/**
 * The town's site, read off the coast for a seed: where the highway runs and where the sea
 * meets the coast's own ground along the stretch of shore the town stands on, sampled along z
 * in the town's frame (see `site.ts`). The coast's own ground is the coast as it is without a
 * town laid over it, through its cove (`coastGround`), so the site does not move when the
 * town's ground is laid.
 *
 * Everything here is the simulation's arithmetic: the shore is found by a scan and then a fixed
 * number of bisection steps, so every machine finds the same bits.
 */
import { SEA_LEVEL, COVE_Z, coastGround, roadCenterX } from "@csarkosh/engine/sim/olympic";
import type { TownSite } from "./site.js";

/** The spacing of the site's samples along z, metres. */
export const SITE_STEP = 16;
/** How far the samples reach south and north of the anchor, metres. */
export const SITE_HALF = 512;
/** The number of samples: one at the anchor and one each step either side of it. */
export const SITE_SAMPLES = (2 * SITE_HALF) / SITE_STEP + 1;
/** How far inland of the highway the made ground reaches, metres. */
export const SITE_INLAND = 320;
/** The seaward scan from the highway for the first ground at or under the sea, metres at a step, and how far. */
export const SHORE_SCAN_STEP = 4;
export const SHORE_SCAN_REACH = 400;
/** The bisection's steps after the scan: a fixed number, so the shore is the same bits on every machine. */
export const SHORE_BISECT_STEPS = 30;
/** What says "town 1" in the town's seed, and the mixer that spreads the world's seed through it. */
export const TOWN_ONE = 0x70771001;
export const TOWN_SEED_MIX = 0x9e3779b1;

/** The town's own seed for a world's: the world's, mixed with which town this is. */
export function townSeedOf(worldSeed: number): number {
  const mixed = Math.imul((worldSeed | 0) ^ TOWN_ONE, TOWN_SEED_MIX);
  return (mixed ^ (mixed >>> 15)) | 0;
}

/**
 * The x at which the coast's own ground meets the sea at `z`, searched seaward of `fromX` (a point
 * on dry ground, the highway's): the first ground at or under the sea going seaward, then bisected.
 * Where a headland stands there it is the headland's tip, where the cove opens it is the cove's shore.
 */
function shoreAt(seed: number, fromX: number, z: number): number {
  let land = fromX;
  let sea = fromX - SHORE_SCAN_REACH;
  for (let k = 1; k * SHORE_SCAN_STEP <= SHORE_SCAN_REACH; k++) {
    const x = fromX - k * SHORE_SCAN_STEP;
    if (coastGround(seed, x, z).ground.h <= SEA_LEVEL) {
      sea = x;
      break;
    }
    land = x;
  }
  for (let i = 0; i < SHORE_BISECT_STEPS; i++) {
    const mid = (land + sea) / 2;
    if (coastGround(seed, mid, z).ground.h > SEA_LEVEL) land = mid;
    else sea = mid;
  }
  return (land + sea) / 2;
}

/** The town's site for a world's seed, read off the coast now: what `siteFor` caches. */
export function readSite(worldSeed: number): TownSite {
  const anchor = { x: roadCenterX(worldSeed, COVE_Z), z: COVE_Z };
  const z0 = -SITE_HALF;
  const shoreX: number[] = [];
  const roadX: number[] = [];
  for (let i = 0; i < SITE_SAMPLES; i++) {
    const z = anchor.z + z0 + i * SITE_STEP;
    const road = roadCenterX(worldSeed, z);
    roadX.push(road - anchor.x);
    shoreX.push(shoreAt(worldSeed, road, z) - anchor.x);
  }
  return { seed: townSeedOf(worldSeed), anchor, step: SITE_STEP, z0, shoreX, roadX, inland: SITE_INLAND };
}

const SITES = new Map<number, TownSite>();

/** The town's site for a world's seed. A pure function of it, cached. */
export function siteFor(worldSeed: number): TownSite {
  let site = SITES.get(worldSeed);
  if (site === undefined) {
    site = readSite(worldSeed);
    SITES.set(worldSeed, site);
  }
  return site;
}
