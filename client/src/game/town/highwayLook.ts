/**
 * How the highway looks, in town and out: the one description of its paving that the town's strip (`highwayGeometry.ts`) and the cells that stream
 * along the rest of the road (`highwayCells.ts`) both draw from, so that the road is the same road on either side of the strip's end.
 *
 * Everything here is a pure function of the world's seed and a place along the road (a z), drawn from streams of its own (`hashN` of the highway's
 * key and the thing's index), so a cell built, let go and built again is the same, two machines see the same road, and nothing of the plan is read.
 *
 * - **Stretches.** The road is paved in stretches of 40 to 70 m (`stretchAt`): a boundary every 55 m, moved by up to 6.5 m and set on the 2 m grid
 *   of the bed's tiles. Each stretch has its own asphalt layer, tone, age and wear, and a texture frame of its own turned to the road's direction at
 *   its middle, so the grain and the cracks run along the road wherever it bends. A seam crosses the road where one stretch meets the next.
 * - **The cross-section.** The asphalt is the bed's whole width (`ROAD_BED_HALF`) in the town's strip and 7 m (`RURAL_HALF`, as wide as the engine
 *   paints) elsewhere, narrowing between them over `TAPER` m past the strip's end; where it is narrow its edge is ragged and gravel shoulders reach
 *   the bed's edge. The asphalt is laid in three bands across so that the dirt and wear gather toward the edges, as on a street.
 * - **Wear** (`layFeatures`), by slots of `SLOT` m: patches (a lane resurfaced, an old repair, a trench along and across), utility cuts with sealed
 *   seams, sealed cracks, potholes, standing water, wheel tracks and oil in both lanes, the edge's spill of mud, stains of oil, and (in town only)
 *   manholes. A feature lies wholly in its slot and a slot lies wholly in one cell, so no feature is cut by a cell's edge and none lies over another
 *   cell's. There are no drains (the road has no curb) and, out of town, no manholes.
 * - **Markings** (`layRow`, `layDashes`): out of town a white edge line just inside each edge of the asphalt and a single yellow centre line, dashed
 *   3 m on in every 12 m, in the worn paint of the town's streets.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { clamp01, hashN, hashS, smooth, vnoise } from "./groundNoise.js";
import { RANK, withOver, type Over } from "./groundSurfaces.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";
import { GRAVEL, PAINT_WHITE, PAINT_YELLOW, PATCH_ASPHALT, ASPHALT } from "./palette.js";
import { LINE_WIDTH, MARK_OVER, ROADWAY_LIFT, asphaltOf } from "./streetGeometry.js";
import { triangulate, type P2, type Surface } from "./surface.js";
import { SEA } from "./townTypes.js";
import { streetLiftD } from "../../sim/town/streetField.js";
import type { UvFrame } from "./townSurface.js";
import type { Paving } from "../../sim/town/types.js";

/** The asphalt's half width out of the town: as wide as the engine paints (|u| under 3.5 m), metres. */
export const RURAL_HALF = 3.5;
/** The length over which the asphalt narrows from the bed's width to `RURAL_HALF` past the strip's end, metres. */
export const TAPER = 10;
/** The white edge line's offset from the centre line out of town (just inside the asphalt's edge), and in the strip (`LANE_HALF`), metres. */
export const RURAL_EDGE_LINE = 3.1;
const STRIP_EDGE_LINE = 3.5;
/** The centre line's dashes out of town: on for this long in every `DASH_PERIOD` m, as the engine paints them. */
export const DASH_ON = 3;
export const DASH_PERIOD = 12;
/** A feature's slot along z, metres: a divisor of the cell (`highwayCells.ts`) so that no slot lies in two cells. */
export const SLOT = 32;
/** The mean length of a stretch of paving and how far its ends are moved, metres. */
export const STRETCH = 55;
const STRETCH_JITTER = 6.5;
/** How much the highway is driven (as a street's `use`, 0 to 1): the wheels' polish and the dirt at the edge follow it. */
const USE = 0.65;
/** The depth rank of the wheel tracks (as `roadTone.ts`). */
const TRACK_RANK = 1.5;
/** The flat colour under a pale mark (its texture is the asphalt lightened). */
const PALE: Rgb = [0.19, 0.19, 0.2];

const CUT = 0.003;
const SEAM_LIFT = 0.0045;
const SEAM_HALF = 0.025;

/** The road's frame at a z: its centre (x, z) and its direction (tx, tz, with tz positive). */
export type F = { readonly x: number; readonly z: number; readonly tx: number; readonly tz: number };

/** What the paving is drawn into, and where: the town's strip and the stream's cells give their own. */
export type HighwayEnv = {
  /** The world's seed, and the highway's hashing key made of it. */
  readonly seed: number;
  readonly key: number;
  /** Whether the road lies near the town's streets, whose troughs reach into the bed (`streetField.ts`): the paving follows the walked ground across it, and the wear keeps off the troughs. */
  readonly near: boolean;
  /** The walked ground's height at a point (the engine's plus the streets' trough). */
  height(x: number, z: number): number;
  /** Where the asphalt is the bed's whole width: from this z to that (the strip and the slivers beside its slanted ends); null where the road is rural all along. */
  readonly full: readonly [number, number] | null;
  /** Whether the manholes are laid (in town only). */
  readonly manholes: boolean;
  /** Whether the edge lines are laid by the rows (the town lays its own marks). */
  readonly marks: boolean;
  /** The x of the centre line at a z. */
  centre(z: number): number;
  /** Lays a polygon of the ground (any simple outline, cut to this builder's region); the surface of `colour` with `over` laid on it. */
  pave(poly: readonly P2[], lift: number, colour: Rgb, over: Over): void;
  /** Lays a soft band whose corners carry their own colours, as a whole if it lies in this builder's region, else not at all. */
  soft(pts: readonly P2[], lift: number, colours: readonly Rgb[], over: Over, rank: number): void;
  /** The stretches made so far, and the last asked for, and the road's frames at the zs asked for (the caches the env keeps). */
  readonly stretches: Map<number, Stretch>;
  readonly memo: { last: Stretch | null; frames: Map<number, F> };
};

export type Stretch = {
  readonly i: number;
  readonly z0: number;
  readonly z1: number;
  readonly key: number;
  readonly wear: number;
  readonly decade: number;
  readonly layer: "asphalt" | "asphalt_dark";
  readonly tint: Rgb;
  readonly frame: UvFrame;
};

/** The highway's hashing key for a world seed. */
export const highwayKey = (seed: number): number => Math.imul(seed ^ 0x4857, 40503);

/** The z of the start of stretch `i`, on the 2 m grid. */
function boundary(key: number, i: number): number {
  return 2 * Math.round((STRETCH * i + STRETCH_JITTER * hashS(key, i, 0, 20)) / 2);
}

/** The asphalt's half width at z before its edge is ragged: the bed's inside the strip, `RURAL_HALF` away from it, between over `TAPER` m. */
export function nominalHalf(full: readonly [number, number] | null, z: number): number {
  if (full === null) return RURAL_HALF;
  if (z >= full[0] && z <= full[1]) return ROAD_BED_HALF;
  const d = z < full[0] ? full[0] - z : z - full[1];
  return ROAD_BED_HALF - (ROAD_BED_HALF - RURAL_HALF) * Math.min(1, d / TAPER);
}

/** How far the asphalt's edge stands out of its nominal line at z on a side: -0.2 to +0.22 m, bitten in where the stretch is worn (as a street's, `streetGeometry.ts`). */
function edgeOffset(key: number, z: number, wear: number): number {
  const slow = vnoise(key, z, 7) - 0.45;
  const fine = hashS(key, Math.floor(z / 2), 0, 3);
  const bite = hashN(key, Math.floor(z / 2), 0, 4) < 0.12 * wear ? -0.12 : 0;
  return Math.max(-0.2, Math.min(0.22, slow * 0.34 + fine * 0.05 + bite));
}

/** The asphalt's half width on a side (`sg` 1 or -1) at z: ragged out of the strip, the more the narrower, and exactly the bed's inside it. */
export function asphaltHalf(env: HighwayEnv, sg: 1 | -1, z: number): number {
  const nominal = nominalHalf(env.full, z);
  const f = (ROAD_BED_HALF - nominal) / (ROAD_BED_HALF - RURAL_HALF);
  if (f <= 0) return nominal;
  const st = stretchAt(env, z);
  return nominal + f * edgeOffset(env.key ^ (sg > 0 ? 0x11 : 0x22), z, st.wear);
}

/** The white edge line's offset at z. */
export function edgeLineAt(full: readonly [number, number] | null, z: number): number {
  const half = nominalHalf(full, z);
  return STRIP_EDGE_LINE - (STRIP_EDGE_LINE - RURAL_EDGE_LINE) * ((ROAD_BED_HALF - half) / (ROAD_BED_HALF - RURAL_HALF));
}

/** The stretch of paving that z lies in. */
export function stretchAt(env: HighwayEnv, z: number): Stretch {
  const last = env.memo.last;
  if (last !== null && z >= last.z0 && z < last.z1) return last;
  const found = stretchFind(env, z);
  env.memo.last = found;
  return found;
}

function stretchFind(env: HighwayEnv, z: number): Stretch {
  let i = Math.floor(z / STRETCH);
  while (boundary(env.key, i) > z) i--;
  while (boundary(env.key, i + 1) <= z) i++;
  return stretchOf(env, i);
}

function stretchOf(env: HighwayEnv, i: number): Stretch {
  let s = env.stretches.get(i);
  if (s !== undefined) return s;
  const key = env.key;
  const z0 = boundary(key, i);
  const z1 = boundary(key, i + 1);
  const sf = 0.78 + 0.5 * hashN(key, i, 0, 1);
  const wear = 0.1 + 0.8 * hashN(key, i, 0, 21);
  const decade = Math.floor(1960 + 65 * hashN(key, i, 0, 22));
  const { layer, tint } = asphaltOf({ s0: 0, s1: 1, decade, curb: 0, wear } as Paving, sf);
  // The texture runs along the road's direction at the stretch's middle, shifted by a roll of the stretch's own.
  const zc = (z0 + z1) / 2;
  const dx = env.centre(zc + 0.5) - env.centre(zc - 0.5);
  const len = Math.sqrt(dx * dx + 1);
  const tx = dx / len;
  const tz = 1 / len;
  const frame: UvFrame = { origin: [env.centre(zc) + hashN(key, i, 0, 2) * 5, 0, zc + hashN(key, i, 0, 3) * 5], u: [-tz, 0, tx], v: [tx, 0, tz] };
  s = { i, z0, z1, key: Math.imul(i + 7, 2246822) ^ key, wear, decade, layer, tint, frame };
  env.stretches.set(i, s);
  return s;
}

/** A stretch's roadway look at a z: its layer, tone, frame, and the dirt and wear that gather toward the edges. */
function lookOf(env: HighwayEnv, st: Stretch): Over & { tint: Rgb; layer: "asphalt" | "asphalt_dark" } {
  const across = (q: readonly [number, number, number]): number => Math.abs(q[0] - env.centre(q[2])) / nominalHalf(env.full, q[2]);
  const dirt = (q: readonly [number, number, number]): number => clamp01(0.02 + 0.08 * st.wear + (0.1 + 0.25 * (1 - USE * 0.6)) * smooth(0.55, 1, across(q)));
  const wear = (q: readonly [number, number, number]): number => clamp01((0.02 + 0.12 * st.wear * (1 - USE * 0.5)) * smooth(0.6, 1.05, across(q)));
  return { layer: st.layer, tint: st.tint, frame: st.frame, dirt, wear };
}

/** The stretches that overlap [lo, hi], in order. */
function stretchesIn(env: HighwayEnv, lo: number, hi: number): Stretch[] {
  const out: Stretch[] = [];
  let st = stretchAt(env, lo);
  for (;;) {
    out.push(st);
    if (st.z1 >= hi) break;
    st = stretchOf(env, st.i + 1);
  }
  return out;
}

/** The paint's look at a z: the town's worn paint (the asphalt's grain under the colour, faded by a roll per 8 m, dirtied where it has faded). */
function paintLook(key: number, colour: Rgb, z: number, line: number): Over {
  const roll = 0.65 + 0.35 * hashN(key, Math.floor(z / 8), line, 4);
  return { layer: "asphalt", tint: [colour[0] * roll * 2.1, colour[1] * roll * 2.1, colour[2] * roll * 2.1], dirt: 0.1 + 0.4 * (1 - roll), wear: 0.04, rank: RANK.paint };
}

/**
 * The road from `lo` to `hi` (z), in rows of about `step` m (2 m: the bed's own tiles; 8 m for the far level): the asphalt in three bands across, the
 * gravel shoulders where the asphalt is narrower than the bed, the seams between stretches and, if the env lays marks, the white edge lines.
 */
export function layRows(env: HighwayEnv, lo: number, hi: number, step: number): void {
  for (const st of stretchesIn(env, lo, hi)) {
    const a = Math.max(lo, st.z0);
    const b = Math.min(hi, st.z1);
    if (!(b - a > 1e-6)) continue;
    const look = lookOf(env, st);
    const n = Math.max(1, Math.round((b - a) / step));
    // The rows' ends, and the places where the asphalt begins to narrow (a row has the bed's whole width, or narrows from one end to the other).
    const zs: number[] = [];
    for (let k = 0; k <= n; k++) zs.push(a + ((b - a) * k) / n);
    if (env.full !== null) for (const z of env.full) if (z > a + 1e-6 && z < b - 1e-6) zs.push(z);
    zs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < zs.length; k++) if ((zs[k + 1] as number) - (zs[k] as number) > 1e-6) layRow(env, st, look, zs[k] as number, zs[k + 1] as number);
    // The seam where this stretch begins (laid by the range it begins in).
    if (st.z0 >= lo && st.z0 < hi) layRoadSeam(env, st);
  }
}

function layRow(env: HighwayEnv, st: Stretch, look: Over & { tint: Rgb; layer: "asphalt" | "asphalt_dark" }, za: number, zb: number): void {
  const ca = env.centre(za);
  const cb = env.centre(zb);
  const half = (sg: 1 | -1, z: number): number => asphaltHalf(env, sg, z);
  const lA = half(-1, za);
  const lB = half(-1, zb);
  const rA = half(1, za);
  const rB = half(1, zb);
  // Three bands: the left's outer, the middle, the right's outer. Where the road lies near the town's streets a band is cut across again until its plane follows the
  // walked ground (the trough of a street that meets the highway rises through the bed): none of it lies more than 4 mm off it.
  const band = (a0: number, a1: number, b0: number, b1: number, depth: number): void => {
    if (env.near && depth < 3 && Math.abs(a1 - a0) > 0.5) {
      const am = (a0 + a1) / 2;
      const bm = (b0 + b1) / 2;
      const miss = (c: number, z: number, u0: number, u1: number, um: number): number => Math.abs(env.height(c + um, z) - (env.height(c + u0, z) + env.height(c + u1, z)) / 2);
      if (Math.max(miss(ca, za, a0, a1, am), miss(cb, zb, b0, b1, bm)) > 0.004) {
        band(a0, am, b0, bm, depth + 1);
        band(am, a1, bm, b1, depth + 1);
        return;
      }
    }
    env.pave([[ca + a0, za], [ca + a1, za], [cb + b1, zb], [cb + b0, zb]], ROADWAY_LIFT, ASPHALT, look);
  };
  band(-lA, -0.5 * lA, -lB, -0.5 * lB, 0);
  band(-0.5 * lA, 0.5 * rA, -0.5 * lB, 0.5 * rB, 0);
  band(0.5 * rA, rA, 0.5 * rB, rB, 0);
  // The shoulders: gravel from just under the asphalt's edge to the bed's edge.
  const under = 0.1;
  for (const sg of [-1, 1] as const) {
    const eA = sg < 0 ? lA : rA;
    const eB = sg < 0 ? lB : rB;
    if (eA >= ROAD_BED_HALF - 0.01 && eB >= ROAD_BED_HALF - 0.01) continue;
    const inA = Math.min(eA - under, ROAD_BED_HALF);
    const inB = Math.min(eB - under, ROAD_BED_HALF);
    const dirt = (q: readonly [number, number, number]): number => clamp01(0.18 + 0.7 * smooth(RURAL_HALF, ROAD_BED_HALF, Math.abs(q[0] - env.centre(q[2]))));
    const wear = (q: readonly [number, number, number]): number => clamp01(0.05 + 0.35 * smooth(RURAL_HALF + 0.3, ROAD_BED_HALF, Math.abs(q[0] - env.centre(q[2]))));
    const over: Over = { layer: "gravel", rank: RANK.under, group: "shoulder", tint: [0.95, 0.9, 0.82], frame: st.frame, dirt, wear };
    env.pave([[ca + sg * inA, za], [ca + sg * ROAD_BED_HALF, za], [cb + sg * ROAD_BED_HALF, zb], [cb + sg * inB, zb]], ROADWAY_LIFT - 0.004, GRAVEL, over);
  }
  if (!env.marks) return;
  // The white edge lines, worn: a stretch of 8 m now and then gone.
  const lift = ROADWAY_LIFT + MARK_OVER;
  for (const sg of [-1, 1] as const) {
    const line = sg < 0 ? 2 : 3;
    if (hashN(env.key, Math.floor(za / 8), line, 6) < 0.05) continue;
    const oa = edgeLineAt(env.full, za);
    const ob = edgeLineAt(env.full, zb);
    const w = LINE_WIDTH / 2;
    env.pave([[ca + sg * (oa - w), za], [ca + sg * (oa + w), za], [cb + sg * (ob + w), zb], [cb + sg * (ob - w), zb]], lift, PAINT_WHITE, paintLook(env.key, PAINT_WHITE, za, line));
  }
}

/** A seam across the road where a stretch begins: a dark band of 5 cm with a jog or two (as a street's). */
function layRoadSeam(env: HighwayEnv, st: Stretch): void {
  const z = st.z0;
  const key = env.key ^ Math.imul(st.i + 3, 40503);
  const f = frameOf(env, z);
  const over: Over = { layer: "asphalt_dark", tint: [0.5, 0.5, 0.5], frame: st.frame, rank: RANK.mark };
  // The asphalt's half widths are measured in x; the seam is laid across the road, along its normal.
  const lh = asphaltHalf(env, -1, z) * f.tz * 0.99;
  const rh = asphaltHalf(env, 1, z) * f.tz * 0.99;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t0 = -lh + ((lh + rh) * i) / n;
    const t1 = -lh + ((lh + rh) * (i + 1)) / n;
    const j0 = 0.06 * hashS(key, i, 0, 5);
    const j1 = 0.06 * hashS(key, i + 1, 0, 5);
    const w = 0.03 + 0.02 * hashN(key, i, 0, 6);
    env.pave([at(f, j0 - w, t0), at(f, j0 + w, t0), at(f, j1 + w, t1), at(f, j1 - w, t1)], ROADWAY_LIFT + 0.002, PATCH_ASPHALT, over);
  }
}

/** The centre line's yellow dashes that begin in [lo, hi): 3 m on in every 12 m, some gone, the rest faded as the street's paint is. */
export function layDashes(env: HighwayEnv, lo: number, hi: number): void {
  const lift = ROADWAY_LIFT + MARK_OVER;
  const w = LINE_WIDTH / 2;
  for (let j = Math.ceil(lo / DASH_PERIOD); j * DASH_PERIOD < hi; j++) {
    if (hashN(env.key, j, 0, 5) < 0.1) continue;
    const z0 = j * DASH_PERIOD;
    const z1 = z0 + DASH_ON;
    const c0 = env.centre(z0);
    const c1 = env.centre(z1);
    env.pave([[c0 - w, z0], [c0 + w, z0], [c1 + w, z1], [c1 - w, z1]], lift, PAINT_YELLOW, paintLook(env.key, PAINT_YELLOW, z0, 4));
  }
}

// ---- Wear, by slots.

/** The road's frame at z: its centre and its direction (tz positive). */
function frameOf(env: HighwayEnv, z: number): F {
  let f = env.memo.frames.get(z);
  if (f === undefined) {
    const dx = env.centre(z + 0.5) - env.centre(z - 0.5);
    const len = Math.sqrt(dx * dx + 1);
    f = { x: env.centre(z), z, tx: dx / len, tz: 1 / len };
    env.memo.frames.set(z, f);
  }
  return f;
}

/** The point `s` along the frame's direction and `t` across it (toward +x). */
const at = (f: F, s: number, t: number): P2 => [f.x + f.tx * s + f.tz * t, f.z + f.tz * s - f.tx * t];

const rot = (x: number, z: number, c: number, s: number): P2 => [x * c - z * s, x * s + z * c];

/**
 * What time and use have done to the road in slot `S` (z from `S * SLOT` to the next): see the header. `lod` 1 lays the patches only, the marks that
 * show at a distance.
 */
export function layFeatures(env: HighwayEnv, S: number, lod: 0 | 1): void {
  const lo = S * SLOT;
  const hi = lo + SLOT;
  const zm = lo + SLOT / 2;
  const key = Math.imul(S + 40503, 2246822) ^ env.key;
  const r = (a: number, b = 0, d = 0): number => hashN(key, a, b, d);
  // The half width a feature may use, measured across the road along its normal: the asphalt's half width is measured in x, which on a road that bends away from z is longer.
  const cw = Math.min(nominalHalf(env.full, lo), nominalHalf(env.full, zm), nominalHalf(env.full, hi)) * Math.min(frameOf(env, lo).tz, frameOf(env, zm).tz, frameOf(env, hi).tz);
  // Where a street's trough reaches into the bed the ground is not level and a feature of a few millimetres' lift would be under or over it: none is laid in the slot.
  if (env.near) {
    for (let z = lo; z <= hi; z += 4) {
      const c = env.centre(z);
      for (const u of [-5, -2.5, 0, 2.5, 5]) if (Math.abs(streetLiftD(env.seed, c + u, z).v) > 0.002) return;
    }
  }
  const stMid = stretchAt(env, zm);
  /** Whether a stretch's boundary lies between two zs (a feature is not laid over a seam). */
  const overSeam = (z0: number, z1: number): boolean => stretchAt(env, z0).i !== stretchAt(env, z1).i;
  const dark = (k: number, rank: number, st: Stretch): Over => ({ rank, layer: "asphalt_dark", tint: [k, k, k], frame: st.frame });
  const rectOf = (f: F, ct: number, hl: number, hw: number, ang: number): P2[] => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const q = (x: number, z: number): P2 => {
      const p = rot(x, z, c, s);
      return at(f, p[0], ct + p[1]);
    };
    return [q(-hl, -hw), q(hl, -hw), q(hl, hw), q(-hl, hw)];
  };

  // ---- Large patches: by what made them (a lane resurfaced, an old repair, a trench along the road, a trench across).
  if (r(0, 0, 1) < 0.6) {
    const roll = r(1, 0, 2);
    const side = r(2, 0, 3) < 0.5 ? 1 : -1;
    const outer = cw - 1.1;
    let hl: number;
    let hw: number;
    let ct: number;
    let ang: number;
    let layer: "asphalt" | "asphalt_dark" = "asphalt_dark";
    let k: number;
    if (roll < 0.28) {
      hl = 3 + 4 * r(5);
      hw = ((outer - 0.15) / 2) * (0.75 + 0.25 * r(6));
      ct = side * ((outer + 0.15) / 2);
      ang = (r(7) - 0.5) * 0.04;
      k = 0.45 + 0.2 * r(8);
    } else if (roll < 0.58) {
      hl = 1.1 + 2.3 * r(5);
      hw = 0.7 + Math.min(1.75 * 0.8, 1.6) * r(6);
      ct = side * (0.3 + Math.max(0, cw - 1.4 - hw) * r(9));
      ang = (r(7) - 0.5) * 0.5;
      layer = "asphalt";
      k = 2.0 + 0.7 * r(8);
    } else if (roll < 0.8) {
      hl = 1.8 + 3.0 * r(5);
      hw = 0.5 + 0.35 * r(6);
      ct = side * cw * (0.15 + 0.5 * r(9));
      ang = (r(7) - 0.5) * 0.05;
      k = 0.55 + 0.15 * r(8);
    } else {
      hl = 0.3 + 0.3 * r(5);
      hw = cw - 1.35;
      ct = 0;
      ang = (r(7) - 0.5) * 0.4;
      k = 0.6 + 0.15 * r(8);
    }
    const rs = Math.abs(hl * Math.cos(ang)) + Math.abs(hw * Math.sin(ang)) + 0.25;
    const rt = Math.abs(hl * Math.sin(ang)) + Math.abs(hw * Math.cos(ang));
    if (rs + 0.3 < SLOT / 2 && Math.abs(ct) + rt <= cw - 1.1) {
      const cs = lo + rs + 0.3 + r(3, 0, 4) * (SLOT - 2 * rs - 0.6);
      if (!overSeam(cs - rs - 0.3, cs + rs + 0.3)) {
        const st = stretchAt(env, cs);
        const f = frameOf(env, cs);
        const over: Over = { layer, tint: [k, k, k * 0.99], frame: st.frame, rank: RANK.mark, dirt: 0.04 };
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const nS = Math.max(1, Math.ceil((2 * hl) / 3.8));
        const nT = Math.max(1, Math.ceil((2 * hw) / 3.2));
        const pt = (i: number, j: number): P2 => {
          const edgeI = i === 0 || i === nS;
          const edgeJ = j === 0 || j === nT;
          const jx = (hashN(key, 77, i * 31 + j, 31) - 0.5) * 0.14;
          const jz = (hashN(key, 77, i * 31 + j, 32) - 0.5) * 0.14;
          const x = -hl + (2 * hl * i) / nS + (edgeI ? 0 : jx);
          const z = -hw + (2 * hw * j) / nT + (edgeJ ? 0 : jz);
          const q = rot(x + (edgeI ? jx * 0.5 : 0), z + (edgeJ ? jz * 0.5 : 0), c, s);
          return at(f, q[0], ct + q[1]);
        };
        for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) env.pave([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], ROADWAY_LIFT + 0.0015, layer === "asphalt" ? PALE : PATCH_ASPHALT, over);
      }
    }
  }
  if (lod === 1) return;

  // ---- Utility cuts: darker, newer asphalt in rectangles at angles with a sealed seam round each; sometimes a second beside the first.
  if (r(10, 0, 1) < 0.45) {
    const lay = (cs: number, ct: number, hl: number, hw: number, ang: number, lift: number, tag: number): void => {
      const st = stretchAt(env, cs);
      const f = frameOf(env, cs);
      const shifted = rectOf(f, ct, hl, hw, ang);
      const k = 0.95 + 0.3 * hashN(key, tag, 1, 105);
      env.pave(shifted, ROADWAY_LIFT + lift, PATCH_ASPHALT, { ...dark(k, RANK.detail, st), dirt: 0.06 });
      for (let e = 0; e < 4; e++) {
        const a = shifted[e] as P2;
        const b = shifted[(e + 1) % 4] as P2;
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const el = Math.sqrt(ex * ex + ez * ez) || 1;
        const nx = (-ez / el) * SEAM_HALF;
        const nz = (ex / el) * SEAM_HALF;
        const cut = e % 2 === 0 ? SEAM_HALF / el : 0;
        const ax = a[0] + ex * cut;
        const az = a[1] + ez * cut;
        const bx = b[0] - ex * cut;
        const bz = b[1] - ez * cut;
        env.pave([[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]], ROADWAY_LIFT + SEAM_LIFT, PATCH_ASPHALT, dark(0.32, RANK.top, st));
      }
    };
    const hl = 0.5 + 0.65 * r(11) + 0.65 * r(12);
    const hw = 0.3 + 0.45 * r(13);
    const ang = (r(14) - 0.5) * 1.1;
    const rs = Math.abs(hl * Math.cos(ang)) + Math.abs(hw * Math.sin(ang)) + 0.3;
    const rt = Math.abs(hl * Math.sin(ang)) + Math.abs(hw * Math.cos(ang));
    const room = Math.max(0, cw - 0.45 - rt);
    const cs = lo + rs + 0.2 + r(15) * (SLOT - 2 * rs - 0.4);
    const ct = (r(16) * 2 - 1) * room;
    if (!overSeam(cs - rs, cs + rs)) {
      lay(cs, ct, hl, hw, ang, CUT, 1);
      if (r(17) < 0.3) {
        const hl2 = 0.4 + 0.7 * r(18);
        const hw2 = 0.25 + 0.3 * r(19);
        const a2 = ang + (r(20) - 0.5) * 1.6;
        const cs2 = cs + (r(21) - 0.5) * 2.2;
        const ct2 = ct + (r(22) - 0.5) * 1.4;
        const rs2 = Math.abs(hl2 * Math.cos(a2)) + Math.abs(hw2 * Math.sin(a2)) + 0.3;
        if (cs2 - rs2 > lo && cs2 + rs2 < hi && Math.abs(ct2) < cw - 1.2 && !overSeam(cs2 - rs2, cs2 + rs2)) lay(cs2, ct2, hl2, hw2, a2, CUT + 0.0008, 2);
      }
    }
  }

  // ---- Sealed cracks: bending dark lines, mostly along the road, more of them where the stretch is worn.
  const cracks = Math.floor((SLOT / 38) * (0.3 + 1.6 * stMid.wear) + r(30, 0, 1));
  for (let i = 0; i < cracks; i++) {
    const along = r(31, i) < 0.72;
    const n = 4 + Math.floor(r(32, i) * 3);
    const stepL = 0.9 + 1.0 * r(33, i);
    const z0 = lo + 1.5 + r(34, i) * (SLOT - 3 - (along ? n * stepL : 0));
    const t0 = (r(35, i) * 2 - 1) * (cw - 0.6);
    const pts: [number, number][] = [];
    let s = z0;
    let t = t0;
    for (let k = 0; k <= n; k++) {
      pts.push([s, t]);
      if (along) {
        s += stepL;
        t += hashS(key, i, k, 126) * 0.14;
      } else {
        t += stepL * (r(37, i) < 0.5 ? 1 : -1) * 0.8;
        s += hashS(key, i, k, 128) * 0.22;
      }
    }
    const w = 0.014 + 0.016 * r(38, i);
    const sealed = r(39, i) < 0.55;
    for (let k = 0; k < n; k++) {
      const a = pts[k] as [number, number];
      const b = pts[k + 1] as [number, number];
      if (Math.abs(a[1]) > cw - 0.3 || Math.abs(b[1]) > cw - 0.3 || overSeam(Math.min(a[0], b[0]), Math.max(a[0], b[0]))) continue;
      const ds = b[0] - a[0];
      const dt = b[1] - a[1];
      const dl = Math.sqrt(ds * ds + dt * dt) || 1;
      const os = (-dt / dl) * w;
      const ot = (ds / dl) * w;
      const fa = frameOf(env, a[0]);
      const fb = frameOf(env, b[0]);
      env.pave([at(fa, -os, a[1] - ot), at(fb, -os, b[1] - ot), at(fb, os, b[1] + ot), at(fa, os, a[1] + ot)], ROADWAY_LIFT + 0.0025, PATCH_ASPHALT, dark(sealed ? 0.3 : 0.5, RANK.crack, stretchAt(env, a[0])));
    }
  }

  // ---- Potholes: on the worst, oldest paving.
  const holes = Math.floor((SLOT / 110) * (1 - USE) * (0.3 + 2.2 * stMid.wear) * 1.6 + r(40, 0, 1) * (1 - USE));
  for (let i = 0; i < holes; i++) {
    const rr = 0.16 + 0.3 * r(41, i) * r(42, i) * 2;
    const cs = lo + rr * 1.7 + 0.5 + r(43, i) * (SLOT - 2 * (rr * 1.7 + 0.5));
    const st = stretchAt(env, cs);
    if (st.wear < 0.45 || st.decade >= 2010 || overSeam(cs - rr * 1.7, cs + rr * 1.7)) continue;
    const ct = (r(44, i) * 2 - 1) * (cw - 0.7);
    const f = frameOf(env, cs);
    const n = 8;
    const ring = (k: number, scale: number): P2 => {
      const a = (k / n) * Math.PI * 2;
      const q = rr * scale * (0.72 + 0.5 * hashN(key, 45, i * 16 + k, 1));
      return at(f, Math.cos(a) * q * 1.2, ct + Math.sin(a) * q);
    };
    env.pave(Array.from({ length: n }, (_, k) => ring(k, 1.35)), ROADWAY_LIFT + 0.002, PATCH_ASPHALT, dark(0.42, RANK.detail, st));
    env.pave(Array.from({ length: n }, (_, k) => ring(k, 0.95)), ROADWAY_LIFT + 0.0035, PATCH_ASPHALT, { rank: RANK.top, layer: "mud", tint: [0.5, 0.46, 0.4], frame: { origin: [f.x, 0, f.z], u: [1, 0, 0], v: [0, 0, 1] }, dirt: 0.3 });
  }

  // ---- Standing water in the low side of the crown, where the paving has settled.
  const pools = Math.floor((SLOT / 60) * (0.2 + 2.2 * stMid.wear) + r(50, 0, 1) * 0.8);
  for (let i = 0; i < pools; i++) {
    const sg = r(51, i) < 0.5 ? 1 : -1;
    const rl = 0.9 + 1.5 * r(52, i);
    const rw = 0.35 + 0.45 * r(53, i);
    const ct = sg * (cw - 0.55 - rw * 1.2 - 0.5 * r(54, i));
    const cs = lo + rl * 1.3 + 0.3 + r(55, i) * (SLOT - 2 * (rl * 1.3 + 0.3));
    if (overSeam(cs - rl * 1.3, cs + rl * 1.3)) continue;
    const f = frameOf(env, cs);
    const m = 7;
    const pts: P2[] = Array.from({ length: m }, (_, k) => {
      const a = (k / m) * Math.PI * 2;
      const q = 0.78 + 0.34 * hashN(key, 56, i * 16 + k, 1);
      return at(f, Math.cos(a) * rl * q, ct + Math.sin(a) * rw * q);
    });
    env.pave(pts, ROADWAY_LIFT + 0.0034, PATCH_ASPHALT, { layer: "asphalt_dark", tint: [0.42, 0.45, 0.5], frame: stretchAt(env, cs).frame, rank: RANK.top, dirt: 0 });
  }

  // ---- Wheel tracks and a little oil, in both lanes: soft bands in the road's own asphalt, laid in the same layer and frame as the stretch beside them.
  const polish = 0.5 + 0.5 * USE;
  const k2 = env.key ^ 0x7a31c5;
  const present = (here: number, sg: number): boolean => vnoise(k2 ^ (sg > 0 ? 0x33 : 0x77), here, 38) > 0.84 - 0.3 * polish && !overSeam(here - 2.2, here + 2.2);
  for (let i = 0; i < SLOT / 4; i++) {
    const s0 = lo + 4 * i;
    const s1 = s0 + 4 - 0.04;
    const here = (s0 + s1) / 2;
    const st = stretchAt(env, here);
    const look = lookOf(env, st);
    const { tint, ...rest } = look;
    for (const sg of [1, -1]) {
      const c0 = sg * 1.75;
      if (!present(here, sg)) continue;
      const f0 = present(here - 4, sg) ? 1 : 0;
      const f1 = present(here + 4, sg) ? 1 : 0;
      const peak = (0.06 + 0.07 * vnoise(k2 ^ 0x51, here, 25) + 0.04 * st.wear) * (0.7 + 0.5 * polish);
      const col = (fa: number): Rgb => [tint[0] * (1 + peak * fa), tint[1] * (1 + peak * fa), tint[2] * (1 + peak * fa)];
      const edgeCol: Rgb = [tint[0], tint[1], tint[2]];
      const fa = frameOf(env, s0);
      const fb = frameOf(env, s1);
      for (const d of [-0.78, 0.78]) {
        const w = 0.3;
        const pts = [at(fa, 0, c0 + d), at(fa, 0, c0 + d + w), at(fb, 0, c0 + d + w), at(fb, 0, c0 + d), at(fb, 0, c0 + d - w), at(fa, 0, c0 + d - w)];
        env.soft(pts, ROADWAY_LIFT + 0.0012, [col(f0), edgeCol, edgeCol, col(f1), edgeCol, edgeCol], rest, TRACK_RANK);
      }
      // A dark patch of oil in the lane's middle, now and then.
      if (hashN(k2, i, sg + 5, 42) < 0.12 + 0.2 * polish) {
        const o0 = s0 + (s1 - s0) * 0.15;
        const o1 = s0 + (s1 - s0) * (0.55 + 0.35 * hashN(k2, i, sg, 44));
        const dk = 1 - 0.14;
        const dcol: Rgb = [tint[0] * dk, tint[1] * dk, tint[2] * dk];
        const pa = frameOf(env, o0);
        const pb = frameOf(env, o1);
        const pts = [at(pa, 0, c0), at(pa, 0, c0 + 0.22), at(pb, 0, c0 + 0.22), at(pb, 0, c0), at(pb, 0, c0 - 0.22), at(pa, 0, c0 - 0.22)];
        env.soft(pts, ROADWAY_LIFT + 0.0014, [edgeCol, edgeCol, edgeCol, dcol, edgeCol, edgeCol], rest, TRACK_RANK);
      }
    }
  }

  // ---- The edge: mud and gravel dragged in over the ragged asphalt where it meets the shoulder (out of town only).
  if (cw < 3.6) {
    for (const sg of [-1, 1] as const) {
      const ek = k2 ^ (sg > 0 ? 0x1b : 0xb1);
      for (let i = 0; i < SLOT / 4; i++) {
        const s0 = lo + 4 * i;
        const s1 = s0 + 4;
        const m = vnoise(ek ^ 3, s0, 9);
        if (m < 0.38 || overSeam(s0, s1)) continue;
        const w = 0.3 + 0.9 * clamp01((m - 0.38) * 1.8);
        const fa = frameOf(env, s0);
        const fb = frameOf(env, s1);
        // The asphalt's edge is measured in x, the band's offsets along the normal.
        const a0 = asphaltHalf(env, sg, s0);
        const a1 = asphaltHalf(env, sg, s1);
        if (a0 > 4 || a1 > 4) continue;
        const e0 = a0 * fa.tz * 0.99;
        const e1 = a1 * fb.tz * 0.99;
        env.pave([at(fa, 0, sg * (e0 - w * (0.5 + 0.5 * hashN(ek, i, 1, 51)))), at(fb, 0, sg * (e1 - w)), at(fb, 0, sg * (e1 - 0.04)), at(fa, 0, sg * (e0 - 0.04))], ROADWAY_LIFT + 0.0026, PATCH_ASPHALT, { layer: "mud", tint: [0.62, 0.55, 0.42], frame: stretchAt(env, s0).frame, rank: RANK.detail, dirt: 0.25 });
      }
    }
  }

  // ---- Oil where an engine has leaked: a soaked patch in a lane's middle, a few drips behind it.
  if (r(60, 0, 1) < 0.5) {
    const sg = r(61) < 0.5 ? 1 : -1;
    const a = 0.5 + 0.6 * r(62);
    const b = 0.25 + 0.25 * r(63);
    const cs = lo + a * 1.4 + 3 + r(64) * (SLOT - 2 * (a * 1.4 + 3));
    const f = frameOf(env, cs);
    const ct = sg * 1.75 + (r(65) - 0.5) * 0.8;
    const st = stretchAt(env, cs);
    const blob = (cx: number, cz: number, ra: number, rb: number, tag: number): void => {
      const n = 8;
      const pts: P2[] = [];
      for (let k = 0; k < n; k++) {
        const ang = ((k + 0.3 * (hashN(key, tag, k, 10) - 0.5)) / n) * Math.PI * 2;
        const q = 0.92 + 0.16 * hashN(key, tag, k, 30);
        pts.push(at(f, cz + Math.cos(ang) * ra * q, cx + Math.sin(ang) * rb * q));
      }
      env.pave(pts, ROADWAY_LIFT + 0.0045, PATCH_ASPHALT, { layer: "asphalt_dark", tint: [0.3, 0.3, 0.32], frame: st.frame, rank: RANK.stain, dirt: 0 });
    };
    if (!overSeam(cs - a - 4, cs + a)) {
      blob(ct, 0, a, b, 70);
      for (let k = 0; k < 3; k++) blob(ct + (hashN(key, 71, k, 1) - 0.5) * 0.25, -(a + 0.8 + 1.1 * k + 0.4 * hashN(key, 71, k, 2)), 0.05 + 0.04 * hashN(key, 71, k, 3), 0.05 + 0.03 * hashN(key, 71, k, 4), 72 + k);
    }
  }

  // ---- A manhole cover now and then along the road through the town.
  if (env.manholes && cw >= 5 && r(80, 0, 1) < SLOT / 90) {
    const cs = lo + 1 + r(81) * (SLOT - 2);
    const f = frameOf(env, cs);
    const c = at(f, 0, (r(82) - 0.5) * 1.4);
    const n = 12;
    const disc = (rad: number): P2[] => Array.from({ length: n }, (_, k) => [c[0] + Math.cos((k / n) * Math.PI * 2) * rad, c[1] + Math.sin((k / n) * Math.PI * 2) * rad] as P2);
    env.pave(disc(0.37), ROADWAY_LIFT + 0.002, PATCH_ASPHALT, { rank: RANK.detail, layer: "asphalt_dark", tint: [0.35, 0.35, 0.35] });
    env.pave(disc(0.31), ROADWAY_LIFT + 0.0032, PATCH_ASPHALT, { rank: RANK.top, layer: "asphalt_dark", tint: [0.3 + 0.08 * r(83), 0.24, 0.21], frame: { origin: [c[0], 0, c[1]], u: [1, 0, 0], v: [0, 0, 1] }, wear: 0.3, wearKind: "rust", dirt: 0.1 });
  }
}

// ---- The env's own parts: laying a polygon into a surface, cut to a region.

const areaOf = (p: readonly P2[]): number => {
  let t = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as P2;
    const b = p[(i + 1) % p.length] as P2;
    t += a[0] * b[1] - b[0] * a[1];
  }
  return t / 2;
};

/** Whether a polygon's corners turn one way all round (convex, no corner flat or folded). */
function convex(p: readonly P2[]): boolean {
  let sign = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i] as P2;
    const b = p[(i + 1) % n] as P2;
    const c = p[(i + 2) % n] as P2;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-7) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The corners of a polygon without a corner that repeats the one before it. */
function distinctCorners(p: readonly P2[]): P2[] {
  return p.filter((q, i) => {
    for (let k = 0; k < i; k++) if (Math.abs(q[0] - (p[k] as P2)[0]) <= 1e-4 && Math.abs(q[1] - (p[k] as P2)[1]) <= 1e-4) return false;
    return true;
  });
}

/**
 * An env's `pave` and `soft`: laid into `surf` (the polygons on the ground at their lift, by `Surface.pave`), cut to `region` (which gives the convex pieces of a
 * convex polygon that this builder draws: the town's strip, or the stream's cell outside it), the soft bands only where `accepts` says all their corners lie in it.
 */
export function envParts(surf: Surface, region: (poly: readonly P2[]) => P2[][], accepts: (pts: readonly P2[]) => boolean): Pick<HighwayEnv, "pave" | "soft"> {
  const g = surf.g;
  return {
    pave(poly, lift, colour, over) {
      const convexPieces: (readonly P2[])[] = poly.length > 4 && !convex(poly) ? triangulate(poly).map(([i, j, k]) => [poly[i] as P2, poly[j] as P2, poly[k] as P2]) : [poly];
      for (const piece of convexPieces) {
        for (const r of region(piece)) {
          const q = distinctCorners(r);
          if (q.length < 3 || Math.abs(areaOf(q)) < 4e-4) continue;
          if (q.every((p) => g.heightAt(p[0], p[1]) < SEA + 0.1)) continue;
          surf.pave(q, lift, colour, over);
        }
      }
    },
    soft(pts, lift, colours, over, rank) {
      if (!accepts(pts)) return;
      const surface = withOver(undefined, [1, 1, 1], g.anchor, over);
      if (surface === undefined) return;
      const verts = pts.map((q): Vec3 => [q[0], g.heightAt(q[0], q[1]) + lift, q[1]]);
      if (verts.every((v) => v[1] < SEA + 0.1)) return;
      let cx = 0;
      let cz = 0;
      for (const q of pts) {
        cx += q[0];
        cz += q[1];
      }
      surf.sink(cx / pts.length, cz / pts.length).poly(verts, [0, 1, 0], colours, surface, { rank });
    },
  };
}
