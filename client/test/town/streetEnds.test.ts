import { describe, expect, it } from "vitest";
import { ADJACENT, PAST_LAST_LOT } from "../../src/sim/town/port/ends.js";
import { segDist } from "../../src/sim/town/geom.js";
import type { TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

const KINDS = ["street", "main", "avenue", "alley"];

/** How far a point is from the nearest right of way of any street but `skip`'s, the rail and the wharf's deck left out. */
function toOtherStreet(plan: TownPlan, skip: number, p: { x: number; z: number }): number {
  let d = Infinity;
  for (const o of plan.streets) {
    if (o.id === skip || o.kind === "rail" || o.kind === "wharf") continue;
    d = Math.min(d, segDist(p, o.a, o.b) - o.width / 2);
  }
  return d;
}

function distanceToBlocks(plan: TownPlan, p: { x: number; z: number }): number {
  let d = Infinity;
  for (const b of plan.blocks) {
    for (let k = 0; k < b.polygon.length; k++) d = Math.min(d, segDist(p, b.polygon[k] as { x: number; z: number }, b.polygon[(k + 1) % b.polygon.length] as { x: number; z: number }));
  }
  return d;
}

describe("streets end the way streets end", () => {
  it("has no street end within 6 m of nothing: every end is a junction, a landing or a made end, over forty seeds", () => {
    let made = 0;
    let landings = 0;
    let junctions = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const st of plan.streets) {
        if (!KINDS.includes(st.kind)) continue;
        for (const at of ["a", "b"] as const) {
          const p = at === "a" ? st.a : st.b;
          if (toOtherStreet(plan, st.id, p) <= 0.6) {
            junctions++;
            continue;
          }
          const end = plan.ends.find((e) => e.street === st.id && e.at === at);
          expect(end, `seed ${seed} ${st.name} (${st.kind}) ${at} ends at nothing`).toBeDefined();
          if (end?.kind === "landing") landings++;
          else made++;
        }
      }
      // Every end the plan names is on its street, points out of it, and is no junction.
      for (const e of plan.ends) {
        const st = plan.streets[e.street] as (typeof plan.streets)[number];
        const p = e.at === "a" ? st.a : st.b;
        expect(Math.hypot(p.x - e.x, p.z - e.z)).toBeLessThan(1e-9);
        expect(Math.hypot(e.dx, e.dz)).toBeCloseTo(1, 9);
        expect(toOtherStreet(plan, st.id, p)).toBeGreaterThan(0.6);
      }
    }
    expect(made).toBeGreaterThan(200);
    process.stderr.write(`street ends over 40 seeds: ${junctions} junctions, ${made} made ends, ${landings} landings\n`);
  });

  it("cuts every stub: a street that is no junction at an end has a block alongside it within a few metres of that end", () => {
    let worst = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const e of plan.ends) {
        const st = plan.streets[e.street] as (typeof plan.streets)[number];
        if (st.kind === "alley" || e.kind === "landing") continue;
        // The street ends `PAST_LAST_LOT` m past where a block last stands beside it (the block's corner is up to a half width and a little more off).
        const d = distanceToBlocks(plan, e);
        worst = Math.max(worst, d - st.width / 2);
        expect(d, `seed ${seed} ${st.name} ${e.at}`).toBeLessThanOrEqual(st.width / 2 + ADJACENT + PAST_LAST_LOT + 1);
      }
    }
    process.stderr.write(`made ends: the nearest block is at most ${worst.toFixed(1)} m beyond the street's right of way\n`);
  });

  it("makes each end of one kind, a turnaround or a barricade, and some of each over forty seeds", () => {
    const seen = { turnaround: 0, barricade: 0, landing: 0 };
    for (const seed of SEEDS) for (const e of townFor(seed).plan.ends) seen[e.kind]++;
    expect(seen.turnaround).toBeGreaterThan(20);
    expect(seen.barricade).toBeGreaterThan(20);
    expect(seen.landing).toBeGreaterThan(5);
  });
});
