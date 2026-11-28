/**
 * Where the player's left arm and its watch are in the camera's frame, each frame. Pure: no engine, no DOM. It is the right arm's (`handPose.ts`) in a simpler
 * form: the same camera frame (x to the right, y up, z forward, metres from the eye), the same `HandPose` record (the origin is the middle of the watch's screen; `mx, my, mz`
 * is the way the forearm runs toward the fingers; `roll` turns the face to the eye), the same `torchBasis` to turn it into the mesh's axes.
 *
 * - **The hold**: the screen's middle `WATCH_DEPTH` ahead of the eye and `WATCH_SCREEN` across and down the view (worked out from the view's aspect); the forearm runs across the
 *   lower part of the view, rising a little to the right, from the lower left; the face is turned to the eye with a slight tilt, and reads upright. The arm is drawn
 *   `ARM_SCALE` times life size and the watch `WATCH_BIG` times larger again (`hand.left.glb`: the build bakes it in, `WATCH_BIG` in `tools/models/buildHands.py`), so that the screen is a fifth of the view's height across and the map on it can be read.
 * - **Raise and lower**: it rises from straight below in `WATCH_RAISE_SECONDS` (0.3 s) and drops straight down in `WATCH_LOWER_SECONDS` (0.25 s), at the same depth and place across
 *   the screen. A bob follows the ground speed, a slow breath sways it when still, it lags a turn of the view on a spring, as the right arm does, and it is drawn in toward the eye
 *   by a wall ahead by the same `RETRACT_LEAST`.
 * - **Hidden** in a car and getting in or out (`ridePhase` not 0) and under the dark screen at a door; it is down at once, and rises again after.
 * - **The quad**: the four corners of the square that bounds the lit circle, projected to the view (`watchQuad`), for the page to draw the map on.
 */
import { FOV, ASPECT_MAX, ASPECT_MIN, RETRACT_LEAST, MAX_LAG, newHandPose, newHandState, type HandPose, type HandState } from "./handPose.js";
import { LEFT } from "./handModels.js";

export const WATCH_RAISE_SECONDS = 0.3;
export const WATCH_LOWER_SECONDS = 0.25;
/** The arm's size against life, about the watch's screen: larger than life on purpose, as a first person view model is. */
export const ARM_SCALE = 1.6;
/** How far ahead of the eye the screen's middle is at the hold (metres), and where it stands on the view, as shares of its width (from the left) and height (from the top). */
export const WATCH_DEPTH = 0.3;
export const WATCH_SCREEN = { x: 0.31, y: 0.7 } as const;
/** The way the forearm runs toward the fingers at the hold, in the camera's frame (a unit vector: to the right, rising a little, a little away), and the roll that turns the face to the eye. */
export const WATCH_AXIS: readonly [number, number, number] = [0.698, 0.173, 0.684];
export const WATCH_ROLL = -1.16;
/** How far straight below the hold the arm is when lowered, metres: past the bottom of the view at every shape. */
export const WATCH_DROP = 0.6;

/** The screen's middle at the hold for a view of this aspect, in the camera's frame. */
export function watchHoldFor(aspect: number): { x: number; y: number; z: number } {
  const a = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
  const half = Math.tan(FOV / 2);
  return { x: (2 * WATCH_SCREEN.x - 1) * half * a * WATCH_DEPTH, y: -(2 * WATCH_SCREEN.y - 1) * half * WATCH_DEPTH, z: WATCH_DEPTH };
}

export function watchLoweredFor(aspect: number): { x: number; y: number; z: number } {
  const h = watchHoldFor(aspect);
  return { x: h.x, y: h.y - WATCH_DROP, z: h.z };
}

export type WatchInput = { dt: number; want: boolean; hidden: boolean; speed: number; sprinting: boolean; yaw: number; pitch: number; clear: number; aspect: number };

export function newWatchState(): HandState {
  return newHandState();
}

export function newWatchPose(): HandPose {
  const low = watchLoweredFor(1.6);
  const pose = newHandPose();
  pose.x = low.x;
  pose.y = low.y;
  pose.z = low.z;
  pose.roll = WATCH_ROLL;
  return pose;
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

/** Steps the arm's state by a frame and writes the pose. Allocates nothing. */
export function stepWatch(s: HandState, i: WatchInput, out: HandPose): HandPose {
  const dt = Math.min(Math.max(i.dt, 0), 0.1);
  if (i.hidden) s.raise = 0;
  else if (i.want) s.raise = Math.min(1, s.raise + dt / WATCH_RAISE_SECONDS);
  else s.raise = Math.max(0, s.raise - dt / WATCH_LOWER_SECONDS);
  if (!s.started) {
    s.lastYaw = i.yaw;
    s.lastPitch = i.pitch;
    s.started = true;
  }
  const dYaw = wrap(i.yaw - s.lastYaw);
  const dPitch = i.pitch - s.lastPitch;
  s.lastYaw = i.yaw;
  s.lastPitch = i.pitch;
  s.lagYaw = Math.min(MAX_LAG, Math.max(-MAX_LAG, (s.lagYaw - dYaw * 0.7) * Math.exp(-dt * 11)));
  s.lagPitch = Math.min(MAX_LAG, Math.max(-MAX_LAG, (s.lagPitch - dPitch * 0.7) * Math.exp(-dt * 11)));
  s.walk += dt * i.speed * 2;
  s.breath += dt;
  const moving = Math.min(1, i.speed / 3.5) * (i.sprinting ? 0.6 : 1);
  const still = 1 - Math.min(1, i.speed / 1.2);
  const raised = smooth(s.raise);
  out.raised = raised;
  out.shown = s.raise > 0;
  const hold = watchHoldFor(i.aspect);
  let x = hold.x + Math.sin(s.walk + 1.6) * 0.004 * moving + Math.sin(s.breath * 0.8) * 0.0012 * still + s.lagYaw * 0.3;
  let y = hold.y + Math.sin(s.walk * 2 + 1) * 0.005 * moving + Math.sin(s.breath * 1.2 + 2) * 0.002 * still - s.lagPitch * 0.3;
  let z = hold.z;
  if (i.sprinting) y -= 0.02;
  const pull = RETRACT_LEAST + (1 - RETRACT_LEAST) * Math.min(1, Math.max(0, i.clear));
  x *= pull;
  y *= pull;
  z *= pull;
  const low = watchLoweredFor(i.aspect);
  out.x = low.x + (x - low.x) * raised;
  out.y = low.y + (y - low.y) * raised;
  out.z = low.z + (z - low.z) * raised;
  out.mx = WATCH_AXIS[0];
  out.my = WATCH_AXIS[1];
  out.mz = WATCH_AXIS[2];
  out.ax = out.mx;
  out.ay = out.my;
  out.az = out.mz;
  out.roll = WATCH_ROLL + Math.sin(s.walk) * 0.02 * moving * raised;
  return out;
}

/**
 * The four corners of the lit screen's bounding square, projected to a view of this aspect, into `out` (eight numbers: x across the view from the left, y down it from the top, 0 to 1, in
 * the order top left, top right, bottom right, bottom left as the wearer reads the face), from the mesh's basis (`torchBasis` stood for the left file by `watchMeshBasis`, scaled by `ARM_SCALE`). Corners behind the eye are left at 0.
 */
export function watchQuad(pose: HandPose, basis: ArrayLike<number>, aspect: number, out: Float32Array | number[]): void {
  const half = Math.tan(FOV / 2);
  for (let k = 0; k < 4; k++) {
    const p = SCREEN_CORNERS[k] as readonly [number, number, number];
    const x = pose.x + (basis[0] as number) * p[0] + (basis[3] as number) * p[1] + (basis[6] as number) * p[2];
    const y = pose.y + (basis[1] as number) * p[0] + (basis[4] as number) * p[1] + (basis[7] as number) * p[2];
    const z = pose.z + (basis[2] as number) * p[0] + (basis[5] as number) * p[1] + (basis[8] as number) * p[2];
    if (z <= 0.05) {
      out[k * 2] = 0;
      out[k * 2 + 1] = 0;
      continue;
    }
    out[k * 2] = 0.5 + x / z / (half * aspect) / 2;
    out[k * 2 + 1] = 0.5 - y / z / half / 2;
  }
}

/**
 * The corners of the lit screen's bounding square, top left, top right, bottom right, bottom left as the wearer reads the face, in the mesh's own frame as the loader stands it: the
 * file's (x, y, z) at (-x, y, z). From `hands.json` (`hand.left.glb`'s `watch.screen_corners`, in the file's frame, z out of the face).
 */
export const SCREEN_CORNERS: readonly (readonly [number, number, number])[] = LEFT.watch === undefined ? [] : LEFT.watch.screen_corners.map((c) => [-(c[0] as number), c[1] as number, c[2] as number] as const);

/**
 * The mesh's axes from `torchBasis`'s (right, up, forward: nine numbers, columns), for the left file as the loader stands it: the mesh's x runs from the fingers back toward the elbow (the
 * file's +x, toward three o'clock, is the fingers' way, mirrored), its y toward twelve and its z out of the face. In the pose, forward is the way the forearm runs toward the fingers and
 * up is the face's normal (turned to the eye by the roll), and twelve o'clock is to the left of the face as it reads (the old frame's -x): so x is -forward, y is -right, z is up.
 */
export function watchMeshBasis(b: ArrayLike<number>, out: Float64Array | number[]): void {
  out[0] = -(b[6] as number); out[1] = -(b[7] as number); out[2] = -(b[8] as number);
  out[3] = -(b[0] as number); out[4] = -(b[1] as number); out[5] = -(b[2] as number);
  out[6] = b[3] as number; out[7] = b[4] as number; out[8] = b[5] as number;
}
