/**
 * The ground that is not beach: what a working port's back lots and a rural highway's verge paint as.
 *
 * The engine paints sand by height alone (ground under 4 m above the sea is sand and pebble, fading to soil by 9 m), and the
 * town's made ground (2.5 m at the quay), the highway's grade line and the railroad's bench (2 to 7 m along the whole coast) all
 * stand in that band. The place's `shoreStrip` makes the shore's rules read the ground `YARD_LIFT` m higher where its weight is
 * above 0, so the ground paints as soil and grass and not as sand. `clearing.ts` gives the strip to yards, paved blocks and
 * streets; this gives it to the rest of the made ground and to the transport corridor:
 *
 * - **The made ground.** Everywhere the town's cover (`cover.ts`) and its fill hold, claimed by a lot or not, up to the top of
 *   the quay's wall and its bank.
 * - **The corridor.** Along the highway for the whole coast: from the inland edge of the highway's bed (`ROAD_BED_HALF`) out
 *   over `VERGE_INLAND_RAMP` m, seaward across the ground between it and the railroad, to `VERGE_SEA_MARGIN` m seaward of the
 *   railroad's ballast, then falling over `VERGE_SEA_RAMP` m: the transition to the real beach, which a ramp of the weight makes
 *   a few metres wide (the paint reads `h + YARD_LIFT * weight`, and is soil from 9 m: the middle of the ramp does the work).
 *
 * Both are weighted by the ground's own height (`VERGE_H_LO` to `VERGE_H_HI`), so the cove's beach below the quay and its bank
 * and the sea floor under a causeway keep painting as beach and seabed: only ground that is dry land is lifted.
 *
 * What it paints as. Lifted, the ground paints as the grass and forest floor mottle (and the leaf litter where the grass thins),
 * never sand, and the engine's grass, meadow carpet and flowers stand on it by their own rules (the road's and the railroad's
 * clearances keep them off the roadway and the ballast: `railClearing.ts`; the paved ground and buildings are shut by the town's
 * own mask). On top of that the mask here adds rough grass and weeds in irregular patches (`meadow`, thicker where the ground is
 * above the quay's own level) and thins the ground cover into bare soil in other patches (`clutter`), and shuts trees on the new
 * ground. The mask never changes what a yard, block or street already has: it is weighted by one minus the town's own strip.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { valueNoise2 } from "@csarkosh/engine/sim/field";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { elevationAt } from "@csarkosh/engine/sim/terrain";
import type { FeatureMask } from "@csarkosh/engine/sim/features";
import { beyondTown } from "./clearing.js";
import { COVER, coverInto } from "./cover.js";
import { FILL, fillWindowInto, smootherstepInto, STEP } from "./fill.js";
import { planFor } from "./planFor.js";
import { RAIL_BED_HALF, RAIL_OFFSET } from "./rail.js";
import { roadCentreX } from "./roadCentre.js";
import { siteFor } from "./siteFor.js";

/** Version of this stage's arithmetic: raised whenever the weights or the mask here change (it is part of the level id). */
export const VERGE_GEN = 1;
/** The strip's inland edge falls over this many metres from the edge of the highway's bed. */
export const VERGE_INLAND_RAMP = 6;
/** The strip runs this many metres seaward of the railroad's ballast, then falls over `VERGE_SEA_RAMP`. */
export const VERGE_SEA_MARGIN = 6;
export const VERGE_SEA_RAMP = 12;
/** The made ground's strip rises with the town's cover between these. */
export const VERGE_COVER_LO = 0.4;
export const VERGE_COVER_HI = 0.85;
/** Only dry land is lifted: the weight rises with the ground's height between these, metres above the sea. */
export const VERGE_H_LO = 0.8;
export const VERGE_H_HI = 1.6;
/** The heights between which the engine's paint (and ground cover and trees) stop taking the shore's rules into account: what lifting opens is `1 - smoothstep` of these. The engine's `SAND_TOP` and `COAST_FADE_END`. */
export const VERGE_OPEN_LO = 4;
export const VERGE_OPEN_HI = 9;
/** Weeds: wavelengths of the two noises (patches, and the smaller grain), how thick `meadow` is at most, and the noise range it rises over. */
export const VERGE_WAVE_PATCH = 19;
export const VERGE_WAVE_GRAIN = 6;
export const VERGE_MEADOW = 0.9;
export const VERGE_MEADOW_LO = 0.45;
export const VERGE_MEADOW_HI = 0.75;
/** Meadow stands only where the ground is above the quay's own level: from `VERGE_MEADOW_H_LO` to `VERGE_MEADOW_H_HI` metres. */
export const VERGE_MEADOW_H_LO = 2.6;
export const VERGE_MEADOW_H_HI = 4.5;
/** Bare soil: the ground cover is thinned by up to this share in the patches where a noise is under `VERGE_THIN_HI`, fully under `VERGE_THIN_LO`. */
export const VERGE_THIN = 0.7;
export const VERGE_THIN_LO = 0.3;
export const VERGE_THIN_HI = 0.55;
export const VERGE_SALT_PATCH = 0x5a17d;
export const VERGE_SALT_GRAIN = 0x3c2b1;
export const VERGE_SALT_THIN = 0x71e5b;

export const VERGE_TUNABLES: Readonly<Record<string, number>> = {
  VERGE_GEN,
  VERGE_INLAND_RAMP,
  VERGE_SEA_MARGIN,
  VERGE_SEA_RAMP,
  VERGE_COVER_LO,
  VERGE_COVER_HI,
  VERGE_H_LO,
  VERGE_H_HI,
  VERGE_OPEN_LO,
  VERGE_OPEN_HI,
  VERGE_WAVE_PATCH,
  VERGE_WAVE_GRAIN,
  VERGE_MEADOW,
  VERGE_MEADOW_LO,
  VERGE_MEADOW_HI,
  VERGE_MEADOW_H_LO,
  VERGE_MEADOW_H_HI,
  VERGE_THIN,
  VERGE_THIN_LO,
  VERGE_THIN_HI,
  VERGE_SALT_PATCH,
  VERGE_SALT_GRAIN,
  VERGE_SALT_THIN,
};

/** The corridor's seaward edge: the offset from the highway's centre where the strip begins to fall, negative seaward. */
const SEA_EDGE = -(RAIL_OFFSET + RAIL_BED_HALF + VERGE_SEA_MARGIN);

/** `smoothstep` as the paint has it (cubic), by `+ - * /` and `min`/`max`. */
function smooth(lo: number, hi: number, x: number): number {
  const t = x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** The weight of the transport corridor at a point, from its offset from the highway's centre alone: 0 to 1, with no regard for the ground's height. */
export function corridorWeight(seed: number, x: number, z: number): number {
  const u = x - roadCentreX(seed, z);
  if (u >= ROAD_BED_HALF + VERGE_INLAND_RAMP || u <= SEA_EDGE - VERGE_SEA_RAMP) return 0;
  let w = 1;
  if (u > ROAD_BED_HALF) {
    smootherstepInto(ROAD_BED_HALF, ROAD_BED_HALF + VERGE_INLAND_RAMP, u);
    w = 1 - STEP.v;
  } else if (u < SEA_EDGE) {
    smootherstepInto(SEA_EDGE - VERGE_SEA_RAMP, SEA_EDGE, u);
    w = STEP.v;
  }
  return w;
}

/** The weight of the town's made ground at a point: its cover and its fill, 0 to 1, with no regard for the ground's height. 0 beyond the town's reach (`beyondTown`), where the cover and the fill are 0 and `madeWeightFull` says 0. */
export function madeWeight(seed: number, x: number, z: number): number {
  if (beyondTown(seed, x, z)) return 0;
  return madeWeightFull(seed, x, z);
}

/** `madeWeight` with no early answer: the cover and the fill asked at every point. */
export function madeWeightFull(seed: number, x: number, z: number): number {
  const plan = planFor(seed);
  const xf = x - siteFor(seed).anchor.x;
  const zr = z - COVE_Z;
  coverInto(plan, xf, zr, false);
  let c = COVER.v;
  if (plan.fill.length > 0) {
    fillWindowInto(plan.fill, xf, zr);
    c = 1 - (1 - c) * (1 - FILL.v);
  }
  if (c <= VERGE_COVER_LO) return 0;
  smootherstepInto(VERGE_COVER_LO, VERGE_COVER_HI, c);
  return STEP.v;
}

/** How far a place is out of the strip's reach by where it stands: the weight of the made ground or the corridor, whichever is more, before the ground's height is asked. */
export function vergeLateral(seed: number, x: number, z: number): number {
  const c = corridorWeight(seed, x, z);
  if (c === 1) return 1;
  const m = madeWeight(seed, x, z);
  return m > c ? m : c;
}

/** `vergeLateral` with the made ground's weight asked in full everywhere. */
export function vergeLateralFull(seed: number, x: number, z: number): number {
  const c = corridorWeight(seed, x, z);
  if (c === 1) return 1;
  const m = madeWeightFull(seed, x, z);
  return m > c ? m : c;
}

/** The share of the lateral weight that stands: 1 on dry land, 0 on the beach below the quay's bank and under the sea. */
export function dryLand(h: number): number {
  return smooth(VERGE_H_LO, VERGE_H_HI, h);
}

/**
 * The strip the corridor and the made ground add, 0 to 1, at a ground of height `h` (the ground's own: the caller that does not hold
 * it asks `vergeWeight`). Reads the ground cover's and the paint's own threshold: only a ground that the shore's rules would
 * otherwise read as beach is changed by it, but the weight is the weight, whatever the height above.
 */
export function vergeWeightAt(seed: number, x: number, z: number, h: number): number {
  const lateral = vergeLateral(seed, x, z);
  return lateral === 0 ? 0 : lateral * dryLand(h);
}

/** `vergeWeightAt` with the made ground's weight asked in full everywhere. */
export function vergeWeightAtFull(seed: number, x: number, z: number, h: number): number {
  const lateral = vergeLateralFull(seed, x, z);
  return lateral === 0 ? 0 : lateral * dryLand(h);
}

/** `vergeWeightAt`, with the ground's height read from the world (the shore strip hook is not handed it). Nothing is read where the lateral weight is 0. */
export function vergeWeight(seed: number, x: number, z: number): number {
  const lateral = vergeLateral(seed, x, z);
  if (lateral === 0) return 0;
  return lateral * dryLand(elevationAt(seed, x, z));
}

/** `vergeWeight` with the made ground's weight asked in full everywhere. */
export function vergeWeightFull(seed: number, x: number, z: number): number {
  const lateral = vergeLateralFull(seed, x, z);
  if (lateral === 0) return 0;
  return lateral * dryLand(elevationAt(seed, x, z));
}

/** How much of a strip weight `w` at height `h` is new ground to the shore's rules: what lifting it opens, the share of the paint's sand band that it takes away. */
export function opened(w: number, h: number): number {
  return w * (1 - smooth(VERGE_OPEN_LO, VERGE_OPEN_HI, h));
}

/**
 * The feature mask `mask` with the verge's weeds and bare patches and no trees on the new ground, where the town's own strip `own` (a
 * yard, a block, a street: `townStripWeight`) is not already there. `w` is the verge's weight at the place (`vergeWeightAt`, asked
 * first so that the town's own is read only where it matters). `mask` itself where the verge has no say.
 */
export function vergeMask(seed: number, x: number, z: number, h: number, w: number, own: number, mask: FeatureMask): FeatureMask {
  if (w === 0) return mask;
  const a = opened(w, h) * (1 - own);
  if (a === 0) return mask;
  const patch = valueNoise2(x / VERGE_WAVE_PATCH, z / VERGE_WAVE_PATCH, seed ^ VERGE_SALT_PATCH);
  const grain = valueNoise2(x / VERGE_WAVE_GRAIN, z / VERGE_WAVE_GRAIN, seed ^ VERGE_SALT_GRAIN);
  const thin = valueNoise2(x / VERGE_WAVE_PATCH, z / VERGE_WAVE_PATCH, seed ^ VERGE_SALT_THIN);
  // Rough grass and weeds where both noises say so, and only above the quay's level: irregular, never a lawn.
  const weeds = smooth(VERGE_MEADOW_LO, VERGE_MEADOW_HI, 0.5 * patch + 0.5 * grain) * smooth(VERGE_MEADOW_H_LO, VERGE_MEADOW_H_HI, h);
  // Bare soil where the thinning noise is low.
  const bare = 1 - smooth(VERGE_THIN_LO, VERGE_THIN_HI, thin);
  const clutter = mask.clutter * (1 - a * VERGE_THIN * bare);
  // The weeds stand only where the ground cover is open (a shut mask stays shut: the ballast, the roadway, a building).
  const open = mask.clutter < 1 ? mask.clutter : 1;
  const meadow = mask.meadow + VERGE_MEADOW * weeds * a * open * (1 - mask.meadow);
  const out = { tree: mask.tree * (1 - a), clutter, meadow: meadow < 1 ? meadow : 1, bare: mask.bare };
  return mask.loose === undefined ? out : { ...out, loose: mask.loose };
}
