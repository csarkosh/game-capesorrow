/**
 * The empty game's simulation: a world with nothing in it but its players,
 * and the rules of a game with none beyond walking. The engine's tick moves
 * the players over the ground, through the forest and round the lakes; no one
 * is held still, nothing limits a move, and the host has no step of its own.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import { spiralSpawn } from "@csarkosh/engine/sim/spawnGround";
import { activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import type { PlayerCore, Rules, SimState, SimWorld } from "@csarkosh/engine/sim/tick";
import { baseGround, withDecks } from "./sim/town/decks.js";
import { townConstrain } from "./sim/town/solid.js";
import { townStart } from "./sim/town/start.js";

/** A player: what the engine moves, and nothing of a game's beside it. */
export type Walker = PlayerCore;
/** The state: the tick, the players, and the two counters every state carries. */
export type WalkState = SimState<Walker>;
/** The world: the state, the ground and the forest it is walked on. */
export type WalkWorld = SimWorld<Walker> & { forest: Forest };

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
  newPlayer: (id, at) => ({ id, pos: cloneVec3(at.pos), vel: { x: 0, y: 0, z: 0 }, yaw: at.yaw, pitch: 0, grounded: false, lastProcessedInput: 0 }),
  held: () => false,
  /** The town's buildings are walls: a hull is moved out of them and slides along them (`sim/town/solid.ts`). */
  constrain: townConstrain,
  hostStep: () => undefined,
};

/** A world on `forest`: the host's own, or a client's predicted copy. Its ground is the engine's with the harbour's decks laid over it (`sim/town/decks.ts`), the same on every peer. */
export function createWalkWorld(forest: Forest, authoritative: boolean): WalkWorld {
  return {
    state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: forest.seed | 0 },
    boxes: forest.grid,
    ground: withDecks(baseGround(forest.seed), forest.seed),
    forest,
    authoritative,
    waterLevel: activeTerrainVariant().waterLevel ?? null,
  };
}
