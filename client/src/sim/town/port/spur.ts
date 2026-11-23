/**
 * The town's own track, a SPUR: it leaves the railroad's main line (`rail.ts`) at one end of the town, curves to the waterfront and runs
 * along it past the mill, the quay and the terminal, and ends there. A train cannot turn sharply, so the line is made from waypoints and every
 * corner is rounded with a circular arc of at least `SPUR_RADIUS` metres (an arc is found by bisection, so only `+ - * /` and `sqrt` are
 * used): where the two legs at a corner are too short to hold an arc of that radius the corner is straightened instead of rounded tighter.
 */
import { dist, type Vec } from "../geom.js";

/** The radius the spur's corners are rounded with, and the least any bend of it may have (a short-line railroad's practical least), metres. */
export const SPUR_RADIUS = 85;
export const SPUR_MIN_RADIUS = 65;
/** An arc is sampled by bisecting this many times: 2^n + 1 points. */
const ARC_BISECTIONS = 3;
/** A corner turning less than this (the cosine of its angle) is left as it is. */
const STRAIGHT = 0.9995;

function unit(a: Vec, b: Vec): { u: Vec; len: number } {
  const len = dist(a, b);
  return { u: { x: (b.x - a.x) / len, z: (b.z - a.z) / len }, len };
}

/** The points of the arc about `c` from `e` to `x` (both on it, `r` from `c`), ends included. */
function arc(c: Vec, e: Vec, x: Vec, r: number): Vec[] {
  const pts: Vec[] = [e, x];
  for (let level = 0; level < ARC_BISECTIONS; level++) {
    const next: Vec[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i] as Vec;
      const q = pts[i + 1] as Vec;
      const mx = (p.x - c.x + (q.x - c.x)) / 2;
      const mz = (p.z - c.z + (q.z - c.z)) / 2;
      const l = Math.sqrt(mx * mx + mz * mz);
      next.push(p, { x: c.x + (mx / l) * r, z: c.z + (mz / l) * r });
    }
    next.push(pts[pts.length - 1] as Vec);
    pts.length = 0;
    pts.push(...next);
  }
  return pts;
}

/** The waypoints joined by straight legs, every corner rounded with an arc of `radius` (or straightened where the legs are too short). */
export function roundedPath(waypoints: readonly Vec[], radius = SPUR_RADIUS): Vec[] {
  const out: Vec[] = [waypoints[0] as Vec];
  // The distance already used up at the start of each leg by the previous corner's arc.
  let used = 0;
  for (let i = 1; i < waypoints.length - 1; i++) {
    const a = waypoints[i - 1] as Vec;
    const v = waypoints[i] as Vec;
    const b = waypoints[i + 1] as Vec;
    const l1 = unit(a, v);
    const l2 = unit(v, b);
    if (!(l1.len > 1e-6) || !(l2.len > 1e-6)) continue;
    const cos = l1.u.x * l2.u.x + l1.u.z * l2.u.z;
    if (cos >= STRAIGHT) {
      out.push(v);
      used = 0;
      continue;
    }
    const cross = l1.u.x * l2.u.z - l1.u.z * l2.u.x;
    const sin = Math.abs(cross);
    // tan(half the turn) = sin / (1 + cos); a back-tracking corner (cos = -1) is not rounded.
    if (1 + cos < 1e-6) {
      out.push(v);
      used = 0;
      continue;
    }
    const tan = sin / (1 + cos);
    const t = radius * tan;
    // Each leg gives half its length to each of its two corners at most; the first and last legs give the whole of it to their one corner.
    const room1 = (i === 1 ? l1.len : l1.len / 2) - used;
    const room2 = i === waypoints.length - 2 ? l2.len : l2.len / 2;
    if (t > room1 || t > room2) {
      out.push(v);
      used = 0;
      continue;
    }
    const e = { x: v.x - l1.u.x * t, z: v.z - l1.u.z * t };
    const x = { x: v.x + l2.u.x * t, z: v.z + l2.u.z * t };
    // The centre lies on the inside of the turn, `radius` from the entry along the leg's normal.
    const side = cross > 0 ? 1 : -1;
    const c = { x: e.x - l1.u.z * radius * side, z: e.z + l1.u.x * radius * side };
    out.push(...arc(c, e, x, radius));
    used = t;
  }
  out.push(waypoints[waypoints.length - 1] as Vec);
  return out;
}

/** The least radius of curvature along a polyline: the circle through each three consecutive points (collinear ones are straight, and skipped); Infinity if it has no curve. */
export function leastRadius(points: readonly Vec[]): number {
  let least = Infinity;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1] as Vec;
    const b = points[i] as Vec;
    const c = points[i + 1] as Vec;
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (cross < 1e-9) continue;
    const r = (dist(a, b) * dist(b, c) * dist(c, a)) / (2 * cross);
    if (r < least) least = r;
  }
  return least;
}

/**
 * The runs of a polyline's points for which `wet` holds, each widened by one point either side where `widen` holds for it (so the trestle's ends stand on the ground
 * the track comes from, and not on a pier's deck), as indices of the first and last point inclusive; runs that touch are one.
 */
export function wetRuns(points: readonly Vec[], wet: (p: Vec) => boolean, widen: (p: Vec) => boolean = () => true): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = 0; i <= points.length; i++) {
    const w = i < points.length && wet(points[i] as Vec);
    if (w && start < 0) start = i;
    if (!w && start >= 0) {
      const from = start > 0 && widen(points[start - 1] as Vec) ? start - 1 : start;
      const to = i < points.length && widen(points[i] as Vec) ? i : i - 1;
      const last = out[out.length - 1];
      if (last !== undefined && from <= last.to) last.to = to;
      else out.push({ from, to });
      start = -1;
    }
  }
  return out;
}

/** The polyline with points added along its long legs so that no two are more than `step` metres apart (every point of the original is kept). */
export function densify(points: readonly Vec[], step: number): Vec[] {
  const out: Vec[] = [points[0] as Vec];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec;
    const b = points[i] as Vec;
    const n = Math.max(1, -Math.floor(-dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** The circumradius of three points (Infinity where they lie on a line). */
function circum(a: Vec, b: Vec, c: Vec): number {
  const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  if (cross < 1e-9) return Infinity;
  return (dist(a, b) * dist(b, c) * dist(c, a)) / (2 * cross);
}

/**
 * A polyline whose every bend has a radius of at least `minRadius`: where the points still turn tighter (a corner the arcs could not round, the
 * legs being too short) each such point and its neighbours are drawn toward the average of theirs, pass after pass, until none does (or
 * `SPUR_SMOOTH_PASSES` passes are spent). The first `keepStart` points and the last are held, so the turnout's tangent and the end stand.
 */
export function relaxed(points: readonly Vec[], minRadius: number, keepStart: number): Vec[] {
  let cur = points.map((p) => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < SPUR_SMOOTH_PASSES; pass++) {
    const tight: boolean[] = cur.map(() => false);
    let any = false;
    for (let i = 1; i < cur.length - 1; i++) {
      if (circum(cur[i - 1] as Vec, cur[i] as Vec, cur[i + 1] as Vec) < minRadius) {
        any = true;
        tight[i - 1] = true;
        tight[i] = true;
        tight[i + 1] = true;
      }
    }
    if (!any) break;
    const next = cur.map((p) => ({ x: p.x, z: p.z }));
    for (let i = keepStart; i < cur.length - 1; i++) {
      if (!tight[i]) continue;
      const a = cur[i - 1] as Vec;
      const b = cur[i] as Vec;
      const c = cur[i + 1] as Vec;
      next[i] = { x: 0.5 * b.x + 0.25 * (a.x + c.x), z: 0.5 * b.z + 0.25 * (a.z + c.z) };
    }
    cur = next;
  }
  return cur;
}

/** The most passes of `relaxed`. */
export const SPUR_SMOOTH_PASSES = 3000;
