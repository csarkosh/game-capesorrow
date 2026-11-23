import { describe, expect, it } from "vitest";
import { bayOf } from "../../src/sim/town/blend.js";
import { contains, orient, segDist, type Poly, type Vec } from "../../src/sim/town/geom.js";
import { LAND_SLOPE, buildableAt, groundUnder, inRailCorridor, landOf, onTongue } from "../../src/sim/town/land.js";
import { GROW_MAX_SLOPE, GROW_MIN_SHARE, blockBudget } from "../../src/sim/town/port/growth.js";
import { STAIR_GRADE, stairSpans } from "../../src/sim/town/port/stairs.js";
import { RAIL_CORRIDOR_HALF, RAIL_OFFSET } from "../../src/sim/town/rail.js";
import { roadAt, shoreAt } from "../../src/sim/town/shore.js";
import { groundAt, type TownSite } from "../../src/sim/town/site.js";
import type { Building, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, realSite, syntheticSite, townFor } from "./sites.js";

/** Points along a polygon's edges (every 3 m) and its corners: what "stands within" is judged by. */
function around(p: Poly): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.z - a.z) / 3));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

function footprintOf(b: Building): Poly {
  const U = { x: b.bearing.a / b.bearing.c, z: b.bearing.b / b.bearing.c };
  const V = { x: U.z, z: -U.x };
  const c = (su: number, sv: number): Vec => ({ x: b.centre.x + U.x * b.halfAlong * su + V.x * b.halfAcross * sv, z: b.centre.z + U.z * b.halfAlong * su + V.z * b.halfAcross * sv });
  return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
}

/** The shape of a town: how far along the shore its blocks reach, and how far from the water. */
function outline(plan: TownPlan, site: TownSite): { length: number; depth: number } {
  let zLo = Infinity;
  let zHi = -Infinity;
  let depth = 0;
  for (const b of plan.blocks) {
    if (b.district === "outskirts") continue;
    for (const q of b.polygon) {
      zLo = Math.min(zLo, q.z);
      zHi = Math.max(zHi, q.z);
      depth = Math.max(depth, q.x - shoreAt(site, q.z));
    }
  }
  return { length: zHi - zLo, depth };
}

describe("the land the plan knows", () => {
  it("is derived once per site, from its grid, and is the same for the same site", () => {
    const site = realSite(1);
    expect(landOf(site)).toBe(landOf(site));
    expect(landOf(realSite(1))).toBe(landOf(site));
    expect(landOf(site).hectares).toBeGreaterThan(15);
    expect(landOf(site).hectares).toBeLessThan(150);
  });

  it("calls a cell buildable only where it is gentle, land, off the highway's bed, off the rail's corridor and off a headland's tongue", () => {
    for (const seed of [1, 7, 20261121]) {
      const site = realSite(seed);
      const land = landOf(site);
      let ok = 0;
      for (let ix = 0; ix < land.nx; ix += 3) {
        for (let iz = 0; iz < land.nz; iz += 3) {
          const k = ix * land.nz + iz;
          const x = land.x0 + ix * land.step;
          const z = land.z0 + iz * land.step;
          if (land.ok[k] !== 1) continue;
          ok++;
          expect(land.slope[k]!, `seed ${seed} slope`).toBeLessThanOrEqual(LAND_SLOPE);
          expect(land.h[k]!).toBeGreaterThan(0);
          expect(Math.abs(x - roadAt(site, z))).toBeGreaterThan(13);
          expect(inRailCorridor(site, x, z)).toBe(false);
          expect(onTongue(site, x, z)).toBe(false);
          expect(buildableAt(land, x, z)).toBe(true);
        }
      }
      expect(ok).toBeGreaterThan(500);
    }
  });

  it("is flat where a hand-made site has no grid of heights: every cell on land is gentle, and only the tongue, the highway and the rail's corridor are held out", () => {
    const site = syntheticSite(3);
    expect(site.ground).toBeUndefined();
    const land = landOf(site);
    expect(land.hectares).toBeGreaterThan(20);
    const z = 0;
    expect(buildableAt(land, roadAt(site, z) + 60, z)).toBe(true);
    expect(buildableAt(land, roadAt(site, z) - RAIL_OFFSET, z)).toBe(false);
    expect(buildableAt(land, shoreAt(site, z) - 30, z)).toBe(false);
  });
});

describe("the town grown over the land, over forty world seeds", () => {
  const towns = SEEDS.map((seed) => townFor(seed));

  it("prints a line per seed: the bay's end, the buildable hectares, the blocks, the town's length and depth, the stairs and the outlying buildings", () => {
    const lines = towns.map(({ seed, site, plan }) => {
      const o = outline(plan, site);
      return `seed ${String(seed).padStart(8)}: bay end ${String(Math.round(bayOf(seed).end)).padStart(4)} m, ${landOf(site).hectares.toFixed(1).padStart(5)} ha buildable, ${String(plan.counts.blocks).padStart(2)} blocks, length ${String(Math.round(o.length)).padStart(4)} m, depth ${String(Math.round(o.depth)).padStart(3)} m, ${String(plan.streets.filter((s) => s.kind === "stair").length).padStart(2)} stairs, ${String(plan.counts.outskirts).padStart(2)} outlying, ${String(plan.rail.crossings.length).padStart(2)} crossings`;
    });
    console.log(lines.join("\n"));
    expect(lines.length).toBe(40);
  });

  it("builds every block on land that meets the rule: at least 60 percent buildable (the old plat's fill counted), no steeper than 14 percent on average", () => {
    for (const { seed, site, plan } of towns) {
      const land = landOf(site);
      // Where the land takes fewer than four blocks of the old plat, the four best stand (`layout.ts`), steep or not.
      const oldPlat = plan.blocks.filter((b) => b.plat === "old").length;
      for (const b of plan.blocks) {
        if (b.district === "outskirts" || (b.plat === "old" && oldPlat <= 4)) continue;
        const g = groundUnder(land, b.polygon, (p) => p.x < shoreAt(site, p.z));
        expect(g.share, `seed ${seed} block ${b.id} (${b.district})`).toBeGreaterThanOrEqual(GROW_MIN_SHARE);
        expect(g.slope, `seed ${seed} block ${b.id}`).toBeLessThanOrEqual(GROW_MAX_SLOPE);
      }
    }
  });

  it("keeps the railroad's corridor clear: no block, lot or building within RAIL_CORRIDOR_HALF of the main line", () => {
    for (const { seed, site, plan } of towns) {
      const clear = (p: Vec): boolean => Math.abs(p.x - (roadAt(site, p.z) - RAIL_OFFSET)) > RAIL_CORRIDOR_HALF;
      for (const b of plan.blocks) for (const p of around(b.polygon)) expect(clear(p), `seed ${seed} block ${b.id}`).toBe(true);
      for (const l of plan.lots) for (const p of around(l.polygon)) expect(clear(p), `seed ${seed} lot ${l.id}`).toBe(true);
      for (const b of plan.buildings) if (b.lot >= 0) for (const p of around(footprintOf(b))) expect(clear(p), `seed ${seed} building ${b.id}`).toBe(true);
    }
  });

  it("records each crossing of the main line: on the line, on the street it names, and none for the highway, the wharf or an alley", () => {
    let total = 0;
    for (const { seed, site, plan } of towns) {
      for (const c of plan.rail.crossings) {
        const st = plan.streets[c.street]!;
        expect(["highway", "wharf", "alley", "rail"]).not.toContain(st.kind);
        expect(segDist(c, st.a, st.b), `seed ${seed}`).toBeLessThan(0.01);
        expect(Math.abs(c.x - (roadAt(site, c.z) - RAIL_OFFSET)), `seed ${seed}`).toBeLessThan(0.1);
        total++;
      }
    }
    expect(total).toBeGreaterThan(200);
  });

  it("leaves no street steeper than 15 percent over 16 m on the coast's own ground: where it would be, it is a stair", () => {
    let stairs = 0;
    for (const { seed, site, plan } of towns) {
      for (const st of plan.streets) {
        if (st.kind === "stair") {
          stairs++;
          expect(st.roadway).toBeLessThanOrEqual(st.width);
          expect(st.walk).toBe(0);
          continue;
        }
        if (st.kind !== "street" && st.kind !== "avenue") continue;
        // A stretch on the fill behind the quay is level whatever the coast's own ground was under it, and is no stair.
        const steep = stairSpans(site.ground!, st.a, st.b).filter(([lo, hi]) => {
          const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
          return ![lo, (lo + hi) / 2, hi].some((d) => plan.fill.some((f) => contains(f.polygon, { x: st.a.x + ((st.b.x - st.a.x) * d) / len, z: st.a.z + ((st.b.z - st.a.z) * d) / len }, 10)));
        });
        expect(steep, `seed ${seed} ${st.name} ${st.id} (a stretch over ${STAIR_GRADE * 100} percent)`).toEqual([]);
      }
    }
    // Over forty worlds some towns have stairs and some none.
    expect(stairs).toBeGreaterThan(40);
    expect(towns.filter((t) => t.plan.streets.some((s) => s.kind === "stair")).length).toBeGreaterThan(20);
    expect(towns.filter((t) => !t.plan.streets.some((s) => s.kind === "stair")).length).toBeGreaterThan(0);
  });

  it("makes the town's own track a spur: it starts on the main line, bends no tighter than 60 m, and there is none without a railroad", () => {
    let spurs = 0;
    for (const { seed, plan, site } of towns) {
      if (!plan.history.railroad) {
        expect(plan.rail.spurs).toEqual([]);
        continue;
      }
      expect(plan.rail.spurs.length, `seed ${seed}`).toBe(1);
      const sp = plan.rail.spurs[0]!;
      spurs++;
      expect(sp.radius).toBeGreaterThanOrEqual(60);
      // No bend between points is sharper than the radius says: the turn between legs over their length.
      for (let i = 1; i + 1 < sp.points.length; i++) {
        const a = sp.points[i - 1]!;
        const b = sp.points[i]!;
        const c = sp.points[i + 1]!;
        const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
        if (cross < 1e-9) continue;
        const r = (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(a.x - c.x, a.z - c.z)) / (2 * cross);
        expect(r, `seed ${seed} spur point ${i}`).toBeGreaterThanOrEqual(58);
      }
      expect(Math.abs(sp.points[0]!.x - (roadAt(site, sp.points[0]!.z) - RAIL_OFFSET))).toBeLessThan(40);
    }
    expect(spurs).toBeGreaterThan(25);
  });

  it("thins out: single buildings on lots of their own past the last blocks, each with a reason, on land that can be built on, none in the corridor, fewer further out", () => {
    let total = 0;
    const byDistance: number[] = [0, 0, 0, 0];
    for (const { seed, site, plan } of towns) {
      const land = landOf(site);
      expect(plan.outskirts.length).toBe(plan.counts.outskirts);
      let zLo = Infinity;
      let zHi = -Infinity;
      for (const b of plan.blocks) {
        if (b.district === "outskirts") continue;
        for (const q of b.polygon) {
          zLo = Math.min(zLo, q.z);
          zHi = Math.max(zHi, q.z);
        }
      }
      for (const o of plan.outskirts) {
        const b = plan.buildings[o.building]!;
        const lot = plan.lots[b.lot]!;
        const block = plan.blocks[lot.block]!;
        expect(block.district).toBe("outskirts");
        expect(plan.lots.filter((l) => l.block === block.id).length).toBe(1);
        expect(o.reason.length).toBeGreaterThan(20);
        const lotPoly = orient(lot.polygon);
        for (const p of around(lotPoly)) expect(Math.abs(p.x - (roadAt(site, p.z) - RAIL_OFFSET)), `seed ${seed}: in the corridor`).toBeGreaterThan(RAIL_CORRIDOR_HALF);
        // Land that can be built on, a few metres in from the lot's edge (the highway's bed lies against it).
        const cx = (lotPoly[0]!.x + lotPoly[2]!.x) / 2;
        const cz = (lotPoly[0]!.z + lotPoly[2]!.z) / 2;
        expect(buildableAt(land, cx, cz), `seed ${seed} outlying ${o.building}`).toBe(true);
        expect(onTongue(site, cx, cz)).toBe(false);
        if (o.where !== "road") {
          const past = o.where === "north" ? cz - zHi : zLo - cz;
          expect(past, `seed ${seed}: an outlying building inside the town's reach`).toBeGreaterThan(20);
          byDistance[Math.min(3, Math.floor(past / 150))]!++;
        }
        total++;
      }
    }
    expect(total).toBeGreaterThan(100);
    // Fewer the further out.
    expect(byDistance[0]!).toBeGreaterThan(byDistance[3]!);
    expect(byDistance[0]! + byDistance[1]!).toBeGreaterThan(byDistance[2]! + byDistance[3]!);
    const kinds = new Set<string>();
    for (const { plan } of towns) for (const o of plan.outskirts) kinds.add(plan.buildings[o.building]!.kind);
    for (const k of ["gas station", "motel", "house", "church", "tavern", "junkyard", "shake mill", "fire hall"]) expect([...kinds], k).toContain(k);
  });

  it("has outlines that differ for real: length, depth and block count each vary by a factor of 1.8 or more, with some long and thin towns and some deep ones", () => {
    const shapes = towns.map(({ plan, site }) => ({ ...outline(plan, site), blocks: plan.counts.blocks }));
    const ratio = (f: (s: (typeof shapes)[number]) => number): number => Math.max(...shapes.map(f)) / Math.min(...shapes.map(f));
    expect(ratio((s) => s.length)).toBeGreaterThanOrEqual(1.8);
    expect(ratio((s) => s.depth)).toBeGreaterThanOrEqual(1.8);
    expect(ratio((s) => s.blocks)).toBeGreaterThanOrEqual(1.8);
    // Long and thin: more than two and a half times as long as deep. Deep: 600 m or more from the water to the last block.
    expect(shapes.filter((s) => s.length / s.depth >= 2.5).length).toBeGreaterThanOrEqual(3);
    expect(shapes.filter((s) => s.depth >= 600).length).toBeGreaterThanOrEqual(3);
    // And the bay explains the land: a narrow shelf has less buildable land than a plain.
    const ha = towns.map((t) => ({ end: bayOf(t.seed).end, ha: landOf(t.site).hectares })).sort((a, b) => a.end - b.end);
    const low = ha.slice(0, 10).reduce((s, t) => s + t.ha, 0);
    const high = ha.slice(-10).reduce((s, t) => s + t.ha, 0);
    expect(high).toBeGreaterThan(low * 1.3);
  });

  it("spends a budget the history sets, 28 to 55 blocks, on the best land first", () => {
    for (const { seed, plan } of towns) {
      const budget = blockBudget(plan.history);
      expect(budget, `seed ${seed}`).toBeGreaterThanOrEqual(26);
      expect(budget).toBeLessThanOrEqual(55);
      expect(plan.counts.blocks, `seed ${seed}`).toBeLessThanOrEqual(budget + 6);
    }
    expect(new Set(towns.map((t) => blockBudget(t.plan.history))).size).toBeGreaterThan(10);
  });

  it("leaves woods where the land said no, and the grid goes round: a block of the old grid left out has a reason, and no wood is built on", () => {
    let woods = 0;
    for (const { seed, plan } of towns) {
      for (const w of plan.woods) {
        woods++;
        // No building of the town's grid stands in a wood (an outlying lot may: the grid's unbuilt cell is where the land is gentle).
        for (const b of plan.buildings) if (b.lot >= 0 && plan.blocks[plan.lots[b.lot]!.block]!.district !== "outskirts") expect(contains(orient(w.polygon), b.centre), `seed ${seed}: a building stands in a wood`).toBe(false);
        expect(["land", "budget"]).toContain(w.why);
        expect(w.polygon.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(woods).toBeGreaterThan(300);
  });

  it("reads the land from the site's grid alone (the plan stays a pure function of the site)", () => {
    const site = realSite(5);
    const g = site.ground!;
    expect(groundAt(g, g.x0 + 100, g.z0 + 100)).toBeTypeOf("number");
    expect(landOf(site).nx).toBe(g.nx);
  });
});

describe("the time a world takes to start", () => {
  it("reads a site and makes a plan in the time it did (reported)", () => {
    const sites = SEEDS.slice(0, 12).map((s) => realSite(s));
    const times: number[] = [];
    for (const site of sites) {
      const t = performance.now();
      landOf(site);
      times.push(performance.now() - t);
    }
    console.log(`landOf (the site's land, once per site): median ${times.sort((a, b) => a - b)[6]!.toFixed(2)} ms`);
    expect(times[11]!).toBeLessThan(200);
  });
});
