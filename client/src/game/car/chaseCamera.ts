/**
 * The camera behind the car: where the eye stands while the local player is in the car (getting in, seated, getting out), worked out from the
 * car as this frame drew it, the mouse's own look, and how far the player is into the seat. Pure arithmetic over records: `townParts.ts` calls
 * it from the renderer's `shot` and writes nothing else.
 *
 * **The engine's conventions** (`cameraPose.ts`): yaw 0 faces +z and grows toward +x; positive pitch looks down; the forward vector is
 * (sin yaw cos pitch, -sin pitch, cos yaw cos pitch). So a heading (hx, hz) has the yaw `atan2(hx, hz)`, and a camera that stands behind its
 * aim point at pitch p stands at aim - forward * back: higher by sin(p) * back.
 *
 * **What it keeps.** A followed point `t` that trails the car at `CHASE_LAG` per second and snaps to it where the car jumps. Two biases that
 * are added to the mouse's yaw and pitch: while the mouse moves they stay, so nothing jumps; once it has been still for `CHASE_IDLE` seconds
 * they ease so the camera comes round behind the car at the height `CHASE_UP`. Nothing is allocated and nothing is thrown, whatever `dt` is.
 */
import { EYE_SNAP_M } from "@csarkosh/engine/game/eyeBlend";
import type { CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import type { CarPose } from "./carPose.js";

/** The camera's distance from the aim point and its height over the car at rest (m); the aim point's height over the car's place (m). */
export const CHASE_BACK = 6.5, CHASE_UP = 2.4, CHASE_AIM = 1.5;
/** How fast the followed point closes on the car, and the biases on their way, per second; the seconds of a still mouse before they ease. */
export const CHASE_LAG = 10, CHASE_RETURN = 2.5, CHASE_IDLE = 2;
/** The nearest the camera is drawn in to by a wall (m), and the widest the lens grows (rad, at 30 m/s). */
export const CHASE_MIN = 1.5, CHASE_FOV = 0.12;

/** The pitch (held to) that puts the camera `CHASE_UP` over the car with the aim `CHASE_AIM` over it: about 0.14 rad down. */
const REST_PITCH = Math.asin((CHASE_UP - CHASE_AIM) / CHASE_BACK);
/** The pitch the camera's look is held to, rad. */
const PITCH_LOW = -0.1, PITCH_HIGH = 1.0;
/** The line from the aim point to the camera is tested this often (m), and the camera stops this short of what it meets (m). */
const STEP = 0.5, SHORT = 0.3;
/** The camera stays this far over the ground (m). */
const GROUND_CLEAR = 0.4;
/** The speed (m/s) at which the lens is widest, and the most one step's seconds count for. */
const WIDE_SPEED = 30, DT_MAX = 1;
const TWO_PI = Math.PI * 2;

export type Chase = { tx: number; ty: number; tz: number; yawBias: number; pitchBias: number; idle: number; lastYaw: number; lastPitch: number; started: boolean };

export function newChase(): Chase {
  return { tx: 0, ty: 0, tz: 0, yawBias: 0, pitchBias: 0, idle: 0, lastYaw: 0, lastPitch: 0, started: false };
}

/** An angle brought to [-pi, pi]. */
function wrap(a: number): number {
  const w = a - TWO_PI * Math.round(a / TWO_PI);
  return Number.isFinite(w) ? w : 0;
}

/**
 * Writes the chase camera into `out` and answers how much wider the lens is, radians.
 * `seated` is 0 at the walker's eye and 1 fully in the seat: between, the pose is between `eye` and the chase.
 */
export function stepChase(
  c: Chase, car: CarPose, look: { yaw: number; pitch: number }, seated: number, dt: number,
  blocked: (x: number, y: number, z: number) => boolean, groundAt: (x: number, z: number) => number, eye: CameraPose, out: CameraPose,
): number {
  const step = dt > 0 ? (dt < DT_MAX ? dt : DT_MAX) : 0;
  // The followed point: at the car at the start and where the car has jumped, otherwise closing on it.
  if (!c.started || Math.hypot(car.x - c.tx, car.y - c.ty, car.z - c.tz) > EYE_SNAP_M) {
    c.tx = car.x;
    c.ty = car.y;
    c.tz = car.z;
    c.started = true;
    c.yawBias = 0;
    c.pitchBias = 0;
    c.idle = 0;
    c.lastYaw = look.yaw;
    c.lastPitch = look.pitch;
  } else {
    const k = 1 - Math.exp(-CHASE_LAG * step);
    c.tx += (car.x - c.tx) * k;
    c.ty += (car.y - c.ty) * k;
    c.tz += (car.z - c.tz) * k;
  }
  // The mouse: any turn keeps the biases where they are; a still one for long enough lets them ease to the car's own yaw and the rest pitch.
  if (look.yaw !== c.lastYaw || look.pitch !== c.lastPitch) {
    c.idle = 0;
    c.lastYaw = look.yaw;
    c.lastPitch = look.pitch;
  } else {
    c.idle += step;
  }
  const len = Math.hypot(car.hx, car.hz);
  const carYaw = len > 1e-6 ? Math.atan2(car.hx, car.hz) : look.yaw;
  if (c.idle >= CHASE_IDLE) {
    const k = 1 - Math.exp(-CHASE_RETURN * step);
    c.yawBias += (wrap(carYaw - look.yaw) - c.yawBias) * k;
    c.pitchBias += (REST_PITCH - look.pitch - c.pitchBias) * k;
  }
  const yaw = look.yaw + c.yawBias;
  const pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, look.pitch + c.pitchBias));
  // Behind the aim point along the look: forward is (sin yaw cos pitch, -sin pitch, cos yaw cos pitch).
  const ax = c.tx;
  const ay = c.ty + CHASE_AIM;
  const az = c.tz;
  const bx = -Math.sin(yaw) * Math.cos(pitch);
  const by = Math.sin(pitch);
  const bz = -Math.cos(yaw) * Math.cos(pitch);
  // The nearest blocked sample along the line, 0.5 m apart; the camera stops 0.3 m short of it and never nearer than `CHASE_MIN`.
  let back = CHASE_BACK;
  for (let d = STEP; d <= CHASE_BACK + 1e-9; d += STEP) {
    if (blocked(ax + bx * d, ay + by * d, az + bz * d)) {
      back = Math.max(CHASE_MIN, d - SHORT);
      break;
    }
  }
  const cx = ax + bx * back;
  const cz = az + bz * back;
  const floor = groundAt(cx, cz) + GROUND_CLEAR;
  const cy = Math.max(ay + by * back, Number.isFinite(floor) ? floor : -Infinity);
  // Looking at the aim point from where it stands: its own yaw and pitch, unless it is on the point.
  const dx = ax - cx;
  const dy = ay - cy;
  const dz = az - cz;
  const run = Math.hypot(dx, dz);
  const seen = Math.hypot(run, dy);
  const lookYaw = run > 1e-6 ? Math.atan2(dx, dz) : yaw;
  const lookPitch = seen > 1e-6 ? Math.asin(Math.min(1, Math.max(-1, -dy / seen))) : pitch;
  // The ease from the walker's eye: smoothstep over `seated`, the yaw by the shorter way round.
  const s0 = seated > 0 ? (seated < 1 ? seated : 1) : 0;
  const s = s0 * s0 * (3 - 2 * s0);
  out.x = eye.x + (cx - eye.x) * s;
  out.y = eye.y + (cy - eye.y) * s;
  out.z = eye.z + (cz - eye.z) * s;
  out.yaw = eye.yaw + wrap(lookYaw - eye.yaw) * s;
  out.pitch = eye.pitch + (lookPitch - eye.pitch) * s;
  out.roll = eye.roll * (1 - s);
  const speed = Math.abs(car.speed);
  return CHASE_FOV * Math.min(1, Number.isFinite(speed) ? speed / WIDE_SPEED : 0) * s;
}
