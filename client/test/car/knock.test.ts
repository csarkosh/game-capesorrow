import { describe, expect, it } from "vitest";
import { KNOCK_FROM, knockCar, touches } from "../../src/sim/car/knock.js";
import { CAR_LENGTH, CAR_WIDTH } from "../../src/sim/car/tuning.js";
import type { Car } from "../../src/sim/car/types.js";
import { KNOCK_LOSS, KNOCK_RADIUS, knockGrid, knockableAt, type KnockBox, type KnockKind, type Knockable } from "../../src/sim/town/knockables.js";

const thing = (id: number, kind: KnockKind, x: number, z: number, box?: KnockBox): Knockable => knockableAt(id, kind, x, z, box);
/** A stop sign 10 m up the road from the origin, on the car's line. */
const sign = thing(0, "stop", 0, 10);
const grid = knockGrid([sign]);

/** A car at (x, z) heading +z. */
function car(z: number, speed: number, over: Partial<Car> = {}): Car {
  return { id: 1, x: 0, y: 0, z, hx: 0, hz: 1, speed, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, owed: 0, seats: [0, 0, 0, 0], ...over };
}

/** Moves the car `dt` seconds along its heading and takes the tick's hits, as `driveCar` does: the place before, then the hits. */
function tick(c: Car, g = grid, dt = 1 / 60): number {
  const fromX = c.x;
  const fromZ = c.z;
  c.x += (c.hx * c.speed + c.hz * c.slip) * dt;
  c.z += (c.hz * c.speed - c.hx * c.slip) * dt;
  return knockCar(0, c, fromX, fromZ, c.hx, c.hz, g);
}

describe("a car and what gives way", () => {
  it("touches a thing when its circle reaches the body's rectangle, and not a hair further off", () => {
    const r = sign.r;
    expect(touches(sign, 0, 10 - CAR_LENGTH / 2 - r + 0.001, 0, 1)).toBe(true);
    expect(touches(sign, 0, 10 - CAR_LENGTH / 2 - r - 0.001, 0, 1)).toBe(false);
    expect(touches(sign, CAR_WIDTH / 2 + r - 0.001, 10, 0, 1)).toBe(true);
    expect(touches(sign, CAR_WIDTH / 2 + r + 0.001, 10, 0, 1)).toBe(false);
    // The body turned a quarter: its length lies across.
    expect(touches(sign, CAR_LENGTH / 2 + r - 0.001, 10, 1, 0)).toBe(true);
    expect(touches(sign, 0, 10 - CAR_WIDTH / 2 - r - 0.001, 1, 0)).toBe(false);
  });

  it("touches a long thing as a box: a bench is met at its ends and not beside them, however it and the car are turned", () => {
    // A bench 1.7 m long lying across the car's line (along x), 10 m up the road.
    const bench = thing(0, "bench", 0, 10, { ux: 1, uz: 0, hu: 0.85, hv: 0.3 });
    expect(bench.box).toBe(true);
    expect(bench.r).toBeCloseTo(Math.hypot(0.85, 0.3), 12);
    // Its near face is 0.3 m this side of its centre.
    expect(touches(bench, 0, 10 - 0.3 - CAR_LENGTH / 2 + 0.001, 0, 1)).toBe(true);
    expect(touches(bench, 0, 10 - 0.3 - CAR_LENGTH / 2 - 0.001, 0, 1)).toBe(false);
    // Its end reaches 0.85 m to the side: a car whose flank is a hair inside that meets it, a hair outside does not.
    expect(touches(bench, 0.85 + CAR_WIDTH / 2 - 0.001, 10, 0, 1)).toBe(true);
    expect(touches(bench, 0.85 + CAR_WIDTH / 2 + 0.001, 10, 0, 1)).toBe(false);
    // A circle of its half length would have been met 0.55 m sooner from the front: it is not.
    expect(touches(bench, 0, 10 - 0.8 - CAR_LENGTH / 2, 0, 1)).toBe(false);
    // Turned a quarter, the bench lies along the car's line, and is met at its end.
    const along = thing(1, "bench", 0, 10, { ux: 0, uz: 1, hu: 0.85, hv: 0.3 });
    expect(touches(along, 0, 10 - 0.85 - CAR_LENGTH / 2 + 0.001, 0, 1)).toBe(true);
    expect(touches(along, 0.3 + CAR_WIDTH / 2 + 0.001, 10, 0, 1)).toBe(false);
    // A car across a corner of it: the corner is inside the car's rectangle turned 45 degrees.
    const h = Math.SQRT1_2;
    expect(touches(bench, 0.85 + 1.2, 10 + 0.3 + 1.2, -h, -h)).toBe(true);
    expect(touches(bench, 0.85 + 3, 10 + 0.3 + 3, -h, -h)).toBe(false);
    // And it slows the car as its kind does, once.
    const c = car(0, 10);
    let hits = 0;
    for (let i = 0; i < 120; i++) hits += tick(c, knockGrid([bench]));
    expect(hits).toBe(1);
    expect(c.speed).toBeCloseTo(10 * (1 - KNOCK_LOSS.bench[0]) - KNOCK_LOSS.bench[1], 9);
  });

  it("is slowed once, on the tick its body comes to touch the thing: a share of its speed and a little more", () => {
    const c = car(0, 10);
    const speeds: number[] = [];
    let hits = 0;
    for (let i = 0; i < 120; i++) {
      hits += tick(c);
      speeds.push(c.speed);
    }
    expect(hits).toBe(1);
    const [share, flat] = KNOCK_LOSS.stop;
    expect(c.speed).toBeCloseTo(10 * (1 - share) - flat, 9);
    // One step down, at the tick the nose reached the post, and none before or after: it is not stopped, and it goes on through.
    const steps = speeds.filter((v, i) => i > 0 && v !== speeds[i - 1]).length;
    expect(steps).toBe(1);
    expect(speeds[0]).toBe(10);
    expect(c.z).toBeGreaterThan(10 + CAR_LENGTH);
  });

  it("is slowed again when it comes back over what it knocked down, and not while it stands on it", () => {
    const c = car(0, 8);
    let hits = 0;
    for (let i = 0; i < 100 && c.z < 10; i++) hits += tick(c);
    expect(hits).toBe(1);
    // On it, standing: nothing more, however long.
    c.speed = 0;
    for (let i = 0; i < 60; i++) expect(tick(c)).toBe(0);
    // Off it and back.
    c.speed = 6;
    for (let i = 0; i < 120; i++) tick(c);
    expect(touches(sign, c.x, c.z, c.hx, c.hz)).toBe(false);
    c.speed = -6;
    let again = 0;
    for (let i = 0; i < 100; i++) again += tick(c);
    expect(again).toBe(1);
    expect(c.speed).toBeGreaterThan(-6);
    expect(c.speed).toBeLessThan(0);
  });

  it("takes from the slide as from the speed along the heading: the car's line is thrown no way but back", () => {
    // Sliding sideways into the post.
    const c = car(10, 0, { x: -4, slip: -6, hx: 0, hz: 1 });
    // The right of the heading (0, 1) is (1, 0), so a slip of -6 goes to -x: turn it to come at the post from -x.
    c.slip = 6;
    let hits = 0;
    for (let i = 0; i < 60; i++) hits += tick(c);
    expect(hits).toBe(1);
    expect(c.speed).toBe(0);
    expect(c.slip).toBeCloseTo(6 * (1 - KNOCK_LOSS.stop[0]) - KNOCK_LOSS.stop[1], 9);
    // Along and across together keep their proportion.
    const d = car(0, 8, { slip: 2 });
    d.x = -(2 / 8) * (10 - CAR_LENGTH / 2);
    for (let i = 0; i < 200 && d.speed === 8; i++) tick(d);
    expect(d.speed).toBeLessThan(8);
    expect(d.slip / d.speed).toBeCloseTo(2 / 8, 9);
  });

  it("knocks nothing down under half a metre a second, and is never turned round by a hit", () => {
    const slow = car(10 - CAR_LENGTH / 2 - sign.r - 0.02, KNOCK_FROM - 0.05);
    let hits = 0;
    for (let i = 0; i < 30; i++) hits += tick(slow);
    expect(hits).toBe(0);
    expect(slow.speed).toBe(KNOCK_FROM - 0.05);
    // Just over it: the hit takes all it has, and leaves it at rest, not going backward.
    const just = car(10 - CAR_LENGTH / 2 - sign.r - 0.02, KNOCK_FROM + 0.05);
    for (let i = 0; i < 30; i++) hits += tick(just);
    expect(hits).toBe(1);
    expect(just.speed).toBe(0);
    expect(Object.is(just.speed, -0)).toBe(false);
  });

  it("is slowed by each of two things met on one tick, and by a can less than by a post", () => {
    // A post and a can whose near sides are level, so the body reaches both on one tick: each takes its share, in the list's order.
    const level = 10 + KNOCK_RADIUS["trash can"] - KNOCK_RADIUS.stop;
    const two = knockGrid([thing(0, "stop", -0.5, 10), thing(1, "trash can", 0.5, level)]);
    const c = car(0, 12);
    let hits = 0;
    let ticks = 0;
    for (let i = 0; i < 120; i++) {
      const n = tick(c, two);
      if (n > 0) ticks++;
      hits += n;
    }
    expect(hits).toBe(2);
    expect(ticks).toBe(1);
    const afterPost = 12 * (1 - KNOCK_LOSS.stop[0]) - KNOCK_LOSS.stop[1];
    expect(c.speed).toBeCloseTo(afterPost * (1 - KNOCK_LOSS["trash can"][0]) - KNOCK_LOSS["trash can"][1], 9);
    const post = car(0, 12);
    const can = car(0, 12);
    for (let i = 0; i < 120; i++) {
      tick(post, knockGrid([thing(0, "stop", 0, 10)]));
      tick(can, knockGrid([thing(0, "trash can", 0, 10)]));
    }
    expect(can.speed).toBeGreaterThan(post.speed);
  });

  it("is the same to the bit for the same drive, and does nothing off the grid or where there is nothing to knock", () => {
    const run = (): Car => {
      const c = car(0, 15, { slip: 0.5 });
      for (let i = 0; i < 200; i++) tick(c);
      return c;
    };
    expect(run()).toEqual(run());
    const far = car(5000, 20);
    expect(tick(far)).toBe(0);
    expect(far.speed).toBe(20);
    expect(tick(car(0, 20), knockGrid([]))).toBe(0);
  });
});
