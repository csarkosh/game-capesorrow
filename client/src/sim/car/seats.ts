/**
 * Where a car's seats and doors are. Seat 0 is the driver's (front left), 1 the front right, 2 the rear left, 3 the rear
 * right. A place is read from the car's footprint centre and its heading; the right of the heading is (hz, -hx).
 *
 * Simulation code: `+ - * /` only.
 */
import { CAR_WIDTH, DOOR_REACH } from "./tuning.js";
import type { Car } from "./types.js";

/** Each seat's place from the footprint's centre: metres along the heading, and to the right of it (negative is left). */
export const SEATS: readonly { readonly along: number; readonly right: number }[] = [
  { along: 0.2, right: -0.38 },
  { along: 0.2, right: 0.38 },
  { along: -0.75, right: -0.38 },
  { along: -0.75, right: 0.38 },
];

/** How high a seated player's hull centre stands over the car's wheels' plane, metres. */
export const SEAT_HEIGHT = 0.5;

/** How far outside the body a walker stands to use a door, metres. */
const DOOR_OUTSIDE = 0.5;

/** The seat's place in the world: where a seated player's hull centre is. */
export function seatPlace(car: Car, seat: number, out: { x: number; y: number; z: number }): void {
  const s = SEATS[seat] as { along: number; right: number };
  out.x = car.x + car.hx * s.along + car.hz * s.right;
  out.y = car.y + SEAT_HEIGHT;
  out.z = car.z + car.hz * s.along - car.hx * s.right;
}

/** Where a walker stands to use a seat's door: 0.5 m outside the body, beside the seat. */
export function doorPlace(car: Car, seat: number, out: { x: number; z: number }): void {
  const s = SEATS[seat] as { along: number; right: number };
  const side = s.right < 0 ? -1 : 1;
  const right = side * (CAR_WIDTH / 2 + DOOR_OUTSIDE);
  out.x = car.x + car.hx * s.along + car.hz * right;
  out.z = car.z + car.hz * s.along - car.hx * right;
}

const DOOR = { x: 0, z: 0 };

/** The seat whose door is nearest (x, z) and within `DOOR_REACH`, or -1. */
export function doorNear(car: Car, x: number, z: number): number {
  let best = -1;
  let bestD2 = DOOR_REACH * DOOR_REACH;
  for (let seat = 0; seat < 4; seat++) {
    doorPlace(car, seat, DOOR);
    const dx = x - DOOR.x;
    const dz = z - DOOR.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2 && (best < 0 || d2 < bestD2)) {
      best = seat;
      bestD2 = d2;
    }
  }
  return best;
}

/** The seat a walker at that door takes: the driver's if it is empty, else the door's own, else -1. */
export function seatFor(car: Car, door: number): number {
  if (car.seats[0] === 0) return 0;
  if (car.seats[door] === 0) return door;
  return -1;
}
