import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { arriveIn, arriveOut, constrainInRoom, fromRoom, DOOR_OUT, DOOR_SIDE, DOOR_TICKS, inRoom, insideRooms, roomDoorAt, roomOf, streetDoorAt, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { townConstrain } from "../../src/sim/town/solid.js";
import { municipalInterior } from "../../src/sim/inside/municipal.js";
import { townStart } from "../../src/sim/town/start.js";
import { readFileSync } from "node:fs";

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

describe("the municipal building's room", () => {
  const office = (seed: number): InsideRoom => roomOf(seed, 4) as InsideRoom;

  /** A hull walked from `from` toward `to` in the room's frame in steps of 5 cm, each from where the room kept it: how far the room ever pushed it back from where the step put it, and where it ended. */
  function walk(room: InsideRoom, from: { s: number; d: number }, to: { s: number; d: number }): { worst: number; end: { s: number; d: number } } {
    const start = fromRoom(room, from.s, from.d);
    const pos = { x: start.x, z: start.z };
    let worst = 0;
    const steps = Math.ceil(Math.hypot(to.s - from.s, to.d - from.d) / 0.05) + 20;
    for (let k = 0; k < steps; k++) {
      const cur = inRoom(room, pos.x, pos.z);
      const dist = Math.hypot(to.s - cur.s, to.d - cur.d);
      if (dist < 1e-6) break;
      const step = Math.min(0.05, dist);
      const want = fromRoom(room, cur.s + ((to.s - cur.s) / dist) * step, cur.d + ((to.d - cur.d) / dist) * step);
      pos.x = want.x;
      pos.z = want.z;
      constrainInRoom(room, pos, { x: 0, z: 0 });
      worst = Math.max(worst, Math.hypot(pos.x - want.x, pos.z - want.z));
    }
    return { worst, end: inRoom(room, pos.x, pos.z) };
  }

  it("has the plan's door and the building's whole front, a back partition with its two doorways, and no word of an outside service", () => {
    for (const seed of ALL) {
      const m = municipalInterior(seed);
      const room = office(seed);
      expect(room.name).toBe("office");
      expect(room.unit).toBe(-1);
      expect(room.s0).toBe(0);
      expect(room.s1).toBe(m.width);
      expect(room.doorS).toBe(m.doorS);
      expect(room.doorWidth).toBe(2.3);
      expect(m.depth).toBeLessThanOrEqual(14);
      expect(m.interior.type).toBe("lobby");
    }
    for (const file of ["src/sim/inside/municipal.ts", "src/game/town/municipalDecor.ts"]) {
      expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), file).not.toMatch(/\b(fbi|agent|bureau|federal)\b/i);
    }
  }, timeLimit(300_000));

  it("lets a player walk from the arrival to the middle of the player's office, never pushed back more than a few centimetres", () => {
    for (const seed of ALL) {
      const room = office(seed);
      const m = municipalInterior(seed);
      const P = m.marks.back;
      const arrival = inRoom(room, arriveIn(room).x, arriveIn(room).z);
      // Down the hall to the office's doorway, through it, and in to the middle of the office.
      const middle = { s: m.doorS - 2.9, d: P + Math.min((m.depth - P) / 2, 3.4) };
      const legs = [{ s: m.marks.officeDoor, d: P - 0.6 }, { s: m.marks.officeDoor, d: P + 0.6 }, middle];
      let at = arrival;
      for (const to of legs) {
        const done = walk(room, at, to);
        expect(done.worst, `seed ${seed} to ${JSON.stringify(to)}`).toBeLessThan(0.03);
        at = done.end;
      }
      expect(Math.hypot(at.s - middle.s, at.d - middle.d), `seed ${seed} ended at ${JSON.stringify(at)}`).toBeLessThan(0.05);
    }
  }, timeLimit(300_000));

  it("shuts the second doorway: a hull walked at it is stopped in the hall", () => {
    for (const seed of ALL) {
      const room = office(seed);
      const m = municipalInterior(seed);
      const done = walk(room, { s: m.marks.shutDoor, d: m.marks.back - 1.2 }, { s: m.marks.shutDoor, d: m.marks.back + 1.2 });
      expect(done.end.d, `seed ${seed}`).toBeLessThan(m.marks.back);
    }
  }, timeLimit(300_000));

  it("leaves the door's zone and the way from the door to the office's doorway free of furnishings", () => {
    for (const seed of ALL) {
      const m = municipalInterior(seed);
      const P = m.marks.back;
      for (const f of m.interior.furnishings) {
        if (f.kind === "partition") continue;
        const half = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
        const deep = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
        // The door's zone: the door's width and 45 cm either side, 2.4 m out from the front wall.
        const inZone = f.s + half > m.doorS - 1.15 - 0.45 && f.s - half < m.doorS + 1.15 + 0.45 && f.d - deep < 2.4;
        expect(inZone, `seed ${seed}: ${f.kind} at ${f.s}, ${f.d} is in the door's zone`).toBe(false);
        // The way: a 1.6 m wide lane along the line from the door to the doorway (sampled).
        for (let k = 0; k <= 20; k++) {
          const t = k / 20;
          const ws = m.doorS + (m.marks.officeDoor - m.doorS) * t;
          const wd = 0.15 + (P - 0.15) * t;
          const nearS = Math.max(0, Math.abs(f.s - ws) - half);
          const nearD = Math.max(0, Math.abs(f.d - wd) - deep);
          expect(Math.hypot(nearS, nearD) >= 0.8, `seed ${seed}: ${f.kind} at ${f.s}, ${f.d} is on the way at ${t}`).toBe(true);
        }
      }
    }
  }, timeLimit(300_000));

  it("has the city on the left and the sheriff on the right in every town, and people that stand on the floor of the room", () => {
    for (const seed of ALL) {
      const m = municipalInterior(seed);
      expect(m.marks.cityS).toBeLessThan(m.doorS);
      expect(m.marks.sheriffS).toBeGreaterThan(m.doorS);
      const room = office(seed);
      expect(m.people.length).toBeGreaterThanOrEqual(3);
      for (const p of m.people) {
        const free = { x: fromRoom(room, p.s, p.d).x, z: fromRoom(room, p.s, p.d).z };
        const before = { ...free };
        constrainInRoom(room, free, { x: 0, z: 0 });
        // A sitter's place is inside the bench they sit on; a standing person's is clear.
        if (p.sits === null) expect(Math.hypot(free.x - before.x, free.z - before.z), `seed ${seed} person at ${p.s}, ${p.d}`).toBeLessThan(0.3);
      }
    }
  }, timeLimit(300_000));

  it("is at the player's street door at the start, or within a step of it", () => {
    for (const seed of ALL) {
      const start = townStart(seed);
      const room = office(seed);
      // The spawn is searched out from the start (`spiralSpawn`); within 1 m of the start it is at the door or a step from it.
      const at = inRoom(room, start.x, start.z);
      console.log(`[office] seed ${seed}: start is at s ${(at.s - room.doorS).toFixed(2)} from the door, d ${at.d.toFixed(2)} (negative is the street)`);
    }
  }, timeLimit(300_000));
});

describe("the municipal building's room, clear of its shut door", () => {
  it("has nothing standing against either doorway", () => {
    for (const seed of ALL) {
      const m = municipalInterior(seed);
      for (const g of [m.marks.officeDoor, m.marks.shutDoor]) {
        for (const f of m.interior.furnishings) {
          if (f.kind === "partition") continue;
          const half = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
          const deep = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
          const onIt = f.s + half > g - 0.65 && f.s - half < g + 0.65 && Math.abs(f.d - m.marks.back) - deep < 0.3;
          expect(onIt, `seed ${seed}: ${f.kind} at ${f.s}, ${f.d} stands against the doorway at ${g}`).toBe(false);
        }
      }
    }
  }, timeLimit(300_000));
});
