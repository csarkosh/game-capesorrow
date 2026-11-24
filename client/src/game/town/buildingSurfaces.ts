/**
 * Which texture layer a building's walls and roof wear, and how worn: the first, simple and uniform application of the
 * town's materials (`townSurface.ts`, `townMaterial.ts`). Pure: a building in, a choice out, every choice from the building's
 * id (`hash01`), so no random call is made.
 *
 * - **Walls by the plan's material.** `wood`: painted lap siding tinted with the colour the house has always had, but one
 *   in four in weathered cedar shingle siding; sheds, garages and the sheds on piles (the net sheds) half in weathered boards
 *   (half of those standing upright); a vacant house two in five in peeling painted boards. `brick`, `concrete` and `stone`
 *   to their layers; `stucco` painted in its colour; `metal` two in three aged corrugated metal painted in its colour and the
 *   rest painted corrugated steel.
 * - **Roofs by kind.** Pitched roofs (gable and hip) in the generated asphalt shingles, tinted as they have always been; a
 *   `shed` roof and any roof of a metal building in metal roofing; a flat roof in bitumen.
 * - **Wear** is a share of the surface, in patches (`townMaterial.ts`): a little on every wall, more on a vacant building and
 *   more still on a ruin, and more near the ground than at the eave.
 */
import type { Building, BuildingKind } from "../../sim/town/types.js";
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { vary } from "./palette.js";
import type { LayerName } from "./townLayers.js";
import type { WearKind } from "./townSurface.js";

export type WallStyle = {
  readonly layer: LayerName;
  /** The layer's picture turned on its side: boards that stand. */
  readonly turned: boolean;
  /** Painted: the texture is neutral detail and the tint is the paint, the polygon's own colour. */
  readonly paint: boolean;
  readonly wearKind: WearKind;
};

/** The kinds of building that are sheds and the like, which take weathered boards as often as their material's own. */
const SHEDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(["mill shed", "garage", "shake mill", "junkyard"]);

/** The share of a wall's surface worn on a building that is open, vacant and a ruin, at the eave, and what the foot of the wall has more. */
export const WALL_WEAR = { open: 0.02, vacant: 0.22, ruin: 0.5, foot: 0.12 } as const;
/** How high up a wall the foot's extra wear fades out, metres. */
export const WEAR_FOOT_HEIGHT = 3.5;

export function wallStyle(b: Building): WallStyle {
  const turned = hash01(b.id, 202) < 0.5;
  switch (b.material) {
    case "wood":
      if (b.lot === -1) return { layer: "planks_weathered", turned, paint: false, wearKind: "moss" };
      if (SHEDS.has(b.kind) && hash01(b.id, 201) < 0.5) return { layer: "planks_weathered", turned, paint: false, wearKind: "moss" };
      if (b.state === "vacant" && hash01(b.id, 203) < 0.4) return { layer: "planks_peeling", turned: false, paint: false, wearKind: "moss" };
      if (hash01(b.id, 204) < 0.25) return { layer: "shingle_siding", turned: false, paint: false, wearKind: "moss" };
      return { layer: "siding_painted", turned: false, paint: true, wearKind: "moss" };
    case "brick":
      return { layer: "brick", turned: false, paint: false, wearKind: "moss" };
    case "concrete":
      return { layer: "concrete_board", turned: false, paint: false, wearKind: "moss" };
    case "stone":
      return { layer: "stone", turned: false, paint: false, wearKind: "moss" };
    case "stucco":
      return { layer: "stucco", turned: false, paint: true, wearKind: "moss" };
    case "metal":
      return hash01(b.id, 205) < 0.65
        ? { layer: "metal_aged", turned: false, paint: true, wearKind: "rust" }
        : { layer: "metal_painted", turned: false, paint: false, wearKind: "rust" };
  }
}

/** The tint of an unpainted wall: white, a little varied from the building's id and dimmed where it is vacant or ruined. */
export function wallTint(b: Building): Rgb {
  const dim = b.state === "ruin" ? 0.65 : b.state === "vacant" ? 0.8 : 1;
  // Brick is warmed a little: the overcast and the fog take the red out of a scanned wall.
  // The scanned cedar shingles and dark boards are near black as they are: the tint lifts them to the silver-grey and brown a weathered coast wall has, a shade of its own for each building.
  const layer = wallStyle(b).layer;
  const warm: Rgb = b.material === "brick" ? [1.12, 1, 0.92] : layer === "shingle_siding" ? [4.3, 4.0, 3.6] : layer === "planks_weathered" ? [3.8, 3.5, 3.2] : [1, 1, 1];
  return scaled(vary(warm, b.id, 7), dim);
}

/** The base share of a building's walls that is worn (before the foot's extra). */
export function wallWearBase(b: Building): number {
  return b.state === "ruin" ? WALL_WEAR.ruin : b.state === "vacant" ? WALL_WEAR.vacant : WALL_WEAR.open;
}

/** A wall's wear at height `y` over its base `baseY`: the base's share and the foot's, which fades over `WEAR_FOOT_HEIGHT`. */
export function wallWearAt(base: number, baseY: number, y: number): number {
  const k = Math.min(1, Math.max(0, (y - baseY) / WEAR_FOOT_HEIGHT));
  return Math.min(1, base + WALL_WEAR.foot * (1 - k * k * (3 - 2 * k)));
}

export type RoofStyle = { readonly layer: LayerName; readonly wearKind: WearKind; readonly wear: number };

/** The layer of a roof of `kind` on building `b`, and its wear. */
export function roofStyle(b: Building, kind: "flat" | "gable" | "hip" | "shed"): RoofStyle {
  const vacant = b.state === "vacant";
  if (kind === "flat") return { layer: "roof_bitumen", wearKind: "moss", wear: vacant ? 0.3 : 0.12 };
  if (kind === "shed" || b.material === "metal") return { layer: "roof_metal", wearKind: "rust", wear: vacant ? 0.3 : 0.1 };
  return { layer: "roof_shingle", wearKind: "moss", wear: vacant ? 0.3 : 0.1 };
}

/** The tint of a roof of a layer that is not painted: white a little varied from the building's id. */
export function roofTint(b: Building): Rgb {
  return vary([1, 1, 1], b.id, 9);
}
