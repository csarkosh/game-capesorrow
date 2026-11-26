/**
 * One tick of the car on its own: what its controls and the ground under it do to its speed, its steering, its
 * heading and its place. It reads no world; the ground arrives as a `CarEnv` (the surface's top speed and grip,
 * and the slope along the heading).
 *
 * The car is a bicycle: the front wheels' angle (`steer`, as a tangent) and the speed give a turn rate. When the
 * sideways demand of that turn passes the grip, the turn is held to what the grip allows and the excess goes into
 * `slip`, which carries the car outward and dies away on its own.
 *
 * Simulation code: `+ - * /` and `sqrt`, `min`, `max`, `abs` only.
 */
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import type { Car, CarControls, CarEnv } from "./types.js";
import {
  ACCEL, BRAKE, CLIMB_MAX, COAST, GRAVITY, GRIP, HANDBRAKE, HANDBRAKE_GRIP, OVERSPEED_DRAG, REVERSE_ACCEL,
  REVERSE_TOP, SLIP_DECAY, STEER_FADE, STEER_LOCK, STEER_RATE, STEER_RETURN, WHEELBASE,
} from "./tuning.js";
import { PAVED } from "./types.js";

const abs = Math.abs;
const min = Math.min;
const max = Math.max;
const sqrt = Math.sqrt;

/** `value` moved toward zero by `amount`, stopping at zero. */
function toZero(value: number, amount: number): number {
  return value > 0 ? max(value - amount, 0) : min(value + amount, 0);
}

/** `value` moved toward `target` by at most `amount`. */
function toward(value: number, target: number, amount: number): number {
  return value < target ? min(value + amount, target) : max(value - amount, target);
}

/** One tick of the car on its own: controls, speed, steering, heading, place. Mutates `car`. Reads no world. */
export function stepCar(car: Car, controls: CarControls, env: CarEnv): void {
  const dt = TICK_DT;
  const t = controls.throttle;

  // Steering: the lock narrows with speed; the wheels turn to it, and come back to centre faster.
  const ratio = car.speed / STEER_FADE;
  const target = controls.turn * STEER_LOCK / (1 + ratio * ratio);
  const rate = abs(target) < abs(car.steer) ? STEER_RETURN : STEER_RATE;
  car.steer = toward(car.steer, target, rate * dt);

  // Along the heading.
  const before = car.speed;
  let speed = before;
  if (t > 0 && speed > -0.5) {
    speed += max(ACCEL * t * (1 - speed / env.top), 0) * dt;
  } else if (t < 0 && speed > 0.5) {
    speed = max(speed - BRAKE * -t * dt, 0);
  } else if (t < 0) {
    speed = min(speed, max(speed - REVERSE_ACCEL * -t * dt, -REVERSE_TOP));
  } else if (t > 0) {
    speed = min(speed + BRAKE * t * dt, 0);
  } else {
    speed = toZero(speed, COAST * dt);
  }
  if (controls.handbrake) speed = toZero(speed, HANDBRAKE * dt);
  if (speed > env.top) speed = max(speed - OVERSPEED_DRAG * dt, env.top);

  // The slope. A car at rest with no throttle stays at rest; a slope too steep to climb only slows the car.
  if (!(speed === 0 && t === 0)) {
    speed -= GRAVITY * env.slope * dt;
    if (env.slope > CLIMB_MAX && speed > before) speed = max(before, 0);
  }
  car.speed = speed;

  // Turning, held to the grip: what the grip cannot hold goes into slip, outward.
  let turnRate = speed * car.steer / WHEELBASE;
  const demand = abs(speed * turnRate);
  const limit = env.grip * (controls.handbrake ? HANDBRAKE_GRIP : 1);
  let slip = car.slip;
  if (demand > limit) {
    const outward = turnRate > 0 ? -1 : 1;
    slip += outward * (demand - limit) * dt;
    turnRate = turnRate * limit / demand;
  }
  const keep = 1 - SLIP_DECAY * env.grip / (GRIP[PAVED] as number) * dt;
  car.slip = slip * max(keep, 0);

  // Heading and place. The right of the heading is (hz, -hx).
  const rightX = car.hz;
  const rightZ = -car.hx;
  let hx = car.hx + rightX * turnRate * dt;
  let hz = car.hz + rightZ * turnRate * dt;
  const length = sqrt(hx * hx + hz * hz);
  hx /= length;
  hz /= length;
  car.hx = hx;
  car.hz = hz;
  car.x += (hx * speed + rightX * car.slip) * dt;
  car.z += (hz * speed + rightZ * car.slip) * dt;

  car.controls = { throttle: controls.throttle, turn: controls.turn, handbrake: controls.handbrake };
}
