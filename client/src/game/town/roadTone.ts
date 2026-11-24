/**
 * The roadway's tone at the scale a player sees from a block away (30 to 100 m): large areas of different asphalt, laid by what caused them.
 *
 * - **Resurfaced lanes** (new black asphalt, 2 to 9 m long, a lane wide): the town's crews mended a lane and not its neighbour.
 * - **Old repairs** (pale grey, squared): a patch of the older mix, drier and lighter than what is round it.
 * - **Utility trenches**: strips along the street 5 to 12 m long, and across it, edge to edge, where a main crosses.
 * - **Wheel tracks**: the two paths of each lane worn pale and polished by tyres, with a darker oil strip between them, in pieces with gaps; the more
 *   used the street, the more continuous.
 * - **Spill and moss at the edge**: mud and gravel dragged in from an unpaved shoulder over the ragged asphalt edge; a green moss line along
 *   the kerbs of the shaded side.
 * - **Standing water** (dark, smooth) in the low side of the crown where the paving is worn.
 *
 * Marks lie over the roadway by rank (`groundSurfaces.ts`), so none of them can lie in one plane with another. Nothing calls a random function:
 * `hashN` of the street's id and the thing's index.
 */
import { clamp01, hashN, vnoise } from "./groundNoise.js";
import { tally } from "./groundTally.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { PATCH_ASPHALT } from "./palette.js";
import type { Rgb } from "./meshBuilder.js";

/** The flat colour under a pale mark (its texture is the asphalt lightened): not the road's own, so a plain road colour is still every roadway's. */
const PALE: Rgb = [0.19, 0.19, 0.2];
import { PARKING_LANE, ROADWAY_LIFT, roadwayLook } from "./streetGeometry.js";
import { withOver } from "./groundSurfaces.js";
import type { P2 } from "./surface.js";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import type { RoadWearContext } from "./roadWear.js";

/** The wheel tracks and the oil lie between the roadway's marks (`RANK.mark`: a gutter's band, a seam, the gravel dragged from an alley) and its cuts (`RANK.detail`), a rank of their own so none of those cuts a track into slivers. */
const TRACK_RANK = 1.5;

const rot = (x: number, z: number, c: number, s: number): P2 => [x * c - z * s, x * s + z * c];

export function roadTone(ctx: RoadWearContext): void {
  const { surf, p, intervals, key } = ctx;
  const low = ctx.detail === "low";
  const edge = p.edge;
  const len = p.length;
  const use = edge.use;
  const kind = p.street.kind;
  const k2 = key ^ 0x7a31c5;
  const at = (s: number, t: number): P2 => [p.ax + p.tx * s + p.nx * t, p.az + p.tz * s + p.nz * t];
  const frame = { origin: [p.ax, 0, p.az] as const, u: [p.nx, 0, p.nz] as const, v: [p.tx, 0, p.tz] as const };
  const fr = (): Over["frame"] => ({ origin: [...frame.origin], u: [...frame.u], v: [...frame.v] });
  const total = intervals.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
  if (total < 3) return;
  const wearAvg = edge.paving.reduce((s, q) => s + q.wear * (q.s1 - q.s0), 0) / Math.max(1, len);
  const placeAt = (f: number): number => {
    let rest = f * total;
    for (const [a, b] of intervals) {
      const l = Math.max(0, b - a);
      if (rest <= l) return a + rest;
      rest -= l;
    }
    return (intervals[intervals.length - 1] as [number, number])[1];
  };
  const inside = (s0: number, s1: number): boolean => intervals.some(([a, b]) => s0 >= a + 0.2 && s1 <= b - 0.2);
  const travel = kind === "main" ? (p.cw - PARKING_LANE) / 2 : p.cw / 2;
  void len;

  /** A rectangle (half sizes `hl` along, `hw` across) at (cs, ct) turned by `ang`, cut in cells of 3.8 m by 3.2 m (each laid as one polygon on the ground) with its corners nudged so no edge is ruled. */
  const patch = (cs: number, ct: number, hl: number, hw: number, ang: number, over: Over, lift: number, tag: number, pale = false): void => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nS = Math.max(1, Math.ceil((2 * hl) / 3.8));
    const nT = Math.max(1, Math.ceil((2 * hw) / 3.2));
    const pt = (i: number, j: number): P2 => {
      const edgeI = i === 0 || i === nS;
      const edgeJ = j === 0 || j === nT;
      const jx = (hashN(k2, tag, i * 31 + j, 31) - 0.5) * 0.14;
      const jz = (hashN(k2, tag, i * 31 + j, 32) - 0.5) * 0.14;
      const x = -hl + (2 * hl * i) / nS + (edgeI ? 0 : jx);
      const z = -hw + (2 * hw * j) / nT + (edgeJ ? 0 : jz);
      const q = rot(x + (edgeI ? jx * 0.5 : 0), z + (edgeJ ? jz * 0.5 : 0), c, s);
      return at(cs + q[0], ct + q[1]);
    };
    for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) surf.flat([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], ROADWAY_LIFT + lift, pale ? PALE : PATCH_ASPHALT, over);
  };
  const g = (k: number): [number, number, number] => [k, k, k * 0.99];

  /** The boxes (along, across) the patches lie in: a track or an oil strip is not laid over one (two marks of one rank are cut off each other, and the cut leaves slivers). */
  const laid: { s0: number; s1: number; t0: number; t1: number }[] = [];
  // ---- Large patches: by what made them.
  const count = Math.floor((total / 20) * (0.55 + 0.75 * (1 - use * 0.3)) + hashN(k2, 0, 0, 1));
  for (let i = 0; i < count; i++) {
    const roll = hashN(k2, i, 0, 2);
    const cs = placeAt(hashN(k2, i, 0, 3));
    const side = hashN(k2, i, 0, 4) < 0.5 ? 1 : -1;
    const frameOver = fr();
    let hl: number;
    let hw: number;
    let ct: number;
    let ang: number;
    let over: Over;
    if (roll < 0.28) {
      // A lane resurfaced: new black, the lane wide.
      hl = 3 + 7 * hashN(k2, i, 0, 5);
      const outer = p.cw - 1.1;
      hw = ((outer - 0.15) / 2) * (0.75 + 0.25 * hashN(k2, i, 0, 6));
      ct = side * ((outer + 0.15) / 2);
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.04;
      over = { layer: "asphalt_dark", tint: g(0.45 + 0.2 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.04 };
    } else if (roll < 0.58) {
      // An old repair: pale, squared, drier.
      hl = 1.1 + 2.3 * hashN(k2, i, 0, 5);
      hw = 0.7 + Math.min(travel * 0.8, 1.6) * hashN(k2, i, 0, 6);
      ct = side * (0.3 + (p.cw - 1.4 - hw) * hashN(k2, i, 0, 9));
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.5;
      over = { layer: "asphalt", tint: g(2.0 + 0.7 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.03 };
    } else if (roll < 0.8) {
      // A trench along the street, where a main runs under it.
      hl = 1.8 + 3.0 * hashN(k2, i, 0, 5);
      hw = 0.5 + 0.35 * hashN(k2, i, 0, 6);
      ct = side * p.cw * (0.15 + 0.5 * hashN(k2, i, 0, 9));
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.05;
      over = { layer: "asphalt_dark", tint: g(0.55 + 0.15 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.05 };
    } else {
      // A trench across, edge to edge.
      hl = 0.3 + 0.3 * hashN(k2, i, 0, 5);
      hw = p.cw - 1.35;
      ct = 0;
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.4;
      over = { layer: "asphalt_dark", tint: g(0.6 + 0.15 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.05 };
    }
    const reach = Math.abs(hl * Math.cos(ang)) + Math.abs(hw * Math.sin(ang));
    if (!inside(cs - reach, cs + reach)) continue;
    // Not over a seam, and not near the gutter's band (the marks of one rank cut each other, and the cut leaves slivers).
    const tExt = Math.abs(ct) + Math.abs(hl * Math.sin(ang)) + Math.abs(hw * Math.cos(ang));
    if (tExt > p.cw - 1.1 || edge.paving.some((q, ix) => ix > 0 && q.s0 > cs - reach - 0.2 && q.s0 < cs + reach + 0.2)) continue;
    patch(cs, ct, hl, hw, ang, over, 0.0015, i, over.layer === "asphalt");
    laid.push({ s0: cs - reach - 0.2, s1: cs + reach + 0.2, t0: ct - (Math.abs(hl * Math.sin(ang)) + Math.abs(hw * Math.cos(ang))) - 0.2, t1: ct + (Math.abs(hl * Math.sin(ang)) + Math.abs(hw * Math.cos(ang))) + 0.2 });
    tally.utilityCuts++;
  }

  // ---- Wheel tracks and a little oil: soft bands in the roadway's own asphalt, with no edge to point to. A band is a strip 0.6 m wide whose corners carry
  // the roadway's own tone at its sides and a little paler (or darker) along its middle line, laid in the same layer and texture frame as the roadway beside it,
  // so the grain runs on across it and only the tone moves. Long gaps; the more a street is used, the more of it is worn.
  if (kind !== "alley" && kind !== "wharf" && use > 0.4 && !low) {
    const polish = 0.5 + 0.5 * use;
    const anchor = ctx.g.anchor;
    for (const [a, b] of intervals) {
      const n = Math.ceil((b - a) / 3.9);
      for (const sg of [1, -1]) {
        const c0 = sg * travel;
        const present = (i: number): boolean => {
          if (i < 0 || i >= n) return false;
          const here = a + ((b - a) * (i + 0.5)) / n;
          if (edge.paving.some((q, ix) => ix > 0 && q.s0 > here - 2.2 && q.s0 < here + 2.2)) return false;
          return vnoise(k2 ^ (sg > 0 ? 0x33 : 0x77), here, 38) > 0.84 - 0.3 * polish;
        };
        for (let i = 0; i < n; i++) {
          if (!present(i)) continue;
          const s0 = a + ((b - a) * i) / n;
          const s1 = a + ((b - a) * (i + 1)) / n - 0.04;
          const here = (s0 + s1) / 2;
          const ix = Math.max(0, edge.paving.findIndex((q) => here < q.s1));
          const pv = edge.paving[ix] ?? (edge.paving[edge.paving.length - 1] as (typeof edge.paving)[number]);
          const look = roadwayLook(p, pv, ix, key);
          const { tint, ...rest } = look;
          const surface = withOver(undefined, tint, anchor, rest);
          if (surface === undefined) continue;
          const f0 = present(i - 1) ? 1 : 0;
          const f1 = present(i + 1) ? 1 : 0;
          const peak = (0.06 + 0.07 * vnoise(k2 ^ 0x51, here, 25) + 0.04 * pv.wear) * (0.7 + 0.5 * polish);
          for (const d of [-0.78, 0.78]) {
            const w = 0.3;
            // Three lines across (edge, middle, edge) and two along: the middle line is `peak` over the roadway's tone at each end where the band goes on, nothing where it stops.
            const col = (fa: number): Rgb => [tint[0] * (1 + peak * fa), tint[1] * (1 + peak * fa), tint[2] * (1 + peak * fa)];
            const edgeCol: Rgb = [tint[0], tint[1], tint[2]];
                        // One convex polygon of six corners: the band's two ends are each three corners on a line (edge, middle, edge).
            const pts = [at(s0, c0 + d), at(s0, c0 + d + w), at(s1, c0 + d + w), at(s1, c0 + d), at(s1, c0 + d - w), at(s0, c0 + d - w)];
            if (pts.some((q) => Math.abs(q[0] - ctx.g.roadX(q[1])) < ROAD_BED_HALF + 0.6)) continue;
            const verts = pts.map((q): [number, number, number] => [q[0], ctx.g.heightAt(q[0], q[1]) + ROADWAY_LIFT + 0.0012, q[1]]);
            const cs: Rgb[] = [col(f0), edgeCol, edgeCol, col(f1), edgeCol, edgeCol];
            surf.sink((pts[0]![0] + pts[3]![0]) / 2, (pts[0]![1] + pts[3]![1]) / 2).poly(verts, [0, 1, 0], cs, surface, { rank: TRACK_RANK });
          }
          // A dark patch of oil in the lane's middle, now and then: a soft band too, a little darker than the roadway.
          if (hashN(k2, i, sg + 5, 42) < 0.12 + 0.2 * polish) {
            const o0 = s0 + (s1 - s0) * 0.15;
            const o1 = s0 + (s1 - s0) * (0.55 + 0.35 * hashN(k2, i, sg, 44));
            const dk = 1 - 0.14;
            const dcol: Rgb = [tint[0] * dk, tint[1] * dk, tint[2] * dk];
            const edgeCol: Rgb = [tint[0], tint[1], tint[2]];
            const pts = [at(o0, c0), at(o0, c0 + 0.22), at(o1, c0 + 0.22), at(o1, c0), at(o1, c0 - 0.22), at(o0, c0 - 0.22)];
            if (pts.some((q) => Math.abs(q[0] - ctx.g.roadX(q[1])) < ROAD_BED_HALF + 0.6)) continue;
            const verts = pts.map((q): [number, number, number] => [q[0], ctx.g.heightAt(q[0], q[1]) + ROADWAY_LIFT + 0.0014, q[1]]);
            surf.sink((pts[0]![0] + pts[3]![0]) / 2, (pts[0]![1] + pts[3]![1]) / 2).poly(verts, [0, 1, 0], [edgeCol, edgeCol, edgeCol, dcol, edgeCol, edgeCol], surface, { rank: TRACK_RANK });
          }
        }
      }
    }
  }

  // ---- The edges: moss along shaded kerbs, mud dragged in where there is no curb.
  for (const sg of [1, -1]) {
    const side = edge.sides[sg > 0 ? 0 : 1];
    if (side === undefined || side === null) continue;
    const ek = k2 ^ (sg > 0 ? 0x1b : 0xb1);
    // The side's outward direction is (sg * n); a side whose lots lie to the south is in the shade of what stands there (z is north).
    const shade = clamp01(0.35 - sg * p.nz * 0.65);
    for (const [a, b] of intervals) {
      const n = Math.max(1, Math.round((b - a) / (low ? 10 : 3.9)));
      for (let i = 0; i < n; i++) {
        const s0 = a + ((b - a) * i) / n;
        const s1 = a + ((b - a) * (i + 1)) / n;
        const q = (s: number, t: number): P2 => at(s, sg * t);
        if (side.curb) {
          const m = vnoise(ek, s0, 14) * (0.4 + 0.9 * shade);
          if (m < 0.55) continue;
          const w = 0.15 + 0.3 * clamp01((m - 0.55) * 2.2);
          surf.flat([q(s0, p.cw - w), q(s1, p.cw - w * (0.7 + 0.6 * hashN(ek, i, 0, 50))), q(s1, p.cw), q(s0, p.cw)], ROADWAY_LIFT + 0.0028, PATCH_ASPHALT, { layer: "moss", tint: [0.62, 0.78, 0.38], frame: fr(), rank: RANK.detail, dirt: 0.1 });
        } else {
          const m = vnoise(ek ^ 3, s0, 9);
          if (m < 0.38) continue;
          const w = 0.3 + 0.9 * clamp01((m - 0.38) * 1.8);
          surf.flat([q(s0, p.cw - w * (0.5 + 0.5 * hashN(ek, i, 1, 51))), q(s1, p.cw - w), q(s1, p.cw - 0.04), q(s0, p.cw - 0.04)], ROADWAY_LIFT + 0.0026, PATCH_ASPHALT, { layer: "mud", tint: [0.62, 0.55, 0.42], frame: fr(), rank: RANK.detail, dirt: 0.25 });
        }
      }
    }
  }

  // ---- Standing water in the low side of the crown, where the paving has settled.
  const pools = Math.floor((total / 60) * (0.2 + 2.2 * wearAvg) + hashN(k2, 0, 0, 60) * 0.8);
  for (let i = 0; i < pools; i++) {
    const cs = placeAt(hashN(k2, i, 0, 61));
    const sg = hashN(k2, i, 0, 62) < 0.5 ? 1 : -1;
    const rl = 0.9 + 1.5 * hashN(k2, i, 0, 63);
    const rw = 0.35 + 0.45 * hashN(k2, i, 0, 64);
    const ct = sg * (p.cw - 0.55 - rw - 0.5 * hashN(k2, i, 0, 65));
    if (!inside(cs - rl * 1.2, cs + rl * 1.2)) continue;
    const m = 7;
    const pts: P2[] = Array.from({ length: m }, (_, k) => {
      const a = (k / m) * Math.PI * 2;
      const rr = 0.78 + 0.34 * hashN(k2, i, k, 66);
      return at(cs + Math.cos(a) * rl * rr, ct + Math.sin(a) * rw * rr);
    });
    surf.flat(pts, ROADWAY_LIFT + 0.0034, PATCH_ASPHALT, { layer: "asphalt_dark", tint: [0.42, 0.45, 0.5], frame: fr(), rank: RANK.top, dirt: 0 });
  }
}
