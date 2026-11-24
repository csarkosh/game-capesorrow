/**
 * Cutting a block into lots, and fitting a building's footprint into a lot. The machinery is the same
 * for every kind of town; what a district's lots look like (their widths, whether they are cut in
 * one row or two, whether an alley runs between) is a `LotRule` the town's recipe supplies.
 *
 * A block is cut in its own (s, t) axes: s along its long side, t across it. Lots face the long
 * streets, the two rows backed by the alley (or by each other, where the plat has none).
 */
import {
  area,
  bbox,
  clipHalfPlane,
  dedupe,
  orient,
  toLocal,
  toWorld,
  type Frame,
  type Poly,
  type Vec,
} from "./geom.js";
import { pick, type Rng } from "./rng.js";

export type LotRule = {
  /** 0: the whole block is one lot; 1: one row of lots facing `face`; 2: two rows, back to back or either side of an alley. */
  readonly rows: 0 | 1 | 2;
  /** The lot widths to draw from, metres. */
  readonly widths: readonly number[];
  /** Cut an alley between the two rows when the plat has one. */
  readonly alley: boolean;
  /** For one row: which long street it faces (lo: the one at small t). */
  readonly face?: "lo" | "hi";
};

/** A landmark's reserved place in a block. */
export type Reservation = {
  readonly block: number;
  readonly role: string;
  readonly side: "lo" | "hi";
  readonly at: "start" | "end";
  /** The reserved lot's width along the street, metres. */
  readonly width: number;
  /** Take the whole block as the one lot. */
  readonly whole: boolean;
};

/** A lot as cut, with the axes it was cut in. */
export type LotDraft = {
  readonly polygon: Poly;
  /** The unit axes of the lot: S along the street, T across (into the block from the lo side). */
  readonly S: Vec;
  readonly T: Vec;
  /** True when S is the plat's v axis (so a footprint's width along S is its half extent across the bearing). */
  readonly swap: boolean;
  /** -1: the front (street side) is at small t; +1: at large t. */
  readonly frontSign: 1 | -1;
  readonly role: string | null;
};

export type AlleyDraft = { readonly a: Vec; readonly b: Vec };

/** Clip a polygon in (s, t) to s in [lo, hi]. */
function clipS(p: Poly, lo: number, hi: number): Poly {
  return clipHalfPlane(clipHalfPlane(p, { x: 1, z: 0 }, lo), { x: -1, z: 0 }, -hi);
}

function clipT(p: Poly, lo: number, hi: number): Poly {
  return clipHalfPlane(clipHalfPlane(p, { x: 0, z: 1 }, lo), { x: 0, z: -1 }, -hi);
}

/** Cuts a block into lots in its frame; returns the lots and the alley, if any. */
export function cutBlock(
  poly: Poly,
  frame: Frame,
  rule: LotRule,
  alleyWidth: number | null,
  rng: Rng,
  reservation: Reservation | undefined,
): { lots: LotDraft[]; alley: { a: Vec; b: Vec; width: number } | null } {
  const loc = poly.map((p) => toLocal(frame, p));
  const bb = bbox(loc.map((l) => ({ x: l.u, z: l.v })));
  const swap = bb.x1 - bb.x0 < bb.z1 - bb.z0; // long side along v: s = v, t = u
  const toST = (l: { u: number; v: number }): Vec => (swap ? { x: l.v, z: l.u } : { x: l.u, z: l.v });
  const fromST = (q: Vec): Vec => (swap ? toWorld(frame, q.z, q.x) : toWorld(frame, q.x, q.z));
  const st = poly.length > 0 ? loc.map(toST) : [];
  const S = swap ? frame.V : frame.U;
  const T = swap ? frame.U : frame.V;
  const ext = bbox(st);
  const world = (q: Poly): Poly => orient(dedupe(q.map(fromST)));
  const out: LotDraft[] = [];

  const slice = (region: Poly, frontSign: 1 | -1, reserved: Reservation | null): void => {
    if (region.length < 3) return;
    const rb = bbox(region);
    let sa = rb.x0;
    let sb = rb.x1;
    const side = frontSign === -1 ? "lo" : "hi";
    const lots: { lo: number; hi: number; role: string | null }[] = [];
    let first: { lo: number; hi: number; role: string | null } | null = null;
    let last: { lo: number; hi: number; role: string | null } | null = null;
    if (reserved && reserved.side === side) {
      const w = Math.min(reserved.width, sb - sa);
      // A block cut oblique is thin at one end: the landmark takes the other end where the end the draw gave would leave it a sliver (under 60 percent of the other's ground).
      let at = reserved.at;
      const aStart = Math.abs(area(clipS(region, sa, sa + w)));
      const aEnd = Math.abs(area(clipS(region, sb - w, sb)));
      if (at === "start" && aStart < aEnd * 0.6) at = "end";
      else if (at === "end" && aEnd < aStart * 0.6) at = "start";
      if (at === "start") {
        first = { lo: sa, hi: sa + w, role: reserved.role };
        sa += w;
      } else {
        last = { lo: sb - w, hi: sb, role: reserved.role };
        sb -= w;
      }
    }
    if (first) lots.push(first);
    let pos = sa;
    const minW = Math.min(...rule.widths);
    const maxW = Math.max(...rule.widths);
    // Lots are never wider than the rule's widest: what is left at the end is one lot if it fits, two equal ones if it is a little over, else a gap.
    while (sb - pos > 1) {
      const rem = sb - pos;
      if (rem <= maxW) {
        if (rem >= minW * 0.8) lots.push({ lo: pos, hi: sb, role: null });
        break;
      }
      let w = pick(rng, rule.widths);
      if (rem - w < minW) w = rem / 2;
      lots.push({ lo: pos, hi: pos + w, role: null });
      pos += w;
    }
    if (last) lots.push(last);
    for (const l of lots) {
      const piece = clipS(region, l.lo, l.hi);
      if (piece.length < 3 || Math.abs(area(piece)) < 60) continue;
      out.push({ polygon: world(piece), S, T, swap, frontSign, role: l.role });
    }
  };

  let alley: { a: Vec; b: Vec; width: number } | null = null;
  if (reservation?.whole || rule.rows === 0) {
    out.push({ polygon: world(st), S, T, swap, frontSign: -1, role: reservation?.whole ? reservation.role : null });
    return { lots: out, alley };
  }
  const res = reservation ?? null;
  if (rule.rows === 1) {
    const sign: 1 | -1 = rule.face === "lo" ? -1 : 1;
    slice(st, sign, res);
    return { lots: out, alley };
  }
  const tm = (ext.z0 + ext.z1) / 2;
  const ah = rule.alley && alleyWidth !== null ? alleyWidth / 2 : 0;
  slice(clipT(st, -Infinity, tm - ah), -1, res);
  slice(clipT(st, tm + ah, Infinity), 1, res);
  if (ah > 0) {
    const strip = clipT(st, tm - 0.01, tm + 0.01);
    if (strip.length >= 3) {
      const sb = bbox(strip);
      const a = fromST({ x: sb.x0, z: tm });
      const b = fromST({ x: sb.x1, z: tm });
      alley = { a, b, width: alleyWidth! };
    }
  }
  return { lots: out, alley };
}

/** The footprint wanted on a lot. */
export type Want = {
  /** Along the street, metres (the lot's width, or less). */
  readonly width: number;
  /** Into the lot from the street. */
  readonly depth: number;
  /** From the lot's street edge to the front wall. */
  readonly setback: number;
  /** Where along the lot the footprint sits, 0 to 1 (0.5: centred). */
  readonly slide?: number;
};

export type Fit = { readonly centre: Vec; readonly halfS: number; readonly halfT: number };

/** The s extent of a convex polygon (in s, t points) along the line at t, or null where the line misses it. */
function chordAt(pts: readonly { s: number; t: number }[], t: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if ((a.t - t) * (b.t - t) > 0) continue;
    if (a.t === b.t) {
      lo = Math.min(lo, a.s, b.s);
      hi = Math.max(hi, a.s, b.s);
      continue;
    }
    const s = a.s + ((b.s - a.s) * (t - a.t)) / (b.t - a.t);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return lo > hi ? null : [lo, hi];
}

/**
 * Fits an oriented rectangle of about the wanted size inside a lot, backing off in steps (smaller,
 * and set further back); null if even a small one will not fit. The rectangle's two long edges are
 * placed where the lot is wide enough at both: the two cross-sections of a convex lot decide.
 */
export function fitRect(lot: LotDraft, want: Want, ok?: (f: Fit) => boolean): Fit | null {
  const S = lot.S;
  const T = lot.T;
  const pts = lot.polygon.map((p) => ({ s: p.x * S.x + p.z * S.z, t: p.x * T.x + p.z * T.z }));
  let sa = Infinity;
  let sb = -Infinity;
  let ta = Infinity;
  let tb = -Infinity;
  for (const q of pts) {
    sa = Math.min(sa, q.s);
    sb = Math.max(sb, q.s);
    ta = Math.min(ta, q.t);
    tb = Math.max(tb, q.t);
  }
  const slide = want.slide ?? 0.5;
  for (let k = 0; k < 20; k++) {
    const shrink = 1 - 0.035 * k;
    const w = Math.min(want.width * shrink, sb - sa - 0.1);
    const d = Math.min(want.depth * shrink, tb - ta - 0.1 - want.setback);
    if (w < 3.5 || d < 3.5) return null;
    const setback = want.setback + k * 0.8;
    const t0 = lot.frontSign === -1 ? ta + setback + 0.05 : tb - setback - 0.05 - d;
    const t1 = t0 + d;
    const c0 = chordAt(pts, t0);
    const c1 = chordAt(pts, t1);
    if (!c0 || !c1) continue;
    const lo = Math.max(c0[0], c1[0]) + 0.05;
    const hi = Math.min(c0[1], c1[1]) - 0.05;
    if (hi - lo < w) continue;
    const tc = (t0 + t1) / 2;
    // Where `ok` refuses the rectangle (it stands on the railroad's corridor), it is slid along the street's side of the lot before it is made smaller.
    for (const at of ok === undefined ? [slide] : [slide, 0, 1, 0.25, 0.75]) {
      const sc = lo + w / 2 + (hi - lo - w) * at;
      const fit = { centre: { x: sc * S.x + tc * T.x, z: sc * S.z + tc * T.z }, halfS: w / 2, halfT: d / 2 };
      if (ok === undefined || ok(fit)) return fit;
    }
  }
  return null;
}

/** A lot's extents along its own axes: s along the street, t into the block. */
export function lotExtents(lot: LotDraft): { sa: number; sb: number; ta: number; tb: number } {
  let sa = Infinity;
  let sb = -Infinity;
  let ta = Infinity;
  let tb = -Infinity;
  for (const p of lot.polygon) {
    const s = p.x * lot.S.x + p.z * lot.S.z;
    const t = p.x * lot.T.x + p.z * lot.T.z;
    sa = Math.min(sa, s);
    sb = Math.max(sb, s);
    ta = Math.min(ta, t);
    tb = Math.max(tb, t);
  }
  return { sa, sb, ta, tb };
}
