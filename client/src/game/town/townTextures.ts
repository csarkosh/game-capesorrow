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

/**
 * Makes the arrays and begins loading their images. `signal` ends the fetches of a renderer that has gone. `landed` is
 * called once the arrays have been filled, with whether they were.
 */
export function createTownTextures(engine: EngineContext, low: boolean, signal: AbortSignal, landed: (filled: boolean) => void): TownTextures {
  const size = townTextureSize(low);
  const layers = TOWN_LAYERS.length;
  const color = createTexture2DArray(engine, size, size, layers, { mipMaps: true, srgb: true });
  const data = createTexture2DArray(engine, size, size, layers, { mipMaps: true, srgb: false });
  let left = TOWN_IMAGES;
  const per = size * size * 4;

  async function load(): Promise<boolean> {
    const colorBytes = new Uint8Array(per * layers);
    const dataBytes = new Uint8Array(per * layers);
    const jobs: (() => Promise<void>)[] = [];
    for (const layer of TOWN_LAYERS) {
      jobs.push(async () => {
        colorBytes.set(await decodeGroundLayer(townImageUrl(layer.color), size, signal), layer.index * per);
        left--;
      });
      jobs.push(async () => {
        dataBytes.set(await decodeGroundLayer(townImageUrl(layer.data), size, signal), layer.index * per);
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
      left = 0;
      landed(filled);
      return filled;
    },
    (error: unknown) => {
      left = 0;
      // A renderer let go mid-load is no fault; a missing or broken image leaves the town as flat colour, and says so once.
      if (!signal.aborted) console.warn("the town's textures did not load; the town stays flat colour:", error);
      landed(false);
      return false;
    },
  );
  return { color, data, done, pending: () => left };
}
