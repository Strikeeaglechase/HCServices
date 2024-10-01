import { v4 as uuidv4 } from "uuid";

interface IPCPacket {
	type: string;
	pid: string;
	timestamp: number;
}

interface ProgressBarCountPacket extends IPCPacket {
	type: "progress_setup";
	barCount: number;
}

interface ProgressUpdatePacket extends IPCPacket {
	type: "progress_update";
	current: number;
	total: number;
	index: number;
}

interface ExitPacket extends IPCPacket {
	type: "exit";
}

class PacketBuilder {
	private static pid() {
		return uuidv4();
	}

	private static base<T extends string>(type: T) {
		return {
			type: type,
			pid: this.pid(),
			timestamp: Date.now()
		};
	}

	public static progressSetup(barCount: number): ProgressBarCountPacket {
		return { ...this.base("progress_setup"), barCount };
	}
	public static isProgressSetup(packet: IPCPacket): packet is ProgressBarCountPacket {
		return packet.type == "progress_setup";
	}

	public static progressUpdate(current: number, total: number, index = -1): ProgressUpdatePacket {
		return { ...this.base("progress_update"), current, total, index };
	}
	public static isProgressUpdate(packet: IPCPacket): packet is ProgressUpdatePacket {
		return packet.type == "progress_update";
	}

	public static exit(): ExitPacket {
		return { ...this.base("exit") };
	}
	public static isExit(packet: IPCPacket): packet is ExitPacket {
		return packet.type == "exit";
	}
}

export { PacketBuilder, ProgressBarCountPacket, ProgressUpdatePacket, ExitPacket, IPCPacket };
