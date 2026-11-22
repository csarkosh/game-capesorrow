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
import { SITE_HALF, SITE_INLAND, SITE_STEP, siteFor } from "./siteFor.js";
import { shoreSplineOf, shoreXAt } from "./shoreSpline.js";

/** The fill's height above the sea at the water's edge, metres. */
export const QUAY = 2.5;
/** The blend from the made ground to the coast's own, metres. */
export const EDGE = 40;
/** The footprint's reach along the shore either side of the anchor, metres. */
export const TOWN_Z_HALF = 480;
/** The footprint's reach inland of the highway, metres. */
export const TOWN_INLAND = SITE_INLAND;
/** The bank at the water's edge: the fill comes down to the coast's own ground over this many metres seaward of the edge. */
export const BANK = 10;

/** What the made ground declares of itself for the level id: every constant that shapes it. */
export const GROUND_TUNABLES: Readonly<Record<string, number>> = {
  TOWN_GROUND: 1,
  QUAY,
  EDGE,
  TOWN_Z_HALF,
  TOWN_INLAND,
  BANK,
  SITE_STEP,
  SITE_HALF,
};

/** Quintic smootherstep with derivative: C2 at both edges. */
export function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return { v: t * t * t * (t * (t * 6 - 15) + 10), d: (30 * t * t * (t - 1) * (t - 1)) / span };
}

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

/**
 * The town's ground over the coast's (`base`), at a point whose offset from the highway is `u` (with
 * its slope in z, `uDz`). The plane is `QUAY + A * s / D`: `s` the distance landward of the water's
 * edge, `D` the highway's distance from it, `A` the highway's grade line's height over `QUAY`.
 */
export function townGroundD(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample): TerrainSample {
  const zr = z - COVE_Z;
  if ((zr < 0 ? -zr : zr) >= TOWN_Z_HALF + EDGE || u >= TOWN_INLAND + EDGE) return base;
  const site = siteFor(seed);
  const shore = shoreXAt(shoreSplineOf(site), zr);
  const s = x - site.anchor.x - shore.v;
  const sz = -shore.dz;
  const ws = bankD(s, sz, shore.dz, shore.dz2);
  if (s <= -ws.foot) return base;
  const D = s - u;
  if (!(D > 0)) return base;
  const Dz = sz - uDz;

  const grade = roadGradeAt(seed, z);
  const A = grade.h - QUAY;
  const planeH = QUAY + (A * s) / D;
  const planeDx = A / D;
  const planeDz = (grade.dz * s) / D + A * (sz / D - (s * Dz) / (D * D));

  const wz = alongD(zr);
  const wi = inlandD(u);
  const w = ws.v * wz.v * wi.v;
  const wDx = ws.dx * wz.v * wi.v + ws.v * wz.v * wi.du;
  const wDz = ws.dz * wz.v * wi.v + ws.v * wz.dz * wi.v + ws.v * wz.v * wi.du * uDz;

  const gap = planeH - base.h;
  return {
    h: base.h + w * gap,
    dx: base.dx + wDx * gap + w * (planeDx - base.dx),
    dz: base.dz + wDz * gap + w * (planeDz - base.dz),
  };
}

/** Whether a world point stands on the made ground proper: inside the footprint, the blend and the bank not counted. */
export function inFootprint(seed: number, x: number, z: number): boolean {
  const zr = z - COVE_Z;
  if ((zr < 0 ? -zr : zr) > TOWN_Z_HALF || x - roadCenterX(seed, z) > TOWN_INLAND) return false;
  const site = siteFor(seed);
  return x - site.anchor.x - shoreXAt(shoreSplineOf(site), zr).v >= 0;
}
