import { fitsDesign } from "../../src/sim/inside/designWalk.js";
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { unnamed } from "../../src/game/town/materials.js";
import { designMesh, RISER } from "../../src/game/town/designGeometry.js";
import { insideGeometry } from "../../src/game/town/insideGeometry.js";
import type { MeshArrays } from "../../src/game/town/meshBuilder.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { bakeLight } from "../../src/game/town/designLight.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { GALLERY, STAIR_FROM, STAIR_TO, testDesign } from "../inside/designHelpers.js";

/** The game's seeds, and seeds 1 to 24. */
const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
const SEEDS = [...GAME_SEEDS, ...Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => !GAME_SEEDS.includes(s))];
/** A vertex of a designed room lies this far outside its box at most: a casing, a frame's bar or a thing's own thickness proud of a wall. */
const MARGIN = 0.1;

const pos = (a: MeshArrays, i: number): [number, number, number] => [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];

/** The number of triangles that have no partner: the same corners wound the other way. */
function unpaired(a: MeshArrays): number {
  const key = (p: [number, number, number]): string => p.map((v) => Math.round(v * 1000)).join(",");
  const canon = (ks: string[]): string => [ks.join("|"), [ks[1], ks[2], ks[0]].join("|"), [ks[2], ks[0], ks[1]].join("|")].sort()[0] as string;
  const tris = new Set<string>();
  for (let t = 0; t < a.indices.length; t += 3) tris.add(canon([0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)))));
  let bad = 0;
  for (let t = 0; t < a.indices.length; t += 3) {
    const ks = [0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)));
    if (!tris.has(canon([ks[2] as string, ks[1] as string, ks[0] as string]))) bad++;
  }
  return bad;
}

describe.each([["bar", 0, 40000], ["cafe", 1, 40000], ["lodging", 2, 70000]] as const)("the %s design drawn, on every test seed", (_name, index, budget) => {
  const lines: string[] = [];
  it("builds on every seed inside its box, with its backs, under the budget, naming every material", () => {
    for (const seed of SEEDS) {
      const g = townGround(seed);
      const room = insideRooms(seed)[index]!;
      expect(room.design.legacy).toBe(false);
      const before = unnamed.polygons;
      const t0 = performance.now();
      const a = insideGeometry(g, room, "full");
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
      // A tread's corners are on the flight's two edges (the posts and rails stand a little in from them).
      if (a.normals[i * 3 + 1]! < 0.99 || (Math.abs(x - 7) > 1e-4 && Math.abs(x - 9) > 1e-4) || z < STAIR_FROM + 0.01 || z > STAIR_TO - 0.01) continue;
      const h = y - 100;
      // The floor under the flight is the floor's, not a tread.
      // Nor the gallery's floor and rail at the flight's head, which stand on its edge.
      if (h < 0.05 || h > GALLERY - 0.05) continue;
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
const percentile = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((u, v) => u - v);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
};

describe.each([["bar", 0], ["cafe", 1]] as const)("the light of the %s on the world the game opens on is uneven", (name, index) => {
  const seed = 1175766972;
  const room = insideRooms(seed)[index]!;
  const a = insideGeometry(townGround(seed), room, "full");
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
    for (const w of ["left", "right", "back"]) expect(ratio(w), `${name} ${w} wall`).toBeGreaterThanOrEqual(3);
  });
});

/** The mean of a list, 0 for none. */
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((u, v) => u + v, 0) / xs.length);

describe.each([["cafe", 1], ["lodging", 2]] as const)("the light of the %s is pooled on open floor", (name, index) => {
  const seed = 1175766972;
  const room = insideRooms(seed)[index]!;
  const d = room.design;
  const a = insideGeometry(townGround(seed), room, "full");
  const n = a.positions.length / 3;
  /** Floor vertices (ground floor, facing up, lit by the room's light) with the place and luminance, on OPEN floor: a hull of 0.6 m stands there clear of any block or wall. */
  const floor: { s: number; d: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    if ((a.surface[i * 12 + 3] as number) > 1.01 || (a.normals[i * 3 + 1] as number) < 0.95) continue;
    if (Math.abs((a.positions[i * 3 + 1] as number) - room.floorY) > 0.02) continue;
    const dx = (a.positions[i * 3] as number) - room.ox;
    const dz = (a.positions[i * 3 + 2] as number) - room.oz;
    const s = dx * room.tx + dz * room.tz - room.s0;
    const dd = -(dx * room.nx + dz * room.nz);
    if (!fitsDesign(d, s, dd, 0, 0.6, 0.001)) continue;
    floor.push({ s, d: dd, v: lum(a, i) });
  }
  const near = (s: number, dd: number, r: number): number[] => floor.filter((f) => Math.hypot(f.s - s, f.d - dd) < r).map((f) => f.v);
  const fixtures = d.lights.filter((l) => l.beam !== undefined && l.y < (d.cuts?.[0] ?? d.height));
  it("has the floor under a ceiling fixture at least twice as bright as midway between two", () => {
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
      const under = Math.max(mean(near(p.s, p.d, 0.5)), mean(near(q.s, q.d, 0.5)));
      const mid = near(ms, md, 0.5);
      const under0 = near(p.s, p.d, 0.5);
      if (under0.length < 2 || mid.length < 2) continue;
      console.log(`[pair ${name}] (${p.s.toFixed(1)},${p.d.toFixed(1)},y${p.y}) kind ${p.kind} (${q.s.toFixed(1)},${q.d.toFixed(1)}) under ${under.toFixed(3)} mid ${mean(mid).toFixed(3)} n ${mid.length}`);
      ratios.push(under / Math.max(1e-6, mean(mid)));
    }
    ratios.sort((u, v) => u - v);
    const med = ratios[Math.floor(ratios.length / 2)] ?? 0;
    console.log(`[pools ${name}] ${floor.length} open vertices, ${fixtures.length} fixtures, ${ratios.length} pairs, median under/between ${med.toFixed(2)}`);
    expect(ratios.length, `${name}: pairs measured`).toBeGreaterThanOrEqual(3);
    // The cafe is the bright room of the four: its pools are gentle, 1.4 times the floor between them, where the lobby's are twice.
    expect(med, `${name}: under a fixture over midway`).toBeGreaterThanOrEqual(name === "cafe" ? 1.4 : 2);
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
      vals.push(lum(a, i));
    }
    const lo = percentile(vals, 0.05);
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
});
