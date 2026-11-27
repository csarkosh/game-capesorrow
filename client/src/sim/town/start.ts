/**
 * Where the player starts: on the street side of the municipal building's door, facing away from it (the
 * plan's `spawn`, `port/landmarks.ts`). A detective's day begins at the office in the town's municipal building.
 *
 * A pure function of the world's seed, in world coordinates (the plan's frame plus the site's
 * anchor), so the rules that place the player and the page and the worker that centre the first
 * scene on them agree with nothing exchanged.
 */
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";

/** The player's start for a world's seed, and the way they face. */
export function townStart(worldSeed: number): { x: number; z: number; yaw: number } {
  const { anchor } = siteFor(worldSeed);
  const { spawn } = planFor(worldSeed);
  return { x: anchor.x + spawn.x, z: anchor.z + spawn.z, yaw: spawn.yaw };
}

/** The x of the clearing the clutter keeps its tall things out of: the start's. */
export function townClearingX(worldSeed: number): number {
  return townStart(worldSeed).x;
}
