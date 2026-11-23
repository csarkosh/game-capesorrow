import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { generateChunk } from "@csarkosh/engine/sim/chunk";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { contains, orient, segDist } from "../../src/sim/town/geom.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import type { Road, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

/** A road's line sampled every 2 m. */
function sampled(road: Road): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1] as Road["points"][number];
    const b = road.points[i] as Road["points"][number];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < len; s += 2) out.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len });
  }
  const last = road.points[road.points.length - 1] as Road["points"][number];
  out.push({ x: last.x, z: last.z });
  return out;
}

function footprint(plan: TownPlan, id: number): { x: number; z: number }[] {
  const b = plan.buildings[id] as (typeof plan.buildings)[number];
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const c = (su: number, sv: number) => ({ x: b.centre.x + u.x * b.halfAlong * su + v.x * b.halfAcross * sv, z: b.centre.z + u.z * b.halfAlong * su + v.z * b.halfAcross * sv });
  return orient([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]);
}

describe("roads out of town", () => {
  it("leave from a grid street's end, never cross a building or a block's lots, and end at their destination, over forty seeds", () => {
    let roads = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      expect(plan.roads.length, `seed ${seed} roads`).toBeGreaterThanOrEqual(1);
      expect(plan.roads.length).toBeLessThanOrEqual(4);
      for (const road of plan.roads) {
        roads++;
        const st = plan.streets[road.from.street] as (typeof plan.streets)[number];
        const start = road.from.at === "a" ? st.a : st.b;
        const first = road.points[0] as Road["points"][number];
        expect(Math.hypot(first.x - start.x, first.z - start.z), `seed ${seed} ${road.name} starts on its street's end`).toBeLessThan(1e-6);
        expect(["street", "main", "avenue"]).toContain(st.kind);
        // The street's end that a road continues is no made end.
        expect(plan.ends.some((e) => e.street === st.id && e.at === road.from.at)).toBe(false);
        // Never in a block (so never in a lot or a building), after the street's own end.
        for (const p of sampled(road).slice(3)) {
          for (const b of plan.blocks) expect(contains(orient(b.polygon), p, 0), `seed ${seed} ${road.name} in block ${b.id}`).toBe(false);
        }
        for (const b of plan.buildings) {
          if (b.lot === -1) continue;
          const fp = footprint(plan, b.id);
          for (const p of sampled(road)) if (contains(fp, p, 0)) throw new Error(`seed ${seed} ${road.name} crosses building ${b.id}`);
        }
        // Ends at its destination, which is a landmark and a sentence of the history.
        const last = road.points[road.points.length - 1] as Road["points"][number];
        expect(Math.hypot(last.x - road.destination.x, last.z - road.destination.z)).toBeLessThan(1e-6);
        expect(road.length).toBeGreaterThanOrEqual(150);
        const lm = plan.landmarks.find((l) => l.role === road.destination.kind && l.name === road.destination.name);
        expect(lm, `seed ${seed} landmark for ${road.destination.name}`).toBeDefined();
        expect(lm?.building).toBe(-1);
        expect(lm?.at).toEqual({ x: road.destination.x, z: road.destination.z });
        expect(plan.history.events.some((e) => e.kind === "road" && e.text.includes(road.name)), `seed ${seed} history for ${road.name}`).toBe(true);
      }
      // A county road to the cemetery on the hill, from the inland side of the town.
      const county = plan.roads.find((r) => r.kind === "county");
      expect(county?.destination.kind, `seed ${seed}`).toBe("cemetery");
      expect(plan.history.events.map((e) => e.year)).toEqual(plan.history.events.map((e) => e.year).slice().sort((a, b) => a - b));
    }
    process.stderr.write(`roads out over 40 seeds: ${roads}\n`);
  });

  it("narrow from paved to gravel to two wheel tracks and end at a destination, each surface after the last", () => {
    const order = { paved: 0, gravel: 1, tracks: 2 } as const;
    let tracks = 0;
    for (const seed of SEEDS) {
      for (const road of townFor(seed).plan.roads) {
        let widest = Infinity;
        let rank = 0;
        for (const p of road.points) {
          expect(order[p.surface], `seed ${seed} ${road.name}`).toBeGreaterThanOrEqual(rank);
          rank = order[p.surface];
          expect(p.width).toBeLessThanOrEqual(widest + 1e-9);
          widest = p.width;
        }
        const st = townFor(seed).plan.streets[road.from.street] as (typeof townFor extends never ? never : ReturnType<typeof townFor>["plan"]["streets"][number]);
        expect((road.points[0] as Road["points"][number]).width).toBeCloseTo(st.roadway, 9);
        expect((road.points[0] as Road["points"][number]).surface).toBe("paved");
        if (road.length >= 400) {
          expect((road.points[road.points.length - 1] as Road["points"][number]).surface).toBe("tracks");
          expect((road.points[road.points.length - 1] as Road["points"][number]).width).toBeLessThanOrEqual(3.3);
          tracks++;
        }
      }
    }
    expect(tracks).toBeGreaterThan(5);
  });

  it("follow the land: on the ground the world has, no 20 m of any road is steeper than 15 percent", () => {
    let worst = 0;
    let worstAt = "";
    let windows = 0;
    for (const seed of SEEDS) {
      const { plan, site } = townFor(seed);
      for (const road of plan.roads) {
        const pts = sampled(road);
        const hs = pts.map((p) => elevationSampleAt(seed, site.anchor.x + p.x, site.anchor.z + p.z).h);
        for (let i = 0; i + 10 < hs.length; i++) {
          const g = Math.abs((hs[i + 10] as number) - (hs[i] as number)) / 20;
          windows++;
          if (g > worst) {
            worst = g;
            worstAt = `seed ${seed} ${road.name} at ${i * 2} m`;
          }
        }
      }
    }
    process.stderr.write(`steepest 20 m of any road over 40 seeds: ${(worst * 100).toFixed(1)}% (${worstAt}), ${windows} windows\n`);
    expect(windows).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(0.15);
  });

  it("clear the trees from every road's surface, and the trees stand within a few metres either side of it past the town's edge", () => {
    let nearAll = 0;
    for (const seed of [20261121, 1, 424242]) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      let nearTrunks = 0;
      let onRoad = 0;
      const seen = new Set<string>();
      for (const road of plan.roads) {
        const lines = sampled(road);
        const xs = lines.map((p) => p.x);
        const zs = lines.map((p) => p.z);
        const cx0 = Math.floor((site.anchor.x + Math.min(...xs) - 16) / CHUNK_SIZE);
        const cx1 = Math.floor((site.anchor.x + Math.max(...xs) + 16) / CHUNK_SIZE);
        const cz0 = Math.floor((site.anchor.z + Math.min(...zs) - 16) / CHUNK_SIZE);
        const cz1 = Math.floor((site.anchor.z + Math.max(...zs) + 16) / CHUNK_SIZE);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            if (seen.has(`${cx},${cz}`)) continue;
            seen.add(`${cx},${cz}`);
            for (const prop of generateChunk(seed, cx, cz).props) {
              if (prop.material !== "trunk") continue;
              const t = { x: (prop.box.min.x + prop.box.max.x) / 2 - site.anchor.x, z: (prop.box.min.z + prop.box.max.z) / 2 - site.anchor.z };
              for (const r of plan.roads) {
                for (let i = 1; i < r.points.length; i++) {
                  const a = r.points[i - 1] as Road["points"][number];
                  const b = r.points[i] as Road["points"][number];
                  const d = segDist(t, a, b) - (a.width + b.width) / 4;
                  if (d < 0) onRoad++;
                  // Past the town's edge: the whole forest comes right up to the road's own width and its ditch.
                  else if (i > 6 && d < 12) nearTrunks++;
                }
              }
            }
          }
        }
      }
      expect(onRoad, `seed ${seed} trunks on a road`).toBe(0);
      nearAll += nearTrunks;
    }
    expect(nearAll, "trunks within 12 m of a road, past the town's edge").toBeGreaterThan(20);
  });
});
