import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { buildingLevels } from "../../src/game/town/buildingGeometry.js";
import { FLOOR_LIFT } from "../../src/game/town/insideGeometry.js";
import { MeshBuilder, isUnbacked, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { groundOf, meshOf } from "./roomMeshes.js";
import { DOOR_TICKS, GOING_IN, GOING_OUT, INSIDE, OUTSIDE, insideRooms } from "../../src/sim/inside/rooms.js";
import { hidesTown, insidePeople, wantedOf, whereOf } from "../../src/game/town/insideParts.js";

const SEEDS = [20261121, 1175766972];
/** A vertex may lie this far outside the room's box: a hanging thing's or a trim's own thickness, and the recess of the back room's doorway is allowed on top of the depth. */
const MARGIN = 0.1;
/** The most vertices a room may take: the designed bar, cafe and lodging and the municipal hall each have their own (40,000, 40,000, 60,000 and 80,000). */
const BUDGET: Readonly<Record<string, number>> = { bar: 46000, cafe: 40000, lodging: 74000, office: 80000 };

const pos = (a: MeshArrays, i: number): [number, number, number] => [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];

describe("the hidden rooms", () => {
  for (const seed of SEEDS) {
    const g = groundOf(seed);
    const rooms = insideRooms(seed);
    it(`seed ${seed} has rooms`, () => {
      expect(rooms.length).toBeGreaterThan(0);
    });
    for (const [index, room] of rooms.entries()) {
      describe(`seed ${seed} ${room.name}`, () => {
        const t0 = performance.now();
        const a = meshOf(seed, index);
        const ms = performance.now() - t0;
        const verts = a.positions.length / 3;
        it("is built and reports its size", () => {
          console.log(`[inside] seed ${seed} ${room.name}: ${verts} vertices, ${a.indices.length / 3} triangles, ${ms.toFixed(0)} ms`);
          expect(verts).toBeGreaterThan(0);
          expect(verts).toBeLessThan(BUDGET[room.name] as number);
        });
        it("is in the room's own frame", () => {
          const xf = buildingLevels(g, g.plan.buildings[room.building]!).xf!;
          for (const k of ["ox", "oz", "nx", "nz", "tx", "tz"] as const) expect(Math.abs(xf[k] - room[k])).toBeLessThan(0.01);
        });
        it("lies inside the room's box", () => {
          let bad = 0;
          for (let i = 0; i < verts; i++) {
            const [x, y, z] = pos(a, i);
            const dx = x - room.ox, dz = z - room.oz;
            const s = dx * room.tx + dz * room.tz;
            const d = -(dx * room.nx + dz * room.nz);
            const yy = y - room.floorY;
            // The back room's doorway goes up to 1.6 m past the back wall.
            if (s < room.s0 - MARGIN || s > room.s1 + MARGIN || d < -MARGIN || d > room.depth + 1.7 || yy < -FLOOR_LIFT - MARGIN || yy > room.ceiling + MARGIN) bad++;
          }
          expect(bad).toBe(0);
        });
        it("draws its floor at the floor the player stands on", () => {
          // The floor is the lowest large upward-facing surface: find vertices with normal up whose heights cluster at the floor.
          let found = false;
          for (let i = 0; i < verts && !found; i++) if (a.normals[i * 3 + 1]! > 0.99 && Math.abs(a.positions[i * 3 + 1]! - room.floorY) < 1e-4) found = true;
          expect(found).toBe(true);
        });
        it("is closed: every triangle has its back", () => {
          const key = (p: [number, number, number]): string => p.map((v) => Math.round(v * 1000)).join(",");
          const tris = new Map<string, number>();
          for (let t = 0; t < a.indices.length; t += 3) {
            const ks = [0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)));
            // The winding as a rotation of the three corners.
            const rots = [ks.join("|"), [ks[1], ks[2], ks[0]].join("|"), [ks[2], ks[0], ks[1]].join("|")];
            const canon = rots.sort()[0] as string;
            tris.set(canon, (tris.get(canon) ?? 0) + 1);
          }
          let unpaired = 0;
          for (let t = 0; t < a.indices.length; t += 3) {
            // A face of a solid (a box, a slab, a flight) has no back: its inside is never seen.
            if (isUnbacked(a.indices, t / 3)) continue;
            const ks = [0, 1, 2].map((k) => key(pos(a, a.indices[t + k] as number)));
            const rev = [ks[2], ks[1], ks[0]];
            const canon = [rev.join("|"), [rev[1], rev[2], rev[0]].join("|"), [rev[2], rev[0], rev[1]].join("|")].sort()[0] as string;
            if (!tris.has(canon)) unpaired++;
          }
          expect(unpaired).toBe(0);
        });
      });
    }
  }
  it("the plain builder lays no backs", () => {
    const m = new MeshBuilder();
    m.poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]], [0, 0, 1], [1, 1, 1], "painted");
    expect(m.triangles).toBe(1);
    const w = new MeshBuilder(true);
    w.poly([[0, 0, 0], [1, 0, 0], [1, 1, 0]], [0, 0, 1], [1, 1, 1], "painted");
    expect(w.triangles).toBe(2);
  });
});

describe("where the local player is by the rooms", () => {
  const at = (phase: 0 | 1 | 2 | 3, ticks = 0) => ({ place: 2, phase, ticks });
  it("builds the room once the screen is dark, and keeps it until the player is out", () => {
    expect(wantedOf(undefined)).toBe(0);
    expect(wantedOf(at(OUTSIDE))).toBe(0);
    expect(wantedOf(at(GOING_IN, DOOR_TICKS))).toBe(0);
    expect(wantedOf(at(GOING_IN, DOOR_TICKS - 12))).toBe(2);
    expect(wantedOf(at(INSIDE))).toBe(2);
    expect(wantedOf(at(GOING_OUT, 5))).toBe(2);
  });
  it("is where a room is only inside it or on the way out, and hides the town only inside", () => {
    expect(whereOf(at(GOING_IN, 3))).toBe(0);
    expect(whereOf(at(INSIDE))).toBe(2);
    expect(whereOf(at(GOING_OUT))).toBe(2);
    expect(hidesTown(at(INSIDE))).toBe(true);
    expect(hidesTown(at(GOING_OUT))).toBe(false);
    expect(hidesTown(at(GOING_IN, 3))).toBe(false);
  });
  it("stands people in the rooms over the whole room, on the floor", () => {
    for (const seed of SEEDS) {
      const people = insidePeople(groundOf(seed));
      console.log(`[inside] seed ${seed}: ${people.length} people in the hidden rooms`);
      for (const p of people) {
        const room = insideRooms(seed).find((r) => r.id === p.room)!;
        // On the floor of the room, or on a floor of its own above it (the municipal hall's second floor).
        const levels = room.design.people.map((q) => Math.round((room.floorY + (q.y ?? 0)) * 1000));
        expect(levels, `a person at y ${p.at.y}`).toContain(Math.round(p.at.y * 1000));
      }
    }
  });
});
