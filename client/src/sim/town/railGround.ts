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
import { CORRIDOR, corridorInto } from "@csarkosh/engine/sim/road";
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

/** Where `benchWeightInto` leaves its answer. Read at once, before any other call. */
const BENCH = { v: 0, dx: 0, dz: 0 };

/**
 * The bed's weight at a point of offset `u` from the highway's centre (the line stands `RAIL_OFFSET` seaward of it), 1 on the
 * bench and 0 beyond the bank, with its partials in x and z, left in `BENCH`. `m` is the grade line's height over the land there (with its
 * partials), `twV` and `twDz` the trestle's weight at z and its slope.
 */
function benchWeightInto(u: number, uDz: number, m: number, mDx: number, mDz: number, twV: number, twDz: number): void {
  const off = u + RAIL_OFFSET;
  const a = off < 0 ? -off : off;
  if (a <= RAIL_BENCH_HALF) {
    if (twV === 0) {
      BENCH.v = 1;
      BENCH.dx = 0;
      BENCH.dz = 0;
      return;
    }
    BENCH.v = 1 - twV;
    BENCH.dx = 0;
    BENCH.dz = -twDz;
    return;
  }
  const B = bankWidthD(m);
  const t = (a - RAIL_BENCH_HALF) / B.v;
  if (t >= 1) {
    BENCH.v = 0;
    BENCH.dx = 0;
    BENCH.dz = 0;
    return;
  }
  // A cubic ease (its steepest slope is 1.5 of the mean, where the quintic's is 1.875): a bank is no steeper in the middle than it need be.
  const ssV = t * t * (3 - 2 * t);
  const ssD = 6 * t * (1 - t);
  const sign = off < 0 ? -1 : 1;
  // t = (a - H) / B(m): its partials.
  const tDx = (sign - t * B.dm * mDx) / B.v;
  const tDz = (sign * uDz - t * B.dm * mDz) / B.v;
  const k = 1 - ssV;
  const kDx = -ssD * tDx;
  const kDz = -ssD * tDz;
  if (twV === 0) {
    BENCH.v = k;
    BENCH.dx = kDx;
    BENCH.dz = kDz;
    return;
  }
  BENCH.v = k * (1 - twV);
  BENCH.dx = kDx * (1 - twV);
  BENCH.dz = kDz * (1 - twV) - k * twDz;
}

/**
 * The bed's weight at a point of offset `u` from the highway's centre (the line stands `RAIL_OFFSET` seaward of it), 1 on the
 * bench and 0 beyond the bank, with its partials in x and z. `m` is the grade line's height over the land there (with its
 * partials), `tw` the trestle's weight at z.
 */
export function benchWeightD(u: number, uDz: number, m: number, mDx: number, mDz: number, tw: { v: number; dz: number }): { v: number; dx: number; dz: number } {
  benchWeightInto(u, uDz, m, mDx, mDz, tw.v, tw.dz);
  return { v: BENCH.v, dx: BENCH.dx, dz: BENCH.dz };
}

/** Where `railGroundInto` leaves the ground with the bed laid over it. Read at once, before any other call. */
export const RAIL_GROUND = { h: 0, dx: 0, dz: 0 };


/**
 * The place's ground with the railroad's bed laid over it: `sh`, `sdx`, `sdz` are the town's ground over the coast's (height and slopes) at a point whose
 * offset from the highway is `u` (slope `uDz`), the answer the highway's corridor is then laid over. Leaves the result in `RAIL_GROUND` and answers true;
 * answers false, and writes nothing, where the staged ground stands: beyond `RAIL_REACH` of the line, or where the bed is not there.
 */
export function railGroundInto(seed: number, z: number, u: number, uDz: number, sh: number, sdx: number, sdz: number): boolean {
  const off = u + RAIL_OFFSET;
  if ((off < 0 ? -off : off) >= RAIL_REACH) return false;
  const tw = trestleWeightAt(seed, z);
  if (tw.v >= 1) return false;
  const grade = roadGradeAt(seed, z);
  // The ground the engine will leave here with no railroad: and how far the grade line stands from it.
  // The staged ground with the highway's corridor cut through it (the engine's, in numbers): where the corridor does not reach, the staged ground itself.
  const cut = corridorInto(u, uDz, grade.h, grade.dz, sh, sdx, sdz);
  const nH = cut ? CORRIDOR.h : sh;
  const nDx = cut ? CORRIDOR.dx : sdx;
  const nDz = cut ? CORRIDOR.dz : sdz;
  const m = grade.h - nH;
  benchWeightInto(u, uDz, m, -nDx, grade.dz - nDz, tw.v, tw.dz);
  const kV = BENCH.v;
  const kDx = BENCH.dx;
  const kDz = BENCH.dz;
  if (kV === 0) return false;
  const gap = grade.h - sh;
  RAIL_GROUND.h = sh + kV * gap;
  RAIL_GROUND.dx = sdx + kDx * gap - kV * sdx;
  RAIL_GROUND.dz = sdz + kDz * gap + kV * (grade.dz - sdz);
  return true;
}

/**
 * The place's ground with the railroad's bed laid over it: `staged` is the town's ground over the coast's at a point whose
 * offset from the highway is `u` (slope `uDz`), the answer the highway's corridor is then laid over. Returns `staged` itself
 * (the same object) beyond `RAIL_REACH` of the line.
 */
export function railGroundD(seed: number, z: number, u: number, uDz: number, staged: TerrainSample): TerrainSample {
  if (!railGroundInto(seed, z, u, uDz, staged.h, staged.dx, staged.dz)) return staged;
  return { h: RAIL_GROUND.h, dx: RAIL_GROUND.dx, dz: RAIL_GROUND.dz };
}
