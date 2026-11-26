/**
 * The game's simulation: a world with its players and one car, and the rules of a game with walking and driving. The
 * engine's tick moves the players over the ground, through the forest and round the lakes; a player in the car is moved by
 * the car's rules (`sim/car/rules.ts`), one getting in or out is held still, and the host's step keeps the car.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import { spiralSpawn } from "@csarkosh/engine/sim/spawnGround";
import { activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import type { Rules, SimState } from "@csarkosh/engine/sim/tick";
import { carHeld, carHostStep, carMove, constrainByCars, newRide, type CarState, type Rider, type RiderWorld } from "./sim/car/rules.js";
import { newCar, walkGround } from "./sim/car/start.js";
import { townConstrain } from "./sim/town/solid.js";
import { townStart } from "./sim/town/start.js";

/** A player: what the engine moves, and where it is in a car. */
export type Walker = Rider;
/** The state: the tick, the players, the two counters every state carries, and the cars. */
export type WalkState = SimState<Walker> & CarState;
/** The world: the state, the ground and the forest it is walked on. */
export type WalkWorld = RiderWorld;

/**
 * Where the search for a first place to stand begins: the town's start (`townStart`), on the made ground
 * seaward of the highway at the cove. Every peer walks the same spiral out from it to the first place a hull
 * stands free, above the sea and off a lake's bed, so all agree with nothing exchanged.
 */
export function walkFrom(seed: number): { x: number; z: number } {
  const start = townStart(seed);
  return { x: start.x, z: start.z };
}

export const WALK_RULES: Rules<WalkWorld, Walker> = {
  spawn: (world) => ({ pos: spiralSpawn(world.boxes, world.forest.seed, PLAYER_HALF, walkFrom(world.forest.seed)), yaw: townStart(world.forest.seed).yaw }),
  newPlayer: (id, at) => ({ id, pos: cloneVec3(at.pos), vel: { x: 0, y: 0, z: 0 }, yaw: at.yaw, pitch: 0, grounded: false, lastProcessedInput: 0, ride: newRide() }),
  held: carHeld,
  /** A seated player's move is the car's (`sim/car/rules.ts`); a player on foot walks. */
  move: carMove,
  /** The town's buildings are walls: a hull is moved out of them and slides along them (`sim/town/solid.ts`). */
  constrain: (world, pos, vel) => {
    townConstrain(world, pos, vel);
    constrainByCars(world, pos, vel);
  },
  hostStep: (world) => carHostStep(world),
};

/** A world on `forest`: the host's own, or a client's predicted copy. Its ground is the engine's with the streets' trough filled (`streetField.ts`), the harbour's decks and the railroad's trestles laid over it (`sim/town/decks.ts`, `railDeck.ts`), the same on every peer. */
export function createWalkWorld(forest: Forest, authoritative: boolean): WalkWorld {
  return {
    state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: forest.seed | 0, cars: [newCar(forest.seed, 1)] },
    boxes: forest.grid,
    ground: walkGround(forest.seed),
    forest,
    authoritative,
    waterLevel: activeTerrainVariant().waterLevel ?? null,
  };
}
