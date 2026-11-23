/**
 * Where the railroad's main line meets the sea, for the whole coast, as a pure function of the world's seed.
 *
 * The line runs beside the highway at the highway's grade line (`railGround.ts`), and the highway comes near the shore
 * in places, so now and then the ground the line would stand on is under the sea. A run of such ground is a SPAN: a
 * low `causeway` (the bed as fill, drawn with riprap on its sides) where it is short and shallow, and a `trestle` (the
 * ground left as it is, the track carried on a deck on piles) where the water is deeper than `TRESTLE_DEPTH` or the gap
 * longer than `TRESTLE_LENGTH`.
 *
 * The spans are found by scanning the ground at the line's centre every `STEP` metres, in chunks of `CHUNK` metres,
 * each made once and kept (a lookup of the sea's gaps, so a sample of the terrain does not scan the coast). A wet
 * point is one whose ground, as the engine would leave it with no railroad laid, is under `WET_LEVEL`; wet points
 * less than `MERGE_GAP` metres apart are one span, and a span's extent is the same whichever chunk finds it.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only, and the caches are only lookups.
 */
import { coastGround, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { corridorD } from "@csarkosh/engine/sim/road";
import { smootherstepD } from "./fill.js";
import { townGroundD } from "./ground.js";
import { railCenterX } from "./rail.js";

/** The ground under this height (metres over the sea) at the line's centre is wet: the waves reach it. */
export const WET_LEVEL = 0.4;
/** The scan's step along z, metres. */
export const SPAN_STEP = 4;
/** Wet points this near each other are one span, metres. */
export const MERGE_GAP = 24;
/** A span whose water is deeper than this, metres, is carried on a trestle. */
export const TRESTLE_DEPTH = 2.5;
/** A span longer than this, metres, is carried on a trestle. */
export const TRESTLE_LENGTH = 60;
/** The trestle stands on the sea's ground over this many metres beyond the span each side, and the bed fades into it over the same. */
export const TRESTLE_RAMP = 10;
/** A chunk of the table, metres of z. */
export const SPAN_CHUNK = 256;
/** The scan goes no farther than this many steps either way from a wet point. */
const SCAN_LIMIT = 600;

export const SPAN_TUNABLES: Readonly<Record<string, number>> = {
  WET_LEVEL,
  SPAN_STEP,
  MERGE_GAP,
  TRESTLE_DEPTH,
  TRESTLE_LENGTH,
  TRESTLE_RAMP,
  SPAN_CHUNK,
};

export type RailSpan = {
  readonly kind: "causeway" | "trestle";
  /** The run of wet ground along z, `a` < `b`. */
  readonly a: number;
  readonly b: number;
  /** The deepest the sea stands over the line's ground in it, metres (0 where it is only wet). */
  readonly depth: number;
};

/** The ground at the line's centre as the engine leaves it with no railroad laid: the coast's, the town's, the highway's own corridor over them. */
export function groundWithoutRail(seed: number, x: number, z: number): { h: number; dx: number; dz: number } {
  const c = coastGround(seed, x, z);
  const staged = townGroundD(seed, x, z, c.u, c.uDz, c.ground);
  return corridorD(c.u, c.uDz, roadGradeAt(seed, z), staged);
}

/** The ground's height at the line's centre at a z, with no railroad laid. */
export function lineGroundAt(seed: number, z: number): number {
  return groundWithoutRail(seed, railCenterX(seed, z), z).h;
}

type Chunk = readonly RailSpan[];
const CHUNKS = new Map<number, Map<number, Chunk>>();
let lastSeed = NaN;
let lastChunks: Map<number, Chunk> | null = null;

/** The spans that touch the chunk `c` of a seed's table, made once. */
function chunkOf(seed: number, c: number): Chunk {
  let table: Map<number, Chunk>;
  if (seed === lastSeed && lastChunks !== null) table = lastChunks;
  else {
    let t = CHUNKS.get(seed);
    if (t === undefined) {
      t = new Map();
      CHUNKS.set(seed, t);
    }
    table = t;
    lastSeed = seed;
    lastChunks = t;
  }
  let hit = table.get(c);
  if (hit === undefined) {
    hit = buildChunk(seed, c);
    table.set(c, hit);
  }
  return hit;
}

/** The ground's height at the scan point `k`. */
function pointH(seed: number, k: number): number {
  return lineGroundAt(seed, k * SPAN_STEP);
}

function buildChunk(seed: number, c: number): Chunk {
  const k0 = Math.floor((c * SPAN_CHUNK) / SPAN_STEP);
  const k1 = Math.floor(((c + 1) * SPAN_CHUNK) / SPAN_STEP) - 1;
  const gap = Math.floor(MERGE_GAP / SPAN_STEP);
  const spans: RailSpan[] = [];
  let doneTo = k0 - 1;
  for (let k = k0; k <= k1; k++) {
    if (k <= doneTo) continue;
    if (!(pointH(seed, k) < WET_LEVEL)) continue;
    // Out from a wet point, to the last wet point of the chain either way.
    let lo = k;
    let dry = 0;
    let lowest = pointH(seed, k);
    for (let j = k - 1; j > k - SCAN_LIMIT && dry < gap; j--) {
      const h = pointH(seed, j);
      if (h < WET_LEVEL) {
        lo = j;
        dry = 0;
        if (h < lowest) lowest = h;
      } else dry++;
    }
    let hi = k;
    dry = 0;
    for (let j = k + 1; j < k + SCAN_LIMIT && dry < gap; j++) {
      const h = pointH(seed, j);
      if (h < WET_LEVEL) {
        hi = j;
        dry = 0;
        if (h < lowest) lowest = h;
      } else dry++;
    }
    doneTo = hi;
    const a = lo * SPAN_STEP;
    const b = (hi + 1) * SPAN_STEP;
    const depth = Math.max(0, -lowest);
    const kind = depth > TRESTLE_DEPTH || b - a > TRESTLE_LENGTH ? "trestle" : "causeway";
    spans.push({ kind, a, b, depth });
  }
  return spans;
}

/** The spans that touch the interval [z0, z1] of a seed's coast, in order of z. */
export function railSpansIn(seed: number, z0: number, z1: number): readonly RailSpan[] {
  const out: RailSpan[] = [];
  // A span found from the chunk it begins in reaches into later chunks: look one chunk of scan limit behind.
  const c0 = Math.floor(z0 / SPAN_CHUNK) - 1;
  const c1 = Math.floor(z1 / SPAN_CHUNK);
  let last = -Infinity;
  for (let c = c0; c <= c1; c++) {
    for (const s of chunkOf(seed, c)) {
      if (s.b < z0 || s.a > z1 || s.a <= last) continue;
      last = s.a;
      out.push(s);
    }
  }
  return out;
}

/** The spans of one chunk, for a lookup that needs no more. */
function spansNear(seed: number, z: number, reach: number): readonly RailSpan[] {
  return railSpansIn(seed, z - reach, z + reach);
}

/**
 * How much of the bed the trestle takes away at a z: 1 on a trestle's span, falling to 0 over `TRESTLE_RAMP` metres at either end
 * (the bed fading into the sea's ground), with its slope in z. A causeway takes none away.
 */
export function trestleWeightAt(seed: number, z: number): { v: number; dz: number } {
  let v = 0;
  let dz = 0;
  for (const s of spansNear(seed, z, TRESTLE_RAMP)) {
    if (s.kind !== "trestle") continue;
    const rise = smootherstepD(s.a - TRESTLE_RAMP, s.a, z);
    const fall = smootherstepD(s.b, s.b + TRESTLE_RAMP, z);
    const w = rise.v * (1 - fall.v);
    if (w > v) {
      v = w;
      dz = rise.d * (1 - fall.v) - rise.v * fall.d;
    }
  }
  return { v, dz };
}
