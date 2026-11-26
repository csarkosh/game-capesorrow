/**
 * The highway's bed as the town sees it: the ground the engine shapes flat for the road, `ROAD_BED_HALF` either side of its centre line
 * (measured across, in x, as the engine measures it). The bed is cut into tiles of `BED_STEP` metres along z, each a convex quad between
 * two chords of the centre line (a chord of 2 m strays 0.5 mm from it). Every surface of the town is cut off these tiles (`Surface`), and
 * the highway's own paving (`highwayGeometry.ts`) is laid on them, so the two share their edges exactly, however the centre line bends.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import type { TownGround } from "./townTypes.js";

export type P2 = readonly [number, number];

/** The length of a bed tile along z, metres. */
export const BED_STEP = 2;

const TILES = new WeakMap<object, Map<number, readonly P2[]>>();

/** The corners of the bed's tile `i` (from z = i * BED_STEP): left edge at the near z, right edge at the near z, right at the far z, left at the far z. */
export function bedTile(g: TownGround, i: number): readonly P2[] {
  let tiles = TILES.get(g.roadX);
  if (tiles === undefined) {
    tiles = new Map();
    TILES.set(g.roadX, tiles);
  }
  let tile = tiles.get(i);
  if (tile === undefined) {
    const z0 = i * BED_STEP;
    const z1 = z0 + BED_STEP;
    const x0 = g.roadX(z0);
    const x1 = g.roadX(z1);
    tile = [
      [x0 - ROAD_BED_HALF, z0],
      [x0 + ROAD_BED_HALF, z0],
      [x1 + ROAD_BED_HALF, z1],
      [x1 - ROAD_BED_HALF, z1],
    ];
    tiles.set(i, tile);
  }
  return tile;
}

/** The index of the bed tile that z falls in. */
export function bedIndex(z: number): number {
  return Math.floor(z / BED_STEP);
}
