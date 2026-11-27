/**
 * The body on its springs: how far the car's body leans, dips and rides over its wheels this frame. The simulation's car is rigid and has no
 * suspension; this is what is drawn of one, and it changes nothing the rules read. The wheels and the dark patch stay on the ground as
 * `carPose.ts` stands them, and the body's meshes alone are moved by `swayMatrix`.
 *
 * **What moves it.** The car's velocity over the ground is its speed along the heading and its slip across it. How that velocity changed
 * since the last frame is the acceleration the body felt: its part along the heading pitches the body (the nose dips under the brake and
 * lifts under the engine), its part across rolls it (out of a turn, and out of a slide as the tyres bite), and the rise and fall of the
 * wheels' own height carries the body up and down after it. Each of the three is a spring with a damper, and the roll and the pitch are
 * underdamped, so the body goes a little past where it will rest and comes back: a car that stops short nods once.
 *
 * **A hit.** A change of velocity too sudden to be the tyres' (more than `ACC_MOST` would give in the frame) is a hit: the rest of it is
 * given to the springs at once as a turn rate, so the body lurches toward what it struck.
 *
 * Pure arithmetic over records; nothing is allocated, and nothing is thrown or left not a number whatever `dt` is.
 */
import { EYE_SNAP_M } from "@csarkosh/engine/game/eyeBlend";
import { AXLE_FRONT, AXLE_REAR } from "../../sim/car/tuning.js";
import type { CarPose } from "./carPose.js";

/** The lean a steady acceleration holds, radians for each m/s²: about 4 degrees of roll at the pavement's grip, and 2.3 of dive under the brake. */
export const ROLL_PER = 0.009, PITCH_PER = 0.0045;
/** The most the body leans and dips (rad) and rides up or down (m). */
export const ROLL_MOST = 0.11, PITCH_MOST = 0.07, HEAVE_MOST = 0.07;
/** Each spring's own frequency (rad/s) and its damping as a share of what would stop it without passing its rest. */
const ROLL_W = 9.4, ROLL_Z = 0.38, PITCH_W = 8.2, PITCH_Z = 0.4, HEAVE_W = 11, HEAVE_Z = 0.3;
/** The body comes back up against a damper twice as stiff as the one it goes down against, as a road car's is. */
const REBOUND = 2;
/** The most acceleration the tyres give (m/s²): more than that in a frame is a hit, and what a hit's m/s gives the springs (rad/s). */
export const ACC_MOST = 22;
const ROLL_KICK = 0.12, PITCH_KICK = 0.1;
/** The height (m, over the wheels' plane) and the place along the car (m) the body turns about: the axles' height, midway between them. */
const PIVOT_UP = 0.32, PIVOT_ALONG = (AXLE_FRONT + AXLE_REAR) / 2;
/** The springs are stepped no coarser than this (s), and a frame counts for no more than `DT_MOST`. */
const STEP = 1 / 120, DT_MOST = 0.25;
/** The fastest the wheels' height is taken to move, m/s: a kerb climbed in a frame is not a launch. */
const RISE_MOST = 2.5;

/** The lean to the right (rad, the right side down), the nose's lift (rad), the body's height over its rest (m), their rates, and the last frame's car. */
export type Sway = {
  roll: number; rollV: number; pitch: number; pitchV: number; heave: number; heaveV: number;
  x: number; y: number; z: number; vx: number; vz: number; started: boolean;
};

export function newSway(): Sway {
  return { roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, started: false };
}

function held(value: number, most: number): number {
  return value > most ? most : value < -most ? -most : value;
}

/** A number, or 0 for what is not one. */
function sane(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** One step of a spring toward `target`: semi-implicit, the rate first. */
function spring(at: number, rate: number, target: number, w: number, z: number, h: number, out: { at: number; rate: number }): void {
  const next = rate + (-w * w * (at - target) - 2 * z * w * rate) * h;
  out.rate = next;
  out.at = at + next * h;
}

const SPRUNG = { at: 0, rate: 0 };

/** Steps the body's springs by `dt` seconds from the car as this frame drew it. */
export function stepSway(s: Sway, pose: CarPose, dt: number): void {
  // The velocity over the ground: along the heading and across it (the right of the heading is (hz, -hx)).
  const vx = sane(pose.hx * pose.speed + pose.hz * pose.slip);
  const vz = sane(pose.hz * pose.speed - pose.hx * pose.slip);
  const jumped = !(Math.hypot(pose.x - s.x, pose.y - s.y, pose.z - s.z) <= EYE_SNAP_M);
  const step = dt > 0 ? (dt < DT_MOST ? dt : DT_MOST) : 0;
  if (!s.started || jumped || step === 0) {
    // A car new to the frame, or put somewhere, rests on its springs; a frame of no time only notes where the car is.
    if (!s.started || jumped) {
      s.roll = 0; s.rollV = 0; s.pitch = 0; s.pitchV = 0; s.heave = 0; s.heaveV = 0;
    }
    s.x = sane(pose.x); s.y = sane(pose.y); s.z = sane(pose.z); s.vx = vx; s.vz = vz;
    s.started = true;
    return;
  }
  // What the body felt: the change of velocity, along the heading and to its right.
  const dvx = vx - s.vx;
  const dvz = vz - s.vz;
  let along = dvx * pose.hx + dvz * pose.hz;
  let across = dvx * pose.hz - dvz * pose.hx;
  // A hit: what the tyres could not have done in the frame goes to the springs at once.
  const most = ACC_MOST * step;
  if (along > most || along < -most) {
    s.pitchV += PITCH_KICK * (along - held(along, most));
    along = held(along, most);
  }
  if (across > most || across < -most) {
    s.rollV -= ROLL_KICK * (across - held(across, most));
    across = held(across, most);
  }
  // Braking dips the nose; a pull to the right (a right turn) leans the body to the left.
  const pitchTo = held(PITCH_PER * along / step, PITCH_MOST);
  const rollTo = held(-ROLL_PER * across / step, ROLL_MOST);
  // The wheels' height moved: the body stays where it was and is carried after it.
  const rise = held((sane(pose.y) - s.y) / step, RISE_MOST);
  const n = Math.max(1, Math.ceil(step / STEP));
  const h = step / n;
  for (let i = 0; i < n; i++) {
    spring(s.roll, s.rollV, rollTo, ROLL_W, ROLL_Z, h, SPRUNG);
    s.roll = SPRUNG.at;
    s.rollV = SPRUNG.rate;
    spring(s.pitch, s.pitchV, pitchTo, PITCH_W, PITCH_Z, h, SPRUNG);
    s.pitch = SPRUNG.at;
    s.pitchV = SPRUNG.rate;
    // The heave is held over the wheels: `heaveV` is the body's own rate, and the damper works on its rate against the wheels'.
    const against = s.heaveV - rise;
    const z = against * s.heave < 0 ? HEAVE_Z * REBOUND : HEAVE_Z;
    s.heaveV += (-HEAVE_W * HEAVE_W * s.heave - 2 * z * HEAVE_W * against) * h;
    s.heave += against * h;
  }
  // Held to what the body has room for: at a stop the rate that pushed against it is spent.
  if (s.roll > ROLL_MOST || s.roll < -ROLL_MOST) { s.roll = held(s.roll, ROLL_MOST); s.rollV = 0; }
  if (s.pitch > PITCH_MOST || s.pitch < -PITCH_MOST) { s.pitch = held(s.pitch, PITCH_MOST); s.pitchV = 0; }
  if (s.heave > HEAVE_MOST || s.heave < -HEAVE_MOST) { s.heave = held(s.heave, HEAVE_MOST); s.heaveV = rise; }
  s.roll = sane(s.roll); s.rollV = sane(s.rollV); s.pitch = sane(s.pitch); s.pitchV = sane(s.pitchV); s.heave = sane(s.heave); s.heaveV = sane(s.heaveV);
  s.x = sane(pose.x); s.y = sane(pose.y); s.z = sane(pose.z); s.vx = vx; s.vz = vz;
}

/**
 * Writes at `out[at]` the body's matrix as it is drawn: `body` (the car stood on its wheels, `carPose.ts`: the model's x the nose, y up, z
 * the left) with the body leaned, dipped and raised on it, about the axles' height midway between them.
 */
export function swayMatrix(body: ArrayLike<number>, s: Sway, out: Float32Array, at: number): void {
  const cp = Math.cos(s.pitch);
  const sp = Math.sin(s.pitch);
  const cr = Math.cos(s.roll);
  const sr = Math.sin(s.roll);
  // A lift of the nose is a turn about the model's z (the left); a lean to the right is a turn about its x (the nose) that lowers -z.
  const x0 = cp, x1 = sp, x2 = 0;
  const y0 = -sp * cr, y1 = cp * cr, y2 = -sr;
  const z0 = -sp * sr, z1 = cp * sr, z2 = cr;
  // The pivot stays where it is, and the heave lifts everything.
  const t0 = PIVOT_ALONG - (x0 * PIVOT_ALONG + y0 * PIVOT_UP);
  const t1 = PIVOT_UP - (x1 * PIVOT_ALONG + y1 * PIVOT_UP) + s.heave;
  const t2 = -(x2 * PIVOT_ALONG + y2 * PIVOT_UP);
  const b = body;
  for (let k = 0; k < 3; k++) {
    const bx = b[k] as number;
    const by = b[4 + k] as number;
    const bz = b[8 + k] as number;
    out[at + k] = bx * x0 + by * x1 + bz * x2;
    out[at + 4 + k] = bx * y0 + by * y1 + bz * y2;
    out[at + 8 + k] = bx * z0 + by * z1 + bz * z2;
    out[at + 12 + k] = bx * t0 + by * t1 + bz * t2 + (b[12 + k] as number);
  }
  out[at + 3] = 0;
  out[at + 7] = 0;
  out[at + 11] = 0;
  out[at + 15] = 1;
}
