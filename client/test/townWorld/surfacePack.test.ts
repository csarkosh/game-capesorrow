import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { GLOW_STEPS, HEIGHT_PER_UNIT, KIND_PER_UNIT, SEED_STEPS, SURFACE_PACKED_BYTES, TINT_ONE, fromHalf, packSurface, toHalf, unpackSurface } from "../../src/game/town/surfacePack.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { NO_LAYER, TOWN_LAYERS } from "../../src/game/town/townLayers.js";

/** A vertex's surface record is packed to 16 bytes for the GPU: two numbers as 16-bit floats and the rest as bit fields in three words, and nothing the shader reads is changed beyond the bounds below. */
const one = (record: number[]): Float32Array => {
  const out = new Float32Array(SURFACE_FLOATS);
  unpackSurface(packSurface(new Float32Array(record)), 0, out);
  return out;
};

describe("the packed surface record", () => {
  it("is sixteen bytes, four 32-bit words, and the twelve numbers of the builder", () => {
    expect(SURFACE_FLOATS).toBe(12);
    expect(SURFACE_PACKED_BYTES).toBe(16);
    const packed = packSurface(new Float32Array(SURFACE_FLOATS * 5));
    expect(packed.byteLength).toBe(SURFACE_PACKED_BYTES * 5);
    expect(packed.length * 4).toBe(packed.byteLength);
  });

  it("holds every whole number the 16-bit floats keep exactly: the kinds and their halves, the ranks, a wire's millimetres", () => {
    for (const v of [-1, 0, 1, 2, 21, 0.5, 8.5, 3, 7, -1, -12, -50, -2048, 2048, 1]) expect(fromHalf(toHalf(v)), String(v)).toBe(v);
  });

  it("holds the hours or a pane's tilt, and the sky or the rank, as 16-bit floats, to one part in two thousand", () => {
    for (const v of [0.001, 0.03, 0.12, 0.3333, 0.62, 0.999, 1.15, 2.2, 4.31, 9.99, 10, 37.5, 0.0245]) expect(Math.abs(fromHalf(toHalf(v)) - v) / v, String(v)).toBeLessThan(1 / 2000);
    for (const v of [-0.03, -0.2]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThan(1e-4);
    const out = one([0, 0, 0, 0, 1, 1, 1, 0, 0.33, 6, 1973, 7.396]);
    expect([out[10], out[11]]).toEqual([1973, fromHalf(toHalf(7.396))]);
    expect(Math.abs((out[8] as number) - 0.33)).toBeLessThanOrEqual(1 / (2 * HEIGHT_PER_UNIT) + 1e-6);
    expect(out[9]).toBe(6);
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

  it("returns the whole numbers exactly: every layer and no layer, every kind with its half, the glow's whole steps, a tint of 1 and the simple multiples of it", () => {
    for (let layer = NO_LAYER; layer < TOWN_LAYERS.length; layer++) {
      for (const kind of [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8]) {
        const out = one([layer, 0, kind, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
        expect(out[0], `layer ${layer}`).toBe(layer);
        expect(out[2], `kind ${kind}`).toBe(kind);
      }
    }
    for (const glow of [-1, 0, 1, 2, 3, 4, 0.5, 1.5, 2.5, 3.5]) expect(one([0, 0, 0, glow, 1, 1, 1, 0, 0, 0, 0, 0])[3], `glow ${glow}`).toBe(glow);
    for (const tint of [0, 1, 0.25, 2.25, 4, 9]) expect(one([0, 0, 0, 0, tint, tint, tint, 0, 0, 0, 0, 0]).slice(4, 7), `tint ${tint}`).toEqual(new Float32Array([tint, tint, tint]));
    for (const unit of [0, 1]) expect(one([0, unit, 0, 0, 1, 1, 1, unit, 0, 0, 0, 0]).filter((_, i) => i === 1 || i === 7)).toEqual(new Float32Array([unit, unit]));
  });

  it("keeps the first wear's whole kind and a pane's seed apart, and carries a seed that rounds up to the next whole", () => {
    const out = one([5, 0.25, 6.35, 0, 1, 1, 1, 0.5, 0, 0, 0, 0]);
    expect(out[2]).toBeCloseTo(6.35, 2);
    expect(Math.abs((out[2] as number) - 6.35)).toBeLessThanOrEqual(1 / (2 * SEED_STEPS) + 1e-6);
    expect(one([5, 0, 6.9999, 0, 1, 1, 1, 0, 0, 0, 0, 0])[2]).toBe(7);
    expect(one([NO_LAYER, 0, 4.005, 0, 1, 1, 1, 0, 0, 0, 0, 0])[0]).toBe(NO_LAYER);
  });

  it("is laid out as the plugin declares it: two halves, then three words of tint, wear, glow, clear, layer, kind and second wear", () => {
    const record = new Float32Array([3, 0.5, 2.5, 1, 4, 1, 0.25, 0.8, 0.1, 4, 600, 2]);
    const packed = packSurface(record);
    const halves = new Uint16Array(packed.buffer);
    expect([fromHalf(halves[0] as number), fromHalf(halves[1] as number)]).toEqual([600, 2]);
    const words = new Uint32Array(packed.buffer);
    expect(words[1]).toBe(((2 * TINT_ONE) | (TINT_ONE << 12) | (Math.round(0.5 * 255) << 24)) >>> 0);
    expect(words[2]).toBe(((TINT_ONE / 2) | (2 * GLOW_STEPS << 12) | (Math.round(0.8 * 255) << 20) | (2 << 28)) >>> 0);
    expect(words[3]).toBe((4 | (SEED_STEPS / 2 << 5) | (Math.round(0.1 * HEIGHT_PER_UNIT) << 12) | (4 * KIND_PER_UNIT << 22)) >>> 0);
  });

  it("saturates a number past what its byte holds rather than wrapping it", () => {
    const out = one([NO_LAYER, 2, 0, 9, 99, 99, -1, 3, 0, 0, 0, 0]);
    expect(out[1]).toBe(1);
    expect(out[3]).toBeCloseTo(255 / GLOW_STEPS - 1, 5);
    expect(out[4]).toBe((4095 / TINT_ONE) ** 2);
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(1);
  });
});

/**
 * Every record of two towns, both tiers, packed and unpacked, against the largest error each of the twelve may have:
 * - the layer and the glow's whole steps exactly; the first wear's kind within half a step of its fraction, 1/252 (a whole kind exactly);
 * - the two amounts and how clear within 1/255 (a byte's step is 1/255, half of it is the most rounding costs);
 * - the glow within 1/100 (its step is 1/50);
 * - a tint within a step of its square root, `sqrt(t) / 1024` and a whisker (0.03 percent of a tint of 14, 0.2 percent of 0.3);
 * - the second wear's amount (float 8) within 1/512 and its kind (float 9) within 1/128, whole numbers and halves exactly;
 * - the hours or the pane's tilt, and the sky or the rank exactly as a 16-bit float gave them before.
 */
describe("the packed surface record over the town", () => {
  for (const [name, seed, detail] of [["the full tier of 20261121", 20261121, "full"], ["the low tier of 20261121", 20261121, "low"]] as const) {
    it(`stays within its bounds over every vertex of ${name}`, () => {
      const batches = finish(townGeometry(townGround(seed), detail, { x: 0, z: 0 }));
      const worst = new Array<number>(12).fill(0);
      const sum = new Array<number>(12).fill(0);
      const out = new Float32Array(SURFACE_FLOATS);
      let vertices = 0;
      for (const batch of batches) {
        const s = batch.arrays.surface;
        const packed = packSurface(s);
        expect(packed.byteLength).toBe((s.length / SURFACE_FLOATS) * SURFACE_PACKED_BYTES);
        for (let v = 0; v < s.length / SURFACE_FLOATS; v++, vertices++) {
          unpackSurface(packed, v, out);
          for (let c = 0; c < SURFACE_FLOATS; c++) {
            const x = s[v * SURFACE_FLOATS + c] as number;
            let bound = 0;
            let error = Math.abs((out[c] as number) - x);
            if (c === 0) bound = 0;
            else if (c === 1 || c === 7) bound = 1 / 510 + 1e-7;
            else if (c === 2) bound = Number.isInteger(x * 2) ? 0 : 1 / (2 * SEED_STEPS) + 1e-6;
            else if (c === 3) bound = 1 / (2 * GLOW_STEPS) + 1e-6;
            else if (c <= 6) bound = Math.sqrt(x) / TINT_ONE + 1e-6;
            else if (c === 8) bound = 1 / (2 * HEIGHT_PER_UNIT) + 1e-6;
            else if (c === 9) bound = 1 / (2 * KIND_PER_UNIT) + 1e-6;
            else error = Math.abs((out[c] as number) - fromHalf(toHalf(x)));
            worst[c] = Math.max(worst[c] as number, error);
            sum[c] = (sum[c] as number) + error;
            if (error > bound) expect.fail(`float ${c} of vertex ${v}: ${x} came back as ${out[c]}`);
          }
        }
      }
      expect(vertices).toBeGreaterThan(100000);
      // The whole numbers of the layer come back with no error at all.
      expect(worst[0]).toBe(0);
      console.log(`${name}: ${vertices} vertices, worst error of each float`, worst.map((w) => Number(w.toPrecision(2))).join(" "));
    }, 600000);
  }
});
