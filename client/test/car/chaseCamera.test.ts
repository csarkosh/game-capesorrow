import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes, type CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import { newCarPose, type CarPose } from "../../src/game/car/carPose.js";
import { ENTER_TICKS, LEAVE_TICKS } from "../../src/sim/car/tuning.js";
import { ENTERING, FOOT, LEAVING, SEATED } from "../../src/sim/car/types.js";
import { SEAT_RATE, CHASE_RELEASE, BOX_MARGIN, PROP_THIN_HALF, PROP_TOP, boxBlocks, carBlocks, inBox, seatStep, seatTarget, CHASE_AIM, CHASE_BACK, CHASE_FOV, CHASE_MIN, CHASE_UP, newChase, stepChase, type Chase } from "../../src/game/car/chaseCamera.js";

const open = (): boolean => false;
const flat = (): number => 0;
const pose = (): CameraPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });

function carAt(x: number, z: number, hx: number, hz: number, speed = 0, y = 0): CarPose {
  const len = Math.hypot(hx, hz);
  const p = newCarPose();
  Object.assign(p, { id: 1, x, y, z, hx: hx / len, hz: hz / len, speed });
  return p;
}

/** Steps `seconds` of 60 Hz frames, the mouse still, and returns the pose and the last widening. */
function settle(c: Chase, car: CarPose, look: { yaw: number; pitch: number }, seconds: number, eye = pose(), blocked: (x: number, y: number, z: number) => boolean = open, ground: (x: number, z: number) => number = flat): { out: CameraPose; fov: number } {
  const out = pose();
  let fov = 0;
  for (let i = 0; i < Math.round(seconds * 60); i++) fov = stepChase(c, car, look, 1, 1 / 60, blocked, ground, eye, out);
  return { out, fov };
}

const forward = (p: CameraPose): { x: number; y: number; z: number } => {
  const a = cameraAxes(p.yaw, p.pitch, p.roll, restAxes());
  return { x: a.fx, y: a.fy, z: a.fz };
};
const dist = (p: CameraPose, x: number, y: number, z: number): number => Math.hypot(p.x - x, p.y - y, p.z - z);

describe("the chase camera", () => {
  it("settles 6.5 m from the aim and 2.4 m above a car at rest once the mouse has been still 2 s", () => {
    const car = carAt(10, 20, 0, 1, 0, 3);
    const { out } = settle(newChase(), car, { yaw: 1.3, pitch: 0.4 }, 10);
    expect(dist(out, 10, 3 + CHASE_AIM, 20)).toBeCloseTo(CHASE_BACK, 1);
    expect(out.y - car.y).toBeCloseTo(CHASE_UP, 1);
  });

  it("is behind the car, not in front, for headings along every axis and diagonal", () => {
    for (const [hx, hz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [3, -4]] as const) {
      const car = carAt(5, -7, hx, hz);
      const { out } = settle(newChase(), car, { yaw: 2, pitch: 0 }, 10);
      expect((out.x - car.x) * car.hx + (out.z - car.z) * car.hz, `heading ${hx},${hz}`).toBeLessThan(-6);
      // And not off to a side.
      expect((out.x - car.x) * car.hz - (out.z - car.z) * car.hx, `heading ${hx},${hz}`).toBeCloseTo(0, 1);
    }
  });

  it("states the engine's yaw: a car heading +z has the camera at its -z, one heading +x at its -x", () => {
    const alongZ = settle(newChase(), carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 10).out;
    expect(alongZ.z).toBeLessThan(-6);
    expect(Math.abs(alongZ.x)).toBeLessThan(0.1);
    expect(Math.abs(alongZ.yaw)).toBeLessThan(0.01);
    const alongX = settle(newChase(), carAt(0, 0, 1, 0), { yaw: 0, pitch: 0 }, 10).out;
    expect(alongX.x).toBeLessThan(-6);
    expect(alongX.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it("looks at the car: the forward vector, made as the engine makes it, passes near the aim point", () => {
    for (const [hx, hz, yaw, pitch] of [[0, 1, 0, 0], [-1, 1, 4, 0.7], [1, -1, -3, -0.05]] as const) {
      const car = carAt(3, 4, hx, hz, 0, 1);
      const { out } = settle(newChase(), car, { yaw, pitch }, 10);
      const f = forward(out);
      const to = { x: 3 - out.x, y: 1 + CHASE_AIM - out.y, z: 4 - out.z };
      const along = to.x * f.x + to.y * f.y + to.z * f.z;
      expect(along).toBeGreaterThan(5);
      expect(Math.hypot(to.x - f.x * along, to.y - f.y * along, to.z - f.z * along)).toBeLessThan(0.3);
    }
  });

  it("looks at the car even in the first frames, with the mouse turned away from it", () => {
    const car = carAt(0, 0, 0, 1);
    const out = pose();
    stepChase(newChase(), car, { yaw: 2.5, pitch: 0.3 }, 1, 1 / 60, open, flat, pose(), out);
    const f = forward(out);
    const to = { x: -out.x, y: CHASE_AIM - out.y, z: -out.z };
    const along = to.x * f.x + to.y * f.y + to.z * f.z;
    expect(Math.hypot(to.x - f.x * along, to.y - f.y * along, to.z - f.z * along)).toBeLessThan(0.3);
  });

  it("raises the camera when the mouse pitches down and lowers it when it pitches up, as the engine's pitch means", () => {
    const car = carAt(0, 0, 0, 1);
    // Positive pitch looks down: the camera is higher.
    const down = settle(newChase(), car, { yaw: 0, pitch: 0.5 }, 0.5).out;
    const level = settle(newChase(), car, { yaw: 0, pitch: 0 }, 0.5).out;
    const up = settle(newChase(), car, { yaw: 0, pitch: -0.1 }, 0.5).out;
    expect(down.y).toBeGreaterThan(level.y + 1);
    expect(up.y).toBeLessThan(level.y);
    expect(level.y).toBeCloseTo(CHASE_AIM, 1);
  });

  it("holds the pitch to -0.1 and 1.0", () => {
    const car = carAt(0, 0, 0, 1);
    const high = settle(newChase(), car, { yaw: 0, pitch: 1.5 }, 0.5).out;
    expect(high.y).toBeCloseTo(CHASE_AIM + CHASE_BACK * Math.sin(1.0), 1);
    const low = settle(newChase(), car, { yaw: 0, pitch: -1.5 }, 0.5, pose(), open, () => -50).out;
    expect(low.y).toBeCloseTo(CHASE_AIM - CHASE_BACK * Math.sin(0.1), 1);
  });

  it("swings round with the mouse by the same angle, with no jump on the first move", () => {
    const car = carAt(0, 0, 0, 1);
    const c = newChase();
    const before = settle(c, car, { yaw: 0, pitch: 0.14 }, 4).out;
    const out = pose();
    stepChase(c, car, { yaw: 0.6, pitch: 0.14 }, 1, 1 / 60, open, flat, pose(), out);
    // One frame of mouse: the camera has turned by the mouse's angle about the aim point, the biases (settled) are kept.
    expect(out.yaw - before.yaw).toBeCloseTo(0.6, 2);
    const turned = Math.atan2(Math.sin(Math.atan2(out.x, out.z) - Math.atan2(before.x, before.z)), Math.cos(Math.atan2(out.x, out.z) - Math.atan2(before.x, before.z)));
    expect(Math.abs(turned)).toBeCloseTo(0.6, 1);
    expect(Math.abs(Math.hypot(out.x, out.z) - Math.hypot(before.x, before.z))).toBeLessThan(0.05);
    // Still for a moment after: the camera stays where the mouse left it.
    const held = pose();
    stepChase(c, car, { yaw: 0.6, pitch: 0.14 }, 1, 1 / 60, open, flat, pose(), held);
    expect(Math.abs(held.yaw - out.yaw)).toBeLessThan(0.001);
  });

  it("comes round behind the car only after the mouse has been still for 2 s", () => {
    const car = carAt(0, 0, 0, 1);
    const c = newChase();
    const look = { yaw: 1.5, pitch: 0.14 };
    expect(settle(c, car, look, 1.5).out.yaw).toBeCloseTo(1.5, 2);
    expect(settle(c, car, look, 8).out.yaw).toBeCloseTo(0, 1);
  });

  it("turns the shorter way round to the car's yaw", () => {
    const car = carAt(0, 0, 0, 1);
    const out = settle(newChase(), car, { yaw: 3.0 + 2 * Math.PI, pitch: 0.14 }, 10).out;
    // Equal to the car's yaw, 0, modulo a turn.
    expect(Math.sin(out.yaw)).toBeCloseTo(0, 1);
    expect(Math.cos(out.yaw)).toBeCloseTo(1, 1);
  });

  it("is pulled in before a wall between it and the car, 0.3 m short of the first blocked sample", () => {
    const car = carAt(0, 0, 0, 1);
    const wall = (_x: number, _y: number, z: number): boolean => z < -3.2;
    const c = newChase();
    const { out } = settle(c, car, { yaw: 0, pitch: 0 }, 10, pose(), wall);
    const d = dist(out, 0, CHASE_AIM, 0);
    expect(d).toBeLessThan(CHASE_BACK - 2);
    expect(d).toBeGreaterThanOrEqual(CHASE_MIN);
    // The wall lies at z = -3.2; along the line (its pitch is the camera's) that is 3.2 / cos(pitch) from the aim, found to within the bisection's 0.5 / 32 m.
    expect(Math.abs(d + 0.3 - 3.2 / Math.cos(out.pitch))).toBeLessThan(0.03);
    expect(c.back).toBeCloseTo(d, 6);
  });

  it("is never nearer than 1.5 m, even with a wall against the car", () => {
    const car = carAt(0, 0, 0, 1);
    const { out } = settle(newChase(), car, { yaw: 0, pitch: 0 }, 10, pose(), () => true);
    expect(dist(out, 0, CHASE_AIM, 0)).toBeCloseTo(CHASE_MIN, 3);
  });

  it("never goes under the ground", () => {
    const car = carAt(0, 0, 0, 1, 0, 0);
    // The ground rises behind the car to 4 m: the camera would be inside it.
    const hill = (_x: number, z: number): number => (z < -2 ? 4 : 0);
    const { out } = settle(newChase(), car, { yaw: 0, pitch: -0.1 }, 10, pose(), open, hill);
    expect(out.y).toBeGreaterThanOrEqual(4 + 0.4 - 1e-9);
    // And still looks at the car.
    const f = forward(out);
    expect(f.z).toBeGreaterThan(0.5);
    expect(f.y).toBeLessThan(0);
  });

  it("is the walker's eye at seated 0 and the chase at 1", () => {
    const car = carAt(0, 0, 0, 1);
    const eye: CameraPose = { x: 4, y: 1.6, z: -2, yaw: 5.5, pitch: 0.2, roll: 0.05 };
    const c = newChase();
    const out = pose();
    stepChase(c, car, { yaw: 0, pitch: 0.14 }, 0, 1 / 60, open, flat, eye, out);
    expect(out).toEqual(eye);
    const full = settle(newChase(), car, { yaw: 0, pitch: 0.14 }, 10, eye).out;
    expect(full.roll).toBe(0);
    expect(dist(full, 0, CHASE_AIM, 0)).toBeCloseTo(CHASE_BACK, 1);
  });

  it("eases from the eye without a jump: each step of seated moves the pose a little, from the first frame to the last", () => {
    const car = carAt(0, 0, 0, 1);
    const eye: CameraPose = { x: 3, y: 1.6, z: 3, yaw: 2, pitch: 0, roll: 0.02 };
    const c = newChase();
    const last = pose();
    let worst = 0;
    stepChase(c, car, { yaw: 2, pitch: 0 }, 0, 1 / 60, open, flat, eye, last);
    for (let tick = 1; tick <= 60; tick++) {
      const now = pose();
      stepChase(c, car, { yaw: 2, pitch: 0 }, tick / 60, 1 / 60, open, flat, eye, now);
      worst = Math.max(worst, Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z), Math.abs(now.yaw - last.yaw) * 3);
      Object.assign(last, now);
    }
    // The whole way is about 9 m over 60 steps; the steepest step of a smoothstep is 1.5 times the mean.
    expect(worst).toBeLessThan(0.35);
    expect(worst).toBeGreaterThan(0);
  });

  it("has no jump from ENTERING to SEATED: seated reaches 1 as the last tick of entering runs out, and 1 holds", () => {
    const car = carAt(0, 0, 0, 1);
    const eye = pose();
    const a = pose();
    const b = pose();
    const c = newChase();
    stepChase(c, car, { yaw: 0, pitch: 0.14 }, 59 / 60, 1 / 60, open, flat, eye, a);
    stepChase(c, car, { yaw: 0, pitch: 0.14 }, 1, 1 / 60, open, flat, eye, b);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.05);
  });

  it("answers a lens wider by 0.12 rad at 30 m/s and no more", () => {
    const at = (speed: number): number => settle(newChase(), carAt(0, 0, 0, 1, speed), { yaw: 0, pitch: 0 }, 0.2).fov;
    expect(at(0)).toBe(0);
    expect(at(15)).toBeCloseTo(CHASE_FOV / 2, 6);
    expect(at(30)).toBeCloseTo(CHASE_FOV, 6);
    expect(at(80)).toBeCloseTo(CHASE_FOV, 6);
    expect(at(-30)).toBeCloseTo(CHASE_FOV, 6);
  });

  it("leaves roll 0 and every number finite for a frame time of 0, of 2 s, and of NaN", () => {
    for (const dt of [0, 2, -1, NaN, Infinity]) {
      const c = newChase();
      const out = pose();
      const fov = stepChase(c, carAt(1, 2, 0.6, 0.8, 12), { yaw: 1, pitch: 0.2 }, 1, dt, open, flat, pose(), out);
      for (const v of [out.x, out.y, out.z, out.yaw, out.pitch, fov, c.tx, c.yawBias, c.pitchBias, c.idle]) expect(Number.isFinite(v), `dt ${dt}`).toBe(true);
      expect(out.roll).toBe(0);
    }
  });

  it("writes no NaN for a heading of zero length or a camera on the aim point", () => {
    const out = pose();
    stepChase(newChase(), carAt(0, 0, 0, 1), { yaw: 0.3, pitch: 0.1 }, 1, 1 / 60, open, flat, pose(), out);
    const dead = newCarPose();
    Object.assign(dead, { x: 2, y: 0, z: 2, hx: 0, hz: 0 });
    const c = newChase();
    stepChase(c, dead, { yaw: 0.3, pitch: 0.1 }, 1, 1 / 60, open, flat, pose(), out);
    for (let i = 0; i < 200; i++) stepChase(c, dead, { yaw: 0.3, pitch: 0.1 }, 1, 1 / 60, open, flat, pose(), out);
    for (const v of [out.x, out.y, out.z, out.yaw, out.pitch]) expect(Number.isFinite(v)).toBe(true);
    // Heading unknown: the camera keeps the mouse's own yaw.
    expect(out.yaw).toBeCloseTo(0.3, 1);
  });

  it("follows the car with a lag, and snaps to it where the car jumps by more than a few metres", () => {
    const c = newChase();
    const out = pose();
    stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), out);
    stepChase(c, carAt(1, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), out);
    expect(c.tx).toBeGreaterThan(0);
    expect(c.tx).toBeLessThan(0.5);
    stepChase(c, carAt(900, -400, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), out);
    expect(c.tx).toBe(900);
    expect(c.tz).toBe(-400);
    expect(Math.hypot(out.x - 900, out.z + 400)).toBeLessThan(10);
  });

  it("starts from the car when the chase is new, and again once started is cleared", () => {
    const c = newChase();
    const out = pose();
    stepChase(c, carAt(50, 60, 0, 1), { yaw: 0, pitch: 0 }, 0.5, 1 / 60, open, flat, pose(), out);
    expect([c.tx, c.tz, c.started]).toEqual([50, 60, true]);
    c.started = false;
    stepChase(c, carAt(51, 61, 0, 1), { yaw: 0, pitch: 0 }, 0.5, 1 / 60, open, flat, pose(), out);
    expect([c.tx, c.tz]).toEqual([51, 61]);
  });

  it("adds no field to the chase record as it steps", () => {
    const c = newChase();
    const keys = Object.keys(c).sort();
    stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), pose());
    expect(Object.keys(c).sort()).toEqual(keys);
  });
});

describe("how far into the seat the camera is", () => {
  it("maps the ride's phase and ticks (counting down) to the target", () => {
    expect(seatTarget(FOOT, 0)).toBe(0);
    expect(seatTarget(SEATED, 0)).toBe(1);
    expect(seatTarget(ENTERING, ENTER_TICKS)).toBe(0);
    expect(seatTarget(ENTERING, 1)).toBeCloseTo(1 - 1 / ENTER_TICKS, 9);
    expect(seatTarget(ENTERING, 0)).toBe(1);
    expect(seatTarget(LEAVING, LEAVE_TICKS)).toBe(1);
    expect(seatTarget(LEAVING, 1)).toBeCloseTo(1 / LEAVE_TICKS, 9);
    expect(seatTarget(LEAVING, 0)).toBe(0);
    let last = -1;
    for (let t = ENTER_TICKS; t >= 0; t--) { const v = seatTarget(ENTERING, t); expect(v).toBeGreaterThan(last); last = v; }
    last = 2;
    for (let t = LEAVE_TICKS; t >= 0; t--) { const v = seatTarget(LEAVING, t); expect(v).toBeLessThan(last); last = v; }
  });

  it("follows plain entering and leaving exactly, from exactly 0 to exactly 1 and back", () => {
    let shown = 0;
    for (let t = ENTER_TICKS; t >= 0; t--) {
      shown = seatStep(shown, seatTarget(ENTERING, t), 1 / 60);
      expect(shown).toBe(seatTarget(ENTERING, t));
    }
    shown = seatStep(shown, seatTarget(SEATED, 0), 1 / 60);
    expect(shown).toBe(1);
    for (let t = LEAVE_TICKS; t >= 0; t--) {
      shown = seatStep(shown, seatTarget(LEAVING, t), 1 / 60);
      expect(shown).toBe(seatTarget(LEAVING, t));
    }
    expect(shown).toBe(0);
  });

  it("eases back out when a leave is refused: no frame moves it far, and it arrives at 1", () => {
    let shown = 1;
    for (let t = LEAVE_TICKS; t >= 1; t--) shown = seatStep(shown, seatTarget(LEAVING, t), 1 / 60);
    expect(shown).toBeCloseTo(1 / LEAVE_TICKS, 9);
    let frames = 0;
    while (shown < 1 && frames < 100) {
      const next = seatStep(shown, seatTarget(SEATED, 0), 1 / 60);
      expect(next - shown).toBeLessThanOrEqual(SEAT_RATE / 60 + 1e-12);
      shown = next;
      frames++;
    }
    expect(shown).toBe(1);
    expect(frames).toBeGreaterThan(10);
  });

  it("lands on the target after a long frame, without passing it", () => {
    expect(seatStep(0, 1, 2)).toBe(1);
    expect(seatStep(1, 0, 2)).toBe(0);
    expect(seatStep(0.5, 0.5, 2)).toBe(0.5);
    expect(seatStep(0.3, 1, 0)).toBe(0.3);
    expect(seatStep(0.3, 1, NaN)).toBe(0.3);
  });
});

describe("what stops the camera besides walls", () => {
  // One box at (10, 10) turned to face +x: 2.4 long and 1 across (half 1.2 and 0.5), as a parked pickup's; one pole 0.1 across beside it.
  const rects = new Float64Array([10, 10, 1, 0, 1.2, 0.5, 20, 10, 1, 0, 0.05, 0.05]);
  const grid = { x0: 0, z0: 0, cols: 2, rows: 2, start: Int32Array.from([0, 1, 2, 2, 2]), list: Int32Array.from([0, 1]), rects };
  const over = 0 + PROP_TOP;

  it("blocks a sample inside a parked vehicle's box and not one beside it", () => {
    expect(boxBlocks(grid, 10.5, 1, 10.2, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(true);
    expect(boxBlocks(grid, 10, 1, 11.0, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
    expect(boxBlocks(grid, 12, 1, 10, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
  });

  it("turns the box: along its axis it is long, across it short", () => {
    expect(inBox(rects, 0, 11.1, 10, 0)).toBe(true);
    expect(inBox(rects, 0, 10, 10.6, 0)).toBe(false);
    const turned = new Float64Array([10, 10, 0, 1, 1.2, 0.5]);
    expect(inBox(turned, 0, 10, 11.1, 0)).toBe(true);
    expect(inBox(turned, 0, 11.1, 10, 0)).toBe(false);
  });

  it("lets a sample above the vehicle's top through", () => {
    expect(boxBlocks(grid, 10, PROP_TOP + 0.01, 10, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
    expect(boxBlocks(grid, 10, 2.4, 10, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(true);
    // The resting camera, 2.4 m over a car, with the ground 1 m lower there (a street climbing 15 percent), is well inside the column.
    expect(boxBlocks(grid, 10, 2.4, 10, PROP_THIN_HALF, -1 + PROP_TOP, BOX_MARGIN)).toBe(true);
    expect(PROP_TOP - 2.4 - 1).toBeGreaterThanOrEqual(0.5);
  });

  it("lets the camera through a thin prop, a pole or a post, a smaller half-extent under 0.3 m", () => {
    expect(boxBlocks(grid, 20, 1, 10, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
    // The same box counts for a building (thin 0).
    expect(boxBlocks(grid, 20, 1, 10, 0, Infinity, BOX_MARGIN)).toBe(true);
  });

  it("answers false outside the grid", () => {
    expect(boxBlocks(grid, -50, 1, 10, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
    expect(boxBlocks(grid, 10, 1, 500, PROP_THIN_HALF, over, BOX_MARGIN)).toBe(false);
  });

  it("blocks inside another car's footprint up to its roof and not above it, and never the car it follows", () => {
    const cars = [{ id: 1, x: 0, y: 0, z: 0, hx: 0, hz: 1 }, { id: 2, x: 30, y: 2, z: 5, hx: 1, hz: 0 }];
    expect(carBlocks(cars, 1, 30 + 2, 2.5, 5)).toBe(true);
    expect(carBlocks(cars, 1, 30 + 3, 2.5, 5)).toBe(false);
    expect(carBlocks(cars, 1, 30, 2 + 1.4 + 0.3, 5)).toBe(false);
    expect(carBlocks(cars, 1, 30, 2.5, 5 + 1.2)).toBe(false);
    expect(carBlocks(cars, 1, 0, 0.5, 0)).toBe(false);
    expect(carBlocks(cars, 2, 0, 0.5, 0)).toBe(true);
  });

  it("pulls the chase in before a vehicle, and reports how far it stands", () => {
    const car = carAt(0, 0, 0, 1);
    const c = newChase();
    const truck = (x: number, y: number, z: number): boolean => boxBlocks({ ...grid, rects: new Float64Array([0, -4, 1, 0, 1.2, 0.5]), x0: -16, z0: -16, cols: 2, rows: 2, start: Int32Array.from([0, 0, 1, 1, 1]), list: Int32Array.from([0]) }, x, y, z, PROP_THIN_HALF, PROP_TOP, BOX_MARGIN);
    const { out } = settle(c, car, { yaw: 0, pitch: 0 }, 10, pose(), truck);
    expect(c.back).toBeLessThan(CHASE_BACK - 1);
    expect(dist(out, 0, CHASE_AIM, 0)).toBeCloseTo(c.back, 3);
    expect(settle(newChase(), car, { yaw: 0, pitch: 0 }, 10).out).toBeDefined();
    const clear = newChase();
    settle(clear, car, { yaw: 0, pitch: 0 }, 1);
    expect(clear.back).toBe(CHASE_BACK);
  });
});

describe("the pulled-in distance", () => {
  
  it("half-extent line: a 0.42 m pole passes, a 0.7 m bin blocks", () => {
    const mk = (half: number): Parameters<typeof boxBlocks>[0] => ({ x0: 0, z0: 0, cols: 1, rows: 1, start: Int32Array.from([0, 1]), list: Int32Array.from([0]), rects: new Float64Array([5, 5, 1, 0, half, half]) });
    expect(boxBlocks(mk(0.21), 5, 1, 5, PROP_THIN_HALF, 4, BOX_MARGIN)).toBe(false);
    expect(boxBlocks(mk(0.35), 5, 1, 5, PROP_THIN_HALF, 4, BOX_MARGIN)).toBe(true);
    expect(boxBlocks(mk(0.29), 5, 1, 5, PROP_THIN_HALF, 4, BOX_MARGIN)).toBe(false);
    expect(boxBlocks(mk(0.31), 5, 1, 5, PROP_THIN_HALF, 4, BOX_MARGIN)).toBe(true);
  });

  it("goes in by the swept distance at once, refined finer than the 0.5 m samples, and out at the release rate", () => {
    // A wall across the line at z = -3.3: the swept distance is within 0.04 m of 3.3 - 0.3 (five halvings of 0.5 m).
    const c = newChase();
    const car = carAt(0, 0, 0, 1);
    const out = pose();
    const wall = (_x: number, _y: number, z: number): boolean => z < -3.3;
    stepChase(c, car, { yaw: 0, pitch: 0 }, 1, 1 / 60, wall, flat, pose(), out);
    expect(c.back).toBeLessThan(3.1);
    expect(c.back).toBeGreaterThan(2.9);
    const taken = c.back;
    stepChase(c, car, { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), out);
    expect(c.back - taken).toBeCloseTo(CHASE_RELEASE / 60, 9);
  });

  it("backing toward a box: goes in by small steps as it comes into the line, never longer than the swept distance, out no faster than the release, full again after", () => {
    // The car reverses along +z (heading -z, so the camera is on its +z side) toward a box at z 30 to 35 and through it.
    const c = newChase();
    const out = pose();
    const look = { yaw: Math.PI, pitch: 0.14 };
    const inBox = (x: number, _y: number, z: number): boolean => Math.abs(x) < 0.5 && z > 30 && z < 35;
    let last = CHASE_BACK;
    let fastestIn = 0;
    let slowestOut = 0;
    let sawPulled = false;
    for (let f = 0; f < 700; f++) {
      const car = carAt(0, f * 0.1, 0, -1);
      stepChase(c, car, look, 1, 1 / 60, inBox, flat, pose(), out);
      const exact = Math.max(CHASE_MIN, (30 - c.tz) / Math.cos(0.14) - 0.3);
      if (c.tz < 30 && exact + 0.3 <= CHASE_BACK - 0.05) expect(c.back).toBeLessThanOrEqual(exact + 0.04);
      expect(c.back).toBeLessThanOrEqual(CHASE_BACK);
      expect(c.back - last).toBeLessThanOrEqual(CHASE_RELEASE / 60 + 1e-9);
      if (c.tz < 28) fastestIn = Math.min(fastestIn, c.back - last);
      slowestOut = Math.max(slowestOut, c.back - last);
      if (c.back < CHASE_BACK - 0.1) sawPulled = true;
      last = c.back;
    }
    expect(sawPulled).toBe(true);
    // The box enters the line at 0.1 m a frame; the first frame it is met the camera goes in by the 0.3 m it stops short and the 0.1 m it moved, and
    // after that by 0.1 a frame: not a jump of three metres.
    expect(fastestIn).toBeGreaterThan(-0.45);
    expect(slowestOut).toBeGreaterThan(0);
    expect(last).toBe(CHASE_BACK);
  });

  it("does not pump between two far values when a box is in the line on alternate frames", () => {
    const c = newChase();
    const out = pose();
    const seen: number[] = [];
    for (let f = 0; f < 120; f++) {
      const on = f % 2 === 0;
      stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, (_x, _y, z) => on && z < -3.3, flat, pose(), out);
      if (f > 2) seen.push(c.back);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(0.2);
  });

  it("is finite and sane for dt 0 and 2 s", () => {
    for (const dt of [0, 2]) {
      const c = newChase();
      const out = pose();
      const wall = (_x: number, _y: number, z: number): boolean => z < -3.3;
      stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, dt, wall, flat, pose(), out);
      stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, dt, open, flat, pose(), out);
      expect(Number.isFinite(c.back)).toBe(true);
      expect(c.back).toBeGreaterThanOrEqual(CHASE_MIN);
      expect(c.back).toBeLessThanOrEqual(CHASE_BACK);
      expect(dt === 0 ? c.back < 3.1 : c.back === CHASE_BACK).toBe(true);
    }
  });

  it("starts at the full distance and again after the chase is started over or the car jumps", () => {
    const c = newChase();
    expect(c.back).toBe(CHASE_BACK);
    const out = pose();
    stepChase(c, carAt(0, 0, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, (_x, _y, z) => z < -3.3, flat, pose(), out);
    expect(c.back).toBeLessThan(3.1);
    stepChase(c, carAt(500, 500, 0, 1), { yaw: 0, pitch: 0 }, 1, 1 / 60, open, flat, pose(), out);
    expect(c.back).toBe(CHASE_BACK);
  });
});
