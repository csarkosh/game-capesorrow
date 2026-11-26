import { describe, expect, it } from "vitest";
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
    controls: { ...none }, lights: false, seats: [0, 0, 0, 0],
  };
}

describe("stepCar", () => {
  it("reverses harder than gravity pulls on the steepest ground the car may be on", () => {
    expect(REVERSE_ACCEL).toBeGreaterThan(GRAVITY * CLIMB_MAX);
  });

  it("gathers speed from rest: 0 to 25 m/s in about 8 s", () => {
    const c = car();
    let ticks = 0;
    while (c.speed < 25) { stepCar(c, full, flat); ticks++; }
    expect(ticks / 60).toBeGreaterThan(7.5);
    expect(ticks / 60).toBeLessThan(8.5);
  });

  it("never passes the surface's top speed", () => {
    const c = car();
    let peak = 0;
    for (let i = 0; i < 60 * 60; i++) { stepCar(c, full, flat); peak = Math.max(peak, c.speed); }
    expect(peak).toBeLessThanOrEqual(30);
    expect(c.speed).toBeLessThanOrEqual(30);
    expect(c.speed).toBeGreaterThan(29);
  });

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
  });

  it("reverses to 6 m/s and no faster", () => {
    const c = car();
    const back: CarControls = { throttle: -1, turn: 0, handbrake: false };
    for (let i = 0; i < 20 * 60; i++) stepCar(c, back, flat);
    expect(c.speed).toBeCloseTo(-6, 1);
    expect(c.speed).toBeGreaterThanOrEqual(-6);
  });

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
  });

  it("keeps its heading a unit vector", () => {
    const c = car();
    for (let i = 0; i < 20 * 60; i++) {
      stepCar(c, { throttle: 1, turn: i % 200 < 100 ? 1 : -1, handbrake: i % 300 > 250 }, flat);
    }
    expect(Math.abs(c.hx * c.hx + c.hz * c.hz - 1)).toBeLessThan(1e-12);
  });

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
  });

  it("is the same to the bit for the same inputs", () => {
    const runOnce = (): Car => {
      const c = car();
      for (let i = 0; i < 1000; i++) {
        stepCar(c, { throttle: i % 400 < 300 ? 1 : -1, turn: i % 170 < 85 ? 0.7 : -0.3, handbrake: i % 500 > 450 }, i % 2 ? flat : gravel);
      }
      return c;
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it("rests on a slope with no throttle, and cannot climb past the limit", () => {
    const still = car();
    stepCar(still, none, { ...flat, slope: 0.2 });
    expect(still.speed).toBe(0);
    const c = car();
    for (let i = 0; i < 5 * 60; i++) stepCar(c, full, { ...flat, slope: 0.5 });
    expect(c.speed).toBeLessThanOrEqual(0);
  });

  it("records the controls it took", () => {
    const c = car();
    const taken: CarControls = { throttle: 0.5, turn: -0.5, handbrake: true };
    stepCar(c, taken, flat);
    expect(c.controls).toEqual(taken);
  });

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
  });

  it("slides outward: to the left after a hard right turn, to the right after a hard left", () => {
    const slide = (turn: number): Car => {
      const c = car();
      c.speed = 25;
      for (let i = 0; i < 60; i++) stepCar(c, { throttle: 1, turn, handbrake: false }, flat);
      return c;
    };
    expect(slide(1).slip).toBeLessThan(-0.5);
    expect(slide(-1).slip).toBeGreaterThan(0.5);
  });

  it("backs with the nose swinging away from the lock", () => {
    const c = car();
    for (let i = 0; i < 120; i++) stepCar(c, { throttle: -1, turn: 1, handbrake: false }, flat);
    expect(c.speed).toBeLessThan(0);
    expect(c.hx).toBeLessThan(0);
  });
});
