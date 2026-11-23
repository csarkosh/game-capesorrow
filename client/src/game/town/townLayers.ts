/**
 * The town's texture layers as the build script wrote them (`tools/textures/build.py`, which makes
 * `client/assets/textures/town.layers.json` and the WebP files beside it): each layer's name, its index in the two texture
 * arrays the renderer binds, the metres its 512 x 512 spans, and whether its colour is neutral detail for a paint colour.
 * Babylon-free, so the builders (`townSurface.ts`, `meshBuilder.ts`) and their tests read it as plain data.
 *
 * The names are the layers' roles. A layer is a surface a polygon can be given (`MeshBuilder.poly`'s `surface`); the layer
 * "none" is no surface at all: a vertex with no layer is drawn as a flat vertex colour, as every town vertex was before.
 */
import manifest from "../../../assets/textures/town.layers.json" with { type: "json" };

/** Every layer, in the order of the arrays: walls, then roofs, then the ground. A test holds this list to the manifest. */
export const LAYER_NAMES = [
  "siding_painted", "planks_peeling", "shingle_siding", "planks_weathered", "brick", "metal_aged", "metal_painted", "concrete_board",
  "stucco", "stone", "plywood", "shutter",
  "roof_metal", "roof_bitumen", "roof_shingle",
  "sidewalk", "asphalt", "asphalt_dark", "gravel", "mud", "moss", "rust",
] as const;

export type LayerName = (typeof LAYER_NAMES)[number];

/** A layer as the manifest lists it. */
export type TownLayer = {
  readonly name: LayerName;
  readonly index: number;
  /** The work's asset id, or "shingles" for the layer the build script makes. */
  readonly id: string;
  /** The id of the work's section in CREDITS.md (where it came from, by whom, under what licence), null for a generated layer. */
  readonly credit: string | null;
  /** Made by the build script, not scanned. */
  readonly generated: boolean;
  /** Metres the 512 x 512 layer spans across (u) and up (v). */
  readonly tile: readonly [number, number];
  /** The tile size is the project's estimate from the picture, not the catalogue's figure. */
  readonly tileEstimated: boolean;
  /** The colour file is neutral detail (mean 0.5, grey) for the vertex colour to paint. */
  readonly paintable: boolean;
  readonly color: string;
  readonly data: string;
  readonly note: string;
};

export const TOWN_LAYERS: readonly TownLayer[] = manifest.layers as unknown as readonly TownLayer[];

/** The side of every layer's images, texels. */
export const LAYER_SIZE: number = manifest.size;

/** What a paintable layer's colour is multiplied by in the shader: its stored mean is 1 / this. */
export const PAINT_GAIN: number = manifest.paintGain;

/** The wear overlays: moss and grime, and rust (`Surface.wearKind`). */
export const WEAR_OVERLAY = { moss: "moss", rust: "rust", peel: "planks_peeling", mud: "mud" } as const satisfies Record<string, LayerName>;

/** The vertex's layer for "none": no texture, the vertex colour as it is. */
export const NO_LAYER = -1;

const BY_NAME = new Map<string, TownLayer>(TOWN_LAYERS.map((layer) => [layer.name, layer]));

/** The layer called `name`; throws for a name the manifest does not have. */
export function townLayer(name: LayerName): TownLayer {
  const layer = BY_NAME.get(name);
  if (layer === undefined) throw new Error(`the town has no texture layer "${name}"`);
  return layer;
}

/** The layer's index in the arrays. */
export function layerIndex(name: LayerName): number {
  return townLayer(name).index;
}
