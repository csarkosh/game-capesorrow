/**
 * The railroad's bed, for the whole coast: along the main line (`rail.ts`) the ground is a level bench across the track at
 * the highway's own grade line for that z, `RAIL_BENCH_HALF` metres either side of the centre, falling or rising to the
 * land's own shape over a bank: a fill on the downhill side and a cut on the uphill, as the engine's `corridorD` makes
 * the highway's own. Where the land (or the town's made ground) already stands at that height nothing changes.
 *
 * The engine lays the highway's corridor over a place's ground within 30 m of its centre, and the line runs 16 m off it,
 * so the ground the engine finally draws there is `w g + (1 - w) S` (`g` the grade line, `S` this stage's answer, `w` the
 * corridor's weight at that offset). To make the engine's final ground `(1 - k) N + k g` (`N` the ground with no railroad,
 * `k` the bed's weight, 1 on the bench and 0 beyond the bank), this stage answers `S = staged + k (g - staged)`: the
 * corridor's weight cancels, so the bench is exactly the grade line wherever it is whole, and the gradient is exact.
 *
 * The bank's width grows with how far the grade line stands from the land there (`m = g - N`): `BANK_MIN` on level ground
 * and `BANK_SLOPE` metres more for each metre of difference (saturating at `BANK_EXTRA` metres more), so a fill or a cut
 * on land that is itself gentle is under one in one, and only the land's own cliffs are steeper. Where the line would stand over the sea the bed is a causeway (the
 * same fill, reaching into the water) or, where the water is deep or the gap long, the ground is left and the track is
 * carried on a trestle (`railSpans.ts`): the bench's weight is then taken away by the trestle's own over a short ramp.
 *
 * An early exit on the offset makes every sample farther than `RAIL_REACH` metres from the line cost one comparison.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { corridorD } from "@csarkosh/engine/sim/road";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { RAIL_BED_HALF, RAIL_OFFSET } from "./rail.js";
import { RAIL_BANK_EXTRA, RAIL_BANK_MIN, RAIL_BANK_SLOPE, RAIL_BENCH_HALF, RAIL_SHOULDER, bankWidthD } from "./railBank.js";
import { SPAN_TUNABLES, trestleWeightAt } from "./railSpans.js";

/** Beyond this offset from the line's centre the bed has no say: the widest the bench and its bank can be. */
export const RAIL_REACH = RAIL_BENCH_HALF + RAIL_BANK_MIN + RAIL_BANK_EXTRA + 0.5;

export { RAIL_BANK_EXTRA, RAIL_BANK_MIN, RAIL_BANK_SLOPE, RAIL_BENCH_HALF, RAIL_SHOULDER };

/** What the bed declares of itself for the level id: every constant that shapes the ground it lays. */
export const RAIL_TUNABLES: Readonly<Record<string, number>> = {
  RAIL_OFFSET,
  RAIL_BED_HALF,
  RAIL_SHOULDER,
  RAIL_BANK_MIN,
  RAIL_BANK_SLOPE,
  RAIL_BANK_EXTRA,
  RAIL_GROUND: 1,
  ...SPAN_TUNABLES,
};

/**
 * The bed's weight at a point of offset `u` from the highway's centre (the line stands `RAIL_OFFSET` seaward of it), 1 on the
 * bench and 0 beyond the bank, with its partials in x and z. `m` is the grade line's height over the land there (with its
 * partials), `tw` the trestle's weight at z.
 */
export function benchWeightD(u: number, uDz: number, m: number, mDx: number, mDz: number, tw: { v: number; dz: number }): { v: number; dx: number; dz: number } {
  const off = u + RAIL_OFFSET;
  const a = off < 0 ? -off : off;
  if (a <= RAIL_BENCH_HALF) {
    if (tw.v === 0) return { v: 1, dx: 0, dz: 0 };
    return { v: 1 - tw.v, dx: 0, dz: -tw.dz };
  }
  const B = bankWidthD(m);
  const t = (a - RAIL_BENCH_HALF) / B.v;
  if (t >= 1) return { v: 0, dx: 0, dz: 0 };
  // A cubic ease (its steepest slope is 1.5 of the mean, where the quintic's is 1.875): a bank is no steeper in the middle than it need be.
  const ss = { v: t * t * (3 - 2 * t), d: 6 * t * (1 - t) };
  const sign = off < 0 ? -1 : 1;
  // t = (a - H) / B(m): its partials.
  const tDx = (sign - t * B.dm * mDx) / B.v;
  const tDz = (sign * uDz - t * B.dm * mDz) / B.v;
  const k = 1 - ss.v;
  const kDx = -ss.d * tDx;
  const kDz = -ss.d * tDz;
  if (tw.v === 0) return { v: k, dx: kDx, dz: kDz };
  return { v: k * (1 - tw.v), dx: kDx * (1 - tw.v), dz: kDz * (1 - tw.v) - k * tw.dz };
}

/**
 * The place's ground with the railroad's bed laid over it: `staged` is the town's ground over the coast's at a point whose
 * offset from the highway is `u` (slope `uDz`), the answer the highway's corridor is then laid over. Returns `staged` itself
 * (the same object) beyond `RAIL_REACH` of the line.
 */
export function railGroundD(seed: number, z: number, u: number, uDz: number, staged: TerrainSample): TerrainSample {
  const off = u + RAIL_OFFSET;
  if ((off < 0 ? -off : off) >= RAIL_REACH) return staged;
  const tw = trestleWeightAt(seed, z);
  if (tw.v >= 1) return staged;
  const grade = roadGradeAt(seed, z);
  // The ground the engine will leave here with no railroad: and how far the grade line stands from it.
  const n = corridorD(u, uDz, grade, staged);
  const m = grade.h - n.h;
  const k = benchWeightD(u, uDz, m, -n.dx, grade.dz - n.dz, tw);
  if (k.v === 0) return staged;
  const gap = grade.h - staged.h;
  return {
    h: staged.h + k.v * gap,
    dx: staged.dx + k.dx * gap - k.v * staged.dx,
    dz: staged.dz + k.dz * gap + k.v * (grade.dz - staged.dz),
  };
}
