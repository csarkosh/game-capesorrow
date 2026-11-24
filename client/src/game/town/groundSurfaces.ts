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
import { groundFrame, wallFrame, type Surface, type UvFrame, type WearKind } from "./townSurface.js";

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

/**
 * The depth ranks of the flat ground (`townMaterial.ts`, `RANK_UNITS`): a face of a higher rank is drawn that many depth steps ahead of one of a
 * lower, so two flat faces that overlap are told apart by their rank at every distance, and not by the millimetres between them.
 *
 * - `under` (-1): ground tucked under a base surface (the gravel of a shoulder that runs 8 cm under the asphalt's edge).
 * - `base` (0, the default): a surface that no other base overlaps (a slab, a roadway tile, a yard's drive, a junction's pavement).
 * - Over the base, in the order they lie on one another: `mark` (a joint, a crack in a slab, a gutter's band, a paving seam, a patch of a
 *   yard), `detail` (what is laid on those: a cut in the asphalt, a pothole's rim, a manhole's ring, a lid), `top` (weeds, a cut's seam, a
 *   pothole, a manhole's cover), `crack` (a crack in the roadway, across all of them), `paint`.
 * - `stain` (7): the dark of the ground under a vehicle, over everything laid on the ground.
 *
 * Two marks of one rank are never laid over each other: `Surface` cuts the later one off the earlier (the first laid keeps its ground).
 */
export const RANK = { under: -1, base: 0, mark: 1, detail: 2, top: 3, crack: 4, paint: 5, stain: 7 } as const;

/**
 * What a builder may lay over the surface a colour names: another layer, a tint, a frame (so asphalt runs along its street and not along the world's z), and
 * wear and dirt (numbers, or functions of a vertex's position, which is how a gutter is dirtier than a street's middle). A field left out is the colour's own.
 */
export type Over = {
  readonly layer?: LayerName;
  readonly tint?: Rgb;
  readonly frame?: UvFrame;
  readonly wear?: number | ((p: readonly [number, number, number]) => number);
  readonly wearKind?: WearKind;
  readonly dirt?: number | ((p: readonly [number, number, number]) => number);
  /** What the dirt is: grime (the default), damp grey, algae, leaf-brown or rust. */
  readonly dirtKind?: WearKind;
  /** The depth rank of flat ground (`townMaterial.ts`): 0 or left out for a base surface, more for what is laid on one. */
  readonly rank?: number;
  /** Marks and surfaces of one group are never laid over each other: the one laid later is cut back to where the earlier ones leave ground (`Surface`). A mark with a rank is in the group of its rank; a base surface that may overlap another (a sidewalk's slab and the next street's roadway, where two streets meet) is in the group `base`. */
  readonly group?: string;
};

/** `base` (the surface the colour names, if any) with `over` laid on it. With no `over` it is `base` itself. A face takes a layer on its own frame unless `over` gives one. */
export function withOver(base: Surface | undefined, colour: Rgb, anchor: { readonly x: number; readonly z: number }, over: Over | undefined, face = false, ends?: readonly [number, number, number, number]): Surface | undefined {
  if (over === undefined) return base;
  const layer = over.layer ?? base?.layer;
  if (layer === undefined) return undefined;
  let frame = over.frame ?? base?.frame;
  if (frame === undefined) {
    if (face && ends !== undefined) {
      const len = Math.sqrt((ends[2] - ends[0]) * (ends[2] - ends[0]) + (ends[3] - ends[1]) * (ends[3] - ends[1]));
      frame = len > 1e-9 ? wallFrame(ends[0], ends[1], (ends[2] - ends[0]) / len, (ends[3] - ends[1]) / len, 0) : groundFrame(anchor);
    } else frame = groundFrame(anchor);
  }
  void colour;
  const wear = over.wear ?? base?.wear;
  // Dirt is the second wear, of the grime kind (the mud layer), laid over the first (moss): one mechanism with the buildings' (`townSurface.ts`, `townMaterial.ts`).
  const wear2 = over.dirt ?? base?.wear2;
  const tint = over.tint ?? base?.tint;
  const wearKind = over.wearKind ?? base?.wearKind;
  return { layer, frame, ...(tint === undefined ? {} : { tint }), ...(wear === undefined ? {} : { wear }), ...(wearKind === undefined ? {} : { wearKind }), ...(wear2 === undefined ? {} : { wear2, wearKind2: over.dirtKind ?? ("grime" as const) }) };
}
