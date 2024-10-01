import { VTGRHeader } from "common/shared.js";
import { IVector3 } from "common/vector.js";
import fs from "fs";
import unzipper, { Entry } from "unzipper";

import { RPCPacket } from "../../../VTOLLiveViewerCommon/src/rpc.js";
import { PacketBuilder } from "../ipcPackets.js";
import { VTGRBodyReader } from "./bodyReader.js";
import { Entity } from "./entity.js";
import { RPCConsumer } from "./rpcConsumer.js";
import { Stats } from "./stats.js";

const rpc_str = (packet: RPCPacket) => `${packet.className}.${packet.method}`;

class Lobby extends RPCConsumer {
	public handleRpc(rpc: RPCPacket): void {}
}

class Processor {
	private header: VTGRHeader;
	private bodyReader: VTGRBodyReader;

	public entities: RPCConsumer[] = [];
	private entitiesMap: Map<string, RPCConsumer> = new Map();
	private lastRpcTime = 0;

	public static instance: Processor;
	public static get time() {
		return Processor.instance.lastRpcTime;
	}

	constructor() {
		Processor.instance = this;
	}

	public async init(filePath: string) {
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
				this.onHeaderLoaded();
			}
		});

		setInterval(() => this.sendPrecDone(), 100);
	}

	private onHeaderLoaded() {
		console.log(`Processing lobby ${this.header.info.lobbyName} (${this.header.info.lobbyId})`);
		const lobbyId = this.header.info.lobbyId;
		const lobby = new Lobby(lobbyId);
		this.registerEntity(lobby);
	}

	private sendPrecDone() {
		if (!this.bodyReader) return;
		process.send(PacketBuilder.progressUpdate(this.bodyReader.totalSizeParsed, this.bodyReader.totalSize));
	}

	private handleRpc(rpc: RPCPacket) {
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
				const entity = new Entity(id, ownerId, path, pos, rot, active);
				this.registerEntity(entity);
				break;
			}

			case "NetDestroy":
				this.unregisterEntity(this.getEntity(rpc.args[0]));
				break;
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

	public static getNearestEntity(pos: IVector3, condition: (entity: Entity) => boolean = () => true) {
		return Processor.instance.getNearestEntity(pos, condition);
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

	private handleEntityRpc(rpc: RPCPacket) {
		const entity = this.getEntity(rpc.id);
		if (!entity) {
			console.log(`Unable to find entity with id ${rpc.id}. RPC: ${rpc_str(rpc)}`);
			return;
		}

		entity.handleRpc(rpc);
	}

	private async onFinish() {
		console.log("Finished processing");
		Stats.print();
		this.sendPrecDone();
		process.exit();
	}
}

const processor = new Processor();
processor.init(process.argv[2]);

export { Processor };
