/**
 * The town's own track as the world has it: the plan's spur (`plan.rail.spurs`, a polyline in the town's frame) in the world's frame
 * with the heights of its bed, and the trestles where it crosses the cove's head. A pure function of the world's seed (the plan and the
 * ground the engine leaves), found once.
 *
 * - **The bed's height** along the track, by arclength `s`: at its start the main line's grade line (the spur leaves the main line's bench
 *   there, so the two beds are one), easing over `SPUR_EASE` metres to the made ground's own height along the track (a spur on the quay
 *   and the flats sits on ground the town made level), then smoothed, so a bump of the ground is not a bump of the rail; on a trestle it is
 *   the deck's level, `DECK_TOP`, the quay's apron height.
 * - **A trestle** stands over each wet stretch of the plan: its deck is ground a player walks on (`spurTrestleTopAt`, the same mechanism
 *   as the main line's, `railDeck.ts`), `TRESTLE_TOP` over the bed, the top coming up from the bed over `TRESTLE_TAPER` metres at each end.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { smootherstepD } from "./fill.js";
import { railCenterX } from "./rail.js";
import { DECK_TOP } from "./levels.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";

/** The spur's bed eases from the main line's height to the ground's over this many metres of track. */
export const SPUR_EASE = 45;
/** ... or this many metres for each metre the ground stands off the main line's height 100 m along (a railroad's grade of 2.5 percent). */
export const SPUR_EASE_PER_M = 40;
/** The bed's grade is held to this (rise over run): a train does not climb more, and the bed leaves the ground where the ground does. The spur ends where the bed stands more than `SPUR_CUT` metres off the ground (100 m past its start at least). */
export const SPUR_GRADE = 0.035;
export const SPUR_CUT = 2;
/** The bed's height is smoothed by this many passes of a three-point average along the track's points. */
export const SPUR_SMOOTH = 4;

export type SpurPoint = { readonly x: number; readonly z: number; readonly s: number; readonly h: number; readonly wet: boolean };

export type SpurRun = {
  /** The indices of the first and last point of a trestle's stretch. */
  readonly from: number;
  readonly to: number;
  /** A box about it (its points grown by the deck's half width), for a quick refusal. */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
};

export type SpurTrack = {
  readonly points: readonly SpurPoint[];
  readonly trestles: readonly SpurRun[];
};

const TRACKS = new Map<number, SpurTrack | null>();

/** The spur of a world seed, in the world's frame with its bed's heights, or null where the town has none. */
export function spurOf(seed: number): SpurTrack | null {
  let hit = TRACKS.get(seed);
  if (hit === undefined) {
    hit = build(seed);
    TRACKS.set(seed, hit);
  }
  return hit;
}

function build(seed: number): SpurTrack | null {
  const plan = planFor(seed);
  const spur = plan.rail.spurs[0];
  if (spur === undefined) return null;
  const a = siteFor(seed).anchor;
  const n = spur.points.length;
  const wetAt: boolean[] = spur.points.map(() => false);
  for (const r of spur.wet) for (let i = r.from; i <= r.to; i++) wetAt[i] = true;
  const xs = spur.points.map((p) => a.x + p.x);
  const zs = spur.points.map((p) => a.z + p.z);
  // The spur leaves the main line: its first point is put on the line's own centre (the plan has the line from its site samples, to a few decimetres).
  xs[0] = railCenterX(seed, zs[0] as number);
  const ss: number[] = [0];
  for (let i = 1; i < n; i++) {
    const dx = (xs[i] as number) - (xs[i - 1] as number);
    const dz = (zs[i] as number) - (zs[i - 1] as number);
    ss.push((ss[i - 1] as number) + Math.sqrt(dx * dx + dz * dz));
  }
  const g0 = roadGradeAt(seed, zs[0] as number).h;
  let k100 = n - 1;
  for (let i = 0; i < n; i++) {
    if ((ss[i] as number) >= 100) {
      k100 = i;
      break;
    }
  }
  const ease = Math.max(SPUR_EASE, SPUR_EASE_PER_M * Math.abs(Math.max(DECK_TOP, elevationSampleAt(seed, xs[k100] as number, zs[k100] as number).h) - g0));
  let h: number[] = [];
  for (let i = 0; i < n; i++) {
    if (wetAt[i]) {
      h.push(DECK_TOP);
      continue;
    }
    // The made ground (or a deck on piles over the water) is no lower than the quay's apron: the bed stands at least that high.
    const ground = Math.max(DECK_TOP, elevationSampleAt(seed, xs[i] as number, zs[i] as number).h);
    const e = smootherstepD(0, ease, ss[i] as number).v;
    h.push(g0 + (ground - g0) * e);
  }
  for (let pass = 0; pass < SPUR_SMOOTH; pass++) {
    const next = h.slice();
    for (let i = 1; i < n - 1; i++) if (!wetAt[i]) next[i] = ((h[i - 1] as number) + 2 * (h[i] as number) + (h[i + 1] as number)) / 4;
    h = next;
  }
  // The grade held: forward from the main line's height, then back from the end, then forward again; the deck's level on a trestle stays.
  const ground: number[] = [];
  for (let i = 0; i < n; i++) ground.push(wetAt[i] ? DECK_TOP : Math.max(DECK_TOP, elevationSampleAt(seed, xs[i] as number, zs[i] as number).h));
  for (const dir of [1, -1, 1]) {
    for (let k = 1; k < n; k++) {
      const i = dir === 1 ? k : n - 1 - k;
      const j = dir === 1 ? i - 1 : i + 1;
      if (wetAt[i]) continue;
      const lim = SPUR_GRADE * Math.abs((ss[i] as number) - (ss[j] as number));
      h[i] = Math.max((h[j] as number) - lim, Math.min((h[j] as number) + lim, h[i] as number));
    }
  }
  // Where the bed would stand more than `SPUR_CUT` off the ground (past the first 100 m), the track ends: it does not run into a hill or float over a gully.
  let end = n;
  for (let i = 0; i < n; i++) {
    if ((ss[i] as number) > 100 && !wetAt[i] && Math.abs((h[i] as number) - (ground[i] as number)) > SPUR_CUT) {
      end = i;
      break;
    }
  }
  while (end > 1 && wetAt[end - 1]) end--;
  const points: SpurPoint[] = [];
  for (let i = 0; i < end; i++) points.push({ x: xs[i] as number, z: zs[i] as number, s: ss[i] as number, h: h[i] as number, wet: wetAt[i] as boolean });
  const reach = 3;
  const trestles: SpurRun[] = spur.wet.filter((r) => r.to < end).map((r) => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = r.from; i <= r.to; i++) {
      x0 = Math.min(x0, xs[i] as number);
      x1 = Math.max(x1, xs[i] as number);
      z0 = Math.min(z0, zs[i] as number);
      z1 = Math.max(z1, zs[i] as number);
    }
    return { from: r.from, to: r.to, x0: x0 - reach, z0: z0 - reach, x1: x1 + reach, z1: z1 + reach };
  });
  return { points, trestles };
}

/** The bed's height at arclength `s` (linear between the points). */
export function spurHeightAt(track: SpurTrack, s: number): number {
  const p = track.points;
  if (s <= 0) return (p[0] as SpurPoint).h;
  for (let i = 1; i < p.length; i++) {
    const b = p[i] as SpurPoint;
    if (s <= b.s) {
      const a = p[i - 1] as SpurPoint;
      return a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s);
    }
  }
  return (p[p.length - 1] as SpurPoint).h;
}

/** The nearest point of a trestle's polyline to (x, z): its distance, arclength and the unit vector from it to the point. */
export function nearOnRun(track: SpurTrack, run: SpurRun, x: number, z: number): { d: number; s: number; nx: number; nz: number; qx: number; qz: number } {
  let best = { d: Infinity, s: 0, nx: 0, nz: 0, qx: 0, qz: 0 };
  for (let i = run.from + 1; i <= run.to; i++) {
    const a = track.points[i - 1] as SpurPoint;
    const b = track.points[i] as SpurPoint;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    let t = l2 === 0 ? 0 : ((x - a.x) * ex + (z - a.z) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t;
    const qz = a.z + ez * t;
    const dx = x - qx;
    const dz = z - qz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best.d) best = { d, s: a.s + (b.s - a.s) * t, nx: d > 1e-9 ? dx / d : 1, nz: d > 1e-9 ? dz / d : 0, qx, qz };
  }
  return best;
}
