import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { roadCenterX, roadGradeAt, coastGround } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { RAIL_OFFSET, railCenterX } from "../../src/sim/town/rail.js";
import { RAIL_BENCH_HALF, RAIL_REACH, benchWeightD, railGroundD } from "../../src/sim/town/railGround.js";
import { groundWithoutRail, railSpansIn, trestleWeightAt } from "../../src/sim/town/railSpans.js";
import { townGroundD } from "../../src/sim/town/ground.js";
import { TEN_SEEDS } from "../townGround/seeds.js";

function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

describe("the railroad's bed", () => {
  it("is the highway's grade line across its bench, and flat across the track, along 6 km of coast on ten seeds", () => {
    let worst = 0;
    let across = 0;
    let n = 0;
    for (const seed of TEN_SEEDS) {
      for (let z = -3000; z < 3000; z += 23) {
        const x = railCenterX(seed, z);
        const g = roadGradeAt(seed, z);
        for (const dx of [-RAIL_BENCH_HALF + 0.05, -2, -0.5, 0, 1.3, RAIL_BENCH_HALF - 0.05]) {
          const s = elevationSampleAt(seed, x + dx, z);
          worst = Math.max(worst, Math.abs(s.h - g.h));
          across = Math.max(across, Math.abs(s.dx));
          // Along z the bench follows the grade line's own slope.
          expect(s.dz).toBeCloseTo(g.dz, 9);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-9);
    expect(across).toBeLessThan(1e-9);
  });

  it("has the exact gradient: across the bench, the banks and beyond, the gradient is the finite difference of the height", () => {
    const rnd = lcg(5);
    const H = 0.0002;
    let worst = 0;
    for (const seed of [20261121, 1, 7, 424242]) {
      for (let k = 0; k < 150; k++) {
        const z = -3000 + rnd() * 6000;
        const x = roadCenterX(seed, z) - RAIL_OFFSET + (rnd() * 2 - 1) * (RAIL_REACH + 6);
        const s = elevationSampleAt(seed, x, z);
        const fdx = (elevationSampleAt(seed, x + H, z).h - elevationSampleAt(seed, x - H, z).h) / (2 * H);
        const fdz = (elevationSampleAt(seed, x, z + H).h - elevationSampleAt(seed, x, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(s.dx - fdx), Math.abs(s.dz - fdz));
        expect(s.dx, `seed ${seed} ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeCloseTo(fdx, 4);
        expect(s.dz, `seed ${seed} ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeCloseTo(fdz, 4);
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("changes nothing farther than its reach from the line: the same object comes back", () => {
    const seed = 7;
    for (const z of [-2000, 500, 1700]) {
      const x = roadCenterX(seed, z) - RAIL_OFFSET + RAIL_REACH + 0.1;
      const c = coastGround(seed, x, z);
      const staged = townGroundD(seed, x, z, c.u, c.uDz, c.ground);
      expect(railGroundD(seed, z, c.u, c.uDz, staged)).toBe(staged);
      const x2 = roadCenterX(seed, z) - RAIL_OFFSET - RAIL_REACH - 0.1;
      const c2 = coastGround(seed, x2, z);
      const staged2 = townGroundD(seed, x2, z, c2.u, c2.uDz, c2.ground);
      expect(railGroundD(seed, z, c2.u, c2.uDz, staged2)).toBe(staged2);
    }
  });

  it("bounds the bank's slope on land that is level and a grade line within 6 m of it: under one in one", () => {
    const seed = 1;
    let steepest = 0;
    let n = 0;
    for (let z = -3000; z < 3000; z += 41) {
      const x = railCenterX(seed, z);
      const g = roadGradeAt(seed, z).h;
      for (let dx = -RAIL_REACH; dx <= RAIL_REACH; dx += 0.5) {
        const here = groundWithoutRail(seed, x + dx, z);
        const next = groundWithoutRail(seed, x + dx + 0.5, z);
        if (Math.abs(g - here.h) > 6 || Math.abs(g - next.h) > 6 || Math.abs(next.h - here.h) / 0.5 > 0.3) continue;
        steepest = Math.max(steepest, Math.abs(elevationSampleAt(seed, x + dx + 0.5, z).h - elevationSampleAt(seed, x + dx, z).h) / 0.5);
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(steepest).toBeLessThan(1);
  });
});

describe("the bed where a trestle takes it away", () => {
  it("has an exact gradient in the weight of a trestle's ramp", () => {
    const H = 1e-5;
    const rnd = lcg(9);
    for (let i = 0; i < 200; i++) {
      const u = -RAIL_OFFSET + (rnd() * 2 - 1) * (RAIL_REACH + 2);
      const uDz = (rnd() - 0.5) * 0.1;
      const m = (rnd() - 0.5) * 14;
      const mx = (rnd() - 0.5) * 0.6;
      const mz = (rnd() - 0.5) * 0.6;
      const w = (z: number): { v: number; dz: number } => {
        const t = Math.min(1, Math.max(0, (z - 100) / 10));
        const v = t * t * (3 - 2 * t);
        return { v, dz: t > 0 && t < 1 ? (6 * t * (1 - t)) / 10 : 0 };
      };
      const z0 = 100 + rnd() * 10;
      // A weight in x alone: the mismatch's own x slope is part of the function, so perturb through a linear mismatch.
      const f = (dx: number, dz: number): number => benchWeightD(u + dx, uDz, m + mx * dx + mz * dz, mx, mz, w(z0 + dz)).v;
      const g = benchWeightD(u, uDz, m, mx, mz, w(z0));
      expect(g.dx).toBeCloseTo((f(H, 0) - f(-H, 0)) / (2 * H), 5);
    }
  });

  it("is a pure lookup of the sea's gaps, the same however the coast is walked, and the natural coast has none", () => {
    const seed = 20261121;
    const a = railSpansIn(seed, -4000, 4000);
    const b = railSpansIn(seed, 1000, 1500);
    const c = railSpansIn(seed, -4000, 4000);
    expect(c).toEqual(a);
    expect(b.every((s) => a.some((t) => t.a === s.a && t.b === s.b))).toBe(true);
    expect(trestleWeightAt(seed, 0)).toEqual({ v: 0, dz: 0 });
  });
});
