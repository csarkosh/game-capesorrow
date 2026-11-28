// The sign atlas is as tall as the signs it holds: the height the town's signs reach on each tier, that nothing is dropped that main
// did not drop, that no two rectangles overlap and every one is inside the texture, that each sign keeps its size in texels, and that a
// quad's UV, written when its sign was placed, is carried to exactly its rectangle's place in the packed atlas.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import type { SignSpec } from "../../src/game/town/townTypes.js";
import { townGeometry, townGround, type TownBatch } from "../../src/game/town/townGeometry.js";

const SPEC = { kind: "board", style: "vinyl", lines: ["A"], decade: 2020, condition: 1, lit: false, seed: 1, bg: [1, 1, 1], fg: [0, 0, 0], accent: [0, 0, 0], clear: false, w: 1, h: 1 } as SignSpec;

const fnv = (t: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
};

/** An atlas that keeps what `place` gave back, in the order of its requests (a sign not placed has none). */
class Recording extends SignAtlas {
  readonly given: { u0: number; v0: number; u1: number; v1: number }[] = [];
  override place(widthM: number, heightM: number, spec: SignSpec): ReturnType<SignAtlas["place"]> {
    const at = super.place(widthM, heightM, spec);
    this.given.push(at);
    return at;
  }
}

/**
 * What the atlas holds on each town and tier: how many signs, how many dropped, the digest of every rectangle's width and height in
 * order (main's own for the full tiers and for 20261121 low, whose signs all fit there), the digest of every packed rectangle (x, y,
 * width, height: the full tiers' are what the first fit made, main's placements packed), the fitted height, and what main held: its
 * signs, the signs it dropped for want of shelf in the old layout, and the height it used (the foot of its lowest rectangle).
 */
const MAIN = {
  "sorrow full": { signs: 676, dropped: 0, sizes: 3192142475, rects: 238359474, fitted: 1024, main: { signs: 676, dropped: 0, bottom: 2036 } },
  "sorrow low": { signs: 299, dropped: 0, sizes: 0, rects: 3611427201, fitted: 832, main: { signs: 212, dropped: 87, bottom: 1018 } },
  "20261121 full": { signs: 382, dropped: 0, sizes: 2864457279, rects: 4055546948, fitted: 640, main: { signs: 382, dropped: 0, bottom: 2040 } },
  "20261121 low": { signs: 171, dropped: 0, sizes: 3291383464, rects: 122810261, fitted: 448, main: { signs: 171, dropped: 0, bottom: 856 } },
} as const;

const rectsDigest = (a: SignAtlas): number => {
  let h = 0x811c9dc5;
  for (const r of a.requests) for (const v of [r.x, r.y, r.w, r.h]) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h;
};

const sizesDigest = (a: SignAtlas): number => {
  let h = 0x811c9dc5;
  for (const r of a.requests) for (const v of [r.w, r.h]) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h;
};

const built = new Map<string, { atlas: Recording; batches: TownBatch[] }>();
function town(name: keyof typeof MAIN): { atlas: Recording; batches: TownBatch[] } {
  let t = built.get(name);
  if (t === undefined) {
    const [token, tier] = name.split(" ") as [string, "full" | "low"];
    const atlas = tier === "low" ? new Recording(2048, 1024, 36) : new Recording(4096, 2048, 56);
    const batches = finish(townGeometry(townGround(/^\d+$/.test(token as string) ? Number(token) : fnv(token as string)), tier, { x: 0, z: 0 }, atlas));
    t = { atlas, batches };
    built.set(name, t);
  }
  return t;
}

describe("the sign atlas of the town", () => {
  for (const name of Object.keys(MAIN) as (keyof typeof MAIN)[]) {
    describe(name, () => {
      it("holds the signs main held, each the size main gave it, and drops none more", () => {
        const { atlas } = town(name);
        expect(atlas.dropped).toBe(MAIN[name].dropped);
        expect(atlas.requests.length).toBe(MAIN[name].signs);
        // Every sign main held, and the ones it dropped for want of shelf in the old layout, are held now.
        expect(atlas.requests.length).toBe(MAIN[name].main.signs + MAIN[name].main.dropped);
        if (MAIN[name].sizes !== 0) expect(sizesDigest(atlas)).toBe(MAIN[name].sizes);
        expect(rectsDigest(atlas)).toBe(MAIN[name].rects);
      }, 600000);

      it("is as tall as the packed signs reach, a multiple of 64, and no taller than the layout main used", () => {
        const { atlas } = town(name);
        expect(atlas.fittedHeight).toBe(MAIN[name].fitted);
        expect(atlas.fittedHeight % 64).toBe(0);
        expect(atlas.fittedHeight).toBeLessThan(atlas.height);
        expect(atlas.fittedHeight).toBeLessThanOrEqual(Math.ceil(MAIN[name].main.bottom / 64) * 64);
        const foot = Math.max(...atlas.requests.map((r) => r.y + r.h));
        expect(foot).toBeLessThanOrEqual(atlas.fittedHeight);
        expect(foot).toBeGreaterThan(atlas.fittedHeight - 64);
      }, 600000);

      it("has every rectangle inside the texture and no two that touch", () => {
        const { atlas } = town(name);
        const rs = atlas.requests;
        for (const r of rs) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(atlas.width);
          expect(r.y + r.h).toBeLessThanOrEqual(atlas.fittedHeight);
        }
        // Sorted by left edge, each rectangle is tried against those whose left edge falls before its right edge (with the 2 texel gutter).
        const byX = rs.slice().sort((a, b) => a.x - b.x);
        let touching = 0;
        for (let i = 0; i < byX.length; i++) {
          const a = byX[i] as (typeof byX)[number];
          for (let j = i + 1; j < byX.length; j++) {
            const b = byX[j] as (typeof byX)[number];
            if (b.x >= a.x + a.w + 2) break;
            if (b.y < a.y + a.h + 2 && a.y < b.y + b.h + 2) touching++;
          }
        }
        expect(touching).toBe(0);
      }, 600000);

      it("carries every quad's UV to exactly its rectangle's place in the packed atlas", () => {
        const { atlas } = town(name);
        expect(atlas.given.length).toBe(atlas.requests.length);
        // The rectangle a sign was given, carried now, is the rectangle it is painted at, corner by corner.
        const w = atlas.width;
        const h = atlas.fittedHeight;
        atlas.given.forEach((g, k) => {
          const r = atlas.finalOf(k) as NonNullable<ReturnType<SignAtlas["finalOf"]>>;
          const uvs = new Float32Array([g.u0, g.v0, g.u1, g.v0, g.u1, g.v1, g.u0, g.v1]);
          atlas.carry(uvs, [0, 1, 2, 0, 2, 3]);
          const want = [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h];
          for (let c = 0; c < 4; c++) {
            expect((uvs[2 * c] as number) * w).toBeCloseTo(want[2 * c] as number, 2);
            expect((uvs[2 * c + 1] as number) * h).toBeCloseTo(want[2 * c + 1] as number, 2);
          }
        });
      }, 600000);

      it("has every sign polygon in one rectangle's reach: none runs into a neighbour's, and none is far from its own", () => {
        const { atlas, batches } = town(name);
        const w = atlas.width;
        const h = atlas.fittedHeight;
        const at = (u: number, v: number): number => {
          const px = u * w;
          const py = v * h;
          return atlas.requests.findIndex((r) => px >= r.x - 1e-3 && px <= r.x + r.w + 1e-3 && py >= r.y - 1e-3 && py <= r.y + r.h + 1e-3);
        };
        let triangles = 0;
        let mixed = 0;
        let lost = 0;
        for (const b of batches) {
          if (b.layer !== "sign") continue;
          const uv = b.arrays.uvs;
          const ix = b.arrays.indices;
          for (let t = 0; t + 2 < ix.length; t += 3) {
            triangles++;
            const rects = new Set([0, 1, 2].map((o) => at(uv[2 * (ix[t + o] as number)] as number, uv[2 * (ix[t + o] as number) + 1] as number)).filter((r) => r >= 0));
            if (rects.size > 1) mixed++;
            if (rects.size === 0) lost++;
          }
        }
        expect(triangles).toBeGreaterThan(0);
        expect(mixed).toBe(0);
        expect(lost).toBe(0);
      }, 600000);
    });
  }

  it("keeps the same layout for the same town", () => {
    const again = new SignAtlas(4096, 2048, 56);
    finish(townGeometry(townGround(20261121), "full", { x: 0, z: 0 }, again));
    const first = town("20261121 full").atlas;
    expect(again.fittedHeight).toBe(first.fittedHeight);
    expect(again.requests.map((r) => [r.x, r.y, r.w, r.h])).toEqual(first.requests.map((r) => [r.x, r.y, r.w, r.h]));
  }, 600000);

  it("places nothing once it is fitted, and a tiny atlas still takes every sign until it is fitted", () => {
    const a = new SignAtlas(256, 128, 10);
    expect(a.place(20, 6, SPEC)).not.toBeNull();
    expect(a.place(20, 6, SPEC)).not.toBeNull();
    expect(a.place(20, 6, SPEC)).not.toBeNull();
    expect(a.dropped).toBe(0);
    a.fit();
    expect(() => a.place(2, 1, SPEC)).toThrow();
  });

  it("drops, when the packed signs would pass the cap, the smallest faces first and the last placed among equals, and only as many as it takes", () => {
    const a = new SignAtlas(256, 128, 10);
    // Three big faces (200 x 60 texels) and two notices (30 x 10): the three together need 182 rows, the cap is 128.
    const rects = [a.place(20, 6, SPEC), a.place(3, 1, SPEC), a.place(20, 6, SPEC), a.place(3, 1, SPEC), a.place(20, 6, SPEC)];
    // One quad (two triangles) a face, at the rectangle the face was given.
    const uvs = new Float32Array(rects.flatMap((r) => [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1]));
    const indices = rects.flatMap((_, q) => [4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3]);
    a.fit();
    // Both notices go, then the last of the big faces: three dropped, two kept.
    expect(a.dropped).toBe(3);
    expect([0, 1, 2, 3, 4].map((k) => a.finalOf(k) === null)).toEqual([false, true, false, true, true]);
    expect(a.requests.length).toBe(2);
    expect(a.fittedHeight).toBe(128);
    const [r0, r2] = a.requests as [(typeof a.requests)[number], (typeof a.requests)[number]];
    expect(r0.y + r0.h + 2).toBeLessThanOrEqual(r2.y);
    expect(r2.y + r2.h).toBeLessThanOrEqual(128);
    // The dropped faces' triangles are gone from the batch, the kept ones are where the rectangles are.
    const kept = a.carry(uvs, indices);
    expect(kept.length).toBe(12);
    expect(Array.from(kept as ArrayLike<number>).every((i) => [0, 1, 2, 3, 8, 9, 10, 11].includes(i))).toBe(true);
    expect((uvs[0] as number) * 256).toBeCloseTo(r0.x, 3);
    expect((uvs[1] as number) * 128).toBeCloseTo(r0.y, 3);
    expect((uvs[16] as number) * 256).toBeCloseTo(r2.x, 3);
    expect((uvs[17] as number) * 128).toBeCloseTo(r2.y, 3);
  });

  it("takes every sign into its planning layout past the cap, and drops only as many as the packed rows need", () => {
    const a = new SignAtlas(256, 128, 10);
    // Sixteen faces of 100 x 20 texels, two a shelf: the planning layout runs to 176 rows, past the 128 cap, and refuses none.
    for (let k = 0; k < 16; k++) a.place(10, 2, SPEC);
    expect(a.dropped).toBe(0);
    a.fit();
    // Five shelves of two fit the cap (5 x 22 - 2 = 108 rows), six do not (130).
    expect(a.requests.length).toBe(10);
    expect(a.dropped).toBe(6);
    expect(Math.max(...a.requests.map((r) => r.y + r.h))).toBeLessThanOrEqual(128);
  });
});
