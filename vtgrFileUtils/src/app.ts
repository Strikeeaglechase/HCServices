import fs from "fs";
import { Readable } from "stream";
import unzipper, { Entry } from "unzipper";

import { decompressRpcPackets } from "../../VTOLLiveViewerCommon/dist/compression/vtcompression.js";
import { RPCPacket } from "../../VTOLLiveViewerCommon/src/rpc.js";

const targetFile = "../input/CAW requal-2024-05-01T13_47_58.723Z.vtgr";

interface VTGRDataChunk {
	start: number;
	length: number;
}

interface VTGRHeader {
	info: {
		lobbyId: string;
		lobbyName: string;
		missionName: string;
		missionId: string;
		campaignId: string;
		type: string;
		map: string;
		recordingId: string;
		duration: number;
		startTime: number;
	};
	id: string;
	chunks: VTGRDataChunk[];
}

let start = Date.now();
class VTGRBodyReader {
	private buffers: Buffer[] = [];
	private currentSize = 0;
	public totalSize = 0;

	private currentChunkIndex = 0;
	constructor(private header: VTGRHeader, stream: Readable, private cb: (rpc: RPCPacket) => void) {
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
		});
	}

	private async readNextChunk() {
		const currentChunkSize = this.header.chunks[this.currentChunkIndex] ? this.header.chunks[this.currentChunkIndex].length : this.currentSize;
		const buffer = Buffer.concat(this.buffers);
		const chunk = buffer.subarray(0, currentChunkSize);
		console.log(
			`(${Date.now() - start}ms) Current chunk ${this.currentChunkIndex}/${this.header.chunks.length}, size: ${currentChunkSize}, current buffer size: ${
				this.currentSize
			}`
		);
		const chunkPackets = decompressRpcPackets(chunk);
		chunkPackets.forEach(p => this.cb(p));

		const rest = buffer.subarray(currentChunkSize);
		this.currentSize = rest.length;
		this.buffers = [rest];
		this.currentChunkIndex++;
	}
}

async function readFile(path: string) {
	const readStream = fs.createReadStream(path);
	// const writeStream = fs.createWriteStream("../packets.json");

	const output: RPCPacket[] = [];
	let totalPacketCount = 0;
	const onRpc = (rpc: RPCPacket) => {
		totalPacketCount++;
		// if (["PlayerVehicle", "MissileEntity"].includes(rpc.className)) return;
		if (output.length < 10000) output.push(rpc);
	};

	const onFinish = () => {
		// fs.writeFileSync("../packets.json", output.join("\n"));
		const fileKb = Math.round(readStream.bytesRead / 1024);
		const time = Date.now() - start;
		const packetsPerMs = Math.round(totalPacketCount / time);
		const bytesPerMs = Math.round(readStream.bytesRead / time);
		console.log(`Finished reading ${targetFile} (${fileKb}kb) in ${Date.now() - start}ms, read ${totalPacketCount} packets`);
		console.log(`Packets per ms: ${packetsPerMs}, bytes per ms: ${bytesPerMs}`);
		console.log(`Bytes per packet ${Math.round(readStream.bytesRead / totalPacketCount)}`);

		const writeStream = fs.createWriteStream("../packets.json");
		output.forEach(p => writeStream.write(JSON.stringify(p) + "\n"));
		writeStream.end();
		console.log(`Wrote ${output.length} packets to ../packets.json`);
	};

	let header: VTGRHeader;
	let headerPromRes: () => void;
	const headerProm = new Promise<void>(res => (headerPromRes = res));

	readStream.pipe(unzipper.Parse()).on("entry", async (entry: Entry) => {
		const fileName = entry.path;
		console.log(`Reading ${fileName}`);
		if (fileName == "data.bin") {
			console.log(headerProm);
			headerProm.then(() => new VTGRBodyReader(header, entry, onRpc));
			entry.on("close", () => onFinish());
		} else if (fileName == "header.json") {
			header = JSON.parse((await entry.buffer()).toString());
			console.log(header);
			headerPromRes();
		}
	});

	readStream.on("close", () => console.log(`close`));
}

export async function run() {
	console.log(`Reading ${targetFile}`);
	readFile(targetFile);
}

export { VTGRHeader, VTGRDataChunk };
