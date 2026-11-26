import { describe, expect, it } from "vitest";
import { LAMP_INTENSITY } from "@csarkosh/engine/game/lampParams";
import { HEADLIGHT_AHEAD, HEADLIGHT_DROP, HEADLIGHT_GAIN, HEADLIGHT_RANGE, HEADLIGHT_STATE, HEADLIGHT_UP, headlightsFor, lightHeadlights, litFor, placeHeadlights } from "../../src/game/car/headlights.js";
import { newCarPose } from "../../src/game/car/carPose.js";
import { FOOT, LEAVING, SEATED } from "../../src/sim/car/types.js";

const lampAt = (): { x: number; y: number; z: number; dx: number; dy: number; dz: number; angle: number; range: number } => ({ x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, angle: 0.7, range: 12 });
const poseOf = (x: number, y: number, z: number, hx: number, hz: number): ReturnType<typeof newCarPose> => Object.assign(newCarPose(), { x, y, z, hx, hz, lights: true });

describe("where the headlights are", () => {
  it("stand ahead of a car heading +z, a little up, pointing along its heading and slightly down", () => {
    const at = lampAt();
    placeHeadlights(poseOf(10, 3, 20, 0, 1), at);
    expect([at.x, at.z]).toEqual([10, 20 + HEADLIGHT_AHEAD]);
    expect(at.y).toBeCloseTo(3 + HEADLIGHT_UP, 12);
    expect(at.dx).toBeCloseTo(0, 12);
    expect(at.dz).toBeGreaterThan(0.99);
    expect(at.dy).toBeLessThan(0);
    expect(at.dy / at.dz).toBeCloseTo(-HEADLIGHT_DROP, 12);
    expect(Math.hypot(at.dx, at.dy, at.dz)).toBeCloseTo(1, 12);
  });

  it("follow a car heading -x, and the lamp's own angle is left as it was", () => {
    const at = lampAt();
    placeHeadlights(poseOf(-5, 1, 2, -1, 0), at);
    expect(at.x).toBeCloseTo(-5 - HEADLIGHT_AHEAD, 12);
    expect(at.z).toBeCloseTo(2, 12);
    expect(at.dx).toBeLessThan(-0.99);
    expect(at.dz).toBeCloseTo(0, 12);
    expect(at.dy / -at.dx).toBeCloseTo(-HEADLIGHT_DROP, 12);
    expect([at.range, at.angle]).toEqual([HEADLIGHT_RANGE, 0.7]);
  });

  it("agree with the engine's camera: a yaw of 0 looks along +z and a heading of (sin yaw, cos yaw) looks as the camera does", () => {
    for (const yaw of [0, 0.7, 2.4, -1.9]) {
      const at = lampAt();
      placeHeadlights(poseOf(0, 0, 0, Math.sin(yaw), Math.cos(yaw)), at);
      // The camera's forward at a pitch p is (sin yaw cos p, -sin p, cos yaw cos p), with p = atan(0.08).
      const p = Math.atan(HEADLIGHT_DROP);
      expect(at.dx).toBeCloseTo(Math.sin(yaw) * Math.cos(p), 12);
      expect(at.dy).toBeCloseTo(-Math.sin(p), 12);
      expect(at.dz).toBeCloseTo(Math.cos(yaw) * Math.cos(p), 12);
    }
  });
});

describe("whether the lamp is the car's", () => {
  it("is when the player is seated, driver or passenger, in a car whose lights are on, and not otherwise", () => {
    const on = { lights: true };
    const off = { lights: false };
    expect(litFor({ car: 1, seat: 0, phase: SEATED, ticks: 0 }, on)).toBe(true);
    expect(litFor({ car: 1, seat: 3, phase: SEATED, ticks: 0 }, on)).toBe(true);
    expect(litFor({ car: 1, seat: 0, phase: SEATED, ticks: 0 }, off)).toBe(false);
    expect(litFor({ car: 1, seat: 0, phase: LEAVING, ticks: 5 }, on)).toBe(false);
    expect(litFor({ car: 0, seat: 0, phase: FOOT, ticks: 0 }, on)).toBe(false);
    expect(litFor({ car: 1, seat: 0, phase: SEATED, ticks: 0 }, null)).toBe(false);
    expect(litFor(undefined, on)).toBe(false);
  });
});

describe("how bright the headlights are", () => {
  it("hand the engine's lamp their own brightness and colour, in place of the walker lamp's, and place it", () => {
    const stock = Object.freeze({ intensity: LAMP_INTENSITY, colour: { r: 1, g: 0.92, b: 0.78 } });
    const lamp = { at: lampAt(), lit: { on: true, state: stock } };
    lightHeadlights(lamp, poseOf(10, 3, 20, 0, 1));
    expect(lamp.lit.state).toBe(HEADLIGHT_STATE);
    expect(lamp.lit.state.intensity).toBe(LAMP_INTENSITY * HEADLIGHT_GAIN);
    expect(lamp.lit.on).toBe(true);
    expect(lamp.at.z).toBe(20 + HEADLIGHT_AHEAD);
    expect(Object.isFrozen(HEADLIGHT_STATE) && Object.isFrozen(HEADLIGHT_STATE.colour)).toBe(true);
  });

  it("are the engine's intensity times the gain, in a warm white", () => {
    expect(HEADLIGHT_STATE.intensity).toBe(LAMP_INTENSITY * HEADLIGHT_GAIN);
    expect(HEADLIGHT_STATE.colour).toEqual({ r: 1, g: 0.95, b: 0.84 });
  });
});

describe("when the frame's lamp becomes the headlights", () => {
  const stock = Object.freeze({ intensity: LAMP_INTENSITY, colour: { r: 1, g: 0.92, b: 0.78 } });
  const frame = (on: boolean): { at: ReturnType<typeof lampAt>; lit: { on: boolean; state: typeof stock } } => ({ at: lampAt(), lit: { on, state: stock } });
  const pose = poseOf(10, 3, 20, 0, 1);
  const seat = (seatNo: number, phase: 0 | 1 | 2 | 3): { car: number; seat: number; phase: 0 | 1 | 2 | 3; ticks: number } => ({ car: 1, seat: seatNo, phase, ticks: 0 });

  it("lights and places them for a seated driver and for a passenger, with the lamp on", () => {
    for (const seatNo of [0, 1, 3]) {
      const lamp = frame(true);
      headlightsFor(lamp, seat(seatNo, SEATED), pose);
      expect(lamp.lit.state).toBe(HEADLIGHT_STATE);
      expect(lamp.at.z).toBe(20 + HEADLIGHT_AHEAD);
      expect(lamp.at.range).toBe(HEADLIGHT_RANGE);
    }
  });

  it("leaves the lamp as the engine placed it when it is off, or the player is on foot, getting in or out, or the car has no pose", () => {
    const cases: [boolean, ReturnType<typeof seat> | undefined, typeof pose | null][] = [
      [false, seat(0, SEATED), pose],
      [true, undefined, pose],
      [true, seat(0, FOOT), pose],
      [true, seat(0, 1), pose],
      [true, seat(0, LEAVING), pose],
      [true, seat(0, SEATED), null],
    ];
    for (const [on, ride, p] of cases) {
      const lamp = frame(on);
      headlightsFor(lamp, ride, p);
      expect(lamp.lit.state).toBe(stock);
      expect(lamp.at).toEqual(lampAt());
      expect(lamp.lit.on).toBe(on);
    }
  });
});
