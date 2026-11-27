/**
 * Nothing the plan places stands on the railroad. Over `SEEDS` (forty world seeds) and over twenty more, no building (its porch and its
 * addition with it), outlying building, fence, vehicle, trailer, bin, mailbox, gear, bench, litter, pole, light or terminal yard stands within
 * its clearance of the main line's or the spur's centre: a building's wall within `BED_HALF` + 2.5 m, anything else within `BED_HALF` + 1.5 m
 * (the bed is 2 m a side). A lot the track crosses is kept as a yard of gravel, weeds and brush, and every town still has its landmarks.
 */
import { describe, expect, it } from "vitest";
import { onTracks, BED_HALF, BUILDING_CLEAR, PROP_CLEAR } from "./trackClearance.js";
import { lineShapeDist, PROP_OFFSET } from "../../src/sim/town/railKeepOut.js";
import { mainLineOf } from "../../src/sim/town/railLine.js";
import { SEEDS, townFor } from "./sites.js";

const MORE = Array.from({ length: 20 }, (_, i) => 41 + i);
const ALL = [...SEEDS, ...MORE];

describe("the railroad's corridor is clear", () => {
  it("names its clearances", () => {
    expect(BED_HALF).toBe(2);
    expect(BUILDING_CLEAR).toBe(2.5);
    expect(PROP_CLEAR).toBe(1.5);
    expect(ALL.length).toBeGreaterThanOrEqual(40);
  });

  it("has nothing on either line in any of the seeds", () => {
    let withSpur = 0;
    for (const seed of ALL) {
      const { plan, site } = townFor(seed);
      if (plan.rail.spurs.length > 0) withSpur++;
      const hits = onTracks(plan, site).map((h) => `${h.on} ${h.kind} ${h.id} at ${h.d.toFixed(1)} m`);
      expect(hits, `seed ${seed}`).toEqual([]);
    }
    // The test means something only where there are tracks to keep clear.
    expect(withSpur).toBeGreaterThan(40);
  });

  it("keeps every landmark and a lot beside the track as a yard, not a lawn", () => {
    for (const seed of ALL) {
      const { plan, site } = townFor(seed);
      for (const role of ["municipal building", "port terminal", "mill", "high school", "hospital"] as const) expect(plan.landmarks.some((l) => l.role === role), `seed ${seed} ${role}`).toBe(true);
      for (const lot of plan.lots) {
        const crossed = [mainLineOf(site), ...plan.rail.spurs.map((sp) => sp.points)].some((l) => lineShapeDist(l, lot.polygon) < PROP_OFFSET);
        const paved = ["core", "dock", "waterfront", "mill", "industrial", "highway strip"].includes(plan.blocks[lot.block]!.district);
        if (crossed && !paved) expect(["bare", "brush", "tall"], `seed ${seed} lot ${lot.id}`).toContain(plan.yards[lot.id]!.kind);
      }
      for (const g of plan.gaps) expect(["demolished", "poor corner", "shore", "rail"]).toContain(g.why);
    }
  });
});
