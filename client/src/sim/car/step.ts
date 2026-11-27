/**
 * One tick of the car on its own: what its controls and the ground under it do to its speed, its steering, its
 * heading and its place. It reads no world; the ground arrives as a `CarEnv` (the surface's top speed and grip,
 * and the slope along the heading).
 *
 * The car is a bicycle: the front wheels' angle (`steer`, as a tangent) and the speed give a turn rate. The car's
 * velocity is its own (the `speed` along the heading and the `slip` across it): a turn of the heading leaves the
 * velocity where it pointed, and the tyres then take the sideways part away at the rate the grip allows. While the
 * grip can take all of it the car goes where it points. When the turn asks for more than the grip, the front wheels
 * turn the nose by what the grip allows and a share of the excess, the rear cannot hold it, and the car slides with
 * its nose inside its path. The handbrake lets the rear go, so the car pivots and slides wide; sliding tyres hold
 * less than gripping ones and less again under power; and the steering turns the front wheels toward where the car
 * is going, which is what brings a slide straight.
 *
 * Simulation code: `+ - * /` and `sqrt`, `min`, `max`, `abs` only.
 */
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import type { Car, CarControls, CarEnv } from "./types.js";
import {
  ACCEL, BRAKE, CLIMB_MAX, COAST, COUNTER_FROM, COUNTER_MOST, COUNTER_STEER, GRAVITY, GRIP, HANDBRAKE, HANDBRAKE_GRIP,
  HAND_PIVOT, OVERSPEED_DRAG, POWER_SLIDE, REVERSE_ACCEL, REVERSE_TOP, SLIDE_FULL, SLIDE_GRIP, STEER_FADE, STEER_LOCK, STEER_RATE,
  STEER_RETURN, WHEELBASE, YAW_FOLLOW, YAW_FOLLOW_HAND,
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

/**
 * One tick of the car on its own: controls, speed, steering, heading, place. Mutates `car`. Reads no world.
 * Precondition: `env.top` is above 0 (the smallest top is the reverse's or the surfaces' own, never 0), and the heading is a unit vector.
 */
export function stepCar(car: Car, controls: CarControls, env: CarEnv): void {
  const dt = TICK_DT;
  const t = controls.throttle;

  // Steering: the lock narrows with speed; the wheels turn to it, and come back to centre faster. In a slide going forward they are
  // turned toward where the car is going as well (the slip over the speed is that direction's tangent), within the lock and by as
  // much as the ground gives the front wheels to pull with, unless the handbrake is on: a driver who pulls it is throwing the car round.
  // The lock is narrowed by how fast the car travels, sliding or not, so a slide that takes speed from along the heading opens no lock.
  const fade = (car.speed * car.speed + car.slip * car.slip) / (STEER_FADE * STEER_FADE);
  let target = controls.turn * STEER_LOCK / (1 + fade);
  if (car.speed > COUNTER_FROM && !controls.handbrake) {
    const counter = COUNTER_STEER * env.grip / (GRIP[PAVED] as number) * car.slip / car.speed;
    target += max(-COUNTER_MOST, min(COUNTER_MOST, counter));
    target = max(-STEER_LOCK, min(STEER_LOCK, target));
  }
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

  // The slope. A car at rest with no throttle stays at rest; a slope too steep to climb only slows a car moving forward.
  if (!(speed === 0 && t === 0)) {
    speed -= GRAVITY * env.slope * dt;
    if (env.slope > CLIMB_MAX && before >= 0 && speed > before) speed = before;
  }
  car.speed = speed;

  // What the tyres hold. Sliding tyres hold less than gripping ones, the driven rear less again under power, and the handbrake lets the rear go.
  const sliding = min(abs(car.slip) / SLIDE_FULL, 1);
  const front = env.grip * (1 - (1 - SLIDE_GRIP) * sliding);
  let rear = front;
  if (t > 0) rear *= 1 - POWER_SLIDE * t * sliding;
  if (controls.handbrake) rear *= HANDBRAKE_GRIP;

  // Turning. The front wheels turn the nose by what they hold of the turn asked for, and by a share of the excess; with the handbrake
  // on the car pivots on them, the rear swinging round.
  let turnRate = speed * car.steer / WHEELBASE;
  if (controls.handbrake) turnRate *= HAND_PIVOT;
  const demand = abs(speed * turnRate);
  if (demand > front) {
    const follow = controls.handbrake ? YAW_FOLLOW_HAND : YAW_FOLLOW;
    turnRate = turnRate * (front + (demand - front) * follow) / demand;
  }

  // The heading turns under the velocity, which stays where it pointed. The right of the heading is (hz, -hx).
  const vx = car.hx * speed + car.hz * car.slip;
  const vz = car.hz * speed - car.hx * car.slip;
  let hx = car.hx + car.hz * turnRate * dt;
  let hz = car.hz - car.hx * turnRate * dt;
  const length = sqrt(hx * hx + hz * hz);
  if (length > 0) {
    hx /= length;
    hz /= length;
  } else {
    // A car of no heading (which the wire refuses) is turned to +x rather than to NaN.
    hx = 1;
    hz = 0;
  }
  car.hx = hx;
  car.hz = hz;
  const along = vx * hx + vz * hz;
  let slip = vx * hz - vz * hx;

  // The rear tyres take the sideways part away: all of it while they hold it. What is left is the slide.
  slip = toZero(slip, rear * dt);
  // A car that was at rest along its heading stays so (the slope's rule above), and one with no slide keeps the speed it had: a turn the tyres hold costs none.
  car.speed = slip === 0 ? speed : along;
  car.slip = slip;
  car.x += (hx * car.speed + hz * slip) * dt;
  car.z += (hz * car.speed - hx * slip) * dt;

  car.controls = { throttle: controls.throttle, turn: controls.turn, handbrake: controls.handbrake };
}
