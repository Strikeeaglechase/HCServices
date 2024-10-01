import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { WorkshopService } from "./workshopService.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY);
	await connector.connect();

	const service = new WorkshopService();
	connector.register("WorkshopService", service);

	service.init();
}

run();