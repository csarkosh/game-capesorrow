/**
 * What grows beside the railroad's main line: nothing within its corridor, and the forest standing right up to the
 * corridor's edge, so the line runs through a slot in the trees. The engine asks the place for a feature mask at a tree
 * cell's centre, a ground-cover sample or a loose rock, and this takes the town's answer (`clearing.ts`) and shuts it
 * along the line:
 *
 * - **Trees.** A tree stands up to `TREE_JITTER` from its cell's centre (the engine's jitter: 3.5 m across the line), so the
 *   mask is shut to `RAIL_TREE_SHUT` = the corridor's half width + that, and opens over `RAIL_TREE_RAMP`: no trunk stands in the
 *   corridor, and the first stand beside it.
 * - **Ground cover** (grass, bushes, shrubs, ferns) shut to `RAIL_CLUTTER_SHUT`, the corridor's half width and the ground
 *   cover's own jitter, opening over `RAIL_CLUTTER_RAMP`.
 * - **Loose rock and driftwood** (the mask's `loose`): a rock's cell is 9 m and it stands up to 3.2 m off its centre across the line,
 *   so it takes the trees' own distances.
 *
 * The line's x at a z is a call into the coast; the engine asks along a row of one z, so the highway's centre at the last z is kept (`roadCentre.ts`).
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import type { FeatureMask } from "@csarkosh/engine/sim/features";
import { smootherstepD } from "./fill.js";
import { RAIL_CORRIDOR_HALF, RAIL_OFFSET } from "./rail.js";
import { roadCentreX } from "./roadCentre.js";

/** The farthest a tree stands from its cell's centre across the line, metres (the engine's jitter span over two, of a 10 m cell). */
export const RAIL_TREE_JITTER = 3.5;
export const RAIL_TREE_SHUT = RAIL_CORRIDOR_HALF + RAIL_TREE_JITTER;
export const RAIL_TREE_RAMP = 3;
/** Ground cover is placed by a cell's centre and stands up to 1.5 m off it (the engine's grass cell is the widest), so its mask is shut a little past the corridor. */
export const RAIL_CLUTTER_JITTER = 1.5;
export const RAIL_CLUTTER_SHUT = RAIL_CORRIDOR_HALF + RAIL_CLUTTER_JITTER;
export const RAIL_CLUTTER_RAMP = 2;
/** Beyond this offset from the line's centre the railroad has no say. */
export const RAIL_CLEAR_REACH = Math.max(RAIL_TREE_SHUT + RAIL_TREE_RAMP, RAIL_CLUTTER_SHUT + RAIL_CLUTTER_RAMP);

export const RAIL_CLEARING_TUNABLES: Readonly<Record<string, number>> = {
  RAIL_TREE_JITTER,
  RAIL_TREE_RAMP,
  RAIL_CLUTTER_JITTER,
  RAIL_CLUTTER_RAMP,
};

/** The line's centre x at a z: `railCenterX`, with the highway's centre at the last z asked kept (`roadCentre.ts`). */
function lineX(seed: number, z: number): number {
  return roadCentreX(seed, z) - RAIL_OFFSET;
}

/** The feature mask `mask` (the town's) with the railroad's corridor shut in it: `mask` itself where the point is clear of the line. */
export function railFeatureMask(seed: number, x: number, z: number, mask: FeatureMask): FeatureMask {
  const off = x - lineX(seed, z);
  const a = off < 0 ? -off : off;
  if (a >= RAIL_CLEAR_REACH) return mask;
  const tree = a < RAIL_TREE_SHUT + RAIL_TREE_RAMP ? smootherstepD(RAIL_TREE_SHUT, RAIL_TREE_SHUT + RAIL_TREE_RAMP, a).v : 1;
  const clutter = a < RAIL_CLUTTER_SHUT + RAIL_CLUTTER_RAMP ? smootherstepD(RAIL_CLUTTER_SHUT, RAIL_CLUTTER_SHUT + RAIL_CLUTTER_RAMP, a).v : 1;
  return { tree: mask.tree * tree, clutter: mask.clutter * clutter, meadow: mask.meadow * clutter, bare: mask.bare, loose: (mask.loose ?? 1) * tree };
}
