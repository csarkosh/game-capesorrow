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
import { PATCH_ASPHALT as ASPHALT } from "./palette.js";
import { PARKING_LANE, ROADWAY_LIFT } from "./streetGeometry.js";
import type { P2 } from "./surface.js";
import type { RoadWearContext } from "./roadWear.js";

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
  const wearAt = (s: number): number => (edge.paving.find((q) => s < q.s1) ?? (edge.paving[edge.paving.length - 1]!)).wear;
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

  /** A rectangle (half sizes `hl` along, `hw` across) at (cs, ct) turned by `ang`, its two long sides bowed a little so no edge is ruled. */
  const patch = (cs: number, ct: number, hl: number, hw: number, ang: number, over: Over, lift: number, tag: number, bow = 0.07): void => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const r = (x: number, z: number): P2 => {
      const q = rot(x, z, c, s);
      return at(cs + q[0], ct + q[1]);
    };
    const j = (i: number): number => (hashN(k2, tag, i, 31) - 0.5) * 2 * bow;
    const pts: P2[] = [r(-hl + j(0), -hw), r(hl + j(1), -hw + j(2) * 0.5), r(hl + j(3), hw), r(-hl + j(2), hw + j(0) * 0.5)];
    surf.flat(pts, ROADWAY_LIFT + lift, ASPHALT, over);
  };
  const g = (k: number): [number, number, number] => [k, k, k * 0.99];

  // ---- Large patches: by what made them.
  const count = Math.floor((total / 34) * (0.55 + 0.75 * (1 - use * 0.3)) + hashN(k2, 0, 0, 1));
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
      hl = 2.2 + 4.5 * hashN(k2, i, 0, 5);
      hw = travel * (0.7 + 0.25 * hashN(k2, i, 0, 6));
      ct = side * (travel * 0.95 + (p.cw - travel * 2) * 0.1);
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.04;
      over = { layer: "asphalt_dark", tint: g(0.55 + 0.25 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.04 };
    } else if (roll < 0.58) {
      // An old repair: pale, squared, drier.
      hl = 1.1 + 2.3 * hashN(k2, i, 0, 5);
      hw = 0.7 + Math.min(travel * 0.8, 1.6) * hashN(k2, i, 0, 6);
      ct = side * (0.3 + (p.cw - 1.4 - hw) * hashN(k2, i, 0, 9));
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.5;
      over = { layer: "asphalt", tint: g(1.6 + 0.6 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.03 };
    } else if (roll < 0.8) {
      // A trench along the street, where a main runs under it.
      hl = 2.5 + 3.5 * hashN(k2, i, 0, 5);
      hw = 0.3 + 0.28 * hashN(k2, i, 0, 6);
      ct = side * p.cw * (0.15 + 0.5 * hashN(k2, i, 0, 9));
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.05;
      over = { layer: "asphalt_dark", tint: g(0.55 + 0.15 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.05 };
    } else {
      // A trench across, edge to edge.
      hl = 0.3 + 0.3 * hashN(k2, i, 0, 5);
      hw = p.cw - 0.7;
      ct = 0;
      ang = (hashN(k2, i, 0, 7) - 0.5) * 0.4;
      over = { layer: "asphalt_dark", tint: g(0.6 + 0.15 * hashN(k2, i, 0, 8)), frame: frameOver, rank: RANK.mark, dirt: 0.05 };
    }
    const reach = Math.abs(hl * Math.cos(ang)) + Math.abs(hw * Math.sin(ang));
    if (!inside(cs - reach, cs + reach)) continue;
    patch(cs, ct, hl, hw, ang, over, 0.0015, i);
    tally.utilityCuts++;
  }

  // ---- Wheel tracks and the oil between them.
  if (kind !== "alley" && kind !== "wharf" && use > 0.25 && !low) {
    const polish = 0.5 + 0.5 * use;
    for (const [a, b] of intervals) {
      const n = Math.max(1, Math.round((b - a) / 9));
      for (const sg of [1, -1]) {
        const c0 = sg * travel;
        for (let i = 0; i < n; i++) {
          const s0 = a + ((b - a) * i) / n;
          const s1 = a + ((b - a) * (i + 1)) / n - 0.05;
          const here = (s0 + s1) / 2;
          // A lane that is driven is worn all along; a quiet street's has gaps.
          const present = hashN(k2, i, sg + 5, 40) < 0.3 + 0.7 * polish;
          const light = (1.15 + 0.22 * vnoise(k2 ^ 0x51, here, 25) + 0.12 * wearAt(here)) * (0.85 + 0.2 * polish);
          if (present) {
            for (const d of [-0.78, 0.78]) {
              const w = 0.12 + 0.05 * hashN(k2, i, sg + d * 3, 41);
              surf.flat([at(s0, c0 + d - w), at(s1, c0 + d - w * 1.1), at(s1, c0 + d + w * 1.1), at(s0, c0 + d + w)], ROADWAY_LIFT + 0.0012, ASPHALT, { layer: "asphalt", tint: g(light), frame: fr(), rank: RANK.mark, dirt: 0.02 });
            }
          }
          // The oil strip: dark, in blobs along the lane's middle.
          if (hashN(k2, i, sg + 5, 42) < 0.2 + 0.4 * polish) {
            const o0 = s0 + (s1 - s0) * 0.1 * hashN(k2, i, sg, 43);
            const o1 = o0 + (s1 - s0) * (0.4 + 0.5 * hashN(k2, i, sg, 44));
            surf.flat([at(o0, c0 - 0.14), at(o1, c0 - 0.1), at(o1, c0 + 0.1), at(o0, c0 + 0.14)], ROADWAY_LIFT + 0.0014, ASPHALT, { layer: "asphalt_dark", tint: g(0.62), frame: fr(), rank: RANK.mark, dirt: 0.1 });
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
      const n = Math.max(1, Math.round((b - a) / (low ? 10 : 4.5)));
      for (let i = 0; i < n; i++) {
        const s0 = a + ((b - a) * i) / n;
        const s1 = a + ((b - a) * (i + 1)) / n;
        const q = (s: number, t: number): P2 => at(s, sg * t);
        if (side.curb) {
          const m = vnoise(ek, s0, 14) * (0.4 + 0.9 * shade);
          if (m < 0.42) continue;
          const w = 0.2 + 0.35 * clamp01((m - 0.42) * 2.2);
          surf.flat([q(s0, p.cw - w), q(s1, p.cw - w * (0.7 + 0.6 * hashN(ek, i, 0, 50))), q(s1, p.cw), q(s0, p.cw)], ROADWAY_LIFT + 0.0028, ASPHALT, { layer: "moss", tint: [0.62, 0.78, 0.38], frame: fr(), rank: RANK.detail, dirt: 0.1 });
        } else {
          const m = vnoise(ek ^ 3, s0, 9);
          if (m < 0.38) continue;
          const w = 0.3 + 0.9 * clamp01((m - 0.38) * 1.8);
          surf.flat([q(s0, p.cw - w * (0.5 + 0.5 * hashN(ek, i, 1, 51))), q(s1, p.cw - w), q(s1, p.cw - 0.04), q(s0, p.cw - 0.04)], ROADWAY_LIFT + 0.0026, ASPHALT, { layer: "mud", tint: [0.62, 0.55, 0.42], frame: fr(), rank: RANK.detail, dirt: 0.25 });
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
    surf.flat(pts, ROADWAY_LIFT + 0.0034, ASPHALT, { layer: "asphalt_dark", tint: [0.42, 0.45, 0.5], frame: fr(), rank: RANK.top, dirt: 0 });
  }
}
