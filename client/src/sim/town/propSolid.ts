/**
 * The props as walls the player cannot pass, as the buildings are (`solid.ts`): the plan's `props.solids` (oriented boxes of the plan's
 * frame: vehicles, trailers, fence runs, poles, bins, mailboxes, the heavy gear) in the world, on the same grid and pushed out of by
 * the same rule, with the same hull. Called from `townConstrain`, in its passes. A box is a column from the ground to the sky, like a building.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only; the cache is only a lookup.
 */
import { gridOf, pushOut, SOLID_CELL, STRIDE, type TownSolids } from "./solid.js";
import { HULL_RADIUS } from "./hull.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";

type PropGrid = Omit<TownSolids, "ids"> & { readonly full: TownSolids };

const SOLIDS = new Map<number, PropGrid>();

/** The props' solids of a world seed's town, made once. */
export function propSolids(worldSeed: number): PropGrid {
  let made = SOLIDS.get(worldSeed);
  if (made === undefined) {
    const { anchor } = siteFor(worldSeed);
    const boxes = planFor(worldSeed).props.solids;
    const n = boxes.length;
    const rects = new Float64Array(n * STRIDE);
    const lowX = new Float64Array(n);
    const highX = new Float64Array(n);
    const lowZ = new Float64Array(n);
    const highZ = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = boxes[i]!;
      const cx = anchor.x + b.cx;
      const cz = anchor.z + b.cz;
      const o = i * STRIDE;
      rects[o] = cx;
      rects[o + 1] = cz;
      rects[o + 2] = b.ux;
      rects[o + 3] = b.uz;
      rects[o + 4] = b.hu;
      rects[o + 5] = b.hv;
      const ex = Math.abs(b.ux) * b.hu + Math.abs(b.uz) * b.hv + 1;
      const ez = Math.abs(b.uz) * b.hu + Math.abs(b.ux) * b.hv + 1;
      lowX[i] = cx - ex;
      highX[i] = cx + ex;
      lowZ[i] = cz - ez;
      highZ[i] = cz + ez;
    }
    const grid = gridOf(rects, n, lowX, highX, lowZ, highZ);
    made = { ...grid, full: { ids: [], ...grid } };
    SOLIDS.set(worldSeed, made);
  }
  return made;
}

/** Moves a hull of `radius` (the player's by default) out of every prop box of its cell it overlaps. Returns whether it moved. */
export function constrainProps(worldSeed: number, pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, radius: number = HULL_RADIUS): boolean {
  const solids = propSolids(worldSeed);
  const c = Math.floor((pos.x - solids.x0) / SOLID_CELL);
  const r = Math.floor((pos.z - solids.z0) / SOLID_CELL);
  if (c < 0 || r < 0 || c >= solids.cols || r >= solids.rows) return false;
  const cell = r * solids.cols + c;
  let moved = false;
  const full = solids.full;
  for (let k = solids.start[cell] as number; k < (solids.start[cell + 1] as number); k++) {
    if (pushOut(full, solids.list[k] as number, pos, vel, radius)) moved = true;
  }
  return moved;
}
