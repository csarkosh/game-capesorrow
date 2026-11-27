import { describe, expect, it } from "vitest";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { addPlayer, applyInput, removePlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import { waterLevelAt } from "@csarkosh/engine/sim/waters";
import { CAR_CIRCLES, CAR_RADIUS, carEnv } from "../../src/sim/car/body.js";
import { carHeld, carHostStep, carMove, carPressed, constrainByCars, newRide, returnCar, type Rider } from "../../src/sim/car/rules.js";
import { SEAT_HEIGHT, doorNear, doorPlace, seatFor, seatPlace } from "../../src/sim/car/seats.js";
import { carStart, groundCar, newCar } from "../../src/sim/car/start.js";
import { surfaceAt } from "../../src/sim/car/surface.js";
import {
  CAR_LENGTH, CAR_WIDTH, COAST, DOOR_REACH, ENTER_TICKS, HANDBRAKE, INTERACT_BIT, LAMP_BIT, LEAVE_SPEED, LEAVE_TICKS, OWED_MAX, WADE,
} from "../../src/sim/car/tuning.js";
import { ENTERING, FOOT, LEAVING, PAVED, SEATED, type Car } from "../../src/sim/car/types.js";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";
import { RAIL_JOIN, baseGround, constrainRails, townDecks } from "../../src/sim/town/decks.js";
import { bearingU } from "../../src/sim/town/bearings.js";
import { constrainCircle } from "../../src/sim/town/solid.js";
import { townStart } from "../../src/sim/town/start.js";
import { WALK_RULES } from "../../src/sim.js";
import { promptFor } from "../../src/game/car/side.js";
import { WORLD_SEEDS, groundOf, planFor, siteFor, worldFor } from "../townWorld/world.js";

const seed = WORLD_SEEDS[0] as number;
const world = worldFor(seed);
const { anchor } = siteFor(seed);
const ground = groundOf(world);

const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

/** Every test starts from a world with no players and one car at its start. */
function reset(): Car {
  world.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: seed | 0, cars: [newCar(seed, 1)] };
  return world.state.cars[0] as Car;
}

/** The car on the open highway, heading +z, at rest: a clear stretch with nothing near. */
function onHighway(car: Car): void {
  const z = anchor.z + 5000;
  car.x = roadCenterX(seed, z);
  car.z = z;
  car.hx = 0;
  car.hz = 1;
  car.speed = 0;
  car.slip = 0;
  car.steer = 0;
  groundCar(world.ground, car);
}

/** Another car, at rest, `lateral` metres to the right of `car` (a negative one to its left). */
function parkedBeside(car: Car, id: number, lateral: number): Car {
  const other: Car = { ...car, id, x: car.x + car.hz * lateral, z: car.z - car.hx * lateral, controls: { throttle: 0, turn: 0, handbrake: false }, seats: [0, 0, 0, 0] };
  groundCar(world.ground, other);
  world.state.cars.push(other);
  return other;
}

function tick(n: number, inputs: Map<number, InputCommand> = new Map()): void {
  for (let i = 0; i < n; i++) tickPlayers(world, inputs, WALK_RULES);
}

/** `n` ticks of one player's command, each with the next sequence number. */
function tickWith(n: number, p: Rider, more: Partial<InputCommand>): void {
  for (let i = 0; i < n; i++) tickPlayers(world, new Map([[p.id, cmd(p.lastProcessedInput + 1, more)]]), WALK_RULES);
}

/** A player standing on the ground at (x, z). */
function walkerAt(x: number, z: number): Rider {
  const p = addPlayer(world, WALK_RULES);
  p.pos = { x, y: ground.heightAt(x, z) + PLAYER_HALF.y, z };
  return p;
}

/** A player at the door of `seat`, on foot. */
function atDoor(car: Car, seat: number): Rider {
  const d = { x: 0, z: 0 };
  doorPlace(car, seat, d);
  return walkerAt(d.x, d.z);
}

/** A player who walks up to a door, presses to get in, and waits until seated: the seat they got. */
function getIn(car: Car, door: number): Rider {
  const p = atDoor(car, door);
  carPressed(world, p, INTERACT_BIT);
  tick(ENTER_TICKS);
  return p;
}

/** How far a point stands outside the car's rectangle, metres, read from the car's own axes (0 inside). */
function outside(car: Car, x: number, z: number): number {
  const dx = x - car.x;
  const dz = z - car.z;
  const along = dx * car.hx + dz * car.hz;
  const across = dx * car.hz - dz * car.hx;
  const eu = Math.max(0, Math.abs(along) - CAR_LENGTH / 2);
  const ev = Math.max(0, Math.abs(across) - CAR_WIDTH / 2);
  return Math.sqrt(eu * eu + ev * ev);
}

describe("where the car starts", () => {
  for (const s of WORLD_SEEDS) {
    it(`is beside the spawn, on pavement, clear of every building and prop, and the same on every call (seed ${s})`, () => {
      const at = carStart(s);
      const spawn = townStart(s);
      expect(Math.hypot(at.x - spawn.x, at.z - spawn.z)).toBeLessThan(90);
      expect(surfaceAt(s, at.x, at.z)).toBe(PAVED);
      expect(Math.hypot(at.hx, at.hz)).toBeCloseTo(1, 12);
      for (const along of CAR_CIRCLES) {
        const pos = { x: at.x + at.hx * along, y: 0, z: at.z + at.hz * along };
        const before = { ...pos };
        expect(constrainCircle(s, pos, { x: 0, y: 0, z: 0 }, CAR_RADIUS), `circle at ${along}`).toBe(false);
        expect(pos).toEqual(before);
      }
      expect(carStart(s)).toEqual(at);
      expect(newCar(s, 1)).toEqual(newCar(s, 1));
    }, timeLimit(60_000));
  }

  for (const s of WORLD_SEEDS) {
    it(`leaves the spawning player's hull clear of the car's footprint (seed ${s})`, () => {
      const at = carStart(s);
      const w = worldFor(s);
      const spawn = WALK_RULES.spawn(w);
      const car = { ...newCar(s, 1), x: at.x, z: at.z, hx: at.hx, hz: at.hz };
      expect(outside(car, spawn.pos.x, spawn.pos.z), `spawn at ${spawn.pos.x}, ${spawn.pos.z}`).toBeGreaterThanOrEqual(HULL_RADIUS);
    }, timeLimit(120_000));
  }

  it("has its curb on the car's right: the street's edge lies on the right of the heading", () => {
    const at = carStart(seed);
    const plan = planFor(seed);
    // The street the car lies along is the nearest drivable one to it.
    let near: { a: { x: number; z: number }; b: { x: number; z: number }; roadway: number } | null = null;
    let nearD = Infinity;
    for (const st of plan.streets) {
      if (st.kind !== "main" && st.kind !== "street" && st.kind !== "avenue") continue;
      const ex = st.b.x - st.a.x;
      const ez = st.b.z - st.a.z;
      const len2 = ex * ex + ez * ez;
      const t = Math.max(0, Math.min(1, ((at.x - anchor.x - st.a.x) * ex + (at.z - anchor.z - st.a.z) * ez) / len2));
      const d = Math.hypot(at.x - anchor.x - (st.a.x + ex * t), at.z - anchor.z - (st.a.z + ez * t));
      if (d < nearD) {
        nearD = d;
        near = st;
      }
    }
    expect(near).not.toBeNull();
    const st = near!;
    const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
    const dx = (st.b.x - st.a.x) / len;
    const dz = (st.b.z - st.a.z) / len;
    // Along the street, the car lies; 1.2 m inside the curb, which is `roadway / 2` from the centre line.
    expect(Math.abs(at.hx * dx + at.hz * dz)).toBeCloseTo(1, 9);
    const lateral = (at.x - anchor.x - st.a.x) * -dz + (at.z - anchor.z - st.a.z) * dx;
    expect(Math.abs(lateral)).toBeCloseTo(st.roadway / 2 - 1.2, 6);
    // The right of the heading is (hz, -hx): it points from the car to the curb, away from the centre line.
    const rightDotOut = at.hz * (lateral < 0 ? dz : -dz) + -at.hx * (lateral < 0 ? -dx : dx);
    expect(rightDotOut).toBeCloseTo(1, 9);
  }, timeLimit(60_000));
});

describe("seats and doors", () => {
  it("puts the doors beside their seats, 0.5 m outside the body, and answers by reach", () => {
    const car = reset();
    onHighway(car);
    const d = { x: 0, z: 0 };
    for (let seat = 0; seat < 4; seat++) {
      doorPlace(car, seat, d);
      expect(outside(car, d.x, d.z), `door ${seat}`).toBeCloseTo(0.5, 9);
      expect(doorNear(car, d.x, d.z)).toBe(seat);
    }
    doorPlace(car, 0, d);
    // Just out of reach of the nearest door on that side, and far from the others.
    expect(doorNear(car, d.x - car.hz * (DOOR_REACH + 0.05), d.z + car.hx * (DOOR_REACH + 0.05))).toBe(-1);
    expect(doorNear(car, car.x + car.hx * 8, car.z + car.hz * 8)).toBe(-1);
    const s = { x: 0, y: 0, z: 0 };
    seatPlace(car, 0, s);
    expect(s.y).toBe(car.y + SEAT_HEIGHT);
  }, timeLimit(60_000));

  it("gives the driver's seat first, then the door's own, and none when both are taken", () => {
    const car = reset();
    expect(seatFor(car, 1)).toBe(0);
    car.seats[0] = 7;
    expect(seatFor(car, 1)).toBe(1);
    expect(seatFor(car, 3)).toBe(3);
    car.seats[1] = 8;
    expect(seatFor(car, 1)).toBe(-1);
  }, timeLimit(60_000));
});

describe("a walker and the car", () => {
  it("cannot pass through the car: walking straight at its side, the hull stops against it", () => {
    const car = reset();
    onHighway(car);
    // 3 m to the car's right, facing it (yaw 0 faces +z; increasing yaw turns toward +x).
    const p = walkerAt(car.x + 3, car.z);
    p.yaw = -Math.PI / 2;
    let nearest = Infinity;
    for (let i = 0; i < 240; i++) {
      tickWith(1, p, { moveZ: 1, yaw: -Math.PI / 2 });
      nearest = Math.min(nearest, outside(car, p.pos.x, p.pos.z));
    }
    expect(nearest).toBeGreaterThanOrEqual(HULL_RADIUS - 1e-6);
    // It did walk up to the car.
    expect(outside(car, p.pos.x, p.pos.z)).toBeLessThan(HULL_RADIUS + 0.05);
  }, timeLimit(60_000));

  it("is pushed out when it stands in the car", () => {
    const car = reset();
    onHighway(car);
    const p = walkerAt(car.x + 0.2, car.z + 0.5);
    tick(1);
    expect(outside(car, p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(HULL_RADIUS - 1e-6);
    // And `constrainByCars` leaves a hull clear of the car exactly where it was.
    const pos = { x: car.x + 5, y: 1, z: car.z };
    const vel = { x: 1, y: 0, z: 0 };
    constrainByCars(world, pos, vel);
    expect([pos, vel]).toEqual([{ x: car.x + 5, y: 1, z: car.z }, { x: 1, y: 0, z: 0 }]);
  }, timeLimit(60_000));
});

describe("getting in and out", () => {
  it("takes 60 ticks, held still, and seats the first player as the driver", () => {
    const car = reset();
    onHighway(car);
    const p = atDoor(car, 0);
    const where = { ...p.pos };
    carPressed(world, p, INTERACT_BIT);
    expect(carHeld(p)).toBe(true);
    expect(car.seats[0]).toBe(p.id);
    // The player pushes forward the whole time and stays where it is.
    tickWith(ENTER_TICKS - 1, p, { moveZ: 1 });
    expect(p.ride.phase).toBe(ENTERING);
    expect(p.pos).toEqual(where);
    tickWith(1, p, { moveZ: 1 });
    expect(p.ride.phase).toBe(SEATED);
    expect(carHeld(p)).toBe(false);
    expect(car.seats).toEqual([p.id, 0, 0, 0]);
  }, timeLimit(60_000));

  it("does nothing for a click out of reach of any door", () => {
    const car = reset();
    onHighway(car);
    const d = { x: 0, z: 0 };
    doorPlace(car, 1, d);
    const far = walkerAt(d.x + car.hz * (DOOR_REACH + 0.05), d.z - car.hx * (DOOR_REACH + 0.05));
    const ahead = walkerAt(car.x + car.hx * 8, car.z + car.hz * 8);
    carPressed(world, far, INTERACT_BIT);
    carPressed(world, ahead, INTERACT_BIT);
    expect([far.ride, ahead.ride]).toEqual([newRide(), newRide()]);
    expect(car.seats).toEqual([0, 0, 0, 0]);
  }, timeLimit(60_000));

  it("gives two players at the same door on the same tick two different seats, and a third none", () => {
    const car = reset();
    onHighway(car);
    const a = atDoor(car, 1);
    const b = atDoor(car, 1);
    const c = atDoor(car, 1);
    carPressed(world, a, INTERACT_BIT);
    carPressed(world, b, INTERACT_BIT);
    carPressed(world, c, INTERACT_BIT);
    expect(a.ride.seat).not.toBe(b.ride.seat);
    expect([a.ride.seat, b.ride.seat]).toEqual([0, 1]);
    expect(car.seats).toEqual([a.id, b.id, 0, 0]);
    expect(c.ride.phase).toBe(FOOT);
  }, timeLimit(60_000));

  it("refuses getting out above 2 m/s; below it takes 36 ticks and stands the player clear of the car, with the car at rest", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    expect(p.ride.phase).toBe(SEATED);
    car.speed = LEAVE_SPEED + 0.5;
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(SEATED);
    car.speed = LEAVE_SPEED - 0.1;
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(LEAVING);
    expect(p.ride.ticks).toBe(LEAVE_TICKS);
    tick(LEAVE_TICKS - 1);
    expect(p.ride.phase).toBe(LEAVING);
    expect(car.seats[0]).toBe(p.id);
    tick(1);
    expect(p.ride.phase).toBe(FOOT);
    expect(car.seats[0]).toBe(0);
    expect(car.speed).toBe(0);
    const d = { x: 0, z: 0 };
    doorPlace(car, 0, d);
    expect(p.pos.x).toBeCloseTo(d.x, 9);
    expect(p.pos.z).toBeCloseTo(d.z, 9);
    expect(p.pos.y).toBeCloseTo(ground.heightAt(d.x, d.z) + PLAYER_HALF.y, 9);
    expect(outside(car, p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(HULL_RADIUS);
  }, timeLimit(60_000));

  it("keeps the player seated when both its door and the one across are blocked by other cars", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    // A car along each side, its near edge on the door's place.
    parkedBeside(car, 2, -(CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2));
    parkedBeside(car, 3, CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2);
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride).toEqual({ car: 1, seat: 0, phase: SEATED, ticks: 0 });
    expect(car.seats[0]).toBe(p.id);
  }, timeLimit(60_000));

  it("gets out by the door across when its own is blocked, and stands on that side", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    parkedBeside(car, 2, -(CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2));
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(LEAVING);
    tick(LEAVE_TICKS);
    expect(p.ride.phase).toBe(FOOT);
    const d = { x: 0, z: 0 };
    doorPlace(car, 1, d);
    expect([p.pos.x, p.pos.z]).toEqual([d.x, d.z]);
    // The right of a car heading +z is +x.
    expect(p.pos.x).toBeGreaterThan(car.x);
  }, timeLimit(60_000));

  it("stays seated at the end of getting out if every door has been blocked meanwhile", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(LEAVING);
    parkedBeside(car, 2, -(CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2));
    parkedBeside(car, 3, CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2);
    tick(LEAVE_TICKS);
    expect(p.ride.phase).toBe(SEATED);
    expect(car.seats[0]).toBe(p.id);
  }, timeLimit(60_000));
});

/**
 * A car at rest on the town's ground with the left side of its body 0.7 m from a building's long wall, so that the left
 * doors' places lie inside the wall's reach of the hull, chosen from the plan before anyone moves: the wall is long
 * enough for the car, the car's three circles touch nothing, and the right doors' places are free of buildings and props.
 */
function besideWall(car: Car): boolean {
  const plan = planFor(seed);
  const vel = { x: 0, y: 0, z: 0 };
  for (const b of plan.buildings) {
    if (b.kind === "pier" || b.halfAlong < 5) continue;
    const u = bearingU(b.bearing);
    const cx = anchor.x + b.centre.x;
    const cz = anchor.z + b.centre.z;
    for (const side of [-1, 1]) {
      // The wall's outward normal, and the car lying along the wall with the wall on its left (its right is the normal).
      const nx = u.z * side;
      const nz = -u.x * side;
      const gap = CAR_WIDTH / 2 + 0.5 + 0.2;
      car.x = cx + nx * (b.halfAcross + gap);
      car.z = cz + nz * (b.halfAcross + gap);
      car.hx = -nz;
      car.hz = nx;
      car.speed = 0;
      groundCar(world.ground, car);
      let free = true;
      for (const along of CAR_CIRCLES) {
        const pos = { x: car.x + car.hx * along, y: 0, z: car.z + car.hz * along };
        if (constrainCircle(seed, pos, vel, CAR_RADIUS)) free = false;
      }
      const d = { x: 0, z: 0 };
      for (const seat of [0, 2]) {
        doorPlace(car, seat, d);
        // The left doors: inside the wall's reach.
        const pos = { x: d.x, y: 0, z: d.z };
        if (!constrainCircle(seed, pos, vel, HULL_RADIUS)) free = false;
      }
      for (const seat of [1, 3]) {
        doorPlace(car, seat, d);
        const pos = { x: d.x, y: 0, z: d.z };
        if (constrainCircle(seed, pos, vel, HULL_RADIUS)) free = false;
      }
      if (free) return true;
    }
  }
  return false;
}

describe("a door beside a wall or over water", () => {
  it("keeps the player seated when a building's wall blocks one side and a car the other", () => {
    const car = reset();
    expect(besideWall(car)).toBe(true);
    const p = getIn(car, 1);
    parkedBeside(car, 2, CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2);
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride).toEqual({ car: 1, seat: 0, phase: SEATED, ticks: 0 });
  }, timeLimit(60_000));

  it("gets out on the side away from the wall when only the wall side is blocked", () => {
    const car = reset();
    expect(besideWall(car)).toBe(true);
    const p = getIn(car, 1);
    carPressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(LEAVING);
    tick(LEAVE_TICKS);
    expect(p.ride.phase).toBe(FOOT);
    const d = { x: 0, z: 0 };
    doorPlace(car, 1, d);
    expect(p.pos.x).toBeCloseTo(d.x, 9);
    expect(p.pos.z).toBeCloseTo(d.z, 9);
  }, timeLimit(60_000));

  /** The ground with a trench on the car's left, deep under a sea level that leaves the right side dry; put back after `body`. */
  function withTrenchOnTheLeft(car: Car, body: () => void): void {
    const was = { ground: world.ground, level: world.waterLevel };
    const base = ground;
    // Beyond the wheels (0.73 m out), so that the car stays level on the ground and the door's place alone is in the trench.
    const edge = car.x - 1.0;
    world.ground = Object.create(base, { heightAt: { value: (x: number, z: number): number => base.heightAt(x, z) - (x < edge ? 3 : 0) } }) as GroundField;
    world.waterLevel = car.y - 1;
    try {
      body();
    } finally {
      world.ground = was.ground;
      world.waterLevel = was.level;
    }
  }

  it("does not stand a player in water deeper than wading: out by the dry side, and not at all when that is blocked", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    // The car heads +z, so its left is -x.
    const left = { x: 0, z: 0 };
    const right = { x: 0, z: 0 };
    doorPlace(car, 0, left);
    doorPlace(car, 1, right);
    expect(left.x).toBeLessThan(car.x);
    withTrenchOnTheLeft(car, () => {
      expect((world.waterLevel as number) - groundOf(world).heightAt(left.x, left.z)).toBeGreaterThan(WADE);
      expect((world.waterLevel as number) - groundOf(world).heightAt(right.x, right.z)).toBeLessThan(WADE);
      carPressed(world, p, INTERACT_BIT);
      expect(p.ride.phase).toBe(LEAVING);
      tick(LEAVE_TICKS);
      expect(p.ride.phase).toBe(FOOT);
      doorPlace(car, 1, right);
      expect([p.pos.x, p.pos.z]).toEqual([right.x, right.z]);
    });
    // Back in, with the dry side now taken by a car: the player stays seated.
    const q = getIn(car, 1);
    withTrenchOnTheLeft(car, () => {
      parkedBeside(car, 2, CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2);
      carPressed(world, q, INTERACT_BIT);
      expect(q.ride.phase).toBe(SEATED);
    });
  }, timeLimit(60_000));
});

describe("riding", () => {
  it("drives the car with the driver's commands and carries a passenger with it", () => {
    const car = reset();
    onHighway(car);
    const driver = atDoor(car, 0);
    const passenger = atDoor(car, 1);
    carPressed(world, driver, INTERACT_BIT);
    carPressed(world, passenger, INTERACT_BIT);
    tick(ENTER_TICKS);
    expect([driver.ride.seat, passenger.ride.seat]).toEqual([0, 1]);
    const z0 = car.z;
    tickWith(180, driver, { moveZ: 1 });
    // Bounds that three seconds from rest meet at every cap from 10 m/s up.
    expect(car.speed).toBeGreaterThan(8);
    expect(car.z).toBeGreaterThan(z0 + 10);
    const seat = { x: 0, y: 0, z: 0 };
    for (const [p, s] of [[driver, 0], [passenger, 1]] as const) {
      seatPlace(car, s, seat);
      expect(Math.hypot(p.pos.x - car.x, p.pos.z - car.z)).toBeLessThan(1.5);
      expect(p.pos).toEqual(seat);
      expect(p.vel).toEqual({ x: 0, y: 0, z: 0 });
      expect(p.grounded).toBe(true);
    }
  }, timeLimit(60_000));

  it("repeats the last controls on a tick with no command", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(60, p, { moveZ: 1 });
    const before = car.speed;
    expect(before).toBeGreaterThan(1);
    // Up to `OWED_MAX` ticks: past it the car is braked.
    tick(OWED_MAX - 1);
    expect(car.speed).toBeGreaterThan(before);
    expect(car.controls.throttle).toBe(1);
  }, timeLimit(60_000));

  it("steps the car once more for a catch-up command, as one more tick would", () => {
    const run = (catchUp: boolean): { car: Car; afterOne: number } => {
      const car = reset();
      onHighway(car);
      const p = getIn(car, 0);
      tickWith(30, p, { moveZ: 1 });
      const s = p.lastProcessedInput;
      let afterOne = 0;
      if (catchUp) {
        tickPlayers(world, new Map([[p.id, cmd(s + 1, { moveZ: 1 })]]), WALK_RULES);
        afterOne = car.z;
        applyInput(world, p.id, cmd(s + 2, { moveZ: 1 }), WALK_RULES);
      } else {
        tickWith(2, p, { moveZ: 1 });
      }
      return { car: structuredClone(car), afterOne };
    };
    const one = run(true);
    const two = run(false);
    expect(one.car).toEqual(two.car);
    expect(one.car.z).toBeGreaterThan(one.afterOne);
  }, timeLimit(60_000));

  it("lets a passenger out beside the car when it presses at rest", () => {
    const car = reset();
    onHighway(car);
    getIn(car, 0);
    const passenger = getIn(car, 1);
    expect(passenger.ride.seat).toBe(1);
    carPressed(world, passenger, INTERACT_BIT);
    expect(passenger.ride.phase).toBe(LEAVING);
    tick(LEAVE_TICKS);
    expect(passenger.ride.phase).toBe(FOOT);
    expect(car.seats[1]).toBe(0);
    const d = { x: 0, z: 0 };
    doorPlace(car, 1, d);
    expect(passenger.pos.x).toBeCloseTo(d.x, 9);
    expect(passenger.pos.z).toBeCloseTo(d.z, 9);
    expect(outside(car, passenger.pos.x, passenger.pos.z)).toBeGreaterThanOrEqual(HULL_RADIUS);
  }, timeLimit(60_000));

  it("carries a passenger getting out with the car if the driver drives off, and keeps it seated", () => {
    const car = reset();
    onHighway(car);
    const driver = getIn(car, 0);
    const passenger = getIn(car, 1);
    carPressed(world, passenger, INTERACT_BIT);
    expect(passenger.ride.phase).toBe(LEAVING);
    const z0 = car.z;
    const seat = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < LEAVE_TICKS; i++) {
      tickWith(1, driver, { moveZ: 1 });
      expect(Math.hypot(passenger.pos.x - car.x, passenger.pos.z - car.z), `tick ${i}`).toBeLessThan(1.5);
      // It rides in its seat, not where the car was when it pressed.
      seatPlace(car, 1, seat);
      expect(passenger.pos, `tick ${i}`).toEqual(seat);
    }
    // The driver had sent nothing for the passenger's whole entry, so the car was owed its first `OWED_MAX` commands' steps: 30 of the 36 drove it.
    expect(car.z).toBeGreaterThan(z0 + 0.5);
    expect(Math.abs(car.speed)).toBeGreaterThanOrEqual(LEAVE_SPEED);
    expect(passenger.ride).toEqual({ car: 1, seat: 1, phase: SEATED, ticks: 0 });
    expect(car.seats[1]).toBe(passenger.id);
  }, timeLimit(60_000));

  it("flips the lamps for the driver's press and no one else's", () => {
    const car = reset();
    onHighway(car);
    const driver = getIn(car, 0);
    const passenger = getIn(car, 1);
    carPressed(world, passenger, LAMP_BIT);
    expect(car.lights).toBe(false);
    carPressed(world, driver, LAMP_BIT);
    expect(car.lights).toBe(true);
    carPressed(world, driver, LAMP_BIT);
    expect(car.lights).toBe(false);
  }, timeLimit(60_000));

  it("puts a seated player whose car is gone back on foot, with the engine's own walk", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    world.state.cars.length = 0;
    expect(carMove(world, p, cmd(p.lastProcessedInput + 1))).toBe(false);
    expect(p.ride).toEqual(newRide());
  }, timeLimit(60_000));
});

describe("the car with no driver", () => {
  it("frees the seat of a driver who leaves the game, and the car brakes to rest", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(120, p, { moveZ: 1 });
    expect(car.speed).toBeGreaterThan(5);
    const v = car.speed;
    removePlayer(world, p.id);
    // At rest within the handbrake's stopping time: the speed over what the handbrake and rolling resistance take off a tick, and a few ticks
    // for the slope. Rolling resistance alone would take v / COAST seconds, four to five times as long.
    const brakeTicks = Math.ceil(v / ((HANDBRAKE + COAST) * TICK_DT));
    expect(v / (COAST * TICK_DT)).toBeGreaterThan(brakeTicks * 4);
    tick(brakeTicks + 5);
    expect(car.seats[0]).toBe(0);
    expect(car.speed).toBe(0);
    const z = car.z;
    tick(300);
    expect(car.z).toBe(z);
  }, timeLimit(60_000));

  it("brakes a parked car that is set moving at the handbrake's rate, not the rolling resistance's", () => {
    const car = reset();
    onHighway(car);
    car.speed = 6;
    tick(30);
    // Half a second: the handbrake and rolling resistance together take (HANDBRAKE + COAST) * 0.5 = 4.1 m/s off; rolling resistance alone 0.6.
    // The road's grade moves the speed a little either way.
    expect(Math.abs(car.speed - (6 - (HANDBRAKE + COAST) * 30 * TICK_DT))).toBeLessThan(0.3);
    expect(car.speed).toBeLessThan(6 - COAST * 30 * TICK_DT - 2);
    tick(30);
    expect(car.speed).toBe(0);
  }, timeLimit(60_000));

  it("holds a car that is being got into at rest, until the driver is seated", () => {
    const car = reset();
    onHighway(car);
    car.speed = 5;
    const p = atDoor(car, 0);
    carPressed(world, p, INTERACT_BIT);
    tick(ENTER_TICKS - 1);
    expect(car.speed).toBe(0);
  }, timeLimit(60_000));

  it("does not creep on the steepest street", () => {
    const car = reset();
    const plan = planFor(seed);
    let steepest: { x: number; z: number; hx: number; hz: number; rise: number } | null = null;
    for (const st of plan.streets) {
      if (st.kind !== "main" && st.kind !== "street" && st.kind !== "avenue") continue;
      const len = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      const ha = ground.heightAt(anchor.x + st.a.x, anchor.z + st.a.z);
      const hb = ground.heightAt(anchor.x + st.b.x, anchor.z + st.b.z);
      const rise = Math.abs(hb - ha) / len;
      if (steepest === null || rise > steepest.rise) {
        // Heading downhill.
        const s = hb < ha ? 1 : -1;
        steepest = { x: anchor.x + (st.a.x + st.b.x) / 2, z: anchor.z + (st.a.z + st.b.z) / 2, hx: s * (st.b.x - st.a.x) / len, hz: s * (st.b.z - st.a.z) / len, rise };
      }
    }
    expect(steepest).not.toBeNull();
    expect(steepest!.rise).toBeGreaterThan(0.03);
    Object.assign(car, { x: steepest!.x, z: steepest!.z, hx: steepest!.hx, hz: steepest!.hz, speed: 0, slip: 0, steer: 0 });
    groundCar(world.ground, car);
    expect(carEnv(world, car).slope).toBeLessThan(-0.02);
    // One tick settles it out of anything it was put in; after that it does not move.
    tick(1);
    const x0 = car.x;
    const z0 = car.z;
    tick(600);
    expect([car.x, car.z]).toEqual([x0, z0]);
    expect(car.speed).toBe(0);
  }, timeLimit(60_000));
});

describe("putting the car back", () => {
  it("returns it to its start at rest with its riders on foot, clear of it", () => {
    const car = reset();
    onHighway(car);
    const driver = atDoor(car, 0);
    const passenger = atDoor(car, 1);
    carPressed(world, driver, INTERACT_BIT);
    carPressed(world, passenger, INTERACT_BIT);
    tick(ENTER_TICKS);
    tickWith(120, driver, { moveZ: 1 });
    car.lights = true;
    returnCar(world, 1);
    const at = carStart(seed);
    expect([car.x, car.z, car.hx, car.hz]).toEqual([at.x, at.z, at.hx, at.hz]);
    expect([car.speed, car.slip, car.steer, car.lights, car.seats]).toEqual([0, 0, 0, false, [0, 0, 0, 0]]);
    expect(car.controls).toEqual({ throttle: 0, turn: 0, handbrake: false });
    expect(car.y).toBeCloseTo(newCar(seed, 1).y, 9);
    for (const p of [driver, passenger]) {
      expect(p.ride).toEqual(newRide());
      expect(outside(car, p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(HULL_RADIUS);
      expect(p.vel).toEqual({ x: 0, y: 0, z: 0 });
    }
    expect(Math.hypot(driver.pos.x - passenger.pos.x, driver.pos.z - passenger.pos.z)).toBeGreaterThan(1);
  }, timeLimit(60_000));
});

describe("the host's step", () => {
  it("is carHostStep on the host's world and never runs on a predicted one", () => {
    const car = reset();
    onHighway(car);
    const p = atDoor(car, 0);
    carPressed(world, p, INTERACT_BIT);
    const predicted = { ...world, authoritative: false };
    tickPlayers(predicted, new Map(), WALK_RULES);
    // A predicted world counts no one into the seat: only the host's step does.
    expect(p.ride.ticks).toBe(ENTER_TICKS);
    carHostStep(world);
    expect(p.ride.ticks).toBe(ENTER_TICKS - 1);
  }, timeLimit(60_000));
});

describe("the driver's late commands", () => {
  /** A driver seated on the highway sends N commands of full throttle with `gaps[i]` host ticks that have none before the i-th: the car after the last. */
  function drive(gaps: readonly number[]): { car: Car; owedMax: number } {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    expect(car.owed).toBe(0);
    let owedMax = 0;
    for (const gap of gaps) {
      for (let g = 0; g < gap; g++) {
        tick(1);
        owedMax = Math.max(owedMax, car.owed);
      }
      tickWith(1, p, { moveZ: 1 });
    }
    return { car: structuredClone(car), owedMax };
  }

  it("steps the car once for each command however the empty ticks fell, so the car is where the same commands on consecutive ticks put it", () => {
    // The first command is sent on time, so that the car has its throttle when the late ones come: the steps taken in advance repeat the last controls.
    const steady = drive(new Array(41).fill(0));
    expect(steady.car.speed).toBeGreaterThan(2);
    for (const head of [[2, 0, 1, 0, 3, 0, 1, 1, 0, 2, 0, 1, 0, 0, 4, 0, 0, 0, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [5, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0], [3, 0, 3, 0, 3, 0]]) {
      // Commands enough after the last gap to pay back everything owed.
      const gaps = [0, ...head, ...new Array(40 - head.length).fill(0)];
      const run = drive(gaps);
      expect(run.owedMax).toBeGreaterThan(0);
      expect(run.owedMax).toBeLessThan(OWED_MAX);
      expect(run.car.owed).toBe(0);
      expect(run.car).toEqual(steady.car);
    }
  }, timeLimit(60_000));

  it("brakes a car whose driver has sent nothing for more than a tenth of a second to rest, and keeps it there however long the gap", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(120, p, { moveZ: 1, moveX: 0.2 });
    const v = car.speed;
    expect(v).toBeGreaterThan(5);
    expect(car.controls.throttle).toBe(1);
    tick(OWED_MAX);
    // The first `OWED_MAX` ticks drove on; the car is owed as much as it may be.
    expect(car.owed).toBe(OWED_MAX);
    expect(car.speed).toBeGreaterThan(v);
    const stopTicks = Math.ceil(car.speed / ((HANDBRAKE + COAST) * TICK_DT));
    tick(stopTicks + 5);
    expect(car.speed).toBe(0);
    expect(car.controls.throttle).toBe(0);
    const at = { x: car.x, z: car.z };
    tick(2000);
    expect({ x: car.x, z: car.z }).toEqual(at);
    expect(car.speed).toBe(0);
    expect(car.owed).toBe(OWED_MAX);
  }, timeLimit(60_000));

  it("swallows at most `OWED_MAX` commands when they resume after a long gap, and then the car answers", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(60, p, { moveZ: 1 });
    tick(1000);
    expect(car.speed).toBe(0);
    for (let i = 0; i < OWED_MAX; i++) {
      tickWith(1, p, { moveZ: 1 });
      expect(car.speed, `command ${i + 1}`).toBe(0);
      expect(car.owed).toBe(OWED_MAX - i - 1);
    }
    expect(car.controls.throttle).toBe(1);
    tickWith(1, p, { moveZ: 1 });
    expect(car.speed).toBeGreaterThan(0);
    expect(car.owed).toBe(0);
  }, timeLimit(60_000));

  it("owes nothing to a new driver", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(30, p, { moveZ: 1 });
    tick(3);
    expect(car.owed).toBe(3);
    car.speed = 0;
    carPressed(world, p, INTERACT_BIT);
    tick(LEAVE_TICKS);
    expect(p.ride.phase).toBe(FOOT);
    expect(car.owed).toBe(0);
    const q = getIn(car, 0);
    expect(car.owed).toBe(0);
    // A driver who leaves the game while the car is owed leaves it owing nothing.
    tickWith(5, q, { moveZ: 1 });
    tick(2);
    expect(car.owed).toBe(2);
    removePlayer(world, q.id);
    tick(1);
    expect(car.owed).toBe(0);
  }, timeLimit(60_000));

  it("takes a first command that is not the last taken as fresh: nothing is owed on seating, so it steps the car", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    const before = car.speed;
    // The first command after seating: its sequence number is past the last taken, which the engine set while the driver was held.
    tickWith(1, p, { moveZ: 1 });
    expect(car.speed).toBeGreaterThan(before);
  }, timeLimit(60_000));
});

/** Rails of the first seed's decks with dry (or wadeable) ground well below their top outboard, long enough to park a car along. */
function railedEdges(): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const r of townDecks(seed).rails) {
    if (Math.hypot(r.bx - r.ax, r.bz - r.az) < 8) continue;
    out.push({ x: (r.ax + r.bx) / 2, z: (r.az + r.bz) / 2, nx: r.nx, nz: r.nz });
  }
  return out;
}

describe("getting out and in at a deck's edge", () => {
  /** A car on a deck hugging a rail, its driver's door (the left) on the rail's outboard side, the driver seated; or null when the outboard door's ground is not below the deck by more than a rail's join. */
  function parkedAtRail(e: { x: number; z: number; nx: number; nz: number }): { car: Car; p: Rider } | null {
    const car = reset();
    // The rail's inboard normal (nx, nz); the left of the heading is outboard.
    car.x = e.x + e.nx * 1.0;
    car.z = e.z + e.nz * 1.0;
    car.hx = -e.nz;
    car.hz = e.nx;
    car.speed = 0;
    groundCar(world.ground, car);
    const d = { x: 0, z: 0 };
    doorPlace(car, 0, d);
    const low = ground.heightAt(d.x, d.z);
    const level = waterLevelAt(world, d.x, d.z);
    if (!(car.y - low > RAIL_JOIN) || (level !== null && level - low > WADE)) return null;
    const p = walkerAt(car.x, car.z);
    car.seats[0] = p.id;
    p.ride = { car: 1, seat: 0, phase: SEATED, ticks: 0 };
    seatPlace(car, 0, p.pos);
    return { car, p };
  }

  it("puts the player out on the deck, not on the ground metres below the rail", () => {
    let found = 0;
    for (const e of railedEdges()) {
      const set = parkedAtRail(e);
      if (set === null) continue;
      const { car, p } = set;
      // The other side must be free for the player to get out at all.
      const d = { x: 0, z: 0 };
      doorPlace(car, 1, d);
      // The deck side's door: on the deck's level, and clear of the town's solids and rails.
      const there = { x: d.x, y: car.y + PLAYER_HALF.y, z: d.z };
      const still = { x: 0, y: 0, z: 0 };
      if (Math.abs(ground.heightAt(d.x, d.z) - car.y) > RAIL_JOIN || constrainCircle(seed, there, still, HULL_RADIUS) || constrainRails(seed, { ...there }, still)) continue;
      found++;
      carPressed(world, p, INTERACT_BIT);
      expect(p.ride.phase).toBe(LEAVING);
      tick(LEAVE_TICKS);
      expect(p.ride.phase as number).toBe(FOOT);
      expect(Math.abs(p.pos.y - PLAYER_HALF.y - car.y), `at ${e.x}, ${e.z}`).toBeLessThanOrEqual(RAIL_JOIN);
      expect([p.pos.x, p.pos.z]).toEqual([d.x, d.z]);
      if (found >= 3) break;
    }
    expect(found).toBeGreaterThan(0);
  }, timeLimit(60_000));

  it("keeps the player seated when the deck side is blocked too", () => {
    let found = 0;
    for (const e of railedEdges()) {
      const set = parkedAtRail(e);
      if (set === null) continue;
      const { car, p } = set;
      parkedBeside(car, 2, CAR_WIDTH / 2 + 0.5 + CAR_WIDTH / 2);
      found++;
      carPressed(world, p, INTERACT_BIT);
      expect(p.ride.phase, `at ${e.x}, ${e.z}`).toBe(SEATED);
      if (found >= 3) break;
    }
    expect(found).toBeGreaterThan(0);
  }, timeLimit(60_000));

  it("does not let a walker under the deck get into a car parked on it, and offers no seat", () => {
    let found = 0;
    for (const e of railedEdges()) {
      const car = reset();
      car.x = e.x + e.nx * 3;
      car.z = e.z + e.nz * 3;
      car.hx = -e.nz;
      car.hz = e.nx;
      groundCar(world.ground, car);
      const d = { x: 0, z: 0 };
      doorPlace(car, 1, d);
      const low = baseGround(seed).heightAt(d.x, d.z);
      if (!(car.y - low > 1.5)) continue;
      const p = addPlayer(world, WALK_RULES);
      p.pos = { x: d.x, y: low + PLAYER_HALF.y, z: d.z };
      expect(doorNear(car, p.pos.x, p.pos.z)).toBe(1);
      carPressed(world, p, INTERACT_BIT);
      expect(p.ride.phase, `at ${e.x}, ${e.z}`).toBe(FOOT);
      expect(car.seats).toEqual([0, 0, 0, 0]);
      expect(promptFor(p, world.state.cars)).toBeNull();
      // The same walker at the deck's own level is offered the seat.
      p.pos = { x: d.x, y: car.y + PLAYER_HALF.y, z: d.z };
      expect(promptFor(p, world.state.cars)).not.toBeNull();
      found++;
      if (found >= 3) break;
    }
    expect(found).toBeGreaterThan(0);
  }, timeLimit(60_000));
});

describe("getting into a moving car", () => {
  it("is refused at the car's leaving speed or more, either way, and allowed below it", () => {
    const car = reset();
    onHighway(car);
    for (const speed of [LEAVE_SPEED, LEAVE_SPEED + 3, -LEAVE_SPEED, -(LEAVE_SPEED + 3)]) {
      car.speed = speed;
      const p = atDoor(car, 0);
      expect(promptFor(p, world.state.cars), `${speed}`).toBeNull();
      carPressed(world, p, INTERACT_BIT);
      expect(p.ride.phase, `${speed}`).toBe(FOOT);
      expect(car.seats[0]).toBe(0);
    }
    car.speed = LEAVE_SPEED - 0.1;
    const q = atDoor(car, 0);
    expect(promptFor(q, world.state.cars)).not.toBeNull();
    carPressed(world, q, INTERACT_BIT);
    expect(q.ride.phase).toBe(ENTERING);
  }, timeLimit(60_000));
});

describe("walking is unchanged by the car", () => {
  it("walks the same path with a car parked far away as in a world with no cars", () => {
    const run = (cars: Car[]): { x: number; y: number; z: number }[] => {
      world.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: seed | 0, cars };
      const p = addPlayer(world, WALK_RULES);
      const path: { x: number; y: number; z: number }[] = [];
      // From the spawn, in turns of 40 ticks toward the eight points of the compass, with a jump now and then: into walls, along them, and past props.
      for (let i = 0; i < 480; i++) {
        const yaw = Math.floor(i / 40) * 0.8 + 0.3;
        tickPlayers(world, new Map([[p.id, cmd(i + 1, { moveZ: 1, moveX: i % 7 === 0 ? 1 : 0, yaw, buttons: i % 97 === 0 ? 1 : 0 })]]), WALK_RULES);
        path.push({ ...p.pos });
      }
      return path;
    };
    const far = newCar(seed, 1);
    far.x += 4000;
    far.z += 4000;
    groundCar(world.ground, far);
    const withCar = run([far]);
    const without = run([]);
    expect(withCar).toEqual(without);
    // The walk went somewhere, and met something: some ticks moved less than a full stride.
    const stride = withCar.slice(1).map((q, i) => Math.hypot(q.x - (withCar[i] as { x: number }).x, q.z - (withCar[i] as { z: number }).z));
    expect(stride.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
    expect(Math.max(...stride)).toBeGreaterThan(0.05);
    expect(stride.some((s) => s < 0.01)).toBe(true);
  }, timeLimit(60_000));

  it("is put out of a wall last when a car pins it there: a walker between a car and a wall ends clear of the wall", () => {
    const car = reset();
    let tried = 0;
    for (const b of planFor(seed).buildings) {
      if (b.kind === "pier" || b.halfAlong < 5 || tried > 0) continue;
      const u = bearingU(b.bearing);
      const nx = u.z;
      const nz = -u.x;
      // The wall's face, and the car lying along it with its near side against the face: its body is 0.917 m off the wall's centre line.
      const fx = anchor.x + b.centre.x + nx * b.halfAcross;
      const fz = anchor.z + b.centre.z + nz * b.halfAcross;
      car.x = fx + nx * (CAR_WIDTH / 2);
      car.z = fz + nz * (CAR_WIDTH / 2);
      car.hx = -nz;
      car.hz = nx;
      groundCar(world.ground, car);
      // A walker whose centre stands 0.5 m off the face, in the car's body: the car's nearest side is the wall's, so it puts the walker through the wall.
      const spot = { x: fx + nx * 0.5, y: car.y + PLAYER_HALF.y, z: fz + nz * 0.5 };
      const probe = { x: spot.x, y: 0, z: spot.z };
      if (constrainCircle(seed, probe, { x: 0, y: 0, z: 0 }, HULL_RADIUS)) continue;
      tried++;
      WALK_RULES.constrain?.(world, spot, { x: 0, y: 0, z: 0 });
      const out = { x: spot.x, y: 0, z: spot.z };
      expect(constrainCircle(seed, out, { x: 0, y: 0, z: 0 }, HULL_RADIUS), `at ${fx}, ${fz}`).toBe(false);
      expect(out).toEqual({ x: spot.x, y: 0, z: spot.z });
    }
    expect(tried).toBe(1);
  }, timeLimit(60_000));
});
