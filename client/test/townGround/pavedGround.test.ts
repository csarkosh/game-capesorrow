import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { APRON_FRONT, APRON_SIDE, isPaved, pavedGround } from "../../src/sim/town/pavedGround.js";
import { area, contains } from "../../src/sim/town/geom.js";
import { planFor } from "../../src/sim/town/planFor.js";

const SEEDS = [20261121, 1, 7, 2, 3, 4, 5, 6, 8, 9];

describe("the paved ground that is not a street", () => {
  it("is every paved district's block and the apron of each lone gas station, motel and fire hall, cached", () => {
    let aprons = 0;
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const list = pavedGround(plan);
      expect(pavedGround(plan)).toBe(list);
      const blocks = list.filter((g) => g.kind === "block");
      expect(blocks.length).toBe(plan.blocks.filter((b) => isPaved(b.district)).length);
      for (const g of list) {
        expect(area(g.polygon)).toBeGreaterThan(0);
        if (g.kind === "block") continue;
        aprons++;
        const lot = plan.lots[g.lot]!;
        const b = plan.buildings.find((q) => q.lot === g.lot)!;
        expect(["gas station", "motel", "fire hall"]).toContain(b.kind);
        expect(isPaved(lot.district)).toBe(false);
        expect(area(g.polygon)).toBeGreaterThanOrEqual(40);
        // Inside its lot, and in from the lot's edges: its corners are at least the frontage's margin in.
        for (const q of g.polygon) {
          expect(contains(lot.polygon, q, -(APRON_FRONT - 0.01))).toBe(true);
        }
        // Convex: every turn the same way.
        let sign = 0;
        for (let i = 0; i < g.polygon.length; i++) {
          const p = g.polygon[i]!;
          const q = g.polygon[(i + 1) % g.polygon.length]!;
          const r = g.polygon[(i + 2) % g.polygon.length]!;
          const cross = (q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x);
          if (Math.abs(cross) < 1e-6) continue;
          if (sign === 0) sign = cross > 0 ? 1 : -1;
          expect(cross > 0 ? 1 : -1).toBe(sign);
        }
      }
    }
    expect(aprons).toBeGreaterThan(0);
    expect(APRON_SIDE).toBeGreaterThan(APRON_FRONT);
  });

  it("holds no two aprons over one another", () => {
    for (const seed of SEEDS) {
      const list = pavedGround(planFor(seed)).filter((g) => g.kind === "apron");
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(list[i]!.lot).not.toBe(list[j]!.lot);
    }
  });
});
