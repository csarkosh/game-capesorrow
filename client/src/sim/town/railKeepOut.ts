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

/** A distance is exact up to this far (metres); past it a query answers "at least this far". Every clearance in the plan is well under it. */
const REACH = 12;
/** The index's cells, metres. */
const CELL = 32;

/** A polyline's segments in a grid of cells, so a query meets only the few near it. */
type LineIndex = {
  readonly line: Line;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Cell `c` lists the segments (index of their first point) whose box meets it. */
  readonly cells: readonly (readonly number[])[];
  /** The box of the whole line, grown by `REACH`. */
  readonly bx0: number;
  readonly bz0: number;
  readonly bx1: number;
  readonly bz1: number;
};

/** The indexes made, by line (a module's own cache: looked up by the line itself, never walked). */
const INDEXES = new Map<Line, LineIndex>();

function indexOf(line: Line): LineIndex {
  let hit = INDEXES.get(line);
  if (hit !== undefined) return hit;
  if (INDEXES.size > 200) INDEXES.clear();
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of line) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  x0 -= REACH;
  z0 -= REACH;
  x1 += REACH;
  z1 += REACH;
  const cols = line.length < 2 ? 1 : Math.floor((x1 - x0) / CELL) + 1;
  const rows = line.length < 2 ? 1 : Math.floor((z1 - z0) / CELL) + 1;
  const cells: number[][] = [];
  for (let c = 0; c < cols * rows; c++) cells.push([]);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec;
    const b = line[i] as Vec;
    const c0 = Math.floor((Math.min(a.x, b.x) - x0) / CELL);
    const c1 = Math.floor((Math.max(a.x, b.x) - x0) / CELL);
    const r0 = Math.floor((Math.min(a.z, b.z) - z0) / CELL);
    const r1 = Math.floor((Math.max(a.z, b.z) - z0) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (cells[r * cols + c] as number[]).push(i);
  }
  hit = { line, x0, z0, cols, rows, cells, bx0: x0, bz0: z0, bx1: x1, bz1: z1 };
  INDEXES.set(line, hit);
  return hit;
}

/** Calls `visit` with the first point's index of each segment that may lie within `REACH` of the box (each once per call of a cell: a segment may repeat, which is harmless to a minimum). */
function near(ix: LineIndex, qx0: number, qz0: number, qx1: number, qz1: number, visit: (i: number) => void): void {
  if (qx1 + REACH < ix.bx0 || qx0 - REACH > ix.bx1 || qz1 + REACH < ix.bz0 || qz0 - REACH > ix.bz1) return;
  const c0 = Math.max(0, Math.floor((qx0 - REACH - ix.x0) / CELL));
  const c1 = Math.min(ix.cols - 1, Math.floor((qx1 + REACH - ix.x0) / CELL));
  const r0 = Math.max(0, Math.floor((qz0 - REACH - ix.z0) / CELL));
  const r1 = Math.min(ix.rows - 1, Math.floor((qz1 + REACH - ix.z0) / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const i of ix.cells[r * ix.cols + c] as number[]) visit(i);
}

/** The distance from a point to a polyline (exact up to `REACH`). */
export function lineDist(line: Line, p: Vec): number {
  let d = Infinity;
  if (line.length < 2) return d;
  near(indexOf(line), p.x, p.z, p.x, p.z, (i) => {
    d = Math.min(d, segDist(p, line[i - 1] as Vec, line[i] as Vec));
  });
  return d;
}

/** The distance from a segment to a polyline (exact up to `REACH`). */
export function lineSegDist(line: Line, a: Vec, b: Vec): number {
  let d = Infinity;
  if (line.length < 2) return d;
  near(indexOf(line), Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), (i) => {
    d = Math.min(d, segSegDist(a, b, line[i - 1] as Vec, line[i] as Vec));
  });
  return d;
}

/** The distance from a convex polygon to a polyline (0 where they overlap; exact up to `REACH`). */
export function lineShapeDist(line: Line, poly: Poly): number {
  let d = Infinity;
  if (line.length < 2) return d;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const q of poly) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    z0 = Math.min(z0, q.z);
    z1 = Math.max(z1, q.z);
  }
  near(indexOf(line), x0, z0, x1, z1, (i) => {
    if (d === 0) return;
    const a = line[i - 1] as Vec;
    const b = line[i] as Vec;
    if (contains(poly, a) || contains(poly, b)) {
      d = 0;
      return;
    }
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segSegDist(poly[k] as Vec, poly[(k + 1) % poly.length] as Vec, a, b));
  });
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
