/**
 * The look's two readings of the hour that the town's material is written from: what its glows are multiplied by so that a lit
 * thing stays bright while the night's grade darkens the frame (`litGainAt`), and how much day there is (`daylightAt`).
 */
import { describe, expect, it } from "vitest";
import { daylightAt, litGainAt } from "../src/look.js";

describe("the look by the hour", () => {
  it("leaves the glows as drawn by day and lifts them through the night", () => {
    for (const h of [9, 12, 15]) expect(litGainAt(h)).toBe(1);
    for (const h of [23, 0, 2]) expect(litGainAt(h)).toBeGreaterThan(2);
    // Never dimmed, and it moves smoothly: no step of an hour's hundredth changes it by more than a twentieth.
    for (let h = 0; h < 24; h += 0.01) {
      expect(litGainAt(h)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(litGainAt(h + 0.01) - litGainAt(h))).toBeLessThan(0.05);
    }
  });

  it("has all of the day at noon, none of it at midnight, and passes between them once each way", () => {
    expect(daylightAt(12)).toBe(1);
    expect(daylightAt(0)).toBe(0);
    let turns = 0;
    for (let h = 0; h < 24; h += 0.05) {
      const a = daylightAt(h);
      const b = daylightAt(h + 0.05);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      if ((a === 0 || a === 1) && b > 0 && b < 1) turns++;
    }
    expect(turns).toBe(2);
  });
});
