/**
 * Where streets end. A grid street runs only as far as the last block it serves: `pruneStreets` cuts every stub that
 * reaches past its last intersection or its last fronting lot (the street at the grid's outer edge stays where it has
 * blocks on one side only), and `findEnds` names what each street's two ends are: a junction with another street or the
 * highway (no end to make), a landing at the water, or an END made by the plan, a turnaround or a barricade, with the
 * pavement stopping at a clean line and gravel beyond for a few metres.
 */
import { dist, lerpVec, segCross, segDist, type Poly, type Vec } from "../geom.js";
import { chance, type Rng } from "../rng.js";
import { shoreAt } from "../shore.js";
import type { TownSite } from "../site.js";
import type { EndKind, Street, StreetEnd, StreetKind } from "../types.js";

/** The kinds of street a grid is made of: these are the ones cut back to what they serve. */
const GRID: readonly StreetKind[] = ["street", "main", "avenue"];
/** A block is adjacent to a street where its edge is within this of the street's right of way, metres. */
export const ADJACENT = 1.2;
/** A street ends this far past the last lot it fronts, metres. */
export const PAST_LAST_LOT = 4;
/** An intersection counts where a block corner lies within the two streets' half widths and this much, metres. */
const JUNCTION_REACH = 10;
/** The least a street may be left, metres. */
const LEAST = 8;
/** Ends this near the water are landings, metres. */
export const LANDING_REACH = 30;
/** How near another street's right of way an end must be to be a junction, metres. */
const TOUCH = 0.6;

type Way = { readonly a: Vec; readonly b: Vec; readonly width: number; readonly kind: StreetKind };

type Box = { x0: number; z0: number; x1: number; z1: number };

function boxOf(poly: Poly): Box {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

/** The distance from a point to a polygon's edges, 0 if the polygon holds it. */
function polyDist(poly: Poly, box: Box, p: Vec, reach: number): number {
  if (p.x < box.x0 - reach || p.x > box.x1 + reach || p.z < box.z0 - reach || p.z > box.z1 + reach) return Infinity;
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) d = Math.min(d, segDist(p, poly[k] as Vec, poly[(k + 1) % poly.length] as Vec));
  return d;
}

/** The street that carries traffic past a point of another street: not the rail, not the wharf's deck. */
function isRoad(k: StreetKind): boolean {
  return k !== "rail" && k !== "wharf";
}

/**
 * Every grid street cut back to the last block it serves or the last intersection beside a block. Streets that serve
 * nothing are dropped. Run twice, so that a street left hanging by another's cutting is cut in turn.
 */
export function pruneStreets<T extends Way>(raw: readonly T[], blocks: readonly Poly[]): T[] {
  const boxes = blocks.map(boxOf);
  let cur: T[] = raw.slice();
  for (let pass = 0; pass < 2; pass++) {
    const next: T[] = [];
    for (const st of cur) {
      if (!GRID.includes(st.kind)) {
        next.push(st);
        continue;
      }
      const len = dist(st.a, st.b);
      const hw = st.width / 2;
      const n = Math.max(2, -Math.floor(-len / 2));
      let lo = Infinity;
      let hi = -Infinity;
      // The stretch with a block alongside it.
      for (let k = 0; k <= n; k++) {
        const s = (len * k) / n;
        const p = lerpVec(st.a, st.b, s / len);
        let near = false;
        for (let b = 0; b < blocks.length && !near; b++) if (polyDist(blocks[b] as Poly, boxes[b] as Box, p, hw + ADJACENT) <= hw + ADJACENT) near = true;
        if (near) {
          lo = Math.min(lo, s - PAST_LAST_LOT);
          hi = Math.max(hi, s + PAST_LAST_LOT);
        }
      }
      // And each intersection with another street that a block stands beside.
      for (const o of cur) {
        if (o === st || !isRoad(o.kind)) continue;
        let s = NaN;
        const c = segCross(st.a, st.b, o.a, o.b);
        if (c) s = c.t * len;
        else if (segDist(o.a, st.a, st.b) < TOUCH) s = project(st, o.a, len);
        else if (segDist(o.b, st.a, st.b) < TOUCH) s = project(st, o.b, len);
        if (Number.isNaN(s)) continue;
        const at = lerpVec(st.a, st.b, s / len);
        const reach = hw + o.width / 2 + JUNCTION_REACH;
        let supported = false;
        for (let b = 0; b < blocks.length && !supported; b++) if (polyDist(blocks[b] as Poly, boxes[b] as Box, at, reach) <= reach) supported = true;
        if (supported) {
          lo = Math.min(lo, s);
          hi = Math.max(hi, s);
        }
      }
      if (lo > hi) continue;
      lo = Math.max(0, lo);
      hi = Math.min(len, hi);
      if (hi - lo < LEAST) continue;
      if (lo === 0 && hi === len) next.push(st);
      else next.push({ ...st, a: lerpVec(st.a, st.b, lo / len), b: lerpVec(st.a, st.b, hi / len) });
    }
    cur = next;
  }
  return cur;
}

/** The distance along a street's own line to the point nearest `p`. */
function project(st: Way, p: Vec, len: number): number {
  const dx = st.b.x - st.a.x;
  const dz = st.b.z - st.a.z;
  return Math.max(0, Math.min(len, ((p.x - st.a.x) * dx + (p.z - st.a.z) * dz) / len));
}

/** Whether a point lies on another street's right of way (grown a little), the highway's and every grid street's alike. */
function touchesStreet(streets: readonly Street[], skip: number, p: Vec): boolean {
  for (const o of streets) {
    if (o.id === skip || !isRoad(o.kind)) continue;
    if (segDist(p, o.a, o.b) <= o.width / 2 + TOUCH) return true;
  }
  return false;
}

/**
 * What each end of each street is. A junction has no end to make. An end within `LANDING_REACH` of the natural shore or of the
 * quay is a landing; any other is made: a turnaround or a barricade, drawn from a stream of its own.
 */
export function findEnds(streets: readonly Street[], site: TownSite, quay: { a: Vec; b: Vec }, fill: readonly { polygon: Poly }[], rng: Rng): StreetEnd[] {
  const ends: StreetEnd[] = [];
  for (const st of streets) {
    if (!GRID.includes(st.kind) && st.kind !== "alley") continue;
    for (const at of ["a", "b"] as const) {
      const p = at === "a" ? st.a : st.b;
      const q = at === "a" ? st.b : st.a;
      if (touchesStreet(streets, st.id, p)) continue;
      const len = dist(p, q);
      const dir = { x: (p.x - q.x) / len, z: (p.z - q.z) / len };
      const water = p.x - shoreAt(site, p.z) < LANDING_REACH || segDist(p, quay.a, quay.b) < LANDING_REACH || fill.some((f) => f.polygon.some((c) => dist(c, p) < LANDING_REACH));
      const kind: EndKind = water ? "landing" : chance(rng, 0.55) ? "turnaround" : "barricade";
      ends.push({ street: st.id, at, x: p.x, z: p.z, dx: dir.x, dz: dir.z, kind });
    }
  }
  return ends;
}
