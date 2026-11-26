/**
 * Every number the car's motion and its riding are tuned by. The body's are the sedan's
 * (`vehicle.sedan_a` in `client/assets/models/vehicles.json`); the rest are chosen so the car gathers speed in
 * about 8 s to 25 m/s, stops from 30 m/s in about 50 m, and turns in a circle of about 4.3 m at a crawl.
 *
 * Simulation code: constants only.
 */

/** The body, metres. The axles' places are along the heading from the footprint's centre. */
export const CAR_LENGTH = 5.001, CAR_WIDTH = 1.834, CAR_HEIGHT = 1.349;
export const AXLE_FRONT = 1.434, AXLE_REAR = -1.218, WHEELBASE = 2.652, TRACK = 1.464, WHEEL_RADIUS = 0.303;

/** Top speed (m/s) and sideways grip (m/s²), each by `Surface`. */
export const TOP_SPEED: readonly number[] = [30, 20, 12, 6];
export const GRIP: readonly number[] = [8.3, 5.4, 4.9, 3.9];
/** The most speed (m/s) the car is let reach on any surface: the speed the world is known to keep up with, apart from the surfaces' own speeds. Raise it when the world is made ahead of travel. */
export const SPEED_CAP = 10;

/** Along the heading, m/s²: the engine at full throttle from rest, the brake, rolling resistance, the handbrake's addition, and the drag on a car over its surface's top speed. */
export const ACCEL = 6.7, BRAKE = 9, COAST = 1.2, HANDBRAKE = 7, OVERSPEED_DRAG = 4;
/** Reverse: its top speed (m/s) and its acceleration (m/s²). The acceleration must stay above `GRAVITY * CLIMB_MAX` (4.41), so that reversing always frees a car from any ground the climb limit lets it be on. */
export const REVERSE_TOP = 6, REVERSE_ACCEL = 5;

/** Steering: the tangent of the full lock, the speed (m/s) at which the lock has fallen to half what it is at rest (it is divided by 1 + (v / fade)²), the rate the wheels turn to a target and the rate they return to centre, per second. */
export const STEER_LOCK = 0.625, STEER_FADE = 14, STEER_RATE = 2.2, STEER_RETURN = 3.5;

/** How fast sideways slip dies away on pavement (per second), the share of grip left with the handbrake on, gravity (m/s²), and the steepest slope (rise over run) the engine can climb. */
export const SLIP_DECAY = 3, HANDBRAKE_GRIP = 0.35, GRAVITY = 9.8, CLIMB_MAX = 0.45;

/** Water depth (m) at which the car stops; ticks to get in and out; how near a door a player must be (m); the most speed (m/s) a car may have for a player to get out. */
export const WADE = 0.3, ENTER_TICKS = 60, LEAVE_TICKS = 36, DOOR_REACH = 1.2, LEAVE_SPEED = 2;

/** The most driving steps (a tenth of a second) the car takes ahead of a driver's commands, on host ticks that have none; it bounds how far a late command can lag and how long a silent driver's last controls are kept. Past it the car brakes. */
export const OWED_MAX = 6;

/** How far the walker's feet may be from the car's wheel plane for a door to be used, metres. */
export const DOOR_HEIGHT = 1;

/** The bits of a player's input that ask to use the car and to switch its lamps. */
export const INTERACT_BIT = 16, LAMP_BIT = 32;
