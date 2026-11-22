/**
 * What keeps the forest off the made ground: no cliff band, no tree, no ground clutter stands on the
 * footprint, all of them returning over the blend. These are the overlay's own hooks for it
 * (`cliffKeepD`, `featureMask`); the trees' and the clutter's own passes read them.
 */
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { UNIT_KEEP } from "@csarkosh/engine/sim/cliffs";
import type { FeatureMask } from "@csarkosh/engine/sim/features";
import { EDGE, TOWN_INLAND, TOWN_Z_HALF, alongD, bankD, inlandD, smootherstepD } from "./ground.js";
import { fillWindowD, townFillFor, type FillArea } from "./fill.js";
import { shoreSplineOf, shoreXAt } from "./shoreSpline.js";
import { siteFor } from "./siteFor.js";

/**
 * How much of the blend's rise is held clear of trees and cover: a tree is placed from a cell's centre
 * and stands up to a few metres from it, so the forest returns only past this share of the blend (about
 * 13 m of it), and over the rest of the blend by a quintic.
 */
export const CLEAR_HOLD = 0.2;

/** What the clearing declares of itself for the level id. */
export const CLEARING_TUNABLES: Readonly<Record<string, number>> = { CLEAR_HOLD };

/**
 * How much of the cliff bands the coast keeps at a place in the road's frame: none inside the
 * footprint's reach along the shore and inland, the bands returning over the blend.
 */
export function townKeepD(u: number, uDz: number, z: number): { v: number; dx: number; dz: number } {
  const wi = inlandD(u);
  if (wi.v === 0) return UNIT_KEEP;
  const wz = alongD(z - COVE_Z);
  const c = wz.v * wi.v;
  if (c === 0) return UNIT_KEEP;
  return { v: 1 - c, dx: -wz.v * wi.du, dz: -(wz.dz * wi.v + wz.v * wi.du * uDz) };
}

/** How much the footprint covers a world point, 0 to 1: the fill's own weight, its bank and its blend included. */
export function townCover(seed: number, x: number, z: number, fill: readonly FillArea[] = townFillFor(seed)): number {
  const zr = z - COVE_Z;
  const site = siteFor(seed);
  const f = fill.length === 0 ? 0 : fillWindowD(fill, x - site.anchor.x, zr).v;
  if ((zr < 0 ? -zr : zr) >= TOWN_Z_HALF + EDGE) return f;
  const u = x - roadCenterX(seed, z);
  if (u >= TOWN_INLAND + EDGE) return f;
  const shore = shoreXAt(shoreSplineOf(site), zr);
  const bank = bankD(x - site.anchor.x - shore.v, -shore.dz, shore.dz, shore.dz2);
  return 1 - (1 - bank.v * alongD(zr).v * inlandD(u).v) * (1 - f);
}

/** No tree and no ground clutter stands on the made ground, the forest and the cover returning over the blend. */
export function townFeatureMask(seed: number, x: number, z: number): FeatureMask {
  const cover = townCover(seed, x, z);
  if (cover === 0) return { tree: 1, clutter: 1, meadow: 0, bare: 0 };
  const open = smootherstepD(CLEAR_HOLD, 1, 1 - cover).v;
  return { tree: open, clutter: open, meadow: 0, bare: 0 };
}
