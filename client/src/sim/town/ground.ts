/**
 * The town's made ground: the town stands on fill, as the real ports of this coast do. Inside its
 * footprint the ground is a graded plane over the coast's own: `QUAY` metres above the sea at the
 * water's edge, rising inland at a grade that is constant across the plane, to meet the highway's
 * own grade where the highway runs, and on at that grade to `TOWN_INLAND` metres east of the
 * highway. The grade is set at each z by the two ends it joins (the quay and the highway's height
 * there), so the plane's height at the highway IS the highway's grade line all along the town, and
 * it carries the grade line's slope in z. Outside the footprint the ground is the coast's own; between
 * them a blend of `EDGE` metres by a quintic window. At the water's edge the fill ends in a bank of
 * `BANK` metres, down to the coast's own ground below the tide line.
 *
 * Same contract as the coast's own stages: `dx`/`dz` are the EXACT analytic derivatives of `h`, and
 * outside the window the base sample is returned as the same object. The simulation's arithmetic.
 */
import { COVE_Z, roadCenterX, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { QUAY_HEIGHT } from "./levels.js";
import { QUAY_BANK, fillWindowD, smootherstepD, townFillFor, type FillArea } from "./fill.js";
import { SITE_HALF, SITE_INLAND, SITE_STEP, siteFor } from "./siteFor.js";
import { shoreSplineOf, shoreXAt } from "./shoreSpline.js";

export { smootherstepD };

/** The fill's height above the sea at the water's edge, metres. */
export const QUAY = QUAY_HEIGHT;
/** The blend from the made ground to the coast's own, metres. */
export const EDGE = 40;
/** The footprint's reach along the shore either side of the anchor, metres. */
export const TOWN_Z_HALF = 480;
/** The footprint's reach inland of the highway, metres. */
export const TOWN_INLAND = SITE_INLAND;
/** The bank at the water's edge: the fill comes down to the coast's own ground over this many metres seaward of the edge. */
export const BANK = 10;

/** The footprint's window along z: 1 inside, 0 beyond the blend, and its slope in z. */
export function alongD(zr: number): { v: number; dz: number } {
  const s = smootherstepD(TOWN_Z_HALF, TOWN_Z_HALF + EDGE, zr < 0 ? -zr : zr);
  return { v: 1 - s.v, dz: -s.d * (zr < 0 ? -1 : 1) };
}

/** The footprint's window inland: 1 up to `TOWN_INLAND` from the highway, 0 beyond the blend, and its slope in u. */
export function inlandD(u: number): { v: number; du: number } {
  const s = smootherstepD(TOWN_INLAND, TOWN_INLAND + EDGE, u);
  return { v: 1 - s.v, du: -s.d };
}

/**
 * The bank's weight at a point `s` metres landward of the water's edge (`s` having slope `sz` in z), where
 * the shore's own slope in z is `q` (and `q2` that slope's slope): 0 seaward of the bank's foot, 1 from the
 * edge landward. The bank is `BANK` metres wide measured across the shore, not along x, so where the shore
 * runs east and west along a headland's flank the bank is no steeper than elsewhere.
 */
export function bankD(s: number, sz: number, q: number, q2: number): { v: number; dx: number; dz: number; foot: number } {
  const r = Math.sqrt(1 + q * q);
  const sm = smootherstepD(-BANK, 0, s / r);
  return { v: sm.v, dx: sm.d / r, dz: sm.d * (sz / r - (s * q * q2) / (r * r * r)), foot: BANK * r };
}

/** Where the grade changes from the flats' to the hill's, in metres of offset from the highway: across it the x-slope eases by a quintic. */
export const HILL_FROM = -4;
export const HILL_TO = 30;
/** The hill's grade east of the highway, rise over run. */
export const HILL_GRADE = 0.06;
/** Landward of the water's edge the plane's grade comes up from 0 to the flats' over this many metres across the shore, so the fill seaward of it (flat at the quay's height) joins it with no crease. */
export const QUAY_JOIN = 8;

/** The quintic smootherstep and the integral of it, which is the hill's rise across the join: on [0, 1], K(t) = t^6 - 3 t^5 + 2.5 t^4. */
function joinD(u: number): { k: number; s: number } {
  const span = HILL_TO - HILL_FROM;
  const t = (u - HILL_FROM) / span;
  if (t <= 0) return { k: 0, s: 0 };
  if (t >= 1) return { k: u - HILL_FROM - span / 2, s: 1 };
  const t2 = t * t;
  return { k: span * t2 * t2 * (t2 - 3 * t + 2.5), s: t2 * t * (t * (t * 6 - 15) + 10) };
}

/** The rise of the join at the highway itself: what the flats' grade must make up so the plane meets the grade line there. */
const JOIN_AT_HIGHWAY = joinD(0).k;

/** The plane's seaward foot: 0 seaward of the water's edge, the identity from `QUAY_JOIN` landward, a quintic ease between. */
function footD(y: number): { v: number; d: number } {
  if (y <= 0) return { v: 0, d: 0 };
  if (y >= QUAY_JOIN) return { v: y, d: 1 };
  const e = smootherstepD(0, QUAY_JOIN, y);
  return { v: y * e.v, d: e.v + y * e.d };
}

/** What the made ground declares of itself for the level id: every constant that shapes it. */
export const GROUND_TUNABLES: Readonly<Record<string, number>> = {
  TOWN_GROUND: 2,
  QUAY,
  EDGE,
  TOWN_Z_HALF,
  TOWN_INLAND,
  BANK,
  HILL_FROM,
  HILL_TO,
  HILL_GRADE,
  QUAY_JOIN,
  QUAY_BANK,
  SITE_STEP,
  SITE_HALF,
};

/** A weight with its partials in x and z. */
type Weight = { v: number; dx: number; dz: number };

/**
 * The town's ground over the coast's (`base`), at a point whose offset from the highway is `u` (with
 * its slope in z, `uDz`).
 *
 * The plane is `QUAY + gf * r * foot(s / r) + (HILL_GRADE - gf) * K(u)`. `s` is the distance landward of the
 * water's edge and `r` the shore's obliquity, so `s / r` is the distance across the shore: the plane is flat
 * at `QUAY` seaward of the edge (where fill stands over the sea), and is no steeper along a headland's flank
 * than elsewhere. `gf` is the flats' grade, found per z so that the plane's height at the highway is exactly
 * the highway's grade line: `(A - HILL_GRADE * K(0)) / (D - K(0))`, `A` the grade line's height over `QUAY`,
 * `D` the highway's distance from the water's edge. `K` is the integral of a quintic ease from 0 to 1 over the
 * highway's few metres, so the x-slope goes from `gf` to the hill's grade without a crease. The made ground
 * is the plane over `base` by the weight: the footprint's windows (the bank, the ends along the shore, the
 * inland edge), united smoothly with the plan's fill.
 */
export function townGroundD(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample, fill: readonly FillArea[] = townFillFor(seed)): TerrainSample {
  const zr = z - COVE_Z;
  const outside = (zr < 0 ? -zr : zr) >= TOWN_Z_HALF + EDGE || u >= TOWN_INLAND + EDGE;
  if (outside && fill.length === 0) return base;
  const site = siteFor(seed);
  const xf = x - site.anchor.x;
  const shore = shoreXAt(shoreSplineOf(site), zr);
  const s = xf - shore.v;
  const sz = -shore.dz;
  const bank = bankD(s, sz, shore.dz, shore.dz2);

  // The footprint's weight: the bank, the ends and the inland edge.
  let fp: Weight = { v: 0, dx: 0, dz: 0 };
  if (!outside && s > -bank.foot) {
    const wz = alongD(zr);
    const wi = inlandD(u);
    fp = {
      v: bank.v * wz.v * wi.v,
      dx: bank.dx * wz.v * wi.v + bank.v * wz.v * wi.du,
      dz: bank.dz * wz.v * wi.v + bank.v * wz.dz * wi.v + bank.v * wz.v * wi.du * uDz,
    };
  }
  // The fill's, united with it.
  let w = fp;
  if (fill.length > 0) {
    const f = fillWindowD(fill, xf, zr);
    w = {
      v: 1 - (1 - fp.v) * (1 - f.v),
      dx: (1 - f.v) * fp.dx + (1 - fp.v) * f.dx,
      dz: (1 - f.v) * fp.dz + (1 - fp.v) * f.dz,
    };
  }
  if (w.v === 0) return base;

  const D = s - u;
  const c = JOIN_AT_HIGHWAY;
  if (!(D > c)) return base;
  const Dz = sz - uDz;
  const grade = roadGradeAt(seed, z);
  const A = grade.h - QUAY;
  const gf = (A - HILL_GRADE * c) / (D - c);
  const gfDz = (grade.dz * (D - c) - (A - HILL_GRADE * c) * Dz) / ((D - c) * (D - c));

  const q = shore.dz;
  const r = Math.sqrt(1 + q * q);
  const rDz = (q * shore.dz2) / r;
  const y = s / r;
  const yDz = sz / r - (s * rDz) / (r * r);
  const foot = footD(y);
  const join = joinD(u);

  const planeH = QUAY + gf * r * foot.v + (HILL_GRADE - gf) * join.k;
  const planeDx = gf * foot.d + (HILL_GRADE - gf) * join.s;
  const planeDz = gfDz * r * foot.v + gf * rDz * foot.v + gf * r * foot.d * yDz - gfDz * join.k + (HILL_GRADE - gf) * join.s * uDz;

  const gap = planeH - base.h;
  return {
    h: base.h + w.v * gap,
    dx: base.dx + w.dx * gap + w.v * (planeDx - base.dx),
    dz: base.dz + w.dz * gap + w.v * (planeDz - base.dz),
  };
}

/** Whether a world point stands on the made ground proper: inside the footprint, the blend and the bank not counted. */
export function inFootprint(seed: number, x: number, z: number): boolean {
  const zr = z - COVE_Z;
  if ((zr < 0 ? -zr : zr) > TOWN_Z_HALF || x - roadCenterX(seed, z) > TOWN_INLAND) return false;
  const site = siteFor(seed);
  return x - site.anchor.x - shoreXAt(shoreSplineOf(site), zr).v >= 0;
}
