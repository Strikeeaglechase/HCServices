import { compressRpcPackets } from "common/compression/vtcompression.js";
import { RPCPacket } from "common/rpc.js";
import { RecordedLobbyPacket } from "common/shared.js";
import { Application } from "serviceLib/serviceDefs/Application.js";
import { DBService } from "serviceLib/serviceDefs/DBService.js";
import { VTGRService } from "serviceLib/serviceDefs/VTGRService.js";
import { v4 as uuidv4 } from "uuid";

import { GameDataManager } from "./gameDataManager.js";

const compress = (data: RPCPacket[]) => toB64(compressRpcPackets(data, true));
const toB64 = (data: number[]) => Buffer.from(data).toString("base64");

// Change to three hours to try to mitigate restart related bugs
const MAX_RECORD_TIME = 3 * 60 * 60 * 1000; // 3 hours
// const MAX_RECORD_TIME = 60 * 1000; // 1 minute

class GameDataRecorder {
	private packetQueue: RPCPacket[] = [];
	private flushLoop: NodeJS.Timer;
	private recordingNumber = 0;
	private startAtTime: number;
	private _isStopped = true;
	private timesWithoutPackets = 0;
	private recordingId: string;

	private get isStopped() {
		return this._isStopped;
	}
	private set isStopped(value: boolean) {
		console.log(`Game data recorder for ${this} isStopped: ${value}`);
		this._isStopped = value;
	}

	constructor(private gameId: string, private manager: GameDataManager) {
		this.recordingId = uuidv4();
	}

	public async init() {
		if (!this.isStopped) {
			console.error(`Game data recorder for ${this} is already running, but init was called`);
			await this.stop();
		}
		this.isStopped = false;
		this.startAtTime = Date.now();
		this.recordingNumber++;
		this.flushLoop = setInterval(() => this.flush(), 1000 * 30);
		this.event("init");

		const resyncPackets = await Application.getLobbyResyncRPCs(this.gameId);
		const [lastMissionInfo, lastLobbyInfo] = resyncPackets;

		const initPacket: RecordedLobbyPacket = {
			type: "init",
			data: JSON.stringify({ lobbyInfo: lastLobbyInfo, missionInfo: lastMissionInfo }),
			lobbyId: this.gameId,
			id: uuidv4(),
			recordingId: this.recordingId,
			timestamp: Date.now()
		};
		DBService.addRecordedLobbyPacket(initPacket);
		this.packet(resyncPackets);
		console.log(`Game data recorder for ${this} initialized (${this.recordingNumber}) - ${this.isStopped}`);
	}

	public async stop() {
		console.log(`Stopping game data recorder for ${this}`);
		clearInterval(this.flushLoop);
		await this.event("stop");
		await this.flush();

		this.setStopped(`stop() called`);
		await VTGRService.dumpGameToFile(this.recordingId);
	}

	public recordPackets(packets: RPCPacket[]) {
		if (this.isStopped) {
			console.error(`Game data recorder for ${this} is already stopped, but recordPackets was called`);
		}
		this.packet(packets);
	}

	private async flush() {
		if (this.isStopped) {
			console.error(`Game data recorder for ${this} is already stopped, but flush was called`);
			return;
		}
		console.log(`Flushing game data recorder for ${this}, packets: ${this.packetQueue.length}`);

		if (this.packetQueue.length > 0) {
			const compressed = compress(this.packetQueue);
			this.packetQueue = []; // Instantly clear the queue, must be done before await to prevent loosing packets
			const packet: RecordedLobbyPacket = {
				type: "packet",
				data: compressed,
				lobbyId: this.gameId,
				id: uuidv4(),
				recordingId: this.recordingId,
				timestamp: Date.now()
			};
			await DBService.addRecordedLobbyPacket(packet);
		}
		// else {
		// 	console.log(`30 seconds without packets`);
		// 	this.timesWithoutPackets++;
		// 	if (this.timesWithoutPackets == 2) {
		// 		console.log(`Game data recorder for ${this.gameId} has been without packets for 1 minute, restarting`);
		// 		this.stop();
		// 	}
		// }

		if (Date.now() - this.startAtTime > MAX_RECORD_TIME) {
			// this.isStopped = true;
			// await this.stop();
			// this.init();
			console.log(`Game data recorder for ${this} has reached max recording time, restarting`);
			this.setStopped(`Max recording time reached`);
			await this.manager.restartRecorder(this.gameId);
		}
	}

	private setStopped(reason: string) {
		this.isStopped = true;
		console.log(`Game data recorder for ${this} stopped: ${reason}`);
	}

	private async event(data: string) {
		const packet: RecordedLobbyPacket = {
			type: "event",
			data: data,
			lobbyId: this.gameId,
			id: uuidv4(),
			recordingId: this.recordingId,
			timestamp: Date.now()
		};

		await DBService.addRecordedLobbyPacket(packet);

		return packet.id;
	}

	public static async addStopPacket(gameId: string, recordingId: string, time: number) {
		const packet: RecordedLobbyPacket = {
			type: "event",
			data: "stop",
			lobbyId: gameId,
			id: uuidv4(),
			recordingId: recordingId,
			timestamp: time
		};

		await DBService.addRecordedLobbyPacket(packet);

		return packet.id;
	}

	private packet(packets: RPCPacket[]) {
		packets.filter(p => p != null).forEach(p => (p.timestamp = Date.now()));
		// this.packetQueue.push(...packets); Overflow's if too many packets are sent at once, so switch to loop
		for (let i = 0; i < packets.length; i++) this.packetQueue.push(packets[i]);
	}

	public toString() {
		return `${this.gameId} (${this.recordingId})`;
	}
}

export { GameDataRecorder };
