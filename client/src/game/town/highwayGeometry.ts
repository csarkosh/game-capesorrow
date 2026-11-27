/**
 * The highway where it runs through the town, paved as a town street is: the bed the engine shapes flat for it (`ROAD_BED_HALF` either side of
 * its centre line) laid with the town's own asphalt, so that the streets that end on it and the highway are one surface.
 *
 * - **The strip** lies over the whole bed, edge to edge, on the bed's tiles (`highwayBed.ts`), at the ground's height and a roadway's lift
 *   (`ROADWAY_LIFT`), in the town's asphalt with one texture frame along its length. It runs from `HIGHWAY_LEAD` metres, measured along the
 *   centre line, before the first street's meeting with the highway to `HIGHWAY_LEAD` after the last, and each end is a clean line square to the
 *   highway: past it the engine's own paint takes over, as it does beyond the end of a street's pavement.
 * - **The meetings.** A junction's pavement is solved against the highway's edge as a straight line (`junctions.ts`), which lies up to a quarter of
 *   a metre in or out of the bed's edge, which is measured across in x. Where it lies in, the town's surfaces are cut off the bed's tiles
 *   (`Surface`) and so meet the strip along its edge; where it lies out, the pavement takes in the ground between the edge and the bed
 *   (`bedFillers`, laid with the junction's own pavement), so there is neither a gap nor a face drawn twice at any meeting.
 * - **The marks**, in the town's own style (`streetGeometry.ts`): a double yellow centre line, broken across the roadway of each street that meets
 *   the highway, and a white line at the edge of each lane (3.5 m from the centre, where the engine's asphalt ends), broken across each meeting's opening
 *   in the curb. The highway is kept up, so its paint is faded and dirtied by a roll of its own per 8 m and none of it is worn through. There is no
 *   stop line on the highway itself: the side streets keep theirs. A crosswalk the plan marks across the highway (`marked` on its leg: at the junctions of the
 *   core) is laid here as a ladder of bars across the bed, in the size of any other crosswalk's, on the paving at the lift of the streets' marks, and the centre
 *   line and the lane's two edge lines are broken across it.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { hashN } from "./groundNoise.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { BED_STEP, bedIndex, bedTile } from "./highwayBed.js";
import { CROSSWALK_WIDTH } from "../../sim/town/junctions.js";
import { onLeg } from "../../sim/town/junctionShape.js";
import { RAIL_BED_HALF } from "../../sim/town/rail.js";
import { spurOf } from "../../sim/town/railSpur.js";
import { SLOT, envParts, highwayKey, layFeatures, layRows, type HighwayEnv } from "./highwayLook.js";
import { BAR_MARGIN, BAR_WIDTH, barOffsets } from "./junctionPaint.js";
import { worldJunctions, type WJunction } from "./junctionWorld.js";
import type { Rgb } from "./meshBuilder.js";
import { PAINT_WHITE, PAINT_YELLOW } from "./palette.js";
import { LINE_WIDTH, MARK_OVER, ROADWAY_LIFT } from "./streetGeometry.js";
import { clipLine, shareArea, subtractConvex, type P2, type Surface } from "./surface.js";
import type { Detail, TownGround } from "./townTypes.js";
import type { Vec } from "../../sim/town/types.js";

/** How far the strip runs past the outermost meeting of a street with the highway, measured along the highway's centre line, metres. */
export const HIGHWAY_LEAD = 25;
/** The lane's width: the white lines lie this far either side of the centre line, metres (the engine's own asphalt is as wide). */
export const LANE_HALF = 3.5;
/** The double yellow's two lines lie this far either side of the centre line (centres), metres: a gap of one line's width (`LINE_WIDTH`, 0.1) between them. */
const CENTRE_OFFSET = 0.1;
/** A stretch of paint along the highway has a wear of its own, per this length, metres. */
const PAINT_RUN = 8;
/** The finest step the centre line's length is measured in, metres. */
const ARC_STEP = 0.25;

/** One end of the strip: the centre line's point, its direction (along z, so that the start is the lesser end), and the end line's two corners on the bed's edges. */
export type StripEnd = { readonly x: number; readonly z: number; readonly tx: number; readonly tz: number; readonly left: P2; readonly right: P2 };

/** Where a junction's pavement meets the bed, on one side of it: the edge's two ends (`a` the lesser z) and the side (-1 seaward, 1 inland). */
export type BedContact = { readonly junction: number; readonly side: 1 | -1; readonly a: P2; readonly b: P2 };

/** A crosswalk the plan marks across the highway: its bars (each a quad) and the range of z they lie over. */
export type HighwayCrosswalk = { readonly junction: number; readonly bars: readonly (readonly P2[])[]; readonly z: readonly [number, number] };

/** What is drawn of the highway: its ends, the meetings along it, the lengths of centre line the streets' roadways cross, each as a range of z, and its crosswalks. */
export type HighwayStrip = {
  readonly start: StripEnd;
  readonly end: StripEnd;
  readonly contacts: readonly BedContact[];
  readonly crossings: readonly (readonly [number, number])[];
  readonly crosswalks: readonly HighwayCrosswalk[];
};

/**
 * The crosswalks a junction's plan marks across the highway: on each of its edge legs that is `marked`, a ladder of bars across the bed, on the side of the bed
 * away from the streets, beginning where the leg's mouth is (as the ladder of a street's leg does).
 */
function crosswalksOf(g: TownGround, j: WJunction): HighwayCrosswalk[] {
  const out: HighwayCrosswalk[] = [];
  const other = j.legs.find((m) => !m.engine);
  for (const l of j.legs) {
    if (!l.engine || !l.marked) continue;
    const side = other === undefined ? 1 : other.dx * -l.dz + other.dz * l.dx > 0 ? -1 : 1;
    const a = BAR_MARGIN;
    const b = ROAD_BED_HALF * 2 - BAR_MARGIN;
    const t0 = side > 0 ? a : -b;
    const t1 = side > 0 ? b : -a;
    // The leg's line is the bed's edge at the leg's reference point only: the highway bends away from it along the leg, so the bars are laid in the bed's own frame,
    // each a stretch of the centre line `CROSSWALK_WIDTH` long from where the leg's mouth is, between its offsets across the bed.
    const es = l.x - g.roadX(l.z) < 0 ? -1 : 1;
    const z0 = onLeg(l, l.mouth, 0).z;
    const z1 = zAlong(g, z0, (l.dz > 0 ? 1 : -1) * CROSSWALK_WIDTH);
    const bars = barOffsets(t0, t1).map((t): P2[] => {
      // How far each side of the bar lies from the bed's edge (t is to the leg's left, so a negative t is the same distance the other way).
      const near = side > 0 ? t : -(t + BAR_WIDTH);
      const far = near + BAR_WIDTH;
      const uA = es * (ROAD_BED_HALF - near);
      const uB = es * (ROAD_BED_HALF - far);
      return [[g.roadX(z0) + uA, z0], [g.roadX(z1) + uA, z1], [g.roadX(z1) + uB, z1], [g.roadX(z0) + uB, z0]];
    });
    const zs = bars.flatMap((q) => q.map((v) => v[1]));
    out.push({ junction: j.id, bars, z: [Math.min(...zs), Math.max(...zs)] });
  }
  return out;
}

/**
 * Where a paved junction's pavement lies along the highway's engine edge: each stretch of its outline that runs along the edge, from its least z to its greatest.
 * One street meeting the highway has one; two that meet it close together, with a corner of lot between them, have two.
 */
function contactsOf(g: TownGround, j: WJunction): BedContact[] {
  const e = j.legs.find((l) => l.engine);
  if (e === undefined || j.polygon.length < 3) return [];
  const poly = j.polygon;
  const n = poly.length;
  const on = poly.map((p) => Math.abs((p.x - e.x) * -e.dz + (p.z - e.z) * e.dx) < 1e-5);
  const start = on.findIndex((o) => !o);
  if (start < 0) return [];
  const out: BedContact[] = [];
  let run: Vec[] = [];
  const close = (): void => {
    if (run.length >= 2) {
      let lo = run[0]!;
      let hi = run[0]!;
      for (const p of run) {
        if (p.z < lo.z) lo = p;
        if (p.z > hi.z) hi = p;
      }
      if (hi.z - lo.z > 0.5) out.push({ junction: j.id, side: (lo.x + hi.x) / 2 - g.roadX((lo.z + hi.z) / 2) < 0 ? -1 : 1, a: [lo.x, lo.z], b: [hi.x, hi.z] });
    }
    run = [];
  };
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (on[i]) run.push(poly[i] as Vec);
    else close();
  }
  close();
  return out;
}

/** Where the roadway of each street at a junction crosses the centre line: the least and greatest z of its two edges' meetings with it. */
function crossingsOf(g: TownGround, j: WJunction): [number, number][] {
  const out: [number, number][] = [];
  for (const l of j.legs) {
    if (l.engine) continue;
    const nx = -l.dz;
    const nz = l.dx;
    const zs: number[] = [];
    for (const off of [-l.half, l.half]) {
      let t = 0;
      for (let k = 0; k < 12; k++) {
        const z = l.z + l.dz * t + nz * off;
        const f = l.x + l.dx * t + nx * off - g.roadX(z);
        const slope = (g.roadX(z + 0.5) - g.roadX(z - 0.5)) / 1;
        const df = l.dx - slope * l.dz;
        if (Math.abs(df) < 1e-6) break;
        t -= f / df;
      }
      zs.push(l.z + l.dz * t + nz * off);
    }
    out.push([Math.min(...(zs as [number, number])), Math.max(...(zs as [number, number]))]);
  }
  return out;
}

/** The centre line's direction at z, as a unit vector (tx, tz) with tz positive. */
function directionAt(g: TownGround, z: number): [number, number] {
  const dx = g.roadX(z + 0.5) - g.roadX(z - 0.5);
  const len = Math.sqrt(dx * dx + 1);
  return [dx / len, 1 / len];
}

/** The z that lies `length` metres along the centre line from `z` (toward greater z for a positive length). */
function zAlong(g: TownGround, z: number, length: number): number {
  const dir = length < 0 ? -1 : 1;
  let at = z;
  let left = Math.abs(length);
  for (let guard = 0; guard < 20000 && left > 0; guard++) {
    const next = at + dir * ARC_STEP;
    const dx = g.roadX(next) - g.roadX(at);
    const step = Math.sqrt(dx * dx + ARC_STEP * ARC_STEP);
    if (step >= left) return at + dir * ARC_STEP * (left / step);
    left -= step;
    at = next;
  }
  return at;
}

/** An end of the strip at z: the line square to the centre line there, with its corners where it meets the bed's two edges. */
function endAt(g: TownGround, z: number): StripEnd {
  const x = g.roadX(z);
  const [tx, tz] = directionAt(g, z);
  // Along the end line: (tz, -tx). The bed's edge is at an offset of `ROAD_BED_HALF` across in x from the centre line there.
  const corner = (sign: 1 | -1): P2 => {
    let s = sign * ROAD_BED_HALF;
    for (let k = 0; k < 12; k++) {
      const px = x + s * tz;
      const pz = z - s * tx;
      const f = px - g.roadX(pz) - sign * ROAD_BED_HALF;
      const slope = (g.roadX(pz + 0.5) - g.roadX(pz - 0.5)) / 1;
      s -= f / (tz + slope * tx);
    }
    return [x + s * tz, z - s * tx];
  };
  return { x, z, tx, tz, left: corner(-1), right: corner(1) };
}

/** Where the highway is paved for a ground: the strip's ends and the meetings along it, or null where no street meets the highway. */
export function highwayStrip(g: TownGround, junctions: readonly WJunction[] = worldJunctions(g)): HighwayStrip | null {
  const contacts: BedContact[] = [];
  const crossings: [number, number][] = [];
  const crosswalks: HighwayCrosswalk[] = [];
  for (const j of junctions) {
    if (j.kind !== "highway") continue;
    const cs = contactsOf(g, j);
    if (cs.length === 0) continue;
    contacts.push(...cs);
    crossings.push(...crossingsOf(g, j));
    crosswalks.push(...crosswalksOf(g, j));
  }
  if (contacts.length === 0) return null;
  const lo = Math.min(...contacts.map((c) => c.a[1]));
  const hi = Math.max(...contacts.map((c) => c.b[1]));
  return { start: endAt(g, zAlong(g, lo, -HIGHWAY_LEAD)), end: endAt(g, zAlong(g, hi, HIGHWAY_LEAD)), contacts, crossings, crosswalks };
}

/** The ground the town's spur lies over where it crosses or runs along the highway's bed: its bed's whole width, as quads between its points, within reach of the bed. */
export function spurGround(g: TownGround): P2[][] {
  const track = spurOf(g.seed);
  if (track === null) return [];
  const out: P2[][] = [];
  const pts = track.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { x: number; z: number };
    const b = pts[i] as { x: number; z: number };
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-9) continue;
    const nx = (-dz / len) * RAIL_BED_HALF;
    const nz = (dx / len) * RAIL_BED_HALF;
    // Only where it comes within the bed (a metre's slack).
    const near = (q: { x: number; z: number }): number => Math.abs(q.x - g.roadX(q.z));
    if (Math.min(near(a), near(b)) > ROAD_BED_HALF + RAIL_BED_HALF + len + 1) continue;
    out.push([[a.x - nx, a.z - nz], [b.x - nx, b.z - nz], [b.x + nx, b.z + nz], [a.x + nx, a.z + nz]]);
  }
  return out;
}

/** The x of the centre line's chord on bed tile `tile` at z. */
function centreOn(tile: readonly P2[], z: number): number {
  const z0 = (tile[0] as P2)[1];
  const x0 = ((tile[0] as P2)[0] + (tile[1] as P2)[0]) / 2;
  const x1 = ((tile[3] as P2)[0] + (tile[2] as P2)[0]) / 2;
  return x0 + ((z - z0) * (x1 - x0)) / BED_STEP;
}

/**
 * The ground between a junction's pavement and the bed, where the pavement's edge lies out of the bed: convex pieces, each within one tile, bounded by the
 * tile's edge and the pavement's. The pavement takes them in.
 */
export function bedFillers(g: TownGround, j: WJunction): P2[][] {
  const out: P2[][] = [];
  for (const c of contactsOf(g, j)) out.push(...fillersOf(g, c));
  return out.filter((p) => Math.abs(areaOf(p)) > 1e-6);
}

/** The ground between one contact's pavement edge and the bed. */
function fillersOf(g: TownGround, c: BedContact): P2[][] {
  const out: P2[][] = [];
  const lineX = (z: number): number => c.a[0] + ((z - c.a[1]) * (c.b[0] - c.a[0])) / (c.b[1] - c.a[1]);
  for (let i = bedIndex(c.a[1]); i <= bedIndex(c.b[1]); i++) {
    const tile = bedTile(g, i);
    const za = Math.max(i * BED_STEP, c.a[1]);
    const zb = Math.min((i + 1) * BED_STEP, c.b[1]);
    if (!(zb - za > 1e-6)) continue;
    const edge = (z: number): number => centreOn(tile, z) + c.side * ROAD_BED_HALF;
    // How far the pavement's edge lies out of the bed at each end (positive: out).
    const da = c.side * (lineX(za) - edge(za));
    const db = c.side * (lineX(zb) - edge(zb));
    if (da <= 1e-9 && db <= 1e-9) continue;
    if (da > 0 && db > 0) {
      out.push([[edge(za), za], [edge(zb), zb], [lineX(zb), zb], [lineX(za), za]]);
    } else {
      // The edge crosses the bed's: a triangle on the side that lies out.
      const zc = za + ((zb - za) * da) / (da - db);
      const cross: P2 = [edge(zc), zc];
      out.push(da > 0 ? [[edge(za), za], cross, [lineX(za), za]] : [cross, [edge(zb), zb], [lineX(zb), zb]]);
    }
  }
  return out;
}

const areaOf = (p: readonly P2[]): number => {
  let t = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as P2;
    const b = p[(i + 1) % p.length] as P2;
    t += a[0] * b[1] - b[0] * a[1];
  }
  return t / 2;
};

/** The parts of [lo, hi] that none of `blocked` covers. */
function without(lo: number, hi: number, blocked: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of blocked.slice().sort((p, q) => p[0] - q[0])) {
    if (b <= at) continue;
    if (a >= hi) break;
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([a, b]) => b - a > 1e-6);
}

/**
 * Lays the highway's paving and its marks: nothing where no street meets it. The paving is `highwayLook.ts`'s (stretches with frames and tones of their own, bands across so
 * that the dirt gathers toward the edges, seams, and the wear a street has), cut to the strip; the marks are the town's own, laid here.
 */
export function highwayGeometry(g: TownGround, surf: Surface, junctions: readonly WJunction[], detail: Detail = "full"): void {
  const strip = highwayStrip(g, junctions);
  if (strip === null) return;
  const { start, end } = strip;
  const key = highwayKey(g.seed);
  /** The part of a convex polygon between the two end lines. */
  const between = (poly: readonly P2[]): P2[] => {
    const a = clipLine(poly, [start.x, start.z], [start.x + start.tz, start.z - start.tx], true);
    return a.length < 3 ? [] : clipLine(a, [end.x, end.z], [end.x + end.tz, end.z - end.tx], false);
  };
  // The spur's bed is left its own ground where the track crosses the highway: the town's paving and its marks are cut off it, so that no two faces lie there.
  const spur = spurGround(g);
  const region = (poly: readonly P2[]): P2[][] => {
    const piece = between(poly);
    if (piece.length < 3 || Math.abs(areaOf(piece)) <= 1e-6) return [];
    let pieces: P2[][] = [piece.slice()];
    for (const q of spur) pieces = pieces.flatMap((r) => (shareArea(r, q, 1e-4) ? subtractConvex(r, q) : [r]));
    return pieces.filter((r) => r.length >= 3 && Math.abs(areaOf(r)) > 1e-6);
  };
  const inStrip = (p: P2): boolean => (p[0] - start.x) * start.tx + (p[1] - start.z) * start.tz >= 0 && (p[0] - end.x) * end.tx + (p[1] - end.z) * end.tz <= 0;
  const full: [number, number] = [Math.min(start.left[1], start.right[1]), Math.max(end.left[1], end.right[1])];
  const env: HighwayEnv = { seed: g.seed, key, near: true, height: g.heightAt, full, manholes: true, marks: false, centre: g.roadX, stretches: new Map(), memo: { last: null, frames: new Map() }, ...envParts(surf, region, (pts) => pts.every(inStrip)) };
  const lay = (poly: readonly P2[], lift: number, colour: Rgb, o: Over): void => env.pave(poly, lift, colour, o);

  const first = bedIndex(Math.min(start.left[1], start.right[1])) - 1;
  const last = bedIndex(Math.max(end.left[1], end.right[1])) + 1;
  // Where each mark is broken: the centre line across the roadways that meet the highway, an edge line across the opening of each pavement on its side.
  const walkBreaks = strip.crosswalks.map((c): [number, number] => [c.z[0], c.z[1]]);
  const centreBreaks = [...strip.crossings, ...walkBreaks];
  const edgeBreaks = (side: 1 | -1): [number, number][] => [...strip.contacts.filter((c) => c.side === side).map((c): [number, number] => [c.a[1], c.b[1]]), ...walkBreaks];
  const lift = ROADWAY_LIFT + MARK_OVER;
  /** A mark's look: the asphalt's grain under the paint's colour, faded by a roll of its own per stretch of the highway and dirtied where it has faded. */
  const look = (colour: Rgb, z: number, line: number): { c: Rgb; over: Over } => {
    const roll = 0.65 + 0.35 * hashN(key, Math.floor(z / PAINT_RUN), line, 4);
    return { c: colour, over: { layer: "asphalt", tint: [colour[0] * roll * 2.1, colour[1] * roll * 2.1, colour[2] * roll * 2.1], dirt: 0.1 + 0.4 * (1 - roll), wear: 0.04, rank: RANK.paint } };
  };
  const lines: { o0: number; o1: number; colour: Rgb; breaks: readonly (readonly [number, number])[] }[] = [
    { o0: -CENTRE_OFFSET - LINE_WIDTH / 2, o1: -CENTRE_OFFSET + LINE_WIDTH / 2, colour: PAINT_YELLOW, breaks: centreBreaks },
    { o0: CENTRE_OFFSET - LINE_WIDTH / 2, o1: CENTRE_OFFSET + LINE_WIDTH / 2, colour: PAINT_YELLOW, breaks: centreBreaks },
    { o0: -LANE_HALF - LINE_WIDTH / 2, o1: -LANE_HALF + LINE_WIDTH / 2, colour: PAINT_WHITE, breaks: edgeBreaks(-1) },
    { o0: LANE_HALF - LINE_WIDTH / 2, o1: LANE_HALF + LINE_WIDTH / 2, colour: PAINT_WHITE, breaks: edgeBreaks(1) },
  ];
  // The asphalt, by stretch and band, and the wear the streets have: over the rows the bed is cut into.
  layRows(env, first * BED_STEP, (last + 1) * BED_STEP, BED_STEP);
  for (let S = Math.floor((first * BED_STEP) / SLOT); S * SLOT < (last + 1) * BED_STEP; S++) layFeatures(env, S, detail === "low" ? 1 : 0);
  for (let i = first; i <= last; i++) {
    const tile = bedTile(g, i);
    const z0 = i * BED_STEP;
    const z1 = z0 + BED_STEP;
    lines.forEach((m, line) => {
      for (const [za, zb] of without(z0, z1, m.breaks)) {
        const quad: P2[] = [[centreOn(tile, za) + m.o0, za], [centreOn(tile, za) + m.o1, za], [centreOn(tile, zb) + m.o1, zb], [centreOn(tile, zb) + m.o0, zb]];
        const { c, over: o } = look(m.colour, za, line);
        lay(quad, lift, c, o);
      }
    });
  }
  // The crosswalks, at the lift of the streets' marks and their rank: the paint of a ladder on the paving, faded as the lines are.
  for (const w of strip.crosswalks) {
    w.bars.forEach((bar, i) => {
      const { c, over: o } = look(PAINT_WHITE, (w.z[0] + w.z[1]) / 2, 8 + i);
      lay(bar, lift, c, o);
    });
  }
}
