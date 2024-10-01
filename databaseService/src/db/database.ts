import MongoDBPkg from "mongodb";

import { CollectionManager, EncodedCollectionManager, Encoder } from "./collectionManager.js";

// This file defines a 'database' class which is a wrapper around the MongoDB database
interface DatabaseOptions {
	databaseName: string;
	url: string;
}
const {
	MongoClient,
} = MongoDBPkg;

type Logger = (msg: string) => void;

class Database {
	db: MongoDBPkg.Db;
	log: Logger;
	options: DatabaseOptions;
	constructor(opts: DatabaseOptions, log: Logger) {
		this.log = log;
		this.options = opts;
	}

	// Connects to the mongoDB database
	async init(): Promise<boolean> {
		this.log("Database init started");
		try {
			const client = await MongoClient.connect(this.options.url);
			this.db = client.db(this.options.databaseName);
			this.log("Database client connected");
			return true;
		} catch (e) {
			this.log(`Database init failed: ${e.toString()}`);
			this.log(e);
			return false;
		}
	}

	// Creates a new collection manager and returns it
	async collection<T, IDType extends string = string>(collectionName: string, useCache: boolean, idProp: string): Promise<CollectionManager<T, IDType>> {
		this.log(`Initializing collection manager for ${collectionName}. Caching: ${useCache}, ID Property: ${idProp}`);
		const newCollection = new CollectionManager<T, IDType>(this, collectionName, useCache, idProp);
		await newCollection.init();
		this.log(`Init finished, ${newCollection.collection.collectionName} and ${newCollection.archive.collectionName} are ready to be used`);
		return newCollection;
	}

	async encodedCollection<DataType, SerializedData, IDType extends string = string>(
		collectionName: string,
		useCache: boolean,
		idProp: string,
		encoder: Encoder<DataType, SerializedData>
	): Promise<EncodedCollectionManager<DataType, SerializedData, IDType>> {
		this.log(`Initializing encoded collection manager for ${collectionName}. Caching: ${useCache}, ID Property: ${idProp},`);
		const newCollection = new EncodedCollectionManager<DataType, SerializedData, IDType>(this, collectionName, useCache, idProp, encoder);
		await newCollection.init();
		this.log(`Init finished, ${newCollection.dbManager.collection.collectionName} and ${newCollection.dbManager.archive.collectionName} are ready to be used`);
		return newCollection;
	}
}
export default Database;
export { DatabaseOptions };