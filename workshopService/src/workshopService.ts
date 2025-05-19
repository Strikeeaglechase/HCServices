import { spawn } from "child_process";
import { MissionInfo, PhoneticLetters, Team, Vector3 } from "common/shared.js";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { Callable } from "serviceLib/serviceHandler.js";

import { buildBuiltinFile } from "./parseBuiltinMissionMeta.js";
import { Node, parse } from "./vtsToJson.js";

const VTOL_ID = "667970";
type CustomScenarioValues =
	| "gameVersion"
	| "campaignID"
	| "campaignOrderIdx"
	| "scenarioName"
	| "scenarioID"
	| "scenarioDescription"
	| "mapID"
	| "vehicle"
	| "multiplayer"
	| "mpPlayerCount"
	| "autoPlayerCount"
	| "overrideAlliedPlayerCount"
	| "overrideEnemyPlayerCount"
	| "scorePerDeath_A"
	| "scorePerDeath_B"
	| "scorePerKill_A"
	| "scorePerKill_B"
	| "mpBudgetMode"
	| "forceEquips"
	| "normForcedFuel"
	| "equipsConfigurable"
	| "baseBudget"
	| "isTraining"
	| "rtbWptID"
	| "refuelWptID"
	| "rtbWptID_B"
	| "refuelWptID_B"
	| "separateBriefings"
	| "envName"
	| "selectableEnv"
	| "qsMode"
	| "qsLimit";
type MPSpawnNodeValues =
	| "unitName"
	| "globalPosition"
	| "unitInstanceID"
	| "unitID"
	| "rotation"
	| "spawnChance"
	| "lastValidPlacement"
	| "editorPlacementMode"
	| "spawnFlags";

function decode(value: number, ...rest: any[]) {
	let val = (value - 88) % 256;
	if (val < 0) val += 256;
	return val;
}

interface DownloadJob {
	id: string;
	lowPrio: boolean;
	prom: Promise<void>;
	callback: () => void;
}

const workshop_download_cache_time = 1000 * 60 * 60; // 1 hour
const workshop_ignore_time = 1000 * 30; // 30 seconds
const steam_warn_after = 1000 * 20; // 20 seconds
const mission_data_cache_time = 1000 * 60 * 60; // 1 hour
// const steam_cmd_session_length = 1000 * 60 * 60 * 1; // 1 hour

class WorkshopService {
	private api: express.Express;
	private basePath = path.join(process.cwd(), "..");
	private builtinMissionInfo: { info: MissionInfo; rawVts: string }[];
	private workshopDownloadCache: Record<string, number> = {};
	private missionDataCache: Record<string, { info: MissionInfo; rawVts: string; time: number }> = {};

	private workshopDownloadQueue: DownloadJob[] = [];
	private steamdbLog: fs.WriteStream;

	public async init() {
		this.api = express();
		this.api.use(cors());

		this.api.listen(parseInt(process.env.API_PORT), () => {
			console.log(`Workshop API opened on ${process.env.API_PORT}`);
		});

		buildBuiltinFile();
		this.builtinMissionInfo = JSON.parse(fs.readFileSync(`${this.basePath}/builtins.json`, "ascii"));
		this.steamdbLog = fs.createWriteStream(`${this.basePath}/steamdb.log`, { flags: "a" });

		// On startup delete any leftover media files
		console.log(`Deleting leftover media files`);
		this.recursivelyDeleteUselessMedia(`${this.basePath}/steamapps/workshop/content/${VTOL_ID}`);
		console.log(`Deleting leftover media files complete`);

		this.clearSteamCache();
		this.setupRoutes();
		this.runWorkshopQueue();
	}

	private clearSteamCache() {
		const clearPaths = [
			`${this.basePath}/steamapps/workshop/appworkshop_667970.acf`,
			`${this.basePath}/steamapps/workshop/temp`,
			`${this.basePath}/steamapps/workshop/downloads`
		];

		clearPaths.forEach(cp => {
			if (!fs.existsSync(cp)) {
				console.log(`Steam cache path ${cp} does not exist. Skipping...`);
				return;
			}

			const info = fs.statSync(cp);
			if (info.isDirectory()) {
				fs.rmdirSync(cp, { recursive: true });
			} else {
				fs.unlinkSync(cp);
			}

			console.log(`Cleared Steam cache path ${cp}`);
		});
		console.log(`Clear Steam cache complete`);
	}

	private getNextWorkshopDownload() {
		const highPrio = this.workshopDownloadQueue.find(d => !d.lowPrio);
		if (highPrio) {
			this.workshopDownloadQueue = this.workshopDownloadQueue.filter(d => d.id != highPrio.id);
			return highPrio;
		} else {
			return this.workshopDownloadQueue.shift();
		}
	}

	private async runWorkshopQueue() {
		// console.log(`DL Queue length: ${this.workshopDownloadQueue.length}`);
		if (this.workshopDownloadQueue.length > 0) {
			const { id, callback } = this.getNextWorkshopDownload();
			console.log(
				`Downloading workshop item ${id}. High prio count: ${this.workshopDownloadQueue.filter(d => !d.lowPrio).length} Low prio count: ${
					this.workshopDownloadQueue.filter(d => d.lowPrio).length
				} (Queue length: ${this.workshopDownloadQueue.length})}`
			);
			await this.downloadWorkshopFile(id);
			callback();
		}

		setTimeout(() => this.runWorkshopQueue(), 100);
	}

	private decryptMaybeEncryptedText(text: string) {
		if (text.includes("CustomScenario")) {
			return text
				.split("")
				.map(c => String.fromCharCode((c.charCodeAt(0) - 88) % 256))
				.join("");
		}

		return text;
	}

	private parseMaybeEncryptedCustomScenario(content: string) {
		const decrypted = this.decryptMaybeEncryptedText(content);
		return parse<CustomScenarioValues>(decrypted.split("\t").join("").split("\n"));
	}

	private async waitForFile(path: string, timeout: number) {
		const start = Date.now();
		while (!fs.existsSync(path)) {
			await new Promise(res => setTimeout(res, 10));
			if (Date.now() - start > timeout) {
				console.log(`Timeout while waiting for file ${path}`);
				return false;
			}
		}

		return true;
	}

	private setupRoutes() {
		this.api.get("/subscribe", async (req, res) => {
			const workshopId = req.query?.id?.toString();
			if (!workshopId) return res.sendStatus(400);

			if (this.workshopDownloadCache[workshopId] && Date.now() - this.workshopDownloadCache[workshopId] < workshop_download_cache_time) {
				console.log(`Skipping subscribe call to ${workshopId} due to it recently being downloaded`);
			} else {
				if (fs.existsSync(`${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${workshopId}`)) {
					this.download(workshopId, true);
					console.log(`Fast return for ${workshopId} as it already exists`);
					// res.sendStatus(200);
				} else {
					await this.download(workshopId, false);
				}
			}
			res.sendStatus(200);
		});

		this.api.get("/mission", async (req, res) => {
			const workshopId = req.query.workshopId?.toString(); //2785198049
			const missionId = decodeURI(req.query.missionId?.toString()); //Dynamic_Liberation_H
			console.log(`Mission data request for ${workshopId} - ${missionId}`);
			if (!workshopId || !missionId) {
				console.warn(`Missing workshopId or missionId (${workshopId} - ${missionId})`);
				return res.sendStatus(400);
			}

			const builtinMission = this.builtinMissionInfo.find(m => m.info.campaignId == workshopId && m.info.id == missionId);
			if (builtinMission) return res.send(builtinMission.info);

			const missionInfo = await this.getMissionInfo(workshopId, missionId);
			if (!missionInfo) return res.sendStatus(404);

			res.send(missionInfo);
		});

		this.api.get("/raw_vts", async (req, res) => {
			const workshopId = req.query.workshopId?.toString(); //2785198049
			const missionId = decodeURI(req.query.missionId?.toString()); //Dynamic_Liberation_H
			console.log(`Mission data request for ${workshopId} - ${missionId}`);
			if (!workshopId || !missionId) {
				console.warn(`Missing workshopId or missionId (${workshopId} - ${missionId})`);
				return res.sendStatus(400);
			}

			const builtinMission = this.builtinMissionInfo.find(m => m.info.campaignId == workshopId && m.info.id == missionId);
			if (builtinMission) return res.send(builtinMission.rawVts);

			const rawVts = await this.getRawMissionVts(workshopId, missionId);
			if (!rawVts) return res.sendStatus(404);

			res.send(rawVts);
		});

		this.api.get("/map/:workshopId/:mapId/:image", async (req, res) => {
			const folderPath = `${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${req.params.workshopId}/${req.params.mapId}`;
			const image = this.loadMapImage(folderPath, req.params.image);
			if (typeof image == "number") res.sendStatus(image);
			else res.sendFile(image);
		});

		this.api.get("/mapBuiltin/:campaignId/:mapId/:image", async (req, res) => {
			const folderPath = `${this.basePath}/builtinMissions/${req.params.campaignId.toLowerCase()}/${req.params.mapId.toLowerCase()}`;
			const image = this.loadMapImage(folderPath, req.params.image);
			if (typeof image == "number") res.sendStatus(image);
			else res.sendFile(image);
		});

		this.api.get("/preview/:workshopId/:missionId", async (req, res) => {
			const imagePath = `${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${req.params.workshopId}/${req.params.missionId
				.split("%20")
				.join(" ")}/image`;
			console.log(imagePath);
			if (fs.existsSync(imagePath + ".jpg")) return res.sendFile(path.resolve(imagePath + ".jpg"));
			if (fs.existsSync(imagePath + ".png")) return res.sendFile(path.resolve(imagePath + ".png"));

			const builtInImagePath = `${this.basePath}/builtinMissions/${req.params.workshopId.toLowerCase()}/${req.params.missionId
				.split("%20")
				.join(" ")
				.toLowerCase()}/image.png`;
			if (fs.existsSync(builtInImagePath)) return res.sendFile(path.resolve(builtInImagePath));

			// console.warn(`No preview image found for ${req.params.workshopId} - ${req.params.missionId}`);
			res.sendStatus(404);
		});
	}

	@Callable
	public getMapImage(workshopId: string, mapId: string, image: string, isBuiltIn: boolean): string | null {
		const folderPath = isBuiltIn
			? `${this.basePath}/builtinMissions/${workshopId.toLowerCase()}/${mapId.toLowerCase()}`
			: `${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${workshopId}/${mapId}`;

		const imagePath = this.loadMapImage(folderPath, image);

		if (typeof imagePath == "number") return null;

		const file = fs.readFileSync(imagePath, "binary");
		const base64 = Buffer.from(file, "binary").toString("base64");
		return base64;
	}

	@Callable
	public async getRawVts(workshopId: string, missionId: string): Promise<string> {
		const builtinMission = this.builtinMissionInfo.find(m => m.info.campaignId == workshopId && m.info.id == missionId);
		if (builtinMission) return builtinMission.rawVts;

		const rawVts = await this.getRawMissionVts(workshopId, missionId);
		if (!rawVts) {
			console.warn(`No raw VTS found for ${workshopId} - ${missionId}`);
			return null;
		}

		return rawVts;
	}

	@Callable
	public async getRawMissionVts(workshopId: string, missionId: string): Promise<string> {
		if (this.missionDataCache[`${workshopId}/${missionId}`]) {
			const cache = this.missionDataCache[`${workshopId}/${missionId}`];
			const dt = Date.now() - cache.time;
			if (dt < mission_data_cache_time) {
				console.log(`Fast return for ${workshopId}/${missionId} as it is cached`);
				// return res.send(cache.data);
				return cache.rawVts;
			}
		}

		const downloadProc = this.workshopDownloadQueue.find(d => d.id == workshopId && !d.lowPrio);
		if (downloadProc) {
			console.log(`Waiting for ${workshopId} to finish downloading`);
			await downloadProc.prom;
		}

		// Wait for 3 seconds for the file to exist, some race conditions can cause it to not exist immediately.
		const exists = await this.waitForFile(`${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${workshopId}/${missionId}/${missionId}.vtsb`, 3000);
		if (!exists) {
			console.warn(`Workshop file ${workshopId}/${missionId} not found`);
			return null;
		}

		// I don't know what this `.` check is checking for.
		// if (workshopId.includes(".") || missionId.includes(".")) return res.sendStatus(400); // This was breaking my mission that had  "1.6" in it?
		const file = fs.readFileSync(`${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${workshopId}/${missionId}/${missionId}.vtsb`, "binary");

		return this.decryptMaybeEncryptedText(file);
	}

	@Callable
	public async getMissionInfo(workshopId: string, missionId: string): Promise<MissionInfo> {
		if (this.missionDataCache[`${workshopId}/${missionId}`]) {
			const cache = this.missionDataCache[`${workshopId}/${missionId}`];
			const dt = Date.now() - cache.time;
			if (dt < mission_data_cache_time) {
				console.log(`Fast return for ${workshopId}/${missionId} as it is cached`);
				// return res.send(cache.data);
				return cache.info;
			}
		}

		const file = await this.getRawMissionVts(workshopId, missionId);
		const mission = this.parseMaybeEncryptedCustomScenario(file); // Really `getRawVts` should decrypt the file, so should always be decrypted at this point
		const unitSpawns: Node<MPSpawnNodeValues>[] = mission.getNodes("UnitSpawner");
		const alliedSpawns = unitSpawns.filter(node => node.getValue("unitID") == "MultiplayerSpawn");
		const enemySpawns = unitSpawns.filter(node => node.getValue("unitID") == "MultiplayerSpawnEnemy");
		const playerSpawns: { name: string; id: number; vehicle: string; unitGroup: string; slotCount: number }[] = [];
		const processSpawn = (spawn: Node<MPSpawnNodeValues>) => {
			const ufs = spawn.getNode("UnitFields");
			playerSpawns.push({
				id: spawn.getValue<number>("unitInstanceID"),
				name: spawn.getValue<string>("unitID"),
				vehicle: ufs.getValue("vehicle"),
				unitGroup: ufs.getValue("unitGroup"),
				slotCount: ufs.getValue("slots") ?? 1
			});
		};
		alliedSpawns.forEach(processSpawn);
		enemySpawns.forEach(processSpawn);
		const allUnitSpawns = unitSpawns.map(node => ({
			id: node.getValue<number>("unitInstanceID"),
			name: node.getValue<string>("unitID")
		}));

		const waypointsNode = mission.getNode("WAYPOINTS");
		const waypoints = waypointsNode?.getNodes("WAYPOINT")?.map(node => {
			return {
				name: node.getValue<string>("name"),
				id: node.getValue<number>("id"),
				position: node.getValue<Vector3>("globalPoint")
			};
		});
		const bullseye = {
			[Team.A]: waypointsNode?.getValue<number>("bullseyeID"),
			[Team.B]: waypointsNode?.getValue<number>("bullseyeID_B"),
			[Team.Unknown]: 0
		};

		const alliedUnitGroupIds: Partial<Record<PhoneticLetters, number[]>> = {};
		const enemyUnitGroupIds: Partial<Record<PhoneticLetters, number[]>> = {};
		const unitGroupsNode = mission.getNode("UNITGROUPS");
		const alliedUnitGroups = unitGroupsNode.getNode("ALLIED");
		const enemyUnitGroups = unitGroupsNode.getNode("ENEMY");

		Object.keys(PhoneticLetters).forEach((key: keyof typeof PhoneticLetters) => {
			const letter = PhoneticLetters[key];
			if (!isNaN(Number(key))) return;

			const alliedGroup = alliedUnitGroups?.getValue(key);
			const enemyGroup = enemyUnitGroups?.getValue(key);
			if (alliedGroup) alliedUnitGroupIds[letter] = (alliedGroup as number[]).slice(1);
			if (enemyGroup) enemyUnitGroupIds[letter] = (enemyGroup as number[]).slice(1);
		});

		const missionData: MissionInfo = {
			id: mission.getValue<string>("scenarioID"),
			name: mission.getValue<string>("scenarioName"),
			campaignId: mission.getValue<string>("campaignID"),
			workshopId: workshopId,
			mapId: mission.getValue<string>("mapID"),
			isBuiltin: false,
			spawns: playerSpawns,
			allUnitSpawns: allUnitSpawns,
			waypoints: waypoints,
			bullseye: bullseye,
			alliedUnitGroupIds: alliedUnitGroupIds,
			enemyUnitGroupIds: enemyUnitGroupIds
		};

		this.missionDataCache[`${workshopId}/${missionId}`] = { info: missionData, rawVts: file, time: Date.now() };

		return missionData;
	}

	private downloadWorkshopFile(id: string) {
		const backupPath = process.platform == "win32" ? "steamcmd" : "/usr/games/steamcmd";
		const baseCmd = process.env.STEAM_CMD_PATH ? process.env.STEAM_CMD_PATH : backupPath;

		this.workshopDownloadCache[id] = Date.now();

		const command = [
			"+force_install_dir",
			this.basePath,
			"+login",
			process.env.STEAM_USER,
			process.env.STEAM_PASS,
			// "+login", "anonymous",
			"+workshop_download_item",
			VTOL_ID,
			id,
			"+quit"
		];
		// console.log([baseCmd, ...command].join(" "));
		const steam = spawn(baseCmd, command, { stdio: ["pipe", "pipe", "pipe"] });

		console.log(`SteamCMD spawned with command ${[baseCmd, ...command].join(" ")}`);
		// console.log(`SteamCMD spawned`);

		return new Promise<void>(res => {
			let hasRes = false;
			steam.stderr.on("data", data => {
				this.steamdbLog.write(data.toString());
				console.error(`SteamCMD ERROR: ${data.toString()}`);
			});

			steam.on("close", code => {
				this.steamdbLog.write(`SteamCMD closed with code ${code}`);
				console.log(`SteamCMD closed with code ${code}`);
				if (!hasRes) {
					console.warn(`SteamCMD closed without resolving`);
					res();
				}
			});

			steam.on("error", err => {
				this.steamdbLog.write(`SteamCMD error: ${err}`);
				console.error(`SteamCMD error: ${err}`);
			});

			steam.stdout.on("data", data => {
				this.steamdbLog.write(data.toString());
				const parts = (data.toString() as string).split("\n");
				// console.log(data.toString());
				parts.forEach(part => {
					// if (part.trim().length > 0) console.log(`SteamCMD: ${part}`);
					if (part.includes("Success. Downloaded ")) {
						this.deleteUselessMedia(id);
						res();
						hasRes = true;
					}
				});
			});
		});
	}

	private deleteUselessMedia(wsId: string) {
		const path = `${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${wsId}`;
		if (!fs.existsSync(path)) {
			console.warn(`Path ${path} does not exist. Skipping media deletion`);
			return;
		}

		this.recursivelyDeleteUselessMedia(path);
	}

	private recursivelyDeleteUselessMedia(path: string) {
		const deleteExtensions = [".ogg", ".wav", ".mp3", ".mp4"];
		const files = fs.readdirSync(path);
		files.forEach(file => {
			const filePath = path + "/" + file;
			if (fs.statSync(filePath).isDirectory()) {
				this.recursivelyDeleteUselessMedia(filePath);
			} else if (deleteExtensions.some(ext => file.endsWith(ext))) {
				console.log(`Deleting media file ${filePath}`);
				fs.unlinkSync(filePath);
			}
		});
	}

	private loadMapImage(folderPath: string, image: string): string | number {
		if (fs.existsSync(folderPath)) {
			if (fs.existsSync(`${folderPath}/height${image}.png`)) {
				return path.resolve(`${folderPath}/height${image}.png`);
			} else if (fs.existsSync(`${folderPath}/height.pngb`) && image == "0") {
				const rawData = fs.readFileSync(`${folderPath}/height.pngb`, null);
				const data = rawData.map(decode);
				fs.writeFileSync(`${folderPath}/height.png`, data);
				return path.resolve(`${folderPath}/height.png`);
			} else if (fs.existsSync(`${folderPath}/height.png`) && image == "0") {
				return path.resolve(`${folderPath}/height.png`);
			} else {
				return 400;
			}
		} else {
			return 400;
		}
	}

	private download(workshopId: string, lowPrio: boolean): Promise<void> {
		// return;
		// If startup or development mode, only download the workshop if it's not already downloaded.
		// In production mode, we want to update the workshop mission when possible (not counting startup)
		// console.log(this.application.hcManager.startedAt);
		// if (this.application.hcManager.startedAt && Date.now() - this.application.hcManager.startedAt < workshop_ignore_time) {
		// 	if (fs.existsSync(`${this.basePath}/steamapps/workshop/content/${VTOL_ID}/${workshopId}`)) {
		// 		console.log(`Skipping workshop download for ${workshopId} due to HC startup`);
		// 		return;
		// 	}
		// }

		console.log(`Enqueuing workshop item ${workshopId} for download. Priority: ${lowPrio ? "low" : "high"}`);

		const queue: DownloadJob = { id: workshopId, callback: null, prom: null, lowPrio: lowPrio };
		queue.prom = new Promise(res => {
			queue.callback = res;
			this.workshopDownloadQueue.push(queue);
		});

		return queue.prom;
	}
}

export { WorkshopService };
