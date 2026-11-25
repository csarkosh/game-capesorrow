// The people who stand in the open shops: the same plan gives the same people, only open units have any, each stands on clear floor inside
// the room (margins to the walls, clear of the furnishings and the door's zone, apart from one another), most open units with a service
// point have a member of staff, the town has people but no crowd, and a room does not repeat a model while it has few people.
import { describe, expect, it } from "vitest";
import {
  ACTIVITIES, DOOR_DEEP, DOOR_SIDE, FRONT_ZONE, FURNITURE_CLEAR, PEOPLE_APART, SEATED_APART, WALL_MARGIN, WINDOW_DEPTH, distanceToFootprint, facesGlass, peopleFor, personWorld, unitSeats, type Person,
} from "../../src/game/town/people.js";
import manifest from "../../assets/models/people.json" with { type: "json" };
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
        if (p.seat === null) expect(p.d, where).toBeGreaterThanOrEqual(WALL_MARGIN - 1e-6);
        expect(p.d, where).toBeLessThanOrEqual(room.depth - WALL_MARGIN + 1e-6);
        expect(p.d, `${where} in the front zone`).toBeLessThanOrEqual(FRONT_ZONE + 1e-6);
        // A standing person is clear of every furnishing; a sitter is on a seat, which is at their own table, desk or row.
        if (p.seat === null) for (const f of room.furnishings) expect(distanceToFootprint(f, p.s, p.d), `${where} ${f.kind}`).toBeGreaterThanOrEqual(FURNITURE_CLEAR - 1e-6);
        const lo = unit.door.s - unit.door.width / 2 - DOOR_SIDE;
        const hi = unit.door.s + unit.door.width / 2 + DOOR_SIDE;
        if (p.seat === null) expect(p.s > lo && p.s < hi && p.d < DOOR_DEEP, `${where} in the door's zone`).toBe(false);
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
            const a = list[i] as Person;
            const b = list[j] as Person;
            expect(Math.hypot(a.s - b.s, a.d - b.d), key).toBeGreaterThanOrEqual((a.seat === null && b.seat === null ? PEOPLE_APART : SEATED_APART) - 1e-6);
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

    it(`seed ${seed}: everyone has an activity the files carry, and the activity fits how they are placed`, () => {
      for (const p of people) {
        expect(ACTIVITIES, p.activity).toContain(p.activity);
        expect(manifest.clips).toContain(p.activity);
        expect(p.activity.startsWith("sit_") === (p.seat !== null), `${p.activity} ${p.seat === null ? "standing" : "seated"}`).toBe(true);
        if (p.seat !== null) expect(p.seat.family === "stool", p.activity).toBe(p.activity === "sit_stool");
      }
    });

    it(`seed ${seed}: every sitter is on a seat the drawing's own arithmetic gives, and no two on one`, () => {
      const taken = new Set<string>();
      for (const p of people) {
        if (p.seat === null) continue;
        const b = plan.buildings.find((x) => x.id === p.building);
        const unit = unitOf(plan, p);
        if (b === undefined) throw new Error("no building");
        const seats = unitSeats(b, unit)[p.seat.furnishing] ?? [];
        const on = seats.find((q) => Math.hypot(q.s - p.s, q.d - p.d) < 1e-2);
        expect(on, `building ${p.building} unit ${p.unit} seat of furnishing ${p.seat.furnishing}`).toBeDefined();
        expect(on?.top).toBeCloseTo(p.seat.top, 6);
        const key = `${p.building}:${p.unit}:${p.seat.furnishing}:${on?.s.toFixed(3)}:${on?.d.toFixed(3)}`;
        expect(taken.has(key), key).toBe(false);
        taken.add(key);
        // Not inside any furnishing but their own.
        for (const [k, f] of unit.interior.furnishings.entries()) if (k !== p.seat.furnishing) expect(distanceToFootprint(f, p.s, p.d), `${key} in ${f.kind}`).toBeGreaterThan(0.04);
      }
    });

    it(`seed ${seed}: no standing person faces out through the front glass unless their task is at something in the window, and staff at a counter face across it`, () => {
      for (const p of people) {
        const unit = unitOf(plan, p);
        const target = p.target === null ? null : unit.interior.furnishings[p.target];
        if (p.seat === null && facesGlass(p.face)) {
          expect(target !== null && target !== undefined && target.d <= WINDOW_DEPTH, `building ${p.building} unit ${p.unit} ${p.activity}`).toBe(true);
        }
        if (p.role === "staff" && p.seat === null && target !== null && target !== undefined && (target.kind === "counter" || target.kind === "checkout")) {
          const dx = target.s - p.s;
          const dz = target.d - p.d;
          const len = Math.hypot(dx, dz);
          // Their facing is within 60 degrees of the line to the counter (15 of them are the hash's turn).
          expect((dx * p.face.s + dz * p.face.d) / len, `building ${p.building} unit ${p.unit}`).toBeGreaterThan(0.5);
        }
      }
    });

    it(`seed ${seed}: people are in about two thirds of the open units that have furnishings in the front zone`, () => {
      let eligible = 0;
      let seen = 0;
      for (const use of plan.uses) {
        for (const unit of use.units) {
          if (unit.state !== "open" || !unit.interior.furnishings.some((f) => f.d <= FRONT_ZONE)) continue;
          eligible++;
          if (rooms.has(`${use.building}:${unit.id}`)) seen++;
        }
      }
      expect(eligible).toBeGreaterThan(5);
      expect(seen / eligible).toBeGreaterThan(0.66);
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
