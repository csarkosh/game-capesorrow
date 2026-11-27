// Who is with whom: outside a bar, a restaurant or a cafe nobody stands alone, most who are out for anything but shopping are with someone, and in
// those rooms the customers come two together.
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { tradeAt } from "../../src/game/town/handHeld.js";
import { SOCIAL, isThere, outdoorPeopleFor, unitCap, type OutdoorPerson } from "../../src/game/town/outdoorPeople.js";
import { TOGETHER, peopleFor, type Person } from "../../src/game/town/people.js";
import { pairUp } from "../../src/game/town/peopleReact.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { WORLD_SEEDS } from "./world.js";

/** The reasons a person outside may be alone for: shopping, keeping a shop, a bench, a corner. */
const ALONE_FOR = ["window shopping", "errand", "shopkeeper", "night shop", "bench", "corner", "round the clock"];

describe("who is with whom", () => {
  for (const seed of WORLD_SEEDS) {
    const ground = townGround(seed);
    const plan = ground.plan;
    const outside = outdoorPeopleFor(plan, ground.anchor);
    const rooms = peopleFor(plan);

    it(`seed ${seed}: outside a bar, a restaurant or a cafe nobody stands alone but the shopkeeper at their own door`, () => {
      let there = 0;
      for (const p of outside) {
        const trade = tradeAt(plan, p.building, p.unit);
        if (trade === null || !SOCIAL.includes(trade)) continue;
        there++;
        if (p.reason === "shopkeeper") continue;
        expect(p.partner, `#${p.id} at a ${trade} for ${p.reason}`).toBeGreaterThanOrEqual(0);
        const q = outside[p.partner] as OutdoorPerson;
        expect(q.partner).toBe(p.id);
        // The two are there for the same hours, at the same door.
        expect([q.start, q.length, q.building, q.unit]).toEqual([p.start, p.length, p.building, p.unit]);
      }
      expect(there).toBeGreaterThan(10);
      // Two pairs have room at such a door.
      for (const trade of SOCIAL) expect(unitCap(trade)).toBe(4);
    }, timeLimit(120_000));

    it(`seed ${seed}: through the day, most of those outside for anything but shopping, a bench or a corner are with someone`, () => {
      let all = 0;
      let paired = 0;
      let everyone = 0;
      let everyonePaired = 0;
      for (let h = 10; h <= 20; h += 0.5) {
        for (const p of outside) {
          if (!isThere(p, h)) continue;
          everyone++;
          if (p.partner >= 0) everyonePaired++;
          if (ALONE_FOR.includes(p.reason)) continue;
          all++;
          if (p.partner >= 0) paired++;
        }
      }
      process.stderr.write(`seed ${seed}: of those out for company ${paired}/${all} are with someone; of everyone outside ${everyonePaired}/${everyone}\n`);
      expect(all).toBeGreaterThan(40);
      expect(paired / all).toBeGreaterThan(0.75);
      // And of everyone out, the shoppers and the shopkeepers with them, more than half.
      expect(everyonePaired / everyone).toBeGreaterThan(0.5);
    }, timeLimit(120_000));

    it(`seed ${seed}: in a bar's, a restaurant's or a cafe's room the customers are two together: an even number, each within a table's width of another`, () => {
      const byRoom = new Map<string, Person[]>();
      for (const p of rooms) {
        const trade = tradeAt(plan, p.building, p.unit);
        if (trade === null || !SOCIAL.includes(trade) || p.role !== "customer") continue;
        const key = `${p.building}:${p.unit}`;
        byRoom.set(key, [...(byRoom.get(key) ?? []), p]);
      }
      let customers = 0;
      for (const [key, list] of byRoom) {
        customers += list.length;
        expect(list.length % 2, `room ${key} has ${list.length}`).toBe(0);
        for (const p of list) {
          const near = list.filter((q) => q !== p && Math.hypot(q.s - p.s, q.d - p.d) <= TOGETHER + 1e-9).length;
          expect(near, `room ${key}, the one at ${p.s.toFixed(1)}, ${p.d.toFixed(1)}`).toBeGreaterThanOrEqual(1);
        }
        // And they are paired for talk by where they are (`pairUp`: the nearest two first, so of four at one table two may be left to listen).
        const partner = pairUp(list.map((p) => ({ x: p.s, z: p.d, group: key })), TOGETHER);
        expect(partner.filter((q) => q >= 0).length, `room ${key}`).toBeGreaterThanOrEqual(2);
        expect(partner.filter((q) => q < 0).length, `room ${key}`).toBeLessThanOrEqual(list.length / 2);
      }
      expect(customers).toBeGreaterThanOrEqual(4);
    }, timeLimit(120_000));
  }
});
