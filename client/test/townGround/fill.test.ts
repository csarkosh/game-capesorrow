import { describe, expect, it } from "vitest";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import "../../src/terrain.js";
import { COVE_Z, SEA_LEVEL, coastGround } from "@csarkosh/engine/sim/olympic";
import { QUAY_BANK, fillWindowD, townFillFor, type FillArea } from "../../src/sim/town/fill.js";
import { townCover } from "../../src/sim/town/clearing.js";
import { QUAY, townGroundD } from "../../src/sim/town/ground.js";
import { shoreSplineOf, shoreXAt } from "../../src/sim/town/shoreSpline.js";
import { coverD } from "../../src/sim/town/cover.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { TEN_SEEDS } from "./seeds.js";

function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** A rectangle of `length` by `width`, centred at (cx, cz) in the site's frame and turned `degrees` from +z, counter-clockwise. */
function rectangle(cx: number, cz: number, length: number, width: number, degrees: number): FillArea {
  const a = (degrees * Math.PI) / 180;
  const e1 = { x: Math.sin(a), z: Math.cos(a) };
  const e2 = { x: -Math.cos(a), z: Math.sin(a) };
  const corner = (l: number, w: number) => ({ x: cx + e1.x * l + e2.x * w, z: cz + e1.z * l + e2.z * w });
  const h = length / 2;
  const k = width / 2;
  // e2 is e1 turned a quarter turn counter-clockwise, so this order is counter-clockwise.
  return { polygon: [corner(-h, -k), corner(h, -k), corner(h, k), corner(-h, k)] };
}

/** The fill the tests lay across the cove's back: 300 m by 90 m, turned 37 degrees, its middle over the sea off the shore at the anchor. */
function coveFill(seed: number): FillArea {
  const site = siteFor(seed);
  return rectangle((site.shoreX[63] as number) - 45, 0, 300, 90, 37);
}

describe("fillWindowD", () => {
  const area = rectangle(10, -20, 300, 90, 37);
  const other = rectangle(-60, 80, 120, 60, -20);

  it("is 1 well inside an area, 0 beyond the bank, and between 0 and 1 across it", () => {
    expect(fillWindowD([area], 10, -20)).toEqual({ v: 1, dx: 0, dz: 0 });
    expect(fillWindowD([area], 400, 400)).toEqual({ v: 0, dx: 0, dz: 0 });
    expect(fillWindowD([], 10, -20)).toEqual({ v: 0, dx: 0, dz: 0 });
    // Straight out of a long side: 1 at the edge, 0 at the bank's foot.
    const a = (37 * Math.PI) / 180;
    const normal = { x: -Math.cos(a), z: Math.sin(a) };
    const edge = { x: 10 + normal.x * 45, z: -20 + normal.z * 45 };
    const at = (d: number) => fillWindowD([area], edge.x + normal.x * d, edge.z + normal.z * d).v;
    expect(at(-0.001)).toBe(1);
    expect(at(QUAY_BANK)).toBe(0);
    expect(at(QUAY_BANK / 2)).toBeCloseTo(0.5, 12);
    for (let d = 0; d < QUAY_BANK; d += 0.1) expect(at(d)).toBeGreaterThanOrEqual(at(d + 0.1));
  });

  it("has the exact gradient: 300 points over, round and beyond the areas, the finite difference", () => {
    const rnd = lcg(21);
    const H = 0.0002;
    let worst = 0;
    for (let k = 0; k < 300; k++) {
      const x = -250 + rnd() * 500;
      const z = -250 + rnd() * 500;
      const f = (px: number, pz: number) => fillWindowD(k % 2 === 0 ? [area] : [area, other], px, pz);
      const g = f(x, z);
      const fdx = (f(x + H, z).v - f(x - H, z).v) / (2 * H);
      const fdz = (f(x, z + H).v - f(x, z - H).v) / (2 * H);
      worst = Math.max(worst, Math.abs(g.dx - fdx), Math.abs(g.dz - fdz));
      expect(g.v).toBeGreaterThanOrEqual(0);
      expect(g.v).toBeLessThanOrEqual(1);
    }
    expect(worst).toBeLessThan(1e-6);
    process.stderr.write(`fill window gradient vs finite difference over 300 points: worst ${worst.toExponential(2)}\n`);
  });

  it("rounds a corner by itself and joins two areas by a smooth union that is at least either's weight", () => {
    // Over a corner the weight is the product of its two edges: lower than either alone, and still 0 to 1.
    const a = (37 * Math.PI) / 180;
    const e1 = { x: Math.sin(a), z: Math.cos(a) };
    const e2 = { x: -Math.cos(a), z: Math.sin(a) };
    const corner = { x: 10 + e1.x * 150 + e2.x * 45, z: -20 + e1.z * 150 + e2.z * 45 };
    const out = fillWindowD([area], corner.x + (e1.x + e2.x) * 2, corner.z + (e1.z + e2.z) * 2).v;
    expect(out).toBeLessThan(1);
    expect(out).toBeGreaterThan(0);
    const side = fillWindowD([area], corner.x + e2.x * 2, corner.z + e2.z * 2).v;
    expect(out).toBeLessThan(side);
    // Two overlapping areas: the union's weight is at least each one's.
    const near = rectangle(10, -20, 300, 90, 37);
    const second = rectangle(30, 0, 200, 90, 90);
    for (let k = 0; k < 50; k++) {
      const x = -150 + k * 6;
      const z = -100 + k * 3;
      const u = fillWindowD([near, second], x, z).v;
      expect(u).toBeGreaterThanOrEqual(Math.max(fillWindowD([near], x, z).v, fillWindowD([second], x, z).v) - 1e-12);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
});

/** The ground with the fill passed in, at a world point. */
function madeWith(seed: number, fill: readonly FillArea[], x: number, z: number) {
  const { u, uDz, ground } = coastGround(seed, x, z);
  return { out: townGroundD(seed, x, z, u, uDz, ground, fill), base: ground };
}

describe("the made ground with fill laid over the sea", () => {
  const SEEDS = [20261121, 1, 424242];

  it("has the exact gradient with the fill: 300 points over the fill, its bank, the shore and the plane beyond", () => {
    const rnd = lcg(33);
    const H = 0.0002;
    let worst = 0;
    for (let k = 0; k < 300; k++) {
      const seed = SEEDS[k % 3] as number;
      const site = siteFor(seed);
      const fill = [coveFill(seed)];
      const x = site.anchor.x + (site.shoreX[63] as number) - 150 + rnd() * 300;
      const z = COVE_Z - 140 + rnd() * 280;
      const sample = madeWith(seed, fill, x, z).out;
      const fdx = (madeWith(seed, fill, x + H, z).out.h - madeWith(seed, fill, x - H, z).out.h) / (2 * H);
      const fdz = (madeWith(seed, fill, x, z + H).out.h - madeWith(seed, fill, x, z - H).out.h) / (2 * H);
      worst = Math.max(worst, Math.abs(sample.dx - fdx), Math.abs(sample.dz - fdz));
    }
    expect(worst).toBeLessThan(1e-5);
    process.stderr.write(`made ground with fill, gradient vs finite difference over 300 points: worst ${worst.toExponential(2)}\n`);
  });

  it("stands at QUAY deep inside the fill where there was sea, with no step in its height", () => {
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const fill = coveFill(seed);
      const centre = { x: site.anchor.x + (site.shoreX[63] as number) - 45, z: COVE_Z };
      const { out, base } = madeWith(seed, [fill], centre.x, centre.z);
      // It was sea there, and is the quay's height now, exactly.
      expect(base.h).toBeLessThan(SEA_LEVEL);
      expect(out.h).toBeCloseTo(QUAY, 12);
      expect(out.dx).toBeCloseTo(0, 12);
      expect(out.dz).toBeCloseTo(0, 12);
      // A walk across the fill, over its edge and out into the sea: neighbours 0.25 m apart differ by the slope between them.
      let worst = 0;
      for (let x = centre.x - 200; x < centre.x + 60; x += 0.25) {
        const a = madeWith(seed, [fill], x, centre.z + 20).out;
        const b = madeWith(seed, [fill], x + 0.25, centre.z + 20).out;
        worst = Math.max(worst, Math.abs(b.h - a.h - 0.125 * (a.dx + b.dx)));
      }
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("joins the plane at the shore with no crease: the slope is continuous across the water's edge", () => {
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const shore = (z: number) => site.anchor.x + shoreXAt(shoreSplineOf(site), z).v;
      // Where the plan stands at the water's edge (elsewhere the ground is the coast's own, which this is not about).
      const stands = [-300, -240, -170, -100, -40, 0, 70, 120, 200, 300].filter((z) => coverD(planFor(seed), shore(z) + 14 - site.anchor.x, z).v === 1);
      expect(stands.length).toBeGreaterThan(1);
      for (const z of stands) {
        let last = madeWith(seed, [], shore(z) - 14, z).out.dx;
        for (let x = shore(z) - 14; x <= shore(z) + 14; x += 0.25) {
          const d = madeWith(seed, [], x, z).out.dx;
          if (x > shore(z) + 10) expect(Math.abs(d - last)).toBeLessThan(0.01);
          last = d;
        }
        // At and seaward of the edge the plane is flat at the quay's height: only the bank's weight moves the ground.
        expect(madeWith(seed, [], shore(z), z).out.h).toBeCloseTo(QUAY, 9);
      }
    }
  });

  it("leaves the coast's own ground untouched beyond the bank, and raises the cover of the forest where it stands", () => {
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const fill = coveFill(seed);
      const rnd = lcg(seed);
      let checked = 0;
      for (let k = 0; k < 300; k++) {
        const x = site.anchor.x + (site.shoreX[63] as number) - 330 + rnd() * 380;
        const z = COVE_Z - 220 + rnd() * 440;
        const { out, base } = madeWith(seed, [fill], x, z);
        const w = fillWindowD([fill], x - site.anchor.x, z - COVE_Z).v;
        // Seaward of the footprint's own bank, with no fill weight: the coast's own, the same object's values.
        const shore = site.anchor.x + shoreXAt(shoreSplineOf(site), z - COVE_Z).v;
        if (w === 0 && x < shore - 170) {
          expect(out).toEqual(base);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
      expect(townCover(seed, site.anchor.x + (site.shoreX[63] as number) - 45, COVE_Z, [fill])).toBe(1);
      // With no fill the plan's own cover (its blocks and the quay's window) is all there is: never more than with it.
      expect(townCover(seed, site.anchor.x + (site.shoreX[63] as number) - 45, COVE_Z, [])).toBeLessThanOrEqual(1);
    }
  });

  it("ends in a quay wall: the bank at the fill's edge is steep, and 6 m wide", () => {
    let steepest = 0;
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const fill = coveFill(seed);
      const a = (37 * Math.PI) / 180;
      const e2 = { x: -Math.cos(a), z: Math.sin(a) };
      const c = { x: site.anchor.x + (site.shoreX[63] as number) - 45, z: COVE_Z };
      // Out of the middle of the long side that faces the sea: the edge is 45 m off the middle, the bank beyond it.
      const edge = { x: c.x - e2.x * 45, z: c.z - e2.z * 45 };
      for (let d = 0; d <= QUAY_BANK; d += 0.05) {
        const s = madeWith(seed, [fill], edge.x - e2.x * d, edge.z - e2.z * d);
        // The slope along the way out, the gradient's component along it.
        steepest = Math.max(steepest, Math.abs(s.out.dx * -e2.x + s.out.dz * -e2.z));
        if (d === 0) expect(s.out.h).toBeCloseTo(QUAY, 6);
        if (d === QUAY_BANK) expect(s.out.h).toBe(s.base.h);
      }
    }
    // A quay wall reads as one: steeper than 1:2 at its steepest, and not a cliff.
    expect(steepest).toBeGreaterThan(0.5);
    expect(steepest).toBeLessThan(3);
    process.stderr.write(`steepest slope at the quay's edge over the bank: ${steepest.toFixed(2)} (${(Math.atan(steepest) * 180 / Math.PI).toFixed(0)} degrees)\n`);
  });
});

describe("the plan's fill in the ground", () => {
  const SEEDS = [20261121, 1, 424242];

  /** The edges of an area as unit inward normals and points, and its vertex average (inside a convex polygon). */
  function centroid(area: FillArea): { x: number; z: number } {
    const n = area.polygon.length;
    return { x: area.polygon.reduce((a, p) => a + p.x, 0) / n, z: area.polygon.reduce((a, p) => a + p.z, 0) / n };
  }

  it("hands over convex counter-clockwise areas, and the ground deep inside one stands at QUAY where the coast's own was under the sea", () => {
    let seaward = 0;
    let edgeCases = 0;
    let areas = 0;
    const rows: string[] = [];
    for (const seed of TEN_SEEDS) {
      const site = siteFor(seed);
      const fill = townFillFor(seed);
      expect(fill.length, `seed ${seed}`).toBeGreaterThan(0);
      let seedSeaward = 0;
      for (const area of fill) {
        areas++;
        const p = area.polygon;
        expect(p.length).toBeGreaterThanOrEqual(3);
        let twice = 0;
        for (let i = 0; i < p.length; i++) {
          const a = p[i] as { x: number; z: number };
          const b = p[(i + 1) % p.length] as { x: number; z: number };
          const c = p[(i + 2) % p.length] as { x: number; z: number };
          // Every turn is to the left: convex and counter-clockwise.
          expect((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), `seed ${seed}`).toBeGreaterThanOrEqual(-1e-9);
          twice += a.x * b.z - b.x * a.z;
        }
        expect(twice).toBeGreaterThan(0);
        const c = centroid(area);
        const x = site.anchor.x + c.x;
        const z = site.anchor.z + c.z;
        const base = coastGround(seed, x, z).ground.h;
        // Over the sea and seaward of the shore's spline, where the plane is flat at QUAY: a middle that is under the
        // sea by a hair but a few centimetres landward of the spline's shore (the spline is a fit through samples) is
        // left out, and counted.
        const landward = c.x - shoreXAt(shoreSplineOf(site), c.z).v >= 0;
        if (base < SEA_LEVEL && landward) edgeCases++;
        if (base < SEA_LEVEL && !landward) {
          seaward++;
          seedSeaward++;
          expect(elevationSampleAt(seed, x, z).h, `seed ${seed} at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`).toBeCloseTo(QUAY, 9);
        }
      }
      rows.push(`seed ${seed}: ${fill.length} areas, ${seedSeaward} with their middle over the sea (all at QUAY)`);
    }
    expect(seaward).toBeGreaterThan(10);
    process.stderr.write(`${rows.join("\n")}\n${areas} areas in all; ${edgeCases} middles under the sea but landward of the shore's spline left out\n`);
  });

  it("keeps the exact gradient over and round the real fill: 200 points a seed across its quads and the quay's bank", () => {
    let worst = 0;
    for (const seed of SEEDS) {
      const rnd = lcg(seed);
      const site = siteFor(seed);
      const fill = townFillFor(seed);
      const H = 0.0002;
      let n = 0;
      let bank = 0;
      while (n < 200) {
        // A point near a random area: inside it, or within the bank round it.
        const area = fill[Math.floor(rnd() * fill.length)] as FillArea;
        const a = area.polygon[Math.floor(rnd() * area.polygon.length)] as { x: number; z: number };
        const c = centroid(area);
        const t = rnd() * 1.4 - 0.2;
        const x = site.anchor.x + c.x + (a.x - c.x) * t + (rnd() - 0.5) * 6;
        const z = site.anchor.z + c.z + (a.z - c.z) * t + (rnd() - 0.5) * 6;
        const w = fillWindowD(fill, x - site.anchor.x, z - site.anchor.z).v;
        if (w > 0 && w < 1) bank++;
        const f = (px: number, pz: number) => madeWith(seed, fill, px, pz).out;
        const g = f(x, z);
        const fdx = (f(x + H, z).h - f(x - H, z).h) / (2 * H);
        const fdz = (f(x, z + H).h - f(x, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(g.dx - fdx), Math.abs(g.dz - fdz));
        n++;
      }
      expect(bank, `seed ${seed} points in the bank`).toBeGreaterThan(10);
    }
    expect(worst).toBeLessThan(1e-5);
    process.stderr.write(`real fill, gradient vs finite difference over 600 points: worst ${worst.toExponential(2)}\n`);
  });

  it("has no step in height where neighbouring quads meet: across every edge of every area, 0.25 m apart", () => {
    let worst = 0;
    let edges = 0;
    let shared = 0;
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const fill = townFillFor(seed);
      for (const area of fill) {
        const p = area.polygon;
        for (let i = 0; i < p.length; i++) {
          const a = p[i] as { x: number; z: number };
          const b = p[(i + 1) % p.length] as { x: number; z: number };
          const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
          const nx = -(b.z - a.z) / len;
          const nz = (b.x - a.x) / len;
          for (const along of [0.25, 0.5, 0.75]) {
            const ex = a.x + (b.x - a.x) * along;
            const ez = a.z + (b.z - a.z) * along;
            edges++;
            // Is another area on the far side of this edge: a shared edge.
            if (fillWindowD(fill, ex - nx * 0.5, ez - nz * 0.5).v === 1 && area.polygon.length > 0) shared++;
            let last = madeWith(seed, fill, site.anchor.x + ex + nx * -2, site.anchor.z + ez + nz * -2).out;
            for (let d = -1.75; d <= 2; d += 0.25) {
              const cur = madeWith(seed, fill, site.anchor.x + ex + nx * d, site.anchor.z + ez + nz * d).out;
              // The normal's slope between the two points, as the gradient gives it.
              const slope = 0.5 * ((last.dx + cur.dx) * nx + (last.dz + cur.dz) * nz);
              worst = Math.max(worst, Math.abs(cur.h - last.h - 0.25 * slope));
              last = cur;
            }
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.02);
    process.stderr.write(`fill edges crossed ${edges} (${shared} with fill on the far side too): largest step beyond the slope between points 0.25 m apart ${(worst * 100).toFixed(2)} cm\n`);
  });

  it("is nearly flat on top: the steepest slope over the fill, away from its quay's bank, and any dip between neighbouring quads", () => {
    const rows: string[] = [];
    let steepestAll = 0;
    let dipAll = 0;
    for (const seed of TEN_SEEDS) {
      const site = siteFor(seed);
      const fill = townFillFor(seed);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const a of fill) {
        for (const p of a.polygon) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
        }
      }
      let steepest = 0;
      let dip = 0;
      for (let z = minZ; z <= maxZ; z += 1) {
        // Along x: where the fill's window is 1 the ground is the plane; a stretch of less than 1 between two such
        // points less than 40 m apart is a seam between quads, and its lowest height below QUAY is a dip.
        let lastIn = Number.NaN;
        let low = Infinity;
        for (let x = minX; x <= maxX; x += 0.5) {
          const w = fillWindowD(fill, x, z).v;
          const s = elevationSampleAt(seed, site.anchor.x + x, site.anchor.z + z);
          if (w === 1) {
            steepest = Math.max(steepest, Math.hypot(s.dx, s.dz));
            if (!Number.isNaN(lastIn) && x - lastIn > 0.5 && x - lastIn < 40) dip = Math.max(dip, QUAY - low);
            lastIn = x;
            low = Infinity;
          } else if (!Number.isNaN(lastIn)) low = Math.min(low, s.h);
        }
      }
      steepestAll = Math.max(steepestAll, steepest);
      dipAll = Math.max(dipAll, dip);
      rows.push(`seed ${seed}: steepest slope on the fill ${steepest.toFixed(3)}, deepest dip between quads ${dip.toFixed(2)} m`);
    }
    process.stderr.write(`${rows.join("\n")}\n`);
    // The bay is the seed's: where a shelf stands under the mountain the highway's grade line is higher over the cove, and the flats' plane climbs to it (up to about 14 percent) where the fill meets the shore.
    expect(steepestAll).toBeLessThan(0.2);
    expect(dipAll).toBeLessThan(0.25);
  });

  it("ends in a bank at its quay: between the coast's own ground and the quay's height, with a slope that reads as a wall", () => {
    let steepest = 0;
    let points = 0;
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const fill = townFillFor(seed);
      const rnd = lcg(seed + 1);
      for (let k = 0; k < 4000; k++) {
        const area = fill[Math.floor(rnd() * fill.length)] as FillArea;
        const c = centroid(area);
        const p = area.polygon[Math.floor(rnd() * area.polygon.length)] as { x: number; z: number };
        const x = c.x + (p.x - c.x) * (1 + rnd() * 0.3);
        const z = c.z + (p.z - c.z) * (1 + rnd() * 0.3);
        const w = fillWindowD(fill, x, z).v;
        if (!(w > 0 && w < 1)) continue;
        points++;
        const { out } = madeWith(seed, fill, site.anchor.x + x, site.anchor.z + z);
        steepest = Math.max(steepest, Math.hypot(out.dx, out.dz));
      }
    }
    expect(points).toBeGreaterThan(1000);
    expect(steepest).toBeLessThan(3);
    process.stderr.write(`steepest slope in the real quays' banks: ${steepest.toFixed(2)} over ${points} points\n`);
  });
});
