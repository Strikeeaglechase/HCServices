import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { DBService } from "./dbService.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY);
	await connector.connect();

	const service = new DBService();

	// Don't register the service until it's fully initialized
	await service.init();
	connector.register("DBService", service);
}

run();