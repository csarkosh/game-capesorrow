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
import { analyseShore, onLand, roadAt, shoreAt, shoreLine } from "../shore.js";
import type { TownSite } from "../site.js";
import { ALLEY_WIDTH, wayOf } from "../ways.js";
import { pruneStreets } from "./ends.js";
import type { Block, District, History, Plat, Quay, Seam, Street, StreetKind } from "../types.js";

const FT = 0.3048;
export const HIGHWAY_WIDTH = 24;
const RAIL_WIDTH = 8;
/** The made ground reaches this far north and south of the anchor at most (the terrain's footprint is 480 m). */
const Z_HALF_MAX = 480;
const MIN_BLOCK_AREA = 900;
const MIN_BLOCK_WIDTH = 16;
/** The rail's corridor on the quay, seaward of the old plat's quay street. */
const RAIL_CORRIDOR = 8;

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
  if (bb.x1 < Math.min(xlo, xhi) - m) return [{ poly, east: false }];
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
  const west = clipHalfPlane(poly, { x: -nx, z: -nz }, -(d0 - m));
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
  /** The most columns (down to four) whose quay, with the plat's seaward edge at `oV`, stays within the made ground's reach and under the fill limit. */
  const bestWindow = (oV: number): { C: number; us: number; depth: number; found: boolean } => {
    let best = { C: 4, us: coveL.u - 2 * pU, depth: Infinity, found: false };
    for (let c = C0; c >= 4; c--) {
      for (const k of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        const us = coveL.u - (c * pU) / 2 + k * pU;
        const zs = [toWorld(prov, us, oV).z, toWorld(prov, us + c * pU, oV).z, toWorld(prov, us, oV + 3 * pV).z, toWorld(prov, us + c * pU, oV + 3 * pV).z];
        if (Math.max(...zs.map((z) => Math.abs(z))) > Z_HALF_MAX - 20) continue;
        const depth = vReach(shoreProv, us - hwQ, us + c * pU + hwQ) - oV;
        if (depth <= FILL_LIMIT) return { C: c, us, depth, found: true };
        if (c === 4 && depth < best.depth) best = { C: 4, us, depth, found: false };
      }
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
  const shoreMargin = railPresent ? 7 : 6;
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
  const target = int(rngP, 40, 54);

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

  let zh = Z_HALF_MAX;
  let comp = buildCompass(zh);
  while (zh > 240 && oldPieces.length + comp.pieces.length > Math.min(target + 4, 54)) {
    zh -= 40;
    comp = buildCompass(zh);
  }
  const { zo, N, J, xo, frame: coFrame, knots, iAv } = comp;

  // ---- Streets.
  const raw: RawStreet[] = [];
  const oldGone = (p: Vec): boolean => contains(oldExcl, p, -0.05);
  const hwBand = (p: Vec, hw: number): boolean => Math.abs(p.x - roadAt(site, p.z)) < HIGHWAY_WIDTH / 2 + hw + 2;
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
  // The rail: along the quay, and along the flats' shore, ending at the old plat.
  if (railPresent) {
    raw.push({ a: O(uLo, -RAIL_WIDTH / 2), b: O(uHi, -RAIL_WIDTH / 2), width: RAIL_WIDTH, kind: "rail", plat: "old", name: `${names.railroad} line` });
    for (let k = 0; k < N; k++) {
      const a = { x: knots[k]!.x, z: knots[k]!.z };
      const b = { x: knots[k + 1]!.x, z: knots[k + 1]!.z };
      for (const [p, q] of runsOf(a, b, (pt) => Math.abs(pt.z) <= zh && !oldGone(pt), [], 12)) raw.push({ a: p, b: q, width: RAIL_WIDTH, kind: "rail", plat: "company", name: `${names.railroad} line` });
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
    const kept = pruneStreets(raw, [...oldPieces.map((p) => p.poly), ...comp.pieces.map((p) => p.poly)]);
    raw.length = 0;
    raw.push(...kept);
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
    const root = find(0);
    const keptRaw = raw.filter((_, i) => find(i) === root);
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
  const coreCentre = O(wharfCol * pU, lineV(mainLine));
  const millCentre = centreOf(millRun, { x: coreCentre.x, z: coreCentre.z + (millNorth ? 300 : -300) });
  const terminalCentre = centreOf(termRun, { x: coreCentre.x, z: coreCentre.z + (millNorth ? -300 : 300) });

  // ---- Blocks and their districts.
  const blocks: Block[] = [];
  const meta: BlockMeta[] = [];
  const rowsHere: number[] = [];
  for (const p of oldPieces) if (!rowsHere.includes(p.row)) rowsHere.push(p.row);
  rowsHere.sort((a, b) => Math.abs(a - (mainLine - 0.5)) - Math.abs(b - (mainLine - 0.5)) || a - b);
  const coreRows = rowsHere.slice(0, 2);
  const oldDistrict = (p: OldPiece): District => {
    const ad = Math.abs(p.d);
    const c = centroid(p.poly);
    if (ad < 1.5 && coreRows.includes(p.row)) return "core";
    if (dist(c, millCentre) <= 260) return "mill housing";
    if (p.row === 0 && p.d >= 1.5) return "dock";
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
    if (nearHwy <= 40 && history.present.highwayStrip && chance(rngP, 0.65)) return "highway strip";
    if (dist(c, millCentre) <= 280) return "mill housing";
    if (c.x < roadAt(site, c.z) && dist(c, terminalCentre) <= 260) return "industrial";
    return "residential";
  };
  for (let k = 0; k < comp.pieces.length; k++) {
    const cp = comp.pieces[k]!;
    blocks.push({ id: blocks.length, plat: "company", polygon: cp.poly, district: compassDistrict(cp, siteOf[k]!), cell: { col: cp.i, row: cp.j } });
    meta.push({ frame: coFrame, bearing: COMPASS, tag: "compass", col: cp.i, row: cp.j, d: 0, site: siteOf[k]!, shoreFront: cp.front });
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
