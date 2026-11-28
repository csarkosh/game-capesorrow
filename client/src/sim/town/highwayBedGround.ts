/**
 * The ground the game draws itself along the highway, as the place says it (`pavedGround`, `CoastOverlay.pavedGround`,
 * in the engine release that adds it): the engine's patches of finer rock leave it alone. The highway's bed,
 * `ROAD_BED_HALF` either side of the road's centre line, is level ground the town's strip and the highway's cells
 * pave at every z, so a patch beside a steep bank must not cover it and paint the engine's own road over the game's.
 * (`pavedGround.ts` is the plan's paved blocks: another thing.)
 *
 * The renderer's alone: no tunable and no part of the level id.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { roadCentreX } from "./roadCentre.js";

/**
 * The hook asks for a distance that changes no faster than a metre a metre. The centre line leans across z (0.57 m a
 * metre at the most, sampled on the engine's coast), so the distance across x is cut by a lean of 1: a smaller
 * number, never a larger. It is nothing or less on the bed, as the hook asks.
 */
const LEAN_BOUND = 1;
const SHRINK = 1 / Math.sqrt(1 + LEAN_BOUND * LEAN_BOUND);

/** Metres to the highway's bed (a lower bound), nothing or less on it. */
export function townHighwayBedGround(seed: number, x: number, z: number): number {
  const across = Math.abs(x - roadCentreX(seed, z)) - ROAD_BED_HALF;
  return across <= 0 ? across : across * SHRINK;
}
