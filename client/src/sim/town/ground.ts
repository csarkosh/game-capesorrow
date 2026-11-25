/**
 * The town's made ground: the town stands on fill, as the real ports of this coast do, but not on a table. Where the
 * plan built (its blocks, grown by a margin: `cover.ts`) the ground is a graded plane over the coast's own: `QUAY`
 * metres above the sea at the water's edge, rising inland at a grade set at each z by the two ends it joins (the
 * quay and the highway's height there), so the plane's height at the highway IS the highway's grade line all along
 * the town, easing to a hill of constant grade (0.06) inland of the highway. The plane keeps a share of the coast's own
 * shape and of relief of its own (`relief` below), none of it on the fill, within `QUAY_LEVEL` metres of the quay, by the
 * water's edge or along the highway, where the ground is level and exact. Beyond the plan's edge the ground is the
 * coast's own, the cover falling to 0 over `COVER_FADE` metres. At the water's edge the made ground ends in a bank of
 * `BANK` metres, down to the coast's own ground below the tide line.
 *
 * Same contract as the coast's own stages: `dx`/`dz` are the EXACT analytic derivatives of `h`, and where the cover is 0
 * the base sample is returned as the same object. The simulation's arithmetic.
 */
import { COVE_Z, roadCenterX, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { fbm2d } from "@csarkosh/engine/sim/field";
import { COVER, COVER_FADE, COVER_HOLD, COVER_OUT_FADE, COVER_OUT_HOLD, COVER_SPUR_FADE, COVER_SPUR_HOLD, coverInto } from "./cover.js";
import { FILL, QUAY_BANK, STEP, fillWindowInto, smootherstepD, smootherstepInto, type FillArea } from "./fill.js";
import { QUAY_HEIGHT } from "./levels.js";
import { planFor } from "./planFor.js";
import { SITE_HALF, SITE_INLAND, SITE_STEP, siteFor } from "./siteFor.js";
import { SHORE, shoreSplineOf, shoreXAtInto, type ShoreSpline } from "./shoreSpline.js";
import type { TownSite } from "./site.js";
import type { TownPlan } from "./types.js";

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
  smootherstepInto(TOWN_Z_HALF, TOWN_Z_HALF + EDGE, zr < 0 ? -zr : zr);
  return { v: 1 - STEP.v, dz: -STEP.d * (zr < 0 ? -1 : 1) };
}

/** The footprint's window inland: 1 up to `TOWN_INLAND` from the highway, 0 beyond the blend, and its slope in u. */
export function inlandD(u: number): { v: number; du: number } {
  smootherstepInto(TOWN_INLAND, TOWN_INLAND + EDGE, u);
  return { v: 1 - STEP.v, du: -STEP.d };
}

/** Where `bankInto` leaves its answer: the weight, its partials and the bank's foot. Read at once, before any other call. */
const BANKR = { v: 0, dx: 0, dz: 0, foot: 0 };

/**
 * The bank's weight at a point `s` metres landward of the water's edge (`s` having slope `sz` in z), where
 * the shore's own slope in z is `q` (and `q2` that slope's slope): 0 seaward of the bank's foot, 1 from the
 * edge landward. The bank is `BANK` metres wide measured across the shore, not along x, so where the shore
 * runs east and west along a headland's flank the bank is no steeper than elsewhere. Left in `BANKR`.
 */
function bankInto(s: number, sz: number, q: number, q2: number): void {
  const r = Math.sqrt(1 + q * q);
  smootherstepInto(-BANK, 0, s / r);
  BANKR.v = STEP.v;
  BANKR.dx = STEP.d / r;
  BANKR.dz = STEP.d * (sz / r - (s * q * q2) / (r * r * r));
  BANKR.foot = BANK * r;
}

/**
 * The bank's weight at a point `s` metres landward of the water's edge (`s` having slope `sz` in z), where
 * the shore's own slope in z is `q` (and `q2` that slope's slope): 0 seaward of the bank's foot, 1 from the
 * edge landward. The bank is `BANK` metres wide measured across the shore, not along x, so where the shore
 * runs east and west along a headland's flank the bank is no steeper than elsewhere.
 */
export function bankD(s: number, sz: number, q: number, q2: number): { v: number; dx: number; dz: number; foot: number } {
  bankInto(s, sz, q, q2);
  return { v: BANKR.v, dx: BANKR.dx, dz: BANKR.dz, foot: BANKR.foot };
}

/** Where the grade changes from the flats' to the hill's, in metres of offset from the highway: across it the x-slope eases by a quintic. */
export const HILL_FROM = -4;
export const HILL_TO = 30;
/** The hill's grade east of the highway, rise over run. */
export const HILL_GRADE = 0.04;
/** Landward of the water's edge the plane's grade comes up from 0 to the flats' over this many metres across the shore, so the fill seaward of it (flat at the quay's height) joins it with no crease. */
export const QUAY_JOIN = 8;

/**
 * The relief the made ground keeps. `RELIEF_FLATS` and `RELIEF_HILL` are the share of the coast's own height above the plane that
 * stays, on the flats and on the hill (changing across the highway's offset `RELIEF_HILL_FROM` to `RELIEF_HILL_TO`), and `RELIEF_LIMIT`
 * the most it can come to either way, metres: the coast's own humps and hollows under the town are tens of metres across and
 * several high, and a rational saturation, `L y / (L + |y|)`, keeps what a town is built on and flattens what it would not be.
 * `OWN_FLATS` and `OWN_HILL` are the amplitude of relief of the town's own, from the engine's noise with exact derivatives, at
 * wavelength `OWN_WAVE`. None of it stands on the fill or within `QUAY_LEVEL` metres of the quay (the working waterfront is
 * level), rising over the next `QUAY_RAMP`; none within `RELIEF_HIGHWAY_FROM` metres of the highway, rising to all of it by
 * `RELIEF_HIGHWAY_TO`; none within `RELIEF_SHORE_FROM` metres of the water's edge, all of it by `RELIEF_SHORE_TO`.
 */
export const RELIEF_FLATS = 0.2;
export const RELIEF_HILL = 0.3;
export const RELIEF_LIMIT = 2;
export const RELIEF_HILL_FROM = 0;
export const RELIEF_HILL_TO = 80;
export const OWN_FLATS = 3.0;
export const OWN_HILL = 2.0;
export const OWN_WAVE = 140;
export const OWN_OCTAVES = 1;
export const OWN_SALT = 0x7e11ef;
export const QUAY_LEVEL = 14;
export const QUAY_RAMP = 70;
export const RELIEF_HIGHWAY_FROM = 14;
export const RELIEF_HIGHWAY_TO = 80;
export const RELIEF_SHORE_FROM = 12;
export const RELIEF_SHORE_TO = 70;
/** The obliquity of the shore, in the relief's own distance from the water's edge, is held under this, smoothly, so a headland's flank (a shore running near east and west) does not make the window flicker far inland. */
export const RELIEF_OBLIQUE = 3;

/** Where `joinInto` leaves its answer. */
const JOIN = { k: 0, s: 0 };

/** The quintic smootherstep and the integral of it, which is the hill's rise across the join: on [0, 1], K(t) = t^6 - 3 t^5 + 2.5 t^4. Left in `JOIN`. */
function joinInto(u: number): void {
  const span = HILL_TO - HILL_FROM;
  const t = (u - HILL_FROM) / span;
  if (t <= 0) {
    JOIN.k = 0;
    JOIN.s = 0;
    return;
  }
  if (t >= 1) {
    JOIN.k = u - HILL_FROM - span / 2;
    JOIN.s = 1;
    return;
  }
  const t2 = t * t;
  JOIN.k = span * t2 * t2 * (t2 - 3 * t + 2.5);
  JOIN.s = t2 * t * (t * (t * 6 - 15) + 10);
}

/**
 * The coast's own hill steepens inland, so the plane's grade eases up from `HILL_GRADE` by `HILL_EXTRA` between `FAR_FROM` and `FAR_FROM + FAR_SPAN`
 * metres of offset from the highway, which keeps the made ground within a few metres of the coast's own where the town ends.
 * `farD` is the integral of that ease, `K`'s own form: on [0, 1], W (t^6 - 3 t^5 + 2.5 t^4), and its slope.
 */
export const HILL_EXTRA = 0.04;
export const FAR_FROM = 200;
export const FAR_SPAN = 220;

/** Where `farInto` leaves its answer. */
const FAR = { k: 0, s: 0 };

function farInto(u: number): void {
  const t = (u - FAR_FROM) / FAR_SPAN;
  if (t <= 0) {
    FAR.k = 0;
    FAR.s = 0;
    return;
  }
  if (t >= 1) {
    FAR.k = u - FAR_FROM - FAR_SPAN / 2;
    FAR.s = 1;
    return;
  }
  const t2 = t * t;
  FAR.k = FAR_SPAN * t2 * t2 * (t2 - 3 * t + 2.5);
  FAR.s = t2 * t * (t * (t * 6 - 15) + 10);
}

/** The rise of the join at the highway itself: what the flats' grade must make up so the plane meets the grade line there. */
joinInto(0);
const JOIN_AT_HIGHWAY = JOIN.k;

/** Where `footInto` leaves its answer. */
const FOOT = { v: 0, d: 0 };

/** The plane's seaward foot: 0 seaward of the water's edge, the identity from `QUAY_JOIN` landward, a quintic ease between. Left in `FOOT`. */
function footInto(y: number): void {
  if (y <= 0) {
    FOOT.v = 0;
    FOOT.d = 0;
    return;
  }
  if (y >= QUAY_JOIN) {
    FOOT.v = y;
    FOOT.d = 1;
    return;
  }
  smootherstepInto(0, QUAY_JOIN, y);
  const ev = STEP.v;
  const ed = STEP.d;
  FOOT.v = y * ev;
  FOOT.d = ev + y * ed;
}

/** What the made ground declares of itself for the level id: every constant that shapes it. */
export const GROUND_TUNABLES: Readonly<Record<string, number>> = {
  TOWN_GROUND: 10,
  QUAY,
  EDGE,
  TOWN_Z_HALF,
  TOWN_INLAND,
  BANK,
  HILL_FROM,
  HILL_TO,
  HILL_GRADE,
  HILL_EXTRA,
  FAR_FROM,
  FAR_SPAN,
  QUAY_JOIN,
  QUAY_BANK,
  COVER_HOLD,
  COVER_FADE,
  COVER_OUT_HOLD,
  COVER_OUT_FADE,
  COVER_SPUR_HOLD,
  COVER_SPUR_FADE,
  RELIEF_FLATS,
  RELIEF_HILL,
  RELIEF_LIMIT,
  RELIEF_HILL_FROM,
  RELIEF_HILL_TO,
  OWN_FLATS,
  OWN_HILL,
  OWN_WAVE,
  OWN_OCTAVES,
  OWN_SALT,
  QUAY_LEVEL,
  QUAY_RAMP,
  RELIEF_HIGHWAY_FROM,
  RELIEF_HIGHWAY_TO,
  RELIEF_SHORE_FROM,
  RELIEF_SHORE_TO,
  RELIEF_OBLIQUE,
  SITE_STEP,
  SITE_HALF,
};

/** What a seed's ground reads at every sample, found once: the plan, the site, the shore's spline, and the box the plan's fill lies in (its bank included). */
type Context = { plan: TownPlan; site: TownSite; spline: ShoreSpline; fillBox: { x0: number; z0: number; x1: number; z1: number } };

const CONTEXTS = new Map<number, Context>();

const NO_FILL: readonly FillArea[] = [];

function contextOf(seed: number): Context {
  let c = CONTEXTS.get(seed);
  if (c === undefined) {
    const plan = planFor(seed);
    const site = siteFor(seed);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const area of plan.fill) {
      for (const p of area.polygon) {
        x0 = Math.min(x0, p.x - QUAY_BANK);
        z0 = Math.min(z0, p.z - QUAY_BANK);
        x1 = Math.max(x1, p.x + QUAY_BANK);
        z1 = Math.max(z1, p.z + QUAY_BANK);
      }
    }
    c = { plan, site, spline: shoreSplineOf(site), fillBox: { x0, z0, x1, z1 } };
    CONTEXTS.set(seed, c);
  }
  return c;
}

/** A weight with its partials in x and z. */
type Weight = { v: number; dx: number; dz: number };

/** Where `reliefWindowInto` leaves its answer. Read at once, before any other call. */
const RELIEF = { v: 0, dx: 0, dz: 0 };

/**
 * Where the relief window opens, 0 to 1 with its partials: closed on the fill, within `QUAY_LEVEL` metres of the quay, within
 * `RELIEF_HIGHWAY_FROM` metres of the highway and within `RELIEF_SHORE_FROM` of the water's edge, each opening smoothly. `y` is
 * the distance across the shore (with its z partial `yDz`), `u` the offset from the highway (with `uDz`), `fv` the fill's weight
 * (with its partials `fdx`, `fdz`). Left in `RELIEF`.
 */
function reliefWindowInto(quay: { a: { x: number; z: number }; b: { x: number; z: number } }, xf: number, zr: number, y: number, yDx: number, yDz: number, u: number, uDz: number, fv: number, fdx: number, fdz: number): void {
  smootherstepInto(RELIEF_SHORE_FROM, RELIEF_SHORE_TO, y);
  const shoreV = STEP.v;
  const shoreD = STEP.d;
  if (shoreV === 0) {
    RELIEF.v = 0;
    RELIEF.dx = 0;
    RELIEF.dz = 0;
    return;
  }
  const au = u < 0 ? -u : u;
  smootherstepInto(RELIEF_HIGHWAY_FROM, RELIEF_HIGHWAY_TO, au);
  const hwV = STEP.v;
  const hwD = STEP.d;
  if (hwV === 0) {
    RELIEF.v = 0;
    RELIEF.dx = 0;
    RELIEF.dz = 0;
    return;
  }
  const qx = quay.b.x - quay.a.x;
  const qz = quay.b.z - quay.a.z;
  const t = Math.max(0, Math.min(1, ((xf - quay.a.x) * qx + (zr - quay.a.z) * qz) / (qx * qx + qz * qz)));
  const ex = xf - (quay.a.x + t * qx);
  const ez = zr - (quay.a.z + t * qz);
  const d = Math.sqrt(ex * ex + ez * ez);
  smootherstepInto(QUAY_LEVEL, QUAY_LEVEL + QUAY_RAMP, d);
  const qV = STEP.v;
  const qD = STEP.d;
  if (qV === 0) {
    RELIEF.v = 0;
    RELIEF.dx = 0;
    RELIEF.dz = 0;
    return;
  }
  const sign = u < 0 ? -1 : 1;
  // The product of the four windows, one at a time: each (v, dx, dz) times the next.
  let kv = shoreV;
  let kdx = shoreD * yDx;
  let kdz = shoreD * yDz;
  let bv = hwV;
  let bdx = hwD * sign;
  let bdz = hwD * sign * uDz;
  let nv = kv * bv;
  let ndx = kdx * bv + kv * bdx;
  let ndz = kdz * bv + kv * bdz;
  kv = nv;
  kdx = ndx;
  kdz = ndz;
  bv = qV;
  bdx = (qD * ex) / d;
  bdz = (qD * ez) / d;
  nv = kv * bv;
  ndx = kdx * bv + kv * bdx;
  ndz = kdz * bv + kv * bdz;
  kv = nv;
  kdx = ndx;
  kdz = ndz;
  bv = 1 - fv;
  bdx = -fdx;
  bdz = -fdz;
  RELIEF.v = kv * bv;
  RELIEF.dx = kdx * bv + kv * bdx;
  RELIEF.dz = kdz * bv + kv * bdz;
}

/**
 * Where the relief window opens, 0 to 1 with its partials: closed on the fill, within `QUAY_LEVEL` metres of the quay, within
 * `RELIEF_HIGHWAY_FROM` metres of the highway and within `RELIEF_SHORE_FROM` of the water's edge, each opening smoothly. `y` is
 * the distance across the shore (with its z partial `yDz`), `u` the offset from the highway (with `uDz`), `fillV` the fill's weight.
 */
export function reliefWindow(quay: { a: { x: number; z: number }; b: { x: number; z: number } }, xf: number, zr: number, y: number, yDx: number, yDz: number, u: number, uDz: number, fill: Weight): Weight {
  reliefWindowInto(quay, xf, zr, y, yDx, yDz, u, uDz, fill.v, fill.dx, fill.dz);
  return { v: RELIEF.v, dx: RELIEF.dx, dz: RELIEF.dz };
}

/** Where `planeInto` leaves its answer: the plane's height and slopes, and the shore's obliquity and its slope. Read at once, before any other call. */
const PLANE = { h: 0, dx: 0, dz: 0, r: 0, rDz: 0 };

/**
 * The graded plane at a point: `QUAY + gf * r * foot(s / r) + (HILL_GRADE - gf) * K(u)`, where `s` is the distance landward of the water's edge
 * (with its z slope `sz`), the shore's line there has slope `q` in z (and `q2` that slope's slope), `u` the offset from the highway (slope `uDz`). False where the shore and the highway are
 * too close for it to stand between them. With its height and exact slopes, and the shore's obliquity `r` and its slope, left in `PLANE`.
 */
function planeInto(seed: number, z: number, u: number, uDz: number, s: number, sz: number, q: number, q2: number): boolean {
  const D = s - u;
  const c = JOIN_AT_HIGHWAY;
  if (!(D > c)) return false;
  const Dz = sz - uDz;
  const grade = roadGradeAt(seed, z);
  const A = grade.h - QUAY;
  const gf = (A - HILL_GRADE * c) / (D - c);
  const gfDz = (grade.dz * (D - c) - (A - HILL_GRADE * c) * Dz) / ((D - c) * (D - c));
  const r = Math.sqrt(1 + q * q);
  const rDz = (q * q2) / r;
  const y = s / r;
  const yDz = sz / r - (s * rDz) / (r * r);
  footInto(y);
  const footV = FOOT.v;
  const footD = FOOT.d;
  joinInto(u);
  const joinK = JOIN.k;
  const joinS = JOIN.s;
  farInto(u);
  const farK = FAR.k;
  const farS = FAR.s;
  PLANE.h = QUAY + gf * r * footV + (HILL_GRADE - gf) * joinK + HILL_EXTRA * farK;
  PLANE.dx = gf * footD + (HILL_GRADE - gf) * joinS + HILL_EXTRA * farS;
  PLANE.dz = gfDz * r * footV + gf * rDz * footV + gf * r * footD * yDz - gfDz * joinK + (HILL_GRADE - gf) * joinS * uDz + HILL_EXTRA * farS * uDz;
  PLANE.r = r;
  PLANE.rDz = rDz;
  return true;
}

/** The graded plane alone, with no relief and no weight, at a world point whose offset from the highway is `u`: what the made ground is built over (null where it does not stand). */
export function madePlaneD(seed: number, x: number, z: number, u: number, uDz: number): TerrainSample | null {
  const ctx = contextOf(seed);
  const zr = z - COVE_Z;
  shoreXAtInto(ctx.spline, zr);
  const shV = SHORE.v;
  const shDz = SHORE.dz;
  const shDz2 = SHORE.dz2;
  if (!planeInto(seed, z, u, uDz, x - ctx.site.anchor.x - shV, -shDz, shDz, shDz2)) return null;
  return { h: PLANE.h, dx: PLANE.dx, dz: PLANE.dz };
}

/** Where `townGroundInto` leaves the made ground. Read at once, before any other call. */
export const GROUND = { h: 0, dx: 0, dz: 0 };

/**
 * The town's ground over the coast's (`bh`, `bdx`, `bdz`: the base sample's height and slopes), at a point whose offset from the highway is `u` (with
 * its slope in z, `uDz`), left in `GROUND`. Answers false, and writes nothing, where the base stands as it is.
 *
 * The plane is `QUAY + gf * r * foot(s / r) + (HILL_GRADE - gf) * K(u)`. `s` is the distance landward of the
 * water's edge and `r` the shore's obliquity, so `s / r` is the distance across the shore: the plane is flat
 * at `QUAY` seaward of the edge (where fill stands over the sea), and is no steeper along a headland's flank
 * than elsewhere. `gf` is the flats' grade, found per z so that the plane's height at the highway is exactly
 * the highway's grade line: `(A - HILL_GRADE * K(0)) / (D - K(0))`, `A` the grade line's height over `QUAY`,
 * `D` the highway's distance from the water's edge. `K` is the integral of a quintic ease from 0 to 1 over the
 * highway's few metres, so the x-slope goes from `gf` to the hill's grade without a crease.
 *
 * The made ground is the plane over the base by the weight `w` (the plan's cover and the water's bank, united smoothly with
 * the plan's fill), keeping relief: `h = base + w * (plane - base + kept + own)`, where `kept` is a saturated share of
 * the coast's own height over the plane and `own` the town's own low relief, both by the relief window.
 */
export function townGroundInto(seed: number, x: number, z: number, u: number, uDz: number, bh: number, bdx: number, bdz: number, fill?: readonly FillArea[]): boolean {
  const ctx = contextOf(seed);
  const site = ctx.site;
  const xf = x - site.anchor.x;
  const zr = z - COVE_Z;
  coverInto(ctx.plan, xf, zr, false);
  const covV = COVER.v;
  const covDx = COVER.dx;
  const covDz = COVER.dz;
  // The plan's fill matters only near it: a point beyond its box is not asked.
  const areas = fill ?? (xf < ctx.fillBox.x0 || xf > ctx.fillBox.x1 || zr < ctx.fillBox.z0 || zr > ctx.fillBox.z1 ? NO_FILL : ctx.plan.fill);
  if (covV === 0 && areas.length === 0) return false;
  shoreXAtInto(ctx.spline, zr);
  const shV = SHORE.v;
  const shDz = SHORE.dz;
  const shDz2 = SHORE.dz2;
  const s = xf - shV;
  const sz = -shDz;
  bankInto(s, sz, shDz, shDz2);
  const bankV = BANKR.v;
  const bankDx = BANKR.dx;
  const bankDz = BANKR.dz;
  const bankFoot = BANKR.foot;

  // The cover and the bank, united smoothly with the plan's fill.
  let fpV = 0;
  let fpDx = 0;
  let fpDz = 0;
  if (covV > 0 && s > -bankFoot) {
    fpV = bankV * covV;
    fpDx = bankDx * covV + bankV * covDx;
    fpDz = bankDz * covV + bankV * covDz;
  }
  let wV = fpV;
  let wDx = fpDx;
  let wDz = fpDz;
  let fV = 0;
  let fDx = 0;
  let fDz = 0;
  if (areas.length > 0) {
    fillWindowInto(areas, xf, zr);
    fV = FILL.v;
    fDx = FILL.dx;
    fDz = FILL.dz;
    wV = 1 - (1 - fpV) * (1 - fV);
    wDx = (1 - fV) * fpDx + (1 - fpV) * fDx;
    wDz = (1 - fV) * fpDz + (1 - fpV) * fDz;
  }
  if (wV === 0) return false;

  if (!planeInto(seed, z, u, uDz, s, sz, shDz, shDz2)) return false;
  const planeH = PLANE.h;
  const planeDx = PLANE.dx;
  const planeDz = PLANE.dz;
  const r = PLANE.r;
  const rDz = PLANE.rDz;

  const gap = planeH - bh;
  let inside = gap;
  let insideDx = planeDx - bdx;
  let insideDz = planeDz - bdz;

  // The relief the town keeps.
  const span = RELIEF_OBLIQUE - 1;
  const rEff = 1 + ((r - 1) * span) / (span + (r - 1));
  const rEffDz = ((span * span) / ((span + (r - 1)) * (span + (r - 1)))) * rDz;
  reliefWindowInto(ctx.plan.quay, xf, zr, s / rEff, 1 / rEff, sz / rEff - (s * rEffDz) / (rEff * rEff), u, uDz, fV, fDx, fDz);
  const kV = RELIEF.v;
  const kDx = RELIEF.dx;
  const kDz = RELIEF.dz;
  if (kV > 0) {
    smootherstepInto(RELIEF_HILL_FROM, RELIEF_HILL_TO, u);
    const hillV = STEP.v;
    const hillD = STEP.d;
    const share = RELIEF_FLATS + (RELIEF_HILL - RELIEF_FLATS) * hillV;
    const shareDx = (RELIEF_HILL - RELIEF_FLATS) * hillD;
    const shareDz = shareDx * uDz;
    // The share kept, y = share * window * (base - plane), saturated at RELIEF_LIMIT.
    const kwV = kV * share;
    const kwDx = kDx * share + kV * shareDx;
    const kwDz = kDz * share + kV * shareDz;
    const delta = -gap;
    const yv = kwV * delta;
    const yx = kwDx * delta + kwV * -insideDx;
    const yz = kwDz * delta + kwV * -insideDz;
    const L = RELIEF_LIMIT;
    const ay = yv < 0 ? -yv : yv;
    const keptV = (L * yv) / (L + ay);
    const keptD = (L * L) / ((L + ay) * (L + ay));
    // The town's own relief.
    const amp = OWN_FLATS + (OWN_HILL - OWN_FLATS) * hillV;
    const ampDx = (OWN_HILL - OWN_FLATS) * hillD;
    const ampDz = ampDx * uDz;
    const n = fbm2d(x / OWN_WAVE, z / OWN_WAVE, seed ^ OWN_SALT, OWN_OCTAVES);
    const ownV = kV * amp * n.v;
    const ownDx = (kDx * amp + kV * ampDx) * n.v + (kV * amp * n.dx) / OWN_WAVE;
    const ownDz = (kDz * amp + kV * ampDz) * n.v + (kV * amp * n.dz) / OWN_WAVE;
    inside += keptV + ownV;
    insideDx += keptD * yx + ownDx;
    insideDz += keptD * yz + ownDz;
  }
  GROUND.h = bh + wV * inside;
  GROUND.dx = bdx + wDx * inside + wV * insideDx;
  GROUND.dz = bdz + wDz * inside + wV * insideDz;
  return true;
}

/** The town's ground over the coast's (`base`), at a point whose offset from the highway is `u` (with its slope in z, `uDz`): the made ground, and `base` itself where the town does not reach (see `townGroundInto`). */
export function townGroundD(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample, fill?: readonly FillArea[]): TerrainSample {
  if (!townGroundInto(seed, x, z, u, uDz, base.h, base.dx, base.dz, fill)) return base;
  return { h: GROUND.h, dx: GROUND.dx, dz: GROUND.dz };
}

/** Whether a world point stands on the made ground proper: inside the footprint, the blend and the bank not counted. */
export function inFootprint(seed: number, x: number, z: number): boolean {
  const zr = z - COVE_Z;
  if ((zr < 0 ? -zr : zr) > TOWN_Z_HALF || x - roadCenterX(seed, z) > TOWN_INLAND) return false;
  const site = siteFor(seed);
  shoreXAtInto(shoreSplineOf(site), zr);
  return x - site.anchor.x - SHORE.v >= 0;
}
