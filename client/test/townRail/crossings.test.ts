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
const SEEDS40 = [20261121, 424242, 123, 99, ...Array.from({ length: 36 }, (_, i) => i + 1)];

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
        // And it is the plan's: within the site samples' own error (under half a metre) of where the plan put it.
        const mine = plan.rail.crossings[list.indexOf(c)] as (typeof plan.rail.crossings)[number];
        expect(Math.abs(a.x + mine.x - c.x), `seed ${seed}`).toBeLessThan(0.5);
        expect(c.z).toBeCloseTo(a.z + mine.z, 9);
        expect(c.z).toBeGreaterThanOrEqual(last);
        last = c.z;
        if (!c.road) {
          const st = plan.streets.find((s) => s.id === c.way);
          expect(st, `street ${c.way}`).toBeDefined();
          const s = st as (typeof plan.streets)[number];
          // On its street to within 5 cm (the crossing is put on the line's own centre, a few centimetres from where the plan found it).
          expect(segDist({ x: c.x - a.x, z: c.z - a.z }, s.a, s.b)).toBeLessThan(0.05);
          expect(s.kind).not.toBe("highway");
          expect(s.kind).not.toBe("rail");
        }
        expect(Math.hypot(c.dx, c.dz)).toBeCloseTo(1, 9);
        expect(c.dx).toBeLessThanOrEqual(0);
      }
      expect(CROSSING_MIN_SIN).toBeGreaterThan(0);
    }
  });

  it("are the plan's, for forty seeds: every plan crossing is drawn, and nothing is drawn that the plan does not name", () => {
    for (const seed of SEEDS40) {
      const plan = planFor(seed);
      const a = siteFor(seed).anchor;
      const list = crossingsFor(plan, seed, a);
      expect(list.length, `seed ${seed}`).toBe(plan.rail.crossings.length);
      for (const c of plan.rail.crossings) {
        const found = list.filter((d) => d.way === c.way && d.road === c.road && Math.abs(d.z - (a.z + c.z)) < 1e-9);
        expect(found.length, `seed ${seed}: crossing of way ${c.way} at ${c.z}`).toBe(1);
      }
      for (const d of list) expect(plan.rail.crossings.some((c) => c.way === d.way && c.road === d.road && Math.abs(a.z + c.z - d.z) < 1e-9), `seed ${seed}: a crossing the plan does not name`).toBe(true);
    }
  });
});

describe("the power line", () => {
  it("stands its poles inland of the highway about every 45 m, and never in a street's roadway", () => {
    let shiftedAll = 0;
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
        // Nor in an outlying lot (a pole stands 9 m inland of the highway, the lots 14 m or more).
        for (const l of plan.lots) {
          if (l.district !== "outskirts") continue;
          const x0 = Math.min(...l.polygon.map((q) => q.x)) + a.x;
          const x1 = Math.max(...l.polygon.map((q) => q.x)) + a.x;
          const z0 = Math.min(...l.polygon.map((q) => q.z)) + a.z;
          const z1 = Math.max(...l.polygon.map((q) => q.z)) + a.z;
          expect(p.x < x0 - POLE_STREET_CLEAR || p.x > x1 + POLE_STREET_CLEAR || p.z < z0 - POLE_STREET_CLEAR || p.z > z1 + POLE_STREET_CLEAR, `seed ${seed} pole ${p.k} in outlying lot ${l.id}`).toBe(true);
        }
        for (const st of plan.streets) {
          if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf") continue;
          expect(segDist({ x: p.x - a.x, z: p.z - a.z }, st.a, st.b), `seed ${seed} pole ${p.k} street ${st.id}`).toBeGreaterThan(st.roadway / 2 + POLE_STREET_CLEAR - 1e-9);
        }
      }
      expect(worstGap).toBeLessThan(POLE_SPACING + 30);
      shiftedAll += shifted;
    }
    // Over the seeds some pole dodged a street's roadway (a town's grown grid has fewer streets across the highway than the old rectangle's).
    expect(shiftedAll).toBeGreaterThan(0);
  });

  it("is a pure function of the seed and the pole's index", () => {
    expect(poleAt(7, 12)).toEqual(poleAt(7, 12));
    expect(polesIn(7, 0, 300)).toEqual(polesIn(7, 0, 300));
  });
});
