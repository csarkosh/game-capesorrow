/**
 * The highway paved where it runs through the town (`highwayGeometry.ts`): the strip of the town's asphalt over the whole of its bed, from a lead
 * before the first street that meets it to a lead after the last, and the streets' pavements meeting it edge to edge.
 *
 * The two seeds are the ones the investigation of the streets and the highway used: the game's own seed and the one the token `wall-shade` makes.
 */
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { HIGHWAY_LEAD, LANE_HALF, highwayGeometry, highwayStrip, type HighwayStrip } from "../../src/game/town/highwayGeometry.js";
import { segDist } from "../../src/sim/town/geom.js";
import { RAIL_BED_HALF } from "../../src/sim/town/rail.js";
import { spurOf } from "../../src/sim/town/railSpur.js";
import { worldJunctions } from "../../src/game/town/junctionWorld.js";
import { MeshBuilder, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { ASPHALT, PAINT_WHITE, PAINT_YELLOW } from "../../src/game/town/palette.js";
import { MARK_OVER, ROADWAY_LIFT, streetGeometry } from "../../src/game/town/streetGeometry.js";
import { Surface, forgetMarks } from "../../src/game/town/surface.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { Detail, TownGround } from "../../src/game/town/townTypes.js";

const GAME_SEED = 20261121;
const SEEDS: readonly number[] = [GAME_SEED, seedFromToken("wall-shade")];
/** Worlds whose plans mark a crosswalk across the highway (the junctions of the core lie on it): neither of the two above does. */
const CROSSWALK_SEEDS: readonly number[] = [1, 7];

/** The widest crack in a pavement's tessellation the test looks across, metres. */
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

/** Whether (x, z) lies in a triangle's plan (its edges count). */
function inside(t: Tri, x: number, z: number): boolean {
  const [a, b, c] = t.p as unknown as [number[], number[], number[]];
  const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((b[2]! - c[2]!) * (x - c[0]!) + (c[0]! - b[0]!) * (z - c[2]!)) / d;
  const v = ((c[2]! - a[2]!) * (x - c[0]!) + (a[0]! - c[0]!) * (z - c[2]!)) / d;
  return u >= -1e-9 && v >= -1e-9 && 1 - u - v >= -1e-9;
}

/** The distance from (x, z) to a triangle's plan: nothing inside it. */
function distance(t: Tri, x: number, z: number): number {
  if (inside(t, x, z)) return 0;
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = t.p[k] as number[];
    const b = t.p[(k + 1) % 3] as number[];
    const ex = (b[0] as number) - (a[0] as number);
    const ez = (b[2] as number) - (a[2] as number);
    const l2 = ex * ex + ez * ez;
    const s = l2 > 0 ? Math.max(0, Math.min(1, (((x - (a[0] as number)) * ex + (z - (a[2] as number)) * ez) / l2))) : 0;
    best = Math.min(best, Math.hypot(x - ((a[0] as number) + ex * s), z - ((a[2] as number) + ez * s)));
  }
  return best;
}

/**
 * The triangles by 4 m cell of their plan boxes, and how the faces lie over a point. `covered`: a face lies over the point or within `CRACK` of it (the town's
 * own tessellation of a pavement leaves cracks of a few millimetres between its long thin triangles, where a corner of the polygon lies on a line: a gap
 * of more than a centimetre is what is looked for). `twice`: most of five points round it (the positions are float32) have two faces or more over them.
 */
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

const grounds = new Map<number, TownGround>();
function groundFor(seed: number): TownGround {
  let g = grounds.get(seed);
  if (g === undefined) {
    g = townGround(seed);
    grounds.set(seed, g);
  }
  return g;
}

/** The highway's paving and marks alone. */
function stripOf(seed: number): { g: TownGround; strip: HighwayStrip; tris: Tri[] } {
  const g = groundFor(seed);
  // A build starts with no marks laid (`townGeometry` does the same).
  forgetMarks(g);
  const b = new MeshBuilder();
  highwayGeometry(g, new Surface(g, () => b), worldJunctions(g));
  return { g, strip: highwayStrip(g) as HighwayStrip, tris: trianglesOf(b.finish()) };
}

/** The streets and the junctions with the paving, as the town builds them (the wharf is a deck, and left out as the street tests leave it). */
function streetsOf(seed: number, detail: Detail = "full"): Tri[] {
  const g = groundFor(seed);
  const only: TownGround = { ...g, plan: { ...g.plan, streets: g.plan.streets.filter((s) => s.kind !== "wharf") } };
  forgetMarks(g);
  forgetMarks(only);
  const b = new MeshBuilder();
  streetGeometry(only, () => b, () => new MeshBuilder(), detail);
  return trianglesOf(b.finish());
}

/** Whether (x, z) lies on the bed of the town's spur, which keeps its own ground where the track crosses the highway: the paving and the marks are cut off it. */
function onTrack(seed: number, x: number, z: number): boolean {
  const track = spurOf(seed)?.points ?? [];
  return track.some((p, i) => i > 0 && segDist({ x, z }, { x: (track[i - 1] as { x: number }).x, z: (track[i - 1] as { z: number }).z }, { x: p.x, z: p.z }) < RAIL_BED_HALF + 0.05);
}

/** Looks across the edge of each pavement that meets the highway (those of `only`, or all): a face of asphalt on each side of it, none missing and none twice. */
function meetings(seed: number, only?: readonly number[]): { checked: number; contacts: number } {
  const g = groundFor(seed);
  const strip = highwayStrip(g) as HighwayStrip;
  const covers = index(streetsOf(seed).filter((t) => isColour(t, ASPHALT)));
  let checked = 0;
  let contacts = 0;
  for (const c of strip.contacts) {
    if (only !== undefined && !only.includes(c.junction)) continue;
    contacts++;
    // The edge of the pavement on the highway, A to B, and the way across it toward the centre line.
    const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    const tx = (c.b[0] - c.a[0]) / len;
    const tz = (c.b[1] - c.a[1]) / len;
    const mid = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2] as const;
    let nx = -tz;
    let nz = tx;
    if (nx * (g.roadX(mid[1]) - mid[0]) < 0) {
      nx = -nx;
      nz = -nz;
    }
    for (let s = 0.3; s < len - 0.3; s += 0.25) {
      // 1.2 cm and 5 cm off the edge on each side (a gap of more than a centimetre shows in the nearer): on the paving, and on the street's pavement. One face of asphalt over each, none missing and none twice.
      for (const d of [-0.05, -0.012, 0.012, 0.05]) {
        // The pavement narrows to nothing at each end of its edge, where its curb return leaves the edge tangent to it: a metre in, it is wider than 5 cm.
        if (d === -0.05 && (s < 1 || s > len - 1)) continue;
        const x = c.a[0] + tx * s + nx * d;
        const z = c.a[1] + tz * s + nz * d;
        if (onTrack(seed, x, z)) continue;
        expect(covers(x, z), `seed ${seed} junction ${c.junction}: ${d} m across the edge, ${s.toFixed(2)} m along it, at ${x.toFixed(2)}, ${z.toFixed(2)}`).toEqual({ covered: true, twice: false });
        checked++;
      }
    }
  }
  return { checked, contacts };
}

describe("the highway's paving", () => {

  it("runs from a lead before the first street that meets the highway to a lead after the last, over the whole bed, with no hole between its ends", () => {
    for (const seed of SEEDS) {
      const { g, strip, tris } = stripOf(seed);
      const asphalt = index(tris.filter((t) => isColour(t, ASPHALT)));
      // The lead: the centre line's length from the end to the outermost meeting is HIGHWAY_LEAD (a metre's slack for the polyline the length is measured on).
      const first = Math.min(...strip.contacts.map((c) => c.a[1]));
      const last = Math.max(...strip.contacts.map((c) => c.b[1]));
      const arc = (za: number, zb: number): number => {
        let t = 0;
        for (let z = za; z < zb; z += 0.05) t += Math.hypot(g.roadX(Math.min(z + 0.05, zb)) - g.roadX(z), Math.min(z + 0.05, zb) - z);
        return t;
      };
      expect(arc(strip.start.z, first)).toBeCloseTo(HIGHWAY_LEAD, 1);
      expect(arc(last, strip.end.z)).toBeCloseTo(HIGHWAY_LEAD, 1);
      const z0 = Math.max(strip.start.left[1], strip.start.right[1]) + 0.05;
      const z1 = Math.min(strip.end.left[1], strip.end.right[1]) - 0.05;
      let samples = 0;
      for (let z = z0; z < z1; z += 0.5) {
        for (let u = -5.49; u <= 5.49; u += 0.61) {
          // Once over the bed: exactly one face of the paving there.
          const over = asphalt(g.roadX(z) + u, z);
          expect(over, `seed ${seed}: the paving at z ${z.toFixed(2)}, ${u.toFixed(2)} m from the centre line`).toEqual({ covered: true, twice: false });
          samples++;
        }
      }
      expect(samples).toBeGreaterThan(10_000);
      console.log(`seed ${seed}: the strip begins at x ${strip.start.x.toFixed(2)}, z ${strip.start.z.toFixed(2)} and ends at x ${strip.end.x.toFixed(2)}, z ${strip.end.z.toFixed(2)}; first meeting z ${first.toFixed(1)}, last z ${last.toFixed(1)}`);
      for (const c of [strip.contacts[0] as (typeof strip.contacts)[number], strip.contacts[strip.contacts.length - 1] as (typeof strip.contacts)[number]]) {
        const z = (c.a[1] + c.b[1]) / 2;
        console.log(`seed ${seed}: junction ${c.junction} on the ${c.side < 0 ? "seaward" : "inland"} side, its opening on the bed from z ${c.a[1].toFixed(1)} to ${c.b[1].toFixed(1)} (centre line at x ${g.roadX(z).toFixed(2)}, z ${z.toFixed(2)})`);
      }
    }
  });

  it("follows the ground: its faces lie a roadway's lift over it, and its marks a mark's over that", () => {
    for (const seed of SEEDS) {
      const { g, tris } = stripOf(seed);
      for (const t of tris) {
        const paint = isColour(t, PAINT_WHITE) || isColour(t, PAINT_YELLOW);
        const lift = isColour(t, ASPHALT) ? ROADWAY_LIFT : ROADWAY_LIFT + MARK_OVER;
        for (const q of t.p) {
          const over = q[1] - g.heightAt(q[0], q[2]);
          // The wear the road shares with the streets (cuts, cracks, patches, oil, manholes) lies between 1 and 5 mm over the roadway, each kind at the lift it has on a street.
          if (!paint && !isColour(t, ASPHALT)) expect(over, `seed ${seed}: wear`).toBeGreaterThan(ROADWAY_LIFT - 0.0001);
          if (!paint && !isColour(t, ASPHALT)) expect(over, `seed ${seed}: wear`).toBeLessThan(ROADWAY_LIFT + 0.005);
          else expect(over, `seed ${seed}`).toBeCloseTo(lift, 3);
        }
      }
    }
  });

  it("ends square to the highway, on a clean line across the bed from edge to edge, and nothing lies beyond it", () => {
    for (const seed of SEEDS) {
      const { g, strip, tris } = stripOf(seed);
      for (const [end, sign] of [[strip.start, 1], [strip.end, -1]] as const) {
        const along = (q: readonly number[]): number => sign * (((q[0] as number) - end.x) * end.tx + ((q[2] as number) - end.z) * end.tz);
        const corners: number[][] = [];
        for (const t of tris) {
          for (const q of t.p) {
            // Nothing past the line.
            expect(along(q), `seed ${seed}: paving beyond an end`).toBeGreaterThan(-0.001);
            if (along(q) < 0.001 && !corners.some((k) => Math.hypot((k[0] as number) - (q[0] as number), (k[2] as number) - (q[2] as number)) < 0.002)) corners.push(q);
          }
        }
        // Only the two corners lie on it (the lines of the marks end on it too, but within the bed, between the two).
        const [lo, hi] = [corners.reduce((m, q) => ((q[0] as number) < (m[0] as number) ? q : m)), corners.reduce((m, q) => ((q[0] as number) > (m[0] as number) ? q : m))] as [number[], number[]];
        const wx = (hi[0] as number) - (lo[0] as number);
        const wz = (hi[2] as number) - (lo[2] as number);
        // Square: the line across is at a right angle to the highway's direction there, and runs from one edge of the bed to the other.
        expect(Math.abs(wx * end.tx + wz * end.tz) / Math.hypot(wx, wz), `seed ${seed}`).toBeLessThan(0.001);
        expect(Math.abs((lo[0] as number) - g.roadX(lo[2] as number)), `seed ${seed}`).toBeCloseTo(ROAD_BED_HALF, 2);
        expect(Math.abs((hi[0] as number) - g.roadX(hi[2] as number)), `seed ${seed}`).toBeCloseTo(ROAD_BED_HALF, 2);
        expect(corners.every((q) => Math.abs(along(q)) < 0.001), `seed ${seed}`).toBe(true);
      }
    }
  });

  it("meets every street that ends on it: the pavement of each junction on the highway abuts the paving with no gap and no overlap", () => {
    for (const seed of SEEDS) {
      const { checked, contacts } = meetings(seed);
      expect(contacts).toBeGreaterThan(8);
      expect(checked).toBeGreaterThan(1000);
    }
  });

  it("meets the streets that the plan once shut at the highway, in the game's own world: School Street (junction 35) and the two beyond it (junction 45), each by a mouth that fills its edge, no gap and nothing drawn twice", () => {
    const g = groundFor(GAME_SEED);
    const joined = g.plan.junctions.filter((j) => j.kind === "highway" && (j.id === 35 || j.id === 45));
    expect(joined.map((j) => j.id)).toEqual([35, 45]);
    for (const j of joined) {
      // Open: a street leg that stops, and no leg closed.
      expect(j.closed, `junction ${j.id}`).toHaveLength(0);
      expect(j.legs.filter((l) => !l.engine && l.stops).length, `junction ${j.id}`).toBeGreaterThanOrEqual(1);
    }
    expect(joined.flatMap((j) => j.legs.filter((l) => !l.engine).map((l) => l.street)).sort((p, q) => p - q)).toEqual([130, 131, 144]);
    const { checked, contacts } = meetings(GAME_SEED, [35, 45]);
    // Each junction's pavement meets the edge by a stretch of its own at least (the two streets of junction 45 share one when no corner of lot is left between them).
    expect(contacts).toBeGreaterThanOrEqual(2);
    const strip = highwayStrip(g) as HighwayStrip;
    for (const id of [35, 45]) expect(strip.contacts.some((c) => c.junction === id), `junction ${id} meets the edge`).toBe(true);
    expect(checked).toBeGreaterThan(300);
  });

  it("is marked with a double yellow centre line broken across each street's roadway and a white line at each lane's edge broken across each pavement's opening, on both tiers", () => {
    for (const seed of SEEDS) {
      const { g, strip, tris } = stripOf(seed);
      const yellow = tris.filter((t) => isColour(t, PAINT_YELLOW));
      const white = tris.filter((t) => isColour(t, PAINT_WHITE));
      expect(yellow.length).toBeGreaterThan(500);
      expect(white.length).toBeGreaterThan(500);
      const middle = (t: Tri): [number, number, number] => [(t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3, 0, (t.p[0]![2] + t.p[1]![2] + t.p[2]![2]) / 3];
      for (const t of yellow) {
        const [x, , z] = middle(t);
        expect(Math.abs(x - g.roadX(z)), `seed ${seed}: a yellow line off the middle`).toBeLessThan(0.2);
        for (const [z0, z1] of strip.crossings) expect(z < z0 + 0.01 || z > z1 - 0.01, `seed ${seed}: the centre line across a street's roadway at z ${z.toFixed(2)}`).toBe(true);
      }
      const inBar = (x: number, z: number): boolean => strip.crosswalks.some((w) => z >= w.z[0] - 0.01 && z <= w.z[1] + 0.01 && Math.abs(x - g.roadX(z)) < ROAD_BED_HALF);
      for (const t of white) {
        const [x, , z] = middle(t);
        // The bars of a crosswalk across the highway are white too (below).
        if (inBar(x, z)) continue;
        const off = x - g.roadX(z);
        expect(Math.abs(Math.abs(off) - 3.5), `seed ${seed}: a white line off the lane's edge`).toBeLessThan(0.1);
        for (const c of strip.contacts) if (c.side === (off < 0 ? -1 : 1)) expect(z < c.a[1] + 0.01 || z > c.b[1] - 0.01, `seed ${seed}: the edge line across junction ${c.junction}'s opening at z ${z.toFixed(2)}`).toBe(true);
      }
      // The same on the low tier.
      const low = streetsOf(seed, "low");
      expect(low.filter((t) => isColour(t, PAINT_YELLOW)).length).toBeGreaterThan(500);
    }
  });

  it("lays a crosswalk across it wherever the plan marks one: a ladder of bars on the paving, one face over each point of each bar, in the lift of any crosswalk, with the centre line and the lane's two edge lines broken across it", () => {
    for (const seed of CROSSWALK_SEEDS) {
      const { g, strip, tris } = stripOf(seed);
      const planned = g.plan.junctions.filter((j) => j.kind === "highway").flatMap((j) => j.legs.filter((l) => l.engine && l.marked));
      expect(planned.length, `seed ${seed}: the plan marks a crosswalk across the highway`).toBeGreaterThan(0);
      expect(strip.crosswalks.length, `seed ${seed}`).toBe(planned.length);
      const white = index(tris.filter((t) => isColour(t, PAINT_WHITE)));
      let samples = 0;
      for (const w of strip.crosswalks) {
        // Bars of a ladder: 0.61 m wide, no more than 1.52 m apart, 0.3 m in from each edge of the bed, each as long as a crosswalk is wide (3.05 m).
        expect(w.bars.length).toBeGreaterThanOrEqual(5);
        for (const [k, bar] of w.bars.entries()) {
          const [a, b, c] = bar as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
          for (const q of bar) expect(Math.abs(q[0] - g.roadX(q[1])), `seed ${seed}: a bar within the bed`).toBeLessThan(ROAD_BED_HALF - 0.29);
          expect(Math.hypot(b[0] - a[0], b[1] - a[1]), `seed ${seed}: a bar's length`).toBeGreaterThan(2.9);
          expect(Math.hypot(c[0] - b[0], c[1] - b[1]), `seed ${seed}: a bar's width`).toBeCloseTo(0.61, 2);
          if (k > 0) {
            const prev = w.bars[k - 1] as readonly (readonly [number, number])[];
            const gap = Math.min(...bar.map((q) => Math.min(...prev.map((r) => Math.abs(q[0] - g.roadX(q[1]) - (r[0] - g.roadX(r[1])))))));
            expect(gap, `seed ${seed}: the gap between bars`).toBeLessThan(1.53);
          }
          // One face of white over the bar's middle and each of its quarter points, none missing and none twice (but where the spur's bed lies over it).
          for (const [fa, fb] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]] as const) {
            const p0 = bar[0] as readonly [number, number];
            const p1 = bar[1] as readonly [number, number];
            const p3 = bar[3] as readonly [number, number];
            const x = p0[0] + (p1[0] - p0[0]) * fa + (p3[0] - p0[0]) * fb;
            const z = p0[1] + (p1[1] - p0[1]) * fa + (p3[1] - p0[1]) * fb;
            if (onTrack(seed, x, z)) continue;
            expect(white(x, z), `seed ${seed} junction ${w.junction}: a crosswalk's bar at ${x.toFixed(2)}, ${z.toFixed(2)}`).toEqual({ covered: true, twice: false });
            samples++;
          }
        }
        // The lines are broken across it.
        for (const t of tris.filter((q) => isColour(q, PAINT_YELLOW))) {
          const z = (t.p[0]![2] + t.p[1]![2] + t.p[2]![2]) / 3;
          expect(z < w.z[0] + 0.01 || z > w.z[1] - 0.01, `seed ${seed}: the centre line across a crosswalk at z ${z.toFixed(2)}`).toBe(true);
        }
        const lanes = tris.filter((t) => isColour(t, PAINT_WHITE) && Math.abs(Math.abs((t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3 - g.roadX((t.p[0]![2] + t.p[1]![2] + t.p[2]![2]) / 3)) - LANE_HALF) < 0.1);
        expect(lanes.length).toBeGreaterThan(100);
        for (const t of lanes) {
          const z = (t.p[0]![2] + t.p[1]![2] + t.p[2]![2]) / 3;
          expect(z < w.z[0] + 0.01 || z > w.z[1] - 0.01, `seed ${seed}: a lane line across a crosswalk at z ${z.toFixed(2)}`).toBe(true);
        }
      }
      expect(samples).toBeGreaterThan(30);
      // The same on the low tier: the crosswalk is the strip's own, in both.
      expect(streetsOf(seed, "low").filter((t) => isColour(t, PAINT_WHITE)).length).toBeGreaterThan(100);
    }
  });
});
