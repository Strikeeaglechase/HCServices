import { RPCPacket } from "common/rpc.js";

import { IVector3, Vector } from "../../../VTOLLiveViewerCommon/dist/vector.js";
import { RPCConsumer } from "./rpcConsumer.js";
import { MissileData, Stats } from "./stats.js";
import { Processor } from "./vtgrProcessor.js";

enum EntityType {
	Player,
	Missile
}

class Entity extends RPCConsumer {
	public type: EntityType;
	private hasFired = false;

	public position: Vector;
	public rotation: Vector;
	public velocity: Vector;
	public acceleration: Vector;

	private lastPosition = new Vector();
	private incrementalTravelDistance = 0;
	private playerPositionsAtLaunch: { id: string; pos: Vector }[] = [];

	private missileData: MissileData = new MissileData();

	constructor(id: number | string, public ownerId: string, public path: string, position: IVector3, velocity: IVector3, public active: boolean) {
		super(id.toString());
		this.position = new Vector().set(position);
		this.velocity = new Vector().set(velocity);
		this.acceleration = new Vector();
		this.rotation = new Vector();

		this.missileData.startPosition = new Vector().set(this.position);
		this.lastPosition.set(this.position);

		if (path.startsWith("Vehicles")) {
			Stats.playersSpawned++;
			this.type = EntityType.Player;
		} else if (path.toLowerCase().includes("missile")) {
			this.type = EntityType.Missile;
		}
	}

	public handleRpc(rpc: RPCPacket) {
		super.handleRpc(rpc);
		switch (rpc.method) {
			case "SyncShit": {
				this.updateData(rpc.args[0], rpc.args[2], rpc.args[3], rpc.args[1]);
				if (!this.hasFired) this.onMissileFired();
			}

			case "UpdateData": {
				this.updateData(rpc.args[0], rpc.args[1], rpc.args[2], rpc.args[3]);
				break;
			}

			case "Detonate":
				this.handleMissileDetonate();
				break;

			case "Die":
				this.handleDie();
				break;
		}
	}

	private handleDie() {
		if (this.type == EntityType.Player) {
			Stats.playerTravelDistance += this.incrementalTravelDistance;
		}
	}

	private onMissileFired() {
		this.hasFired = true;
		this.startPoint.set(this.position);
		this.lastPosition.set(this.position);

		this.playerPositionsAtLaunch = Processor.instance.entities
			.filter(e => {
				return e instanceof Entity && e.type == EntityType.Player;
			})
			.map((playerEntity: Entity) => {
				return { id: playerEntity.id, pos: playerEntity.position.clone() };
			});

		Stats.missilesFired++;
	}

	private updateData(pos: IVector3, vel: IVector3, acc: IVector3, rot: IVector3) {
		this.position.set(pos);
		this.velocity.set(vel);
		this.acceleration.set(acc);
		this.rotation.set(rot);

		if (this.hasFired || this.type == EntityType.Player) {
			const distance = this.position.distanceTo(this.lastPosition);
			this.incrementalTravelDistance += distance;
			this.lastPosition.set(pos);
		}
	}

	private async handleMissileDetonate() {
		const travelDistance = this.position.distanceTo(this.startPoint);
		Stats.missilesLinearTravelDistance += travelDistance;
		Stats.missilesTravelDistance += this.incrementalTravelDistance;

		const nearestPlayer = Processor.getNearestEntity(this.position, e => e.type == EntityType.Player);
		if (nearestPlayer.dist > 1000) {
			Stats.missilesMissTravelDistance += this.incrementalTravelDistance;
			return;
		}

		const damage = await nearestPlayer.entity.waitForRpc("Damage", 1000);
		if (damage == null) {
			Stats.missilesMissTravelDistance += this.incrementalTravelDistance;
			return;
		}

		Stats.missilesHit++;

		const posAtLaunch = this.playerPositionsAtLaunch.find(p => p.id == nearestPlayer.entity.id);
		if (!posAtLaunch) {
			console.log(`No position at time of launch? Did missile hit someone that wasn't spawned?`);
			return;
		}

		const hitDistance = posAtLaunch.pos.distanceTo(this.startPoint);
		Stats.missilesHitLaunchRange += hitDistance;
		Stats.missilesHitTravelDistance += this.incrementalTravelDistance;
	}
}

export { Entity };
