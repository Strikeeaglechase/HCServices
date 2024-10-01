import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { ReplayService } from "./replayService.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY);
	await connector.connect();

	const service = new ReplayService();
	connector.register("ReplayService", service);

	service.init();
}

run();