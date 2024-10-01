import { ChildProcess, fork, spawn } from "child_process";
import fs from "fs";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";

import { IPCPacket, PacketBuilder } from "./ipcPackets.js";

const replayDirectory = "../replays";
const doLoadingBars = false;

let childIndex = 0;
class ChildProcessor {
	private childProc: ChildProcess;
	private id = childIndex++;

	constructor(private filePath: string, private progressBarSocket: WebSocket) {}

	public start() {
		this.childProc = fork("./processor/vtgrProcessor.js", [this.filePath], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
		this.childProc.on("message", msg => {
			const message = msg as IPCPacket;
			this.handleChildMessage(message);
		});

		this.childProc.stdout.on("data", data => console.log(data.toString()?.trim()));
		this.childProc.stderr.on("data", data => console.error(data.toString()?.trim()));
	}

	private handleChildMessage(message: IPCPacket) {
		if (PacketBuilder.isProgressUpdate(message)) {
			message.index = this.id;
			this.progressBarSocket?.send(JSON.stringify(message));
		} else {
			console.log(message);
		}
	}
}

async function setupProgressBar() {
	if (!doLoadingBars) return null;
	const wsServer = new WebSocketServer({ port: 8080 });
	let progressBarSocketPromResolve: (socket: WebSocket) => void;
	const progressBarSocketPromise = new Promise<WebSocket>(res => (progressBarSocketPromResolve = res));
	wsServer.on("connection", socket => progressBarSocketPromResolve(socket));

	const progressBarProcess = spawn("node ./progressBar.js", [], { detached: true, shell: true });
	const progressBarSocket = await progressBarSocketPromise;
	console.log(`Connected to progress bar process`);

	return progressBarSocket;
}

async function run() {
	const progressBarSocket = await setupProgressBar();
	const files = fs.readdirSync(replayDirectory);
	const processors: ChildProcessor[] = files
		.filter(file => file.endsWith(".vtgr"))
		.map(file => new ChildProcessor(path.join(replayDirectory, file), progressBarSocket));

	progressBarSocket?.send(JSON.stringify(PacketBuilder.progressSetup(processors.length)) + "\n");
	processors.forEach(p => p.start());

	process.on("SIGINT", () => {
		progressBarSocket?.send(JSON.stringify(PacketBuilder.exit()) + "\n");
		process.exit();
	});
}

run();
