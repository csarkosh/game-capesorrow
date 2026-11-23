/**
 * The plane geometry of a junction: where the legs' curb lines meet, the curb returns between them, how far each leg's
 * roadway and its verge, sidewalk and curb are held back from the junction, and the polygons of the junction's pavement and
 * of each corner's sidewalk. Pure arithmetic (`+ - * /`, `abs`, `min`, `max`, `floor`, `sqrt`): no angle is computed. A corner's
 * angle is carried as the cosine and sine of the turn from one leg to the next (`dot` and `cross` of their unit directions).
 *
 * The legs run out from the junction, counter-clockwise by direction; the corner between a leg and the next is bounded by the
 * first leg's left curb (the side the turn goes toward) and the second leg's right curb. A curb return is the arc of the
 * corner's radius tangent to both, `reach` from where they meet; a through street's far side (a straight wedge) is no corner at
 * all.
 */
import type { JunctionCorner, Vec } from "./types.js";

/** The longest tangent a curb return may have, metres: an acute corner keeps its tangent here and takes the radius that gives it (authored). */
export const REACH_MAX = 10;

/** What the solver needs of a leg. */
export type Ray = {
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly from: number;
  readonly half: number;
  readonly outer: number;
};

export type Solved = {
  readonly corners: JunctionCorner[];
  readonly bandLeft: number[];
  readonly bandRight: number[];
  readonly mouth: number[];
};

/** A point of a leg: `s` along it and `side` times its half width to the left (negative to the right). */
export function onLeg(r: Ray, s: number, side: number): Vec {
  return { x: r.x + r.dx * s - r.dz * side, z: r.z + r.dz * s + r.dx * side };
}

/** The distance along a leg's direction from its reference point to a point. */
function along(r: Ray, p: Vec): number {
  return (p.x - r.x) * r.dx + (p.z - r.z) * r.dz;
}

/** Where line `pa + s da` meets line `pb + u db`, or null when they are parallel. */
function meet(pa: Vec, da: Vec, pb: Vec, db: Vec): Vec | null {
  const k = da.x * db.z - da.z * db.x;
  if (Math.abs(k) < 1e-9) return null;
  const s = ((pb.x - pa.x) * db.z - (pb.z - pa.z) * db.x) / k;
  return { x: pa.x + da.x * s, z: pa.z + da.z * s };
}

/**
 * The corners of a junction and how far back from it each leg's parts begin. `rays` are in counter-clockwise order;
 * `radiusFor(i, j)` is the nominal radius of the corner between rays i and j.
 */
export function solveJunction(rays: readonly Ray[], radiusFor: (i: number, j: number) => number): Solved {
  const n = rays.length;
  const corners: JunctionCorner[] = [];
  const bandLeft: number[] = rays.map((r) => Math.max(0, r.from));
  const bandRight: number[] = rays.map((r) => Math.max(0, r.from));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = rays[i] as Ray;
    const b = rays[j] as Ray;
    const cross = a.dx * b.dz - a.dz * b.dx;
    const dot = a.dx * b.dx + a.dz * b.dz;
    const nominal = radiusFor(i, j);
    const da = { x: a.dx, z: a.dz };
    const db = { x: b.dx, z: b.dz };
    if (Math.abs(cross) < 1e-3 && dot < 0) {
      // A straight wedge: a through street's far side. The curb and the verge and sidewalk run on, unbroken.
      const sa = Math.max(0, a.from);
      const sb = Math.max(0, b.from);
      corners.push({ from: i, to: j, shape: "straight", radius: 0, nominal, reach: 0, v: null, ta: onLeg(a, sa, a.half), tb: onLeg(b, sb, -b.half), c: null, lot: null });
      continue;
    }
    const pa = onLeg(a, 0, a.half);
    const pb = onLeg(b, 0, -b.half);
    const v = meet(pa, da, pb, db) ?? pa;
    const lot = meet(onLeg(a, 0, a.outer), da, onLeg(b, 0, -b.outer), db);
    if (cross <= 1e-3) {
      // Reflex (a wedge over a half turn) or parallel: a sharp corner of the pavement, with no return.
      corners.push({ from: i, to: j, shape: "sharp", radius: 0, nominal, reach: 0, v, ta: v, tb: v, c: null, lot });
      bandLeft[i] = Math.max(bandLeft[i] as number, along(a, v));
      bandRight[j] = Math.max(bandRight[j] as number, along(b, v));
      continue;
    }
    // A square or obtuse corner keeps the tangent of a square one (`nominal`) and takes the radius that gives it; an acute one
    // keeps the nominal radius until its tangent would pass `REACH_MAX`, then the tangent stops there.
    const reach = dot <= 0 ? nominal : Math.min((nominal * (1 + dot)) / cross, REACH_MAX);
    const radius = (reach * cross) / (1 + dot);
    const ta = { x: v.x + da.x * reach, z: v.z + da.z * reach };
    const tb = { x: v.x + db.x * reach, z: v.z + db.z * reach };
    const k = radius / cross;
    const c = { x: v.x + (da.x + db.x) * k, z: v.z + (da.z + db.z) * k };
    corners.push({ from: i, to: j, shape: "arc", radius, nominal, reach, v, ta, tb, c, lot });
    bandLeft[i] = Math.max(bandLeft[i] as number, along(a, ta));
    bandRight[j] = Math.max(bandRight[j] as number, along(b, tb));
  }
  const mouth = rays.map((_, i) => Math.max(bandLeft[i] as number, bandRight[i] as number));
  return { corners, bandLeft, bandRight, mouth };
}

/** The points of an arc from `ta` to `tb` (inclusive) about `c`, by chord, the number of steps from the angle's size. */
export function arcPoints(c: Vec, ta: Vec, tb: Vec, radius: number): Vec[] {
  const chord = Math.sqrt((ta.x - tb.x) * (ta.x - tb.x) + (ta.z - tb.z) * (ta.z - tb.z));
  const steps = Math.max(2, Math.min(10, -Math.floor(-(chord / Math.max(radius, 0.1)) / 0.22)));
  const out: Vec[] = [];
  const u0 = { x: (ta.x - c.x) / radius, z: (ta.z - c.z) / radius };
  const u1 = { x: (tb.x - c.x) / radius, z: (tb.z - c.z) / radius };
  for (let k = 0; k <= steps; k++) {
    const w = { x: u0.x + (u1.x - u0.x) * (k / steps), z: u0.z + (u1.z - u0.z) * (k / steps) };
    const len = Math.sqrt(w.x * w.x + w.z * w.z) || 1;
    out.push({ x: c.x + (w.x / len) * radius, z: c.z + (w.z / len) * radius });
  }
  return out;
}

/** What the polygons need of a leg: a ray and its band and mouth distances. */
export type ShapedLeg = Ray & { readonly mouth: number; readonly bandLeft: number; readonly bandRight: number };

function dedupe(pts: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(last.x - p.x) > 1e-4 || Math.abs(last.z - p.z) > 1e-4) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0] as Vec;
    const b = out[out.length - 1] as Vec;
    if (Math.abs(a.x - b.x) <= 1e-4 && Math.abs(a.z - b.z) <= 1e-4) out.pop();
    else break;
  }
  return out;
}

/**
 * The junction's pavement: the roadway inside the legs' mouths, bounded by each leg's curbs out to its mouth and, between
 * legs, the curb return (an arc, or a straight edge, or a sharp corner). Counter-clockwise (positive area). Not convex.
 */
export function pavementPolygon(legs: readonly ShapedLeg[], corners: readonly JunctionCorner[]): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i] as ShapedLeg;
    pts.push(onLeg(l, l.bandRight, -l.half), onLeg(l, l.mouth, -l.half), onLeg(l, l.mouth, l.half), onLeg(l, l.bandLeft, l.half));
    const k = corners[i] as JunctionCorner;
    if (k.shape === "arc" && k.c !== null) {
      const arc = arcPoints(k.c, k.ta, k.tb, k.radius);
      for (let m = 1; m < arc.length - 1; m++) pts.push(arc[m] as Vec);
    } else if (k.shape === "sharp" && k.v !== null) pts.push(k.v);
  }
  return dedupe(pts);
}

/**
 * The sidewalk of an arc corner, one piece: from the first leg's lot line in to its curb, along the curb and the return to the
 * second leg's curb and out to its lot line, and back along the two lot lines to where they meet. Convex.
 */
export function cornerPolygon(a: ShapedLeg, b: ShapedLeg, k: JunctionCorner): Vec[] {
  if (k.shape === "straight" || k.lot === null) return [];
  const pts: Vec[] = [onLeg(a, a.bandLeft, a.outer), onLeg(a, a.bandLeft, a.half)];
  if (k.shape === "arc" && k.c !== null) pts.push(...arcPoints(k.c, k.ta, k.tb, k.radius));
  else if (k.v !== null) pts.push(k.v);
  pts.push(onLeg(b, b.bandRight, -b.half), onLeg(b, b.bandRight, -b.outer), k.lot);
  return dedupe(pts);
}

/** The signed area of a polygon (positive counter-clockwise in x, z). */
export function areaOf(p: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Vec;
    const b = p[(i + 1) % p.length] as Vec;
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

/** Whether two simple polygons share area: an edge of one crosses an edge of the other, or one holds a corner of the other. Touching is no overlap. */
export function polygonsOverlap(p: readonly Vec[], q: readonly Vec[]): boolean {
  if (p.length < 3 || q.length < 3) return false;
  let px0 = Infinity;
  let px1 = -Infinity;
  let pz0 = Infinity;
  let pz1 = -Infinity;
  for (const v of p) {
    px0 = Math.min(px0, v.x);
    px1 = Math.max(px1, v.x);
    pz0 = Math.min(pz0, v.z);
    pz1 = Math.max(pz1, v.z);
  }
  let qx0 = Infinity;
  let qx1 = -Infinity;
  let qz0 = Infinity;
  let qz1 = -Infinity;
  for (const v of q) {
    qx0 = Math.min(qx0, v.x);
    qx1 = Math.max(qx1, v.x);
    qz0 = Math.min(qz0, v.z);
    qz1 = Math.max(qz1, v.z);
  }
  if (px1 <= qx0 + 1e-6 || qx1 <= px0 + 1e-6 || pz1 <= qz0 + 1e-6 || qz1 <= pz0 + 1e-6) return false;
  const EPS = 1e-4;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Vec;
    const b = p[(i + 1) % p.length] as Vec;
    for (let k = 0; k < q.length; k++) {
      const c = q[k] as Vec;
      const d = q[(k + 1) % q.length] as Vec;
      const rx = b.x - a.x;
      const rz = b.z - a.z;
      const sx = d.x - c.x;
      const sz = d.z - c.z;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
      const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) return true;
    }
  }
  return insideStrictly(p, q[0] as Vec) || insideStrictly(q, p[0] as Vec);
}

/** Whether a point lies strictly inside a simple polygon (even-odd). */
export function insideStrictly(poly: readonly Vec[], pt: Vec): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec;
    const b = poly[j] as Vec;
    if (a.z > pt.z !== b.z > pt.z && pt.x < ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

// ---- Curb ramps (the research's section 2).
/** The curb's face above the gutter, 6 in (section 1, WSDOT's curb and gutter section). */
export const CURB_FACE = 0.15;
/** A ramp's clear width, 4 ft (WSDOT, PROWAG); its running slope at most 8.3 percent (1:12); its landing 4 by 4 ft; its dome panel 2 ft deep. */
export const RAMP_WIDTH = 1.22;
export const RAMP_SLOPE = 0.083;
export const RAMP_LANDING = 1.22;
export const DOME_DEPTH = 0.61;
/** The ramp's run, from the foot on the gutter up to its landing: the curb's face over the slope, rounded up so the slope is under the limit. */
export const RAMP_RUN = -Math.floor(-((CURB_FACE / RAMP_SLOPE) * 100)) / 100;

/** One curb ramp: at the foot of a leg's side, inside the leg's crosswalk, leading from the roadway up to the sidewalk. */
export type Ramp = {
  /** The leg (an index into the junction's legs) whose crosswalk it serves, and the side of the leg it stands on: 1 left of the leg's direction, -1 right. */
  readonly leg: number;
  readonly side: 1 | -1;
  /** From and to along the leg (from its reference point): its width, inside the crosswalk. */
  readonly s0: number;
  readonly s1: number;
};

/**
 * The ramps of a junction: one at each side of each leg's crosswalk (two per corner of a four-way: one per crossing direction), at
 * the middle of the crosswalk, which begins at the leg's mouth. None where the corners were not rebuilt, nor on the highway's
 * edge (no sidewalk there) nor on a closed leg.
 */
export function rampsOf(legs: readonly { readonly mouth: number; readonly marked: boolean; readonly engine: boolean; readonly closed: boolean; readonly walk: number }[], ramps: boolean, crosswalk: { marked: number; unmarked: number }): Ramp[] {
  if (!ramps) return [];
  const out: Ramp[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i] as (typeof legs)[number];
    if (l.engine || l.closed || !(l.walk > 0)) continue;
    const mid = l.mouth + (l.marked ? crosswalk.marked : crosswalk.unmarked) / 2;
    for (const side of [1, -1] as const) out.push({ leg: i, side, s0: mid - RAMP_WIDTH / 2, s1: mid + RAMP_WIDTH / 2 });
  }
  return out;
}
