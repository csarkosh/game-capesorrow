import { describe, expect, it } from "vitest";
import { boxesNear } from "@csarkosh/engine/sim/boxSource";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { waterLevelAt } from "@csarkosh/engine/sim/waters";
import { CAR_CIRCLES, CAR_RADIUS, carEnv, driveCar, wheelPoints, type CarWorld } from "../../src/sim/car/body.js";
import { AXLE_FRONT, AXLE_REAR, CLIMB_MAX, TRACK, WADE, WHEELBASE } from "../../src/sim/car/tuning.js";
import type { Car, CarControls } from "../../src/sim/car/types.js";
import { bearingU } from "../../src/sim/town/bearings.js";
import { deckTopAt } from "../../src/sim/town/decks.js";
import { constrainCircle, solidsNear } from "../../src/sim/town/solid.js";
import { WORLD_SEEDS, groundOf, planFor, siteFor, worldFor } from "../townWorld/world.js";

const seed = WORLD_SEEDS[0] as number;
const world: CarWorld = worldFor(seed);
const plan = planFor(seed);
const { anchor } = siteFor(seed);

const none: CarControls = { throttle: 0, turn: 0, handbrake: false };
const full: CarControls = { throttle: 1, turn: 0, handbrake: false };
const back: CarControls = { throttle: -1, turn: 0, handbrake: false };

/** A car at (x, z) heading (hx, hz), on the ground there. */
function carAt(x: number, z: number, hx: number, hz: number, speed = 0): Car {
  return {
    id: 1, x, y: groundOf(worldFor(seed)).heightAt(x, z), z, hx, hz, speed, slip: 0, steer: 0,
    controls: { ...none }, lights: false, seats: [0, 0, 0, 0],
  };
}

function drive(c: Car, controls: CarControls, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) driveCar(world, c, controls);
}

/** An oriented rectangle in the world: its centre, its along axis, and its half extents. */
type Rect = { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number };

/** Every solid building of the town and every prop box, as world rectangles. */
const buildings: Rect[] = plan.buildings.filter((b) => b.kind !== "pier").map((b) => {
  const u = bearingU(b.bearing);
  return { cx: anchor.x + b.centre.x, cz: anchor.z + b.centre.z, ux: u.x, uz: u.z, hu: b.halfAlong, hv: b.halfAcross };
});
const props: Rect[] = plan.props.solids.map((b) => ({ cx: anchor.x + b.cx, cz: anchor.z + b.cz, ux: b.ux, uz: b.uz, hu: b.hu, hv: b.hv }));
const everything: Rect[] = [...buildings, ...props];

/** The distance from (x, z) to a rectangle, 0 inside it. */
function distTo(r: Rect, x: number, z: number): number {
  const dx = x - r.cx;
  const dz = z - r.cz;
  const lu = dx * r.ux + dz * r.uz;
  const lv = dx * r.uz - dz * r.ux;
  const eu = Math.max(0, Math.abs(lu) - r.hu);
  const ev = Math.max(0, Math.abs(lv) - r.hv);
  return Math.sqrt(eu * eu + ev * ev);
}

/** How far the nearest of the car's circles stands from the rectangle's wall, beyond the circle's own radius (negative: inside it). */
function gapTo(r: Rect, c: Car): number {
  let gap = Infinity;
  for (const along of CAR_CIRCLES) gap = Math.min(gap, distTo(r, c.x + c.hx * along, c.z + c.hz * along) - CAR_RADIUS);
  return gap;
}

/** The deepest any rectangle near the car reaches into one of its circles. */
function deepest(c: Car): number {
  let worst = 0;
  for (const r of everything) {
    if (Math.abs(r.cx - c.x) > 40 + r.hu + r.hv || Math.abs(r.cz - c.z) > 40 + r.hu + r.hv) continue;
    worst = Math.max(worst, -gapTo(r, c));
  }
  return worst;
}

/** Whether every sample of the line from (x, z) along (dx, dz) for `length` metres is at least `clear` from every rectangle but `skip`. */
function lineClear(x: number, z: number, dx: number, dz: number, length: number, clear: number, skip: Rect | null): boolean {
  for (let s = 0; s <= length; s += 0.5) {
    const px = x + dx * s;
    const pz = z + dz * s;
    for (const r of everything) {
      if (r === skip || Math.abs(r.cx - px) > 30 || Math.abs(r.cz - pz) > 30) continue;
      if (distTo(r, px, pz) < clear) return false;
    }
  }
  return true;
}

/** A rectangle's four wall middles with their outward normals. */
function faces(r: Rect): { x: number; z: number; nx: number; nz: number; length: number }[] {
  const vx = r.uz;
  const vz = -r.ux;
  return [
    { x: r.cx + r.ux * r.hu, z: r.cz + r.uz * r.hu, nx: r.ux, nz: r.uz, length: 2 * r.hv },
    { x: r.cx - r.ux * r.hu, z: r.cz - r.uz * r.hu, nx: -r.ux, nz: -r.uz, length: 2 * r.hv },
    { x: r.cx + vx * r.hv, z: r.cz + vz * r.hv, nx: vx, nz: vz, length: 2 * r.hu },
    { x: r.cx - vx * r.hv, z: r.cz - vz * r.hv, nx: -vx, nz: -vz, length: 2 * r.hu },
  ];
}

/** The first rectangle among `targets` and face of it that a car driven straight at from 20 m reaches, clear of anything else on the way. */
function headOn(targets: readonly Rect[], wanted: (r: Rect) => boolean): { rect: Rect; car: Car } {
  for (const rect of targets) {
    if (!wanted(rect)) continue;
    for (const f of faces(rect)) {
      const x = f.x + f.nx * 20;
      const z = f.z + f.nz * 20;
      if (!lineClear(x, z, -f.nx, -f.nz, 20, 3, rect)) continue;
      const c = carAt(x, z, -f.nx, -f.nz);
      if (Math.abs(c.y - groundOf(worldFor(seed)).heightAt(f.x, f.z)) > 0.5) continue;
      drive(c, full, 6);
      if (gapTo(rect, c) < 0.05) return { rect, car: carAt(x, z, -f.nx, -f.nz) };
    }
  }
  throw new Error("no clear approach found");
}

describe("the car's wheels and the ground under them", () => {
  it("puts the four wheels at the axles and half the track either side, front left first", () => {
    const c = carAt(100, 200, 0, 1);
    const w = new Float64Array(8);
    wheelPoints(c, w);
    // Heading +z: the right is (hz, -hx) = +x.
    expect(Array.from(w)).toEqual([
      100 - TRACK / 2, 200 + AXLE_FRONT, 100 + TRACK / 2, 200 + AXLE_FRONT,
      100 - TRACK / 2, 200 + AXLE_REAR, 100 + TRACK / 2, 200 + AXLE_REAR,
    ]);
  });

  it("reads gravel under it on an alley and pavement on a street", () => {
    const alley = plan.streets.find((s) => s.kind === "alley");
    const street = plan.streets.find((s) => s.kind === "street");
    expect(alley).toBeDefined();
    expect(street).toBeDefined();
    for (const [st, top, grip] of [[alley!, 20, 5.4], [street!, 30, 8.3]] as const) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const c = carAt(anchor.x + (st.a.x + st.b.x) / 2, anchor.z + (st.a.z + st.b.z) / 2, (st.b.x - st.a.x) / len, (st.b.z - st.a.z) / len);
      const env = carEnv(world, c);
      expect(env.top).toBe(top);
      expect(env.grip).toBe(grip);
    }
  });

  it("reads the rise along its heading between its axles", () => {
    const g = groundOf(worldFor(seed));
    let found = 0;
    for (const st of plan.streets.filter((s) => s.kind === "street")) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const hx = (st.b.x - st.a.x) / len;
      const hz = (st.b.z - st.a.z) / len;
      const c = carAt(anchor.x + (st.a.x + st.b.x) / 2, anchor.z + (st.a.z + st.b.z) / 2, hx, hz);
      const rise = g.heightAt(c.x + hx * AXLE_FRONT, c.z + hz * AXLE_FRONT) - g.heightAt(c.x + hx * AXLE_REAR, c.z + hz * AXLE_REAR);
      const up = carEnv(world, c).slope;
      expect(up).toBeCloseTo(rise / (AXLE_FRONT - AXLE_REAR), 9);
      if (Math.abs(rise) > 0.05) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it("stands on the mean of the four wheels' ground", () => {
    const st = plan.streets.find((s) => s.kind === "street")!;
    const c = carAt(anchor.x + st.a.x, anchor.z + st.a.z, 1, 0);
    c.y = 123;
    driveCar(world, c, none);
    const w = new Float64Array(8);
    wheelPoints(c, w);
    const g = groundOf(worldFor(seed));
    let sum = 0;
    for (let i = 0; i < 8; i += 2) sum += g.heightAt(w[i] as number, w[i + 1] as number);
    expect(c.y).toBeCloseTo(sum / 4, 12);
  });
});

describe("the car among the town's solids", () => {
  it("stops at a building's wall and can reverse away", () => {
    const { rect, car: c } = headOn(buildings, (r) => r.hu > 4 && r.hv > 4);
    drive(c, full, 6);
    expect(deepest(c)).toBeLessThan(1e-6);
    expect(gapTo(rect, c)).toBeLessThan(0.05);
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
    drive(c, back, 2);
    expect(gapTo(rect, c)).toBeGreaterThan(2);
    expect(deepest(c)).toBeLessThan(1e-6);
  });

  it("slides along a wall it meets at a shallow angle, keeping most of its speed", () => {
    const angle = 8 * Math.PI / 180;
    const long = buildings.filter((r) => Math.max(r.hu, r.hv) > 20);
    expect(long.length).toBeGreaterThan(0);
    let tried = 0;
    for (const r of long) {
      // The long wall: along its own axis if that is the longer side.
      const alongU = r.hu >= r.hv;
      const wx = alongU ? r.ux : r.uz;
      const wz = alongU ? r.uz : -r.ux;
      const half = alongU ? r.hu : r.hv;
      const nx0 = alongU ? r.uz : r.ux;
      const nz0 = alongU ? -r.ux : r.uz;
      const depth = alongU ? r.hv : r.hu;
      for (const side of [-1, 1]) {
        const nx = nx0 * side;
        const nz = nz0 * side;
        // From the wall's near end, 2 m out, heading along it and turned a little into it.
        const sx = r.cx - wx * half + nx * (depth + 2) - wx * 6;
        const sz = r.cz - wz * half + nz * (depth + 2) - wz * 6;
        const hx = wx * Math.cos(angle) - nx * Math.sin(angle);
        const hz = wz * Math.cos(angle) - nz * Math.sin(angle);
        const c = carAt(sx, sz, hx, hz, 14);
        // A paved start and a clear line along the wall, so the wall is the only thing met.
        if (carEnv(world, c).top < 30) continue;
        if (!lineClear(sx, sz, wx, wz, 2 * half, 1.2 + 0, r)) continue;
        tried++;
        drive(c, full, 1.2);
        if (gapTo(r, c) < 0.05 && gapTo(r, c) > -1e-6) {
          expect(c.speed).toBeGreaterThan(8);
          expect(deepest(c)).toBeLessThan(1e-6);
          return;
        }
      }
    }
    throw new Error(`no long wall met at a shallow angle on pavement (${tried} tried)`);
  });

  it("is stopped by a parked car (a prop's box)", () => {
    const { rect, car: c } = headOn(props, (r) => r.hu > 1.8 && r.hv > 0.7 && r.hu < 4 && r.hv < 1.5);
    drive(c, full, 6);
    expect(deepest(c)).toBeLessThan(1e-6);
    expect(gapTo(rect, c)).toBeLessThan(0.05);
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
  });

  it("is stopped by a tree", () => {
    const g = groundOf(worldFor(seed));
    let stopped = 0;
    for (let wx = anchor.x - 900; wx < anchor.x + 900 && stopped === 0; wx += 60) {
      for (let wz = -900; wz < 900 && stopped === 0; wz += 60) {
        const near = boxesNear(world.boxes, { x: wx, y: -50, z: wz }, { x: wx + 60, y: 200, z: wz + 60 }).slice();
        for (const b of near) {
          if (b.max.x - b.min.x > 2 || b.max.z - b.min.z > 2 || b.max.y - b.min.y < 2.5) continue;
          const tx = (b.min.x + b.max.x) / 2;
          const tz = (b.min.z + b.max.z) / 2;
          // Approached along +x from 15 m west, over ground that holds no other box high enough to be a wall.
          const c = carAt(tx - 15, tz, 1, 0);
          if (Math.abs(c.y - g.heightAt(tx, tz)) > 0.5 || !lineClear(tx - 15, tz, 1, 0, 14, 3, null)) continue;
          let alone = true;
          for (let s = 0; s <= 14 && alone; s += 1) {
            for (const o of boxesNear(world.boxes, { x: tx - 15 + s - 2, y: -50, z: tz - 2 }, { x: tx - 15 + s + 2, y: 200, z: tz + 2 })) {
              if (o !== b && o.max.y > g.heightAt(tx - 15 + s, tz) + 0.35) alone = false;
            }
          }
          if (!alone) continue;
          drive(c, full, 6);
          const front = c.x + c.hx * 1.58;
          const reach = Math.hypot(front - tx, c.z - tz);
          if (reach < CAR_RADIUS + (b.max.x - b.min.x) / 2 + 0.1) {
            expect(Math.abs(c.speed)).toBeLessThan(0.5);
            expect(reach).toBeGreaterThan(CAR_RADIUS - 1e-3);
            stopped++;
            break;
          }
        }
      }
    }
    expect(stopped).toBe(1);
  });

  it("drives over a box lower than a curb and is not stopped by one it passes under", () => {
    // A box whose top stands 0.3 m over the ground is driven over; one that starts above the roof is no wall.
    const c = carAt(0, 0, 1, 0);
    const low = { min: { x: 3, y: -5, z: -1 }, max: { x: 4, y: 0.3, z: 1 } };
    const high = { min: { x: 8, y: 2.5, z: -1 }, max: { x: 9, y: 6, z: 1 } };
    const flat = {
      forest: { seed },
      boxes: [low, high],
      ground: { heightAt: () => 0, normalAt: (_x: number, _z: number, out: { x: number; y: number; z: number }) => { out.x = 0; out.y = 1; out.z = 0; } },
      waterLevel: null,
    };
    for (let i = 0; i < 60 * 3; i++) driveCar(flat, c, full);
    expect(c.x).toBeGreaterThan(12);
    // And a box 0.5 m high is a wall.
    const wall = { min: { x: 3, y: -5, z: -1 }, max: { x: 4, y: 0.5, z: 1 } };
    const d = carAt(0, 0, 1, 0);
    for (let i = 0; i < 60 * 3; i++) driveCar({ ...flat, boxes: [wall] }, d, full);
    expect(d.x + CAR_CIRCLES[2]! + CAR_RADIUS).toBeLessThan(3.01);
    expect(Math.abs(d.speed)).toBeLessThan(0.5);
  });

  it("reaches every cell a circle touches, not the one under its centre", () => {
    // A circle of 3 m centred 2 m off a wall, where the wall's building is not listed in the cell under the centre.
    let checked = 0;
    for (const b of plan.buildings.filter((q) => q.kind !== "pier")) {
      const rect = buildings[plan.buildings.filter((q) => q.kind !== "pier").indexOf(b)] as Rect;
      for (const f of faces(rect)) {
        const px = f.x + f.nx * 2;
        const pz = f.z + f.nz * 2;
        if (solidsNear(seed, px, pz).includes(b.id)) continue;
        if (everything.some((r) => r !== rect && distTo(r, px, pz) < 3.1)) continue;
        const pos = { x: px, y: 0, z: pz };
        const vel = { x: -f.nx, y: 0, z: -f.nz };
        expect(constrainCircle(seed, pos, vel, 3)).toBe(true);
        expect(distTo(rect, pos.x, pos.z)).toBeGreaterThanOrEqual(3);
        expect(vel.x * f.nx + vel.z * f.nz).toBeGreaterThan(-1e-9);
        checked++;
      }
      if (checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("the car on the ground, the rails and the water", () => {
  it("climbs a curb: from the roadway on to the sidewalk, y rises by the curb and it goes on", () => {
    const g = groundOf(worldFor(seed));
    for (const st of plan.streets.filter((s) => s.kind === "street" || s.kind === "avenue")) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const dx = (st.b.x - st.a.x) / len;
      const dz = (st.b.z - st.a.z) / len;
      for (const side of [-1, 1]) {
        const nx = -dz * side;
        const nz = dx * side;
        for (let s = 0.2; s < 0.8; s += 0.1) {
          const mx = anchor.x + st.a.x + (st.b.x - st.a.x) * s;
          const mz = anchor.z + st.a.z + (st.b.z - st.a.z) * s;
          // The curb: the first place out from the centre line where the ground climbs 0.1 m or more in half a metre.
          let at = -1;
          for (let d = 0.5; d < st.roadway / 2 + 2; d += 0.05) {
            if (g.heightAt(mx + nx * (d + 0.5), mz + nz * (d + 0.5)) - g.heightAt(mx + nx * d, mz + nz * d) >= 0.1) { at = d; break; }
          }
          if (at < 0 || !lineClear(mx + nx * (at - 4), mz + nz * (at - 4), nx, nz, 9, 3, null)) continue;
          const c = carAt(mx + nx * (at - 3.5), mz + nz * (at - 3.5), nx, nz, 5);
          const before = c.y;
          drive(c, full, 1);
          const out = (c.x - mx) * nx + (c.z - mz) * nz;
          if (out < at + 1.5) continue;
          expect(c.y - before).toBeGreaterThan(0.08);
          expect(c.y - before).toBeLessThan(0.3);
          expect(c.speed).toBeGreaterThan(2);
          return;
        }
      }
    }
    throw new Error("no curb crossed");
  });

  /** The first street whose end runs on to water, driven at full throttle from 12 m before its end; null when `wanted` is not met by where the car ends. */
  function toTheWater(wanted: (c: Car) => boolean): { c: Car; start: { x: number; z: number }; wettest: number } | null {
    const g = groundOf(worldFor(seed));
    const w = new Float64Array(8);
    for (const st of plan.streets.filter((s) => s.kind !== "highway" && s.kind !== "stair" && s.kind !== "rail")) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      for (const ends of [[st.a, st.b], [st.b, st.a]] as const) {
        const dx = (ends[0].x - ends[1].x) / len;
        const dz = (ends[0].z - ends[1].z) / len;
        const sx = anchor.x + ends[0].x - dx * 12;
        const sz = anchor.z + ends[0].z - dz * 12;
        // Water lies ahead on the line, within 120 m, and nothing stands in the way.
        let water = -1;
        for (let s = 0; s < 120 && water < 0; s++) {
          const level = waterLevelAt(world as never, sx + dx * s, sz + dz * s);
          if (level !== null && g.heightAt(sx + dx * s, sz + dz * s) < level - WADE - 0.5) water = s;
        }
        if (water < 20 || !lineClear(sx, sz, dx, dz, water, 3, null)) continue;
        const c = carAt(sx, sz, dx, dz);
        let wettest = -Infinity;
        for (let i = 0; i < 60 * 14; i++) {
          driveCar(world, c, full);
          wheelPoints(c, w);
          for (let k = 0; k < 8; k += 2) {
            const level = waterLevelAt(world as never, w[k] as number, w[k + 1] as number) ?? -Infinity;
            wettest = Math.max(wettest, level - g.heightAt(w[k] as number, w[k + 1] as number));
          }
        }
        if (wanted(c)) return { c, start: { x: sx, z: sz }, wettest };
      }
    }
    return null;
  }

  it("cannot be driven into the sea: down a street's bank to the water it stops with every wheel in under 0.3 m", () => {
    // A street that runs down to the shore with no deck or rail between: the water rule alone holds the car.
    const run = toTheWater((c) => deckTopAt(seed, c.x, c.z) === null);
    expect(run).not.toBeNull();
    const { c, start, wettest } = run!;
    expect(Math.hypot(c.x - start.x, c.z - start.z)).toBeGreaterThan(10);
    expect(wettest).toBeLessThanOrEqual(WADE);
    expect(c.speed).toBe(0);
    // And reversing frees it.
    const stopped = { x: c.x, z: c.z };
    drive(c, back, 2);
    expect(Math.hypot(c.x - stopped.x, c.z - stopped.z)).toBeGreaterThanOrEqual(2);
  });

  it("cannot be driven off the quay's street into the sea, and can reverse away from the edge", () => {
    const run = toTheWater((c) => deckTopAt(seed, c.x, c.z) !== null);
    expect(run).not.toBeNull();
    const { c, start, wettest } = run!;
    expect(wettest).toBeLessThanOrEqual(WADE);
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
    const edge = { x: c.x, z: c.z };
    drive(c, back, 3);
    expect(Math.hypot(c.x - edge.x, c.z - edge.z)).toBeGreaterThan(3);
    expect(Math.hypot(c.x - start.x, c.z - start.z)).toBeLessThan(Math.hypot(edge.x - start.x, edge.z - start.z));
  });

  /** The slope between the axles along the heading, and the wettest wheel, at the car's place. */
  function slopeAt(c: Car): number {
    const g = groundOf(worldFor(seed));
    return (g.heightAt(c.x + c.hx * AXLE_FRONT, c.z + c.hz * AXLE_FRONT) - g.heightAt(c.x + c.hx * AXLE_REAR, c.z + c.hz * AXLE_REAR)) / WHEELBASE;
  }
  function wettestWheel(c: Car): number {
    const g = groundOf(worldFor(seed));
    const w = new Float64Array(8);
    wheelPoints(c, w);
    let wettest = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      const level = waterLevelAt(world as never, w[k] as number, w[k + 1] as number) ?? -Infinity;
      wettest = Math.max(wettest, level - g.heightAt(w[k] as number, w[k + 1] as number));
    }
    return wettest;
  }
  /** Street 126's bank (or the first street end that runs down one): the start 12 m before the end, and the way down. */
  function bank(): { sx: number; sz: number; dx: number; dz: number } {
    for (const st of plan.streets.filter((s) => s.kind !== "highway" && s.kind !== "stair" && s.kind !== "rail")) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      for (const ends of [[st.a, st.b], [st.b, st.a]] as const) {
        const dx = (ends[0].x - ends[1].x) / len;
        const dz = (ends[0].z - ends[1].z) / len;
        const sx = anchor.x + ends[0].x - dx * 12;
        const sz = anchor.z + ends[0].z - dz * 12;
        const c = carAt(sx, sz, dx, dz);
        drive(c, full, 14);
        if (deckTopAt(seed, c.x, c.z) === null && wettestWheel(c) > 0 && Math.hypot(c.x - sx, c.z - sz) > 10 && lineClear(sx, sz, dx, dz, Math.hypot(c.x - sx, c.z - sz), 3, null)) return { sx, sz, dx, dz };
      }
    }
    throw new Error("no bank found");
  }
  it("stops at the brink of a bank, never on ground past the climb limit, and reversing frees it", () => {
    const { sx, sz, dx, dz } = bank();
    const c = carAt(sx, sz, dx, dz);
    let worst = 0;
    for (let i = 0; i < 60 * 10; i++) {
      driveCar(world, c, full);
      worst = Math.max(worst, Math.abs(slopeAt(c)));
      expect(wettestWheel(c)).toBeLessThanOrEqual(WADE);
    }
    expect(worst).toBeLessThanOrEqual(CLIMB_MAX + 1e-9);
    expect(c.speed).toBe(0);
    expect(Math.hypot(c.x - sx, c.z - sz)).toBeGreaterThan(10);
    const stopped = { x: c.x, z: c.z };
    drive(c, back, 2);
    expect(Math.hypot(c.x - stopped.x, c.z - stopped.z)).toBeGreaterThanOrEqual(2);
    expect(wettestWheel(c)).toBeLessThanOrEqual(WADE);
  });

  it("backed toward the brink of a bank it stops, and forward throttle frees it", () => {
    const { sx, sz, dx, dz } = bank();
    // Facing away from the water, from the same start, reversing toward it.
    const c = carAt(sx, sz, -dx, -dz);
    let worst = 0;
    for (let i = 0; i < 60 * 12; i++) {
      driveCar(world, c, back);
      worst = Math.max(worst, Math.abs(slopeAt(c)));
      expect(wettestWheel(c)).toBeLessThanOrEqual(WADE);
    }
    expect(worst).toBeLessThanOrEqual(CLIMB_MAX + 1e-9);
    expect(Math.hypot(c.x - sx, c.z - sz)).toBeGreaterThan(8);
    expect(c.speed).toBe(0);
    const stopped = { x: c.x, z: c.z };
    drive(c, full, 2);
    expect(Math.hypot(c.x - stopped.x, c.z - stopped.z)).toBeGreaterThanOrEqual(2);
  });

  it("backs up out of ground nose-down at a slope between 0.35 and 0.45", () => {
    const g = groundOf(worldFor(seed));
    let tried = 0;
    for (let ix = -400; ix < 600; ix += 4) {
      for (let iz = -300; iz < 600; iz += 4) {
        const x = anchor.x + ix;
        const z = iz;
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = carAt(x, z, hx, hz);
          const slope = slopeAt(c);
          if (slope > -0.35 || slope < -0.44 || wettestWheel(c) > 0 || deckTopAt(seed, x, z) !== null) continue;
          if (!lineClear(x, z, -hx, -hz, 6, 3, null) || !lineClear(x, z, hx, hz, 1, 3, null)) continue;
          if (Math.abs(g.heightAt(x, z) - g.heightAt(x - hx * 6, z - hz * 6)) < 1) continue;
          // The way back up stays within the limit for the first 3 m (a steeper place behind is a wall, which the bank tests cover).
          let open = true;
          for (let s = 0.25; s <= 3; s += 0.25) if (Math.abs(slopeAt(carAt(x - hx * s, z - hz * s, hx, hz))) > CLIMB_MAX - 0.01) open = false;
          if (!open) continue;
          tried++;
          drive(c, back, 2);
          expect(c.speed, `at ${ix},${iz}`).toBeLessThan(0);
          expect((c.x - x) * -hx + (c.z - z) * -hz, `at ${ix},${iz}`).toBeGreaterThan(1);
          if (tried === 3) return;
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it("is held on a pier by its rails", () => {
    const piers = plan.decks.filter((d) => d.kind === "pier" && Math.min(d.halfAlong, d.halfAcross) >= 3 && Math.max(d.halfAlong, d.halfAcross) >= 15);
    expect(piers.length).toBeGreaterThan(0);
    let held = 0;
    for (const d of piers) {
      // The long way along the pier (lx, lz) and the short way across it (sx, sz).
      const lengthwise = d.halfAlong >= d.halfAcross;
      const lx = lengthwise ? d.axis.x : -d.axis.z;
      const lz = lengthwise ? d.axis.z : d.axis.x;
      const sx = -lz;
      const sz = lx;
      const half = lengthwise ? d.halfAcross : d.halfAlong;
      const cx = anchor.x + d.centre.x;
      const cz = anchor.z + d.centre.z;
      // From the middle of the pier, heading 45 degrees from its length toward one edge, and toward the other, along each way (the rails
      // stop short of the end where the pier joins the quay, which a car in the middle does not reach in two seconds).
      for (const [along, across] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = cx;
        const z = cz;
        const r = Math.SQRT1_2;
        const c = carAt(x, z, lx * along * r + sx * across * r, lz * along * r + sz * across * r, 8);
        let off = 0;
        for (let i = 0; i < 60 * 2; i++) {
          driveCar(world, c, full);
          if (deckTopAt(seed, c.x, c.z) === null) throw new Error(`pier ${d.id} (${along}, ${across}): the car left the deck at tick ${i}`);
          // The front circle, the first to meet the rail.
          off = Math.max(off, Math.abs((c.x + c.hx * 1.58 - cx) * sx + (c.z + c.hz * 1.58 - cz) * sz));
        }
        // The front circle was kept inside the rail, a hull's radius from its line; where nothing else stood in the way it reached it.
        expect(off).toBeLessThan(half);
        if (off > half - 0.5) held++;
      }
    }
    // Most of the runs met the rail; the others met a pier's own props first.
    expect(held).toBeGreaterThanOrEqual(piers.length * 4 / 2);
  });

  it("is the same to the bit for the same inputs, and no other car's tick changes it", () => {
    const run = (withOther: boolean): Car => {
      const st = plan.streets.find((s) => s.kind === "street")!;
      const c = carAt(anchor.x + st.a.x + 5, anchor.z + st.a.z + 5, 1, 0, 3);
      const other = carAt(anchor.x - 100, 30, 0, 1, 10);
      for (let i = 0; i < 60 * 20; i++) {
        driveCar(world, c, { throttle: 1, turn: Math.sin(i / 40), handbrake: i % 300 > 280 });
        if (withOther) driveCar(world, other, i % 90 < 45 ? full : back);
      }
      return c;
    };
    const a = run(false);
    const b = run(false);
    const d = run(true);
    expect(b).toEqual(a);
    expect(d).toEqual(a);
    expect(a.speed).not.toBe(3);
  });

  it("drives the open highway as the step alone would, with nothing to push it", () => {
    const z = anchor.z + 5000;
    const c = carAt(roadCenterX(seed, z), z, 0, 1);
    drive(c, full, 3);
    expect(c.speed).toBeGreaterThan(15);
    expect(c.z).toBeGreaterThan(z + 20);
    expect(c.x).toBeCloseTo(roadCenterX(seed, z), 3);
  });
});
