/**
 * Where the player starts. For now, before the plan names a door: a point on the made ground
 * `START_SEAWARD` metres seaward of the highway at the anchor's z, facing the sea. The plan's FBI
 * office will replace this: its door is where a detective arrives.
 *
 * A pure function of the world's seed, in world coordinates, so the rules that place the player
 * and the page and the worker that centre the first scene on them agree with nothing exchanged.
 */
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { facingYaw } from "@csarkosh/engine/sim/facing";

/** How far seaward of the highway the player starts, metres. */
export const START_SEAWARD = 40;

/** The player's start for a world's seed, and the way they face: west, to the sea. */
export function townStart(worldSeed: number): { x: number; z: number; yaw: number } {
  return { x: roadCenterX(worldSeed, COVE_Z) - START_SEAWARD, z: COVE_Z, yaw: facingYaw(-1, 0) };
}

/** The x of the clearing the clutter keeps its tall things out of: the start's. */
export function townClearingX(worldSeed: number): number {
  return townStart(worldSeed).x;
}
