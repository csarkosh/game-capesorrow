import { describe, expect, it } from "vitest";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { addPlayer, applyInput, removePlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { CAR_CIRCLES, CAR_RADIUS, carEnv } from "../../src/sim/car/body.js";
import { carHeld, carHostStep, carMove, carPressed, constrainByCars, newRide, returnCar, type Rider } from "../../src/sim/car/rules.js";
import { SEAT_HEIGHT, doorNear, doorPlace, seatFor, seatPlace } from "../../src/sim/car/seats.js";
import { carStart, groundCar, newCar } from "../../src/sim/car/start.js";
import { surfaceAt } from "../../src/sim/car/surface.js";
import {
  CAR_LENGTH, CAR_WIDTH, DOOR_REACH, ENTER_TICKS, INTERACT_BIT, LAMP_BIT, LEAVE_SPEED, LEAVE_TICKS, WADE,
} from "../../src/sim/car/tuning.js";
import { ENTERING, FOOT, LEAVING, PAVED, SEATED, type Car } from "../../src/sim/car/types.js";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";
import { bearingU } from "../../src/sim/town/bearings.js";
import { constrainCircle } from "../../src/sim/town/solid.js";
import { townStart } from "../../src/sim/town/start.js";
import { WALK_RULES } from "../../src/sim.js";
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
    });
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
  });
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
  });

  it("gives the driver's seat first, then the door's own, and none when both are taken", () => {
    const car = reset();
    expect(seatFor(car, 1)).toBe(0);
    car.seats[0] = 7;
    expect(seatFor(car, 1)).toBe(1);
    expect(seatFor(car, 3)).toBe(3);
    car.seats[1] = 8;
    expect(seatFor(car, 1)).toBe(-1);
  });
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
  });

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
  });
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
  });

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
  });

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
  });

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
  });

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
  });

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
  });

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
  });
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
  });

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
  });

  /** The ground with a trench on the car's left, deep under a sea level that leaves the right side dry; put back after `body`. */
  function withTrenchOnTheLeft(car: Car, body: () => void): void {
    const was = { ground: world.ground, level: world.waterLevel };
    const base = ground;
    const edge = car.x - 0.5;
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
  });
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
  });

  it("repeats the last controls on a tick with no command", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(60, p, { moveZ: 1 });
    const before = car.speed;
    expect(before).toBeGreaterThan(1);
    tick(10);
    expect(car.speed).toBeGreaterThan(before);
    expect(car.controls.throttle).toBe(1);
  });

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
  });

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
  });

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
    expect(car.z).toBeGreaterThan(z0 + 1);
    expect(Math.abs(car.speed)).toBeGreaterThanOrEqual(LEAVE_SPEED);
    expect(passenger.ride).toEqual({ car: 1, seat: 1, phase: SEATED, ticks: 0 });
    expect(car.seats[1]).toBe(passenger.id);
  });

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
  });

  it("puts a seated player whose car is gone back on foot, with the engine's own walk", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    world.state.cars.length = 0;
    expect(carMove(world, p, cmd(p.lastProcessedInput + 1))).toBe(false);
    expect(p.ride).toEqual(newRide());
  });
});

describe("the car with no driver", () => {
  it("frees the seat of a driver who leaves the game, and the car brakes to rest", () => {
    const car = reset();
    onHighway(car);
    const p = getIn(car, 0);
    tickWith(120, p, { moveZ: 1 });
    expect(car.speed).toBeGreaterThan(5);
    removePlayer(world, p.id);
    tick(600);
    expect(car.seats[0]).toBe(0);
    expect(car.speed).toBe(0);
  });

  it("holds a car that is being got into at rest, until the driver is seated", () => {
    const car = reset();
    onHighway(car);
    car.speed = 5;
    const p = atDoor(car, 0);
    carPressed(world, p, INTERACT_BIT);
    tick(ENTER_TICKS - 1);
    expect(car.speed).toBe(0);
  });

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
  });
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
  });
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
  });
});
