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
/** The most speed (m/s) the car is let reach, by place (`limit.ts`): `TOWN_SPEED` where the town covers the ground, `FULL_SPEED` past the town's last blocks, with the cover's own fade between; and `FULL_SPEED` on the highway's bed all the way through the town, easing down to the place's own over `HIGHWAY_SPEED_FADE` metres beside it. The limit is the speed the world is known to keep up with, apart from the surfaces' own speeds; raise `FULL_SPEED` as the world is made to keep up. */
export const TOWN_SPEED = 10;
export const FULL_SPEED = 15;
export const HIGHWAY_SPEED_FADE = 12;

/** Along the heading, m/s²: the engine at full throttle from rest, the brake, rolling resistance, the handbrake's addition, and the drag on a car over its surface's top speed. */
export const ACCEL = 6.7, BRAKE = 9, COAST = 1.2, HANDBRAKE = 4.5, OVERSPEED_DRAG = 4;
/** Reverse: its top speed (m/s) and its acceleration (m/s²). The acceleration must stay above `GRAVITY * CLIMB_MAX` (4.41), so that reversing always frees a car from any ground the climb limit lets it be on. */
export const REVERSE_TOP = 6, REVERSE_ACCEL = 5;

/** Steering: the tangent of the full lock, the speed (m/s) at which the lock has fallen to half what it is at rest (it is divided by 1 + (v / fade)²), the rate the wheels turn to a target and the rate they return to centre, per second. */
export const STEER_LOCK = 0.625, STEER_FADE = 14, STEER_RATE = 2.2, STEER_RETURN = 3.5;

/** The share of the rear's grip left with the handbrake on, gravity (m/s²), and the steepest slope (rise over run) the engine can climb. */
export const HANDBRAKE_GRIP = 0.35, GRAVITY = 9.8, CLIMB_MAX = 0.45;

/**
 * The slide. A turn that asks for more sideways acceleration than the grip turns the nose by the grip's share and by `YAW_FOLLOW` of the
 * excess (`YAW_FOLLOW_HAND` with the handbrake on, when the rear has let go and the car pivots on its front wheels); what the rear tyres
 * cannot hold of that is the slide. Sliding tyres hold less than gripping ones: the rear's hold falls to `SLIDE_GRIP` of the grip as the
 * slide grows to `SLIDE_FULL` (m/s), and by a further `POWER_SLIDE` at full throttle, so a slide is easier to keep than to start and the
 * throttle holds it.
 */
export const YAW_FOLLOW = 0.16, YAW_FOLLOW_HAND = 0.45, HAND_PIVOT = 1.2, SLIDE_GRIP = 0.8, SLIDE_FULL = 3, POWER_SLIDE = 0.25;
/**
 * The steering's own help in a slide: the front wheels are turned toward where the car is going by `COUNTER_STEER` of the slide's
 * tangent (the slip over the speed), above `COUNTER_FROM` m/s forward and by no more than `COUNTER_MOST` of a tangent, so letting go of
 * the wheel in a slide brings the car straight, and holding the turn keeps it.
 */
export const COUNTER_STEER = 1.5, COUNTER_FROM = 3, COUNTER_MOST = 0.25;

/** Water depth (m) at which the car stops; ticks to get in and out; how near a door a player must be (m); the most speed (m/s) a car may have for a player to get out. */
export const WADE = 0.3, ENTER_TICKS = 60, LEAVE_TICKS = 36, DOOR_REACH = 1.2, LEAVE_SPEED = 2;

/** The most driving steps (a tenth of a second) the car takes ahead of a driver's commands, on host ticks that have none; it bounds how far a late command can lag and how long a silent driver's last controls are kept. Past it the car brakes. */
export const OWED_MAX = 6;

/** How far the walker's feet may be from the car's wheel plane for a door to be used, metres. */
export const DOOR_HEIGHT = 1;

/** The bits of a player's input that ask to use the car and to switch its lamps. */
export const INTERACT_BIT = 16, LAMP_BIT = 32;
