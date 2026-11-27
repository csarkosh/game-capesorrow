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
  // each with its legs, corners, control, crosswalks and ramps. Version 7: what is in the buildings, `plan.uses`. Version 8: what stands beside each street (its sidewalks, curbs and paving) and how each lot's ground is kept. Version 9: fewer blinds on offices' and bars' windows, so that the room shows. Version 10: what stands in the streets, yards and docks, `plan.props`. Version 11: the two together. Version 13: the town made to fit its houses: the grid held to the lots the houses fill, a short business street, the streets cut back to what the buildings serve, a shop's door on a sidewalk, `plan.gaps`. Version 14: each parked vehicle has a model of its own and its box is the model's footprint, `plan.props.vehicles[].model`. Version 15: the post office is named "Post Office", not "United States Post Office". Version 16: a banner says what the tenant's record allows, so no sale or grand opening on a post office, bank, clinic or office. Version 17: parked vehicles come in a rural spread of eighteen paints and no two of one model within 45 m share one. Version 18: what stands on the sidewalks and lies on them, `plan.props.furniture` and `plan.props.litter`. Version 19: the room behind each front ends at a back partition at a depth of its trade and its unit's own, and its furnishings are laid out afresh.  Version 20: nothing stands on the railroad: no building, porch, addition, fence, prop, vehicle or terminal yard within the clearance of the main line or the spur, and a lot the track crosses is a yard of gravel, weeds and brush. Version 21: the front of each room is full: every window has its thing, a second rank of furnishings stands between 1.45 and 4 m behind the glass with a way in kept clear from the door, a tall thing stands on each side wall in the band, and about one room in six is left thin; `interior.thin` says which. Version 22: the street lights follow the dark: a light at every junction of the highway, an avenue or a main street and at about half of the others, and along an avenue or main street wherever the next is more than about 70 m off, with a pole of its own at a major junction that has none near. Version 23: the harbour's working lights, `plan.harbour.lights`: lamps along every pier, posts along the quay's apron, dock lights on the floats, flood masts at the terminal's yard and yard lights at a running mill; the props keep their places off them. Version 24: a street that meets the highway is no longer shut with a planter for its angle: it runs on to the bed's edge and joins, with an acute corner, and the highway's two edge legs stand at the middle of the pavement's stretch along the edge; and no prop keeps off the joint of two lengths of the highway's own line. Version 25: one downtown: every business, lodging, apartment, the school, the hospital and the gas stations stand in one connected set of blocks, the FBI office is the municipal building, and every town has an open lodging, bar and cafe in the downtown, `plan.downtown` and `plan.places`.)
  it("pins three plans by digest (a change means raising TOWN_GEN)", () => {
    expect(TOWN_GEN).toBe(25);
    expect({ 20261121: digest(townFor(20261121).plan), 1: digest(townFor(1).plan), 7: digest(townFor(7).plan) }).toEqual({
      20261121: "3eb75796",
      1: "2eb1d287",
      7: "eca5f00f",
    });
  });

  // What the business stage and the ground's (edges, yards, the junctions' curb and sidewalk flags) added is added alone: the plan of a
  // seed, with `version`, `uses`, `edges`, `yards`, `props` and the junctions' new flags taken out, is what the layout, lots and buildings
  // made, whatever those stages added after. These digests were first taken at generator 6 (origin/main f09b897), before any of those existed,
  // and were taken again at 13 (4674c34c, b46785b3, 7e9ee956 were version 6's): the town-size change moved the layout, the lots and the buildings
  // themselves, so what they pin now is the plan's own part at 13, and the stages above it still add nothing to it. They were taken again at 25 (1ff43796, 81eb4d1e, 1dfcfc61 were version 13's through 24's): the downtown moved the districts, the lots and the buildings, and `places`, which the business stage makes, is taken out with the rest of what it makes.
  it("changes nothing earlier in the plan: with its new fields removed it is what the layout, lots and buildings made", () => {
    const BEFORE: Record<number, string> = { 20261121: "9e647d6b", 1: "6d8f1d66", 7: "fc00abee" };
    for (const seed of [20261121, 1, 7]) {
      const rest: Record<string, unknown> = { ...townFor(seed).plan };
      delete rest.version;
      delete rest.uses;
      delete rest.edges;
      delete rest.yards;
      delete rest.props;
      // The four places (version 25) are found in `uses` once they are made.
      delete rest.places;
      // The harbour's working lights (version 23) are drawn last by its stage: with them out, its other data is what it was.
      const harbour = townFor(seed).plan.harbour;
      rest.harbour = { ...harbour, lights: harbour.lights.filter((l) => l.kind === "harbour light" || l.kind === "day beacon" || l.kind === "pier light") };
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
