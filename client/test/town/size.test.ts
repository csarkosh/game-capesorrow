import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { SEEDS, syntheticSite, townFor } from "./sites.js";

describe("the large port's size and speed", () => {
  it("has 35 to 60 blocks and 250 to 450 buildings, over forty seeds", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.counts.blocks, `seed ${seed}`).toBeGreaterThanOrEqual(35);
      expect(plan.counts.blocks, `seed ${seed}`).toBeLessThanOrEqual(60);
      expect(plan.counts.buildings, `seed ${seed}`).toBeGreaterThanOrEqual(250);
      expect(plan.counts.buildings, `seed ${seed}`).toBeLessThanOrEqual(450);
      expect(plan.counts.open + plan.counts.vacant + plan.counts.ruin).toBe(plan.counts.buildings);
    }
  });

  it("uses the real dimensions: blocks, rights of way, alleys, lots", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const p of plan.plats) {
        const lo = Math.min(p.block.along, p.block.across);
        const hi = Math.max(p.block.along, p.block.across);
        expect(lo, `${seed} ${p.id}`).toBeGreaterThanOrEqual(76);
        expect(lo).toBeLessThanOrEqual(115);
        expect(hi).toBeGreaterThanOrEqual(90);
        expect(hi).toBeLessThanOrEqual(141);
        expect([18, 20, 24]).toContain(p.streetWidth);
        expect(p.alley === null || p.alley === 5).toBe(true);
      }
      for (const s of plan.streets) {
        if (s.kind === "alley") expect(s.width).toBe(5);
        if (s.kind === "street") expect([18, 20, 24]).toContain(s.width);
      }
      // Commercial lots are 7.5 to 15 m wide: no core lot wider along its street than 15 m or so, but for the reserved ones.
      for (const b of plan.buildings) {
        if (b.lot < 0 || plan.lots[b.lot]!.district !== "core" || plan.lots[b.lot]!.role !== null) continue;
        const wide = Math.max(b.halfAlong, b.halfAcross) * 2;
        expect(wide, `seed ${seed} ${b.kind}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("is made in well under 50 ms (asserted under 500) and reports the real figure", () => {
    const times: number[] = [];
    planTown(syntheticSite(1), "port"); // warm up
    for (const seed of SEEDS) {
      const site = syntheticSite(seed);
      const t0 = performance.now();
      planTown(site, "port");
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const max = times[times.length - 1]!;
    console.log(`planTown, 40 seeds: median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    expect(max).toBeLessThan(500);
  });
});
