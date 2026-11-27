/**
 * The rooms' two texture arrays on Babylon Lite: the interiors' set (`interiorLayers.ts`, `interior.layers.json`), made as the town's are
 * (`townTextures.ts`, whose loader this uses) and read the same way. It is read by `insideParts.ts` and nothing else, and only when a player
 * first starts to walk into a room that is drawn from a design (or is put straight in one): never with the town, so a player in the street
 * has not asked for a byte of it and the arrays are not in the GPU's memory. Once made they are kept for the session.
 *
 * Sizes: the colour array's layers are 512 x 512 and the data array's 256 x 256 on the tiers above low, and half of each on low. The set holds 11
 * layers, so the arrays take (512 x 512 + 256 x 256) x 4 bytes x 11 x 4/3 with their mips, 19.2 MB (4.8 MB on low): under the 22 MB the set was
 * given.
 */
import type { EngineContext } from "@babylonjs/lite";
import { INTERIOR_COLOR_SIZE, INTERIOR_DATA_SIZE, INTERIOR_LAYERS } from "./interiorLayers.js";
import { createLayerTextures, type LayerFiles, type TownTextures } from "./townTextures.js";

/** The sides of the colour and the data arrays' images on a tier. */
export function interiorTextureSizes(low: boolean): { readonly color: number; readonly data: number } {
  return low ? { color: INTERIOR_COLOR_SIZE / 2, data: INTERIOR_DATA_SIZE / 2 } : { color: INTERIOR_COLOR_SIZE, data: INTERIOR_DATA_SIZE };
}

/** Bytes of GPU memory the two arrays take, with their mip chains (a third more than the base level). */
export function interiorTextureBytes(low: boolean): number {
  const { color, data } = interiorTextureSizes(low);
  return Math.round((color * color + data * data) * 4 * INTERIOR_LAYERS.length * (4 / 3));
}

/**
 * Makes the arrays and begins loading their images (22 files, about a megabyte). `signal` ends the fetches of a renderer that has gone. `landed`
 * is called once, with whether the arrays were filled. A failure is a warning and `landed(false)`: the room is then drawn on the town's arrays.
 */
export function createInteriorTextures(engine: EngineContext, low: boolean, signal: AbortSignal, landed: (filled: boolean) => void): TownTextures {
  const { color, data } = interiorTextureSizes(low);
  const files: LayerFiles = {
    what: "the rooms' textures did not load; the room is drawn with the town's textures:",
    layers: INTERIOR_LAYERS,
    colorSize: color,
    dataSize: data,
  };
  return createLayerTextures(engine, files, signal, landed);
}
