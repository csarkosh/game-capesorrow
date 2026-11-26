/**
 * The car's headlights: the engine has one lamp, the walker's own, and while the local player is seated in a car with its lights on that
 * lamp is moved to the car's nose. Its direction is a unit vector (`dx, dy, dz`), as the engine's camera forward is: (sin yaw cos pitch, -sin pitch,
 * cos yaw cos pitch), so a heading of (hx, hz) is a yaw of atan2(hx, hz).
 */
import type { RenderLamp } from "@csarkosh/engine/game/lite/renderGame";
import { SEATED, type Ride } from "../../sim/car/types.js";

/** How far ahead of the car's centre the lamp stands, how far above the car's wheels' plane, how far the beam points down (rise per metre along), and how far it reaches, metres. */
export const HEADLIGHT_AHEAD = 2.3, HEADLIGHT_UP = 0.65, HEADLIGHT_DROP = 0.08, HEADLIGHT_RANGE = 40;

const NORM = 1 / Math.sqrt(1 + HEADLIGHT_DROP * HEADLIGHT_DROP);

/** Places the lamp at the car's nose as the car is drawn, pointing along its heading and a little down. The lamp's cone angle is left as it was. */
export function placeHeadlights(pose: { x: number; y: number; z: number; hx: number; hz: number }, at: RenderLamp["at"]): void {
  at.x = pose.x + pose.hx * HEADLIGHT_AHEAD;
  at.y = pose.y + HEADLIGHT_UP;
  at.z = pose.z + pose.hz * HEADLIGHT_AHEAD;
  at.dx = pose.hx * NORM;
  at.dy = -HEADLIGHT_DROP * NORM;
  at.dz = pose.hz * NORM;
  at.range = HEADLIGHT_RANGE;
}

/** Whether the lamp is the car's, and lit: the player is seated in a car (any seat) whose lights are on. */
export function litFor(ride: Ride | undefined, car: { lights: boolean } | null): boolean {
  return ride !== undefined && ride.phase === SEATED && car !== null && car.lights;
}
