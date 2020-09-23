import { PowerUp } from "./power_up";
import * as THREE from "three";
import { state } from "../state";
import { Util } from "../util";

export class AntiGravity extends PowerUp {
	dtsPath = "shapes/items/antigravity.dts";
	isItem = true;
	autoUse = true;
	cooldownDuration: number = 7000;

	pickUp() {return true;}

	use(time: number) {
		let direction = new THREE.Vector3(0, 0, -1);
		direction.applyQuaternion(this.worldOrientation);

		if (Util.isSameVector(direction, state.currentLevel.currentUp)) return;

		state.currentLevel.setUp(Util.vecThreeToOimo(direction), time);
	}
}