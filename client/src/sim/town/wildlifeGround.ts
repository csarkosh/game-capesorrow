/**
 * Where the town's animals may not be: the place's `wildlifeGround` (`CoastOverlay.wildlifeGround`), which the engine's
 * ambient wildlife asks wherever it anchors an animal or takes a step. The engine places elk, deer, rabbits, squirrels
 * and butterflies as a pure function of the world seed, and the town's lawns make the whole town forest ground to it, so
 * without this herds stand in the streets.
 *
 * The rule: the large animals may come up to the town's outskirts and not into it; rabbits keep to the house yards near
 * its edge; squirrels and butterflies are free (the engine keeps them to trees and flowers).
 *
 * It is the renderer's alone and is no part of the place's tunables: the plan and the ground never read it, so it moves
 * no digest and no level id.
 *
 * The town is read once per world seed on a coarse grid over the plan's bounds, and what is asked of a place is a
 * lookup. Only a rabbit inside the town's rim reads the buildings, to see whose yard it is in.
 */
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { bearingU, bearingV } from "./bearings.js";
import { contains, orient, segDist, type Poly, type Vec } from "./geom.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import type { Building, BuildingKind, TownPlan } from "./types.js";

/** Every number of the rule. None is a tunable of the place: the hook is the renderer's alone. */
export const WILDLIFE_TUNING = {
  /** The wildlife field's species numbers (`game/wildlifeField.ts` in the engine), held here because nothing in `sim/` may import the engine's `game/`. A test holds them to the engine's. */
  elk: 0,
  deer: 1,
  rabbit: 2,
  /** The grid's cell, in metres. */
  cell: 16,
  /** How far from a built block, a street's right of way, the quay, the made ground behind it or the harbour's yards a place is still the town (m). A cell is the town if any part of it is within this. */
  townReach: 25,
  /** The most a cell's centre can lie from the nearest point of the cell (m): half its diagonal, rounded up. Added to `townReach` for a cell's centre. */
  cellHalfDiagonal: 12,
  /** How far past the plan's bounds the grid reaches (m): more than `townReach` plus a cell, so its rim is never the town. */
  margin: 64,
  /** How deep into the town (m, from its nearest non-town cell) a rabbit may go. */
  rabbitDepth: 90,
  /** How far from a rabbit the nearest building is looked for (m): past it the place is a street or a lot with no house by, and no rabbit's. */
  rabbitHouseReach: 30,
  /** The kinds of building whose yards a rabbit may use. */
  houses: ["house", "boarding house"] as readonly BuildingKind[],
} as const;

const T = WILDLIFE_TUNING;
/** The 3-4 chamfer's step: three for a side, four for a diagonal, each a third of a cell. */
const SIDE = 3;
const DIAGONAL = 4;

type Box = { x0: number; z0: number; x1: number; z1: number };

type TownGrid = {
  /** The grid's corner, in the plan's frame. */
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** Per cell, the chamfer depth into the town in thirds of a cell, 0 outside it. */
  readonly depth: Int32Array;
  readonly plan: TownPlan;
  /** The buildings of lots by grid cell (index `i * nz + j`), for the rabbit's look at what stands by. */
  readonly byCell: readonly (readonly Building[])[];
};

const GRIDS = new Map<number, TownGrid>();
/** The last grid asked for: this is asked many times a frame, and nearly always of one seed. */
let lastSeed = NaN;
let lastGrid: TownGrid | null = null;

function gridFor(seed: number): TownGrid {
  if (seed === lastSeed && lastGrid !== null) return lastGrid;
  let grid = GRIDS.get(seed);
  if (grid === undefined) {
    grid = buildGrid(seed);
    GRIDS.set(seed, grid);
  }
  lastSeed = seed;
  lastGrid = grid;
  return grid;
}

/** Marks every cell whose centre is within `reach` of a shape, by the shape's box and its distance to a point. */
function mark(town: Uint8Array, g: { x0: number; z0: number; nx: number; nz: number }, box: Box, reach: number, distance: (p: Vec) => number): void {
  const cell = T.cell;
  const i0 = Math.max(0, Math.floor((box.x0 - reach - g.x0) / cell));
  const i1 = Math.min(g.nx - 1, Math.floor((box.x1 + reach - g.x0) / cell));
  const j0 = Math.max(0, Math.floor((box.z0 - reach - g.z0) / cell));
  const j1 = Math.min(g.nz - 1, Math.floor((box.z1 + reach - g.z0) / cell));
  const p: Vec = { x: 0, z: 0 };
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = i * g.nz + j;
      if (town[k] === 1) continue;
      p.x = g.x0 + (i + 0.5) * cell;
      p.z = g.z0 + (j + 0.5) * cell;
      if (distance(p) <= reach) town[k] = 1;
    }
  }
}

function polyBox(poly: readonly Vec[]): Box {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

/** The distance from a point to a convex polygon: 0 inside it. */
function polyDistance(poly: Poly, p: Vec): number {
  if (contains(poly, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i] as Vec, poly[(i + 1) % poly.length] as Vec));
  return best;
}

function buildGrid(seed: number): TownGrid {
  const plan = planFor(seed);
  const cell = T.cell;
  const b = plan.bounds;
  const x0 = b.x0 - T.margin;
  const z0 = b.z0 - T.margin;
  const nx = Math.floor((b.x1 + T.margin - x0) / cell) + 1;
  const nz = Math.floor((b.z1 + T.margin - z0) / cell) + 1;
  const g = { x0, z0, nx, nz };
  const town = new Uint8Array(nx * nz);
  const reach = T.townReach + T.cellHalfDiagonal;

  // The built blocks (a lot of the outskirts, standing alone past the last blocks, is not the town), which hold every
  // paved lot and every yard.
  for (const blk of plan.blocks) {
    if (blk.district === "outskirts") continue;
    const poly = orient(blk.polygon);
    mark(town, g, polyBox(poly), reach, (p) => polyDistance(poly, p));
  }
  // The streets' rights of way (not the highway, the engine's own, nor the rail, nor the wharf over water).
  for (const st of plan.streets) {
    if (st.kind === "highway" || st.kind === "wharf" || st.kind === "rail") continue;
    const half = st.width / 2;
    const box = polyBox([st.a, st.b]);
    mark(town, g, { x0: box.x0 - half, z0: box.z0 - half, x1: box.x1 + half, z1: box.z1 + half }, reach, (p) => segDist(p, st.a, st.b) - half);
  }
  // The quay and the made ground behind it.
  const qa = plan.quay.a;
  const qb = plan.quay.b;
  mark(town, g, polyBox([qa, qb]), reach, (p) => segDist(p, qa, qb));
  for (const f of plan.fill) {
    const poly = orient(f.polygon);
    mark(town, g, polyBox(poly), reach, (p) => polyDistance(poly, p));
  }
  // The harbour's yards: the terminal's cargo.
  for (const item of plan.harbour.terminal?.yard ?? []) {
    mark(
      town,
      g,
      { x0: item.x - item.halfX, z0: item.z - item.halfZ, x1: item.x + item.halfX, z1: item.z + item.halfZ },
      reach,
      (p) => {
        const dx = Math.max(Math.abs(p.x - item.x) - item.halfX, 0);
        const dz = Math.max(Math.abs(p.z - item.z) - item.halfZ, 0);
        return Math.sqrt(dx * dx + dz * dz);
      },
    );
  }

  // What the town wholly encloses is the town: the non-town cells that reach the grid's rim, by their four sides, are
  // outside it, and every other (a wooded block in the middle of the grid, a gap) is within.
  const outside = new Uint8Array(nx * nz);
  const stack: number[] = [];
  const push = (i: number, j: number): void => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = i * nz + j;
    if (town[k] === 1 || outside[k] === 1) return;
    outside[k] = 1;
    stack.push(k);
  };
  for (let i = 0; i < nx; i++) { push(i, 0); push(i, nz - 1); }
  for (let j = 0; j < nz; j++) { push(0, j); push(nx - 1, j); }
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const i = Math.floor(k / nz);
    const j = k - i * nz;
    push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1);
  }

  // Each town cell's depth: the chamfer's distance to the nearest cell that is not the town, in a third of a cell.
  const far = 1 << 28;
  const depth = new Int32Array(nx * nz);
  for (let k = 0; k < depth.length; k++) depth[k] = outside[k] === 1 ? 0 : far;
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : (depth[i * nz + j] as number));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      let d = depth[k] as number;
      d = Math.min(d, at(i - 1, j) + SIDE, at(i, j - 1) + SIDE, at(i - 1, j - 1) + DIAGONAL, at(i - 1, j + 1) + DIAGONAL);
      depth[k] = d;
    }
  }
  for (let i = nx - 1; i >= 0; i--) {
    for (let j = nz - 1; j >= 0; j--) {
      const k = i * nz + j;
      let d = depth[k] as number;
      d = Math.min(d, at(i + 1, j) + SIDE, at(i, j + 1) + SIDE, at(i + 1, j + 1) + DIAGONAL, at(i + 1, j - 1) + DIAGONAL);
      depth[k] = d;
    }
  }

  // The buildings of lots, by the cell their centre lies in, for a rabbit's look at what stands by.
  const byCell: Building[][] = [];
  for (let k = 0; k < nx * nz; k++) byCell.push([]);
  for (const bld of plan.buildings) {
    if (bld.lot === -1) continue;
    const i = Math.floor((bld.centre.x - x0) / cell);
    const j = Math.floor((bld.centre.z - z0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    (byCell[i * nz + j] as Building[]).push(bld);
  }
  return { x0, z0, nx, nz, depth, plan, byCell };
}

/** The distance from a point to a building's footprint: 0 on it. */
function footprintDistance(bld: Building, x: number, z: number): number {
  const u = bearingU(bld.bearing);
  const v = bearingV(bld.bearing);
  const dx = x - bld.centre.x;
  const dz = z - bld.centre.z;
  const du = Math.max(Math.abs(dx * u.x + dz * u.z) - bld.halfAlong, 0);
  const dv = Math.max(Math.abs(dx * v.x + dz * v.z) - bld.halfAcross, 0);
  return Math.sqrt(du * du + dv * dv);
}

/** Whether the nearest building to a place, within the rabbit's reach, is a house. */
function houseNear(grid: TownGrid, xf: number, zr: number): boolean {
  const cell = T.cell;
  const i = Math.floor((xf - grid.x0) / cell);
  const j = Math.floor((zr - grid.z0) / cell);
  const span = Math.floor(T.rabbitHouseReach / cell) + 1;
  let best: Building | null = null;
  let bestD: number = T.rabbitHouseReach;
  for (let di = -span; di <= span; di++) {
    for (let dj = -span; dj <= span; dj++) {
      const ci = i + di;
      const cj = j + dj;
      if (ci < 0 || cj < 0 || ci >= grid.nx || cj >= grid.nz) continue;
      const list = grid.byCell[ci * grid.nz + cj] as readonly Building[];
      for (let k = 0; k < list.length; k++) {
        const d = footprintDistance(list[k] as Building, xf, zr);
        if (d <= bestD) {
          bestD = d;
          best = list[k] as Building;
        }
      }
    }
  }
  return best !== null && T.houses.includes(best.kind);
}

/** How far into the town a place is, in metres from its nearest non-town cell (0 outside it, and past the grid): a seam for tests. */
export function townDepth(seed: number, x: number, z: number): number {
  const grid = gridFor(seed);
  const i = Math.floor((x - siteFor(seed).anchor.x - grid.x0) / T.cell);
  const j = Math.floor((z - COVE_Z - grid.z0) / T.cell);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return 0;
  return ((grid.depth[i * grid.nz + j] as number) * T.cell) / SIDE;
}

/**
 * Whether an animal of a species may be at, or walk over, a place (`CoastOverlay.wildlifeGround`). Asked only of ground the
 * engine's own rules allow, and asked many times a frame: past the grid it answers without a thought, and inside it, a lookup.
 */
export function townWildlifeGround(seed: number, species: number, x: number, z: number): boolean {
  if (species !== T.elk && species !== T.deer && species !== T.rabbit) return true;
  const grid = gridFor(seed);
  const xf = x - siteFor(seed).anchor.x;
  const zr = z - COVE_Z;
  const i = Math.floor((xf - grid.x0) / T.cell);
  const j = Math.floor((zr - grid.z0) / T.cell);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return true;
  const d = grid.depth[i * grid.nz + j] as number;
  if (d === 0) return true;
  if (species !== T.rabbit) return false;
  // A rabbit in the town: near its edge, and in a house's yard.
  if (d * T.cell > T.rabbitDepth * SIDE) return false;
  return houseNear(grid, xf, zr);
}
