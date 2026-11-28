import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { underside } from "../../src/game/town/designGeometry.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { meshOf } from "./roomMeshes.js";

/** What is hung from or let into the ceiling at one place, and so has a wire, a stem or a rod there: nothing of it may stand above the underside of what is over that place. */
const HUNG = ["pendant_lamp", "glass_ball", "ceiling_fan", "flush_light"];

describe("what hangs from a ceiling", () => {
  it("is drawn under the surface above it: no wire, stem or rod stands up through a slab", () => {
    let checked = 0;
    for (const seed of [1175766972, 20261121, 1, 6]) {
      for (const [index, room] of insideRooms(seed).entries()) {
        const d = room.design;
        const a = meshOf(seed, index);
        const items = d.items.filter((it) => HUNG.includes(it.kind));
        if (items.length === 0) continue;
        // Every vertex in the room's frame, once.
        const n = a.positions.length / 3;
        const vs: number[] = new Array(n);
        const vd: number[] = new Array(n);
        const vy: number[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const dx = (a.positions[i * 3] as number) - room.ox;
          const dz = (a.positions[i * 3 + 2] as number) - room.oz;
          vs[i] = dx * room.tx + dz * room.tz - room.s0;
          vd[i] = -(dx * room.nx + dz * room.nz);
          vy[i] = (a.positions[i * 3 + 1] as number) - room.floorY;
        }
        for (const it of items) {
          const y = it.y ?? 0;
          const top = underside(d, it.s, it.d, y);
          // A thing's own stem is within a centimetre of its place; the ball's wire, the lamp's rod.
          for (let i = 0; i < n; i++) {
            // A wire or a rod is a thin upright: faces round it, with no face up or down.
            if (Math.abs((vs[i] as number) - it.s) > 0.02 || Math.abs((vd[i] as number) - it.d) > 0.02 || Math.abs(a.normals[i * 3 + 1] as number) > 0.2) continue;
            expect(vy[i] as number, `seed ${seed} ${room.name}: a ${it.kind} at ${it.s}, ${it.d} has geometry at ${(vy[i] as number).toFixed(2)} over a ceiling of ${top.toFixed(2)}`).toBeLessThanOrEqual(top + 0.02);
          }
          checked++;
        }
      }
    }
    console.log(`[hung] ${checked} hung items checked`);
    expect(checked).toBeGreaterThan(30);
  }, timeLimit(300_000));
});
