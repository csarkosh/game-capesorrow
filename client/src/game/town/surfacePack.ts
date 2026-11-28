/**
 * A vertex's surface record as the GPU holds it: the twelve numbers `MeshBuilder` writes (`SURFACE_FLOATS`: a layer, two wears and their
 * kinds, a glow, a tint, how clear, a pane's size and tilt, a rank) in 16 bytes, where twelve 32-bit floats were 48 and twelve 16-bit floats 24.
 * For 2.15 million vertices that is 34 MB of the GPU's memory instead of 52.
 *
 * Four attributes, every format one every WebGPU browser has (`townMaterial.ts` declares them; `unpackSurface` is the shader's arithmetic for the tests):
 *
 * - bytes 0 to 3, `float16x2`: the two floats that need range and fine steps, the hours or a pane's tilt or a wall's height over the ground (float 10),
 *   and the sky or the rank or the other tilt (float 11). Exactly as the 16-bit floats gave them.
 * - bytes 4 to 7, `uint32`: the tint's red and green, 12 bits each, and the first wear's amount, 0 to 1 (1/255 a step).
 * - bytes 8 to 11, `uint32`: the tint's blue, 12 bits; the glow, `GLOW_STEPS` to 1 from -1; how clear, 0 to 1 (1/255); the first wear's whole kind (4 bits).
 * - bytes 12 to 15, `uint32`: the layer's index plus one (5 bits, so that no layer is 0); the first wear's kind's fraction (a streak's half, or a pane's seed)
 *   in `SEED_STEPS`ths, so that a half is exact (7 bits); float 8, the second wear's amount or a pane's height or a sheet's colour, 10 bits, `HEIGHT_PER_UNIT`
 *   to 1 (0 to 4); float 9, the second wear's kind or a pane's width or a sheet's colour, 10 bits, `KIND_PER_UNIT` to 1 (0 to 16): wholes and halves are exact.
 *
 * A tint runs past 1 (up to 13.9): each is kept as its square root, `TINT_ONE` steps to 1, so 1 and the simple multiples of it are exact, the largest is 16,
 * and a tint is within 0.05 percent at 1 and 0.2 percent at 0.1 (a 16-bit float held it to 0.05 percent). Fewer bits showed: ten bits a colour changed the
 * low tier's pictures by 0.4 of a level on average, all of it the tint.
 *
 * The shader unpacks at the top of the plugin's vertex code into the names the rest of it has always read (`townSurface`, `townTint`,
 * `townWear`), so nothing below it changes.
 */
import { TOWN_LAYERS } from "./townLayers.js";

/** Bytes of a packed record. */
export const SURFACE_PACKED_BYTES = 16;

/** Layer codes: the layers and "no layer" (-1), which is code 0. Held in 5 bits. */
export const LAYER_CODES = TOWN_LAYERS.length + 1;
/** Steps of the tint's square root to a tint of 1 (12 bits a colour: the largest is (4095/1024)^2 = 16). */
export const TINT_ONE = 1024;
/** Steps to 1 of the kind's fraction: an even number, so that a half is a whole step. */
export const SEED_STEPS = 126;
/** Steps to 1 of the glow (-1 is step 0). */
export const GLOW_STEPS = 50;
/** Steps to 1 of float 8 (10 bits: 0 to 4) and of float 9 (10 bits: 0 to 16). */
export const HEIGHT_PER_UNIT = 256;
export const KIND_PER_UNIT = 64;

const F = new Float32Array(1);
const U = new Uint32Array(F.buffer);

/** The 16-bit float nearest `value` (round to nearest, ties to even; past its range, infinity). */
export function toHalf(value: number): number {
  F[0] = value;
  const x = U[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man !== 0 ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    // Too small for a normal half: a subnormal, or nothing.
    if (e < -10) return sign;
    man |= 0x800000;
    const shift = 14 - e;
    const half = man >>> shift;
    const rest = man & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    return sign | (rest > mid || (rest === mid && (half & 1) === 1) ? half + 1 : half);
  }
  const half = (e << 10) | (man >>> 13);
  const rest = man & 0x1fff;
  // A carry out of the mantissa runs into the exponent, which is what it should do.
  return sign | (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1) ? half + 1 : half);
}

/** The value a 16-bit float holds (for the tests and for reading a record back). */
export function fromHalf(h: number): number {
  const sign = (h & 0x8000) !== 0 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const man = h & 0x3ff;
  if (exp === 0) return sign * man * 2 ** -24;
  if (exp === 31) return man !== 0 ? NaN : sign * Infinity;
  return sign * (1 + man / 1024) * 2 ** (exp - 15);
}

const byte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
const field = (v: number, max: number): number => (v <= 0 ? 0 : v >= max ? max : Math.round(v));

/**
 * The records of `surface` (twelve 32-bit floats a vertex) packed, as the array Lite uploads: a `Float32Array` over the packed bytes (Lite
 * writes a mesh's plugin data by its length in 32-bit words, and 16 bytes a vertex is four of them).
 */
export function packSurface(surface: Float32Array): Float32Array {
  const n = surface.length / 12;
  const buffer = new ArrayBuffer(n * SURFACE_PACKED_BYTES);
  const halves = new Uint16Array(buffer);
  const words = new Uint32Array(buffer);
  for (let v = 0; v < n; v++) {
    const s = v * 12;
    halves[v * 8] = toHalf(surface[s + 10] as number);
    halves[v * 8 + 1] = toHalf(surface[s + 11] as number);
    const tint = (k: number): number => field(Math.sqrt(Math.max(0, surface[s + 4 + k] as number)) * TINT_ONE, 4095);
    const kind = Math.max(0, surface[s + 2] as number);
    let whole = Math.floor(kind);
    let fraction = Math.round((kind - whole) * SEED_STEPS);
    if (fraction === SEED_STEPS) {
      whole++;
      fraction = 0;
    }
    words[v * 4 + 1] = (tint(0) | (tint(1) << 12) | (byte((surface[s + 1] as number) * 255) << 24)) >>> 0;
    words[v * 4 + 2] = (tint(2) | (byte(((surface[s + 3] as number) + 1) * GLOW_STEPS) << 12) | (byte((surface[s + 7] as number) * 255) << 20) | (field(whole, 15) << 28)) >>> 0;
    const layer = field(Math.round(surface[s] as number) + 1, LAYER_CODES - 1);
    words[v * 4 + 3] = (layer | (fraction << 5) | (field((surface[s + 8] as number) * HEIGHT_PER_UNIT, 1023) << 12) | (field((surface[s + 9] as number) * KIND_PER_UNIT, 1023) << 22)) >>> 0;
  }
  return new Float32Array(buffer);
}

/** The twelve numbers of vertex `v` of a packed array, as the vertex stage unpacks them (for the tests): into `out`, twelve long. */
export function unpackSurface(packed: Float32Array, v: number, out: Float32Array): void {
  const halves = new Uint16Array(packed.buffer, packed.byteOffset, packed.byteLength / 2);
  const words = new Uint32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4);
  out[10] = fromHalf(halves[v * 8] as number);
  out[11] = fromHalf(halves[v * 8 + 1] as number);
  const a = words[v * 4 + 1] as number;
  const b = words[v * 4 + 2] as number;
  const w = words[v * 4 + 3] as number;
  const red = (a & 4095) / TINT_ONE;
  const green = ((a >>> 12) & 4095) / TINT_ONE;
  const blue = (b & 4095) / TINT_ONE;
  out[4] = red * red;
  out[5] = green * green;
  out[6] = blue * blue;
  out[0] = (w & 31) - 1;
  out[1] = (a >>> 24) / 255;
  out[2] = (b >>> 28) + ((w >>> 5) & 127) / SEED_STEPS;
  out[3] = ((b >>> 12) & 255) / GLOW_STEPS - 1;
  out[7] = ((b >>> 20) & 255) / 255;
  out[8] = ((w >>> 12) & 1023) / HEIGHT_PER_UNIT;
  out[9] = (w >>> 22) / KIND_PER_UNIT;
}
