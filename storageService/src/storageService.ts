import cors from "cors";
import express from "express";
import { Callable, ReadStream, WriteStream } from "serviceLib/serviceHandler.js";
import { Readable, Writable } from "stream";
import unzipper from "unzipper";

import { FSStorage } from "./storageHandlers/fsStorage.js";
import { StorageHandler } from "./storageHandlers/storageHandler.js";

class StorageService {
	public api: express.Express;
	private storage: StorageHandler;

	public async init() {
		this.storage = new FSStorage(process.env.DATA_PATH);

		this.api = express();
		this.api.use(cors());

		this.api.get("/read_unzip", async (req, res) => {
			if (typeof req.query.key !== "string") return res.sendStatus(400);
			if (typeof req.query.file !== "string") return res.sendStatus(400);
			console.log(`Processing read_unzip request, zip: ${req.query.key}, file: ${req.query.file}`);

			const exists = await this.storage.exists(req.query.key);
			if (!exists) return res.sendStatus(404);

			const allowableChars = /[a-z]|[A-Z]|[0-9]|\.|_|-/;
			const fileName = req.query.file
				.split("")
				.filter(c => allowableChars.test(c))
				.join("");
			console.log(req.query.file, fileName);
			const fileNameRegex = new RegExp(`^${fileName}$`);
			const downloadStream = await this.storage.getDownloadStream(req.query.key);
			downloadStream
				.pipe(unzipper.ParseOne(fileNameRegex).on("error", err => console.error(err)))
				.pipe(res)
				.on("error", err => {
					console.error(err);
					res.sendStatus(500);
				})
				.on("finish", () => {
					res.status(200).end();
				});
		});

		this.api.listen(parseInt(process.env.API_PORT), () => {
			console.log(`Storage API opened on ${process.env.API_PORT}`);
		});
	}

	@WriteStream
	write(stream: Readable, key: string) {
		this.storage.uploadStream(stream, key);
	}

	@ReadStream
	async read(stream: Writable, key: string) {
		const exists = await this.storage.exists(key);
		if (!exists) {
			stream.end();
			console.error(`Requested file ${key} does not exist`);
			return;
		}

		this.storage.downloadStream(key, stream);
	}

	@Callable
	writeData(key: string, data: string) {
		this.storage.uploadText(data, key);
	}

	@Callable
	async readData(key: string): Promise<string> {
		return await this.storage.downloadText(key);
	}

	@Callable
	async exists(key: string): Promise<boolean> {
		return await this.storage.exists(key);
	}

	@Callable
	async sizeof(key: string): Promise<number> {
		return await this.storage.sizeof(key);
	}
}

export { StorageService };
