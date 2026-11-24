import { describe, expect, it } from "vitest";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { SURFACE_PACKED_BYTES, fromHalf, packSurface, toHalf } from "../../src/game/town/surfacePack.js";

/** A vertex's surface record is packed to 16-bit floats for the GPU: half the bytes, and nothing the shader reads is changed by it. */
describe("the packed surface record", () => {
  it("is twelve 16-bit floats, a whole number of 32-bit words", () => {
    expect(SURFACE_PACKED_BYTES).toBe(SURFACE_FLOATS * 2);
    expect(SURFACE_PACKED_BYTES % 4).toBe(0);
    const packed = packSurface(new Float32Array(SURFACE_FLOATS * 5));
    expect(packed.byteLength).toBe(SURFACE_PACKED_BYTES * 5);
    expect(packed.length * 4).toBe(packed.byteLength);
  });

  it("holds every whole number the record uses exactly: no layer, the layers, the kinds and their halves, the ranks, a wire's millimetres", () => {
    for (const v of [-1, 0, 1, 2, 21, 0.5, 8.5, 3, 7, -1, -12, -50, -2048, 2048, 1]) expect(fromHalf(toHalf(v)), String(v)).toBe(v);
  });

  it("holds a tint, a wear, a glow and a pane's size to one part in two thousand", () => {
    for (const v of [0.001, 0.03, 0.12, 0.3333, 0.62, 0.999, 1.15, 2.2, 4.31, 9.99, 10, 37.5, 0.0245]) expect(Math.abs(fromHalf(toHalf(v)) - v) / v, String(v)).toBeLessThan(1 / 2000);
    for (const v of [-0.03, -0.2]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThan(1e-4);
  });

  it("rounds to the nearest, keeps zero and the sign, and saturates past its range", () => {
    expect(toHalf(0)).toBe(0);
    expect(fromHalf(toHalf(-0))).toBe(-0);
    expect(fromHalf(toHalf(1e9))).toBe(Infinity);
    expect(fromHalf(toHalf(1e-12))).toBe(0);
    // Between 1 and its next half (1 + 1/1024): the nearer wins.
    expect(fromHalf(toHalf(1 + 0.4 / 1024))).toBe(1);
    expect(fromHalf(toHalf(1 + 0.6 / 1024))).toBe(1 + 1 / 1024);
    // The largest mantissa rounds up into the next exponent.
    expect(fromHalf(toHalf(1.99999))).toBe(2);
  });

  it("packs a record in order", () => {
    const record = new Float32Array([3, 0.25, 1.5, 0, 1.2, 0.8, 0.6, 0, 0.1, 4, 0, 2]);
    const halves = new Uint16Array(packSurface(record).buffer);
    expect(Array.from(halves, fromHalf).map((v) => Math.round(v * 1000) / 1000)).toEqual([3, 0.25, 1.5, 0, 1.2, 0.8, 0.6, 0, 0.1, 4, 0, 2]);
  });
});
