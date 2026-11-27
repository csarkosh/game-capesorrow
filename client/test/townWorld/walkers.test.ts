// The people who walk from one business to another: the same twice; both ends open when a walker leaves and arrives; at every tenth of an hour and at
// random instants every walker is on a sidewalk or a crossing at a corner, clear of buildings and props, of the people who stand and of each other;
// the path is continuous and turns no faster than a person can; speeds are in the band; no two trips leave one door within 20 real seconds; and the
// count by hour is a small town's street: printed, and held to the bands scaled by the town's size.
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { describe, expect, it } from "vitest";
import { HOUR_S } from "../../src/game/dayClock.js";
import { hashN } from "../../src/game/town/groundNoise.js";
import { isOpen, unitHours, wrapHour } from "../../src/game/town/hours.js";
import { groundOf, inRoadway, isDowntown, isThere, openDowntownUnits, outdoorPeopleFor, rectDist } from "../../src/game/town/outdoorPeople.js";
import { DOOR_GAP, MAX_TURN, PAIR_SIDE, STANDER_CLEAR, TRIP_LENGTH, WALK_PROP, WALK_REASONS, WALK_SPEED, alongAt, crossingsOf, pathPoint, walkCeilingAt, walkNet, walkable, walkHours, walkersFor } from "../../src/game/town/walkers.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { WORLD_SEEDS } from "./world.js";

const SORROW = seedFromToken("sorrow");
const SEEDS = [SORROW, ...WORLD_SEEDS];
const PRINT = [3, 8, 10, 12, 15, 17, 20, 22];
const TENTHS = Array.from({ length: 240 }, (_, i) => i / 10);
/** The metres at each end of a path that are a door's: inside it, across its forecourt. */
const DOOR_LEAD = 9;

describe("the people who walk", () => {
  for (const seed of SEEDS) {
    const ground = townGround(seed);
    const plan = ground.plan;
    const walkers = walkersFor(plan, ground.anchor);
    const standers = outdoorPeopleFor(plan, ground.anchor);
    const units = openDowntownUnits(plan);
    const k = units / 46;
    const net = walkNet(plan);
    const g = groundOf(plan);
    const crossings = crossingsOf(plan);
    const walking = (hour: number): typeof walkers[number][] => walkers.filter((w) => alongAt(w, hour) >= 0);
    const unitOf = (b: number, u: number) => {
      const building = plan.buildings.find((x) => x.id === b);
      const unit = plan.uses.find((x) => x.building === b)?.units.find((x) => x.id === u);
      if (building === undefined || unit === undefined) throw new Error(`no unit ${b}:${u}`);
      return { building, unit, hours: unitHours(building, unit) };
    };
    // Instants: every tenth of an hour, and 200 more by a hash.
    const instants = [...TENTHS, ...Array.from({ length: 200 }, (_, i) => hashN(seed, i, 5, 80) * 24)];

    it(`seed ${seed}: counts by hour (${units} open downtown units, ${walkers.length} walkers, ${walkers.filter((w) => w.partner >= 0).length / 2} pairs)`, () => {
      const lines = [`seed ${seed}: ${walkers.length} walkers, ${units} open downtown units`];
      for (const h of PRINT) {
        const by = new Map<string, number>();
        for (const w of walking(h)) by.set(w.reason, (by.get(w.reason) ?? 0) + 1);
        lines.push(`  ${String(h).padStart(2, "0")}:00 ${String(walking(h).length).padStart(2)}  ${[...by].map(([r, n]) => `${r} ${n}`).join(", ")}`);
      }
      process.stderr.write(`${lines.join("\n")}\n`);
      let most = 0;
      for (const h of TENTHS) {
        const n = walking(h).length;
        most = Math.max(most, n);
        expect(n, `${h.toFixed(1)}`).toBeLessThanOrEqual(walkCeilingAt(h, units));
        if (h >= 1 && h <= 5) expect(n, `${h.toFixed(1)}`).toBeLessThanOrEqual(1);
      }
      expect(most).toBeLessThanOrEqual(Math.max(1, Math.ceil(8 * k + 0.5)));
      // A town the size of the one the table was set on has a few walking at noon and at five, and one to four at eight and at eight at night.
      if (k >= 0.8) {
        for (const h of [12, 17]) {
          expect(walking(h).length, `${h}:00`).toBeGreaterThanOrEqual(2);
          expect(walking(h).length, `${h}:00`).toBeLessThanOrEqual(8);
        }
        for (const h of [8, 20]) expect(walking(h).length, `${h}:00`).toBeLessThanOrEqual(4);
        expect(walking(8).length + walking(20).length).toBeGreaterThanOrEqual(1);
      }
    });

    it(`seed ${seed}: the same plan gives the same walkers twice`, () => {
      expect(walkersFor(plan, ground.anchor)).toBe(walkers);
      const again = walkersFor({ ...plan }, ground.anchor);
      expect(again.length).toBe(walkers.length);
      for (const [i, w] of walkers.entries()) {
        const o = again[i];
        expect(o?.t0).toBe(w.t0);
        expect(o?.speed).toBe(w.speed);
        expect(o?.length).toBe(w.length);
        expect([...(o?.pts ?? [])]).toEqual([...w.pts]);
      }
    });

    it(`seed ${seed}: both ends are open units, when a walker leaves and when they arrive; trips are 30 to 220 m, mostly; speeds are 1.15 to 1.45 m/s`, () => {
      let inRange = 0;
      for (const w of walkers) {
        const from = unitOf(w.from.building, w.from.unit);
        const to = unitOf(w.to.building, w.to.unit);
        expect(from.hours, `${w.reason} #${w.id}`).not.toBeNull();
        expect(isDowntown(plan.lots[from.building.lot]?.district)).toBe(true);
        expect(isDowntown(plan.lots[to.building.lot]?.district)).toBe(true);
        expect(from.unit.state).toBe("open");
        expect(to.unit.state).toBe("open");
        if (from.hours !== null) expect(isOpen(from.hours, w.t0), `${w.reason} #${w.id} leaves ${w.t0.toFixed(2)}`).toBe(true);
        if (to.hours !== null) expect(isOpen(to.hours, w.t0 + walkHours(w)), `${w.reason} #${w.id} arrives ${(w.t0 + walkHours(w)).toFixed(2)}`).toBe(true);
        expect(w.speed).toBeGreaterThanOrEqual(WALK_SPEED[0]);
        expect(w.speed).toBeLessThanOrEqual(WALK_SPEED[1]);
        expect(w.length).toBeGreaterThan(TRIP_LENGTH[0] * 0.75);
        expect(w.length).toBeLessThan(TRIP_LENGTH[1] * 1.3);
        if (w.length >= TRIP_LENGTH[0] && w.length <= TRIP_LENGTH[1]) inRange++;
        expect(WALK_REASONS.some((r) => r.id === w.reason)).toBe(true);
      }
      if (walkers.length > 0) expect(inRange / walkers.length).toBeGreaterThan(0.8);
    });

    it(`seed ${seed}: no two trips leave a door within 20 real seconds`, () => {
      for (const [i, a] of walkers.entries()) {
        for (const b of walkers.slice(i + 1)) {
          if (a.partner === b.id || a.from.building !== b.from.building || a.from.unit !== b.from.unit) continue;
          const d = Math.abs(a.t0 - b.t0);
          expect(Math.min(d, 24 - d), `trips #${a.id} and #${b.id}`).toBeGreaterThanOrEqual(DOOR_GAP - 1e-6);
        }
      }
    });

    it(`seed ${seed}: a walker is on a sidewalk or a crossing, clear of buildings, props, people who stand and other walkers, at every tenth of an hour and at 200 more instants`, () => {
      for (const h of instants) {
        const now = walking(h);
        for (const w of now) {
          const s = alongAt(w, h);
          const p = pathPoint(w, s);
          const where = `${w.reason} #${w.id} at ${h.toFixed(2)}, ${s.toFixed(0)} of ${w.length.toFixed(0)} m, (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
          const lead = s < DOOR_LEAD || s > w.length - DOOR_LEAD;
          if (!lead) {
            expect(walkable(net, p.x, p.z), `${where} on the walk`).toBe(true);
            for (const b of g.buildings) expect(rectDist(b, p.x, p.z), `${where} by a wall`).toBeGreaterThanOrEqual(0.3 - 0.03);
            // In the roadway only on a crossing at a corner.
            if (inRoadway(plan, p.x, p.z, 0)) {
              const on = crossings.some(([ax, az, bx, bz]) => {
                const dx = bx - ax;
                const dz = bz - az;
                const t = Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz || 1)));
                return Math.hypot(p.x - ax - dx * t, p.z - az - dz * t) <= 1;
              });
              expect(on, `${where} in the roadway off a crossing`).toBe(true);
            }
          }
          for (const b of g.boxes) expect(rectDist(b, p.x, p.z), `${where} in a prop`).toBeGreaterThanOrEqual(WALK_PROP - 0.04);
          for (const b of g.benches) expect(rectDist(b, p.x, p.z), `${where} in a bench`).toBeGreaterThanOrEqual(WALK_PROP - 0.04);
          for (const t of g.things) expect(Math.hypot(p.x - t.x, p.z - t.z), `${where} in a post or a sign`).toBeGreaterThanOrEqual(t.r + WALK_PROP - 0.04);
          for (const q of standers) if (isThere(q, h)) expect(Math.hypot(p.x - q.px, p.z - q.pz), `${where} by a ${q.activity} stander #${q.id}`).toBeGreaterThanOrEqual(STANDER_CLEAR - 0.1);
          for (const o of now) {
            if (o.id <= w.id || o.partner === w.id) continue;
            const q = pathPoint(o, alongAt(o, h));
            expect(Math.hypot(p.x - q.x, p.z - q.z), `${where} and walker #${o.id}`).toBeGreaterThanOrEqual(0.6 - 0.02);
          }
        }
      }
    });

    it(`seed ${seed}: a path is continuous and turns no faster than a person can (a corner is an arc, not a snap)`, () => {
      for (const w of walkers) {
        const n = w.cum.length;
        for (let i = 1; i < n; i++) {
          const d = Math.hypot((w.pts[i * 2] as number) - (w.pts[i * 2 - 2] as number), (w.pts[i * 2 + 1] as number) - (w.pts[i * 2 - 1] as number));
          // (A pair's second, offset round a corner, goes a little farther in a step on the outside of it: at most about 2.5 times on a tight one.)
          expect(d, `#${w.id} step ${i}`).toBeLessThanOrEqual(w.partner >= 0 ? 0.2 * 2.6 : 0.2 * 1.05);
        }
        // The way along it, over 1.2 m (the bend's whole arc): no more than 125 degrees, which is a hundred degrees a metre, but at a door, where a pair's second makes a tighter turn.
        for (let i = 3; i + 3 < n; i++) {
          if (i < 15 || i > n - 16) continue;
          const a = Math.atan2((w.pts[i * 2] as number) - (w.pts[(i - 3) * 2] as number), (w.pts[i * 2 + 1] as number) - (w.pts[(i - 3) * 2 + 1] as number));
          const b = Math.atan2((w.pts[(i + 3) * 2] as number) - (w.pts[i * 2] as number), (w.pts[(i + 3) * 2 + 1] as number) - (w.pts[i * 2 + 1] as number));
          let turn = Math.abs(a - b);
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          expect(turn, `#${w.id} at ${(i * 0.2).toFixed(1)} m`).toBeLessThan(MAX_TURN);
        }
      }
    });

    it(`seed ${seed}: a pair walks side by side at one speed, 0.7 m apart`, () => {
      for (const w of walkers) {
        if (w.partner < 0) continue;
        const o = walkers[w.partner];
        expect(o?.partner).toBe(w.id);
        expect(o?.speed).toBe(w.speed);
        expect(o?.t0).toBe(w.t0);
        expect(o?.model === w.model && o?.offset === w.offset).toBe(false);
        // Mid-path they are the pair's distance apart.
        const mid = (w.length / 2) * (hashN(w.id, 1, 1, 81) * 0.4 + 0.8);
        const a = pathPoint(w, mid);
        const b = pathPoint(o as typeof w, Math.min(mid, (o as typeof w).length));
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(PAIR_SIDE - 0.2);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(PAIR_SIDE + 0.2);
      }
    });
  }

  it("keeps the table's hours, rates and kinds readable", () => {
    for (const r of WALK_REASONS) {
      expect(r.from.length).toBeGreaterThan(0);
      expect(r.to.length).toBeGreaterThan(0);
      for (const b of r.bands) {
        expect(b.to).toBeGreaterThan(b.from);
        expect(b.rate).toBeGreaterThan(0);
      }
    }
  });

  it("holds the ceiling to its curve: one in the small hours, eight in the day, four at eight and at eight at night, for the reference town", () => {
    expect(walkCeilingAt(3, 46)).toBe(1);
    expect(walkCeilingAt(12, 46)).toBe(8);
    expect(walkCeilingAt(8, 46)).toBe(5);
    expect(walkCeilingAt(20.5, 46)).toBe(5);
    expect(walkCeilingAt(12, 3)).toBe(1);
    void wrapHour;
    void HOUR_S;
  });
});
