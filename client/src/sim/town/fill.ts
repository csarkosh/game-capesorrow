/**
 * Fill the plan adds seaward of the natural shore: convex polygons behind a straight quay, where the
 * ground is raised to `QUAY` over what is sea now, so the old town's grid can stand partly on fill as
 * the real ports did. The polygons are in the site's frame (+x inland, +z north, origin at the anchor).
 *
 * The window of fill is a weight from 0 to 1 with an exact gradient: 1 inside a polygon, and falling to 0
 * across `QUAY_BANK` metres outside each of its edges, so the quay's face is a bank of that width. A
 * polygon's weight is the product, over its edges, of a smooth step of the signed distance to the edge
 * (corners round off by themselves); areas combine by a smooth union, `1 - (1 - w1)(1 - w2)...`.
 *
 * The plan reads the SITE, which is the coast's own ground, and never the made ground: the made ground
 * reads the plan's fill from here, so nothing loops.
 */
import { planFor } from "./planFor.js";

/** A convex polygon of fill, counter-clockwise (+x east, +z north), in the site's frame. */
export type FillArea = { readonly polygon: readonly { readonly x: number; readonly z: number }[] };

/** The width of the bank at a quay's edge, metres. */
export const QUAY_BANK = 6;

/** Where `smootherstepInto` leaves its answer: the value and the derivative. Read at once, before any other call. */
export const STEP = { v: 0, d: 0 };

/** Quintic smootherstep with derivative: C2 at both edges. Leaves its answer in `STEP`, and makes no object. */
export function smootherstepInto(edge0: number, edge1: number, x: number): void {
  const span = edge1 - edge0;
  if (x <= edge0) {
    STEP.v = 0;
    STEP.d = 0;
    return;
  }
  if (x >= edge1) {
    STEP.v = 1;
    STEP.d = 0;
    return;
  }
  const t = (x - edge0) / span;
  STEP.v = t * t * t * (t * (t * 6 - 15) + 10);
  STEP.d = (30 * t * t * (t - 1) * (t - 1)) / span;
}

/** Quintic smootherstep with derivative: C2 at both edges. */
export function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  smootherstepInto(edge0, edge1, x);
  return { v: STEP.v, d: STEP.d };
}

/** Where `areaWindowInto` leaves its answer. */
const AREA = { v: 0, dx: 0, dz: 0 };
/** Scratch for one polygon's edge weights and their gradients, grown to the largest polygon and then reused. */
const W: number[] = [];
const WX: number[] = [];
const WZ: number[] = [];

/** One polygon's weight at a point of the site's frame, and its gradient, left in `AREA`. */
function areaWindowInto(area: FillArea, x: number, z: number): void {
  const p = area.polygon;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i] as { x: number; z: number };
    const b = p[(i + 1) % n] as { x: number; z: number };
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.sqrt(ex * ex + ez * ez);
    // The inward normal of a counter-clockwise edge is its left: (-ez, ex).
    const nx = -ez / len;
    const nz = ex / len;
    const d = nx * (x - a.x) + nz * (z - a.z);
    smootherstepInto(-QUAY_BANK, 0, d);
    const sV = STEP.v;
    const sD = STEP.d;
    W[i] = sV;
    WX[i] = sD * nx;
    WZ[i] = sD * nz;
    if (sV === 0) {
      AREA.v = 0;
      AREA.dx = 0;
      AREA.dz = 0;
      return;
    }
  }
  let v = 1;
  for (let i = 0; i < n; i++) v *= W[i] as number;
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < n; i++) {
    let others = 1;
    for (let j = 0; j < n; j++) if (j !== i) others *= W[j] as number;
    dx += (WX[i] as number) * others;
    dz += (WZ[i] as number) * others;
  }
  AREA.v = v;
  AREA.dx = dx;
  AREA.dz = dz;
}

/** Where `fillWindowInto` leaves its answer: the weight and its gradient. Read at once, before any other call. */
export const FILL = { v: 0, dx: 0, dz: 0 };

/** The last answer: the areas, the point and the three numbers `FILL` was left with. */
let keptAreas: readonly FillArea[] | null = null;
let keptX = NaN;
let keptZ = NaN;
let keptV = 0;
let keptDx = 0;
let keptDz = 0;

/** The fill's weight at a point of the site's frame (0 to 1, with its gradient), the areas combined by a smooth union. Leaves its answer in `FILL`. One terrain evaluation asks the same point more than once, so the last answer is kept, and `FILL` is left as `fillWindowIntoFull` leaves it. */
export function fillWindowInto(areas: readonly FillArea[], x: number, z: number): void {
  if (keptAreas === areas && keptX === x && keptZ === z) {
    FILL.v = keptV;
    FILL.dx = keptDx;
    FILL.dz = keptDz;
    return;
  }
  fillWindowIntoFull(areas, x, z);
  keptAreas = areas;
  keptX = x;
  keptZ = z;
  keptV = FILL.v;
  keptDx = FILL.dx;
  keptDz = FILL.dz;
}

/** `fillWindowInto` with nothing kept: the areas asked at every call. */
export function fillWindowIntoFull(areas: readonly FillArea[], x: number, z: number): void {
  // The union's complement is the product of the areas' complements: 1 - w = Π (1 - w_i).
  let rest = 1;
  let restDx = 0;
  let restDz = 0;
  for (let k = 0; k < areas.length; k++) {
    areaWindowInto(areas[k] as FillArea, x, z);
    const av = AREA.v;
    if (av === 0) continue;
    const adx = AREA.dx;
    const adz = AREA.dz;
    // d(rest * (1 - a)) = (1 - a) d(rest) - rest da
    restDx = (1 - av) * restDx - rest * adx;
    restDz = (1 - av) * restDz - rest * adz;
    rest *= 1 - av;
  }
  FILL.v = 1 - rest;
  FILL.dx = 0 - restDx;
  FILL.dz = 0 - restDz;
}

/** The fill's weight at a point of the site's frame (0 to 1, with its gradient), the areas combined by a smooth union. */
export function fillWindowD(areas: readonly FillArea[], x: number, z: number): { v: number; dx: number; dz: number } {
  fillWindowInto(areas, x, z);
  return { v: FILL.v, dx: FILL.dx, dz: FILL.dz };
}

/**
 * The fill the plan has named for a world's seed: the ground the old town's grid stands on where the
 * sea was, behind its quay (`TownPlan.fill`). The plan is made from the site, which is the coast's own
 * ground, so reading it here asks nothing of the made ground and cannot come back round.
 */
export function townFillFor(worldSeed: number): readonly FillArea[] {
  return planFor(worldSeed).fill;
}
