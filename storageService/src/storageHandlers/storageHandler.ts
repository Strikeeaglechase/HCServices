abstract class StorageHandler {
	public abstract init(): Promise<void>;

	public abstract uploadFile(filepath: string, key: string): Promise<void>;
	public abstract uploadStream(stream: NodeJS.ReadableStream, key: string): Promise<void>;
	public abstract uploadText(text: string, key: string): Promise<void>;

	public abstract downloadFile(key: string, filepath: string): Promise<void>;
	public abstract downloadStream(key: string, stream: NodeJS.WritableStream): Promise<void>;
	public abstract getDownloadStream(key: string): Promise<NodeJS.ReadableStream>;
	public abstract downloadText(key: string): Promise<string>;
	public abstract downloadBuffer(key: string): Promise<Buffer>;

	public abstract exists(key: string): Promise<boolean>;
	public abstract sizeof(key: string): Promise<number>;
}

export { StorageHandler };
