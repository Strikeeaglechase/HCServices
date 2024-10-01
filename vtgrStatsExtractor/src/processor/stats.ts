import { Vector } from "common/vector.js";

const prec = (a: number, b: number) => ((a / b) * 100).toFixed(1) + "%";

class MissileData {
	public hasFired = false;
	public startPosition: Vector;
	public endPosition: Vector;

	public startVelocity: Vector;
	public endVelocity: Vector;

	public startTime: number;
	public endTime: number;

	public launchRange: number;
	public travelDistance: number;

	public missileType: string;
}

class Stats {
	public missiles: MissileData[] = [];

	static playersSpawned = 0;
	static playerTravelDistance = 0;

	static print() {
		// console.log(`Missiles -- spawned: ${Stats.missilesSpawned}, fired: ${Stats.missilesFired}, hit: ${Stats.missilesHit}`);
		// console.log(`Missiles -- fired: ${prec(Stats.missilesFired, Stats.missilesSpawned)}, hit: ${prec(Stats.missilesHit, Stats.missilesFired)}`);
		// const averageHitRange = Stats.missilesHitLaunchRange / Stats.missilesHit;
		// const averageHitTravelDist = Stats.missilesHitTravelDistance / Stats.missilesHit;
		// const averageMissTravelDist = Stats.missilesMissTravelDistance / (Stats.missilesFired - Stats.missilesHit);
		// console.log(`Missiles -- average hit range: ${averageHitRange.toFixed(1)}`);
		// console.log(
		// 	`Missiles -- average hit travel distance: ${averageHitTravelDist.toFixed(1)}, average miss travel distance: ${averageMissTravelDist.toFixed(1)}`
		// );
		// const distDelta = Stats.missilesTravelDistance - Stats.missilesLinearTravelDistance;
		// const distPrec = prec(distDelta, Stats.missilesLinearTravelDistance);
		// console.log(`Missiles travel ${distPrec} more distance than linear travel.`);
	}
}

export { Stats, MissileData };
