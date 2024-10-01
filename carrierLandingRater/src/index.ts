import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { LandingRaterService } from "./landingRaterService.js";
import { Parser } from "./parser.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY, process.env.EXTERNAL_IP);
	await connector.connect();

	const service = new LandingRaterService();
	connector.register("LandingRaterService", service);

	service.init();
}

if (process.env.SERVICE_CONNECTOR_URL) {
	run();
} else {
	const parser = new Parser();
	parser.initFromFile("../replay4.vtgr");
}
