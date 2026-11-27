/**
 * The highway outside the town's strip, as cells along the road (`highwayParts.ts` streams them as the rail's are): a cell is `HIGHWAY_CELL` m of the road,
 * the plain function of the world's seed, its index and a level of detail, so any machine builds the same one in any order, whenever the camera comes near.
 * The paving is `highwayLook.ts`'s, the same that the strip in town is laid with: stretches with their own frames and tones, the cross-section with its
 * ragged edge and gravel shoulders, the wear, the white edge lines and the dashed yellow centre line.
 *
 * - **Levels.** 0 (near): rows every 2 m (the bed's own tiles) and all the wear. 1 (far): rows every 8 m and the large patches alone.
 * - **No road twice.** What lies in the town's strip (between its two end lines) is the strip's, and a cell leaves it out: each polygon is cut to what lies
 *   before the strip's start or after its end, and the soft bands of the wheel tracks are laid only where all of them do. Where the town's spur crosses the
 *   highway's bed its ground is left out, as the strip leaves it.
 * - **Anywhere.** The engine's road is endless, and a cell is built at any z, with no plan to read beyond the strip's own two ends.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { sliceDue, type Slices } from "@csarkosh/engine/game/syncJobs";
import { streetLiftD } from "../../sim/town/streetField.js";
import { highwayStrip, spurGround, type StripEnd } from "./highwayGeometry.js";
import { SLOT, envParts, highwayKey, layDashes, layFeatures, layRows, type HighwayEnv } from "./highwayLook.js";
import { MeshBuilder, type MeshArrays } from "./meshBuilder.js";
import { Surface, clipLine, shareArea, subtractConvex, type P2 } from "./surface.js";
import { townGround } from "./townGeometry.js";
import type { TownGround } from "./townTypes.js";

/** The length of a cell along z, metres: a multiple of `SLOT`. */
export const HIGHWAY_CELL = 128;
export type HighwayLod = 0 | 1;
/** The rows' length at each level of detail, metres. */
export const ROW_STEP: Readonly<Record<HighwayLod, number>> = { 0: 2, 1: 8 };

/** What a cell is built from, for a world seed. */
export type HighwayWorld = {
  readonly seed: number;
  readonly key: number;
  readonly ground: TownGround;
  /** The town's strip: its two ends, or null where no street meets the highway. */
  readonly start: StripEnd | null;
  readonly end: StripEnd | null;
  /** Where the asphalt is the bed's whole width: the strip and the slivers beside its slanted ends. */
  readonly full: readonly [number, number] | null;
  /** The z range wholly inside the strip (nothing of a cell lying in it is drawn). */
  readonly inner: readonly [number, number] | null;
  /** The spur's ground where it comes within the bed. */
  readonly spur: readonly (readonly P2[])[];
};

const WORLDS = new Map<number, HighwayWorld>();

/** The highway's world for a seed, made once. */
export function highwayWorld(seed: number): HighwayWorld {
  let w = WORLDS.get(seed);
  if (w === undefined) {
    const ground = townGround(seed);
    const strip = highwayStrip(ground);
    const zs = (e: StripEnd): [number, number] => [Math.min(e.left[1], e.right[1]), Math.max(e.left[1], e.right[1])];
    w = {
      seed,
      key: highwayKey(seed),
      ground,
      start: strip === null ? null : strip.start,
      end: strip === null ? null : strip.end,
      full: strip === null ? null : [zs(strip.start)[0], zs(strip.end)[1]],
      inner: strip === null ? null : [zs(strip.start)[1], zs(strip.end)[0]],
      spur: spurGround(ground),
    };
    WORLDS.set(seed, w);
  }
  return w;
}

/** Whether a cell lies wholly inside the town's strip (and so has nothing to draw). */
export function cellInStrip(w: HighwayWorld, k: number): boolean {
  return w.inner !== null && k * HIGHWAY_CELL >= w.inner[0] && (k + 1) * HIGHWAY_CELL <= w.inner[1];
}

/** The cell that z falls in. */
export const cellOf = (z: number): number => Math.floor(z / HIGHWAY_CELL);

/** A cell's geometry at a level of detail, in slices for the scheduler (run at once, it is the same arrays); null where it has nothing to draw. */
export function* highwayCellSlices(w: HighwayWorld, k: number, lod: HighwayLod): Slices<MeshArrays | null> {
  if (cellInStrip(w, k)) return null;
  const z0 = k * HIGHWAY_CELL;
  const z1 = z0 + HIGHWAY_CELL;
  const seed = w.seed;
  const builder = new MeshBuilder();
  // The ground and the centre line, remembered for this cell alone (a point read to the millimetre is read once, and nothing outlives the build).
  const heights = new Map<number, number>();
  const totals = new Map<number, number>();
  const centres = new Map<number, number>();
  const centre = (z: number): number => {
    let x = centres.get(z);
    if (x === undefined) {
      x = roadCenterX(seed, z);
      centres.set(z, x);
    }
    return x;
  };
  // The engine's ground is exactly level across the bed (its height there is the grade line's, with no slope across), so the height of a point of the bed is
  // read once for its z, on the centre line. The trough the streets cut (`streetLiftD`, nothing but at the town's streets) is read at the point itself.
  const heightAt = (x: number, z: number): number => {
    const at = Math.round(x * 1000) * 4000003 + Math.round(z * 1000);
    let h = totals.get(at);
    if (h !== undefined) return h;
    const onBed = Math.abs(x - centre(z)) <= ROAD_BED_HALF + 1e-6;
    const key = Math.round(z * 1000);
    let e = onBed ? heights.get(key) : undefined;
    if (e === undefined) {
      e = onBed ? elevationSampleAt(seed, centre(z), z).h : elevationSampleAt(seed, x, z).h;
      if (onBed) heights.set(key, e);
    }
    h = e + streetLiftD(seed, x, z).v;
    totals.set(at, h);
    return h;
  };
  const g: TownGround = { ...w.ground, heightAt, roadX: centre };
  const surf = new Surface(g, () => builder);
  const { start, end, inner } = w;

  /** The side of the strip's start line a point lies on (negative: before it), and of its end line (positive: after it). */
  const beforeStart = (p: P2): boolean => start !== null && (p[0] - start.x) * start.tx + (p[1] - start.z) * start.tz < 0;
  const afterEnd = (p: P2): boolean => end !== null && (p[0] - end.x) * end.tx + (p[1] - end.z) * end.tz > 0;
  const sMin = start === null ? 0 : Math.min(start.left[1], start.right[1]);
  const sMax = start === null ? 0 : Math.max(start.left[1], start.right[1]);
  const eMin = end === null ? 0 : Math.min(end.left[1], end.right[1]);
  const eMax = end === null ? 0 : Math.max(end.left[1], end.right[1]);
  const region = (poly: readonly P2[]): P2[][] => {
    let pieces: P2[][];
    if (start === null || end === null || inner === null) pieces = [poly.slice()];
    else {
      let zLo = Infinity;
      let zHi = -Infinity;
      for (const q of poly) {
        if (q[1] < zLo) zLo = q[1];
        if (q[1] > zHi) zHi = q[1];
      }
      if (zHi <= sMin || zLo >= eMax) pieces = [poly.slice()];
      else if (zLo >= sMax && zHi <= eMin) return [];
      else {
        // Across an end line: what lies before the start line and what lies after the end line.
        pieces = [];
        const a = clipLine(poly, [start.x, start.z], [start.x + start.tz, start.z - start.tx], false);
        if (a.length >= 3) pieces.push(a);
        const b = clipLine(poly, [end.x, end.z], [end.x + end.tz, end.z - end.tx], true);
        if (b.length >= 3) pieces.push(b);
      }
    }
    // The spur's ground is left to the spur.
    for (const q of w.spur) pieces = pieces.flatMap((r) => (shareArea(r, q, 1e-4) ? subtractConvex(r, q) : [r]));
    return pieces;
  };
  const accepts = (pts: readonly P2[]): boolean => pts.every((p) => (start === null && end === null) || beforeStart(p) || afterEnd(p));

  const near = w.full !== null && z0 < w.full[1] + 160 && z1 > w.full[0] - 160;
  const env: HighwayEnv = { seed, key: w.key, near, height: heightAt, full: w.full, manholes: false, marks: true, centre, stretches: new Map(), memo: { last: null, frames: new Map() }, ...envParts(surf, region, accepts) };
  layRows(env, z0, z1, ROW_STEP[lod]);
  layDashes(env, z0, z1);
  if (sliceDue()) yield;
  for (let S = z0 / SLOT; S < z1 / SLOT; S++) {
    layFeatures(env, S, lod);
    if (sliceDue()) yield;
  }
  return builder.vertices > 0 ? builder.take() : null;
}

/** A cell's arrays, built at once. */
export function highwayCell(w: HighwayWorld, k: number, lod: HighwayLod): MeshArrays | null {
  const it = highwayCellSlices(w, k, lod);
  for (;;) {
    const r = it.next();
    if (r.done === true) return r.value;
  }
}

