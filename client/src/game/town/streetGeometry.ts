/**
 * The town's streets as flat surfaces that follow the ground: every street of the plan but the highway (which the engine
 * paints and the town does not draw over). A street is a roadway of `street.roadway` between curbs and, down each side, a
 * grass verge and a sidewalk of `street.walk` (the main street has sidewalks and no verge; an alley is gravel, all roadway; the
 * wharf is a timber deck).
 *
 * - **One height for every roadway.** Every roadway, the junctions' pavements included, lies `ROADWAY_LIFT` over the ground, so no
 *   two roadway surfaces overlap and none stands over another. The sidewalk lies a curb's face (6 in, `CURB_RISE`) over the
 *   roadway, the verge 2 cm under it, and the curb's top is the sidewalk's own height.
 * - **The legs' strips end on the junction.** A street is cut where it meets another: its roadway strip ends at each junction's
 *   mouth (`sim/town/junctions.ts`), its verge, sidewalk and curb at the corner's tangent point, and the pavement between is the
 *   junction's, bounded by its curb returns (`junctionGeometry.ts`). A street that runs through a junction is two strips.
 * - **Cut every `TILE` m** along its length and across into bands; a vertex stands at the ground's height plus its lift, so a
 *   surface follows the ground's roll.
 * - **Curb ramps, aprons and gaps**: the sidewalk's bands are cut where a ramp or a driveway apron stands, and the curb with them.
 * - **Paint**: the main street has a dashed yellow centre line (10 ft dashes with 30 ft gaps, ending short of every crossing) and
 *   white parking stalls held back from corners; the avenue a painted median between solid yellow lines. A residential street
 *   has none. The marks at a junction (crosswalks, stop lines, the dotted extension) are `junctionPaint.ts`'s.
 * - Ground under the sea is not drawn. A tile that reaches into the engine's road bed is cut along the bed's edge.
 */
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { ALLEY, ASPHALT, CURB, DECK, MEDIAN, PAINT_WHITE, PAINT_YELLOW, SIDEWALK, VERGE } from "./palette.js";
import { junctionGeometry } from "./junctionGeometry.js";
import { junctionPaint } from "./junctionPaint.js";
import { worldJunctions } from "./junctionWorld.js";
import { signGeometry } from "./signGeometry.js";
import { RoadSet, Surface, type P2, type P3 } from "./surface.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";
import { RAMP_RUN, RAMP_LANDING, CURB_FACE } from "../../sim/town/junctionShape.js";
import { hasPavement } from "../../sim/town/junctions.js";
import type { JunctionLeg, Street } from "../../sim/town/types.js";

/** A strip is cut along its length at least this often, metres. */
export const TILE = 4;
/** The lift of a verge's base over the ground, metres; a roadway lies `ASPHALT_OVER` more. */
export const STREET_LIFT = 0.06;
export const ASPHALT_OVER = 0.02;
/** Every roadway's lift over the ground, the junctions' pavements and the legs alike. */
export const ROADWAY_LIFT = STREET_LIFT + ASPHALT_OVER;
/** The curb's face over the gutter, 6 in (the research, section 1), the sidewalk's height over the roadway, and the curb's width. */
export const CURB_RISE = CURB_FACE;
export const WALK_LIFT = ROADWAY_LIFT + CURB_RISE;
export const VERGE_LIFT = WALK_LIFT - 0.02;
export const CURB_WIDTH = 0.18;
/** Paint lies this much over its roadway, metres. */
export const MARK_OVER = 0.012;
/** The main street's centre line: its width (4 in, WSDOT), dash and gap (10 ft and 30 ft, MUTCD and WSDOT), metres. */
export const CENTRE_WIDTH = 0.1;
export const CENTRE_DASH = 3.05;
export const CENTRE_GAP = 9.14;
/** The dotted extension through a junction: dashes of 2 ft with gaps of 6 ft (WSDOT's sheet). */
export const DOTTED_DASH = 0.61;
export const DOTTED_GAP = 1.83;
/** Parking along the main street: the lane's width, a stall's length along the curb, and a line's width, metres. */
export const PARKING_LANE = 2.4;
export const PARKING_STALL = 6.5;
export const LINE_WIDTH = 0.1;
/** The avenue's painted median: its width, metres. */
export const MEDIAN_WIDTH = 2;
/** A driveway apron's flare at each side (2 ft 6 in, WSDOT's sheet) and its lip at the gutter (1/2 in), metres. */
export const APRON_FLARE = 0.76;
export const APRON_LIP = 0.013;
/** Where an alley's gravel rises to the sidewalk's height, over this long a ramp at its mouth, metres. */
export const ALLEY_RISE = 1.8;
/** How far beyond the sidewalk the skirt's foot lies under the ground, so no light shows under it, metres. */
const SKIRT_FOOT = 0.0;

type PS = {
  street: Street;
  ax: number;
  az: number;
  tx: number;
  tz: number;
  /** The left normal: a positive offset lies left of the street's direction. */
  nx: number;
  nz: number;
  length: number;
  cw: number;
  hw: number;
  walk: number;
  /** The verge's width between the curb's back and the sidewalk (0 for none). */
  verge: number;
};

type Rect = [number, number, number, number];
type Span = { lo: number; hi: number; backCentre: number; backPark: number; fwdCentre: number; fwdPark: number };

/** The parts of [lo, hi] that none of `blocked` covers. */
function without(lo: number, hi: number, blocked: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = blocked.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of sorted) {
    if (b <= at) continue;
    if (a >= hi) break;
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([a, b]) => b - a > 1e-6);
}

/** A rectangle (s0, s1, t0, t1) with one hole cut out of it: up to four rectangles. */
function minus(r: Rect, h: Rect): Rect[] {
  const [s0, s1, t0, t1] = r;
  const [a0, a1, b0, b1] = h;
  if (a1 <= s0 || a0 >= s1 || b1 <= t0 || b0 >= t1) return [r];
  const out: Rect[] = [];
  if (a0 > s0) out.push([s0, a0, t0, t1]);
  if (a1 < s1) out.push([a1, s1, t0, t1]);
  const m0 = Math.max(s0, a0);
  const m1 = Math.min(s1, a1);
  if (b0 > t0) out.push([m0, m1, t0, Math.min(b0, t1)]);
  if (b1 < t1) out.push([m0, m1, Math.max(b1, t0), t1]);
  return out;
}

function cut(r: Rect, holes: readonly Rect[]): Rect[] {
  let pieces: Rect[] = [r];
  for (const h of holes) pieces = pieces.flatMap((p) => minus(p, h));
  return pieces.filter((p) => p[1] - p[0] > 1e-6 && p[3] - p[2] > 1e-6);
}

export function streetGeometry(g: TownGround, flat: Sink, solid: Sink = flat, detail: Detail = "full"): void {
  const { plan, anchor } = g;
  const surf = new Surface(g, flat);
  const road = new RoadSet(surf);
  /** The junctions' pavements alone: paint is laid without them (a neighbour's stop line does not run over this one's). */
  const pavements = new RoadSet(surf);
  const junctions = worldJunctions(g);
  const paved = junctions.filter(hasPavement);

  const prepared = new Map<number, PS>();
  for (const street of plan.streets) {
    if (street.kind === "highway" || street.kind === "rail" || street.kind === "stair") continue;
    const ax = anchor.x + street.a.x;
    const az = anchor.z + street.a.z;
    const bx = anchor.x + street.b.x;
    const bz = anchor.z + street.b.z;
    const length = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (!(length > 0.1)) continue;
    const tx = (bx - ax) / length;
    const tz = (bz - az) / length;
    const hw = street.width / 2;
    const cw = street.kind === "wharf" ? 0 : street.roadway / 2;
    const inner = cw + CURB_WIDTH;
    const verge = street.walk > 0 ? Math.max(0, hw - street.walk - inner) : 0;
    prepared.set(street.id, { street, ax, az, tx, tz, nx: -tz, nz: tx, length, cw, hw, walk: street.walk, verge: verge > 0.05 ? verge : 0 });
  }

  const at = (p: PS, s: number, t: number): P2 => [p.ax + p.tx * s + p.nx * t, p.az + p.tz * s + p.nz * t];

  /** A flat strip of a street: from `s0` to `s1` along it and `t0` to `t1` across it, cut every `TILE` m, at one lift; a roadway's tiles are laid without the ground a roadway laid before covers. */
  const strip = (p: PS, r: Rect, colour: Rgb, lift: number, roadway = false): void => {
    const [s0, s1, t0, t1] = r;
    const n = Math.max(1, Math.ceil((s1 - s0) / TILE));
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      const b = s0 + ((s1 - s0) * (i + 1)) / n;
      const quad = [at(p, a, t0), at(p, b, t0), at(p, b, t1), at(p, a, t1)];
      if (roadway) road.tile(quad, lift, colour);
      else surf.flat(quad, lift, colour);
    }
  };

  // ---- Where each street is cut: the junctions' legs on it, and the ramps' and aprons' holes in its bands.
  const spansOf = new Map<number, Span[]>();
  const sideBlocked = new Map<number, [number, number][][]>();
  const holes = new Map<number, Rect[][]>();
  for (const p of prepared.values()) {
    spansOf.set(p.street.id, []);
    sideBlocked.set(p.street.id, [[], []]);
    holes.set(p.street.id, [[], []]);
  }
  const sideIx = (sigma: number): number => (sigma > 0 ? 0 : 1);
  for (const j of paved) {
    const list: { leg: JunctionLeg; closed: boolean }[] = [...j.legs.map((leg) => ({ leg, closed: false })), ...j.closed.map((leg) => ({ leg, closed: true }))];
    for (const p of prepared.values()) {
      const mine = list.filter((m) => m.leg.street === p.street.id && !m.leg.engine);
      if (mine.length === 0) continue;
      let lo = 1e9;
      let hi = -1e9;
      let backCentre = -1e9;
      let backPark = -1e9;
      let fwdCentre = 1e9;
      let fwdPark = 1e9;
      const sideLo = [1e9, 1e9];
      const sideHi = [-1e9, -1e9];
      let hasFwd = false;
      let hasBack = false;
      for (const { leg: l, closed } of mine) {
        const so = (l.x - p.ax) * p.tx + (l.z - p.az) * p.tz;
        const fwd = l.dx * p.tx + l.dz * p.tz > 0;
        const band = (sigma: number): number => (closed ? l.mouth : fwd === sigma > 0 ? l.bandLeft : l.bandRight);
        if (fwd) {
          hasFwd = true;
          hi = Math.max(hi, so + l.mouth);
          fwdCentre = Math.min(fwdCentre, so + l.centreEnd);
          fwdPark = Math.min(fwdPark, so + l.mouth + l.holdBack);
          for (const sg of [1, -1]) sideHi[sideIx(sg)] = Math.max(sideHi[sideIx(sg)] as number, so + band(sg));
        } else {
          hasBack = true;
          lo = Math.min(lo, so - l.mouth);
          backCentre = Math.max(backCentre, so - l.centreEnd);
          backPark = Math.max(backPark, so - l.mouth - l.holdBack);
          for (const sg of [1, -1]) sideLo[sideIx(sg)] = Math.min(sideLo[sideIx(sg)] as number, so - band(sg));
        }
      }
      (spansOf.get(p.street.id) as Span[]).push({ lo: hasBack ? lo : -1e9, hi: hasFwd ? hi : 1e9, backCentre, backPark, fwdCentre, fwdPark });
      for (const sg of [1, -1]) {
        (sideBlocked.get(p.street.id) as [number, number][][])[sideIx(sg)]!.push([hasBack ? (sideLo[sideIx(sg)] as number) : -1e9, hasFwd ? (sideHi[sideIx(sg)] as number) : 1e9]);
      }
      // Each ramp of this junction on this street: a hole in the verge, sidewalk and curb.
      for (const r of j.ramp) {
        const l = j.legs[r.leg] as JunctionLeg;
        if (l.street !== p.street.id) continue;
        const so = (l.x - p.ax) * p.tx + (l.z - p.az) * p.tz;
        const fwd = l.dx * p.tx + l.dz * p.tz > 0;
        const sigma = fwd ? r.side : -r.side;
        const s0 = fwd ? so + r.s0 : so - r.s1;
        const s1 = fwd ? so + r.s1 : so - r.s0;
        const reach = p.cw + RAMP_RUN + RAMP_LANDING;
        (holes.get(p.street.id) as Rect[][])[sideIx(sigma)]!.push([s0, s1, sigma > 0 ? p.cw : -reach, sigma > 0 ? reach : -p.cw]);
      }
    }
  }
  // Alleys' mouths: the apron's opening in the curb, verge and sidewalk.
  const apronsOf: { p: PS; s: number; sigma: number; width: number; depth: number }[] = [];
  for (const j of junctions) {
    if (j.kind !== "alley" || j.alley === null) continue;
    const p = prepared.get(j.alley.street);
    if (p === undefined) continue;
    const s = (j.legs[0]!.x - p.ax) * p.tx + (j.legs[0]!.z - p.az) * p.tz;
    const sigma = j.alley.dx * p.nx + j.alley.dz * p.nz > 0 ? 1 : -1;
    const depth = p.verge > 0.5 ? p.verge : CURB_FACE / 0.083;
    const half = j.alley.width / 2 + APRON_FLARE;
    (holes.get(p.street.id) as Rect[][])[sideIx(sigma)]!.push([s - half, s + half, sigma > 0 ? p.cw : -(p.cw + depth + 0.0), sigma > 0 ? p.cw + depth : -p.cw]);
    apronsOf.push({ p, s, sigma, width: j.alley.width, depth });
  }

  /** The curb's gaps along a side: the ramps' and the aprons' s-ranges. */
  const curbGaps = (p: PS, sigma: number): [number, number][] => (holes.get(p.street.id) as Rect[][])[sideIx(sigma)]!.map((h): [number, number] => [h[0], h[1]]);

  // The junctions' pavements first: they keep their ground, and the roadways laid after them leave it.
  junctionGeometry(g, surf, solid, paved, road, pavements);

  // ---- The streets.
  for (const p of prepared.values()) {
    const { street } = p;
    if (street.kind === "wharf") {
      for (const [t0, t1] of [[-p.hw, 0], [0, p.hw]] as const) {
        const n = Math.max(1, Math.ceil(p.length / TILE));
        for (let i = 0; i < n; i++) {
          const corners = [at(p, (i / n) * p.length, t0), at(p, ((i + 1) / n) * p.length, t0), at(p, ((i + 1) / n) * p.length, t1), at(p, (i / n) * p.length, t1)];
          const pts: Vec3[] = corners.map(([x, z]) => [x, Math.max(g.heightAt(x, z) + STREET_LIFT, g.deckAt(x, z)), z]);
          const c = corners[0] as P2;
          solid(c[0], c[1]).poly(pts, [0, 1, 0], DECK);
        }
      }
      continue;
    }
    if (street.kind === "alley") {
      alleyGeometry(p);
      continue;
    }
    const spans = spansOf.get(street.id) as Span[];
    const blocked = spans.map((s): [number, number] => [s.lo, s.hi]);
    const roadIntervals = without(0, p.length, blocked);
    for (const [a, b] of roadIntervals) {
      strip(p, [a, b, -p.cw, 0], ASPHALT, ROADWAY_LIFT, true);
      strip(p, [a, b, 0, p.cw], ASPHALT, ROADWAY_LIFT, true);
    }
    const inner = p.cw + CURB_WIDTH;
    for (const sg of [1, -1]) {
      const sideBand = (sideBlocked.get(street.id) as [number, number][][])[sideIx(sg)] as [number, number][];
      const hs = (holes.get(street.id) as Rect[][])[sideIx(sg)] as Rect[];
      const lat = (u0: number, u1: number): [number, number] => (sg > 0 ? [u0, u1] : [-u1, -u0]);
      for (const [a, b] of without(0, p.length, sideBand)) {
        if (p.walk > 0) {
          const [c0, c1] = lat(p.cw, inner);
          for (const r of cut([a, b, c0, c1], hs)) strip(p, r, CURB, WALK_LIFT);
          if (p.verge > 0) {
            const [v0, v1] = lat(inner, inner + p.verge);
            for (const r of cut([a, b, v0, v1], hs)) strip(p, r, VERGE, VERGE_LIFT);
          }
          const [w0, w1] = lat(p.hw - p.walk, p.hw);
          const [x0, x1] = lat(Math.max(inner, p.hw - p.walk), p.hw);
          void w0;
          void w1;
          for (const r of cut([a, b, x0, x1], hs)) strip(p, r, SIDEWALK, WALK_LIFT);
          // The curb's face down to the roadway, looking over it, and the sidewalk's outer edge down to the ground.
          for (const [fa, fb] of without(a, b, curbGaps(p, sg))) {
            const m = Math.max(1, Math.ceil((fb - fa) / TILE));
            for (let i = 0; i < m; i++) {
              const s0 = fa + ((fb - fa) * i) / m;
              const s1 = fa + ((fb - fa) * (i + 1)) / m;
              surf.face(at(p, s0, sg * p.cw), at(p, s1, sg * p.cw), ROADWAY_LIFT, WALK_LIFT, [-sg * p.nx, -sg * p.nz], CURB);
            }
          }
          const m = Math.max(1, Math.ceil((b - a) / TILE));
          for (let i = 0; i < m; i++) {
            const s0 = a + ((b - a) * i) / m;
            const s1 = a + ((b - a) * (i + 1)) / m;
            surf.face(at(p, s0, sg * p.hw), at(p, s1, sg * p.hw), SKIRT_FOOT, WALK_LIFT, [sg * p.nx, sg * p.nz], CURB);
          }
        }
      }
    }
    streetPaint(p, spans, roadIntervals);
  }

  // ---- Aprons: the driveway aprons across the verge, each with its flared wings.
  for (const { p, s, sigma, width, depth } of apronsOf) {
    const half = width / 2;
    const f = APRON_FLARE;
    const t0 = sigma * p.cw;
    const t1 = sigma * (p.cw + depth);
    const lip = ROADWAY_LIFT + APRON_LIP;
    const pt = (ss: number, t: number, lift: number): P3 => {
      const q = at(p, ss, t);
      return [q[0], q[1], lift];
    };
    // The apron's middle, sloping from the lip at the gutter up to the sidewalk's height.
    surf.poly([pt(s - half, t0, lip), pt(s + half, t0, lip), pt(s + half, t1, WALK_LIFT), pt(s - half, t1, WALK_LIFT)], SIDEWALK);
    // Each wing: the flare, a triangle from the apron's edge at the gutter up to the curb's full height.
    for (const e of [-1, 1]) {
      surf.poly([pt(s + e * half, t0, lip), pt(s + e * (half + f), t0, WALK_LIFT), pt(s + e * half, t1, WALK_LIFT)], SIDEWALK);
      surf.poly([pt(s + e * (half + f), t0, WALK_LIFT), pt(s + e * (half + f), t1, WALK_LIFT), pt(s + e * half, t1, WALK_LIFT)], SIDEWALK);
    }
  }

  // ---- An alley: gravel, risen to the sidewalk's height where it meets a street.
  function alleyGeometry(p: PS): void {
    const mouths = junctions.filter((j) => j.kind === "alley" && j.legs[2]!.street === p.street.id);
    // The alley's own two ends: the one nearer each mouth is where its gravel rises; the end carries on to the street's lot line.
    const lifts = (s: number): number => {
      let lift = ROADWAY_LIFT;
      for (const m of mouths) {
        const e = m.legs[2] as JunctionLeg;
        const sm = (e.x - p.ax) * p.tx + (e.z - p.az) * p.tz;
        const d = Math.abs(s - sm);
        if (d < ALLEY_RISE) lift = Math.max(lift, WALK_LIFT - ((WALK_LIFT - ROADWAY_LIFT) * d) / ALLEY_RISE);
      }
      return lift;
    };
    // Along the alley, from its end (or the lot line it is carried out to) to its other end.
    let a = 0;
    let b = p.length;
    for (const m of mouths) {
      const e = m.legs[2] as JunctionLeg;
      const sm = (e.x - p.ax) * p.tx + (e.z - p.az) * p.tz;
      if (sm < p.length / 2) a = Math.min(a, sm);
      else b = Math.max(b, sm);
    }
    const stations: number[] = [a];
    const n = Math.max(1, Math.ceil((b - a) / TILE));
    for (let i = 1; i < n; i++) stations.push(a + ((b - a) * i) / n);
    stations.push(b);
    for (const m of mouths) {
      const e = m.legs[2] as JunctionLeg;
      const sm = (e.x - p.ax) * p.tx + (e.z - p.az) * p.tz;
      stations.push(sm + (sm < p.length / 2 ? ALLEY_RISE : -ALLEY_RISE));
    }
    stations.sort((x, y) => x - y);
    for (let i = 0; i + 1 < stations.length; i++) {
      const s0 = stations[i] as number;
      const s1 = stations[i + 1] as number;
      if (s1 - s0 < 1e-3) continue;
      const y0 = lifts(s0);
      const y1 = lifts(s1);
      const l0 = at(p, s0, -p.cw);
      const l1 = at(p, s1, -p.cw);
      const r1 = at(p, s1, p.cw);
      const r0 = at(p, s0, p.cw);
      surf.poly([[l0[0], l0[1], y0], [l1[0], l1[1], y1], [r1[0], r1[1], y1], [r0[0], r0[1], y0]], ALLEY);
    }
  }

  // ---- The paint along a street: the main street's centre line and parking, the avenue's median.
  function streetPaint(p: PS, spans: readonly Span[], roadIntervals: readonly [number, number][]): void {
    const kind = p.street.kind;
    if (kind !== "main" && kind !== "avenue") return;
    const lift = ROADWAY_LIFT + MARK_OVER;
    for (const [a, b] of roadIntervals) {
      // Where the paint may begin and end: short of the crossing at each junction end.
      const start = spans.filter((s) => Math.abs(s.hi - a) < 1e-6);
      const end = spans.filter((s) => Math.abs(s.lo - b) < 1e-6);
      const ca = start.length > 0 ? Math.max(a, ...start.map((s) => s.fwdCentre)) : a;
      const cb = end.length > 0 ? Math.min(b, ...end.map((s) => s.backCentre)) : b;
      if (cb - ca > 0.2) {
        if (kind === "main") {
          // Dashes, 10 ft with 30 ft gaps, spread so they begin and end even.
          const run = cb - ca;
          const count = Math.max(1, Math.floor((run + CENTRE_GAP) / (CENTRE_DASH + CENTRE_GAP)));
          const used = count * CENTRE_DASH + (count - 1) * CENTRE_GAP;
          let s = ca + (run - used) / 2;
          for (let k = 0; k < count; k++, s += CENTRE_DASH + CENTRE_GAP) strip(p, [Math.max(ca, s), Math.min(cb, s + CENTRE_DASH), -CENTRE_WIDTH / 2, CENTRE_WIDTH / 2], PAINT_YELLOW, lift);
        } else {
          // The avenue's median: a band between two solid yellow lines, ended short of the crossing.
          strip(p, [ca, cb, -MEDIAN_WIDTH / 2, MEDIAN_WIDTH / 2], MEDIAN, lift);
          for (const t of [-MEDIAN_WIDTH / 2, MEDIAN_WIDTH / 2]) strip(p, [ca, cb, t - LINE_WIDTH / 2, t + LINE_WIDTH / 2], PAINT_YELLOW, lift + 0.002);
        }
      }
      if (kind !== "main") continue;
      // Parking along both curbs, held back from the crossings (20 ft from a crosswalk, 30 ft from a STOP sign).
      const pa = start.length > 0 ? Math.max(a, ...start.map((s) => s.fwdPark)) : a;
      const pb = end.length > 0 ? Math.min(b, ...end.map((s) => s.backPark)) : b;
      if (pb - pa < PARKING_STALL * 0.5) continue;
      for (const sg of [1, -1]) {
        const edge = sg * (p.cw - PARKING_LANE);
        const lo = Math.min(edge, sg * p.cw);
        const hi = Math.max(edge, sg * p.cw);
        strip(p, [pa, pb, edge - LINE_WIDTH / 2, edge + LINE_WIDTH / 2], PAINT_WHITE, lift);
        const stalls = Math.max(1, Math.round((pb - pa) / PARKING_STALL));
        for (let k = 0; k <= stalls; k++) {
          const s = pa + ((pb - pa) * k) / stalls;
          strip(p, [Math.max(pa, s - LINE_WIDTH / 2), Math.min(pb, s + LINE_WIDTH / 2), lo, hi], PAINT_WHITE, lift);
        }
      }
    }
  }

  // ---- Everything at the junctions.
  junctionPaint(g, surf, junctions, pavements);
  signGeometry(g, surf, solid, junctions, detail);
}
