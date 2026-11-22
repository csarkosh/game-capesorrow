/**
 * The town's streets as strips of quads that follow the ground: every street of the plan but the highway (which the
 * engine paints and the town does not draw over), with the rail laid simply as ballast, ties and two rails.
 *
 * - **Each street is cut** along its length every `TILE` m (at most) and across into bands: two halves of
 *   carriageway, and on `main`, `avenue` and `street` a sidewalk band of `SIDEWALK_WIDTH` m down each side (less on a
 *   narrow street); an alley is two halves of plain carriageway; a wharf is a timber deck.
 * - **Every vertex stands at the ground's height plus a lift**: `STREET_LIFT` (0.06 m) for a sidewalk, and 0.08 to 0.12 m for a carriageway by its rank, so the layers never share a height (the renderer also draws
 *   the strips a depth step ahead of the terrain). A wharf stands at the deck's height where that is above the ground.
 * - **A crossing is drawn once.** A carriageway tile that lies wholly inside a carriageway of higher rank (a main
 *   over an avenue over a street over an alley, ties by the street's number) is left out, and a sidewalk tile that lies
 *   wholly inside any carriageway is left out; a tile only partly covered stays, lifted below the one that covers it,
 *   so at every point the highest layer is the one seen and nothing shares a height (a rank adds `RANK_LIFT`, and each street
 *   of a rank its own `SLOT_LIFT` more than the one before).
 * - **The highway's edge**: a tile that reaches into the engine's road bed (`ROAD_BED_HALF` either side of its centre
 *   line) is cut along the bed's edge, so a street ends exactly at the road's gravel.
 * - Ground under the sea is not drawn.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { ALLEY, ASPHALT, BALLAST, DECK, RAIL, SIDEWALK, TIE } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import type { Street, StreetKind } from "../../sim/town/types.js";

/** A strip is cut along its length at least this often, metres. */
export const TILE = 4;
/** The sidewalk band down each side of a street, metres. */
export const SIDEWALK_WIDTH = 2.5;
/** The lift of a sidewalk over the ground, metres; a carriageway adds `ASPHALT_OVER` and its rank's share. */
export const STREET_LIFT = 0.06;
export const ASPHALT_OVER = 0.02;
/** What a rank adds to a carriageway's lift, and what each street of a rank adds beside the one before (its slot): ranks never meet, and no two streets share a height. */
export const RANK_LIFT = 0.01;
export const SLOT_LIFT = 0.0002;

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
  /** Half the carriageway's width, and half the street's. */
  cw: number;
  hw: number;
  rank: number;
  /** The street's place among those of its rank, in the plan's order. */
  slot: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
};

type Band = { t0: number; t1: number; colour: Rgb; lift: number; layer: "sidewalk" | "asphalt" | "deck" };

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
    const sidewalk = street.kind === "main" || street.kind === "avenue" || street.kind === "street" ? Math.max(0, Math.min(SIDEWALK_WIDTH, hw - 2.5)) : 0;
    const cw = street.kind === "wharf" ? 0 : hw - sidewalk;
    const reach = hw + 0.1;
    prepared.push({
      street, ax, az, tx: (bx - ax) / length, tz: (bz - az) / length, length, cw, hw, rank: RANK[street.kind] ?? -1, slot: 0,
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
  const covered = (p: Prepared, layer: Band["layer"], pts: readonly [number, number][]): boolean => {
    if (layer === "deck") return false;
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

  for (const p of prepared) {
    const { street } = p;
    const nx = p.tz;
    const nz = -p.tx;
    const bands: Band[] = [];
    if (street.kind === "wharf") {
      bands.push({ t0: -p.hw, t1: 0, colour: DECK, lift, layer: "deck" }, { t0: 0, t1: p.hw, colour: DECK, lift, layer: "deck" });
    } else {
      const flat = street.kind === "alley" ? ALLEY : ASPHALT;
      const up = lift + ASPHALT_OVER + RANK_LIFT * p.rank + SLOT_LIFT * p.slot;
      bands.push({ t0: -p.cw, t1: 0, colour: flat, lift: up, layer: "asphalt" }, { t0: 0, t1: p.cw, colour: flat, lift: up, layer: "asphalt" });
      if (p.hw > p.cw) bands.push({ t0: -p.hw, t1: -p.cw, colour: SIDEWALK, lift, layer: "sidewalk" }, { t0: p.cw, t1: p.hw, colour: SIDEWALK, lift, layer: "sidewalk" });
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
      emit([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], { t0, t1, colour, lift: lift + over, layer: "sidewalk" });
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
