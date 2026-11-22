/** Shared by the town-in-the-world tests: a world made once per seed, and the plan on its site. */
import "../../src/terrain.js";
import { createForest } from "@csarkosh/engine/sim/forest";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { createWalkWorld, type WalkWorld } from "../../src/sim.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";

/** The seed the game is played on, and two more whose towns differ (a turned grid at the quay, a different coast). */
export const WORLD_SEEDS: readonly number[] = [20261121, 1, 7];

const worlds = new Map<number, WalkWorld>();

/** A host's world for a seed, made once: its forest is the expensive part. */
export function worldFor(seed: number): WalkWorld {
  let world = worlds.get(seed);
  if (world === undefined) {
    world = createWalkWorld(createForest(seed), true);
    worlds.set(seed, world);
  }
  return world;
}

/** The ground a world is walked on (every world made here has one). */
export function groundOf(world: WalkWorld): GroundField {
  if (world.ground === null) throw new Error("the world has no ground field");
  return world.ground;
}

export { planFor, siteFor };
