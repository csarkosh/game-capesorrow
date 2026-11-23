/**
 * Cape Sorrow's place: what the game lays over the engine's coast. Importing `coast.ts` registers the
 * coast with it as the terrain `olympic`, on every thread that builds a world.
 *
 * It is the town's made ground (`ground.ts`: the fill the town stands on at the cove, following the plan and keeping
 * relief), the coast's climb to the massif drawn out behind it so the ground inland of the highway is not a wall, the
 * forest and the ground cover kept off streets, buildings and paved blocks and let into yards (`clearing.ts`), the cliff
 * bands kept off the old rectangle, and a clearing about the player's start.
 */
import { COVE_Z, type CoastOverlay } from "@csarkosh/engine/sim/olympic";
import { townBlendWindowD, TOWN_BLEND_END, TOWN_BLEND_TUNABLES } from "./blend.js";
import { CLEARING_TUNABLES, YARD_LIFT, townFeatureMask, townKeepD, townYardWeight } from "./clearing.js";
import { GROUND_TUNABLES, townGroundD } from "./ground.js";
import { RAIL_TUNABLES, railGroundD } from "./railGround.js";
import { SHORE_BISECT_STEPS, SHORE_SCAN_REACH, SHORE_SCAN_STEP, TOWN_ONE, TOWN_SEED_MIX } from "./siteFor.js";
import { townClearingX } from "./start.js";
import { TOWN_GEN } from "./version.js";

export const CAPE_PLACE: CoastOverlay = {
  tunables: {
    ...GROUND_TUNABLES,
    ...TOWN_BLEND_TUNABLES,
    ...CLEARING_TUNABLES,
    ...RAIL_TUNABLES,
    SHORE_SCAN_STEP,
    SHORE_SCAN_REACH,
    SHORE_BISECT_STEPS,
    TOWN_ONE,
    TOWN_SEED_MIX,
    // The plan's own version: two machines whose generators differ make different towns, and must not meet.
    TOWN_GEN,
  },
  blend: { end: TOWN_BLEND_END, windowD: townBlendWindowD },
  cliffKeepD: townKeepD,
  // The town's made ground, then the railroad's bed laid over it (`railGround.ts`), under the highway's own corridor.
  shapeD: (seed, x, z, u, uDz, base) => railGroundD(seed, z, u, uDz, townGroundD(seed, x, z, u, uDz, base)),
  featureMask: (seed, x, z) => townFeatureMask(seed, x, z),
  // On a yard the shore's rules (what paints sand, what grows) read the ground higher than it is: ground that bears grass and trees.
  shoreStrip: { lift: YARD_LIFT, forestFloor: 0, at: townYardWeight },
  clearing: { z: COVE_Z, x: townClearingX },
};
