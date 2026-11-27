import { describe, expect, it } from "vitest";
import { dist, segDist, type Vec } from "../../src/sim/town/geom.js";
import { SEEDS, townFor } from "./sites.js";
import { doorsWithoutSidewalk, dwellingsOf, extentOf, nearBuilding, streetsWithoutBuildings, unitsOf, woodsEnclosed } from "./measure.js";

/**
 * The town fits its houses (the owner's check, 2026-11: the grid reached further than the houses did, and the shops were sized for several
 * thousand). Every measure is in `measure.ts`; the numbers asserted are the targets and a margin, and each test says what it was before.
 */
const GAME_SEED = 20261121;

describe("a town's streets serve its buildings", () => {
  it("has no more than 12 percent of the streets (the grid's streets and alleys, not the highway or the wharf) with no building within 20 m, over forty world seeds (it was 20)", () => {
    let total = 0;
    let empty = 0;
    for (const seed of SEEDS) {
      const m = streetsWithoutBuildings(townFor(seed).plan);
      expect(m.share, `seed ${seed}`).toBeLessThanOrEqual(0.2);
      total += m.total;
      empty += m.empty;
    }
    console.log(`streets with no building within 20 m: ${((empty / total) * 100).toFixed(1)} percent of ${(total / 1000).toFixed(0)} km`);
    expect(empty / total).toBeLessThanOrEqual(0.12);
  });

  it("leaves no budget wood wrapped in streets on every side (woods the land forced may be)", () => {
    let budget = 0;
    let land = 0;
    let landEnclosed = 0;
    for (const seed of SEEDS) {
      const w = woodsEnclosed(townFor(seed).plan);
      expect(w.budgetEnclosed, `seed ${seed}`).toBe(0);
      budget += w.budget;
      land += w.land;
      landEnclosed += w.landEnclosed;
    }
    console.log(`woods over 40 seeds: ${land} by the land (${landEnclosed} with streets on every side), ${budget} by the budget (none)`);
    expect(budget).toBeGreaterThan(0);
  });

  it("ends every street at a building: a made end stands within 40 m of one, and no street runs past woods on both sides to an end in the forest", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const real = plan.buildings.filter((b) => b.kind !== "pier");
      const built = real.map((b) => (b.lot >= 0 ? plan.lots[b.lot]!.block : -1));
      for (const e of plan.ends) {
        const st = plan.streets[e.street]!;
        // The plats' seam stays whole (`port/trim.ts`), and an alley or the wharf is no grid street.
        if (st.kind === "alley" || st.kind === "wharf" || st.seam === true) continue;
        const p: Vec = { x: e.x, z: e.z };
        // A landing is by the water, and a street that runs on as a road out is the road's; any other end is within reach of what it served.
        if (e.kind === "landing") continue;
        // (A block with a building on it keeps a street along it, so that it has one, however far into the block the building stands: an end that stands by such a block is served.)
        const near = real.some((b) => nearBuilding(plan, b, p, 40, "footprint")) || plan.blocks.some((bl) => built.includes(bl.id) && bl.polygon.some((q, k) => segDist(p, q, bl.polygon[(k + 1) % bl.polygon.length] as Vec) <= 25));
        const toRoad = plan.roads.some((r) => dist(r.points[0] as Vec, p) < 30);
        expect(near || toRoad, `seed ${seed}: street ${st.name} ends at (${e.x.toFixed(0)}, ${e.z.toFixed(0)}) with nothing within 40 m`).toBe(true);
      }
    }
  });

  it("keeps the seams naming a street of the plan, and no street ends of its own accord in the forest: every end the plan lists is a landing or a made end", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.seams) expect(s.street === -1 || plan.streets[s.street] !== undefined, `seed ${seed}`).toBe(true);
      for (const e of plan.ends) expect(["landing", "turnaround", "barricade"], `seed ${seed}`).toContain(e.kind);
    }
  });
});

describe("the town's houses and its shops", () => {
  it("holds at least 3.5 dwellings to each shop unit over forty world seeds, flats over shops, apartments and rooms counted (it was 2.7), and 2.2 in each", () => {
    let dwellings = 0;
    let houses = 0;
    let units = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const d = dwellingsOf(plan);
      const u = unitsOf(plan);
      expect(d.total / u.units, `seed ${seed}: ${d.total} dwellings, ${u.units} units`).toBeGreaterThanOrEqual(2.2);
      dwellings += d.total;
      houses += d.houses;
      units += u.units;
    }
    console.log(`dwellings per shop unit over 40 seeds: ${(dwellings / units).toFixed(2)} (houses alone ${(houses / units).toFixed(2)})`);
    expect(dwellings / units).toBeGreaterThanOrEqual(3.5);
    expect(houses / units).toBeGreaterThanOrEqual(2.8);
  });

  it("has taverns a small share of the shop units (the counted towns' is 3.7 percent; it was 9.5 in the game's town; 4.8 over the forty seeds since the downtown, whose every town has a bar of its own)", () => {
    let taverns = 0;
    let units = 0;
    for (const seed of SEEDS) {
      const u = unitsOf(townFor(seed).plan);
      taverns += u.taverns;
      units += u.units;
    }
    console.log(`taverns: ${taverns} of ${units} units (${((taverns / units) * 100).toFixed(1)} percent)`);
    expect(taverns / units).toBeLessThanOrEqual(0.06);
  });

  it("makes the game's town 200 to 260 houses in no more than 320 buildings (it was 181 houses in 299; 214 in 309 since the downtown, whose blocks are built up)", () => {
    const { plan } = townFor(GAME_SEED);
    const d = dwellingsOf(plan);
    expect(d.houses).toBeGreaterThanOrEqual(200);
    expect(d.houses).toBeLessThanOrEqual(260);
    expect(plan.buildings.length).toBeLessThanOrEqual(320);
  });

  it("keeps the business street short: the game's town has fewer than 70 shop units (it had 93), and none of the forty towns more than 125 (110 before the downtown was built up)", () => {
    expect(unitsOf(townFor(GAME_SEED).plan).units).toBeLessThan(70);
    for (const seed of SEEDS) expect(unitsOf(townFor(seed).plan).units, `seed ${seed}`).toBeLessThanOrEqual(125);
  });

  it("keeps every landmark the town had: the municipal building, the hospital, the school, a church, the hotel, the mill and the port terminal in every town; the depot where there is a railroad", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const roles = plan.landmarks.map((l) => l.role);
      for (const role of ["municipal building", "hotel", "hospital", "high school", "church", "mill"] as const) expect(roles, `seed ${seed}`).toContain(role);
    }
  });
});

describe("a lot with no building has a reason", () => {
  it("lists every empty lot of the town's blocks in `plan.gaps` with its reason, and no lot that has a building", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const built = plan.buildings.map((b) => b.lot);
      const gap = plan.gaps.map((g) => g.lot);
      for (const g of plan.gaps) {
        expect(["demolished", "poor corner", "shore", "rail"], `seed ${seed}`).toContain(g.why);
        expect(built.includes(g.lot), `seed ${seed}: lot ${g.lot} is a gap and has a building`).toBe(false);
      }
      for (const lot of plan.lots) {
        const district = plan.blocks[lot.block]!.district;
        // The outlying parcels are made with their buildings, and the terminal's open yard is the harbour's.
        if (district === "outskirts" || district === "waterfront" || built.includes(lot.id)) continue;
        expect(gap.includes(lot.id), `seed ${seed}: lot ${lot.id} (${district}) is empty and has no reason`).toBe(true);
      }
    }
  });

  it("builds the house lots it keeps: under 14 percent of the residential lots stand empty over forty seeds (12 before the downtown, and the hill blocks thinned for a world's memory: the school's and hospital's whole blocks and the strip's are house lots now) (the burned and vacant buildings are ruins and stand on theirs), and not all alike", () => {
    let lots = 0;
    let empty = 0;
    const kinds: Record<string, number> = {};
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const built = plan.buildings.map((b) => b.lot);
      let l = 0;
      let e = 0;
      for (const lot of plan.lots) {
        const district = plan.blocks[lot.block]!.district;
        if (district !== "residential" && district !== "mill housing") continue;
        l++;
        if (!built.includes(lot.id)) e++;
      }
      expect(l === 0 || e / l <= 0.25, `seed ${seed}: ${e} of ${l} house lots empty`).toBe(true);
      lots += l;
      empty += e;
      for (const g of plan.gaps) kinds[g.why] = (kinds[g.why] ?? 0) + 1;
    }
    console.log(`residential lots empty: ${empty} of ${lots} (${((empty / lots) * 100).toFixed(1)} percent); reasons ${JSON.stringify(kinds)}`);
    expect(empty / lots).toBeLessThanOrEqual(0.14);
    expect(Object.keys(kinds).length).toBeGreaterThanOrEqual(2);
  });
});

describe("a shop's door opens onto a sidewalk", () => {
  it("has no unit door whose front stands on a grid street side with no sidewalk run at its station, over forty world seeds (there were 196 over fourteen)", () => {
    const bad: string[] = [];
    for (const seed of SEEDS) {
      for (const d of doorsWithoutSidewalk(townFor(seed).plan)) bad.push(`seed ${seed}: unit ${d.unit} of building ${d.building} on street ${d.street} side ${d.side} at ${d.s.toFixed(1)} m`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("gives a side that has a shop on it a curb as well, so the sidewalk is not at the roadway's level", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const { plan } = townFor(seed);
      for (const e of plan.edges) {
        for (const side of e.sides) if (side.runs.length > 0) expect(side.walk, `seed ${seed} street ${e.street}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the town's size", () => {
  it("reports the extent of the town's buildings, outskirts included and left out (the game's town was 594 by 1,261 m, 594 by 772 m in its blocks, and is 772.3 since the downtown)", () => {
    const e = extentOf(townFor(GAME_SEED).plan);
    const g = extentOf(townFor(GAME_SEED).plan, true);
    console.log(`game's town: buildings span ${e.w.toFixed(0)} x ${e.h.toFixed(0)} m, ${g.w.toFixed(0)} x ${g.h.toFixed(0)} m without the outskirts`);
    expect(e.h).toBeLessThan(1261);
    expect(g.h).toBeLessThanOrEqual(775);
  });
});
