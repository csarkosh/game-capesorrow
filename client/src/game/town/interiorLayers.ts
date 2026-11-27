/**
 * The rooms' texture layers as the build script wrote them (`tools/textures/build.py`: `client/assets/textures/interior.layers.json` and the WebP files
 * beside it). The rooms have a set of their own, made by the same steps as the town's (`townLayers.ts`) but loaded only when a player first walks into a
 * building (`interiorTextures.ts`, read by `insideParts.ts` alone). It is self-contained: the seven layers that only the rooms use (marble, carpet, oak, dark
 * wood, cloth, glazed tile, cane) and the four outdoor ones the rooms use as well (brick, sidewalk concrete, stucco, painted steel), so a room samples one pair
 * of arrays. Its colour files are `size` square and its data files `dataSize` square. Babylon-free, so the builders read it as plain data.
 *
 * This file is the manifest's data and nothing else: it is read by the builders (a layer's tile size and mean colour, for a surface's frame and tint) and so is
 * in the town's code, where the images are not: a few hundred bytes of numbers.
 */
import manifest from "../../../assets/textures/interior.layers.json" with { type: "json" };
import type { TownLayer } from "./townLayers.js";

/** A layer of the rooms' set: a town layer's fields, and the average linear colour of its colour file, which a tint is divided by. */
export type InteriorLayer = Omit<TownLayer, "name"> & { readonly name: string; readonly mean: readonly [number, number, number] };

/** Every layer of the set, in the order of its arrays. */
export const INTERIOR_LAYERS: readonly InteriorLayer[] = manifest.layers as unknown as readonly InteriorLayer[];

/** The side of the colour files' images, and of the data files', texels. */
export const INTERIOR_COLOR_SIZE: number = manifest.size;
export const INTERIOR_DATA_SIZE: number = manifest.dataSize;

/** A layer's place in the set's arrays by its name, or undefined where the set has none of that name. */
export function interiorIndex(name: string): number | undefined {
  return INTERIOR_LAYERS.find((layer) => layer.name === name)?.index;
}
