/**
 * The town's buildings as walls the player cannot pass: the game's own rule for where a player may stand
 * (`Rules.constrain`, which runs on every machine after a player's move). The engine's colliders are
 * axis-aligned boxes and the old town's grid is turned, so buildings are collided with here, as the exact
 * oriented rectangles the plan holds (`centre`, `halfAlong`, `halfAcross`, `bearing`).
 *
 * The hull is a circle of `HULL_RADIUS` in plan. Against a rectangle the circle is moved out along the
 * direction of least penetration: the nearest point of the rectangle to the centre gives the way out (along
 * the line from a corner when the circle meets a corner), and a centre inside the rectangle is taken out by
 * the nearest side. The velocity then loses the part that points into the wall, so a walker slides along it.
 * Two buildings that meet in a corner are settled by passes: a fixed few, each over the buildings near.
 *
 * A uniform grid over the town (cells of `SOLID_CELL` m, built once per world seed and kept in a top-level
 * cache) names the buildings near a position, so a player costs a handful of tests a tick. A building is
 * a column from the ground to the sky: nothing here reads the player's height (a jump reaches a metre and a
 * third; every wall is higher, a ruin's the lowest at 2.5 m).
 *
 * Skipped: the piers (kind `pier`): a pier is its deck, which is ground (`decks.ts`), and no wall. The sheds on piles stand
 * on their decks and are solid like any building. The harbour's rails are held to after the walls, in the same passes.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only, and the cache is only a lookup.
 */
import { bearingU } from "./bearings.js";
import { constrainRails } from "./decks.js";
import { constrainTrestle } from "./railDeck.js";
import { HULL_RADIUS } from "./hull.js";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import { constrainProps, propSolids } from "./propSolid.js";

const abs = Math.abs;
const min = Math.min;
const max = Math.max;
const floor = Math.floor;
const sqrt = Math.sqrt;

export { HULL_RADIUS };
/** The grid's cell, metres. */
export const SOLID_CELL = 16;
/** The passes a position gets: a corner of two buildings is settled in two or three, a narrow wedge between two walls in a few more. */
export const SOLID_PASSES = 8;
/** What a push leaves between the hull and the wall, metres: the hull ends clear, never touching. */
const CLEAR = 1e-6;
/** How far past a building's own box a grid cell is listed for it: more than the hull's radius. */
const REACH = 1;
/** Numbers a building takes in `rects`: its centre (x, z), its along axis (x, z), its half extents (along, across). */
export const STRIDE = 6;

/** The solid buildings of a town, and the grid that names the ones near a place. */
export type TownSolids = {
  /** The ids of the solid buildings, in the plan's order. */
  readonly ids: readonly number[];
  /** Each one's numbers (`STRIDE`): world centre x and z, along axis x and z (the across axis is its turn: (z, -x)), half along, half across. */
  readonly rects: Float64Array;
  /** The grid's south-west corner (world x, z) and its size in cells. */
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Cell `c` lists `list[start[c] .. start[c + 1]]`: indices into `ids` and `rects`. */
  readonly start: Int32Array;
  readonly list: Int32Array;
};

const SOLIDS = new Map<number, TownSolids>();

/** The solid buildings of a world seed's town, made once. */
export function townSolids(worldSeed: number): TownSolids {
  let made = SOLIDS.get(worldSeed);
  if (made === undefined) {
    made = makeSolids(worldSeed);
    SOLIDS.set(worldSeed, made);
  }
  return made;
}

/** A pier is its deck and no wall; every other building is solid, a shed on piles among them (it stands on its deck). */
export function isSolid(b: { readonly kind: string }): boolean {
  return b.kind !== "pier";
}

function makeSolids(worldSeed: number): TownSolids {
  const { anchor } = siteFor(worldSeed);
  const plan = planFor(worldSeed);
  const ids: number[] = [];
  for (const b of plan.buildings) if (isSolid(b)) ids.push(b.id);
  const n = ids.length;
  const rects = new Float64Array(n * STRIDE);
  const lowX = new Float64Array(n);
  const lowZ = new Float64Array(n);
  const highX = new Float64Array(n);
  const highZ = new Float64Array(n);
  const byId = plan.buildings;
  for (let i = 0; i < n; i++) {
    const b = byId[ids[i] as number];
    if (b === undefined || b.id !== ids[i]) throw new Error("a building's id is not its place in the plan");
    const u = bearingU(b.bearing);
    const cx = anchor.x + b.centre.x;
    const cz = anchor.z + b.centre.z;
    const o = i * STRIDE;
    rects[o] = cx;
    rects[o + 1] = cz;
    rects[o + 2] = u.x;
    rects[o + 3] = u.z;
    rects[o + 4] = b.halfAlong;
    rects[o + 5] = b.halfAcross;
    // The box that holds the turned rectangle, and the reach past it.
    const ex = abs(u.x) * b.halfAlong + abs(u.z) * b.halfAcross + REACH;
    const ez = abs(u.z) * b.halfAlong + abs(u.x) * b.halfAcross + REACH;
    lowX[i] = cx - ex;
    highX[i] = cx + ex;
    lowZ[i] = cz - ez;
    highZ[i] = cz + ez;
  }
  return { ids, ...gridOf(rects, n, lowX, highX, lowZ, highZ) };
}

/** The grid over `n` rectangles whose reaching boxes are given: shared with the props' solids (`propSolid.ts`). */
export function gridOf(rects: Float64Array, n: number, lowX: Float64Array, highX: Float64Array, lowZ: Float64Array, highZ: Float64Array): Omit<TownSolids, "ids"> {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = min(minX, lowX[i] as number);
    maxX = max(maxX, highX[i] as number);
    minZ = min(minZ, lowZ[i] as number);
    maxZ = max(maxZ, highZ[i] as number);
  }
  if (n === 0) return { rects, x0: 0, z0: 0, cols: 0, rows: 0, start: new Int32Array(1), list: new Int32Array(0) };
  const x0 = floor(minX / SOLID_CELL) * SOLID_CELL;
  const z0 = floor(minZ / SOLID_CELL) * SOLID_CELL;
  const cols = floor((maxX - x0) / SOLID_CELL) + 1;
  const rows = floor((maxZ - z0) / SOLID_CELL) + 1;
  // The cells each building's box reaches, counted and then listed (a compressed row layout).
  const start = new Int32Array(cols * rows + 1);
  const range = (i: number): [number, number, number, number] => [
    floor(((lowX[i] as number) - x0) / SOLID_CELL),
    floor(((highX[i] as number) - x0) / SOLID_CELL),
    floor(((lowZ[i] as number) - z0) / SOLID_CELL),
    floor(((highZ[i] as number) - z0) / SOLID_CELL),
  ];
  for (let i = 0; i < n; i++) {
    const [c0, c1, r0, r1] = range(i);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * cols + c + 1] = (start[r * cols + c + 1] as number) + 1;
  }
  for (let c = 0; c < cols * rows; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
  const list = new Int32Array(start[cols * rows] as number);
  const filled = new Int32Array(cols * rows);
  for (let i = 0; i < n; i++) {
    const [c0, c1, r0, r1] = range(i);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * cols + c;
        list[(start[cell] as number) + (filled[cell] as number)] = i;
        filled[cell] = (filled[cell] as number) + 1;
      }
    }
  }
  return { rects, x0, z0, cols, rows, start, list };
}

/** A place and a velocity, as `Rules.constrain` is handed them. */
type Point = { x: number; y: number; z: number };

/**
 * Moves a hull out of the building `i` it overlaps and takes the velocity's part into it away. Returns whether
 * it acted; a hull that touches nothing is left exactly as it was. `radius` is the circle's (the player's hull by default).
 */
export function pushOut(solids: TownSolids, i: number, pos: Point, vel: Point, radius: number = HULL_RADIUS): boolean {
  const r = solids.rects;
  const o = i * STRIDE;
  const ux = r[o + 2] as number;
  const uz = r[o + 3] as number;
  const hu = r[o + 4] as number;
  const hv = r[o + 5] as number;
  const dx = pos.x - (r[o] as number);
  const dz = pos.z - (r[o + 1] as number);
  // The hull's centre in the building's own axes: along, and across (the across axis is (uz, -ux)).
  const lu = dx * ux + dz * uz;
  const lv = dx * uz - dz * ux;
  const qu = max(-hu, min(hu, lu));
  const qv = max(-hv, min(hv, lv));
  const eu = lu - qu;
  const ev = lv - qv;
  const d2 = eu * eu + ev * ev;
  if (d2 >= radius * radius) return false;
  let nu: number;
  let nv: number;
  let push: number;
  if (d2 > 0) {
    // Outside the rectangle: away from its nearest point, which is a corner's own where the circle meets a corner.
    const d = sqrt(d2);
    nu = eu / d;
    nv = ev / d;
    push = radius - d + CLEAR;
  } else {
    // The centre is inside, or on an edge: out by the nearest side.
    const pu = hu - abs(lu);
    const pv = hv - abs(lv);
    if (pu <= pv) {
      nu = lu < 0 ? -1 : 1;
      nv = 0;
      push = pu + radius + CLEAR;
    } else {
      nu = 0;
      nv = lv < 0 ? -1 : 1;
      push = pv + radius + CLEAR;
    }
  }
  // The wall's normal in the world: nu along the building's axis, nv across it.
  const nx = nu * ux + nv * uz;
  const nz = nu * uz - nv * ux;
  pos.x += nx * push;
  pos.z += nz * push;
  const into = vel.x * nx + vel.z * nz;
  if (into < 0) {
    vel.x -= into * nx;
    vel.z -= into * nz;
  }
  return true;
}

/**
 * The rule: the hull at `pos` may not stand in a building. Called by the engine's tick after a player's move,
 * on the host and on every client alike.
 */
export function townConstrain(world: { readonly forest: { readonly seed: number } }, pos: Point, vel: Point): void {
  const solids = townSolids(world.forest.seed);
  for (let pass = 0; pass < SOLID_PASSES; pass++) {
    const c = floor((pos.x - solids.x0) / SOLID_CELL);
    const r = floor((pos.z - solids.z0) / SOLID_CELL);
    // The props' boxes first (vehicles, trailers, fences, poles, bins, mailboxes: `propSolid.ts`), then the walls, so that where the two wedge a hull the buildings keep it out.
    let moved = constrainProps(world.forest.seed, pos, vel);
    if (c >= 0 && r >= 0 && c < solids.cols && r < solids.rows) {
      const cell = r * solids.cols + c;
      const end = solids.start[cell + 1] as number;
      for (let k = solids.start[cell] as number; k < end; k++) {
        if (pushOut(solids, solids.list[k] as number, pos, vel)) moved = true;
      }
    }
    // The harbour's rails, after the walls: a hull on a deck is held to it (`decks.ts`).
    if (constrainRails(world.forest.seed, pos, vel)) moved = true;
    // And a trestle's guard rails (`railDeck.ts`).
    if (constrainTrestle(world.forest.seed, pos, vel)) moved = true;
    if (!moved) return;
  }
}

/**
 * A circle of `radius` moved out of every building and prop its box touches: every cell the circle reaches is read, not
 * the one under its centre, so a circle wider than the grid's margin still meets what it overlaps. Passes, as `townConstrain`'s.
 * Returns whether it moved.
 */
export function constrainCircle(worldSeed: number, pos: Point, vel: Point, radius: number): boolean {
  const solids = townSolids(worldSeed);
  const props = propSolids(worldSeed).full;
  let any = false;
  for (let pass = 0; pass < SOLID_PASSES; pass++) {
    // The props first, then the buildings, as `townConstrain` does: where the two wedge a circle the buildings keep it out.
    const inProps = pushGrid(props, pos, vel, radius);
    const inWalls = pushGrid(solids, pos, vel, radius);
    if (!inProps && !inWalls) return any;
    any = true;
  }
  return any;
}

/** Moves the circle out of every box listed in the cells it reaches. Returns whether it moved. */
function pushGrid(grid: TownSolids, pos: Point, vel: Point, radius: number): boolean {
  if (grid.cols === 0) return false;
  const c0 = max(0, floor((pos.x - radius - grid.x0) / SOLID_CELL));
  const c1 = min(grid.cols - 1, floor((pos.x + radius - grid.x0) / SOLID_CELL));
  const r0 = max(0, floor((pos.z - radius - grid.z0) / SOLID_CELL));
  const r1 = min(grid.rows - 1, floor((pos.z + radius - grid.z0) / SOLID_CELL));
  let moved = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * grid.cols + c;
      const end = grid.start[cell + 1] as number;
      for (let k = grid.start[cell] as number; k < end; k++) {
        if (pushOut(grid, grid.list[k] as number, pos, vel, radius)) moved = true;
      }
    }
  }
  return moved;
}

/** The solid buildings near a place: for a test, which asks what the grid names. */
export function solidsNear(worldSeed: number, x: number, z: number): number[] {
  const solids = townSolids(worldSeed);
  const c = floor((x - solids.x0) / SOLID_CELL);
  const r = floor((z - solids.z0) / SOLID_CELL);
  const out: number[] = [];
  if (c < 0 || r < 0 || c >= solids.cols || r >= solids.rows) return out;
  const cell = r * solids.cols + c;
  for (let k = solids.start[cell] as number; k < (solids.start[cell + 1] as number); k++) out.push(solids.ids[solids.list[k] as number] as number);
  return out;
}

/** How far the hull at (x, z) stands inside building `id`'s rectangle, metres (0 where it clears it): for a test. */
export function penetration(worldSeed: number, id: number, x: number, z: number): number {
  const solids = townSolids(worldSeed);
  const i = solids.ids.indexOf(id);
  if (i < 0) return 0;
  const o = i * STRIDE;
  const r = solids.rects;
  const ux = r[o + 2] as number;
  const uz = r[o + 3] as number;
  const dx = x - (r[o] as number);
  const dz = z - (r[o + 1] as number);
  const lu = dx * ux + dz * uz;
  const lv = dx * uz - dz * ux;
  const eu = lu - max(-(r[o + 4] as number), min(r[o + 4] as number, lu));
  const ev = lv - max(-(r[o + 5] as number), min(r[o + 5] as number, lv));
  const d = sqrt(eu * eu + ev * ev);
  if (d > 0) return max(0, HULL_RADIUS - d);
  return HULL_RADIUS + min((r[o + 4] as number) - abs(lu), (r[o + 5] as number) - abs(lv));
}
