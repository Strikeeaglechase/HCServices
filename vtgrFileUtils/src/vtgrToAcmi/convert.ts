import { RPCPacket } from "common/rpc.js";
import { InstancedRpcClass, MessageHandler, MissileEntity, PlayerVehicle, VTOLLobby } from "common/rpcApi.js";
import { RawPlayerInfo, Team } from "common/shared.js";
import { IVector3, Vector } from "common/vector.js";
import { VTGRReader } from "common/vtgrFileReader.js";
import fs from "fs";
import { pathToType } from "./pathToType.js";

function toHex(num: number): string {
	return num.toString(16).toUpperCase();
}

const timeWriteRate = 100; // Every 100ms write a time stamp

class ACMIBuilder {
	private writeStream: fs.WriteStream;
	private hasWrittenSinceTime = false;
	private refTime = 0;

	constructor(private outputPath: string) {
		this.writeStream = fs.createWriteStream(outputPath);

		this.writeHeader();
	}

	public setRefTime(time: number) {
		this.refTime = time;
		// console.log(`Setting reference time to ${this.refTime} (${new Date(this.refTime).toISOString()})`);
		const refTimeStamp = new Date(this.refTime).toISOString();
		this.write(`0,ReferenceTime=${refTimeStamp}`);
	}

	public writeTime(time: number) {
		if (!this.hasWrittenSinceTime) return;
		const stamp = (time - this.refTime) / 1000;
		this.write(`#${stamp.toFixed(3)}`);
		this.hasWrittenSinceTime = false;
	}

	private getColorString(entity: Entity) {
		if (entity.rpcHandler instanceof MissileEntity) return "Orange";
		switch (entity.team) {
			case Team.A:
				return "Blue";
			case Team.B:
				return "Red";
			default:
				return null;
		}
	}

	private getCoalitionString(entity: Entity) {
		switch (entity.team) {
			case Team.A:
				return "Allies";
			case Team.B:
				return "Enemies";
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
			"Vehicles/T-55": "T-55",
			"Vehicles/EF-24": "EF-24",
			"Weapons/Missiles/Maverick": "AGM-65",
			"Weapons/Missiles/AIM-92": "AIM-92", // From the AH-94
			"Weapons/Missiles/APKWS": "PGM-27",
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

	public handleEntitySpawn(entity: Entity) {
		const updateStr = this.getUpdateString(entity.id, entity.position, entity.rotation);
		const type = pathToType(entity.path);
		if (!type) {
			console.log(`Unknown type for entity with ID ${entity.id} and path ${entity.path}`);
		}

		const color = this.getColorString(entity);
		const coalition = this.getCoalitionString(entity);
		const name = this.identifierToDisplayName(entity.path);

		let initStr = `${toHex(entity.id)},${updateStr},Name=${name},Type=${type},LongName=${name},ShortName=${name}`;
		if (color) initStr += `,Color=${color}`;
		if (coalition) initStr += `,Coalition=${coalition}`;

		this.write(initStr);
		// return initStr;
	}

	public handleEntityDestroy(entityId: number) {
		this.write(`-${toHex(entityId)}`);
	}

	public handleEntityUpdate(entity: Entity) {
		const updateStr = this.getUpdateString(entity.id, entity.position, entity.rotation);
		this.write(`${toHex(entity.id)},${updateStr}`);
	}

	private getUpdateString(entityId: number, pos: Vector, rot: Vector) {
		const cords = this.worldToGpsCord(pos);
		const kinematicsStr = `${cords.x}|${cords.y}|${cords.z}|${-rot.z}|${-rot.x}|${rot.y}`;
		return `T=${kinematicsStr}`;
	}

	private worldToGpsCord(pos: Vector): Vector {
		const resultZ = pos.y;
		const resultY = pos.z / 111319.9;
		const b = Math.abs(Math.cos(resultY * 0.01745329238474369) * 111319.9);
		const resultX = b > 0 ? pos.x / b : 0;

		return new Vector(resultX, resultY, resultZ);
	}

	private writeHeader() {
		this.write("FileType=text/acmi/tacview");
		this.write("FileVersion=2.2");
	}

	private write(str: string) {
		this.writeStream.write(str + "\n");
		this.hasWrittenSinceTime = true;
	}
}

const vehiclePaths = ["Vehicles/SEVTF", "Vehicles/FA-26B", "Vehicles/F-16", "Vehicles/AH-94", "Vehicles/VTOL4", "Vehicles/T-55", "Vehicles/EF-24"];

class Entity {
	public position: Vector = new Vector(0, 0, 0);
	public rotation: Vector = new Vector(0, 0, 0);
	public team: Team = Team.Unknown;

	constructor(public id: number, public path: string, public rpcHandler: InstancedRpcClass) {}
}

class VTGRHandler {
	private rpcHandlers: Record<string, InstancedRpcClass[]> = {};
	// private entities: Record<number, Entity> = {};
	private players: RawPlayerInfo[] = [];

	private time: number = 0;
	private lastWrittenTime = 0;
	private hasSetRefTime = false;

	constructor(private reader: VTGRReader, private builder: ACMIBuilder) {}

	public async run() {
		const header = await this.reader.getHeader();
		console.log(`Beginning convert of ${header.info.lobbyName} (${header.id})`);
		const runningProm = this.reader.parse(packet => this.handlePacket(packet));

		const messageHandler = new MessageHandler(header.info.lobbyId);
		const vtolLobby = new VTOLLobby(header.info.lobbyId);
		this.addRpcHandler(messageHandler);
		this.addRpcHandler(vtolLobby);

		vtolLobby.on("UpdateLobbyInfo", (name, missionName, playerCount, maxPlayers, isPrivate, isConnected, players, hostId) => {
			this.players = players;
		});

		messageHandler.on("NetInstantiate", (id, ownerId, path, pos, rot, active) => {
			if (path.startsWith("Weapons/Missiles/")) {
				this.spawnMissile(id, ownerId, path, pos, rot);
			} else if (vehiclePaths.includes(path)) {
				this.spawnPlayerVehicle(id, ownerId, path, pos, rot);
			}
		});

		messageHandler.on("NetDestroy", id => {
			this.builder.handleEntityDestroy(id);
		});

		return runningProm;
	}

	private spawnMissile(id: number, ownerId: string, path: string, pos: IVector3, rot: IVector3) {
		const missile = new MissileEntity(id);
		const entity = new Entity(id, path, missile);
		entity.position.set(pos);
		entity.rotation.set(rot);

		let hasFired = false;
		missile.on("SyncShit", (pos, rot, vel, accel) => {
			if (!hasFired) {
				this.builder.handleEntitySpawn(entity);
				hasFired = true;
			}
			entity.position.set(pos);
			entity.rotation.set(rot);
			this.builder.handleEntityUpdate(entity);
		});

		this.addRpcHandler(missile);
	}

	private spawnPlayerVehicle(id: number, ownerId: string, path: string, pos: IVector3, rot: IVector3) {
		const player = this.players.find(p => p.steamId == ownerId);
		if (!player) {
			console.log(`Player with ID ${ownerId} not found for vehicle ${id} (${path})`);
		}

		const vehicle = new PlayerVehicle(id);
		const entity = new Entity(id, path, vehicle);
		entity.position.set(pos);
		entity.rotation.set(rot);
		entity.team = player ? player.team : Team.Unknown;
		this.builder.handleEntitySpawn(entity);

		vehicle.on("UpdateData", (pos, vel, accel, rot, throttle, isLanded, pyr) => {
			entity.position.set(pos);
			entity.rotation.set(rot);
			this.builder.handleEntityUpdate(entity);
		});

		this.addRpcHandler(vehicle);
	}

	private addRpcHandler(handler: InstancedRpcClass) {
		if (!this.rpcHandlers[handler.id]) {
			this.rpcHandlers[handler.id] = [];
		}

		this.rpcHandlers[handler.id].push(handler);
	}

	private handlePacket(packet: RPCPacket) {
		if (!packet.id) console.log(packet);

		this.time = packet.timestamp;
		if (!this.hasSetRefTime) {
			this.builder.setRefTime(this.time);
			this.hasSetRefTime = true;
		}

		if (this.time - this.lastWrittenTime >= timeWriteRate) {
			this.builder.writeTime(this.time);
			this.lastWrittenTime = this.time;
		}

		const handlers = this.rpcHandlers[packet.id];
		if (handlers) handlers.forEach(handler => handler.fireRpcEvent(packet));
	}
}

async function run() {
	const reader = new VTGRReader("../../input.vtgr");
	await reader.open();

	const builder = new ACMIBuilder("../../output.acmi");
	const handler = new VTGRHandler(reader, builder);

	await handler.run();

	// const header = await reader.getHeader();
	// let pc = 0;
	// await reader.parse(packet => pc++);

	// console.log("Total packets parsed:", pc);
	// console.log(`Packets/chunk: ${(pc / header.chunks.length).toFixed(0)}`);
	// console.log(`Packets/second: ${(pc / (header.info.duration / 1000)).toFixed(1)}`);
}

run();
