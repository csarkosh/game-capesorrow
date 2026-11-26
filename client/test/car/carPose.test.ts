import { describe, expect, it } from "vitest";
import { AXLE_FRONT, AXLE_REAR, TRACK, WHEEL_RADIUS } from "../../src/sim/car/tuning.js";
import type { Car } from "../../src/sim/car/types.js";
import { carPose, newCarPose, rollAfter, wheelMatrix, type CarPose } from "../../src/game/car/carPose.js";

function car(over: Partial<Car> = {}): Car {
  return { id: 1, x: 10, y: 0, z: 20, hx: 1, hz: 0, speed: 0, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, seats: [0, 0, 0, 0], ...over };
}

const flat = (h: number) => (): number => h;

/** A point of the model (x forward, y up, z to the left) as the matrix, column by column, puts it in the world. */
function through(m: ArrayLike<number>, p: readonly [number, number, number]): [number, number, number] {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

function posed(c: Car, ground: (x: number, z: number) => number, before: Car | null = null, alpha = 1): CarPose {
  const out = newCarPose();
  carPose(before, c, alpha, ground, out);
  return out;
}

describe("the car's pose", () => {
  it("stands the body on its four wheels: on a flat place the matrix is upright at the ground's height", () => {
    const p = posed(car(), flat(4.5));
    expect(Array.from(p.matrix).map((v) => Math.round(v * 1e5) / 1e5 + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 4.5, 20, 1]);
    expect([p.x, p.y, p.z]).toEqual([10, 4.5, 20]);
  });

  it("puts the model's nose along the heading and its left on the heading's left (the right is (hz, -hx))", () => {
    const hx = 0.6, hz = 0.8;
    const p = posed(car({ hx, hz }), flat(0));
    const nose = through(p.matrix, [2.5, 0, 0]);
    expect(nose[0]).toBeCloseTo(10 + 2.5 * hx, 4);
    expect(nose[2]).toBeCloseTo(20 + 2.5 * hz, 4);
    const left = through(p.matrix, [0, 0, 1]);
    expect(left[0]).toBeCloseTo(10 - hz, 4);
    expect(left[2]).toBeCloseTo(20 + hx, 4);
    // Right of the heading is (hz, -hx): the model's -z.
    const right = through(p.matrix, [0, 0, -1]);
    expect(right[0] - 10).toBeCloseTo(hz, 4);
    expect(right[2] - 20).toBeCloseTo(-hx, 4);
  });

  it("on a slope the nose is lower than the tail by the ground's fall between the axles", () => {
    const fall = 0.1;
    const p = posed(car(), (x) => -fall * x);
    const front = through(p.matrix, [AXLE_FRONT, 0, 0]);
    const rear = through(p.matrix, [AXLE_REAR, 0, 0]);
    expect(front[1] - rear[1]).toBeCloseTo(-fall * (AXLE_FRONT - AXLE_REAR), 2);
    expect(front[1]).toBeLessThan(rear[1]);
    // The model's up leans back with the slope: its y column has a positive x part (the nose is down).
    expect(p.matrix[5]).toBeGreaterThan(0.99);
    expect(p.matrix[4]).toBeGreaterThan(0);
    // Each wheel stands on its ground: none under it, and none off it by more than the ground's own twist (none here).
    for (const [a, c] of [[AXLE_FRONT, TRACK / 2], [AXLE_FRONT, -TRACK / 2], [AXLE_REAR, TRACK / 2], [AXLE_REAR, -TRACK / 2]] as const) {
      const w = through(p.matrix, [a, 0, c]);
      expect(w[1]).toBeGreaterThanOrEqual(-fall * w[0] - 1e-5);
      expect(w[1]).toBeLessThan(-fall * w[0] + 1e-3);
    }
  });

  it("on a cross slope the left side is higher where the ground is higher on the left", () => {
    // Heading +x: the left is +z.
    const p = posed(car(), (_x, z) => 0.05 * (z - 20));
    const l = through(p.matrix, [0, 0, TRACK / 2]);
    const r = through(p.matrix, [0, 0, -TRACK / 2]);
    expect(l[1] - r[1]).toBeCloseTo(0.05 * TRACK, 2);
  });

  it("raises the body by the wheel that would sink on a twisted ground, so no wheel is in it", () => {
    const g = (x: number, z: number): number => (x > 10 && z > 20 ? 0.04 : 0);
    const p = posed(car(), g);
    for (const [a, c] of [[AXLE_FRONT, TRACK / 2], [AXLE_FRONT, -TRACK / 2], [AXLE_REAR, TRACK / 2], [AXLE_REAR, -TRACK / 2]] as const) {
      const w = through(p.matrix, [a, 0, c]);
      expect(w[1]).toBeGreaterThanOrEqual(g(w[0], w[2]) - 1e-5);
    }
  });

  it("blends between two ticks' cars by alpha, and is the newer car at alpha 1", () => {
    const before = car({ x: 0, hx: 1, hz: 0, speed: 0, steer: 0 });
    const now = car({ x: 1, hx: 0, hz: 1, speed: 4, steer: 0.4 });
    const quarter = posed(now, flat(0), before, 0.25);
    expect(quarter.x).toBeCloseTo(0.25, 6);
    expect(quarter.speed).toBeCloseTo(1, 6);
    expect(quarter.steer).toBeCloseTo(0.1, 6);
    // The heading turns toward the newer one and stays a unit vector.
    expect(quarter.hz).toBeGreaterThan(0);
    expect(Math.hypot(quarter.hx, quarter.hz)).toBeCloseTo(1, 6);
    const whole = posed(now, flat(0), before, 1);
    expect([whole.x, whole.hx, whole.hz, whole.speed]).toEqual([1, 0, 1, 4]);
    const none = posed(now, flat(0), null, 0.3);
    expect(none.x).toBe(1);
  });

  it("draws the newer car where the two are a teleport apart", () => {
    const p = posed(car({ x: 500 }), flat(0), car({ x: 0 }), 0.5);
    expect(p.x).toBe(500);
  });

  it("carries the car's id, lights and driver", () => {
    const p = posed(car({ id: 7, lights: true, seats: [42, 0, 0, 0] }), flat(0));
    expect([p.id, p.lights, p.driver]).toEqual([7, true, 42]);
  });
});

describe("a wheel's matrix", () => {
  const body = posed(car(), flat(0)).matrix;
  const centre: [number, number, number] = [AXLE_FRONT, WHEEL_RADIUS, 0.732];
  const wheel = (steer: number, roll: number): Float32Array => {
    const out = new Float32Array(16);
    wheelMatrix(body, centre, steer, roll, out, 0);
    return out;
  };
  const rel = (m: Float32Array, p: [number, number, number]): [number, number, number] => {
    const w = through(m, p);
    const a = through(wheel(0, 0), [0, 0, 0]);
    return [w[0] - a[0], w[1] - a[1], w[2] - a[2]];
  };

  it("puts the wheel's axle at the axle's place on the body", () => {
    const o = through(wheel(0.3, 1.1), [0, 0, 0]);
    const expected = through(body, centre);
    for (let i = 0; i < 3; i++) expect(o[i]).toBeCloseTo(expected[i] as number, 5);
  });

  it("turns the front of a wheel to the right for a positive steer: the heading's right is (hz, -hx)", () => {
    const front = rel(wheel(0.5, 0), [WHEEL_RADIUS, 0, 0]);
    const angle = Math.atan(0.5);
    // The car heads +x, so its right is -z.
    expect(front[2]).toBeCloseTo(-WHEEL_RADIUS * Math.sin(angle), 5);
    expect(front[0]).toBeCloseTo(WHEEL_RADIUS * Math.cos(angle), 5);
    const left = rel(wheel(-0.5, 0), [WHEEL_RADIUS, 0, 0]);
    expect(left[2]).toBeGreaterThan(0);
  });

  it("rolls forward: after a quarter turn the wheel's top is at its front", () => {
    const top = rel(wheel(0, Math.PI / 2), [0, WHEEL_RADIUS, 0]);
    expect(top[0]).toBeCloseTo(WHEEL_RADIUS, 5);
    expect(top[1]).toBeCloseTo(0, 5);
    // And its front is then at the bottom, as a wheel rolling along the ground has it.
    const front = rel(wheel(0, Math.PI / 2), [WHEEL_RADIUS, 0, 0]);
    expect(front[1]).toBeCloseTo(-WHEEL_RADIUS, 5);
  });

  it("turns for the steer after the roll: the rolled top lands on the steered front", () => {
    const steer = 0.5;
    const a = Math.atan(steer);
    const top = rel(wheel(steer, Math.PI / 2), [0, WHEEL_RADIUS, 0]);
    expect(top[0]).toBeCloseTo(WHEEL_RADIUS * Math.cos(a), 5);
    expect(top[1]).toBeCloseTo(0, 5);
    expect(top[2]).toBeCloseTo(-WHEEL_RADIUS * Math.sin(a), 5);
  });

  it("writes at the offset it is given and leaves the rest alone", () => {
    const out = new Float32Array(32).fill(7);
    wheelMatrix(body, centre, 0, 0, out, 16);
    expect(out[0]).toBe(7);
    expect(out[15]).toBe(7);
    expect(out[31]).toBe(1);
    expect(out[16]).toBeCloseTo(1, 6);
  });
});

describe("the roll", () => {
  it("grows by speed * dt / radius going forward and shrinks in reverse", () => {
    expect(rollAfter(0, 10, 0.1)).toBeCloseTo(1 / WHEEL_RADIUS, 6);
    // 1 - 0.6 / r is under zero: it comes round to the same angle within a turn.
    expect(rollAfter(1, -3, 0.2)).toBeCloseTo(1 - 0.6 / WHEEL_RADIUS + 2 * Math.PI, 6);
    expect(rollAfter(3, -0.3, 0.1)).toBeCloseTo(3 - 0.03 / WHEEL_RADIUS, 6);
  });
  it("stays within a turn so a long drive does not lose its precision", () => {
    const r = rollAfter(6.2, 30, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(2 * Math.PI);
  });
});
