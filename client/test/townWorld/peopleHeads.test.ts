// Whose head a person has: by their key alone, and as often as the people of the coast's small ports are of each background and age.
import { describe, expect, it } from "vitest";
import { AGE_BANDS, AGE_TOP, GROUP_SHARE, ageShare, headFor, headIdOf, headWeights, type HeadGroup, type HeadSpec } from "../../src/game/town/peopleHeads.js";
import { LOOK_FLOATS, lookOf, writeLook } from "../../src/game/town/peopleLook.js";

const head = (sex: "f" | "m", group: HeadGroup, age: number): HeadSpec => ({ id: `${sex}-${group}-${age}`, sex, group, age });
const WOMEN = [head("f", "white", 35), head("f", "white", 55), head("f", "white", 66), head("f", "white", 78), head("f", "hispanic", 30), head("f", "native", 45), head("f", "black", 28)];
const MEN = [head("m", "white", 25), head("m", "white", 38), head("m", "white", 57), head("m", "white", 70), head("m", "white", 80), head("m", "hispanic", 44), head("m", "native", 50), head("m", "asian", 58)];
const ALL = [...WOMEN, ...MEN];
const sum = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);

describe("the heads people wear", () => {
  it("counts every adult once across the ages", () => {
    expect(sum(AGE_BANDS.map((b) => b.share))).toBeCloseTo(1, 9);
    expect(ageShare(18, AGE_TOP)).toBeCloseTo(1, 9);
    expect(ageShare(18, 25)).toBeCloseTo(0.091, 9);
    expect(ageShare(35, 55)).toBeCloseTo(0.302 / 2 + 0.295 / 2, 9);
    expect(ageShare(40, 40)).toBe(0);
  });

  it("gives a body's heads weights that sum to one, each head some", () => {
    for (const worn of [WOMEN, MEN]) {
      const w = headWeights(worn, ALL, 0.5);
      expect(sum(w)).toBeCloseTo(1, 9);
      for (const v of w) expect(v).toBeGreaterThan(0);
    }
  });

  it("draws the town's people as the ports' adults are by background, a background with heads of one sex only still at its whole share", () => {
    const women = headWeights(WOMEN, ALL, 0.5);
    const men = headWeights(MEN, ALL, 0.5);
    const share = (group: HeadGroup): number =>
      0.5 * sum(women.filter((_, i) => (WOMEN[i] as HeadSpec).group === group)) + 0.5 * sum(men.filter((_, i) => (MEN[i] as HeadSpec).group === group));
    // Those of two or more backgrounds have no head, so every share is the survey's over what the heads can show; the sexes differ a little in that.
    const shown = sum(Object.values(GROUP_SHARE));
    for (const group of Object.keys(GROUP_SHARE) as HeadGroup[]) {
      expect(share(group) / (GROUP_SHARE[group] / shown), group).toBeGreaterThan(0.97);
      expect(share(group) / (GROUP_SHARE[group] / shown), group).toBeLessThan(1.03);
    }
    expect(share("white")).toBeGreaterThan(0.85);
    expect(share("hispanic")).toBeGreaterThan(0.085);
    // Only the men have a head of this background, and only the women of that one.
    expect(sum(men.filter((_, i) => (MEN[i] as HeadSpec).group === "asian"))).toBeGreaterThan(2 * 0.95 * (GROUP_SHARE.asian / shown));
    expect(sum(women.filter((_, i) => (WOMEN[i] as HeadSpec).group === "black"))).toBeGreaterThan(2 * 0.95 * (GROUP_SHARE.black / shown));
  });

  it("draws them as old as the ports' adults are: about three in ten of sixty-five and over, about four in ten under forty-five", () => {
    const women = headWeights(WOMEN, ALL, 0.5);
    const men = headWeights(MEN, ALL, 0.5);
    const of = (test: (age: number) => boolean): number =>
      0.5 * sum(women.filter((_, i) => test((WOMEN[i] as HeadSpec).age))) + 0.5 * sum(men.filter((_, i) => test((MEN[i] as HeadSpec).age)));
    expect(of((age) => age >= 65)).toBeGreaterThan(0.26);
    expect(of((age) => age >= 65)).toBeLessThan(0.36);
    expect(of((age) => age < 45)).toBeGreaterThan(0.33);
    expect(of((age) => age < 45)).toBeLessThan(0.46);
    // Among the heads of one background and sex, each stands for the ages nearest its own.
    const white = women.slice(0, 4);
    expect((white[0] as number) / sum(white)).toBeCloseTo(ageShare(18, 45), 9);
    expect((white[3] as number) / sum(white)).toBeCloseTo(ageShare(72, AGE_TOP), 9);
  });

  it("gives a person the same head every time, and a crowd its heads as often as they are weighted", () => {
    const weights = headWeights(MEN, ALL, 0.5);
    for (const key of [0, 1, 7, 263, 1_000_004]) expect(headFor(key, weights)).toBe(headFor(key, weights));
    const counts = new Array<number>(weights.length).fill(0);
    const n = 40_000;
    for (let key = 0; key < n; key++) counts[headFor(key, weights)] = (counts[headFor(key, weights)] as number) + 1;
    for (const [i, w] of weights.entries()) expect(Math.abs((counts[i] as number) / n - w), `head ${i}`).toBeLessThan(0.012);
    expect(headFor(5, [])).toBe(-1);
    expect(headFor(5, [1])).toBe(0);
  });

  it("knows a head's primitive by its name", () => {
    expect(headIdOf("head.f-white-35")).toBe("f-white-35");
    expect(headIdOf("prop.cup")).toBeNull();
    expect(headIdOf("person.f-fleece")).toBeNull();
  });

  it("writes a body's hands as the skin of the head it wears, and a head's own skin as its picture has it", () => {
    const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const look = lookOf(12);
    const hands = [0.6, 0.45, 0.4];
    const face = [0.36, 0.22, 0.16];
    const out = new Float32Array(LOOK_FLOATS * 2);
    // The body: no hair of its own, the skin its hands.
    writeLook(out, 0, look, { shoes: { mean: [0.2, 0.2, 0.2] }, bottoms: { mean: [0.2, 0.25, 0.4] }, top: { mean: [0.8, 0.8, 0.8] }, skin: { mean: hands } }, face);
    for (const c of [0, 1, 2] as const) expect((out[c * 4 + 3] as number) * linear(hands[c] as number)).toBeCloseTo(look.skin[c] * linear(face[c] as number), 6);
    // A region the picture lacks multiplies nothing up.
    expect(out[16 + 3]).toBeCloseTo(1, 6);
    // The head: its skin is its own.
    writeLook(out, 1, look, { skin: { mean: face }, hair: { mean: [0.1, 0.08, 0.06] } });
    for (const c of [0, 1, 2] as const) expect(out[LOOK_FLOATS + c * 4 + 3]).toBeCloseTo(look.skin[c], 6);
    expect(out[LOOK_FLOATS + 16]).toBeCloseTo(1, 6);
  });
});
