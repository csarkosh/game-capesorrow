/**
 * What a wheel runs on at a place in the world: the one question the car's top speed and grip are answered from.
 * First match wins: a deck stands here (paved); within the highway's bed of its centre (paved); within half the
 * roadway of a street's centre line (paved for a main street, street, avenue, highway and wharf; gravel for an alley;
 * a stair and a rail are no road); within half the width of a road out, the surface of the nearer end of the segment
 * (paved, gravel or two wheel tracks); inside a paved ground polygon (gravel on the dock end, the mill's site and the
 * industrial flats, else paved); otherwise open ground.
 *
 * Where a paved and a gravel street meet, paved wins. A uniform grid of `SURFACE_CELL` m over the town's streets, roads
 * and polygons, made once per world seed and kept in a top-level cache, names what lies near a place, so a lookup
 * touches one cell.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max` only, and the cache is only a lookup.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { deckTopAt } from "../town/decks.js";
import { pavedGround } from "../town/pavedGround.js";
import { planFor } from "../town/planFor.js";
import { siteFor } from "../town/siteFor.js";
import { gridOf, type TownSolids } from "../town/solid.js";
import type { RoadSurface } from "../town/types.js";
import { GRAVEL, OPEN, PAVED, TRACKS, type Surface } from "./types.js";

const abs = Math.abs;
const min = Math.min;
const max = Math.max;
const floor = Math.floor;

/** The grid's cell, metres. */
export const SURFACE_CELL = 16;

/** Numbers a street takes in `streets`: its ends (x, z, x, z), half its roadway, and 1 when it is gravel. */
const S = 6;
/** Numbers a road segment takes in `segs`: its ends (x, z, x, z), the half widths at them, and the surfaces there. */
const R = 8;

type SurfaceGrid = {
  readonly streets: Float64Array;
  readonly segs: Float64Array;
  /** Each polygon's first number in `verts` (x, z pairs), with one more to end the last; and 1 when it is gravel. */
  readonly polyStart: Int32Array;
  readonly polyGravel: Uint8Array;
  readonly verts: Float64Array;
  /** The items of a cell are the streets, then the segments, then the polygons, numbered in that order. */
  readonly nStreets: number;
  readonly nSegs: number;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly start: Int32Array;
  readonly list: Int32Array;
};

const GRIDS = new Map<number, SurfaceGrid>();

/** The grid of a world seed's town, made once. */
export function surfaceGrid(worldSeed: number): SurfaceGrid {
  let made = GRIDS.get(worldSeed);
  if (made === undefined) {
    made = makeGrid(worldSeed);
    GRIDS.set(worldSeed, made);
  }
  return made;
}

const surfaceOf = (s: RoadSurface): number => (s === "paved" ? PAVED : s === "gravel" ? GRAVEL : TRACKS);

function makeGrid(worldSeed: number): SurfaceGrid {
  const { anchor } = siteFor(worldSeed);
  const plan = planFor(worldSeed);
  const paved = pavedGround(plan);
  const lows: number[] = [];
  const highs: number[] = [];
  const lowsZ: number[] = [];
  const highsZ: number[] = [];
  const reach = (x0: number, z0: number, x1: number, z1: number, pad: number): void => {
    lows.push(min(x0, x1) - pad);
    highs.push(max(x0, x1) + pad);
    lowsZ.push(min(z0, z1) - pad);
    highsZ.push(max(z0, z1) + pad);
  };

  const streetList = plan.streets.filter((st) => st.kind !== "stair" && st.kind !== "rail");
  const streets = new Float64Array(streetList.length * S);
  streetList.forEach((st, i) => {
    const o = i * S;
    streets[o] = anchor.x + st.a.x;
    streets[o + 1] = anchor.z + st.a.z;
    streets[o + 2] = anchor.x + st.b.x;
    streets[o + 3] = anchor.z + st.b.z;
    streets[o + 4] = st.roadway / 2;
    streets[o + 5] = st.kind === "alley" ? 1 : 0;
    reach(streets[o] as number, streets[o + 1] as number, streets[o + 2] as number, streets[o + 3] as number, st.roadway / 2);
  });

  let nSegs = 0;
  for (const road of plan.roads) nSegs += max(0, road.points.length - 1);
  const segs = new Float64Array(nSegs * R);
  let k = 0;
  for (const road of plan.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1] as { x: number; z: number; width: number; surface: RoadSurface };
      const b = road.points[i] as { x: number; z: number; width: number; surface: RoadSurface };
      const o = k * R;
      segs[o] = anchor.x + a.x;
      segs[o + 1] = anchor.z + a.z;
      segs[o + 2] = anchor.x + b.x;
      segs[o + 3] = anchor.z + b.z;
      segs[o + 4] = a.width / 2;
      segs[o + 5] = b.width / 2;
      segs[o + 6] = surfaceOf(a.surface);
      segs[o + 7] = surfaceOf(b.surface);
      reach(segs[o] as number, segs[o + 1] as number, segs[o + 2] as number, segs[o + 3] as number, max(a.width, b.width) / 2);
      k++;
    }
  }

  const polyStart = new Int32Array(paved.length + 1);
  const polyGravel = new Uint8Array(paved.length);
  let nv = 0;
  for (const g of paved) nv += g.polygon.length;
  const verts = new Float64Array(nv * 2);
  let v = 0;
  paved.forEach((g, i) => {
    polyStart[i] = v;
    polyGravel[i] = g.district === "dock" || g.district === "mill" || g.district === "industrial" ? 1 : 0;
    let lowX = Infinity;
    let highX = -Infinity;
    let lowZ = Infinity;
    let highZ = -Infinity;
    for (const q of g.polygon) {
      verts[v * 2] = anchor.x + q.x;
      verts[v * 2 + 1] = anchor.z + q.z;
      lowX = min(lowX, anchor.x + q.x);
      highX = max(highX, anchor.x + q.x);
      lowZ = min(lowZ, anchor.z + q.z);
      highZ = max(highZ, anchor.z + q.z);
      v++;
    }
    reach(lowX, lowZ, highX, highZ, 0);
  });
  polyStart[paved.length] = v;

  const n = lows.length;
  const grid = gridOf(new Float64Array(0), n, Float64Array.from(lows), Float64Array.from(highs), Float64Array.from(lowsZ), Float64Array.from(highsZ));
  return { streets, segs, polyStart, polyGravel, verts, nStreets: streetList.length, nSegs, ...cellsOf(grid) };
}

function cellsOf(g: Omit<TownSolids, "ids">): Pick<SurfaceGrid, "x0" | "z0" | "cols" | "rows" | "start" | "list"> {
  return { x0: g.x0, z0: g.z0, cols: g.cols, rows: g.rows, start: g.start, list: g.list };
}

/** How far along the segment a-b (0 to 1) the point nearest (x, z) lies. */
function nearestT(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  return len2 > 0 ? max(0, min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
}

/** The squared distance from (x, z) to the point a fraction `t` along the segment a-b. */
function dist2(x: number, z: number, ax: number, az: number, bx: number, bz: number, t: number): number {
  const ex = x - (ax + t * (bx - ax));
  const ez = z - (az + t * (bz - az));
  return ex * ex + ez * ez;
}

/** What the ground is at the world point (x, z): `PAVED`, `GRAVEL`, `TRACKS` or `OPEN`. */
export function surfaceAt(worldSeed: number, x: number, z: number): Surface {
  if (deckTopAt(worldSeed, x, z) !== null) return PAVED;
  if (abs(x - roadCenterX(worldSeed, z)) <= ROAD_BED_HALF) return PAVED;
  const g = surfaceGrid(worldSeed);
  const c = floor((x - g.x0) / SURFACE_CELL);
  const r = floor((z - g.z0) / SURFACE_CELL);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return OPEN;
  const cell = r * g.cols + c;
  const from = g.start[cell] as number;
  const to = g.start[cell + 1] as number;
  // Streets: paved wins over an alley's gravel.
  let gravel = false;
  for (let k = from; k < to; k++) {
    const i = g.list[k] as number;
    if (i >= g.nStreets) break;
    const o = i * S;
    const half = g.streets[o + 4] as number;
    const ax = g.streets[o] as number;
    const az = g.streets[o + 1] as number;
    const bx = g.streets[o + 2] as number;
    const bz = g.streets[o + 3] as number;
    if (dist2(x, z, ax, az, bx, bz, nearestT(x, z, ax, az, bx, bz)) > half * half) continue;
    if (g.streets[o + 5] === 0) return PAVED;
    gravel = true;
  }
  if (gravel) return GRAVEL;
  // Roads out: the nearest segment that holds the point gives the surface of its nearer end.
  let best = Infinity;
  let surface: Surface = OPEN;
  for (let k = from; k < to; k++) {
    const i = (g.list[k] as number) - g.nStreets;
    if (i < 0) continue;
    if (i >= g.nSegs) break;
    const o = i * R;
    const ax = g.segs[o] as number;
    const az = g.segs[o + 1] as number;
    const bx = g.segs[o + 2] as number;
    const bz = g.segs[o + 3] as number;
    const t = nearestT(x, z, ax, az, bx, bz);
    const d2 = dist2(x, z, ax, az, bx, bz, t);
    const half = (g.segs[o + 4] as number) * (1 - t) + (g.segs[o + 5] as number) * t;
    if (d2 > half * half || d2 >= best) continue;
    best = d2;
    surface = (t < 0.5 ? g.segs[o + 6] : g.segs[o + 7]) as Surface;
  }
  if (surface !== OPEN) return surface;
  // Paved ground: a convex polygon wound counter-clockwise holds a point that is left of every edge.
  for (let k = from; k < to; k++) {
    const p = (g.list[k] as number) - g.nStreets - g.nSegs;
    if (p < 0) continue;
    const s = g.polyStart[p] as number;
    const e = g.polyStart[p + 1] as number;
    let inside = true;
    for (let j = s; j < e && inside; j++) {
      const n = j + 1 < e ? j + 1 : s;
      const ax = g.verts[j * 2] as number;
      const az = g.verts[j * 2 + 1] as number;
      if ((g.verts[n * 2] as number - ax) * (z - az) - (g.verts[n * 2 + 1] as number - az) * (x - ax) < 0) inside = false;
    }
    if (inside) return g.polyGravel[p] === 1 ? GRAVEL : PAVED;
  }
  return OPEN;
}
