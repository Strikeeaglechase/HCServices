import { MissionInfo, Team, Vector3 } from "common/shared.js";
import fs from "fs";

import { Node, parse } from "./vtsToJson.js";

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

const missionDatas: MissionInfo[] = [];
function processMission(mission: Node<CustomScenarioValues>) {
	const unitSpawns: Node<MPSpawnNodeValues>[] = mission.getNodes("UnitSpawner");
	const alliedSpawns = unitSpawns.filter(node => node.getValue("unitID") == "MultiplayerSpawn");
	const enemySpawns = unitSpawns.filter(node => node.getValue("unitID") == "MultiplayerSpawnEnemy");
	const playerSpawns: { name: string; id: number }[] = [];
	const processSpawn = (spawn: Node<MPSpawnNodeValues>) => {
		playerSpawns.push({
			id: spawn.getValue<number>("unitInstanceID"),
			name: spawn.getValue<string>("unitID")
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

	const missionData: MissionInfo = {
		id: mission.getValue<string>("scenarioID"),
		name: mission.getValue<string>("scenarioName"),
		campaignId: mission.getValue<string>("campaignID"),
		workshopId: "built-in",
		mapId: mission.getValue<string>("mapID"),
		isBuiltin: false,
		spawns: playerSpawns,
		allUnitSpawns: allUnitSpawns,
		waypoints: waypoints,
		bullseye: bullseye
	};
	console.log(`Processed ${missionData.name} (${missionData.id})`);
	missionDatas.push(missionData);
}

function buildBuiltinFile() {
	console.log(`Building builtins.json file`);
	if (!fs.existsSync("../builtinMissions")) fs.mkdirSync("../builtinMissions");
	if (!fs.existsSync("../builtinMissions/metadatas")) fs.mkdirSync("../builtinMissions/metadatas");
	const dir = "../builtinMissions/metadatas/";
	const files = fs.readdirSync(dir);

	files.forEach(fileName => {
		if (!fileName.endsWith(".asset")) return;
		const file = fs.readFileSync(dir + fileName, "utf-8").split("\n");
		if (!file.some(l => l.includes("scenarioConfig"))) return;
		const filter = "\t\r";
		let curConf = "";
		file.forEach(line => {
			if (line.includes("scenarioConfig")) {
				curConf += line.substring(line.indexOf(": '") + 3);
			} else if (line.trim() == "'" && curConf.length != 0) {
				const str = curConf
					.split("")
					.filter(c => !filter.includes(c))
					.join("")
					.split("\n")
					.filter(l => l.length > 0);

				const mission = parse<CustomScenarioValues>(str.map(str => str.trim()));
				if (mission.getValue("multiplayer")) {
					processMission(mission);
					// fs.writeFileSync(`../metaOut/${mission.getValue("campaignID")}-${mission.getValue("scenarioID")}.vts`, str.join("\n"));
				}

				curConf = "";
			} else if (curConf != "") curConf += line.trim() + "\n";
		});
	});

	fs.writeFileSync("../builtins.json", JSON.stringify(missionDatas));
	console.log(`Wrote to builtsins.json with ${missionDatas.length} missions`);
}

export { buildBuiltinFile };
