import { RPCPacket } from "common/rpc.js";
import { RawPlayerInfo, VTGRHeader, VTGRMetadata } from "common/shared.js";
import express from "express";
import fs from "fs";
import path from "path";
import { Application } from "serviceLib/serviceDefs/Application.js";
import { DBService } from "serviceLib/serviceDefs/DBService.js";
import { StorageService } from "serviceLib/serviceDefs/StorageService.js";
import { VTGRService } from "serviceLib/serviceDefs/VTGRService.js";

import { GameDataRecorder } from "./gameDataRecorder.js";

class GameDataManager {
	private recorders: Record<string, GameDataRecorder> = {};
	constructor(private api: express.Express) {}

	public async init() {
		this.api.get("/recordings", async (req, res) => {
			const entries = await DBService.getAllRecordedLobbies();
			res.send(entries.map(e => e.info));
		});

		Application.on("lobbyConnected", lobbyId => {
			console.log(`OnLobbyConnected: ${lobbyId}, starting recorder`);
			const recorder = new GameDataRecorder(lobbyId, this);
			recorder.init();
			this.recorders[lobbyId] = recorder;
		});

		Application.on("lobbyDisconnected", lobbyId => {
			console.log(`OnLobbyDisconnected: ${lobbyId}, stopping recorder`);
			const recorder = this.recorders[lobbyId];
			if (recorder) {
				recorder.stop();
				delete this.recorders[lobbyId];
			}
		});

		Application.on("lobbyData", (lobbyId, packets) => {
			const recorder = this.recorders[lobbyId];
			if (recorder) {
				recorder.recordPackets(packets);
			}
		});

		VTGRService.on("vtgrFileFinalized", (lobbyId, header) => {
			this.extractLobbyMetadata(header);
		});

		this.api.get("/recordings/:recordingId/:dlname", async (req, res) => {
			if (!req.params.recordingId) return res.sendStatus(400);
			const entry = await DBService.getRecordedLobby(req.params.recordingId);
			if (!entry) {
				console.warn(`Request for unknown recording: ${req.params.recordingId}`);
				return res.sendStatus(400);
			}

			// const filepath = path.resolve(recordingPath, `${entry.id}.vtgr`);
			const exists = await StorageService.exists(`recordings/${entry.id}.vtgr`);
			if (exists) {
				// res.setHeader("MIME-Type", "application/octet-stream");
				// res.download(filepath, `demotesting`);

				const size = await StorageService.sizeof(`recordings/${entry.id}.vtgr`);
				console.log(`Download request for ${entry.info.lobbyName} (${entry.id}). Size: ${(size / 1000 / 1000).toFixed(1)}mb`);
				res.setHeader("Content-Length", size);
				res.setHeader("MIME-Type", "application/octet-stream");

				const readStream = StorageService.read(`recordings/${entry.id}.vtgr`);
				readStream.on("data", data => {
					res.write(data);
				});
				readStream.on("end", () => {
					res.end();
					console.log(`Stream end!`);
				});
			} else {
				console.error(`Recording entry ${entry.id} exists in the DB, however no file is located at recordings/${entry.id}.vtgr in S3`);
				res.sendStatus(404);
			}
		});

		this.recoverRecordings();
	}

	private async recoverRecordings() {
		const initPackets = await DBService.getActivelyRecordingLobbiesInitPackets();
		const proms = initPackets.map(async packet => {
			console.log(`Recovering recording for ${packet.lobbyId}`);
			const existingEndPacket = await DBService.getActivelyRecordingStopPacket(packet.recordingId);
			if (existingEndPacket) {
				console.log(`Recording for ${packet.lobbyId} already has an end packet`);
			} else {
				console.log(`Recording for ${packet.lobbyId} does not have an end packet, adding one`);
				const lastDataPacket = await DBService.getActivelyRecordingLastPacket(packet.lobbyId);
				const timestamp = lastDataPacket ? lastDataPacket.timestamp : Date.now();
				await GameDataRecorder.addStopPacket(packet.lobbyId, packet.recordingId, timestamp);
			}

			console.log(`Starting VTGR dump for ${packet.lobbyId}`);
			await VTGRService.dumpGameToFile(packet.recordingId);
			console.log(`VTGR dump for ${packet.lobbyId} completed`);
		});

		await Promise.all(proms);
	}

	public async restartRecorder(lobbyId: string) {
		const recorder = this.recorders[lobbyId];
		if (!recorder) return;

		await recorder.stop();
		const newRecorder = new GameDataRecorder(lobbyId, this);
		newRecorder.init();
		this.recorders[lobbyId] = newRecorder;
	}

	private async extractLobbyMetadata(header: VTGRHeader) {
		console.log(`Starting metadata extraction for ${header.id}`);
		const packetStream = VTGRService.readRecordingPackets(header.id);

		const metadata: VTGRMetadata = {
			id: header.id,
			players: [],
			netInstantiates: 0,
			totalPackets: 0
		};

		let currentBuffer = "";
		packetStream.on("data", (packets: string) => {
			currentBuffer += packets.toString();
			const rpcs = currentBuffer.split("\n");
			currentBuffer = rpcs.pop() as string;

			rpcs.forEach(rpc => {
				if (rpc.length == 0) return;
				const rpcObj = JSON.parse(rpc);
				this.maybeUpdateMetadata(metadata, rpcObj);
			});
			// const rpcs = packets
			// 	.toString()
			// 	.split("\n")
			// 	.map(p => {
			// 		if (p.length == 0) return null;
			// 		return JSON.parse(p);
			// 	})
			// 	.filter(p => p != null);

			// rpcs.forEach(rpc => this.maybeUpdateMetadata(metadata, rpc));
		});

		await new Promise<void>(res => {
			packetStream.on("close", async () => {
				await DBService.updateRecordedLobbyMetadata(metadata);
				console.log(`Metadata extraction for ${header.id} completed, resolved ${metadata.players.length} players`);
				res();
			});
		});
	}

	private maybeUpdateMetadata(metadata: VTGRMetadata, rpc: RPCPacket) {
		const cmPair = `${rpc.className}.${rpc.method}`;
		metadata.totalPackets++;

		switch (cmPair) {
			case "MessageHandler.NetInstantiate":
				metadata.netInstantiates++;
				break;
			case "VTOLLobby.UpdateLobbyInfo": {
				const players: RawPlayerInfo[] = rpc.args[6];
				players
					.filter(player => !metadata.players.some(p => p.id == player.steamId))
					.forEach(p => metadata.players.push({ name: p.pilotName, id: p.steamId }));
				break;
			}
		}
	}
}

export { GameDataManager };
