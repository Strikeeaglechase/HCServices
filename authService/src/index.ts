import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { AuthService } from "./authService.js";

async function run() {
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY);
	await connector.connect();

	const service = new AuthService();
	connector.register("AuthService", service);

	service.init();
}

run();