import Archiver from "archiver";
import { decompressRpcPackets } from "common/compression/vtcompression.js";
import { RecordedLobbyInfo, RecordedLobbyPacket, VTGRDataChunk, VTGRHeader } from "common/shared.js";
import fs from "fs";
import { DBService } from "serviceLib/serviceDefs/DBService.js";
import { StorageService } from "serviceLib/serviceDefs/StorageService.js";
import { WorkshopService } from "serviceLib/serviceDefs/WorkshopService.js";
import { Callable, Event, ReadStream } from "serviceLib/serviceHandler.js";
import { Readable, Writable } from "stream";
import unzipper, { Entry } from "unzipper";

export const recordingPath = "../recordings/";
if (!fs.existsSync(recordingPath)) {
	fs.mkdirSync(recordingPath);
}

class VTGRBodyReader {
	private buffers: Buffer[] = [];
	private currentSize = 0;
	public totalSize = 0;

	private currentChunkIndex = 0;
	constructor(private header: VTGRHeader, stream: Readable, private outStream: Writable, private packetsPerChunk = 5000) {
		stream.on("data", data => {
			this.totalSize += data.length;
			this.currentSize += data.length;

			this.buffers.push(data);

			if (this.currentSize >= this.header.chunks[this.currentChunkIndex].length) {
				this.readNextChunk();
			}
		});

		stream.on("end", () => {
			this.readNextChunk();
			this.outStream.end();
		});
	}

	private async readNextChunk() {
		const currentChunkSize = this.header.chunks[this.currentChunkIndex] ? this.header.chunks[this.currentChunkIndex].length : this.currentSize;
		const buffer = Buffer.concat(this.buffers);
		const chunk = buffer.subarray(0, currentChunkSize);

		const chunkPackets = decompressRpcPackets(chunk);

		for (let i = 0; i < chunkPackets.length; i += this.packetsPerChunk) {
			const rpcChunk = chunkPackets.slice(i, i + this.packetsPerChunk);
			const data = rpcChunk.map(c => JSON.stringify(c)).join("\n");
			this.outStream.write(data + "\n");
		}

		const rest = buffer.subarray(currentChunkSize);
		this.currentSize = rest.length;
		this.buffers = [rest];
		this.currentChunkIndex++;
	}
}

class VTGRService {
	public async init() {
		console.log(`VTGRFileHandler initialized`);

		this.loadIngest();
	}

	// TODO: Remove need for temp file, stream direct to archive and direct back to storage service
	//       change so no need for any storage
	@Callable
	public async dumpGameToFile(recordingId: string) {
		console.log(`Dumping lobby ${recordingId} to a file (${recordingId})`);
		const packetStream = DBService.getLobbyPacketStream(recordingId);
		const writeStream = fs.createWriteStream(`${recordingPath}${recordingId}.temp`);

		const chunks: VTGRDataChunk[] = [];
		let dataBytes = 0;
		let totalPackets = 0;
		let initPacket: RecordedLobbyPacket;
		let endPacket: RecordedLobbyPacket;

		packetStream.on("data", data => {
			const packet = JSON.parse(data.toString());
			totalPackets++;
			if (packet.type === "packet") {
				const buffer = Buffer.from(packet.data, "base64");
				writeStream.write(buffer);
				chunks.push({ start: dataBytes, length: buffer.length });
				dataBytes += buffer.length;
			} else if (packet.type == "init") {
				initPacket = packet;
			} else if (packet.type == "event" && packet.data == "stop") {
				endPacket = packet;
			}
		});

		await new Promise(async res => {
			await new Promise(res => packetStream.on("end", res));
			writeStream.end(res);
		});

		// TODO: Cleanup temp
		if (!initPacket || !endPacket) {
			console.log(`Could not find init or end packet, aborting`);
			console.log(`Total packets: ${totalPackets} (Bytes: ${dataBytes})`);
			return;
		}
		const lobbyId = initPacket.lobbyId;
		const info = await this.produceRecordedLobbyInfo(lobbyId, recordingId, JSON.parse(initPacket.data), initPacket.timestamp, endPacket.timestamp);
		console.log(`Dumping lobby ${info.lobbyName} (${info.lobbyId}) to a file (${info.recordingId}). DB Packets: ${totalPackets} (Bytes: ${dataBytes})`);
		console.log(`Fetched ${(dataBytes / 1000 / 1000).toFixed(1)}mb of recorded data, wrote to ${recordingPath}${info.recordingId}.temp`);

		const header: VTGRHeader = {
			info: info,
			id: info.recordingId,
			chunks: chunks
		};
		console.log(`Compressing and finalizing file for ${recordingId}`);
		await this.compressAndFinalize(header, recordingPath + info.recordingId);
		console.log(`Compress completed, cleaning up for ${recordingId}`);
		DBService.addStoredLobbyHeader(header);
		DBService.deleteRecordedLobbyPackets(recordingId);

		// console.log(` - Finished dumping lobby ${info.lobbyName} (${info.lobbyId}) to a file`);
		fs.unlinkSync(recordingPath + info.recordingId + ".temp");

		this.vtgrFileFinalized(lobbyId, header);
	}

	@ReadStream
	public async readRecordingBody(writeStream: Writable, replayId: string) {
		const readStream = StorageService.read(`recordings/${replayId}.vtgr`);
		readStream.pipe(unzipper.Parse()).on("entry", (entry: Entry) => {
			const fileName = entry.path;
			if (fileName == "data.bin") entry.pipe(writeStream); // Write body to stream
			else entry.autodrain();
		});
	}

	@ReadStream
	public async readRecordingPackets(writeStream: Writable, replayId: string) {
		const header = await DBService.getRecordedLobby(replayId);
		if (!header) {
			console.warn(`Request for unknown recording: ${replayId}`);
			return writeStream.end();
		}

		const readStream = StorageService.read(`recordings/${replayId}.vtgr`);
		readStream.pipe(unzipper.Parse()).on("entry", (entry: Entry) => {
			const fileName = entry.path;
			if (fileName == "data.bin") new VTGRBodyReader(header, entry, writeStream);
			else entry.autodrain();
		});
	}

	private async compressAndFinalize(vtgrHeader: VTGRHeader, fileName: string) {
		const input = fs.createReadStream(fileName + ".temp");
		const archive = Archiver("zip");

		// Pipe archive to storage service
		const writeStream = StorageService.write(`recordings/${vtgrHeader.id}.vtgr`);
		const completionPromise = new Promise(res => writeStream.on("close", res));
		archive.pipe(writeStream);

		// writeStream.on("close", () => console.log(`Write stream closed`));
		// archive.on("close", () => console.log(`Archive stream closed`));

		const header = JSON.stringify(vtgrHeader);
		archive.append(header, { name: "header.json" });
		archive.append(input, { name: "data.bin" });
		archive.finalize();

		// Upload header
		StorageService.writeData(`recordings/${vtgrHeader.id}.json`, header);

		await completionPromise;
	}

	@Event
	private vtgrFileFinalized(lobbyId: string, header: VTGRHeader) {}

	private async produceRecordedLobbyInfo(lobbyId: string, recordingId: string, packet: any, startTime: number, endTime: number): Promise<RecordedLobbyInfo> {
		if (!packet.missionInfo) {
			console.error(`No mission info for packet from lobby ${lobbyId}, recording: ${recordingId}`);
		}

		if (!packet.lobbyInfo) {
			console.error(`No lobby info for packet from lobby ${lobbyId}, recording: ${recordingId}`);
		}

		// I don't want to talk about it
		return {
			lobbyId: lobbyId,
			lobbyName: packet.lobbyInfo?.args[0],
			missionName: packet.missionInfo?.args[0],
			missionId: packet.missionInfo?.args[1],
			campaignId: packet.missionInfo?.args[2],
			workshopId: packet.missionInfo?.args[3],
			map: packet.missionInfo?.args[4],
			hostId: packet.lobbyInfo?.args[7],
			hostName: packet.lobbyInfo?.args[8],
			recordingId: recordingId,
			duration: endTime - startTime,
			startTime: startTime,
			missionInfo: packet.missionInfo != null ? await WorkshopService.getMissionInfo(packet.missionInfo.args[3], packet.missionInfo.args[1]) : null
		};
	}

	@Callable
	public async readFileHeader(id: string): Promise<VTGRHeader> {
		console.log(`Reading header for ${id}`);

		// Directly download header if it exists
		const alreadyParsedHeader = await StorageService.exists(`recordings/${id}.json`);
		if (alreadyParsedHeader) {
			console.log(` - Found header file in S3, downloading`);
			return JSON.parse(await StorageService.readData(`recordings/${id}.json`));
		}

		let filesStream: unzipper.ParseStream = null;
		try {
			// files = fs.createReadStream(`${recordingPath}${id}.vtgr`).pipe();
			filesStream = unzipper.Parse({ forceStream: true });
			const stream = StorageService.read(`recordings/${id}.vtgr`);
			stream.pipe(filesStream);
		} catch (e) {
			console.log(`Exception reading file: ${e}`);
		}

		if (filesStream == null) {
			console.log(`No files object returned`);
			return;
		}

		for await (const f of filesStream) {
			const file = f as Entry;
			if (file.path === "header.json") {
				const buf = await file.buffer();
				console.log(` - Found header file, ${buf.length} bytes`);
				// Write header to S3
				StorageService.writeData(`recordings/${id}.json`, buf.toString());
				return JSON.parse(buf.toString());
			}
		}
	}

	private async loadIngest() {
		if (!fs.existsSync("../ingest")) return;
		if (!fs.existsSync("../ingest-finished")) fs.mkdirSync("../ingest-finished");
		const files = fs.readdirSync("../ingest");
		files.forEach(async file => {
			if (file.endsWith(".vtgr")) {
				await this.ingestFile(`../ingest/${file}`);
				fs.renameSync(`../ingest/${file}`, `../ingest-finished/${file}`);
			} else {
				console.log(`Skipping file ${file} for ingest`);
			}
		});
	}

	private async ingestFile(filePath: string) {
		console.log(`Ingesting file at ${filePath}`);
		const header = await this.readHeaderFromLocalFile(filePath);
		console.log(`Here with local header`);
		if (!header) {
			console.error(`Ingest file at ${filePath} is an invalid VTGR file (no header)`);
			return;
		}

		const existingHeader = await DBService.getRecordedLobby(header.id);
		if (existingHeader) {
			console.warn(`Ingest file at ${filePath} already exists in DB as ${header.id}, skipping`);
			return;
		}

		// Upload to storage
		const writeStream = StorageService.write(`recordings/${header.id}.vtgr`);
		const readStream = fs.createReadStream(filePath);
		const rsProm = new Promise<void>(res =>
			readStream.on("close", () => {
				writeStream.end();
				res();
			})
		);
		// readStream.on("data", c => console.log(c));
		readStream.pipe(writeStream);

		// Upload header
		await StorageService.writeData(`recordings/${header.id}.json`, JSON.stringify(header));
		// Upload to db
		await DBService.addStoredLobbyHeader(header);
		// Wait for body upload to finish
		await rsProm;

		console.log(`Ingested file at ${filePath} as ${header.id}`);
	}

	private async readHeaderFromLocalFile(filePath: string) {
		const readStream = fs.createReadStream(filePath);
		return new Promise<VTGRHeader>(res => {
			readStream
				.pipe(unzipper.Parse())
				.on("entry", (entry: Entry) => {
					const fileName = entry.path;
					console.log(`Reading ${fileName}`);
					if (fileName == "header.json") entry.buffer().then(buf => res(JSON.parse(buf.toString())));
					else entry.autodrain();
				})
				.on("error", err => console.error(err));
		});
	}

	private async test() {
		const header = await this.readFileHeader("3bf4f04e-0b1a-4084-84b4-3c5e1bb73593");
		const files = fs.createReadStream(`${recordingPath}3bf4f04e-0b1a-4084-84b4-3c5e1bb73593.vtgr`).pipe(unzipper.Parse({ forceStream: true }));
		for await (const f of files) {
			const file = f as Entry;
			if (file.path === "data.bin") {
				const buf = await file.buffer();
				console.log(` - Got data file, ${buf.length} bytes`);

				const packets = [];
				header.chunks.forEach((chunk, idx) => {
					const slice = buf.subarray(chunk.start, chunk.start + chunk.length);
					const chunkPackets = decompressRpcPackets(slice);
					packets.push(...chunkPackets);
					console.log(` - Chunk #${idx} - ${chunkPackets.length} packets`);
				});

				fs.writeFileSync("../test.json", JSON.stringify(packets));
			}
		}
	}
}

export { VTGRService };
