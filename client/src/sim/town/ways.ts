/**
 * How a street's right of way is made, from how a small Northwest town's streets are: a roadway between two curbs,
 * a sidewalk down each side, and between sidewalk and curb a grass verge on streets of houses.
 *
 * - **A street** has a right of way of 14 to 16 m: a roadway of 7.5 to 9 m (two lanes and a bit), a sidewalk of 1.7 m each
 *   side and a grass verge of the rest (about 1.5 m); where it runs between shops the sidewalk takes the verge's place.
 * - **The main street** has 11 m of roadway with parking along both sides and sidewalks of 3.5 m up to the storefronts in a
 *   right of way of 18 m; 12 m of roadway and sidewalks of 4 m in 20 m where the fire's rebuilding widened it.
 * - **The avenue** has 12 m of roadway with a painted median between sidewalks of 2 m and verges of 2 m, in 20 m.
 * - **A stair** is a public flight of steps on a right of way where the street would climb more than 15 percent: its
 *   steps are `STAIR_WIDTH` wide in a right of way of the street's own width, with no sidewalk (the handrail is drawn).
 * - **An alley** is 4 m of gravel with no sidewalk. The highway's roadway is the engine's own bed, 11 m, and the widest
 *   road in the world: nothing here is wider.
 */
import type { StreetKind } from "./types.js";

/** The sidewalk down each side of a street between houses, metres. */
export const STREET_WALK = 1.7;
/** The most roadway an ordinary street has, metres. */
export const STREET_ROADWAY_MAX = 9;
/** What a street's right of way keeps beyond its roadway on both sides together: two sidewalks and verges, metres. */
export const STREET_EDGES = 6.5;
/** The main street's roadway and sidewalks: the usual, and where a fire widened it. */
export const MAIN_ROADWAY = 11;
export const MAIN_WALK = 3.5;
export const MAIN_WIDE_ROADWAY = 12;
export const MAIN_WIDE_WALK = 4;
/** The avenue's roadway and sidewalk. */
export const AVENUE_ROADWAY = 12;
export const AVENUE_WALK = 2;
/** The highway's roadway, the engine's road bed. */
export const HIGHWAY_ROADWAY = 11;
/** The width of a flight of public steps, metres. */
export const STAIR_WIDTH = 3.5;
/** An alley's width, all of it gravel. */
export const ALLEY_WIDTH = 4;

/** The right of way's widths for a street: its roadway and the sidewalk down each side (0 for none). `shops`: the street runs between shops, so no verge. */
export function wayOf(kind: StreetKind, width: number, shops = false): { roadway: number; walk: number } {
  switch (kind) {
    case "highway":
      return { roadway: HIGHWAY_ROADWAY, walk: 0 };
    case "main":
      return width >= 19.5 ? { roadway: MAIN_WIDE_ROADWAY, walk: MAIN_WIDE_WALK } : { roadway: MAIN_ROADWAY, walk: MAIN_WALK };
    case "avenue":
      return { roadway: AVENUE_ROADWAY, walk: AVENUE_WALK };
    case "street": {
      const roadway = Math.min(STREET_ROADWAY_MAX, width - STREET_EDGES);
      return { roadway, walk: shops ? (width - roadway) / 2 : STREET_WALK };
    }
    case "stair":
      return { roadway: Math.min(STAIR_WIDTH, width), walk: 0 };
    case "alley":
    case "wharf":
    case "rail":
      return { roadway: width, walk: 0 };
  }
}
