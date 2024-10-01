import fs from "fs";

function search(dir: string, initDir: string = dir) {
	const files = fs.readdirSync(dir);
	files.forEach((file) => {
		if (file == "2876350101") return;
		const filePath = `${dir}/${file}`;
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			search(filePath, initDir);
		} else if (filePath.endsWith(".mp4")) {
			const resultName = filePath.substring(initDir.length + 1).replaceAll("/", "_");
			console.log(`${filePath} -> ${resultName}`);
			fs.copyFileSync(filePath, `../output/${resultName}`);
		}
	});
}

search("../steamapps/workshop/content/667970");;