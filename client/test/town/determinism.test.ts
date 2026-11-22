import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { TOWN_GEN } from "../../src/sim/town/version.js";
import { SEEDS, digest, syntheticSite, townFor } from "./sites.js";

describe("the plan is deterministic", () => {
  it("is deeply equal for the same site, made twice", () => {
    for (const seed of [1, 2, 3, 17, 40]) {
      const site = syntheticSite(seed);
      expect(planTown(site, "port")).toEqual(planTown(syntheticSite(seed), "port"));
    }
  });

  it("carries the generator's version, the seed and the kind", () => {
    const { site, plan } = townFor(5);
    expect(plan.version).toBe(TOWN_GEN);
    expect(plan.seed).toBe(site.seed);
    expect(plan.kind).toBe("port");
  });

  it("differs, in history and in layout, for a different seed", () => {
    for (const seed of SEEDS.slice(0, 39)) {
      const a = townFor(seed).plan;
      const b = townFor(seed + 1).plan;
      expect(JSON.stringify(a.history), `history ${seed}`).not.toBe(JSON.stringify(b.history));
      expect(JSON.stringify(a.blocks.map((x) => x.polygon)), `layout ${seed}`).not.toBe(JSON.stringify(b.blocks.map((x) => x.polygon)));
    }
  });

  it("does not change with the order the towns are made in", () => {
    const first = digest(planTown(syntheticSite(9), "port"));
    planTown(syntheticSite(10), "port");
    expect(digest(planTown(syntheticSite(9), "port"))).toBe(first);
  });

  // Pinned digests of three named seeds. A change here means the same site now gives a different plan:
  // raise TOWN_GEN (client/src/sim/town/version.ts) in the same commit, then re-pin.
  it("pins three plans by digest (a change means raising TOWN_GEN)", () => {
    expect(TOWN_GEN).toBe(1);
    expect({ 1: digest(townFor(1).plan), 7: digest(townFor(7).plan), 23: digest(townFor(23).plan) }).toEqual({
      1: "6e3e7bc1",
      7: "7e177c22",
      23: "0ba778ed",
    });
  });
});
