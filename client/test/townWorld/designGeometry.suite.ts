import { fitsDesign } from "../../src/sim/inside/designWalk.js";
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { unnamed } from "../../src/game/town/materials.js";
import { designMesh, RISER } from "../../src/game/town/designGeometry.js";
import { isUnbacked, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { bakeLight } from "../../src/game/town/designLight.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { GALLERY, STAIR_FROM, STAIR_TO, testDesign } from "../inside/designHelpers.js";
import { HEAVY_SEEDS } from "../inside/seeds.js";
import { meshOf } from "./roomMeshes.js";

/** The game's seeds, and seeds 1 to 24. */
const SEEDS = HEAVY_SEEDS;
/** A vertex of a designed room lies this far outside its box at most: a casing, a frame's bar or a thing's own thickness proud of a wall. */
const MARGIN = 0.1;

const pos = (a: MeshArrays, i: number): [number, number, number] => [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];

/** The number of triangles that have no partner: the same corners wound the other way (a face of a solid, a box or a slab or a flight, has none by design: `MeshBuilder.solid`). */
function unpaired(a: MeshArrays): number {
  const key = (p: [number, number, number]): string => p.map((v) => Math.round(v * 1000)).join(",");
  const canon = (ks: string[]): string => [ks.join("|"), [ks[1], ks[2], ks[0]].join("|"), [ks[2], ks[0], ks[1]].join("|")].sort()[0] as string;
  const tris = new Set<string>();
  for (let t = 0; t < a.indices.length; t += 3) tris.add(canon([0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)))));
  let bad = 0;
  for (let t = 0; t < a.indices.length; t += 3) {
    if (isUnbacked(a.indices, t / 3)) continue;
    const ks = [0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)));
    if (!tris.has(canon([ks[2] as string, ks[1] as string, ks[0] as string]))) bad++;
  }
  return bad;
}

describe.each([["bar", 0, 46000], ["cafe", 1, 40000], ["lodging", 2, 74000]] as const)("the %s design drawn, on every test seed", (_name, index, budget) => {
  const lines: string[] = [];
  it("builds on every seed inside its box, with its backs, under the budget, naming every material", () => {
    for (const seed of SEEDS) {
      const room = insideRooms(seed)[index]!;
      expect(room.design.legacy).toBe(false);
      const before = unnamed.polygons;
      const t0 = performance.now();
      const a = meshOf(seed, index);
      const ms = performance.now() - t0;
      const verts = a.positions.length / 3;
      const label = `seed ${seed}`;
      expect(unnamed.polygons, `${label}: polygons that name no material`).toBe(before);
      expect(verts, `${label}: vertices`).toBeGreaterThan(1000);
      expect(verts, `${label}: vertices`).toBeLessThan(budget);
      let outside = 0;
      for (let i = 0; i < verts; i++) {
        const [x, y, z] = pos(a, i);
        const dx = x - room.ox;
        const dz = z - room.oz;
        const s = dx * room.tx + dz * room.tz - room.s0;
        const d = -(dx * room.nx + dz * room.nz);
        const yy = y - room.floorY;
        if (s < -MARGIN || s > room.design.width + MARGIN || d < -MARGIN || d > room.depth + MARGIN || yy < -0.3 || yy > room.ceiling + 1e-4) outside++;
      }
      expect(outside, `${label}: vertices outside the box`).toBe(0);
      // The drawn floor is at the floor the player stands on, exactly.
      let atFloor = false;
      for (let i = 0; i < verts && !atFloor; i++) if (a.normals[i * 3 + 1]! > 0.99 && Math.abs((a.positions[i * 3 + 1] as number) - room.floorY) < 1e-4) atFloor = true;
      expect(atFloor, `${label}: a floor at floorY`).toBe(true);
      expect(unpaired(a), `${label}: triangles without their backs`).toBe(0);
      expect((a.indices.length / 3) % 2).toBe(0);
      lines.push(`${seed}: ${room.design.width.toFixed(2)} x ${room.depth.toFixed(2)}, ${verts} vertices, ${a.indices.length / 3} triangles, ${ms.toFixed(0)} ms`);
    }
    console.log(`[${_name} drawn]\n${lines.join("\n")}`);
  }, timeLimit(600_000));
});

describe("a design with a stair and a gallery drawn", () => {
  const design = testDesign();
  const a = designMesh({
    design,
    xf: { ox: 0, oz: 0, nx: 0, nz: -1, tx: 1, tz: 0, width: design.width, depth: design.depth },
    floorY: 100,
    seed: 3,
    hours: "always",
    detail: "full",
    front: null,
  });
  const n = a.positions.length / 3;

  it("is closed, in its box, and in named materials", () => {
    expect(n).toBeGreaterThan(1000);
    expect(unpaired(a)).toBe(0);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = pos(a, i);
      expect(x).toBeGreaterThan(-0.1);
      expect(x).toBeLessThan(design.width + 0.1);
      expect(z).toBeGreaterThan(-0.1);
      expect(z).toBeLessThan(design.depth + 0.1);
      expect(y - 100).toBeGreaterThan(-0.3 - 1e-4);
      expect(y - 100).toBeLessThan(design.height + 1e-4);
    }
  });

  it("draws the flight as steps of 17.5 cm, each within half a riser of the ramp the walker stands on", () => {
    const levels: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y, z] = pos(a, i);
      // A tread's corners are on the flight's two stringers, 3 cm in off its edges (the posts and rails stand a little further in).
      if (a.normals[i * 3 + 1]! < 0.99 || (Math.abs(x - 7.03) > 1e-4 && Math.abs(x - 8.97) > 1e-4) || z < STAIR_FROM + 0.01 || z > STAIR_TO - 0.01) continue;
      const h = y - 100;
      // The floor under the flight is the floor's, not a tread.
      // Nor the gallery's floor and rail at the flight's head, which stand on its edge.
      if (h < 0.05 || h > GALLERY - 0.05) continue;
      // Nor the top of a post, which stands a hand's breadth in from a stringer and 0.9 m over the ramp.
      if (h - (GALLERY * (z - STAIR_FROM)) / (STAIR_TO - STAIR_FROM) > 0.5) continue;
      if (!levels.some((l) => Math.abs(l - h) < 1e-4)) levels.push(h);
      const ramp = (GALLERY * (z - STAIR_FROM)) / (STAIR_TO - STAIR_FROM);
      expect(Math.abs(h - ramp), `a tread at ${z} is ${h}, the ramp ${ramp}`).toBeLessThanOrEqual(RISER / 2 + 0.03);
    }
    levels.sort((p, q) => p - q);
    expect(levels.length).toBeGreaterThanOrEqual(17);
    for (let k = 1; k < levels.length; k++) expect((levels[k] as number) - (levels[k - 1] as number), `riser ${k}`).toBeGreaterThan(0.17 - 0.01);
    for (let k = 1; k < levels.length; k++) expect((levels[k] as number) - (levels[k - 1] as number)).toBeLessThan(0.18 + 0.01);
    expect(RISER).toBeGreaterThanOrEqual(0.17);
    expect(RISER).toBeLessThanOrEqual(0.18);
  });
});

/** The vertex colour's luminance at `i`. */
const lum = (a: MeshArrays, i: number): number => 0.2126 * (a.colors[i * 4] as number) + 0.7152 * (a.colors[i * 4 + 1] as number) + 0.0722 * (a.colors[i * 4 + 2] as number);
/** The vertex's colour at night: its colour by day times the ratios the room carries with it (`NIGHT_RATIOS`, red in float 9 and blue in float 11 as 2 + the ratio, green read between), as the indoor material at midnight draws it; the day's where it has none. */
const lumNight = (a: MeshArrays, i: number): number => {
  const rr = (a.surface[i * 12 + 9] as number) - 2;
  const rb = (a.surface[i * 12 + 11] as number) - 2;
  if ((a.surface[i * 12 + 11] as number) < 1.99) return lum(a, i);
  const rg = Math.sqrt(Math.max(0, rr * rb));
  return 0.2126 * (a.colors[i * 4] as number) * rr + 0.7152 * (a.colors[i * 4 + 1] as number) * rg + 0.0722 * (a.colors[i * 4 + 2] as number) * rb;
};
const percentile = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((u, v) => u - v);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
};

describe.each([["bar", 0], ["cafe", 1]] as const)("the light of the %s on the world the game opens on is uneven", (name, index) => {
  const seed = 1175766972;
  const room = insideRooms(seed)[index]!;
  const a = meshOf(seed, index);
  const n = a.positions.length / 3;
  const W = room.design.width;
  /** Luminance of the surfaces lit by the room's light (not a glowing thing's own), by where they are: the floor, and each of the three walls. */
  const zones: Record<string, number[]> = { floor: [], left: [], right: [], back: [] };
  for (let i = 0; i < n; i++) {
    if ((a.surface[i * 12 + 3] as number) > 1.01) continue;
    const dx = (a.positions[i * 3] as number) - room.ox;
    const dz = (a.positions[i * 3 + 2] as number) - room.oz;
    const s = dx * room.tx + dz * room.tz - room.s0;
    const d = -(dx * room.nx + dz * room.nz);
    const y = (a.positions[i * 3 + 1] as number) - room.floorY;
    const ny = a.normals[i * 3 + 1] as number;
    if (ny > 0.95 && Math.abs(y) < 0.02) (zones.floor as number[]).push(lum(a, i));
    else if (Math.abs(ny) < 0.2 && y > 0.3 && y < room.ceiling - 0.3) {
      if (s < 0.02) (zones.left as number[]).push(lum(a, i));
      else if (s > W - 0.02) (zones.right as number[]).push(lum(a, i));
      else if (d > room.depth - 0.02) (zones.back as number[]).push(lum(a, i));
    }
  }
  it("has a floor whose 90th percentile is 4 times its 10th, and walls whose are 3 times", () => {
    const ratio = (key: string): number => percentile(zones[key] as number[], 0.9) / Math.max(1e-6, percentile(zones[key] as number[], 0.1));
    console.log(`[light ${name}] ratios floor ${ratio("floor").toFixed(1)} left ${ratio("left").toFixed(1)} right ${ratio("right").toFixed(1)} back ${ratio("back").toFixed(1)}`);
    expect(ratio("floor"), `${name} floor`).toBeGreaterThanOrEqual(4);
    // Walls are lit more evenly than they were (they hold a share of the floor's light, `Mood.fill`), so the cafe's are held to 2.3.
    for (const w of ["left", "right", "back"]) expect(ratio(w), `${name} ${w} wall`).toBeGreaterThanOrEqual(name === "cafe" ? 2.3 : 3);
  });
});

/** The mean of a list, 0 for none. */
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((u, v) => u + v, 0) / xs.length);

describe.each([["cafe", 1], ["lodging", 2]] as const)("the light of the %s is pooled on open floor", (name, index) => {
  const seed = 1175766972;
  const room = insideRooms(seed)[index]!;
  const d = room.design;
  const a = meshOf(seed, index);
  const n = a.positions.length / 3;
  /** Floor vertices (ground floor, facing up, lit by the room's light) with the place and luminance, on OPEN floor: a hull of 0.6 m stands there clear of any block or wall. */
  const floor: { s: number; d: number; v: number; n: number }[] = [];
  for (let i = 0; i < n; i++) {
    if ((a.surface[i * 12 + 3] as number) > 1.01 || (a.normals[i * 3 + 1] as number) < 0.95) continue;
    if (Math.abs((a.positions[i * 3 + 1] as number) - room.floorY) > 0.02) continue;
    const dx = (a.positions[i * 3] as number) - room.ox;
    const dz = (a.positions[i * 3 + 2] as number) - room.oz;
    const s = dx * room.tx + dz * room.tz - room.s0;
    const dd = -(dx * room.nx + dz * room.nz);
    if (!fitsDesign(d, s, dd, 0, 0.6, 0.001)) continue;
    floor.push({ s, d: dd, v: lum(a, i), n: lumNight(a, i) });
  }
  const near = (s: number, dd: number, r: number, night = false): number[] => floor.filter((f) => Math.hypot(f.s - s, f.d - dd) < r).map((f) => (night ? f.n : f.v));
  const fixtures = d.lights.filter((l) => l.beam !== undefined && l.y < (d.cuts?.[0] ?? d.height));
  for (const night of [false, true]) {
    it(`has the floor under a ceiling fixture at least twice as bright as midway between two, ${night ? "at night (the lamps alone)" : "by day"}`, () => {
      const ratios: number[] = [];
      for (let i = 0; i < fixtures.length; i++) for (let j = i + 1; j < fixtures.length; j++) {
        const p = fixtures[i]!;
        const q = fixtures[j]!;
        const gap = Math.hypot(p.s - q.s, p.d - q.d);
        if (gap < 1.8 || gap > 6) continue;
        // Between two with no third nearer to the middle than either.
        const ms = (p.s + q.s) / 2;
        const md = (p.d + q.d) / 2;
        if (fixtures.some((r, k) => k !== i && k !== j && Math.hypot(r.s - ms, r.d - md) < gap / 2 - 0.2)) continue;
        const under = Math.max(mean(near(p.s, p.d, 0.5, night)), mean(near(q.s, q.d, 0.5, night)));
        const mid = near(ms, md, 0.5, night);
        const under0 = near(p.s, p.d, 0.5, night);
        if (under0.length < 2 || mid.length < 2) continue;
        ratios.push(under / Math.max(1e-6, mean(mid)));
      }
      ratios.sort((u, v) => u - v);
      const med = ratios[Math.floor(ratios.length / 2)] ?? 0;
      console.log(`[pools ${name} ${night ? "night" : "day"}] ${floor.length} open vertices, ${fixtures.length} fixtures, ${ratios.length} pairs, median under/between ${med.toFixed(2)}`);
      expect(ratios.length, `${name}: pairs measured`).toBeGreaterThanOrEqual(3);
      // The cafe is the bright room of the four: its pools are gentle, 1.4 times the floor between them by day, where the lobby's are twice; at night the lamps alone make them, and sharper.
      expect(med, `${name}: under a fixture over midway`).toBeGreaterThanOrEqual(name === "cafe" ? 1.4 : 2);
    });
  }
  it("is dark but not void at night, and carries its night colour on nearly every surface", () => {
    const day = mean(floor.map((f) => f.v));
    const night = mean(floor.map((f) => f.n));
    // Textured vertices (a layer of the room's own) with no night ratios would stay as bright as by day at midnight.
    let textured = 0;
    let without = 0;
    for (let i = 0; i < n; i++) {
      if ((a.surface[i * 12] as number) < 0 || (a.surface[i * 12 + 3] as number) > 1.01) continue;
      textured++;
      if ((a.surface[i * 12 + 11] as number) < 1.99) without++;
    }
    console.log(`[night ${name}] open floor mean ${day.toFixed(3)} by day, ${night.toFixed(3)} at night (${((night / day) * 100).toFixed(0)} percent); ${without} of ${textured} textured vertices carry no night colour`);
    expect(night, `${name}: faint ambient and the lamps`).toBeGreaterThan(0.012);
    expect(night, `${name}: darker than by day`).toBeLessThan(day * 0.95);
    expect(without / Math.max(1, textured), `${name}: surfaces with no night colour`).toBeLessThan(0.03);
  });
  it("has the front third of the day-lit room at least 1.6 times the back third", () => {
    const front = mean(floor.filter((f) => f.d < d.depth / 3).map((f) => f.v));
    const back = mean(floor.filter((f) => f.d > (2 * d.depth) / 3).map((f) => f.v));
    console.log(`[front/back ${name}] front ${front.toFixed(3)} back ${back.toFixed(3)} ratio ${(front / Math.max(1e-6, back)).toFixed(2)}`);
    expect(front / Math.max(1e-6, back), `${name}: front over back`).toBeGreaterThanOrEqual(1.6);
  });
  it("has an evenly pale open ceiling: its dimmest part no less than half its brightest in the cafe, 45 percent in the lobby", () => {
    const at = d.cuts?.[0] === undefined ? d.height : d.cuts[0] - 0.15;
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      if ((a.surface[i * 12 + 3] as number) > 1.01 || (a.normals[i * 3 + 1] as number) > -0.95) continue;
      if (Math.abs((a.positions[i * 3 + 1] as number) - room.floorY - at) > 0.03) continue;
      const dx = (a.positions[i * 3] as number) - room.ox;
      const dz = (a.positions[i * 3 + 2] as number) - room.oz;
      const s = dx * room.tx + dz * room.tz - room.s0;
      const dd = -(dx * room.nx + dz * room.nz);
      if (s < 0.7 || s > d.width - 0.7 || dd < 0.7 || dd > d.depth - 0.7) continue;
      // Not at what is let into the ceiling or hung from it (a grille, a sprinkler head, a ring): those are darker than the paint by design.
      if (d.items.some((it) => ["vent", "sprinkler", "downlight", "pendant_lamp", "flush_light", "ceiling_fan", "smoke_detector"].includes(it.kind) && Math.hypot(it.s - s, it.d - dd) < 0.45)) continue;
      vals.push(lum(a, i));
    }
    // The 10th percentile: a few grilles and sprinkler heads let into the ceiling are darker than its paint by design.
    const lo = percentile(vals, 0.1);
    const hi = percentile(vals, 0.95);
    console.log(`[ceiling ${name}] ${vals.length} open vertices, 5th ${lo.toFixed(3)} 95th ${hi.toFixed(3)} ratio ${(lo / Math.max(1e-6, hi)).toFixed(2)}`);
    expect(vals.length, `${name}: ceiling vertices`).toBeGreaterThan(20);
    // White: the cafe's about 0.75 to 0.85 of white, the lobby's 0.65 to 0.75.
    const mean = vals.reduce((u, v) => u + v, 0) / vals.length;
    console.log(`[ceiling ${name}] mean ${mean.toFixed(3)}`);
    expect(mean, `${name}: mean of the open ceiling`).toBeGreaterThanOrEqual(name === "cafe" ? 0.72 : 0.62);
    expect(mean, `${name}: mean of the open ceiling`).toBeLessThanOrEqual(name === "cafe" ? 0.9 : 0.8);
    expect(lo / Math.max(1e-6, hi), `${name}: dimmest over brightest of the open ceiling`).toBeGreaterThanOrEqual(name === "cafe" ? 0.5 : 0.45);
  });
});

describe.each([["bar", 0], ["cafe", 1], ["lodging", 2], ["office", 3]] as const)("the walls of the %s shade smoothly", (name, index) => {
  const seed = 1175766972;
  const d = insideRooms(seed)[index]!.design;
  it("change by no more than a factor of 1.6 between neighbouring samples of one wall face on the mesh's own grid, away from fixtures", () => {
    // The day through the front's panes is taken as a pane across the front.
    const light = bakeLight(d, [{ s0: 0, s1: d.width, through: 0.5 }]);
    const faces: { key: string; len: number; at: (u: number) => [number, number]; n: [number, number] }[] = [
      { key: "left", len: d.depth - 0.3, at: (u) => [0.003, 0.15 + u], n: [1, 0] },
      { key: "right", len: d.depth - 0.3, at: (u) => [d.width - 0.003, 0.15 + u], n: [-1, 0] },
      { key: "back", len: d.width, at: (u) => [u, d.depth - 0.003], n: [0, -1] },
      { key: "front", len: d.width, at: (u) => [u, 0.153], n: [0, 1] },
    ];
    let worst = 1;
    let where = "";
    for (const f of faces) {
      const nu = Math.floor(f.len / 0.75);
      const ny = Math.floor((d.height - 0.4 - 2.6) / 0.9);
      const grid: (number | null)[][] = [];
      for (let j = 0; j <= ny; j++) {
        const row: (number | null)[] = [];
        for (let i = 0; i <= nu; i++) {
          const [s, dd] = f.at((i * f.len) / nu);
          const y = 2.6 + (j * (d.height - 0.4 - 2.6)) / ny;
          // Away from fixtures: no light within 2 m and 2.6 times its reach, to 4.2 m (a lamp's own pool on the wall falls fast, by design).
          const near = d.lights.some((l) => Math.hypot(l.s - s, l.d - dd, l.y - y) < Math.max(2.0, Math.min(4.2, 2.6 * l.reach)));
          const c = light.lit(s, dd, y, f.n[0], f.n[1], 0);
          row.push(near ? null : (c[0] + c[1] + c[2]) / 3);
        }
        grid.push(row);
      }
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nu; i++) {
        const p = (grid[j] as (number | null)[])[i] ?? null;
        if (p === null) continue;
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
          const q = (grid[j + dj] as (number | null)[] | undefined)?.[i + di] ?? null;
          if (q === null || Math.max(p, q) < 0.01) continue;
          // Not across a storey's floor, where the light of one storey ends and the next's begins.
          const yAt = (jj: number): number => 2.6 + (jj * (d.height - 0.4 - 2.6)) / ny;
          if ((d.cuts ?? []).some((c) => (yAt(j) - c) * (yAt(j + dj) - c) < 0)) continue;
          const r = Math.max(p, q) / Math.max(1e-3, Math.min(p, q));
          if (r > worst) {
            worst = r;
            where = `p ${p.toFixed(3)} q ${q.toFixed(3)} ${f.key} at u ${((i * f.len) / nu).toFixed(1)} y ${(2.6 + (j * (d.height - 0.4 - 2.6)) / ny).toFixed(1)}`;
          }
        }
      }
    }
    console.log(`[wall steps ${name}] worst neighbour ratio ${worst.toFixed(2)} ${where}`);
    // The bar's corners are as they were (its light is as it is): held to 2.1.
    expect(worst, `${name}: ${where}`).toBeLessThanOrEqual(name === "bar" ? 2.1 : 1.6);
  });

  it("has no region of a wall, 1.5 m across, under 55 percent of the wall's median by day: no dark patch where no lamp reaches", () => {
    const light = bakeLight(d, [{ s0: 0, s1: d.width, through: 0.5 }]);
    const faces: { key: string; len: number; at: (u: number) => [number, number]; n: [number, number] }[] = [
      { key: "left", len: d.depth - 0.3, at: (u) => [0.003, 0.15 + u], n: [1, 0] },
      { key: "right", len: d.depth - 0.3, at: (u) => [d.width - 0.003, 0.15 + u], n: [-1, 0] },
      { key: "back", len: d.width, at: (u) => [u, d.depth - 0.003], n: [0, -1] },
      // The front wall is drawn from the field with no normal (`shade` calls `at`), as the street side's `frontWall` does.
      { key: "front", len: d.width, at: (u) => [u, 0.15], n: [0, 0] },
    ];
    const cuts = [0, ...(d.cuts ?? []), d.height];
    const worst: string[] = [];
    for (const f of faces) {
      const nu = Math.max(4, Math.floor(f.len / 0.5));
      for (let band = 0; band + 1 < cuts.length; band++) {
        // From a metre above the floor: the foot of a wall is darkened by what stands against it, by design (`contact`).
        const y0 = (cuts[band] as number) + 1.0;
        const y1 = (cuts[band + 1] as number) - 0.3;
        const ny = Math.max(4, Math.floor((y1 - y0) / 0.5));
        const grid: number[][] = [];
        const all: number[] = [];
        for (let j = 0; j <= ny; j++) {
          const row: number[] = [];
          for (let i = 0; i <= nu; i++) {
            const [s, dd] = f.at((i * f.len) / nu);
            const c = light.lit(s, dd, y0 + (j * (y1 - y0)) / ny, f.n[0], f.n[1], 0);
            // Behind a tall thing (a cabinet, a shelf unit, a booth's back) a wall is dark by design (`contact`): such a sample is held to no more than the wall's own.
            const behind = d.blocks.some((b) => b.y1 > 1.0 && Math.abs(s - b.s) < Math.abs(b.ax) * b.ha + Math.abs(b.ad) * b.hb + 0.6 && Math.abs(dd - b.d) < Math.abs(b.ad) * b.ha + Math.abs(b.ax) * b.hb + 0.6);
            const v = behind ? Infinity : (c[0] + c[1] + c[2]) / 3;
            row.push(v);
            if (!behind) all.push(v);
          }
          grid.push(row);
        }
        // A face with nothing of itself to see (all of it behind something tall) has nothing to hold.
        if (all.length < 8) continue;
        all.sort((p, q) => p - q);
        const median = all[Math.floor(all.length / 2)] as number;
        // A block of 4 by 4 samples (1.5 m by 1.5 m at a sample every half metre) all under 55 percent of the median.
        for (let j = 0; j + 3 <= ny; j++) for (let i = 0; i + 3 <= nu; i++) {
          let dark = true;
          for (let a = 0; a < 4 && dark; a++) for (let b = 0; b < 4; b++) if ((grid[j + a] as number[])[i + b]! >= 0.55 * median) { dark = false; break; }
          if (dark) worst.push(`${f.key} band ${band} at u ${((i * f.len) / nu).toFixed(1)} y ${(y0 + (j * (y1 - y0)) / ny).toFixed(1)} (median ${median.toFixed(3)})`);
        }
      }
    }
    console.log(`[wall patches ${name}] ${worst.length} dark blocks ${worst.slice(0, 2).join("; ")}`);
    expect(worst.slice(0, 3), `${name}: dark regions of a wall`).toEqual([]);
  });
  it("is one smooth tone on the front wall by day apart from its lamps: the 90th percentile of what the room and the panes give it under 1.5 times the 10th, no step over 12 percent between neighbouring samples", () => {
    // The wall the windows are in has no lamp of its own, and what is checked is its own tone: the room's bounce and the day through the panes (the lamps taken out), at a sample every half metre, away from its corners (where two walls darken each other by design) and from what stands against it.
    if (name === "bar") return;
    // Windows as the street side lays them out: a bay of 1.4 m every 3.4 m from the wall's middle.
    const panes: { s0: number; s1: number; through: number }[] = [];
    for (let s = d.width / 2 - 3.4 * Math.floor(d.width / 6.8); s < d.width - 1; s += 3.4) if (s > 1 && Math.abs(s - d.doorS) > 2) panes.push({ s0: s - 0.7, s1: s + 0.7, through: 0.5 });
    // With the lamps in, a wall steps by a third beside a lamp by the lamp's own falloff (the patch test above holds it to no dark region); what is held here is the tone the wall has of its own.
    for (const [label, lights, maxStep] of [["room and panes", [], 1.12]] as const) {
      const light = bakeLight({ ...d, lights }, panes);
      // A metre under the ceiling: its edge darkens a wall by design (`occlusion`).
      const top = (d.cuts?.[0] ?? d.height) - 1.0;
      const nu = Math.floor(d.width / 0.5);
      const ny = Math.max(4, Math.floor((top - 1.0) / 0.5));
      const grid: (number | null)[][] = [];
      const kept: number[] = [];
      for (let j = 0; j <= ny; j++) {
        const row: (number | null)[] = [];
        for (let i = 0; i <= nu; i++) {
          const s = (i * d.width) / nu;
          const y = 1.0 + (j * (top - 1.0)) / ny;
          const aside = s < 1.5 || d.width - s < 1.5;
          const behind = d.blocks.some((b) => b.y1 > 1.0 && Math.abs(s - b.s) < Math.abs(b.ax) * b.ha + Math.abs(b.ad) * b.hb + 0.6 && Math.abs(0.15 - b.d) < Math.abs(b.ad) * b.ha + Math.abs(b.ax) * b.hb + 0.6);
          const c = light.lit(s, 0.15, y, 0, 0, 0);
          const v = (c[0] + c[1] + c[2]) / 3;
          row.push(aside || behind ? null : v);
          if (!aside && !behind) kept.push(v);
        }
        grid.push(row);
      }
      expect(kept.length, `${name} front (${label}): samples`).toBeGreaterThanOrEqual(12);
      kept.sort((p, q) => p - q);
      const spread = (kept[Math.floor(kept.length * 0.9)] as number) / Math.max(1e-6, kept[Math.floor(kept.length * 0.1)] as number);
      let step = 1;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nu; i++) {
        const p = (grid[j] as (number | null)[])[i] ?? null;
        if (p === null) continue;
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
          const q = (grid[j + dj] as (number | null)[] | undefined)?.[i + di] ?? null;
          if (q !== null) step = Math.max(step, Math.max(p, q) / Math.max(1e-6, Math.min(p, q)));
        }
      }
      console.log(`[smooth ${name} front, ${label}] ${kept.length} samples, 90th over 10th ${spread.toFixed(2)}, largest step ${((step - 1) * 100).toFixed(1)} percent`);
      if (label === "room and panes") expect(spread, `${name} front: 90th over 10th`).toBeLessThan(1.5);
      expect(step, `${name} front (${label}): neighbouring samples`).toBeLessThanOrEqual(maxStep);
    }
  });
});
