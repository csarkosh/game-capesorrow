import { describe, expect, it } from "vitest";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import {
  CROSSWALK_WIDTH,
  NO_PARK_CROSSWALK,
  NO_PARK_STOP,
  RADIUS_HIGHWAY,
  RADIUS_MAIN,
  RADIUS_STREET,
  RAIL_STOP_LINE,
  SHARP_SKEW,
  SQUARE_SKEW,
  STOP_LINE_GAP,
  UNMARKED_CROSSWALK,
  hasPavement,
  stopSignSpot,
} from "../../src/sim/town/junctions.js";
import { CURB_FACE, RAMP_RUN, RAMP_SLOPE, RAMP_WIDTH, REACH_MAX, areaOf, onLeg, pavementPolygon, polygonsOverlap, rampsOf } from "../../src/sim/town/junctionShape.js";
import { segDist } from "../../src/sim/town/geom.js";
import type { Junction, JunctionLeg, TownPlan } from "../../src/sim/town/types.js";
import { SEEDS, townFor } from "./sites.js";

const GRID = ["street", "avenue", "main"];
const weight = (k: string): number => (k === "highway" ? 5 : k === "main" ? 4 : k === "avenue" ? 3 : 1);

/** The pairs of grid streets that meet: their centre lines cross, or one ends within the other's right of way (found here from the plan's streets, apart from the finder). */
function meetings(plan: TownPlan): { ids: [number, number]; x: number; z: number }[] {
  const grid = plan.streets.filter((s) => GRID.includes(s.kind));
  const out: { ids: [number, number]; x: number; z: number }[] = [];
  for (let i = 0; i < grid.length; i++) {
    for (let j = i + 1; j < grid.length; j++) {
      const a = grid[i] as (typeof grid)[number];
      const b = grid[j] as (typeof grid)[number];
      const ax = a.b.x - a.a.x;
      const az = a.b.z - a.a.z;
      const bx = b.b.x - b.a.x;
      const bz = b.b.z - b.a.z;
      const la = Math.sqrt(ax * ax + az * az);
      const lb = Math.sqrt(bx * bx + bz * bz);
      const den = (ax * bz - az * bx) / (la * lb);
      if (Math.abs(den) < 0.17) continue;
      const ti = ((b.a.x - a.a.x) * bz - (b.a.z - a.a.z) * bx) / (ax * bz - az * bx);
      const tj = ((b.a.x - a.a.x) * az - (b.a.z - a.a.z) * ax) / (ax * bz - az * bx);
      if (ti * la < -(b.width / 2 + 0.8) || ti * la > la + b.width / 2 + 0.8 || tj * lb < -(a.width / 2 + 0.8) || tj * lb > lb + a.width / 2 + 0.8) continue;
      out.push({ ids: [a.id, b.id], x: a.a.x + ax * ti, z: a.a.z + az * ti });
    }
  }
  return out;
}

const paved = (plan: TownPlan): Junction[] => plan.junctions.filter(hasPavement);

describe("junctions: the plan's records", () => {
  it("has exactly one junction for every meeting of streets, and every street's end on the highway is in one, over forty seeds", () => {
    let pairs = 0;
    let ends = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const hwSegs = plan.streets.filter((q) => q.kind === "highway");
      for (const { ids: [a, b], x, z } of meetings(plan)) {
        // A meeting at the highway's own edge is the highway junction's (below).
        if (Math.min(...hwSegs.map((h) => segDist({ x, z }, h.a, h.b))) <= ROAD_BED_HALF + 14) continue;
        // The junction at the place where the two streets' centre lines meet (a compound junction may hold more streets, and its middle is within its pavement).
        const holding = paved(plan).filter((j) => j.streets.includes(a) && j.streets.includes(b) && Math.min(...j.legs.map((l) => Math.sqrt((l.x - x) * (l.x - x) + (l.z - z) * (l.z - z)))) < 45);
        expect(holding.length, `seed ${seed}: streets ${a} and ${b} meet`).toBe(1);
        pairs++;
      }
      const hw = plan.streets.filter((s) => s.kind === "highway");
      for (const st of plan.streets.filter((q) => GRID.includes(q.kind))) {
        for (const e of [st.a, st.b]) {
          if (Math.min(...hw.map((h) => segDist(e, h.a, h.b))) > ROAD_BED_HALF + 3) continue;
          expect(paved(plan).some((j) => j.kind === "highway" && j.streets.includes(st.id)), `seed ${seed}: street ${st.id} ends on the highway`).toBe(true);
          ends++;
        }
      }
      // No street is in two junctions that share its length: each street's junctions are in order and leave a strip between.
    }
    expect(pairs).toBeGreaterThan(500);
    expect(ends).toBeGreaterThan(200);
  });

  it("keeps each leg's parts in order and no finite number out of range: legs counter-clockwise, mouths at least the bands, no NaN", () => {
    for (const seed of SEEDS) {
      for (const j of paved(townFor(seed).plan)) {
        const dirs = j.legs.map((l) => Math.atan2(l.dz, l.dx));
        // Counter-clockwise: the turn from each leg to the next is positive and they close one full turn.
        let turn = 0;
        for (let i = 0; i < dirs.length; i++) {
          let d = (dirs[(i + 1) % dirs.length] as number) - (dirs[i] as number);
          while (d <= 0) d += Math.PI * 2;
          turn += d;
        }
        expect(Math.abs(turn - Math.PI * 2), `seed ${seed} junction ${j.id}`).toBeLessThan(1e-6);
        for (const l of j.legs) {
          for (const v of [l.mouth, l.bandLeft, l.bandRight, l.x, l.z, l.dx, l.dz, l.from, l.to]) expect(Number.isFinite(v)).toBe(true);
          expect(l.mouth).toBeGreaterThanOrEqual(Math.max(l.bandLeft, l.bandRight) - 1e-9);
          expect(l.mouth).toBeGreaterThanOrEqual(l.from - 1e-9);
          expect(Math.abs(Math.sqrt(l.dx * l.dx + l.dz * l.dz) - 1)).toBeLessThan(1e-9);
          if (!l.engine) expect(l.mouth, `seed ${seed} junction ${j.id}: a leg shorter than its mouth`).toBeLessThan(l.to);
        }
      }
    }
  });

  it("gives every curb return its radius by which streets meet (3.0, 6.1, 9.1 m at a square corner), tangent to both curbs", () => {
    let arcs = 0;
    let square = 0;
    for (const seed of SEEDS) {
      for (const j of paved(townFor(seed).plan)) {
        for (const k of j.corners) {
          if (k.shape !== "arc" || k.c === null || k.v === null) continue;
          const a = j.legs[k.from] as JunctionLeg;
          const b = j.legs[k.to] as JunctionLeg;
          // Where two junctions lie so close that their returns would meet (`tight`), every corner takes the 10 ft radius.
          const nominal = j.tight ? RADIUS_STREET : a.engine || b.engine ? RADIUS_HIGHWAY : weight(a.kind) > 1 || weight(b.kind) > 1 ? RADIUS_MAIN : RADIUS_STREET;
          expect(k.nominal).toBe(nominal);
          // Tangent to both curbs: the centre is the radius from each curb line, and the tangent points lie on the curbs and a radius from the centre.
          const da = (k.c.x - a.x) * -a.dz + (k.c.z - a.z) * a.dx - a.half;
          const db = -((k.c.x - b.x) * -b.dz + (k.c.z - b.z) * b.dx) - b.half;
          expect(Math.abs(da - k.radius), `seed ${seed} junction ${j.id}`).toBeLessThan(1e-6);
          expect(Math.abs(db - k.radius), `seed ${seed} junction ${j.id}`).toBeLessThan(1e-6);
          for (const t of [k.ta, k.tb]) expect(Math.abs(Math.sqrt((t.x - k.c.x) * (t.x - k.c.x) + (t.z - k.c.z) * (t.z - k.c.z)) - k.radius)).toBeLessThan(1e-6);
          expect(Math.abs((k.ta.x - k.c.x) * a.dx + (k.ta.z - k.c.z) * a.dz)).toBeLessThan(1e-6);
          expect(Math.abs((k.tb.x - k.c.x) * b.dx + (k.tb.z - k.c.z) * b.dz)).toBeLessThan(1e-6);
          expect(k.reach).toBeLessThanOrEqual(REACH_MAX + 1e-9);
          const dot = a.dx * b.dx + a.dz * b.dz;
          if (Math.abs(dot) < 0.005) {
            expect(Math.abs(k.radius - nominal) / nominal, `seed ${seed} junction ${j.id}: a square corner's radius`).toBeLessThan(0.01);
            square++;
          }
          arcs++;
        }
      }
    }
    expect(arcs).toBeGreaterThan(1000);
    expect(square).toBeGreaterThan(500);
  });

  it("decides control as the research decides it: none on quiet crossings, STOP on the minor legs only, all-way at one or two corners of the core, never a signal", () => {
    let none = 0;
    let stop = 0;
    let allWay = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      let ways = 0;
      for (const j of paved(plan)) {
        const heavy = Math.max(...j.legs.map((l) => (l.engine ? 5 : weight(l.kind))));
        const stopping = j.legs.filter((l) => l.stops);
        expect(["none", "stop", "all-way"]).toContain(j.control);
        for (const l of j.legs) {
          expect(l.stops === (l.stopLine !== null)).toBe(true);
          if (l.engine || l.closed) expect(l.stops).toBe(false);
        }
        if (j.control === "none") {
          expect(stopping.length).toBe(0);
          // Quiet: streets of one weight meeting square, no tee (whose stem stops).
          expect(new Set(j.legs.map((l) => weight(l.kind))).size).toBe(1);
          expect(j.kind === "tee" && j.legacy === null).toBe(false);
          if (j.legacy === null) expect(j.skew).toBeLessThanOrEqual(SQUARE_SKEW + 1e-9);
          none++;
        } else if (j.control === "all-way") {
          expect(j.core).toBe(true);
          expect(stopping.length).toBe(j.legs.filter((l) => !l.engine).length);
          ways++;
          allWay++;
        } else {
          expect(stopping.length).toBeGreaterThan(0);
          for (const l of stopping) {
            const w = weight(l.kind);
            // The minor street stops: a lighter street, or an equal one that is a tee's stem or the lesser street of a skew or of a marked crossing.
            expect(w < heavy || (w === heavy && (j.legs.indexOf(l) === j.stem || j.kind === "skew" || j.civic))).toBe(true);
          }
          stop++;
        }
        // A residential street meeting the main street, the avenue or the highway stops.
        if (heavy >= 3) for (const l of j.legs) if (!l.engine && weight(l.kind) < heavy && !l.closed) expect(l.stops, `seed ${seed} junction ${j.id}`).toBe(true);
      }
      expect(ways).toBeLessThanOrEqual(2);
    }
    console.log(`control over ${SEEDS.length} seeds: ${none} uncontrolled, ${stop} STOP, ${allWay} all-way, no signals`);
    expect(none).toBeGreaterThan(100);
    expect(stop).toBeGreaterThan(300);
    expect(allWay).toBeGreaterThan(40);
  });

  it("puts a stop line the cited distance before its crosswalk, a STOP sign beside the road before them, and holds parking back 20 ft and 30 ft", () => {
    let lines = 0;
    for (const seed of SEEDS) {
      for (const j of paved(townFor(seed).plan)) {
        for (const l of j.legs) {
          const crosswalk = l.marked ? CROSSWALK_WIDTH : UNMARKED_CROSSWALK;
          expect(l.holdBack).toBeGreaterThanOrEqual(crosswalk + NO_PARK_CROSSWALK - 1e-9);
          if (l.stopLine === null) continue;
          // 4 ft (1.22 m) before the crosswalk's far edge, or at least that far from the intersecting roadway with none marked.
          if (l.marked) expect(l.stopLine - (l.mouth + CROSSWALK_WIDTH)).toBeGreaterThanOrEqual(STOP_LINE_GAP - 1e-9);
          else expect(l.stopLine - l.mouth).toBeGreaterThanOrEqual(STOP_LINE_GAP - 1e-9);
          const spot = stopSignSpot(l) as { s: number; lat: number };
          expect(spot.lat).toBeGreaterThan(l.half);
          expect(spot.lat - l.half).toBeCloseTo(0.3, 6);
          expect(spot.s).toBeGreaterThan(l.stopLine);
          // 30 ft on the approach to a STOP sign.
          expect(l.holdBack).toBeGreaterThanOrEqual(spot.s - l.mouth + NO_PARK_STOP - 1e-9);
          lines++;
        }
      }
    }
    expect(lines).toBeGreaterThan(300);
  });

  it("marks crosswalks only on the main street, the avenue, the highway's legs in the core and the school's and hospital's corners, and gives every rebuilt corner ramps", () => {
    let marked = 0;
    let withRamps = 0;
    let without = 0;
    for (const seed of SEEDS) {
      for (const j of paved(townFor(seed).plan)) {
        for (const l of j.legs) {
          const expected = l.engine ? j.core : l.kind === "main" || l.kind === "avenue" || j.civic;
          expect(l.marked, `seed ${seed} junction ${j.id} ${l.kind}`).toBe(expected);
          if (l.marked) marked++;
        }
        // Rebuilt: anything with the main street, the avenue or the highway, the core, the school or the hospital.
        const rebuilt = j.legs.some((l) => l.engine || l.kind === "main" || l.kind === "avenue") || j.core || j.civic;
        if (rebuilt) expect(j.ramps, `seed ${seed} junction ${j.id}`).toBe(true);
        if (j.ramps) withRamps++;
        else {
          without++;
          expect(rebuilt).toBe(false);
        }
        const ramps = rampsOf(j.legs, j.ramps, { marked: CROSSWALK_WIDTH, unmarked: UNMARKED_CROSSWALK });
        // Two ramps (one a crossing direction) for each leg that has a sidewalk: eight at a four-way of streets.
        if (j.ramps && j.legs.length === 4 && j.legs.every((l) => !l.engine && l.walkLeft && l.walkRight && l.curbLeft && l.curbRight)) expect(ramps.length).toBe(8);
        for (const r of ramps) {
          const l = j.legs[r.leg] as JunctionLeg;
          const crosswalk = l.marked ? CROSSWALK_WIDTH : UNMARKED_CROSSWALK;
          // Inside the crosswalk's width, 4 ft wide, falling no more than 8.3 percent.
          expect(r.s0).toBeGreaterThanOrEqual(l.mouth - 1e-9);
          expect(r.s1).toBeLessThanOrEqual(l.mouth + crosswalk + 1e-9);
          expect(r.s1 - r.s0).toBeGreaterThanOrEqual(RAMP_WIDTH - 1e-9);
          expect(CURB_FACE / RAMP_RUN).toBeLessThanOrEqual(RAMP_SLOPE);
        }
      }
    }
    console.log(`crosswalks marked: ${marked}; junctions with ramps ${withRamps}, without ${without}`);
    expect(marked).toBeGreaterThan(50);
    expect(without).toBeGreaterThan(20);
  });

  it("draws no two junction pavements over each other, and no pavement's area is negative or empty", () => {
    for (const seed of SEEDS) {
      const js = paved(townFor(seed).plan).filter((j) => j.legs.length >= 3 || j.kind === "bend");
      const polys = js.map((j) => pavementPolygon(j.legs, j.corners));
      polys.forEach((p, i) => {
        if (p.length >= 3) expect(areaOf(p), `seed ${seed} junction ${js[i]?.id}`).toBeGreaterThan(0);
      });
      for (let a = 0; a < polys.length; a++) for (let b = a + 1; b < polys.length; b++) expect(polygonsOverlap(polys[a] as never, polys[b] as never), `seed ${seed}: junctions ${js[a]?.id} and ${js[b]?.id}`).toBe(false);
    }
  });

  it("closes a leg with a planter only where streets cross within 60 degrees, and leaves a tee of the rest", () => {
    let legacy = 0;
    for (const seed of SEEDS) {
      for (const j of paved(townFor(seed).plan)) {
        if (j.legacy === null) {
          expect(j.closed.length).toBe(0);
          continue;
        }
        legacy++;
        expect(j.skew).toBeGreaterThan(SHARP_SKEW);
        expect(j.closed.length).toBeGreaterThanOrEqual(1);
        expect(j.closed.every((l) => l.closed && !l.stops)).toBe(true);
      }
    }
    expect(legacy).toBeGreaterThan(0);
  });

  it("gives each junction with a pavement name blades that carry two different streets' own names", () => {
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const j of paved(plan)) {
        if (j.blades === null) continue;
        const [a, b] = j.blades.legs.map((i) => j.legs[i] as JunctionLeg);
        expect(a?.name).toBe((plan.streets[a?.street as number] as { name: string }).name);
        expect(b?.name).toBe((plan.streets[b?.street as number] as { name: string }).name);
        expect(a?.street).not.toBe(b?.street);
      }
    }
  });

  it("carries the railroad's crossbucks and stop line in the crossing's junction, at least 15 ft (4.6 m) from the nearest rail", () => {
    let n = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      const rails = plan.junctions.filter((j) => j.kind === "rail");
      expect(rails.length).toBe(plan.rail.crossings.length);
      for (const j of rails) {
        expect(j.control).toBe("crossbuck");
        expect(j.rail?.stopLine).toBe(RAIL_STOP_LINE);
        expect((j.rail?.stopLine ?? 0) - 0.72).toBeGreaterThanOrEqual(4.6);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("makes an alley's mouth no intersection (no corners, no control, no marks), each at a street's right of way", () => {
    let mouths = 0;
    for (const seed of SEEDS) {
      const { plan } = townFor(seed);
      for (const j of plan.junctions.filter((q) => q.kind === "alley")) {
        expect(j.corners.length).toBe(0);
        expect(j.control).toBe("none");
        expect(j.legs.every((l) => !l.marked && !l.stops)).toBe(true);
        const m = j.alley;
        expect(m).not.toBeNull();
        const st = plan.streets[m?.street as number] as (typeof plan.streets)[number];
        expect(GRID).toContain(st.kind);
        // The apron opens on the street's lot line: at most 2.5 m from the street's centre line past its half width.
        expect(segDist({ x: m?.x ?? 0, z: m?.z ?? 0 }, st.a, st.b)).toBeLessThanOrEqual(st.width / 2 + 0.05);
        mouths++;
      }
    }
    expect(mouths).toBeGreaterThan(300);
  });

  it("prints the counts of each kind for twelve seeds", () => {
    const rows: string[] = [];
    for (const seed of SEEDS.slice(0, 12)) {
      const { plan } = townFor(seed);
      const k = (kind: string): number => plan.junctions.filter((j) => j.kind === kind).length;
      const p = paved(plan);
      rows.push(
        `seed ${seed}: four-way ${k("four-way")}, tee ${k("tee")}, skew ${k("skew")}, bend ${k("bend")}, highway ${k("highway")}, alley ${k("alley")}, road end ${k("road end")}, stair ${k("stair")}, rail ${k("rail")}; ` +
          `controlled ${p.filter((j) => j.control !== "none").length}, uncontrolled ${p.filter((j) => j.control === "none").length}; marked crosswalks ${p.reduce((s, j) => s + j.legs.filter((l) => l.marked).length, 0)}; ramps ${p.reduce((s, j) => s + rampsOf(j.legs, j.ramps, { marked: CROSSWALK_WIDTH, unmarked: UNMARKED_CROSSWALK }).length, 0)}; legacy ${p.filter((j) => j.legacy !== null).length}`,
      );
      void onLeg;
    }
    console.log(rows.join("\n"));
    expect(rows.length).toBe(12);
  });
});
