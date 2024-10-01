import fs from "fs";
import path from "path";

import { StorageHandler } from "./storageHandler.js";

class FSStorage extends StorageHandler {
	constructor(private root: string) {
		super();
		if (!fs.existsSync(root)) fs.mkdirSync(root);
	}
	public async init(): Promise<void> {}

	public async uploadFile(filepath: string, key: string): Promise<void> {
		const location = this.dir(key);
		return new Promise<void>((res, err) => {
			fs.copyFile(filepath, location, err => {
				res();
			});
		});
	}

	public async uploadStream(stream: NodeJS.ReadableStream, key: string): Promise<void> {
		const location = this.dir(key);
		return new Promise<void>((res, err) => {
			stream.pipe(fs.createWriteStream(location)).on("finish", () => {
				res();
			});
		});
	}

	public async uploadText(text: string, key: string): Promise<void> {
		const location = this.dir(key);
		return new Promise<void>((res, err) => {
			fs.writeFile(location, text, err => {
				res();
			});
		});
	}

	public async downloadFile(key: string, filepath: string): Promise<void> {
		const location = this.dir(key);
		return new Promise<void>((res, err) => {
			fs.copyFile(location, filepath, err => {
				res();
			});
		});
	}

	public async downloadStream(key: string, stream: NodeJS.WritableStream): Promise<void> {
		const location = this.dir(key);
		return new Promise<void>((res, err) => {
			fs.createReadStream(location, { highWaterMark: 512 * 1024 }) // 512kb
				.pipe(stream)
				.on("finish", () => {
					res();
				});
		});
	}

	public async getDownloadStream(key: string): Promise<NodeJS.ReadableStream> {
		const location = this.dir(key);
		return fs.createReadStream(location, { highWaterMark: 512 * 1024 }); // 512kb
	}

	public async downloadText(key: string): Promise<string> {
		const location = this.dir(key);
		return new Promise<string>((res, err) => {
			fs.readFile(location, (err, data) => {
				res(data.toString());
			});
		});
	}

	public async downloadBuffer(key: string): Promise<Buffer> {
		const location = this.dir(key);
		return new Promise<Buffer>((res, err) => {
			fs.readFile(location, (err, data) => {
				res(data);
			});
		});
	}

	public async exists(key: string): Promise<boolean> {
		const location = this.dir(key);
		const exists = fs.existsSync(location);
		return exists;
	}

	public async sizeof(key: string): Promise<number> {
		const location = this.dir(key);
		const stats = await new Promise<fs.Stats>(res => fs.stat(location, (err, data) => res(data)));
		return stats.size;
	}

	private dir(dirPath: string) {
		if (dirPath.includes("/")) dirPath = dirPath.replace("/", "\\");
		const parts = dirPath.split("\\");
		let current = this.root + "\\";
		parts.slice(0, -1).forEach(part => {
			current = current + part + "\\";
			if (!fs.existsSync(current)) fs.mkdirSync(current);
		});
		current = current + parts[parts.length - 1];
		const result = path.resolve(current);
		console.log(`Resolved ${dirPath} to ${result}`);
		return result;
	}
}

export { FSStorage };
