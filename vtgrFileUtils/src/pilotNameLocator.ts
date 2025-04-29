import { RPCPacket } from "common/rpc.js";
import { VTGRHeader } from "common/shared.js";
import fs from "fs";
import unzipper, { Entry } from "unzipper";

import { VTGRBodyReader } from "./bodyReader.js";

const files = fs.readdirSync("../input/names/");

async function readFile(path: string, onRpc: (rpc: RPCPacket) => void) {
	const start = Date.now();
	const readStream = fs.createReadStream(path);

	let totalPacketCount = 0;

	return new Promise<void>(async res => {
		const onFinish = () => {
			// fs.writeFileSync("../packets.json", output.join("\n"));
			const fileKb = Math.round(readStream.bytesRead / 1024);
			const time = Date.now() - start;
			const packetsPerMs = Math.round(totalPacketCount / time);
			const bytesPerMs = Math.round(readStream.bytesRead / time);
			console.log(`Finished reading ${path} (${fileKb}kb) in ${Date.now() - start}ms, read ${totalPacketCount} packets`);
			console.log(`Packets per ms: ${packetsPerMs}, bytes per ms: ${bytesPerMs}`);
			console.log(`Bytes per packet ${Math.round(readStream.bytesRead / totalPacketCount)}`);

			res();
		};

		let header: VTGRHeader;
		let headerPromRes: () => void;
		const headerProm = new Promise<void>(res => (headerPromRes = res));

		readStream.pipe(unzipper.Parse()).on("entry", async (entry: Entry) => {
			const fileName = entry.path;
			console.log(`Reading ${fileName}`);
			if (fileName == "data.bin") {
				// console.log(headerProm);
				headerProm.then(
					() =>
						new VTGRBodyReader(header, entry, rpc => {
							totalPacketCount++;
							onRpc(rpc);
						})
				);
				entry.on("close", () => onFinish());
			} else if (fileName == "header.json") {
				header = JSON.parse((await entry.buffer()).toString());
				// console.log(header);
				headerPromRes();
			}
		});

		// readStream.on("close", () => console.log(`close`));
	});
}
let result = "";
async function run() {
	const proms = files.map(async (file, idx) => {
		// if (idx != 0) return;
		const pilots: Record<string, string> = {};
		try {
			await readFile(`../input/names/${file}`, rpc => {
				if (rpc.method != "UpdateLobbyInfo") return;
				const players: { steamId: string; pilotName: string; slot: number; team: number; entityId: number; unitId: number }[] = rpc.args[6];
				players.forEach(p => {
					pilots[p.steamId] = p.pilotName;
				});
			}).catch(console.error);
		} catch (e) {
			console.error(e);
		}

		// console.log(pilots);
		if ("76561199833734162" in pilots) {
			// console.log(`Replay ${file} contains pilot 76561199833734162`);
			result += `${file}\n`;
			console.log(result);
		}
	});

	await Promise.all(proms);

	console.log(`Result: ${result}`);
}

run();

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
process.on("exit", () => {
	console.log(`Result: ${result}`);
});
