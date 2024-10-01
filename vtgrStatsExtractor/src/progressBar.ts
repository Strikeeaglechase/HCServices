import cliProgress from "cli-progress";
import WebSocket from "ws";

import { IPCPacket, PacketBuilder } from "./ipcPackets.js";

const multibar = new cliProgress.MultiBar(
	{
		hideCursor: true,
		clearOnComplete: false,
		etaBuffer: 100
	},
	cliProgress.Presets.shades_grey
);
const bars: cliProgress.SingleBar[] = [];

const conn = new WebSocket("ws://localhost:8080");
conn.on("message", msg => {
	const message = JSON.parse(msg.toString()) as IPCPacket;
	if (PacketBuilder.isProgressSetup(message)) {
		for (let i = 0; i < message.barCount; i++) bars.push(multibar.create(1, 0));
	} else if (PacketBuilder.isProgressUpdate(message)) {
		const bar = bars[message.index];
		if (bar.getTotal() != message.total) bar.setTotal(message.total);
		bar.update(message.current);
	} else if (PacketBuilder.isExit(message)) {
		process.exit(0);
	}
});
