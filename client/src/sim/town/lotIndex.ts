/**
 * Which lot a point of the plan's frame stands in: the lots listed in cells of 16 m, built once per plan. A lot is a convex polygon
 * (`lots.ts`), so a point is in it when it is on the inner side of every edge. Used by the mask (what grows on a lot, `clearing.ts`),
 * and by the drawing (what a sidewalk fronts, what a yard has in it).
 *
 * Simulation code: `+ - * /` only.
 */
import { orient } from "./geom.js";
import type { Lot, TownPlan, Yard } from "./types.js";

const CELL = 16;

type Cell = readonly number[];
type Index = {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly cells: readonly Cell[];
  /** Per lot: the edges as (nx, nz, c), the inside where nx * x + nz * z - c >= 0. */
  readonly edges: readonly (readonly (readonly [number, number, number])[])[];
};

const INDEX = new WeakMap<TownPlan, Index>();

function indexOf(plan: TownPlan): Index {
  let ix = INDEX.get(plan);
  if (ix !== undefined) return ix;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const edges: (readonly [number, number, number])[][] = [];
  const boxes: [number, number, number, number][] = [];
  for (const lot of plan.lots) {
    const poly = orient(lot.polygon);
    const es: [number, number, number][] = [];
    let a0 = Infinity;
    let b0 = Infinity;
    let a1 = -Infinity;
    let b1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as { x: number; z: number };
      const q = poly[(i + 1) % poly.length] as { x: number; z: number };
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      a0 = Math.min(a0, p.x);
      b0 = Math.min(b0, p.z);
      a1 = Math.max(a1, p.x);
      b1 = Math.max(b1, p.z);
      if (!(len > 1e-9)) continue;
      // Counter-clockwise: the inside is on the left, the normal (-ez, ex) over the length.
      const nx = -ez / len;
      const nz = ex / len;
      es.push([nx, nz, nx * p.x + nz * p.z]);
    }
    edges.push(es);
    boxes.push([a0, b0, a1, b1]);
    x0 = Math.min(x0, a0);
    z0 = Math.min(z0, b0);
    x1 = Math.max(x1, a1);
    z1 = Math.max(z1, b1);
  }
  if (plan.lots.length === 0) {
    ix = { x0: 0, z0: 0, nx: 0, nz: 0, cells: [], edges };
    INDEX.set(plan, ix);
    return ix;
  }
  x0 = Math.floor(x0 / CELL) * CELL;
  z0 = Math.floor(z0 / CELL) * CELL;
  const nx = Math.floor((x1 - x0) / CELL) + 1;
  const nz = Math.floor((z1 - z0) / CELL) + 1;
  const cells: number[][] = [];
  for (let i = 0; i < nx * nz; i++) cells.push([]);
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k] as [number, number, number, number];
    for (let i = Math.floor((b[0] - x0) / CELL); i <= Math.floor((b[2] - x0) / CELL); i++) {
      for (let j = Math.floor((b[1] - z0) / CELL); j <= Math.floor((b[3] - z0) / CELL); j++) (cells[i * nz + j] as number[]).push(k);
    }
  }
  ix = { x0, z0, nx, nz, cells, edges };
  INDEX.set(plan, ix);
  return ix;
}

/** The id of the lot the point stands in, or -1. */
export function lotIdAt(plan: TownPlan, x: number, z: number): number {
  const ix = indexOf(plan);
  const i = Math.floor((x - ix.x0) / CELL);
  const j = Math.floor((z - ix.z0) / CELL);
  if (i < 0 || j < 0 || i >= ix.nx || j >= ix.nz) return -1;
  const list = ix.cells[i * ix.nz + j] as Cell;
  for (let k = 0; k < list.length; k++) {
    const es = ix.edges[list[k] as number] as readonly (readonly [number, number, number])[];
    let inside = es.length >= 3;
    for (let e = 0; e < es.length && inside; e++) {
      const edge = es[e] as readonly [number, number, number];
      if (edge[0] * x + edge[1] * z - edge[2] < 0) inside = false;
    }
    if (inside) return list[k] as number;
  }
  return -1;
}

/** The lot a point stands in, or null. */
export function lotAt(plan: TownPlan, x: number, z: number): Lot | null {
  const id = lotIdAt(plan, x, z);
  return id < 0 ? null : (plan.lots[id] as Lot);
}

/** The yard of the lot a point stands in, or null off every lot. */
export function yardAt(plan: TownPlan, x: number, z: number): Yard | null {
  const id = lotIdAt(plan, x, z);
  return id < 0 ? null : (plan.yards[id] ?? null);
}
