import fs from "fs";
import * as THREE from "three";

import { RPCPacket } from "../../VTOLLiveViewerCommon/dist/rpc.js";
import { RawPlayerInfo } from "../../VTOLLiveViewerCommon/dist/shared.js";
import { VTGRHeader } from "./app.js";

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (rad: number): number => (rad * 180) / Math.PI;

const rEarth = 6378 * 1000;
const mPerLong = (Math.PI / 180) * rEarth * Math.cos((1 * Math.PI) / 180);
const mPerLat = (Math.PI / 180) * rEarth;

function parseRotation(rot: { x: number; y: number; z: number }) {
	const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rot.x), -rad(rot.y), -rad(rot.z), "YXZ"));
	const r = new THREE.Euler().setFromQuaternion(quat);

	return {
		x: deg(r.x),
		y: deg(r.y),
		z: deg(r.z)
	};
}

interface Vector {
	x: number;
	y: number;
	z: number;
}

class ACMIFileHandler {
	private text: string = "";
	private lastPlayerList: RawPlayerInfo[] = [];
	private entityFirstUpdated = new Set<string>();
	private entityInfos: Record<string, { path: string; owner: string }> = {};
	private entityPositions: Record<string, Vector>;

	constructor(private header: VTGRHeader) {
		console.log(`Creating ACMI file`);
	}

	private write(message: string) {
		this.text += message + "\n";
	}

	private writeHeader() {
		this.write("FileType=text/acmi/tacview");
		this.write("FileVersion=2.1");
		const timestamp = new Date(this.header.info.startTime).toISOString();
		this.write(`0,ReferenceTime=${timestamp}`);
	}

	private pathToType(path: string) {
		if (path.startsWith("Weapons/Missiles/")) return "Medium+Weapon+Missile";
		switch (path) {
			case "Vehicles/FA-26B":
				return "Medium+Air+FixedWing";
			case "Vehicles/AH-94":
				return "Medium+Air+Rotorcraft";
			case "Units/Allied/ABomberAI":
				return "Heavy+Air+FixedWing";
			case "Units/Enemy/AEW-50":
				return "Heavy+Air+FixedWing";
			case "Units/Enemy/AIUCAV":
				return "Light+Air+FixedWing";
			case "Units/Allied/AlliedAAShip":
				return "Sea+Watercraft+AircraftCarrier";
			case "Units/Allied/AlliedCarrier":
				return "Sea+Watercraft+AircraftCarrier";
			case "Units/Allied/AlliedCarrier_OLD":
				return "Sea+Watercraft+AircraftCarrier";
			case "Units/Allied/alliedCylinderTent":
				return "Static+Ground+Building";
			case "Units/Allied/AlliedEWRadar":
				return "Static+Ground+AntiAircraft";
			case "Units/Allied/alliedMBT1":
				return "Ground+Heavy+Armor+Vehicle+Tank";
			case "Units/Allied/AlliedSoldier":
				return "Ground+Light+Human+Infantry";
			case "Units/Allied/AlliedSoldierMANPAD":
				return "Ground+Light+Human+Infantry+AntiAircraft";
			case "Units/Allied/ARocketTruck":
				return "Ground+Heavy+Armor+Vehicle";
			case "Units/Enemy/Artillery":
				return "Ground+Heavy+Armor+Vehicle";
			case "Units/Enemy/ASF-30":
				return "Medium+Air+FixedWing";
			case "Units/Enemy/ASF-33":
				return "Medium+Air+FixedWing";
			case "Units/Enemy/ASF-58":
				return "Medium+Air+FixedWing";
			case "Units/Allied/AV-42CAI":
				return "Medium+Air+FixedWing";
			case "Units/Enemy/bunker1":
				return "Static+Ground+Building";
			case "Units/Allied/bunker2":
				return "Static+Ground+Building";
			case "Units/Enemy/cylinderTent":
				return "Static+Ground+Building";
			case "Units/Enemy/DroneCarrier":
				return "Sea+Watercraft+Warship";
			case "Units/Enemy/DroneGunBoat":
				return "Light+Sea+Watercraft+Warship";
			case "Units/Enemy/DroneGunBoatRocket":
				return "Light+Sea+Watercraft+Warship";
			case "Units/Enemy/DroneMissileCruiser":
				return "Sea+Watercraft+Warship";
			case "Units/Allied/E-4":
				return "Heavy+Air+FixedWing";
			case "Units/Enemy/EBomberAI":
				return "Heavy+Air+FixedWing";
			case "Units/Enemy/EnemyCarrier":
				return "Sea+Watercraft+AircraftCarrier";
			case "Units/Enemy/enemyMBT1":
				return "Ground+Heavy+Armor+Vehicle+Tank";
			case "Units/Enemy/EnemySoldier":
				return "Ground+Light+Human+Infantry";
			case "Units/Enemy/EnemySoldierMANPAD":
				return "Ground+Light+Human+Infantry+AntiAircraft";
			case "Units/Enemy/ERocketTruck":
				return "Ground+Heavy+Armor+Vehicle";
			case "Units/Allied/EscortCruiser":
				return "Sea+Watercraft+Warship";
			case "Units/Enemy/ESuperMissileCruiser":
				return "Sea+Watercraft+Warship";
			case "Units/Allied/F-45A AI":
				return "Medium+Air+FixedWing";
			case "Units/Allied/FA-26A":
				return "Medium+Air+FixedWing";
			case "Units/Allied/FA-26B AI":
				return "Medium+Air+FixedWing";
			case "Units/Enemy/GAV-25":
				return "Medium+Air+FixedWing";
			case "Units/Enemy/IRAPC":
				return "Ground+Heavy+Armor+Vehicle+AntiAircraft";
			case "Units/Allied/KC-49":
				return "Heavy+Air+FixedWing";
			case "Units/Enemy/MAD-4Launcher":
				return "Ground+Medium+AntiAircraft+Vehicle";
			case "Units/Enemy/MAD-4Radar":
				return "Ground+Medium+AntiAircraft+Vehicle";
			case "Units/Enemy/MineBoat":
				return "Light+Sea+Watercraft+Warship";
			case "Units/Allied/MQ-31":
				return "Light+Air+FixedWing";
			case "Units/Allied/PatRadarTrailer":
				return "Static+Ground+AntiAircraft";
			case "Units/Allied/PatriotLauncher":
				return "Static+Ground+AntiAircraft";
			case "Units/Allied/PhallanxTruck":
				return "Static+Ground+AntiAircraft";
			case "Units/Enemy/SAAW":
				return "Ground+Heavy+Armor+Vehicle+AntiAircraft";
			case "Units/Enemy/SamBattery1":
				return "Static+Ground+AntiAircraft";
			case "Units/Enemy/SamFCR":
				return "Static+Ground+AntiAircraft";
			case "Units/Enemy/SamFCR2":
				return "Static+Ground+AntiAircraft";
			case "Units/Allied/SRADTruck":
				return "Ground+Heavy+Armor+Vehicle+AntiAircraft";
			case "Units/Enemy/staticAAA-20x2":
				return "Static+Ground+AntiAircraft";
			case "Units/Allied/staticCIWS":
				return "Static+Ground+AntiAircraft";

			default:
				return null;
		}
	}

	private identifierToDisplayName(identifier: string): string {
		const map: Record<string, string> = {
			"Vehicles/SEVTF": "F-45A",
			"Vehicles/FA-26B": "F/A-26B",
			"Vehicles/AH-94": "AH-94",
			"Vehicles/VTOL4": "AV-42C",
			"Weapons/Missiles/Maverick": "AGM-65",
			"Weapons/Missiles/AIM-92": "Stinger", // From the AH-94
			"Weapons/Missiles/APKWS": "Guided Rocket",
			"Weapons/Missiles/HARM": "AGM-88",
			"Weapons/Missiles/Hellfire": "AGM-114",
			"Weapons/Missiles/MARM": "AGM-188",
			"Weapons/Missiles/MK82": "MK-82",
			"Weapons/Missiles/MK82HighDrag": "MK-82 [High Drag]",
			"Weapons/Missiles/MK83": "MK-83",
			"Weapons/Missiles/SB-1": "SB-1 Bomb",
			"Weapons/Missiles/SideARM": "AGM-126",
			"Weapons/Missiles/SubMissile": "Cluster Munition",
			"Weapons/Missiles/SAMs/APCIRSAM": "IR APC SAM",
			"Weapons/Missiles/SAMs/SaawMissile": "SAAW Missile",
			"Units/Allied/BSTOPRadar": "Backstop Radar"
		};

		if (map[identifier]) return map[identifier];

		// If there wasn't a mapping, try to convert myEntityName to My Entity Name
		const name = identifier.substring(identifier.lastIndexOf("/") + 1);
		function convert(inp: string) {
			return inp.replace(/([a-z][A-Z])/g, str => str[0] + " " + str[1].toUpperCase());
		}

		// If a string has a letter followed by a number, add a space before the number, but don't add a space between numbers
		// ie: "hello123" -> "hello 123"
		function addSpace(inp: string): string {
			return inp.replace(/([a-z])(\d)/gi, "$1 $2");
		}

		return addSpace(convert(name));
	}

	private teamToColor(team: number) {
		return team == 0 ? "Blue" : "Red";
	}

	public output(file: string) {
		fs.writeFileSync(file, this.text);
	}

	public processPackets(packets: RPCPacket[]) {
		console.log(`ACMI Processing ${packets.length} packets`);
		this.writeHeader();

		let currentTimestamp = "";
		packets.forEach(packet => {
			const time = ((packet.timestamp - this.header.info.startTime) / 1000).toFixed(2);
			if (time != currentTimestamp && packet.timestamp - this.header.info.startTime > 0) {
				this.write(`#${time}`);
				currentTimestamp = time;
			}

			// Handle player list updates
			if (packet.className == "VTOLLobby" && packet.method == "UpdateLobbyInfo") {
				const [lobbyName, missionName, playerCount, maxPlayers, someBool, someBool2, playerList] = packet.args;
				this.lastPlayerList = playerList;
			}

			// Handle net instantiation
			if (packet.className == "MessageHandler" && packet.method == "NetInstantiate") {
				const [id, ownerId, path, position, rotation] = packet.args;
				this.entityInfos[id.toString()] = { path: path, owner: ownerId.toString() };
			}

			// Handle net destruction
			if (packet.className == "MessageHandler" && packet.method == "NetDestroy") {
				const [id] = packet.args;
				delete this.entityInfos[id.toString()];
				this.write(`-${id}`);
			}

			// Handle player entity position updates
			if (packet.className == "PlayerVehicle" && packet.method == "UpdateData") {
				this.handlePlayerVehicleUpdate(packet);
			}

			// Handle missile entity position updates
			if (packet.className == "MissileEntity" && packet.method == "SyncShit") {
				this.handleMissileUpdate(packet);
			}
		});
	}

	private entityPositionUpdate(id: string, position: { x: number; y: number; z: number }) {
		const long = position.z / mPerLong;
		const lat = position.x / mPerLat;
		// this.write(`${packet.id},T=${long}|${lat}|${position.y}|${rotation.x}|${rotation.y}|${rotation.x}|${position.x}|${position.z}|`);
		this.write(`${id},T=${long}|${lat}|${position.y}|${position.x}|${position.z}`);
		this.entityPositions[id] = position;
	}

	private handleMissileUpdate(packet: RPCPacket) {
		const [position, velocity, acceleration, rawRotation] = packet.args;
		const rotation = parseRotation(rawRotation);

		if (this.entityFirstUpdated.has(packet.id)) {
			this.entityPositionUpdate(packet.id, position);
		} else {
			const info = this.entityInfos[packet.id];
			if (!info) {
				console.log(`Unable to find the type of entity ${packet.id}`);
				return;
			}
			const player = this.lastPlayerList.find(p => p.steamId == info.owner);

			if (!player) {
				console.log(`Unable to find player for entity missile ${packet.id}`);
				return;
			}

			const type = this.pathToType(info.path);
			if (!type) {
				console.log(`Unable to find type for entity ${packet.id} with path ${info.path}`);
				return;
			}

			this.write(
				`${packet.id},T=||${position.y}|${position.x}|${position.z},Name=${this.identifierToDisplayName(info.path)},Type=${type},Parent=${
					player.entityId
				},Color=${this.teamToColor(player.team)}`
			);
			this.entityFirstUpdated.add(packet.id);
		}
	}

	private handlePlayerVehicleUpdate(packet: RPCPacket) {
		const [position, velocity, acceleration, rawRotation] = packet.args;
		const rotation = parseRotation(rawRotation);
		if (this.entityFirstUpdated.has(packet.id)) {
			this.entityPositionUpdate(packet.id, position);
		} else {
			const player = this.lastPlayerList.find(p => p.entityId.toString() == packet.id);
			const info = this.entityInfos[packet.id];

			if (!info) {
				console.log(`Unable to find the type of entity ${packet.id}`);
				return;
			}

			if (!player) {
				console.log(`Unable to find player for entity ${packet.id}`);
				return;
			}

			const type = this.pathToType(info.path);
			if (!type) {
				console.log(`Unable to find type for entity ${packet.id} with path ${info.path}`);
				return;
			}

			this.write(
				`${packet.id},T=||${position.y}|${position.x}|${position.z},Name=${this.identifierToDisplayName(info.path)},Pilot=${
					player.pilotName
				},Type=${type},Color=${this.teamToColor(player.team)}`
			);
			this.entityFirstUpdated.add(packet.id);
		}
	}
}

export { ACMIFileHandler };
