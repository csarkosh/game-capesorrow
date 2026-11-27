/**
 * The cinematic view of a drive: while it is on, the camera is no longer the chase behind the car but a run of shots, cut from one to the
 * next, each of which shows the car going by. Pure arithmetic over records, as `chaseCamera.ts` is: `townParts.ts` calls `stepCine` from the
 * renderer's `shot` in the chase's place and writes nothing else. It reads the same `blocked` the chase is stopped by, so no shot stands in a
 * building, a parked vehicle or the ground, and none looks at the car through one.
 *
 * **The shots.**
 * - `ROADSIDE`: a camera that stands still beside the road ahead of the car, low or at head height or on a pole, turns to follow the car
 *   and holds it at one size in the frame by its lens (long while the car is far, wide as it passes). It ends when the car has gone by and
 *   away, when something has stood between it and the car for `LOST_FOR` seconds, or after `ROADSIDE_SECONDS`.
 * - `WHEEL`: fixed to the car, low beside a front wheel, looking forward along the car's side at the road coming.
 * - `NOSE`: fixed to the car, ahead of it and to one side, looking back at it.
 * - `HIGH`: above and behind the car, following it with a lag, looking down. Buildings are columns to the sky for the camera, so in a
 *   street between them this shot does not stand and another is taken; it is the open road's.
 * - `ORBIT`: for a car that stands or crawls, a slow turn round it.
 * - `TAIL`: fixed to the car, low behind it. It is drawn in toward the car by whatever stands behind, as the chase is, so it always stands:
 *   it is the shot taken when no other does.
 *
 * **The cut.** A shot ends by its own rule or its time; the next is the first of a fixed round (a roadside shot between each of the
 * others) that stands, tried in order, each with a side and a height drawn from the count of cuts so far, so the run is the same for the
 * same drive and never the same shot twice running. A cut is a cut: nothing is eased between two shots.
 *
 * Nothing is allocated and nothing is thrown, whatever `dt` is.
 */
import { EYE_SNAP_M } from "@csarkosh/engine/game/eyeBlend";
import type { CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import { AXLE_FRONT } from "../../sim/car/tuning.js";
import type { CarPose } from "./carPose.js";

export const NO_SHOT = 0, ROADSIDE = 1, WHEEL = 2, NOSE = 3, HIGH = 4, ORBIT = 5, TAIL = 6;

/** The round the shots are taken in while the car moves: a roadside shot between each of the others. */
const ROUND: readonly number[] = [ROADSIDE, WHEEL, ROADSIDE, HIGH, ROADSIDE, NOSE];

/** How long each shot is held at most, seconds, and the least any is held before a lost sight of the car may cut it. */
export const ROADSIDE_SECONDS = 7, FIXED_SECONDS = 4, HIGH_SECONDS = 6, ORBIT_SECONDS = 9, HOLD_LEAST = 0.9;
/** How long the car may be out of a shot's sight before the cut, seconds. */
export const LOST_FOR = 0.3;
/** The speed over the ground (m/s) under which the car is taken to stand (the orbit's), and over which an orbit is left. */
export const STANDS_UNDER = 1.5, MOVES_OVER = 3;

/** The roadside camera: how far ahead of the car it stands is `AHEAD_BASE` metres and `AHEAD_PER` seconds of the car's travel, held to `AHEAD_MOST`. */
const AHEAD_BASE = 12, AHEAD_PER = 1.5, AHEAD_MOST = 60;
/** How far to the side of the car's line it stands (tried in this order), and how high over the ground (one is drawn a cut). */
const ROADSIDE_ASIDE: readonly number[] = [6, 3.6, 2.3];
const ROADSIDE_UP: readonly number[] = [1.5, 0.45, 3.2];
/** The roadside lens holds this half-width of the world at the car (m), within these angles (rad). */
const FRAME_HALF = 5.5, LENS_LONG = 0.3, LENS_WIDE = 1.0;
/** Once the car has passed, the roadside shot ends when it is this far off (m); and it ends at any time past this (m). */
const GONE_BY = 26, TOO_FAR = 75;

/** The shots fixed to the car, as places in its frame (m along the heading, to its right, up) for the camera and for what it looks at, and their lens (rad). */
type Fixed = { along: number; aside: number; up: number; toAlong: number; toAside: number; toUp: number; fov: number };
const WHEEL_SHOT: Fixed = { along: AXLE_FRONT - 2.7, aside: 1.5, up: 0.42, toAlong: AXLE_FRONT + 7, toAside: 0.9, toUp: 0.55, fov: 1.15 };
const NOSE_SHOT: Fixed = { along: 5.4, aside: 2.1, up: 0.85, toAlong: 0.4, toAside: 0, toUp: 0.8, fov: 0.9 };
const TAIL_SHOT: Fixed = { along: -4.4, aside: 0.9, up: 0.75, toAlong: 1.5, toAside: 0, toUp: 0.9, fov: 1.05 };

/** The high shot: how far behind the car's travel, to the side and up it stands (m), how fast it closes on that place (per second), and its lens. */
const HIGH_BACK = 12, HIGH_ASIDE = 5, HIGH_UP = 9.5, HIGH_LAG = 1.6, HIGH_FOV = 0.7;
/** The orbit: its distance (m), its height over the car (m), its turn (rad/s) and its lens. */
const ORBIT_BACK = 6.5, ORBIT_UP = 1.5, ORBIT_TURN = 0.22, ORBIT_FOV = 0.85;

/** What every shot looks at: this far over the car's place (m). */
const AIM_UP = 0.9;
/** The sight line is tested this often (m), from this far off the car (m, its own body is not in the way); the camera stays this far over the ground (m). */
const SIGHT_STEP = 1.25, SIGHT_NEAR = 2.6, GROUND_CLEAR = 0.3;
/** A drawn-in camera stops this short of what it met, and comes no nearer the car than this (m). */
const SHORT = 0.3, NEAREST = 1.6;
const DT_MAX = 1;

export type Cine = {
  /** The shot being held (`NO_SHOT` before the first), its age in seconds, and how many cuts there have been. */
  shot: number; age: number; cuts: number;
  /** Where the camera stands (a roadside shot's fixed place; the high shot's eased one). */
  px: number; py: number; pz: number;
  /** The side the shot was taken on (1 the car's right, -1 its left), and the orbit's angle (rad). */
  side: number; turn: number;
  /** How long the car has been out of sight, seconds; whether it has been nearer than it is now (it has passed); the nearest it has been (m). */
  lost: number; nearest: number;
  /** Where the car was at the last step, to tell a car that was put somewhere. */
  cx: number; cy: number; cz: number;
};

export function newCine(): Cine {
  return { shot: NO_SHOT, age: 0, cuts: 0, px: 0, py: 0, pz: 0, side: 1, turn: 0, lost: 0, nearest: Infinity, cx: 0, cy: 0, cz: 0 };
}

/** A number from 0 to 1 drawn from the count of cuts and a salt: the same for the same count. */
function draw(cuts: number, salt: number): number {
  const v = Math.sin(cuts * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function sane(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

type Blocked = (x: number, y: number, z: number) => boolean;
type Ground = (x: number, z: number) => number;

/** Whether the car can be seen from (x, y, z): nothing stands on the line to the point `AIM_UP` over it, up to `SIGHT_NEAR` from the car. */
function sees(car: CarPose, x: number, y: number, z: number, blocked: Blocked): boolean {
  const ax = car.x;
  const ay = car.y + AIM_UP;
  const az = car.z;
  const dx = ax - x;
  const dy = ay - y;
  const dz = az - z;
  const far = Math.hypot(dx, dy, dz);
  if (!(far > 1e-6)) return true;
  for (let d = 0; d < far - SIGHT_NEAR; d += SIGHT_STEP) {
    const t = d / far;
    if (blocked(x + dx * t, y + dy * t, z + dz * t)) return false;
  }
  return true;
}

/** The car's direction of travel in plan, a unit vector: its velocity's where it moves, its heading's where it stands. */
const WAY = { x: 0, z: 1 };
function wayOf(car: CarPose): void {
  const vx = car.hx * car.speed + car.hz * car.slip;
  const vz = car.hz * car.speed - car.hx * car.slip;
  const v = Math.hypot(vx, vz);
  if (v > STANDS_UNDER) {
    WAY.x = vx / v;
    WAY.z = vz / v;
    return;
  }
  const h = Math.hypot(car.hx, car.hz);
  WAY.x = h > 1e-6 ? car.hx / h : 0;
  WAY.z = h > 1e-6 ? car.hz / h : 1;
}

/** Writes `out` as a camera at (x, y, z) looking at (tx, ty, tz), by the engine's conventions (yaw 0 faces +z and grows toward +x; positive pitch looks down). */
function lookFrom(x: number, y: number, z: number, tx: number, ty: number, tz: number, out: CameraPose): void {
  const dx = tx - x;
  const dy = ty - y;
  const dz = tz - z;
  const run = Math.hypot(dx, dz);
  const far = Math.hypot(run, dy);
  out.x = x;
  out.y = y;
  out.z = z;
  out.yaw = run > 1e-6 ? Math.atan2(dx, dz) : 0;
  out.pitch = far > 1e-6 ? Math.asin(Math.min(1, Math.max(-1, -dy / far))) : 0;
  out.roll = 0;
}

/** A place in the car's frame, in the world: `along` its heading, `aside` to its right ((hz, -hx)), `up` over its place. */
const SPOT = { x: 0, y: 0, z: 0 };
function spot(car: CarPose, along: number, aside: number, up: number): void {
  SPOT.x = car.x + car.hx * along + car.hz * aside;
  SPOT.y = car.y + up;
  SPOT.z = car.z + car.hz * along - car.hx * aside;
}

/** Tries to stand a roadside camera for this cut. Answers whether one stands; `c.px`, `c.py`, `c.pz` and `c.side` are then its place. */
function standRoadside(c: Cine, car: CarPose, blocked: Blocked, groundAt: Ground): boolean {
  wayOf(car);
  const speed = Math.hypot(car.speed, car.slip);
  const far = Math.min(AHEAD_BASE + AHEAD_PER * speed, AHEAD_MOST);
  const first = draw(c.cuts, 1) < 0.5 ? 1 : -1;
  const up = ROADSIDE_UP[Math.floor(draw(c.cuts, 2) * ROADSIDE_UP.length) % ROADSIDE_UP.length] as number;
  for (let reach = 0; reach < 2; reach++) {
    const ahead = reach === 0 ? far : far * 0.55;
    for (let k = 0; k < ROADSIDE_ASIDE.length; k++) {
      const aside = ROADSIDE_ASIDE[k] as number;
      for (let turn = 0; turn < 2; turn++) {
        const side = turn === 0 ? first : -first;
        // The right of the way is (z, -x).
        const x = car.x + WAY.x * ahead + WAY.z * aside * side;
        const z = car.z + WAY.z * ahead - WAY.x * aside * side;
        const ground = groundAt(x, z);
        if (!Number.isFinite(ground)) continue;
        const y = ground + up;
        if (blocked(x, y, z) || !sees(car, x, y, z, blocked)) continue;
        c.px = x;
        c.py = y;
        c.pz = z;
        c.side = side;
        return true;
      }
    }
  }
  return false;
}

/** Where the high shot would stand for the car now, in `SPOT`. */
function highPlace(c: Cine, car: CarPose): void {
  wayOf(car);
  SPOT.x = car.x - WAY.x * HIGH_BACK + WAY.z * HIGH_ASIDE * c.side;
  SPOT.y = car.y + HIGH_UP;
  SPOT.z = car.z - WAY.z * HIGH_BACK - WAY.x * HIGH_ASIDE * c.side;
}

/** Whether a shot fixed to the car stands: its place is in nothing and sees the car. */
function fixedStands(car: CarPose, f: Fixed, side: number, blocked: Blocked, groundAt: Ground): boolean {
  spot(car, f.along, f.aside * side, f.up);
  const ground = groundAt(SPOT.x, SPOT.z);
  if (Number.isFinite(ground) && SPOT.y < ground + GROUND_CLEAR) return false;
  return !blocked(SPOT.x, SPOT.y, SPOT.z) && sees(car, SPOT.x, SPOT.y, SPOT.z, blocked);
}

/** Begins `shot` if it stands, and answers whether it did. */
function begin(c: Cine, shot: number, car: CarPose, blocked: Blocked, groundAt: Ground): boolean {
  const side = draw(c.cuts, 3) < 0.5 ? 1 : -1;
  if (shot === ROADSIDE) {
    if (!standRoadside(c, car, blocked, groundAt)) return false;
  } else if (shot === WHEEL || shot === NOSE) {
    const f = shot === WHEEL ? WHEEL_SHOT : NOSE_SHOT;
    if (fixedStands(car, f, side, blocked, groundAt)) c.side = side;
    else if (fixedStands(car, f, -side, blocked, groundAt)) c.side = -side;
    else return false;
  } else if (shot === HIGH) {
    c.side = side;
    highPlace(c, car);
    if (blocked(SPOT.x, SPOT.y, SPOT.z) || !sees(car, SPOT.x, SPOT.y, SPOT.z, blocked)) {
      c.side = -side;
      highPlace(c, car);
      if (blocked(SPOT.x, SPOT.y, SPOT.z) || !sees(car, SPOT.x, SPOT.y, SPOT.z, blocked)) return false;
    }
    c.px = SPOT.x;
    c.py = SPOT.y;
    c.pz = SPOT.z;
  } else {
    // The orbit and the tail are drawn in by what is in their way, so they always stand. The orbit starts from behind the car, to one side.
    c.side = side;
    c.turn = Math.atan2(-car.hx, -car.hz) + side * 0.7;
  }
  c.shot = shot;
  c.age = 0;
  c.lost = 0;
  c.nearest = Infinity;
  return true;
}

/** Cuts to the next shot that stands: the orbit for a car that stands, else the round from where the count of cuts has it, else the tail. */
function cut(c: Cine, car: CarPose, blocked: Blocked, groundAt: Ground): void {
  const was = c.shot;
  c.cuts++;
  if (Math.hypot(car.speed, car.slip) < STANDS_UNDER) {
    // A car that stands is turned round, one way or the other by the cut's draw.
    begin(c, ORBIT, car, blocked, groundAt);
    return;
  }
  for (let k = 0; k < ROUND.length; k++) {
    // The first cut takes the round's first, a roadside shot.
    const shot = ROUND[(c.cuts - 1 + k) % ROUND.length] as number;
    if (shot === was && shot !== ROADSIDE) continue;
    if (begin(c, shot, car, blocked, groundAt)) return;
  }
  begin(c, TAIL, car, blocked, groundAt);
}

/** The camera on the line from the aim point (ax, ay, az) toward (x, y, z), drawn in before whatever stands on it: the distance it stands at. */
function drawnIn(ax: number, ay: number, az: number, x: number, y: number, z: number, blocked: Blocked): number {
  const dx = x - ax;
  const dy = y - ay;
  const dz = z - az;
  const far = Math.hypot(dx, dy, dz);
  if (!(far > 1e-6)) return 0;
  for (let d = SIGHT_NEAR; d <= far; d += 0.5) {
    const t = d / far;
    if (blocked(ax + dx * t, ay + dy * t, az + dz * t)) return Math.max(NEAREST, d - 0.5 - SHORT);
  }
  return blocked(x, y, z) ? Math.max(NEAREST, far - SHORT) : far;
}

/**
 * Writes the cinematic camera into `out` and answers its lens, radians (the whole angle, not an addition to the game's).
 * A new `Cine`, or one whose car was put somewhere, begins with a cut.
 */
export function stepCine(c: Cine, car: CarPose, dt: number, blocked: Blocked, groundAt: Ground, out: CameraPose): number {
  const step = dt > 0 ? (dt < DT_MAX ? dt : DT_MAX) : 0;
  const jumped = !(Math.hypot(car.x - c.cx, car.y - c.cy, car.z - c.cz) <= EYE_SNAP_M);
  c.cx = sane(car.x);
  c.cy = sane(car.y);
  c.cz = sane(car.z);
  c.age += step;
  const speed = sane(Math.hypot(car.speed, car.slip));
  const ax = car.x;
  const ay = car.y + AIM_UP;
  const az = car.z;

  // Whether the shot being held is over.
  let over = c.shot === NO_SHOT || jumped;
  if (!over && c.shot === ROADSIDE) {
    const far = Math.hypot(ax - c.px, ay - c.py, az - c.pz);
    if (far < c.nearest) c.nearest = far;
    c.lost = sees(car, c.px, c.py, c.pz, blocked) ? 0 : c.lost + step;
    const passed = far > c.nearest + 2;
    over = c.age >= ROADSIDE_SECONDS || far > TOO_FAR || (passed && far > GONE_BY) || (c.lost >= LOST_FOR && c.age >= HOLD_LEAST)
      // A car that has stopped short of the camera is not waited for.
      || (speed < STANDS_UNDER && c.age >= FIXED_SECONDS);
  } else if (!over && (c.shot === WHEEL || c.shot === NOSE)) {
    const f = c.shot === WHEEL ? WHEEL_SHOT : NOSE_SHOT;
    c.lost = fixedStands(car, f, c.side, blocked, groundAt) ? 0 : c.lost + step;
    over = c.age >= FIXED_SECONDS || (c.lost >= LOST_FOR && c.age >= HOLD_LEAST) || (speed < STANDS_UNDER && c.age >= HOLD_LEAST);
  } else if (!over && c.shot === HIGH) {
    c.lost = !blocked(c.px, c.py, c.pz) && sees(car, c.px, c.py, c.pz, blocked) ? 0 : c.lost + step;
    over = c.age >= HIGH_SECONDS || (c.lost >= LOST_FOR && c.age >= HOLD_LEAST) || (speed < STANDS_UNDER && c.age >= HOLD_LEAST);
  } else if (!over && c.shot === ORBIT) {
    over = c.age >= ORBIT_SECONDS || speed > MOVES_OVER;
  } else if (!over && c.shot === TAIL) {
    over = c.age >= FIXED_SECONDS;
  }
  if (over) cut(c, car, blocked, groundAt);

  // The shot.
  if (c.shot === ROADSIDE) {
    lookFrom(c.px, c.py, c.pz, ax, ay, az, out);
    const far = Math.hypot(ax - c.px, ay - c.py, az - c.pz);
    return Math.min(LENS_WIDE, Math.max(LENS_LONG, 2 * Math.atan(FRAME_HALF / Math.max(far, 1e-3))));
  }
  if (c.shot === WHEEL || c.shot === NOSE) {
    const f = c.shot === WHEEL ? WHEEL_SHOT : NOSE_SHOT;
    spot(car, f.along, f.aside * c.side, f.up);
    const x = SPOT.x;
    const y = SPOT.y;
    const z = SPOT.z;
    spot(car, f.toAlong, f.toAside * c.side, f.toUp);
    lookFrom(x, y, z, SPOT.x, SPOT.y, SPOT.z, out);
    return f.fov;
  }
  if (c.shot === HIGH) {
    highPlace(c, car);
    const k = 1 - Math.exp(-HIGH_LAG * step);
    c.px += (SPOT.x - c.px) * k;
    c.py += (SPOT.y - c.py) * k;
    c.pz += (SPOT.z - c.pz) * k;
    lookFrom(c.px, c.py, c.pz, ax, ay, az, out);
    return HIGH_FOV;
  }
  if (c.shot === ORBIT) {
    c.turn += ORBIT_TURN * c.side * step;
    const x = ax + Math.sin(c.turn) * ORBIT_BACK;
    const y = ay + ORBIT_UP - AIM_UP;
    const z = az + Math.cos(c.turn) * ORBIT_BACK;
    const far = Math.hypot(x - ax, y - ay, z - az);
    const at = drawnIn(ax, ay, az, x, y, z, blocked) / far;
    const px = ax + (x - ax) * at;
    const pz = az + (z - az) * at;
    const ground = groundAt(px, pz);
    const py = Math.max(ay + (y - ay) * at, Number.isFinite(ground) ? ground + GROUND_CLEAR : -Infinity);
    lookFrom(px, py, pz, ax, ay, az, out);
    return ORBIT_FOV;
  }
  // The tail: low behind the car, drawn in from what it looks at.
  const f = TAIL_SHOT;
  spot(car, f.toAlong, f.toAside * c.side, f.toUp);
  const tx = SPOT.x;
  const ty = SPOT.y;
  const tz = SPOT.z;
  spot(car, f.along, f.aside * c.side, f.up);
  const far = Math.hypot(SPOT.x - tx, SPOT.y - ty, SPOT.z - tz);
  const at = far > 1e-6 ? drawnIn(tx, ty, tz, SPOT.x, SPOT.y, SPOT.z, blocked) / far : 0;
  const px = tx + (SPOT.x - tx) * at;
  const pz = tz + (SPOT.z - tz) * at;
  const ground = groundAt(px, pz);
  const py = Math.max(ty + (SPOT.y - ty) * at, Number.isFinite(ground) ? ground + GROUND_CLEAR : -Infinity);
  lookFrom(px, py, pz, tx, ty, tz, out);
  return f.fov;
}
