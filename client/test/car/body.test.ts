import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import { boxesNear } from "@csarkosh/engine/sim/boxSource";
import type { Aabb } from "@csarkosh/engine/sim/level";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { waterLevelAt } from "@csarkosh/engine/sim/waters";
import { speedLimitAt } from "../../src/sim/car/limit.js";
import { surfaceAt } from "../../src/sim/car/surface.js";
import { CAR_CIRCLES, CAR_RADIUS, carEnv, driveCar, wheelPoints, type CarWorld } from "../../src/sim/car/body.js";
import { touches } from "../../src/sim/car/knock.js";
import { KNOCK_LOSS, knockablesFor, type KnockKind, type Knockable } from "../../src/sim/town/knockables.js";
import { AXLE_FRONT, AXLE_REAR, CLIMB_MAX, FULL_SPEED, GRIP, OVERSPEED_DRAG, TOWN_SPEED, TOP_SPEED, TRACK, WADE, WHEELBASE } from "../../src/sim/car/tuning.js";
import { GRAVEL, PAVED, type Car, type CarControls } from "../../src/sim/car/types.js";
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
    controls: { ...none }, lights: false, owed: 0, seats: [0, 0, 0, 0],
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

/**
 * Whether the line from (x, z) along (dx, dz) for `length` metres is plain: its ground within half a metre of the start's, dry, and no
 * forest box but `skip` standing a wall's height over it within 1.5 m. Things true before any car moves.
 */
function plainLine(x: number, z: number, dx: number, dz: number, length: number, skip: Aabb | null): boolean {
  const g = groundOf(worldFor(seed));
  const h0 = g.heightAt(x, z);
  for (let s = 0; s <= length; s += 0.5) {
    const px = x + dx * s;
    const pz = z + dz * s;
    const h = g.heightAt(px, pz);
    if (Math.abs(h - h0) > 0.5) return false;
    const level = waterLevelAt(world as never, px, pz);
    if (level !== null && h < level - WADE) return false;
    for (const o of boxesNear(world.boxes, { x: px - 1.5, y: -50, z: pz - 1.5 }, { x: px + 1.5, y: 200, z: pz + 1.5 })) {
      if (o !== skip && o.max.y > h + 0.35) return false;
    }
  }
  return true;
}

/**
 * The first rectangle among `targets` and face of it that a car can be driven straight at from 20 m: chosen by what is true before the
 * car moves (a clear, plain line to the wall), never by what the drive does, so a car that goes through the wall fails the test.
 */
function headOn(targets: readonly Rect[], wanted: (r: Rect) => boolean): { rect: Rect; car: Car } {
  for (const rect of targets) {
    if (!wanted(rect)) continue;
    for (const f of faces(rect)) {
      const x = f.x + f.nx * 20;
      const z = f.z + f.nz * 20;
      if (!lineClear(x, z, -f.nx, -f.nz, 20, 3, rect)) continue;
      if (!plainLine(x, z, -f.nx, -f.nz, 20, null)) continue;
      return { rect, car: carAt(x, z, -f.nx, -f.nz) };
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
  }, timeLimit(300_000));

  it("reads gravel under it on an alley and pavement on a street", () => {
    const alley = plan.streets.find((s) => s.kind === "alley");
    const street = plan.streets.find((s) => s.kind === "street");
    expect(alley).toBeDefined();
    expect(street).toBeDefined();
    for (const [st, surface] of [[alley!, GRAVEL], [street!, PAVED]] as const) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const c = carAt(anchor.x + (st.a.x + st.b.x) / 2, anchor.z + (st.a.z + st.b.z) / 2, (st.b.x - st.a.x) / len, (st.b.z - st.a.z) / len);
      const env = carEnv(world, c);
      expect(env.top).toBe(Math.min(TOP_SPEED[surface]!, speedLimitAt(seed, c.x, c.z)));
      expect(env.grip).toBe(GRIP[surface]);
    }
  }, timeLimit(300_000));

  it("holds the top speed to TOWN_SPEED in the town, on pavement and on gravel", () => {
    for (const kind of ["street", "alley"] as const) {
      const st = plan.streets.find((s) => s.kind === kind) as NonNullable<(typeof plan.streets)[number]>;
      const c = carAt(anchor.x + (st.a.x + st.b.x) / 2, anchor.z + (st.a.z + st.b.z) / 2, 0, 1);
      expect(speedLimitAt(seed, c.x, c.z)).toBe(TOWN_SPEED);
      expect(carEnv(world, c).top).toBe(TOWN_SPEED);
    }
  }, timeLimit(300_000));

  it("lets pavement reach FULL_SPEED beyond the town's fade", () => {
    const z = anchor.z + 5000;
    const c = carAt(roadCenterX(seed, z), z, 0, 1);
    expect(surfaceAt(seed, c.x, c.z)).toBe(PAVED);
    expect(carEnv(world, c).top).toBe(FULL_SPEED);
    // Open ground off the road is still held to its own speed.
    const off = carAt(roadCenterX(seed, z) + 60, z, 0, 1);
    expect(carEnv(world, off).top).toBe(Math.min(TOP_SPEED[surfaceAt(seed, off.x, off.z)]!, FULL_SPEED));
    expect(carEnv(world, off).top).toBeLessThan(FULL_SPEED);
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));
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
  }, timeLimit(300_000));

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
        if (carEnv(world, c).grip < GRIP[PAVED]!) continue;
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
  }, timeLimit(300_000));

  it("is stopped by a parked car (a prop's box)", () => {
    const { rect, car: c } = headOn(props, (r) => r.hu > 1.8 && r.hv > 0.7 && r.hu < 4 && r.hv < 1.5);
    drive(c, full, 6);
    expect(deepest(c)).toBeLessThan(1e-6);
    expect(gapTo(rect, c)).toBeLessThan(0.05);
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
  }, timeLimit(300_000));

  it("is stopped by a tree", () => {
    // The first tree found (a box under 2 m wide and 2.5 m or more high) with a clear, plain 15 m line to it from the west: chosen before any car moves.
    let tree: Aabb | null = null;
    for (let wx = anchor.x - 900; wx < anchor.x + 900 && tree === null; wx += 60) {
      for (let wz = -900; wz < 900 && tree === null; wz += 60) {
        for (const b of boxesNear(world.boxes, { x: wx, y: -50, z: wz }, { x: wx + 60, y: 200, z: wz + 60 }).slice()) {
          if (b.max.x - b.min.x > 2 || b.max.z - b.min.z > 2 || b.max.y - b.min.y < 2.5) continue;
          const tx = (b.min.x + b.max.x) / 2;
          const tz = (b.min.z + b.max.z) / 2;
          if (lineClear(tx - 15, tz, 1, 0, 14, 3, null) && plainLine(tx - 15, tz, 1, 0, 14, b)) { tree = b; break; }
        }
      }
    }
    expect(tree).not.toBeNull();
    const b = tree as Aabb;
    const tx = (b.min.x + b.max.x) / 2;
    const tz = (b.min.z + b.max.z) / 2;
    const c = carAt(tx - 15, tz, 1, 0);
    drive(c, full, 6);
    const reach = Math.hypot(c.x + c.hx * 1.58 - tx, c.z - tz);
    expect(Math.abs(c.speed)).toBeLessThan(0.5);
    expect(reach).toBeGreaterThan(CAR_RADIUS - 1e-3);
    expect(reach).toBeLessThan(CAR_RADIUS + (b.max.x - b.min.x) / 2 + 0.1);
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));
});

describe("the car on the ground, the rails and the water", () => {
  it("climbs a curb: from the roadway on to the sidewalk, y rises by the curb and it goes on", () => {
    const g = groundOf(worldFor(seed));
    // The first curb found with a clear, plain line across it, chosen before any car moves.
    let place: { mx: number; mz: number; nx: number; nz: number; at: number } | null = null;
    for (const st of plan.streets.filter((s) => s.kind === "street" || s.kind === "avenue")) {
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const dx = (st.b.x - st.a.x) / len;
      const dz = (st.b.z - st.a.z) / len;
      for (const side of [-1, 1]) {
        const nx = -dz * side;
        const nz = dx * side;
        for (let s = 0.2; s < 0.8 && place === null; s += 0.1) {
          const mx = anchor.x + st.a.x + (st.b.x - st.a.x) * s;
          const mz = anchor.z + st.a.z + (st.b.z - st.a.z) * s;
          // The curb: the first place out from the centre line where the ground climbs 0.1 m or more in half a metre.
          let at = -1;
          for (let d = 0.5; d < st.roadway / 2 + 2; d += 0.05) {
            if (g.heightAt(mx + nx * (d + 0.5), mz + nz * (d + 0.5)) - g.heightAt(mx + nx * d, mz + nz * d) >= 0.1) { at = d; break; }
          }
          if (at < 0) continue;
          const x0 = mx + nx * (at - 4);
          const z0 = mz + nz * (at - 4);
          if (lineClear(x0, z0, nx, nz, 9, 3, null) && plainLine(x0, z0, nx, nz, 9, null)) place = { mx, mz, nx, nz, at };
        }
        if (place !== null) break;
      }
      if (place !== null) break;
    }
    expect(place).not.toBeNull();
    const { mx, mz, nx, nz, at } = place!;
    const c = carAt(mx + nx * (at - 3.5), mz + nz * (at - 3.5), nx, nz, 5);
    const before = c.y;
    drive(c, full, 1);
    expect((c.x - mx) * nx + (c.z - mz) * nz).toBeGreaterThan(at + 1.5);
    expect(c.y - before).toBeGreaterThan(0.08);
    expect(c.y - before).toBeLessThan(0.3);
    expect(c.speed).toBeGreaterThan(2);
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

  it("at full lock along the top of a bank, never on ground past the limit, and at rest in a pose it can reverse from", () => {
    const { sx, sz, dx, dz } = bank();
    const down = carAt(sx, sz, dx, dz);
    drive(down, full, 10);
    // Back from the brink 3 m, then along the brink (across the way down), steering toward the drop.
    const bx = down.x - dx * 3;
    const bz = down.z - dz * 3;
    for (const side of [1, -1]) {
      // side 1: heading (-dz, dx), whose right is (dx, dz), the drop; side -1: heading (dz, -dx), whose left is the drop.
      const c = carAt(bx, bz, -dz * side, dx * side, 8);
      expect(Math.abs(slopeAt(c))).toBeLessThanOrEqual(CLIMB_MAX);
      for (let i = 0; i < 60 * 8; i++) {
        driveCar(world, c, { throttle: 1, turn: side, handbrake: false });
        expect(Math.abs(slopeAt(c)), `side ${side} tick ${i}`).toBeLessThanOrEqual(CLIMB_MAX + 1e-9);
        expect(wettestWheel(c)).toBeLessThanOrEqual(WADE);
      }
      // At rest where it ended, and reverse frees it.
      c.speed = 0;
      c.slip = 0;
      c.steer = 0;
      const rest = { x: c.x, z: c.z };
      drive(c, back, 2);
      expect(Math.hypot(c.x - rest.x, c.z - rest.z), `side ${side}`).toBeGreaterThanOrEqual(2);
    }
  }, timeLimit(300_000));

  it("across a steep side slope, steering downhill at full lock never takes it on to ground past the limit along its heading", () => {
    let runs = 0;
    for (let ix = -400; ix < 600 && runs < 3; ix += 3) {
      for (let iz = -300; iz < 600 && runs < 3; iz += 3) {
        const x = anchor.x + ix;
        const z = iz;
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = carAt(x, z, hx, hz, 5);
          // Along the heading within the limit and across it over the limit; the right of the heading is (hz, -hx).
          const across = slopeAt(carAt(x, z, hz, -hx));
          if (Math.abs(slopeAt(c)) > 0.3 || Math.abs(across) < 0.5 || wettestWheel(c) > -2 || deckTopAt(seed, x, z) !== null) continue;
          if (!lineClear(x, z, hx, hz, 12, 3, null) || !lineClear(x, z, hz, -hx, 6, 3, null) || !lineClear(x, z, -hz, hx, 6, 3, null)) continue;
          runs++;
          // Downhill is to the right when the ground falls along (hz, -hx), that is when `across` is negative.
          const turn = across < 0 ? 1 : -1;
          for (let i = 0; i < 60 * 6; i++) {
            driveCar(world, c, { throttle: 1, turn, handbrake: false });
            expect(Math.abs(slopeAt(c)), `at ${ix},${iz} tick ${i}`).toBeLessThanOrEqual(CLIMB_MAX + 1e-9);
          }
          break;
        }
      }
    }
    expect(runs).toBeGreaterThan(0);
  }, timeLimit(300_000));

  it("with one wheel 0.4 m under the water, can be driven out toward the shore", () => {
    let runs = 0;
    for (let ix = -500; ix < 300 && runs < 2; ix += 2) {
      for (let iz = -300; iz < 600 && runs < 2; iz += 2) {
        const x = anchor.x + ix;
        const z = iz;
        for (const [hx, hz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = carAt(x, z, hx, hz);
          const depth = wettestWheel(c);
          if (depth < 0.35 || depth > 0.5 || Math.abs(slopeAt(c)) > 0.3 || deckTopAt(seed, x, z) !== null) continue;
          // Which way leads up: the way the deepest wheel gets shallower over the next 2 m.
          const ahead = wettestWheel(carAt(x + hx * 2, z + hz * 2, hx, hz));
          const behind = wettestWheel(carAt(x - hx * 2, z - hz * 2, hx, hz));
          if (Math.min(ahead, behind) > depth - 0.2) continue;
          const controls = ahead < behind ? full : back;
          runs++;
          drive(c, controls, 3);
          expect(Math.hypot(c.x - x, c.z - z), `at ${ix},${iz}`).toBeGreaterThan(1);
          expect(wettestWheel(c), `at ${ix},${iz}`).toBeLessThan(depth - 0.2);
          break;
        }
      }
    }
    expect(runs).toBeGreaterThan(0);
  }, timeLimit(300_000));

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
        const wheels = new Float64Array(8);
        for (let i = 0; i < 60 * 2; i++) {
          driveCar(world, c, full);
          if (deckTopAt(seed, c.x, c.z) === null) throw new Error(`pier ${d.id} (${along}, ${across}): the car left the deck at tick ${i}`);
          // Every circle is kept inside the rail by its own radius, and every wheel stands on the deck.
          for (const a of CAR_CIRCLES) {
            const across2 = Math.abs((c.x + c.hx * a - cx) * sx + (c.z + c.hz * a - cz) * sz);
            off = Math.max(off, across2);
            expect(across2, `pier ${d.id} (${along}, ${across}) circle ${a} tick ${i}`).toBeLessThanOrEqual(half - CAR_RADIUS + 1e-3);
          }
          wheelPoints(c, wheels);
          for (let k = 0; k < 8; k += 2) expect(deckTopAt(seed, wheels[k] as number, wheels[k + 1] as number), `pier ${d.id} wheel ${k / 2} tick ${i}`).not.toBeNull();
        }
        // Where nothing else stood in the way the car reached the rail: its circle a radius from the line.
        if (off > half - CAR_RADIUS - 0.5) held++;
      }
    }
    // Most of the runs met the rail; the others met a pier's own props first.
    expect(held).toBeGreaterThanOrEqual(piers.length * 4 / 2);
  }, timeLimit(300_000));

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
  }, timeLimit(300_000));

  it("drives the open highway as the step alone would, with nothing to push it", () => {
    const z = anchor.z + 5000;
    const c = carAt(roadCenterX(seed, z), z, 0, 1);
    drive(c, full, 3);
    // Bounds that three seconds from rest meet at every cap from 10 m/s up (the speed gathered rises with the cap).
    expect(c.speed).toBeGreaterThan(8);
    expect(c.z).toBeGreaterThan(z + 15);
    expect(c.x).toBeCloseTo(roadCenterX(seed, z), 3);
  }, timeLimit(300_000));

  /** The steering that keeps a car heading south on the highway: toward the road's centre 20 m ahead (the highway bends, so no straight line stays on it). */
  function followHighway(c: Car): number {
    const dx = roadCenterX(seed, c.z - 20) - c.x;
    const dz = -20;
    const len = Math.sqrt(dx * dx + dz * dz);
    // The car's right is (hz, -hx).
    const side = (dx * c.hz - dz * c.hx) / len;
    return Math.max(-1, Math.min(1, side * 3));
  }

  it("a car entering the town at full speed is slowed, never stopped", () => {
    // The town's last block to the north, then the highway 400 m beyond it, driven at full throttle toward the town.
    let last = -Infinity;
    for (const b of plan.blocks) if (b.district !== "outskirts") for (const p of b.polygon) last = Math.max(last, p.z);
    const z0 = last + 400;
    const c = carAt(roadCenterX(seed, z0), z0, 0, -1, FULL_SPEED);
    expect(speedLimitAt(seed, c.x, c.z)).toBe(FULL_SPEED);
    const speeds = [c.speed];
    let inside = -1;
    for (let i = 0; i < 3200 && (inside < 0 || i < inside + 120); i++) {
      driveCar(world, c, { throttle: 1, turn: followHighway(c), handbrake: false });
      speeds.push(c.speed);
      if (inside < 0 && speedLimitAt(seed, c.x, c.z) === TOWN_SPEED) inside = i;
    }
    // Taken a second apart it only falls while it is between the two speeds (on either plateau the hill moves it by a few hundredths either way).
    for (let i = 60; i < speeds.length; i += 60) {
      if ((speeds[i - 60] as number) > TOWN_SPEED + 0.2 && (speeds[i - 60] as number) < FULL_SPEED - 0.1) expect(speeds[i] as number).toBeLessThan(speeds[i - 60] as number);
    }
    // It did come into a block, and ran on in it.
    expect(inside).toBeGreaterThan(0);
    expect(speeds.length).toBeGreaterThan(inside + 120);
    for (let i = 1; i < speeds.length; i++) {
      const was = speeds[i - 1] as number;
      const now = speeds[i] as number;
      // Never faster than a tick before, never slower than the drag over the top speed takes in a tick, and never below the town's speed.
      // The hill under it lets it gain or lose a few hundredths of a m/s now and then: it never gains more than that.
      expect(now).toBeLessThanOrEqual(was + 0.01);
      expect(was - now).toBeLessThanOrEqual(OVERSPEED_DRAG * TICK_DT + 1e-9);
      expect(now).toBeGreaterThanOrEqual(TOWN_SPEED - 0.2);
    }
    // Held to the town's speed once inside a block.
    expect(Math.abs((speeds[speeds.length - 1] as number) - TOWN_SPEED)).toBeLessThanOrEqual(0.2);
    expect(speeds[0]).toBe(FULL_SPEED);
  }, timeLimit(300_000));
});

describe("the car and what gives way, in the town", () => {
  const knockables = knockablesFor(seed).list;
  const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8], [-0.6, 0.8], [0.6, -0.8], [-0.6, -0.8]];

  /** Whether the car's three circles stand in nothing solid to a car at (x, z) heading (hx, hz). */
  function free(x: number, z: number, hx: number, hz: number): boolean {
    for (const along of CAR_CIRCLES) {
      const pos = { x: x + hx * along, y: 0, z: z + hz * along };
      if (constrainCircle(seed, pos, { x: 0, y: 0, z: 0 }, CAR_RADIUS, true)) return false;
    }
    return true;
  }

  /** A knockable of `kind` with a straight run through it that nothing solid stands in, and the heading of the run. */
  function approach(kind: KnockKind): { k: Knockable; hx: number; hz: number } {
    for (const k of knockables) {
      if (k.kind !== kind) continue;
      for (const [hx, hz] of DIRS) {
        let clear = true;
        for (let d = -7; d <= 7 && clear; d += 0.5) clear = free(k.x + hx * d, k.z + hz * d, hx, hz);
        // And over no other knockable on the way, so the one hit is this one's.
        if (clear && !knockables.some((o) => o.id !== k.id && Math.hypot(o.x - k.x, o.z - k.z) < 9)) return { k, hx, hz };
      }
    }
    throw new Error(`no ${kind} with a free run through it`);
  }

  for (const kind of ["stop", "cart"] as const) {
    it(`drives through a ${kind}: it is not stopped or turned aside, and it is slowed once, by the ${kind}'s share`, () => {
      const { k, hx, hz } = approach(kind);
      const c = carAt(k.x - hx * 6, k.z - hz * 6, hx, hz, 6);
      const [share, flat] = KNOCK_LOSS[kind];
      let worst = 0;
      let before = 0;
      let hitTicks = 0;
      for (let i = 0; i < 150; i++) {
        const was = Math.hypot(c.speed, c.slip);
        const touched = touches(k, c.x, c.z, c.hx, c.hz);
        driveCar(world, c, full);
        const lost = was - Math.hypot(c.speed, c.slip);
        if (!touched && touches(k, c.x, c.z, c.hx, c.hz)) {
          hitTicks++;
          before = was;
        }
        worst = Math.max(worst, lost);
      }
      // Past it, on the line it came in on.
      const along = (c.x - k.x) * hx + (c.z - k.z) * hz;
      const across = (c.x - k.x) * hz - (c.z - k.z) * hx;
      expect(along).toBeGreaterThan(3);
      expect(Math.abs(across)).toBeLessThan(0.5);
      expect(c.hx * hx + c.hz * hz).toBeGreaterThan(0.99);
      // One hit, and its tick is the hardest of the drive: the share and the flat loss, give or take what the engine and the ground did in that tick.
      expect(hitTicks).toBe(1);
      expect(before).toBeGreaterThan(2);
      expect(worst).toBeGreaterThan(before * share + flat - 0.25);
      expect(worst).toBeLessThan(before * share + flat + 0.25);
    }, timeLimit(120_000));
  }

  it("is still stopped by what does not give way: the same drive at a utility pole ends against it", () => {
    const pole = plan.props.poles[0];
    expect(pole).toBeDefined();
    // The poles' boxes are in the car's solids as they were.
    const box = plan.props.solids.find((b) => b.hu === 0.21 && b.hv === 0.21);
    expect(box).toBeDefined();
    const pos = { x: anchor.x + (box as { cx: number }).cx + 0.02, y: 0, z: anchor.z + (box as { cz: number }).cz };
    expect(constrainCircle(seed, pos, { x: 0, y: 0, z: 0 }, CAR_RADIUS, true)).toBe(true);
  }, timeLimit(120_000));
});
