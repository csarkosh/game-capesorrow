import { elevationSampleAt, type TerrainSample } from "@csarkosh/engine/sim/terrain";
import { streetLiftD, streetLowerD } from "../../src/sim/town/streetField.js";

/**
 * The made ground before the streets are cut into it: the coast's own with the town laid over it, as the tests of the ground's shape
 * (its slope, its flatness on the fill) were written to measure. A street's roadway lies a curb's height under the lots
 * (`streetField.ts`), with a step of that height at its curb, a trough under its pavement and its sidewalks, and a ditch beside
 * some: no part of what those tests measure. So a point the streets cut into (or fade out at) is not measured: `null`.
 */
export function madeGround(seed: number, x: number, z: number): TerrainSample | null {
  if (streetLowerD(seed, x, z).v !== 0 || streetLiftD(seed, x, z).v !== 0) return null;
  return elevationSampleAt(seed, x, z);
}
