/**
 * Which of the plan's parked vehicles the world holds. The plan's props stage puts a vehicle down where its box is free, but it cannot read
 * the made ground (the ground reads the plan), so a few of its vehicles stand where the ground under them is no plane: across a bank of
 * the made ground, a curb, the edge of a deck. A vehicle there would stand with a wheel in the air or in the ground, so it is not in the
 * world: everything outside the plan that reads `plan.props.vehicles` (the drawn fleet and the code-built cars, the oil stains under
 * them, the props' solids a walker and the car are pushed out of) reads `standingVehicles` instead, and all agree.
 *
 * The test: the ground's height (the engine's elevation with the streets' trough, or a deck's top over the water: the ground the town
 * is drawn on, without the drawing's constant lift) is read on a grid over the part of the footprint the wheels stand in (a little more
 * than any model's wheelbase and track), a plane is fitted to it by least squares, and the vehicle stands when no point is further from
 * that plane than `PARKED_FLAT`. A model's four wheels then stand within twice that of the plane they are turned onto.
 *
 * Simulation code: `+ - * /`, `abs`, `max` only; the cache is only a lookup.
 */
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { deckTopAt } from "./decks.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import { streetLiftD } from "./streetField.js";
import type { Box, TownPlan, Vehicle } from "./types.js";

/** How far the ground under a vehicle's wheels may stand off the plane through it, metres. */
export const PARKED_FLAT = 0.02;
/**
 * Where the ground is read, as fractions of the footprint's half length (fore and aft, each station at both ends) and half width (from side
 * to side): the band every model's axles stand in (the manifest's wheels lie between 0.57 and 0.73 of the half length, and inside 0.82 of
 * the half width), and not the belly between them, which clears a crown or a gutter.
 */
const ALONG: readonly number[] = [-0.77, -0.66, -0.55, 0.55, 0.66, 0.77];
const ACROSS: readonly number[] = [-0.86, -0.43, 0, 0.43, 0.86];

/** The ground a parked vehicle stands on at a world place: the terrain with the streets' trough, or a deck's top. */
export function parkedGroundAt(seed: number, x: number, z: number): number {
  const d = deckTopAt(seed, x, z);
  const h = elevationSampleAt(seed, x, z).h + streetLiftD(seed, x, z).v;
  return d === null ? h : Math.max(h, d);
}

/** The worst distance of the ground under a vehicle's wheels from the plane fitted through it, metres. `(ax, az)` is the plan's anchor in the world. */
export function parkedUnevenness(seed: number, ax: number, az: number, v: Vehicle): number {
  const wx = ax + v.x;
  const wz = az + v.z;
  const lx = -v.hz;
  const lz = v.hx;
  const ha = v.length / 2;
  const hc = v.width / 2;
  // The grid is symmetric about the centre, so the least-squares plane is the mean and the two slopes, each on its own.
  const as: number[] = [];
  const cs: number[] = [];
  const hs: number[] = [];
  let sh = 0, sah = 0, sch = 0, saa = 0, scc = 0;
  for (const fa of ALONG) {
    const a = ha * fa;
    for (const fc of ACROSS) {
      const c = hc * fc;
      const h = parkedGroundAt(seed, wx + v.hx * a + lx * c, wz + v.hz * a + lz * c);
      as.push(a);
      cs.push(c);
      hs.push(h);
      sh += h; sah += a * h; sch += c * h; saa += a * a; scc += c * c;
    }
  }
  const y0 = sh / hs.length;
  const pitch = sah / saa;
  const roll = sch / scc;
  let worst = 0;
  for (let k = 0; k < hs.length; k++) worst = Math.max(worst, Math.abs((hs[k] as number) - (y0 + pitch * (as[k] as number) + roll * (cs[k] as number))));
  return worst;
}

/** Whether the ground holds a parked vehicle: whether its wheels' ground is a plane to within `PARKED_FLAT`. */
export function vehicleStands(seed: number, ax: number, az: number, v: Vehicle): boolean {
  return parkedUnevenness(seed, ax, az, v) <= PARKED_FLAT;
}

/** Whether a box of the props' solids is a vehicle's own (the props stage puts a vehicle's box down as its centre, heading and half sizes). */
export function isVehicleBox(b: Box, v: Vehicle): boolean {
  return b.cx === v.x && b.cz === v.z && b.ux === v.hx && b.uz === v.hz && b.hu === v.length / 2 && b.hv === v.width / 2;
}

/** The plan's parked vehicles that the world does not hold (the rest of `standingVehicles`), in the plan's order. */
export function absentVehicles(seed: number, plan: TownPlan = planFor(seed), anchor: { x: number; z: number } = siteFor(seed).anchor): readonly Vehicle[] {
  const standing = standingVehicles(seed, plan, anchor);
  const out: Vehicle[] = [];
  let k = 0;
  for (const v of plan.props.vehicles) {
    if (k < standing.length && standing[k] === v) k++;
    else out.push(v);
  }
  return out;
}

const STANDING = new Map<number, readonly Vehicle[]>();

/**
 * The plan's parked vehicles that the world holds, in the plan's order. `plan` and `anchor` default to the world seed's own (and that
 * answer is made once); a reader that has its own plan of the seed's site hands it.
 */
export function standingVehicles(seed: number, plan: TownPlan = planFor(seed), anchor: { x: number; z: number } = siteFor(seed).anchor): readonly Vehicle[] {
  const own = plan === planFor(seed);
  if (own) {
    const made = STANDING.get(seed);
    if (made !== undefined) return made;
  }
  const out: Vehicle[] = [];
  for (const v of plan.props.vehicles) if (vehicleStands(seed, anchor.x, anchor.z, v)) out.push(v);
  if (own) STANDING.set(seed, out);
  return out;
}
