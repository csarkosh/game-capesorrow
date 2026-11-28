import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { STEP_UP } from "../../src/sim/inside/design.js";
import { municipalFrame } from "../../src/sim/inside/designs/municipal.js";
import { roomOf, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { CELL, R, centre, floodOf, standsAt, stepTo, walkableOf } from "./designHelpers.js";
import { HEAVY_SEEDS } from "./seeds.js";

const SEEDS = HEAVY_SEEDS;
const office = (seed: number): InsideRoom => roomOf(seed, 4) as InsideRoom;

describe("the municipal hall as a design", () => {
  it("is the building's whole front with the plan's door, open through its storeys, and names nothing of an outside service", () => {
    for (const seed of SEEDS) {
      const m = municipalFrame(seed);
      const room = office(seed);
      const d = room.design;
      expect(room.name).toBe("office");
      expect(room.unit).toBe(-1);
      expect(d.legacy).toBe(false);
      expect(room.s1).toBe(m.width);
      expect(room.doorS).toBe(m.doorS);
      expect(room.doorWidth).toBe(2.3);
      expect(d.depth).toBeLessThanOrEqual(14);
      expect(d.height, `seed ${seed}`).toBeGreaterThanOrEqual(6);
    }
    for (const file of ["src/sim/inside/designs/municipal.ts", "src/sim/inside/designs/hall.ts"]) expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), file).not.toMatch(/\b(fbi|agent|bureau|federal)\b/i);
  }, timeLimit(300_000));

  it("lets a player climb the stair to the gallery, reach the player's office, and no one reach the staff stair, the evidence room or floor 3", () => {
    const lines: string[] = [];
    for (const seed of SEEDS) {
      const d = office(seed).design;
      const reach = floodOf(d);
      const label = `seed ${seed}`;
      const mark = (name: string) => (d.marks ?? []).find((m) => m.name === name) as { s: number; d: number; y: number };
      const room = mark("room");
      const inRoom = reach.states.filter((s) => {
        const c = centre(s.i, s.j);
        return Math.abs(c.s - room.s) < 1.6 && Math.abs(c.d - room.d) < 1.6 && Math.abs(s.h - room.y) < 0.2;
      });
      expect(inRoom.length, `${label}: cells of the player's office reached`).toBeGreaterThanOrEqual(4);
      const gallery = mark("gallery");
      expect(reach.states.some((s) => Math.abs(centre(s.i, s.j).s - gallery.s) < 0.5 && Math.abs(centre(s.i, s.j).d - gallery.d) < 0.5 && Math.abs(s.h - gallery.y) < 0.2), `${label}: the gallery`).toBe(true);
      // Nothing is stood on above floor 2: the third floor is seen and never walked.
      const top = Math.max(...reach.states.map((s) => s.h));
      expect(top, `${label}: the highest floor reached`).toBeLessThan(d.height * (2 / 3) - 0.5);
      // The way to the office climbs the stair (it passes the heights between the floors).
      const target = reach.states.indexOf(inRoom[0]!);
      let climbed = false;
      for (let k = target; k >= 0; k = reach.states[k]!.from) if ((reach.states[k] as { h: number }).h > 1 && (reach.states[k] as { h: number }).h < room.y - 1) climbed = true;
      expect(climbed, `${label}: the way climbs the stair`).toBe(true);
      // Every open edge of floor 2 is railed or lands within a step.
      for (const s of reach.states) {
        if (s.h < 1) continue;
        const c = centre(s.i, s.j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const g = stepTo(d, { s: c.s, d: c.d, h: s.h }, c.s + di * CELL, c.d + dj * CELL, R);
          if (g !== null) expect(g, `${label}: a step from (${c.s}, ${c.d}) at ${s.h} drops to ${g}`).toBeGreaterThanOrEqual(s.h - STEP_UP);
        }
      }
      // The city is on the left and the sheriff on the right.
      const city = d.decor.find((x) => x.text === "CITY CLERK")!;
      const sheriff = d.decor.find((x) => x.text === "SHERIFF")!;
      expect(city.s, `${label}: the city's side`).toBeLessThan(room.s + d.width);
      expect(city.s).toBeLessThan(office(seed).doorS);
      expect(sheriff.s).toBeGreaterThan(office(seed).doorS);
      const share = reach.states.length / walkableOf(d);
      expect(share, `${label}: share of the floor reached`).toBeGreaterThan(0.9);
      lines.push(`${seed}: ${d.width.toFixed(1)} x ${d.depth.toFixed(1)} x ${d.height.toFixed(1)}, ${d.items.length} items, ${d.decor.length} hangings, ${d.lights.length} lights, ${(share * 100).toFixed(0)} percent reached`);
    }
    console.log(`[hall]\n${lines.join("\n")}`);
  }, timeLimit(600_000));

  it("puts every person on a floor a hull stands on, at the height of the floor they are on", () => {
    for (const seed of SEEDS) {
      const d = office(seed).design;
      expect(d.people.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      for (const p of d.people) if (p.sits === null) expect(standsAt(d, p.s, p.d, p.y ?? 0, 0.3), `seed ${seed} person at ${p.s}, ${p.d}, ${p.y ?? 0}`).not.toBeNull();
    }
  }, timeLimit(300_000));
});
