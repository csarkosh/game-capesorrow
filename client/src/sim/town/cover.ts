/**
 * How much the town covers a place: the weight of the made ground, 0 to 1 with an exact gradient. It follows what
 * the plan built and not a rectangle: a smooth union of one window per block polygon, each window 1 up to `COVER_HOLD`
 * metres beyond the block's edges (the streets between blocks, the highway's width and the rail's corridor all lie
 * inside that) and falling to 0 over the next `COVER_FADE` metres, so the town's edge is the ragged edge of its outer
 * blocks and what lies beyond is the coast's own ground and forest.
 *
 * A window is the product, over a convex polygon's edges, of a smooth step of the distance outside each edge (as the
 * fill's is, `fill.ts`); a point finds the few windows near it through a grid of `CELL` metre cells, so a terrain sample
 * tests only the blocks within reach, and stops at the first window that holds it whole.
 *
 * The plan is read in its own frame (+x inland, +z north, origin at the anchor); `xf` and `zr` here are that frame's.
 */
import { orient } from "./geom.js";
import { smootherstepD } from "./fill.js";
import { planFor } from "./planFor.js";
import type { TownPlan } from "./types.js";

/** The made ground is whole this far beyond a block's edges, metres. */
export const COVER_HOLD = 16;
/** And falls to the coast's own over this many metres beyond that. */
export const COVER_FADE = 160;
/** The side of a grid cell, metres. */
const CELL = 24;

/** A lone outlying lot's window holds only this far beyond its edges and falls over this much more (its ground is levelled for the building, not the town's), metres. */
export const COVER_OUT_HOLD = 6;
export const COVER_OUT_FADE = 30;

/** The spur's own ground: a strip of the made ground (the plane) laid along its line so the track stands on level ground and not on the tideflat: whole this far from its centre and falling over the next `COVER_SPUR_FADE` metres. */
export const COVER_SPUR_HOLD = 6;
export const COVER_SPUR_FADE = 24;
/** Half the width of the quad a spur segment's window is made from, metres. */
const SPUR_HALF = 3;

export const COVER_TUNABLES: Readonly<Record<string, number>> = { COVER_HOLD, COVER_FADE, COVER_OUT_HOLD, COVER_OUT_FADE, COVER_SPUR_HOLD, COVER_SPUR_FADE };

type Edge = { readonly nx: number; readonly nz: number; readonly c: number };
type Window = { readonly edges: readonly Edge[]; readonly hold: number; readonly fade: number; /** A lone outlying lot's: it levels nothing (the ground is the land's own there) but holds the cliff bands and the forest off. */ readonly lot: boolean };

export type CoverIndex = {
  readonly windows: readonly Window[];
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** The windows each cell must test, by cell. */
  readonly cells: readonly (readonly number[])[];
};

const INDEX = new WeakMap<TownPlan, CoverIndex>();

/** The cover's index for a plan, made once. */
export function coverIndexOf(plan: TownPlan): CoverIndex {
  const hit = INDEX.get(plan);
  if (hit !== undefined) return hit;
  const windows: Window[] = [];
  const boxes: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const block of plan.blocks) {
    const poly = orient(block.polygon);
    const n = poly.length;
    const edges: Edge[] = [];
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = poly[i] as { x: number; z: number };
      const b = poly[(i + 1) % n] as { x: number; z: number };
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      if (!(len > 1e-9)) continue;
      // The inward normal of a counter-clockwise edge is its left.
      const nx = -ez / len;
      const nz = ex / len;
      edges.push({ nx, nz, c: nx * a.x + nz * a.z });
      x0 = Math.min(x0, a.x);
      z0 = Math.min(z0, a.z);
      x1 = Math.max(x1, a.x);
      z1 = Math.max(z1, a.z);
    }
    if (edges.length < 3) continue;
    const out = block.district === "outskirts";
    const hold = out ? COVER_OUT_HOLD : COVER_HOLD;
    const fade = out ? COVER_OUT_FADE : COVER_FADE;
    const reach = hold + fade;
    windows.push({ edges, hold, fade, lot: out });
    boxes.push({ x0: x0 - reach, z0: z0 - reach, x1: x1 + reach, z1: z1 + reach });
  }
  // The town's own track carries a strip of made ground along it, a window to each of its segments.
  for (const spur of plan.rail.spurs) {
    for (let i = 1; i < spur.points.length; i++) {
      const a = spur.points[i - 1] as { x: number; z: number };
      const b = spur.points[i] as { x: number; z: number };
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      if (!(len > 1e-6)) continue;
      const nx = (-ez / len) * SPUR_HALF;
      const nz = (ex / len) * SPUR_HALF;
      const poly = orient([
        { x: a.x + nx, z: a.z + nz },
        { x: b.x + nx, z: b.z + nz },
        { x: b.x - nx, z: b.z - nz },
        { x: a.x - nx, z: a.z - nz },
      ]);
      const edges: Edge[] = [];
      for (let k = 0; k < 4; k++) {
        const p = poly[k] as { x: number; z: number };
        const q = poly[(k + 1) % 4] as { x: number; z: number };
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        const inx = -dz / l;
        const inz = dx / l;
        edges.push({ nx: inx, nz: inz, c: inx * p.x + inz * p.z });
      }
      const reach = COVER_SPUR_HOLD + COVER_SPUR_FADE;
      windows.push({ edges, hold: COVER_SPUR_HOLD, fade: COVER_SPUR_FADE, lot: false });
      boxes.push({ x0: Math.min(a.x, b.x) - SPUR_HALF - reach, z0: Math.min(a.z, b.z) - SPUR_HALF - reach, x1: Math.max(a.x, b.x) + SPUR_HALF + reach, z1: Math.max(a.z, b.z) + SPUR_HALF + reach });
    }
  }
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  for (const b of boxes) {
    bx0 = Math.min(bx0, b.x0);
    bz0 = Math.min(bz0, b.z0);
    bx1 = Math.max(bx1, b.x1);
    bz1 = Math.max(bz1, b.z1);
  }
  if (boxes.length === 0) {
    const empty: CoverIndex = { windows, x0: 0, z0: 0, nx: 0, nz: 0, cells: [] };
    INDEX.set(plan, empty);
    return empty;
  }
  const nx = Math.floor((bx1 - bx0) / CELL) + 1;
  const nz = Math.floor((bz1 - bz0) / CELL) + 1;
  const cells: number[][] = [];
  for (let i = 0; i < nx * nz; i++) cells.push([]);
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k] as (typeof boxes)[number];
    const i0 = Math.floor((b.x0 - bx0) / CELL);
    const i1 = Math.floor((b.x1 - bx0) / CELL);
    const j0 = Math.floor((b.z0 - bz0) / CELL);
    const j1 = Math.floor((b.z1 - bz0) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (cells[i * nz + j] as number[]).push(k);
  }
  const index: CoverIndex = { windows, x0: bx0, z0: bz0, nx, nz, cells };
  INDEX.set(plan, index);
  return index;
}

/** One window's weight and gradient at a point: 0 if it is out of reach, 1 and no slope where it holds whole. */
function windowD(w: Window, x: number, z: number): { v: number; dx: number; dz: number } {
  const edges = w.edges;
  const n = edges.length;
  const near = -w.hold;
  const far = -(w.hold + w.fade);
  let v = 1;
  for (let i = 0; i < n; i++) {
    const e = edges[i] as Edge;
    const dist = e.nx * x + e.nz * z - e.c;
    if (dist <= far) return { v: 0, dx: 0, dz: 0 };
    if (dist < near) v *= smootherstepD(far, near, dist).v;
  }
  if (v === 1) return { v: 1, dx: 0, dz: 0 };
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < n; i++) {
    const e = edges[i] as Edge;
    const dist = e.nx * x + e.nz * z - e.c;
    if (dist >= near) continue;
    const s = smootherstepD(far, near, dist);
    // The product of the other edges' factors.
    const others = v / s.v;
    dx += s.d * e.nx * others;
    dz += s.d * e.nz * others;
  }
  return { v, dx, dz };
}

/** The quay's own window: 1 within `COVER_HOLD` metres of the quay's line, falling to 0 over `COVER_FADE` beyond, so the waterfront's ground is whole to its ends. */
function quayWindowD(plan: TownPlan, xf: number, zr: number): { v: number; dx: number; dz: number } {
  const { a, b } = plan.quay;
  const qx = b.x - a.x;
  const qz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((xf - a.x) * qx + (zr - a.z) * qz) / (qx * qx + qz * qz)));
  const ex = xf - (a.x + t * qx);
  const ez = zr - (a.z + t * qz);
  const d = Math.sqrt(ex * ex + ez * ez);
  if (d >= COVER_HOLD + COVER_FADE) return { v: 0, dx: 0, dz: 0 };
  if (d <= COVER_HOLD) return { v: 1, dx: 0, dz: 0 };
  const s = smootherstepD(COVER_HOLD, COVER_HOLD + COVER_FADE, d);
  return { v: 1 - s.v, dx: (-s.d * ex) / d, dz: (-s.d * ez) / d };
}

/** The town's cover at a point of the plan's frame, with its gradient: the smooth union of the block windows near it, and the quay's. `withLots` false leaves out the outlying lots' windows: the ground they stand on is the land's own, and only the forest and the cliff bands keep off them. */
export function coverD(plan: TownPlan, xf: number, zr: number, withLots = true): { v: number; dx: number; dz: number } {
  const quay = quayWindowD(plan, xf, zr);
  if (quay.v === 1) return quay;
  const blocks = blocksCoverD(plan, xf, zr, withLots);
  if (quay.v === 0) return blocks;
  if (blocks.v === 1) return blocks;
  // The union: 1 - w = (1 - quay)(1 - blocks).
  return {
    v: 1 - (1 - quay.v) * (1 - blocks.v),
    dx: (1 - blocks.v) * quay.dx + (1 - quay.v) * blocks.dx,
    dz: (1 - blocks.v) * quay.dz + (1 - quay.v) * blocks.dz,
  };
}

/** The union of the block windows near a point. */
function blocksCoverD(plan: TownPlan, xf: number, zr: number, withLots: boolean): { v: number; dx: number; dz: number } {
  const index = coverIndexOf(plan);
  const i = Math.floor((xf - index.x0) / CELL);
  const j = Math.floor((zr - index.z0) / CELL);
  if (i < 0 || j < 0 || i >= index.nx || j >= index.nz) return { v: 0, dx: 0, dz: 0 };
  const list = index.cells[i * index.nz + j] as readonly number[];
  // The union's complement is the product of the windows' complements: 1 - w = product of (1 - w_i).
  let rest = 1;
  let restDx = 0;
  let restDz = 0;
  for (let k = 0; k < list.length; k++) {
    const w = index.windows[list[k] as number] as Window;
    if (w.lot && !withLots) continue;
    const a = windowD(w, xf, zr);
    if (a.v === 0) continue;
    if (a.v === 1) return { v: 1, dx: 0, dz: 0 };
    restDx = (1 - a.v) * restDx - rest * a.dx;
    restDz = (1 - a.v) * restDz - rest * a.dz;
    rest *= 1 - a.v;
  }
  return { v: 1 - rest, dx: 0 - restDx, dz: 0 - restDz };
}

/** The town's cover for a world's seed at a point of the plan's frame. */
export function townCoverD(seed: number, xf: number, zr: number): { v: number; dx: number; dz: number } {
  return coverD(planFor(seed), xf, zr);
}
