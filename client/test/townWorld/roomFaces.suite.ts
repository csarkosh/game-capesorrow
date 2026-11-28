// No two faces of a designed room are left for the depth buffer to tell apart (`roomFaces.ts` says what is counted and how near is too near), on the heavy seeds: its own mesh, its layer of
// through glass and the street outside, taken together, for each of the four rooms.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { HEAVY_SEEDS } from "../inside/seeds.js";
import { roomPatches } from "./roomFaces.js";

describe("the rooms' faces are held apart", () => {
  for (const seed of HEAVY_SEEDS) {
    it(`seed ${seed}: no two faces that look the same way overlap within 3 mm, in any of the four rooms`, () => {
      const rooms = insideRooms(seed);
      const found: string[] = [];
      for (let index = 0; index < rooms.length; index++) {
        const quick = roomPatches(seed, index, false);
        if (quick.length === 0) continue;
        // Again with the builders' trace on, to say where each came from.
        for (const p of roomPatches(seed, index, true).slice(0, 6)) found.push(`room ${index} (${rooms[index]?.design.name}) at ${p.patch.at.map((x) => x.toFixed(1)).join(",")}, ${(p.patch.gap * 1000).toFixed(1)} mm apart, ${(p.patch.area * 1e4).toFixed(0)} cm2: ${p.where}`);
      }
      expect(found, found.join("\n")).toEqual([]);
    });
  }
});
