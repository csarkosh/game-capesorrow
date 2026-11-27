/**
 * How fast the car may go at a place: `TOWN_SPEED` where the town covers the ground, rising smoothly to `FULL_SPEED` over
 * the cover's own fade past the town's last blocks (`COVER_FADE` metres), and `FULL_SPEED` everywhere beyond. The limit is
 * the town's cover (`coverInto`, without the single outlying lots: a lone building by the highway does not slow the car)
 * mixed between the two speeds, so it has no jump and no corner the cover has not.
 *
 * A pure function of the world's seed and the place: the host's step, a joined machine's prediction and its replay all
 * ask it and must get the same bits.
 *
 * Simulation code: `+ - * /`, `min`, `max`, `floor` only. The one `Map` is a cache looked up by the seed.
 */
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { COVER, COVER_FADE, COVER_HOLD, coverExtentOf, coverInto } from "../town/cover.js";
import { planFor } from "../town/planFor.js";
import { siteFor } from "../town/siteFor.js";
import type { TownPlan } from "../town/types.js";
import { FULL_SPEED, TOWN_SPEED } from "./tuning.js";

/** What a seed's limit reads: its plan, the anchor's x, and the rectangle of the plan's frame outside which the cover is 0. */
type Reach = { readonly plan: TownPlan; readonly ax: number; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number };

const REACHES = new Map<number, Reach>();

/** The plan, the anchor and the rectangle the cover can be above 0 in for a seed: the blocks' grid and the quay's window, which is not in the grid. Made once. */
function reachOf(seed: number): Reach {
  const hit = REACHES.get(seed);
  if (hit !== undefined) return hit;
  const plan = planFor(seed);
  const { a, b } = plan.quay;
  const r = COVER_HOLD + COVER_FADE;
  let x0 = Math.min(a.x, b.x) - r;
  let z0 = Math.min(a.z, b.z) - r;
  let x1 = Math.max(a.x, b.x) + r;
  let z1 = Math.max(a.z, b.z) + r;
  const grid = coverExtentOf(plan);
  if (grid !== null) {
    x0 = Math.min(x0, grid.x0);
    z0 = Math.min(z0, grid.z0);
    x1 = Math.max(x1, grid.x1);
    z1 = Math.max(z1, grid.z1);
  }
  const made: Reach = { plan, ax: siteFor(seed).anchor.x, x0, z0, x1, z1 };
  REACHES.set(seed, made);
  return made;
}

/** The fastest the car may go at a world point, m/s: `TOWN_SPEED` to `FULL_SPEED`. */
export function speedLimitAt(worldSeed: number, x: number, z: number): number {
  const reach = reachOf(worldSeed);
  const xf = x - reach.ax;
  const zr = z - COVE_Z;
  if (xf < reach.x0 || xf > reach.x1 || zr < reach.z0 || zr > reach.z1) return FULL_SPEED;
  coverInto(reach.plan, xf, zr, false);
  return TOWN_SPEED + (FULL_SPEED - TOWN_SPEED) * (1 - COVER.v);
}
