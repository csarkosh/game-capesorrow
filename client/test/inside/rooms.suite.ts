import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { arriveIn, arriveOut, constrainInRoom, DOOR_OUT, DOOR_SIDE, DOOR_TICKS, inRoom, insideRooms, roomDoorAt, roomOf, streetDoorAt, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { townConstrain } from "../../src/sim/town/solid.js";
import { FRONT_WALL, blocksOverlap } from "../../src/sim/inside/design.js";
import { fitsDesign } from "../../src/sim/inside/designWalk.js";
import { DECOR_KINDS, ITEM_FOOT } from "../../src/sim/inside/kinds.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { ACTIVITIES } from "../../src/game/town/people.js";
import { MATERIAL_NAMES } from "../../src/game/town/interiorMaterials.js";
import { ITEMS, DECOR } from "../../src/game/town/furniture/index.js";
import { FIT, R } from "./designHelpers.js";
import { ALL_SEEDS, GAME_SEEDS } from "./seeds.js";

const ALL = ALL_SEEDS;

/** The street arrival after the town's constraint, and how far it moved. */
function arrivedOut(seed: number, room: InsideRoom): { x: number; y: number; z: number; moved: number } {
  const at = arriveOut(room);
  const pos = { x: at.x, y: at.y, z: at.z };
  townConstrain({ forest: { seed } }, pos, { x: 0, y: 0, z: 0 });
  return { ...pos, moved: Math.hypot(pos.x - at.x, pos.z - at.z) };
}

describe("the rooms of a world", () => {
  it("are four, with ids 1 to 4 (the bar, the cafe, the lodging, the municipal building)", () => {
    for (const seed of ALL) {
      const rooms = insideRooms(seed);
      expect(rooms.map((r) => r.id), `seed ${seed}`).toEqual([1, 2, 3, 4]);
      expect(rooms.map((r) => r.name), `seed ${seed}`).toEqual(["bar", "cafe", "lodging", "office"]);
      expect(roomOf(seed, 2)).toBe(rooms[1]);
      expect(roomOf(seed, 0)).toBeUndefined();
      expect(roomOf(seed, 4)?.name).toBe("office");
      expect(roomOf(seed, 5)).toBeUndefined();
    }
  }, timeLimit(300_000));

  it("are as the plan has them: a door in the front wall, a floor 60 m over the street's", () => {
    for (const seed of GAME_SEEDS) {
      for (const room of insideRooms(seed)) {
        expect(room.floorY - room.streetY, `${seed} ${room.name}`).toBeCloseTo(60, 9);
        expect(room.s1 - room.s0).toBeGreaterThan(room.doorWidth);
        expect(room.depth).toBeGreaterThan(2);
        expect(room.ceiling).toBeGreaterThan(2);
        const at = inRoom(room, room.ox + room.tx * room.doorS, room.oz + room.tz * room.doorS);
        expect(Math.abs(at.s - room.doorS)).toBeLessThan(1e-9);
        expect(Math.abs(at.d)).toBeLessThan(1e-9);
      }
    }
  }, timeLimit(300_000));

  it("let a player stand free where they arrive inside, and at the street door where they arrive outside", () => {
    for (const seed of ALL) {
      for (const room of insideRooms(seed)) {
        const label = `seed ${seed} ${room.name}`;
        const inside = arriveIn(room);
        const pos = { x: inside.x, z: inside.z };
        const vel = { x: 0, z: 0 };
        constrainInRoom(room, pos, vel);
        expect(Math.hypot(pos.x - inside.x, pos.z - inside.z), label).toBeLessThan(1e-9);
        expect(inside.y, label).toBe(room.floorY + PLAYER_HALF.y);
        // The arrival is at the room's door, so a press there goes out.
        expect(roomDoorAt(room, inside), label).toBe(true);
        const out = arriveOut(room);
        expect(streetDoorAt(seed, out)?.id, label).toBe(room.id);
        const moved = arrivedOut(seed, room);
        expect(streetDoorAt(seed, moved)?.id, `${label} after the town's constraint`).toBe(room.id);
        expect(moved.moved, `${label} moved`).toBeLessThanOrEqual(1);
      }
    }
  }, timeLimit(300_000));

  it("have street doors out of reach of one another: no room's arrival is within another room's reach in plan", () => {
    for (const seed of ALL) {
      const rooms = insideRooms(seed);
      for (const a of rooms) {
        for (const b of rooms) {
          if (a === b) continue;
          // The test the street door makes, in plan, of a room `a` on the arrival at room `b`'s door.
          const at = inRoom(a, arriveOut(b).x, arriveOut(b).z);
          const reached = at.d <= 0.3 && at.d >= -DOOR_OUT && Math.abs(at.s - a.doorS) <= a.doorWidth / 2 + DOOR_SIDE;
          expect(reached, `seed ${seed}: ${b.name}'s arrival is at ${a.name}'s door`).toBe(false);
        }
      }
    }
  }, timeLimit(300_000));

  it("are left by no one standing in the street 60 m below", () => {
    for (const seed of GAME_SEEDS) {
      for (const room of insideRooms(seed)) {
        const up = arriveIn(room);
        expect(streetDoorAt(seed, up), `${seed} ${room.name}`).toBeUndefined();
      }
    }
    expect(DOOR_TICKS).toBe(27);
  }, timeLimit(300_000));
});

// The cheap structural checks, on every seed: no flood, no walk (the long ones are on the heavy seeds, `seeds.ts`).
describe("the rooms' designs, on every test seed", () => {
  it("gives every room a design that is the room's own measures, and the bar and the cafe designed ones", () => {
    for (const seed of ALL) {
      for (const room of insideRooms(seed)) {
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
    for (const seed of ALL) {
      for (const room of insideRooms(seed)) {
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

  it("puts nothing on anything: no two blocks of the bar's items overlap, and every item and decor kind has a footprint and a builder", () => {
    for (const seed of ALL) for (const room of [insideRooms(seed)[0]!, insideRooms(seed)[1]!]) {
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

});
