import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { buildingGeometry, PROUD } from "../../src/game/town/buildingGeometry.js";
import { MeshBuilder, hash01, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { GLASS, PLYWOOD, DECK, PILE, QUAY_FACE } from "../../src/game/town/palette.js";
import { APRON, CURB_HEIGHT, FACE_DEPTH, pierGeometry, quayGeometry, wharfGeometry } from "../../src/game/town/pileGeometry.js";
import { ASPHALT_OVER, RANK_LIFT, SLOT_LIFT, STREET_LIFT, streetGeometry } from "../../src/game/town/streetGeometry.js";
import { CELL, townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { SEA, type TownGround } from "../../src/game/town/townTypes.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
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

  it("puts every batch in the cell its geometry stands in, and no more than a hundred meshes for the town", () => {
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
    expect(townFor(GAME_SEED).length).toBeLessThanOrEqual(100);
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
    expect({ meshes: townFor(GAME_SEED).length, flat, vertices, triangles }).toEqual({ meshes: 74, flat: 38, vertices: 122637, triangles: 61125 });
  });
});

describe("the streets", () => {
  /** The streets alone (the wharf is a deck, which stands where the water is, and is tested with the piles). */
  function streetsOf(seed: number): { g: TownGround; a: MeshArrays } {
    const g = groundFor(seed);
    const only: TownGround = { ...g, plan: { ...g.plan, streets: g.plan.streets.filter((s) => s.kind !== "wharf") } };
    const builder = new MeshBuilder();
    streetGeometry(only, () => builder);
    return { g, a: builder.finish() };
  }

  it("lie on the ground: every vertex is its ground's height plus a lift of 0.06 m (the sidewalks) to 0.16 m (the rail's top), facing up", () => {
    for (const seed of WORLD_SEEDS) {
      const { g, a } = streetsOf(seed);
      let least = Infinity;
      let most = -Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) {
        const lift = (a.positions[v * 3 + 1] as number) - g.heightAt(a.positions[v * 3] as number, a.positions[v * 3 + 2] as number);
        least = Math.min(least, lift);
        most = Math.max(most, lift);
      }
      expect(least).toBeGreaterThan(STREET_LIFT - 0.002);
      // The highest is the rail's top (0.1 over the street lift); the highest carriageway is under 0.125.
      expect(most).toBeLessThan(STREET_LIFT + 0.1 + 0.002);
      eachTriangle(a, (_p, n) => {
        if (n[1] < 0.95) throw new Error(`${seed}: a street surface turned from the sky (${n[1]})`);
      });
      console.log(`street lifts for ${seed}: ${least.toFixed(4)} to ${most.toFixed(4)} m`);
    }
  });

  it("are cut along their length at 4 m or less and across into at least two", () => {
    const g = groundFor(GAME_SEED);
    const main = g.plan.streets.find((s) => s.kind === "main");
    const street = main ?? (g.plan.streets.find((s) => s.kind === "street") as NonNullable<typeof main>);
    const only: TownGround = { ...g, plan: { ...g.plan, streets: [street] } };
    const builder = new MeshBuilder();
    streetGeometry(only, () => builder);
    const a = builder.finish();
    // Every quad is a strip tile: its long edge is at most 4 m (a tile is cut at 4 m and the street's length divided evenly).
    const xs = new Set<number>();
    let longest = 0;
    eachTriangle(a, (p) => {
      for (let k = 0; k < 3; k++) {
        const q = p[k] as number[];
        const r = p[(k + 1) % 3] as number[];
        longest = Math.max(longest, Math.hypot((q[0] as number) - (r[0] as number), (q[2] as number) - (r[2] as number)));
      }
      xs.add(Math.round((p[0] as number[])[0] as number * 100));
    });
    // The longest edge of a tile of at most 4 m by at most half the street's width: a diagonal under 4 + width / 2.
    expect(longest).toBeLessThan(Math.hypot(4.01, street.width / 2));
    // Bands: at least two across (two carriageway halves) and, on this kind, a sidewalk each side: four.
    const length = Math.hypot(street.b.x - street.a.x, street.b.z - street.a.z);
    const tiles = Math.ceil(length / 4);
    expect(a.indices.length / 6).toBeGreaterThanOrEqual(tiles * 2);
  });

  it("end at the highway's bed: no vertex stands within the bed of the road the engine paints", () => {
    for (const seed of WORLD_SEEDS) {
      const { g, a } = streetsOf(seed);
      let nearest = Infinity;
      for (let v = 0; v < a.positions.length / 3; v++) {
        const x = a.positions[v * 3] as number;
        const z = a.positions[v * 3 + 2] as number;
        nearest = Math.min(nearest, Math.abs(x - g.roadX(z)));
      }
      // Float32 positions, and the clip is on a line through the tile's corners while the road curves a little.
      expect(nearest).toBeGreaterThan(ROAD_BED_HALF - 0.02);
    }
  });

  it("draw a crossing once: at a crossing's middle one layer is highest, by a clear margin over the next", () => {
    const seed = GAME_SEED;
    const { g, a } = streetsOf(seed);
    const triangles: { p: [number, number, number][] }[] = [];
    eachTriangle(a, (p) => triangles.push({ p }));
    // The streets' crossings: where two carriageways' centre lines meet.
    const streets = g.plan.streets.filter((s) => s.kind === "street" || s.kind === "main" || s.kind === "avenue");
    let crossings = 0;
    let worstGap = Infinity;
    for (let i = 0; i < streets.length; i++) {
      for (let j = i + 1; j < streets.length; j++) {
        const s = streets[i] as (typeof streets)[number];
        const t = streets[j] as (typeof streets)[number];
        const d1x = s.b.x - s.a.x;
        const d1z = s.b.z - s.a.z;
        const d2x = t.b.x - t.a.x;
        const d2z = t.b.z - t.a.z;
        const den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-6) continue;
        const u = ((t.a.x - s.a.x) * d2z - (t.a.z - s.a.z) * d2x) / den;
        const w = ((t.a.x - s.a.x) * d1z - (t.a.z - s.a.z) * d1x) / den;
        if (u < 0.02 || u > 0.98 || w < 0.02 || w > 0.98) continue;
        const x = g.anchor.x + s.a.x + d1x * u;
        const z = g.anchor.z + s.a.z + d1z * u;
        // Out of the highway's bed.
        if (Math.abs(x - g.roadX(z)) < ROAD_BED_HALF + 1) continue;
        for (const [dx, dz] of [[0, 0], [1.3, 0.7], [-1.9, 1.1], [0.6, -2.2]] as const) {
          const px = x + dx;
          const pz = z + dz;
          const ys: number[] = [];
          for (const tri of triangles) {
            const [q0, q1, q2] = tri.p as unknown as [number[], number[], number[]];
            const d = ((q1[2] as number) - (q2[2] as number)) * ((q0[0] as number) - (q2[0] as number)) + ((q2[0] as number) - (q1[0] as number)) * ((q0[2] as number) - (q2[2] as number));
            if (Math.abs(d) < 1e-12) continue;
            const l0 = (((q1[2] as number) - (q2[2] as number)) * (px - (q2[0] as number)) + ((q2[0] as number) - (q1[0] as number)) * (pz - (q2[2] as number))) / d;
            const l1 = (((q2[2] as number) - (q0[2] as number)) * (px - (q2[0] as number)) + ((q0[0] as number) - (q2[0] as number)) * (pz - (q2[2] as number))) / d;
            const l2 = 1 - l0 - l1;
            if (l0 < 0 || l1 < 0 || l2 < 0) continue;
            ys.push(l0 * (q0[1] as number) + l1 * (q1[1] as number) + l2 * (q2[1] as number));
          }
          if (ys.length < 2) continue;
          ys.sort((m, k) => k - m);
          worstGap = Math.min(worstGap, (ys[0] as number) - (ys[1] as number));
        }
        crossings++;
      }
    }
    expect(crossings).toBeGreaterThan(5);
    // Layers differ by at least a sidewalk's step (ASPHALT_OVER) or a rank's (RANK_LIFT) or a slot's (SLOT_LIFT): the least of them, less the ground's own tilt across a 4 m tile.
    expect(worstGap).toBeGreaterThan(SLOT_LIFT / 2);
    console.log(`crossings checked: ${crossings}, least gap between the top layer and the next: ${worstGap.toFixed(5)} m (ASPHALT_OVER ${ASPHALT_OVER}, RANK_LIFT ${RANK_LIFT}, SLOT_LIFT ${SLOT_LIFT})`);
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
    const vacant = build(g, { ...shop, state: "vacant" });
    const ruin = build(g, { ...shop, state: "ruin" });
    const luma = (a: MeshArrays): number => {
      let s = 0;
      for (let v = 0; v < a.colors.length / 4; v++) s += 0.2126 * (a.colors[v * 4] as number) + 0.7152 * (a.colors[v * 4 + 1] as number) + 0.0722 * (a.colors[v * 4 + 2] as number);
      return s / (a.colors.length / 4);
    };
    const plywood = (a: MeshArrays): number => {
      let n = 0;
      eachTriangle(a, (_p, _n, c) => {
        if (c[0] > PLYWOOD[0] * 0.8 && c[0] < PLYWOOD[0] * 1.2 && Math.abs(c[1] - PLYWOOD[1] * (c[0] / PLYWOOD[0])) < 0.02 && c[2] < c[1]) n++;
      });
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

  it("lay their windows proud of the wall, on its outward face: each glass quad is off a wall by about 3 cm, facing away from the building", () => {
    const seed = GAME_SEED;
    const g = groundFor(seed);
    let checked = 0;
    for (const b of g.plan.buildings.filter((q) => q.lot !== -1 && q.state === "open").slice(0, 120)) {
      const a = build(g, b, roleOf(g, b));
      const u = bearingU(b.bearing);
      const w = bearingV(b.bearing);
      const cx = g.anchor.x + b.centre.x;
      const cz = g.anchor.z + b.centre.z;
      eachTriangle(a, (p, n, c) => {
        // Glass: the colour of the glass (its own scatter, 0.8 to 1.5 of it) and bluer than red.
        const k = c[2] / GLASS[2];
        if (k < 0.79 || k > 1.51 || Math.abs(c[0] / GLASS[0] - k) > 0.05 || Math.abs(c[1] / GLASS[1] - k) > 0.05) return;
        expect(Math.abs(n[1])).toBeLessThan(0.01);
        const mid = [p.reduce((acc, q) => acc + q[0], 0) / 3, 0, p.reduce((acc, q) => acc + q[2], 0) / 3];
        const out = (mid[0] as number - cx) * n[0] + (mid[2] as number - cz) * n[2];
        expect(out).toBeGreaterThan(0);
        // In the building's own axes the quad lies a hair off one face and inside the other's extent.
        const lu = ((mid[0] as number) - cx) * u.x + ((mid[2] as number) - cz) * u.z;
        const lv = ((mid[0] as number) - cx) * w.x + ((mid[2] as number) - cz) * w.z;
        const offU = Math.abs(lu) - b.halfAlong;
        const offV = Math.abs(lv) - b.halfAcross;
        const off = Math.max(offU, offV);
        expect(off).toBeGreaterThan(PROUD - 0.002);
        expect(off).toBeLessThan(PROUD + 0.02);
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
      expect(touched.positions.length, role).toBeGreaterThan(plain.positions.length);
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
  it("stand a deck at the quay's height on piles that go down under the sea", () => {
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      const piers = g.plan.buildings.filter((b) => b.lot === -1);
      expect(piers.length).toBeGreaterThan(0);
      for (const b of piers) {
        const builder = new MeshBuilder();
        pierGeometry(g, b, () => builder);
        const a = builder.finish();
        const deck = g.deckAt(g.anchor.x + b.centre.x, g.anchor.z + b.centre.z);
        let deckVerts = 0;
        let pileVerts = 0;
        let lowest = Infinity;
        for (let v = 0; v < a.positions.length / 3; v++) {
          const y = a.positions[v * 3 + 1] as number;
          const col = [a.colors[v * 4], a.colors[v * 4 + 1], a.colors[v * 4 + 2]];
          if (Math.abs((col[0] as number) - DECK[0]) < 1e-6 && Math.abs((col[2] as number) - DECK[2]) < 1e-6) {
            deckVerts++;
            // A deck is at the quay's height, or on the ground where that is higher: never under it.
            expect(y).toBeGreaterThanOrEqual(deck - 1e-4);
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

  it("edge the made ground with an apron, a curb and a face that goes down to the water, facing the sea", () => {
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      const solid = new MeshBuilder();
      const flat = new MeshBuilder();
      quayGeometry(g, () => solid, () => flat);
      const a = solid.finish();
      const apron = flat.finish();
      const q = g.plan.quay;
      const len = Math.hypot(q.b.x - q.a.x, q.b.z - q.a.z);
      // The seaward side: negative x.
      let faceTriangles = 0;
      let curbTops = 0;
      eachTriangle(a, (p, n, c) => {
        const faceColour = Math.abs(c[0] - QUAY_FACE[0]) < 1e-6 && Math.abs(c[2] - QUAY_FACE[2]) < 1e-6;
        if (faceColour) {
          faceTriangles++;
          expect(Math.abs(n[1])).toBeLessThan(0.01);
          expect(n[0]).toBeLessThan(0);
          expect(Math.min(...p.map((q) => q[1]))).toBeLessThanOrEqual(SEA - FACE_DEPTH + 1e-4);
        }
        if (n[1] > 0.99) curbTops++;
      });
      expect(faceTriangles).toBeGreaterThanOrEqual(Math.floor(len / 4) * 2);
      expect(curbTops).toBeGreaterThanOrEqual(Math.floor(len / 4) * 2);
      // The apron lies at the line's own height and `APRON` m seaward.
      eachTriangle(apron, (_p, n) => expect(n[1]).toBeGreaterThan(0.9));
      expect(APRON).toBeGreaterThan(CURB_HEIGHT);
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
  it("builds in well under a second for the game's seed", { tags: ["wall-clock"] }, () => {
    const g = groundFor(GAME_SEED);
    // The first build warms the engine's tables and the module's code: the second is what a world pays.
    finish(townGeometry(g, "full", { x: 0, z: 0 }));
    const start = performance.now();
    finish(townGeometry(g, "full", { x: 0, z: 0 }));
    const ms = performance.now() - start;
    console.log(`town geometry for ${GAME_SEED}: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
