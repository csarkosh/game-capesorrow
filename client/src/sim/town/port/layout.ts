/**
 * The large port's ground plan: its plats, the seam between them, the streets and the blocks.
 *
 * The claimant's WATERFRONT plat is laid to the bearing the history chose (the shore's own line, the
 * cove's flank, or the line of the first wharf), a few blocks deep, with its main street along the
 * water and a street to the wharf. Between the main street and the water lies a strip of working
 * waterfront (with the railroad along it, if the history has one), and beside the plat, along the
 * shore, the mill's site. The land company's COMPASS plat (bearing 0) fills the ground behind it,
 * reaching the highway and across it, with alleys and one wide avenue. Where they meet is the SEAM:
 * company blocks are cut by the claimant plat's last street into trapezoids and triangles, streets
 * end in T-junctions on it, and that street runs along the seam.
 *
 * The highway is given. Blocks are kept clear of its surface, grid streets that reach it end on it,
 * and a company grid line is taken up by it.
 */
import { COMPASS, bearingV, gridAngle, type Bearing } from "../bearings.js";
import {
  area,
  bbox,
  centroid,
  clipHalfPlane,
  dist,
  frameOf,
  lerpVec,
  localRect,
  segCross,
  simplifyTo,
  toLocal,
  toWorld,
  type Frame,
  type Poly,
  type Vec,
} from "../geom.js";
import { ordinal, type TownNames } from "../names.js";
import { chance, int, pick, range, type Rng } from "../rng.js";
import { analyseShore, polyOnLand, roadAt, shoreAt, shoreLine, type ShoreFacts } from "../shore.js";
import type { TownSite } from "../site.js";
import type { Block, District, History, Plat, Seam, Street, StreetKind } from "../types.js";

const FT = 0.3048;
export const HIGHWAY_WIDTH = 24;
const RAIL_WIDTH = 8;
const MIN_BLOCK_AREA = 900;
const MIN_BLOCK_WIDTH = 16;

/** What a block is, in its plat's own grid; the lot and building stages read it. */
export type BlockMeta = {
  readonly frame: Frame;
  readonly bearing: Bearing;
  readonly tag: "grid" | "strip" | "mill";
  readonly col: number;
  readonly row: number;
  /** For a claimant block: the signed distance in blocks from the street to the wharf, positive toward the dock end. */
  readonly d: number;
  /** For a strip block: its seaward edge and the shoreline's v at its middle, both in the claimant's local frame. */
  readonly edge?: number;
  readonly shoreV?: number;
};

export type Layout = {
  plats: Plat[];
  seams: Seam[];
  streets: Street[];
  blocks: Block[];
  meta: BlockMeta[];
  /** The claimant's grid: its frame and numbers, for the later stages. */
  claim: {
    frame: Frame;
    bearing: Bearing;
    columns: number;
    rows: number;
    pU: number;
    pV: number;
    wharfCol: number;
    dockDir: 1 | -1;
    millSide: 1 | -1;
    railPresent: boolean;
    /** The shoreline in the claimant's local frame (u, v), south to north. */
    shore: { u: number; v: number }[];
    mainWidth: number;
    streetWidth: number;
  };
  company: { frame: Frame; pU: number; pV: number; streetWidth: number };
  coreCentre: Vec;
  millCentre: Vec;
  /** The streets-to-the-water deck: where the wharf street leaves the land. */
  wharfFoot: Vec;
};

/** A street under construction. */
type RawStreet = { a: Vec; b: Vec; width: number; kind: StreetKind; plat: string | null; name: string; seam?: boolean };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function ceilDiv(x: number): number {
  return -Math.floor(-x);
}

/** Pieces of a segment: cut by an optional half-plane (keep n.p >= d) and split where it crosses the highway; east pieces kept only if `keepEast`. */
function segmentPieces(site: TownSite, a: Vec, b: Vec, clip: { n: Vec; d: number } | null, splitHighway: boolean, keepEast: boolean, minLen: number): [Vec, Vec][] {
  const ts: number[] = [0, 1];
  if (clip) {
    const sa = a.x * clip.n.x + a.z * clip.n.z - clip.d;
    const sb = b.x * clip.n.x + b.z * clip.n.z - clip.d;
    if ((sa >= 0 && sb < 0) || (sa < 0 && sb >= 0)) ts.push(sa / (sa - sb));
  }
  if (splitHighway) {
    for (let i = 0; i < site.roadX.length - 1; i++) {
      const z0 = site.z0 + i * site.step;
      const c = segCross(a, b, { x: site.roadX[i]!, z: z0 }, { x: site.roadX[i + 1]!, z: z0 + site.step });
      if (c) ts.push(c.t);
    }
  }
  ts.sort((p, q) => p - q);
  const out: [Vec, Vec][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const mid = lerpVec(a, b, (t0 + t1) / 2);
    if (clip && mid.x * clip.n.x + mid.z * clip.n.z < clip.d) continue;
    if (!keepEast && mid.x > roadAt(site, mid.z)) continue;
    const p = lerpVec(a, b, t0);
    const q = lerpVec(a, b, t1);
    if (dist(p, q) >= minLen) out.push([p, q]);
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

/** Does a block polygon stand at least this far in (in a frame's axes)? */
function usable(f: Frame, poly: Poly): boolean {
  return poly.length >= 3 && area(poly) >= MIN_BLOCK_AREA && thickness(f, poly) >= MIN_BLOCK_WIDTH;
}

export function layoutPort(site: TownSite, history: History, names: TownNames, rngP: Rng, rngS: Rng): Layout {
  const shore: ShoreFacts = analyseShore(site);
  const bearing = history.firstPlat.bearing;
  const prov = frameOf({ x: 0, z: 0 }, bearing);
  const sp = shoreLine(site).map((p) => toLocal(prov, p));
  const uCove = toLocal(prov, { x: shoreAt(site, shore.coveZ), z: shore.coveZ }).u;

  // ---- The claimant's plat: block size, street widths, alley.
  const pU = FT * 5 * int(rngP, 60, 84);
  const pV = FT * 5 * int(rngP, 52, 66);
  const wClaim = pick(rngP, [18, 20]);
  const wMain = history.fire ? 24 : 20;
  const claimAlley = chance(rngP, 0.5) ? 5 : null;
  const railPresent = history.railroad !== null;
  const c0 = int(rngP, 5, 7);
  const millSide: 1 | -1 = chance(rngP, 0.5) ? 1 : -1;
  const dockDir: 1 | -1 = millSide === 1 ? -1 : 1;
  const millLen = int(rngP, 200, 280);
  const dStrip = railPresent ? int(rngP, 62, 86) : int(rngP, 56, 80);
  let rows = int(rngP, 2, 4);
  const wharfJitter = int(rngP, -1, 1);

  // ---- The window of columns (and the mill's ground) along the shore that keeps the wharf row shallow.
  const extentOf = (uStart: number, c: number): { lo: number; hi: number } => ({
    lo: uStart - (millSide < 0 ? millLen + wClaim / 2 : 0),
    hi: uStart + c * pU + (millSide > 0 ? millLen + wClaim / 2 : 0),
  });
  const spreadOf = (lo: number, hi: number): { vmax: number; vmin: number } => {
    let vmax = -Infinity;
    let vmin = Infinity;
    for (const q of sp) {
      if (q.u < lo || q.u > hi) continue;
      vmax = Math.max(vmax, q.v);
      vmin = Math.min(vmin, q.v);
    }
    return { vmax, vmin };
  };
  let columns = 3;
  let uStart = uCove - (3 * pU) / 2;
  let found = false;
  for (let cap = 130; !found && cap < 600; cap += 30) {
    for (let c = c0; !found && c >= (cap < 230 ? 4 : 3); c--) {
      for (const k of [0, 1, -1, 2, -2, 3, -3]) {
        const us = uCove - (c * pU) / 2 + (k * pU) / 2;
        const e = extentOf(us, c);
        const s = spreadOf(e.lo, e.hi);
        if (s.vmax - s.vmin <= cap) {
          columns = c;
          uStart = us;
          found = true;
          break;
        }
      }
    }
  }
  const ext = extentOf(uStart, columns);
  const { vmax } = spreadOf(ext.lo, ext.hi);
  const F = vmax + dStrip;
  const claimFrame = frameOf(toWorld(prov, uStart, F), bearing);
  const shoreLocal = sp.map((q) => ({ u: q.u - uStart, v: q.v - F }));
  const C = columns;
  const wharfCol = clamp(Math.floor(C / 2) + wharfJitter, 1, C - 1);

  // The shoreline's most inland v (local) within a u-range.
  const shoreMaxV = (u0: number, u1: number): number => {
    let m = -Infinity;
    for (const q of shoreLocal) if (q.u >= u0 && q.u <= u1 && q.v > m) m = q.v;
    return m === -Infinity ? -dStrip : m;
  };

  // Rows: as deep as keeps the plat's back street clear of the highway.
  const backClear = (r: number): boolean => {
    for (const k of [0, 0.5, 1]) {
      const p = toWorld(claimFrame, k * C * pU, r * pV);
      if (p.x + wClaim / 2 + 45 > roadAt(site, p.z)) return false;
    }
    return true;
  };
  while (rows > 2 && !backClear(rows)) rows--;
  const R = rows;

  // ---- Local helpers for the claimant's grid.
  const wU = (j: number): number => (j === 0 ? wMain : wClaim);
  const cellU = (i: number): [number, number] => [i * pU + wClaim / 2, (i + 1) * pU - wClaim / 2];
  const cellV = (j: number): [number, number] => [j * pV + wU(j) / 2, (j + 1) * pV - wU(j + 1) / 2];
  const railV = -dStrip + RAIL_WIDTH;
  const edgeFor = (u0: number, u1: number): number => (railPresent ? railV + 6 : shoreMaxV(u0, u1) + 8);

  const blocks: Block[] = [];
  const meta: BlockMeta[] = [];
  const addBlock = (poly: Poly, plat: string, frame: Frame, bearingOf: Bearing, tag: BlockMeta["tag"], col: number, row: number, d: number, district: District, keepEast: boolean, extra?: { edge: number; shoreV: number }): number => {
    let made = 0;
    for (const piece of aroundHighway(site, poly)) {
      if (piece.east && !keepEast) continue;
      const p = simplifyTo(piece.poly, 6);
      if (!usable(frame, p)) continue;
      blocks.push({ id: blocks.length, plat, polygon: p, district, cell: tag === "grid" ? { col, row } : null });
      const m: BlockMeta = { frame, bearing: bearingOf, tag, col, row, d, ...(extra ?? {}) };
      meta.push(m);
      made++;
    }
    return made;
  };

  const coreCentre = toWorld(claimFrame, wharfCol * pU, 0);
  const millU = millSide > 0 ? C * pU + wClaim / 2 + millLen / 2 : -wClaim / 2 - millLen / 2;
  const millCentre = toWorld(claimFrame, millU, (-dStrip + R * pV) / 2 - 10);
  const distTo = (p: Vec, q: Vec): number => dist(p, q);

  const claimDistrict = (poly: Poly, col: number, row: number): District => {
    const d = (col + 0.5 - wharfCol) * dockDir;
    const ad = Math.abs(d);
    if (row === 0 && ad < 2) return "core";
    if (row === 1 && ad < 1) return "core";
    if (distTo(centroid(poly), millCentre) <= 270) return "mill housing";
    if (row === 0 && d >= 2 && d < 4) return "dock";
    return "residential";
  };

  // Claimant grid cells.
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < C; i++) {
      const [u0, u1] = cellU(i);
      const [v0, v1] = cellV(j);
      const poly = localRect(claimFrame, u0, u1, v0, v1);
      addBlock(poly, "claim", claimFrame, bearing, "grid", i, j, (i + 0.5 - wharfCol) * dockDir, claimDistrict(poly, i, j), false);
    }
  }
  // Strip blocks: the working waterfront, between the water and the main street.
  const eCol: (number | null)[] = [];
  for (let i = 0; i < C; i++) {
    const [u0, u1] = cellU(i);
    let e = edgeFor(u0, u1);
    let poly = localRect(claimFrame, u0, u1, e, -wMain / 2);
    for (let tries = 0; tries < 12 && !polyOnLand(site, poly, 2); tries++) {
      e += 4;
      poly = localRect(claimFrame, u0, u1, e, -wMain / 2);
    }
    if (-wMain / 2 - e < 18) {
      eCol.push(null);
      continue;
    }
    eCol.push(e);
    const t = (i + 0.5 - wharfCol) * dockDir;
    addBlock(poly, "claim", claimFrame, bearing, "strip", i, -1, t, t >= 2 && t < 4 ? "dock" : "waterfront", false, { edge: e, shoreV: shoreMaxV(u0, u1) });
  }
  // The mill's site, beside the plat, along the shore.
  {
    const u0 = millSide > 0 ? C * pU + wClaim / 2 : -wClaim / 2 - millLen;
    const u1 = u0 + millLen;
    let e = edgeFor(u0, u1);
    const vEnd = Math.min(R * pV - wClaim / 2, 170);
    let poly = localRect(claimFrame, u0, u1, e, vEnd);
    for (let tries = 0; tries < 12 && !polyOnLand(site, poly, 2); tries++) {
      e += 4;
      poly = localRect(claimFrame, u0, u1, e, vEnd);
    }
    addBlock(poly, "claim", claimFrame, bearing, "mill", millSide > 0 ? C : -1, 0, 0, "mill", false, { edge: e, shoreV: shoreMaxV(u0, u1) });
  }
  const claimBlockCount = blocks.length;

  // ---- The seam: the claimant's last street, and the half-plane behind it.
  const Vc = bearingV(bearing);
  const seamN: Vec = { x: Vc.x, z: Vc.z };
  const seamLineD = claimFrame.o.x * seamN.x + claimFrame.o.z * seamN.z + R * pV;
  const seamClipBlocks = { n: seamN, d: seamLineD + wClaim / 2 };
  const seamClipStreets = { n: seamN, d: seamLineD };

  // ---- The land company's plat, to the compass.
  const coFrameBase = (o: Vec): Frame => frameOf(o, COMPASS);
  const shortFt = 5 * int(rngP, 52, 75);
  const longFt = 5 * int(rngP, Math.max(60, shortFt / 5 + 6), 92);
  const longAlongZ = chance(rngP, 0.5);
  const pUc = FT * (longAlongZ ? longFt : shortFt);
  const pVc = FT * (longAlongZ ? shortFt : longFt);
  const wCo = pick(rngP, [18, 20, 20, 24]);
  const avenueWidth = 30;
  const target = int(rngP, 42, 54);
  const zc = coreCentre.z;
  const zOff = range(rngP, 0, pUc);
  const zAv = zc + range(rngP, -pUc, pUc);
  let roadMean = 0;
  for (let k = -3; k <= 3; k++) roadMean += roadAt(site, zc + k * 150);
  roadMean /= 7;
  const seamX = (z: number): number => (seamLineD - z * seamN.z) / seamN.x;
  const xSeamMin = Math.min(seamX(zc - 5.5 * pUc), seamX(zc + 5.5 * pUc));
  const jH = clamp(ceilDiv((roadMean - xSeamMin) / pVc) + 1, 1, 8);
  const xo = roadMean - jH * pVc;
  const east = clamp(Math.floor(site.inland / pVc), 1, 3);
  const J = jH + east;

  const companyCells = (N: number): { poly: Poly; i: number; j: number }[] => {
    const zo = zc - (N * pUc) / 2 - zOff;
    const frame = coFrameBase({ x: xo, z: zo });
    const iAv = clamp(Math.round((zAv - zo) / pUc), 1, N - 1);
    const out: { poly: Poly; i: number; j: number }[] = [];
    const hwI = (i: number): number => (i === iAv ? avenueWidth : wCo) / 2;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < J; j++) {
        const u0 = i * pUc + hwI(i);
        const u1 = (i + 1) * pUc - hwI(i + 1);
        const v0 = j === jH ? jH * pVc - 40 : j * pVc + wCo / 2;
        const v1 = j === jH - 1 ? jH * pVc + 40 : (j + 1) * pVc - wCo / 2;
        const poly = clipHalfPlane(localRect(frame, u0, u1, v0, v1), seamClipBlocks.n, seamClipBlocks.d);
        if (poly.length >= 3) out.push({ poly, i, j });
      }
    }
    return out;
  };

  let N = 3;
  let cells = companyCells(N);
  // The pieces of a company cell: the cells beside the highway's grid line were drawn over it, and keep only their own side.
  const piecesOf = (poly: Poly, j: number): Poly[] => {
    const out: Poly[] = [];
    for (const piece of aroundHighway(site, poly)) {
      if (j === jH - 1 && piece.east) continue;
      if (j === jH && !piece.east) continue;
      const p = simplifyTo(piece.poly, 6);
      out.push(p);
    }
    return out;
  };
  const countPieces = (cs: { poly: Poly; j: number }[], f: Frame): number => {
    let n = 0;
    for (const c of cs) for (const p of piecesOf(c.poly, c.j)) if (usable(f, p)) n++;
    return n;
  };
  while (N < 12) {
    const f = coFrameBase({ x: xo, z: zc - (N * pUc) / 2 - zOff });
    if (claimBlockCount + countPieces(cells, f) >= target) break;
    N++;
    cells = companyCells(N);
  }
  const zo = zc - (N * pUc) / 2 - zOff;
  const coFrame = coFrameBase({ x: xo, z: zo });
  const iAv = clamp(Math.round((zAv - zo) / pUc), 1, N - 1);

  const companyDistrict = (poly: Poly): District => {
    const c = centroid(poly);
    let nearHwy = Infinity;
    for (const p of poly) nearHwy = Math.min(nearHwy, Math.abs(p.x - roadAt(site, p.z)));
    if (nearHwy <= 45 && history.present.highwayStrip && chance(rngP, 0.6)) return "highway strip";
    if (distTo(c, millCentre) <= 270) return "mill housing";
    if (c.x < roadAt(site, c.z) && Math.abs(c.z - coreCentre.z) >= 2.3 * pUc) return "industrial";
    return "residential";
  };
  for (const cell of cells) {
    for (const p of piecesOf(cell.poly, cell.j)) {
      if (!usable(coFrame, p)) continue;
      blocks.push({ id: blocks.length, plat: "company", polygon: p, district: companyDistrict(p), cell: { col: cell.i, row: cell.j } });
      meta.push({ frame: coFrame, bearing: COMPASS, tag: "grid", col: cell.i, row: cell.j, d: 0 });
    }
  }

  // ---- Streets.
  const raw: RawStreet[] = [];
  const push = (s: RawStreet, clip: { n: Vec; d: number } | null, splitHighway: boolean, keepEast: boolean): void => {
    for (let [a, b] of segmentPieces(site, s.a, s.b, clip, splitHighway, keepEast, 8)) {
      if (clip) {
        // A street that ends on the seam street must not poke its square end across it: draw it back until its corners are on the seam street's surface.
        const len = dist(a, b);
        const dx = (b.x - a.x) / len;
        const dz = (b.z - a.z) / len;
        const cosA = Math.abs(dx * clip.n.x + dz * clip.n.z);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const back = cosA > 0.2 ? Math.max(0, (s.width / 2 * sinA - wClaim / 2 + 0.15) / cosA) : 0;
        if (back > 0) {
          if (Math.abs(a.x * clip.n.x + a.z * clip.n.z - clip.d) < 1e-6) a = { x: a.x + dx * back, z: a.z + dz * back };
          if (Math.abs(b.x * clip.n.x + b.z * clip.n.z - clip.d) < 1e-6) b = { x: b.x - dx * back, z: b.z - dz * back };
        }
      }
      raw.push({ ...s, a, b });
    }
  };
  const L = (u: number, v: number): Vec => toWorld(claimFrame, u, v);

  // The highway, as given.
  for (let i = 0; i < site.roadX.length - 1; i++) {
    const z0 = site.z0 + i * site.step;
    raw.push({ a: { x: site.roadX[i]!, z: z0 }, b: { x: site.roadX[i + 1]!, z: z0 + site.step }, width: HIGHWAY_WIDTH, kind: "highway", plat: null, name: names.highway });
  }
  // The rail line, along the shore, between the water and the town.
  if (railPresent) {
    let a = L(ext.lo - uStart - 20, railV);
    let b = L(ext.hi - uStart + 20, railV);
    for (let k = 0; k < 40 && a.x > roadAt(site, a.z) - 40; k++) a = lerpVec(a, b, 0.03);
    for (let k = 0; k < 40 && b.x > roadAt(site, b.z) - 40; k++) b = lerpVec(b, a, 0.03);
    raw.push({ a, b, width: RAIL_WIDTH, kind: "rail", plat: "claim", name: `${names.railroad} line` });
  }
  // The claimant's streets along the shore (u lines).
  const eLine = (i: number): number => {
    if (railPresent) return railV;
    let e = Infinity;
    for (const k of [i - 1, i]) {
      const v = eCol[k];
      if (v !== undefined && v !== null) e = Math.min(e, v);
    }
    return e === Infinity ? -wMain / 2 - 20 : e;
  };
  for (let j = 0; j < R; j++) {
    push({ a: L(0, j * pV), b: L(C * pU, j * pV), width: wU(j), kind: j === 0 ? "main" : "street", plat: "claim", name: `${names.along[j]!} Street` }, null, true, false);
  }
  // The seam street runs on past the plat to where the company's blocks end.
  const reach = Math.max(240, (N * pUc) / 2);
  push(
    { a: L(-reach, R * pV), b: L(C * pU + reach, R * pV), width: wClaim, kind: "street", plat: "claim", name: `${names.along[R]!} Street`, seam: true },
    null,
    true,
    false,
  );
  // Trim the seam street to the company plat's reach in z, but never inside the claimant's own span.
  for (let k = 0; k < raw.length; k++) {
    const s = raw[k]!;
    if (!s.seam) continue;
    const zlo = zo - 5;
    const zhi = zo + N * pUc + 5;
    let a = s.a;
    let b = s.b;
    if (a.z > b.z) [a, b] = [b, a];
    if (a.z < zlo) a = lerpVec(a, b, (zlo - a.z) / (b.z - a.z));
    if (b.z > zhi) b = lerpVec(a, b, (zhi - a.z) / (b.z - a.z));
    // Re-extend to the claimant's own span (u from 0 to C * pU), where that span lies on this piece's side of the highway.
    const la = toLocal(claimFrame, a).u;
    const lb = toLocal(claimFrame, b).u;
    const lo = Math.min(la, lb);
    const hi = Math.max(la, lb);
    const s0 = toLocal(claimFrame, s.a).u;
    const s1 = toLocal(claimFrame, s.b).u;
    const sLo = Math.min(s0, s1);
    const sHi = Math.max(s0, s1);
    const uA = Math.max(sLo, Math.min(lo, 0));
    const uB = Math.min(sHi, Math.max(hi, C * pU));
    raw[k] = { ...s, a: L(uA, R * pV), b: L(uB, R * pV) };
  }
  // The claimant's streets down to the water (v lines).
  for (let i = 0; i <= C; i++) {
    const nm = names.cross[i]!;
    push({ a: L(i * pU, eLine(i)), b: L(i * pU, R * pV), width: wClaim, kind: "street", plat: "claim", name: `${nm} Street` }, null, true, false);
  }
  // The wharf: the street to the wharf runs on over the water.
  const wharfU = wharfCol * pU;
  const wharfStartV = eLine(wharfCol);
  const shoreAtWharf = shoreMaxV(wharfU - 8, wharfU + 8);
  const deckLen = int(rngS, 60, 110);
  const wharfFoot = L(wharfU, shoreAtWharf);
  raw.push({ a: L(wharfU, wharfStartV), b: L(wharfU, shoreAtWharf - deckLen), width: 12, kind: "wharf", plat: "claim", name: names.wharf });

  // The company's streets.
  for (let i = 0; i <= N; i++) {
    const isAv = i === iAv;
    const name = isAv ? names.avenue : `${ordinal(names.numberedFrom + i)} Street`;
    push(
      { a: toWorld(coFrame, i * pUc, 0), b: toWorld(coFrame, i * pUc, J * pVc), width: isAv ? avenueWidth : wCo, kind: isAv ? "avenue" : "street", plat: "company", name },
      seamClipStreets,
      true,
      true,
    );
  }
  for (let j = 0; j <= J; j++) {
    if (j === jH) continue;
    push(
      { a: toWorld(coFrame, 0, j * pVc), b: toWorld(coFrame, N * pUc, j * pVc), width: wCo, kind: "street", plat: "company", name: `${names.named[j % names.named.length]!} Street` },
      seamClipStreets,
      true,
      true,
    );
  }

  const streets: Street[] = raw.map((s, id) => ({ id, a: s.a, b: s.b, width: s.width, kind: s.kind, plat: s.plat, name: s.name, ...(s.seam ? { seam: true } : {}) }));

  // ---- The plats as records.
  const claimPoly = localRect(claimFrame, 0, C * pU, -dStrip, R * pV);
  const platClaim: Plat = {
    id: "claim",
    name: `${names.claimant}'s plat`,
    origin: claimFrame.o,
    bearing,
    block: { along: pU, across: pV },
    streetWidth: wClaim,
    alley: claimAlley,
    columns: C,
    rows: R,
    polygon: claimPoly,
    by: history.firstPlat.by,
    year: history.firstPlat.year,
    avenue: null,
  };
  const coPoly = clipHalfPlane(localRect(coFrame, 0, N * pUc, 0, J * pVc), seamClipBlocks.n, seamClipBlocks.d);
  const platCompany: Plat = {
    id: "company",
    name: `${history.secondPlat.company}'s addition`,
    origin: coFrame.o,
    bearing: COMPASS,
    block: { along: pUc, across: pVc },
    streetWidth: wCo,
    alley: 5,
    columns: N,
    rows: J,
    polygon: coPoly,
    by: history.secondPlat.company,
    year: history.secondPlat.year,
    avenue: { line: iAv, width: avenueWidth },
  };

  // The seam: the longest piece of the seam street.
  const seams: Seam[] = [];
  let seamStreet = -1;
  let longest = 0;
  for (const s of streets) {
    if (!s.seam) continue;
    const l = dist(s.a, s.b);
    if (l > longest) {
      longest = l;
      seamStreet = s.id;
    }
  }
  if (seamStreet >= 0) {
    const s = streets[seamStreet]!;
    seams.push({ plats: ["claim", "company"], a: s.a, b: s.b, angle: gridAngle(bearing, COMPASS), street: seamStreet });
  }

  return {
    plats: [platClaim, platCompany],
    seams,
    streets,
    blocks,
    meta,
    claim: {
      frame: claimFrame,
      bearing,
      columns: C,
      rows: R,
      pU,
      pV,
      wharfCol,
      dockDir,
      millSide,
      railPresent,
      shore: shoreLocal,
      mainWidth: wMain,
      streetWidth: wClaim,
    },
    company: { frame: coFrame, pU: pUc, pV: pVc, streetWidth: wCo },
    coreCentre,
    millCentre,
    wharfFoot,
  };
}
