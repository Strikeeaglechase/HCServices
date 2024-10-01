import { decompressRpcPackets } from "common/compression/vtcompression.js";
import { VTGRHeader } from "common/shared.js";
import { Readable } from "stream";

import { RPCPacket } from "../../VTOLLiveViewerCommon/src/rpc.js";

class VTGRBodyReader {
	private buffers: Buffer[] = [];

	private currentSize = 0;
	private currentChunkIndex = 0;

	public totalSizeParsed = 0;
	public packetsParsed = 0;
	public totalSize = 0;
	public startTime = Date.now();
	public get precDone() {
		return this.totalSizeParsed / this.totalSize;
	}

	constructor(private header: VTGRHeader, stream: Readable, private cb: (rpc: RPCPacket) => void) {
		const lastChunk = this.header.chunks[this.header.chunks.length - 1];
		this.totalSize = lastChunk.start + lastChunk.length;

		stream.on("data", data => {
			this.totalSizeParsed += data.length;
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
		const chunkPackets = decompressRpcPackets(chunk);
		chunkPackets.forEach(p => this.cb(p));

		this.packetsParsed += chunkPackets.length;
		if (this.currentChunkIndex % 10 == 0) {
			const t = Date.now() - this.startTime;
			const packetPerMs = this.packetsParsed / t; //this.packetsParsed / (t / 1000);
			const packetsPerSecond = packetPerMs * 1000;
			console.log(`Parsed ${this.packetsParsed} packets, ${packetsPerSecond.toFixed(0)}pps, ${(this.precDone * 100).toFixed(2)}%`);
		}

		const rest = buffer.subarray(currentChunkSize);
		this.currentSize = rest.length;
		this.buffers = [rest];
		this.currentChunkIndex++;
	}
}

export { VTGRBodyReader };
