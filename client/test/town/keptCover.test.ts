/**
 * The cover and the fill at the last point asked are kept, and the registers (`COVER`, `FILL`) are left exactly as the uncached bodies
 * leave them: asked twice in a row, interleaved with the other kind, other points and another plan's same coordinates, each of the three
 * numbers by `Object.is`.
 */
import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVER, coverInto, coverIntoFull } from "../../src/sim/town/cover.js";
import { FILL, fillWindowInto, fillWindowIntoFull } from "../../src/sim/town/fill.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { townReachOf } from "../../src/sim/town/clearing.js";

function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Triple = [number, number, number];
const cover = (f: typeof coverInto, plan: ReturnType<typeof planFor>, x: number, z: number, lots: boolean): Triple => {
  f(plan, x, z, lots);
  return [COVER.v, COVER.dx, COVER.dz];
};
const fill = (f: typeof fillWindowInto, areas: ReturnType<typeof planFor>["fill"], x: number, z: number): Triple => {
  f(areas, x, z);
  return [FILL.v, FILL.dx, FILL.dz];
};
const same = (a: Triple, b: Triple): boolean => Object.is(a[0], b[0]) && Object.is(a[1], b[1]) && Object.is(a[2], b[2]);

describe("the kept cover and fill leave the registers as the full bodies do", () => {
  it("in and round the town, two plans, interleaved", () => {
    const plans = [planFor(20261121), planFor(1)];
    const reaches = plans.map((p) => townReachOf(p));
    const r = stream(99);
    const bad: string[] = [];
    let said = 0;
    let withFill = 0;
    for (let i = 0; i < 6000; i++) {
      const k = i % 2;
      const plan = plans[k] as (typeof plans)[number];
      const o = plans[1 - k] as (typeof plans)[number];
      const reach = reaches[k] as (typeof reaches)[number];
      // Mostly in the reach, some just round it.
      const m = i % 5 === 0 ? 300 : 0;
      const x = reach.x0 - m + r() * (reach.x1 - reach.x0 + 2 * m);
      const z = reach.z0 - m + r() * (reach.z1 - reach.z0 + 2 * m);
      const x2 = x + 3 + r() * 40;
      const z2 = z - 3 - r() * 40;
      const check = (what: string, a: Triple, b: Triple): void => {
        if (!same(a, b) && bad.length < 12) bad.push(`${what} plan ${k} at (${x}, ${z})`);
      };
      const wantL = cover(coverIntoFull, plan, x, z, true);
      const wantN = cover(coverIntoFull, plan, x, z, false);
      const wantF = fill(fillWindowIntoFull, plan.fill, x, z);
      const wantO = cover(coverIntoFull, o, x, z, true);
      const wantOF = fill(fillWindowIntoFull, o.fill, x, z);
      const want2 = cover(coverIntoFull, plan, x2, z2, true);
      // Asked twice in a row (a miss, then a hit), the other kind between, another point, then back, then the other plan at the same point.
      check("cover lots first", cover(coverInto, plan, x, z, true), wantL);
      check("cover lots second", cover(coverInto, plan, x, z, true), wantL);
      check("cover no lots", cover(coverInto, plan, x, z, false), wantN);
      check("fill first", fill(fillWindowInto, plan.fill, x, z), wantF);
      check("cover lots after fill", cover(coverInto, plan, x, z, true), wantL);
      check("fill second", fill(fillWindowInto, plan.fill, x, z), wantF);
      check("cover other point", cover(coverInto, plan, x2, z2, true), want2);
      check("cover back (no lots kept)", cover(coverInto, plan, x, z, false), wantN);
      check("cover back (lots)", cover(coverInto, plan, x, z, true), wantL);
      check("cover other plan", cover(coverInto, o, x, z, true), wantO);
      check("cover this plan again", cover(coverInto, plan, x, z, true), wantL);
      check("fill other plan", fill(fillWindowInto, o.fill, x, z), wantOF);
      check("fill this plan again", fill(fillWindowInto, plan.fill, x, z), wantF);
      if (wantL[0] !== 0) said++;
      if (wantF[0] !== 0) withFill++;
    }
    expect(bad).toEqual([]);
    expect(said).toBeGreaterThan(1000);
    expect(withFill).toBeGreaterThan(100);
  });

  it("tells +0 from -0 in xf, zr, x and z: a kept answer is used only for the very same point", () => {
    const plans = [planFor(20261121), planFor(1)];
    const zeros: [number, number][] = [[0, 0], [-0, 0], [0, -0], [-0, -0]];
    const bad: string[] = [];
    const sign = (v: number): string => (Object.is(v, -0) ? "-0" : "+0");
    for (const plan of plans) {
      for (const first of zeros) {
        for (const second of zeros) {
          for (const lots of [true, false]) {
            for (const [x, z] of [first, second]) {
              const want = cover(coverIntoFull, plan, x, z, lots);
              if (!same(cover(coverInto, plan, x, z, lots), want)) bad.push(`cover lots ${lots} (${sign(x)}, ${sign(z)}) after (${sign(first[0])}, ${sign(first[1])})`);
            }
          }
          for (const [x, z] of [first, second]) {
            const want = fill(fillWindowIntoFull, plan.fill, x, z);
            if (!same(fill(fillWindowInto, plan.fill, x, z), want)) bad.push(`fill (${sign(x)}, ${sign(z)}) after (${sign(first[0])}, ${sign(first[1])})`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
