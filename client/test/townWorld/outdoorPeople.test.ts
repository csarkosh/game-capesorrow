// The people outside in the downtown: counts by reason through the day on three seeds (printed), and the rules a place keeps: out of roadways,
// props, buildings and each other, inside the unit's hours, downtown only, the same twice, and the dead of night nearly empty.
import { describe, expect, it } from "vitest";
import { PERSON_MODELS } from "../../src/game/town/people.js";
import { PAIR_APART, PEOPLE_APART, PROP_CLEAR, REASONS, REFERENCE_UNITS, inRoadway, isDowntown, isThere, outdoorPeopleFor, outdoorWorld, sameTime, type OutdoorPerson } from "../../src/game/town/outdoorPeople.js";
import { isOpen } from "../../src/game/town/hours.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { WORLD_SEEDS } from "./world.js";

const HOURS = [3, 8, 12, 17, 20, 23];
const BANDS: Record<number, readonly [number, number]> = { 3: [0, 3], 8: [6, 14], 12: [18, 30], 17: [18, 30], 20: [6, 14], 23: [0, 14] };

describe("the people outside", () => {
  for (const seed of WORLD_SEEDS) {
    const ground = townGround(seed);
    const plan = ground.plan;
    const people = outdoorPeopleFor(plan, ground.anchor);
    const units = plan.uses.reduce((n, use) => {
      const b = plan.buildings.find((c) => c.id === use.building);
      const lot = b === undefined ? undefined : plan.lots[b.lot];
      return n + (lot !== undefined && isDowntown(lot.district) ? use.units.filter((u) => u.state === "open").length : 0);
    }, 0);
    const there = (hour: number): OutdoorPerson[] => people.filter((p) => isThere(p, hour));

    it(`seed ${seed}: counts by reason (${units} open downtown units)`, () => {
      const lines = [`seed ${seed}: ${people.length} slots, ${units} open downtown units`];
      for (const h of HOURS) {
        const by = new Map<string, number>();
        for (const p of there(h)) by.set(p.reason, (by.get(p.reason) ?? 0) + 1);
        lines.push(`  ${String(h).padStart(2, "0")}:00 ${String(there(h).length).padStart(3)}  ${[...by].map(([r, n]) => `${r} ${n}`).join(", ")}`);
      }
      process.stderr.write(`${lines.join("\n")}\n`);
      const k = units / REFERENCE_UNITS;
      for (const h of HOURS) {
        const [lo, hi] = BANDS[h] as readonly [number, number];
        const n = there(h).length;
        // A downtown of a few units may be empty at an hour; the lower band holds for a town of half the reference size or more.
        if (k >= 0.5) expect(n, `${h}:00`).toBeGreaterThanOrEqual(Math.floor(lo * k * 0.6));
        expect(n, `${h}:00`).toBeLessThanOrEqual(Math.ceil(hi * k * 1.3) + (h === 3 ? 0 : 2));
      }
      expect(there(3).length).toBeLessThanOrEqual(3);
    });

    it(`seed ${seed}: the same plan gives the same people twice`, () => {
      expect(outdoorPeopleFor(plan, ground.anchor)).toBe(people);
      expect(outdoorPeopleFor({ ...plan }, ground.anchor)).toEqual(people);
    });

    it(`seed ${seed}: nobody is in a roadway, a prop's box, a building or another person, or outside downtown`, () => {
      const solids = plan.props.solids;
      for (const p of people) {
        const x = p.x - ground.anchor.x;
        const z = p.z - ground.anchor.z;
        const where = `${p.reason} #${p.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
        expect(inRoadway(plan, x, z, 0.3), where).toBe(false);
        for (const b of solids) {
          const a = (x - b.cx) * b.ux + (z - b.cz) * b.uz;
          const c = -(x - b.cx) * b.uz + (z - b.cz) * b.ux;
          expect(Math.hypot(Math.max(Math.abs(a) - b.hu, 0), Math.max(Math.abs(c) - b.hv, 0)), `${where} in a prop`).toBeGreaterThanOrEqual(PROP_CLEAR - 1e-6);
        }
        for (const b of plan.buildings) {
          const hu = b.bearing.a / b.bearing.c;
          const hv = b.bearing.b / b.bearing.c;
          const a = (x - b.centre.x) * hu + (z - b.centre.z) * hv;
          const c = -(x - b.centre.x) * hv + (z - b.centre.z) * hu;
          expect(Math.abs(a) > b.halfAlong || Math.abs(c) > b.halfAcross, `${where} in building ${b.id}`).toBe(true);
        }
        expect(isDowntown(p.district), where).toBe(true);
        expect(PERSON_MODELS.includes(p.model)).toBe(true);
        expect(Number.isFinite(outdoorWorld(ground, p).y)).toBe(true);
      }
      for (const [i, p] of people.entries()) {
        for (const q of people.slice(i + 1)) {
          if (!sameTime(p, q)) continue;
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          if (d < PEOPLE_APART - 1e-6) throw new Error(`${p.reason} #${p.id} and ${q.reason} #${q.id} stand ${d.toFixed(2)} m apart at the same time`);
          if (p.partner !== q.id) expect(d >= PEOPLE_APART || !sameTime(p, q)).toBe(true);
          else expect(d).toBeGreaterThanOrEqual(PAIR_APART - 0.02);
        }
      }
    });

    it(`seed ${seed}: everyone tied to a unit is inside its hours`, () => {
      for (const p of people) {
        if (p.unitHours === null) continue;
        for (let k = 0; k <= 10; k++) {
          const t = p.start + (p.length * k) / 10;
          expect(isOpen(p.unitHours, t), `${p.reason} #${p.id} at ${t.toFixed(2)}`).toBe(true);
        }
      }
    });
  }

  it("has a reason for every reason id, each with hours", () => {
    for (const r of REASONS) expect(r.bands.length).toBeGreaterThan(0);
  });
});
