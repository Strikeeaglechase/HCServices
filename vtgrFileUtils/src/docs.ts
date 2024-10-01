import fs from "fs";

function run(path: string) {
	const files = fs.readdirSync(path);
	let result = "";
	files.forEach(file => {
		const filePath = path + "/" + file;
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			result += run(filePath);
		} else {
			if (filePath.endsWith(".ts")) {
				result += parseFile(filePath);
			}
		}
	});

	return result;
}

// Convert ["F45A"] into F45A
// Convert "FA26B into FA26B
// Convert  "AH94"] into AH94
const filterChar = (s: string, c: string) => s.split(c).join("");
const filterChars = (s: string, c: string[]) => {
	let result = s;
	c.forEach(cc => result = filterChar(result, cc));
	return result;
};
function filterArg(arg: string) {
	return filterChars(arg, ["\"", " ", "[", "]"]);
}

interface RPC { direction: string, name: string, args: string[]; };

function genMarkdown(name: string, altNames: string[], mode: string, rpcs: RPC[]) {

	const rpcStrs = rpcs.map(rpc => {
		return `- [${rpc.direction.toUpperCase()}] \`${rpc.name}(${rpc.args.join(", ")})\``;
	}).join("\n");
	const md = `
## ${name} (${mode})

### Alt Names: ${altNames.length > 0 ? altNames.join(", ") : "None"}
${rpcStrs}

`;
	return md;
}

function parseFile(path: string) {
	const file = fs.readFileSync(path, "utf8");
	const lines = file.split("\n").map(line => line.trim()).filter(l => l.length > 0);

	let out = "";

	let curMode = "";
	let curAltNames: string[] = [];
	let curName = "";
	let rpcs: RPC[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("@EnableRPCs(")) {
			if (curName != "") {
				out += genMarkdown(curName, curAltNames, curMode, rpcs);
				rpcs = [];
			}

			const args = line.split("(")[1].split(")")[0].split(",").map(arg => filterArg(arg));
			curMode = args[0];
			curAltNames = args.slice(1);

			const nextLine = lines[i + 1];
			curName = nextLine.split(" ")[1];
		}
		if (line.startsWith("@RPC(")) {
			const direction = filterChar(line.split("(")[1].split(")")[0], "\"");
			const nextLine = lines[i + 1];
			let name = nextLine.split("(")[0];
			const parts = name.split(" ");
			if (parts.length != 1) {
				name = parts[parts.length - 1];
			}

			const args = nextLine.split("(")[1].split(")")[0].split(",").map(arg => arg.trim());
			rpcs.push({ direction, name, args });
		}
	}

	if (curName != "") {
		out += genMarkdown(curName, curAltNames, curMode, rpcs);
	}

	return out;
}

let result = "";
result += run("../../VTOLLiveViewerClient/src");
result += run("../../VTOLLiveViewerCommon/src");
fs.writeFileSync("../out.md", result);