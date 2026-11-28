/**
 * What the map is told each frame about the local player: where they are and which way they face, whether they sit in a car (and then
 * which way its nose points), the room they are in, the hour, and whether play has the controls. The session's half hands it to the
 * HUD, which hands it to the minimap; this is the one place that reads the simulation's records for the map.
 */
import { INSIDE, GOING_OUT } from "../../sim/inside/rooms.js";
import { SEATED, type Car } from "../../sim/car/types.js";
import type { Walker } from "../../sim.js";

export type MapFrame = {
  seed: number;
  x: number;
  z: number;
  /** The angle of the vector (sin, cos) the player faces, or the car's nose when driving. */
  heading: number;
  driving: boolean;
  /** The id of the room the player stands in, or 0 in the street. */
  place: number;
  hour: number;
  /** Play has the controls (the game is not paused). */
  engaged: boolean;
  /** The screen is a touch screen: a tap on the map opens it. */
  touch: boolean;
  /** The local player's round trip to the host in milliseconds (0 for the host), or null where it is not known. */
  rtt: number | null;
};

const frame: MapFrame = { seed: 0, x: 0, z: 0, heading: 0, driving: false, place: 0, hour: 12, engaged: true, touch: false, rtt: null };

/**
 * The frame for the local player, or null where there is nothing to show (no player, or no world to name a seed). The record returned is
 * reused by the next call: it is read at once and not kept.
 */
export function mapFrameFor(seed: number | null, cars: readonly Car[], self: Walker | undefined, hour: number, engaged: boolean, touch: boolean, rtt: number | null = null): MapFrame | null {
  if (self === undefined || seed === null) return null;
  let car: Car | undefined;
  if (self.ride.phase === SEATED) {
    for (let i = 0; i < cars.length; i++) if ((cars[i] as Car).id === self.ride.car) car = cars[i];
  }
  frame.seed = seed;
  frame.driving = car !== undefined;
  frame.x = car === undefined ? self.pos.x : car.x;
  frame.z = car === undefined ? self.pos.z : car.z;
  frame.heading = car === undefined ? self.yaw : Math.atan2(car.hx, car.hz);
  const ph = self.inside.phase;
  frame.place = ph === INSIDE || ph === GOING_OUT ? self.inside.place : 0;
  frame.hour = hour;
  frame.engaged = engaged;
  frame.touch = touch;
  frame.rtt = rtt;
  return frame;
}
