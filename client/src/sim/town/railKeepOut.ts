/**
 * The railroad's corridor as the plan keeps it: how far from either line's centre (the main line beside the highway, the town's own spur) a
 * building or a prop may stand. The bed is `RAIL_BED_HALF` wide each side; a building's walls keep `BUILDING_CLEAR` clear of its edge and
 * anything smaller (a fence, a vehicle, a pole, a bin, a bench, litter) keeps `PROP_CLEAR`. A house is held with what it grows: the porch at
 * its front and an addition at its sides or back (`game/town/buildingParts.ts` draws them from the house's own record), so the corridor is
 * clear of those too.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { bearingU, bearingV } from "./bearings.js";
import { contains, orientedRect, segDist, segSegDist, type Poly, type Vec } from "./geom.js";
import { RAIL_BED_HALF } from "./rail.js";
import type { Building } from "./types.js";

/** A building's walls keep this far clear of the bed's edge, metres. */
export const BUILDING_CLEAR = 2.5;
/** A prop, fence, vehicle, piece of furniture or litter keeps this far clear of the bed's edge, metres. */
export const PROP_CLEAR = 1.5;
/** A house's porch reaches this far past its front wall, and the owner's addition this far past a side or back wall, metres. */
export const PORCH_REACH = 1.7;
export const ADDITION_REACH = 3.5;

/** The most a building's wall may come to a line's centre: the bed's half width and the clearance. */
export const BUILDING_OFFSET = RAIL_BED_HALF + BUILDING_CLEAR;
export const PROP_OFFSET = RAIL_BED_HALF + PROP_CLEAR;

export type Line = readonly Vec[];

/** The distance from a point to a polyline. */
export function lineDist(line: Line, p: Vec): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(p, line[i - 1] as Vec, line[i] as Vec));
  return d;
}

/** The distance from a segment to a polyline. */
export function lineSegDist(line: Line, a: Vec, b: Vec): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segSegDist(a, b, line[i - 1] as Vec, line[i] as Vec));
  return d;
}

/** The distance from a convex polygon to a polyline (0 where they overlap). */
export function lineShapeDist(line: Line, poly: Poly): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) {
    if (contains(poly, line[i] as Vec)) return 0;
    const a = line[i - 1] as Vec;
    const b = line[i] as Vec;
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segSegDist(poly[k] as Vec, poly[(k + 1) % poly.length] as Vec, a, b));
  }
  return d;
}

/**
 * What a building takes up as the town draws it: its rectangle, and for a house the porch past its front wall and the addition past the
 * rest, as a rectangle of the building's own axes. `front` is the street-side unit vector (null: no front, no porch).
 */
export function footprint(centre: Vec, halfAlong: number, halfAcross: number, bearing: Building["bearing"], front: Vec | null, kind: string): Poly {
  const U = bearingU(bearing);
  const V = bearingV(bearing);
  if (kind !== "house" || front === null) return orientedRect(centre, halfAlong, halfAcross, U, V);
  // The front faces the building's u axis or its v axis, and the side of it by the sign of the dot product.
  const fu = front.x * U.x + front.z * U.z;
  const fv = front.x * V.x + front.z * V.z;
  const alongFront = Math.abs(fu) > Math.abs(fv);
  const s = (alongFront ? fu : fv) > 0 ? 1 : -1;
  // The rectangle is grown by the addition's reach all round, less on the front side, where the porch is the most.
  const gu = alongFront ? (s > 0 ? PORCH_REACH : ADDITION_REACH) : ADDITION_REACH;
  const gu2 = alongFront ? (s > 0 ? ADDITION_REACH : PORCH_REACH) : ADDITION_REACH;
  const gv = alongFront ? ADDITION_REACH : (s > 0 ? PORCH_REACH : ADDITION_REACH);
  const gv2 = alongFront ? ADDITION_REACH : (s > 0 ? ADDITION_REACH : PORCH_REACH);
  // `gu` is the reach past the +u side, `gu2` past the -u side; `gv` past +v, `gv2` past -v.
  const u0 = -(halfAlong + gu2);
  const u1 = halfAlong + gu;
  const v0 = -(halfAcross + gv2);
  const v1 = halfAcross + gv;
  const at = (a: number, b: number): Vec => ({ x: centre.x + U.x * a + V.x * b, z: centre.z + U.z * a + V.z * b });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/** Whether a building's footprint keeps clear of every line. */
export function buildingClear(lines: readonly Line[], poly: Poly): boolean {
  for (const line of lines) if (line.length > 1 && lineShapeDist(line, poly) < BUILDING_OFFSET) return false;
  return true;
}
