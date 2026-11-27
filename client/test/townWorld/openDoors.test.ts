// The doors that open for the walkers (`openDoors.ts`): every trip's two doors are found; a door is shut when nobody is near it; at the instant any walker
// crosses a door's plane it is open by 70 degrees or more; its angle never jumps; no walker is within the leaf's sweep while it is moving; and a walker inside
// the room with the door shut is not drawn, while one outside it always is (the rule that no one appears or vanishes in the street).
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { describe, expect, it } from "vitest";
import { HOUR_S } from "../../src/game/dayClock.js";
import { wrapHour } from "../../src/game/town/hours.js";
import { MAX_IN, MIN_IN, isPair, SHUT_BELOW, angleAt, doorDepth, doorLook, doorsFor, hiddenByDoor, hingeOf, movingDoors, unitKey, type Door } from "../../src/game/town/openDoors.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { alongAt, pathPoint, walkersFor } from "../../src/game/town/walkers.js";
import { WORLD_SEEDS } from "./world.js";

const SEEDS = [seedFromToken("sorrow"), ...WORLD_SEEDS];
const DEG70 = (70 * Math.PI) / 180;
/** The step of 1/60 of a real second, in hours. */
const FRAME = 1 / 60 / HOUR_S;

describe("a door's look", () => {
  it("is its own by a roll: the angle 80 to 95 degrees, opening about 0.6 s and closing 1.4 to 2.2 s, the hinge either side", () => {
    const looks = Array.from({ length: 40 }, (_, i) => doorLook(100 + i, i % 5));
    for (const l of looks) {
      expect(l.maxAngle).toBeGreaterThanOrEqual((80 * Math.PI) / 180 - 1e-9);
      expect(l.maxAngle).toBeLessThanOrEqual((95 * Math.PI) / 180 + 1e-9);
      expect(l.openS).toBeGreaterThanOrEqual(0.5);
      expect(l.openS).toBeLessThanOrEqual(0.7);
      expect(l.closeS).toBeGreaterThanOrEqual(1.4);
      expect(l.closeS).toBeLessThanOrEqual(2.2);
    }
    expect(looks.some((l) => l.hingeNeg)).toBe(true);
    expect(looks.some((l) => !l.hingeNeg)).toBe(true);
    expect(new Set(looks.map((l) => l.maxAngle.toFixed(4))).size).toBeGreaterThan(20);
    expect(doorLook(7, 3)).toEqual(doorLook(7, 3));
  });
});

for (const seed of SEEDS) {
  describe(`the doors of seed ${seed}`, () => {
    const ground = townGround(seed);
    const plan = ground.plan;
    const walkers = walkersFor(plan, ground.anchor);
    const book = doorsFor(plan, ground.anchor, walkers);
    const doorOf = (b: number, u: number): Door => {
      const i = book.byUnit.get(unitKey(b, u));
      if (i === undefined) throw new Error(`no door for ${b}:${u}`);
      return book.doors[i] as Door;
    };
    const unitOf = (b: number, u: number) => plan.uses.find((x) => x.building === b)?.units.find((x) => x.id === u);

    it("are found for both ends of every trip, with a depth the room's floor allows", () => {
      expect(walkers.length).toBeGreaterThan(0);
      for (const w of walkers) {
        for (const end of [w.from, w.to]) {
          const d = doorOf(end.building, end.unit);
          expect(d.depth - d.set).toBeGreaterThanOrEqual(MIN_IN - 1e-9);
          expect(d.depth - d.set).toBeLessThanOrEqual(MAX_IN + 1e-9);
          const u = unitOf(end.building, end.unit);
          expect(u).toBeDefined();
          expect(d.depth).toBe(doorDepth(u as NonNullable<typeof u>));
        }
      }
    });

    it("begin each trip at the middle of the door and inside the room by the door's depth", () => {
      for (const w of walkers.slice(0, 60)) {
        const d = doorOf(w.from.building, w.from.unit);
        const p0 = pathPoint(w, 0);
        const inside = (p0.x - d.x) * -d.nx + (p0.z - d.z) * -d.nz;
        expect(inside).toBeCloseTo(d.depth, 1);
        const across = (p0.x - d.x) * d.tx + (p0.z - d.z) * d.tz;
        if (w.partner < 0) expect(across).toBeCloseTo(isPair(d.width) ? d.width / 4 : 0, 1);
      }
    });

    it("are shut when no walker is within their times, and open by 70 degrees when any walker crosses the plane", () => {
      for (const w of walkers) {
        const speed = w.speed * HOUR_S;
        for (const [end, along] of [[w.from, doorOf(w.from.building, w.from.unit).depth - doorOf(w.from.building, w.from.unit).set], [w.to, w.length - (doorOf(w.to.building, w.to.unit).depth - doorOf(w.to.building, w.to.unit).set)]] as const) {
          const d = doorOf(end.building, end.unit);
          const t = w.t0 + along / speed;
          expect(angleAt(d, wrapHour(t)), `walker ${w.id} at ${end.building}:${end.unit}`).toBeGreaterThanOrEqual(DEG70);
        }
      }
      // Every angle is within 0 to the door's own, and a door is shut a minute of game time from any of its calls.
      for (const d of book.doors) {
        for (let i = 0; i < d.t.length; i++) {
          expect(d.a[i] as number).toBeGreaterThanOrEqual(0);
          expect(d.a[i] as number).toBeLessThanOrEqual(d.look.maxAngle + 1e-9);
        }
        const first = d.t[0] as number;
        expect(angleAt(d, wrapHour(first - 0.01))).toBe(0);
        const last = d.t[d.t.length - 1] as number;
        expect(angleAt(d, wrapHour(last + 0.01))).toBe(0);
      }
    });

    it("never jump: over 1/60 s the angle moves no more than the leaf's own speed allows, sampled round every crossing", () => {
      for (const w of walkers.slice(0, 80)) {
        const speed = w.speed * HOUR_S;
        for (const [end, along] of [[w.from, doorOf(w.from.building, w.from.unit).depth - doorOf(w.from.building, w.from.unit).set], [w.to, w.length - (doorOf(w.to.building, w.to.unit).depth - doorOf(w.to.building, w.to.unit).set)]] as const) {
          const d = doorOf(end.building, end.unit);
          const t = w.t0 + along / speed;
          // The leaf's fastest: smoothstep's slope (1.5) over the shortest of its moves, a quarter second, bounds a step a frame.
          const most = (1.5 * d.look.maxAngle) / (0.25 * 60);
          for (let k = -240; k <= 240; k++) {
            const a = angleAt(d, wrapHour(t + (k * FRAME)));
            const b = angleAt(d, wrapHour(t + ((k + 1) * FRAME)));
            expect(Math.abs(b - a)).toBeLessThanOrEqual(most);
          }
        }
      }
    });

    it("sweep clear of the walker's body (a 0.25 m disc) while the leaf is moving", () => {
      let checked = 0;
      for (const w of walkers) {
        const d = doorOf(w.from.building, w.from.unit);
        const h = hingeOf(d, book.anchor);
        const speed = w.speed * HOUR_S;
        const t = w.t0 + (d.depth - d.set) / speed;
        for (let k = -90; k <= 90; k += 6) {
          const hour = wrapHour(t + k * FRAME);
          const s = alongAt(w, hour);
          if (s < 0) continue;
          const p = pathPoint(w, s);
          const wx = ground.anchor.x + p.x;
          const wz = ground.anchor.z + p.z;
          const ang = angleAt(d, hour);
          if (ang < 0.01 || w.partner >= 0) continue;
          // The walker in the hinge's frame (along the shut leaf, and into the room), and the leaf turned by `ang`: its points are (a cos, a sin) along that frame.
          const rx = wx - h.hx;
          const rz = wz - h.hz;
          const a = rx * h.ux + rz * h.uz;
          const b = rx * h.nx + rz * h.nz;
          // The distance from the walker to the leaf's line, which runs from the hinge to `width` along the turned direction.
          const lx = Math.cos(ang);
          const ly = Math.sin(ang);
          const along = Math.min(Math.max(a * lx + b * ly, 0), h.width);
          const dist = Math.hypot(a - along * lx, b - along * ly);
          expect(dist, `walker ${w.id} ${k}`).toBeGreaterThan(0.25);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("hide a walker inside the room with the door shut, and never one on the street", () => {
      let hid = 0;
      let seen = 0;
      for (const w of walkers) {
        const speed = w.speed * HOUR_S;
        const dFrom = doorOf(w.from.building, w.from.unit);
        const dTo = doorOf(w.to.building, w.to.unit);
        // At the very start they are inside with the door about to open: hidden; as they cross the plane they are drawn.
        expect(hiddenByDoor(book, w, 0, w.t0), `walker ${w.id} at the start`).toBe(angleAt(dFrom, wrapHour(w.t0)) < SHUT_BELOW);
        const cross = w.t0 + (dFrom.depth - dFrom.set) / speed;
        expect(hiddenByDoor(book, w, dFrom.depth - dFrom.set + 0.05, cross)).toBe(false);
        // Out on the street (past both depths) they are drawn whatever the doors do.
        if (w.length > dFrom.depth + dTo.depth + 2) expect(hiddenByDoor(book, w, w.length / 2, w.t0 + w.length / 2 / speed)).toBe(false);
        if (hiddenByDoor(book, w, 0, w.t0)) hid++;
        else seen++;
        // At the end, inside with the door shut: hidden.
        const endHour = w.t0 + w.length / speed;
        expect(hiddenByDoor(book, w, w.length, endHour)).toBe(angleAt(dTo, wrapHour(endHour)) < SHUT_BELOW);
      }
      expect(hid + seen).toBe(walkers.length);
    });

    it("are listed as moving only when open, the most open first, with the hinge in the world", () => {
      const w = walkers[0];
      if (w === undefined) return;
      const d = doorOf(w.from.building, w.from.unit);
      const t = w.t0 + (d.depth - d.set) / (w.speed * HOUR_S);
      const moving = movingDoors(book, wrapHour(t));
      const m = moving.find((x) => x.door === d);
      expect(m).toBeDefined();
      const hinge = hingeOf(d, book.anchor);
      expect(m?.hx).toBeCloseTo(hinge.hx, 9);
      // The hinge is half a leaf from the door's middle along the wall, and the leaf's shut direction is across the door toward the other jamb.
      expect(Math.hypot(hinge.hx - (ground.anchor.x + d.x), hinge.hz - (ground.anchor.z + d.z))).toBeGreaterThan(d.width / 2 - 0.01);
      expect(hinge.ux * (ground.anchor.x + d.x - hinge.hx) + hinge.uz * (ground.anchor.z + d.z - hinge.hz)).toBeGreaterThan(0);
      for (let i = 1; i < moving.length; i++) expect((moving[i - 1] as { angle: number }).angle).toBeGreaterThanOrEqual((moving[i] as { angle: number }).angle);
    });
  });
}
