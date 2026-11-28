import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { barDepth } from "../../src/sim/inside/designs/bar.js";
import { wallGaps, type Design } from "../../src/sim/inside/design.js";
import { insideRooms, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { CELL, explore, floodOf, reached, walkableOf } from "./designHelpers.js";
import { HEAVY_SEEDS } from "./seeds.js";

/** The game's seeds: the one the tests share, two more whose towns differ, and the world the game opens on (as `rooms.test.ts`). */
const SEEDS = HEAVY_SEEDS;

/** Every room of a seed that has a design of its own or the converter's: the four, so that the walking rules are held to all of them. */
const roomsOf = (seed: number): readonly InsideRoom[] => insideRooms(seed);

describe("the rooms' designs, walked on the heavy seeds", () => {
  it("is walked in 3,000 ticks without leaving the box, ending in a block or standing on nothing, and reaches 60 percent of what a grid flood reaches", () => {
    const worst: string[] = [];
    for (const seed of SEEDS) {
      for (const room of roomsOf(seed)) {
        const d = room.design;
        const label = `seed ${seed} ${room.name}`;
        const reach = floodOf(d);
        const w = explore(roomOf(room), d.arrive, 3000, seed * 7 + room.id, reach);
        expect(w.worstOutside, `${label}: left the box`).toBeLessThan(0);
        expect(w.inBlock, `${label}: ended in a block`).toBe(0);
        expect(w.onNothing, `${label}: stood on nothing`).toBe(0);
        const covered = reach.states.filter((s) => reached(w.visited, s)).length / reach.states.length;
        // 3,000 ticks of sprint is about 350 m of walking, which covers 60 percent of a room up to about 250 m2; a hotel's lobby, stair, corridor and room is more than that, and is held to half.
        // The municipal hall is open through three storeys with a gallery and offices: a walk of this length reaches a quarter of it.
        const need = room.name === "office" ? 0.25 : d.width * d.depth > 250 ? 0.5 : 0.6;
        expect(covered, `${label}: reached ${(covered * 100).toFixed(0)} percent`).toBeGreaterThan(need);
        // Every surface that is not the ground floor is reached; a design that walls off a part of itself fails here and in the share of the floor the fill reaches.
        expect(reach.surfaces.size, `${label}: surfaces reached`).toBe(d.surfaces.length);
        const share = reach.states.length / walkableOf(d);
        if (!d.legacy) expect(share, `${label}: the fill reaches ${(share * 100).toFixed(0)} percent of the floor a hull stands on`).toBeGreaterThan(0.9);
        if (room.name === "bar" || room.name === "cafe") worst.push(`${room.name} ${seed}: ${d.width.toFixed(2)} x ${d.depth.toFixed(2)}, ${(covered * 100).toFixed(0)}% walked, ${(share * 100).toFixed(0)}% reached`);
      }
    }
    console.log(`[bar] ${worst.join("\n[bar] ")}`);
  }, timeLimit(600_000));

  it("makes the bar's depth from its width and the building's depth", () => {
    expect(barDepth(7.42, 33.8)).toBeCloseTo(14.4, 1);
    expect(barDepth(7.42, 8)).toBe(8);
    expect(barDepth(4.57, 4.9)).toBe(4.9);
    expect(barDepth(14.8, 40)).toBe(15);
  });

  it("holds the bar on the game's world to the numbers the owner looks at", () => {
    const d = roomsOf(1175766972)[0]!.design as Design;
    expect(d.width).toBeCloseTo(7.42, 2);
    console.log(`[bar] seed 1175766972: ${d.width} x ${d.depth}, ${d.items.length} items, ${d.decor.length} decor, ${d.lights.length} lights, ${d.people.length} people`);
  });
});

describe.each([["bar", 0], ["cafe", 1]] as const)("the %s on the world the game opens on is full", (name, index) => {
  const d = insideRooms(1175766972)[index]!.design;
  it("leaves under 55 percent of its floor for a hull to stand on, and every part of it is reached", () => {
    const share = (walkableOf(d) * CELL * CELL) / (d.width * d.depth);
    console.log(`[full] ${name}: a hull can stand on ${(share * 100).toFixed(0)} percent of the floor, ${d.items.length} items, ${d.decor.length} hangings`);
    expect(share, `${name}: floor share`).toBeLessThan(0.55);
    const reach = floodOf(d);
    expect(reach.states.length / walkableOf(d), `${name}: the fill reaches the floor`).toBeGreaterThan(0.9);
  });
  it("has no stretch of either long wall between 1.0 and 2.0 m high that is bare for more than 2 m", () => {
    for (const wall of ["left", "right"] as const) expect(wallGaps(d, wall, 2.0), `${name}: bare stretches of the ${wall} wall`).toEqual([]);
  });
});

function roomOf(r: InsideRoom): InsideRoom {
  return r;
}
