import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { STEP_UP } from "../../src/sim/inside/design.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { CELL, R, centre, floodOf, stepTo, standsAt } from "./designHelpers.js";
import { HEAVY_SEEDS } from "./seeds.js";

const SEEDS = HEAVY_SEEDS;
/** Words that would name a real brand, or the player's employer. */
const BANNED = /\b(hilton|marriott|hyatt|holiday|sheraton|ritz|westin|motel 6|super 8|best western|fbi|agent|bureau|federal)\b/i;

describe("the lodging, on every test seed", () => {
  const table: string[] = [];
  it("holds the player's room, the closed flight and the opening in the floor to the levels rules", () => {
    for (const seed of SEEDS) {
      const room = insideRooms(seed)[2]!;
      const d = room.design;
      const plan = planFor(seed);
      const b = plan.buildings[room.building]!;
      const unit = plan.uses[room.building]!.units.find((u) => u.id === room.unit)!;
      const label = `seed ${seed}`;
      const reach = floodOf(d);
      const multi = b.storeys >= 2;
      const mark = (name: string) => d.marks?.find((m) => m.name === name);
      const roomMark = mark("room")!;
      // The player's room is reached, and on its own floor.
      const inRoom = reach.states.filter((s) => {
        const c = centre(s.i, s.j);
        return Math.abs(c.s - roomMark.s) < 2 && c.d > roomMark.d - 0.6 && Math.abs(s.h - roomMark.y) < 0.2;
      });
      expect(inRoom.length, `${label}: cells of the player's room reached`).toBeGreaterThanOrEqual(4);
      // Reached only by the stair, in a building with one: the way there climbs through the heights between the floors. In a motel it stays on the ground.
      const high = reach.states.filter((s) => s.h > 1);
      if (multi) {
        expect(high.length, `${label}: floor 2 is reached`).toBeGreaterThan(20);
        const target = reach.states.indexOf(inRoom[0]!);
        let climbed = false;
        for (let k = target; k >= 0; k = reach.states[k]!.from) if ((reach.states[k] as { h: number }).h > 1 && (reach.states[k] as { h: number }).h < d.cuts![0]! - 1) climbed = true;
        expect(climbed, `${label}: the way to the room climbs the stair`).toBe(true);
      } else expect(Math.max(...reach.states.map((s) => s.h)), `${label}: a motel is walked on one floor`).toBeLessThan(0.1);
      // The closed flight is not walked: at three storeys or more, past the barrier, nobody has been.
      const beyond = mark("beyond");
      if (beyond !== undefined) {
        for (const s of reach.states) {
          const c = centre(s.i, s.j);
          expect(c.s < beyond.s + 1.0 && Math.abs(c.d - beyond.d) < 1 && s.h > beyond.y - 0.3 && c.s < beyond.s + 0.9, `${label}: reached the closed flight at ${c.s}, ${c.d}, ${s.h}`).toBe(false);
        }
      }
      // The opening in the slab and every open edge of an upper surface is railed: a step outward is refused or lands within a step.
      let edges = 0;
      for (const s of high) {
        const c = centre(s.i, s.j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const g = stepTo(d, { s: c.s, d: c.d, h: s.h }, c.s + di * CELL, c.d + dj * CELL, R);
          if (g === null) edges++;
          else expect(g, `${label}: a step from (${c.s}, ${c.d}) at ${s.h} drops to ${g}`).toBeGreaterThanOrEqual(s.h - STEP_UP);
        }
      }
      if (multi) expect(edges).toBeGreaterThan(10);
      // No sign says a real brand.
      for (const dc of d.decor) expect(dc.text ?? "", `${label}: ${dc.text}`).not.toMatch(BANNED);
      // The room numbers: 200s on floor 2, 100s on a motel's one floor.
      for (const dc of d.decor) if (/^\d+$/.test(dc.text ?? "")) expect(Math.floor(Number(dc.text) / 100), `${label}: plate ${dc.text}`).toBe(multi ? 2 : 1);
      expect(unit.tenant?.name ?? "", `${label}: the name`).not.toMatch(BANNED);
      table.push(`${seed}: unit ${(unit.s1 - unit.s0).toFixed(1)} m wide, building ${plan.uses[room.building]!.frame!.depth.toFixed(1)} m deep, ${b.storeys} storeys, ${b.kind}, trade ${unit.tenant?.trade}: design ${d.width.toFixed(1)} x ${d.depth.toFixed(1)} x ${d.height.toFixed(1)}, ${multi ? (d.marks?.some((m) => m.name === "beyond") ? "stair, corridor, room, closed flight" : "stair, corridor, room") : "office, corridor, room (one floor)"}`);
    }
    console.log(`[lodging]\n${table.join("\n")}`);
  }, timeLimit(600_000));

  it("leaves about 60 percent or less of a hotel lobby's floor for a hull to stand on, and prints each lobby's items", () => {
    const lines: string[] = [];
    const over: string[] = [];
    for (const seed of SEEDS) {
      const d = insideRooms(seed)[2]!.design;
      // The lobby: the ground floor, from the front wall to the back, the length of the stair hall.
      let free = 0;
      let all = 0;
      for (let j = 0; j * CELL < d.depth; j++) for (let i = 0; i * CELL < d.width; i++) {
        const c = centre(i, j);
        if (c.d < 0.5) continue;
        all++;
        if (standsAt(d, c.s, c.d, 0, R) !== null) free++;
      }
      const share = free / all;
      const hotel = d.width >= 12 && (d.marks?.some((m) => m.name === "corridor" && m.y > 1) ?? false);
      lines.push(`${seed}: ${d.width.toFixed(1)} x ${d.depth.toFixed(1)}${hotel ? " hotel" : ""}: ${(share * 100).toFixed(0)} percent free, ${d.items.length} items, ${d.decor.length} hangings`);
      if (hotel && d.depth >= 10 && share >= 0.69) over.push(`${seed} ${(share * 100).toFixed(0)}`);
    }
    console.log(`[lobby]\n${lines.join("\n")}`);
    expect(over, "hotel lobbies leaving over 69 percent of the floor free").toEqual([]);
  }, timeLimit(120_000));
});
