import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes, type CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import { newCarPose, type CarPose } from "../../src/game/car/carPose.js";
import {
  FIXED_SECONDS, HIGH, HOLD_LEAST, NOSE, NO_SHOT, ORBIT, ORBIT_SECONDS, ROADSIDE, ROADSIDE_SECONDS, TAIL, WHEEL, newCine, stepCine, type Cine,
} from "../../src/game/car/cineCamera.js";

const DT = 1 / 60;
const open = (): boolean => false;
const flat = (): number => 0;
const pose = (): CameraPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });

/** A car heading +z at (x, z), at `speed`. */
function carAt(x: number, z: number, speed: number, over: Partial<CarPose> = {}): CarPose {
  return Object.assign(newCarPose(), { id: 1, x, y: 0, z, hx: 0, hz: 1, speed, slip: 0 }, over);
}

type Frame = { shot: number; cuts: number; out: CameraPose; fov: number; car: CarPose; t: number };

/** Drives a car straight along +z for `seconds`, stepping the cinematic view each frame. */
function drive(c: Cine, seconds: number, speed: number, blocked: (x: number, y: number, z: number) => boolean = open, each?: (f: Frame) => void, from = 0): number {
  const out = pose();
  let z = from;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    z += speed * DT;
    const car = carAt(0, z, speed);
    const fov = stepCine(c, car, DT, blocked, flat, out);
    each?.({ shot: c.shot, cuts: c.cuts, out, fov, car, t: i * DT });
  }
  return z;
}

/** How far off the camera's forward line the car's aim point lies, as the sine of the angle. */
function offAim(out: CameraPose, car: CarPose): number {
  const a = cameraAxes(out.yaw, out.pitch, out.roll, restAxes());
  const dx = car.x - out.x;
  const dy = car.y + 0.9 - out.y;
  const dz = car.z - out.z;
  const far = Math.hypot(dx, dy, dz);
  const along = (dx * a.fx + dy * a.fy + dz * a.fz) / far;
  return Math.sqrt(Math.max(0, 1 - along * along));
}

describe("the cinematic view", () => {
  it("begins with a cut to a shot, and takes every shot of its round on an open road", () => {
    const c = newCine();
    expect(c.shot).toBe(NO_SHOT);
    const seen = new Set<number>();
    drive(c, 60, 10, open, (f) => seen.add(f.shot));
    for (const shot of [ROADSIDE, WHEEL, NOSE, HIGH]) expect(seen.has(shot), `shot ${shot}`).toBe(true);
    expect(seen.has(NO_SHOT)).toBe(false);
    // Nothing is in the way on an open road, so the shot of last resort is never taken, and a moving car is not orbited.
    expect(seen.has(TAIL)).toBe(false);
    expect(seen.has(ORBIT)).toBe(false);
  });

  it("stands a roadside camera still ahead of the car and turns it to keep the car in the middle of the frame", () => {
    const c = newCine();
    let place: [number, number, number] | null = null;
    let frames = 0;
    drive(c, 30, 10, open, (f) => {
      if (f.shot !== ROADSIDE) {
        place = null;
        return;
      }
      if (place === null) {
        place = [f.out.x, f.out.y, f.out.z];
        // Ahead of the car as the shot begins, beside its line, over the ground.
        expect(f.out.z).toBeGreaterThan(f.car.z + 5);
        expect(Math.abs(f.out.x)).toBeGreaterThan(2);
        expect(f.out.y).toBeGreaterThan(0.3);
      }
      expect([f.out.x, f.out.y, f.out.z]).toEqual(place);
      expect(offAim(f.out, f.car)).toBeLessThan(1e-6);
      expect(f.out.roll).toBe(0);
      frames++;
    });
    expect(frames).toBeGreaterThan(60);
  });

  it("holds the car at one size from the roadside: a long lens while it is far, a wide one as it passes, between 0.3 and 1 rad", () => {
    const c = newCine();
    let far = 0;
    let near = 0;
    drive(c, 40, 10, open, (f) => {
      if (f.shot !== ROADSIDE) return;
      const d = Math.hypot(f.car.x - f.out.x, f.car.z - f.out.z);
      expect(f.fov).toBeGreaterThanOrEqual(0.3);
      expect(f.fov).toBeLessThanOrEqual(1);
      if (d > 20) far = Math.max(far, f.fov);
      if (d < 7) near = Math.max(near, f.fov);
    });
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(0.6);
    expect(near).toBeGreaterThan(0.9);
  });

  it("leaves a roadside shot once the car has gone by and away, and holds none past its time", () => {
    const c = newCine();
    let began = 0;
    let longest = 0;
    let last = NO_SHOT;
    let cuts = 0;
    drive(c, 60, 10, open, (f) => {
      if (f.cuts !== cuts) {
        cuts = f.cuts;
        began = f.t;
      }
      last = f.shot;
      if (f.shot === ROADSIDE) {
        longest = Math.max(longest, f.t - began);
        // Never held with the car far behind it: 26 m past, and a frame's travel.
        const behind = f.out.z - f.car.z;
        expect(behind).toBeGreaterThan(-27);
      }
    });
    expect(last).not.toBe(NO_SHOT);
    expect(longest).toBeLessThanOrEqual(ROADSIDE_SECONDS + DT);
    expect(longest).toBeGreaterThan(1.5);
  });

  it("never holds the same fixed shot twice running, and never holds one past its time", () => {
    const c = newCine();
    const run: number[] = [];
    let cuts = 0;
    let began = 0;
    drive(c, 90, 12, open, (f) => {
      if (f.cuts !== cuts) {
        cuts = f.cuts;
        began = f.t;
        run.push(f.shot);
      }
      if (f.shot === WHEEL || f.shot === NOSE) expect(f.t - began).toBeLessThanOrEqual(FIXED_SECONDS + DT);
    });
    expect(run.length).toBeGreaterThan(8);
    for (let i = 1; i < run.length; i++) if (run[i] !== ROADSIDE) expect(run[i]).not.toBe(run[i - 1]);
  });

  it("rides with the car in the wheel shot: low beside it, looking forward along its side", () => {
    const c = newCine();
    let frames = 0;
    drive(c, 60, 10, open, (f) => {
      if (f.shot !== WHEEL) return;
      frames++;
      // Beside the car, under a metre up, behind its front axle; and looking the way it goes.
      expect(Math.abs(f.out.x)).toBeGreaterThan(1.2);
      expect(Math.abs(f.out.x)).toBeLessThan(1.8);
      expect(f.out.y).toBeLessThan(1);
      expect(f.out.z).toBeLessThan(f.car.z + 1.434);
      expect(Math.cos(f.out.yaw)).toBeGreaterThan(0.9);
    });
    expect(frames).toBeGreaterThan(60);
  });

  it("looks back at the car in the nose shot, and down on it from behind in the high one", () => {
    const c = newCine();
    let nose = 0;
    let high = 0;
    drive(c, 90, 10, open, (f) => {
      if (f.shot === NOSE) {
        nose++;
        expect(f.out.z).toBeGreaterThan(f.car.z + 3);
        expect(Math.cos(f.out.yaw)).toBeLessThan(-0.8);
      } else if (f.shot === HIGH) {
        high++;
        expect(f.out.y).toBeGreaterThan(6);
        expect(f.out.z).toBeLessThan(f.car.z);
        expect(f.out.pitch).toBeGreaterThan(0.3);
        expect(offAim(f.out, f.car)).toBeLessThan(1e-6);
      }
    });
    expect(nose).toBeGreaterThan(60);
    expect(high).toBeGreaterThan(60);
  });

  it("turns slowly round a car that stands, and cuts away when it drives off", () => {
    const c = newCine();
    const out = pose();
    const car = carAt(0, 0, 0);
    const yaws: number[] = [];
    for (let i = 0; i < 4 * 60; i++) {
      stepCine(c, car, DT, open, flat, out);
      expect(c.shot).toBe(ORBIT);
      expect(Math.hypot(out.x, out.z)).toBeGreaterThan(5);
      expect(Math.hypot(out.x, out.z)).toBeLessThan(7);
      expect(offAim(out, car)).toBeLessThan(1e-6);
      yaws.push(out.yaw);
    }
    // It turns: a fifth of a radian a second, one way.
    const turned = Math.atan2(Math.sin((yaws[yaws.length - 1] as number) - (yaws[0] as number)), Math.cos((yaws[yaws.length - 1] as number) - (yaws[0] as number)));
    expect(Math.abs(turned)).toBeGreaterThan(0.6);
    expect(Math.abs(turned)).toBeLessThan(1.1);
    const cuts = c.cuts;
    stepCine(c, carAt(0, 0.1, 6), DT, open, flat, out);
    expect(c.cuts).toBe(cuts + 1);
    expect(c.shot).not.toBe(ORBIT);
  });

  it("orbits again, on a new cut, when a standing car's orbit has run its time", () => {
    const c = newCine();
    const out = pose();
    const car = carAt(0, 0, 0);
    for (let i = 0; i < (ORBIT_SECONDS + 1) * 60; i++) stepCine(c, car, DT, open, flat, out);
    expect(c.shot).toBe(ORBIT);
    expect(c.cuts).toBe(2);
  });

  it("stands no camera in a wall and looks at the car through none: in a street between walls every shot is clear", () => {
    // A street 9 m wide along +z: everything further than 4.5 m from its middle is a building, a column to the sky.
    const street = (x: number): boolean => Math.abs(x) > 4.5;
    const blocked = (x: number): boolean => street(x);
    const c = newCine();
    const seen = new Set<number>();
    drive(c, 90, 10, blocked, (f) => {
      seen.add(f.shot);
      expect(blocked(f.out.x), `shot ${f.shot} at x ${f.out.x}`).toBe(false);
    });
    expect(seen.has(ROADSIDE)).toBe(true);
    expect(seen.has(WHEEL)).toBe(true);
  });

  it("takes the tail shot, drawn in, where nothing else stands: a lane hardly wider than the car, a wall close behind", () => {
    // Walls 1.2 m either side of the car's middle, a wall across the lane 3 m behind the car wherever it is, and one 4 m ahead.
    let carZ = 0;
    const blocked = (x: number, _y: number, z: number): boolean => Math.abs(x) > 1.2 || z < carZ - 3 || z > carZ + 4;
    const c = newCine();
    const out = pose();
    for (let i = 0; i < 6 * 60; i++) {
      carZ += 5 * DT;
      const car = carAt(0, carZ, 5);
      stepCine(c, car, DT, blocked, flat, out);
      expect(c.shot).toBe(TAIL);
      expect(blocked(out.x, out.y, out.z)).toBe(false);
      // Behind the car and looking forward.
      expect(out.z).toBeLessThan(carZ);
      expect(Math.cos(out.yaw)).toBeGreaterThan(0.8);
    }
  });

  it("cuts from a roadside shot when the car goes out of its sight, but not before the shot has been held a moment", () => {
    const c = newCine();
    const out = pose();
    let wall = false;
    // The wall, when it stands, is everything further than 1.9 m from the car's line on both sides: the camera's own place is in it.
    const blocked = (x: number): boolean => wall && Math.abs(x) > 1.9;
    const car = carAt(0, 0, 10);
    stepCine(c, car, DT, blocked, flat, out);
    expect(c.shot).toBe(ROADSIDE);
    const cuts = c.cuts;
    wall = true;
    let held = 0;
    while (c.cuts === cuts && held < 10) {
      car.z += 0.01;
      stepCine(c, car, DT, blocked, flat, out);
      held += DT;
    }
    expect(held).toBeGreaterThanOrEqual(HOLD_LEAST - DT);
    expect(held).toBeLessThan(HOLD_LEAST + 0.5);
  });

  it("takes the same run of shots for the same drive", () => {
    const run = (): number[] => {
      const c = newCine();
      const shots: number[] = [];
      drive(c, 45, 14, open, (f) => shots.push(f.shot, f.out.x, f.out.y, f.out.z));
      return shots;
    };
    expect(run()).toEqual(run());
  });

  it("cuts when the car is put somewhere else", () => {
    const c = newCine();
    const out = pose();
    drive(c, 1, 10);
    const cuts = c.cuts;
    stepCine(c, carAt(900, -400, 10), DT, open, flat, out);
    expect(c.cuts).toBe(cuts + 1);
    expect(Math.hypot(out.x - 900, out.z + 400)).toBeLessThan(80);
  });

  it("leaves every number finite and the roll 0 for a frame of 0 s, of 2 s and of no number, and for a car of no heading", () => {
    for (const dt of [0, 2, -1, NaN, Infinity]) {
      const c = newCine();
      const out = pose();
      const dead = Object.assign(carAt(3, 4, 0), { hx: 0, hz: 0 });
      for (const car of [carAt(1, 2, 12), dead, carAt(1, 2.2, 12, { slip: -5 })]) {
        const fov = stepCine(c, car, dt, open, flat, out);
        for (const v of [out.x, out.y, out.z, out.yaw, out.pitch, fov, c.age, c.px, c.py, c.pz, c.turn]) expect(Number.isFinite(v), `dt ${dt}`).toBe(true);
        expect(out.roll).toBe(0);
        expect(fov).toBeGreaterThan(0.2);
        expect(fov).toBeLessThan(1.3);
      }
    }
  });

  it("adds no field to its record as it steps", () => {
    const c = newCine();
    const keys = Object.keys(c).sort();
    drive(c, 20, 10);
    expect(Object.keys(c).sort()).toEqual(keys);
  });
});
