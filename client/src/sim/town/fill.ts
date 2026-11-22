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

/** Quintic smootherstep with derivative: C2 at both edges. */
export function smootherstepD(edge0: number, edge1: number, x: number): { v: number; d: number } {
  const span = edge1 - edge0;
  if (x <= edge0) return { v: 0, d: 0 };
  if (x >= edge1) return { v: 1, d: 0 };
  const t = (x - edge0) / span;
  return { v: t * t * t * (t * (t * 6 - 15) + 10), d: (30 * t * t * (t - 1) * (t - 1)) / span };
}

/** One polygon's weight at a point of the site's frame, and its gradient. */
function areaWindowD(area: FillArea, x: number, z: number): { v: number; dx: number; dz: number } {
  const p = area.polygon;
  const n = p.length;
  const w: number[] = [];
  const wx: number[] = [];
  const wz: number[] = [];
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
    const s = smootherstepD(-QUAY_BANK, 0, d);
    w.push(s.v);
    wx.push(s.d * nx);
    wz.push(s.d * nz);
    if (s.v === 0) return { v: 0, dx: 0, dz: 0 };
  }
  let v = 1;
  for (let i = 0; i < n; i++) v *= w[i] as number;
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < n; i++) {
    let others = 1;
    for (let j = 0; j < n; j++) if (j !== i) others *= w[j] as number;
    dx += (wx[i] as number) * others;
    dz += (wz[i] as number) * others;
  }
  return { v, dx, dz };
}

/** The fill's weight at a point of the site's frame (0 to 1, with its gradient), the areas combined by a smooth union. */
export function fillWindowD(areas: readonly FillArea[], x: number, z: number): { v: number; dx: number; dz: number } {
  // The union's complement is the product of the areas' complements: 1 - w = Π (1 - w_i).
  let rest = 1;
  let restDx = 0;
  let restDz = 0;
  for (const area of areas) {
    const a = areaWindowD(area, x, z);
    if (a.v === 0) continue;
    // d(rest * (1 - a)) = (1 - a) d(rest) - rest da
    restDx = (1 - a.v) * restDx - rest * a.dx;
    restDz = (1 - a.v) * restDz - rest * a.dz;
    rest *= 1 - a.v;
  }
  return { v: 1 - rest, dx: 0 - restDx, dz: 0 - restDz };
}

/**
 * The fill the plan has named for a world's seed: the ground the old town's grid stands on where the
 * sea was, behind its quay (`TownPlan.fill`). The plan is made from the site, which is the coast's own
 * ground, so reading it here asks nothing of the made ground and cannot come back round.
 */
export function townFillFor(worldSeed: number): readonly FillArea[] {
  return planFor(worldSeed).fill;
}
