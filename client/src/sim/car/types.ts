/**
 * The car's records: what a car is, what drives it, what the ground under it says, and how a player rides it.
 *
 * Simulation code: plain data only, with no behaviour of its own.
 */

/** What a wheel runs on: the car's top speed and grip come from it. */
export type Surface = 0 | 1 | 2 | 3;
export const PAVED = 0, GRAVEL = 1, TRACKS = 2, OPEN = 3;

/** What the driver asks of the car in one tick. `throttle` and `turn` are in [-1, 1]; a positive `turn` is to the right. */
export type CarControls = { throttle: number; turn: number; handbrake: boolean };

export type Car = {
  id: number;
  /** The footprint's centre, on the wheels' plane. */
  x: number; y: number; z: number;
  /** The heading, a unit vector in plan. */
  hx: number; hz: number;
  /** Along the heading, m/s; negative in reverse. */
  speed: number;
  /** Sideways, m/s; positive to the right of the heading. */
  slip: number;
  /** The tangent of the front wheels' angle; positive to the right. */
  steer: number;
  /** The controls last taken. */
  controls: CarControls;
  lights: boolean;
  /** The driver's commands the car has already stepped for in advance, taken in its place when they arrive: 0 to `OWED_MAX`. */
  owed: number;
  /** Player ids by seat, 0 for empty; seat 0 drives. */
  seats: [number, number, number, number];
};

/** What the ground under the car allows: top speed (m/s), sideways grip (m/s²) and the slope along the heading (rise over run). */
export type CarEnv = { top: number; grip: number; slope: number };

/** Where a player is in relation to a car: on foot, getting in, seated, getting out. */
export const FOOT = 0, ENTERING = 1, SEATED = 2, LEAVING = 3;
export type Ride = { car: number; seat: number; phase: 0 | 1 | 2 | 3; ticks: number };
