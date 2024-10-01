import { RPCPacket } from "common/rpc.js";
import { VTGRHeader } from "common/shared.js";
import fs from "fs";
import unzipper, { Entry } from "unzipper";

import { VTGRBodyReader } from "./bodyReader.js";

const targetFile = "../input/test.vtgr";
async function parseFile() {
	const readStream = fs.createReadStream(targetFile);

	let headerPromRes: () => void;
	const headerProm = new Promise<void>(res => (headerPromRes = res));
	let header: VTGRHeader;

	await new Promise<void>(res => {
		readStream.pipe(unzipper.Parse()).on("entry", async (entry: Entry) => {
			const fileName = entry.path;
			if (fileName == "data.bin") {
				await headerProm;
				const bodyReader = new VTGRBodyReader(header, entry, handleRpc);

				let lastPrecDone = "";
				setInterval(() => {
					const curPrecDone = (bodyReader.precDone * 100).toFixed(0);
					if (curPrecDone != lastPrecDone) {
						console.log(`Progress: ${curPrecDone}%`);
						lastPrecDone = curPrecDone;
					}
				}, 0);

				entry.on("close", () => res());
			} else if (fileName == "header.json") {
				header = JSON.parse((await entry.buffer()).toString());
				headerPromRes();
			}
		});
	});
}

const writeStream = fs.createWriteStream("../dump.json");
function handleRpc(rpc: RPCPacket) {
	if (rpc.className == "MissileEntity" || rpc.className == "PlayerVehicle") return;
	writeStream.write(JSON.stringify(rpc) + "\n");
}

parseFile();
