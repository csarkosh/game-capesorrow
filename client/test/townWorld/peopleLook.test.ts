// Each person's own look: by their key alone, from the tables, no two alike among a town's people; the floats the shader is handed; and a body
// made broader without being made taller.
import { describe, expect, it } from "vitest";
import {
  BOTTOMS, GREY_AT, HAIR, LOOK_ATTRIBUTES, LOOK_CODE, LOOK_FLOATS, LOOK_LIGHT, LOOK_OVER, LOOK_SOFT, LOOK_WARM, LOOK_WIDE, MEAN_LEAST, SHOES, SKIN_VARIES, TOPS, lookOf, lookSoft, peopleLookPlugin, widen, writeLook,
} from "../../src/game/town/peopleLook.js";

const REGIONS = {
  shoes: { mean: [0.2, 0.2, 0.2] }, bottoms: { mean: [0.2, 0.25, 0.4] }, top: { mean: [0.8, 0.8, 0.8] }, skin: { mean: [0.7, 0.55, 0.45] }, hair: { mean: [0.1, 0.08, 0.06] },
};
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: readonly number[]): number => 0.2126 * linear(c[0] as number) + 0.7152 * linear(c[1] as number) + 0.0722 * linear(c[2] as number);

describe("a person's look", () => {
  it("is the same for the same person, and from the tables: each colour within the table's own by the person's draws, the body a little broader or narrower", () => {
    for (const key of [0, 1, 7, 263, 1_000_004]) expect(lookOf(key)).toEqual(lookOf(key));
    const near = (c: readonly number[], table: readonly (readonly number[])[]): boolean =>
      table.some((t) => t.every((v, i) => Math.abs((c[i] as number) - v) <= v * (LOOK_LIGHT + LOOK_WARM + LOOK_LIGHT * LOOK_WARM) + 1e-9));
    for (let key = 0; key < 400; key++) {
      const look = lookOf(key);
      expect(near(look.top, TOPS), `top of ${key}`).toBe(true);
      expect(near(look.bottoms, BOTTOMS), `bottoms of ${key}`).toBe(true);
      expect(near(look.shoes, SHOES), `shoes of ${key}`).toBe(true);
      expect(near(look.hair, HAIR), `hair of ${key}`).toBe(true);
      // The skin keeps the picture's tone but for a few parts in a hundred.
      for (const v of look.skin) expect(Math.abs(v - 1)).toBeLessThanOrEqual(SKIN_VARIES * 1.7);
      expect(Math.abs(look.wide - 1)).toBeLessThanOrEqual(LOOK_WIDE + 1e-9);
      for (const c of [...look.top, ...look.bottoms, ...look.shoes, ...look.hair]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is nobody else's among a town's people: of 1,500 keys (the standers' and the walkers'), no two looks are the same, and every colour of every table is worn", () => {
    const seen = new Set<string>();
    const worn = { top: new Set<number>(), bottoms: new Set<number>(), shoes: new Set<number>(), hair: new Set<number>() };
    const nearest = (c: readonly number[], table: readonly (readonly number[])[]): number => {
      let best = 0;
      let d = Infinity;
      for (const [i, t] of table.entries()) {
        const e = Math.hypot((c[0] as number) - (t[0] as number), (c[1] as number) - (t[1] as number), (c[2] as number) - (t[2] as number));
        if (e < d) {
          d = e;
          best = i;
        }
      }
      return best;
    };
    const keys = [...Array.from({ length: 1000 }, (_, i) => i), ...Array.from({ length: 500 }, (_, i) => 1_000_000 + i)];
    for (const key of keys) {
      const look = lookOf(key);
      const text = JSON.stringify([look.top, look.bottoms, look.shoes, look.hair, look.skin].map((c) => c.map((v) => Math.round(v * 255))));
      expect(seen.has(text), `key ${key}`).toBe(false);
      seen.add(text);
      worn.top.add(nearest(look.top, TOPS));
      worn.bottoms.add(nearest(look.bottoms, BOTTOMS));
      worn.shoes.add(nearest(look.shoes, SHOES));
      worn.hair.add(nearest(look.hair, HAIR));
    }
    expect(worn.top.size).toBe(TOPS.length);
    expect(worn.bottoms.size).toBe(BOTTOMS.length);
    expect(worn.shoes.size).toBe(SHOES.length);
    expect(worn.hair.size).toBe(HAIR.length);
    // Neighbours in the list (a pair, a queue) are not dressed alike: the top's colour differs for nine in ten of them.
    let same = 0;
    for (let key = 0; key < 999; key++) if (nearest(lookOf(key).top, TOPS) === nearest(lookOf(key + 1).top, TOPS)) same++;
    expect(same / 999).toBeLessThan(0.14);
  });

  it("does not change who a model is: hair is grey as often as it is at the model's age, a model of dark hair is never made fair, and the skin is the picture's own", () => {
    const hairOf = (c: readonly number[]): number => {
      let best = 0;
      let d = Infinity;
      for (const [i, t] of HAIR.entries()) {
        const e = Math.hypot((c[0] as number) - (t[0] as number), (c[1] as number) - (t[1] as number), (c[2] as number) - (t[2] as number));
        if (e < d) {
          d = e;
          best = i;
        }
      }
      return best;
    };
    // The grey and the white are the table's sixth and seventh.
    const greyShare = (age: "young" | "middle" | "old"): number => {
      let grey = 0;
      for (let key = 0; key < 2000; key++) if ([5, 6].includes(hairOf(lookOf(key, { age, hair: "any" }).hair))) grey++;
      return grey / 2000;
    };
    for (const age of ["young", "middle", "old"] as const) expect(Math.abs(greyShare(age) - GREY_AT[age]), age).toBeLessThan(0.04);
    expect(GREY_AT.young).toBeLessThan(0.06);
    expect(GREY_AT.old).toBeGreaterThan(0.8);
    // Dark hair stays dark until it greys: black or dark brown (the table's first two), or grey.
    for (let key = 0; key < 600; key++) expect([0, 1, 5, 6]).toContain(hairOf(lookOf(key, { age: "middle", hair: "dark" }).hair));
    // Clothes are the same person's whatever the model's traits: only the hair's draw reads them.
    expect(lookOf(77, { age: "old", hair: "dark" }).top).toEqual(lookOf(77).top);
  });

  it("is written as twenty floats: each region's colour, linear, the skin's tone beside them, and one over each region's mean luminance in the model's picture", () => {
    const out = new Float32Array(LOOK_FLOATS * 3).fill(-1);
    const look = lookOf(12);
    writeLook(out, 1, look, REGIONS);
    expect([...out.slice(0, LOOK_FLOATS)]).toEqual(new Array(LOOK_FLOATS).fill(-1));
    expect([...out.slice(LOOK_FLOATS * 2)]).toEqual(new Array(LOOK_FLOATS).fill(-1));
    const at = LOOK_FLOATS;
    for (const [slot, colour, mean] of [[0, look.top, REGIONS.top.mean], [1, look.bottoms, REGIONS.bottoms.mean], [2, look.shoes, REGIONS.shoes.mean], [3, look.hair, REGIONS.hair.mean]] as const) {
      for (let i = 0; i < 3; i++) expect(out[at + slot * 4 + i]).toBeCloseTo(linear(colour[i] as number), 6);
      // A texel at the region's mean luminance is drawn the look's colour: its luminance times this is 1.
      expect((out[at + 16 + slot] as number) * lum(mean)).toBeCloseTo(1, 5);
    }
    expect([out[at + 3], out[at + 7], out[at + 11]]).toEqual(look.skin.map((v) => Math.fround(v)));
    // A region the picture has all but black is not multiplied without end.
    writeLook(out, 0, look, { ...REGIONS, shoes: { mean: [0, 0, 0] } });
    expect(out[16 + 2]).toBeCloseTo(1 / MEAN_LEAST, 3);
    // Brighter than the mean counts for less than in proportion, and never more than 1.8 times; darker is as it is.
    expect(lookSoft(0.4)).toBe(0.4);
    expect(lookSoft(1)).toBe(1);
    expect(lookSoft(2)).toBeGreaterThan(1.3);
    expect(lookSoft(2)).toBeLessThan(1.6);
    expect(lookSoft(50)).toBeLessThanOrEqual(1 + LOOK_OVER);
    expect(LOOK_SOFT).toContain(LOOK_OVER.toFixed(2));
  });

  it("makes a body broader across and through, and no taller, wherever it faces", () => {
    const m = new Float32Array(32);
    // A body turned 0.7 rad at scale 1.1, as the engine writes one: columns x, y, z and the place.
    const c = Math.cos(0.7) * 1.1;
    const s = Math.sin(0.7) * 1.1;
    m.set([c, 0, -s, 0, 0, 1.1, 0, 0, s, 0, c, 0, 5, 6, 7, 1], 16);
    widen(m, 1, 1.05);
    expect(Math.hypot(m[16] as number, m[17] as number, m[18] as number)).toBeCloseTo(1.1 * 1.05, 5);
    expect(Math.hypot(m[24] as number, m[25] as number, m[26] as number)).toBeCloseTo(1.1 * 1.05, 5);
    expect([m[20], m[21], m[22]]).toEqual([0, Math.fround(1.1), 0]);
    expect([m[28], m[29], m[30], m[31]]).toEqual([5, 6, 7, 1]);
    expect([...m.slice(0, 16)]).toEqual(new Array(16).fill(0));
  });

  it("hands the shader five attributes of twenty floats a body, and code that leaves a texel with no region as its picture has it", () => {
    expect(LOOK_ATTRIBUTES.map((a) => a.offset)).toEqual([0, 16, 32, 48, 64]);
    for (const a of LOOK_ATTRIBUTES) expect(a.stride).toBe(LOOK_FLOATS * 4);
    const plugin = peopleLookPlugin();
    expect(plugin.getInstanceAttributes?.()).toBe(LOOK_ATTRIBUTES);
    expect(plugin.getVaryings?.().map((v) => v.name)).toEqual(["vLookA", "vLookB", "vLookC", "vLookD", "vLookE"]);
    // The lamps' plugin is 200: the look comes first, so the lamps light its colours.
    expect(plugin.priority).toBeLessThan(200);
    // The code's own arithmetic, worked here: at alpha 1 (region 5) every weight but the picture's own is nothing.
    const weights = (alpha: number): number[] => [0, 1, 2, 3, 4].map((id) => Math.min(1, Math.max(0, 1 - Math.abs(alpha * 5 - id))));
    expect(weights(1)).toEqual([0, 0, 0, 0, 0]);
    expect(weights(0.4)).toEqual([0, 0, 1, 0, 0]);
    // Between the top (2) and what is on the legs (1): half of each, and nothing of any other.
    expect(weights(0.3).map((w) => Math.round(w * 100) / 100)).toEqual([0, 0.5, 0.5, 0, 0]);
    expect(LOOK_CODE).toContain("baseColorSample.a*5.0");
    expect(LOOK_CODE).toContain("alpha=1.0;");
  });
});
