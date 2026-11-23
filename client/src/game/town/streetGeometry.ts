/**
 * The town's streets as strips of quads that follow the ground: every street of the plan but the highway (which the
 * engine paints and the town does not draw over), with the rail laid simply as ballast, ties and two rails.
 *
 * A street is drawn at its true width (`port/ways.ts`): a roadway of `street.roadway` between curbs, and outside it down
 * each side a grass verge and a sidewalk of `street.walk` (the main street has sidewalks and no verge; an alley is gravel,
 * all roadway).
 *
 * - **Each street is cut** along its length every `TILE` m (at most) and across into bands: two halves of roadway, the
 *   verge and the sidewalk each side; a wharf is a timber deck.
 * - **Every vertex stands at the ground's height plus a lift**: `STREET_LIFT` (0.06 m) for a verge, 0.003 more for a sidewalk,
 *   and 0.08 to 0.12 m for a roadway by its rank, so the layers never share a height (the renderer also draws the strips
 *   a depth step ahead of the terrain). A rank adds `RANK_LIFT`, and each street of a rank its own `SLOT_LIFT` more than the one before.
 * - **A crossing is drawn once.** A roadway tile that lies wholly inside a roadway of higher rank (a main over an avenue
 *   over a street over an alley, ties by the street's number) is left out, and a sidewalk or verge tile that lies wholly
 *   inside any roadway is left out; a tile only partly covered stays, lifted below the one that covers it.
 * - **The curb** is a low strip, `CURB_RISE` over the roadway, along each edge of a roadway that has sidewalks, with its
 *   face down to the roadway, left off where another street's roadway crosses it.
 * - **Markings** lie `MARK_OVER` over their roadway and are cut away where another roadway crosses them: a dashed yellow
 *   centre line on streets, the main street and the avenue; on the main street also parking stalls along both curbs and
 *   zebra crosswalks beside each cross street; on the avenue a painted median; and a stop bar where a street meets the highway.
 * - **The highway's edge**: a tile that reaches into the engine's road bed (`ROAD_BED_HALF` either side of its centre
 *   line) is cut along the bed's edge, so a street ends exactly at the road's gravel.
 * - Ground under the sea is not drawn.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { ALLEY, ASPHALT, BALLAST, CURB, DECK, MEDIAN, PAINT_WHITE, PAINT_YELLOW, RAIL, SIDEWALK, TIE, VERGE } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import type { Street, StreetKind } from "../../sim/town/types.js";

/** A strip is cut along its length at least this often, metres. */
export const TILE = 4;
/** The lift of a verge over the ground, metres; a sidewalk adds `WALK_OVER`, a carriageway `ASPHALT_OVER` and its rank's share. */
export const STREET_LIFT = 0.06;
export const WALK_OVER = 0.003;
export const ASPHALT_OVER = 0.02;
/** What a rank adds to a carriageway's lift, and what each street of a rank adds beside the one before (its slot): ranks never meet, and no two streets share a height. */
export const RANK_LIFT = 0.01;
export const SLOT_LIFT = 0.0002;
/** A curb stands this much over its roadway, and is this wide, metres. */
export const CURB_RISE = 0.045;
export const CURB_WIDTH = 0.18;
/** Paint lies this much over its roadway, metres. */
export const MARK_OVER = 0.012;
/** The dashed centre line: its width, dash and gap, metres. */
export const CENTRE_WIDTH = 0.14;
export const CENTRE_DASH = 2;
export const CENTRE_GAP = 4;
/** Parking along the main street: the lane's width, a stall's length along the curb, and a line's width, metres. */
export const PARKING_LANE = 2.4;
export const PARKING_STALL = 6.5;
export const LINE_WIDTH = 0.1;
/** A zebra crosswalk: a bar's width across the street, its pitch, its length along the street, and how far beside a cross street's roadway it begins, metres. */
export const ZEBRA_BAR = 0.4;
export const ZEBRA_PITCH = 0.85;
export const ZEBRA_LENGTH = 3;
export const ZEBRA_OFFSET = 1.5;
/** A stop bar's width along the street, and how far back from the highway's bed it lies, metres. */
export const STOP_BAR = 0.5;
export const STOP_BACK = 1.8;
/** The avenue's painted median: its width, metres. */
export const MEDIAN_WIDTH = 2;

const UP: Vec3 = [0, 1, 0];

/** The kinds drawn as a carriageway, with their rank among the layers. */
const RANK: Partial<Record<StreetKind, number>> = { alley: 0, street: 1, avenue: 2, main: 3 };

type Prepared = {
  street: Street;
  ax: number;
  az: number;
  tx: number;
  tz: number;
  length: number;
  /** Half the roadway's width, and half the right of way's. */
  cw: number;
  hw: number;
  /** The sidewalk down each side. */
  walk: number;
  rank: number;
  /** The street's place among those of its rank, in the plan's order. */
  slot: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
};

type Layer = "walk" | "verge" | "asphalt" | "deck" | "curb" | "mark";
type Band = { t0: number; t1: number; colour: Rgb; lift: number; layer: Layer };

type Corner = { x: number; z: number; u: number };

/** A convex polygon clipped to one side of the highway's bed edge: `sign` 1 keeps u >= edge, -1 keeps u <= -edge. */
function clipSide(poly: readonly Corner[], sign: 1 | -1, edge: number): Corner[] {
  const out: Corner[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Corner;
    const b = poly[(i + 1) % n] as Corner;
    const da = a.u * sign - edge;
    const db = b.u * sign - edge;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const k = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, u: a.u + (b.u - a.u) * k });
    }
  }
  return out;
}

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

export function streetGeometry(g: TownGround, sink: Sink, lift = STREET_LIFT): void {
  const { plan, anchor } = g;
  const prepared: Prepared[] = [];
  for (const street of plan.streets) {
    if (street.kind === "highway" || street.kind === "rail") continue;
    const ax = anchor.x + street.a.x;
    const az = anchor.z + street.a.z;
    const bx = anchor.x + street.b.x;
    const bz = anchor.z + street.b.z;
    const length = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (!(length > 0.1)) continue;
    const hw = street.width / 2;
    const cw = street.kind === "wharf" ? 0 : street.roadway / 2;
    const reach = hw + 0.1;
    prepared.push({
      street, ax, az, tx: (bx - ax) / length, tz: (bz - az) / length, length, cw, hw, walk: street.walk, rank: RANK[street.kind] ?? -1, slot: 0,
      x0: Math.min(ax, bx) - reach, x1: Math.max(ax, bx) + reach, z0: Math.min(az, bz) - reach, z1: Math.max(az, bz) + reach,
    });
  }

  const seen = new Map<number, number>();
  for (const p of prepared) {
    p.slot = seen.get(p.rank) ?? 0;
    seen.set(p.rank, p.slot + 1);
  }

  /** Whether the point is within the carriageway of `t` (its centre line, to half its width, along its length). */
  const inCarriage = (t: Prepared, x: number, z: number): boolean => {
    const s = (x - t.ax) * t.tx + (z - t.az) * t.tz;
    const c = (x - t.ax) * t.tz - (z - t.az) * t.tx;
    return s >= -1e-6 && s <= t.length + 1e-6 && Math.abs(c) <= t.cw + 1e-6;
  };

  /** Whether the four corners of a tile of `p` lie inside what is drawn over it. */
  const covered = (p: Prepared, layer: Layer, pts: readonly [number, number][]): boolean => {
    if (layer === "deck" || layer === "mark" || layer === "curb") return false;
    let lox = Infinity;
    let hix = -Infinity;
    let loz = Infinity;
    let hiz = -Infinity;
    for (const q of pts) {
      lox = Math.min(lox, q[0]);
      hix = Math.max(hix, q[0]);
      loz = Math.min(loz, q[1]);
      hiz = Math.max(hiz, q[1]);
    }
    for (const t of prepared) {
      if (t === p || t.cw <= 0 || t.x1 < lox || t.x0 > hix || t.z1 < loz || t.z0 > hiz) continue;
      // What is drawn over a carriageway: a carriageway of higher rank, or of the same rank and a later street.
      if (layer === "asphalt" && !(t.rank > p.rank || (t.rank === p.rank && t.street.id > p.street.id))) continue;
      if (pts.every((q) => inCarriage(t, q[0], q[1]))) return true;
    }
    return false;
  };

  /**
   * The parts of a street's length (from 0 to its length) along the line at offset `t0` from its centre that lie inside
   * another street's carriageway, grown by `margin`: where that line is crossed.
   */
  const crossed = (p: Prepared, t0: number, margin: number): [number, number][] => {
    const nx = p.tz;
    const nz = -p.tx;
    const out: [number, number][] = [];
    for (const q of prepared) {
      if (q === p || q.cw <= 0 || q.x1 < p.x0 || q.x0 > p.x1 || q.z1 < p.z0 || q.z0 > p.z1) continue;
      const rx = p.ax + nx * t0 - q.ax;
      const rz = p.az + nz * t0 - q.az;
      // q's frame along p's line: s_q = s0 + s1 * s, c_q = c0 + c1 * s.
      const s0 = rx * q.tx + rz * q.tz;
      const s1 = p.tx * q.tx + p.tz * q.tz;
      const c0 = rx * q.tz - rz * q.tx;
      const c1 = p.tx * q.tz - p.tz * q.tx;
      let lo = 0;
      let hi = p.length;
      const across = q.cw + margin;
      if (Math.abs(c1) < 1e-9) {
        if (Math.abs(c0) > across) continue;
      } else {
        const a = (-across - c0) / c1;
        const b = (across - c0) / c1;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (Math.abs(s1) < 1e-9) {
        if (s0 < -margin || s0 > q.length + margin) continue;
      } else {
        const a = (-margin - s0) / s1;
        const b = (q.length + margin - s0) / s1;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (hi > lo) out.push([lo, hi]);
    }
    return out;
  };

  const bed = ROAD_BED_HALF;
  const emit = (corners: readonly [number, number][], band: Band): void => {
    const asCorner = (q: readonly [number, number]): Corner => ({ x: q[0], z: q[1], u: q[0] - g.roadX(q[1]) });
    const poly = corners.map(asCorner);
    let pieces: Corner[][];
    const us = poly.map((q) => q.u);
    if (us.every((u) => u >= bed) || us.every((u) => u <= -bed)) pieces = [poly];
    else if (us.every((u) => u > -bed && u < bed)) pieces = [];
    else pieces = [clipSide(poly, 1, bed), clipSide(poly, -1, bed)];
    for (const piece of pieces) {
      if (piece.length < 3) continue;
      const pts: Vec3[] = piece.map((q) => {
        const ground = g.heightAt(q.x, q.z);
        const y = band.layer === "deck" ? Math.max(ground + band.lift, g.deckAt(q.x, q.z)) : ground + band.lift;
        return [q.x, y, q.z];
      });
      if (band.layer !== "deck" && pts.every((q) => q[1] - band.lift < SEA + 0.1)) continue;
      const c = piece.reduce((acc, q) => ({ x: acc.x + q.x / piece.length, z: acc.z + q.z / piece.length }), { x: 0, z: 0 });
      sink(c.x, c.z).poly(pts, UP, band.colour);
    }
  };

  /** A flat strip of a street: from `s0` to `s1` along it and `t0` to `t1` across it, at a lift. */
  const strip = (p: Prepared, s0: number, s1: number, t0: number, t1: number, colour: Rgb, liftOf: number, layer: Layer): void => {
    const nx = p.tz;
    const nz = -p.tx;
    const at = (s: number, t: number): [number, number] => [p.ax + p.tx * s + nx * t, p.az + p.tz * s + nz * t];
    // Cut every TILE m, so a strip follows the ground and meets the highway's bed edge as a tile does.
    const n = Math.max(1, Math.ceil((s1 - s0) / TILE));
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      const b = s0 + ((s1 - s0) * (i + 1)) / n;
      emit([at(a, t0), at(b, t0), at(b, t1), at(a, t1)], { t0, t1, colour, lift: liftOf, layer });
    }
  };

  /** A vertical face along a street: from `s0` to `s1` at offset `t`, from height `y0` over the ground to `y1`, facing along the street's normal times `face`. */
  const face = (p: Prepared, s0: number, s1: number, t: number, y0: number, y1: number, facing: number, colour: Rgb): void => {
    const nx = p.tz;
    const nz = -p.tx;
    const ax = p.ax + p.tx * s0 + nx * t;
    const az = p.az + p.tz * s0 + nz * t;
    const bx = p.ax + p.tx * s1 + nx * t;
    const bz = p.az + p.tz * s1 + nz * t;
    // Not inside the road's bed: left off where either end is.
    if (Math.abs(ax - g.roadX(az)) < bed + 0.3 || Math.abs(bx - g.roadX(bz)) < bed + 0.3) return;
    const ga = g.heightAt(ax, az);
    const gb = g.heightAt(bx, bz);
    if (ga + y1 < SEA + 0.1 && gb + y1 < SEA + 0.1) return;
    sink((ax + bx) / 2, (az + bz) / 2).poly([[ax, ga + y0, az], [bx, gb + y0, bz], [bx, gb + y1, bz], [ax, ga + y1, az]], [nx * facing, 0, nz * facing], colour);
  };

  for (const p of prepared) {
    const { street } = p;
    const nx = p.tz;
    const nz = -p.tx;
    const bands: Band[] = [];
    const flat = street.kind === "alley" ? ALLEY : ASPHALT;
    const up = lift + ASPHALT_OVER + RANK_LIFT * p.rank + SLOT_LIFT * p.slot;
    if (street.kind === "wharf") {
      bands.push({ t0: -p.hw, t1: 0, colour: DECK, lift, layer: "deck" }, { t0: 0, t1: p.hw, colour: DECK, lift, layer: "deck" });
    } else {
      bands.push({ t0: -p.cw, t1: 0, colour: flat, lift: up, layer: "asphalt" }, { t0: 0, t1: p.cw, colour: flat, lift: up, layer: "asphalt" });
      const verge = p.hw - p.cw - p.walk;
      if (p.walk > 0) {
        for (const sg of [-1, 1]) {
          bands.push({ t0: sg * (p.hw - p.walk), t1: sg * p.hw, colour: SIDEWALK, lift: lift + WALK_OVER, layer: "walk" });
          if (verge > 0.05) bands.push({ t0: sg * p.cw, t1: sg * (p.hw - p.walk), colour: VERGE, lift, layer: "verge" });
        }
      }
    }
    const n = Math.max(1, Math.ceil(p.length / TILE));
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * p.length;
      const s1 = ((i + 1) / n) * p.length;
      for (const band of bands) {
        const at = (s: number, t: number): [number, number] => [p.ax + p.tx * s + nx * t, p.az + p.tz * s + nz * t];
        const corners: [number, number][] = [at(s0, band.t0), at(s1, band.t0), at(s1, band.t1), at(s0, band.t1)];
        if (covered(p, band.layer, corners)) continue;
        emit(corners, band);
      }
    }
    if (street.kind === "wharf" || street.kind === "alley") continue;

    // The curb: along each edge of the roadway, cut where another roadway crosses it.
    for (const sg of [-1, 1]) {
      const t = sg * (p.cw + CURB_WIDTH / 2);
      const gaps = crossed(p, t, 0.1);
      const m = Math.max(1, Math.ceil(p.length / TILE));
      for (let i = 0; i < m; i++) {
        for (const [a, b] of without((i / m) * p.length, ((i + 1) / m) * p.length, gaps)) {
          strip(p, a, b, sg * p.cw, sg * (p.cw + CURB_WIDTH), CURB, up + CURB_RISE, "curb");
          // The face down to the roadway, looking over it (the outer side, down to the sidewalk, is left open: nobody sees it).
          face(p, a, b, sg * p.cw, up, up + CURB_RISE, -sg, CURB);
        }
      }
    }

    // The markings, on the roadway.
    const paint = up + MARK_OVER;
    const dashed = (t: number, colour: Rgb): void => {
      const gaps = crossed(p, t, 0.6);
      const period = CENTRE_DASH + CENTRE_GAP;
      for (let s = (p.length % period) / 2; s < p.length; s += period) {
        for (const [a, b] of without(s, Math.min(s + CENTRE_DASH, p.length), gaps)) strip(p, a, b, t - CENTRE_WIDTH / 2, t + CENTRE_WIDTH / 2, colour, paint, "mark");
      }
    };
    const solid = (t: number, colour: Rgb, margin: number): void => {
      for (const [a, b] of without(0, p.length, crossed(p, t, margin))) strip(p, a, b, t - LINE_WIDTH / 2, t + LINE_WIDTH / 2, colour, paint, "mark");
    };
    if (street.kind === "street" || street.kind === "main") dashed(0, PAINT_YELLOW);
    if (street.kind === "avenue") {
      // A painted median: a band of its own paint between two solid yellow lines.
      for (const [a, b] of without(0, p.length, crossed(p, 0, 0.6))) strip(p, a, b, -MEDIAN_WIDTH / 2, MEDIAN_WIDTH / 2, MEDIAN, paint, "mark");
      solid(-MEDIAN_WIDTH / 2, PAINT_YELLOW, 0.6);
      solid(MEDIAN_WIDTH / 2, PAINT_YELLOW, 0.6);
    }
    if (street.kind === "main") {
      for (const sg of [-1, 1]) {
        // The parking lane's edge, and a tick across it at each stall, kept back from the corners.
        const edge = sg * (p.cw - PARKING_LANE);
        solid(edge, PAINT_WHITE, 2);
        const gaps = crossed(p, sg * (p.cw - PARKING_LANE / 2), 2.5);
        for (let s = PARKING_STALL / 2; s < p.length - 0.5; s += PARKING_STALL) {
          for (const [a, b] of without(s, s + LINE_WIDTH, gaps)) strip(p, a, b, Math.min(edge, sg * p.cw), Math.max(edge, sg * p.cw), PAINT_WHITE, paint, "mark");
        }
      }
      // A zebra crosswalk across the roadway beside each cross street's mouth, on both sides of it.
      for (const q of prepared) {
        if (q === p || (q.street.kind !== "street" && q.street.kind !== "avenue") || q.cw <= 0) continue;
        // Where q's centre line crosses this street's, and the angle between them, so the crosswalk clears q's roadway.
        const den = p.tx * q.tz - p.tz * q.tx;
        if (Math.abs(den) < 0.5) continue;
        const sx = ((q.ax - p.ax) * q.tz - (q.az - p.az) * q.tx) / den;
        const qs = ((q.ax - p.ax) * p.tz - (q.az - p.az) * p.tx) / den;
        // q must reach this street: its centre line crosses it between its ends, or ends on it.
        if (sx < 1 || sx > p.length - 1 || qs < -0.5 || qs > q.length + 0.5) continue;
        const half = q.cw / Math.abs(den) + ZEBRA_OFFSET;
        for (const sgn of [-1, 1]) {
          const s0 = sgn < 0 ? sx - half - ZEBRA_LENGTH : sx + half;
          if (s0 < 0.5 || s0 + ZEBRA_LENGTH > p.length - 0.5) continue;
          const lane = p.cw - 0.3;
          for (let t = -lane + ZEBRA_BAR / 2; t < lane - ZEBRA_BAR / 2; t += ZEBRA_PITCH) {
            if (Math.abs(t) > lane) break;
            strip(p, s0, s0 + ZEBRA_LENGTH, t - ZEBRA_BAR / 2, t + ZEBRA_BAR / 2, PAINT_WHITE, paint, "mark");
          }
        }
      }
    }
    // A stop bar where the street meets the highway: across the lane that runs toward it.
    for (const end of [0, 1] as const) {
      const ex = end === 0 ? p.ax : p.ax + p.tx * p.length;
      const ez = end === 0 ? p.az : p.az + p.tz * p.length;
      if (Math.abs(ex - g.roadX(ez)) > 1.5) continue;
      const hx = g.roadX(ez + 5) - g.roadX(ez - 5);
      const hl = Math.sqrt(100 + hx * hx);
      const sin = Math.abs(p.tx * 10 - p.tz * hx) / hl;
      const cos = Math.abs(p.tx * hx + p.tz * 10) / hl;
      if (sin < 0.3) continue;
      // Far enough back that the bar's far corner, across the roadway and along the highway's edge, is clear of the bed.
      const back = (bed + STOP_BACK + p.cw * cos) / sin;
      // Traffic toward the end at the street's far end keeps to its right, toward the start to the left of the street's direction.
      const s0 = end === 1 ? p.length - back - STOP_BAR : back;
      if (s0 < 0.5 || s0 + STOP_BAR > p.length - 0.5) continue;
      if (end === 1) strip(p, s0, s0 + STOP_BAR, 0.1, p.cw - 0.1, PAINT_WHITE, paint, "mark");
      else strip(p, s0, s0 + STOP_BAR, -p.cw + 0.1, -0.1, PAINT_WHITE, paint, "mark");
    }
  }

  // The rail: ballast, ties and two rails, along each segment of the line.
  for (const street of plan.streets) {
    if (street.kind !== "rail") continue;
    const ax = anchor.x + street.a.x;
    const az = anchor.z + street.a.z;
    const length = Math.sqrt((anchor.x + street.b.x - ax) * (anchor.x + street.b.x - ax) + (anchor.z + street.b.z - az) * (anchor.z + street.b.z - az));
    if (!(length > 0.1)) continue;
    const tx = (anchor.x + street.b.x - ax) / length;
    const tz = (anchor.z + street.b.z - az) / length;
    const nx = tz;
    const nz = -tx;
    const at = (s: number, t: number): [number, number] => [ax + tx * s + nx * t, az + tz * s + nz * t];
    const rail = (s0: number, s1: number, t0: number, t1: number, colour: Rgb, over: number): void => {
      emit([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], { t0, t1, colour, lift: lift + over, layer: "walk" });
    };
    const n = Math.max(1, Math.ceil(length / TILE));
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * length;
      const s1 = ((i + 1) / n) * length;
      rail(s0, s1, -1.7, 1.7, BALLAST, 0);
      rail(s0, s1, -0.78, -0.66, RAIL, 0.1);
      rail(s0, s1, 0.66, 0.78, RAIL, 0.1);
    }
    const ties = Math.floor(length / 1.9);
    for (let k = 0; k < ties; k++) {
      const s = 0.5 + k * 1.9;
      rail(s, s + 0.28, -1.3, 1.3, TIE, 0.05);
    }
  }
}
