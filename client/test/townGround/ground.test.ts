import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVE_Z, HEAD_HALF_WIDTH, SEA_LEVEL, coastGround, coveFor, roadCenterX, roadCorridorOverD, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt, type TerrainSample } from "@csarkosh/engine/sim/terrain";
import { BANK, EDGE, HILL_FROM, HILL_GRADE, HILL_TO, QUAY, QUAY_JOIN, TOWN_INLAND, TOWN_Z_HALF, bankD, townGroundD } from "../../src/sim/town/ground.js";
import { shoreSplineOf, shoreXAt } from "../../src/sim/town/shoreSpline.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { TEN_SEEDS } from "./seeds.js";

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

  it("is a plane of constant grade on the flats and a hill of constant grade east of the highway's corridor, both set by the quay and the highway's height", () => {
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
          expect(made(seed, shore + s, z).dx, `seed ${seed} z ${z} s ${s}`).toBeCloseTo(flats, 9);
        }
        for (const u of [HILL_TO, 60, 150, TOWN_INLAND - 10]) {
          expect(made(seed, road + u, z).dx, `seed ${seed} z ${z} u ${u}`).toBeCloseTo(HILL_GRADE, 9);
        }
        // QUAY above the sea at the water's edge, and the grade line's height where the highway runs.
        expect(made(seed, shore, z).h).toBeCloseTo(QUAY, 9);
        expect(made(seed, road, z).h).toBeCloseTo(roadGradeAt(seed, z).h, 9);
        // The hill rises at its grade: the same rise over the same run, anywhere on it.
        expect(made(seed, road + 300, z).h - made(seed, road + 100, z).h).toBeCloseTo(200 * HILL_GRADE, 9);
      }
    }
  });

  it("changes from the flats' grade to the hill's by an ease, not a crease: the slope is continuous and monotone across the highway", () => {
    let step = 0;
    for (const seed of [20261121, 1, 424242]) {
      for (const z of [-300, 0, 200]) {
        const road = roadCenterX(seed, z);
        let last = made(seed, road + HILL_FROM - 6, z).dx;
        const first = last;
        for (let u = HILL_FROM - 6; u <= HILL_TO + 6; u += 0.25) {
          const d = made(seed, road + u, z).dx;
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

  it("never exceeds a slope of 0.10 on the made ground, the highway's corridor laid over it included: streets there are walkable and drivable", () => {
    let worst = 0;
    let where = "";
    let edgeLeast = Infinity;
    let edgeGreatest = -Infinity;
    let edgeAbs = 0;
    let edgeN = 0;
    for (const seed of TEN_SEEDS) {
      const site = siteFor(seed);
      const line = shoreSplineOf(site);
      for (let z = -TOWN_Z_HALF; z <= TOWN_Z_HALF; z += 8) {
        const shore = site.anchor.x + shoreXAt(line, z - COVE_Z).v;
        const road = roadCenterX(seed, z);
        // From the water's edge to the inland edge: the bank and the outer blend are outside.
        for (let x = shore; x <= road + TOWN_INLAND; x += 3) {
          const s = elevationSampleAt(seed, x, z);
          const g = Math.hypot(s.dx, s.dz);
          if (g > worst) {
            worst = g;
            where = `seed ${seed} z ${z} s ${(x - shore).toFixed(0)} u ${(x - road).toFixed(0)}`;
          }
        }
        if (z % 40 === 0) {
          // The cut or fill where the made ground meets the coast's own at the inland edge: the plane less the coast's ground there.
          const x = road + TOWN_INLAND;
          const gap = elevationSampleAt(seed, x, z).h - coastGround(seed, x, z).ground.h;
          edgeLeast = Math.min(edgeLeast, gap);
          edgeGreatest = Math.max(edgeGreatest, gap);
          edgeAbs += Math.abs(gap);
          edgeN++;
        }
      }
    }
    process.stderr.write(`steepest slope on the made ground over ten seeds: ${worst.toFixed(3)} (${where}); at the inland edge the cut (-) or fill (+) is ${edgeLeast.toFixed(1)} to ${edgeGreatest.toFixed(1)} m, mean ${(edgeAbs / edgeN).toFixed(1)} m\n`);
    expect(worst).toBeLessThan(0.1);
    // The coast's climb is drawn out behind the town so the hill does not stand under a wall of ground: no more than this either way.
    expect(edgeLeast).toBeGreaterThan(-10);
    expect(edgeGreatest).toBeLessThan(10);
  });

  it("is the coast's own, exactly, outside the footprint and its blend", () => {
    const rnd = lcg(3);
    let checked = 0;
    for (const seed of [20261121, 1, 424242]) {
      for (let k = 0; k < 40; k++) {
        const z = (rnd() * 2 - 1) * 900;
        const f = frame(seed, z);
        const x = k % 2 === 0 ? f.road + TOWN_INLAND + EDGE + 1 + rnd() * 300 : f.at(-f.foot - 1 - rnd() * 100);
        const own = coastGround(seed, x, z);
        const got = elevationSampleAt(seed, x, z);
        expect(got).toEqual(roadCorridorOverD(seed, z, own.u, own.uDz, own.ground));
        checked++;
      }
      // Along the shore, past the footprint's far blend.
      for (const z of [TOWN_Z_HALF + EDGE + 1, -(TOWN_Z_HALF + EDGE + 1), 700, -1300]) {
        const f = frame(seed, z);
        for (const s of [20, 60, 150]) {
          const own = coastGround(seed, f.at(s), z);
          expect(elevationSampleAt(seed, f.at(s), z)).toEqual(roadCorridorOverD(seed, z, own.u, own.uDz, own.ground));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("follows the highway's grade line along the whole town: its height at the highway is the grade line's, worst case over ten seeds", () => {
    let worst = 0;
    const rows: string[] = [];
    for (const seed of TEN_SEEDS) {
      let seedWorst = 0;
      let gradeLeast = Infinity;
      let gradeGreatest = -Infinity;
      for (let z = -TOWN_Z_HALF; z <= TOWN_Z_HALF; z += 4) {
        const road = roadCenterX(seed, z);
        const { u, uDz, ground } = coastGround(seed, road, z);
        const h = townGroundD(seed, road, z, u, uDz, ground).h;
        seedWorst = Math.max(seedWorst, Math.abs(h - roadGradeAt(seed, z).h));
        const f = frame(seed, z);
        const grade = made(seed, f.at(60), z).dx;
        gradeLeast = Math.min(gradeLeast, grade);
        gradeGreatest = Math.max(gradeGreatest, grade);
      }
      worst = Math.max(worst, seedWorst);
      rows.push(`seed ${String(seed).padStart(9)}: highway grade ${roadGradeAt(seed, 0).h.toFixed(2)} m at the anchor, plane grade ${gradeLeast.toFixed(4)} to ${gradeGreatest.toFixed(4)}, mismatch at the highway ${seedWorst.toExponential(1)} m`);
    }
    expect(worst).toBeLessThan(1e-9);
    process.stderr.write(`${rows.join("\n")}\nworst mismatch with the highway's grade over ten seeds: ${worst.toExponential(2)} m\n`);
  });

  it("ends at the water's edge in a bank, from the quay down to the coast's own ground below the tide line, and not a spike", () => {
    let steepest = 0;
    let widest = 0;
    for (const seed of TEN_SEEDS) {
      const heads = coveFor(seed).heads;
      for (let z = -TOWN_Z_HALF + 8; z < TOWN_Z_HALF; z += 8) {
        // The cove's two headlands reach 100 to 150 m seaward of the waterline in a ridge 60 m across: on their
        // flanks the shore runs east and west and the coast's own ground beyond the bank is the ridge's.
        const atHeadland = heads.some((h) => Math.abs(z - h.z) < HEAD_HALF_WIDTH + 16);
        const f = frame(seed, z);
        const top = made(seed, f.at(0), z);
        const foot = made(seed, f.at(-f.foot), z);
        expect(top.h).toBeCloseTo(QUAY, 9);
        expect(foot.h).toBe(coastGround(seed, f.at(-f.foot), z).ground.h);
        widest = Math.max(widest, f.foot);
        if (!atHeadland) expect(foot.h, `seed ${seed} z ${z}`).toBeLessThan(SEA_LEVEL);
        let wet = false;
        for (let s = -f.foot; s <= 0; s += 0.1) {
          const m = made(seed, f.at(s), z);
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
