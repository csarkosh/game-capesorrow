import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { designMesh } from "../../src/game/town/designGeometry.js";
import { PANE_SETBACK } from "../../src/game/town/roomGlass.js";
import { FACE_D } from "../../src/game/town/roomKit.js";
import { INTERIOR_SET, ROOM_DAY_FROM, ROOM_NIGHT_BELOW, ROOM_NIGHT_CODE, townSurfaceCode } from "../../src/game/town/townMaterial.js";
import { meshOf } from "./roomMeshes.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { testDesign } from "../inside/designHelpers.js";

const SEED = 1175766972;

/** The sheets of a through layer as quads: its corners in the room's frame (`s`, `d`, height over the floor). */
function quads(room: ReturnType<typeof insideRooms>[number], a: { positions: Float32Array; indices: Uint32Array }): { s0: number; s1: number; d: number; y0: number; y1: number; ds: number }[] {
  const out: { s0: number; s1: number; d: number; y0: number; y1: number; ds: number }[] = [];
  const at = (i: number): [number, number, number] => {
    const dx = (a.positions[i * 3] as number) - room.ox;
    const dz = (a.positions[i * 3 + 2] as number) - room.oz;
    return [dx * room.tx + dz * room.tz - room.s0, -(dx * room.nx + dz * room.nz), (a.positions[i * 3 + 1] as number) - room.floorY];
  };
  // Every pane is two triangles on four vertices: its extent is its vertices'.
  const n = a.positions.length / 3;
  for (let i = 0; i + 3 < n; i += 4) {
    const p = [0, 1, 2, 3].map((k) => at(i + k));
    out.push({ s0: Math.min(...p.map((v) => v[0])), s1: Math.max(...p.map((v) => v[0])), d: p[0]![1], y0: Math.min(...p.map((v) => v[2])), y1: Math.max(...p.map((v) => v[2])), ds: Math.max(...p.map((v) => Math.abs(v[1] - p[0]![1]))) });
  }
  return out;
}

describe("the panes of the rooms, seen from inside", () => {
  it("make a glass layer on every room that has a pane, and none where a room has none", () => {
    for (const room of insideRooms(SEED)) {
      const a = meshOf(SEED, insideRooms(SEED).indexOf(room), true);
      expect(a.through, `${room.name}: the layer of panes`).not.toBeNull();
      expect((a.through?.positions.length ?? 0) / 3, `${room.name}: panes`).toBeGreaterThanOrEqual(8);
      // Without it the room has no layer of its own for panes, and its windows are the sheets they were.
      const plain = meshOf(SEED, insideRooms(SEED).indexOf(room));
      expect(plain.through ?? null, `${room.name}: no glass asked for`).toBeNull();
    }
    // A room whose front is no front (a design drawn with none) and that has no window in its walls has none.
    const d = testDesign();
    const bare = designMesh({ design: d, xf: { ox: 0, oz: 0, tx: 1, tz: 0, nx: 0, nz: -1, width: d.width, depth: d.depth } as never, floorY: 0, seed: 1, hours: null, detail: "full", front: null, glass: true });
    expect(bare.through).toBeNull();
  }, timeLimit(120_000));

  it("lie in their openings: the cafe's front panes on the street side's windows and its door, set back into the wall, and the lodging's and the office's back-wall windows in theirs", () => {
    const rooms = insideRooms(SEED);
    const g = (n: number) => meshOf(SEED, n, true);
    // The front: every pane is on a plane 10 cm behind the wall's face (3 cm for a door's glass) and the room's width and height hold it.
    for (const index of [0, 1, 2, 3]) {
      const room = rooms[index]!;
      const a = g(index);
      for (const q of quads(room, a.through as NonNullable<typeof a.through>)) {
        const front = Math.abs(q.d - (FACE_D - PANE_SETBACK)) < 0.003 || Math.abs(q.d - (FACE_D - 0.03)) < 0.003;
        const back = Math.abs(q.d - (room.design.depth + PANE_SETBACK)) < 0.003;
        const side = q.s1 - q.s0 < 0.003;
        expect(front || back || side, `${room.name}: a pane at d ${q.d.toFixed(3)}`).toBe(true);
        expect(q.ds, `${room.name}: the pane is flat`).toBeLessThan(0.003);
        if (!side) {
          expect(q.s0).toBeGreaterThanOrEqual(-0.2);
          expect(q.s1).toBeLessThanOrEqual(room.design.width + 0.2);
        }
        expect(q.y0).toBeGreaterThanOrEqual(-0.01);
        expect(q.y1).toBeLessThanOrEqual(room.design.height + 0.01);
      }
    }
    // The back windows: each design window has a pane in it, and nothing of the wall's own mesh is laid over it.
    for (const index of [2, 3]) {
      const room = rooms[index]!;
      const d = room.design;
      expect((d.windows ?? []).length, `${room.name}: its windows`).toBeGreaterThanOrEqual(1);
      const a = g(index);
      const qs = quads(room, a.through as NonNullable<typeof a.through>);
      for (const w of d.windows ?? []) {
        const hit = qs.some((q) => Math.abs(q.d - (d.depth + PANE_SETBACK)) < 0.003 && Math.abs(q.s0 - w.a0) < 0.01 && Math.abs(q.s1 - w.a1) < 0.01 && Math.abs(q.y0 - w.y0) < 0.01 && Math.abs(q.y1 - w.y1) < 0.01);
        expect(hit, `${room.name}: a pane in the window ${JSON.stringify(w)}`).toBe(true);
        // The room's own mesh has no vertex of the back wall inside the opening (it is cut away).
        const main = a;
        for (let i = 0; i < main.positions.length / 3; i++) {
          const dx = (main.positions[i * 3] as number) - room.ox;
          const dz = (main.positions[i * 3 + 2] as number) - room.oz;
          const s = dx * room.tx + dz * room.tz - room.s0;
          const dd = -(dx * room.nx + dz * room.nz);
          const y = (main.positions[i * 3 + 1] as number) - room.floorY;
          if (Math.abs(dd - d.depth) < 0.003 && s > w.a0 + 0.01 && s < w.a1 - 0.01 && y > w.y0 + 0.01 && y < w.y1 - 0.01) throw new Error(`${room.name}: a wall vertex inside the window at s ${s.toFixed(2)} y ${y.toFixed(2)}`);
        }
      }
    }
  }, timeLimit(120_000));

  it("mix a room's two colours by how bright it is outside, from the air's own colour and no clock of its own, on the rooms' material alone", () => {
    const rooms = townSurfaceCode(false, false, false, INTERIOR_SET);
    expect(rooms).toContain("atmFarColour");
    // The mix reads the air and nothing else: no hour, no clock (the unit's hours that dim a shut shop's lamps are another part of the surface code and stay).
    expect(ROOM_NIGHT_CODE).not.toContain("townHour");
    expect(ROOM_NIGHT_CODE).not.toContain("townDay");
    expect(rooms).toContain("tsRr");
    // The town's own surface code has none of it.
    expect(townSurfaceCode(false)).not.toContain("tsRr");
    // The air's mean far colour: 0.03 to 0.04 at night in any weather, 0.28 in heavy rain and 0.40 under the game's overcast at noon, 0.56 at clear noon (measured under the engine's sky).
    expect(ROOM_NIGHT_BELOW).toBeGreaterThan(0.036);
    expect(ROOM_DAY_FROM).toBeLessThanOrEqual(0.56);
    expect(ROOM_DAY_FROM).toBeGreaterThan(0.4);
  });
});
