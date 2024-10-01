import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { VTGRService } from "./vtgrService.js";

// import { VTGRService } from "./vtgrService.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY);
	await connector.connect();

	const service = new VTGRService();
	connector.register("VTGRService", service);

	service.init();
}

run();