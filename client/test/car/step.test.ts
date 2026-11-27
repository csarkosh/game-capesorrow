import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { stepCar } from "../../src/sim/car/step.js";
import { CLIMB_MAX, GRAVITY, REVERSE_ACCEL } from "../../src/sim/car/tuning.js";
import type { Car, CarControls, CarEnv } from "../../src/sim/car/types.js";

const flat: CarEnv = { top: 30, grip: 8.3, slope: 0 };
const gravel: CarEnv = { top: 20, grip: 5.4, slope: 0 };
const none: CarControls = { throttle: 0, turn: 0, handbrake: false };
const full: CarControls = { throttle: 1, turn: 0, handbrake: false };

function car(): Car {
  return {
    id: 1, x: 0, y: 0, z: 0, hx: 0, hz: 1, speed: 0, slip: 0, steer: 0,
    controls: { ...none }, lights: false, owed: 0, seats: [0, 0, 0, 0],
  };
}

describe("stepCar", () => {
  it("reverses harder than gravity pulls on the steepest ground the car may be on", () => {
    expect(REVERSE_ACCEL).toBeGreaterThan(GRAVITY * CLIMB_MAX);
  }, timeLimit(30_000));

  it("makes no NaN of a car with no heading: it is turned to +x", () => {
    const c = car();
    c.hx = 0;
    c.hz = 0;
    stepCar(c, full, flat);
    for (const v of [c.x, c.z, c.hx, c.hz, c.speed, c.slip, c.steer]) expect(Number.isFinite(v)).toBe(true);
    expect([c.hx, c.hz]).toEqual([1, 0]);
  }, timeLimit(30_000));

  it("gathers speed from rest: 0 to 25 m/s in about 8 s", () => {
    const c = car();
    let ticks = 0;
    while (c.speed < 25) { stepCar(c, full, flat); ticks++; }
    expect(ticks / 60).toBeGreaterThan(7.5);
    expect(ticks / 60).toBeLessThan(8.5);
  }, timeLimit(30_000));

  it("never passes the surface's top speed", () => {
    const c = car();
    let peak = 0;
    for (let i = 0; i < 60 * 60; i++) { stepCar(c, full, flat); peak = Math.max(peak, c.speed); }
    expect(peak).toBeLessThanOrEqual(30);
    expect(c.speed).toBeLessThanOrEqual(30);
    expect(c.speed).toBeGreaterThan(29);
  }, timeLimit(30_000));

  it("stops from 30 m/s in about 50 m and rests at exactly zero", () => {
    const c = car();
    c.speed = 30;
    const z0 = c.z;
    const brake: CarControls = { throttle: -1, turn: 0, handbrake: false };
    while (c.speed > 0.5) stepCar(c, brake, flat);
    for (let i = 0; i < 120; i++) stepCar(c, none, flat);
    expect(c.z - z0).toBeGreaterThan(45);
    expect(c.z - z0).toBeLessThan(56);
    expect(c.speed).toBe(0);
  }, timeLimit(30_000));

  it("reverses to 6 m/s and no faster", () => {
    const c = car();
    const back: CarControls = { throttle: -1, turn: 0, handbrake: false };
    for (let i = 0; i < 20 * 60; i++) stepCar(c, back, flat);
    expect(c.speed).toBeCloseTo(-6, 1);
    expect(c.speed).toBeGreaterThanOrEqual(-6);
  }, timeLimit(30_000));

  it("turns right with a positive turn, in a circle of about 4.3 m at a crawl", () => {
    const c = car();
    const lock: CarControls = { throttle: 0, turn: 1, handbrake: false };
    c.speed = 2;
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
    let hxAfterFirstSecond = 0;
    let lapped = false;
    for (let i = 1; i <= 60 * 30; i++) {
      stepCar(c, { ...lock, throttle: c.speed < 2 ? 1 : 0 }, flat);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
      if (i === 60) hxAfterFirstSecond = c.hx;
      if (i > 5 * 60 && c.hx >= 0 && c.hz > 0) { lapped = true; break; }
    }
    expect(lapped).toBe(true);
    const radius = (maxX - minX + (maxZ - minZ)) / 4;
    expect(radius).toBeGreaterThan(4.0);
    expect(radius).toBeLessThan(4.8);
    expect(hxAfterFirstSecond).toBeGreaterThan(0);
  }, timeLimit(30_000));

  it("keeps its heading a unit vector", () => {
    const c = car();
    for (let i = 0; i < 20 * 60; i++) {
      stepCar(c, { throttle: 1, turn: i % 200 < 100 ? 1 : -1, handbrake: i % 300 > 250 }, flat);
    }
    expect(Math.abs(c.hx * c.hx + c.hz * c.hz - 1)).toBeLessThan(1e-12);
  }, timeLimit(30_000));

  it("slides on gravel where it holds on pavement", () => {
    const run = (env: CarEnv): Car => {
      const c = car();
      c.speed = 18;
      for (let i = 0; i < 60; i++) stepCar(c, { throttle: 1, turn: 1, handbrake: false }, env);
      return c;
    };
    const onGravel = run(gravel);
    const onPaved = run(flat);
    expect(Math.abs(onGravel.slip)).toBeGreaterThan(Math.abs(onPaved.slip) + 0.5);
  }, timeLimit(30_000));

  it("is the same to the bit for the same inputs", () => {
    const runOnce = (): Car => {
      const c = car();
      for (let i = 0; i < 1000; i++) {
        stepCar(c, { throttle: i % 400 < 300 ? 1 : -1, turn: i % 170 < 85 ? 0.7 : -0.3, handbrake: i % 500 > 450 }, i % 2 ? flat : gravel);
      }
      return c;
    };
    expect(runOnce()).toEqual(runOnce());
  }, timeLimit(30_000));

  it("rests on a slope with no throttle, and cannot climb past the limit", () => {
    const still = car();
    stepCar(still, none, { ...flat, slope: 0.2 });
    expect(still.speed).toBe(0);
    const c = car();
    for (let i = 0; i < 5 * 60; i++) stepCar(c, full, { ...flat, slope: 0.5 });
    expect(c.speed).toBeLessThanOrEqual(0);
  }, timeLimit(30_000));

  it("records the controls it took", () => {
    const c = car();
    const taken: CarControls = { throttle: 0.5, turn: -0.5, handbrake: true };
    stepCar(c, taken, flat);
    expect(c.controls).toEqual(taken);
  }, timeLimit(30_000));

  it("does not hold a reversing car at rest on a steep slope", () => {
    const steep = { ...flat, slope: 0.5 };
    for (const controls of [{ throttle: 1, turn: 0, handbrake: false }, { throttle: 0, turn: 0, handbrake: true }]) {
      const c = car();
      c.speed = -5;
      stepCar(c, controls, steep);
      expect(c.speed).toBeLessThan(-4.5);
      expect(c.speed).toBeGreaterThan(-5.5);
      expect(c.speed).not.toBe(0);
    }
  }, timeLimit(30_000));

  it("slides outward: to the left after a hard right turn, to the right after a hard left", () => {
    const slide = (turn: number): Car => {
      const c = car();
      c.speed = 25;
      for (let i = 0; i < 60; i++) stepCar(c, { throttle: 1, turn, handbrake: false }, flat);
      return c;
    };
    expect(slide(1).slip).toBeLessThan(-0.5);
    expect(slide(-1).slip).toBeGreaterThan(0.5);
  }, timeLimit(30_000));

  it("costs no speed and leaves no slide in a turn the tyres hold", () => {
    const c = car();
    c.speed = 10;
    const top: CarEnv = { top: 10, grip: 8.3, slope: 0 };
    for (let i = 0; i < 120; i++) {
      stepCar(c, { throttle: 1, turn: 0.4, handbrake: false }, top);
      expect(c.slip).toBe(0);
    }
    expect(c.speed).toBeGreaterThan(9.99);
    expect(c.hx).toBeGreaterThan(0.5);
  }, timeLimit(30_000));

  it("settles into a small slide at full lock, nose inside its path, at 10, 20 and 30 m/s", () => {
    for (const v of [10, 20, 30]) {
      const c = car();
      c.speed = v;
      const top: CarEnv = { top: v, grip: 8.3, slope: 0 };
      const tangents: number[] = [];
      for (let i = 0; i < 4 * 60; i++) {
        stepCar(c, { throttle: 1, turn: 1, handbrake: false }, top);
        tangents.push(-c.slip / c.speed);
      }
      // A right turn slides the car to its left (the slip is negative), by 2 to 12 degrees of its heading, and holds there.
      const last = tangents[tangents.length - 1] as number;
      expect(last).toBeGreaterThan(0.035);
      expect(last).toBeLessThan(0.21);
      expect(Math.max(...tangents)).toBeLessThan(0.21);
      expect(Math.abs(last - (tangents[tangents.length - 61] as number))).toBeLessThan(0.02);
    }
  }, timeLimit(30_000));

  it("throws the tail out with the handbrake: the car turns further and slides wider than it does without", () => {
    const turn = (handbrake: boolean): { turned: number; tangent: number } => {
      const c = car();
      c.speed = 10;
      const top: CarEnv = { top: 10, grip: 8.3, slope: 0 };
      for (let i = 0; i < 42; i++) stepCar(c, { throttle: 0, turn: 1, handbrake }, top);
      return { turned: Math.atan2(c.hx, c.hz), tangent: -c.slip / Math.max(c.speed, 0.01) };
    };
    const thrown = turn(true);
    const plain = turn(false);
    expect(thrown.turned).toBeGreaterThan(plain.turned);
    // Past 25 degrees of slide in 0.7 s, where the plain turn has not reached 6.
    expect(thrown.tangent).toBeGreaterThan(0.46);
    expect(plain.tangent).toBeLessThan(0.1);
  }, timeLimit(30_000));

  it("comes straight when the wheel is let go in a slide: the front wheels turn against it, and the slide is over in a second and a half", () => {
    for (const v of [10, 20, 30]) {
      const c = car();
      c.speed = v;
      const top: CarEnv = { top: v, grip: 8.3, slope: 0 };
      for (let i = 0; i < 42; i++) stepCar(c, { throttle: 0, turn: 1, handbrake: true }, top);
      expect(c.slip).toBeLessThan(-2);
      let against = false;
      for (let i = 0; i < 90; i++) {
        stepCar(c, { throttle: 1, turn: 0, handbrake: false }, top);
        // The car slides to its left, so the wheels are turned left of centre.
        if (c.steer < -0.05) against = true;
      }
      expect(against).toBe(true);
      expect(c.slip).toBe(0);
      expect(c.steer).toBe(0);
      expect(c.speed).toBeGreaterThan(0);
    }
  }, timeLimit(30_000));

  it("gains no speed from a slide: with no throttle the car's speed over the ground only falls", () => {
    const c = car();
    c.speed = 20;
    let before = 20;
    for (let i = 0; i < 180; i++) {
      stepCar(c, { throttle: 0, turn: i < 60 ? 1 : -1, handbrake: i % 90 < 45 }, flat);
      const now = Math.hypot(c.speed, c.slip);
      expect(now).toBeLessThanOrEqual(before + 1e-9);
      before = now;
    }
  }, timeLimit(30_000));

  it("opens no lock as a slide takes speed from along the heading", () => {
    // Two cars going 20 m/s over the ground, one of them sliding: the wheels are asked for the same lock (the steering's help aside, which the handbrake leaves out).
    const straight = car();
    straight.speed = 20;
    const sliding = car();
    sliding.speed = 16;
    sliding.slip = -12;
    for (let i = 0; i < 12; i++) {
      stepCar(straight, { throttle: 0, turn: 1, handbrake: true }, { top: 30, grip: 0, slope: 0 });
      stepCar(sliding, { throttle: 0, turn: 1, handbrake: true }, { top: 30, grip: 0, slope: 0 });
    }
    // At 16 m/s along the heading alone the lock would be 0.27; at 20 over the ground it is 0.21.
    expect(Math.abs(sliding.steer - straight.steer)).toBeLessThan(0.02);
    expect(sliding.steer).toBeLessThan(0.24);
  }, timeLimit(30_000));

  it("backs with the nose swinging away from the lock", () => {
    const c = car();
    for (let i = 0; i < 120; i++) stepCar(c, { throttle: -1, turn: 1, handbrake: false }, flat);
    expect(c.speed).toBeLessThan(0);
    expect(c.hx).toBeLessThan(0);
  }, timeLimit(30_000));
});
