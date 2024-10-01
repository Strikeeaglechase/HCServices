import { RPCPacket } from "../../../VTOLLiveViewerCommon/src/rpc.js";
import { Processor } from "./vtgrProcessor.js";

interface RPCWaitResolver {
	method: string;
	startTime: number;
	maxWait: number;
	hasResolved: boolean;
	resolve: (packet: RPCPacket) => void;
}

abstract class RPCConsumer {
	private waitingPromises: RPCWaitResolver[] = [];
	constructor(public id: string) {}

	public handleRpc(rpc: RPCPacket): void {
		const waitingRpcs = this.waitingPromises.filter(w => w.method == rpc.method);
		waitingRpcs.forEach(wait => {
			if (wait.hasResolved) return;
			const timePassed = rpc.timestamp - wait.startTime;
			if (timePassed > wait.maxWait) {
				wait.hasResolved = true;
				wait.resolve(null);
				return;
			}

			wait.hasResolved = true;
			wait.resolve(rpc);
		});

		this.waitingPromises = this.waitingPromises.filter(w => !w.hasResolved);
	}

	public waitForRpc(method: string, maxWait: number): Promise<RPCPacket> {
		return new Promise<RPCPacket>(res => {
			this.waitingPromises.push({ method, startTime: Processor.time, maxWait, resolve: res, hasResolved: false });
		});
	}
}

export { RPCConsumer };
