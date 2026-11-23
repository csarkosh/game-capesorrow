import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { RAIL_CORRIDOR_HALF, railCenterX } from "../../src/sim/town/rail.js";
import { CROSSING_MIN_SIN, crossingsFor } from "../../src/sim/town/railCrossings.js";
import { POLE_OFFSET, POLE_SPACING, POLE_STREET_CLEAR, poleAt, polesIn } from "../../src/sim/town/powerLine.js";
import { segDist } from "../../src/sim/town/geom.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";

const SEEDS = [20261121, 1, 7, 424242];

describe("the town's crossings of the main line", () => {
  it("are found on the line and on their own street, from the plan's streets and roads", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const a = siteFor(seed).anchor;
      const list = crossingsFor(plan, seed, a);
      expect(list.length, `seed ${seed}`).toBeGreaterThan(3);
      let last = -Infinity;
      for (const c of list) {
        expect(Math.abs(c.x - railCenterX(seed, c.z))).toBeLessThan(1e-6);
        expect(c.z).toBeGreaterThanOrEqual(last);
        last = c.z;
        if (!c.road) {
          const st = plan.streets.find((s) => s.id === c.way);
          expect(st, `street ${c.way}`).toBeDefined();
          const s = st as (typeof plan.streets)[number];
          expect(segDist({ x: c.x - a.x, z: c.z - a.z }, s.a, s.b)).toBeLessThan(1e-3);
          expect(s.kind).not.toBe("highway");
          expect(s.kind).not.toBe("rail");
        }
        expect(Math.hypot(c.dx, c.dz)).toBeCloseTo(1, 9);
        expect(c.dx).toBeLessThanOrEqual(0);
      }
      expect(CROSSING_MIN_SIN).toBeGreaterThan(0);
    }
  });
});

describe("the power line", () => {
  it("stands its poles inland of the highway about every 45 m, and never in a street's roadway", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const a = siteFor(seed).anchor;
      const poles = polesIn(seed, -1500, 1500);
      expect(poles.length).toBeGreaterThan(1500 / POLE_SPACING);
      let worstGap = 0;
      let shifted = 0;
      for (let i = 0; i < poles.length; i++) {
        const p = poles[i] as (typeof poles)[number];
        expect(p.x - roadCenterX(seed, p.z)).toBeCloseTo(POLE_OFFSET, 9);
        expect(p.x - railCenterX(seed, p.z)).toBeGreaterThan(RAIL_CORRIDOR_HALF);
        if (i > 0) worstGap = Math.max(worstGap, Math.abs(p.z - (poles[i - 1] as (typeof poles)[number]).z));
        if (Math.abs(p.z - p.k * POLE_SPACING) > 3.01) shifted++;
        for (const st of plan.streets) {
          if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf") continue;
          expect(segDist({ x: p.x - a.x, z: p.z - a.z }, st.a, st.b), `seed ${seed} pole ${p.k} street ${st.id}`).toBeGreaterThan(st.roadway / 2 + POLE_STREET_CLEAR - 1e-9);
        }
      }
      expect(worstGap).toBeLessThan(POLE_SPACING + 30);
      expect(shifted).toBeGreaterThan(0);
    }
  });

  it("is a pure function of the seed and the pole's index", () => {
    expect(poleAt(7, 12)).toEqual(poleAt(7, 12));
    expect(polesIn(7, 0, 300)).toEqual(polesIn(7, 0, 300));
  });
});
