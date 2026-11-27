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
 *
 * **Where "behind" is.** Behind where the car is going, part of the way: in a slide the car's velocity points to one side of its nose, and the
 * camera comes round toward the velocity by `DRIFT_LOOK` of that angle, so the car is seen turned in the frame and the road it slides along
 * stays ahead. A car that has backed for `REVERSE_AFTER` seconds is followed from its nose, looking the way it goes, until it stops or goes
 * forward. While `look.behind` is held the view is turned half a circle at once, and back when it is let go.
 *
 * **Speed and hits.** How fast the car goes over the ground, as a share of the fastest it can (`CHASE_FAST`), eased, widens the lens by up to
 * `CHASE_FOV` and stands the camera up to `CHASE_PULL` further back. A fall in that speed too sudden for the brakes is a hit: it shakes the
 * view (a roll, and a little pitch and yaw, from a few sines of the camera's own clock) for about half a second.
 */
import { EYE_SNAP_M } from "@csarkosh/engine/game/eyeBlend";
import type { CameraPose } from "@csarkosh/engine/game/lite/cameraPose";
import { CAR_HEIGHT, CAR_LENGTH, CAR_WIDTH, ENTER_TICKS, LEAVE_TICKS, SPEED_CAP, TOP_SPEED } from "../../sim/car/tuning.js";
import { ENTERING, FOOT, LEAVING, PAVED, SEATED } from "../../sim/car/types.js";
import type { CarPose } from "./carPose.js";

/** The camera's distance from the aim point and its height over the car at rest (m); the aim point's height over the car's place (m). */
export const CHASE_BACK = 3.25, CHASE_UP = 1.95, CHASE_AIM = 1.5;
/** How fast the followed point closes on the car, and the biases on their way, per second; the seconds of a still mouse before they ease. */
export const CHASE_LAG = 10, CHASE_RETURN = 2.5, CHASE_IDLE = 2;
/** The nearest the camera is drawn in to by a wall (m); the widest the lens grows (rad) and the furthest back the camera is stood (m), both at `CHASE_FAST`. */
export const CHASE_MIN = 1.5, CHASE_FOV = 0.15, CHASE_PULL = 0.7;
/** The speed over the ground (m/s) at which the lens is widest and the camera furthest back: the fastest the car can go, so the top of its range reads as fast whatever that is. */
export const CHASE_FAST = Math.min(TOP_SPEED[PAVED] as number, SPEED_CAP);
/** How fast the speed's share is followed, per second: the lens and the distance take about half a second to answer, so a hit does not snap them. */
const FAST_RATE = 2.2;
/** The share of the angle between the car's nose and its velocity the camera comes round by, and the forward speed (m/s) above which it does. */
export const DRIFT_LOOK = 0.55, DRIFT_FROM = 2;
/** The backward speed (m/s) that counts as backing, the seconds of it before the camera goes to the nose, and the seconds it stays there once the backing stops. */
export const REVERSE_FROM = 1.2, REVERSE_AFTER = 0.7, REVERSE_KEEP = 0.6;
/** A hit: the most the brakes and a slide take off the speed (m/s²), the fall beyond it that shakes the view fully (m/s), and how fast the shake dies (per second). */
export const HIT_BRAKING = 22, HIT_FULL = 7, HIT_FADE = 1.8;
/** The shake at its fullest, rad: the roll, and the pitch and yaw. */
export const SHAKE_ROLL = 0.022, SHAKE_TURN = 0.012;
/** How fast the camera comes back out after a wall or a parked vehicle has drawn it in, m/s: it takes a second to win back three metres, slow enough that a street of parked cars does not make it pump, quick enough to be clear of the thing once the car is past. */
export const CHASE_RELEASE = 4;

/** The pitch (held to) that puts the camera `CHASE_UP` over the car with the aim `CHASE_AIM` over it: about 0.14 rad down. */
const REST_PITCH = Math.asin((CHASE_UP - CHASE_AIM) / CHASE_BACK);
/** The pitch the camera's look is held to, rad. */
const PITCH_LOW = -0.1, PITCH_HIGH = 1.0;
/** The line from the aim point to the camera is tested this often (m), and the camera stops this short of what it meets (m). */
const STEP = 0.5, SHORT = 0.3, HALVINGS = 5;
/** The camera stays this far over the ground (m). */
const GROUND_CLEAR = 0.4;
/** How far over the drawn ground a point of the camera's sweep must stand to be clear of it, metres. */
export const GROUND_BLOCK = 0.1;

/** Whether a point of the camera's sweep stands under the drawn ground (with `GROUND_BLOCK` to spare), so that a crest in the way hides the car. Pure; allocates nothing. */
export function underGround(groundAt: (x: number, z: number) => number, x: number, y: number, z: number): boolean {
  return y < groundAt(x, z) + GROUND_BLOCK;
}
/** The most one step's seconds count for. */
const DT_MAX = 1;
const TWO_PI = Math.PI * 2;

export type Chase = {
  tx: number; ty: number; tz: number; yawBias: number; pitchBias: number; idle: number; lastYaw: number; lastPitch: number; started: boolean;
  /** How far from the aim point the camera stood this step: `CHASE_BACK` (and up to `CHASE_PULL` more at speed) when nothing was in the way. */
  back: number;
  /** The car's speed over the ground as a share of `CHASE_FAST`, eased: 0 to 1. */
  fast: number;
  /** The seconds the car has been backing, held to `REVERSE_AFTER + REVERSE_KEEP`. */
  backing: number;
  /** The shake left of a hit, 0 to 1; the camera's own clock, seconds; the car's speed over the ground at the last step. */
  hit: number; clock: number; ground: number;
};

export function newChase(): Chase {
  return { tx: 0, ty: 0, tz: 0, yawBias: 0, pitchBias: 0, idle: 0, lastYaw: 0, lastPitch: 0, started: false, back: CHASE_BACK, fast: 0, backing: 0, hit: 0, clock: 0, ground: 0 };
}

/** A number, or 0 for what is not one. */
function sane(value: number): number {
  return Number.isFinite(value) ? value : 0;
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
  c: Chase, car: CarPose, look: { yaw: number; pitch: number; behind?: boolean }, seated: number, dt: number,
  blocked: (x: number, y: number, z: number) => boolean, groundAt: (x: number, z: number) => number, eye: CameraPose, out: CameraPose,
): number {
  const step = dt > 0 ? (dt < DT_MAX ? dt : DT_MAX) : 0;
  // The followed point: at the car at the start and where the car has jumped, otherwise closing on it.
  // Written so that a distance that is not a number snaps too: a car place that was NaN for a frame must not hold the followed point there.
  if (!c.started || !(Math.hypot(car.x - c.tx, car.y - c.ty, car.z - c.tz) <= EYE_SNAP_M)) {
    c.tx = car.x;
    c.ty = car.y;
    c.tz = car.z;
    c.started = true;
    c.back = CHASE_BACK;
    c.yawBias = 0;
    c.pitchBias = 0;
    c.idle = 0;
    c.lastYaw = look.yaw;
    c.lastPitch = look.pitch;
    c.fast = 0;
    c.backing = 0;
    c.hit = 0;
    c.ground = sane(Math.hypot(car.speed, car.slip));
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
  // The car's speed over the ground: its share of the fastest it goes, eased, and a fall too sudden for the brakes, which is a hit.
  const ground = sane(Math.hypot(car.speed, car.slip));
  const lost = c.ground - ground - HIT_BRAKING * step;
  if (step > 0 && lost > 0) c.hit = Math.min(1, c.hit + lost / HIT_FULL);
  else c.hit = Math.max(0, c.hit - HIT_FADE * step);
  c.ground = ground;
  c.clock += step;
  c.fast += (Math.min(1, ground / CHASE_FAST) - c.fast) * (1 - Math.exp(-FAST_RATE * step));
  // Backing: counted while the car goes backward, forgotten at once when it goes forward, and run down when it stands.
  const along = sane(car.speed);
  if (along < -REVERSE_FROM) c.backing = Math.min(c.backing + step, REVERSE_AFTER + REVERSE_KEEP);
  else if (along > 0.5) c.backing = 0;
  else c.backing = Math.max(0, c.backing - step);
  const len = Math.hypot(car.hx, car.hz);
  const carYaw = len > 1e-6 ? Math.atan2(car.hx, car.hz) : look.yaw;
  // Behind where the car is going: toward its velocity in a slide (the right of the heading is a quarter turn on in yaw), and at its nose while it backs.
  let behindYaw = carYaw;
  if (len > 1e-6 && along > DRIFT_FROM) behindYaw += DRIFT_LOOK * sane(Math.atan2(car.slip, along));
  if (len > 1e-6 && c.backing >= REVERSE_AFTER) behindYaw += Math.PI;
  if (c.idle >= CHASE_IDLE) {
    const k = 1 - Math.exp(-CHASE_RETURN * step);
    // By the shorter way round from where the bias is, so a car that turns through the opposite of the mouse's yaw is followed on round.
    c.yawBias += wrap(behindYaw - look.yaw - c.yawBias) * k;
    c.pitchBias += (REST_PITCH - look.pitch - c.pitchBias) * k;
  }
  const yaw = look.yaw + c.yawBias + (look.behind === true ? Math.PI : 0);
  const pitch = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, look.pitch + c.pitchBias));
  // Behind the aim point along the look: forward is (sin yaw cos pitch, -sin pitch, cos yaw cos pitch).
  const ax = c.tx;
  const ay = c.ty + CHASE_AIM;
  const az = c.tz;
  const bx = -Math.sin(yaw) * Math.cos(pitch);
  const by = Math.sin(pitch);
  const bz = -Math.cos(yaw) * Math.cos(pitch);
  // The nearest blocked sample along the line, 0.5 m apart and one at its end; the camera stops 0.3 m short of it and never nearer than `CHASE_MIN`.
  // Where the line first meets something is refined by bisection between the blocked sample and the clear one before it, so the distance moves
  // smoothly as the car passes a box and not in steps of the sampling.
  // At speed the camera stands further back.
  const reach = CHASE_BACK + CHASE_PULL * c.fast;
  let swept = reach;
  for (let from = 0; from < reach; from += STEP) {
    const d = Math.min(from + STEP, reach);
    if (blocked(ax + bx * d, ay + by * d, az + bz * d)) {
      let lo = from;
      let hi = d;
      for (let n = 0; n < HALVINGS; n++) {
        const mid = (lo + hi) / 2;
        if (blocked(ax + bx * mid, ay + by * mid, az + bz * mid)) hi = mid;
        else lo = mid;
      }
      swept = Math.max(CHASE_MIN, hi - SHORT);
      break;
    }
  }
  // The distance shown goes in at once (the camera is never seen inside a thing) and comes back out at `CHASE_RELEASE`.
  const back = swept <= c.back ? swept : Math.min(swept, c.back + CHASE_RELEASE * step);
  c.back = back;
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
  // A hit shakes the view: three sums of sines of the camera's clock, each within 1, by the square of what is left of the hit.
  if (c.hit > 0) {
    const shake = c.hit * c.hit * s;
    const t = c.clock;
    out.roll += SHAKE_ROLL * shake * (Math.sin(t * 47) * 0.6 + Math.sin(t * 71 + 1.3) * 0.4);
    out.pitch += SHAKE_TURN * shake * (Math.sin(t * 53 + 0.7) * 0.6 + Math.sin(t * 83) * 0.4);
    out.yaw += SHAKE_TURN * shake * (Math.sin(t * 59 + 2.1) * 0.6 + Math.sin(t * 67 + 0.4) * 0.4);
  }
  return CHASE_FOV * c.fast * s;
}

/** The most the shown seat moves a second: faster than plain getting in (1 per second) and out (1.67), so those are followed exactly, and a refused leave comes back out in a quarter of a second. */
export const SEAT_RATE = 4;

/** How far into the seat a ride is, 0 to 1: `ticks` counts DOWN, so entering rises as it runs out and leaving falls. */
export function seatTarget(phase: number, ticks: number): number {
  if (phase === ENTERING) return Math.min(1, Math.max(0, 1 - ticks / ENTER_TICKS));
  if (phase === LEAVING) return Math.min(1, Math.max(0, ticks / LEAVE_TICKS));
  return phase === SEATED ? 1 : phase === FOOT ? 0 : 0;
}

/** The shown seat moved toward `target` by at most `SEAT_RATE * dt`, landing on it without passing it. */
export function seatStep(shown: number, target: number, dt: number): number {
  const most = SEAT_RATE * (dt > 0 ? dt : 0);
  const d = target - shown;
  return d > most ? shown + most : d < -most ? shown - most : target;
}

/**
 * What a prop's box counts for. The boxes (`propSolid.ts`) carry no height and no kind, only an oriented footprint, so the camera is stopped by
 * a box by its footprint: a box whose smaller half-extent is under `PROP_THIN_HALF` (so under 0.6 m across: a pole 0.42 m square, a fence panel 0.14 m
 * wide, a mailbox post) is let through, since a few centimetres of wood must not yank the camera in; any other (vehicles, trailers, bins of 0.7 m,
 * heavy gear) is a column `PROP_TOP` over the ground at the point. 4 m: the resting camera stands 1.95 m over the car's ground, and a street may
 * climb 15 percent (about 0.5 m over the 3.25 m of the line) so the ground at a sample differs from the car's by that much either way; 4 m keeps the
 * resting camera at least 1.5 m inside the column on any street, so a rise in the road or a small pitch of the mouse does not flip samples across
 * its top, while a camera pitched well up still looks over a parked car. `BOX_MARGIN` is the camera's own thickness.
 */
export const PROP_THIN_HALF = 0.3, PROP_TOP = 4, BOX_MARGIN = 0.2;

/** The numbers of a grid of boxes (`TownSolids`' own layout: six to a box, centre, along axis, half extents) and the cells that list them. */
export type BoxGrid = { x0: number; z0: number; cols: number; rows: number; start: Int32Array; list: Int32Array; rects: Float64Array };
const GRID_CELL = 16, GRID_STRIDE = 6;

/** Whether (x, z) is inside the oriented box at `o` of `rects`, widened by `margin`. */
export function inBox(rects: Float64Array, o: number, x: number, z: number, margin: number): boolean {
  const u = rects[o + 2] as number;
  const v = rects[o + 3] as number;
  const dx = x - (rects[o] as number);
  const dz = z - (rects[o + 1] as number);
  return Math.abs(dx * u + dz * v) < (rects[o + 4] as number) + margin && Math.abs(dx * v - dz * u) < (rects[o + 5] as number) + margin;
}

/**
 * Whether the point is in a box of the grid, a box with a half-extent under `thin` excepted and `top` (a height, metres) over it excepted, the buildings' (`thin` 0, `top` Infinity)
 * and the props' alike. Reads the one cell the point is in, and allocates nothing.
 */
export function boxBlocks(grid: BoxGrid, x: number, y: number, z: number, thin: number, top: number, margin: number): boolean {
  if (!(y < top)) return false;
  const c = Math.floor((x - grid.x0) / GRID_CELL);
  const r = Math.floor((z - grid.z0) / GRID_CELL);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
  const cell = r * grid.cols + c;
  const end = grid.start[cell + 1] as number;
  for (let k = grid.start[cell] as number; k < end; k++) {
    const o = (grid.list[k] as number) * GRID_STRIDE;
    if (Math.min(grid.rects[o + 4] as number, grid.rects[o + 5] as number) < thin) continue;
    if (inBox(grid.rects, o, x, z, margin)) return true;
  }
  return false;
}

/** Whether the point is inside any car but `skip`'s: its footprint turned by its heading, up to its roof. */
export function carBlocks(cars: readonly { id: number; x: number; y: number; z: number; hx: number; hz: number }[], skip: number, x: number, y: number, z: number): boolean {
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i] as (typeof cars)[number];
    if (car.id === skip || y >= car.y + CAR_HEIGHT + BOX_MARGIN || y < car.y - BOX_MARGIN) continue;
    const dx = x - car.x;
    const dz = z - car.z;
    if (Math.abs(dx * car.hx + dz * car.hz) < CAR_LENGTH / 2 + BOX_MARGIN && Math.abs(dx * car.hz - dz * car.hx) < CAR_WIDTH / 2 + BOX_MARGIN) return true;
  }
  return false;
}
