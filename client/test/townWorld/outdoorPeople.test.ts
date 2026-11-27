// The people outside in the downtown: counts by reason and by clip through the day on four seeds (printed), and the rules a street keeps: out of
// roadways, props, buildings and strangers, inside the unit's hours, downtown only, the same twice; few at a place at once, a few in the whole
// downtown at every tenth of an hour, long stays, a pair that is one who talks and one who listens, a leaner with a wall behind and no glass, and
// nobody facing a wall.
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { describe, expect, it } from "vitest";
import { ACTIVITIES, PERSON_MODELS } from "../../src/game/town/people.js";
import {
  LEAN_BLANK, LEAN_OUT, PAIR_APART, PAIR_FAR, PEOPLE_APART, PROP_CLEAR, REASONS, ceilingAt, facingClear, inRoadway, isDowntown, isThere, leanStretches, openDowntownUnits, outdoorPeopleFor,
  outdoorWorld, sameTime, stayHolds, unitCap, type OutdoorPerson,
} from "../../src/game/town/outdoorPeople.js";
import { isOpen } from "../../src/game/town/hours.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { WORLD_SEEDS } from "./world.js";

const SORROW = seedFromToken("sorrow");
/** The three seeds the other tests use, and "sorrow", the town the numbers were set on. */
const SEEDS = [SORROW, ...WORLD_SEEDS];
const PRINT = [8, 12, 15, 17, 20, 23, 3];
const TENTHS = Array.from({ length: 240 }, (_, i) => i / 10);
/** What a clip's person holds or does with a pair, a bench or a wall. */
const NO_DRINK = ["drink"];

describe("the people outside", () => {
  for (const seed of SEEDS) {
    const ground = townGround(seed);
    const plan = ground.plan;
    const people = outdoorPeopleFor(plan, ground.anchor);
    const units = openDowntownUnits(plan);
    const k = units / 46;
    const there = (hour: number): OutdoorPerson[] => people.filter((p) => isThere(p, hour));
    const front = (p: OutdoorPerson): { ox: number; oz: number; tx: number; tz: number; nx: number; nz: number } => {
      const use = plan.uses.find((u) => u.building === p.building);
      if (use === undefined || use.frame === null) throw new Error(`no front for #${p.id}`);
      return { ox: use.frame.origin.x, oz: use.frame.origin.z, tx: use.frame.t.x, tz: use.frame.t.z, nx: use.frame.n.x, nz: use.frame.n.z };
    };

    it(`seed ${seed}: counts by reason and by clip (${units} open downtown units)`, () => {
      const lines = [`seed ${seed}: ${people.length} slots, ${units} open downtown units`];
      for (const h of PRINT) {
        const here = there(h);
        const by = new Map<string, number>();
        const clip = new Map<string, number>();
        for (const p of here) {
          by.set(p.reason, (by.get(p.reason) ?? 0) + 1);
          clip.set(p.activity, (clip.get(p.activity) ?? 0) + 1);
        }
        lines.push(`  ${String(h).padStart(2, "0")}:00 ${String(here.length).padStart(3)}  ${[...by].map(([r, n]) => `${r} ${n}`).join(", ")}  |  ${[...clip].map(([r, n]) => `${r} ${n}`).join(", ")}`);
      }
      process.stderr.write(`${lines.join("\n")}\n`);
      for (const p of people) expect(ACTIVITIES, `${p.reason} #${p.id}`).toContain(p.activity);
    });

    it(`seed ${seed}: the whole downtown is held to the day's count at every tenth of an hour`, () => {
      let most = 0;
      for (const h of TENTHS) {
        const n = there(h).length;
        most = Math.max(most, n);
        const cap = ceilingAt(h, units);
        expect(n, `${h.toFixed(1)}`).toBeLessThanOrEqual(cap);
        // The small hours are nearly empty.
        if (h >= 1 && h <= 5) expect(n, `${h.toFixed(1)}`).toBeLessThanOrEqual(3);
        // A town of a fair size keeps most of its ceiling from late morning to late afternoon and a few at eight and at eight at night.
        if (k >= 0.4 && h >= 11 && h <= 16.5) expect(n, `${h.toFixed(1)}`).toBeGreaterThanOrEqual(Math.floor(0.4 * cap));
      }
      expect(most).toBeLessThanOrEqual(30);
      for (const h of [8, 20]) {
        const n = there(h).length;
        expect(n).toBeLessThanOrEqual(Math.ceil(12 * k));
        if (k >= 0.8) expect(n).toBeGreaterThanOrEqual(5);
      }
      if (k >= 0.8) for (const h of [11, 12, 13, 14, 15, 16]) expect(there(h).length, `${h}:00`).toBeGreaterThanOrEqual(15);
    });

    it(`seed ${seed}: a small town still has someone out at midday`, () => {
      // A town with a business, a bench or a corner to stand them at has a person or two through the day.
      if (units === 0) return;
      for (const h of [12, 13, 14]) expect(there(h).length, `${h}:00`).toBeGreaterThanOrEqual(1);
      if (units >= 5) expect(there(12).length).toBeGreaterThanOrEqual(2);
    });

    it(`seed ${seed}: the same plan gives the same people twice`, () => {
      expect(outdoorPeopleFor(plan, ground.anchor)).toBe(people);
      expect(outdoorPeopleFor({ ...plan }, ground.anchor)).toEqual(people);
    });

    it(`seed ${seed}: nobody is in a roadway, a prop's box, a building or too near a stranger, or outside downtown`, () => {
      const solids = plan.props.solids;
      for (const p of people) {
        const x = p.x - ground.anchor.x;
        const z = p.z - ground.anchor.z;
        const where = `${p.reason} #${p.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
        expect(inRoadway(plan, x, z, 0.3), where).toBe(false);
        // (A bench's sitter is in its own box.)
        for (const b of p.bench >= 0 ? [] : solids) {
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
          if (p.partner === q.id) {
            expect(d, `pair #${p.id} #${q.id}`).toBeGreaterThanOrEqual(PAIR_APART - 0.02);
            expect(d, `pair #${p.id} #${q.id}`).toBeLessThanOrEqual(PAIR_FAR + 0.02);
          } else expect(d, `${p.reason} #${p.id} and ${q.reason} #${q.id} at the same time`).toBeGreaterThanOrEqual(PEOPLE_APART - 1e-6);
        }
      }
    });

    it(`seed ${seed}: a place holds few at once: a window one, an office two (a pair, or 2.5 m apart), a cafe three, a tavern four, a bench one, a corner one`, () => {
      const at = new Map<string, OutdoorPerson[]>();
      for (const p of people) at.set(p.place, [...(at.get(p.place) ?? []), p]);
      for (const [place, list] of at) {
        for (const p of list) {
          const here = list.filter((q) => stayHolds(q, p.start));
          const same = (reason: string): number => here.filter((q) => q.reason === reason).length;
          const unit = p.unit >= 0 ? plan.uses.find((u) => u.building === p.building)?.units.find((u) => u.id === p.unit) : undefined;
          if (unit?.tenant != null) expect(here.length, `${place} at ${p.start.toFixed(2)}`).toBeLessThanOrEqual(unitCap(unit.tenant.trade));
          expect(same("window shopping"), place).toBeLessThanOrEqual(1);
          expect(same("bench"), place).toBeLessThanOrEqual(1);
          expect(same("corner"), place).toBeLessThanOrEqual(1);
          expect(same("break"), place).toBeLessThanOrEqual(2);
          for (const q of here) if (q.reason === "break" && p.reason === "break" && q.id !== p.id && q.partner !== p.id) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(2.5 - 1e-6);
        }
      }
    });

    it(`seed ${seed}: stays are half an hour at least (a corner's 0.3), mostly 0.6 to 1.5 hours, a bench's 1 to 3`, () => {
      const rest = people.filter((p) => p.reason !== "corner" && p.reason !== "bench");
      for (const p of people) {
        expect(p.length, `${p.reason} #${p.id}`).toBeGreaterThanOrEqual(p.reason === "corner" ? 0.3 - 1e-9 : p.reason === "bench" ? 1 - 1e-9 : 0.5 - 1e-9);
        if (p.reason === "corner") expect(p.length).toBeLessThanOrEqual(0.5 + 1e-9);
        if (p.reason === "bench") expect(p.length).toBeLessThanOrEqual(3 + 1e-9);
      }
      const usual = rest.filter((p) => p.length >= 0.6 && p.length <= 1.5).length;
      expect(usual / Math.max(1, rest.length)).toBeGreaterThan(0.6);
    });

    it(`seed ${seed}: a pair is one who talks and one who listens (or two with a cup), turned to each other and opened toward the street`, () => {
      for (const p of people) {
        if (p.partner < 0) continue;
        const q = people[p.partner] as OutdoorPerson;
        expect(q.partner).toBe(p.id);
        expect(p.hours).toEqual(q.hours);
        const set = [p.activity, q.activity].sort().join("+");
        expect(["cup+cup", "listen+talk", "cup+talk"], `${p.reason} #${p.id}`).toContain(set);
        if (set === "cup+talk") expect(p.reason).toBe("morning drink");
        // Each faces the other within 30 degrees, and not square on (15 degrees at least).
        for (const [a, b] of [[p, q], [q, p]] as const) {
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          const dot = (Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / d;
          expect(Math.acos(Math.min(1, dot)), `#${a.id} to #${b.id}`).toBeGreaterThan(0.2);
          expect(Math.acos(Math.min(1, dot)), `#${a.id} to #${b.id}`).toBeLessThan(0.6);
        }
      }
    });

    it(`seed ${seed}: no drink outside a tavern, a leaner has a wall behind and no glass, a window shopper faces a display window`, () => {
      for (const p of people) {
        expect(NO_DRINK.includes(p.activity), `${p.reason} #${p.id}`).toBe(false);
        if (p.activity === "cup" && (p.reason === "night shop" || p.reason === "round the clock")) {
          const trade = plan.uses.find((u) => u.building === p.building)?.units.find((u) => u.id === p.unit)?.tenant?.trade;
          expect(["convenience store", "gas station"], `${p.reason} #${p.id}`).toContain(trade);
        }
        if (p.activity === "lean") {
          const use = plan.uses.find((u) => u.building === p.building);
          const unit = use?.units.find((u) => u.id === p.unit);
          if (use === undefined || unit === undefined || use.frame === null) throw new Error("a leaner at no unit");
          const f = front(p);
          const dx = p.x - ground.anchor.x - f.ox;
          const dz = p.z - ground.anchor.z - f.oz;
          const s = dx * f.tx + dz * f.tz;
          const out = dx * f.nx + dz * f.nz;
          const where = `leaner #${p.id}`;
          expect(out, where).toBeCloseTo(LEAN_OUT, 3);
          // Facing straight out from the wall, a few degrees off square.
          expect(Math.sin(p.yaw) * f.nx + Math.cos(p.yaw) * f.nz, where).toBeGreaterThan(Math.cos(0.1));
          // On a stretch the front itself calls blank: no glass, no door, nothing at a person's height, and wide enough.
          const stretch = leanStretches(use, unit, use.frame.width).find(([a, b]) => s >= a + LEAN_BLANK / 2 - 1e-6 && s <= b - LEAN_BLANK / 2 + 1e-6);
          expect(stretch, where).toBeDefined();
          for (const o of unit.openings) if (o.cover !== "bricked") expect(s + LEAN_BLANK / 2 <= o.s0 || s - LEAN_BLANK / 2 >= o.s1, `${where} against glass`).toBe(true);
          expect(Math.abs(s - unit.door.s), `${where} by the door`).toBeGreaterThan(unit.door.width / 2 + LEAN_BLANK / 2);
          // The wall is behind them: the building's own rectangle lies within a hand of their back.
          const building = plan.buildings.find((b) => b.id === p.building);
          if (building === undefined) throw new Error("no building");
          const hu = building.bearing.a / building.bearing.c;
          const hv = building.bearing.b / building.bearing.c;
          const bx = p.x - ground.anchor.x - Math.sin(p.yaw) * (LEAN_OUT + 0.15);
          const bz = p.z - ground.anchor.z - Math.cos(p.yaw) * (LEAN_OUT + 0.15);
          const a = (bx - building.centre.x) * hu + (bz - building.centre.z) * hv;
          const c = -(bx - building.centre.x) * hv + (bz - building.centre.z) * hu;
          expect(Math.abs(a) <= building.halfAlong + 0.05 && Math.abs(c) <= building.halfAcross + 0.05, `${where} has a wall behind`).toBe(true);
        }
        if (p.reason === "window shopping") {
          const use = plan.uses.find((u) => u.building === p.building);
          const unit = use?.units.find((u) => u.id === p.unit);
          const f = front(p);
          const s = (p.x - ground.anchor.x - f.ox) * f.tx + (p.z - ground.anchor.z - f.oz) * f.tz;
          const out = (p.x - ground.anchor.x - f.ox) * f.nx + (p.z - ground.anchor.z - f.oz) * f.nz;
          expect(p.activity).toBe("look");
          expect(out, `window shopper #${p.id}`).toBeGreaterThanOrEqual(0.8 - 1e-6);
          expect(out, `window shopper #${p.id}`).toBeLessThanOrEqual(1.1 + 1e-6);
          expect(unit?.openings.some((o) => o.cover === "display" && s >= o.s0 && s <= o.s1), `window shopper #${p.id} in front of a display window`).toBe(true);
          expect(-(Math.sin(p.yaw) * f.nx + Math.cos(p.yaw) * f.nz), `window shopper #${p.id} faces the glass`).toBeGreaterThan(Math.cos(0.25));
        }
        if (p.activity === "wipe") {
          const f = front(p);
          const out = (p.x - ground.anchor.x - f.ox) * f.nx + (p.z - ground.anchor.z - f.oz) * f.nz;
          expect(out, `wiper #${p.id} at arm's length`).toBeLessThanOrEqual(0.6 + 1e-6);
        }
      }
    });

    it(`seed ${seed}: nobody faces a wall or a pole within a metre; a bench sitter faces as the bench does`, () => {
      for (const p of people) {
        const x = p.x - ground.anchor.x;
        const z = p.z - ground.anchor.z;
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        // One at a window faces the glass, and a sitter faces as their bench does: the rest are clear a metre ahead.
        if (p.reason === "window shopping" || p.activity === "wipe") continue;
        if (p.bench < 0) {
          expect(facingClear(plan, x, z, fx, fz), `${p.reason} ${p.activity} #${p.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true);
          for (const b of plan.buildings) {
            const hu = b.bearing.a / b.bearing.c;
            const hv = b.bearing.b / b.bearing.c;
            for (const d of [0.5, 1]) {
              const px = x + fx * d - b.centre.x;
              const pz = z + fz * d - b.centre.z;
              const a = px * hu + pz * hv;
              const c = -px * hv + pz * hu;
              expect(Math.abs(a) < b.halfAlong - 0.05 && Math.abs(c) < b.halfAcross - 0.05, `${p.reason} #${p.id} faces building ${b.id}`).toBe(false);
            }
          }
        }
        if (p.bench >= 0) {
          const f = plan.props.furniture.find((q) => q.id === p.bench);
          if (f === undefined) throw new Error("no bench");
          expect(Math.abs(fx * f.hx + fz * f.hz), `bench sitter #${p.id}`).toBeLessThan(0.15);
          expect(["sit_rest", "sit_phone"]).toContain(p.activity);
        }
      }
    });

    it(`seed ${seed}: everyone tied to a unit is inside its hours`, () => {
      for (const p of people) {
        if (p.unitHours === null) continue;
        for (let n = 0; n <= 10; n++) {
          const t = p.start + (p.length * n) / 10;
          expect(isOpen(p.unitHours, t), `${p.reason} #${p.id} at ${t.toFixed(2)}`).toBe(true);
        }
      }
    });
  }

  it("has a reason for every reason id, each with hours, caps and clips the models carry", () => {
    for (const r of REASONS) {
      expect(r.bands.length).toBeGreaterThan(0);
      expect(r.cap).toBeGreaterThan(0);
      for (const [a] of r.acts) if (a !== "pair" && a !== "cups") expect(ACTIVITIES).toContain(a);
      for (const b of r.bands) expect(b.stay[0]).toBeGreaterThanOrEqual(r.id === "corner" ? 0.3 : 0.5);
    }
  });

  it("holds the ceiling to its curve: 3 in the small hours, 12 at eight, 28 at midday, for the reference town", () => {
    expect(ceilingAt(3, 46)).toBe(3);
    expect(ceilingAt(8, 46)).toBe(12);
    expect(ceilingAt(12, 46)).toBe(28);
    expect(ceilingAt(20, 46)).toBe(12);
    expect(ceilingAt(12, 3)).toBe(2);
  });
});
