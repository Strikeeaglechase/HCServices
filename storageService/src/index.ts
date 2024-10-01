// docker build -f storageService/Dockerfile -t storage_service .
// docker run -p 8014:8014 --mount type=bind,source=C:\Users\strik\Desktop\Programs\Typescript\VTOLLiveViewer\storageService\store,target=/home/node/app/store storage_service

import fs from "fs";
import { ServiceConnector } from "serviceLib/serviceConnector.js";

import { StorageService } from "./storageService.js";

async function run() {
	const port = process.env.EXTERNAL_PORT ?? "-1";
	const connector = new ServiceConnector(process.env.SERVICE_CONNECTOR_URL, process.env.SERVICE_KEY, process.env.EXTERNAL_IP, parseInt(port));
	await connector.connect();

	const service = new StorageService();
	connector.register("StorageService", service);

	service.init();
}

run();
