import { describe, expect, it } from "vitest";
import { planTown } from "../../src/sim/town/plan.js";
import { CURB_LEAST, CURB_REBUILT, walkAt } from "../../src/sim/town/port/edges.js";
import type { Street, StreetEdge, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, realSite, townFor } from "./sites.js";

const grid = (s: Street): boolean => s.kind === "street" || s.kind === "main" || s.kind === "avenue";
const length = (s: Street): number => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);

/** The share of a street side's length that has a sidewalk. */
const covered = (e: StreetEdge, k: 0 | 1): number => e.sides[k].runs.reduce((sum, r) => sum + r.s1 - r.s0, 0);

describe("what stands beside each street (the sidewalks, curbs and repaving the history decided)", () => {
  it("is made for every street, in order, with its two sides, its paving and its era", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.edges.length).toBe(plan.streets.length);
      plan.streets.forEach((s, i) => {
        const e = plan.edges[i] as StreetEdge;
        expect(e.street).toBe(s.id);
        expect(e.sides.length).toBe(2);
        expect(e.paving.length).toBeGreaterThanOrEqual(1);
        // The paving covers the street from end to end with no gap.
        expect(e.paving[0]!.s0).toBe(0);
        for (let k = 1; k < e.paving.length; k++) expect(e.paving[k]!.s0).toBe(e.paving[k - 1]!.s1);
        if (grid(s)) expect(e.paving[e.paving.length - 1]!.s1).toBeCloseTo(length(s), 6);
      });
    }
  });

  it("gives the core, the main street and the avenue a sidewalk on both sides all the way, and the edges one side or none", () => {
    const share: Record<StreetEdge["era"], { sides: number; walk: number; curb: number }> = { core: { sides: 0, walk: 0, curb: 0 }, old: { sides: 0, walk: 0, curb: 0 }, later: { sides: 0, walk: 0, curb: 0 }, edge: { sides: 0, walk: 0, curb: 0 } };
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        if (!grid(s)) continue;
        const e = plan.edges[s.id] as StreetEdge;
        if (s.kind === "main" || s.kind === "avenue") expect(e.era, `seed ${seed} ${s.name}`).toBe("core");
        for (const k of [0, 1] as const) {
          const side = e.sides[k];
          share[e.era].sides++;
          if (side.walk > 0) share[e.era].walk++;
          if (side.curb) share[e.era].curb++;
          if (e.era === "core") {
            // Both sides, poured end to end (the pours join with no gap).
            expect(side.walk, `seed ${seed} street ${s.id}`).toBeGreaterThan(0);
            expect(covered(e, k)).toBeCloseTo(length(s), 6);
            expect(side.curb).toBe(true);
          }
        }
      }
    }
    const f = (e: StreetEdge["era"]): number => share[e].walk / Math.max(1, share[e].sides);
    console.log(`share of street sides with a sidewalk over ${SEEDS.length} seeds: core ${f("core").toFixed(2)} (${share.core.sides}), old ${f("old").toFixed(2)} (${share.old.sides}), later ${f("later").toFixed(2)} (${share.later.sides}), edge ${f("edge").toFixed(2)} (${share.edge.sides})`);
    expect(f("core")).toBe(1);
    expect(f("old")).toBeGreaterThan(0.75);
    expect(f("old")).toBeLessThan(0.97);
    expect(f("later")).toBeGreaterThan(0.2);
    expect(f("later")).toBeLessThan(0.65);
    expect(f("edge")).toBeLessThan(0.4);
    expect(share.edge.sides).toBeGreaterThan(50);
    expect(share.later.sides).toBeGreaterThan(30);
    // Fewer sidewalks as the town's history thins: the order of the eras.
    expect(f("old")).toBeGreaterThan(f("later"));
    expect(f("later")).toBeGreaterThan(f("edge"));
  });

  it("does not give a street's two sides the same sidewalk everywhere: some have one side, the old streets lose stretches, and the pours differ", () => {
    let oneSided = 0;
    let neither = 0;
    let gaps = 0;
    let stops = 0;
    let unequal = 0;
    let sides = 0;
    const decades = new Set<number>();
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        if (!grid(s)) continue;
        const e = plan.edges[s.id] as StreetEdge;
        const a = e.sides[0].walk > 0;
        const b = e.sides[1].walk > 0;
        if (a !== b) oneSided++;
        if (!a && !b) neither++;
        if (Math.abs(covered(e, 0) - covered(e, 1)) > 5) unequal++;
        for (const side of e.sides) {
          sides++;
          for (let i = 1; i < side.runs.length; i++) if (side.runs[i]!.s0 - side.runs[i - 1]!.s1 > 1) gaps++;
          if (side.runs.length > 0 && side.runs[side.runs.length - 1]!.s1 < length(s) - 6 && e.era !== "core") stops++;
          for (const r of side.runs) decades.add(r.decade);
        }
      }
    }
    console.log(`one-sided streets ${oneSided}, streets with no sidewalk ${neither}, gaps ${gaps}, sidewalks that stop short ${stops}, sides unequal in length ${unequal} of ${sides}; ${decades.size} decades`);
    expect(oneSided).toBeGreaterThan(40);
    expect(neither).toBeGreaterThan(40);
    expect(gaps).toBeGreaterThan(80);
    expect(stops).toBeGreaterThan(30);
    expect(unequal).toBeGreaterThan(80);
    expect(decades.size).toBeGreaterThanOrEqual(10);
  });

  it("keeps each side's pours in order, apart, inside the street, each with a decade and a wear, and a curb height between the buried and the rebuilt", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        if (!grid(s)) continue;
        const e = plan.edges[s.id] as StreetEdge;
        for (const side of e.sides) {
          let last = -1;
          for (const r of side.runs) {
            expect(r.s0).toBeGreaterThanOrEqual(last - 1e-9);
            expect(r.s1).toBeGreaterThan(r.s0);
            expect(r.s0).toBeGreaterThanOrEqual(0);
            expect(r.s1).toBeLessThanOrEqual(length(s) + 1e-6);
            expect(r.decade % 10).toBe(0);
            expect(r.decade).toBeGreaterThanOrEqual(1900);
            expect(r.decade).toBeLessThanOrEqual(2020);
            expect(r.wear).toBeGreaterThanOrEqual(0);
            expect(r.wear).toBeLessThanOrEqual(1);
            last = r.s1;
          }
          if (side.walk === 0) expect(side.runs.length).toBe(0);
          // A pour is found where it is, and not where it is not.
          if (side.runs.length > 0) {
            const r = side.runs[0]!;
            expect(walkAt(side, (r.s0 + r.s1) / 2)).toBe(r);
          }
        }
        const anyCurb = e.sides.some((side) => side.curb);
        for (const p of e.paving) {
          if (anyCurb) {
            expect(p.curb).toBeGreaterThanOrEqual(CURB_LEAST - 1e-9);
            expect(p.curb).toBeLessThanOrEqual(CURB_REBUILT + 1e-9);
          } else expect(p.curb).toBe(0);
        }
      }
    }
  });

  it("gives streets of the old plat and the later plat curbs of different heights (15 cm rebuilt, 5 to 10 where overlaid) and none on the edges' bare sides", () => {
    const heights = new Set<number>();
    let bareEdge = 0;
    let edgeSides = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        if (!grid(s)) continue;
        const e = plan.edges[s.id] as StreetEdge;
        for (const p of e.paving) if (p.curb > 0) heights.add(Math.round(p.curb * 1000));
        if (e.era === "edge") {
          for (const side of e.sides) {
            edgeSides++;
            if (!side.curb && side.walk === 0) bareEdge++;
          }
        }
      }
    }
    expect(heights.has(150)).toBe(true);
    expect([...heights].some((h) => h >= 50 && h <= 100)).toBe(true);
    expect(bareEdge / edgeSides).toBeGreaterThan(0.5);
  });

  it("is deterministic and part of the plan: the same site made twice gives the same edges and yards", () => {
    for (const seed of [20261121, 7, 12]) {
      const a = planTown(realSite(seed), "port");
      const b = planTown(realSite(seed), "port");
      expect(a.edges).toEqual(b.edges);
      expect(a.yards).toEqual(b.yards);
    }
  });

  it("has no repeating pattern of sidewalk: no two streets have the same pours on their sides", () => {
    const seen = new Set<string>();
    let total = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const s of plan.streets) {
        if (!grid(s) || length(s) < 80) continue;
        const e = plan.edges[s.id] as StreetEdge;
        for (const side of e.sides) {
          if (side.runs.length < 2) continue;
          total++;
          seen.add(side.runs.map((r) => `${r.s0.toFixed(2)}-${r.s1.toFixed(2)}:${r.decade}`).join(","));
        }
      }
    }
    expect(total).toBeGreaterThan(150);
    expect(seen.size).toBe(total);
  });
});

describe("how each lot's ground is kept (the yards)", () => {
  const plans = (): TownPlan[] => SEEDS.slice(0, 12).map((s) => townFor(s).plan);

  it("is made for every lot, and none of a paved district's lots is a yard", () => {
    for (const plan of plans()) {
      expect(plan.yards.length).toBe(plan.lots.length);
      plan.yards.forEach((y, i) => {
        expect(y.lot).toBe(i);
        const district = plan.blocks[plan.lots[i]!.block]!.district;
        if (["core", "dock", "waterfront", "mill", "industrial", "highway strip"].includes(district)) expect(y.kind).toBe("paved");
        else expect(y.kind).not.toBe("paved");
        expect(y.kept).toBeGreaterThanOrEqual(0);
        expect(y.kept).toBeLessThanOrEqual(1);
      });
    }
  });

  it("differs between adjacent lots and uses every kind, with a cause: ruins and empty lots are never mown, and a lot with no building has no drive or walk", () => {
    const kinds = new Set<string>();
    let pairs = 0;
    let differ = 0;
    for (const plan of plans()) {
      const buildingOf = new Map<number, (typeof plan.buildings)[number]>();
      for (const b of plan.buildings) if (b.lot >= 0) buildingOf.set(b.lot, b);
      for (let i = 0; i + 1 < plan.lots.length; i++) {
        const a = plan.yards[i]!;
        const b = plan.yards[i + 1]!;
        if (plan.lots[i]!.block === plan.lots[i + 1]!.block && a.kind !== "paved" && b.kind !== "paved") {
          pairs++;
          if (a.kind !== b.kind) differ++;
        }
      }
      for (const y of plan.yards) {
        if (y.kind === "paved") continue;
        kinds.add(y.kind);
        const b = buildingOf.get(y.lot);
        if (b === undefined) {
          expect(["tall", "brush", "shaggy", "bare"]).toContain(y.kind);
          expect(y.drive).toBeNull();
          expect(y.walk).toBeNull();
        } else if (b.state === "ruin") expect(["brush", "tall"]).toContain(y.kind);
        else if (b.state === "vacant") expect(y.kind).not.toBe("mown");
      }
    }
    console.log(`yards: ${[...kinds].sort().join(", ")}; ${differ} of ${pairs} neighbouring pairs differ`);
    expect(kinds.size).toBe(6);
    expect(differ / pairs).toBeGreaterThan(0.6);
  });
});
