/**
 * What time and use have done to a street's roadway, laid over it. Each thing has a cause, and where the cause is absent it is
 * absent:
 *
 * - **Utility cuts** (patches of darker, newer asphalt): rectangles 1 to 3.6 m by 0.6 to 1.5 m at their own angles, the water and
 *   sewer crews' trenches; about one every 60 m on a street, more where it is mended more (the busy ones), some overlapping the last
 *   (a second trench beside it), each with a sealed seam round it. A cut's asphalt is the newer, darker layer.
 * - **Sealed cracks**: dark lines of 4 to 6 bends, mostly along the street, the number following how worn the paving is.
 * - **Potholes**: dark irregular holes 15 to 45 cm across with a broken rim, on the least-used streets and the most worn paving
 *   (a main street's are mended the week they open); none on fresh paving.
 * - **The gutter's band** of needles, leaves and dirt along a curbed side: 12 to 70 cm wide with an inner edge that wanders, wider
 *   where the street is little swept (the less-used) and its lots are shady or neglected.
 * - **Gravel tracked on** from an alley's mouth: a fan of it dragged a metre or two into the street.
 * - **Manhole covers** at junctions and every 90 m or so along a street, and storm drains (grates) at the low point of each curb
 *   return and about every 80 m of curb.
 *
 * Nothing here calls a random function: `hashN` of the street's id and the thing's index. Every number is authored.
 */
import type { Junction, StreetEdge, TownPlan } from "../../sim/town/types.js";
import type { WJunction } from "./junctionWorld.js";
import { arcPoints } from "../../sim/town/junctionShape.js";
import { clamp01, hashN, hashS, vnoise } from "./groundNoise.js";
import { tally } from "./groundTally.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { GRAVEL, PATCH_ASPHALT as ASPHALT } from "./palette.js";
import { ROADWAY_LIFT, type PS } from "./streetGeometry.js";
import type { P2, RoadSet, Surface } from "./surface.js";
import type { Detail, TownGround } from "./townTypes.js";
import { roadTone } from "./roadTone.js";

export type RoadWearContext = { g: TownGround; surf: Surface; road: RoadSet; p: PS; plan: TownPlan; intervals: readonly [number, number][]; junctions: readonly Junction[]; key: number; detail?: Detail };


/** The wear's own lifts over the roadway: a cut, its seam, a crack, a pothole. */
const CUT = 0.003;
const SEAM_LIFT = 0.0045;
/** Half the width of the sealed seam round a cut. */
const SEAM_HALF = 0.025;

const rot = (x: number, z: number, c: number, s: number): P2 => [x * c - z * s, x * s + z * c];

export function roadWear(ctx: RoadWearContext): void {
  const { g, surf, p, intervals, key, plan } = ctx;
  const edge: StreetEdge = p.edge;
  const len = p.length;
  const use = edge.use;
  const at = (s: number, t: number): P2 => [p.ax + p.tx * s + p.nx * t, p.az + p.tz * s + p.nz * t];
  const wearAt = (s: number): number => (edge.paving.find((q) => s < q.s1) ?? (edge.paving[edge.paving.length - 1]!)).wear;
  const decadeAt = (s: number): number => (edge.paving.find((q) => s < q.s1) ?? (edge.paving[edge.paving.length - 1]!)).decade;
  const frame = { origin: [p.ax, 0, p.az] as const, u: [p.nx, 0, p.nz] as const, v: [p.tx, 0, p.tz] as const };
  const dark = (k: number, rank: number = RANK.detail): Over => ({ rank, layer: "asphalt_dark", tint: [k, k, k], frame: { origin: [...frame.origin], u: [...frame.u], v: [...frame.v] } });
  const total = intervals.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
  /** A place in the roadways' intervals, by a fraction 0 to 1 of their total length. */
  const placeAt = (f: number): number => {
    let rest = f * total;
    for (const [a, b] of intervals) {
      const l = Math.max(0, b - a);
      if (rest <= l) return a + rest;
      rest -= l;
    }
    return intervals.length > 0 ? (intervals[intervals.length - 1] as [number, number])[1] : 0;
  };
  const insideInterval = (s0: number, s1: number): boolean => intervals.some(([a, b]) => s0 >= a + 0.2 && s1 <= b - 0.2);
  if (total < 3) return;

  // ---- Utility cuts: darker, newer asphalt in rectangles at angles, some overlapping the one before.
  const cuts = Math.floor(total / 60 * (0.55 + 0.9 * (1 - use * 0.4)) + hashN(key, 0, 0, 100));
  for (let i = 0; i < cuts; i++) {
    const hl = 0.5 + 0.65 * hashN(key, i, 0, 101) + 0.65 * hashN(key, i, 0, 102);
    const hw = 0.3 + 0.45 * hashN(key, i, 0, 103);
    const ang = (hashN(key, i, 0, 104) - 0.5) * 1.1;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rec = (cs: number, ct: number, hl2: number, hw2: number, a2: number, lift: number): void => {
      const cc = Math.cos(a2);
      const ss = Math.sin(a2);
      const r = (x: number, z: number): P2 => {
        const q = rot(x, z, cc, ss);
        return at(cs + q[0], ct + q[1]);
      };
      const corners: P2[] = [r(-hl2, -hw2), r(hl2, -hw2), r(hl2, hw2), r(-hl2, hw2)];
      const k = 0.95 + 0.3 * hashN(key, i, 1, 105);
      surf.flat(corners, ROADWAY_LIFT + lift, ASPHALT, { ...dark(k), dirt: 0.06 });
      // The sealed seam round it: four thin dark bands.
      for (let e = 0; e < 4; e++) {
        const a = corners[e] as P2;
        const b = corners[(e + 1) % 4] as P2;
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const el = Math.sqrt(ex * ex + ez * ez) || 1;
        const nx = (-ez / el) * SEAM_HALF;
        const nz = (ex / el) * SEAM_HALF;
        // The bands along the first and third edges stop short of the corners, where the second and fourth cross them.
        const cut = e % 2 === 0 ? SEAM_HALF / el : 0;
        const ax = a[0] + ex * cut;
        const az = a[1] + ez * cut;
        const bx = b[0] - ex * cut;
        const bz = b[1] - ez * cut;
        surf.flat([[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]], ROADWAY_LIFT + SEAM_LIFT, ASPHALT, dark(0.32, RANK.top));
      }
    };
    const cs = placeAt(hashN(key, i, 0, 106));
    const reach = Math.abs(hl * s) + Math.abs(hw * c);
    const room = Math.max(0, p.cw - 0.45 - reach);
    const ct = (hashN(key, i, 0, 107) * 2 - 1) * room;
    const lreach = Math.abs(hl * c) + Math.abs(hw * s);
    if (!insideInterval(cs - lreach, cs + lreach)) continue;
    tally.utilityCuts++;
    rec(cs, ct, hl, hw, ang, CUT);
    // A second trench beside the first, at its own angle, laid over it a millimetre higher.
    if (hashN(key, i, 0, 108) < 0.3) {
      const ds = (hashN(key, i, 0, 109) - 0.5) * 2.2;
      const dt = (hashN(key, i, 0, 110) - 0.5) * 1.4;
      const hl2 = 0.4 + 0.7 * hashN(key, i, 0, 111);
      const hw2 = 0.25 + 0.3 * hashN(key, i, 0, 112);
      const a2 = ang + (hashN(key, i, 0, 113) - 0.5) * 1.6;
      const cs2 = cs + ds;
      if (insideInterval(cs2 - 2, cs2 + 2) && Math.abs(ct + dt) < p.cw - 1.2) {
        tally.utilityCuts++;
        rec(cs2, ct + dt, hl2, hw2, a2, CUT + 0.0008);
      }
    }
  }

  // ---- Sealed cracks: bending dark lines, mostly along the street, more of them where the paving is worn.
  const wearAvg = (edge.paving.reduce((s, q) => s + q.wear * (q.s1 - q.s0), 0)) / Math.max(1, len);
  const cracks = Math.floor(total / 38 * (0.3 + 1.6 * wearAvg) + hashN(key, 0, 0, 120));
  for (let i = 0; i < cracks; i++) {
    const along = hashN(key, i, 0, 121) < 0.72;
    const n = 4 + Math.floor(hashN(key, i, 0, 122) * 3);
    const step = 0.9 + 1.0 * hashN(key, i, 0, 123);
    const s0 = placeAt(hashN(key, i, 0, 124));
    const t0 = (hashN(key, i, 0, 125) * 2 - 1) * (p.cw - 0.6);
    const pts: [number, number][] = [];
    let s = s0;
    let t = t0;
    for (let k = 0; k <= n; k++) {
      pts.push([s, t]);
      if (along) {
        s += step;
        t += hashS(key, i, k, 126) * 0.14;
      } else {
        t += step * (hashN(key, i, 0, 127) < 0.5 ? 1 : -1) * 0.8;
        s += hashS(key, i, k, 128) * 0.22;
      }
    }
    tally.roadCracks++;
    const w = 0.014 + 0.016 * hashN(key, i, 0, 129);
    const sealed = hashN(key, i, 0, 130) < 0.55;
    for (let k = 0; k < n; k++) {
      const a = pts[k] as [number, number];
      const b = pts[k + 1] as [number, number];
      if (!insideInterval(Math.min(a[0], b[0]), Math.max(a[0], b[0])) || Math.abs(a[1]) > p.cw - 0.3 || Math.abs(b[1]) > p.cw - 0.3) continue;
      const ds = b[0] - a[0];
      const dt = b[1] - a[1];
      const dl = Math.sqrt(ds * ds + dt * dt) || 1;
      const os = (-dt / dl) * w;
      const ot = (ds / dl) * w;
      surf.flat([at(a[0] - os, a[1] - ot), at(b[0] - os, b[1] - ot), at(b[0] + os, b[1] + ot), at(a[0] + os, a[1] + ot)], ROADWAY_LIFT + 0.0025, ASPHALT, dark(sealed ? 0.3 : 0.5, RANK.crack));
    }
  }

  // ---- Potholes: the least-used streets and the worst paving.
  const holes = Math.floor(total / 110 * (1 - use) * (0.3 + 2.2 * wearAvg) * 1.6 + hashN(key, 0, 0, 140) * (1 - use));
  for (let i = 0; i < holes; i++) {
    const cs = placeAt(hashN(key, i, 0, 141));
    if (wearAt(cs) < 0.45 || decadeAt(cs) >= 2010) continue;
    const ct = (hashN(key, i, 0, 142) * 2 - 1) * (p.cw - 0.7);
    const r = 0.16 + 0.3 * hashN(key, i, 0, 143) * hashN(key, i, 0, 144) * 2;
    if (!insideInterval(cs - r * 1.3, cs + r * 1.3)) continue;
    tally.potholes++;
    const n = 8;
    const ring = (k: number, scale: number): P2 => {
      const a = (k / n) * Math.PI * 2;
      const rr = r * scale * (0.72 + 0.5 * hashN(key, i, k, 145));
      return at(cs + Math.cos(a) * rr * 1.2, ct + Math.sin(a) * rr);
    };
    // The broken rim (a darker, bitten ring), then the hole itself in dirt.
    surf.flat(Array.from({ length: n }, (_, k) => ring(k, 1.35)), ROADWAY_LIFT + 0.002, ASPHALT, dark(0.42));
    surf.flat(Array.from({ length: n }, (_, k) => ring(k, 0.95)), ROADWAY_LIFT + 0.0035, ASPHALT, { rank: RANK.top, layer: "mud", tint: [0.5, 0.46, 0.4], frame: { origin: [cs, 0, ct], u: [1, 0, 0], v: [0, 0, 1] }, dirt: 0.3 });
  }

  // ---- The gutter's band of needles, leaves and dirt, along each curbed side.
  for (const sg of [1, -1]) {
    const side = edge.sides[sg > 0 ? 0 : 1];
    if (!side?.curb) continue;
    const gkey = key ^ (sg > 0 ? 0x5a : 0xa5);
    for (const [a, b] of intervals) {
      const n = Math.max(1, Math.round((b - a) / 2));
      const width = (s: number): number => {
        // Wider where the street is little swept (the less-used) and by a slow roll along it; some stretches are swept clean.
        const slow = vnoise(gkey, s, 18);
        const clean = slow < 0.25 ? 0.15 : 1;
        return clamp01(0.1 + (0.55 * (1 - use * 0.6)) * slow * clean + 0.14 * vnoise(gkey ^ 0x33, s, 2.2)) * 0.95 + 0.04;
      };
      for (let i = 0; i < n; i++) {
        const s0 = a + ((b - a) * i) / n;
        const s1 = a + ((b - a) * (i + 1)) / n;
        const w0 = width(s0);
        const w1 = width(s1);
        if (w0 < 0.08 && w1 < 0.08) continue;
        const t = p.cw;
        const q = (s: number, tt: number): P2 => at(s, sg * tt);
        const moss = vnoise(gkey ^ 7, s0, 12) * 0.28;
        surf.flat([q(s0, t - w0), q(s1, t - w1), q(s1, t), q(s0, t)], ROADWAY_LIFT + 0.0022, ASPHALT, { rank: RANK.mark, layer: "mud", tint: [0.55, 0.52, 0.42], frame: { origin: [p.ax + hashN(gkey, i, 0, 151) * 4, 0, p.az + hashN(gkey, i, 0, 152) * 4], u: [p.tx, 0, p.tz], v: [p.nx, 0, p.nz] }, wear: moss, dirt: 0.3 });
      }
    }
  }

  // ---- Manholes along the street and storm drains along its curbs.
  const holesN = Math.floor(total / 90 + hashN(key, 0, 0, 160));
  for (let i = 0; i < holesN; i++) {
    const cs = placeAt(hashN(key, i, 0, 161));
    manhole(surf, at(cs, (hashN(key, i, 0, 162) - 0.5) * 1.4), key + i);
  }
  for (const sg of [1, -1]) {
    const side = edge.sides[sg > 0 ? 0 : 1];
    if (!side?.curb) continue;
    const n = Math.floor(total / 80 + hashN(key, sg, 0, 165));
    for (let i = 0; i < n; i++) {
      const cs = placeAt(hashN(key, i, sg, 166));
      if (!insideInterval(cs - 0.6, cs + 0.6)) continue;
      drain(surf, at(cs, sg * (p.cw - 0.25)), p.tx, p.tz, key + i * 7);
    }
  }
  roadTone(ctx);
  void g;
  void plan;
}

/** A manhole cover: a rusted disc 62 cm across in a darker ring. */
export function manhole(surf: Surface, c: P2, key: number): void {
  tally.manholes++;
  const n = 12;
  const disc = (r: number): P2[] => Array.from({ length: n }, (_, k) => [c[0] + Math.cos((k / n) * Math.PI * 2) * r, c[1] + Math.sin((k / n) * Math.PI * 2) * r] as P2);
  surf.flat(disc(0.37), ROADWAY_LIFT + 0.002, ASPHALT, { rank: RANK.detail, layer: "asphalt_dark", tint: [0.35, 0.35, 0.35] });
  surf.flat(disc(0.31), ROADWAY_LIFT + 0.0032, ASPHALT, { rank: RANK.top, layer: "asphalt_dark", tint: [0.3 + 0.08 * hashN(key, 0, 0, 170), 0.24, 0.21], frame: { origin: [c[0], 0, c[1]], u: [1, 0, 0], v: [0, 0, 1] }, wear: 0.3, wearKind: "rust", dirt: 0.1 });
}

/** A storm drain's grate: 85 by 32 cm, dark, set along the curb (its long side along (tx, tz)). */
export function drain(surf: Surface, c: P2, tx: number, tz: number, key: number): void {
  tally.drains++;
  const hl = 0.43;
  const hw = 0.17;
  const nx = -tz;
  const nz = tx;
  const q = (a: number, b: number): P2 => [c[0] + tx * a + nx * b, c[1] + tz * a + nz * b];
  surf.flat([q(-hl - 0.05, -hw - 0.05), q(hl + 0.05, -hw - 0.05), q(hl + 0.05, hw + 0.05), q(-hl - 0.05, hw + 0.05)], ROADWAY_LIFT + 0.002, ASPHALT, { rank: RANK.detail, layer: "asphalt_dark", tint: [0.3, 0.3, 0.3] });
  surf.flat([q(-hl, -hw), q(hl, -hw), q(hl, hw), q(-hl, hw)], ROADWAY_LIFT + 0.0032, ASPHALT, { rank: RANK.top, layer: "asphalt_dark", tint: [0.2 + 0.05 * hashN(key, 0, 0, 171), 0.17, 0.15], frame: { origin: [c[0], 0, c[1]], u: [tx, 0, tz], v: [nx, 0, nz] }, wear: 0.2, wearKind: "rust", dirt: 0.2 });
}

/**
 * What a junction has: the gravel dragged from an alley's mouth into the street (a ragged fan of it from the curb line), and at a
 * junction of pavement a manhole near its middle and a storm drain at the low point of each curb return (and, off a curb's end, none).
 */
export function junctionWear(g: TownGround, surf: Surface, junctions: readonly WJunction[], plan: TownPlan): void {
  const { anchor } = g;
  for (const j of junctions) {
    const key = Math.imul(j.id + 5, 2246822);
    if (j.kind === "alley" && j.alley !== null) {
      const a = j.alley;
      const st = plan.streets[a.street];
      if (st === undefined) continue;
      const hw = st.width / 2;
      const cw = st.roadway / 2;
      // From the alley toward the street's middle.
      const dx = -a.dx;
      const dz = -a.dz;
      const ox = -dz;
      const oz = dx;
      const base: P2 = [a.x + anchor.x + dx * (hw - cw), a.z + anchor.z + dz * (hw - cw)];
      const w = a.width / 2 + 0.3 + 0.5 * hashN(key, 0, 0, 180);
      const L = 0.9 + 1.4 * hashN(key, 0, 0, 181);
      const pt = (u: number, v: number): P2 => [base[0] + ox * u + dx * v, base[1] + oz * u + dz * v];
      surf.flat([pt(-w, 0), pt(w, 0), pt(w * 0.75, L * 0.55), pt(w * 0.2 * hashS(key, 0, 0, 182), L), pt(-w * 0.7, L * 0.6)], ROADWAY_LIFT + 0.003, GRAVEL, { rank: RANK.mark, layer: "gravel", tint: [0.85, 0.8, 0.72], frame: { origin: [base[0], 0, base[1]], u: [ox, 0, oz], v: [dx, 0, dz] }, dirt: 0.4 });
      continue;
    }
    if (j.polygon.length < 3) continue;
    manhole(surf, [j.x + 1.2 * hashS(key, 0, 0, 190), j.z + 1.2 * hashS(key, 0, 0, 191)], key);
    junctionTone(surf, j, key);
    for (const k of j.corners) {
      if (k.shape !== "arc" || k.c === null || !k.curb) continue;
      const arc = arcPoints(k.c, k.ta, k.tb, k.radius);
      const m = Math.floor(arc.length / 2);
      const p0 = arc[m - 1] as { x: number; z: number };
      const p1 = arc[m + 1] as { x: number; z: number };
      const mid = arc[m] as { x: number; z: number };
      const tl = Math.sqrt((p1.x - p0.x) * (p1.x - p0.x) + (p1.z - p0.z) * (p1.z - p0.z)) || 1;
      const tx = (p1.x - p0.x) / tl;
      const tz = (p1.z - p0.z) / tl;
      // A step inside the curb, away from the arc's centre.
      const cx = mid.x - k.c.x;
      const cz = mid.z - k.c.z;
      const cl = Math.sqrt(cx * cx + cz * cz) || 1;
      if (hashN(key, k.from, 0, 192) < 0.75) {
        drain(surf, [mid.x + (cx / cl) * 0.22, mid.z + (cz / cl) * 0.22], tx, tz, key + k.from);
        // The water that has not gone down it lies in front of it, in the road.
        if (hashN(key, k.from, 0, 193) < 0.7) {
          const px = mid.x + (cx / cl) * -0.7;
          const pz = mid.z + (cz / cl) * -0.7;
          const m = 7;
          const rl = 0.9 + 1.1 * hashN(key, k.from, 0, 194);
          const rw = 0.5 + 0.5 * hashN(key, k.from, 0, 195);
          surf.flat(Array.from({ length: m }, (_, q) => [px + tx * Math.cos((q / m) * 6.283) * rl * (0.8 + 0.3 * hashN(key, k.from, q, 196)) + (cx / cl) * -Math.sin((q / m) * 6.283) * rw, pz + tz * Math.cos((q / m) * 6.283) * rl * (0.8 + 0.3 * hashN(key, k.from, q, 196)) + (cz / cl) * -Math.sin((q / m) * 6.283) * rw] as P2), ROADWAY_LIFT + 0.0034, ASPHALT, { rank: RANK.top, layer: "asphalt_dark", tint: [0.42, 0.45, 0.5], dirt: 0 });
        }
      }
    }
  }
}

/**
 * Tone on a junction's pavement: the patches of the crews that dug it up (it is where the mains cross), a dark smear where cars stand to turn, and a
 * puddle at the foot of each curb return (where the water runs to).
 */
function junctionTone(surf: Surface, j: WJunction, key: number): void {
  let reach = Infinity;
  for (const l of j.legs) reach = Math.min(reach, l.half);
  if (!(reach > 2.4) || !(reach < 20)) return;
  const frame = { origin: [j.x, 0, j.z] as const, u: [1, 0, 0] as const, v: [0, 0, 1] as const };
  const over = (layer: "asphalt" | "asphalt_dark", k: number, rank: number, dirt = 0.05): Over => ({ layer, tint: [k, k, k * 0.99], frame: { origin: [...frame.origin], u: [...frame.u], v: [...frame.v] }, rank, dirt });
  const patches = 2 + Math.floor(hashN(key, 0, 0, 200) * 2.4);
  for (let i = 0; i < patches; i++) {
    const a = hashN(key, i, 0, 201) * 6.283;
    const d = reach * (0.2 + 0.45 * hashN(key, i, 0, 202));
    const cx = j.x + Math.cos(a) * d;
    const cz = j.z + Math.sin(a) * d;
    const hl = 0.8 + 1.5 * hashN(key, i, 0, 203);
    const hw = 0.6 + 1.0 * hashN(key, i, 0, 204);
    const ang = hashN(key, i, 0, 205) * 3.1416;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const r = (x: number, z: number): P2 => [cx + x * c - z * s, cz + x * s + z * c];
    const pale = hashN(key, i, 0, 206) < 0.45;
    const k = pale ? 1.45 + 0.35 * hashN(key, i, 0, 207) : 0.6 + 0.15 * hashN(key, i, 0, 207);
    surf.flat([r(-hl, -hw), r(hl, -hw + 0.1 * hashS(key, i, 0, 208)), r(hl + 0.1 * hashS(key, i, 0, 209), hw), r(-hl, hw)], ROADWAY_LIFT + 0.0016, ASPHALT, over(pale ? "asphalt" : "asphalt_dark", k, RANK.mark));
  }
  // The oil where cars wait: a dark smear off the middle.
  const oa = hashN(key, 0, 0, 210) * 6.283;
  const od = reach * 0.3;
  const ox = j.x + Math.cos(oa) * od;
  const oz = j.z + Math.sin(oa) * od;
  const n = 6;
  surf.flat(Array.from({ length: n }, (_, k) => [ox + Math.cos((k / n) * 6.283) * (1.2 + 0.5 * hashN(key, k, 0, 211)), oz + Math.sin((k / n) * 6.283) * (0.8 + 0.4 * hashN(key, k, 0, 212))] as P2), ROADWAY_LIFT + 0.0018, ASPHALT, over("asphalt_dark", 0.7, RANK.mark, 0.15));
}
