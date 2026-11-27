/**
 * What a car does to the things that give way (`sim/town/knockables.ts`): a sign, a trash can, a mailbox on a post. It is not stopped
 * by one and is not pushed out of it. On the tick its body comes to touch one it is slowed: it keeps a share of its speed over the
 * ground and loses a little more, by the thing's kind (`KNOCK_LOSS`), along its heading and across it alike, so a hit throws the car's
 * line no way but back. That is the whole of the rule, and it keeps nothing: the tick a car's body is over a thing it was not over as
 * the tick began is the tick of the hit, read from the car as the tick found it and as the tick leaves it. So `driveCar` is still a
 * pure function of the world's seed and the car, on the host, in a client's prediction and in its replay.
 *
 * What is not kept is whether the thing still stands. The drawing lays it down for a while (`game/town/knocked.ts`), and a car that
 * comes back over it while it lies there is slowed again, as by what is left of it in the road.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { KNOCK_CELL, KNOCK_LOSS, knockablesFor, type Knockable, type Knockables } from "../town/knockables.js";
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.js";
import type { Car } from "./types.js";

const abs = Math.abs;
const floor = Math.floor;
const max = Math.max;
const sqrt = Math.sqrt;

/** The least speed over the ground (m/s) at which a car knocks a thing down: under it the car is among them as it was, with no hit. */
export const KNOCK_FROM = 0.5;

/**
 * Whether a knockable touches a car's body standing at (x, z) with the heading (hx, hz). A round one: its circle and the body's
 * rectangle, the corners squared off. A long one: its box and the body's rectangle, which are apart when some axis of either parts them.
 */
export function touches(k: Knockable, x: number, z: number, hx: number, hz: number): boolean {
  const dx = k.x - x;
  const dz = k.z - z;
  if (!k.box) return abs(dx * hx + dz * hz) < CAR_LENGTH / 2 + k.r && abs(dx * hz - dz * hx) < CAR_WIDTH / 2 + k.r;
  // The body's axes are its heading and its right ((hz, -hx)); the box's are (ux, uz) and (uz, -ux).
  const along = hx * k.ux + hz * k.uz;
  const across = hz * k.ux - hx * k.uz;
  // On the body's two axes: the box's reach is its half extents turned onto them.
  if (abs(dx * hx + dz * hz) >= CAR_LENGTH / 2 + abs(along) * k.hu + abs(across) * k.hv) return false;
  if (abs(dx * hz - dz * hx) >= CAR_WIDTH / 2 + abs(across) * k.hu + abs(along) * k.hv) return false;
  // On the box's two axes: the body's reach, likewise.
  if (abs(dx * k.ux + dz * k.uz) >= k.hu + abs(along) * (CAR_LENGTH / 2) + abs(across) * (CAR_WIDTH / 2)) return false;
  if (abs(dx * k.uz - dz * k.ux) >= k.hv + abs(across) * (CAR_LENGTH / 2) + abs(along) * (CAR_WIDTH / 2)) return false;
  return true;
}

/**
 * Calls `each` with every knockable of the grid that touches a car's body at (x, z, hx, hz), in the list's order within a cell. One
 * cell is read, the car's own: a knockable is listed in every cell its reach touches, and a body's furthest corner is nearer its
 * centre than the reach.
 */
export function touching(grid: Knockables, x: number, z: number, hx: number, hz: number, each: (k: Knockable) => void): void {
  const c = floor((x - grid.x0) / KNOCK_CELL);
  const r = floor((z - grid.z0) / KNOCK_CELL);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return;
  const cell = r * grid.cols + c;
  const end = grid.start[cell + 1] as number;
  for (let i = grid.start[cell] as number; i < end; i++) {
    const k = grid.list[grid.ids[i] as number] as Knockable;
    if (touches(k, x, z, hx, hz)) each(k);
  }
}

/**
 * The hits of one tick: the car as the tick leaves it, against where it stood as the tick began. Each thing its body touches now and
 * did not then takes its share of the car's speed. Mutates `car.speed` and `car.slip`, and answers how many it hit.
 */
export function knockCar(worldSeed: number, car: Car, fromX: number, fromZ: number, fromHx: number, fromHz: number, grid: Knockables = knockablesFor(worldSeed)): number {
  if (grid.cols === 0) return 0;
  if (car.speed * car.speed + car.slip * car.slip < KNOCK_FROM * KNOCK_FROM) return 0;
  const c = floor((car.x - grid.x0) / KNOCK_CELL);
  const r = floor((car.z - grid.z0) / KNOCK_CELL);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return 0;
  const cell = r * grid.cols + c;
  const end = grid.start[cell + 1] as number;
  let hits = 0;
  for (let i = grid.start[cell] as number; i < end; i++) {
    const k = grid.list[grid.ids[i] as number] as Knockable;
    if (!touches(k, car.x, car.z, car.hx, car.hz) || touches(k, fromX, fromZ, fromHx, fromHz)) continue;
    const over = sqrt(car.speed * car.speed + car.slip * car.slip);
    if (over <= 0) break;
    const loss = KNOCK_LOSS[k.kind];
    const keep = max(over * (1 - loss[0]) - loss[1], 0) / over;
    car.speed *= keep;
    car.slip *= keep;
    hits++;
  }
  return hits;
}
