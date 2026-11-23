/**
 * The town's colours, as the engine's own prop colours are given (`propBoxes.ts`): a base colour of 0 to 1 a channel,
 * lit matt. Each is a starting point; a building varies from its own id (`vary`).
 */
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import type { Material } from "../../sim/town/types.js";

export const ASPHALT: Rgb = [0.1, 0.1, 0.11];
export const ALLEY: Rgb = [0.14, 0.13, 0.12];
export const SIDEWALK: Rgb = [0.3, 0.3, 0.29];
export const VERGE: Rgb = [0.1, 0.17, 0.07];
export const CURB: Rgb = [0.4, 0.4, 0.38];
export const PAINT_YELLOW: Rgb = [0.55, 0.43, 0.08];
export const PAINT_WHITE: Rgb = [0.62, 0.62, 0.6];
export const MEDIAN: Rgb = [0.15, 0.14, 0.12];
export const GRAVEL: Rgb = [0.24, 0.22, 0.19];
export const WALK_CONCRETE: Rgb = [0.31, 0.31, 0.3];
export const YARD_GRAVEL: Rgb = [0.22, 0.2, 0.17];
export const YARD_ASPHALT: Rgb = [0.12, 0.12, 0.125];
export const ROAD_ASPHALT: Rgb = [0.13, 0.13, 0.135];
export const TRACK: Rgb = [0.1, 0.08, 0.055];
export const LOG: Rgb = [0.22, 0.14, 0.08];
export const HEADSTONE: Rgb = [0.38, 0.38, 0.36];
export const FENCE: Rgb = [0.27, 0.27, 0.26];
export const TANK: Rgb = [0.34, 0.37, 0.4];
export const BARRICADE_RED: Rgb = [0.5, 0.09, 0.07];
export const BARRICADE_WHITE: Rgb = [0.6, 0.6, 0.57];
export const DECK: Rgb = [0.26, 0.19, 0.12];
export const PILE: Rgb = [0.12, 0.09, 0.06];
export const BALLAST: Rgb = [0.2, 0.19, 0.18];
export const TIE: Rgb = [0.1, 0.07, 0.05];
export const RAIL: Rgb = [0.26, 0.22, 0.2];
export const QUAY_CONCRETE: Rgb = [0.36, 0.36, 0.35];
export const QUAY_FACE: Rgb = [0.24, 0.25, 0.25];
export const TIMBER: Rgb = [0.2, 0.14, 0.09];
export const TIMBER_WEATHERED: Rgb = [0.3, 0.26, 0.21];
export const STEEL: Rgb = [0.24, 0.27, 0.3];
export const STEEL_RUST: Rgb = [0.34, 0.2, 0.12];
export const BOLLARD: Rgb = [0.09, 0.1, 0.11];
export const GLASS: Rgb = [0.025, 0.035, 0.05];
export const FRAME: Rgb = [0.32, 0.3, 0.26];
export const PLYWOOD: Rgb = [0.4, 0.3, 0.17];
export const DOOR: Rgb = [0.16, 0.09, 0.05];
export const BIG_DOOR: Rgb = [0.18, 0.2, 0.22];
export const ROOF_SHINGLE: Rgb = [0.13, 0.12, 0.12];
export const ROOF_TAR: Rgb = [0.1, 0.1, 0.1];
export const ROOF_METAL: Rgb = [0.3, 0.34, 0.38];
export const FLAG_RED: Rgb = [0.55, 0.06, 0.06];
export const FLAG_POLE: Rgb = [0.5, 0.5, 0.5];
export const STONE_TRIM: Rgb = [0.5, 0.48, 0.44];

/** The wall colours by material: the painted houses of wood come in a few, picked by the building's id. */
const WOOD: readonly Rgb[] = [
  [0.3, 0.27, 0.23],
  [0.5, 0.49, 0.45],
  [0.2, 0.28, 0.36],
  [0.18, 0.27, 0.2],
  [0.38, 0.17, 0.12],
  [0.42, 0.37, 0.25],
];

export function wallColour(material: Material, id: number): Rgb {
  switch (material) {
    case "wood":
      return WOOD[Math.floor(hash01(id, 3) * WOOD.length)] as Rgb;
    case "brick":
      return [0.36, 0.15, 0.11];
    case "concrete":
      return [0.4, 0.4, 0.39];
    case "metal":
      return [0.29, 0.35, 0.41];
    case "stucco":
      return [0.52, 0.47, 0.37];
    case "stone":
      return [0.45, 0.43, 0.4];
  }
}

/** A colour varied from a building's id: brighter or darker by up to 12%, and a little off in hue, never from a random call. */
export function vary(c: Rgb, id: number, salt = 0): Rgb {
  const k = 0.88 + hash01(id, 10 + salt) * 0.24;
  const tint = (hash01(id, 20 + salt) - 0.5) * 0.08;
  return scaled([c[0] * (1 + tint), c[1], c[2] * (1 - tint)], k);
}
