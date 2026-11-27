import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { unnamed } from "../../src/game/town/materials.js";
import { designMesh, RISER } from "../../src/game/town/designGeometry.js";
import { insideGeometry } from "../../src/game/town/insideGeometry.js";
import type { MeshArrays } from "../../src/game/town/meshBuilder.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { GALLERY, STAIR_FROM, STAIR_TO, testDesign } from "../inside/designHelpers.js";

/** The game's seeds, and seeds 1 to 24. */
const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
const SEEDS = [...GAME_SEEDS, ...Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => !GAME_SEEDS.includes(s))];
/** A vertex of a designed room lies this far outside its box at most: a casing, a frame's bar or a thing's own thickness proud of a wall. */
const MARGIN = 0.1;
const BAR_BUDGET = 30000;

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

describe("the bar's design drawn, on every test seed", () => {
  const lines: string[] = [];
  it("builds on every seed inside its box, with its backs, under the budget, naming every material", () => {
    for (const seed of SEEDS) {
      const g = townGround(seed);
      const room = insideRooms(seed)[0]!;
      expect(room.design.legacy).toBe(false);
      const before = unnamed.polygons;
      const t0 = performance.now();
      const a = insideGeometry(g, room, "full");
      const ms = performance.now() - t0;
      const verts = a.positions.length / 3;
      const label = `seed ${seed}`;
      expect(unnamed.polygons, `${label}: polygons that name no material`).toBe(before);
      expect(verts, `${label}: vertices`).toBeGreaterThan(2000);
      expect(verts, `${label}: vertices`).toBeLessThan(BAR_BUDGET);
      let outside = 0;
      for (let i = 0; i < verts; i++) {
        const [x, y, z] = pos(a, i);
        const dx = x - room.ox;
        const dz = z - room.oz;
        const s = dx * room.tx + dz * room.tz - room.s0;
        const d = -(dx * room.nx + dz * room.nz);
        const yy = y - room.floorY;
        if (s < -MARGIN || s > room.design.width + MARGIN || d < -MARGIN || d > room.depth + MARGIN || yy < -1e-4 || yy > room.ceiling + 1e-4) outside++;
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
    console.log(`[bar drawn]\n${lines.join("\n")}`);
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
