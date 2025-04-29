import { Logger } from "common/logger.js";
import { config } from "dotenv";

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
