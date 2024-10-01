import { VTGRHeader } from "common/shared.js";
import { IVector3 } from "common/vector.js";
import fs from "fs";
import unzipper, { Entry } from "unzipper";

import { RPCPacket } from "../../VTOLLiveViewerCommon/src/rpc.js";
import { VTGRBodyReader } from "./bodyReader.js";
import { Entity } from "./entity.js";
import { RPCConsumer } from "./rpcConsumer.js";

class Lobby extends RPCConsumer {
	public users: { steamId: string; pilotName: string }[] = [];

	public handleRpc(rpc: RPCPacket): void {
		if (rpc.method == "UpdateLobbyInfo") {
			this.users = rpc.args[6];
		}
	}
}
const rpc_str = (packet: RPCPacket) => `${packet.className}.${packet.method}`;

class Parser {
	private header: VTGRHeader;
	private bodyReader: VTGRBodyReader;

	private lobby: Lobby;
	public entities: RPCConsumer[] = [];
	private entitiesMap: Map<string, RPCConsumer> = new Map();

	private lastRpcTime = 0;
	public resultImages: { name: string; data: Buffer }[] = [];
	private writeImagesToLocalDisk = false;

	public static instance: Parser;
	public static get time() {
		return Parser.instance.lastRpcTime;
	}

	constructor() {
		Parser.instance = this;
	}

	public async initFromFile(filePath: string) {
		this.writeImagesToLocalDisk = true;
		const readStream = fs.createReadStream(filePath);

		let headerPromRes: () => void;
		const headerProm = new Promise<void>(res => (headerPromRes = res));
		readStream.pipe(unzipper.Parse()).on("entry", async (entry: Entry) => {
			const fileName = entry.path;
			if (fileName == "data.bin") {
				await headerProm;
				this.bodyReader = new VTGRBodyReader(this.header, entry, this.handleRpc.bind(this));
				entry.on("close", () => this.onFinish());
			} else if (fileName == "header.json") {
				this.header = JSON.parse((await entry.buffer()).toString());
				headerPromRes();
				this.onHeaderLoaded(this.header);
			}
		});
	}

	public onHeaderLoaded(header: VTGRHeader) {
		this.header = header;
		console.log(`Processing lobby ${this.header.info.lobbyName} (${this.header.info.lobbyId})`);
		console.log(`Replay id: ${this.header.id}`);
		const lobbyId = this.header.info.lobbyId;
		this.lobby = new Lobby(lobbyId);
		this.registerEntity(this.lobby);
	}

	public handleRpc(rpc: RPCPacket) {
		this.lastRpcTime = rpc.timestamp;
		if (rpc.className == "MessageHandler") {
			this.handleMessageHandler(rpc);
		} else if (rpc.id) {
			this.handleEntityRpc(rpc);
		} else {
			console.log(`Unhandled RPC: ${rpc_str(rpc)}`);
		}
	}

	private handleMessageHandler(rpc: RPCPacket) {
		switch (rpc.method) {
			case "NetInstantiate": {
				const [id, ownerId, path, pos, rot, active] = rpc.args;
				// if (Math.round(id) != id) console.log(id);
				const entity = new Entity(id, ownerId, path, pos, rot, active);
				this.registerEntity(entity);
				break;
			}

			case "NetDestroy":
				this.unregisterEntity(this.getEntity(rpc.args[0]));
				break;

			// SetEntityUnitID(entityId: number, unitId: number)
			// case "SetEntityUnitID":
			// 	const [entityId, unitId] = rpc.args;
			// 	console.log({ entityId, unitId });
			// 	break;
		}
	}

	private getEntity(id: string) {
		return this.entitiesMap.get(id);
	}

	private registerEntity(entity: RPCConsumer) {
		if (entity == undefined) return;
		this.entitiesMap.set(entity.id, entity);
		this.entities.push(entity);
	}

	private unregisterEntity(entity: RPCConsumer) {
		if (entity == undefined) return;
		this.entitiesMap.delete(entity.id);
		this.entities.splice(this.entities.indexOf(entity), 1);
	}

	private handleEntityRpc(rpc: RPCPacket) {
		const entity = this.getEntity(rpc.id);
		if (!entity) {
			// console.log(`Unable to find entity with id ${rpc.id}. RPC: ${rpc_str(rpc)}`);
			return;
		}

		entity.handleRpc(rpc);
	}

	public static getNearestEntity(pos: IVector3, condition: (entity: Entity) => boolean = () => true) {
		return Parser.instance.getNearestEntity(pos, condition);
	}

	public getNearestEntity(pos: IVector3, condition: (entity: Entity) => boolean = () => true) {
		let closestEntity: Entity = null;
		let closestDistance = Infinity;

		const entityList = this.entities.filter(e => e instanceof Entity && condition(e as Entity)) as Entity[];
		for (const otherEntity of entityList) {
			const distance = otherEntity.position.distanceTo(pos);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestEntity = otherEntity;
			}
		}

		return { entity: closestEntity, dist: closestDistance };
	}

	public getUserName(steamId: string) {
		const user = this.lobby.users.find(u => u.steamId == steamId);
		return user ? user.pilotName : "Unknown";
	}

	private async onFinish() {
		if (!this.writeImagesToLocalDisk) return;
		this.resultImages.forEach(({ name, data }) => {
			fs.writeFileSync(`../landingGraphs/${name}`, data);
		});
		console.log(`Total packets parsed: ${this.bodyReader.packetsParsed} in ${Date.now() - this.bodyReader.startTime}ms`);
		// console.log("Finished processing");
		// process.exit();
	}
}

export { Parser };
