/**
 * A vertex's surface record as the GPU holds it: the twelve numbers `MeshBuilder` writes (`SURFACE_FLOATS`: a layer, two wears and their
 * kinds, a glow, a tint, how clear, a pane's size and tilt, a rank) as twelve 16-bit floats, 24 bytes where twelve 32-bit floats were 48.
 * For 1.9 million vertices that is 46 MB of the GPU's memory. A 16-bit float holds every whole number to 2,048 exactly (the layers, the
 * kinds, the ranks, a wire's width in millimetres) and any other value to one part in two thousand (a tint, a wear, a pane's size in
 * metres), which is finer than the eight bits a texture's own colour has.
 *
 * The plugin declares its attributes as `float16x4` (`townMaterial.ts`): the shader still reads `vec4<f32>`.
 */

/** Bytes of a packed record. */
export const SURFACE_PACKED_BYTES = 24;

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

/**
 * The records of `surface` (twelve 32-bit floats a vertex) packed, as the array Lite uploads: a `Float32Array` over the packed bytes (Lite
 * writes a mesh's plugin data by its length in 32-bit words, and 24 bytes a vertex is a whole number of them), six words a vertex.
 */
export function packSurface(surface: Float32Array): Float32Array {
  const halves = new Uint16Array(surface.length);
  for (let i = 0; i < surface.length; i++) halves[i] = toHalf(surface[i] as number);
  return new Float32Array(halves.buffer);
}
