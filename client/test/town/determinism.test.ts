import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { TOWN_GEN } from "../../src/sim/town/version.js";
import type { TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, digest, realSite, syntheticSite, townFor } from "./sites.js";

/** A leg without the version 8 fields (curb and sidewalk by side; its `walk` is the street's width and was there before). */
function stripLeg(o: Record<string, unknown>): Record<string, unknown> {
  const { curbLeft, curbRight, walkLeft, walkRight, ...rest } = o;
  void [curbLeft, curbRight, walkLeft, walkRight];
  return rest;
}

/** A corner without the version 8 fields (a curb return, a corner sidewalk). */
function stripCorner(o: Record<string, unknown>): Record<string, unknown> {
  const { curb, walk, ...rest } = o;
  void [curb, walk];
  return rest;
}

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
  // raise TOWN_GEN (client/src/sim/town/version.ts) in the same commit, then re-pin. (Version 6: junctions, where streets meet,
  // each with its legs, corners, control, crosswalks and ramps. Version 7: what is in the buildings, `plan.uses`. Version 8: what stands beside each street (its sidewalks, curbs and paving) and how each lot's ground is kept. Version 10: what stands in the streets, yards and docks, `plan.props`; the other version between is the buildings' interiors, made in another worktree.)
  it("pins three plans by digest (a change means raising TOWN_GEN)", () => {
    expect(TOWN_GEN).toBe(10);
    expect({ 20261121: digest(townFor(20261121).plan), 1: digest(townFor(1).plan), 7: digest(townFor(7).plan) }).toEqual({
      20261121: "5c77b170",
      1: "0e9ca6bf",
      7: "21aab473",
    });
  });

  // What the business stage and the ground's (edges, yards, the junctions' curb and sidewalk flags) added is added alone: the plan of a
  // seed, with `version`, `uses`, `edges`, `yards`, `props` and the junctions' new flags taken out, is byte for byte what origin/main
  // (f09b897, generator 6) made, which these digests were taken from before either existed.
  it("changes nothing earlier in the plan: with its new fields removed it is what version 6 made", () => {
    const BEFORE: Record<number, string> = { 20261121: "4674c34c", 1: "b46785b3", 7: "7e9ee956" };
    for (const seed of [20261121, 1, 7]) {
      const rest: Record<string, unknown> = { ...townFor(seed).plan };
      delete rest.version;
      delete rest.uses;
      delete rest.edges;
      delete rest.yards;
      delete rest.props;
      // The junctions' legs and corners carry which sides have a curb and a sidewalk (version 8).
      rest.junctions = (townFor(seed).plan.junctions as readonly Record<string, unknown>[]).map((j) => ({
        ...j,
        legs: (j.legs as readonly Record<string, unknown>[]).map(stripLeg),
        closed: (j.closed as readonly Record<string, unknown>[]).map(stripLeg),
        corners: (j.corners as readonly Record<string, unknown>[]).map(stripCorner),
      }));
      expect(digest(rest as unknown as TownPlan), `seed ${seed}`).toBe(BEFORE[seed]);
    }
  });
});
