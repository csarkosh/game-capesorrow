import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { TOWN_GEN } from "../../src/sim/town/version.js";
import { SEEDS, digest, realSite, syntheticSite, townFor } from "./sites.js";

describe("the plan is deterministic", () => {
  it("is deeply equal for the same site, made twice", () => {
    for (const seed of [20261121, 1, 2, 17, 36]) {
      expect(planTown(realSite(seed), "port")).toEqual(planTown(realSite(seed), "port"));
    }
    // And on the synthetic coast, which is a different shape of ground.
    for (const seed of [1, 9]) expect(planTown(syntheticSite(seed), "port")).toEqual(planTown(syntheticSite(seed), "port"));
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
    const first = digest(planTown(realSite(9), "port"));
    planTown(realSite(10), "port");
    expect(digest(planTown(realSite(9), "port"))).toBe(first);
  });

  // Pinned digests of three named world seeds. A change here means the same site now gives a different plan:
  // raise TOWN_GEN (client/src/sim/town/version.ts) in the same commit, then re-pin. (The generator is unreleased,
  // so for now the number stays at 1 and the pins are simply replaced.)
  it("pins three plans by digest (a change means raising TOWN_GEN)", () => {
    expect(TOWN_GEN).toBe(2);
    expect({ 20261121: digest(townFor(20261121).plan), 1: digest(townFor(1).plan), 7: digest(townFor(7).plan) }).toEqual({
      20261121: "8ef88fa0",
      1: "6c0c8cfb",
      7: "09238be8",
    });
  });
});
