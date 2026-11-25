// The people who stand in the open shops: the same plan gives the same people, only open units have any, each stands on clear floor inside
// the room (margins to the walls, clear of the furnishings and the door's zone, apart from one another), most open units with a service
// point have a member of staff, the town has people but no crowd, and a room does not repeat a model while it has few people.
import { describe, expect, it } from "vitest";
import {
  DOOR_DEEP, DOOR_SIDE, FURNITURE_CLEAR, PEOPLE_APART, WALL_MARGIN, distanceToFootprint, peopleFor, personWorld, type Person,
} from "../../src/game/town/people.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { Unit } from "../../src/sim/town/types.js";
import { WORLD_SEEDS } from "./world.js";

function unitOf(plan: ReturnType<typeof townGround>["plan"], p: Person): Unit {
  const use = plan.uses.find((u) => u.building === p.building);
  const unit = use?.units.find((u) => u.id === p.unit);
  if (unit === undefined) throw new Error("a person with no unit");
  return unit;
}

describe("the people in the shops", () => {
  for (const seed of WORLD_SEEDS) {
    const ground = townGround(seed);
    const plan = ground.plan;
    const people = peopleFor(plan);
    const rooms = new Map<string, Person[]>();
    for (const p of people) {
      const key = `${p.building}:${p.unit}`;
      rooms.set(key, [...(rooms.get(key) ?? []), p]);
    }

    it(`seed ${seed}: the same plan gives the same people twice, and the town has some but no crowd`, () => {
      expect(peopleFor(plan)).toBe(people);
      // A cache is no proof: ask again of a copy of the plan.
      expect(peopleFor({ ...plan })).toEqual(people);
      expect(people.length).toBeGreaterThan(20);
      expect(people.length).toBeLessThan(400);
    });

    it(`seed ${seed}: only open units have people, each inside the room on clear floor`, () => {
      for (const p of people) {
        const unit = unitOf(plan, p);
        const where = `building ${p.building} unit ${p.unit}`;
        expect(unit.state, where).toBe("open");
        const room = unit.interior;
        expect(p.s, where).toBeGreaterThanOrEqual(unit.s0 + 0.04 + WALL_MARGIN - 1e-6);
        expect(p.s, where).toBeLessThanOrEqual(unit.s1 - 0.04 - WALL_MARGIN + 1e-6);
        expect(p.d, where).toBeGreaterThanOrEqual(WALL_MARGIN - 1e-6);
        expect(p.d, where).toBeLessThanOrEqual(room.depth - WALL_MARGIN + 1e-6);
        for (const f of room.furnishings) expect(distanceToFootprint(f, p.s, p.d), `${where} ${f.kind}`).toBeGreaterThanOrEqual(FURNITURE_CLEAR - 1e-6);
        const lo = unit.door.s - unit.door.width / 2 - DOOR_SIDE;
        const hi = unit.door.s + unit.door.width / 2 + DOOR_SIDE;
        expect(p.s > lo && p.s < hi && p.d < DOOR_DEEP, `${where} in the door's zone`).toBe(false);
        expect(Math.hypot(p.face.s, p.face.d), where).toBeCloseTo(1, 6);
        expect(p.scale).toBeGreaterThanOrEqual(0.95);
        expect(p.scale).toBeLessThanOrEqual(1.04);
        expect(p.rate).toBeGreaterThanOrEqual(0.85);
        expect(p.rate).toBeLessThanOrEqual(1.1);
      }
    });

    it(`seed ${seed}: people stand apart, and a room with fewer than six does not repeat a model`, () => {
      for (const [key, list] of rooms) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            expect(Math.hypot((list[i] as Person).s - (list[j] as Person).s, (list[i] as Person).d - (list[j] as Person).d), key).toBeGreaterThanOrEqual(PEOPLE_APART - 1e-6);
          }
        }
        if (list.length < 6) expect(new Set(list.map((p) => p.model)).size, key).toBe(list.length);
        expect(list.filter((p) => p.role === "staff").length, key).toBeLessThanOrEqual(1);
      }
    });

    it(`seed ${seed}: most open units with a service point have staff`, () => {
      let withPoint = 0;
      let staffed = 0;
      for (const use of plan.uses) {
        for (const unit of use.units) {
          if (unit.state !== "open" || !unit.interior.furnishings.some((f) => f.kind === "checkout" || f.kind === "counter" || f.kind === "desk")) continue;
          withPoint++;
          if (rooms.get(`${use.building}:${unit.id}`)?.some((p) => p.role === "staff") === true) staffed++;
        }
      }
      expect(withPoint).toBeGreaterThan(5);
      expect(staffed / withPoint).toBeGreaterThan(0.6);
    });

    it(`seed ${seed}: they stand on the room's drawn floor, in the world`, () => {
      for (const p of people.slice(0, 40)) {
        const w = personWorld(ground, plan, p);
        expect(Number.isFinite(w.x + w.y + w.z + w.yaw)).toBe(true);
        // The floor is within a few metres of the ground at the spot (a room is raised only a little, or cut into a slope).
        expect(Math.abs(w.y - ground.heightAt(w.x, w.z))).toBeLessThan(2.5);
      }
    });
  }
});
