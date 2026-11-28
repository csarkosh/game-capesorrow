/**
 * The highway's centre x at a z, the last asked kept. `roadCenterX` (the engine's) is noise, a blend window and a spline, and one
 * terrain evaluation asks it again for the same z from several hooks of the place (the verge's corridor twice, the railroad's line,
 * the cliff keep): the one answer is kept, so they are the engine's value, to the bit, asked once.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";

let lastSeed = NaN;
let lastZ = NaN;
let lastX = 0;

/** `roadCenterX(seed, z)`, with the answer at the last seed and z asked kept, used only for the very same numbers (a +0 is not a -0, and a NaN is never the same). */
export function roadCentreX(seed: number, z: number): number {
  if (!(seed === lastSeed && (seed !== 0 || 1 / seed === 1 / lastSeed)) || !(z === lastZ && (z !== 0 || 1 / z === 1 / lastZ))) {
    lastX = roadCenterX(seed, z);
    lastSeed = seed;
    lastZ = z;
  }
  return lastX;
}
