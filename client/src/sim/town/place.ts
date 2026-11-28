/**
 * Port Ashton's place: what the game lays over the engine's coast. Importing `coast.ts` registers the
 * coast with it as the terrain `olympic`, on every thread that builds a world.
 *
 * It is the town's made ground (`ground.ts`: the fill the town stands on at the cove, following the plan and keeping
 * relief), the coast's climb to the massif drawn out behind it so the ground inland of the highway is not a wall, the
 * forest and the ground cover kept off streets, buildings and paved blocks and let into yards (`clearing.ts`), the cliff
 * bands kept off the old rectangle, and a clearing about the player's start.
 */
import { COVE_Z, type CoastOverlay } from "@csarkosh/engine/sim/olympic";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { townBlendEnd, townBlendWindowD, TOWN_BLEND_TUNABLES } from "./blend.js";
import { CLEARING_TUNABLES, YARD_LIFT, beyondTown, townClutterStands, townFeatureMask, townKeepD, townStripWeight } from "./clearing.js";
import { GROUND, GROUND_TUNABLES, townGroundInto } from "./ground.js";
import { townHighwayBedGround } from "./highwayBedGround.js";
import { VERGE_TUNABLES, vergeMask, vergeWeight, vergeWeightAt } from "./verge.js";
import { RAIL_CLEARING_TUNABLES, railFeatureMask } from "./railClearing.js";
import { RAIL_GROUND, RAIL_TUNABLES, railGroundInto } from "./railGround.js";
import { SHORE_BISECT_STEPS, SHORE_SCAN_REACH, SHORE_SCAN_STEP, TOWN_ONE, TOWN_SEED_MIX } from "./siteFor.js";
import { townClearingX } from "./start.js";
import { CHANNEL, STREET_TUNABLES, streetChannelInto } from "./streetField.js";
import { TOWN_GEN } from "./version.js";
import { townWildlifeGround } from "./wildlifeGround.js";

/**
 * The town's made ground, then the streets cut into it (`streetField.ts`: the roadways lie a curb's face under the lots), then the railroad's bed laid
 * over it (`railGround.ts`), under the highway's own corridor. Each stage leaves its answer in its own register and the next reads it by number, so the
 * one record made is the one returned; where no stage changes the ground it is `base` itself.
 */
export function shapeD(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample): TerrainSample {
  // Beyond the town's reach (`townReachOf`) the made ground and the streets leave the ground as it is: only the railroad's bed, which runs the whole coast.
  if (!beyondTown(seed, x, z)) return shapeDFull(seed, x, z, u, uDz, base);
  if (!railGroundInto(seed, z, u, uDz, base.h, base.dx, base.dz)) return base;
  return { h: RAIL_GROUND.h, dx: RAIL_GROUND.dx, dz: RAIL_GROUND.dz };
}

/** `shapeD` with no early answer: every stage asked at every point. */
export function shapeDFull(seed: number, x: number, z: number, u: number, uDz: number, base: TerrainSample): TerrainSample {
  let h = base.h;
  let dx = base.dx;
  let dz = base.dz;
  let changed = false;
  if (townGroundInto(seed, x, z, u, uDz, h, dx, dz)) {
    h = GROUND.h;
    dx = GROUND.dx;
    dz = GROUND.dz;
    changed = true;
  }
  if (streetChannelInto(seed, x, z, h, dx, dz)) {
    h = CHANNEL.h;
    dx = CHANNEL.dx;
    dz = CHANNEL.dz;
    changed = true;
  }
  if (railGroundInto(seed, z, u, uDz, h, dx, dz)) {
    h = RAIL_GROUND.h;
    dx = RAIL_GROUND.dx;
    dz = RAIL_GROUND.dz;
    changed = true;
  }
  return changed ? { h, dx, dz } : base;
}

export const PORTASHTON_PLACE: CoastOverlay = {
  tunables: {
    ...GROUND_TUNABLES,
    ...TOWN_BLEND_TUNABLES,
    ...CLEARING_TUNABLES,
    ...RAIL_TUNABLES,
    ...RAIL_CLEARING_TUNABLES,
    ...VERGE_TUNABLES,
    ...STREET_TUNABLES,
    SHORE_SCAN_STEP,
    SHORE_SCAN_REACH,
    SHORE_BISECT_STEPS,
    TOWN_ONE,
    TOWN_SEED_MIX,
    // The plan's own version: two machines whose generators differ make different towns, and must not meet.
    TOWN_GEN,
  },
  blend: { end: townBlendEnd, windowD: townBlendWindowD },
  cliffKeepD: townKeepD,
  // The town's made ground, with the streets cut into it, then the railroad's bed laid over it, under the highway's own corridor (`shapeD` above).
  shapeD,
  // The town's mask, with the railroad's corridor shut in it (`railClearing.ts`).
  // And, on the made ground and along the highway and the railroad, rough grass and bare soil and no trees (`verge.ts`).
  featureMask: (seed, x, z, h) => {
    const mask = railFeatureMask(seed, x, z, townFeatureMask(seed, x, z));
    const w = vergeWeightAt(seed, x, z, h);
    return w === 0 ? mask : vergeMask(seed, x, z, h, w, townStripWeight(seed, x, z), mask);
  },
  // On a yard, a paved block or a street, on the rest of the made ground and along the highway and the railroad, the shore's rules (what paints sand, what grows) read the ground higher than it is: ground that bears grass and not beach.
  shoreStrip: {
    lift: YARD_LIFT,
    forestFloor: 0,
    at: (seed, x, z) => {
      const own = townStripWeight(seed, x, z);
      if (own === 1) return 1;
      const w = vergeWeight(seed, x, z);
      return w > own ? w : own;
    },
  },
  clearing: { z: COVE_Z, x: townClearingX },
  // Round a yard's building the mask is open to the wall, and each piece of ground cover is kept back by where it stands (`clearing.ts`).
  clutterStands: townClutterStands,
  // What lies on the beach and the shape it has (the engine's `beach`): the wrack line, cobbles, small driftwood and dune grass at their full density, and the storm ridge, cusps, bars and hummocks.
  beach: {},
  // Where animals may not be (`wildlifeGround.ts`): the renderer's alone, so no tunable and no part of the level id.
  wildlifeGround: townWildlifeGround,
  // The highway's bed is the game's own surface: the engine's patches of finer rock make no triangle on it (`highwayBedGround.ts`); the renderer's alone, like the line above.
  pavedGround: townHighwayBedGround,
};
