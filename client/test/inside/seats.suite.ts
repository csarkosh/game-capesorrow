import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { SEAT_BEHIND, SEAT_FRONT, blocksOverlap, type Block, type Item } from "../../src/sim/inside/design.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { standsAt } from "./designHelpers.js";
import { HEAVY_SEEDS } from "./seeds.js";

/** The height of the top of each seat as its builder draws it (`furniture/`): what a sitting clip's hips are raised to (`CHAIR_CLIP_SEAT` 0.46, `STOOL_CLIP_SEAT` 0.75). */
const SEAT_TOP: Readonly<Record<string, number>> = { chair: 0.46, round_chair: 0.46, shell_chair: 0.47, armchair: 0.45, sofa: 0.45, window_bench: 0.48, stool: 0.76, bistro_stool: 0.76 };

describe("the people of the rooms sit and stand where they can", () => {
  it("sit with their hips at the top of the seat they are on, and on a deep seat with the lower legs in open air", () => {
    let seated = 0;
    let deep = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        for (const p of d.people) {
          if (p.sits === null) continue;
          // The seat: the nearest seat item whose footprint has the person on it.
          let seat: { it: Item; f: number; r: number; hb: number } | null = null;
          let bestScore = Infinity;
          for (const it of d.items) {
            if (SEAT_TOP[it.kind] === undefined || (it.y ?? 0) !== (p.y ?? 0)) continue;
            const dx = p.s - it.s;
            const dd = p.d - it.d;
            const f = dx * it.face.s + dd * it.face.d;
            const r = -dx * it.face.d + dd * it.face.s;
            const ext = it.kind === "sofa" || it.kind === "window_bench" ? (it.p[0] ?? 2) / 2 : 0.4;
            if (Math.abs(f) > 0.5 || Math.abs(r) > ext + 0.1) continue;
            if (Math.abs(f) + Math.abs(r) < bestScore) {
              bestScore = Math.abs(f) + Math.abs(r);
              seat = { it, f, r, hb: ext };
            }
          }
          if (seat === null) continue;
          seated++;
          const label = `seed ${seed} ${room.name}: a ${p.family} sitter at ${p.s}, ${p.d} on a ${seat.it.kind}`;
          expect(Math.abs(p.sits - (SEAT_TOP[seat.it.kind] as number)), `${label}: hips ${p.sits} over a seat top of ${SEAT_TOP[seat.it.kind]}`).toBeLessThanOrEqual(0.03);
          const front = SEAT_FRONT[seat.it.kind];
          if (front === undefined) continue;
          deep++;
          // The hips are 0.1 m behind the seat's front edge, facing out of it.
          expect(Math.abs(seat.f - (front - SEAT_BEHIND)), `${label}: hips at ${seat.f.toFixed(2)} from the middle, the front edge at ${front}`).toBeLessThanOrEqual(0.02);
          expect(p.face, label).toEqual(seat.it.face);
          // The lower legs and feet: from the seat's front edge forward 0.45 m, 0.4 m wide, from the floor to the seat's top: nothing solid there but the floor.
          const it = seat.it;
          const at = front + 0.225;
          const box: Block = { s: it.s + it.face.s * at - it.face.d * seat.r, d: it.d + it.face.d * at + it.face.s * seat.r, ax: it.face.s, ad: it.face.d, ha: 0.225, hb: 0.2, y0: (it.y ?? 0) + 0.02, y1: (it.y ?? 0) + (SEAT_TOP[it.kind] as number) };
          for (const b of d.blocks) if (b.y1 > box.y0 && b.y0 < box.y1) expect(blocksOverlap(b, box, 0), `${label}: a block at ${b.s}, ${b.d} (${b.y0} to ${b.y1}) is in the leg room`).toBe(false);
        }
      }
    }
    console.log(`[seats] ${seated} sitters on a known seat, ${deep} on a deep one`);
    expect(seated).toBeGreaterThan(10);
    expect(deep).toBeGreaterThan(3);
  }, timeLimit(300_000));

  it("stand with their feet on a floor a hull stands on, inside no furniture", () => {
    for (const seed of HEAVY_SEEDS) {
      for (const room of insideRooms(seed)) {
        for (const p of room.design.people) {
          if (p.sits !== null) continue;
          expect(standsAt(room.design, p.s, p.d, p.y ?? 0, 0.2), `seed ${seed} ${room.name}: a person at ${p.s}, ${p.d}, ${p.y ?? 0}`).not.toBeNull();
        }
      }
    }
  }, timeLimit(300_000));
});
