/**
 * The highway outside the town's strip, in cells along the road (`highwayCells.ts`, streamed by `highwayParts.ts`), and the paving's look it shares with the strip
 * (`highwayLook.ts`): the asphalt covers the road with no gap and nothing twice at the cells' joins and where the strip hands over; a cell is the same built
 * twice, in any order; the marks lie where the rule says; nothing of a cell lies in the strip; the asphalt narrows from the bed's width to the engine's over the taper;
 * and a cell builds far beyond the plan's record.
 */
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { HIGHWAY_CELL, ROW_STEP, cellInStrip, highwayCell, highwayWorld, type HighwayLod, type HighwayWorld } from "../../src/game/town/highwayCells.js";
import { highwayGeometry } from "../../src/game/town/highwayGeometry.js";
import { DASH_ON, DASH_PERIOD, RURAL_EDGE_LINE, RURAL_HALF, SLOT, STRETCH, TAPER, nominalHalf, stretchAt, type HighwayEnv } from "../../src/game/town/highwayLook.js";
import { gpuBytes } from "../../src/game/town/highwayParts.js";
import { worldJunctions } from "../../src/game/town/junctionWorld.js";
import { MeshBuilder, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { ASPHALT, GRAVEL, PAINT_WHITE, PAINT_YELLOW } from "../../src/game/town/palette.js";
import { Surface, forgetMarks } from "../../src/game/town/surface.js";
import { townGround } from "../../src/game/town/townGeometry.js";

const GAME_SEED = 20261121;
const SEEDS: readonly number[] = [GAME_SEED, seedFromToken("wall-shade")];
const CRACK = 0.006;

type Tri = { p: [number, number, number][]; c: [number, number, number] };

function trianglesOf(a: MeshArrays): Tri[] {
  const out: Tri[] = [];
  const pos = (i: number): [number, number, number] => [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];
  for (let t = 0; t < a.indices.length; t += 3) {
    const i0 = a.indices[t] as number;
    if ((a.normals[i0 * 3 + 1] as number) < 0.9) continue;
    out.push({ p: [pos(i0), pos(a.indices[t + 1] as number), pos(a.indices[t + 2] as number)], c: [a.colors[i0 * 4] as number, a.colors[i0 * 4 + 1] as number, a.colors[i0 * 4 + 2] as number] });
  }
  return out;
}

const isColour = (t: Tri, k: readonly number[]): boolean => Math.abs(t.c[0] - (k[0] as number)) < 1e-6 && Math.abs(t.c[1] - (k[1] as number)) < 1e-6 && Math.abs(t.c[2] - (k[2] as number)) < 1e-6;

function inside(t: Tri, x: number, z: number): boolean {
  const [a, b, c] = t.p as unknown as [number[], number[], number[]];
  const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((b[2]! - c[2]!) * (x - c[0]!) + (c[0]! - b[0]!) * (z - c[2]!)) / d;
  const v = ((c[2]! - a[2]!) * (x - c[0]!) + (a[0]! - c[0]!) * (z - c[2]!)) / d;
  return u >= -1e-9 && v >= -1e-9 && 1 - u - v >= -1e-9;
}

function distance(t: Tri, x: number, z: number): number {
  if (inside(t, x, z)) return 0;
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = t.p[k] as number[];
    const b = t.p[(k + 1) % 3] as number[];
    const ex = (b[0] as number) - (a[0] as number);
    const ez = (b[2] as number) - (a[2] as number);
    const l2 = ex * ex + ez * ez;
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((x - (a[0] as number)) * ex + (z - (a[2] as number)) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ((a[0] as number) + ex * s), z - ((a[2] as number) + ez * s)));
  }
  return best;
}

/** As `highwayPaving.test.ts`: whether a face lies over a point (or within `CRACK` of it), and whether most of five points round it have two faces or more. */
function index(tris: readonly Tri[]): (x: number, z: number) => { covered: boolean; twice: boolean } {
  const cells = new Map<string, Tri[]>();
  for (const t of tris) {
    const xs = t.p.map((q) => q[0]);
    const zs = t.p.map((q) => q[2]);
    for (let ix = Math.floor(Math.min(...xs) / 4); ix <= Math.floor(Math.max(...xs) / 4); ix++) {
      for (let iz = Math.floor(Math.min(...zs) / 4); iz <= Math.floor(Math.max(...zs) / 4); iz++) {
        const k = `${ix},${iz}`;
        const list = cells.get(k);
        if (list === undefined) cells.set(k, [t]);
        else list.push(t);
      }
    }
  }
  const here = (x: number, z: number): Tri[] => cells.get(`${Math.floor(x / 4)},${Math.floor(z / 4)}`) ?? [];
  const count = (x: number, z: number): number => here(x, z).filter((t) => inside(t, x, z)).length;
  const e = 6e-5;
  return (x, z) => {
    const n = [count(x, z), count(x + e, z), count(x - e, z), count(x, z + e), count(x, z - e)];
    return { covered: n.some((k) => k >= 1) || here(x, z).some((t) => distance(t, x, z) <= CRACK), twice: n.filter((k) => k >= 2).length >= 3 };
  };
}

/** The cells k0..k1 at a level, as triangles (an empty cell has none). */
function cells(w: HighwayWorld, k0: number, k1: number, lod: HighwayLod = 0): { k: number; arrays: MeshArrays | null; tris: Tri[] }[] {
  const out = [];
  for (let k = k0; k <= k1; k++) {
    const arrays = highwayCell(w, k, lod);
    out.push({ k, arrays, tris: arrays === null ? [] : trianglesOf(arrays) });
  }
  return out;
}

/** The strip's own triangles. */
function stripTris(seed: number): Tri[] {
  const g = townGround(seed);
  forgetMarks(g);
  const b = new MeshBuilder();
  highwayGeometry(g, new Surface(g, () => b), worldJunctions(g));
  return trianglesOf(b.finish());
}

/** An env that only records nothing: for the look's pure functions (stretches, the half width). */
function bareEnv(seed: number): HighwayEnv {
  const w = highwayWorld(seed);
  return { seed, key: w.key, near: false, height: w.ground.heightAt, full: w.full, manholes: false, marks: false, centre: w.ground.roadX, stretches: new Map(), memo: { last: null, frames: new Map() }, pave: () => undefined, soft: () => undefined };
}

describe("the highway outside the town's strip", () => {
  it("is paved in stretches of 40 to 70 m whose ends are on the bed's 2 m grid, the same wherever they are asked for", () => {
    for (const seed of SEEDS) {
      const env = bareEnv(seed);
      for (const base of [-9000, -1000, 0, 3000, 12000]) {
        let z = base;
        let n = 0;
        while (n < 40) {
          const st = stretchAt(env, z);
          expect(st.z1 - st.z0, `seed ${seed} at ${z}`).toBeGreaterThanOrEqual(40);
          expect(st.z1 - st.z0, `seed ${seed} at ${z}`).toBeLessThanOrEqual(70);
          expect(Math.abs(st.z0 % 2), `seed ${seed}`).toBe(0);
          expect(stretchAt(bareEnv(seed), (st.z0 + st.z1) / 2).z0, `seed ${seed}: a fresh env gives the same stretch`).toBe(st.z0);
          z = st.z1;
          n++;
        }
      }
    }
  });

  it("covers the asphalt with no gap and nothing twice, across the cells' joins and where the strip hands over to them", () => {
    for (const seed of SEEDS) {
      const w = highwayWorld(seed);
      const g = w.ground;
      const strip = w.full as NonNullable<typeof w.full>;
      const first = Math.floor(strip[0] / HIGHWAY_CELL) - 3;
      const last = Math.floor(strip[1] / HIGHWAY_CELL) + 3;
      const all = [...stripTris(seed), ...cells(w, first, last).flatMap((c) => c.tris)];
      const asphalt = index(all.filter((t) => isColour(t, ASPHALT)));
      let samples = 0;
      // Across both ends: the strip's slanted end, the sliver of full width beside it, the taper, and the rural road, past three cells' joins each way.
      for (const [z0, z1] of [[first * HIGHWAY_CELL + 1, strip[0] + 12], [strip[1] - 12, (last + 1) * HIGHWAY_CELL - 1]] as const) {
        for (let z = z0 + 0.0123; z < z1; z += 0.37) {
          // Inside the edge by the most the ragged edge goes in (0.2 m), and by a sliver's width more.
          const half = nominalHalf(w.full, z) - 0.25;
          for (let u = -half + 0.0071; u <= half; u += 0.53) {
            const over = asphalt(g.roadX(z) + u, z);
            expect(over, `seed ${seed}: the asphalt at z ${z.toFixed(2)}, ${u.toFixed(2)} m from the centre line`).toEqual({ covered: true, twice: false });
            samples++;
          }
        }
      }
      expect(samples).toBeGreaterThan(8000);
    }
  });

  it("is the same cell built twice, and in any order", () => {
    const w = highwayWorld(GAME_SEED);
    for (const lod of [0, 1] as const) {
      const a = highwayCell(w, -12, lod) as MeshArrays;
      const other = highwayCell(w, -11, lod) as MeshArrays;
      const b = highwayCell(w, -12, lod) as MeshArrays;
      expect(other).not.toBeNull();
      expect(b.positions).toEqual(a.positions);
      expect(b.colors).toEqual(a.colors);
      expect(b.surface).toEqual(a.surface);
      expect(b.indices).toEqual(a.indices);
    }
    // A fresh world (a second machine) gives the same: the world is a pure function of the seed.
    const fresh: HighwayWorld = { ...w, ground: townGround(GAME_SEED) };
    const a = highwayCell(w, 7, 0) as MeshArrays;
    const b = highwayCell(fresh, 7, 0) as MeshArrays;
    expect(b.positions).toEqual(a.positions);
    expect(b.surface).toEqual(a.surface);
  });

  it("lays its marks where the rule says: a white line just inside each edge of the asphalt, and a yellow centre line of dashes 3 m long in every 12 m", () => {
    const w = highwayWorld(GAME_SEED);
    const g = w.ground;
    // Far from the town (the rural road all along): z from 2560 on.
    const tris = cells(w, 20, 27).flatMap((c) => c.tris);
    const white = tris.filter((t) => isColour(t, PAINT_WHITE));
    const yellow = tris.filter((t) => isColour(t, PAINT_YELLOW));
    expect(white.length).toBeGreaterThan(400);
    for (const t of white) {
      for (const q of t.p) {
        const off = Math.abs(q[0] - g.roadX(q[2]));
        expect(off, `white at z ${q[2].toFixed(1)}`).toBeGreaterThan(RURAL_EDGE_LINE - 0.07);
        expect(off, `white at z ${q[2].toFixed(1)}`).toBeLessThan(RURAL_EDGE_LINE + 0.07);
      }
    }
    // Both sides.
    expect(white.some((t) => t.p[0]![0] < g.roadX(t.p[0]![2]))).toBe(true);
    expect(white.some((t) => t.p[0]![0] > g.roadX(t.p[0]![2]))).toBe(true);
    // Yellow: on the centre line, each triangle within a dash [12 j, 12 j + 3] (a millimetre's slack).
    const starts = new Set<number>();
    for (const t of yellow) {
      for (const q of t.p) {
        expect(Math.abs(q[0] - g.roadX(q[2])), `yellow at z ${q[2].toFixed(1)}`).toBeLessThan(0.06);
        const j = Math.floor(q[2] / DASH_PERIOD + 1e-6);
        const into = q[2] - j * DASH_PERIOD;
        expect(into > DASH_ON + 0.001 && into < DASH_PERIOD - 0.001, `yellow outside a dash at z ${q[2].toFixed(2)}`).toBe(false);
        starts.add(j);
      }
    }
    // 8 cells of 128 m hold about 85 dashes; about nine in ten are kept.
    expect(starts.size).toBeGreaterThan(60);
    expect(starts.size).toBeLessThanOrEqual(Math.ceil((8 * HIGHWAY_CELL) / DASH_PERIOD) + 1);
  });

  it("leaves the town's strip to the strip: nothing of a cell lies between the strip's two end lines", () => {
    for (const seed of SEEDS) {
      const w = highwayWorld(seed);
      const start = w.start as NonNullable<typeof w.start>;
      const end = w.end as NonNullable<typeof w.end>;
      const full = w.full as NonNullable<typeof w.full>;
      const list = [...cells(w, Math.floor(full[0] / HIGHWAY_CELL) - 1, Math.floor(full[0] / HIGHWAY_CELL) + 1), ...cells(w, Math.floor(full[1] / HIGHWAY_CELL) - 1, Math.floor(full[1] / HIGHWAY_CELL) + 1)];
      let vertices = 0;
      for (const { k, arrays } of list) {
        if (arrays === null) continue;
        for (let i = 0; i < arrays.positions.length; i += 3) {
          const x = arrays.positions[i] as number;
          const z = arrays.positions[i + 2] as number;
          const before = (x - start.x) * start.tx + (z - start.z) * start.tz;
          const after = (x - end.x) * end.tx + (z - end.z) * end.tz;
          // Before the start line, or past the end line (a millimetre's slack for float32 positions).
          expect(before < 0.001 || after > -0.001, `seed ${seed} cell ${k}: a vertex in the strip at z ${z.toFixed(2)}`).toBe(true);
          vertices++;
        }
      }
      expect(vertices).toBeGreaterThan(5000);
      // A cell wholly inside the strip is not built at all.
      const inner = w.inner as NonNullable<typeof w.inner>;
      const mid = Math.floor((inner[0] + inner[1]) / 2 / HIGHWAY_CELL);
      expect(cellInStrip(w, mid)).toBe(true);
      expect(highwayCell(w, mid, 0)).toBeNull();
    }
  });

  it("narrows from the bed's width to the engine's 7 m over the taper past the strip's end, with a ragged edge and gravel to the bed's edge", () => {
    const w = highwayWorld(GAME_SEED);
    const g = w.ground;
    const full = w.full as NonNullable<typeof w.full>;
    const tris = cells(w, Math.floor(full[1] / HIGHWAY_CELL), Math.floor(full[1] / HIGHWAY_CELL) + 2).flatMap((c) => c.tris);
    const widest = (z0: number, z1: number, colour: readonly number[]): number => {
      let m = 0;
      for (const t of tris) if (isColour(t, colour)) for (const q of t.p) if (q[2] >= z0 && q[2] <= z1) m = Math.max(m, Math.abs(q[0] - g.roadX(q[2])));
      return m;
    };
    // The bed's whole width right at the end, 7 m (and the ragged edge's few centimetres) a taper further, and in between, between.
    expect(widest(full[1], full[1] + 1.5, ASPHALT)).toBeGreaterThan(ROAD_BED_HALF - 0.3);
    const mid = widest(full[1] + TAPER / 2 - 1, full[1] + TAPER / 2 + 1, ASPHALT);
    expect(mid).toBeGreaterThan(4.1);
    expect(mid).toBeLessThan(4.9);
    expect(widest(full[1] + TAPER + 0.5, full[1] + 90, ASPHALT)).toBeLessThan(RURAL_HALF + 0.25);
    expect(widest(full[1] + TAPER + 0.5, full[1] + 90, ASPHALT)).toBeGreaterThan(RURAL_HALF - 0.1);
    // The edge is ragged: its offset takes many values, over a range of a decimetre or more.
    const edges = new Set<number>();
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of tris) {
      if (!isColour(t, ASPHALT)) continue;
      for (const q of t.p) {
        if (q[2] < full[1] + TAPER + 1 || q[2] > full[1] + 120) continue;
        const off = Math.abs(q[0] - g.roadX(q[2]));
        if (off > 3.2) {
          edges.add(Math.round(off * 100));
          lo = Math.min(lo, off);
          hi = Math.max(hi, off);
        }
      }
    }
    expect(edges.size).toBeGreaterThan(10);
    expect(hi - lo).toBeGreaterThan(0.1);
    // Gravel (the shoulder) reaches the bed's edge.
    let gravel = 0;
    for (const t of tris) for (const q of t.p) if (q[2] > full[1] + TAPER + 1 && !isColour(t, ASPHALT) && Math.abs(q[0] - g.roadX(q[2])) > ROAD_BED_HALF - 0.01 && Math.abs(q[0] - g.roadX(q[2])) < ROAD_BED_HALF + 0.01) gravel++;
    expect(gravel).toBeGreaterThan(20);
  });

  it("builds a cell anywhere on the endless road, far beyond the plan's record", () => {
    const w = highwayWorld(GAME_SEED);
    for (const z of [3000, -3000, 25000, -60000]) {
      const k = Math.floor(z / HIGHWAY_CELL);
      for (const lod of [0, 1] as const) {
        const a = highwayCell(w, k, lod) as MeshArrays;
        expect(a, `z ${z}`).not.toBeNull();
        expect(a.positions.length / 3, `z ${z}`).toBeGreaterThan(lod === 0 ? 1500 : 300);
        for (let i = 0; i < a.positions.length; i++) if (!Number.isFinite(a.positions[i] as number)) throw new Error(`z ${z}: a position is not finite`);
        const g = w.ground;
        // Every vertex of the asphalt lies on the road's bed.
        for (const t of trianglesOf(a)) for (const q of t.p) expect(Math.abs(q[0] - g.roadX(q[2])), `z ${z}`).toBeLessThan(ROAD_BED_HALF + 0.05);
      }
    }
  });

  it("has the wear the streets have: patches, cuts, cracks, tracks and stains over the asphalt, none of them cut by a cell's edge, and no manholes or drains", () => {
    const w = highwayWorld(GAME_SEED);
    const k0 = 24;
    const list = cells(w, k0, k0 + 7);
    const total = list.flatMap((c) => c.tris);
    const other = total.filter((t) => !isColour(t, ASPHALT) && !isColour(t, PAINT_WHITE) && !isColour(t, PAINT_YELLOW) && !isColour(t, GRAVEL));
    // Over 1 km of the road, wear is some thousands of triangles.
    expect(other.length).toBeGreaterThan(400);
    expect(other.length).toBeLessThan(total.length);
    // A slot lies in one cell: HIGHWAY_CELL is a whole number of slots.
    expect(HIGHWAY_CELL % SLOT).toBe(0);
    expect(STRETCH).toBeGreaterThan(SLOT);
    // The sliver's width: every wear triangle's vertices lie on the asphalt (within the narrowest edge, 3.5 less its ragged 0.2), or, for a few kinds, a sliver beyond.
    const g = w.ground;
    for (const t of other) for (const q of t.p) expect(Math.abs(q[0] - g.roadX(q[2])), `wear at z ${q[2].toFixed(1)}`).toBeLessThan(RURAL_HALF + 0.25);
  });

  it("has the engine's ground level across the bed, which the cells rely on to read the height of a point of the bed once for its z", () => {
    for (const seed of [GAME_SEED, 1, 6]) {
      for (let z = -4000; z < 4000; z += 7.31) {
        const c = roadCenterX(seed, z);
        const h = elevationSampleAt(seed, c, z).h;
        for (const u of [-ROAD_BED_HALF, -2.7, 2.7, ROAD_BED_HALF]) expect(elevationSampleAt(seed, c + u, z).h, `seed ${seed} z ${z.toFixed(1)}`).toBe(h);
      }
    }
  });

  it("changes the marks' kind at the strip's end: the edge line moves in from the lane's edge to just inside the asphalt, and the double yellow gives way to dashes", () => {
    const w = highwayWorld(GAME_SEED);
    const g = w.ground;
    const full = w.full as NonNullable<typeof w.full>;
    const end = w.end as NonNullable<typeof w.end>;
    const tris = cells(w, Math.floor(full[1] / HIGHWAY_CELL), Math.floor(full[1] / HIGHWAY_CELL) + 1).flatMap((c) => c.tris);
    for (const t of tris.filter((q) => isColour(q, PAINT_WHITE))) {
      for (const q of t.p) {
        const off = Math.abs(q[0] - g.roadX(q[2]));
        expect(off).toBeGreaterThan(RURAL_EDGE_LINE - 0.07);
        // Never outside the town's lane line (3.5 m, as the strip lays it), a hair for the width.
        expect(off).toBeLessThan(3.5 + 0.07);
        // At the start of the taper the line is still the strip's (3.5); a taper further it is the rural one (3.1).
        if (q[2] < full[1] + 0.2) expect(off).toBeGreaterThan(3.5 - 0.07);
        if (q[2] > full[1] + TAPER + 0.5) expect(off).toBeLessThan(RURAL_EDGE_LINE + 0.07);
      }
    }
    // No double line past the end: a yellow vertex is within 6 cm of the centre line and in a dash (the strip's pair lies 10 cm either side, solid).
    for (const t of tris.filter((q) => isColour(q, PAINT_YELLOW))) {
      for (const q of t.p) {
        expect(Math.abs(q[0] - g.roadX(q[2]))).toBeLessThan(0.06);
        expect((q[0] - end.x) * end.tx + (q[2] - end.z) * end.tz).toBeGreaterThan(-0.001);
      }
    }
  });

  it("gives the strip in town the same look: stretches with tones and frames of their own, and the wear a street has", () => {
    for (const seed of SEEDS) {
      const g = townGround(seed);
      forgetMarks(g);
      const b = new MeshBuilder();
      highwayGeometry(g, new Surface(g, () => b), worldJunctions(g));
      const a = b.finish();
      const tris = trianglesOf(a);
      // The stretches: more than a few distinct tints on the asphalt (the tint is the surface's, at floats 4 to 6 of a vertex's record).
      const tints = new Set<string>();
      const layers = new Set<number>();
      for (let t = 0; t < a.indices.length; t += 3) {
        const i = a.indices[t] as number;
        if (Math.abs((a.colors[i * 4] as number) - ASPHALT[0]) > 1e-6 || Math.abs((a.colors[i * 4 + 1] as number) - ASPHALT[1]) > 1e-6) continue;
        layers.add(a.surface[i * 12] as number);
        tints.add([4, 5, 6].map((k) => (a.surface[i * 12 + k] as number).toFixed(3)).join(","));
      }
      expect(tints.size, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      const wear = tris.filter((t) => !isColour(t, ASPHALT) && !isColour(t, PAINT_WHITE) && !isColour(t, PAINT_YELLOW));
      expect(wear.length, `seed ${seed}`).toBeGreaterThan(300);
      // Built twice, the strip is the same.
      forgetMarks(g);
      const b2 = new MeshBuilder();
      highwayGeometry(g, new Surface(g, () => b2), worldJunctions(g));
      expect(b2.finish().positions, `seed ${seed}`).toEqual(a.positions);
    }
  });

  it("is within budget: bytes on the GPU for the cells standing at 600 m, vertices and triangles a metre, and the time of one cell", () => {
    const w = highwayWorld(GAME_SEED);
    let vertices = 0;
    let triangles = 0;
    let bytes = 0;
    for (const lod of [0, 1] as const) {
      let v = 0;
      let t = 0;
      let b = 0;
      for (let k = 30; k < 38; k++) {
        const a = highwayCell(w, k, lod) as MeshArrays;
        v += a.positions.length / 3;
        t += a.indices.length / 3;
        b += gpuBytes(a);
      }
      const m = 8 * HIGHWAY_CELL;
      console.log(`level ${lod}: ${(v / m).toFixed(1)} vertices, ${(t / m).toFixed(1)} triangles, ${(b / m).toFixed(0)} bytes a metre (rows of ${ROW_STEP[lod]} m)`);
      if (lod === 0) {
        vertices = v / m;
        triangles = t / m;
        bytes = b / m;
      }
    }
    // The cells standing at once at 600 m (full tiers): 1200 m of road, the near 400 m at level 0 and the far 800 m at level 1 (the sum is bounded by all of it at level 0).
    const standing = bytes * 1200;
    console.log(`all of 1200 m at level 0: ${(standing / 1e6).toFixed(2)} MB`);
    expect(standing).toBeLessThan(4e6);
    expect(vertices).toBeLessThan(40);
    expect(triangles).toBeLessThan(25);
  });

  it("builds a cell in under 4 ms", { tags: ["wall-clock"] }, () => {
    const w = highwayWorld(GAME_SEED);
    for (let k = 30; k < 34; k++) highwayCell(w, k, 0);
    const t0 = performance.now();
    const n = 24;
    for (let k = 40; k < 40 + n; k++) highwayCell(w, k, 0);
    const each = (performance.now() - t0) / n;
    console.log(`a near cell: ${each.toFixed(2)} ms`);
    expect(each).toBeLessThan(4);
  });
});
