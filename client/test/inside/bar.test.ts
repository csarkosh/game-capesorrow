import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { DECOR_KINDS, ITEM_FOOT } from "../../src/sim/inside/kinds.js";
import { barDepth } from "../../src/sim/inside/designs/bar.js";
import { FRONT_WALL, blocksOverlap, wallGaps, type Design } from "../../src/sim/inside/design.js";
import { fitsDesign } from "../../src/sim/inside/designWalk.js";
import { insideRooms, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { ACTIVITIES } from "../../src/game/town/people.js";
import { MATERIAL_NAMES } from "../../src/game/town/interiorMaterials.js";
import { ITEMS, DECOR } from "../../src/game/town/furniture/index.js";
import { CELL, FIT, R, explore, flood, reached, walkable } from "./designHelpers.js";

/** The game's seeds: the one the tests share, two more whose towns differ, and the world the game opens on (as `rooms.test.ts`). */
const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
const SEEDS = [...GAME_SEEDS, ...Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => !GAME_SEEDS.includes(s))];

/** Every room of a seed that has a design of its own or the converter's: the four, so that the walking rules are held to all of them. */
const roomsOf = (seed: number): readonly InsideRoom[] => insideRooms(seed);

describe("the rooms' designs, on every test seed", () => {
  it("gives every room a design that is the room's own measures, and the bar and the cafe designed ones", () => {
    for (const seed of SEEDS) {
      for (const room of roomsOf(seed)) {
        const d = room.design;
        const label = `seed ${seed} ${room.name}`;
        expect(d.width, label).toBeCloseTo(room.s1 - room.s0, 9);
        expect(d.depth, label).toBe(room.depth);
        expect(d.height, label).toBe(room.ceiling);
        expect(d.legacy, label).toBe(false);
        if (room.name === "bar" || room.name === "cafe") {
          const use = planFor(seed).uses[room.building];
          // No deeper than the building less a metre, between 8 and 15 m where it can be.
          expect(d.depth, label).toBeLessThanOrEqual((use?.frame?.depth ?? 0) - 1 + 1e-9);
          expect(d.depth, label).toBeGreaterThanOrEqual(Math.min(room.name === "bar" ? 8 : 7.5, (use?.frame?.depth ?? 0) - 1) - 1e-9);
          expect(d.depth, label).toBeLessThanOrEqual(15);
        }
      }
    }
  }, timeLimit(300_000));

  it("lets a player stand free where they arrive, with the street door's zone and a way 1.2 m wide from it clear", () => {
    for (const seed of SEEDS) {
      for (const room of roomsOf(seed)) {
        const d = room.design;
        const label = `seed ${seed} ${room.name}`;
        expect(fitsDesign(d, d.arrive.s, d.arrive.d, 0, R, FIT), `${label}: the arrival`).toBe(true);
        if (d.legacy) continue;
        // The zone: the door's width and 55 cm either side, out to 2.5 m from the wall: no block stands on it.
        const zone = { s: d.doorS, d: 1.25 + FRONT_WALL / 2, ax: 1, ad: 0, ha: d.doorWidth / 2 + 0.55, hb: 1.25 - FRONT_WALL / 2, y0: 0, y1: 9 };
        for (const b of d.blocks.filter((x) => x.y0 < 1)) expect(blocksOverlap(b, zone, 0), `${label}: a block at ${b.s}, ${b.d} is on the door's zone`).toBe(false);
        // The way: a hull 1.2 m wide (radius 0.6) stands all along the line in from the door, to 1.8 m (its edge 2.4 m in), or as near as the side walls let it be.
        const s = Math.max(0.6, Math.min(d.width - 0.6, d.doorS));
        for (let y = 0.8; y <= Math.min(1.8, d.depth - 0.6); y += 0.1) expect(fitsDesign(d, s, y, 0, 0.6, FIT), `${label}: the way in at d ${y.toFixed(1)}`).toBe(true);
      }
    }
  }, timeLimit(300_000));

  it("is walked in 3,000 ticks without leaving the box, ending in a block or standing on nothing, and reaches 60 percent of what a grid flood reaches", () => {
    const worst: string[] = [];
    for (const seed of SEEDS) {
      for (const room of roomsOf(seed)) {
        const d = room.design;
        const label = `seed ${seed} ${room.name}`;
        const reach = flood(d, d.arrive);
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
        const share = reach.states.length / walkable(d);
        if (!d.legacy) expect(share, `${label}: the fill reaches ${(share * 100).toFixed(0)} percent of the floor a hull stands on`).toBeGreaterThan(0.9);
        if (room.name === "bar" || room.name === "cafe") worst.push(`${room.name} ${seed}: ${d.width.toFixed(2)} x ${d.depth.toFixed(2)}, ${(covered * 100).toFixed(0)}% walked, ${(share * 100).toFixed(0)}% reached`);
      }
    }
    console.log(`[bar] ${worst.join("\n[bar] ")}`);
  }, timeLimit(600_000));

  it("puts nothing on anything: no two blocks of the bar's items overlap, and every item and decor kind has a footprint and a builder", () => {
    for (const seed of SEEDS) for (const room of [roomsOf(seed)[0]!, roomsOf(seed)[1]!]) {
      const d = room.design;
      const label = `seed ${seed} ${room.name}`;
      const feet = d.items.filter((it) => ITEM_FOOT[it.kind]?.(it.p) !== null).map((it) => d.blocks.find((b) => b.s === it.s && b.d === it.d && Math.abs(b.y0 - (it.y ?? 0)) < 1e-9)).filter((b) => b !== undefined);
      for (let i = 0; i < feet.length; i++) for (let j = i + 1; j < feet.length; j++) expect(blocksOverlap(feet[i]!, feet[j]!, 0.0), `${label}: items ${i} and ${j} overlap`).toBe(false);
      for (const it of d.items) {
        expect(ITEM_FOOT[it.kind], `${label}: ${it.kind} has a footprint`).toBeDefined();
        expect(ITEMS[it.kind], `${label}: ${it.kind} has a builder`).toBeDefined();
      }
      for (const dc of d.decor) {
        expect(DECOR_KINDS, `${label}: ${dc.kind} is a decor kind`).toContain(dc.kind);
        expect(DECOR[dc.kind], `${label}: ${dc.kind} has a builder`).toBeDefined();
      }
      for (const p of d.people) expect(ACTIVITIES as readonly string[], `${label}: ${p.activity}`).toContain(p.activity);
      for (const w of d.walls) expect(MATERIAL_NAMES).toContain(w.mat);
      for (const f of [d.shell.front, d.shell.left, d.shell.right, d.shell.back]) for (const m of [f.mat, f.skirt, f.wainscot?.mat]) if (m !== undefined) expect(MATERIAL_NAMES, m).toContain(m);
      for (const m of [d.shell.floor, d.shell.ceiling, ...d.slabs.map((s) => s.mat)]) expect(MATERIAL_NAMES, m).toContain(m);
    }
    for (const kind of Object.keys(ITEMS)) expect(ITEM_FOOT[kind], kind).toBeDefined();
    for (const kind of Object.keys(ITEM_FOOT)) expect(ITEMS[kind], kind).toBeDefined();
    for (const kind of DECOR_KINDS) expect(DECOR[kind], kind).toBeDefined();
    for (const kind of Object.keys(DECOR)) expect(DECOR_KINDS, kind).toContain(kind);
  }, timeLimit(300_000));

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
    const share = (walkable(d) * CELL * CELL) / (d.width * d.depth);
    console.log(`[full] ${name}: a hull can stand on ${(share * 100).toFixed(0)} percent of the floor, ${d.items.length} items, ${d.decor.length} hangings`);
    expect(share, `${name}: floor share`).toBeLessThan(0.55);
    const reach = flood(d, d.arrive);
    expect(reach.states.length / walkable(d), `${name}: the fill reaches the floor`).toBeGreaterThan(0.9);
  });
  it("has no stretch of either long wall between 1.0 and 2.0 m high that is bare for more than 2 m", () => {
    for (const wall of ["left", "right"] as const) expect(wallGaps(d, wall, 2.0), `${name}: bare stretches of the ${wall} wall`).toEqual([]);
  });
});

function roomOf(r: InsideRoom): InsideRoom {
  return r;
}
