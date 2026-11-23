/**
 * What the plan knows of the land, derived once from a site's grid of the coast's own heights: for a cell of
 * ground its height, its slope, whether it is buildable, and how much buildable land there is and where. The plan stays
 * a pure function of the site: this is derived from the site and nothing else, and cached on it.
 *
 * A cell is **buildable** where the ground is no steeper than `LAND_SLOPE` (14 percent), stands at least
 * `LAND_MIN_HEIGHT` metres above the sea (the coast's own flats between the water and the highway stand 0 to 2 m, and the
 * town's made ground lifts them to 2.5 m at the water's edge and the highway's grade line by it, so what is tested is that the
 * ground is land and not beach or tideflat awash; the made ground is never lower than 2.5 m), is not on a headland's tongue (where the natural shore stands 40 m or
 * more seaward of the shore a little north and south of it, within 25 m of the water), is not on the highway's bed
 * and is not in the railroad's corridor (`rail.ts`: `RAIL_OFFSET` and `RAIL_CORRIDOR_HALF`, in the highway's frame on
 * its seaward side). The coast's own ground is read as it stands, so the town goes where the land lets it.
 *
 * A site made by hand with no grid of heights has a flat land: every cell on land is gentle and high enough, and only
 * the tongue, the highway and the rail corridor are held out.
 */
import { RAIL_CORRIDOR_HALF, RAIL_OFFSET } from "./rail.js";
import { contains, orient, type Poly, type Vec } from "./geom.js";
import { roadAt, shoreAt } from "./shore.js";
import type { TownSite } from "./site.js";

/** The steepest ground a block may stand on (rise over run), the least height above the sea, and the highway's half bed that no building stands on, metres. */
export const LAND_SLOPE = 0.14;
export const LAND_MIN_HEIGHT = 0.5;
export const LAND_HIGHWAY_HALF = 14;
/** A tongue: the shore stands this far seaward of what it is 40 m north and south, and the strip within this reach of the water is the tongue. */
export const LAND_TONGUE_DEPTH = 40;
export const LAND_TONGUE_REACH = 25;
/** The corridor is held out this much wider than the rail's own, so that a grid node a few metres off it is kept out too. */
export const LAND_RAIL_MARGIN = 3;
/**
 * The made ground is graded: a plane from the quay's height at the water's edge to the highway's grade line, and from the highway a hill rising 4 percent
 * and, from 310 m inland, 8. A block stands where the land is within `LAND_FIT` metres of that plane (on average): a bench or a hump much
 * above it would have to be cut away to make the town's ground, and a hollow much below it filled, and the land is meant to decide.
 */
export const LAND_FIT = 4.5;
export const LAND_QUAY_HEIGHT = 2.5;
export const LAND_HILL_GRADE = 0.04;
export const LAND_FAR_FROM = 310;
/** How far along the shore either way of the anchor the town can reach, and the area the buildable hectares are counted over. */
export const LAND_Z_REACH = 600;
/** The flat land's height of a site with no grid, and its spacing. */
export const LAND_FLAT_HEIGHT = 5;
export const LAND_FLAT_STEP = 8;

export const LAND_TUNABLES: Readonly<Record<string, number>> = { LAND_SLOPE, LAND_MIN_HEIGHT, LAND_HIGHWAY_HALF, LAND_TONGUE_DEPTH, LAND_TONGUE_REACH, LAND_RAIL_MARGIN, LAND_Z_REACH, LAND_FIT, LAND_QUAY_HEIGHT, LAND_HILL_GRADE, LAND_FAR_FROM };

/** The land of a site: grids of height, slope and buildability on the lattice of the site's ground, in the site's frame. */
export type Land = {
  readonly x0: number;
  readonly z0: number;
  readonly step: number;
  readonly nx: number;
  readonly nz: number;
  /** Height above the sea, metres; row by row along z (`[ix * nz + iz]`). */
  readonly h: readonly number[];
  /** The ground's slope (rise over run) from the heights either side of the node. */
  readonly slope: readonly number[];
  /** 1 where a block may stand. */
  readonly ok: readonly number[];
  /** The buildable land within the town's reach (|z| <= `LAND_Z_REACH`, between the shore and `site.inland` past the highway), hectares. */
  readonly hectares: number;
};

const LANDS = new WeakMap<TownSite, Land>();

/** Is a point in the railroad's corridor (in the highway's frame, seaward of it), `margin` metres wider than the corridor? */
export function inRailCorridor(site: TownSite, x: number, z: number, margin = 0): boolean {
  const off = x - (roadAt(site, z) - RAIL_OFFSET);
  return (off < 0 ? -off : off) <= RAIL_CORRIDOR_HALF + margin;
}

/** Is a point on a headland's tongue? */
export function onTongue(site: TownSite, x: number, z: number): boolean {
  const here = shoreAt(site, z);
  const around = Math.max(shoreAt(site, z - 40), shoreAt(site, z + 40));
  return here < around - LAND_TONGUE_DEPTH && x < here + LAND_TONGUE_REACH;
}

/** The grid of heights a site is judged over: its own, or a flat one over the stretch a hand-made site spans. */
function gridOf(site: TownSite): { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] } {
  const g = site.ground;
  if (g !== undefined) return { x0: g.x0, z0: g.z0, step: g.step, nx: g.nx, nz: g.nz, h: g.h as number[] };
  let xLo = Infinity;
  let xHi = -Infinity;
  for (let i = 0; i < site.shoreX.length; i++) {
    xLo = Math.min(xLo, site.shoreX[i] as number);
    xHi = Math.max(xHi, (site.roadX[i] as number) + site.inland);
  }
  const step = LAND_FLAT_STEP;
  const x0 = Math.floor((xLo - 40) / step) * step;
  const z0 = site.z0;
  const nx = Math.floor((xHi + 40 - x0) / step) + 1;
  const nz = Math.floor(((site.shoreX.length - 1) * site.step) / step) + 1;
  const h: number[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      h.push(x >= shoreAt(site, z) ? LAND_FLAT_HEIGHT : -1);
    }
  }
  return { x0, z0, step, nx, nz, h };
}

/** The land of a site, derived once and cached on it. */
export function landOf(site: TownSite): Land {
  const hit = LANDS.get(site);
  if (hit !== undefined) return hit;
  const g = gridOf(site);
  const { nx, nz, step } = g;
  const slope: number[] = new Array<number>(nx * nz);
  const ok: number[] = new Array<number>(nx * nz);
  const reach = { zLo: -LAND_Z_REACH, zHi: LAND_Z_REACH };
  let count = 0;
  for (let ix = 0; ix < nx; ix++) {
    const ixa = ix > 0 ? ix - 1 : ix;
    const ixb = ix < nx - 1 ? ix + 1 : ix;
    const x = g.x0 + ix * step;
    for (let iz = 0; iz < nz; iz++) {
      const iza = iz > 0 ? iz - 1 : iz;
      const izb = iz < nz - 1 ? iz + 1 : iz;
      const k = ix * nz + iz;
      const dx = ((g.h[ixb * nz + iz] as number) - (g.h[ixa * nz + iz] as number)) / ((ixb - ixa) * step);
      const dz = ((g.h[ix * nz + izb] as number) - (g.h[ix * nz + iza] as number)) / ((izb - iza) * step);
      const s = Math.sqrt(dx * dx + dz * dz);
      slope[k] = s;
      const z = g.z0 + iz * step;
      let good = (g.h[k] as number) >= LAND_MIN_HEIGHT && s <= LAND_SLOPE;
      if (good) {
        const road = roadAt(site, z);
        if ((x - road < 0 ? road - x : x - road) <= LAND_HIGHWAY_HALF) good = false;
        else if (inRailCorridor(site, x, z, LAND_RAIL_MARGIN)) good = false;
        else if (onTongue(site, x, z)) good = false;
      }
      ok[k] = good ? 1 : 0;
      if (good && z >= reach.zLo && z <= reach.zHi && x <= roadAt(site, z) + site.inland) count++;
    }
  }
  const land: Land = { x0: g.x0, z0: g.z0, step, nx, nz, h: g.h, slope, ok, hectares: (count * step * step) / 10000 };
  LANDS.set(site, land);
  return land;
}

/** The node nearest a point, or -1 off the grid. */
function nodeAt(land: Land, x: number, z: number): number {
  const ix = Math.floor((x - land.x0) / land.step + 0.5);
  const iz = Math.floor((z - land.z0) / land.step + 0.5);
  if (ix < 0 || iz < 0 || ix >= land.nx || iz >= land.nz) return -1;
  return ix * land.nz + iz;
}

/** Whether a block may stand at a point (the nearest cell's rule); off the grid, no. */
export function buildableAt(land: Land, x: number, z: number): boolean {
  const k = nodeAt(land, x, z);
  return k >= 0 && land.ok[k] === 1;
}

/** The ground's slope at a point (the nearest cell's); off the grid, steep. */
export function slopeAt(land: Land, x: number, z: number): number {
  const k = nodeAt(land, x, z);
  return k < 0 ? 1 : (land.slope[k] as number);
}

/** The ground's height at a point (the nearest cell's); off the grid, the sea. */
export function heightAt(land: Land, x: number, z: number): number {
  const k = nodeAt(land, x, z);
  return k < 0 ? -1 : (land.h[k] as number);
}

/** What a stretch of ground is made of: the share of its cells that are buildable, their mean slope, and the height range. */
export type Ground = { readonly cells: number; readonly share: number; readonly slope: number; readonly hMin: number; readonly hMax: number; readonly hMean: number };

/**
 * The land under a polygon: the cells whose centres lie inside it, each judged `ok` (the land's rule, or `also`, a rule for ground that
 * is made, such as the fill behind the quay). A polygon too small to hold a cell is judged at its centre.
 */
export function groundUnder(land: Land, poly: Poly, also?: (p: Vec) => boolean): Ground {
  const p = orient(poly);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    z0 = Math.min(z0, q.z);
    z1 = Math.max(z1, q.z);
  }
  const ix0 = Math.max(0, Math.floor((x0 - land.x0) / land.step));
  const ix1 = Math.min(land.nx - 1, Math.floor((x1 - land.x0) / land.step) + 1);
  const iz0 = Math.max(0, Math.floor((z0 - land.z0) / land.step));
  const iz1 = Math.min(land.nz - 1, Math.floor((z1 - land.z0) / land.step) + 1);
  let cells = 0;
  let good = 0;
  let slope = 0;
  let hMin = Infinity;
  let hMax = -Infinity;
  let hSum = 0;
  let hN = 0;
  for (let ix = ix0; ix <= ix1; ix++) {
    const x = land.x0 + ix * land.step;
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = land.z0 + iz * land.step;
      if (!contains(p, { x, z })) continue;
      const k = ix * land.nz + iz;
      cells++;
      if (land.ok[k] !== 1 && also !== undefined && also({ x, z })) {
        // Made ground (the fill behind the quay) is level and counts whole; its height is the land's under it, so it adds no slope or range.
        good++;
        continue;
      }
      const h = land.h[k] as number;
      if (land.ok[k] === 1) good++;
      slope += land.slope[k] as number;
      hMin = Math.min(hMin, h);
      hMax = Math.max(hMax, h);
      hSum += h;
      hN++;
    }
  }
  if (cells === 0) {
    const c = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    const k = nodeAt(land, c.x, c.z);
    if (k < 0) return { cells: 0, share: 0, slope: 1, hMin: -1, hMax: -1, hMean: -1 };
    const ok1 = land.ok[k] === 1 || (also !== undefined && also(c));
    return { cells: 1, share: ok1 ? 1 : 0, slope: land.slope[k] as number, hMin: land.h[k] as number, hMax: land.h[k] as number, hMean: land.h[k] as number };
  }
  return { cells, share: good / cells, slope: slope / cells, hMin: hMin === Infinity ? 0 : hMin, hMax: hMax === -Infinity ? 0 : hMax, hMean: hN === 0 ? 0 : hSum / hN };
}

/** The height the made ground will have at a point, as the land can guess it: the graded plane (see `LAND_FIT`), from the land's height at the highway. */
export function gradedHeight(site: TownSite, land: Land, x: number, z: number): number {
  const road = roadAt(site, z);
  const shore = shoreAt(site, z);
  const g = Math.max(LAND_QUAY_HEIGHT, heightAt(land, road, z));
  if (x <= road) {
    const t = road > shore ? Math.max(0, Math.min(1, (x - shore) / (road - shore))) : 1;
    return LAND_QUAY_HEIGHT + (g - LAND_QUAY_HEIGHT) * t;
  }
  const u = x - road;
  return g + LAND_HILL_GRADE * u + LAND_HILL_GRADE * Math.max(0, u - LAND_FAR_FROM);
}
