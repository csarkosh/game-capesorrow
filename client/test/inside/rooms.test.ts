import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { arriveIn, arriveOut, constrainInRoom, DOOR_OUT, DOOR_SIDE, DOOR_TICKS, inRoom, insideRooms, roomDoorAt, roomOf, streetDoorAt, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { townConstrain } from "../../src/sim/town/solid.js";

/** The game's seeds: the one the tests share, two more whose towns differ, and the world the game opens on. */
export const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
const SEEDS_1_TO_24 = Array.from({ length: 24 }, (_, i) => i + 1);
const ALL = [...GAME_SEEDS, ...SEEDS_1_TO_24.filter((s) => !GAME_SEEDS.includes(s))];

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
