/**
 * Where the car starts, and a new car: at the curb nearest the plan's spawn, lying along its street, a pure function of the
 * world's seed.
 *
 * Simulation code: `+ - * /`, `abs`, `min`, `max`, `sqrt` only.
 */
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { baseGround, withDecks } from "../town/decks.js";
import { planFor } from "../town/planFor.js";
import { withTrestles } from "../town/railDeck.js";
import { siteFor } from "../town/siteFor.js";
import { constrainCircle } from "../town/solid.js";
import { withStreets } from "../town/streetField.js";
import { CAR_CIRCLES, CAR_RADIUS, wheelPoints } from "./body.js";
import { HULL_RADIUS } from "../town/hull.js";
import { CAR_LENGTH, CAR_WIDTH } from "./tuning.js";
import type { Car } from "./types.js";

const abs = Math.abs;
const max = Math.max;
const min = Math.min;
const sqrt = Math.sqrt;

/** How far inside the curb the car's centre line lies, metres. */
const CURB_INSET = 1.2;
/** The steps along the street that are tried, metres, and how far either way. */
const STEP = 6.5, REACH = 78;

/** The ground the game is walked on: the engine's with the streets' trough filled, the harbour's decks and the railroad's trestles laid over it. */
export function walkGround(seed: number): GroundField {
  return withTrestles(withDecks(withStreets(baseGround(seed), seed), seed), seed);
}

const WHEELS = new Float64Array(8);
const POS = { x: 0, y: 0, z: 0 };
const VEL = { x: 0, y: 0, z: 0 };

/** Whether the car's three circles at (x, z) heading (hx, hz) touch no building and no prop, and its footprint stays a hull's radius from the spawn at (spawnX, spawnZ). */
function clear(seed: number, x: number, z: number, hx: number, hz: number, spawnX: number, spawnZ: number): boolean {
  // The spawn in the car's own axes: along the heading, and to the right of it ((hz, -hx)).
  const dx = spawnX - x;
  const dz = spawnZ - z;
  const eu = max(0, abs(dx * hx + dz * hz) - CAR_LENGTH / 2);
  const ev = max(0, abs(dx * hz - dz * hx) - CAR_WIDTH / 2);
  if (eu * eu + ev * ev < HULL_RADIUS * HULL_RADIUS) return false;
  for (let i = 0; i < 3; i++) {
    const along = CAR_CIRCLES[i] as number;
    POS.x = x + hx * along;
    POS.y = 0;
    POS.z = z + hz * along;
    VEL.x = 0;
    VEL.y = 0;
    VEL.z = 0;
    if (constrainCircle(seed, POS, VEL, CAR_RADIUS)) return false;
  }
  return true;
}

/**
 * Where the car starts, in the world: at the curb nearest the plan's spawn. It lies along the nearest street of kind main,
 * street or avenue, 1.2 m inside the curb on the spawn's side, facing so that the curb is on its right. The places tried are
 * along the street from the spawn's foot, at 0, +6.5, -6.5, +13, -13 ... to 78 m either way: the first where the car's three
 * circles touch no building and no prop and whose footprint stays a hull's radius from the spawn. If none, the spawn's foot on the street's centre line.
 */
export function carStart(seed: number): { x: number; z: number; hx: number; hz: number } {
  const { anchor } = siteFor(seed);
  const plan = planFor(seed);
  const spawn = plan.spawn;
  let best = -1;
  let bestD2 = Infinity;
  let bestLen = 0;
  let bestFoot = 0;
  for (let i = 0; i < plan.streets.length; i++) {
    const st = plan.streets[i]!;
    if (st.kind !== "main" && st.kind !== "street" && st.kind !== "avenue") continue;
    const ex = st.b.x - st.a.x;
    const ez = st.b.z - st.a.z;
    const len = sqrt(ex * ex + ez * ez);
    if (len === 0) continue;
    const s = max(0, min(len, ((spawn.x - st.a.x) * ex + (spawn.z - st.a.z) * ez) / len));
    const fx = st.a.x + ex / len * s - spawn.x;
    const fz = st.a.z + ez / len * s - spawn.z;
    const d2 = fx * fx + fz * fz;
    if (d2 < bestD2) {
      best = i;
      bestD2 = d2;
      bestLen = len;
      bestFoot = s;
    }
  }
  if (best < 0) return { x: anchor.x + spawn.x, z: anchor.z + spawn.z, hx: 1, hz: 0 };
  const st = plan.streets[best]!;
  const dx = (st.b.x - st.a.x) / bestLen;
  const dz = (st.b.z - st.a.z) / bestLen;
  // The street's left, and the side of the centre line the spawn is on: the curb on that side is the car's right.
  const footX = st.a.x + dx * bestFoot;
  const footZ = st.a.z + dz * bestFoot;
  const side = (spawn.x - footX) * -dz + (spawn.z - footZ) * dx < 0 ? -1 : 1;
  const nx = -dz * side;
  const nz = dx * side;
  const hx = -nz;
  const hz = nx;
  const inset = st.roadway / 2 - CURB_INSET;
  const last = REACH / STEP;
  for (let k = 0; k <= 2 * last + 1; k++) {
    // 0, +1, -1, +2, -2 ... steps.
    const n = k === 0 ? 0 : (k % 2 === 1 ? (k + 1) / 2 : -k / 2);
    if (abs(n) > last) continue;
    const s = bestFoot + n * STEP;
    if (s < 0 || s > bestLen) continue;
    const x = anchor.x + st.a.x + dx * s + nx * inset;
    const z = anchor.z + st.a.z + dz * s + nz * inset;
    if (clear(seed, x, z, hx, hz, anchor.x + spawn.x, anchor.z + spawn.z)) return { x, z, hx, hz };
  }
  return { x: anchor.x + footX, z: anchor.z + footZ, hx, hz };
}

/** Stands the car on the ground under its wheels, as a tick does. */
export function groundCar(ground: GroundField | null, car: Car): void {
  const w = WHEELS;
  wheelPoints(car, w);
  let sum = 0;
  for (let i = 0; i < 8; i += 2) sum += ground === null ? 0 : ground.heightAt(w[i] as number, w[i + 1] as number);
  car.y = sum / 4;
}

/** A car at rest at its start, with its lamps off and every seat empty. */
export function newCar(seed: number, id: number): Car {
  const at = carStart(seed);
  const car: Car = {
    id, x: at.x, y: 0, z: at.z, hx: at.hx, hz: at.hz, speed: 0, slip: 0, steer: 0,
    controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, owed: 0, seats: [0, 0, 0, 0],
  };
  groundCar(walkGround(seed), car);
  return car;
}
