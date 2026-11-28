/**
 * Where the player's hand and torch are in the camera's frame, each frame. Pure: no engine, no DOM; `handParts.ts` places the meshes by it and the
 * flashlight's lamp is put at its lens (`lensWorld`).
 *
 * The camera's frame is x to the right, y up and z forward, in metres from the eye. The pose is the lens of the torch (its place) and two axes (unit
 * vectors): the beam's, the way the light goes from the lens (`ax, ay, az`), and the one the torch is drawn along (`mx, my, mz`), which is not the same at the hold; and a
 * roll about the drawn axis.
 *
 * - **At rest the hand is down**, below the view. Lamp turned on: it rises over `RAISE_SECONDS` (0.25 s) to its hold; turned off, it lowers over
 *   `LOWER_SECONDS` (0.2 s). A part-way raise that is turned off goes back down from where it is.
 * - **The hold** is the lens `HOLD_DEPTH` (0.45 m) ahead of the eye and where `HOLD_SCREEN` says on the screen (worked out from the view's aspect). The beam goes along
 *   `TILT_YAW` and `TILT_PITCH`; the torch is drawn along `DRAWN_YAW` and `DRAWN_PITCH`, turned in so that its barrel shows. The arm drops straight down `LOWER_DROP` (0.55 m:
 *   a third of the view's height under the bottom edge at the lowest, on every window from 4:3 to 21:9) and rises the same way.
 * - **A walking bob** tied to the ground speed (a step is about two bobs a metre of stride's phase), a **breathing sway** that is the whole of the motion
 *   when standing still, a **lag behind a quick turn** of the view (the hand follows the camera on a spring; at most `MAX_LAG`, 4 degrees), **lower and steadier
 *   when sprinting**, and **raised a little when the view looks steeply down**, so that it does not fill the view.
 * - **Never nearer the eye than `NEAREST`** (14 cm, the near plane being 5 cm): held by the hold's place, the least a wall draws it in (`RETRACT_LEAST`) and the
 *   lag's and the bob's small bounds, and checked by a test over every vertex of the hand.
 * - **Pulled in toward the eye by a wall** ahead (`clear`, 1 in the open, 0 against a wall): the torch is shortened toward the eye so that it does not
 *   come out through the wall's far side.
 * - **Hidden** while seated in the car, while getting in or out, and while the screen is dark at a door (`handHidden`): it is down at once, and rises again
 *   if the lamp is still on when they are over.
 */
import type { CameraAxes } from "@csarkosh/engine/game/lite/cameraPose";

export const RAISE_SECONDS = 0.25;
export const LOWER_SECONDS = 0.2;
/** The camera's vertical field of view (the game's lens), radians, and the widest and narrowest view (width over height) the hold is worked out for. */
export const FOV = 1.4;
export const ASPECT_MIN = 1, ASPECT_MAX = 2.2;
/** How far ahead of the eye the lens is at the hold (metres), and where it stands on the screen there, as shares of the view's width (from the left) and height (from the top). */
export const HOLD_DEPTH = 0.45;
export const HOLD_SCREEN = { x: 0.52, y: 0.64 } as const;
/**
 * How the torch is tilted at the hold, radians: turned toward the left of the view and pitched down, as a person holds a torch up before them and points it at the
 * ground ahead. The tilt shows the barrel along its side (pointed straight ahead it is seen end on) and sends the beam's middle to the ground about 7 m ahead, so
 * the pool runs from a couple of metres out to the lamp's range.
 */
export const TILT_YAW = -0.04, TILT_PITCH = 0.2;
/**
 * How the torch is DRAWN at the hold, radians, which is not the beam's axis: turned toward the middle of the view and a little up. A torch below and to the right
 * of the eye that points exactly where the beam goes is seen from behind, its tail cap hiding the rest; drawn turned in like this its barrel is seen along its
 * side, the head the farthest and widest part, as a held torch looks to the one who holds it. The beam keeps `TILT_YAW` and `TILT_PITCH` from the lens. Set by eye.
 */
export const DRAWN_YAW = -0.95, DRAWN_PITCH = -0.5;
/** The turn of the torch about its own axis at the hold, radians: the hand holds it from the right and below, the forearm rising from the bottom edge of the view. */
export const HOLD_ROLL = -0.2;
/** The lens's place at the hold for a view of this aspect (width over height), in the camera's frame: so that the torch's head stands at `HOLD_SCREEN` whatever the window's shape. */
export function holdFor(aspect: number): { x: number; y: number; z: number } {
  const a = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
  const half = Math.tan(FOV / 2);
  return { x: (2 * HOLD_SCREEN.x - 1) * half * a * HOLD_DEPTH, y: -(2 * HOLD_SCREEN.y - 1) * half * HOLD_DEPTH, z: HOLD_DEPTH };
}
/** The hold for a view of the usual shape, 16 to 10, for what wants one number (the tests; the lowered place is measured from it). */
export const HOLD = holdFor(1.6);
/**
 * How far straight below the hold the lens is with the hand lowered, metres: so that the arm drops straight down out of the bottom of the view as it goes, at the
 * same distance from the eye and the same place across the screen (it does not shrink, slide sideways or fade), and rises the same way. At 0.55 m the whole of the
 * hand and the sleeve is under the bottom edge on any window from 4:3 to 21:9.
 */
export const LOWER_DROP = 0.55;
/** Where the lens is with the hand lowered, for a view of this aspect. */
export function loweredFor(aspect: number): { x: number; y: number; z: number } {
  const h = holdFor(aspect);
  return { x: h.x, y: h.y - LOWER_DROP, z: h.z };
}
/** The nearest the lens comes to the eye, metres. */
export const NEAREST = 0.14;
/** The most the hand lags a turn of the view, radians. */
export const MAX_LAG = (4 * Math.PI) / 180;
/** How quickly a lag dies away, per second, and how much of a turn it takes up. */
const LAG_RATE = 11;
const LAG_TAKES = 0.7;

export type HandInput = {
  /** The frame's time, seconds. */
  dt: number;
  /** Whether the hand is wanted up (the torch is lit, or the console said `hand on`). */
  want: boolean;
  /** Whether it is hidden (`handHidden`). */
  hidden: boolean;
  /** The player's ground speed, metres a second. */
  speed: number;
  sprinting: boolean;
  /** The view's yaw and pitch, radians (the engine's: pitch is positive looking down). */
  yaw: number;
  pitch: number;
  /** How far the way ahead is clear, 0 (a wall at the nose) to 1 (open). */
  clear: number;
  /** The view's width over its height. */
  aspect: number;
};

export type HandState = {
  /** How far up, 0 to 1, by time: the eased value is `eased`. */
  raise: number;
  /** The walk's phase, radians, and the clock of the breathing, seconds. */
  walk: number;
  breath: number;
  /** The hand's own turn behind the view, radians. */
  lagYaw: number;
  lagPitch: number;
  /** The view's yaw and pitch of the last frame, and whether there was one. */
  lastYaw: number;
  lastPitch: number;
  started: boolean;
};

export type HandPose = {
  /** Whether any of the hand is up and to be drawn. */
  shown: boolean;
  /** How up it is, eased, 0 to 1. */
  raised: number;
  /** The lens's place in the camera's frame. */
  x: number;
  y: number;
  z: number;
  /** The beam's axis, a unit vector, in the camera's frame. */
  ax: number;
  ay: number;
  az: number;
  /** The axis the torch is drawn along (`DRAWN_YAW`, `DRAWN_PITCH`), a unit vector, in the camera's frame. */
  mx: number;
  my: number;
  mz: number;
  /** The torch's turn about its own axis, radians. */
  roll: number;
};

export function newHandState(): HandState {
  return { raise: 0, walk: 0, breath: 0, lagYaw: 0, lagPitch: 0, lastYaw: 0, lastPitch: 0, started: false };
}

export function newHandPose(): HandPose {
  const low = loweredFor(1.6);
  return { shown: false, raised: 0, x: low.x, y: low.y, z: low.z, ax: 0, ay: 0, az: 1, mx: 0, my: 0, mz: 1, roll: HOLD_ROLL };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const wrap = (a: number): number => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};

/** Whether the hand is hidden: the player is not on foot (`ridePhase` is not 0), or the screen is dark at a door (`insidePhase` going in or out: 1 or 3, or in a room not yet drawn). */
export function handHidden(ridePhase: number, insidePhase: number, roomUndrawn: boolean): boolean {
  return ridePhase !== 0 || insidePhase === 1 || insidePhase === 3 || (insidePhase === 2 && roomUndrawn);
}

/** The axis of the beam at the hold, in the camera's frame: ahead, turned by `TILT_YAW` and pitched down by `TILT_PITCH`. */
export function holdAxis(): [number, number, number] {
  return [Math.sin(TILT_YAW) * Math.cos(TILT_PITCH), -Math.sin(TILT_PITCH), Math.cos(TILT_YAW) * Math.cos(TILT_PITCH)];
}

/** The most the hand is drawn in toward the eye by a wall ahead: the whole offset is scaled, so that the torch keeps its place on the screen and is only nearer and smaller. */
export const RETRACT_LEAST = 0.9;

/** Steps the hand's state by a frame and writes the pose. Allocates nothing. */
export function stepHand(s: HandState, i: HandInput, out: HandPose): HandPose {
  const dt = Math.min(Math.max(i.dt, 0), 0.1);
  if (i.hidden) s.raise = 0;
  else if (i.want) s.raise = Math.min(1, s.raise + dt / RAISE_SECONDS);
  else s.raise = Math.max(0, s.raise - dt / LOWER_SECONDS);
  // The view's turn since the last frame, which the hand lags behind: kept, then let die away on a spring.
  if (!s.started) {
    s.lastYaw = i.yaw;
    s.lastPitch = i.pitch;
    s.started = true;
  }
  const dYaw = wrap(i.yaw - s.lastYaw);
  const dPitch = i.pitch - s.lastPitch;
  s.lastYaw = i.yaw;
  s.lastPitch = i.pitch;
  s.lagYaw = (s.lagYaw - dYaw * LAG_TAKES) * Math.exp(-dt * LAG_RATE);
  s.lagPitch = (s.lagPitch - dPitch * LAG_TAKES) * Math.exp(-dt * LAG_RATE);
  s.lagYaw = Math.min(MAX_LAG, Math.max(-MAX_LAG, s.lagYaw));
  s.lagPitch = Math.min(MAX_LAG, Math.max(-MAX_LAG, s.lagPitch));
  // The walk's phase moves with the ground speed; the breath moves with the clock.
  s.walk += dt * i.speed * 2;
  s.breath += dt;
  const moving = Math.min(1, i.speed / 3.5) * (i.sprinting ? 0.6 : 1);
  const still = 1 - Math.min(1, i.speed / 1.2);
  const raised = smooth(s.raise);
  out.raised = raised;
  out.shown = s.raise > 0;
  // The hold, with its motions.
  const down = smooth((i.pitch - 0.55) / 0.65);
  const hold = holdFor(i.aspect);
  let x = hold.x + Math.sin(s.walk) * 0.005 * moving + Math.sin(s.breath * 0.9 + 1) * 0.0015 * still;
  let y = hold.y + Math.sin(s.walk * 2) * 0.0065 * moving + Math.sin(s.breath * 1.3) * 0.0025 * still;
  let z = hold.z;
  if (i.sprinting) {
    y -= 0.025;
    z -= 0.015;
  }
  y += 0.03 * down;
  x += 0.04 * down;
  z -= 0.02 * down;
  // The lag moves the hand across the view the other way to the turn.
  x += s.lagYaw * 0.35;
  y -= s.lagPitch * 0.35;
  // A wall near draws the torch in toward the eye along the line it is seen on: the whole offset is scaled, so it stays where it is on the screen.
  const pull = RETRACT_LEAST + (1 - RETRACT_LEAST) * Math.min(1, Math.max(0, i.clear));
  x *= pull;
  y *= pull;
  z *= pull;
  // From the lowered place to the hold.
  const low = loweredFor(i.aspect);
  out.x = low.x + (x - low.x) * raised;
  out.y = low.y + (y - low.y) * raised;
  out.z = low.z + (z - low.z) * raised;
  // The axis: the hold's tilt, with the lag turning it; lowered it points ahead and a little up.
  const yaw0 = TILT_YAW;
  const pitch0 = TILT_PITCH;
  const yaw = yaw0 + s.lagYaw;
  const pitch = pitch0 + s.lagPitch * 0.8 + Math.sin(s.walk * 2) * 0.01 * moving;
  const lowPitch = -0.35;
  const p = lowPitch + (pitch - lowPitch) * raised;
  const yw = yaw * raised;
  out.ax = Math.sin(yw) * Math.cos(p);
  out.ay = -Math.sin(p);
  out.az = Math.cos(yw) * Math.cos(p);
  // The torch as drawn keeps its own turn the whole way up and down, so the arm rises and drops without twisting.
  const dYawNow = DRAWN_YAW + s.lagYaw;
  const dPitchNow = DRAWN_PITCH + s.lagPitch * 0.8 + Math.sin(s.walk * 2) * 0.01 * moving;
  out.mx = Math.sin(dYawNow) * Math.cos(dPitchNow);
  out.my = -Math.sin(dPitchNow);
  out.mz = Math.cos(dYawNow) * Math.cos(dPitchNow);
  out.roll = HOLD_ROLL + Math.sin(s.walk) * 0.03 * moving * raised;
  return out;
}

/**
 * The lens's place in the world and the way the beam points, for an eye at (`ex`, `ey`, `ez`) with the camera's axes `a`: written to `out`
 * (`x, y, z` the lens, `dx, dy, dz` the unit axis).
 */
export function lensWorld(ex: number, ey: number, ez: number, a: CameraAxes, p: HandPose, out: { x: number; y: number; z: number; dx: number; dy: number; dz: number }): void {
  out.x = ex + a.rx * p.x + a.ux * p.y + a.fx * p.z;
  out.y = ey + a.ry * p.x + a.uy * p.y + a.fy * p.z;
  out.z = ez + a.rz * p.x + a.uz * p.y + a.fz * p.z;
  out.dx = a.rx * p.ax + a.ux * p.ay + a.fx * p.az;
  out.dy = a.ry * p.ax + a.uy * p.ay + a.fy * p.az;
  out.dz = a.rz * p.ax + a.uz * p.ay + a.fz * p.az;
}

/**
 * The torch's own axes in the world, as three unit vectors written to `out` (right, up, forward: nine numbers): its forward is the axis the torch is drawn along, its up is the
 * camera's up turned by the roll and squared to the axis, so the torch is the right way up in the hand.
 */
export function torchBasis(a: CameraAxes, p: HandPose, out: Float64Array | number[]): void {
  // In the camera's frame: forward is (ax, ay, az); up is (0, 1, 0) with its part along forward taken out; right completes the turn (up cross forward).
  const dotUp = p.my;
  let ux = -dotUp * p.mx;
  let uy = 1 - dotUp * p.my;
  let uz = -dotUp * p.mz;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  let rx = uy * p.mz - uz * p.my;
  let ry = uz * p.mx - ux * p.mz;
  let rz = ux * p.my - uy * p.mx;
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  const nrx = rx * cr + ux * sr, nry = ry * cr + uy * sr, nrz = rz * cr + uz * sr;
  const nux = ux * cr - rx * sr, nuy = uy * cr - ry * sr, nuz = uz * cr - rz * sr;
  rx = nrx; ry = nry; rz = nrz; ux = nux; uy = nuy; uz = nuz;
  const world = (vx: number, vy: number, vz: number, k: number): void => {
    out[k] = a.rx * vx + a.ux * vy + a.fx * vz;
    out[k + 1] = a.ry * vx + a.uy * vy + a.fy * vz;
    out[k + 2] = a.rz * vx + a.uz * vy + a.fz * vz;
  };
  world(rx, ry, rz, 0);
  world(ux, uy, uz, 3);
  world(p.mx, p.my, p.mz, 6);
}

/**
 * How clear the way ahead is: 1 in the open, down to 0 with a wall at the nose, from a probe of `blocked` at a few distances along the view from the eye. In a room
 * (`insidePhase` not 0) nothing is probed: the town's walls are not the room's, and the room stands 60 m up over footprints of the town's, where every place
 * reads as inside a wall.
 */
export function clearAhead(blocked: (x: number, y: number, z: number) => boolean, ex: number, ey: number, ez: number, a: CameraAxes, insidePhase: number): number {
  if (insidePhase !== 0) return 1;
  for (const d of [0.3, 0.5, 0.7, 0.9]) {
    if (blocked(ex + a.fx * d, ey + a.fy * d, ez + a.fz * d)) return Math.max(0, (d - 0.3) / 0.6);
  }
  return 1;
}

/** The unit quaternion (x, y, z, w) of the rotation whose columns are the three axes `b` holds (`torchBasis`): the rotation from the torch's frame to the world's. */
export function basisQuaternion(b: ArrayLike<number>, out: number[]): void {
  const m00 = b[0] as number, m10 = b[1] as number, m20 = b[2] as number;
  const m01 = b[3] as number, m11 = b[4] as number, m21 = b[5] as number;
  const m02 = b[6] as number, m12 = b[7] as number, m22 = b[8] as number;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
}
