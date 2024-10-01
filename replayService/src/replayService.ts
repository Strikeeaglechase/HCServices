import cors from "cors";
// import { Callable } from "serviceLib/serviceHandler.js";
import express from "express";

import { GameDataManager } from "./gameDataManager.js";

class ReplayService {
	private api: express.Express;
	private gameDataManager: GameDataManager;

	public async init() {
		this.api = express();
		this.api.use(cors());

		this.gameDataManager = new GameDataManager(this.api);
		await this.gameDataManager.init();

		this.api.listen(parseInt(process.env.API_PORT), () => {
			console.log(`Workshop API opened on ${process.env.API_PORT}`);
		});
	}
}

export { ReplayService };