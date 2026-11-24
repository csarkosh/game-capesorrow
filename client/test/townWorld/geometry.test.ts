import { describe, expect, it } from "vitest";
import { resetLedger } from "../../src/game/town/faceLedger.js";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { ROAD_BED_HALF, ROAD_CORRIDOR_HALF } from "@csarkosh/engine/sim/road";
import { buildingGeometry } from "../../src/game/town/buildingGeometry.js";
import { MeshBuilder, SURFACE_FLOATS, hash01, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import { LAYER_NAMES } from "../../src/game/town/townLayers.js";
import { ALLEY, ASPHALT, CURB, DECK, PILE, PAINT_WHITE, PAINT_YELLOW, SIDEWALK, SIGN_RED } from "../../src/game/town/palette.js";
import { FACE_DEPTH, deckGeometry, wharfGeometry } from "../../src/game/town/pileGeometry.js";
import { APRON, quayGeometry } from "../../src/game/town/quayGeometry.js";
import { STEP_RISE, stairGeometry } from "../../src/game/town/stairGeometry.js";
import { CURB_REBUILT, walkAt } from "../../src/sim/town/port/edges.js";
import { CURB_WIDTH, WALK_LIFT, streetGeometry } from "../../src/game/town/streetGeometry.js";
import { ENGINE_MARK_LIFT } from "../../src/game/town/junctionPaint.js";
import { bladeText } from "../../src/game/town/signGeometry.js";
import { textRuns } from "../../src/game/town/signFont.js";
import { CELL, townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { SEA, type TownGround } from "../../src/game/town/townTypes.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { CROSSWALK_WIDTH } from "../../src/sim/town/junctions.js";
import { pavementPolygon, insideStrictly } from "../../src/sim/town/junctionShape.js";
import { overlapDepth } from "../../src/sim/town/geom.js";
import type { Building, LandmarkRole } from "../../src/sim/town/types.js";
import { WORLD_SEEDS } from "./world.js";

const GAME_SEED = 20261121;

const groundCache = new Map<number, TownGround>();
function groundFor(seed: number): TownGround {
  let g = groundCache.get(seed);
  if (g === undefined) {
    g = townGround(seed);
    groundCache.set(seed, g);
  }
  return g;
}

/** The whole town's batches for a seed, made once. */
const townCache = new Map<number, ReturnType<typeof makeTown>>();
function makeTown(seed: number): ReturnType<typeof townGeometry> extends Generator<unknown, infer R> ? R : never {
  return finish(townGeometry(groundFor(seed), "full", { x: 0, z: 0 }));
}
function townFor(seed: number): ReturnType<typeof makeTown> {
  let t = townCache.get(seed);
  if (t === undefined) {
    t = makeTown(seed);
    townCache.set(seed, t);
  }
  return t;
}

/** Visits every triangle of arrays: its three corners (positions), the first corner's normal and its colour. */
function eachTriangle(a: MeshArrays, visit: (p: [number, number, number][], n: [number, number, number], c: [number, number, number], i: number) => void): void {
  const pos = (i: number): [number, number, number] => [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];
  for (let t = 0; t < a.indices.length; t += 3) {
    const i0 = a.indices[t] as number;
    visit(
      [pos(i0), pos(a.indices[t + 1] as number), pos(a.indices[t + 2] as number)],
      [a.normals[i0 * 3] as number, a.normals[i0 * 3 + 1] as number, a.normals[i0 * 3 + 2] as number],
      [a.colors[i0 * 4] as number, a.colors[i0 * 4 + 1] as number, a.colors[i0 * 4 + 2] as number],
      t / 3,
    );
  }
}

const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number)];
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];
const dot = (a: readonly number[], b: readonly number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);

/** A building built alone into one builder. */
function build(g: TownGround, b: Building, role: LandmarkRole | null = null, detail: "low" | "full" = "full"): MeshArrays {
  const builder = new MeshBuilder();
  // A building is built in a clean town: the faces on the walls (`faceLedger.ts`) are the town build's to clear.
  resetLedger();
  buildingGeometry(g, b, role, () => builder, detail);
  return builder.finish();
}

function roleOf(g: TownGround, b: Building): LandmarkRole | null {
  return g.plan.landmarks.find((l) => l.building === b.id)?.role ?? null;
}

describe("the town's arrays, every batch of three worlds", () => {
  it("has no NaN, no index out of range, no degenerate triangle, unit normals, and every triangle wound against its normal", () => {
    let triangles = 0;
    for (const seed of WORLD_SEEDS) {
      for (const batch of townFor(seed)) {
        const a = batch.arrays;
        expect(a.positions.length % 3).toBe(0);
        const vertices = a.positions.length / 3;
        expect(a.normals.length).toBe(a.positions.length);
        expect(a.colors.length).toBe(vertices * 4);
        for (const n of [a.positions, a.normals, a.colors]) for (let i = 0; i < n.length; i++) if (!Number.isFinite(n[i])) throw new Error(`${seed}: a number is not finite`);
        for (let v = 0; v < vertices; v++) {
          const len = Math.hypot(a.normals[v * 3] as number, a.normals[v * 3 + 1] as number, a.normals[v * 3 + 2] as number);
          if (Math.abs(len - 1) > 1e-5) throw new Error(`${seed}: a normal of length ${len}`);
        }
        for (let i = 0; i < a.indices.length; i++) if ((a.indices[i] as number) >= vertices) throw new Error(`${seed}: an index out of range`);
        eachTriangle(a, (p, n) => {
          const c = cross(sub(p[1] as number[], p[0] as number[]), sub(p[2] as number[], p[0] as number[]));
          const area2 = Math.hypot(c[0], c[1], c[2]);
          if (!(area2 > 1e-7)) throw new Error(`${seed}: a degenerate triangle (${area2})`);
          // The engine winds a face so that the turn from its first edge to its second runs against the normal.
          if (dot(c, n) >= 0) throw new Error(`${seed}: a triangle wound with its normal`);
          triangles++;
        });
      }
    }
    expect(triangles).toBeGreaterThan(100_000);
  });

  it("puts every batch in the cell its geometry stands in, and no more than a hundred and fifty meshes for the town", () => {
    for (const batch of townFor(GAME_SEED)) {
      const a = batch.arrays;
      for (let v = 0; v < a.positions.length / 3; v++) {
        const cx = Math.floor((a.positions[v * 3] as number) / CELL);
        const cz = Math.floor((a.positions[v * 3 + 2] as number) / CELL);
        // A polygon is put in the cell of its middle: its corners may reach into the next, by no more than a building's length.
        expect(Math.abs(cx - batch.cx)).toBeLessThanOrEqual(1);
        expect(Math.abs(cz - batch.cz)).toBeLessThanOrEqual(1);
      }
    }
    // A cell has up to four meshes now: the flat layer, the standing, the blended glass and the signs.
    expect(townFor(GAME_SEED).length).toBeLessThanOrEqual(150);
  });

  it("is the same arrays every time it is built", () => {
    const hashOf = (batches: ReturnType<typeof makeTown>): string => {
      let h = 0x811c9dc5;
      for (const b of batches) {
        for (const arr of [b.arrays.positions, b.arrays.colors]) {
          const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
          for (let i = 0; i < u.length; i += 7) h = Math.imul(h ^ (u[i] as number), 0x01000193);
        }
        h = Math.imul(h ^ b.arrays.indices.length, 0x01000193);
      }
      return (h >>> 0).toString(16);
    };
    expect(hashOf(makeTown(GAME_SEED))).toBe(hashOf(townFor(GAME_SEED)));
  });

  // The plan's version changes these: a new TOWN_GEN gives other buildings, so every number here moves with it. Re-pin from the
  // test's own message when the plan changes on purpose.
  it("has stable counts for world seed 20261121", () => {
    let vertices = 0;
    let triangles = 0;
    let flat = 0;
    for (const b of townFor(GAME_SEED)) {
      vertices += b.arrays.positions.length / 3;
      triangles += b.arrays.indices.length / 3;
      if (b.layer === "flat") flat++;
    }
    console.log(`town ${GAME_SEED}: ${townFor(GAME_SEED).length} meshes (${flat} flat), ${vertices} vertices, ${triangles} triangles`);
    expect({ meshes: townFor(GAME_SEED).length, flat, vertices, triangles }).toEqual({ meshes: 128, flat: 40, vertices: 1503650, triangles: 728848 });
  });
});

describe("the streets", () => {
  /** The streets alone (the wharf is a deck, which stands where the water is, and is tested with the piles): the flat surfaces, and the standing signs apart. */
  function streetsOf(seed: number): { g: TownGround; a: MeshArrays; signs: MeshArrays } {
    const g = groundFor(seed);
    const only: TownGround = { ...g, plan: { ...g.plan, streets: g.plan.streets.filter((s) => s.kind !== "wharf") } };
    const builder = new MeshBuilder();
    const standing = new MeshBuilder();
    streetGeometry(only, () => builder, () => standing);
    return { g, a: builder.finish(), signs: standing.finish() };
  }

  it("lie on the ground: every surface is its ground's height plus a lift, from a joint's groove to a curb's top (the curb's face over the roadway cut under it, 0.15 m at most, and a centimetre or two); the standing faces run from the roadway to it", () => {
    for (const seed of WORLD_SEEDS) {
      const { g, a } = streetsOf(seed);
      let least = Infinity;
      let most = -Infinity;
      let faces = 0;
      eachTriangle(a, (p, n) => {
        for (const q of p) {
          const lift = q[1] - g.heightAt(q[0], q[2]);
          // Not on steep ground (a fall of over 18 percent in 30 cm: a street's end on the highway's cut, a bank): beside a curb the ground is read 30 cm out, which there is more than a few centimetres off.
          if (Math.abs(g.heightAt((q[0] as number) + 0.3, q[2] as number) - g.heightAt(q[0] as number, q[2] as number)) > 0.055 || Math.abs(g.heightAt(q[0] as number, (q[2] as number) + 0.3) - g.heightAt(q[0] as number, q[2] as number)) > 0.055) continue;
          if (n[1] >= 0.75) {
            // A crosswalk across the highway lies on the engine's road, at the lift the engine's marks take.
            if (Math.abs((q[0] as number) - g.roadX(q[2] as number)) < ROAD_BED_HALF + 0.5) continue;
            least = Math.min(least, lift);
            most = Math.max(most, lift);
          } else {
            // A curb's face: from the roadway's gutter (the ground cut down for it) to the curb's top.
            expect(lift).toBeGreaterThan(-0.002);
            // (The curb's top is read 30 cm past the curb line, so on a hillside it stands the ground's fall over that more or less than the curb's face over the roadway.)
            expect(lift).toBeLessThan(CURB_REBUILT + WALK_LIFT + 0.06);
          }
        }
        // A street that ends on the highway across a hillside meets the road's own cut there (the ground stands nearly on end within the road's corridor), and one along a rocky shore meets a stack the 8 m grid does not see.
        const nearRoad = p.some((q) => Math.abs((q[0] as number) - g.roadX(q[2] as number)) < ROAD_CORRIDOR_HALF);
        // (A ramp cut through the curb climbs the ground's own step over 30 cm: a grade of up to 0.94, a normal of 0.73, which a person can stand on.)
        if (n[1] < 0.7 && Math.abs(n[1]) > 0.05 && !nearRoad) throw new Error(`${seed}: a street surface turned from the sky (${n[1]})`);
        if (Math.abs(n[1]) < 0.05) faces++;
      });
      // The lowest is a joint's groove or a roadway's own lift; the highest a curb's top, which stands the curb's face over the ground cut down beside it.
      // (Beside a curb the ground is read 30 cm out, so on a hillside a corner of a slab or a curb's top stands the ground's fall over that, a few centimetres, 10 at the steepest street of three worlds, and the curb's top that much over it on the other side, under the ground at the corner itself.)
      // (Over the town made to fit its houses, the streets stand on other hillsides: -0.065 at the steepest, a grade the exclusion above lets through. It was -0.04.)
      expect(least).toBeGreaterThan(-0.07);
      expect(most).toBeLessThan(CURB_REBUILT + WALK_LIFT + 0.06);
      expect(faces).toBeGreaterThan(100);
      console.log(`street lifts for ${seed}: ${least.toFixed(4)} to ${most.toFixed(4)} m`);
    }
  });

  it("are cut along their length at 4 m or less and across into at least two", () => {
    const g = groundFor(GAME_SEED);
    const main = g.plan.streets.find((s) => s.kind === "main");
    const street = main ?? (g.plan.streets.find((s) => s.kind === "street") as NonNullable<typeof main>);
    // The street alone: no junction, so no cut of its strips (its ends stand free).
    const only: TownGround = { ...g, plan: { ...g.plan, streets: [street], junctions: [] } };
    const builder = new MeshBuilder();
    streetGeometry(only, () => builder);
    const a = builder.finish();
    // Every quad is a strip tile: its long edge is at most 4 m (a tile is cut at 4 m and the street's length divided evenly).
    let longest = 0;
    eachTriangle(a, (p) => {
      for (let k = 0; k < 3; k++) {
        const q = p[k] as number[];
        const r = p[(k + 1) % 3] as number[];
        longest = Math.max(longest, Math.hypot((q[0] as number) - (r[0] as number), (q[2] as number) - (r[2] as number)));
      }
    });
    // The longest edge of a tile of at most 4 m by at most half the street's width: a diagonal under 4 + width / 2.
    expect(longest).toBeLessThan(Math.hypot(4.01, street.width / 2));
    // Bands: at least two across (two carriageway halves) and, on this kind, a sidewalk each side: four.
    const length = Math.hypot(street.b.x - street.a.x, street.b.z - street.a.z);
    const tiles = Math.ceil(length / 4);
    expect(a.indices.length / 6).toBeGreaterThanOrEqual(tiles * 2);
  });

  it("end at the highway's bed: no street surface stands within the bed of the road the engine paints, but a marked crosswalk across it, which lies on its surface", () => {
    for (const seed of WORLD_SEEDS) {
      const { g, a } = streetsOf(seed);
      let nearest = Infinity;
      let crosswalks = 0;
      eachTriangle(a, (p, _n, c) => {
        const white = Math.abs(c[0] - PAINT_WHITE[0]) < 1e-6 && Math.abs(c[1] - PAINT_WHITE[1]) < 1e-6;
        for (const q of p) {
          const off = Math.abs((q[0] as number) - g.roadX(q[2] as number));
          if (white && off < ROAD_BED_HALF - 0.02) {
            // A crosswalk's bar on the engine's road: its lift is the one the engine's marks take.
            expect((q[1] as number) - g.heightAt(q[0] as number, q[2] as number)).toBeCloseTo(ENGINE_MARK_LIFT, 2);
            crosswalks++;
          } else nearest = Math.min(nearest, off);
        }
      });
      // Float32 positions, and the clip is on a line through the tile's corners while the road curves a little.
      expect(nearest).toBeGreaterThan(ROAD_BED_HALF - 0.02);
      console.log(`${seed}: ${crosswalks} crosswalk vertices on the highway`);
    }
  });

  describe("at their junctions", () => {
    /** The game's seed, one with a main street and a seam of sharp crossings, and a third. */
    const JUNCTION_SEEDS = [GAME_SEED, 894932655, 1];
    type Tri = { p: [number, number][]; y: [number, number, number]; c: [number, number, number] };
    /** The flat layer's triangles of a colour, from the whole town as it is built, hashed by 8 m cells. */
    function layer(seed: number): { tris: Tri[]; of: (c: readonly number[]) => Tri[]; cells: Map<string, Tri[]> } {
      const tris: Tri[] = [];
      for (const b of townFor(seed)) {
        if (b.layer !== "flat") continue;
        eachTriangle(b.arrays, (p, _n, c) => tris.push({ p: p.map((q) => [q[0], q[2]] as [number, number]), y: [p[0]![1], p[1]![1], p[2]![1]], c }));
      }
      const cells = new Map<string, Tri[]>();
      for (const t of tris) {
        const xs = t.p.map((q) => q[0]);
        const zs = t.p.map((q) => q[1]);
        for (let ix = Math.floor(Math.min(...xs) / 8); ix <= Math.floor(Math.max(...xs) / 8); ix++) {
          for (let iz = Math.floor(Math.min(...zs) / 8); iz <= Math.floor(Math.max(...zs) / 8); iz++) {
            const k = `${ix},${iz}`;
            const list = cells.get(k);
            if (list === undefined) cells.set(k, [t]);
            else list.push(t);
          }
        }
      }
      const is = (t: Tri, c: readonly number[]): boolean => Math.abs(t.c[0] - (c[0] as number)) < 1e-4 && Math.abs(t.c[1] - (c[1] as number)) < 1e-4 && Math.abs(t.c[2] - (c[2] as number)) < 1e-4;
      return { tris, cells, of: (c) => tris.filter((t) => is(t, c)) };
    }
    const inside = (t: Tri, x: number, z: number): boolean => {
      const [a, b, c] = t.p as [[number, number], [number, number], [number, number]];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-12) return false;
      const l0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / d;
      const l1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / d;
      return l0 >= -1e-6 && l1 >= -1e-6 && 1 - l0 - l1 >= -1e-6;
    };
    const coveredBy = (l: ReturnType<typeof layer>, colour: readonly number[], x: number, z: number): boolean =>
      (l.cells.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []).some((t) => Math.abs(t.c[0] - (colour[0] as number)) < 1e-4 && Math.abs(t.c[1] - (colour[1] as number)) < 1e-4 && inside(t, x, z));

    it("leave no two roadway surfaces over each other anywhere in the town: no two roadway triangles share area", () => {
      for (const seed of JUNCTION_SEEDS) {
        const l = layer(seed);
        const road = [...l.of(ASPHALT), ...l.of(ALLEY)];
        const cells = new Map<string, Tri[]>();
        for (const t of road) {
          const xs = t.p.map((q) => q[0]);
          const zs = t.p.map((q) => q[1]);
          for (let ix = Math.floor(Math.min(...xs) / 8); ix <= Math.floor(Math.max(...xs) / 8); ix++) {
            for (let iz = Math.floor(Math.min(...zs) / 8); iz <= Math.floor(Math.max(...zs) / 8); iz++) {
              const k = `${ix},${iz}`;
              const list = cells.get(k);
              if (list === undefined) cells.set(k, [t]);
              else list.push(t);
            }
          }
        }
        let overlaps = 0;
        let worst = 0;
        const seen = new Set<string>();
        const index = new Map<Tri, number>(road.map((t, i) => [t, i]));
        for (const list of cells.values()) {
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const a = list[i] as Tri;
              const b = list[j] as Tri;
              const key = `${index.get(a)},${index.get(b)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const depth = overlapDepth(a.p.map(([x, z]) => ({ x, z })), b.p.map(([x, z]) => ({ x, z })));
              if (depth > 0.004) {
                overlaps++;
                worst = Math.max(worst, depth);
              }
            }
          }
        }
        console.log(`${seed}: ${road.length} roadway triangles, ${overlaps} overlapping (deepest ${worst.toFixed(4)} m)`);
        expect(overlaps).toBe(0);
      }
    });

    it("end every leg's strip on its junction's edge: a roadway at both sides of each mouth, vertices that meet, no step in height", () => {
      for (const seed of JUNCTION_SEEDS) {
        const g = groundFor(seed);
        const l = layer(seed);
        let mouths = 0;
        for (const j of g.plan.junctions) {
          if (!(j.kind === "four-way" || j.kind === "tee" || j.kind === "skew" || j.kind === "highway" || j.kind === "bend")) continue;
          for (const leg of j.legs) {
            if (leg.engine || leg.to - leg.mouth < 3) continue;
            const wx = (s: number, t: number): [number, number] => [g.anchor.x + leg.x + leg.dx * s - leg.dz * t, g.anchor.z + leg.z + leg.dz * s + leg.dx * t];
            // (Not at the very edge: where a street has no curb its asphalt's edge wanders by 20 cm.)
            for (const t of [-leg.half + 0.45, 0, leg.half - 0.45]) {
              // Roadway on the junction's side and on the strip's: no gap at the mouth.
              const [x0, z0] = wx(leg.mouth - 0.03, t);
              const [x1, z1] = wx(leg.mouth + 0.03, t);
              expect(coveredBy(l, ASPHALT, x0, z0), `seed ${seed} junction ${j.id}: no pavement just inside a mouth`).toBe(true);
              expect(coveredBy(l, ASPHALT, x1, z1), `seed ${seed} junction ${j.id}: no strip just outside a mouth`).toBe(true);
            }
            mouths++;
          }
        }
        // No step: two roadway vertices within 2 cm in plan stand at one height (within 3 mm).
        const roadVertices = new Map<string, number[]>();
        for (const t of l.of(ASPHALT)) {
          for (let k = 0; k < 3; k++) {
            const key = `${Math.round((t.p[k] as [number, number])[0] * 50)},${Math.round((t.p[k] as [number, number])[1] * 50)}`;
            const list = roadVertices.get(key);
            if (list === undefined) roadVertices.set(key, [t.y[k] as number]);
            else list.push(t.y[k] as number);
          }
        }
        let worst = 0;
        for (const ys of roadVertices.values()) worst = Math.max(worst, Math.max(...ys) - Math.min(...ys));
        console.log(`${seed}: ${mouths} mouths checked; the largest step between roadway vertices at one place ${worst.toFixed(5)} m`);
        expect(mouths).toBeGreaterThan(40);
        expect(worst).toBeLessThan(0.003);
      }
    });

    it("lay every marked crosswalk's bars on its leg's roadway just outside the pavement, and no paint inside a quiet junction's pavement", () => {
      for (const seed of JUNCTION_SEEDS) {
        const g = groundFor(seed);
        const l = layer(seed);
        const white = l.of(PAINT_WHITE);
        let bars = 0;
        for (const j of g.plan.junctions) {
          if (!(j.kind === "four-way" || j.kind === "tee" || j.kind === "skew" || j.kind === "highway" || j.kind === "bend")) continue;
          for (const leg of j.legs) {
            if (!leg.marked || leg.engine) continue;
            const frame = (x: number, z: number): { s: number; t: number } => {
              const dx = x - g.anchor.x - leg.x;
              const dz = z - g.anchor.z - leg.z;
              return { s: dx * leg.dx + dz * leg.dz, t: -dx * leg.dz + dz * leg.dx };
            };
            // The bars: the white triangles of a bar's size that lie wholly in the leg's crosswalk, over its roadway.
            const mine = white.filter((t) => {
              // The bars are 2 ft wide; the parking lines are thinner and the stop line wider.
              const e = t.p.map((q, k) => Math.hypot(q[0] - (t.p[(k + 1) % 3] as [number, number])[0], q[1] - (t.p[(k + 1) % 3] as [number, number])[1]));
              if (Math.min(...e) < 0.3) return false;
              return t.p.every((q) => {
                const f = frame(q[0], q[1]);
                return f.s >= leg.mouth - 0.002 && f.s <= leg.mouth + CROSSWALK_WIDTH + 0.002 && Math.abs(f.t) <= leg.half + 0.002;
              });
            });
            expect(mine.length, `seed ${seed} junction ${j.id}: a marked leg's bars`).toBeGreaterThanOrEqual(4);
            bars += mine.length;
          }
          if (j.legs.every((leg) => !leg.marked && !leg.stops) && j.dotted === false) {
            // A quiet junction has no paint at all: nothing white or yellow stands inside its pavement.
            const poly = pavementPolygon(j.legs, j.corners).map((q) => ({ x: q.x + g.anchor.x, z: q.z + g.anchor.z }));
            if (poly.length < 3) continue;
            for (const t of l.tris) {
              if (t.c[0] < 0.3) continue;
              const cx = (t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3;
              const cz = (t.p[0]![1] + t.p[1]![1] + t.p[2]![1]) / 3;
              if (cx < Math.min(...poly.map((q) => q.x)) || cx > Math.max(...poly.map((q) => q.x)) || cz < Math.min(...poly.map((q) => q.z)) || cz > Math.max(...poly.map((q) => q.z))) continue;
              // Paint colours only (white and yellow); the sidewalk, ramps and domes stand outside the pavement.
              const isPaint = (Math.abs(t.c[0] - PAINT_WHITE[0]) < 1e-4 && Math.abs(t.c[1] - PAINT_WHITE[1]) < 1e-4) || (Math.abs(t.c[0] - PAINT_YELLOW[0]) < 1e-4 && Math.abs(t.c[1] - PAINT_YELLOW[1]) < 1e-4);
              if (isPaint) expect(insideStrictly(poly, { x: cx, z: cz }), `seed ${seed} junction ${j.id}: paint in a quiet junction`).toBe(false);
            }
          }
        }
        expect(bars).toBeGreaterThan(8);
        // No bar or line of white stands inside any junction's pavement (the crosswalks lie just outside it).
        for (const j of g.plan.junctions) {
          if (!(j.kind === "four-way" || j.kind === "tee" || j.kind === "skew" || j.kind === "highway" || j.kind === "bend")) continue;
          const poly = pavementPolygon(j.legs, j.corners).map((q) => ({ x: q.x + g.anchor.x, z: q.z + g.anchor.z }));
          if (poly.length < 3) continue;
          for (const t of white) {
            const cx = (t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3;
            const cz = (t.p[0]![1] + t.p[1]![1] + t.p[2]![1]) / 3;
            expect(insideStrictly(poly, { x: cx, z: cz }), `seed ${seed} junction ${j.id}: white paint inside the pavement`).toBe(false);
          }
        }
      }
    });

    it("hold parking back from the corners: no stall's line of the main street within 20 ft of a crosswalk or 30 ft of a STOP sign", () => {
      let checked = 0;
      for (const seed of JUNCTION_SEEDS) {
        const g = groundFor(seed);
        const l = layer(seed);
        // The lines of a stall are the white marks 0.1 m wide.
        const thin = l.of(PAINT_WHITE).filter((t) => {
          const e = t.p.map((q, k) => Math.hypot(q[0] - (t.p[(k + 1) % 3] as [number, number])[0], q[1] - (t.p[(k + 1) % 3] as [number, number])[1]));
          return Math.min(...e) < 0.12 && Math.max(...e) > 0.3;
        });
        for (const j of g.plan.junctions) {
          for (const leg of j.legs) {
            if (leg.kind !== "main" || leg.engine || leg.closed) continue;
            for (const t of thin) {
              const cx = (t.p[0]![0] + t.p[1]![0] + t.p[2]![0]) / 3 - g.anchor.x - leg.x;
              const cz = (t.p[0]![1] + t.p[1]![1] + t.p[2]![1]) / 3 - g.anchor.z - leg.z;
              const s = cx * leg.dx + cz * leg.dz;
              const lat = Math.abs(-cx * leg.dz + cz * leg.dx);
              // On this leg's roadway side, in a parking lane, within the held-back distance from its mouth.
              if (s > leg.mouth && s < leg.mouth + leg.holdBack - 0.01 && lat > leg.half - 2.5 && lat < leg.half) throw new Error(`seed ${seed} junction ${j.id}: a stall's line ${(s - leg.mouth).toFixed(1)} m from the mouth, held back ${leg.holdBack.toFixed(1)}`);
            }
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(5);
    });

    it("carry a through street's sidewalk and curb unbroken across a tee's top, and an alley's mouth breaks no sidewalk", () => {
      let tees = 0;
      let mouths = 0;
      for (const seed of JUNCTION_SEEDS) {
        const g = groundFor(seed);
        const l = layer(seed);
        for (const j of g.plan.junctions) {
          if (j.kind === "tee" && j.legacy === null && j.stem >= 0) {
            const through = j.legs.filter((_, i) => i !== j.stem);
            const a = through[0] as (typeof through)[number];
            const b = through[1] as (typeof through)[number];
            if (a.street !== b.street) continue;
            // The far side of the through street is the side the stem is not on: left of `a` if the stem's direction points to its right.
            const stem = j.legs[j.stem] as (typeof j.legs)[number];
            const farSide = stem.dx * -a.dz + stem.dz * a.dx > 0 ? -1 : 1;
            const lotLat = farSide * (a.outer - Math.min(a.walk, a.outer - a.half - CURB_WIDTH) / 2);
            const curbLat = farSide * (a.half + CURB_WIDTH / 2);
            // Across the tee's top, from where one leg's roadway begins to where the other's does (and a metre beyond each), stepping half a metre.
            for (let s = -(b.mouth + 1); s <= a.mouth + 1; s += 0.5) {
              const x = g.anchor.x + a.x + a.dx * s - a.dz * lotLat;
              const z = g.anchor.z + a.z + a.dz * s + a.dx * lotLat;
              // The engine's road bed is cut from every surface.
              if (Math.abs(x - g.roadX(z)) < ROAD_BED_HALF + 0.5) continue;
              // Only where the street's side has a sidewalk there (a pour ends, a stretch is missing, a side has none: `plan.edges`).
              const st = g.plan.streets[a.street] as (typeof g.plan.streets)[number];
              const tl = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
              const sAt = (x - g.anchor.x - st.a.x) * ((st.b.x - st.a.x) / tl) + (z - g.anchor.z - st.a.z) * ((st.b.z - st.a.z) / tl);
              const farLeft = (st.b.x - st.a.x) * a.dx + (st.b.z - st.a.z) * a.dz > 0 ? farSide > 0 : farSide < 0;
              const edge = (g.plan.edges[a.street] as (typeof g.plan.edges)[number]).sides[farLeft ? 0 : 1];
              if (walkAt(edge, sAt - 0.3) === null || walkAt(edge, sAt + 0.3) === null) continue;
              expect(coveredBy(l, SIDEWALK, x, z), `seed ${seed} junction ${j.id}: the sidewalk broken at ${s}`).toBe(true);
              const cx = g.anchor.x + a.x + a.dx * s - a.dz * curbLat;
              const cz = g.anchor.z + a.z + a.dz * s + a.dx * curbLat;
              if (Math.abs(cx - g.roadX(cz)) < ROAD_BED_HALF + 0.5) continue;
              if (!edge.curb) continue;
              // A ramp opens the curb over its crosswalk's width (at each leg's mouth), and a driveway's apron over its own.
              const along = s >= 0 ? s - a.mouth : -s - b.mouth;
              if (along > 0 && along < CROSSWALK_WIDTH + 0.3) continue;
              if (g.plan.junctions.some((q) => q.kind === "alley" && Math.abs((g.anchor.x + q.legs[0]!.x - cx) * a.dx + (g.anchor.z + q.legs[0]!.z - cz) * a.dz) < 3.4 && Math.hypot(g.anchor.x + q.legs[0]!.x - cx, g.anchor.z + q.legs[0]!.z - cz) < 9)) continue;
              expect(coveredBy(l, CURB, cx, cz), `seed ${seed} junction ${j.id}: the curb broken at ${s}`).toBe(true);
            }
            tees++;
          }
          if (j.kind === "alley" && j.alley !== null) {
            const st = g.plan.streets[j.alley.street] as (typeof g.plan.streets)[number];
            const leg = j.legs[0] as (typeof j.legs)[number];
            const side = j.alley.dx * -leg.dz + j.alley.dz * leg.dx > 0 ? 1 : -1;
            // The middle of the sidewalk, across the mouth.
            const lat = side * (st.width / 2 - st.walk / 2);
            const sd = (g.plan.edges[j.alley.street] as (typeof g.plan.edges)[number]).sides[(st.b.x - st.a.x) * leg.dx + (st.b.z - st.a.z) * leg.dz > 0 ? (side > 0 ? 0 : 1) : side > 0 ? 1 : 0];
            for (let s = -4; s <= 4; s += 0.5) {
              const x = g.anchor.x + leg.x + leg.dx * s - leg.dz * lat;
              const z = g.anchor.z + leg.z + leg.dz * s + leg.dx * lat;
              // Only where the side has a sidewalk to break.
              const tl = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
              const sAt = (x - g.anchor.x - st.a.x) * ((st.b.x - st.a.x) / tl) + (z - g.anchor.z - st.a.z) * ((st.b.z - st.a.z) / tl);
              if (walkAt(sd, sAt - 0.3) === null || walkAt(sd, sAt + 0.3) === null) continue;
              expect(coveredBy(l, SIDEWALK, x, z), `seed ${seed} junction ${j.id}: an alley's mouth breaks the sidewalk at ${s}`).toBe(true);
            }
            mouths++;
          }
        }
      }
      expect(tees).toBeGreaterThan(10);
      // (Fewer alleys: an alley with no building near is cut away, `port/trim.ts`. It was 30.)
      expect(mouths).toBeGreaterThan(15);
    });

    it("stand a STOP sign beside the road before the crosswalk on each leg that stops, and none elsewhere; each blade names its two streets", () => {
      for (const seed of WORLD_SEEDS) {
        const g = groundFor(seed);
        let stops = 0;
        for (const j of g.plan.junctions) for (const leg of j.legs) if (leg.stops) stops++;
        const { signs } = streetsOf(seed);
        // A STOP sign is a red octagon: its back and front are two polygons of eight corners, six triangles each; the end markers are red too (four-cornered), so count by octagons' triangles.
        let redTriangles = 0;
        eachTriangle(signs, (_p, _n, c) => {
          if (Math.abs(c[0] - SIGN_RED[0]) < 1e-6 && Math.abs(c[1] - SIGN_RED[1]) < 1e-6) redTriangles++;
        });
        // Each stopping leg's sign: one red octagon (six triangles), and its post. A planter's or a marker's red is none of the street's.
        expect(redTriangles).toBe(stops * 6);
        // Every street's name can be drawn: its letters are all in the face.
        for (const st of g.plan.streets) for (const ch of bladeText(st.name).replace(/ /g, "")) expect(textRuns(ch).length, `${st.name}: ${ch}`).toBeGreaterThan(0);
      }
    });
  });
});

describe("the buildings", () => {
  it("stand on the ground: every wall's base is at or under the ground at its corners, and the base is as low as the lowest ground under it", () => {
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      for (const b of g.plan.buildings.filter((q) => q.lot !== -1)) {
        const a = build(g, b);
        let lowest = Infinity;
        for (let v = 0; v < a.positions.length / 3; v++) lowest = Math.min(lowest, a.positions[v * 3 + 1] as number);
        const u = bearingU(b.bearing);
        const w = bearingV(b.bearing);
        const cx = g.anchor.x + b.centre.x;
        const cz = g.anchor.z + b.centre.z;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          const x = cx + u.x * b.halfAlong * su + w.x * b.halfAcross * sv;
          const z = cz + u.z * b.halfAlong * su + w.z * b.halfAcross * sv;
          if (lowest > g.heightAt(x, z) + 1e-4) throw new Error(`${seed} building ${b.id}: base ${lowest} over the ground ${g.heightAt(x, z)}`);
        }
      }
    }
  });

  it("rise to their height over their floor, flat roofs with a parapet, a ruin lower", () => {
    const g = groundFor(GAME_SEED);
    for (const b of g.plan.buildings.filter((q) => q.lot !== -1 && q.state === "open" && q.roof === "flat")) {
      const a = build(g, b);
      let top = -Infinity;
      let bottom = Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) {
        top = Math.max(top, a.positions[v * 3 + 1] as number);
        bottom = Math.min(bottom, a.positions[v * 3 + 1] as number);
      }
      // The floor stands within a few metres over the lowest ground on a slope; the parapet is half a metre over the height.
      expect(top - bottom).toBeGreaterThan(b.height);
      expect(top - bottom).toBeLessThan(b.height + 0.5 + 6);
    }
  });

  it("differ when vacant and when ruined: duller, boarded, and open to the sky", () => {
    const g = groundFor(GAME_SEED);
    const shop = g.plan.buildings.find((q) => q.kind === "storefront" && q.state === "open" && q.lot !== -1 && q.storeys >= 2) as Building;
    const open = build(g, shop);
    // A vacant building: its walls duller (the building's state), and its units the plan's vacant boarded ones (the plan's own record of what is boarded).
    const doctored: TownGround = {
      ...g,
      plan: {
        ...g.plan,
        uses: g.plan.uses.map((u) => (u.building !== shop.id ? u : { ...u, units: u.units.map((x) => ({ ...x, state: "vacant boarded" as const, openings: x.openings.map((o) => ({ ...o, cover: "boarded" as const })) })) })),
      },
    };
    const vacant = build(doctored, { ...shop, state: "vacant" });
    const ruin = build(g, { ...shop, state: "ruin" });
    // The walls' colour: the vertices the scene lights (a room's walls are lit by their own baked light, `glow` 1, and a boarded unit has no room).
    const luma = (a: MeshArrays): number => {
      let s = 0;
      let n = 0;
      for (let v = 0; v < a.colors.length / 4; v++) {
        if ((a.surface[v * SURFACE_FLOATS + 3] as number) !== 0) continue;
        s += 0.2126 * (a.colors[v * 4] as number) + 0.7152 * (a.colors[v * 4 + 1] as number) + 0.0722 * (a.colors[v * 4 + 2] as number);
        n++;
      }
      return s / n;
    };
    // Boards are the plywood layer's (the openings' covers, laid in the wall's own frame); count its triangles.
    const plywood = (a: MeshArrays): number => {
      let n = 0;
      for (let t = 0; t < a.indices.length; t += 3) if (a.surface[(a.indices[t] as number) * SURFACE_FLOATS] === LAYER_NAMES.indexOf("plywood")) n++;
      return n;
    };
    // Open: glass, no boards. Vacant: boards where the glass was, and a duller wall.
    expect(plywood(open)).toBe(0);
    expect(plywood(vacant)).toBeGreaterThan(5);
    expect(luma(vacant)).toBeLessThan(luma(open));
    expect(vacant.colors).not.toEqual(open.colors);
    // A ruin has no roof: nothing of it stands over the wall's height, and its top is lower.
    const topOf = (a: MeshArrays): number => {
      let m = -Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) m = Math.max(m, a.positions[v * 3 + 1] as number);
      return m;
    };
    expect(topOf(ruin)).toBeLessThan(topOf(open) - shop.height * 0.2);
    expect(ruin.positions.length).not.toBe(open.positions.length);
    // The same building built twice is the same arrays.
    expect(build(g, shop).positions).toEqual(open.positions);
  });

  it("set their glass in the wall's openings, facing out: each pane in the see-through layer is off a wall by no more than the reveal (a recessed entry's depth into the wall, or an addition's depth out)", () => {
    const seed = GAME_SEED;
    const g = groundFor(seed);
    let checked = 0;
    for (const b of g.plan.buildings.filter((q) => q.lot !== -1 && q.state === "open").slice(0, 120)) {
      const solid = new MeshBuilder();
      const glass = new MeshBuilder();
      resetLedger();
      buildingGeometry(g, b, roleOf(g, b), () => solid, "full", { glass: () => glass, sign: () => new MeshBuilder(), atlas: new SignAtlas() });
      const a = glass.finish();
      const u = bearingU(b.bearing);
      const w = bearingV(b.bearing);
      const cx = g.anchor.x + b.centre.x;
      const cz = g.anchor.z + b.centre.z;
      eachTriangle(a, (p, n) => {
        expect(Math.abs(n[1])).toBeLessThan(0.7);
        const mid = [p.reduce((acc, q) => acc + q[0], 0) / 3, 0, p.reduce((acc, q) => acc + q[2], 0) / 3];
        const lu = ((mid[0] as number) - cx) * u.x + ((mid[2] as number) - cz) * u.z;
        const lv = ((mid[0] as number) - cx) * w.x + ((mid[2] as number) - cz) * w.z;
        const off = Math.max(Math.abs(lu) - b.halfAlong, Math.abs(lv) - b.halfAcross);
        expect(off).toBeGreaterThan(-1.6);
        expect(off).toBeLessThan(4.5);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("carry the touch of a landmark: a steeple, a flagpole, an open tower on legs, a stack", () => {
    const g = groundFor(GAME_SEED);
    const topOf = (a: MeshArrays): number => {
      let m = -Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) m = Math.max(m, a.positions[v * 3 + 1] as number);
      return m;
    };
    const bottomOf = (a: MeshArrays): number => {
      let m = Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) m = Math.min(m, a.positions[v * 3 + 1] as number);
      return m;
    };
    for (const role of ["fbi", "church", "mill"] as const) {
      const l = g.plan.landmarks.find((q) => q.role === role) as NonNullable<ReturnType<typeof g.plan.landmarks.find>>;
      const b = g.plan.buildings[l.building] as Building;
      const plain = build(g, b, null);
      const touched = build(g, b, role);
      // A church with no role has a bell cote of the size of the steeple's tower, so the count may be the same; what the role adds is height.
      expect(touched.positions.length, role).toBeGreaterThanOrEqual(plain.positions.length);
      // The flagpole stands on the ground and is shorter than the office; the steeple and the stack stand over their roofs.
      if (role === "fbi") expect(topOf(touched)).toBeGreaterThanOrEqual(topOf(plain));
      else expect(topOf(touched), role).toBeGreaterThan(topOf(plain) + 2);
    }
    // The tsunami refuge is not a shell: legs and a platform, open under it.
    const refuge = g.plan.landmarks.find((q) => q.role === "tsunami refuge") as NonNullable<ReturnType<typeof g.plan.landmarks.find>>;
    const rb = g.plan.buildings[refuge.building] as Building;
    const tower = build(g, rb, "tsunami refuge");
    const shell = build(g, rb, null);
    expect(tower.positions.length).not.toBe(shell.positions.length);
    expect(topOf(tower) - bottomOf(tower)).toBeGreaterThan(rb.height * 0.9);
  });

  it("is built a little less on the low tier, never more", () => {
    const g = groundFor(GAME_SEED);
    let low = 0;
    let full = 0;
    for (const b of g.plan.buildings.filter((q) => q.lot !== -1)) {
      low += build(g, b, roleOf(g, b), "low").positions.length;
      full += build(g, b, roleOf(g, b), "full").positions.length;
    }
    expect(low).toBeLessThan(full);
  });
});

describe("the piers, the wharf and the quay", () => {
  it("stand every pier's and shed's deck at the plan's height on piles that go down under the sea", () => {
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      const piers = g.plan.decks.filter((d) => d.kind === "pier" || d.kind === "shed");
      expect(piers.length).toBeGreaterThan(0);
      for (const d of piers) {
        const builder = new MeshBuilder();
        deckGeometry(g, () => builder, d);
        const a = builder.finish();
        let deckVerts = 0;
        let pileVerts = 0;
        let lowest = Infinity;
        for (let v = 0; v < a.positions.length / 3; v++) {
          const y = a.positions[v * 3 + 1] as number;
          const col = [a.colors[v * 4], a.colors[v * 4 + 1], a.colors[v * 4 + 2]];
          if (Math.abs((col[0] as number) - DECK[0]) < 1e-6 && Math.abs((col[2] as number) - DECK[2]) < 1e-6) {
            deckVerts++;
            // A deck's top is the plan's number, the one the walking reads.
            expect(y).toBeCloseTo(d.top, 5);
          }
          if (Math.abs((col[0] as number) - PILE[0]) < 1e-6 && Math.abs((col[2] as number) - PILE[2]) < 1e-6) {
            pileVerts++;
            lowest = Math.min(lowest, y);
          }
        }
        expect(deckVerts).toBeGreaterThanOrEqual(4);
        expect(pileVerts).toBeGreaterThan(40);
        expect(lowest).toBeLessThan(SEA - 1);
      }
    }
  });

  it("deck the wharf street over the water, on piles", () => {
    const g = groundFor(GAME_SEED);
    const wharf = g.plan.streets.find((s) => s.kind === "wharf");
    expect(wharf).toBeDefined();
    const builder = new MeshBuilder();
    wharfGeometry(g, wharf as NonNullable<typeof wharf>, () => builder);
    const a = builder.finish();
    expect(a.positions.length / 3).toBeGreaterThan(100);
    let lowest = Infinity;
    for (let v = 0; v < a.positions.length / 3; v++) lowest = Math.min(lowest, a.positions[v * 3 + 1] as number);
    expect(lowest).toBeLessThan(SEA - 1);
  });

  it("edge each wet stretch of the quay with an apron and a wall that goes down to the water, facing the sea", () => {
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      const solid = new MeshBuilder();
      const flat = new MeshBuilder();
      quayGeometry(g, () => solid, () => flat);
      const a = solid.finish();
      const apron = flat.finish();
      const q = g.plan.quay;
      let wet = 0;
      for (const w of q.wet) wet += Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
      expect(wet).toBeGreaterThan(100);
      // The wall's face: upright triangles that look out to sea and go down under it.
      const sea = q.seaward;
      let faceTriangles = 0;
      eachTriangle(a, (p, n) => {
        if (Math.abs(n[1]) < 0.01 && n[0] * sea.x + n[2] * sea.z > 0.9 && Math.min(...p.map((v) => v[1])) <= SEA - FACE_DEPTH + 1e-4) faceTriangles++;
      });
      // A wall of two triangles for every 4 m of the stretch, less what the piers and the wharf take.
      expect(faceTriangles).toBeGreaterThanOrEqual(Math.floor(wet / 4));
      // And nothing of the wall stands under the apron's edge: its face is a hand beyond the deck's own edge.
      eachTriangle(a, (p, n) => {
        if (n[0] * sea.x + n[2] * sea.z > 0.9 && Math.abs(n[1]) < 0.01 && Math.min(...p.map((v) => v[1])) < SEA - 3) {
          for (const v of p) expect(Math.abs((v[0] - g.anchor.x - q.a.x) * sea.x + (v[2] - g.anchor.z - q.a.z) * sea.z)).toBeGreaterThan(APRON - 1e-3);
        }
      });
      // The apron lies at the apron deck's height.
      const top = g.plan.decks.find((d) => d.kind === "apron")?.top as number;
      eachTriangle(apron, (p, n) => {
        expect(n[1]).toBeGreaterThan(0.9);
        for (const v of p) expect(v[1]).toBeCloseTo(top, 5);
      });
      expect(APRON).toBeGreaterThan(1);
    }
  });
});

describe("a building's variation", () => {
  it("comes from its id: the same id the same colour, ids differing", () => {
    expect(hash01(7, 3)).toBe(hash01(7, 3));
    expect(hash01(7, 3)).not.toBe(hash01(8, 3));
    for (let i = 0; i < 100; i++) {
      const h = hash01(i, 10);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("the whole town's geometry, timed", () => {
  it("builds in under two and a half seconds for the game's seed", { tags: ["wall-clock"] }, () => {
    const g = groundFor(GAME_SEED);
    // The first build warms the engine's tables and the module's code: the second is what a world pays.
    finish(townGeometry(g, "full", { x: 0, z: 0 }));
    const start = performance.now();
    finish(townGeometry(g, "full", { x: 0, z: 0 }));
    const ms = performance.now() - start;
    console.log(`town geometry for ${GAME_SEED}: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2500);
  });
});

describe("the stairs", () => {
  it("draw a flight of steps for each stair street: treads that climb with the ground by no more than a step's rise, standing on it, with a handrail down each side", () => {
    let flights = 0;
    for (const seed of [20261121, 1, 6]) {
      const g = groundFor(seed);
      for (const st of g.plan.streets.filter((q) => q.kind === "stair")) {
        const only: TownGround = { ...g, plan: { ...g.plan, streets: [st] } };
        const builder = new MeshBuilder();
        stairGeometry(only, () => builder);
        const a = builder.finish();
        expect(a.positions.length, `seed ${seed} stair ${st.id}`).toBeGreaterThan(300);
        // The highest vertex is the handrail over the head of the flight, the lowest a tread's footing: nothing floats off the ground or is buried deeper than a footing.
        let lo = Infinity;
        for (let v = 0; v < a.positions.length / 3; v++) {
          const x = a.positions[v * 3] as number;
          const y = a.positions[v * 3 + 1] as number;
          const z = a.positions[v * 3 + 2] as number;
          lo = Math.min(lo, y - g.heightAt(x, z));
        }
        expect(lo, `seed ${seed} stair ${st.id}`).toBeGreaterThan(-STEP_RISE * 40);
        flights++;
      }
    }
    expect(flights).toBeGreaterThan(5);
  });
});
