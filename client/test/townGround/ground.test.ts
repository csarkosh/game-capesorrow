import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVE_Z, HEAD_HALF_WIDTH, SEA_LEVEL, coastGround, coveFor, roadCenterX, roadCorridorOverD, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt, type TerrainSample } from "@csarkosh/engine/sim/terrain";
import { RAIL_REACH } from "../../src/sim/town/railGround.js";
import { railCenterX } from "../../src/sim/town/rail.js";
import { BANK, EDGE, FAR_FROM, HILL_EXTRA, HILL_FROM, HILL_GRADE, HILL_TO, OWN_FLATS, OWN_HILL, QUAY, QUAY_JOIN, RELIEF_LIMIT, TOWN_INLAND, TOWN_Z_HALF, bankD, madePlaneD, townGroundD } from "../../src/sim/town/ground.js";
import { COVER_FADE, COVER_HOLD, coverD } from "../../src/sim/town/cover.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { fillWindowD, townFillFor } from "../../src/sim/town/fill.js";
import { shoreSplineOf, shoreXAt } from "../../src/sim/town/shoreSpline.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { TEN_SEEDS } from "./seeds.js";
import { madeGround } from "./made.js";

/** A small deterministic generator for the points a test picks. */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** The made ground alone, over the coast's, at a world point (what the coast hands the overlay, and the overlay's answer). */
function made(seed: number, x: number, z: number): TerrainSample {
  const { u, uDz, ground } = coastGround(seed, x, z);
  return townGroundD(seed, x, z, u, uDz, ground);
}

/** The graded plane alone at a world point (no relief, no weight): what the made ground is built over. */
function planeAt(seed: number, x: number, z: number): TerrainSample {
  const { u, uDz } = coastGround(seed, x, z);
  const plane = madePlaneD(seed, x, z, u, uDz);
  if (plane === null) throw new Error("no plane here");
  return plane;
}

/** The town's cover at a world point, as the made ground reads it (the outlying lots level nothing: their ground is the land's own). */
function cover(seed: number, x: number, z: number): number {
  const site = siteFor(seed);
  return coverD(planFor(seed), x - site.anchor.x, z - COVE_Z, false).v;
}

/** Whether the plan's fill, its bank included, reaches a world point: there the ground is made, and not the coast's own, whatever the footprint says. */
function fillReaches(seed: number, x: number, z: number): boolean {
  const site = siteFor(seed);
  return fillWindowD(townFillFor(seed), x - site.anchor.x, z - site.anchor.z).v > 0;
}

/** The shore's world x and the highway's at a z, and the point `s` metres landward of the water's edge. */
function frame(seed: number, z: number) {
  const site = siteFor(seed);
  const line = shoreXAt(shoreSplineOf(site), z - COVE_Z);
  const shore = site.anchor.x + line.v;
  // `foot`: how far seaward of the water's edge the bank ends here, along x.
  return { shore, road: roadCenterX(seed, z), at: (s: number) => shore + s, foot: bankD(0, 0, line.dz, line.dz2).foot };
}

describe("the town's made ground", () => {
  it("has the exact gradient: at 300 points inside, on the edges and outside the footprint, the gradient is the finite difference of the height", () => {
    const rnd = lcg(11);
    const H = 0.0002;
    let worst = 0;
    const counts = { inside: 0, edge: 0, outside: 0 };
    for (const seed of [20261121, 1, 424242]) {
      for (let k = 0; k < 100; k++) {
        const z = (rnd() * 2 - 1) * (TOWN_Z_HALF + 2 * EDGE);
        const f = frame(seed, z);
        // Land of the footprint, its three blends and its bank, then outside them all.
        const kind = k % 4;
        const x = kind === 0 ? f.at(8 + rnd() * (f.road - f.shore + TOWN_INLAND - 8)) : kind === 1 ? f.at(-BANK - 2 + rnd() * (BANK + 6)) : kind === 2 ? f.road + TOWN_INLAND - 4 + rnd() * (EDGE + 8) : f.at(-60 + rnd() * 400);
        const zz = kind === 3 ? Math.sign(z) * (TOWN_Z_HALF - 4 + rnd() * (EDGE + 8)) : z;
        const here = { x: kind === 3 ? f.at(40 + rnd() * 100) : x, z: zz };
        const sample = made(seed, here.x, here.z);
        const fdx = (made(seed, here.x + H, here.z).h - made(seed, here.x - H, here.z).h) / (2 * H);
        const fdz = (made(seed, here.x, here.z + H).h - made(seed, here.x, here.z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(sample.dx - fdx), Math.abs(sample.dz - fdz));
        expect(sample.dx, `seed ${seed} at ${here.x.toFixed(2)}, ${here.z.toFixed(2)}`).toBeCloseTo(fdx, 5);
        expect(sample.dz, `seed ${seed} at ${here.x.toFixed(2)}, ${here.z.toFixed(2)}`).toBeCloseTo(fdz, 5);
        const inFoot = Math.abs(here.z) <= TOWN_Z_HALF && here.x - f.road <= TOWN_INLAND && here.x >= f.shore;
        if (inFoot) counts.inside++;
        else if (Math.abs(here.z) < TOWN_Z_HALF + EDGE && here.x - f.road < TOWN_INLAND + EDGE && here.x > f.shore - BANK) counts.edge++;
        else counts.outside++;
      }
    }
    // All three kinds were met.
    expect(counts.inside).toBeGreaterThan(20);
    expect(counts.edge).toBeGreaterThan(20);
    expect(counts.outside).toBeGreaterThan(5);
    expect(worst).toBeLessThan(1e-5);
    process.stderr.write(`gradient vs finite difference over 300 points (${counts.inside} inside, ${counts.edge} edge, ${counts.outside} outside): worst ${worst.toExponential(2)}\n`);
  });

  it("keeps the exact gradient through the whole coast's ground, the road's corridor laid over it", () => {
    const rnd = lcg(5);
    const H = 0.002;
    for (let k = 0; k < 100; k++) {
      const seed = [20261121, 1, 424242, 31337][k % 4] as number;
      const z = (rnd() * 2 - 1) * (TOWN_Z_HALF + EDGE);
      const f = frame(seed, z);
      const x = f.road - 40 + rnd() * 80;
      const s = elevationSampleAt(seed, x, z);
      const fdx = (elevationSampleAt(seed, x + H, z).h - elevationSampleAt(seed, x - H, z).h) / (2 * H);
      const fdz = (elevationSampleAt(seed, x, z + H).h - elevationSampleAt(seed, x, z - H).h) / (2 * H);
      expect(s.dx).toBeCloseTo(fdx, 5);
      expect(s.dz).toBeCloseTo(fdz, 5);
    }
  });

  it("has no step in its height: neighbours 0.25 m apart differ by the slope between them, to a few centimetres, across every edge", () => {
    let worst = 0;
    for (const seed of [20261121, 7]) {
      for (const zr of [-300, -17.5, 0, 123.25, 290]) {
        const f = frame(seed, zr);
        // Along x: the bank, the water's edge, the highway, the inland edge and its blend.
        const lines: { from: number; to: number; along: "x" | "z"; at: number }[] = [
          { from: f.at(-BANK - 6), to: f.at(8), along: "x", at: zr },
          { from: f.road + TOWN_INLAND - 10, to: f.road + TOWN_INLAND + EDGE + 10, along: "x", at: zr },
        ];
        for (const line of lines) {
          for (let x = line.from; x < line.to; x += 0.25) {
            const a = made(seed, x, line.at);
            const b = made(seed, x + 0.25, line.at);
            worst = Math.max(worst, Math.abs(b.h - a.h - 0.125 * (a.dx + b.dx)));
          }
        }
      }
      // Along z through the footprint's two ends and across the bank.
      for (const sign of [-1, 1]) {
        for (let zr = sign * (TOWN_Z_HALF - 10); Math.abs(zr) < TOWN_Z_HALF + EDGE + 10; zr += sign * 0.25) {
          const f = frame(seed, zr);
          const x = f.at(30);
          const a = made(seed, x, zr);
          const b = made(seed, x, zr + sign * 0.25);
          worst = Math.max(worst, Math.abs(b.h - a.h - sign * 0.125 * (a.dz + b.dz)));
        }
      }
    }
    expect(worst).toBeLessThan(0.02);
    process.stderr.write(`largest step beyond the slope between points 0.25 m apart, across the edges: ${(worst * 100).toFixed(3)} cm\n`);
  });

  it("is built over a plane of constant grade on the flats and a hill of constant grade (steepening past FAR_FROM) east of the highway's corridor, both set by the quay and the highway's height", () => {
    // What the flats' grade makes up for the ease into the hill, across the highway: the rise of the join at u = 0.
    const span = HILL_TO - HILL_FROM;
    const t0 = -HILL_FROM / span;
    const joinAtHighway = span * t0 * t0 * t0 * t0 * (t0 * t0 - 3 * t0 + 2.5);
    for (const seed of TEN_SEEDS.slice(0, 5)) {
      const site = siteFor(seed);
      for (const i of [8, 20, 32, 44, 56]) {
        const zr = site.z0 + i * site.step;
        const z = COVE_Z + zr;
        // Independent of the spline: at a sample it is the sample's shore.
        const shore = site.anchor.x + (site.shoreX[i] as number);
        const road = roadCenterX(seed, z);
        const flats = (roadGradeAt(seed, z).h - QUAY - HILL_GRADE * joinAtHighway) / (road - shore - joinAtHighway);
        // Beyond the plane's foot, which is QUAY_JOIN metres across the shore.
        const q = shoreXAt(shoreSplineOf(site), zr).dz;
        const clear = QUAY_JOIN * Math.sqrt(1 + q * q) + 5;
        for (const s of [clear, clear + 15, road - shore - 40]) {
          expect(planeAt(seed, shore + s, z).dx, `seed ${seed} z ${z} s ${s}`).toBeCloseTo(flats, 9);
        }
        for (const u of [HILL_TO, 60, 150, FAR_FROM]) {
          expect(planeAt(seed, road + u, z).dx, `seed ${seed} z ${z} u ${u}`).toBeCloseTo(HILL_GRADE, 9);
        }
        // Past FAR_FROM the coast's own hill steepens and the grade eases up, by no more than HILL_EXTRA.
        const far = planeAt(seed, road + TOWN_INLAND - 10, z).dx;
        expect(far).toBeGreaterThan(HILL_GRADE);
        expect(far).toBeLessThanOrEqual(HILL_GRADE + HILL_EXTRA + 1e-12);
        // QUAY above the sea at the water's edge, and the grade line's height where the highway runs.
        expect(planeAt(seed, shore, z).h).toBeCloseTo(QUAY, 9);
        expect(planeAt(seed, road, z).h).toBeCloseTo(roadGradeAt(seed, z).h, 9);
        // The hill rises at its grade: the same rise over the same run, anywhere on it.
        expect(planeAt(seed, road + FAR_FROM, z).h - planeAt(seed, road + 100, z).h).toBeCloseTo((FAR_FROM - 100) * HILL_GRADE, 9);
      }
    }
  });

  it("changes from the flats' grade to the hill's by an ease, not a crease: the slope is continuous and monotone across the highway", () => {
    let step = 0;
    for (const seed of [20261121, 1, 424242]) {
      for (const z of [-300, 0, 200]) {
        const road = roadCenterX(seed, z);
        let last = planeAt(seed, road + HILL_FROM - 6, z).dx;
        const first = last;
        for (let u = HILL_FROM - 6; u <= HILL_TO + 6; u += 0.25) {
          const d = planeAt(seed, road + u, z).dx;
          step = Math.max(step, Math.abs(d - last));
          // The grade only rises from the flats' to the hill's.
          expect(d).toBeGreaterThanOrEqual(last - 1e-12);
          last = d;
        }
        expect(first).toBeLessThan(HILL_GRADE / 2);
        expect(last).toBeCloseTo(HILL_GRADE, 12);
      }
    }
    // A quintic ease over 34 m: the slope moves by at most 1.875 * 0.06 / 34 * 0.25 in a step.
    expect(step).toBeLessThan(0.002);
    process.stderr.write(`largest change of the x-slope between points 0.25 m apart across the highway: ${step.toExponential(2)}\n`);
  });

  it("keeps the town's ground walkable: where the plan stands, all but a few of 100 points are under a slope of 0.10 (the land the blocks stand on is up to 14 percent, and the relief keeps a share of it), and the highway's own width is under 0.13 (its grade line follows the ground, which climbs more where the bay's shelf is narrow)", () => {
    let total = 0;
    let steep = 0;
    let worst = 0;
    let corridorWorst = 0;
    for (const seed of TEN_SEEDS) {
      const site = siteFor(seed);
      const line = shoreSplineOf(site);
      for (let zr = -TOWN_Z_HALF; zr <= TOWN_Z_HALF; zr += 6) {
        const shore = site.anchor.x + shoreXAt(line, zr).v;
        const z = COVE_Z + zr;
        const road = roadCenterX(seed, z);
        // From 14 m inland of the water's edge (the bank is tested apart), where the plan stands whole.
        for (let x = shore + 14; x <= road + TOWN_INLAND; x += 6) {
          if (cover(seed, x, z) < 0.999) continue;
          const s = madeGround(seed, x, z);
          if (s === null) continue;
          const g = Math.hypot(s.dx, s.dz);
          if (Math.abs(x - road) <= 14) corridorWorst = Math.max(corridorWorst, g);
          else {
            total++;
            if (g > 0.1) steep++;
            worst = Math.max(worst, g);
          }
        }
      }
    }
    process.stderr.write(`slope where the plan stands over ten seeds: ${steep} of ${total} points over 0.10 (${((steep / total) * 100).toFixed(2)}%), steepest ${worst.toFixed(2)}; within 14 m of the highway steepest ${corridorWorst.toFixed(3)}\n`);
    expect(total).toBeGreaterThan(10000);
    expect(steep / total).toBeLessThan(0.03);
    expect(corridorWorst).toBeLessThan(0.13);
  });

  it("follows the plan, not a rectangle: the cover is 1 on every block, on the streets between them and on the highway beside them, falls to 0 beyond, and the made ground is the coast's own where it is 0", () => {
    for (const seed of TEN_SEEDS.slice(0, 6)) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      let inside = 0;
      for (const b of plan.blocks) {
        const c = b.polygon.reduce((acc, p) => ({ x: acc.x + p.x / b.polygon.length, z: acc.z + p.z / b.polygon.length }), { x: 0, z: 0 });
        expect(coverD(plan, c.x, c.z).v, `seed ${seed} block ${b.id}`).toBe(1);
        inside++;
      }
      // The streets: a point on each (its middle) is covered whole, whatever else lies about it.
      let covered = 0;
      let streets = 0;
      for (const st of plan.streets) {
        if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf") continue;
        streets++;
        if (coverD(plan, (st.a.x + st.b.x) / 2, (st.a.z + st.b.z) / 2).v >= 0.999) covered++;
      }
      expect(covered / streets, `seed ${seed} streets covered`).toBeGreaterThan(0.97);
      // Beyond COVER_HOLD + COVER_FADE of every block the ground is the coast's own, the same values.
      let own = 0;
      for (let zr = -700; zr <= 700; zr += 20) {
        for (let xf = -400; xf <= 700; xf += 20) {
          if (coverD(plan, xf, zr).v !== 0) continue;
          const x = site.anchor.x + xf;
          const z = COVE_Z + zr;
          if (fillReaches(seed, x, z)) continue;
          const here = coastGround(seed, x, z);
          expect(townGroundD(seed, x, z, here.u, here.uDz, here.ground)).toBe(here.ground);
          own++;
        }
      }
      expect(own, `seed ${seed} points with no cover`).toBeGreaterThan(300);
      expect(inside).toBeGreaterThan(20);
    }
    process.stderr.write(`cover: whole on every block, hold ${COVER_HOLD} m and fade ${COVER_FADE} m\n`);
  });

  it("has the exact gradient at 300 points of the plan: inside its blocks, in the fade beyond them and in the relief's own windows", () => {
    const rnd = lcg(21);
    const H = 0.0002;
    let worst = 0;
    for (const seed of [20261121, 1, 424242]) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      for (let k = 0; k < 100; k++) {
        const b = plan.blocks[Math.floor(rnd() * plan.blocks.length)] as (typeof plan.blocks)[number];
        const p = b.polygon[Math.floor(rnd() * b.polygon.length)] as { x: number; z: number };
        const c = b.polygon.reduce((acc, q) => ({ x: acc.x + q.x / b.polygon.length, z: acc.z + q.z / b.polygon.length }), { x: 0, z: 0 });
        // From the block's middle out to well beyond its corner: inside, the hold, the fade.
        const t = rnd() * (k % 2 === 0 ? 1 : 3.2);
        const x = site.anchor.x + c.x + (p.x - c.x) * t;
        const z = site.anchor.z + c.z + (p.z - c.z) * t;
        const sample = made(seed, x, z);
        const fdx = (made(seed, x + H, z).h - made(seed, x - H, z).h) / (2 * H);
        const fdz = (made(seed, x, z + H).h - made(seed, x, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(sample.dx - fdx), Math.abs(sample.dz - fdz));
        expect(sample.dx, `seed ${seed} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeCloseTo(fdx, 5);
        expect(sample.dz, `seed ${seed} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeCloseTo(fdz, 5);
      }
    }
    process.stderr.write(`gradient vs finite difference at 300 points of the plan: worst ${worst.toExponential(2)}\n`);
  });

  it("keeps relief inside what it declares: the made ground is the plane where the relief window is shut (the fill, the quay's 14 m, the highway's 14 m), and elsewhere within RELIEF_LIMIT and the town's own amplitude of it", () => {
    let shut = 0;
    let open = 0;
    let worst = 0;
    for (const seed of TEN_SEEDS.slice(0, 5)) {
      const site = siteFor(seed);
      const plan = planFor(seed);
      for (let zr = -400; zr <= 400; zr += 16) {
        const z = COVE_Z + zr;
        const road = roadCenterX(seed, z);
        // Within the highway's own width, and the plan standing whole: exactly the plane.
        for (const u of [-10, -4, 0, 5, 12]) {
          const x = road + u;
          if (cover(seed, x, z) < 1) continue;
          const here = coastGround(seed, x, z);
          const plane = madePlaneD(seed, x, z, here.u, here.uDz);
          if (plane === null || !(x - site.anchor.x > shoreXAt(shoreSplineOf(site), zr).v + 20)) continue;
          expect(Math.abs(townGroundD(seed, x, z, here.u, here.uDz, here.ground).h - plane.h), `seed ${seed} z ${z} u ${u}`).toBeLessThan(1e-9);
          shut++;
        }
        // Where it is open: the ground is within the limit and the own relief of the plane.
        for (const u of [-60, 100, 200]) {
          const x = road + u;
          if (cover(seed, x, z) < 1) continue;
          const here = coastGround(seed, x, z);
          const plane = madePlaneD(seed, x, z, here.u, here.uDz);
          if (plane === null) continue;
          const off = Math.abs(townGroundD(seed, x, z, here.u, here.uDz, here.ground).h - plane.h);
          worst = Math.max(worst, off);
          expect(off, `seed ${seed} z ${z} u ${u}`).toBeLessThanOrEqual(RELIEF_LIMIT + Math.max(OWN_FLATS, OWN_HILL) + 1e-9);
          open++;
        }
      }
      expect(plan.blocks.length).toBeGreaterThan(0);
    }
    expect(shut).toBeGreaterThan(50);
    expect(open).toBeGreaterThan(50);
    process.stderr.write(`relief: ${shut} points where the window is shut equal the plane; ${open} where it is open stand within ${worst.toFixed(2)} m of it\n`);
  });

  it("is the coast's own, exactly, beyond the plan's cover", () => {
    const rnd = lcg(3);
    let checked = 0;
    // The plan's fill reaches seaward of the natural shore at the cove, and its bank is made ground: a point it
    // reaches is left out here (and tested as the quay's bank in fill.test.ts), and counted.
    let inFill = 0;
    for (const seed of [20261121, 1, 424242]) {
      for (let k = 0; k < 120; k++) {
        const z = (rnd() * 2 - 1) * 900;
        const f = frame(seed, z);
        const x = k % 2 === 0 ? f.road + TOWN_INLAND + EDGE + 1 + rnd() * 300 : f.at(-f.foot - 1 - rnd() * 100);
        if (fillReaches(seed, x, z)) {
          inFill++;
          continue;
        }
        if (cover(seed, x, z) !== 0) continue;
        // The railroad's bed is laid over the place's ground along the whole coast (`railGround.ts`): a point it reaches is the bed's, tested in `townRail/`.
        if (Math.abs(x - railCenterX(seed, z)) < RAIL_REACH + 1) continue;
        const own = coastGround(seed, x, z);
        const got = elevationSampleAt(seed, x, z);
        expect(got).toEqual(roadCorridorOverD(seed, z, own.u, own.uDz, own.ground));
        checked++;
      }
      // Along the shore, past the footprint's far blend.
      for (const z of [TOWN_Z_HALF + EDGE + 1, -(TOWN_Z_HALF + EDGE + 1), 700, -1300]) {
        const f = frame(seed, z);
        for (const s of [20, 60, 150]) {
          if (fillReaches(seed, f.at(s), z)) {
            inFill++;
            continue;
          }
          if (cover(seed, f.at(s), z) !== 0) continue;
          if (Math.abs(f.at(s) - railCenterX(seed, z)) < RAIL_REACH + 1) continue;
          const own = coastGround(seed, f.at(s), z);
          expect(elevationSampleAt(seed, f.at(s), z)).toEqual(roadCorridorOverD(seed, z, own.u, own.uDz, own.ground));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    process.stderr.write(`the coast's own beyond the cover: ${checked} points checked, ${inFill} left out for lying in the plan's fill or its bank\n`);
  });

  it("follows the highway's grade line wherever the plan stands along it: its height at the highway is the grade line's, worst case over ten seeds", () => {
    let worst = 0;
    let checked = 0;
    const rows: string[] = [];
    for (const seed of TEN_SEEDS) {
      let seedWorst = 0;
      let gradeLeast = Infinity;
      let gradeGreatest = -Infinity;
      for (let z = -TOWN_Z_HALF; z <= TOWN_Z_HALF; z += 4) {
        const road = roadCenterX(seed, z);
        const { u, uDz, ground } = coastGround(seed, road, z);
        if (cover(seed, road, z) < 1) continue;
        const h = townGroundD(seed, road, z, u, uDz, ground).h;
        seedWorst = Math.max(seedWorst, Math.abs(h - roadGradeAt(seed, z).h));
        checked++;
        const f = frame(seed, z);
        const grade = planeAt(seed, f.at(60), z).dx;
        gradeLeast = Math.min(gradeLeast, grade);
        gradeGreatest = Math.max(gradeGreatest, grade);
      }
      worst = Math.max(worst, seedWorst);
      rows.push(`seed ${String(seed).padStart(9)}: highway grade ${roadGradeAt(seed, 0).h.toFixed(2)} m at the anchor, plane grade ${gradeLeast.toFixed(4)} to ${gradeGreatest.toFixed(4)}, mismatch at the highway ${seedWorst.toExponential(1)} m`);
    }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-9);
    process.stderr.write(`${rows.join("\n")}\nworst mismatch with the highway's grade over ten seeds: ${worst.toExponential(2)} m\n`);
  });

  it("ends at the water's edge in a bank, from the quay down to the coast's own ground below the tide line, and not a spike", () => {
    // The footprint's own bank, at every z: the ground is taken with no fill, so that the plan's fill, which now reaches
    // seaward of the natural shore at the cove, does not stand in the bank's place (its quay's bank is tested in fill.test.ts).
    const natural = (seed: number, x: number, z: number) => {
      const { u, uDz, ground } = coastGround(seed, x, z);
      return townGroundD(seed, x, z, u, uDz, ground, []);
    };
    let steepest = 0;
    let widest = 0;
    for (const seed of TEN_SEEDS) {
      const heads = coveFor(seed).heads;
      for (let z = -TOWN_Z_HALF + 8; z < TOWN_Z_HALF; z += 8) {
        // Where the plan stands at the water's edge.
        if (cover(seed, frame(seed, z).at(0), z) < 1) continue;
        // The cove's two headlands reach 100 to 150 m seaward of the waterline in a ridge 60 m across: on their
        // flanks the shore runs east and west and the coast's own ground beyond the bank is the ridge's.
        const atHeadland = heads.some((h) => Math.abs(z - h.z) < HEAD_HALF_WIDTH + 16);
        const f = frame(seed, z);
        const top = natural(seed, f.at(0), z);
        const foot = natural(seed, f.at(-f.foot), z);
        expect(top.h).toBeCloseTo(QUAY, 9);
        expect(foot.h).toBe(coastGround(seed, f.at(-f.foot), z).ground.h);
        widest = Math.max(widest, f.foot);
        if (!atHeadland) expect(foot.h, `seed ${seed} z ${z}`).toBeLessThan(SEA_LEVEL);
        let wet = false;
        for (let s = -f.foot; s <= 0; s += 0.1) {
          const m = natural(seed, f.at(s), z);
          if (!atHeadland) steepest = Math.max(steepest, Math.hypot(m.dx, m.dz));
          if (m.h > SEA_LEVEL) wet = true;
        }
        // The tide line lies in the bank.
        if (!atHeadland) expect(wet).toBe(true);
      }
    }
    expect(steepest).toBeLessThan(0.7);
    process.stderr.write(`steepest slope in the bank over ten seeds, away from the headlands: ${steepest.toFixed(3)}; widest along x ${widest.toFixed(1)} m\n`);
  });
});
