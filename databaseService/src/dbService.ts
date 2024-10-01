import { DbUserEntry, HCUser, RecordedLobbyPacket, ServiceCallMetrics, UserScopes, VTGRHeader, VTGRMetadata } from "common/shared.js";
import { Callable, ReadStream } from "serviceLib/serviceHandler.js";
import { Writable } from "stream";
import { v4 as uuidv4 } from "uuid";

import { CollectionManager } from "./db/collectionManager.js";
import Database from "./db/database.js";

const validQueryChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-_ ";
const stripQuery = (query: string) =>
	query
		.split("")
		.filter(c => validQueryChars.includes(c))
		.join("");
const REPLAY_REQ_LIMIT = 100;

class DBService {
	private db: Database;

	private recordingLobbies: CollectionManager<RecordedLobbyPacket>;
	private storedLobbies: CollectionManager<VTGRHeader>;
	private users: CollectionManager<DbUserEntry>;
	private serviceMetrics: CollectionManager<{ timestamp: number; metrics: Record<string, ServiceCallMetrics>; id: string }>;

	public async init() {
		this.db = new Database(
			{
				databaseName: process.env.DB_NAME,
				url: process.env.DB_URL
			},
			console.log
		);

		await this.db.init();

		this.recordingLobbies = await this.db.collection("recorded-lobbies", false, "id");
		this.storedLobbies = await this.db.collection("stored-lobbies", false, "id");
		this.users = await this.db.collection("users", false, "id");
		this.serviceMetrics = await this.db.collection("service-metrics", false, "id");
	}

	@Callable
	public async logServiceCallMetrics(metrics: Record<string, ServiceCallMetrics>): Promise<void> {
		const id = uuidv4();
		await this.serviceMetrics.add({ timestamp: Date.now(), metrics: metrics, id: id });
	}

	@Callable
	public async getAllRecordedLobbies(): Promise<VTGRHeader[]> {
		return await this.storedLobbies.get();
	}

	@ReadStream
	public async getRecordedLobbiesStream(
		stream: Writable,
		id: string | null,
		lobbyNameQuery: string,
		playerNameQuery: string,
		hostNameQuery: string,
		lowerDateBound: number,
		upperDateBound: number
	) {
		let filter = {};
		if (id) filter = { id: id };
		// {"info.metadata.players.name": {$regex: "chase", $options: "i"}}
		if (lobbyNameQuery) filter["info.lobbyName"] = { $regex: stripQuery(lobbyNameQuery), $options: "i" };
		if (playerNameQuery) filter["info.metadata.players.name"] = { $regex: stripQuery(playerNameQuery), $options: "i" };
		if (hostNameQuery) filter["info.hostName"] = { $regex: stripQuery(hostNameQuery), $options: "i" };
		if (lowerDateBound) filter["info.startTime"] = { $gte: lowerDateBound };
		if (upperDateBound) {
			if (!filter["info.startTime"]) filter["info.startTime"] = {};
			filter["info.startTime"]["$lte"] = upperDateBound;
		}

		const cursor = this.storedLobbies.collection.find(filter).sort({ "info.startTime": -1 }).limit(REPLAY_REQ_LIMIT);

		await cursor.forEach(doc => {
			stream.write(JSON.stringify(doc));
		});

		stream.end();
	}

	@Callable
	public async getRecordedLobby(id: string): Promise<VTGRHeader> {
		return await this.storedLobbies.get(id);
	}

	@Callable
	public async getUser(id: string): Promise<DbUserEntry> {
		return await this.users.get(id);
	}

	@Callable
	public async getUsersWithScope(scope: UserScopes): Promise<DbUserEntry[]> {
		return await this.users.collection.find({ scopes: scope }).toArray();
	}

	@Callable
	public async createUser(user: DbUserEntry): Promise<void> {
		await this.users.add(user);
	}

	@Callable
	public async searchUserByName(query: string): Promise<DbUserEntry[]> {
		const mongoQuery = { "lastUserObject.username": { $regex: query, $options: "i" } };
		const result = await this.users.collection.find(mongoQuery).limit(30).toArray();
		return result;
	}

	@Callable
	public async updateUserScopes(id: string, scopes: UserScopes[]) {
		this.users.collection.updateOne({ id: id }, { $set: { scopes: scopes } });
	}

	@Callable
	public async updateUserLastLogin(id: string, userObj: HCUser) {
		this.users.collection.updateOne({ id: id }, { $set: { lastLoginTime: Date.now(), lastUserObject: userObj } });
	}

	@Callable
	public async addRecordedLobbyPacket(packet: RecordedLobbyPacket) {
		await this.recordingLobbies.add(packet);
	}

	@Callable
	public async getAllLobbyPackets(recordingId: string): Promise<RecordedLobbyPacket[]> {
		return this.recordingLobbies.collection.find({ recordingId: recordingId }).toArray();
	}

	@Callable
	public async getActivelyRecordingLobbiesInitPackets(): Promise<RecordedLobbyPacket[]> {
		return this.recordingLobbies.collection.find({ type: "init" }).toArray();
	}

	@Callable
	public async getActivelyRecordingStopPacket(recordingId: string): Promise<RecordedLobbyPacket> {
		return this.recordingLobbies.collection.findOne({ recordingId: recordingId, type: "event", data: "stop" });
	}

	@Callable
	public async getActivelyRecordingLastPacket(recordingId: string): Promise<RecordedLobbyPacket> {
		return this.recordingLobbies.collection.findOne({ recordingId: recordingId }, { sort: { timestamp: -1 } });
	}

	@ReadStream
	public async getLobbyPacketStream(stream: Writable, recordingId: string) {
		// const cursor = this.recordingLobbies.collection.find({ lobbyId: lobbyId }).stream();
		// cursor.pipe(stream);
		const cursor = this.recordingLobbies.collection.find({ recordingId: recordingId });
		await cursor.forEach(doc => {
			stream.write(JSON.stringify(doc));
		});

		stream.end();
	}

	@Callable
	public async addStoredLobbyHeader(header: VTGRHeader) {
		await this.storedLobbies.add(header);
	}

	@Callable
	public async updateRecordedLobbyMetadata(metadata: VTGRMetadata) {
		// await this.storedLobbies.collection.updateOne({ id: metadata.id }, { $set: { metadata: metadata } });
		await this.storedLobbies.collection.updateOne({ id: metadata.id }, { $set: { "info.metadata": metadata } });
	}

	@Callable
	public async deleteRecordedLobbyPackets(recordingId: string) {
		await this.recordingLobbies.collection.deleteMany({ recordingId: recordingId });
	}
}

export { DBService };
