/**
 * Plane geometry for the plan: points, convex polygons, clipping, separating-axis overlap, frames.
 * Only `+ - * /`, `Math.floor`, `Math.abs`, `Math.min`, `Math.max` and `Math.sqrt` are used, so every
 * machine computes the same bits. Polygons are convex and wound the same way (positive signed area
 * in (x, z)): `orient` makes them so.
 */
import type { Bearing } from "./bearings.js";
import { bearingU, bearingV } from "./bearings.js";

export type Vec = { x: number; z: number };
export type Poly = Vec[];

/** A grid's frame: an origin and the two unit axes; local (u, v) <-> site (x, z). */
export type Frame = { readonly o: Vec; readonly U: Vec; readonly V: Vec };

export function frameOf(o: Vec, bearing: Bearing): Frame {
  return { o, U: bearingU(bearing), V: bearingV(bearing) };
}

export function toWorld(f: Frame, u: number, v: number): Vec {
  return { x: f.o.x + u * f.U.x + v * f.V.x, z: f.o.z + u * f.U.z + v * f.V.z };
}

export function toLocal(f: Frame, p: Vec): { u: number; v: number } {
  const dx = p.x - f.o.x;
  const dz = p.z - f.o.z;
  return { u: dx * f.U.x + dz * f.U.z, v: dx * f.V.x + dz * f.V.z };
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.z * b.z;
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, z: a.z * k };
}

export function length(a: Vec): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

export function dist(a: Vec, b: Vec): number {
  return length(sub(a, b));
}

export function lerpVec(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** The signed area (positive when the corners run counter-clockwise in (x, z) with x right and z up). */
export function area(p: Poly): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

/** The polygon wound to positive area. */
export function orient(p: Poly): Poly {
  return area(p) < 0 ? p.slice().reverse() : p;
}

export function centroid(p: Poly): Vec {
  let x = 0;
  let z = 0;
  for (const q of p) {
    x += q.x;
    z += q.z;
  }
  return { x: x / p.length, z: z / p.length };
}

export function bbox(p: readonly Vec[]): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    z0 = Math.min(z0, q.z);
    x1 = Math.max(x1, q.x);
    z1 = Math.max(z1, q.z);
  }
  return { x0, z0, x1, z1 };
}

/** A rectangle in a frame, as a positively wound polygon. */
export function localRect(f: Frame, u0: number, u1: number, v0: number, v1: number): Poly {
  return orient([toWorld(f, u0, v0), toWorld(f, u1, v0), toWorld(f, u1, v1), toWorld(f, u0, v1)]);
}

/** Keep the part of a convex polygon where n.p >= d (Sutherland-Hodgman). */
export function clipHalfPlane(poly: Poly, n: Vec, d: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = a.x * n.x + a.z * n.z - d;
    const sb = b.x * n.x + b.z * n.z - d;
    if (sa >= 0) out.push(a);
    if ((sa >= 0 && sb < 0) || (sa < 0 && sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return dedupe(out);
}

/** Drops corners that repeat (within a millimetre) and collapses a polygon of fewer than three. */
export function dedupe(p: Poly): Poly {
  const out: Poly = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - q.x) > 1e-3 || Math.abs(last.z - q.z) > 1e-3) out.push(q);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a.x - b.x) <= 1e-3 && Math.abs(a.z - b.z) <= 1e-3) out.pop();
    else break;
  }
  return out.length < 3 ? [] : out;
}

/** Reduces a convex polygon to at most `n` corners by dropping the corner whose triangle is smallest (the result lies inside). */
export function simplifyTo(p: Poly, n: number): Poly {
  let q = p;
  while (q.length > n) {
    let best = 0;
    let bestA = Infinity;
    for (let i = 0; i < q.length; i++) {
      const a = q[(i + q.length - 1) % q.length]!;
      const b = q[i]!;
      const c = q[(i + 1) % q.length]!;
      const tri = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
      if (tri < bestA) {
        bestA = tri;
        best = i;
      }
    }
    q = q.filter((_, i) => i !== best);
  }
  return q;
}

/** Is a point inside (or on, within `tol`) a positively wound convex polygon? */
export function contains(poly: Poly, p: Vec, tol = 0): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const cross = ex * (p.z - a.z) - ez * (p.x - a.x);
    // cross / |e| is the signed distance to the edge's line (left of a counter-clockwise edge is inside).
    if (cross < -tol * Math.sqrt(ex * ex + ez * ez)) return false;
  }
  return true;
}

/** Is `inner` inside `outer` (every corner within `tol`)? Both convex, so the corners decide. */
export function polyInside(inner: Poly, outer: Poly, tol = 0): boolean {
  for (const p of inner) if (!contains(outer, p, tol)) return false;
  return true;
}

/** The depth to which two convex polygons overlap (separating axis); 0 or less when they only touch or are apart. */
export function overlapDepth(p: Poly, q: Poly): number {
  let least = Infinity;
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      let nx = b.z - a.z;
      let nz = a.x - b.x;
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len === 0) continue;
      nx /= len;
      nz /= len;
      let p0 = Infinity;
      let p1 = -Infinity;
      for (const c of p) {
        const s = c.x * nx + c.z * nz;
        p0 = Math.min(p0, s);
        p1 = Math.max(p1, s);
      }
      let q0 = Infinity;
      let q1 = -Infinity;
      for (const c of q) {
        const s = c.x * nx + c.z * nz;
        q0 = Math.min(q0, s);
        q1 = Math.max(q1, s);
      }
      const o = Math.min(p1, q1) - Math.max(p0, q0);
      if (o <= 0) return o;
      least = Math.min(least, o);
    }
  }
  return least;
}

/** The distance from a point to a segment. */
export function segDist(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + abx * t);
  const dz = p.z - (a.z + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** The parameters (t along a-b, s along c-d) where two segments cross, or null. */
export function segCross(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; s: number } | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (den === 0) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const s = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { t, s };
}

/** The distance between two segments. */
export function segSegDist(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segCross(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

/** The rectangle of a building: centre, half extents along u and v, and a frame's axes. */
export function orientedRect(c: Vec, halfU: number, halfV: number, U: Vec, V: Vec): Poly {
  const mk = (su: number, sv: number): Vec => ({
    x: c.x + U.x * halfU * su + V.x * halfV * sv,
    z: c.z + U.z * halfU * su + V.z * halfV * sv,
  });
  return orient([mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1)]);
}
