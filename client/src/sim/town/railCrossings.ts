/**
 * Where the town's streets and the roads out of it cross the railroad's main line, in the world.
 *
 * The plan keeps them (`plan.rail.crossings`, found once, in `plan.ts`, where each street or road step meets the line's x less the
 * highway's offset); `crossingsFor(plan, worldSeed, anchor)` is that list in the world's frame, with a stable index, and is the one
 * function the drawing asks, so what is drawn is what the plan names, no more and no fewer. The plan finds a crossing on the line as its site samples give it (16 m apart, straight between); the drawing keeps the plan's z and puts the crossing on the line's own centre there (a few decimetres off the plan's x).
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { railCenterX } from "./rail.js";
import type { TownPlan } from "./types.js";

/** A way meeting the line more obliquely than this (the sine of the angle between them, about six degrees) is no crossing. */
export const CROSSING_MIN_SIN = 0.1;

/** Where a way crosses the line, in the world. */
export type RailCrossing = {
  /** A stable index along the list. */
  readonly id: number;
  /** What crosses: a street's id, or a road's id (`road` is then true). */
  readonly way: number;
  readonly road: boolean;
  /** The crossing's point on the line's centre, in the world. */
  readonly x: number;
  readonly z: number;
  /** The way's unit direction there, from the highway's side to the sea's (`dx` is then negative or zero: the way runs seaward). */
  readonly dx: number;
  readonly dz: number;
  /** The way's roadway and its whole right of way, metres, at the crossing. */
  readonly roadway: number;
  readonly width: number;
  /** Whether it is paved. */
  readonly paved: boolean;
};

const CACHE = new Map<number, readonly RailCrossing[]>();

/** The town's crossings of the main line, in the world, ordered by z (the plan's order). */
export function crossingsFor(plan: TownPlan, worldSeed: number, anchor: { x: number; z: number }): readonly RailCrossing[] {
  const hit = CACHE.get(worldSeed);
  if (hit !== undefined) return hit;
  const out: RailCrossing[] = plan.rail.crossings.map((c, id) => ({ id, way: c.way, road: c.road, x: railCenterX(worldSeed, anchor.z + c.z), z: anchor.z + c.z, dx: c.dx, dz: c.dz, roadway: c.roadway, width: c.width, paved: c.paved }));
  CACHE.set(worldSeed, out);
  return out;
}
