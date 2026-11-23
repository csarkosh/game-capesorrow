import { describe, expect, it } from "vitest";
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { BAY_CENTRE_MAX, BAY_END_MAX, BAY_END_MIN, BAY_FADE, BAY_HALF_MAX, BAY_HALF_MIN, bayOf, townBlendEnd, townBlendWindowD } from "../../src/sim/town/blend.js";
import { SEEDS } from "../town/sites.js";

describe("the bay is the seed's", () => {
  it("is drawn within its ranges, the same each time, and differs between worlds", () => {
    const ends = new Set<number>();
    const centres: number[] = [];
    for (const seed of SEEDS) {
      const bay = bayOf(seed);
      expect(bayOf(seed)).toEqual(bay);
      expect(townBlendEnd(seed)).toBe(bay.end);
      expect(bay.end).toBeGreaterThanOrEqual(BAY_END_MIN);
      expect(bay.end).toBeLessThanOrEqual(BAY_END_MAX);
      expect(bay.half).toBeGreaterThanOrEqual(BAY_HALF_MIN);
      expect(bay.half).toBeLessThanOrEqual(BAY_HALF_MAX);
      expect(Math.abs(bay.centre)).toBeLessThanOrEqual(BAY_CENTRE_MAX);
      ends.add(Math.round(bay.end));
      centres.push(bay.centre);
    }
    expect(ends.size).toBeGreaterThanOrEqual(35);
    // Some bays open north of the cove, some south of it, and some sit square on it.
    expect(centres.filter((c) => c > 150).length).toBeGreaterThanOrEqual(5);
    expect(centres.filter((c) => c < -150).length).toBeGreaterThanOrEqual(5);
    expect(centres.filter((c) => Math.abs(c) <= 150).length).toBeGreaterThanOrEqual(5);
    // Both a narrow shelf and a broad plain turn up in forty worlds.
    expect(Math.min(...SEEDS.map((s) => bayOf(s).end))).toBeLessThan(1100);
    expect(Math.max(...SEEDS.map((s) => bayOf(s).end))).toBeGreaterThan(2000);
  });

  it("has a window of 1 inside its half length, 0 beyond the fade, and an exact slope between", () => {
    for (const seed of [1, 2, 3, 20261121]) {
      const bay = bayOf(seed);
      const c = COVE_Z + bay.centre;
      expect(townBlendWindowD(c, seed)).toEqual({ v: 1, dz: 0 });
      expect(townBlendWindowD(c + bay.half - 1, seed).v).toBe(1);
      expect(townBlendWindowD(c - bay.half + 1, seed).v).toBe(1);
      expect(townBlendWindowD(c + bay.half + BAY_FADE + 1, seed).v).toBe(0);
      expect(townBlendWindowD(c - bay.half - BAY_FADE - 1, seed).v).toBe(0);
      const H = 0.001;
      for (const side of [-1, 1]) {
        for (let k = 1; k < 12; k++) {
          const z = c + side * (bay.half + (BAY_FADE * k) / 12);
          const w = townBlendWindowD(z, seed);
          const fd = (townBlendWindowD(z + H, seed).v - townBlendWindowD(z - H, seed).v) / (2 * H);
          expect(w.dz).toBeCloseTo(fd, 6);
          expect(w.v).toBeGreaterThan(0);
          expect(w.v).toBeLessThan(1);
        }
      }
    }
  });
});
