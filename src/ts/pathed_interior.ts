import { Interior } from "./interior";
import { DifParser } from "./parsing/dif_parser";
import { MissionElementSimGroup, MissionElementType, MissionElementPathedInterior, MissionElementPath, MisParser, MissionElementTrigger } from "./parsing/mis_parser";
import { Util } from "./util";
import * as THREE from "three";
import { TimeState } from "./level";
import { MustChangeTrigger } from "./triggers/must_change_trigger";

export class PathedInterior extends Interior {
	path: MissionElementPath;
	duration: number;
	timeStart: number = null;
	timeDest: number = null;
	changeTime: number = null;
	triggers: MustChangeTrigger[] = [];
	timeOffset: number = 0;

	static async createFromSimGroup(simGroup: MissionElementSimGroup) {
		let interiorElement = simGroup.elements.find((element) => element._type === MissionElementType.PathedInterior) as MissionElementPathedInterior;

		let path = interiorElement.interiorResource.slice(interiorElement.interiorResource.indexOf('data/'));
		let difFile = await DifParser.loadFile('./assets/' + path);

		let pathedInterior = new PathedInterior(difFile, Number(interiorElement.interiorIndex));
		await pathedInterior.init();
		pathedInterior.path = simGroup.elements.find((element) => element._type === MissionElementType.Path) as MissionElementPath;
		pathedInterior.computeDuration();

		let triggers = simGroup.elements.filter((element) => element._type === MissionElementType.Trigger) as MissionElementTrigger[];
		for (let triggerElement of triggers) {
			// Make sure the interior doesn't start moving on its own (the default)
			pathedInterior.timeStart = 0;
			pathedInterior.timeDest = 0;
			pathedInterior.changeTime = -Infinity;

			let trigger = new MustChangeTrigger(triggerElement, pathedInterior);
			pathedInterior.triggers.push(trigger);
		}

		let initialTargetPosition = Number(interiorElement.initialTargetPosition ?? -1);
		if (initialTargetPosition >= 0) {
			pathedInterior.timeStart = Number(interiorElement.initialPosition);
			pathedInterior.timeDest = initialTargetPosition;
			pathedInterior.changeTime = 0;
		} else if (interiorElement.initialPosition) {
			pathedInterior.timeOffset = Number(interiorElement.initialPosition);
		}

		return pathedInterior;
	}

	computeDuration() {
		let total = 0;

		// Don't count the last marker
		for (let i = 0; i < this.path.markers.length-1; i++) {
			total += Number(this.path.markers[i].msToNext);
		}

		this.duration = total;
	}

	setDestinationTime(now: TimeState, destination: number) {
		let currentInternalTime = this.getInternalTime(now.currentAttemptTime);

		this.timeStart = currentInternalTime;
		this.timeDest = destination;
		this.changeTime = now.currentAttemptTime;
	}

	getInternalTime(externalTime: number) {
		if (this.changeTime === null) return (externalTime + this.timeOffset) % this.duration;

		let dur = Math.abs(this.timeStart - this.timeDest);
		let completion = Util.clamp((externalTime - this.changeTime) / dur, 0, 1);
		return Util.lerp(this.timeStart, this.timeDest, completion) % this.duration;
	}

	tick(time: TimeState) {
		let transform = this.getTransformAtTime(this.getInternalTime(time.currentAttemptTime));

		let mat = this.worldMatrix.clone();
		mat.multiplyMatrices(transform, mat);

		let position = new THREE.Vector3();
		let orientation = new THREE.Quaternion();
		mat.decompose(position, orientation, new THREE.Vector3());

		this.group.position.copy(position);
		this.group.quaternion.copy(orientation);

		this.body.setPosition(Util.vecThreeToOimo(position));

		let deltaTransform = this.getTransformAtTime(this.getInternalTime(time.currentAttemptTime + 1));
		mat = this.worldMatrix.clone();
		mat.multiplyMatrices(deltaTransform, mat);

		let position2 = new THREE.Vector3();
		let orientation2 = new THREE.Quaternion();
		mat.decompose(position2, orientation2, new THREE.Vector3());

		let velocity = position2.sub(position).multiplyScalar(1000);
		this.body.setLinearVelocity(Util.vecThreeToOimo(velocity));
	}

	getTransformAtTime(time: number) {
		let m1 = this.path.markers[0];
		let m2 = this.path.markers[1];

		let currentEndTime = Number(m1.msToNext);
		let i = 2;
		while (currentEndTime < time && i < this.path.markers.length) {
			m1 = m2;
			m2 = this.path.markers[i++];
			
			currentEndTime += Number(m1.msToNext);
		}

		let m1Time = currentEndTime - Number(m1.msToNext);
		let m2Time = currentEndTime;
		let duration = m2Time - m1Time;
		let position: THREE.Vector3;

		let completion = Util.clamp(duration? (time - m1Time) / duration : 1, 0, 1);
		if (m1.smoothingType === "Accelerate") {
			completion = Math.sin(completion * Math.PI - (Math.PI / 2)) * 0.5 + 0.5;
		} else if (m1.smoothingType === "Spline") {
			let preStart = (i - 2) - 1;
			let postEnd = (i - 1) + 1;
			if (postEnd >= this.path.markers.length) postEnd = 0;
			if (preStart < 0) preStart = this.path.markers.length - 1;

			let p0 = MisParser.parseVector3(this.path.markers[preStart].position);
			let p1 = MisParser.parseVector3(m1.position);
			let p2 = MisParser.parseVector3(m2.position);
			let p3 = MisParser.parseVector3(this.path.markers[postEnd].position);

			position = new THREE.Vector3();
			position.x = Util.catmullRom(completion, p0.x, p1.x, p2.x, p3.x);
			position.y = Util.catmullRom(completion, p0.y, p1.y, p2.y, p3.y);
			position.z = Util.catmullRom(completion, p0.z, p1.z, p2.z, p3.z);
		}

		if (!position) {
			let p1 = MisParser.parseVector3(m1.position);
			let p2 = MisParser.parseVector3(m2.position);
			position = p1.multiplyScalar(1 - completion).add(p2.multiplyScalar(completion));
		}
		
		let r1 = MisParser.parseRotation(m1.rotation);
		let r2 = MisParser.parseRotation(m2.rotation);
		let rotation = r1.slerp(r2, completion);

		let firstPosition = MisParser.parseVector3(this.path.markers[0].position);
		position.sub(firstPosition);

		let mat = new THREE.Matrix4();
		mat.compose(position, rotation, new THREE.Vector3(1, 1, 1));

		return mat;
	}
}