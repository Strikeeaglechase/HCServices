import Archiver from "archiver";
import cors from "cors";
import express from "express";
import { VTGRService } from "serviceLib/serviceDefs/VTGRService.js";

import { Parser } from "./parser.js";

class LandingRaterService {
	public api: express.Express;

	public async init() {
		this.api = express();
		this.api.use(cors());

		this.api.get("/rate/:replayId", async (req, res) => {
			await this.rateReplay(req.params.replayId, res);
		});

		this.api.listen(parseInt(process.env.API_PORT), () => {
			console.log(`LRS API opened on ${process.env.API_PORT}`);
		});
	}

	private async rateReplay(replayId: string, res: express.Response) {
		const header = await VTGRService.readFileHeader(replayId);
		if (!header) {
			console.warn(`Request for unknown replay: ${replayId}`);
			res.sendStatus(400);
			return;
		}
		const parser = new Parser();

		parser.onHeaderLoaded(header);
		const packetStream = VTGRService.readRecordingPackets(replayId);
		let currentBuffer = "";
		packetStream.on("data", (packets: string) => {
			currentBuffer += packets.toString();
			const rpcs = currentBuffer.split("\n");
			currentBuffer = rpcs.pop() as string;

			rpcs.forEach(rpc => {
				if (rpc.length == 0) return;
				const rpcObj = JSON.parse(rpc);
				parser.handleRpc(rpcObj);
			});
		});

		packetStream.on("end", () => {
			const archive = Archiver("zip");
			archive.pipe(res);
			console.log(`About to append ${parser.resultImages.length} images to the archive`);
			parser.resultImages.forEach(img => {
				archive.append(img.data, { name: img.name });
			});

			archive.finalize();
		});
	}
}

export { LandingRaterService };
