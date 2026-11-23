/**
 * The large port's ground plan on the real coast: its plats, the seam where they touch, the made
 * ground, the streets and the blocks.
 *
 * The coast gives little room. The shore runs near north to south, the highway stands 70 to 270 m
 * inland of it, and at the cove two narrow headlands run out to sea, so the cove between them is a
 * natural harbour. The OLD (claimant's) plat stands at the cove, partly on FILL behind a straight QUAY:
 * a rectangle at the old bearing, a few blocks along the quay and two or three deep, its seaward edge
 * the quay and its landward edge at the highway or one block past it. Where the quay lies seaward of the
 * natural shore the ground between is made (`fill`); the harbour stays open between the quay and the
 * headlands' tips. The land company's COMPASS plat takes the rest of the made ground, and wraps
 * around the old plat: its blocks are dropped where they lie inside the old plat's rectangle and cut
 * where they cross an edge, and cut by the natural shoreline and by the highway. The mill's site and
 * the public port's terminal each take a stretch of the flats' shore, with their wharves running from
 * the natural shore; the rough dock end stays at the quay.
 *
 * The highway is given. Blocks keep clear of its surface, grid streets that reach it end on it, and a
 * grid street that would run along it is taken up by it.
 */
import { COMPASS, gridAngle, type Bearing } from "../bearings.js";
import {
  area,
  bbox,
  centroid,
  clipHalfPlane,
  convexHull,
  contains,
  dist,
  frameOf,
  lerpVec,
  localRect,
  orient,
  overlapDepth,
  segCross,
  segDist,
  segSegDist,
  simplifyTo,
  toLocal,
  toWorld,
  type Frame,
  type Poly,
  type Vec,
} from "../geom.js";
import { ordinal, type TownNames } from "../names.js";
import { chance, int, pick, range, type Rng } from "../rng.js";
import { groundUnder, gradedHeight, landOf, buildableAt, LAND_FIT, type Land } from "../land.js";
import { RAIL_CORRIDOR_HALF, RAIL_OFFSET } from "../rail.js";
import { RAIL_BENCH_HALF, bankWidthD } from "../railBank.js";
import { QUAY_HEIGHT } from "../levels.js";
import { analyseShore, onLand, roadAt, shoreAt, shoreLine } from "../shore.js";
import type { TownSite } from "../site.js";
import { ALLEY_WIDTH, wayOf } from "../ways.js";
import { pruneStreets } from "./ends.js";
import { SIZING } from "./sizing.js";
import { densify, relaxed, roundedPath, leastRadius, SPUR_MIN_RADIUS } from "./spur.js";
import { splitAtStairs } from "./stairs.js";
import { GROW_MAX_SLOPE, GROW_MIN_SHARE, LOT_AREA, blockBudget, eligible, grow, lotBudget, neighbours, type GrowCell } from "./growth.js";
import type { Block, District, History, Plat, Quay, Seam, Spur, Street, StreetKind, Woods } from "../types.js";

const FT = 0.3048;
export const HIGHWAY_WIDTH = 24;
const RAIL_WIDTH = 8;
/** The old plat's quay stands within this far north and south of the anchor (the made ground's footprint is 480 m). */
const Z_HALF_MAX = 480;
/** The compass plat is laid over the land this far north and south of the anchor, and the town takes only the blocks the land and the budget allow. */
const Z_REACH = 600;
/** Blocks keep this far clear of the highway's centre line on its seaward side: the rail's offset and half its corridor, and 3 m of margin. */
/** The spur leaves the main line where it stands no higher than this over the sea, metres. */
const JUNCTION_HEIGHT = 4.5;
/** The spur's points are at most this far apart, metres. */
const SPUR_POINT_STEP = 8;
/** ... and where the main line stands higher than this at both ends within 800 m of the town (it climbs a headland there), the town has no spur: a train cannot come down to the shore strip. */
const JUNCTION_HEIGHT_MAX = 10;
const RAIL_CLEAR = RAIL_OFFSET + RAIL_CORRIDOR_HALF + 3;

/**
 * How far from the highway's centre line, seaward, blocks keep clear at a z: the main line's bench and the bank the ground makes down to the town's
 * (`railBank.ts`; the bank's width grows with how far the grade line stands over the made ground at the line, which the plane makes `QUAY_HEIGHT`
 * at the water and the grade line at the highway), and 1.5 m more; never under `RAIL_CLEAR`.
 */
export function railClear(site: TownSite, z: number): number {
  if (site.grade === undefined) return RAIL_CLEAR;
  const f = Math.max(0, Math.min(site.grade.length - 1, (z - site.z0) / site.step));
  const i = Math.min(site.grade.length - 2, Math.floor(f));
  const g = (site.grade[i] as number) + ((site.grade[i + 1] as number) - (site.grade[i] as number)) * (f - i);
  const d = roadAt(site, z) - shoreAt(site, z);
  if (!(d > 20)) return RAIL_CLEAR;
  const m = ((g - QUAY_HEIGHT) * RAIL_OFFSET) / d;
  return Math.max(RAIL_CLEAR, RAIL_OFFSET + RAIL_BENCH_HALF + bankWidthD(m < 0 ? -m : m).v + 1.5);
}
/** A street cut back from the railroad's corridor is dropped if under this long, metres. */
const LEAST_STREET = 8;
const MIN_BLOCK_AREA = 900;
const MIN_BLOCK_WIDTH = 16;
/** The rail's corridor on the quay, seaward of the old plat's quay street. */
const RAIL_CORRIDOR = 6;

/** What a block is, in its plat's own grid; the lot and building stages read it. */
export type BlockMeta = {
  readonly frame: Frame;
  readonly bearing: Bearing;
  readonly tag: "old" | "compass";
  readonly col: number;
  readonly row: number;
  /** For an old-plat block: the signed distance in blocks from the street to the wharf, positive toward the dock end. */
  readonly d: number;
  /** For a compass block on the flats: the mill's site, or the public port's terminal. */
  readonly site: "mill" | "terminal" | null;
  /** The block's shore edge stands on the natural shore (a block of the flats that fronts the water). */
  readonly shoreFront: boolean;
};

/** Where a pier may go: its landward end, the way it runs, its width and how far it can run over water. */
export type PierSpot = {
  readonly origin: Vec;
  readonly dir: Vec;
  readonly width: number;
  readonly length: number;
  readonly kind: "quay" | "shore";
  readonly block: number;
};

export type Layout = {
  plats: Plat[];
  seams: Seam[];
  streets: Street[];
  blocks: Block[];
  meta: BlockMeta[];
  /** The old plat's grid: its frame and numbers, for the later stages. */
  old: {
    frame: Frame;
    bearing: Bearing;
    columns: number;
    rows: number;
    pU: number;
    pV: number;
    wharfCol: number;
    /** The direction along u toward the dock end (the public port's side). */
    dockDir: 1 | -1;
    /** The line (between rows mainLine - 1 and mainLine) that is the main street: the highway, if the plat was laid to it. */
    mainLine: number;
    /** The rows of the old plat that make the core: the (up to) two existing rows nearest the main street. */
    coreRows: number[];
    roadBasis: boolean;
    railPresent: boolean;
    mainWidth: number;
    streetWidth: number;
    /** The quay's v in the old frame (0, or the rail corridor's outer edge when the railroad runs along the quay). */
    quayV: number;
  };
  company: { frame: Frame; pU: number; pV: number; streetWidth: number };
  fill: { polygon: Poly }[];
  quay: Quay;
  pierSpots: PierSpot[];
  /** The town's own track, from the main line along the waterfront (none where the history has no railroad). */
  spurs: Spur[];
  /** The grid's blocks near the town that the land or the budget left as woods. */
  woods: Woods[];
  coreCentre: Vec;
  millCentre: Vec;
  terminalCentre: Vec;
  /** Where the street to the wharf leaves the quay. */
  wharfFoot: Vec;
};

/** A street under construction. */
type RawStreet = { a: Vec; b: Vec; width: number; kind: StreetKind; plat: string | null; name: string; seam?: boolean };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function ceilOf(x: number): number {
  return -Math.floor(-x);
}

/** Sorted t values in [0, 1] where a segment crosses the highway's centre line. */
function highwayCrossings(site: TownSite, a: Vec, b: Vec): number[] {
  const ts: number[] = [];
  for (let i = 0; i < site.roadX.length - 1; i++) {
    const z0 = site.z0 + i * site.step;
    const c = segCross(a, b, { x: site.roadX[i]!, z: z0 }, { x: site.roadX[i + 1]!, z: z0 + site.step });
    if (c) ts.push(c.t);
  }
  return ts;
}

/**
 * The runs of a segment where `keep(point)` holds, ends found by bisection, dropping runs shorter than
 * `minLen`. `cuts` are t values where the segment is split whatever (the highway's crossings).
 */
function runsOf(a: Vec, b: Vec, keep: (p: Vec) => boolean, cuts: readonly number[], minLen: number): [Vec, Vec][] {
  const len = dist(a, b);
  const n = Math.max(2, ceilOf(len / 2));
  const at = (t: number): Vec => lerpVec(a, b, t);
  const ts: number[] = [0, 1, ...cuts].sort((p, q) => p - q);
  const out: [Vec, Vec][] = [];
  for (let k = 0; k < ts.length - 1; k++) {
    const t0 = ts[k]!;
    const t1 = ts[k + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const m = Math.max(2, ceilOf(n * (t1 - t0)));
    let start = -1;
    let prevOk = false;
    let prevT = t0;
    for (let s = 0; s <= m; s++) {
      const t = t0 + ((t1 - t0) * s) / m;
      // A cut's own end is inside the run: the crossing point itself is kept even where its test is on the edge.
      const ok = keep(at(t));
      if (ok && !prevOk) {
        let lo = prevT;
        let hi = t;
        if (s === 0) lo = hi = t;
        else for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          if (keep(at(mid))) hi = mid;
          else lo = mid;
        }
        start = hi;
      }
      if (!ok && prevOk) {
        let lo = prevT;
        let hi = t;
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          if (keep(at(mid))) lo = mid;
          else hi = mid;
        }
        const p = at(start);
        const q = at(lo);
        if (dist(p, q) >= minLen) out.push([p, q]);
        start = -1;
      }
      prevOk = ok;
      prevT = t;
    }
    if (prevOk && start >= 0) {
      const p = at(start);
      const q = at(t1);
      if (dist(p, q) >= minLen) out.push([p, q]);
    }
  }
  return out;
}

/** A polygon cut around the highway: the piece west of it and the piece east of it, each kept clear of its surface. */
function aroundHighway(site: TownSite, poly: Poly): { poly: Poly; east: boolean }[] {
  const bb = bbox(poly);
  const zlo = bb.z0;
  const zhi = bb.z1;
  const xlo = roadAt(site, zlo);
  const xhi = roadAt(site, zhi);
  const span = zhi - zlo;
  let dev = 0;
  for (let i = 0; i < site.roadX.length; i++) {
    const z = site.z0 + i * site.step;
    if (z <= zlo || z >= zhi) continue;
    const chord = xlo + ((xhi - xlo) * (z - zlo)) / span;
    dev = Math.max(dev, Math.abs(site.roadX[i]! - chord));
  }
  const m = HIGHWAY_WIDTH / 2 + dev + 3;
  // On the seaward side the main line's corridor lies between the blocks and the highway: they keep clear of it too.
  let clear = RAIL_CLEAR;
  for (let z = zlo; z <= zhi + 8; z += 16) clear = Math.max(clear, railClear(site, Math.min(z, zhi)));
  const mW = clear + dev;
  if (bb.x1 < Math.min(xlo, xhi) - mW) return [{ poly, east: false }];
  if (bb.x0 > Math.max(xlo, xhi) + m) return [{ poly, east: true }];
  let nx = 1;
  let nz = 0;
  if (span > 1e-6) {
    const dx = xhi - xlo;
    const len = Math.sqrt(dx * dx + span * span);
    nx = span / len;
    nz = -dx / len;
  }
  const n = { x: nx, z: nz };
  const d0 = xlo * nx + zlo * nz;
  const out: { poly: Poly; east: boolean }[] = [];
  const west = clipHalfPlane(poly, { x: -nx, z: -nz }, -(d0 - mW));
  if (west.length >= 3) out.push({ poly: west, east: false });
  const east = clipHalfPlane(poly, n, d0 + m);
  if (east.length >= 3) out.push({ poly: east, east: true });
  return out;
}

/** The part of a convex polygon that lies at most `reach` east of the highway's chord over its span. */
function eastLimit(site: TownSite, poly: Poly, reach: number): Poly {
  const bb = bbox(poly);
  const zlo = bb.z0;
  const zhi = bb.z1;
  const xlo = roadAt(site, zlo);
  const xhi = roadAt(site, zhi);
  const span = zhi - zlo;
  if (span <= 1e-6) return clipHalfPlane(poly, { x: -1, z: 0 }, -(xlo + reach));
  const dx = xhi - xlo;
  const len = Math.sqrt(dx * dx + span * span);
  const nx = span / len;
  const nz = -dx / len;
  return clipHalfPlane(poly, { x: -nx, z: -nz }, -(xlo * nx + zlo * nz + reach * nx));
}

/** The pieces of a convex polygon outside a convex rectangle. A block crossing an edge is cut by that edge's line. */
function subtractConvex(poly: Poly, rect: Poly): Poly[] {
  // A polygon that does not reach the rectangle is not cut by it, whatever lines the rectangle's edges lie on.
  if (overlapDepth(poly, rect) <= 0.05) return [poly];
  const out: Poly[] = [];
  let rest = poly;
  for (let i = 0; i < rect.length && rest.length >= 3; i++) {
    const a = rect[i]!;
    const b = rect[(i + 1) % rect.length]!;
    // The outward normal of a counter-clockwise edge.
    const len = dist(a, b);
    const n = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
    const d = n.x * a.x + n.z * a.z;
    const outside = clipHalfPlane(rest, n, d);
    if (outside.length >= 3 && Math.abs(area(outside)) > 1) out.push(outside);
    rest = clipHalfPlane(rest, { x: -n.x, z: -n.z }, -d);
  }
  return out;
}

/** The smaller of a polygon's two extents in a frame's axes. */
function thickness(f: Frame, poly: Poly): number {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of poly) {
    const l = toLocal(f, p);
    u0 = Math.min(u0, l.u);
    u1 = Math.max(u1, l.u);
    v0 = Math.min(v0, l.v);
    v1 = Math.max(v1, l.v);
  }
  return Math.min(u1 - u0, v1 - v0);
}

function usable(f: Frame, poly: Poly): boolean {
  return poly.length >= 3 && Math.abs(area(poly)) >= MIN_BLOCK_AREA && thickness(f, poly) >= MIN_BLOCK_WIDTH;
}

/** Is a point over water (seaward of the natural shore)? */
function overWater(site: TownSite, p: Vec, margin: number): boolean {
  return p.x < shoreAt(site, p.z) - margin;
}

/** How far a pier from `origin` running `dir` stays over water (beyond its first 4 m), up to `maxLen`, by its width. */
function waterReach(site: TownSite, origin: Vec, dir: Vec, width: number, maxLen: number): number {
  const side = { x: -dir.z, z: dir.x };
  let reach = 0;
  for (let s = 0; s <= maxLen; s += 3) {
    let ok = true;
    for (const k of [-1, 0, 1]) {
      const p = { x: origin.x + dir.x * s + side.x * k * (width / 2), z: origin.z + dir.z * s + side.z * k * (width / 2) };
      if (s >= 4 && !overWater(site, p, 0.5)) ok = false;
    }
    if (!ok) return s <= 4 ? 0 : s - 3;
    reach = s;
  }
  return reach;
}

/**
 * HOW LONG THE BUSINESS STREET RUNS AND HOW BIG THE DOCK DISTRICT IS. AUTHORED, NOT RESEARCHED: the owner found the shops sized for
 * several thousand and the houses for about five hundred, so the business street is scaled down from what it was (the two blocks
 * either side of the wharf street, along the main street, in both of its rows).
 * A town the panic of 1893 stopped built its main street one block long: the block on the dock side of the wharf street when the
 * founding year is even and on the other side when it is odd, in each of the two rows. A town that kept its boom built it a block longer
 * in the row nearer the main street (two blocks there, one in the other row). The dock district, the rough waterfront by the quay, is
 * the one block of the quay's row that lies a block or two past the wharf street, toward the dock end (it was every such block). The
 * blocks the business street no longer takes are houses.
 */
const BUSINESS_STREET = {
  /** Is the block `d` columns from the wharf street (a half-integer, positive toward the dock end), in core row `k` (0 nearest the main street, -1 not a core row), on the business street? */
  core: (history: History, d: number, k: number): boolean => {
    if (k < 0) return false;
    if (k === 0 && !history.boom.bust1893) return Math.abs(d) < 1;
    return d === (history.founding.year % 2 === 0 ? 0.5 : -0.5);
  },
  dock: (d: number): boolean => d >= SIZING.DOCK_FROM && d < SIZING.DOCK_TO,
};
/** The share of the compass plat's blocks beside the highway that become the highway strip (motels, gas, a big-box store): it was 0.65. AUTHORED (`sizing.ts`). */
export const STRIP_SHARE = SIZING.STRIP_SHARE;

type OldPiece = { poly: Poly; row: number; col: number; d: number };
type CompassPiece = { poly: Poly; i: number; j: number; front: boolean };

export function layoutPort(site: TownSite, history: History, names: TownNames, rngP: Rng, rngS: Rng): Layout {
  const facts = analyseShore(site);
  const bearing = history.firstPlat.bearing;
  const roadBasis = history.firstPlat.basis === "road";
  const prov = frameOf({ x: 0, z: 0 }, bearing);
  const railPresent = history.railroad !== null;

  // ---- The old plat: block size, street widths, alley, columns.
  const pU = FT * 5 * int(rngP, 60, 84);
  const pV = FT * 5 * int(rngP, 52, 66);
  // Rights of way as a small Northwest town's streets are (`ways.ts`); the blocks keep their centre-line sizes, so the lots gain the difference.
  const wOld = pick(rngP, [14, 15]);
  const wMain = history.fire ? 20 : 18;
  const oldAlley = chance(rngP, 0.5) ? ALLEY_WIDTH : null;
  const C0 = int(rngP, 4, 6);
  const dq0 = int(rngP, 35, 70);
  const wharfJitter = int(rngP, -1, 1);
  const hwQ = wOld / 2;

  // The cove's middle, and the highway there, in the provisional frame.
  const coveP = { x: shoreAt(site, facts.coveZ), z: facts.coveZ };
  const coveL = toLocal(prov, coveP);
  const hwyP = { x: roadAt(site, facts.coveZ), z: facts.coveZ };
  const hwyV = toLocal(prov, hwyP).v;
  // The window of columns along the quay: as many as the draw gives, as far as keeps the fill shallow (the quay is straight and the shore is not).
  const shoreProv = shoreLine(site).map((p) => toLocal(prov, p));
  const vReach = (pts: readonly { u: number; v: number }[], ua: number, ub: number): number => {
    let m = -Infinity;
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k]!;
      const q = pts[k + 1]!;
      const lo = Math.min(p.u, q.u);
      const hi = Math.max(p.u, q.u);
      if (hi < ua || lo > ub) continue;
      for (const u of [Math.max(ua, lo), Math.min(ub, hi)]) {
        const t = hi === lo ? 0 : (u - p.u) / (q.u - p.u);
        m = Math.max(m, p.v + (q.v - p.v) * t);
      }
      if (hi === lo) m = Math.max(m, p.v, q.v);
    }
    return m;
  };
  const FILL_LIMIT = 100;
  const MIN_FILL = 12;
  const land: Land = landOf(site);
  /** How much buildable land lies behind a window's quay, in 12 m cells over its three rows: the best landing is where there is most flat ground behind it. */
  const windowLand = (us: number, c: number, oV: number): number => {
    let n = 0;
    for (let u = us + 6; u < us + c * pU; u += 12) {
      for (let v = oV + 6; v < oV + 3 * pV; v += 12) {
        const p = toWorld(prov, u, v);
        if (buildableAt(land, p.x, p.z)) n++;
      }
    }
    return n;
  };
  /**
   * The most columns (down to four) whose quay, with the plat's seaward edge at `oV`, stays within the made ground's reach and under the fill limit;
   * of the places along the cove such a window can stand, the one with the most buildable land behind it (a window set off the cove's middle costs three cells a column).
   */
  const bestWindow = (oV: number): { C: number; us: number; depth: number; found: boolean } => {
    let best = { C: 4, us: coveL.u - 2 * pU, depth: Infinity, found: false };
    for (let c = C0; c >= 4; c--) {
      let pick: { C: number; us: number; depth: number; found: boolean } | null = null;
      let pickScore = -Infinity;
      for (const k of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        const us = coveL.u - (c * pU) / 2 + k * pU;
        const zs = [toWorld(prov, us, oV).z, toWorld(prov, us + c * pU, oV).z, toWorld(prov, us, oV + 3 * pV).z, toWorld(prov, us + c * pU, oV + 3 * pV).z];
        if (Math.max(...zs.map((z) => Math.abs(z))) > Z_HALF_MAX - 20) continue;
        const depth = vReach(shoreProv, us - hwQ, us + c * pU + hwQ) - oV;
        if (depth <= FILL_LIMIT) {
          // A landing with no water beyond its quay has no harbour: a window with under `MIN_FILL` metres of fill is chosen only where there is none better.
          const score = windowLand(us, c, oV) - 60 * Math.abs(k) - (depth < MIN_FILL ? 100000 : 0);
          if (score > pickScore) {
            pickScore = score;
            pick = { C: c, us, depth, found: true };
          }
        }
        if (c === 4 && depth < best.depth) best = { C: 4, us, depth, found: false };
      }
      if (pick !== null) return pick;
    }
    return best;
  };
  let originV = coveL.v - dq0;
  let jH = 1;
  let mainLine = 1;
  let win = bestWindow(originV);
  if (roadBasis) {
    // The highway is the old town's main street: one of the plat's lines lies on it. Of the lines it could lie on, the one that gives the shallowest fill.
    const first = clamp(Math.round((hwyV - originV - hwQ) / pV), 1, 3);
    let chosen: { jh: number; oV: number; w: typeof win } | null = null;
    for (const jh of [first, ...[1, 2, 3].filter((k) => k !== first)]) {
      const oV = clamp(hwyV - hwQ - jh * pV, coveL.v - 85, coveL.v - 25);
      const w = bestWindow(oV);
      if (chosen === null || (!chosen.w.found && (w.found || w.depth < chosen.w.depth))) chosen = { jh, oV, w };
      if (chosen.w.found) break;
    }
    jH = chosen!.jh;
    originV = chosen!.oV;
    win = chosen!.w;
    mainLine = jH;
  }
  if (!win.found) {
    // Where even four columns reach far into the sea, the quay comes landward (but stays seaward of the cove's back, and within what the blocks beside the highway can reach).
    originV += Math.min(win.depth - FILL_LIMIT, roadBasis ? 55 : dq0 - 8);
    win = bestWindow(originV);
  }
  const C = win.C;
  const uStart = win.us;
  const dH = hwyV - originV;
  let R = roadBasis ? clamp(jH + int(rngP, 0, 1), 2, 3) : clamp(ceilOf((dH - hwQ) / pV) + int(rngP, 0, 1), 2, 3);
  if (roadBasis && R === jH && jH < 3 && chance(rngP, 0.4)) R = jH + 1;
  const oldFrame = frameOf(toWorld(prov, uStart, originV), bearing);
  const wharfCol = clamp(Math.floor(C / 2) + wharfJitter, 1, C - 1);
  const dockDir: 1 | -1 = history.millSide === "north" ? -1 : 1;

  const lineV = (j: number): number => hwQ + j * pV;
  const wLine = (j: number): number => (roadBasis && j === jH ? HIGHWAY_WIDTH : j === mainLine ? wMain : wOld);
  const O = (u: number, v: number): Vec => toWorld(oldFrame, u, v);
  const quayV = railPresent ? -RAIL_CORRIDOR : 0;
  const uLo = -wOld / 2;
  const uHi = C * pU + wOld / 2;
  const vBack = lineV(R) + wLine(R) / 2;
  const oldPoly = localRect(oldFrame, uLo, uHi, 0, vBack);
  /** The ground the old plat keeps for itself: its streets and the quay's rail corridor. */
  const oldExcl = localRect(oldFrame, uLo, uHi, quayV, vBack);

  // ---- The old plat's blocks.
  let oldPieces: OldPiece[] = [];
  const ext = 60;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < C; i++) {
      const u0 = i * pU + wOld / 2;
      const u1 = (i + 1) * pU - wOld / 2;
      let v0 = lineV(j) + wLine(j) / 2;
      let v1 = lineV(j + 1) - wLine(j + 1) / 2;
      if (roadBasis && j === jH - 1) v1 = lineV(jH) + ext;
      if (roadBasis && j === jH) v0 = lineV(jH) - ext;
      const poly = localRect(oldFrame, u0, u1, v0, v1);
      for (const piece of aroundHighway(site, poly)) {
        if (roadBasis && j === jH - 1 && piece.east) continue;
        if (roadBasis && j === jH && !piece.east) continue;
        const p = simplifyTo(piece.poly, 6);
        if (usable(oldFrame, p)) oldPieces.push({ poly: p, row: j, col: i, d: (i + 0.5 - wharfCol) * dockDir });
      }
    }
  }
  const woods: Woods[] = [];
  // The old plat takes only as many blocks as the land takes: a block of it stands where the ground is gentle enough (the fill behind the quay is level, and counts), or is left as woods.
  const madeGround = (p: Vec): boolean => p.x < shoreAt(site, p.z);
  {
    const stats = oldPieces.map((p) => groundUnder(land, p.poly, madeGround));
    const fit = (k: number): boolean => {
      const c = centroid(oldPieces[k]!.poly);
      return stats[k]!.share >= GROW_MIN_SHARE && stats[k]!.slope <= GROW_MAX_SLOPE && Math.abs(stats[k]!.hMean - gradedHeight(site, land, c.x, c.z)) <= LAND_FIT;
    };
    let kept = oldPieces.filter((_, k) => fit(k));
    // However steep the cove's back, a town needs a core: where the land takes fewer than four blocks of the old plat, the four best stand.
    if (kept.length < 4) {
      const best = oldPieces.map((_, k) => k).sort((a, b) => stats[b]!.share * (1 - stats[b]!.slope) - stats[a]!.share * (1 - stats[a]!.slope) || a - b).slice(0, 4);
      kept = oldPieces.filter((_, k) => best.includes(k));
    }
    for (let k = 0; k < oldPieces.length; k++) if (!kept.includes(oldPieces[k]!)) woods.push({ polygon: oldPieces[k]!.poly, why: "land" });
    oldPieces = kept;
  }

  // ---- The fill: the water between the quay and the natural shore, in columns across the plat.
  const shoreOld = shoreLine(site).map((p) => toLocal(oldFrame, p));
  /** The furthest landward v the shoreline reaches between u = ua and ub: each segment clipped to the range, so a steep flank is not missed. */
  const vShoreIn = (ua: number, ub: number): number => {
    let m = -Infinity;
    for (let k = 0; k < shoreOld.length - 1; k++) {
      const p = shoreOld[k]!;
      const q = shoreOld[k + 1]!;
      const lo = Math.min(p.u, q.u);
      const hi = Math.max(p.u, q.u);
      if (hi < ua || lo > ub) continue;
      for (const u of [Math.max(ua, lo), Math.min(ub, hi)]) {
        const t = hi === lo ? 0 : (u - p.u) / (q.u - p.u);
        m = Math.max(m, p.v + (q.v - p.v) * t);
      }
      if (hi === lo) m = Math.max(m, p.v, q.v);
    }
    return m;
  };
  const fill: { polygon: Poly }[] = [];
  /** The stretches of the quay with water seaward of them: where a wall stands and the made ground is a polygon of its own. */
  const quayWet: { a: Vec; b: Vec }[] = [];
  {
    // One convex polygon of fill for each stretch of columns that has water beyond the quay. Its quay-side edge is the
    // stretch's own piece of the quay line (so the edges of every polygon are collinear and no two overlap, and the bank
    // along the quay is one smooth slope); its landward side is the hull of the columns' deepest shore points.
    const step = 6;
    const cols = ceilOf((uHi - uLo) / step);
    let start = -1;
    let reach: { u: number; v: number }[] = [];
    const flush = (end: number): void => {
      if (start < 0) return;
      const ua = uLo + start * step;
      const ub = Math.min(uHi, uLo + end * step);
      const hull = convexHull([{ u: ua, v: quayV }, { u: ub, v: quayV }, ...reach]);
      fill.push({ polygon: orient(hull.map((q) => toWorld(oldFrame, q.u, q.v))) });
      quayWet.push({ a: O(ua, quayV), b: O(ub, quayV) });
      start = -1;
      reach = [];
    };
    for (let k = 0; k < cols; k++) {
      const ua = uLo + k * step;
      const ub = Math.min(uHi, uLo + (k + 1) * step);
      const m = vShoreIn(ua, ub);
      if (m > quayV + 1) {
        if (start < 0) start = k;
        const v = Math.min(m + 1, vBack);
        reach.push({ u: ua, v }, { u: ub, v });
      } else flush(k);
    }
    flush(cols);
  }
  const quay = { a: O(uLo, quayV), b: O(uHi, quayV), wet: quayWet,
    seaward: { x: -oldFrame.V.x, z: -oldFrame.V.z },
    wall: history.fire !== null && history.fire.burned === "both" && history.fire.year >= 1922 ? ("sheet" as const) : ("timber" as const),
  };

  // ---- The flats' limits: the west boundary of the compass plat, the shore's envelope or the rail's line.
  const shoreMargin = railPresent ? 17 : 16;
  const pUcDraw = FT * 5 * int(rngP, 60, 92);
  const pVcDraw = FT * 5 * int(rngP, 52, 75);
  const longAlongZ = chance(rngP, 0.5);
  const lo = Math.min(pUcDraw, pVcDraw);
  const hi = Math.max(pUcDraw, pVcDraw);
  const pUc = longAlongZ ? hi : lo;
  const pVc = longAlongZ ? lo : hi;
  const wCo = pick(rngP, [14, 15, 15, 16]);
  const avenueWidth = 20;
  const zOff = range(rngP, 0, pUc);
  const avenueAt = range(rngP, -pUc, pUc);
  const xOff = range(rngP, 0, pVc);

  type CompassResult = {
    zo: number;
    N: number;
    J: number;
    xo: number;
    frame: Frame;
    pieces: CompassPiece[];
    knots: { z: number; x: number }[];
    iAv: number;
    zh: number;
  };
  const buildCompass = (zh: number): CompassResult => {
    const zo = -zh - zOff;
    const N = ceilOf((2 * zh + zOff) / pUc);
    const xo = -pVc * ceilOf(330 / pVc) - xOff;
    let xMax = -Infinity;
    for (const r of site.roadX) xMax = Math.max(xMax, r);
    const J = ceilOf((xMax + site.inland + 20 - xo) / pVc);
    const frame = frameOf({ x: xo, z: zo }, COMPASS);
    const iAv = clamp(Math.round((avenueAt - zo) / pUc), 1, N - 1);
    // The west limit's knots at the row boundaries: the shore's envelope over a row either side, kept a margin landward.
    const knots: { z: number; x: number }[] = [];
    for (let k = 0; k <= N; k++) {
      const z = zo + k * pUc;
      let m = -Infinity;
      for (let q = -pUc; q <= pUc + 1e-9; q += 4) m = Math.max(m, shoreAt(site, z + q));
      knots.push({ z, x: m + shoreMargin });
    }
    const pieces: CompassPiece[] = [];
    const hwI = (i: number): number => (i === iAv ? avenueWidth : wCo) / 2;
    for (let i = 0; i < N; i++) {
      const k0 = knots[i]!;
      const k1 = knots[i + 1]!;
      const dx = k1.x - k0.x;
      const dz = k1.z - k0.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const wn = { x: dz / len, z: -dx / len };
      const wd = wn.x * k0.x + wn.z * k0.z + (railPresent ? RAIL_WIDTH / 2 + 3 : 0) * wn.x;
      for (let j = 0; j < J; j++) {
        const u0 = i * pUc + hwI(i);
        const u1 = (i + 1) * pUc - hwI(i + 1);
        const v0 = j * pVc + wCo / 2;
        const v1 = (j + 1) * pVc - wCo / 2;
        let poly = localRect(frame, u0, u1, v0, v1);
        poly = clipHalfPlane(poly, { x: 0, z: 1 }, -zh);
        poly = clipHalfPlane(poly, { x: 0, z: -1 }, -zh);
        if (poly.length < 3) continue;
        poly = clipHalfPlane(poly, wn, wd);
        if (poly.length < 3) continue;
        poly = eastLimit(site, poly, site.inland);
        if (poly.length < 3) continue;
        for (const hw of aroundHighway(site, poly)) {
          for (const sub of subtractConvex(hw.poly, oldExcl)) {
            const p = simplifyTo(sub, 6);
            if (!usable(frame, p)) continue;
            let near = Infinity;
            for (const c of p) near = Math.min(near, c.x - shoreAt(site, c.z));
            pieces.push({ poly: p, i, j, front: near < 40 && !hw.east });
          }
        }
      }
    }
    return { zo, N, J, xo, frame, pieces, knots, iAv, zh };
  };

  const zh = Z_REACH;
  let comp = buildCompass(zh);
  // ---- The town grows from the old plat over the land: the budget the history gives, spent on the cheapest cells first (`growth.ts`).
  const coreAt = O(wharfCol * pU, lineV(mainLine));
  {
    const nearOf = (poly: Poly): { hw: number; shore: number } => {
      let hw = Infinity;
      let sh = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k]!;
        const b = poly[(k + 1) % poly.length]!;
        for (const q of [a, lerpVec(a, b, 0.5)]) {
          hw = Math.min(hw, Math.abs(q.x - roadAt(site, q.z)));
          sh = Math.min(sh, q.x - shoreAt(site, q.z));
        }
      }
      return { hw, shore: Math.max(0, sh) };
    };
    const cellOf = (poly: Poly, also?: (p: Vec) => boolean): GrowCell => {
      const g = groundUnder(land, poly, also);
      const n = nearOf(poly);
      const centre = centroid(poly);
      return { poly, centre, share: g.share, slope: g.slope, fit: also !== undefined ? 0 : g.hMean - gradedHeight(site, land, centre.x, centre.z), hwGap: n.hw, shoreGap: n.shore, lots: Math.floor(Math.abs(area(poly)) / LOT_AREA) };
    };
    const cells: GrowCell[] = [...oldPieces.map((p) => cellOf(p.poly, madeGround)), ...comp.pieces.map((p) => cellOf(p.poly))];
    const taken = oldPieces.map((_, k) => k);
    const { order } = grow(cells, neighbours(cells), taken, coreAt, blockBudget(history), lotBudget(history));
    const chosen: boolean[] = comp.pieces.map(() => false);
    for (const idx of order) chosen[idx - oldPieces.length] = true;
    // The public port's terminal needs a block of the flats' shore on the side away from the mill: where the budgets were spent before the town reached it, the best such block the land allows is taken as well.
    {
      const termNorth = history.millSide !== "north";
      const onSide = (k: number): boolean => (centroid((comp.pieces[k] as { poly: Poly }).poly).z > facts.coveZ) === termNorth;
      let have = false;
      for (let k = 0; k < comp.pieces.length; k++) if (chosen[k] && onSide(k)) have = true;
      if (!have) {
        let bestK = -1;
        let bestScore = Infinity;
        for (let k = 0; k < comp.pieces.length; k++) {
          const c = cells[oldPieces.length + k] as GrowCell;
          if (chosen[k] || !onSide(k) || !eligible(c) || Math.abs(area(c.poly)) < 1500) continue;
          const score = dist(c.centre, coreAt) + (comp.pieces[k]!.front ? 0 : 400);
          if (score < bestScore) {
            bestScore = score;
            bestK = k;
          }
        }
        if (bestK >= 0) chosen[bestK] = true;
      }
    }
    // What the grid would have had here and the town did not take is woods, if it lies near the town: the land's, or the budget's.
    for (let k = 0; k < comp.pieces.length; k++) {
      if (chosen[k]) continue;
      const c = cells[oldPieces.length + k] as GrowCell;
      let nearTown = false;
      for (const idx of [...taken, ...order]) if (dist((cells[idx] as GrowCell).centre, c.centre) < 260) nearTown = true;
      if (nearTown) woods.push({ polygon: c.poly, why: eligible(c) ? "budget" : "land" });
    }
    comp = { ...comp, pieces: comp.pieces.filter((_, k) => chosen[k]) };
  }
  const { zo, N, J, xo, frame: coFrame, knots, iAv } = comp;

  // ---- Streets.
  const raw: RawStreet[] = [];
  const oldGone = (p: Vec): boolean => contains(oldExcl, p, -0.05);
  const hwBand = (p: Vec, hw: number): boolean => {
    const off = p.x - roadAt(site, p.z);
    return off < HIGHWAY_WIDTH / 2 + hw + 2 && off > -(railClear(site, p.z) + hw);
  };
  const westX = (z: number): number => {
    // The knots' polyline, extended flat beyond its ends.
    const f = (z - zo) / pUc;
    const k = clamp(Math.floor(f), 0, N - 1);
    const a = knots[k]!;
    const b = knots[k + 1]!;
    const t = clamp((z - a.z) / (b.z - a.z), 0, 1);
    return a.x + (b.x - a.x) * t;
  };

  // The highway, as given.
  for (let i = 0; i < site.roadX.length - 1; i++) {
    const z0 = site.z0 + i * site.step;
    raw.push({ a: { x: site.roadX[i]!, z: z0 }, b: { x: site.roadX[i + 1]!, z: z0 + site.step }, width: HIGHWAY_WIDTH, kind: "highway", plat: null, name: names.highway });
  }
  // The old plat's streets: along the quay (u lines), and down to it (v lines). Split at the highway, both sides kept.
  const pushOld = (s: RawStreet): void => {
    for (const [a, b] of runsOf(s.a, s.b, () => true, highwayCrossings(site, s.a, s.b), 8)) raw.push({ ...s, a, b });
  };
  for (let j = 0; j <= R; j++) {
    if (roadBasis && j === jH) continue;
    const isBack = j === R;
    pushOld({
      a: O(0, lineV(j)),
      b: O(C * pU, lineV(j)),
      width: wLine(j),
      kind: j === mainLine ? "main" : "street",
      plat: "old",
      name: `${names.along[j]!} Street`,
      ...(isBack ? { seam: true } : {}),
    });
  }
  for (let i = 0; i <= C; i++) {
    pushOld({
      a: O(i * pU, lineV(0)),
      b: O(i * pU, lineV(R)),
      width: wOld,
      kind: "street",
      plat: "old",
      name: `${names.cross[i]!} Street`,
      ...(i === 0 || i === C ? { seam: true } : {}),
    });
  }
  // The street to the wharf runs on over the harbour from the quay: the first column that has water for it.
  let wharfFoot = O(wharfCol * pU, quayV);
  {
    const cols = [wharfCol, ...[1, -1, 2, -2].map((k) => wharfCol + k).filter((c) => c >= 1 && c <= C - 1)];
    for (const c of cols) {
      const foot = O(c * pU, quayV);
      const dir = { x: -oldFrame.V.x, z: -oldFrame.V.z };
      const reach = waterReach(site, foot, dir, 12, 90);
      if (reach >= 30) {
        const len = Math.min(reach, int(rngS, 30, 90));
        raw.push({ a: foot, b: { x: foot.x + dir.x * len, z: foot.z + dir.z * len }, width: 12, kind: "wharf", plat: "old", name: names.wharf });
        wharfFoot = foot;
        break;
      }
    }
  }
  // The company's streets: E-W lines (along v, numbered) and N-S lines (along u, named).
  for (let i = 0; i <= N; i++) {
    const z = zo + i * pUc;
    if (Math.abs(z) > zh) continue;
    const isAv = i === iAv;
    const w = isAv ? avenueWidth : wCo;
    const a = { x: westX(z), z };
    const b = { x: roadAt(site, z) + site.inland, z };
    const name = isAv ? names.avenue : `${ordinal(names.numberedFrom + i)} Street`;
    for (const [p, q] of runsOf(a, b, (pt) => !oldGone(pt), highwayCrossings(site, a, b), 8)) raw.push({ a: p, b: q, width: w, kind: isAv ? "avenue" : "street", plat: "company", name });
  }
  for (let j = 0; j <= J; j++) {
    const x = xo + j * pVc;
    const a = { x, z: -zh };
    const b = { x, z: zh };
    const keep = (pt: Vec): boolean => pt.x >= westX(pt.z) && pt.x <= roadAt(site, pt.z) + site.inland && !hwBand(pt, wCo / 2) && !oldGone(pt);
    for (const [p, q] of runsOf(a, b, keep, [], 30)) {
      raw.push({ a: p, b: q, width: wCo, kind: "street", plat: "company", name: `${names.named[j % names.named.length]!} Street` });
    }
  }

  // A grid street runs only as far as the last block it serves (`ends.ts`).
  {
    const all = raw.slice();
    const kept = pruneStreets(raw, [...oldPieces.map((p) => p.poly), ...comp.pieces.map((p) => p.poly)]);
    // The town is joined to the highway: where the blocks the town took stand off it (a short town, the highway strip not made) and no grid street reaches it any more, the
    // street of the grid nearest the core that did reach it runs on to it again, from the last block it serves.
    const meetsHighway = (s2: RawStreet): boolean => kept.some((h) => h.kind === "highway" && segSegDist(s2.a, s2.b, h.a, h.b) <= (s2.width + h.width) / 2 + 0.5);
    if (kept.some((k) => k.kind !== "highway") && !kept.some((k) => k.kind !== "highway" && k.kind !== "wharf" && meetsHighway(k))) {
      let best: { k: number; far: Vec; reach: Vec; d: number } | null = null;
      for (const full of all) {
        if (full.kind !== "street" && full.kind !== "main" && full.kind !== "avenue") continue;
        if (!meetsHighway(full)) continue;
        const k = kept.findIndex((q) => q.name === full.name && q.plat === full.plat && q.kind === full.kind && segDist(q.a, full.a, full.b) < 0.5 && segDist(q.b, full.a, full.b) < 0.5);
        if (k < 0) continue;
        const q = kept[k] as RawStreet;
        // The end of the original that stands at the highway, and the kept street's end that is farther from it.
        const hw = (p: Vec): number => Math.abs(p.x - roadAt(site, p.z));
        const reach = hw(full.a) <= hw(full.b) ? full.a : full.b;
        const far = dist(q.a, reach) >= dist(q.b, reach) ? q.a : q.b;
        const d = dist(centroid([q.a, q.b, reach]), coreAt);
        if (best === null || d < best.d) best = { k, far, reach, d };
      }
      if (best !== null) kept[best.k] = { ...(kept[best.k] as RawStreet), a: best.far, b: best.reach };
    }
    raw.length = 0;
    raw.push(...kept);
  }

  // A street that ends inside the railroad's corridor (it reaches the line and stops: the old plat's back street, or a cross street ending on it) is cut back to the corridor's edge: a street meets the line only by crossing it.
  {
    const corridor = RAIL_CORRIDOR_HALF + 1;
    const offOf = (q: Vec): number => Math.abs(q.x - (roadAt(site, q.z) - RAIL_OFFSET));
    const trimmed: RawStreet[] = [];
    for (const st of raw) {
      if (st.kind === "highway" || st.kind === "wharf" || st.kind === "rail") {
        trimmed.push(st);
        continue;
      }
      const len = dist(st.a, st.b);
      const n = Math.max(2, -Math.floor(-len / 1));
      const inside = (k: number): boolean => offOf(lerpVec(st.a, st.b, k / n)) <= corridor;
      let lo = 0;
      let hi = n;
      // From each end inward while inside the corridor; a street that crosses has the corridor's middle inside, not an end.
      while (lo < n && inside(lo) && inside(lo + 1) && lo < hi) lo++;
      while (hi > 0 && inside(hi) && inside(hi - 1) && hi > lo) hi--;
      const endsOutside = !inside(0) && !inside(n);
      if (endsOutside) {
        trimmed.push(st);
        continue;
      }
      // Cut back to the corridor's edge, unless the street can run on across it to the highway (it then crosses the line, and the plan records the crossing).
      let a = lerpVec(st.a, st.b, lo / n);
      let b = lerpVec(st.a, st.b, hi / n);
      /** Where the street's line, run on from `end` away from `other`, meets the highway's centre within 70 m, or null. */
      const reachTo = (end: Vec, other: Vec): Vec | null => {
        const d = dist(end, other);
        if (!(d > 1e-6)) return null;
        const far = { x: end.x + ((end.x - other.x) / d) * 70, z: end.z + ((end.z - other.z) / d) * 70 };
        const ts = highwayCrossings(site, end, far);
        return ts.length > 0 ? lerpVec(end, far, ts[0] as number) : null;
      };
      if (inside(n) && !inside(0)) b = reachTo(st.b, st.a) ?? b;
      if (inside(0) && !inside(n)) a = reachTo(st.a, st.b) ?? a;
      if (dist(a, b) < LEAST_STREET) continue;
      trimmed.push({ ...st, a, b });
    }
    raw.length = 0;
    raw.push(...trimmed);
  }

  // A street that would climb more than 15 percent is a public stair there (`stairs.ts`).
  if (site.ground !== undefined) {
    const cut: RawStreet[] = [];
    for (const st of raw) {
      if (st.kind === "street" || st.kind === "avenue") cut.push(...splitAtStairs(st, site.ground, (p) => fill.some((f) => contains(f.polygon, p, 10))));
      else cut.push(st);
    }
    raw.length = 0;
    raw.push(...cut);
  }

  // Streets cut off from the rest are dropped, and a block that touches none of those left goes with them.
  {
    const parent = raw.map((_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r]!;
      return r;
    };
    for (let i = 0; i < raw.length; i++) {
      for (let j2 = i + 1; j2 < raw.length; j2++) {
        const a = raw[i]!;
        const b = raw[j2]!;
        if (segSegDist(a.a, a.b, b.a, b.b) <= (a.width + b.width) / 2 + 0.5) parent[find(i)] = find(j2);
      }
    }
    // The highway's network, or, where the town stands off it (a coast with the highway far inland of the water), the longest network there is.
    let root = find(0);
    if (!raw.some((s2, i) => s2.kind !== "highway" && find(i) === root)) {
      const length: number[] = raw.map(() => 0);
      for (let i = 0; i < raw.length; i++) if (raw[i]!.kind !== "highway") length[find(i)] = length[find(i)]! + dist(raw[i]!.a, raw[i]!.b);
      let best = -1;
      for (let i = 0; i < raw.length; i++) if (find(i) === i && length[i]! > best) {
        best = length[i]!;
        root = i;
      }
    }
    const keptRaw = raw.filter((s2, i) => find(i) === root || s2.kind === "highway");
    raw.length = 0;
    raw.push(...keptRaw);
  }
  const streets: Street[] = raw.map((s2, id) => ({ id, a: s2.a, b: s2.b, width: s2.width, ...wayOf(s2.kind, s2.width), kind: s2.kind, plat: s2.plat, name: s2.name, ...(s2.seam ? { seam: true } : {}) }));
  const touchesStreet = (poly: Poly): boolean => {
    for (const st of streets) {
      let d = Infinity;
      if (contains(orient(poly), st.a) || contains(orient(poly), st.b)) d = 0;
      else for (let k = 0; k < poly.length; k++) d = Math.min(d, segSegDist(poly[k]!, poly[(k + 1) % poly.length]!, st.a, st.b));
      if (d - st.width / 2 <= 0.6) return true;
    }
    return false;
  };
  oldPieces = oldPieces.filter((p) => touchesStreet(p.poly));
  comp = { ...comp, pieces: comp.pieces.filter((p) => touchesStreet(p.poly)) };

  // ---- The mill's site and the terminal on the flats' shore: runs of blocks that front the water, north and south of the old plat.
  const zc = facts.coveZ;
  const siteOf: ("mill" | "terminal" | null)[] = comp.pieces.map(() => null);
  const gapOf = (poly: Poly): number => {
    let g = Infinity;
    for (const c of poly) g = Math.min(g, c.x - shoreAt(site, c.z));
    return g;
  };
  const pickRun = (north: boolean, taken: readonly boolean[]): number[] => {
    const side = comp.pieces.map((p, k) => ({ p, k })).filter(({ p, k }) => !taken[k] && (centroid(p.poly).z > zc) === north);
    // The best stretch first (blocks that front the water, big enough), then smaller ones, then whatever is nearest the shore.
    const tiers = [
      side.filter(({ p }) => p.front && Math.abs(area(p.poly)) >= 1500),
      side.filter(({ p }) => p.front && Math.abs(area(p.poly)) >= 900),
      side.filter(({ p }) => gapOf(p.poly) < 120 && c_west(p.poly) && Math.abs(area(p.poly)) >= 900),
      // Where the grown town has no block on the flats' shore, the block of that side nearest the water takes the mill (or the terminal), whatever its place.
      side.slice().sort((a, b) => gapOf(a.p.poly) - gapOf(b.p.poly) || a.k - b.k).slice(0, 1),
    ];
    for (const cand of tiers) {
      if (cand.length === 0) continue;
      const idx = cand.slice().sort((a, b) => centroid(a.p.poly).z - centroid(b.p.poly).z || a.k - b.k);
      let best: number[] = [];
      let bestA = -1;
      for (let q = 0; q < idx.length; q++) {
        const next = idx[q + 1];
        const adjacent = next !== undefined && dist(centroid(next.p.poly), centroid(idx[q]!.p.poly)) < pUc * 1.4;
        const run = adjacent && next ? [idx[q]!.k, next.k] : [idx[q]!.k];
        const a = run.reduce((sum, k) => sum + Math.abs(area(comp.pieces[k]!.poly)), 0);
        if (a > bestA) {
          bestA = a;
          best = run;
        }
      }
      return best;
    }
    return [];
  };
  const c_west = (poly: Poly): boolean => {
    const c = centroid(poly);
    return c.x < roadAt(site, c.z);
  };
  const millNorth = history.millSide === "north";
  const taken: boolean[] = [];
  let millRun = pickRun(millNorth, taken);
  if (millRun.length === 0) millRun = pickRun(!millNorth, taken);
  for (const k of millRun) {
    siteOf[k] = "mill";
    taken[k] = true;
  }
  let termRun = pickRun(!millNorth, taken);
  if (termRun.length === 0) termRun = pickRun(millNorth, taken);
  for (const k of termRun) {
    siteOf[k] = "terminal";
    taken[k] = true;
  }
  const centreOf = (run: readonly number[], fallback: Vec): Vec => {
    if (run.length === 0) return fallback;
    let x = 0;
    let z = 0;
    for (const k of run) {
      const c = centroid(comp.pieces[k]!.poly);
      x += c.x;
      z += c.z;
    }
    return { x: x / run.length, z: z / run.length };
  };
  const coreCentre = coreAt;
  const millCentre = centreOf(millRun, { x: coreCentre.x, z: coreCentre.z + (millNorth ? 300 : -300) });
  const terminalCentre = centreOf(termRun, { x: coreCentre.x, z: coreCentre.z + (millNorth ? -300 : 300) });

  // ---- Blocks and their districts.
  const blocks: Block[] = [];
  const meta: BlockMeta[] = [];
  const rowsHere: number[] = [];
  for (const p of oldPieces) if (!rowsHere.includes(p.row)) rowsHere.push(p.row);
  rowsHere.sort((a, b) => Math.abs(a - (mainLine - 0.5)) - Math.abs(b - (mainLine - 0.5)) || a - b);
  const coreRows = rowsHere.slice(0, 2);
  // Where the land took the blocks the business street was to have (a single block, in a short one), the block of the core's rows nearest the wharf street is the core.
  const coreBlock = ((): OldPiece | null => {
    const inRows = oldPieces.filter((p) => coreRows.includes(p.row));
    if (inRows.some((p) => BUSINESS_STREET.core(history, p.d, coreRows.indexOf(p.row)))) return null;
    return inRows.slice().sort((p, q) => Math.abs(p.d) - Math.abs(q.d) || coreRows.indexOf(p.row) - coreRows.indexOf(q.row))[0] ?? null;
  })();
  const oldDistrict = (p: OldPiece): District => {
    const c = centroid(p.poly);
    if (p === coreBlock || BUSINESS_STREET.core(history, p.d, coreRows.indexOf(p.row))) return "core";
    if (dist(c, millCentre) <= 260) return "mill housing";
    if (p.row === 0 && BUSINESS_STREET.dock(p.d)) return "dock";
    return "residential";
  };
  for (const p of oldPieces) {
    blocks.push({ id: blocks.length, plat: "old", polygon: p.poly, district: oldDistrict(p), cell: { col: p.col, row: p.row } });
    meta.push({ frame: oldFrame, bearing, tag: "old", col: p.col, row: p.row, d: p.d, site: null, shoreFront: false });
  }
  const compassDistrict = (cp: CompassPiece, site_: "mill" | "terminal" | null): District => {
    if (site_ === "mill") return "mill";
    if (site_ === "terminal") return "waterfront";
    const c = centroid(cp.poly);
    let nearHwy = Infinity;
    for (const q of cp.poly) nearHwy = Math.min(nearHwy, Math.abs(q.x - roadAt(site, q.z)));
    if (nearHwy <= 40 && history.present.highwayStrip && chance(rngP, STRIP_SHARE)) return "highway strip";
    if (dist(c, millCentre) <= 280) return "mill housing";
    if (c.x < roadAt(site, c.z) && dist(c, terminalCentre) <= 260) return "industrial";
    return "residential";
  };
  for (let k = 0; k < comp.pieces.length; k++) {
    const cp = comp.pieces[k]!;
    blocks.push({ id: blocks.length, plat: "company", polygon: cp.poly, district: compassDistrict(cp, siteOf[k]!), cell: { col: cp.i, row: cp.j } });
    meta.push({ frame: coFrame, bearing: COMPASS, tag: "compass", col: cp.i, row: cp.j, d: 0, site: siteOf[k]!, shoreFront: cp.front });
  }

  // ---- The town's own track (`spur.ts`): it leaves the main line beyond the end of the town on the mill's side, curves to the shore's strip between the water and the
  // blocks, runs along it, along the quay's track, and on along the other flats' strip, to end at the far end of the town.
  const spurs: Spur[] = [];
  if (railPresent) {
    let zLo = Infinity;
    let zHi = -Infinity;
    for (const bl of blocks) {
      for (const q of bl.polygon) {
        zLo = Math.min(zLo, q.z);
        zHi = Math.max(zHi, q.z);
      }
    }
    const qa = O(uLo, quayV / 2);
    const qb = O(uHi, quayV / 2);
    const [qLow, qHigh] = qa.z <= qb.z ? [qa, qb] : [qb, qa];
    const front: Vec[] = [];
    for (const k of knots) if (k.z < qLow.z - 25 && k.z > zLo - 40) front.push({ x: k.x - shoreMargin / 2, z: k.z });
    const back: Vec[] = [];
    for (const k of knots) if (k.z > qHigh.z + 25 && k.z < zHi + 40) back.push({ x: k.x - shoreMargin / 2, z: k.z });
    const line: Vec[] = [...front, qLow, qHigh, ...back];
    // The spur leaves the main line where the line stands low enough to come down to the shore strip at a railroad's grade: beyond the end of the town on the mill's side if
    // the line is no higher than `JUNCTION_HEIGHT` there within reach, else on the other side's (and then it serves the terminal first).
    const zMax = site.z0 + (site.shoreX.length - 1) * site.step - 40;
    const zMin = site.z0 + 40;
    const lineHeight = (z: number): number => {
      if (site.grade === undefined) return 0;
      const f = Math.max(0, Math.min(site.grade.length - 1, (z - site.z0) / site.step));
      const i = Math.min(site.grade.length - 2, Math.floor(f));
      return (site.grade[i] as number) + ((site.grade[i + 1] as number) - (site.grade[i] as number)) * (f - i);
    };
    const bestJunction = (north: boolean): { z: number; h: number } => {
      const sign = north ? 1 : -1;
      const from = (north ? ordered0(true) : ordered0(false)).z;
      let best = { z: clamp(from + sign * 220, zMin, zMax), h: Infinity };
      for (let d = 80; d <= 800; d += 16) {
        const z = clamp(from + sign * d, zMin, zMax);
        const h = lineHeight(z);
        if (h <= JUNCTION_HEIGHT) return { z, h };
        if (h < best.h) best = { z, h };
      }
      return best;
    };
    const ordered0 = (north: boolean): Vec => (north ? (line[line.length - 1] as Vec) : (line[0] as Vec));
    const millNorth = history.millSide === "north";
    let fromNorth = millNorth;
    let pick = bestJunction(fromNorth);
    if (pick.h > JUNCTION_HEIGHT) {
      const other = bestJunction(!fromNorth);
      if (other.h < pick.h) {
        fromNorth = !fromNorth;
        pick = other;
      }
    }
    if (pick.h <= JUNCTION_HEIGHT_MAX) {
    const ordered = fromNorth ? line.slice().reverse() : line;
    const sign = fromNorth ? 1 : -1;
    const zJ = pick.z;
    const mainAt = (z: number): Vec => ({ x: roadAt(site, z) - RAIL_OFFSET, z });
    const junction = mainAt(zJ);
    const beyond = mainAt(clamp(zJ + sign * 60, site.z0 + 8, site.z0 + (site.shoreX.length - 1) * site.step - 8));
    const way: Vec[] = [beyond, junction, ...ordered];
    const points = relaxed(densify(roundedPath(way), SPUR_POINT_STEP), SPUR_MIN_RADIUS, 4);
    // The spur starts on the main line: its first point is the junction.
    const trimmed = points.slice(1);
    // It serves first what lies on the side it comes in from: the mill if that is the mill's side, else the terminal.
    const serves: ("mill" | "quay" | "terminal")[] = fromNorth === millNorth ? ["mill", "quay", "terminal"] : ["terminal", "quay", "mill"];
    spurs.push({ id: 0, name: `${names.railroad} spur`, points: trimmed, radius: leastRadius(trimmed), serves, wet: [] });
    }
  }

  // ---- The plats as records, and the seam: where the old plat's edge meets the company's blocks.
  const platOld: Plat = {
    id: "old",
    name: `${names.claimant}'s plat`,
    origin: oldFrame.o,
    bearing,
    block: { along: pU, across: pV },
    streetWidth: wOld,
    alley: oldAlley,
    columns: C,
    rows: R,
    polygon: oldPoly,
    by: history.firstPlat.by,
    year: history.firstPlat.year,
    avenue: null,
  };
  const platCompany: Plat = {
    id: "company",
    name: `${history.secondPlat.company}'s addition`,
    origin: coFrame.o,
    bearing: COMPASS,
    block: { along: pUc, across: pVc },
    streetWidth: wCo,
    alley: ALLEY_WIDTH,
    columns: N,
    rows: J,
    polygon: orient([toWorld(coFrame, 0, 0), toWorld(coFrame, N * pUc, 0), toWorld(coFrame, N * pUc, J * pVc), toWorld(coFrame, 0, J * pVc)]),
    by: history.secondPlat.company,
    year: history.secondPlat.year,
    avenue: { line: iAv, width: avenueWidth },
  };
  const seams: Seam[] = [];
  const angle = gridAngle(bearing, COMPASS);
  const edges: [Vec, Vec, number][] = [
    [O(uLo, vBack), O(uHi, vBack), R],
    [O(uLo, 0), O(uLo, vBack), -1],
    [O(uHi, 0), O(uHi, vBack), -2],
  ];
  for (const [a, b] of edges) {
    // The edge touches the company's blocks if a block corner lies on it.
    let touches = false;
    for (const bl of blocks) {
      if (bl.plat !== "company") continue;
      for (const c of bl.polygon) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        const t = ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2;
        const ex = a.x + dx * clamp(t, 0, 1) - c.x;
        const ez = a.z + dz * clamp(t, 0, 1) - c.z;
        if (t > 0.02 && t < 0.98 && Math.sqrt(ex * ex + ez * ez) < 0.3) touches = true;
      }
      if (touches) break;
    }
    if (!touches) continue;
    let sid = -1;
    let bestD = Infinity;
    const mid = lerpVec(a, b, 0.5);
    for (const s of streets) {
      if (!s.seam) continue;
      const smid = lerpVec(s.a, s.b, 0.5);
      const d = dist(smid, mid);
      if (d < bestD) {
        bestD = d;
        sid = s.id;
      }
    }
    seams.push({ plats: ["old", "company"], a, b, angle, street: sid });
  }

  // ---- Where piers may go: from the quay at the old plat, and from the natural shore at the mill and the terminal.
  const pierSpots: PierSpot[] = [];
  const quayDir = { x: -oldFrame.V.x, z: -oldFrame.V.z };
  for (let i = 0; i < C; i++) {
    const uc = i * pU + pU / 2 + range(rngS, -8, 8);
    const d = (i + 0.5 - wharfCol) * dockDir;
    const wanted = Math.abs(d) < 1 ? 0.8 : d > 0 ? 0.6 : 0.3;
    if (!chance(rngS, wanted) || Math.abs(uc - wharfCol * pU) < 16) continue;
    const origin = O(uc, quayV);
    const width = range(rngS, 6, 10);
    const reach = waterReach(site, origin, quayDir, width, 90);
    const length = Math.min(reach, int(rngS, 30, 90));
    if (length < 30) continue;
    const blk = blocks.findIndex((b, k) => b.plat === "old" && meta[k]!.col === i && meta[k]!.row === 0);
    pierSpots.push({ origin, dir: quayDir, width, length, kind: "quay", block: blk });
  }
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k]!;
    const m = meta[k]!;
    if (m.site === null) continue;
    const c = centroid(b.polygon);
    const bb = bbox(b.polygon);
    const zm = clamp(c.z + range(rngS, -15, 15), bb.z0 + 10, bb.z1 - 10);
    const origin = { x: shoreAt(site, zm) + 3, z: zm };
    const dir = { x: -1, z: 0 };
    const width = m.site === "terminal" ? range(rngS, 10, 14) : range(rngS, 7, 10);
    const reach = waterReach(site, origin, dir, width, 90);
    const length = Math.min(reach, int(rngS, 30, 90));
    if (length >= 30) pierSpots.push({ origin, dir, width, length, kind: "shore", block: k });
  }

  // A pier does not run over made ground or a block: where it would, it is not made.
  const pierRect = (sp: PierSpot): Poly => {
    const side = { x: -sp.dir.z, z: sp.dir.x };
    const hw = sp.width / 2;
    const e = { x: sp.origin.x + sp.dir.x * sp.length, z: sp.origin.z + sp.dir.z * sp.length };
    return orient([
      { x: sp.origin.x + side.x * hw, z: sp.origin.z + side.z * hw },
      { x: e.x + side.x * hw, z: e.z + side.z * hw },
      { x: e.x - side.x * hw, z: e.z - side.z * hw },
      { x: sp.origin.x - side.x * hw, z: sp.origin.z - side.z * hw },
    ]);
  };
  const clearSpots = pierSpots.filter((sp) => {
    const r = pierRect(sp);
    if (sp.kind === "shore" && overlapDepth(r, oldExcl) > 0.2) return false;
    if (sp.kind === "shore" && fill.some((f) => overlapDepth(r, f.polygon) > 0.2)) return false;
    return !blocks.some((b) => overlapDepth(r, orient(b.polygon)) > 0.2);
  });

  // A street that runs between shops, yards or the strip has its sidewalk where a street of houses has its verge.
  const SHOPS: readonly District[] = ["core", "dock", "waterfront", "mill", "industrial", "highway strip"];
  const edgeDist = (poly: Poly, a: Vec, b: Vec): number => {
    let d = Infinity;
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segSegDist(poly[k]!, poly[(k + 1) % poly.length]!, a, b));
    return d;
  };
  const streetsOut: Street[] = streets.map((st) => {
    if (st.kind !== "street") return st;
    const shops = blocks.some((bl) => SHOPS.includes(bl.district) && edgeDist(bl.polygon, st.a, st.b) <= st.width / 2 + 1);
    return shops ? { ...st, ...wayOf(st.kind, st.width, true) } : st;
  });

  return {
    plats: [platOld, platCompany],
    seams,
    streets: streetsOut,
    blocks,
    meta,
    old: { frame: oldFrame, bearing, columns: C, rows: R, pU, pV, wharfCol, dockDir, mainLine, coreRows, roadBasis, railPresent, mainWidth: wMain, streetWidth: wOld, quayV },
    company: { frame: coFrame, pU: pUc, pV: pVc, streetWidth: wCo },
    fill,
    quay,
    pierSpots: clearSpots,
    spurs,
    woods,
    coreCentre,
    millCentre,
    terminalCentre,
    wharfFoot,
  };
}

/** Does a whole polygon stand on made ground: on natural land (at least `margin` m inland) or on the fill? Corners and points along the edges every 2.5 m. */
export function onMadeGround(site: TownSite, fill: readonly { polygon: Poly }[], poly: Poly, margin = 0.5): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const steps = Math.max(1, Math.floor(Math.sqrt(dx * dx + dz * dz) / 2.5));
    for (let k = 0; k <= steps; k++) {
      const p = { x: a.x + (dx * k) / steps, z: a.z + (dz * k) / steps };
      if (onLand(site, p, margin)) continue;
      if (!fill.some((f) => contains(f.polygon, p, 0.05))) return false;
    }
  }
  return true;
}
