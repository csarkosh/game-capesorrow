/**
 * Where a lot's drive and front walk lie, as oriented rectangles of the plan's frame, from the lot, its building and the yard's own
 * roll (`port/yards.ts`): the drawing lays gravel, dirt or concrete in them (`game/town/yardGeometry.ts`) and the mask keeps the grass
 * off them (`clearing.ts`), so the two agree.
 *
 * - The lot's frontage is the edge of its polygon that faces the street (`Lot.front`). A drive leaves it at `yard.drive.at` of its
 *   length (kept `half width + 0.6` m from the ends) and runs in to the building's near face, or 40 m at most; a walk leaves it
 *   level with the building's middle (moved sideways past a drive that would cover it) and runs to the building's near face.
 * - A lot with no building has neither.
 *
 * Simulation code: `+ - * /`, `abs`, `min`, `max`, `sqrt`.
 */
import { orient } from "./geom.js";
import { bearingU, bearingV } from "./bearings.js";
import type { Building, Lot, TownPlan, Vec, Yard } from "./types.js";

export type YardRect = {
  /** The point on the frontage the rectangle starts at, and the unit direction into the lot. */
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  /** How far it runs in, and its half width. */
  readonly length: number;
  readonly half: number;
};

export type YardShape = { readonly drive: YardRect | null; readonly walk: YardRect | null; readonly front: { readonly a: Vec; readonly b: Vec } | null };

const BUILDING_OF = new WeakMap<TownPlan, readonly (Building | undefined)[]>();
const SHAPES = new WeakMap<TownPlan, (YardShape | undefined)[]>();

function buildingOf(plan: TownPlan, lot: number): Building | undefined {
  let list = BUILDING_OF.get(plan);
  if (list === undefined) {
    const l: (Building | undefined)[] = plan.lots.map(() => undefined);
    for (const b of plan.buildings) if (b.lot >= 0 && b.kind !== "pier") l[b.lot] = b;
    list = l;
    BUILDING_OF.set(plan, list);
  }
  return list[lot];
}

/** How far a building's footprint reaches from its centre along the unit direction (dx, dz). */
function reach(b: Building, dx: number, dz: number): number {
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  return Math.abs(u.x * dx + u.z * dz) * b.halfAlong + Math.abs(v.x * dx + v.z * dz) * b.halfAcross;
}

function shapeOf(plan: TownPlan, lot: Lot, yard: Yard): YardShape {
  const b = buildingOf(plan, lot.id);
  const poly = orient(lot.polygon);
  // The frontage: the edge whose outward normal is most nearly the lot's front.
  let best = -Infinity;
  let a: Vec | null = null;
  let c: Vec | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec;
    const q = poly[(i + 1) % poly.length] as Vec;
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const len = Math.sqrt(ex * ex + ez * ez);
    if (!(len > 3)) continue;
    const score = (ez / len) * lot.front.x + (-ex / len) * lot.front.z;
    if (score > best) {
      best = score;
      a = p;
      c = q;
    }
  }
  if (a === null || c === null || b === undefined || yard.kind === "paved") return { drive: null, walk: null, front: a !== null && c !== null ? { a, b: c } : null };
  const ex = c.x - a.x;
  const ez = c.z - a.z;
  const len = Math.sqrt(ex * ex + ez * ez);
  const tx = ex / len;
  const tz = ez / len;
  // Into the lot: against the outward normal.
  const dx = -(ez / len);
  const dz = ex / len;
  // The distance from the frontage to the building's near face, along the way in, and the building's middle along the frontage.
  const toCentre = (b.centre.x - a.x) * dx + (b.centre.z - a.z) * dz;
  const face = toCentre - reach(b, dx, dz);
  const along = (b.centre.x - a.x) * tx + (b.centre.z - a.z) * tz;
  const run = Math.min(40, Math.max(0, face));
  let drive: YardRect | null = null;
  if (yard.drive !== null && run > 3) {
    const half = yard.drive.width / 2;
    const s = Math.min(len - half - 0.6, Math.max(half + 0.6, len * yard.drive.at));
    drive = { x: a.x + tx * s, z: a.z + tz * s, dx, dz, length: run, half };
  }
  let walk: YardRect | null = null;
  if (yard.walk !== null && run > 3) {
    let s = Math.min(len - 0.9, Math.max(0.9, along));
    if (drive !== null) {
      const ds = (drive.x - a.x) * tx + (drive.z - a.z) * tz;
      if (Math.abs(s - ds) < drive.half + 1) s = ds + (s >= ds ? 1 : -1) * (drive.half + 1);
      s = Math.min(len - 0.9, Math.max(0.9, s));
    }
    walk = { x: a.x + tx * s, z: a.z + tz * s, dx, dz, length: run, half: 0.48 };
  }
  return { drive, walk, front: { a, b: c } };
}

/** The drive, walk and frontage of a lot, made once. */
export function yardShape(plan: TownPlan, lotId: number): YardShape {
  let list = SHAPES.get(plan);
  if (list === undefined) {
    list = [];
    SHAPES.set(plan, list);
  }
  let s = list[lotId];
  if (s === undefined) {
    const lot = plan.lots[lotId] as Lot;
    const yard = plan.yards[lotId] as Yard;
    s = shapeOf(plan, lot, yard);
    list[lotId] = s;
  }
  return s;
}

/** Whether a point of the plan's frame lies in a rectangle (grown by `margin` metres all round). */
export function inYardRect(r: YardRect, x: number, z: number, margin = 0): boolean {
  const ex = x - r.x;
  const ez = z - r.z;
  const along = ex * r.dx + ez * r.dz;
  const across = Math.abs(-ex * r.dz + ez * r.dx);
  return along >= -margin && along <= r.length + margin && across <= r.half + margin;
}
