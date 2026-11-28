/**
 * The town's two texture arrays on Babylon Lite: a layer each of colour and of data for every layer of the manifest
 * (`townLayers.ts`), 512 x 512 on the tiers above low and 256 x 256 on low (the images are decoded at that size).
 *
 * Read as the engine reads its ground layers (`groundLayers.ts`): each image decoded with no colour management and no
 * premultiplied alpha, its rows turned over so v = 0 is the image's bottom row, laid one layer after another into an RGBA8
 * array with a mip chain, trilinear, repeating both ways. They differ in one thing: the colour array is read as sRGB
 * (`rgba8unorm-srgb`, so the sampler's filtering and the mips are made in linear light and the shader gets linear colour),
 * where the engine's ground albedos are read as stored and divided by a mean; the town's layers carry real colours and
 * paint, so they are decoded the way the base colour of Lite's own material is. The data array is read as data.
 *
 * The arrays are made empty (`createTexture2DArray`) when the renderer's part is, and filled in place by one upload when
 * the last image lands (`updateTexture2DArrayFromPixels` regenerates the mips), so the material binds the same textures for
 * its whole life and no bind group is made again. Until then the material's `townReady` is 0 (`townMaterial.ts`).
 */
import { createTexture2DArray, updateTexture2DArrayFromPixels, type EngineContext } from "@babylonjs/lite";
import { textureUrl } from "@csarkosh/engine/game/assetUrls";
import { decodeGroundLayer } from "@csarkosh/engine/game/groundLayers";
import { LAYER_SIZE, TOWN_LAYERS } from "./townLayers.js";
import type { TownTextureSet } from "./townMaterial.js";

/** The side of the arrays' images on a tier. */
export function townTextureSize(low: boolean): number {
  return low ? LAYER_SIZE / 2 : LAYER_SIZE;
}

/** How many images the arrays are made from. */
export const TOWN_IMAGES = TOWN_LAYERS.length * 2;

/** Bytes of GPU memory the two arrays take, with their mip chains (a third more than the base level). */
export function townTextureBytes(low: boolean): number {
  const size = townTextureSize(low);
  return Math.round(size * size * 4 * TOWN_LAYERS.length * 2 * (4 / 3));
}

export type TownTextures = TownTextureSet & {
  /** Settles true when the arrays are filled, false when they could not be (an image missing, or the renderer gone). */
  readonly done: Promise<boolean>;
  /** Images not yet decoded: for the renderer's count of files still loading. */
  pending(): number;
};

/** The shipped address of a layer's file ("textures/town.<name>.color.webp"), by the registered assets. */
export function townImageUrl(file: string): string {
  return textureUrl(`textures/${file}`);
}

/** At most this many images are in flight: a decoded image is a megabyte, and the browser decodes them on its own threads. */
const IN_FLIGHT = 4;

/** A set of layers to make arrays of: the files of each layer, and the sides the colour and the data arrays are made at (they may differ: the rooms' data is a quarter the size of its colour). */
export type LayerFiles = {
  /** What the warning says when the set does not load: "the town's textures", and what stays as it was. */
  readonly what: string;
  readonly layers: readonly { readonly index: number; readonly color: string; readonly data: string }[];
  readonly colorSize: number;
  readonly dataSize: number;
};

/** The town's set, at the size of a tier. */
function townFiles(low: boolean): LayerFiles {
  const size = townTextureSize(low);
  return { what: "the town's textures did not load; the town stays flat colour:", layers: TOWN_LAYERS, colorSize: size, dataSize: size };
}

/**
 * Makes the arrays and begins loading their images. `signal` ends the fetches of a renderer that has gone. `landed` is
 * called once the arrays have been filled, with whether they were.
 */
export function createTownTextures(engine: EngineContext, low: boolean, signal: AbortSignal, landed: (filled: boolean) => void): TownTextures {
  return createLayerTextures(engine, townFiles(low), signal, landed);
}

/**
 * The same for any set of layers (`townFiles`; the rooms' set is `interiorTextures.ts`'s): two arrays, a layer each, filled in place by one upload
 * when every image has been decoded (four at a time, by the engine's decoder, which fetches through the engine's own retries and takes a file
 * asked for ahead). A set that cannot load settles false once, with a warning that says what stays as it was.
 */
export function createLayerTextures(engine: EngineContext, files: LayerFiles, signal: AbortSignal, landed: (filled: boolean) => void): TownTextures {
  const { colorSize, dataSize } = files;
  const layers = files.layers.length;
  const color = createTexture2DArray(engine, colorSize, colorSize, layers, { mipMaps: true, srgb: true });
  const data = createTexture2DArray(engine, dataSize, dataSize, layers, { mipMaps: true, srgb: false });
  let left = layers * 2;
  // Set once the load has settled: a worker still running after a failure goes on counting down, which is no business of whoever asks what is left.
  let settled = false;
  const colorPer = colorSize * colorSize * 4;
  const dataPer = dataSize * dataSize * 4;

  async function load(): Promise<boolean> {
    const colorBytes = new Uint8Array(colorPer * layers);
    const dataBytes = new Uint8Array(dataPer * layers);
    const jobs: (() => Promise<void>)[] = [];
    for (const layer of files.layers) {
      jobs.push(async () => {
        colorBytes.set(await decodeGroundLayer(townImageUrl(layer.color), colorSize, signal), layer.index * colorPer);
        left--;
      });
      jobs.push(async () => {
        dataBytes.set(await decodeGroundLayer(townImageUrl(layer.data), dataSize, signal), layer.index * dataPer);
        left--;
      });
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) await (jobs[next++] as () => Promise<void>)();
    };
    await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
    signal.throwIfAborted();
    updateTexture2DArrayFromPixels(engine, color, colorBytes);
    updateTexture2DArrayFromPixels(engine, data, dataBytes);
    return true;
  }

  const done = load().then(
    (filled) => {
      settled = true;
      left = 0;
      landed(filled);
      return filled;
    },
    (error: unknown) => {
      settled = true;
      left = 0;
      // A renderer let go mid-load is no fault; a missing or broken image leaves the town as flat colour, and says so once.
      if (!signal.aborted) console.warn(files.what, error);
      landed(false);
      return false;
    },
  );
  return { color, data, done, pending: () => (settled ? 0 : left) };
}
