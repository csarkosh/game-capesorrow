// No face of a designed room is left with nothing behind it where an eye can see its back (`roomOpen.ts` says how eyes and rays are taken): on the heavy seeds, in all four rooms. The coplanar finder's
// zero (`roomFaces.suite.ts`) holds beside it: a solid's face in the plane of another's is buried or stood off, never left out.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { HEAVY_SEEDS } from "../inside/seeds.js";
import { meshOf } from "./roomMeshes.js";
import { roomOpenFaces } from "./roomOpen.js";

describe("the rooms have no face open to its back", () => {
  for (const seed of HEAVY_SEEDS) {
    it(`seed ${seed}: from every standable cell, at 1.0 and 1.75 m, in every direction, nothing is seen through`, () => {
      const rooms = insideRooms(seed);
      const found: string[] = [];
      for (let i = 0; i < rooms.length; i++) {
        const open = roomOpenFaces(meshOf(seed, i), rooms[i]!);
        for (const o of open.slice(0, 5)) found.push(`room ${i} (${rooms[i]!.design.name}): ${o.area.toFixed(2)} m2 at ${o.at.map((v) => v.toFixed(1)).join(",")} facing ${o.n.map((v) => v.toFixed(1)).join(",")}, seen from ${o.eye.map((v) => v.toFixed(1)).join(",")}`);
      }
      expect(found, found.join("\n")).toEqual([]);
    });
  }
});
