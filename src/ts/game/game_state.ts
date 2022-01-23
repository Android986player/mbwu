import { GAME_UPDATE_RATE } from "../../../shared/constants";
import { GameObjectStateUpdate } from "../../../shared/game_object_state_update";
import { AudioManager } from "../audio";
import { DEFAULT_PITCH, PHYSICS_TICK_RATE } from "../level";
import { Euler } from "../math/euler";
import { Vector3 } from "../math/vector3";
import { MissionElementSimGroup, MissionElementTrigger, MisParser } from "../parsing/mis_parser";
import { StartPad } from "../shapes/start_pad";
import { state } from "../state";
import { Util } from "../util";
import { Game } from "./game";

export const GO_TIME = 0 ?? 3.5; // fixme

export class GameState {
	game: Game;
	id = 0;

	tick = -1;
	attemptTick = -1;
	clock = 0;

	get time() {
		return (this.tick + this.subtickCompletion) / GAME_UPDATE_RATE;
	}

	get attemptTime() {
		return (this.attemptTick + this.subtickCompletion) / GAME_UPDATE_RATE;
	}

	subtickCompletion = 0;

	stateHistory = new Map<number, GameObjectStateUpdate[]>();

	collectedGems = 0;
	currentTimeTravelBonus = 0;

	constructor(game: Game) {
		this.game = game;
	}

	advanceTime() {
		if (this.attemptTime >= GO_TIME) {
			if (this.currentTimeTravelBonus > 0) {
				// Subtract remaining time travel time
				this.currentTimeTravelBonus -= 1 / GAME_UPDATE_RATE;
			} else {
				// Increase the gameplay time
				this.clock += 1 / PHYSICS_TICK_RATE;
			}

			if (this.currentTimeTravelBonus < 0) {
				// If we slightly undershot the zero mark of the remaining time travel bonus, add the "lost time" back onto the gameplay clock:
				this.clock += -this.currentTimeTravelBonus;
				this.currentTimeTravelBonus = 0;
			}
		}

		this.tick++;
		this.attemptTick++;
	}

	restart() {
		let { game } = this;
		let hud = state.menu.hud;

		this.clock = 0;
		this.attemptTick = -1;
		this.currentTimeTravelBonus = 0;

		if (game.totalGems > 0) {
			this.collectedGems = 0;
			hud.displayGemCount(this.collectedGems, game.totalGems);
		}

		let marble = game.marble;
		let { position: startPosition, euler } = this.getStartPositionAndOrientation();

		// Todo put all this shit into marble bro! what the fuck are you thinking
		// Place the marble a bit above the start pad position
		marble.body.position.set(startPosition.x, startPosition.y, startPosition.z + 3);
		marble.body.syncShapes();
		marble.group.position.copy(marble.body.position);
		marble.group.recomputeTransform();
		marble.reset();
		marble.calculatePredictiveTransforms();

		let missionInfo = game.mission.missionInfo;
		if (missionInfo.starthelptext)
			hud.displayHelp(missionInfo.starthelptext); // Show the start help text

		for (let object of game.objects) object.reset();

		game.timeTravelSound?.stop();
		game.timeTravelSound = null;
		game.alarmSound?.stop();
		game.alarmSound = null;

		AudioManager.play('spawn.wav');
	}

	saveStates() {
		for (let i = 0; i < this.game.objects.length; i++) {
			let object = this.game.objects[i];
			if (object.hasChangedState) {
				let arr = this.stateHistory.get(object.id);
				if (!arr) {
					arr = [];
					this.stateHistory.set(object.id, arr);
				}

				let stateUpdate: GameObjectStateUpdate = {
					gameStateId: this.id,
					tick: this.tick,
					state: object.getCurrentState()
				};
				arr.push(stateUpdate);
			}
		}

		console.log(this.stateHistory);
	}

	/** Gets the position and orientation of the player spawn point. */
	getStartPositionAndOrientation() {
		let { game } = this;

		// The player is spawned at the last start pad in the mission file.
		let startPad = Util.findLast(game.shapes, (shape) => shape instanceof StartPad);
		let position: Vector3;
		let euler = new Euler();

		if (startPad) {
			// If there's a start pad, start there
			position = startPad.worldPosition;
			euler.setFromQuaternion(startPad.worldOrientation, "ZXY");
		} else {
			// Search for spawn points used for multiplayer
			let spawnPoints = game.mission.allElements.find(x => x._name === "SpawnPoints") as MissionElementSimGroup;
			if (spawnPoints) {
				let first = spawnPoints.elements[0] as MissionElementTrigger;
				position = MisParser.parseVector3(first.position);
			} else {
				// If there isn't anything, start at this weird point
				position = new Vector3(0, 0, 300);
			}
		}

		return { position, euler };
	}
}