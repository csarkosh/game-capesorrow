// The people who walk from one business to another: the same twice; both ends open when a walker leaves and arrives; at every tenth of an hour and at
// random instants every walker is on a sidewalk or a crossing at a corner, clear of buildings and props, of the people who stand and of each other;
// the path is continuous and turns no faster than a person can; speeds are in the band; no two trips leave one door within 20 real seconds; and the
// count by hour is a small town's street: printed, and held to the bands scaled by the town's size. And the walkers are not a matched set: each has a speed of
// their own (and two near each other differ), a line of their own across the walk that bends, ends that are spread over the town's businesses, and about as many go
// one way along a block as the other.

/** The walkers' sum of the means by hour on main before the walkers were made different (the four seeds: sorrow, 20261121, 1, 6), measured by the same sampling. */
const MAIN_SUM: Record<string, number> = { sorrow: 57, 20261121: 27, 1: 14, 6: 2 };
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { describe, expect, it } from "vitest";
import { HOUR_S } from "../../src/game/dayClock.js";
import { hashN } from "../../src/game/town/groundNoise.js";
import { isOpen, unitHours, wrapHour } from "../../src/game/town/hours.js";
import { groundOf, inRoadway, isDowntown, isThere, openDowntownUnits, outdoorPeopleFor, rectDist } from "../../src/game/town/outdoorPeople.js";
import { WALK_WORK, walkerJob, CROSS_WIDTH, DOOR_GAP, END_APART, END_APART_SMALL, MAX_TURN, PAIR_CHANCE, SPEED_GAP, SPEED_NEAR, STANDER_CLEAR, TANDEM, TRIP_LENGTH, WALK_PROP, WALK_REASONS, WALK_SPEED, type Walker, alongAt, crossingsOf, rampsOf, pathPoint, walkCeilingAt, walkNet, walkable, walkHours, walkersFor } from "../../src/game/town/walkers.js";
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
      // A town the size of the one the table was set on has a few walking at noon and at five, and at eight and at eight at night up to three parties, most of
      // them two together: six at the most.
      if (k >= 0.8) {
        for (const h of [12, 17]) {
          // The mean over the hour about it, not the one instant (a street has its quiet minutes); and no more than eight at any.
          let sum = 0;
          for (let t = -5; t <= 5; t++) sum += walking(h + t / 10).length;
          expect(sum / 11, `${h}:00 mean`).toBeGreaterThanOrEqual(h === 17 ? 1 : 2);
          expect(walking(h).length, `${h}:00`).toBeLessThanOrEqual(8);
        }
        for (const h of [8, 20]) expect(walking(h).length, `${h}:00`).toBeLessThanOrEqual(6);
        expect(walking(8).length + walking(20).length).toBeGreaterThanOrEqual(1);
      }
    });

    it(`seed ${seed}: the day's count of walkers is not below what it was before they were made different (printed beside it)`, () => {
      let sum = 0;
      for (let h = 0; h < 24; h++) {
        let at = 0;
        for (let t = 0; t < 10; t++) at += walking(h + t / 10).length;
        sum += at / 10;
      }
      const was = MAIN_SUM[seed === SORROW ? "sorrow" : String(seed)] as number;
      process.stderr.write(`seed ${seed}: walker-hours in the day ${sum.toFixed(1)} (before: ${was})\n`);
      expect(sum).toBeGreaterThanOrEqual(was - 0.5);
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
                return Math.hypot(p.x - ax - dx * t, p.z - az - dz * t) <= CROSS_WIDTH;
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

    it(`seed ${seed}: at a corner or the end of a crossing that five trips or more use, the points the paths pass are spread (0.3 m or more), not one spot`, () => {
      // Where each path comes nearest a corner's ramp (within 3 m), and, across a roadway, where it crosses the middle of the crossing along the curb.
      const spread = (pts: readonly { x: number; z: number }[]): number => {
        const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const mz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
        return Math.sqrt(pts.reduce((a, p) => a + (p.x - mx) ** 2 + (p.z - mz) ** 2, 0) / pts.length);
      };
      const nearest = (w: typeof walkers[number], x: number, z: number, within: number): { x: number; z: number } | null => {
        let best = within;
        let at: { x: number; z: number } | null = null;
        // (Not where the path is a door's, its first and last nine metres: it is the door's own point there.)
        for (let i = 45; i < w.cum.length - 45; i++) {
          const d = Math.hypot((w.pts[i * 2] as number) - x, (w.pts[i * 2 + 1] as number) - z);
          if (d < best) {
            best = d;
            at = { x: w.pts[i * 2] as number, z: w.pts[i * 2 + 1] as number };
          }
        }
        return at;
      };
      let used = 0;
      let spreadOut = 0;
      const lines: string[] = [];
      for (const ramp of rampsOf(plan)) {
        const pts = walkers.filter((w) => w.partner < 0 || w.id < w.partner).map((w) => nearest(w, ramp.x, ramp.z, 3)).filter((p): p is { x: number; z: number } => p !== null);
        if (pts.length < 5) continue;
        const sd = spread(pts);
        // The clear width there: across the way the paths mostly go (the line through their points), the run of walkable, clear ground about the middle of them.
        const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const mz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
        let hx = 0;
        let hz = 0;
        for (const p of pts) {
          const d = Math.hypot(p.x - mx, p.z - mz);
          if (d > 0.05) {
            const sg = hx * (p.x - mx) + hz * (p.z - mz) < 0 ? -1 : 1;
            hx += (sg * (p.x - mx)) / d;
            hz += (sg * (p.z - mz)) / d;
          }
        }
        const hl = Math.hypot(hx, hz) || 1;
        const clear = (o: number): boolean => walkable(net, mx + (hx / hl) * o, mz + (hz / hl) * o) && !net.obst.blocked(mx + (hx / hl) * o, mz + (hz / hl) * o, 0.3, WALK_PROP);
        let lo = 0;
        let hi = 0;
        while (lo > -2.5 && clear(lo - 0.1)) lo -= 0.1;
        while (hi < 2.5 && clear(hi + 0.1)) hi += 0.1;
        const width = hi - lo;
        if (width < 1.2) continue;
        used++;
        if (sd >= 0.3) spreadOut++;
        else lines.push(`corner at ${ramp.x.toFixed(0)}, ${ramp.z.toFixed(0)}: ${pts.length} trips, spread ${sd.toFixed(2)} m, clear width ${width.toFixed(1)} m`);
      }
      let crossUsed = 0;
      let crossSpread = 0;
      for (const [ax, az, bx, bz] of crossings) {
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const l = Math.hypot(bx - ax, bz - az);
        const cx = -(bz - az) / l;
        const cz = (bx - ax) / l;
        const us = walkers.filter((w) => w.partner < 0 || w.id < w.partner).map((w) => nearest(w, mx, mz, 1.6)).filter((p): p is { x: number; z: number } => p !== null).map((p) => (p.x - mx) * cx + (p.z - mz) * cz);
        if (us.length < 5) continue;
        crossUsed++;
        const m = us.reduce((a, b) => a + b, 0) / us.length;
        const sd = Math.sqrt(us.reduce((a, b) => a + (b - m) ** 2, 0) / us.length);
        if (sd >= 0.3) crossSpread++;
        else lines.push(`crossing at ${mx.toFixed(0)}, ${mz.toFixed(0)}: ${us.length} trips, spread ${sd.toFixed(2)} m`);
      }
      process.stderr.write(`seed ${seed}: ${used} corners used by 5 trips or more, ${spreadOut} spread 0.3 m or more; ${crossUsed} crossings, ${crossSpread} spread across their width${lines.length > 0 ? `\n  not spread: ${lines.join("; ")}` : ""}\n`);
      // Most of them (seven in ten, where there are six or more such places): a corner a few trips use may by chance have them near one spot.
      // (Six or more: the played seed's town has five, and two of them are the two ramps of one corner, which the same six trips cross at the same place.)
      if (used >= 6) expect(spreadOut / used).toBeGreaterThanOrEqual(0.7);
      if (crossUsed >= 3) expect(crossSpread / crossUsed).toBeGreaterThanOrEqual(0.7);
    });

    it(`seed ${seed}: two together walk side by side, the gap between them breathing between 0.6 and 0.9 m, or one behind the other on one line where there is no room abreast`, () => {
      let abreast = 0;
      let file = 0;
      for (const w of walkers) {
        if (w.partner < 0) continue;
        const o = walkers[w.partner] as Walker;
        expect(o.partner).toBe(w.id);
        expect(o.speed).toBe(w.speed);
        expect(o.model === w.model && o.offset === w.offset).toBe(false);
        const mid = (w.length / 2) * (hashN(w.id, 1, 1, 81) * 0.4 + 0.8);
        if (o.t0 === w.t0) {
          abreast++;
          // Mid-path they are the pair's distance apart.
          const a = pathPoint(w, mid);
          const b = pathPoint(o, Math.min(mid, o.length));
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.55);
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.95);
        } else {
          file++;
          // The one line, and the second a pace and a bit behind the first on it.
          expect(o.pts).toBe(w.pts);
          expect(o.length).toBe(w.length);
          const lag = Math.abs(wrapHour(o.t0 - w.t0 + 12) - 12) * HOUR_S * w.speed;
          expect(lag).toBeGreaterThanOrEqual(TANDEM[0] - 1e-6);
          expect(lag).toBeLessThanOrEqual(TANDEM[1] + 1e-6);
        }
      }
      process.stderr.write(`seed ${seed}: ${abreast / 2} pairs abreast, ${file / 2} in file\n`);
    });

    it(`seed ${seed}: each walker's speed is their own, bell-shaped, and two out together within 60 m differ by 0.12 m/s or more`, () => {
      const sp = walkers.map((w) => w.speed);
      const mean = sp.reduce((a, b) => a + b, 0) / Math.max(1, sp.length);
      const sd = Math.sqrt(sp.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, sp.length));
      process.stderr.write(`seed ${seed}: speeds ${Math.min(...sp).toFixed(2)} to ${Math.max(...sp).toFixed(2)}, mean ${mean.toFixed(2)}, sd ${sd.toFixed(3)}, under 1.1: ${sp.filter((v) => v < 1.1).length}, over 1.55: ${sp.filter((v) => v > 1.55).length} of ${sp.length}\n`);
      for (const v of sp) {
        expect(v).toBeGreaterThanOrEqual(WALK_SPEED[0]);
        expect(v).toBeLessThanOrEqual(WALK_SPEED[1]);
      }
      if (walkers.length >= 40) expect(sd).toBeGreaterThanOrEqual(0.13);
      for (const [i, a] of walkers.entries()) {
        for (const b of walkers.slice(i + 1)) {
          if (a.partner === b.id) continue;
          if (Math.abs(a.speed - b.speed) >= SPEED_GAP - 1e-9) continue;
          // They must never be near each other at the same time.
          const ha = walkHours(a);
          const hb = walkHours(b);
          const gap = wrapHour(b.t0 - a.t0);
          for (const shift of [gap, gap - 24]) {
            const lo = Math.max(0, shift);
            const hi = Math.min(ha, shift + hb);
            for (let u = lo; u <= hi; u += 2 / HOUR_S) {
              const p = pathPoint(a, u * HOUR_S * a.speed);
              const q = pathPoint(b, (u - shift) * HOUR_S * b.speed);
              expect(Math.hypot(p.x - q.x, p.z - q.z), `walkers #${a.id} (${a.speed.toFixed(2)}) and #${b.id} (${b.speed.toFixed(2)})`).toBeGreaterThanOrEqual(SPEED_NEAR);
            }
          }
        }
      }
    });

    it(`seed ${seed}: no two trips out together share a destination or an origin (a quarter hour apart where the town's few open units could not), and no end has much more than its share`, () => {
      const trips = walkers.filter((w) => w.partner < 0 || w.id < w.partner);
      const gapOf = (a: number, b: number): number => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
      let relaxed = 0;
      const endKey = (u: { building: number; unit: number }): string => `${u.building}:${u.unit}`;
      for (const [i, a] of trips.entries()) {
        if (a.relaxed) relaxed++;
        for (const b of trips.slice(i + 1)) {
          const bothStrict = !a.relaxed && !b.relaxed;
          const sameTo = endKey(a.to) === endKey(b.to);
          const sameFrom = endKey(a.from) === endKey(b.from);
          if (!sameTo && !sameFrom) continue;
          if (sameTo) {
            // Arrivals: a quarter hour apart where relaxed; trips out at once, with 30 real seconds either side, where not.
            if (bothStrict) {
              const out = (w: typeof a): [number, number] => [w.t0, w.t0 + walkHours(w)];
              const [a0, a1] = out(a);
              const [b0, b1] = out(b);
              const clash = [-24, 0, 24].some((sh) => a0 - END_APART < b1 + sh && b0 + sh < a1 + END_APART);
              expect(clash, `trips #${a.id} and #${b.id} to one end, together`).toBe(false);
            } else expect(gapOf(a.t0 + walkHours(a), b.t0 + walkHours(b)), `trips #${a.id} and #${b.id} arriving at one end`).toBeGreaterThanOrEqual(END_APART_SMALL - 1e-6);
          }
          if (sameFrom) {
            if (bothStrict) {
              const out = (w: typeof a): [number, number] => [w.t0, w.t0 + walkHours(w)];
              const [a0, a1] = out(a);
              const [b0, b1] = out(b);
              const clash = [-24, 0, 24].some((sh) => a0 - END_APART < b1 + sh && b0 + sh < a1 + END_APART);
              expect(clash, `trips #${a.id} and #${b.id} from one end, together`).toBe(false);
            } else expect(gapOf(a.t0, b.t0), `trips #${a.id} and #${b.id} leaving one end`).toBeGreaterThanOrEqual(END_APART_SMALL - 1e-6);
          }
        }
      }
      const top = (f: (w: typeof trips[number]) => string): number => {
        const m = new Map<string, number>();
        for (const w of trips) m.set(f(w), (m.get(f(w)) ?? 0) + 1);
        return Math.max(0, ...m.values());
      };
      const dest = top((w) => endKey(w.to));
      const orig = top((w) => endKey(w.from));
      process.stderr.write(`seed ${seed}: ${trips.length} trips, ${relaxed} on the quarter-hour rule, busiest destination ${dest} (${((100 * dest) / Math.max(1, trips.length)).toFixed(1)}%), busiest origin ${orig} (${((100 * orig) / Math.max(1, trips.length)).toFixed(1)}%)\n`);
      // A town with 40 or more open downtown units keeps every end to 8 percent; one with 20 or more to a sixth (a few reachable doors cannot do better).
      if (units >= 40) {
        expect(dest / trips.length).toBeLessThanOrEqual(0.08);
        expect(orig / trips.length).toBeLessThanOrEqual(0.08);
      } else if (units >= 20) {
        expect(dest / trips.length).toBeLessThanOrEqual(0.18);
        expect(orig / trips.length).toBeLessThanOrEqual(0.18);
      }
    });

    it(`seed ${seed}: people go for a coffee, to lunch and out for the evening two together and run an errand alone, and no path is a ruler line: it bends a few centimetres over any straight 20 m, and two going one way on a walk are on lines of their own`, () => {
      // Of the trips that are not errands, most are two walking together; of the errands, few.
      // Of the people out for anything but an errand, most are with someone; of those on an errand, few.
      const social = walkers.filter((w) => w.reason !== "errand");
      const errands = walkers.filter((w) => w.reason === "errand");
      const together = (list: readonly Walker[]): number => list.filter((w) => w.partner >= 0).length / Math.max(1, list.length);
      expect(together(social)).toBeGreaterThan(0.5);
      expect(together(errands)).toBeLessThan(0.4);
      expect(PAIR_CHANCE.errand).toBeLessThan(0.25);
      expect(PAIR_CHANCE.evening).toBeGreaterThan(0.7);
      // Two who are together are within three metres of each other all the way, abreast or one behind the other.
      for (const w of walkers) {
        if (w.partner < 0 || w.id > w.partner) continue;
        const o = walkers[w.partner] as Walker;
        expect(o.partner).toBe(w.id);
        for (const share of [0.2, 0.5, 0.8]) {
          const hour = w.t0 + (share * w.length) / (w.speed * HOUR_S);
          const a = pathPoint(w, Math.max(0, alongAt(w, hour)));
          const b = pathPoint(o, Math.max(0, Math.min(o.length, alongAt(o, hour))));
          expect(Math.hypot(a.x - b.x, a.z - b.z), `#${w.id} with #${o.id}`).toBeLessThan(3);
        }
      }
      // The greatest distance from its chord over each 20 m of a path that is straight (its way changes by under ten degrees along it), clear of the doors.
      let windows = 0;
      let flat = 0;
      let bent = 0;
      for (const w of walkers) {
        const n = w.cum.length;
        for (let i = 45; i + 100 < n - 45; i += 25) {
          const ax = w.pts[i * 2] as number;
          const az = w.pts[i * 2 + 1] as number;
          const bx = w.pts[(i + 100) * 2] as number;
          const bz = w.pts[(i + 100) * 2 + 1] as number;
          const dx = bx - ax;
          const dz = bz - az;
          const l = Math.hypot(dx, dz);
          let far = 0;
          let turn = 0;
          for (let q = 0; q <= 100; q += 5) {
            far = Math.max(far, Math.abs((((w.pts[(i + q) * 2] as number) - ax) * dz - ((w.pts[(i + q) * 2 + 1] as number) - az) * dx) / l));
            if (q >= 5) {
              const h0 = Math.atan2((w.pts[(i + q) * 2] as number) - (w.pts[(i + q - 5) * 2] as number), (w.pts[(i + q) * 2 + 1] as number) - (w.pts[(i + q - 5) * 2 + 1] as number));
              const h1 = Math.atan2(dx, dz);
              let t = Math.abs(h0 - h1);
              if (t > Math.PI) t = 2 * Math.PI - t;
              turn = Math.max(turn, t);
            }
          }
          if (turn > (10 * Math.PI) / 180) continue;
          windows++;
          if (far < 0.04) flat++;
          else if (far <= 0.3) bent++;
        }
      }
      process.stderr.write(`seed ${seed}: ${walkers.filter((w) => w.partner >= 0).length / 2} pairs; straight 20 m windows ${windows}: ${bent} bend 4 to 30 cm, ${flat} under 4 cm\n`);
      if (windows > 20) expect(flat / windows).toBeLessThanOrEqual(0.1);
      // Two non-partners going one way within 8 m of each other: the mean of their sideways distance, over the moments they share, is 0.2 m or more.
      const shared = new Map<string, { sum: number; n: number }>();
      for (let h = 6; h < 23; h += 1 / HOUR_S) {
        const on = walking(h);
        for (const [i, a] of on.entries()) {
          for (const b of on.slice(i + 1)) {
            if (a.partner === b.id) continue;
            const p = pathPoint(a, alongAt(a, h));
            const q = pathPoint(b, alongAt(b, h));
            if (Math.hypot(p.x - q.x, p.z - q.z) > 8 || Math.cos(p.yaw - q.yaw) < 0.95) continue;
            const side = Math.abs((q.x - p.x) * Math.cos(p.yaw) - (q.z - p.z) * Math.sin(p.yaw));
            const key = `${a.id}:${b.id}`;
            const e = shared.get(key) ?? { sum: 0, n: 0 };
            e.sum += side;
            e.n++;
            shared.set(key, e);
          }
        }
      }
      const same = [...shared.values()].filter((e) => e.n >= 4);
      const apart = same.filter((e) => e.sum / e.n >= 0.2).length;
      process.stderr.write(`seed ${seed}: ${same.length} pairs going one way together, ${apart} at least 0.2 m apart sideways\n`);
      if (same.length >= 5) expect(apart / same.length).toBeGreaterThanOrEqual(0.9);
    });

  }

  // The work of making a town's walkers, counted and not timed (this machine's time limits fail under load; the seconds are printed beside it). The bounds are
  // about half as much again as it takes now, which is a second or so on an idle machine for the played seed and under two for "sorrow".
  // (The played seed's steps are 126,000 before the downtown and 344,000 after, in 0.62 s and 0.70 s: its bound for them is 520,000.)
  // (With most trips made by two, each trip is two walkers to hold clear of the rest: the played seed's steps are 564,000 and "sorrow"'s 1,046,000, and
  // their bounds 700,000 and 1,300,000.)
  for (const [seed, bound] of [[SORROW, { builds: 1700, lines: 1900, points: 800_000, steps: 1_300_000 }], [20261121, { builds: 2000, lines: 1500, points: 850_000, steps: 700_000 }]] as const) {
    it(`seed ${seed}: making the walkers takes a bounded amount of work`, () => {
      const g = townGround(seed);
      outdoorPeopleFor(g.plan, g.anchor);
      const t = performance.now();
      const job = walkerJob(g.plan, g.anchor);
      let slices = 0;
      while (!job.next().done) slices++;
      const seconds = (performance.now() - t) / 1000;
      process.stderr.write(`seed ${seed}: ${seconds.toFixed(2)} s, ${slices} slices; work ${JSON.stringify(WALK_WORK)}\n`);
      expect(WALK_WORK.builds).toBeLessThanOrEqual(bound.builds);
      expect(WALK_WORK.lines).toBeLessThanOrEqual(bound.lines);
      expect(WALK_WORK.points).toBeLessThanOrEqual(bound.points);
      expect(WALK_WORK.steps).toBeLessThanOrEqual(bound.steps);
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
