import { config } from "dotenv";

import { Logger } from "../../VTOLLiveViewerCommon/dist/logger.js";
import { run } from "./app.js";

config();
run();

process.on("unhandledRejection", error => {
	console.error(error);
	Logger.info(error.toString());
});
process.on("uncaughtException", error => {
	console.error(error);
	Logger.info(error.toString());
});
