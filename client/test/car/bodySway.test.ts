import { describe, expect, it } from "vitest";
import { HEAVE_MOST, PITCH_MOST, PITCH_PER, ROLL_MOST, ROLL_PER, newSway, stepSway, swayMatrix, type Sway } from "../../src/game/car/bodySway.js";
import { newCarPose, type CarPose } from "../../src/game/car/carPose.js";

const DT = 1 / 60;

/** A car heading +z at the origin: its right is +x. */
function car(over: Partial<CarPose> = {}): CarPose {
  return Object.assign(newCarPose(), { id: 1, x: 0, y: 0, z: 0, hx: 0, hz: 1, speed: 0, slip: 0 }, over);
}

/** Steps `seconds` of frames; `at(t)` gives the car at each. */
function run(s: Sway, seconds: number, at: (t: number) => CarPose, each?: (s: Sway, t: number) => void): void {
  for (let i = 0; i <= Math.round(seconds / DT); i++) {
    stepSway(s, at(i * DT), DT);
    each?.(s, i * DT);
  }
}

/** A matrix with the car's nose along +x, its up +y and its left +z, at a place. */
function upright(x = 0, y = 0, z = 0): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
const at = (m: Float32Array, x: number, y: number, z: number): [number, number, number] => [
  (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
  (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
  (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
];

describe("the body on its springs", () => {
  it("rests level on a car that stands, and on one that holds its speed in a straight line", () => {
    const s = newSway();
    run(s, 3, () => car());
    expect([s.roll, s.pitch, s.heave]).toEqual([0, 0, 0]);
    run(s, 3, (t) => car({ z: 10 * t, speed: 10 }));
    expect(Math.abs(s.roll)).toBeLessThan(1e-6);
    expect(Math.abs(s.pitch)).toBeLessThan(1e-3);
  });

  it("dips its nose under the brake and lifts it under the engine, by the acceleration", () => {
    const braking = newSway();
    run(braking, 2, (t) => car({ speed: 30 - 9 * t }));
    expect(braking.pitch).toBeCloseTo(-PITCH_PER * 9, 3);
    const pulling = newSway();
    run(pulling, 2, (t) => car({ speed: 6 * t }));
    expect(pulling.pitch).toBeCloseTo(PITCH_PER * 6, 3);
  });

  it("leans out of a turn: to the left in a right turn, to the right in a left", () => {
    // A circle at 10 m/s turning 0.8 rad/s to the right (the heading turns toward +x): 8 m/s² toward the right.
    const turn = (rate: number): Sway => {
      const s = newSway();
      run(s, 3, (t) => car({ hx: Math.sin(rate * t), hz: Math.cos(rate * t), speed: 10 }));
      return s;
    };
    expect(turn(0.8).roll).toBeCloseTo(-ROLL_PER * 8, 2);
    expect(turn(-0.8).roll).toBeCloseTo(ROLL_PER * 8, 2);
    expect(Math.abs(turn(0.8).pitch)).toBeLessThan(2e-3);
  });

  it("leans as a slide is caught: the tyres' bite is felt though the heading holds", () => {
    // Sliding to the left at 6 m/s, the slide dying at 6 m/s²: the pull is to the right, so the body leans left.
    const s = newSway();
    let most = 0;
    run(s, 1, (t) => car({ speed: 10, slip: Math.min(0, -6 + 6 * t) }), (now) => { most = Math.min(most, now.roll); });
    expect(most).toBeLessThan(-ROLL_PER * 4);
  });

  it("goes past where it will rest and comes back: a car that stops short nods", () => {
    const s = newSway();
    // Braking at 9 m/s² from 9 m/s, then at rest.
    let low = 0;
    let high = 0;
    run(s, 4, (t) => car({ speed: Math.max(0, 9 - 9 * t) }), (now, t) => {
      low = Math.min(low, now.pitch);
      if (t > 1) high = Math.max(high, now.pitch);
    });
    // Dipped past the steady dip on the way in, and lifted past level once the car had stopped.
    expect(low).toBeLessThan(-PITCH_PER * 9 * 1.05);
    expect(high).toBeGreaterThan(PITCH_PER * 9 * 0.1);
    // And at rest again in the end.
    expect(Math.abs(s.pitch)).toBeLessThan(1e-3);
  });

  it("lurches at a hit, more than the hardest braking dips it, and within what the body has room for", () => {
    const s = newSway();
    run(s, 1, () => car({ speed: 9 }));
    let low = 0;
    run(s, 1.5, () => car({ speed: 0 }), (now) => { low = Math.min(low, now.pitch); });
    // Braking at the brake's 9 m/s² holds a dip of `PITCH_PER * 9`; a wall met at 9 m/s throws the nose down half as far again at least.
    expect(low).toBeLessThan(-PITCH_PER * 9 * 1.5);
    expect(low).toBeGreaterThanOrEqual(-PITCH_MOST);
    // A hit from the side rolls it.
    const side = newSway();
    run(side, 1, () => car({ speed: 0, slip: 8 }));
    let most = 0;
    run(side, 1.5, () => car({ speed: 0, slip: 0 }), (now) => { most = Math.max(most, Math.abs(now.roll)); });
    expect(most).toBeGreaterThan(ROLL_PER * 6);
    expect(most).toBeLessThanOrEqual(ROLL_MOST);
  });

  it("is carried over a kerb after its wheels: it stays down as they rise, comes up past them, and settles on them", () => {
    const s = newSway();
    run(s, 1, () => car({ speed: 3 }));
    // The wheels' plane rises 0.1 m over a tenth of a second.
    let low = 0;
    let high = 0;
    run(s, 3, (t) => car({ speed: 3, y: Math.min(0.1, t) }), (now) => {
      low = Math.min(low, now.heave);
      high = Math.max(high, now.heave);
    });
    expect(low).toBeLessThan(-0.02);
    expect(low).toBeGreaterThanOrEqual(-HEAVE_MOST);
    expect(high).toBeGreaterThan(0.002);
    expect(Math.abs(s.heave)).toBeLessThan(1e-3);
  });

  it("holds no sag on a steady climb", () => {
    const s = newSway();
    run(s, 4, (t) => car({ speed: 10, z: 10 * t, y: 1.5 * t }));
    expect(Math.abs(s.heave)).toBeLessThan(2e-3);
  });

  it("rests when the car is put somewhere, instead of taking the jump for a hit", () => {
    const s = newSway();
    run(s, 2, (t) => car({ speed: 30 - 9 * t }));
    expect(s.pitch).not.toBe(0);
    stepSway(s, car({ x: 500, z: -300, speed: 0 }), DT);
    expect([s.roll, s.rollV, s.pitch, s.pitchV, s.heave, s.heaveV]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("stays finite and within its limits for a frame of 0 s, of 2 s, and of no number, and for a car that is no number", () => {
    for (const dt of [0, 2, -1, NaN, Infinity]) {
      const s = newSway();
      stepSway(s, car({ speed: 10 }), 1 / 60);
      stepSway(s, car({ speed: 0, slip: 9, y: 0.5 }), dt);
      stepSway(s, car({ speed: NaN, slip: NaN, y: NaN }), 1 / 60);
      stepSway(s, car({ speed: 5 }), 1 / 60);
      for (const v of [s.roll, s.rollV, s.pitch, s.pitchV, s.heave, s.heaveV]) expect(Number.isFinite(v), `dt ${dt}`).toBe(true);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(ROLL_MOST);
      expect(Math.abs(s.pitch)).toBeLessThanOrEqual(PITCH_MOST);
      expect(Math.abs(s.heave)).toBeLessThanOrEqual(HEAVE_MOST);
    }
  });

  it("moves the same at 30 frames a second as at 120", () => {
    const peak = (dt: number): number => {
      const s = newSway();
      let low = 0;
      for (let t = 0; t < 3; t += dt) {
        stepSway(s, car({ speed: Math.max(0, 9 - 9 * t) }), dt);
        low = Math.min(low, s.pitch);
      }
      return low;
    };
    expect(peak(1 / 30)).toBeCloseTo(peak(1 / 120), 2);
  });
});

describe("the body's matrix", () => {
  it("is the car's own when the body rests", () => {
    const body = upright(3, 1, -2);
    const out = new Float32Array(16);
    swayMatrix(body, newSway(), out, 0);
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(body[i] as number, 6);
  });

  it("lowers the right side for a lean to the right, and lifts the nose for a positive pitch", () => {
    const out = new Float32Array(16);
    swayMatrix(upright(), Object.assign(newSway(), { roll: 0.1 }), out, 0);
    // The model's left is +z, so its right is -z.
    expect(at(out, 0, 1, -0.9)[1]).toBeLessThan(1);
    expect(at(out, 0, 1, 0.9)[1]).toBeGreaterThan(1);
    swayMatrix(upright(), Object.assign(newSway(), { pitch: 0.05 }), out, 0);
    expect(at(out, 2, 0.5, 0)[1]).toBeGreaterThan(0.5);
    expect(at(out, -2, 0.5, 0)[1]).toBeLessThan(0.5);
  });

  it("turns the body about the axles' height midway between them, so the wheels' arches stay over the wheels", () => {
    const out = new Float32Array(16);
    swayMatrix(upright(), Object.assign(newSway(), { roll: 0.1, pitch: -0.06 }), out, 0);
    const pivot = at(out, 0.108, 0.32, 0);
    expect(pivot[0]).toBeCloseTo(0.108, 5);
    expect(pivot[1]).toBeCloseTo(0.32, 5);
    expect(pivot[2]).toBeCloseTo(0, 5);
  });

  it("raises everything by the heave, keeps its axes unit and square, and writes at the offset it is given", () => {
    const out = new Float32Array(32).fill(7);
    swayMatrix(upright(1, 2, 3), Object.assign(newSway(), { roll: -0.07, pitch: 0.04, heave: 0.05 }), out, 16);
    for (let i = 0; i < 16; i++) expect(out[i]).toBe(7);
    const m = out.subarray(16);
    const col = (k: number): [number, number, number] => [m[k * 4] as number, m[k * 4 + 1] as number, m[k * 4 + 2] as number];
    const dot = (a: readonly number[], b: readonly number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
    for (let k = 0; k < 3; k++) expect(dot(col(k), col(k))).toBeCloseTo(1, 6);
    expect(dot(col(0), col(1))).toBeCloseTo(0, 6);
    expect(dot(col(0), col(2))).toBeCloseTo(0, 6);
    expect(dot(col(1), col(2))).toBeCloseTo(0, 6);
    expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    // The pivot is lifted by the heave and nothing else.
    const lifted = new Float32Array(m);
    expect(at(lifted, 0.108, 0.32, 0)[1]).toBeCloseTo(2 + 0.32 + 0.05, 5);
  });
});
