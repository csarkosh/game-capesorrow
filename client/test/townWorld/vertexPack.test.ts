import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { SURFACE_PACKED_BYTES, fromHalf } from "../../src/game/town/surfacePack.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { COLOR_BYTES, INDEX16_BELOW, NORMAL_BYTES, NORMAL_FORMAT, indexBytes, packColors, packNormals, packVertices, packedBytes } from "../../src/game/town/vertexPack.js";

/** A town vertex is 52 bytes, not 64 (48 with 8-bit normals): the normal in `NORMAL_FORMAT`'s bytes, the colour in 16-bit floats, and 16-bit indices where the batch is small. */
const SCALE = NORMAL_FORMAT === "snorm8x4" ? 127 : 32767;
/** The largest angle, in degrees, a unit normal may be turned by: half a step on the worst axis, over the three axes. */
const MAX_DEGREES = NORMAL_FORMAT === "snorm8x4" ? 0.4 : 0.002;

const degrees = (a: readonly number[], b: readonly number[]): number => {
  const dot = (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
  return (Math.acos(Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
};
const decodeNormal = (p: Int8Array | Int16Array, i: number): number[] => [Math.max(-1, (p[i * 4] as number) / SCALE), Math.max(-1, (p[i * 4 + 1] as number) / SCALE), Math.max(-1, (p[i * 4 + 2] as number) / SCALE)];

describe("the packed vertex", () => {
  it("is 52 bytes with its surface record: position 12, uv 8, normal 8 and colour 8, and the record's 16 (48 with 8-bit normals)", () => {
    expect(NORMAL_BYTES).toBe(NORMAL_FORMAT === "snorm8x4" ? 4 : 8);
    expect(COLOR_BYTES).toBe(8);
    // 100 vertices, 300 indices: 12 + 8 + 8 + 8 + 16 = 52 a vertex (it was 64) and 2 bytes an index (it was 4).
    expect(packedBytes(100, 300, 100 * SURFACE_PACKED_BYTES)).toBe(100 * (NORMAL_FORMAT === "snorm8x4" ? 48 : 52) + 300 * 2);
    expect(packedBytes(100, 300, 100 * SURFACE_PACKED_BYTES)).toBe(100 * (12 + 8 + NORMAL_BYTES + 8 + SURFACE_PACKED_BYTES) + 600);
    expect(packedBytes(70000, 300, 0)).toBe(70000 * (12 + 8 + NORMAL_BYTES + 8) + 1200);
  });

  it("takes 16-bit indices below 65,536 vertices and 32-bit from there", () => {
    expect(INDEX16_BELOW).toBe(65536);
    expect(indexBytes(1)).toBe(2);
    expect(indexBytes(65535)).toBe(2);
    expect(indexBytes(65536)).toBe(4);
    const idx = new Uint32Array([0, 1, 2, 65534, 65535, 0]);
    const small = packVertices(65535, new Float32Array(65535 * 3), new Float32Array(65535 * 4), idx);
    expect(small.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(small.indices)).toEqual(Array.from(idx));
    const large = packVertices(65536, new Float32Array(65536 * 3), new Float32Array(65536 * 4), idx);
    expect(large.indices).toBe(idx);
  });

  it("says the formats the renderer is to take the arrays in, and makes the arrays of that kind and four values a vertex", () => {
    const p = packVertices(3, new Float32Array(9), new Float32Array(12), new Uint32Array([0, 1, 2]));
    expect(p.formats).toEqual({ normalFormat: NORMAL_FORMAT, colorFormat: "float16x4" });
    expect(p.normals).toBeInstanceOf(NORMAL_FORMAT === "snorm8x4" ? Int8Array : Int16Array);
    expect(p.normals.length).toBe(12);
    expect(p.colors).toBeInstanceOf(Uint16Array);
    expect(p.colors.length).toBe(12);
  });

  it("holds the axes exactly, a zero normal as zero, and a unit normal within its bound of angle", () => {
    const axes = new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0]);
    const p = packNormals(axes);
    for (let i = 0; i < 7; i++) {
      expect(decodeNormal(p, i)).toEqual([axes[i * 3] === 0 ? 0 : axes[i * 3], axes[i * 3 + 1] === 0 ? 0 : axes[i * 3 + 1], axes[i * 3 + 2] === 0 ? 0 : axes[i * 3 + 2]].map((v) => v as number));
      expect(p[i * 4 + 3]).toBe(0);
    }
    let seed = 1;
    const next = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const normals = new Float32Array(30000);
    for (let i = 0; i < 10000; i++) {
      const a = next() * 2 * Math.PI, z = next() * 2 - 1, r = Math.sqrt(1 - z * z);
      normals.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
    }
    const q = packNormals(normals);
    let worst = 0;
    for (let i = 0; i < 10000; i++) worst = Math.max(worst, degrees([normals[i * 3] as number, normals[i * 3 + 1] as number, normals[i * 3 + 2] as number], decodeNormal(q, i)));
    expect(worst).toBeLessThan(MAX_DEGREES);
  });

  it("clamps what a normal's rounding would carry past a whole", () => {
    const p = packNormals(new Float32Array([1.0001, -1.0001, 0]));
    expect(p[0]).toBe(SCALE);
    expect(p[1]).toBe(-SCALE);
  });

  it("holds a colour within 0.0005, and the codes the alpha carries and the whole numbers exactly where a 16-bit float does", () => {
    const values = [0, 1, 0.5, 0.25, 0.02, 0.05, 1 / 16, 3 / 16, 7 / 16, 15 / 16, 1.571, 0.3, 0.77, 1.2, 0.0123];
    const colors = new Float32Array(values.length);
    colors.set(values);
    const packed = packColors(colors);
    expect(packed.length).toBe(colors.length);
    for (let i = 0; i < values.length; i++) expect(Math.abs(fromHalf(packed[i] as number) - (colors[i] as number)), String(values[i])).toBeLessThan(0.0005);
    for (const v of [0, 1, 0.5, 0.25]) expect(fromHalf(packColors(new Float32Array([v]))[0] as number)).toBe(v);
  });
});

/** Every batch of two towns' tiers: the packed normals and colours against the arrays they came from, and the indices. */
describe("the packed vertex over the town", () => {
  for (const [name, seed, detail] of [["the full tier of 20261121", 20261121, "full"], ["the low tier of 20261121", 20261121, "low"]] as const) {
    it(`stays within its bounds over every vertex of ${name}`, () => {
      const batches = finish(townGeometry(townGround(seed), detail, { x: 0, z: 0 }));
      let vertices = 0, small = 0, worstAngle = 0, worstColour = 0, worstLength = 0, was = 0, now = 0;
      for (const batch of batches) {
        const a = batch.arrays;
        const n = a.positions.length / 3;
        const p = packVertices(n, a.normals, a.colors, a.indices);
        expect(p.normals.length).toBe(n * 4);
        expect(p.colors.length).toBe(n * 4);
        expect(p.indices.length).toBe(a.indices.length);
        expect(p.indices.BYTES_PER_ELEMENT).toBe(indexBytes(n));
        if (p.indices !== a.indices) for (let i = 0; i < a.indices.length; i++) if (p.indices[i] !== a.indices[i]) expect.fail(`index ${i} of a batch`);
        for (let v = 0; v < n; v++) {
          worstAngle = Math.max(worstAngle, degrees([a.normals[v * 3] as number, a.normals[v * 3 + 1] as number, a.normals[v * 3 + 2] as number], decodeNormal(p.normals, v)));
          worstLength = Math.max(worstLength, Math.abs(Math.hypot(a.normals[v * 3] as number, a.normals[v * 3 + 1] as number, a.normals[v * 3 + 2] as number) - 1));
          for (let k = 0; k < 4; k++) worstColour = Math.max(worstColour, Math.abs(fromHalf(p.colors[v * 4 + k] as number) - (a.colors[v * 4 + k] as number)));
        }
        vertices += n;
        if (p.indices !== a.indices) small++;
        was += n * (12 + 12 + 8 + 16 + SURFACE_PACKED_BYTES) + a.indices.length * 4;
        now += packedBytes(n, a.indices.length, n * SURFACE_PACKED_BYTES);
      }
      expect(vertices).toBeGreaterThan(100000);
      expect(worstAngle).toBeLessThan(MAX_DEGREES);
      expect(worstColour).toBeLessThan(0.0005);
      // The town's normals are unit (a zero one is a face of no size), which is what the packed formats and the shader's renormalising assume.
      expect(worstLength).toBeLessThan(1e-3);
      expect(now).toBeLessThan(was);
      console.log(`${name}: ${vertices} vertices in ${batches.length} batches (${small} with 16-bit indices); worst normal ${worstAngle.toFixed(3)} degrees, worst colour ${worstColour.toFixed(5)}, worst normal length off by ${worstLength.toFixed(5)}; ${(was / 1e6).toFixed(1)} MB became ${(now / 1e6).toFixed(1)} MB`);
    }, 600000);
  }
});
