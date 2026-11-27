/**
 * The town's streets as flat surfaces that follow the ground: every street of the plan but the highway (which the town paves on its bed
 * through the town: `highwayGeometry.ts`). A street is a roadway of `street.roadway` between curbs and, down each side, what that side
 * of the street has (`plan.edges`, `port/edges.ts`): a curb and a sidewalk of slabs (`walkGeometry.ts`), or no curb and a ragged
 * asphalt edge against a gravel shoulder; an alley is two wheel tracks of gravel with grass between; the wharf is a timber deck.
 *
 * - **The ground is cut for the roadway** (`sim/town/streetField.ts`): the roadway lies the curb's height (15 cm, 5 to 10 where overlays
 *   buried the old curb, none where there is no curb) under the lots' level, and the sidewalk, the verge and the lawns keep the lots'
 *   level. Every surface here is the ground's height (the walked surface: terrain plus the trough's fill) plus a lift of a centimetre or
 *   so: the roadway `ROADWAY_LIFT`, the curb's top and the sidewalk `WALK_LIFT`, the curb's top laid at the lots' level (read a quarter
 *   metre beyond the curb line, where the ground has come up) over a face down to the gutter.
 * - **The legs' strips end on the junction.** A street is cut where it meets another: its roadway strip ends at each junction's
 *   mouth (`sim/town/junctions.ts`), its verge, sidewalk and curb at the corner's tangent point, and the pavement between is the
 *   junction's, bounded by its curb returns (`junctionGeometry.ts`).
 * - **The roadway is laid in the stretches the plan gives it** (`Paving`): each its own asphalt (the new, dark layer after 2000, else
 *   the old, cracked one, with a tone of its own), a seam across the roadway between them, its texture running along the street.
 *   A side with no curb ends its asphalt in a ragged edge that wanders by 10 to 20 cm and bites out here and there, against a gravel
 *   shoulder 0.9 to 1.6 m wide with its own ragged edge, and a ditch beyond it where the plan has one.
 * - **Wear** (`roadWear.ts`): utility cuts, sealed cracks, potholes, the band of needles and dirt in the gutter, gravel tracked on from
 *   alley mouths, manhole covers and storm drains.
 * - **Paint**: the main street has a dashed yellow centre line (10 ft dashes with 30 ft gaps, ending short of every crossing) and
 *   white parking stalls held back from corners; the avenue a painted median between solid yellow lines. A residential street
 *   has none. Paint is worn: some dashes short, some gone, the rest faded by the street's use. The marks at a junction are `junctionPaint.ts`'s.
 * - Ground under the sea is not drawn. A tile that reaches into the highway's bed is cut along the bed's edge, where the highway's paving meets it.
 */
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { ASPHALT, CURB, DECK, GRAVEL, MEDIAN, PAINT_WHITE, PAINT_YELLOW, PATCH_ASPHALT, SIDEWALK } from "./palette.js";
import { clamp01, hashN, hashS, smooth, vnoise } from "./groundNoise.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { junctionWear, roadWear } from "./roadWear.js";
import { walkSide, type SideFrame } from "./walkGeometry.js";
import { highwayGeometry } from "./highwayGeometry.js";
import { junctionGeometry } from "./junctionGeometry.js";
import { junctionPaint } from "./junctionPaint.js";
import { worldJunctions } from "./junctionWorld.js";
import { signGeometry } from "./signGeometry.js";
import { RoadSet, Surface, type P2, type P3 } from "./surface.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";
import { RAMP_RUN, RAMP_LANDING, CURB_FACE } from "../../sim/town/junctionShape.js";
import { hasPavement } from "../../sim/town/junctions.js";
import { lotIdAt } from "../../sim/town/lotIndex.js";
import { CURB_OUT } from "../../sim/town/streetField.js";
import type { JunctionLeg, Paving, SideEdge, Street, StreetEdge, YardKind } from "../../sim/town/types.js";


/** A strip is cut along its length at least this often, metres. */
export const TILE = 4;
/** The lift of a verge's base over the ground, metres; a roadway lies `ASPHALT_OVER` more. */
export const STREET_LIFT = 0.024;
/** Every roadway's lift over the ground (which is already cut down by the curb's height: `sim/town/streetField.ts`), the junctions' pavements and the legs alike. */
export const ROADWAY_LIFT = 0.012;
/**
 * How far over the ground a surface lies where the terrain under it is not cut down (a shoulder's outer edge, an alley's wheel tracks): the
 * terrain is drawn as an upper envelope of the ground, a few centimetres over it wherever it bends, so a surface lying millimetres over
 * uncut ground is under the drawn terrain in places, and shows only from where the flat layer's depth lead (which grows with distance) is
 * more than the terrain stands over it: it comes and goes as one walks. The yards' surfaces lie this far over theirs (`yardGeometry.ts`).
 */
export const OPEN_GROUND_LIFT = 0.04;
/** How far out of the asphalt's edge a shoulder still lies under the asphalt's level, metres: within the cut the terrain has under a roadway. */
const SHOULDER_UNDER = 0.1;
/** The curb's top and the sidewalk's lie this much over the ground at the lots' level, so a sidewalk is level with the lot behind it. */
export const WALK_LIFT = 0.012;
/** The curb's width. */
export const CURB_WIDTH = 0.18;
/** The curb's face as a constant, for the ramps' length (the research's 6 in); the face drawn is the street's own curb height. */
export const CURB_RISE = CURB_FACE;
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


/** A street's frame in the world, as the builders here use it (and `walkGeometry.ts`, `roadWear.ts`). */
export type PS = {
  street: Street;
  edge: StreetEdge;
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
};

type Rect = [number, number, number, number];
type Span = { lo: number; hi: number; backCentre: number; backPark: number; fwdCentre: number; fwdPark: number };

/** The curb top's lift when the ground beside the curb has come up: the lots' level is read this far past the curb line. */
const CURB_LEVEL = CURB_OUT + 0.01;
/** The asphalt of a stretch: the new layer after 2000 and under half worn, else the old one. */
export function asphaltOf(pv: Paving, sf: number): { layer: "asphalt" | "asphalt_dark"; tint: Rgb } {
  const fresh = pv.decade >= 2000 && pv.wear < 0.5;
  return fresh ? { layer: "asphalt_dark", tint: [1.15 * sf, 1.15 * sf, 1.15 * sf] } : { layer: "asphalt", tint: [sf, sf, sf * 0.98] };
}

/** What a stretch of roadway is made of: its asphalt, its tone, its texture's frame and the dirt and wear that gather toward the gutters. Shared with the wheel tracks (`roadTone.ts`), which must have the roadway's own look at their edges so no edge shows. */
export function roadwayLook(p: PS, pv: Paving, ix: number, key: number): Over & { tint: Rgb; layer: "asphalt" | "asphalt_dark" } {
  const sf = 0.78 + 0.5 * hashN(key, ix, 0, 1);
  const { layer, tint } = asphaltOf(pv, sf);
  const use = p.edge.use;
  // The texture runs along the street (its cracks do), shifted by a roll of the stretch's own.
  const frame = { origin: [p.ax + hashN(key, ix, 0, 2) * 5, 0, p.az + hashN(key, ix, 0, 3) * 5] as Vec3, u: [p.nx, 0, p.nz] as Vec3, v: [p.tx, 0, p.tz] as Vec3 };
  const across = (q: readonly [number, number, number]): number => Math.abs((q[0] - p.ax) * p.nx + (q[2] - p.az) * p.nz) / p.cw;
  // Dirt gathers toward the gutters, the more where the stretch is worn and the street little used; the middle is cleaner where the wheels go.
  const dirt = (q: readonly [number, number, number]): number => clamp01(0.02 + 0.08 * pv.wear + (0.1 + 0.25 * (1 - use * 0.6)) * smooth(0.55, 1, across(q)));
  const wear = (q: readonly [number, number, number]): number => clamp01((0.02 + 0.12 * pv.wear * (1 - use * 0.5)) * smooth(0.6, 1.05, across(q)));
  return { layer, tint, frame, dirt, wear };
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
    const edge = plan.edges[street.id];
    if (edge === undefined) continue;
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
    prepared.set(street.id, { street, edge, ax, az, tx, tz, nx: -tz, nz: tx, length, cw, hw, walk: street.walk });
  }

  const at = (p: PS, s: number, t: number): P2 => [p.ax + p.tx * s + p.nx * t, p.az + p.tz * s + p.nz * t];
  /** The roadway's height at (s, t) with its lift: the walked surface where the roadway is whole (the cut reaches the curb line). */
  const roadY = (p: PS, s: number, t: number, lift = ROADWAY_LIFT): number => {
    const q = at(p, s, t);
    return g.heightAt(q[0], q[1]) + lift;
  };
  /** The lots' level at (s, t) beside a curb: read at least `CURB_LEVEL` past the curb line. */
  const topY = (p: PS, s: number, sg: number, t: number, lift = WALK_LIFT): number => {
    const q = at(p, s, sg * Math.max(t, p.cw + CURB_LEVEL));
    return g.heightAt(q[0], q[1]) + lift;
  };

  /** A flat strip of a street: from `s0` to `s1` along it and `t0` to `t1` across it, cut every `tile` m, at one lift; a roadway's tiles are laid without the ground a roadway laid before covers. */
  const strip = (p: PS, r: Rect, colour: Rgb, lift: number, roadway = false, over?: Over, tile = TILE): void => {
    const [s0, s1, t0, t1] = r;
    const n = Math.max(1, Math.ceil((s1 - s0) / tile));
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      const b = s0 + ((s1 - s0) * (i + 1)) / n;
      const quad = [at(p, a, t0), at(p, b, t0), at(p, b, t1), at(p, a, t1)];
      if (roadway) road.tile(quad, lift, colour, over);
      else surf.flat(quad, lift, colour, over);
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
      // Each ramp of this junction on this street: a hole in the curb and the sidewalk.
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
  // Alleys' mouths: the apron's opening in the curb (and the sidewalk, where the verge is no wider than the apron).
  const apronsOf: { p: PS; s: number; sigma: number; width: number; depth: number }[] = [];
  for (const j of junctions) {
    if (j.kind !== "alley" || j.alley === null) continue;
    const p = prepared.get(j.alley.street);
    if (p === undefined) continue;
    const s = (j.legs[0]!.x - p.ax) * p.tx + (j.legs[0]!.z - p.az) * p.tz;
    const sigma = j.alley.dx * p.nx + j.alley.dz * p.nz > 0 ? 1 : -1;
    const side = p.edge.sides[sideIx(sigma)] as SideEdge;
    const depth = side.curb ? (side.verge > 0.5 ? side.verge : 1.8) : 0;
    const half = j.alley.width / 2 + APRON_FLARE;
    if (side.curb) (holes.get(p.street.id) as Rect[][])[sideIx(sigma)]!.push([s - half, s + half, sigma > 0 ? p.cw : -(p.cw + depth), sigma > 0 ? p.cw + depth : -p.cw]);
    apronsOf.push({ p, s, sigma, width: j.alley.width, depth });
  }

  // The junctions' pavements first: they keep their ground, and the roadways laid after them leave it.
  junctionGeometry(g, surf, solid, paved, road, pavements);
  // The highway between its first street and its last, paved on its bed (the streets that end on it are cut off the bed, so they meet it).
  highwayGeometry(g, surf, junctions);

  // ---- The streets.
  for (const p of prepared.values()) {
    const { street } = p;
    if (street.kind === "wharf") {
      for (const [t0, t1] of [[-p.hw, 0], [0, p.hw]] as const) {
        const n = Math.max(1, Math.ceil(p.length / TILE));
        for (let i = 0; i < n; i++) {
          const corners = [at(p, (i / n) * p.length, t0), at(p, ((i + 1) / n) * p.length, t0), at(p, ((i + 1) / n) * p.length, t1), at(p, (i / n) * p.length, t1)];
          const pts: Vec3[] = corners.map(([x, z]) => [x, Math.max(g.heightAt(x, z) + 0.06, g.deckAt(x, z)), z]);
          const c = corners[0] as P2;
          solid(c[0], c[1]).poly(pts, [0, 1, 0], DECK, "wood", { back: { colour: [0.2, 0.19, 0.18] } });
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
    const key = Math.imul(street.id + 1, 40503);
    // The roadway, in the stretches it was paved in.
    for (const [a, b] of roadIntervals) {
      p.edge.paving.forEach((pv, ix) => {
        const lo = Math.max(a, pv.s0);
        const hi = Math.min(b, pv.s1);
        if (hi - lo < 0.04) return;
        roadway(p, lo, hi, pv, ix, key);
      });
    }
    // The seams between stretches: a dark line across the roadway where the old surface meets the new.
    p.edge.paving.forEach((pv, ix) => {
      if (ix === 0) return;
      for (const [a, b] of roadIntervals) if (pv.s0 > a + 0.3 && pv.s0 < b - 0.3) seam(p, pv.s0, key + ix);
    });
    for (const sg of [1, -1]) {
      const k = sideIx(sg);
      const side = p.edge.sides[k] as SideEdge;
      const sideBand = (sideBlocked.get(street.id) as [number, number][][])[k] as [number, number][];
      const hs = (holes.get(street.id) as Rect[][])[k] as Rect[];
      const lat = (u0: number, u1: number): [number, number] => (sg > 0 ? [u0, u1] : [-u1, -u0]);
      const sideKey = key ^ (sg > 0 ? 0x1f : 0x2e);
      for (const [a, b] of without(0, p.length, sideBand)) {
        if (side.curb) {
          // The curb: its top at the lots' level, in sections of about 3 m (poured as they were, some replaced), and its face down to the gutter.
          const [c0, c1] = lat(p.cw, p.cw + CURB_WIDTH);
          for (const r of cut([a, b, c0, c1], hs)) curbSections(p, sg, r[0], r[1], sideKey);
        } else {
          shoulder(p, sg, a, b, side, sideKey);
        }
        // The sidewalk: the runs of this side between the junctions' corners and the ramps and aprons that cross it.
        if (side.runs.length > 0) {
          const inner = p.hw - p.walk;
          const free = without(a, b, hs.filter((h) => Math.max(Math.abs(h[2]), Math.abs(h[3])) > inner && Math.min(Math.abs(h[2]), Math.abs(h[3])) < p.hw).map((h): [number, number] => [h[0], h[1]]));
          const frame: SideFrame = { id: street.id, ax: p.ax, az: p.az, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz, cw: p.cw, hw: p.hw, walk: p.walk };
          walkSide(
            {
              surf,
              frame,
              sigma: sg as 1 | -1,
              side,
              yardKindAt: (s) => yardKindAt(p, sg, s),
              plan,
              use: p.edge.use,
              low: detail === "low",
            },
            free,
            (x, z) => g.heightAt(x, z),
            inner,
          );
        }
      }
    }
    // The wear first, so the paint is laid over the cracks and cuts it crosses (a mark laid later is the one on top).
    roadWear({ g, surf, road, p, plan, intervals: roadIntervals, junctions, key, detail });
    streetPaint(p, spans, roadIntervals);
  }

  /** The yard kind of the lot beside a side of a street at `s`: a point 4 m past the right of way's edge. */
  function yardKindAt(p: PS, sg: number, s: number): YardKind | null {
    const q = at(p, s, sg * (p.hw + 4));
    const id = lotIdAt(plan, q[0] - anchor.x, q[1] - anchor.z);
    if (id < 0) return null;
    return plan.yards[id]?.kind ?? null;
  }

  /** The roadway of one stretch of paving, from `a` to `b`: bands across, the outer one at each side ragged where there is no curb. */
  function roadway(p: PS, a: number, b: number, pv: Paving, ix: number, key: number): void {
    const over: Over = roadwayLook(p, pv, ix, key);
    for (const sg of [1, -1]) {
      const side = p.edge.sides[sideIx(sg)] as SideEdge;
      const lat = (u0: number, u1: number): [number, number] => (sg > 0 ? [u0, u1] : [-u1, -u0]);
      const [i0, i1] = lat(0, p.cw * 0.5);
      const [m0, m1] = lat(p.cw * 0.5, p.cw - 0.9);
      strip(p, [a, b, i0, i1], ASPHALT, ROADWAY_LIFT, true, over);
      strip(p, [a, b, m0, m1], ASPHALT, ROADWAY_LIFT, true, over);
      const t0 = p.cw - 0.9;
      if (side.curb) {
        const [o0, o1] = lat(t0, p.cw);
        strip(p, [a, b, o0, o1], ASPHALT, ROADWAY_LIFT, true, over);
        continue;
      }
      // No curb: the outer band ends in an edge that wanders, in stations of 2 m.
      const sideKey = key ^ (sg > 0 ? 0x11 : 0x22);
      const n = Math.max(1, Math.ceil((b - a) / 2));
      for (let i = 0; i < n; i++) {
        const s0 = a + ((b - a) * i) / n;
        const s1 = a + ((b - a) * (i + 1)) / n;
        const e0 = edgeOffset(p, sideKey, s0, pv);
        const e1 = edgeOffset(p, sideKey, s1, pv);
        const q = (s: number, t: number): P2 => at(p, s, sg * t);
        road.tile([q(s0, t0), q(s1, t0), q(s1, p.cw + e1), q(s0, p.cw + e0)], ROADWAY_LIFT, ASPHALT, over);
      }
    }
  }

  /** How far the asphalt's edge stands out from the nominal line at `s` where there is no curb: -0.14 to +0.18 m, bitten in where the stretch is worn. */
  function edgeOffset(p: PS, key: number, s: number, pv: Paving): number {
    const slow = vnoise(key, s, 7) - 0.45;
    const fine = hashS(key, Math.floor(s / 2), 0, 3);
    const bite = hashN(key, Math.floor(s / 2), 0, 4) < 0.12 * pv.wear ? -0.12 : 0;
    return Math.max(-0.2, Math.min(0.22, slow * 0.34 + fine * 0.05 + bite));
  }

  /** A seam across the roadway: a dark band 5 cm wide with a jog or two, where one paving ends and the next begins. */
  function seam(p: PS, s: number, key: number): void {
    const over: Over = { layer: "asphalt_dark", tint: [0.5, 0.5, 0.5], frame: { origin: [p.ax, 0, p.az], u: [p.nx, 0, p.nz], v: [p.tx, 0, p.tz] } };
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t0 = -p.cw + (2 * p.cw * i) / n;
      const t1 = -p.cw + (2 * p.cw * (i + 1)) / n;
      const j0 = 0.06 * hashS(key, i, 0, 5);
      const j1 = 0.06 * hashS(key, i + 1, 0, 5);
      const w = 0.03 + 0.02 * hashN(key, i, 0, 6);
      const quad = [at(p, s + j0 - w, t0), at(p, s + j0 + w, t0), at(p, s + j1 + w, t1), at(p, s + j1 - w, t1)];
      surf.flat(quad, ROADWAY_LIFT + 0.002, PATCH_ASPHALT, { ...over, rank: RANK.mark });
    }
  }

  /** The curb along [a, b] of a side, in sections of 2.6 to 3.4 m: each poured by itself, with its tone and its dirt, and its face down to the gutter. */
  function curbSections(p: PS, sg: number, a: number, b: number, key: number): void {
    const n = Math.max(1, Math.round((b - a) / 3));
    for (let i = 0; i < n; i++) {
      const s0 = a + ((b - a) * i) / n;
      const s1 = a + ((b - a) * (i + 1)) / n;
      const roll = hashN(key, Math.floor(s0 * 2), 0, 7);
      const replaced = roll < 0.07;
      const sh = (0.6 + 0.3 * hashN(key, Math.floor(s0 * 2), 0, 8)) * (replaced ? 1.3 : 1);
      // Some sections are painted, long ago: a faded yellow (no parking), a faded red (a hydrant's), worn back to the concrete at the edges by the noise.
      const painted = hashN(key, Math.floor(s0 * 2), 0, 11);
      const tint: Rgb = painted < 0.1 ? [sh * 1.55, sh * 1.25, sh * 0.35] : painted < 0.15 ? [sh * 1.45, sh * 0.55, sh * 0.45] : [sh * 0.98, sh * 0.97, sh * 0.92];
      const frame = { origin: [p.ax + hashN(key, Math.floor(s0 * 2), 0, 9) * 3, 0, p.az + hashN(key, Math.floor(s0 * 2), 0, 10) * 3] as Vec3, u: [p.tx, 0, p.tz] as Vec3, v: [p.nx, 0, p.nz] as Vec3 };
      const top: Over = { rank: RANK.mark, layer: "sidewalk", tint, frame, wear: replaced ? 0.02 : 0.12, dirt: replaced ? 0.05 : 0.28 };
      const q = (s: number, t: number): P2 => at(p, s, sg * t);
      const y0 = topY(p, s0, sg, p.cw);
      const y1 = topY(p, s1, sg, p.cw);
      surf.polyY([[...q(s0, p.cw), y0], [...q(s1, p.cw), y1], [...q(s1, p.cw + CURB_WIDTH), y1], [...q(s0, p.cw + CURB_WIDTH), y0]] as P3[], CURB, top);
      // The face, looking over the roadway; its foot is the gutter, which is dirtier.
      const fb0 = roadY(p, s0, sg * p.cw);
      const fb1 = roadY(p, s1, sg * p.cw);
      if (y0 - fb0 > 0.01 || y1 - fb1 > 0.01) {
        const faceOver: Over = { layer: "sidewalk", tint: [tint[0] * 0.92, tint[1] * 0.92, tint[2] * 0.9], frame: { origin: [p.ax, 0, p.az], u: [p.tx, 0, p.tz], v: [0, 1, 0] }, wear: 0.1, dirt: (v) => clamp01(0.55 - (v[1] - Math.min(fb0, fb1)) * 4.5) };
        surf.faceY(q(s0, p.cw), q(s1, p.cw), fb0, y0, fb1, y1, [-sg * p.nx, -sg * p.nz], CURB, faceOver);
      }
    }
  }

  /** A side with no curb: the gravel shoulder, 0.9 to 1.6 m wide, from under the asphalt's edge to its own ragged edge. */
  function shoulder(p: PS, sg: number, a: number, b: number, side: SideEdge, key: number): void {
    const sideKey = key ^ 0x44;
    const pvOf = (s: number): Paving => p.edge.paving.find((q) => s < q.s1) ?? (p.edge.paving[p.edge.paving.length - 1] as Paving);
    const n = Math.max(1, Math.ceil((b - a) / 2));
    const frame = { origin: [p.ax + hashN(sideKey, 0, 0, 2) * 5, 0, p.az + hashN(sideKey, 0, 0, 3) * 5] as Vec3, u: [p.tx, 0, p.tz] as Vec3, v: [p.nx, 0, p.nz] as Vec3 };
    const lat = (q: readonly [number, number, number]): number => Math.abs((q[0] - p.ax) * p.nx + (q[2] - p.az) * p.nz);
    for (let i = 0; i < n; i++) {
      const s0 = a + ((b - a) * i) / n;
      const s1 = a + ((b - a) * (i + 1)) / n;
      // The asphalt's own edge (the same offsets as the roadway's, so they meet) and the shoulder's outer edge.
      const e0 = edgeOffset(p, key ^ (sg > 0 ? 0x11 : 0x22), s0, pvOf(s0));
      const e1 = edgeOffset(p, key ^ (sg > 0 ? 0x11 : 0x22), s1, pvOf(s1));
      const w = side.verge;
      const o0 = p.cw + w * (0.75 + 0.5 * vnoise(sideKey, s0, 5)) + 0.12 * hashS(sideKey, Math.floor(s0 / 2), 0, 3);
      const o1 = p.cw + w * (0.75 + 0.5 * vnoise(sideKey, s1, 5)) + 0.12 * hashS(sideKey, Math.floor(s1 / 2), 0, 3);
      const edge = p.cw + 0.04;
      const q = (s: number, t: number): P2 => at(p, s, sg * t);
      const dirt = (v: readonly [number, number, number]): number => clamp01(0.18 + 0.7 * smooth(p.cw, p.cw + w, lat(v)));
      const wear = (v: readonly [number, number, number]): number => clamp01(0.05 + 0.35 * smooth(p.cw + 0.3, p.cw + w, lat(v)));
      // Two strips. The inner, from 8 cm under the asphalt's edge to a hand's breadth out of it, lies under the asphalt (the terrain is cut down under
      // the roadway and a little beyond). The outer rises from there to `OPEN_GROUND_LIFT` at the shoulder's own edge, where the terrain is not cut.
      const over: Over = { layer: "gravel", rank: RANK.under, group: "shoulder", tint: [0.95, 0.9, 0.82], frame, dirt, wear };
      const low = ROADWAY_LIFT - 0.004;
      const m0 = Math.min(edge + e0 + SHOULDER_UNDER, o0);
      const m1 = Math.min(edge + e1 + SHOULDER_UNDER, o1);
      surf.flat([q(s0, edge + e0 - 0.08), q(s1, edge + e1 - 0.08), q(s1, m1), q(s0, m0)], low, GRAVEL, over);
      const c = (pt: P2, lift: number): P3 => [pt[0], pt[1], lift];
      if (o0 - m0 > 0.01 || o1 - m1 > 0.01) surf.poly([c(q(s0, m0), low), c(q(s1, m1), low), c(q(s1, o1), OPEN_GROUND_LIFT), c(q(s0, o0), OPEN_GROUND_LIFT)], GRAVEL, over);
    }
  }

  // ---- Aprons: the driveway aprons across the verge, in strips across so they follow the ground's own cut.
  for (const { p, s, sigma, width, depth } of apronsOf) {
    if (depth <= 0) continue;
    const half = width / 2 + APRON_FLARE;
    const ts = [p.cw, p.cw + 0.12, p.cw + 0.25, p.cw + 0.6, p.cw + depth];
    const over: Over = { layer: "sidewalk", tint: [0.78, 0.77, 0.73], dirt: 0.18, wear: 0.1 };
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i] as number;
      const t1 = ts[i + 1] as number;
      if (t1 - t0 < 0.02) continue;
      surf.flat([at(p, s - half, sigma * t0), at(p, s + half, sigma * t0), at(p, s + half, sigma * t1), at(p, s - half, sigma * t1)], WALK_LIFT, SIDEWALK, over);
    }
  }

  // ---- An alley: two wheel tracks of gravel with grass between (the mask lets the grass grow there).
  function alleyGeometry(p: PS): void {
    const key = Math.imul(p.street.id + 1, 2246822);
    const mouths = junctions.filter((j) => j.kind === "alley" && j.legs[2]!.street === p.street.id);
    // Along the alley, from its end (or the lot line it is carried out to) to its other end.
    let a = 0;
    let b = p.length;
    for (const m of mouths) {
      const e = m.legs[2] as JunctionLeg;
      const sm = (e.x - p.ax) * p.tx + (e.z - p.az) * p.tz;
      if (sm < p.length / 2) a = Math.min(a, sm);
      else b = Math.max(b, sm);
    }
    const n = Math.max(1, Math.ceil((b - a) / 3));
    for (const sg of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const s0 = a + ((b - a) * i) / n;
        const s1 = a + ((b - a) * (i + 1)) / n;
        // A track about 0.8 m wide, 0.8 m off the middle, its edges wandering a few centimetres: the wheels do not run true.
        const c0 = 0.85 + 0.1 * (vnoise(key ^ sg, s0, 9) - 0.5);
        const c1 = 0.85 + 0.1 * (vnoise(key ^ sg, s1, 9) - 0.5);
        const w0 = 0.34 + 0.12 * hashN(key, i, sg, 3);
        const w1 = 0.34 + 0.12 * hashN(key, i + 1, sg, 3);
        const q = (s: number, t: number): P2 => at(p, s, sg * t);
        const frame = { origin: [p.ax + hashN(key, i, sg, 4) * 4, 0, p.az + hashN(key, i, sg, 5) * 4] as Vec3, u: [p.tx, 0, p.tz] as Vec3, v: [p.nx, 0, p.nz] as Vec3 };
        const centre = c0;
        void centre;
        const hump = (v: readonly [number, number, number]): number => clamp01(0.45 + 0.4 * Math.abs(Math.abs((v[0] - p.ax) * p.nx + (v[2] - p.az) * p.nz) - 0.85));
        surf.flat([q(s0, c0 - w0), q(s1, c1 - w1), q(s1, c1 + w1), q(s0, c0 + w0)], OPEN_GROUND_LIFT, GRAVEL, { layer: "gravel", tint: [0.8, 0.75, 0.68], frame, dirt: hump, wear: 0.08, rank: RANK.mark });
      }
    }
  }

  // ---- The paint along a street: the main street's centre line and parking, the avenue's median; worn.
  function streetPaint(p: PS, spans: readonly Span[], roadIntervals: readonly [number, number][]): void {
    const kind = p.street.kind;
    if (kind !== "main" && kind !== "avenue") return;
    const lift = ROADWAY_LIFT + MARK_OVER;
    const key = Math.imul(p.street.id + 1, 1597334);
    /** A mark's surface: the asphalt's own grain under the paint colour, faded by the street's use and by a roll of the mark's own, and dirt over it where it has worn through. */
    const paint = (colour: Rgb, i: number): { c: Rgb; over: Over } => {
      const fresh = 0.55 + 0.45 * p.edge.use;
      const roll = 0.55 + 0.45 * hashN(key, i, 0, 1);
      const k = fresh * roll;
      return { c: colour, over: { layer: "asphalt", tint: [colour[0] * k * 2.1, colour[1] * k * 2.1, colour[2] * k * 2.1], dirt: 0.12 + 0.55 * (1 - roll), wear: 0.04 } };
    };
    let mark = 0;
    const stripP = (r: Rect, colour: Rgb, l = lift): void => {
      const { c, over } = paint(colour, mark++);
      strip(p, r, c, l, false, { ...over, rank: RANK.paint });
    };
    for (const [a, b] of roadIntervals) {
      // Where the paint may begin and end: short of the crossing at each junction end.
      const start = spans.filter((s) => Math.abs(s.hi - a) < 1e-6);
      const end = spans.filter((s) => Math.abs(s.lo - b) < 1e-6);
      const ca = start.length > 0 ? Math.max(a, ...start.map((s) => s.fwdCentre)) : a;
      const cb = end.length > 0 ? Math.min(b, ...end.map((s) => s.backCentre)) : b;
      if (cb - ca > 0.2) {
        if (kind === "main") {
          // Dashes, 10 ft with 30 ft gaps, spread so they begin and end even; each worn: some short, a few gone.
          const run = cb - ca;
          const count = Math.max(1, Math.floor((run + CENTRE_GAP) / (CENTRE_DASH + CENTRE_GAP)));
          const used = count * CENTRE_DASH + (count - 1) * CENTRE_GAP;
          let s = ca + (run - used) / 2;
          for (let k = 0; k < count; k++, s += CENTRE_DASH + CENTRE_GAP) {
            const gone = hashN(key, Math.floor(s), 0, 2) < 0.12 * (1 - p.edge.use * 0.6);
            if (gone) continue;
            const short = hashN(key, Math.floor(s), 0, 3) * 0.45 * (1 - p.edge.use * 0.5);
            const d0 = s + CENTRE_DASH * short * 0.5 * hashN(key, Math.floor(s), 0, 4);
            const d1 = s + CENTRE_DASH - CENTRE_DASH * short * 0.5;
            stripP([Math.max(ca, d0), Math.min(cb, d1), -CENTRE_WIDTH / 2, CENTRE_WIDTH / 2], PAINT_YELLOW);
          }
        } else {
          // The avenue's median: a band between two solid yellow lines, ended short of the crossing; the lines broken where worn.
          strip(p, [ca, cb, -MEDIAN_WIDTH / 2, MEDIAN_WIDTH / 2], MEDIAN, lift, false, { layer: "asphalt", tint: [0.3, 0.28, 0.24], dirt: 0.3, wear: 0.1, rank: RANK.mark });
          for (const t of [-MEDIAN_WIDTH / 2, MEDIAN_WIDTH / 2]) {
            const pieces = Math.max(1, Math.round((cb - ca) / 6));
            for (let i = 0; i < pieces; i++) {
              if (hashN(key, i, Math.floor(t * 4), 5) < 0.1) continue;
              stripP([ca + ((cb - ca) * i) / pieces, ca + ((cb - ca) * (i + 1)) / pieces - 0.05, t - LINE_WIDTH / 2, t + LINE_WIDTH / 2], PAINT_YELLOW, lift + 0.002);
            }
          }
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
        const pieces = Math.max(1, Math.round((pb - pa) / 5));
        for (let i = 0; i < pieces; i++) {
          if (hashN(key, i, sg, 6) < 0.08) continue;
          stripP([pa + ((pb - pa) * i) / pieces, pa + ((pb - pa) * (i + 1)) / pieces - 0.04, edge - LINE_WIDTH / 2, edge + LINE_WIDTH / 2], PAINT_WHITE);
        }
        const stalls = Math.max(1, Math.round((pb - pa) / PARKING_STALL));
        for (let k = 0; k <= stalls; k++) {
          const s = pa + ((pb - pa) * k) / stalls;
          if (hashN(key, k, sg, 7) < 0.15) continue;
          stripP([Math.max(pa, s - LINE_WIDTH / 2), Math.min(pb, s + LINE_WIDTH / 2), lo, hi], PAINT_WHITE);
        }
      }
    }
  }

  // ---- Everything at the junctions.
  junctionPaint(g, surf, junctions, pavements);
  junctionWear(g, surf, junctions, plan);
  signGeometry(g, surf, solid, junctions, detail);
}
