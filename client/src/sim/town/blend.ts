/**
 * The coast's climb to the massif, drawn out behind the town, and drawn out differently in every world. On the coast's
 * own the climb ends 40 to 500 m inland of the shore (`BLEND_END_HEADLAND`, `BLEND_END_BAY`), so the ground behind the
 * highway rises tens of metres in the town's first hundred and sixty. Inside a window along the shore the climb is
 * drawn out to end `end` metres inland (the engine's own hook for it, `CoastOverlay.blend`), and what makes a town
 * different from the next one's is how far: a world's seed draws
 *
 * - **how far inland the climb ends** (`BAY_END_MIN` to `BAY_END_MAX`, the middle likeliest): near the least the mountain
 *   stands close behind the highway and the land is a narrow shelf, near the most there is a broad low plain;
 * - **how long a stretch of coast it is drawn out over** (the window's half length, `BAY_HALF_MIN` to `BAY_HALF_MAX`);
 * - **where along the coast that stretch is centred** relative to the cove (`BAY_CENTRE_MAX` either way, the middle
 *   likeliest): a bay that opens north of the cove, or south of it, or sits square on it.
 *
 * Outside the window the ground is the coast's own. The highway does not move with the climb, but its grade line,
 * which follows the ground, comes down with the foot of the hill. Nothing here reads the plan: the plan reads the
 * ground this makes (through the site), so the town is where the land is.
 */
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { hashSeed, next, type Rng } from "./rng.js";

/** How far inland of the shore the climb may end in a world's bay, metres: a narrow shelf under the mountain to a broad low plain. */
export const BAY_END_MIN = 800;
export const BAY_END_MAX = 2400;
/** The window's half length along the coast, and how far its centre may stand north or south of the cove, metres. */
export const BAY_HALF_MIN = 450;
export const BAY_HALF_MAX = 1100;
export const BAY_CENTRE_MAX = 600;
/** The window's fall from 1 to 0 beyond its half length, metres. */
export const BAY_FADE = 240;
/** The seed's own tag for these draws, so another stage's draws never move them. */
export const BAY_TAG = 0x62617965;

export const TOWN_BLEND_TUNABLES: Readonly<Record<string, number>> = { BAY_END_MIN, BAY_END_MAX, BAY_HALF_MIN, BAY_HALF_MAX, BAY_CENTRE_MAX, BAY_FADE, BAY_TAG };

/** One world's bay: where the climb ends, and the stretch of coast it is drawn out over. */
export type Bay = {
  /** How far inland of the shore the climb ends, metres. */
  readonly end: number;
  /** The window's half length along the coast, metres. */
  readonly half: number;
  /** The z of the window's centre, relative to the cove: positive is north of it. */
  readonly centre: number;
};

const BAYS = new Map<number, Bay>();

/** A world seed's bay, drawn once. The middle of a range is likeliest (the mean of two draws). */
export function bayOf(worldSeed: number): Bay {
  let bay = BAYS.get(worldSeed);
  if (bay === undefined) {
    const r: Rng = { state: hashSeed(worldSeed, BAY_TAG) };
    const end = BAY_END_MIN + (BAY_END_MAX - BAY_END_MIN) * ((next(r) + next(r)) / 2);
    const half = BAY_HALF_MIN + (BAY_HALF_MAX - BAY_HALF_MIN) * next(r);
    const centre = BAY_CENTRE_MAX * (next(r) + next(r) - 1);
    bay = { end, half, centre };
    BAYS.set(worldSeed, bay);
  }
  return bay;
}

/** How far inland the climb ends in a world's bay (the engine's `blend.end`, given the seed). */
export function townBlendEnd(worldSeed: number): number {
  return bayOf(worldSeed).end;
}

/** The window's weight at `z` for a world, and its slope: a quintic fade, flat (so with no kink) inside. */
export function townBlendWindowD(z: number, worldSeed: number): { v: number; dz: number } {
  const bay = bayOf(worldSeed);
  const off = z - COVE_Z - bay.centre;
  const az = off < 0 ? -off : off;
  const edge0 = bay.half;
  const edge1 = bay.half + BAY_FADE;
  if (az <= edge0) return { v: 1, dz: 0 };
  if (az >= edge1) return { v: 0, dz: 0 };
  const t = (az - edge0) / (edge1 - edge0);
  const v = t * t * t * (t * (t * 6 - 15) + 10);
  const d = (30 * t * t * (t - 1) * (t - 1)) / (edge1 - edge0);
  return { v: 1 - v, dz: -d * (off < 0 ? -1 : 1) };
}
