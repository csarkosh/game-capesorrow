/**
 * Where the town's streets and the roads out of it cross the railroad's main line.
 *
 * `crossingsFor(plan, worldSeed)` reads them from the plan's streets and roads against `railCenterX`: a street segment (or a
 * road's step) crosses the line where its x less the line's x changes sign, found by bisection. It is behind this one function
 * so that it can be pointed at a list the plan itself keeps. Alleys, the wharf, the highway and the town's own rail are no
 * crossing; a street that meets the line at under about twelve degrees is none either.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { railCenterX } from "./rail.js";
import type { TownPlan } from "./types.js";

/** Where a way crosses the line, in the world. */
export type RailCrossing = {
  /** A stable index along the list. */
  readonly id: number;
  /** What crosses: a street's id, or a road's id (`road` is then true). */
  readonly way: number;
  readonly road: boolean;
  /** The crossing's point on the line's centre, in the world. */
  readonly x: number;
  readonly z: number;
  /** The way's unit direction there, from the highway's side to the sea's (`dx` is then negative or zero: the way runs seaward). */
  readonly dx: number;
  readonly dz: number;
  /** The way's roadway and its whole right of way, metres, at the crossing. */
  readonly roadway: number;
  readonly width: number;
  /** Whether it is paved. */
  readonly paved: boolean;
};

/** A way meeting the line more obliquely than this (the sine of the angle) is no crossing. */
export const CROSSING_MIN_SIN = 0.2;

const CACHE = new Map<number, readonly RailCrossing[]>();

function side(seed: number, x: number, z: number): number {
  return x - railCenterX(seed, z);
}

/** The point of the segment (ax, az)-(bx, bz) where it crosses the line, or null. */
function cross(seed: number, ax: number, az: number, bx: number, bz: number): { x: number; z: number } | null {
  const sa = side(seed, ax, az);
  const sb = side(seed, bx, bz);
  if (!((sa < 0 && sb >= 0) || (sa >= 0 && sb < 0))) return null;
  let lo = 0;
  let hi = 1;
  let slo = sa;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const s = side(seed, ax + (bx - ax) * mid, az + (bz - az) * mid);
    if ((s < 0) === (slo < 0)) {
      lo = mid;
      slo = s;
    } else hi = mid;
  }
  const t = (lo + hi) / 2;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
}

/** The town's crossings of the main line, in the world, ordered by z. */
export function crossingsFor(plan: TownPlan, worldSeed: number, anchor: { x: number; z: number }): readonly RailCrossing[] {
  const hit = CACHE.get(worldSeed);
  if (hit !== undefined) return hit;
  const raw: Omit<RailCrossing, "id">[] = [];
  const consider = (way: number, road: boolean, a: { x: number; z: number }, b: { x: number; z: number }, roadway: number, width: number, paved: boolean): void => {
    const ax = anchor.x + a.x;
    const az = anchor.z + a.z;
    const bx = anchor.x + b.x;
    const bz = anchor.z + b.z;
    const p = cross(worldSeed, ax, az, bx, bz);
    if (p === null) return;
    const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (!(len > 1e-6)) return;
    let dx = (bx - ax) / len;
    let dz = (bz - az) / len;
    if (dx > 0) {
      dx = -dx;
      dz = -dz;
    }
    // The line's own direction there, from two samples of it.
    const lx = railCenterX(worldSeed, p.z + 1) - railCenterX(worldSeed, p.z - 1);
    const ll = Math.sqrt(lx * lx + 4);
    const sin = abs(dx * (2 / ll) - dz * (lx / ll));
    if (sin < CROSSING_MIN_SIN) return;
    raw.push({ way, road, x: p.x, z: p.z, dx, dz, roadway, width, paved });
  };
  for (const st of plan.streets) {
    if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf" || st.kind === "alley") continue;
    consider(st.id, false, st.a, st.b, st.roadway, st.width, true);
  }
  for (const road of plan.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1] as { x: number; z: number; width: number; surface: string };
      const b = road.points[i] as { x: number; z: number; width: number; surface: string };
      consider(road.id, true, a, b, (a.width + b.width) / 2, (a.width + b.width) / 2 + 2, a.surface === "paved");
    }
  }
  raw.sort((p, q) => p.z - q.z || p.x - q.x);
  const out = raw.map((c, id) => ({ ...c, id }));
  CACHE.set(worldSeed, out);
  return out;
}

function abs(v: number): number {
  return v < 0 ? -v : v;
}
