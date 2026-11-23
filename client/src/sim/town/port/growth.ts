/**
 * How the town grows over the land. The history gives the town a SIZE, a budget of blocks (`blockBudget`); the plan
 * lays the old plat where the town began and then spends the budget outward from it, block cell by block cell, always
 * taking next the cell that costs least (`cellPrice`):
 *
 * - its distance on foot from the core: the path along the blocks already taken, from the core's centre to the cell's, in metres;
 * - its slope, `GROW_SLOPE_COST` metres of price for each percent of mean slope;
 * - how much of it is unbuildable, `GROW_SHARE_COST` metres for the whole cell;
 * - less the worth of standing on the highway or the water: up to `GROW_HIGHWAY_WORTH` metres for a cell whose edge is at the
 *   highway's and falling to nothing `GROW_HIGHWAY_REACH` metres off it, and up to `GROW_SHORE_WORTH` for one at the shore.
 *
 * A cell less than `GROW_MIN_SHARE` buildable, or steeper than `GROW_MAX_SLOPE` on average, or standing more than `LAND_FIT` metres off the graded plane the town's ground is made over, is never taken. Where the land
 * is a narrow shelf the town comes out long and thin; where a plain opens it spreads inland; a hump or a gully in a block's
 * place leaves the block as woods and the grid goes round it.
 */
import { LAND_FIT } from "../land.js";
import { dist, segSegDist, type Poly, type Vec } from "../geom.js";
import type { History } from "../types.js";

export const GROW_MIN_SHARE = 0.6;
export const GROW_MAX_SLOPE = 0.14;
export const GROW_SLOPE_COST = 8;
export const GROW_SHARE_COST = 120;
export const GROW_HIGHWAY_WORTH = 45;
export const GROW_HIGHWAY_REACH = 70;
export const GROW_SHORE_WORTH = 30;
export const GROW_SHORE_REACH = 60;
/** Two blocks are neighbours where their edges are within this of each other (a street, the highway and the rail between them, or a gap of woods the grid goes across), metres. */
export const GROW_NEIGHBOUR = 130;

/** The least and the most blocks the history can give a large port. */
export const BUDGET_MIN = 26;
export const BUDGET_MAX = 55;

/**
 * The block budget the history gives the town: 28 blocks and, for how long the town had to grow, up to 14 more (a founding in
 * 1889 gives none, in 1851 all 14); a boom that was not cut short by the panic of 1893 adds 6 and, for a late peak, up to 4 more
 * (a peak in 1900 none, 1912 all); a county seat adds 3. Clamped to `BUDGET_MIN`..`BUDGET_MAX`.
 */
export function blockBudget(history: History): number {
  const age = Math.max(0, Math.min(38, 1889 - history.founding.year));
  let b = 28 + Math.floor((age * 14) / 38);
  if (!history.boom.bust1893) b += 6 + Math.floor((Math.max(0, Math.min(12, history.boom.peakYear - 1900)) * 4) / 12);
  if (history.countySeat.isSeat) b += 3;
  return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, b));
}

/** A cell the town may grow into: a block's polygon with what the land under it is, and how near the highway and the water. */
export type GrowCell = {
  readonly poly: Poly;
  readonly centre: Vec;
  /** The share of its ground that is buildable, 0 to 1. */
  readonly share: number;
  /** Its mean slope, rise over run. */
  readonly slope: number;
  /** How far the land's mean height stands over the graded plane the made ground will be, metres (negative below it). */
  readonly fit: number;
  /** How far its nearest corner is from the highway's centre line and from the shore, metres. */
  readonly hwGap: number;
  readonly shoreGap: number;
};

/** May the town grow into this cell at all? */
export function eligible(c: GrowCell): boolean {
  return c.share >= GROW_MIN_SHARE && c.slope <= GROW_MAX_SLOPE && Math.abs(c.fit) <= LAND_FIT;
}

/** What a cell costs apart from the way to it: its slope and unbuildable ground, less the worth of its place on the highway and the water. */
export function cellPrice(c: GrowCell): number {
  const hw = Math.max(0, 1 - c.hwGap / GROW_HIGHWAY_REACH) * GROW_HIGHWAY_WORTH;
  const sh = Math.max(0, 1 - c.shoreGap / GROW_SHORE_REACH) * GROW_SHORE_WORTH;
  return c.slope * 100 * GROW_SLOPE_COST + (1 - c.share) * GROW_SHARE_COST - hw - sh;
}

/** The least distance between two convex polygons' edges (0 where they touch or overlap an edge). */
export function polyGap(a: Poly, b: Poly): number {
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as Vec;
    const q = a[(i + 1) % a.length] as Vec;
    for (let j = 0; j < b.length; j++) d = Math.min(d, segSegDist(p, q, b[j] as Vec, b[(j + 1) % b.length] as Vec));
  }
  return d;
}

/** For each cell the indices of the others within `GROW_NEIGHBOUR` of it. */
export function neighbours(cells: readonly GrowCell[]): number[][] {
  const out: number[][] = cells.map(() => []);
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i] as GrowCell;
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j] as GrowCell;
      if (dist(a.centre, b.centre) > 330) continue;
      if (polyGap(a.poly, b.poly) <= GROW_NEIGHBOUR) {
        (out[i] as number[]).push(j);
        (out[j] as number[]).push(i);
      }
    }
  }
  return out;
}

/**
 * Spends the budget. `taken` are the cells already there (the old plat's), `core` where the town began; the result is the order
 * the other cells were taken in (indices into `cells`) and each one's distance on foot from the core. Growth stops when the
 * budget is spent (`taken` counted) or when no eligible cell touches the town.
 */
export function grow(cells: readonly GrowCell[], near: readonly (readonly number[])[], taken: readonly number[], core: Vec, budget: number): { order: number[]; walk: number[] } {
  const walk: number[] = cells.map(() => Infinity);
  const have: boolean[] = cells.map(() => false);
  for (const t of taken) {
    have[t] = true;
    walk[t] = dist(core, (cells[t] as GrowCell).centre);
  }
  const order: number[] = [];
  let count = taken.length;
  while (count < budget) {
    let best = -1;
    let bestPrice = Infinity;
    let bestWalk = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (have[i]) continue;
      const c = cells[i] as GrowCell;
      if (!eligible(c)) continue;
      let g = Infinity;
      for (const n of near[i] as readonly number[]) {
        if (!have[n]) continue;
        g = Math.min(g, (walk[n] as number) + dist((cells[n] as GrowCell).centre, c.centre));
      }
      if (g === Infinity) continue;
      const price = g + cellPrice(c);
      // The cheaper first; a tie goes to the lower index, so the order is the same on every machine.
      if (price < bestPrice) {
        best = i;
        bestPrice = price;
        bestWalk = g;
      }
    }
    if (best < 0) break;
    have[best] = true;
    walk[best] = bestWalk;
    order.push(best);
    count++;
  }
  return { order, walk };
}
