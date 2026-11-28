/**
 * The look's two readings of the hour that the town's material is written from: what its glows are multiplied by so that a lit
 * thing stays bright while the night's grade darkens the frame (`litGainAt`), and how much day there is (`daylightAt`).
 */
import { describe, expect, it } from "vitest";
import { PORTASHTON_LOOK, daylightAt, litGainAt } from "../src/look.js";

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

describe("the look's line far off", () => {
  it("is as it was within a street's width, and thins out over a long reach beyond it", () => {
    const finish = PORTASHTON_LOOK.finish;
    expect(finish).toBeDefined();
    if (finish === undefined) return;
    // A shop front across a street (15 to 30 m) and the far end of a block must be drawn in full.
    expect(finish.lineNear).toBeGreaterThanOrEqual(30);
    expect(finish.lineNear).toBeLessThanOrEqual(60);
    // A long ease, so there is no ring where the line changes: the far end is at least eight times the near.
    expect((finish.lineFar ?? 0) / (finish.lineNear ?? 1)).toBeGreaterThanOrEqual(8);
    // Far off a step must be deeper to draw (or a forested hill is a thicket of outlines), and what is drawn is lighter, but it is still drawn.
    expect(finish.lineFarBand).toBeGreaterThanOrEqual(8);
    expect(finish.lineFarWeight).toBeGreaterThanOrEqual(0.3);
    expect(finish.lineFarWeight).toBeLessThanOrEqual(0.7);
  });
});

describe("the look's line behind a shop's glass", () => {
  it("is drawn on what shows through the glass, by how much of it the pane hides (the engine's `lineThrough`)", () => {
    expect(PORTASHTON_LOOK.finish?.lineThrough).toBe(true);
    // The line itself is still drawn, or there is nothing to draw through.
    expect(PORTASHTON_LOOK.finish?.line).toBeGreaterThan(0);
  });
});
