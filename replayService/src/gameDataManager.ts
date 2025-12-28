import { RPCPacket } from "common/rpc.js";
import { CURRENT_VTGR_METADATA_VERSION, RawPlayerInfo, VTGRHeader, VTGRMetadata } from "common/shared.js";
import express from "express";
import fs from "fs";
import path from "path";
import { Application } from "serviceLib/serviceDefs/Application.js";
import { DBService } from "serviceLib/serviceDefs/DBService.js";
import { StorageService } from "serviceLib/serviceDefs/StorageService.js";
import { VTGRService } from "serviceLib/serviceDefs/VTGRService.js";
import { execFile } from "child_process";

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

		this.api.get("/health", (req, res) => res.sendStatus(200));

		this.recoverRecordings();
		// this.updateOldMetadata();
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

	private async updateOldMetadata() {
		const headers = await DBService.getAllRecordedLobbies();
		const needsUpdating = headers.filter(h => !h.info?.metadata?.version || h.info.metadata.version != CURRENT_VTGR_METADATA_VERSION);
		console.log(`Found ${needsUpdating.length} recordings that need metadata updating`);

		for (let i = 0; i < needsUpdating.length; i++) {
			const header = needsUpdating[i];
			await this.extractLobbyMetadata(header);

			console.log(`Updated metadata for ${header.id} (${i + 1}/${needsUpdating.length})`);
		}
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
		const absolutePath = await StorageService.getAbsolutePath(`recordings/${header.id}.vtgr`);
		const executorPath = path.resolve("../../../VTGRMetadataDump/target/release/vtgr_metadata_dump.exe");
		console.log(`Starting metadata extraction for ${header.id} using external tool`);
		await new Promise<void>(res => {
			execFile(executorPath, [absolutePath], async (error, stdout, stderr) => {
				if (error) {
					console.error(`Error extracting metadata for ${header.id}: ${error.message}`);
					const metadata: Partial<VTGRMetadata> = {
						id: header.id,
						errored: true
					};

					await DBService.updateRecordedLobbyMetadata(metadata as VTGRMetadata);
					res();
					return;
				}

				if (stderr) {
					console.warn(`Stderr from metadata extraction for ${header.id}: ${stderr}`);
				}

				try {
					const metadata: VTGRMetadata = JSON.parse(stdout);
					await DBService.updateRecordedLobbyMetadata(metadata);
					console.log(`Metadata extraction for ${header.id} completed, resolved ${metadata.players.length} players`);
					res();
				} catch (parseError) {
					console.error(`Error parsing metadata JSON for ${header.id}: ${parseError}`);
					const metadata: Partial<VTGRMetadata> = {
						id: header.id,
						errored: true
					};
					await DBService.updateRecordedLobbyMetadata(metadata as VTGRMetadata);
					res();
				}
			});
		});
	}

	private async extractLobbyMetadataOld(header: VTGRHeader) {
		console.log(`Starting metadata extraction for ${header.id}`);
		const packetStream = VTGRService.readRecordingPackets(header.id);

		const metadata: VTGRMetadata = {
			id: header.id,
			players: [],
			netInstantiates: 0,
			totalPackets: 0,
			version: CURRENT_VTGR_METADATA_VERSION,
			errored: false,
			containsSupplementalSensorData: false
		};

		let currentBuffer = "";
		let packetsProcessed = 0;
		packetStream.on("data", (packets: string) => {
			currentBuffer += packets.toString();
			const rpcs = currentBuffer.split("\n");
			currentBuffer = rpcs.pop() as string;

			rpcs.forEach(rpc => {
				if (rpc.length == 0) return;
				const rpcObj = JSON.parse(rpc);
				this.maybeUpdateMetadata(metadata, rpcObj);
			});

			packetsProcessed += rpcs.length;
		});

		await new Promise<void>(res => {
			packetStream.on("close", async () => {
				if (packetsProcessed == 0) {
					metadata.errored = true;
					console.warn(`No packets processed for ${header.id}, marking as errored`);
				}

				if (packetsProcessed == 0 && header.info.metadata) {
					console.warn(`No packets processed for ${header.id}, using existing metadata`);
				} else {
					await DBService.updateRecordedLobbyMetadata(metadata);
				}

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
			case "VTOLLobby.RadarDataReport":
			case "VTOLLobby.IRDataReport":
				metadata.containsSupplementalSensorData = true;
				break;
		}
	}
}

export { GameDataManager };
