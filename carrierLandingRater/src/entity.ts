import { createCanvas, Image } from "canvas";
import { RPCPacket } from "common/rpc.js";
import { IVector3, Vector } from "common/vector.js";
import fs from "fs";
import GIFEncoder from "gifencoder";
import * as THREE from "three";

import { Parser } from "./parser.js";
import { Color, ColorValue } from "./renderer/color.js";
import { Renderer } from "./renderer/renderer.js";
import { RPCConsumer } from "./rpcConsumer.js";

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (rad: number): number => (rad * 180) / Math.PI;

enum EntityType {
	Player,
	Missile
}

const scaleNm = 1;
const xScale = 1852 * scaleNm;
const vertYScale = 100;
const horizontalYScale = (1852 * scaleNm) / 3;
const width = 2000;
const height = 1250;
const leftBuffer = -70;
const centerYPos = 700;
const horizontalBuffer = 175;
const deckAltitude = 25.8;
const centerlineZValue = 20;
const touchdownPointOffset = 83;
const carrierImageXOffset = 135;
const vnames = {
	"Vehicles/SEVTF": "F-45A",
	"Vehicles/FA-26B": "F/A-26B",
	"Vehicles/AH-94": "AH-94",
	"Vehicles/VTOL4": "AV-42C",
	"Vehicles/T-55": "T-55",
	"Vehicles/EF-24": "EF-24"
};

const formatError = (val: number) => {
	// if (val < 20_000) return val.toFixed(0);
	// if (val < 50_000) return `${(val / 1000).toFixed(1)}k`;
	// if (val < 1_000_000) return `${(val / 1000).toFixed(0)}k`;
	// return `${(val / 1_000_000).toFixed(2)}m`;

	// Add commas to the number
	const str = val.toFixed(0);
	return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const heightToY = (h: number) => (-((h - deckAltitude) / vertYScale) * height) / 2 + centerYPos;
const posToX = (p: number) => (p / xScale) * width + leftBuffer;
const horizZToY = (z: number) => (-(z - centerlineZValue) / horizontalYScale) * height + centerYPos + horizontalBuffer;
const aoaColors: { color: ColorValue; value: number; name: string }[] = [
	{ color: "#FF0000", value: 6.9, name: "Fast" },
	{ color: "#FF6500", value: 7.4, name: "Slightly-Fast" },
	{ color: "#00FF00", value: 8.8, name: "On-Speed" },
	{ color: "#005EBB", value: 9.3, name: "Slightly-Slow" },
	{ color: "#0000FF", value: Infinity, name: "Slow" }
];

let landingCounter = 0;

function correctUnityVector(type: string, { pos, rot, vel, time, aoa }: { pos: Vector; rot: Vector; vel: Vector; time?: number; aoa: number }) {
	const newPos = new Vector(-pos.x, pos.y, pos.z);
	const newVel = new Vector(-vel.x, vel.y, vel.z);
	const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rot.x), -rad(rot.y), -rad(rot.z), "YXZ"));
	const r = new THREE.Euler().setFromQuaternion(quat);

	const newRot = new Vector(r.x, r.y, r.z);

	const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

	let aoaOffset = 0;
	if (type == "Vehicles/FA-26B" || type == "Vehicles/T-55") aoaOffset = 0.806;
	if (type == "Vehicles/EF-24") aoaOffset = 0.8896;

	const correctedAoa = deg(newVel.angleTo(Vector.from(forward))) + aoaOffset;

	return { pos: newPos, rot: newRot, time, aoa: correctedAoa };
}

class Entity extends RPCConsumer {
	public type: EntityType;

	public position: Vector;
	public rotation: Vector;
	public velocity: Vector;
	public acceleration: Vector;
	public aoa: number;

	public lastCableCaught = 0;
	public lastCableCaughtTime = 0;

	public dataHistory: { pos: Vector; rot: Vector; vel: Vector; aoa: number; time: number }[] = [];

	private previousLandedState = true;
	private lastLandedTime = 0;
	private createNextGraphAt = 0;

	constructor(id: number | string, public ownerId: string, public path: string, position: IVector3, velocity: IVector3, public active: boolean) {
		super(id.toString());
		this.position = new Vector().set(position);
		this.velocity = new Vector().set(velocity);
		this.acceleration = new Vector();
		this.rotation = new Vector();

		if (path.startsWith("Vehicles")) {
			this.type = EntityType.Player;
		}

		this.lastLandedTime = Parser.time;
	}

	public handleRpc(rpc: RPCPacket) {
		super.handleRpc(rpc);
		switch (rpc.method) {
			case "UpdateData": {
				// pos, vel, acc, rot, throttle (skipped), isLanded
				this.updateData(rpc.args[0], rpc.args[1], rpc.args[2], rpc.args[3], rpc.args[5]);
				break;
			}

			case "Die":
				this.handleDie();
				break;

			case "SetCable":
				this.lastCableCaught = rpc.args[0] + 1;
				this.lastCableCaughtTime = Parser.time;
				break;

			// case "SetFuel":
			// case "UpdatePilotHead":
			// 	break;
			// default:
			// 	console.log(rpc);
		}
	}

	private handleDie() {}

	private updateData(pos: IVector3, vel: IVector3, acc: IVector3, rot: IVector3, isLanded: boolean) {
		this.position.set(pos);
		this.velocity.set(vel);
		this.acceleration.set(acc);
		this.rotation.set(rot);

		// const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(rot.x), -rad(rot.y), -rad(rot.z), "YXZ"));
		// const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

		// let aoaOffset = 0;
		// if (this.path == "Vehicles/FA-26B" || this.path == "Vehicles/T-55") aoaOffset = 0.806;
		// const aoa = deg(this.velocity.angleTo(Vector.from(forward))) + aoaOffset;

		this.dataHistory.push({ pos: this.position.clone(), rot: this.rotation.clone(), vel: this.velocity.clone(), aoa: 0, time: Parser.time });

		if (this.type != EntityType.Player) return;

		if (this.createNextGraphAt && Parser.time > this.createNextGraphAt) {
			this.createNextGraphAt = 0;

			const nCarrier = Parser.getNearestEntity(this.position, e => e.path.toLowerCase() == "units/allied/alliedcarrier");
			// console.log(`NCarrier: ${nCarrier.entity.id}, dist: ${nCarrier.dist}`);
			if (nCarrier.dist < 1000) {
				// console.log(`Landed on carrier`);

				this.createLandingGraph(nCarrier.entity);
			}
		}

		if (!this.previousLandedState && isLanded) {
			const flightTime = Parser.time - this.lastLandedTime;
			if (flightTime > 10 * 1000) {
				// console.log(`Landed at ${this.position.toString()}, flight time: ${flightTime}`);
				this.createNextGraphAt = Parser.time + 1000;
			}
		}

		this.previousLandedState = isLanded;
		if (isLanded) {
			this.lastLandedTime = Parser.time;
		}
	}

	private createLandingGraph(carrier: Entity) {
		// const canvas = PImage.make(1000, 1000);
		const ourData = this.dataHistory.map(p => correctUnityVector(this.path, p));
		const carrierData = carrier.dataHistory.map(p => correctUnityVector(carrier.path, p));

		const relativePath = ourData
			.filter(d => Parser.time - d.time < 45000)
			.map(p => {
				const closestCarrier = carrierData.reduce((prev, curr) => {
					if (Math.abs(curr.time - p.time) < Math.abs(prev.time - p.time)) {
						return curr;
					}
					return prev;
				});

				const relativePos = p.pos.clone().subtract(closestCarrier.pos);
				const carrierRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(closestCarrier.rot.x, closestCarrier.rot.y, closestCarrier.rot.z));
				const carrierSide = new THREE.Vector3(1, 0, 0).applyQuaternion(carrierRotation);
				const onPlane = new THREE.Vector3(relativePos.x, relativePos.y, relativePos.z).projectOnPlane(carrierSide);

				const deckRotation = new THREE.Euler(0, rad(10 + 90 + closestCarrier.rot.y), 0);
				const deckQuat = new THREE.Quaternion().setFromEuler(deckRotation).multiply(carrierRotation);
				const rotatedRelative = new THREE.Vector3(relativePos.x, relativePos.y, relativePos.z).applyQuaternion(deckQuat.invert());

				return { vertical: onPlane, horizontal: rotatedRelative, aoa: p.aoa };
			});

		// heightToY(0) = centerYPos

		const canvas = createCanvas(width, height);
		const renderer = new Renderer(canvas);
		renderer.clear([31, 41, 55]);

		renderer.ctx.lineWidth = 1;

		this.drawBottomScaleBar(renderer);
		this.drawCarrierImages(renderer);
		this.drawAngledLines(renderer);

		let prev = relativePath[0];
		let totalError = 0;

		let lastCheckX = 1389;
		for (let i = 1; i < relativePath.length; i++) {
			renderer.ctx.lineWidth = 5;
			const current = relativePath[i];
			const color = this.getAoaColor(current.aoa);

			// Vertical graph
			const vx1 = posToX(prev.horizontal.x);
			const vy1 = heightToY(prev.vertical.y);
			const vx2 = posToX(current.horizontal.x);
			const vy2 = heightToY(current.vertical.y);
			renderer.line(vx1, vy1, vx2, vy2, color);

			// Horizontal graph
			const hx1 = posToX(prev.horizontal.x);
			const hy1 = horizZToY(prev.horizontal.z);
			const hx2 = posToX(current.horizontal.x);
			const hy2 = horizZToY(current.horizontal.z);
			renderer.line(hx1, hy1, hx2, hy2, color);

			renderer.ctx.lineWidth = 1;

			const distIn = lastCheckX - current.horizontal.x;
			// if (current.horizontal.x <= 1389) {
			if (distIn > 10) {
				const errorMult = Math.floor(distIn / 10);
				const endPosMetersY = Math.tan(rad(3.5)) * current.horizontal.x;
				const endPosCanvasY = heightToY(endPosMetersY + deckAltitude) + 30;
				const expectedZValue = centerYPos + horizontalBuffer;
				const zError = Math.abs(hy2 - expectedZValue);
				const yError = Math.abs(vy2 - endPosCanvasY);
				const aoaError = Math.abs(current.aoa - 8.2);
				totalError += (zError + yError + aoaError * 20) * 3 * errorMult;
				// if (i % 25 == 0) {
				// renderer.line(vx2, vy2, vx2, endPosCanvasY, [255, 255, 255]);
				// renderer.line(hx2, hy2, vx2, expectedZValue, [255, 255, 255]);
				// renderer.text(`${yError.toFixed(0)}/${totalError.toFixed(0)}`, vx2, endPosCanvasY, 255, 12);
				// renderer.text(`${distIn.toFixed(0)}`, vx2, expectedZValue, 255, 6);
				// }

				lastCheckX = current.horizontal.x;
			}

			prev = current;
		}

		// Name
		const name = Parser.instance.getUserName(this.ownerId);
		const entName = vnames[this.path];
		renderer.text(`${name} [${entName}]`, 10, 40, 255, 32);
		const wire = Parser.time - carrier.lastCableCaughtTime < 5000 ? carrier.lastCableCaught + " Wire" : "Bolter";
		const score = totalError;
		renderer.text(`${wire} Error: ${formatError(score)}`, 10, 90, 255, 32);
		renderer.text(`(Lower is better)`, 210, 115, 255, 16);

		// Speed Legend
		aoaColors.forEach((aoa, i) => {
			renderer.rect(10, 125 + i * 50, 30, 30, aoa.color);
			renderer.text(aoa.name, 50, 150 + i * 50, 255, 28);
		});

		// CAW8 logo
		this.drawLogo(renderer);

		const buf = canvas.toBuffer();
		const cleanName = (landingCounter++).toString().padStart(2, "0") + "_" + name.replaceAll(" ", "_") + "_" + wire.replaceAll(" ", "_");
		// fs.writeFileSync(`../landingGraphs/${cleanName}.png`, buf);
		Parser.instance.resultImages.push({ name: `${cleanName}.png`, data: buf });

		this.dataHistory = [];
		carrier.dataHistory = [];
	}

	private drawLogo(renderer: Renderer) {
		const logo = fs.readFileSync("../caw8.png");
		const logoImg = new Image();
		logoImg.src = logo;

		const ratio = 1535 / 1368;
		const size = height - 250;
		const imageWidth = size * ratio;
		const imageHeight = size;

		const x = width / 2 - imageWidth / 2;
		const y = height / 2 - imageHeight / 2;
		renderer.ctx.globalAlpha = 0.06;
		renderer.ctx.drawImage(logoImg, x, y, imageWidth, imageHeight);
		renderer.ctx.globalAlpha = 1;
		renderer.text(`https://discord.gg/caw8`, 10, height - 10, 255, 28);
	}

	private getAoaColor(aoa: number): ColorValue {
		const aoaColor = aoaColors.find(c => aoa < c.value);
		const colorIdx = aoaColors.indexOf(aoaColor);
		if (colorIdx == 0) return aoaColor.color;

		const prevColor = aoaColors[colorIdx - 1];
		const t = (aoa - prevColor.value) / (aoaColor.value - prevColor.value);
		return Color.lerp(prevColor.color, aoaColor.color, t);
	}

	private drawBottomScaleBar(renderer: Renderer) {
		const barY = height - 120;
		renderer.line(0, barY, width, barY, 255);
		for (let i = 1852 / 4; i < xScale; i += 1852 / 4) {
			const x = (i / xScale) * width + leftBuffer;
			renderer.line(x, barY, x, barY + 20, 255);
			const distText = `${(i / 1852).toFixed(2)}nm`;
			const fontSize = 32;
			renderer.ctx.font = `${fontSize}pt Anonymous Pro, monospace`;
			let offset = renderer.ctx.measureText(distText).width / 2;
			if (i == 0) offset = 25;
			renderer.text(distText, x - offset, barY + 60, 255, fontSize);
		}
	}

	private drawCarrierImages(renderer: Renderer) {
		const image = fs.readFileSync("../carrier-side.png");
		const carrierImg = new Image();
		carrierImg.src = image;
		const imgSize = 230;
		renderer.ctx.drawImage(carrierImg, leftBuffer - imgSize / 2 + carrierImageXOffset, centerYPos - 73, imgSize, imgSize / 2);

		const image2 = fs.readFileSync("../carrier-top.png");
		const carrierImg2 = new Image();
		carrierImg2.src = image2;
		renderer.ctx.drawImage(carrierImg2, leftBuffer - imgSize / 2 + carrierImageXOffset, centerYPos + horizontalBuffer - 57, imgSize, imgSize / 2);
	}

	private drawAngledLines(renderer: Renderer) {
		function drawVertLine(angle: number, color: ColorValue) {
			const endPosMetersX = 10000;
			const endPosMetersY = Math.tan(angle) * endPosMetersX;
			const endPosCanvasX = posToX(endPosMetersX);
			const endPosCanvasY = heightToY(endPosMetersY + deckAltitude);

			const startX = leftBuffer + touchdownPointOffset;
			const startY = heightToY(deckAltitude);
			const canvasXPos = endPosCanvasX + touchdownPointOffset;
			const canvasYPos = endPosCanvasY;

			renderer.line(startX, startY, canvasXPos, canvasYPos, color);
		}

		function drawHorizontalLine(angle: number, color: ColorValue) {
			const startX = leftBuffer + touchdownPointOffset;
			const startY = centerYPos + horizontalBuffer;
			const endPosX = Math.cos(angle) * 10000;
			const endPosY = Math.sin(angle) * 10000;
			const endPosCanvasX = posToX(endPosX);
			const endPosCanvasY = horizZToY(endPosY);
			renderer.line(startX, startY, endPosCanvasX, endPosCanvasY, color);
		}

		const targetAngle = 3.5;
		const slopes: { angle: number; color: ColorValue }[] = [
			{ angle: targetAngle - 0.9, color: [239, 68, 68] },
			{ angle: targetAngle - 0.6, color: [254, 240, 138] },
			{ angle: targetAngle - 0.25, color: [34, 197, 94] },
			{ angle: targetAngle, color: [100, 116, 139] },
			{ angle: targetAngle + 0.25, color: [34, 197, 94] },
			{ angle: targetAngle + 0.7, color: [254, 240, 138] },
			{ angle: targetAngle + 1.5, color: [239, 68, 68] }
		];

		slopes.forEach(slope => {
			drawVertLine(rad(slope.angle), slope.color);
		});

		const horizontalLines: { angle: number; color: ColorValue }[] = [
			{ angle: 0.25, color: [100, 116, 139] },
			{ angle: 0.75, color: [34, 197, 94] },
			{ angle: 3.0, color: [254, 240, 138] },
			{ angle: 6.0, color: [239, 68, 68] }
		];

		horizontalLines.forEach(line => {
			drawHorizontalLine(rad(line.angle), line.color);
			drawHorizontalLine(rad(-line.angle), line.color);
		});
	}
}

export { Entity };
