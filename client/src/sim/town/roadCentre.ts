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

/** `roadCenterX(seed, z)`, with the answer at the last seed and z asked kept. */
export function roadCentreX(seed: number, z: number): number {
  if (seed !== lastSeed || z !== lastZ) {
    lastX = roadCenterX(seed, z);
    lastSeed = seed;
    lastZ = z;
  }
  return lastX;
}
