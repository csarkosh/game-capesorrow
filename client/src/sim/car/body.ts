/**
 * The car in the town's world: the ground under its four wheels, and what keeps it out of the buildings, the props,
 * the trees, off the edges of the piers and out of the sea. `driveCar` is one whole tick of it, a pure function of the
 * world's seed and the car (the world's boxes and ground are the seed's too): it runs on every machine, and in a
 * client's replay of past ticks.
 *
 * The car's footprint is three circles along its axis. Each is moved out of the town's solids (`constrainCircle`), out of
 * the forest's boxes that stand as walls, and held by the harbour's rails and the trestles' guard rails; a push moves
 * the whole car and takes the part of its velocity that points into the wall. A box whose top stands no more than
 * `CURB` over the ground at the circle is driven over, and so is one that begins above the car's roof.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only. The scratch objects are module-level and reused.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { boxesNear, type BoxProvider } from "@csarkosh/engine/sim/boxSource";
import type { Aabb } from "@csarkosh/engine/sim/level";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { waterLevelAt } from "@csarkosh/engine/sim/waters";
import { constrainRails } from "../town/decks.js";
import { constrainTrestle } from "../town/railDeck.js";
import { constrainCircle } from "../town/solid.js";
import { stepCar } from "./step.js";
import { surfaceAt } from "./surface.js";
import { AXLE_FRONT, AXLE_REAR, CAR_HEIGHT, CLIMB_MAX, GRIP, TOP_SPEED, TRACK, WADE, WHEELBASE } from "./tuning.js";
import type { Car, CarControls, CarEnv } from "./types.js";

const abs = Math.abs;
const min = Math.min;
const max = Math.max;
const sqrt = Math.sqrt;

/** What the car's world is made of: the seed's forest, its boxes and ground, and the sea level. */
export type CarWorld = {
  readonly forest: { readonly seed: number };
  readonly boxes: BoxProvider;
  readonly ground: GroundField | null;
  readonly waterLevel: number | null;
};

/** The car's three circles along its axis, from the footprint's centre: rear, middle, front, metres. */
export const CAR_CIRCLES: readonly number[] = [-1.58, 0, 1.58];
/** Each circle's radius, metres. */
export const CAR_RADIUS = 0.92;
/** How far a box's top may stand over the ground and still be driven over, metres. */
const CURB = 0.35;
/** What a push leaves between the circle and the box, metres. */
const CLEAR = 1e-6;
/** The passes a tick's pushes get. */
const PASSES = 4;

const POS = { x: 0, y: 0, z: 0 };
const VEL = { x: 0, y: 0, z: 0 };
const LOW = { x: 0, y: 0, z: 0 };
const HIGH = { x: 0, y: 0, z: 0 };
const WHEELS = new Float64Array(8);

/** The ground's height at (x, z); a world without a ground field is level. */
function heightAt(world: CarWorld, x: number, z: number): number {
  return world.ground === null ? 0 : world.ground.heightAt(x, z);
}

/** The four wheels' places in the world, x then z, front left, front right, rear left, rear right. */
export function wheelPoints(car: Car, out: Float64Array): void {
  // The right of the heading is (hz, -hx).
  const rx = car.hz;
  const rz = -car.hx;
  const half = TRACK / 2;
  const fx = car.x + car.hx * AXLE_FRONT;
  const fz = car.z + car.hz * AXLE_FRONT;
  const bx = car.x + car.hx * AXLE_REAR;
  const bz = car.z + car.hz * AXLE_REAR;
  out[0] = fx - rx * half;
  out[1] = fz - rz * half;
  out[2] = fx + rx * half;
  out[3] = fz + rz * half;
  out[4] = bx - rx * half;
  out[5] = bz - rz * half;
  out[6] = bx + rx * half;
  out[7] = bz + rz * half;
}

/** What the car's step needs of the ground under it: the four wheels' mean top speed and grip, and the rise along its heading between its axles. */
export function carEnv(world: CarWorld, car: Car): CarEnv {
  wheelPoints(car, WHEELS);
  const seed = world.forest.seed;
  let top = 0;
  let grip = 0;
  for (let i = 0; i < 8; i += 2) {
    const surface = surfaceAt(seed, WHEELS[i] as number, WHEELS[i + 1] as number);
    top += TOP_SPEED[surface] as number;
    grip += GRIP[surface] as number;
  }
  return { top: top / 4, grip: grip / 4, slope: slopeAlong(world, car) };
}

/** The rise along the car's heading between its axles, over the wheelbase. */
function slopeAlong(world: CarWorld, car: Car): number {
  const front = heightAt(world, car.x + car.hx * AXLE_FRONT, car.z + car.hz * AXLE_FRONT);
  const rear = heightAt(world, car.x + car.hx * AXLE_REAR, car.z + car.hz * AXLE_REAR);
  return (front - rear) / WHEELBASE;
}

/**
 * Moves the circle at `POS` out of the box `b` if it is a wall for it, taking the velocity's part into it away.
 * Returns whether it moved.
 */
function pushBox(world: CarWorld, b: Aabb, roof: number): boolean {
  const qx = max(b.min.x, min(b.max.x, POS.x));
  const qz = max(b.min.z, min(b.max.z, POS.z));
  const dx = POS.x - qx;
  const dz = POS.z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= CAR_RADIUS * CAR_RADIUS) return false;
  if (b.min.y >= roof || b.max.y <= heightAt(world, POS.x, POS.z) + CURB) return false;
  let nx: number;
  let nz: number;
  let push: number;
  if (d2 > 0) {
    const d = sqrt(d2);
    nx = dx / d;
    nz = dz / d;
    push = CAR_RADIUS - d + CLEAR;
  } else {
    // The centre is inside the box: out by its nearest side.
    const left = POS.x - b.min.x;
    const right = b.max.x - POS.x;
    const near = POS.z - b.min.z;
    const far = b.max.z - POS.z;
    const side = min(min(left, right), min(near, far));
    nx = 0;
    nz = 0;
    if (side === left) nx = -1;
    else if (side === right) nx = 1;
    else if (side === near) nz = -1;
    else nz = 1;
    push = side + CAR_RADIUS + CLEAR;
  }
  POS.x += nx * push;
  POS.z += nz * push;
  const into = VEL.x * nx + VEL.z * nz;
  if (into < 0) {
    VEL.x -= into * nx;
    VEL.z -= into * nz;
  }
  return true;
}

/** Runs the circle at `POS` through everything that keeps it out. Returns whether it moved. */
function settleCircle(world: CarWorld, seed: number, roof: number): boolean {
  let moved = constrainCircle(seed, POS, VEL, CAR_RADIUS);
  LOW.x = POS.x - CAR_RADIUS;
  LOW.y = POS.y - PLAYER_HALF.y - 1;
  LOW.z = POS.z - CAR_RADIUS;
  HIGH.x = POS.x + CAR_RADIUS;
  HIGH.y = roof;
  HIGH.z = POS.z + CAR_RADIUS;
  const near = boxesNear(world.boxes, LOW, HIGH);
  for (let i = 0; i < near.length; i++) {
    if (pushBox(world, near[i] as Aabb, roof)) moved = true;
  }
  if (constrainRails(seed, POS, VEL)) moved = true;
  if (constrainTrestle(seed, POS, VEL)) moved = true;
  return moved;
}

/** How far under the water the deepest of the four wheels' ground lies, metres (negative where every wheel is dry or there is no water). */
function deepestWheel(world: CarWorld, car: Car): number {
  wheelPoints(car, WHEELS);
  const watered = world as unknown as Parameters<typeof waterLevelAt>[0];
  let deepest = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const level = waterLevelAt(watered, WHEELS[i] as number, WHEELS[i + 1] as number);
    if (level !== null) deepest = max(deepest, level - heightAt(world, WHEELS[i] as number, WHEELS[i + 1] as number));
  }
  return deepest;
}

/** One whole tick of the car in the world: `carEnv`, `stepCar`, then out of every solid, held by rails, kept out of water and off ground too steep to climb, and stood on the ground. */
export function driveCar(world: CarWorld, car: Car, controls: CarControls): void {
  const seed = world.forest.seed;
  const startX = car.x;
  const startZ = car.z;
  const startHx = car.hx;
  const startHz = car.hz;
  const startSteer = car.steer;
  const startDepth = deepestWheel(world, car);
  const env = carEnv(world, car);
  stepCar(car, controls, env);

  // Out of the walls. The car's velocity in the world is along the heading and to the right of it.
  VEL.x = car.hx * car.speed + car.hz * car.slip;
  VEL.y = 0;
  VEL.z = car.hz * car.speed - car.hx * car.slip;
  const roof = car.y + CAR_HEIGHT;
  // The rails read a hull's feet: the car's are its highest wheel's ground, so that a wheel hanging over a deck's edge does not
  // lower the car under the deck's level, where a rail would take it for a hull in the water and put it out.
  wheelPoints(car, WHEELS);
  let feet = -Infinity;
  for (let i = 0; i < 8; i += 2) feet = max(feet, heightAt(world, WHEELS[i] as number, WHEELS[i + 1] as number));
  let pushed = false;
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < 3; i++) {
      const along = CAR_CIRCLES[i] as number;
      const cx = car.x + car.hx * along;
      const cz = car.z + car.hz * along;
      POS.x = cx;
      // A hull's centre stands the player's half height over its feet.
      POS.y = feet + PLAYER_HALF.y;
      POS.z = cz;
      if (settleCircle(world, seed, roof)) {
        car.x += POS.x - cx;
        car.z += POS.z - cz;
        moved = true;
      }
    }
    if (!moved) break;
    pushed = true;
  }
  if (pushed) {
    car.speed = VEL.x * car.hx + VEL.z * car.hz;
    car.slip = VEL.x * car.hz - VEL.z * car.hx;
  }

  // Out of the water: a move that leaves a wheel in over `WADE`, and deeper than the deepest wheel was where the tick began, is undone.
  // A car somehow in the water can always move toward shallower ground.
  const depth = deepestWheel(world, car);
  // Steep ground is a wall both ways: a move on to ground steeper than the climb limit, and steeper than where the tick began, is undone.
  // A move toward gentler ground is always allowed, so a car on steep ground can leave it.
  const now = abs(slopeAlong(world, car));
  const steep = now > CLIMB_MAX && now > abs(env.slope);
  if ((depth > WADE && depth > startDepth) || steep) {
    // The whole pose the tick began with, at rest: a start that passed the checks.
    car.x = startX;
    car.z = startZ;
    car.hx = startHx;
    car.hz = startHz;
    car.steer = startSteer;
    car.speed = 0;
    car.slip = 0;
  }
  wheelPoints(car, WHEELS);
  let sum = 0;
  for (let i = 0; i < 8; i += 2) sum += heightAt(world, WHEELS[i] as number, WHEELS[i + 1] as number);
  car.y = sum / 4;
}
