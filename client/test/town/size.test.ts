import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { SEEDS, realSite, townFor } from "./sites.js";

describe("the large port's size and speed", () => {
  it("has 30 to 55 blocks and 220 to 420 buildings, over forty world seeds", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.counts.blocks, `seed ${seed}`).toBeGreaterThanOrEqual(30);
      expect(plan.counts.blocks, `seed ${seed}`).toBeLessThanOrEqual(55);
      expect(plan.counts.buildings, `seed ${seed}`).toBeGreaterThanOrEqual(220);
      expect(plan.counts.buildings, `seed ${seed}`).toBeLessThanOrEqual(420);
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
        expect([14, 15, 16]).toContain(p.streetWidth);
        expect(p.alley === null || p.alley === 4).toBe(true);
      }
      for (const s of plan.streets) {
        if (s.kind === "alley") expect(s.width).toBe(4);
        if (s.kind === "street") expect([14, 15, 16]).toContain(s.width);
      }
      // Commercial lots are 7.5 to 15 m wide: no core lot wider along its street than 15 m or so, but for the reserved ones.
      for (const b of plan.buildings) {
        if (b.lot < 0 || plan.lots[b.lot]!.district !== "core" || plan.lots[b.lot]!.role !== null) continue;
        // A shop's frontage is its narrow side: 15 m at most.
        const narrow = Math.min(b.halfAlong, b.halfAcross) * 2;
        expect(narrow, `seed ${seed} ${b.kind}`).toBeLessThanOrEqual(15.5);
      }
    }
  });

  it("draws every street at its true width: roadways of 7.5 to 9 m in rights of way of 14 to 16 m, the main street's 11 or 12 m between sidewalks of 3.5 or 4, the avenue's 12 m, alleys of 4 m, and nothing wider than the highway's bed by more than a lane's margin", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        // Roadway, two sidewalks and the verges that are left fit the right of way.
        expect(s.roadway + 2 * s.walk, `seed ${seed} street ${s.id} ${s.kind}`).toBeLessThanOrEqual(s.width + 1e-9);
        if (s.kind === "street") {
          expect(s.roadway).toBeGreaterThanOrEqual(7.5);
          expect(s.roadway).toBeLessThanOrEqual(9);
          expect(s.walk).toBeGreaterThanOrEqual(1.5);
          expect(s.walk).toBeLessThanOrEqual(3.5);
        }
        if (s.kind === "main") {
          expect([11, 12]).toContain(s.roadway);
          expect([3.5, 4]).toContain(s.walk);
        }
        if (s.kind === "avenue") {
          expect(s.roadway).toBe(12);
          expect(s.width).toBe(20);
        }
        if (s.kind === "alley") {
          expect(s.width).toBe(4);
          expect(s.walk).toBe(0);
        }
        if (s.kind !== "highway" && s.kind !== "rail" && s.kind !== "wharf") expect(s.roadway, `seed ${seed} ${s.kind}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it("is made in well under 50 ms (asserted under 500) and reports the real figure", () => {
    const times: number[] = [];
    planTown(realSite(1), "port"); // warm up
    for (const seed of SEEDS) {
      const site = realSite(seed);
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
