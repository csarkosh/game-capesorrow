/**
 * The railroad's main line: where it runs through the whole world, as a pure
 * function of the world's seed, so that the plan (which keeps its corridor
 * clear of blocks), the ground (which grades its bed), the forest (which is
 * cleared from it) and the drawing (which lays its ballast, ties and rails,
 * wherever the player is) all ask the same thing.
 *
 * The line follows the highway: beside it on the seaward side, at one offset
 * from the highway's centre, at the highway's own grade, along the whole
 * coast. It does not begin or end at a town. A town's own tracks (a spur to
 * its quay, its mill and its terminal) leave this line and are the plan's.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";

/** How far seaward of the highway's centre line the main line's centre runs, metres: clear of the highway's bed and shoulder. */
export const RAIL_OFFSET = 16;

/** Half the width of the main line's own ground, metres: ballast, a ditch and a strip kept clear each side. Nothing of a town's stands inside it but a crossing. */
export const RAIL_CORRIDOR_HALF = 5;

/** Half the width of the ballast bed, metres. */
export const RAIL_BED_HALF = 2;

/** The gauge between the rails' centres, metres (standard gauge). */
export const RAIL_GAUGE = 1.435;

/** The main line's centre x in the world at a z. */
export function railCenterX(worldSeed: number, z: number): number {
  return roadCenterX(worldSeed, z) - RAIL_OFFSET;
}

/** A place's offset from the main line's centre: negative seaward of it. */
export function railOffsetAt(worldSeed: number, x: number, z: number): number {
  return x - railCenterX(worldSeed, z);
}
