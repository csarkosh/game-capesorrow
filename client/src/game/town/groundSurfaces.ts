/**
 * Which flat colours of the street and ground builders are materials, and what they are: a polygon laid in a colour that
 * names one is given that material's surface, and its colour stays as it was (the flat colour, until the textures land). The
 * builders keep naming colours (`palette.ts`), so every street, junction, made end, paved block and road out wears its
 * material with no change to its own code.
 *
 * - **Roadways and junction pavements** (`ASPHALT`, `ROAD_ASPHALT`, `YARD_ASPHALT`): `asphalt`, the cracked street asphalt.
 * - **Sidewalks, curbs, ramps and the concrete walks of the blocks** (`SIDEWALK`, `CURB`, `WALK_CONCRETE`): `sidewalk`, with
 *   a little wear (moss and grime) so a walk is not new.
 * - **Alleys, gravel road ends and the blocks' gravel yards** (`ALLEY`, `GRAVEL`, `YARD_GRAVEL`): `gravel`.
 *
 * Everything else stays flat colour for now: the paint, the signs, the verges, the ramps' dome panels, the decks, the planters.
 * A face that stands (a curb's face) takes the layer on a frame that runs along it and up; anything flat takes the world's x
 * and z, so neighbouring pieces meet with no seam (`townSurface.ts`).
 */
import type { Rgb } from "./meshBuilder.js";
import { ALLEY, ASPHALT, CURB, GRAVEL, ROAD_ASPHALT, SIDEWALK, WALK_CONCRETE, YARD_ASPHALT, YARD_GRAVEL } from "./palette.js";
import type { LayerName } from "./townLayers.js";
import { groundFrame, wallFrame, type Surface, type WearKind } from "./townSurface.js";

type Material = { readonly layer: LayerName; readonly tint: Rgb; readonly wear: number; readonly wearKind: WearKind };

/** The share of a sidewalk's surface the moss and grime take: a little, in patches. */
export const WALK_WEAR = 0.16;

const ASPHALT_MATERIAL: Material = { layer: "asphalt", tint: [1, 1, 1], wear: 0, wearKind: "moss" };
const WALK_MATERIAL: Material = { layer: "sidewalk", tint: [1, 1, 1], wear: WALK_WEAR, wearKind: "moss" };
const GRAVEL_MATERIAL: Material = { layer: "gravel", tint: [1, 1, 1], wear: 0, wearKind: "moss" };

const TABLE: readonly (readonly [Rgb, Material])[] = [
  [ASPHALT, ASPHALT_MATERIAL], [ROAD_ASPHALT, ASPHALT_MATERIAL], [YARD_ASPHALT, ASPHALT_MATERIAL],
  [SIDEWALK, WALK_MATERIAL], [CURB, WALK_MATERIAL], [WALK_CONCRETE, WALK_MATERIAL],
  [ALLEY, GRAVEL_MATERIAL], [GRAVEL, GRAVEL_MATERIAL], [YARD_GRAVEL, GRAVEL_MATERIAL],
];

function material(colour: Rgb): Material | null {
  for (const [c, m] of TABLE) if (c[0] === colour[0] && c[1] === colour[1] && c[2] === colour[2]) return m;
  return null;
}

/** The surface of a flat piece of ground laid in `colour`, or undefined where the colour names no material. */
export function flatSurfaceFor(colour: Rgb, anchor: { readonly x: number; readonly z: number }): Surface | undefined {
  const m = material(colour);
  if (m === null) return undefined;
  return { layer: m.layer, tint: m.tint, frame: groundFrame(anchor), ...(m.wear > 0 ? { wear: m.wear, wearKind: m.wearKind } : {}) };
}

/** The surface of a face that stands, from (ax, az) toward (bx, bz), laid in `colour`; undefined where the colour names no material. */
export function faceSurfaceFor(colour: Rgb, ax: number, az: number, bx: number, bz: number): Surface | undefined {
  const m = material(colour);
  if (m === null) return undefined;
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  if (!(len > 1e-9)) return undefined;
  return { layer: m.layer, tint: m.tint, frame: wallFrame(ax, az, (bx - ax) / len, (bz - az) / len, 0), ...(m.wear > 0 ? { wear: m.wear, wearKind: m.wearKind } : {}) };
}
