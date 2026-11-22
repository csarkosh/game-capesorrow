/**
 * What the plan may know of the ground: the shoreline and the highway as functions of z, read from
 * a `TownSite`'s samples, and the few facts the history is built on (the shore's own line).
 */
import { nearestBearing, type Bearing } from "./bearings.js";
import type { Vec, Poly } from "./geom.js";
import type { TownSite } from "./site.js";

function sampleAt(site: TownSite, arr: readonly number[], z: number): number {
  const f = (z - site.z0) / site.step;
  const last = arr.length - 1;
  if (f <= 0) return arr[0]!;
  if (f >= last) return arr[last]!;
  const i = Math.floor(f);
  const t = f - i;
  return arr[i]! + (arr[i + 1]! - arr[i]!) * t;
}

/** The shoreline's x at z (linear between samples). */
export function shoreAt(site: TownSite, z: number): number {
  return sampleAt(site, site.shoreX, z);
}

/** The highway's centre line's x at z. */
export function roadAt(site: TownSite, z: number): number {
  return sampleAt(site, site.roadX, z);
}

/** The highest z the site's samples reach. */
export function zEnd(site: TownSite): number {
  return site.z0 + (site.shoreX.length - 1) * site.step;
}

/** The shoreline as points no more than about 5 m apart, from south to north. */
export function shoreLine(site: TownSite): Vec[] {
  const out: Vec[] = [];
  const n = site.shoreX.length;
  const sub = Math.max(1, Math.floor(site.step / 5) + 1);
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const z = site.z0 + (i + k / sub) * site.step;
      out.push({ x: shoreAt(site, z), z });
    }
  }
  out.push({ x: site.shoreX[n - 1]!, z: zEnd(site) });
  return out;
}

/** Least-squares slope dx/dz of the shoreline over z in [zlo, zhi]. */
export function shoreSlope(site: TownSite, zlo: number, zhi: number): number {
  let n = 0;
  let sz = 0;
  let sx = 0;
  let szz = 0;
  let szx = 0;
  for (let i = 0; i < site.shoreX.length; i++) {
    const z = site.z0 + i * site.step;
    if (z < zlo || z > zhi) continue;
    const x = site.shoreX[i]!;
    n++;
    sz += z;
    sx += x;
    szz += z * z;
    szx += z * x;
  }
  const den = n * szz - sz * sz;
  return n < 2 || den === 0 ? 0 : (n * szx - sz * sx) / den;
}

export type ShoreFacts = {
  /** The highway's direction through the town at the anchor (z within 150 m), as the nearest grid bearing. */
  readonly roadBearing: Bearing;
  /** The z of the cove's middle: the middle of the stretch where the shore stands furthest inland near the anchor. */
  readonly coveZ: number;
};

/** The highway's slope dx/dz by least squares over z in [zlo, zhi]. */
export function roadSlope(site: TownSite, zlo: number, zhi: number): number {
  let n = 0;
  let sz = 0;
  let sx = 0;
  let szz = 0;
  let szx = 0;
  for (let i = 0; i < site.roadX.length; i++) {
    const z = site.z0 + i * site.step;
    if (z < zlo || z > zhi) continue;
    const x = site.roadX[i]!;
    n++;
    sz += z;
    sx += x;
    szz += z * z;
    szx += z * x;
  }
  const den = n * szz - sz * sz;
  return n < 2 || den === 0 ? 0 : (n * szx - sz * sx) / den;
}

/** What the history is built on: the highway's own line at the anchor, and where the cove's middle is. */
export function analyseShore(site: TownSite): ShoreFacts {
  let best = -Infinity;
  for (let i = 0; i < site.shoreX.length; i++) {
    const z = site.z0 + i * site.step;
    if (Math.abs(z) <= 220 && site.shoreX[i]! > best) best = site.shoreX[i]!;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < site.shoreX.length; i++) {
    const z = site.z0 + i * site.step;
    if (Math.abs(z) <= 220 && site.shoreX[i]! >= best - 25) {
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return { roadBearing: nearestBearing(roadSlope(site, -150, 150), 1), coveZ: (lo + hi) / 2 };
}

/** Does a point stand on land, at least `margin` m inland of the shoreline? */
export function onLand(site: TownSite, p: Vec, margin = 0): boolean {
  return p.x >= shoreAt(site, p.z) + margin;
}

/** Does a whole polygon stand on land (corners, and points along the edges every 2.5 m)? */
export function polyOnLand(site: TownSite, poly: Poly, margin = 0): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.floor(len / 2.5));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (!onLand(site, { x: a.x + dx * t, z: a.z + dz * t }, margin)) return false;
    }
  }
  return true;
}
