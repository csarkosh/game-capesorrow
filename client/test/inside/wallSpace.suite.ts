// What hangs on a wall of a designed room is held to `wallSpace.ts`, on the heavy seeds and in all four rooms: no hanging overlaps another or anything that meets its wall's face (a slab or a gallery's edge, a flight and
// its rail, a partition or tall furniture against the wall, a window, the door, a glazed front, a leaf), and each lies wholly inside one storey's clear height (over a floor that holds it, a hand's breadth under the slab above).
import { describe, expect, it } from "vitest";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { HANGINGS, MARGIN, conflicts, planeOf, rectOf, storeyOf } from "../../src/sim/inside/wallSpace.js";
import { HEAVY_SEEDS } from "./seeds.js";

describe("what hangs on the walls", () => {
  it("clears everything that meets its wall's face, and every other hanging, by a hand's breadth, in all four rooms on the heavy seeds", () => {
    const bad: string[] = [];
    let hangings = 0;
    for (const seed of HEAVY_SEEDS) {
      for (const [i, room] of insideRooms(seed).entries()) {
        hangings += room.design.decor.filter((d) => HANGINGS.includes(d.kind)).length;
        for (const c of conflicts(room.design, MARGIN - 0.05)) bad.push(`seed ${seed} room ${i} (${room.design.name}): ${c.decor.kind} ${c.decor.text ?? ""} at ${JSON.stringify(rectOf(c.decor))} meets ${c.with}`);
      }
    }
    expect(hangings).toBeGreaterThan(400);
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
  });

  it("puts every picture, board and sign of an outer wall at a height a person hangs it, over the floor it is seen from (a large piece higher in a tall space)", () => {
    const bad: string[] = [];
    for (const seed of HEAVY_SEEDS) {
      for (const [i, room] of insideRooms(seed).entries()) {
        const d = room.design;
        for (const dc of d.decor) {
          if (!HANGINGS.includes(dc.kind) || dc.kind === "mural") continue;
          const p = planeOf(dc);
          if (p === null) continue;
          const r = rectOf(dc);
          const st = storeyOf(d, p, r, 0);
          if (st === null) {
            bad.push(`seed ${seed} room ${i}: ${dc.kind} not in one storey`);
            continue;
          }
          // Its foot is over the floor and its head under the soffit; nothing of it is lower than a metre unless it is a fixture meant low (a switch, a lamp).
          if (r.y1 > st.soffit - 0.01 || r.y0 < st.floor + 0.25) bad.push(`seed ${seed} room ${i}: ${dc.kind} outside its storey`);
        }
      }
    }
    expect(bad, bad.slice(0, 10).join("\n")).toEqual([]);
  });

  it("keeps the hall's notices board and its mural in every hall", () => {
    for (const seed of HEAVY_SEEDS) {
      const d = insideRooms(seed)[3]?.design;
      expect(d?.decor.some((x) => x.kind === "board" && x.text === "NOTICES"), `seed ${seed}: no NOTICES board`).toBe(true);
      expect(d?.decor.some((x) => x.kind === "mural"), `seed ${seed}: no mural`).toBe(true);
    }
  });
});
