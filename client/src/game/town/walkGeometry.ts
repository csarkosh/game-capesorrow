/**
 * A street side's sidewalk, drawn slab by slab. A sidewalk is poured in runs (`port/edges.ts`: each run has a decade and a wear), and
 * each run is cut into slabs by tooled joints about every 1.5 m (5 ft). What makes it a sidewalk of this coast and not a model:
 *
 * - **Each run has its own tone and joint spacing** (a pour's decade: older is greyer and yellower, the spacing is one of 1.35, 1.5,
 *   1.65 or 1.8 m by the run), and each slab a shade of its own; now and then a replaced slab is lighter than its neighbours.
 *   Every slab's texture is turned and shifted by a roll of its own so no two look alike. The joint lengths wander by 4 percent and
 *   no run's joints are where another's are.
 * - **Heave.** At a joint one slab may stand up to 3 cm higher than the other (a slab's edge is lifted, its far edge not), more
 *   often where the run is worn and where the lot beside it is a shady yard of trees (their roots, `YardKind` mossy and brush).
 *   The sidewalk's top is never more than 3 cm over the lot's ground: the surface is the ground (`streetField.ts`) plus this.
 * - **Cracks, broken corners, missing slabs.** A worn slab cracks (a dark line of three or four bends, 1 to 2.5 cm wide), loses a corner
 *   to gravel, or is gone: filled with asphalt or left as gravel with weeds, by the roll of the slab and more where the lot is vacant.
 * - **Dirt and moss** thicken toward the back edge and in the joints (per-vertex wear across the slab, in patches: the shader's
 *   `dirt` and moss overlays); grass blobs and weeds grow over the back edge and out of the joints, and the back edge itself wanders
 *   (its corners move in by up to 18 cm, slowly along the run and by a roll at each joint): never a ruler line.
 * - **A utility cover or two** (a rusted lid on some runs, a water meter's small lid).
 *
 * Every number is authored. Nothing here calls a random function: a slab's rolls are `hashN` of the street's id, the side and the slab's
 * index, so a different street, side or slab has a different roll and a rebuilt plan draws the same.
 */
import { walkAt } from "../../sim/town/port/edges.js";
import { yardAt } from "../../sim/town/lotIndex.js";
import type { SideEdge, WalkRun, YardKind } from "../../sim/town/types.js";
import { CURB_OUT } from "../../sim/town/streetField.js";
import { clamp01, hashN, hashS, smooth, vnoise } from "./groundNoise.js";
import { tally } from "./groundTally.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";
import { SIDEWALK } from "./palette.js";
import { RANK, type Over } from "./groundSurfaces.js";
import { plant } from "./growth.js";
import type { P2, P3, Surface } from "./surface.js";
import type { UvFrame } from "./townSurface.js";

/** The sidewalk's top over the ground, and a joint's: a joint is a groove 1.4 cm wide, a little lower. */
export const WALK_TOP = 0.012;
export const JOINT_WIDTH = 0.014;
export const JOINT_DROP = 0.0035;
/** The most a slab's edge is heaved (a tree root's lift), metres: the sidewalk's top stays within 3 cm of the lot's ground. */
export const HEAVE_MAX = 0.016;
/** The ground's own height is read this far (in metres past the curb line) from the curb, so a vertex near the curb takes the lots' level, not the curb's own slope. */
const LEVEL_FROM = CURB_OUT + 0.01;

/** The street side's frame in the world (see `streetGeometry.ts`'s `PS`): enough to put a point at (s along, t across). */
export type SideFrame = {
  readonly id: number;
  readonly ax: number;
  readonly az: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly cw: number;
  readonly hw: number;
  readonly walk: number;
};

export type WalkContext = {
  readonly surf: Surface;
  readonly frame: SideFrame;
  /** Which side: 1 left of the street's direction, -1 right. */
  readonly sigma: 1 | -1;
  readonly side: SideEdge;
  /** The lot's yard kind at a point of the world (beside the sidewalk), for trees and vacancy; null off every lot. */
  readonly yardKindAt: (s: number) => YardKind | null;
  readonly plan: Parameters<typeof yardAt>[0];
  /** How much the street is used, 0 to 1 (a busy front is walked clear of weeds). */
  readonly use?: number;
  /** The low tier: no moss strips, patches as one polygon, a few tufts. */
  readonly low?: boolean;
};

const lift = (e: number): number => WALK_TOP + e;

export const SPACINGS = [1.35, 1.5, 1.5, 1.65, 1.8] as const;

/** The pour's tint: older concrete is greyer and yellower and darker, newer lighter and bluer. */
export function pourTint(decade: number): Rgb {
  const t = clamp01((decade - 1900) / 120);
  return [0.52 + 0.4 * t, 0.5 + 0.4 * t, 0.43 + 0.45 * t];
}

/** The slabs of one sub-interval [a, b] of a run: stations along the street, from `a` to `b`, the last slab absorbing what remains. */
export function stations(key: number, run: number, a: number, b: number, spacing: number): number[] {
  const out = [a];
  let s = a;
  let k = 0;
  while (true) {
    const step = spacing * (1 + 0.04 * hashS(key, run, k, 11));
    if (b - s - step < spacing * 0.45) break;
    s += step;
    out.push(s);
    k++;
  }
  out.push(b);
  return out;
}

/** One slab's world corners and heights, by position along (s) and across (t). */
export function slabPoint(f: SideFrame, sigma: number, g: (x: number, z: number) => number, s: number, t: number, lift: number): P3 {
  // The ground's height is read at the clamped offset (`LEVEL_FROM` past the curb line at the least), so a vertex near the curb takes the lots' level; the point itself is where it is, its lift over that.
  const tt = Math.max(t, f.cw + LEVEL_FROM);
  const xr = f.ax + f.tx * s + f.nx * sigma * tt;
  const zr = f.az + f.tz * s + f.nz * sigma * tt;
  const x = f.ax + f.tx * s + f.nx * sigma * t;
  const z = f.az + f.tz * s + f.nz * sigma * t;
  // Returned as (x, z, lift over the ground at the point itself): `Surface.poly` adds that ground's height, so the difference of the two readings goes in the lift.
  return tt === t ? [x, z, lift] : [x, z, lift + (g(xr, zr) - g(x, z))];
}

/**
 * Draws the runs of one side between the intervals `free` (the parts of the side not taken by a junction's corner, a ramp or an
 * apron). `treeness` and `vacancy` of the lot beside a slab raise the heave and the weeds.
 */
export function walkSide(ctx: WalkContext, free: readonly (readonly [number, number])[], heightAt: (x: number, z: number) => number, inner: number): void {
  const { surf, frame: f, sigma, side } = ctx;
  const key = Math.imul(f.id + 1, 2654435) ^ (sigma === 1 ? 0x51 : 0xa3);
  const out = f.hw;
  const use = ctx.use ?? 0.5;
  const low = ctx.low === true;
  const slabX = (s: number, t: number): number => f.ax + f.tx * s + f.nx * sigma * t;
  const slabZ = (s: number, t: number): number => f.az + f.tz * s + f.nz * sigma * t;
  const at = (s: number, t: number): P2 => [f.ax + f.tx * s + f.nx * sigma * t, f.az + f.tz * s + f.nz * sigma * t];
  const lat = (p: Vec3): number => (p[0] - f.ax) * f.nx * sigma + (p[2] - f.az) * f.nz * sigma;
  void lat;
  side.runs.forEach((run, runIx) => {
    for (const [fa, fb] of free) {
      const a = Math.max(run.s0, fa);
      const b = Math.min(run.s1, fb);
      if (b - a < 0.12) continue;
      drawRun(a, b, run, runIx);
    }
  });

  function drawRun(a: number, b: number, run: WalkRun, runIx: number): void {
    const spacing = SPACINGS[Math.floor(hashN(key, runIx, 0, 3) * SPACINGS.length)] as number;
    const st = stations(key, runIx, a, b, spacing);
    const tone = pourTint(run.decade);
    const w = run.wear;
    // The lot beside the run: a shady yard (trees) heaves the sidewalk and shades it, a vacant one is let go.
    const kind = ctx.yardKindAt((a + b) / 2);
    const shady = kind === "mossy" || kind === "brush" ? 1 : kind === "tall" || kind === "shaggy" ? 0.4 : 0;
    const neglected = kind === "brush" || kind === "tall" || kind === null ? 0.6 : kind === "shaggy" ? 0.3 : 0;
    // The edge's wander along this run: slow, with a roll at each joint.
    const wander = (s: number, i: number): number => clamp01(0.025 + (0.04 + 0.12 * w + 0.06 * neglected) * vnoise(key ^ 0x77, s, 5) + (0.03 + 0.05 * w) * hashN(key, runIx, i, 5));
    // A joint's heave: 0 or up to HEAVE_MAX, raised on the slab to its right or the one to its left.
    const heave = (i: number): [number, number] => {
      const chance = 0.1 + 0.5 * w + 0.22 * shady;
      if (hashN(key, runIx, i, 7) > chance) return [0, 0];
      const h = (0.35 + 0.65 * hashN(key, runIx, i, 8)) * HEAVE_MAX;
      return hashN(key, runIx, i, 9) < 0.5 ? [h, 0] : [0, h];
    };
    for (let i = 0; i + 1 < st.length; i++) {
      const s0 = st[i] as number;
      const s1 = st[i + 1] as number;
      const hj0 = i === 0 ? [0, 0] : heave(i);
      const hj1 = i + 2 >= st.length ? [0, 0] : heave(i + 1);
      // This slab's start edge is lifted by the joint's right-hand share, its end by the next joint's left-hand share.
      const l0 = hj0[1] as number;
      const l1 = hj1[0] as number;
      const j0 = i === 0 ? 0 : JOINT_WIDTH / 2;
      const j1 = i + 2 >= st.length ? 0 : JOINT_WIDTH / 2;
      const ss0 = s0 + j0;
      const ss1 = s1 - j1;
      if (ss1 - ss0 < 0.1) continue;
      const roll = hashN(key, runIx, i, 1);
      const replaced = hashN(key, runIx, i, 2) < 0.11;
      const missing = w > 0.45 && hashN(key, runIx, i, 4) < 0.008 + 0.045 * (w - 0.45) + 0.03 * neglected;
      const d0 = wander(ss0, i);
      const d1 = wander(ss1, i + 1);
      const frame = slabFrame(f, key, runIx, i, sigma);
      // Slabs differ a great deal: a new pale replacement beside old dark ones, one in eight stained near black with age.
      const shade = (0.72 + 0.42 * roll) * (replaced ? 1.4 : hashN(key, runIx, i, 150) < 0.12 ? 0.68 : 1);
      const tint: Rgb = [tone[0] * shade, tone[1] * shade, tone[2] * shade];
      const sw = replaced ? 0.25 * w : w;
      const mossK = 0.08 + 0.3 * shady + 0.12 * w;
      const front = Math.max(inner, f.cw + 0.18);
      const slabWear = (p: Vec3): number => {
        const k = clamp01((lat(p) - front) / Math.max(0.3, out - front));
        return replaced ? 0.02 + 0.1 * k : clamp01(0.03 + mossK * (0.2 + 0.9 * k * k) * (0.5 + sw));
      };
      const slabDirt = (p: Vec3): number => {
        const k = clamp01((lat(p) - front) / Math.max(0.3, out - front));
        return replaced ? 0.02 + 0.1 * k : clamp01(0.04 + (0.08 + 0.28 * sw) * (0.2 + 1.0 * k) + 0.14 * neglected * k);
      };
      const over: Over = { layer: "sidewalk", tint, frame, wear: slabWear, dirt: slabDirt, group: "base" };
      const pt = (s: number, t: number, e: number): P3 => slabPoint(f, sigma, heightAt, s, t, lift(e));
      const T0 = front;
      const T1 = out;
      tally.slabs++;
      if (missing) {
        tally.missingSlabs++;
        // Gone: filled with asphalt (a cheap mend) or left as gravel and weeds.
        const asphalt = hashN(key, runIx, i, 6) < 0.35;
        surf.poly([pt(ss0, T0, 0.002), pt(ss1, T0, 0.002), pt(ss1, T1 - d1, 0.002), pt(ss0, T1 - d0, 0.002)], SIDEWALK, asphalt ? { layer: "asphalt_dark", tint: [1.6, 1.6, 1.6], frame, dirt: 0.3, wear: 0.15, group: "base" } : { layer: "gravel", tint: [0.85, 0.8, 0.72], frame, dirt: 0.5, wear: 0.4, group: "base" });
        weeds(ss0, ss1, T0, T1 - d0, 3 + Math.floor(3 * hashN(key, runIx, i, 12)), i, 1, "gravel", [0.85, 0.8, 0.72]);
        grow(ss0, ss1, T0 + 0.05, T1 - 0.1, 2, i, 0.9, 0.4);
      } else {
        surf.poly([pt(ss0, T0, l0), pt(ss1, T0, l1), pt(ss1, T1 - d1, l1), pt(ss0, T1 - d0, l0)], SIDEWALK, over);
        if (!replaced && hashN(key, runIx, i, 13) < 0.07 + 0.6 * w * w) crack(ss0, ss1, T0, T1 - Math.max(d0, d1), l0, l1, i, frame);
        if (!replaced && hashN(key, runIx, i, 14) < 0.02 + 0.22 * w) brokenCorner(ss0, ss1, T0, T1 - d0, T1 - d1, l0, l1, i, frame);
        // Weeds along the back edge, more where the run is worn and the lot beside it neglected.
        const edgeWeeds = Math.floor(hashN(key, runIx, i, 15) * (0.5 + 2.4 * sw + 1.8 * neglected));
        if (edgeWeeds > 0 && hashN(key, runIx, i, 130) < 0.6) weeds(ss0, ss1, T1 - 0.45, T1 - Math.min(d0, d1), 1, i, 0.8 + neglected, "sidewalk", tint);
        // Moss along the back edge and the kerb line: wear that is full at the edge and none a hand's breadth in, so the noise leaves it ragged.
        const mossy = 0.45 + 0.8 * shady + 0.5 * sw;
        if (!low && hashN(key, runIx, i, 140) < 0.22 + 0.25 * mossy) {
          const tb = Math.min(T1 - d0, T1 - d1);
          const wd = 0.17 + 0.12 * hashN(key, runIx, i, 141);
          const amt = 0.7 + 0.3 * hashN(key, runIx, i, 142);
          const wearAt = (q: Vec3): number => clamp01(amt * (1 - clamp01((tb - lat(q)) / wd)));
          surf.poly([pt(ss0, tb - wd, l0), pt(ss1, tb - wd, l1), pt(ss1, tb, l1), pt(ss0, tb, l0)], SIDEWALK, { layer: "sidewalk", tint, frame, wear: wearAt, wearKind: "moss", rank: RANK.mark });
        }
        if (!low && hashN(key, runIx, i, 143) < 0.2 + 0.2 * mossy) {
          const wd = 0.12 + 0.1 * hashN(key, runIx, i, 144);
          const amt = 0.6 + 0.4 * hashN(key, runIx, i, 145);
          const wearAt = (q: Vec3): number => clamp01(amt * (1 - clamp01((lat(q) - T0) / wd)));
          surf.poly([pt(ss0, T0, l0), pt(ss1, T0, l1), pt(ss1, T0 + wd, l1), pt(ss0, T0 + wd, l0)], SIDEWALK, { layer: "sidewalk", tint, frame, wear: wearAt, wearKind: "moss", rank: RANK.mark });
        }
        // The crack between sidewalk and wall: a row of tufts along the back edge, thick where the run is old or the lot is let go; a few along the kerb line.
        const grown = 0.45 + 1.0 * sw + 0.9 * neglected + 0.4 * shady;
        const idle = 1 - 0.3 * use;
        for (let q = ss0 + 0.25; q < ss1 - 0.15; q += 0.45 + 0.5 * hashN(key, runIx, i * 40 + Math.floor((q - ss0) * 10), 100)) {
          const roll100 = hashN(key, runIx, i * 40 + Math.floor((q - ss0) * 10), 101);
          if (roll100 > 0.03 + 0.05 * grown * idle) continue;
          const tb = Math.min(T1 - d0, T1 - d1) - 0.09 - 0.12 * hashN(key, runIx, i * 40 + Math.floor(q - ss0), 102);
          const [px, pz] = at(q, tb);
          plant(px, pz, 1 + 0.5 * hashN(key, runIx, i * 40 + Math.floor(q - ss0), 103), 0.35 + 0.65 * hashN(key, runIx, i * 40 + Math.floor(q - ss0), 104) * (0.5 + 0.5 * grown / 2), 0.15 + 0.3 * hashN(key, runIx, i, 105), key + i * 53 + Math.floor(q * 10), -f.nx * sigma, -f.nz * sigma);
        }
        for (let q = ss0 + 0.2; q < ss1 - 0.15; q += 0.9 + 1.0 * hashN(key, runIx, i * 40 + Math.floor((q - ss0) * 10), 106)) {
          if (hashN(key, runIx, i * 40 + Math.floor((q - ss0) * 10), 107) > 0.03 + 0.04 * grown) continue;
          const [px, pz] = at(q, T0 + 0.04 + 0.05 * hashN(key, runIx, i * 40 + Math.floor(q - ss0), 108));
          plant(px, pz, 1, 0.3 + 0.4 * hashN(key, runIx, i, 110), 0.25, key + i * 59 + Math.floor(q * 10), 0, 0);
        }
        // A crack and a broken corner have weeds in them.
        if (hashN(key, runIx, i, 13) < 0.07 + 0.6 * w * w) grow(ss0, ss1, T0 + 0.3, T1 - 0.4, 1, i, 0.8, 0.3);
        if (hashN(key, runIx, i, 14) < 0.02 + 0.22 * w) grow(ss0, ss1, T0 + 0.3, T1 - 0.3, 2, i, 0.9, 0.3);
      }
      // The joint after this slab: a dark groove, with weeds out of it where the run is old.
      if (i + 2 < st.length) {
        const jy = (e: number): number => WALK_TOP - JOINT_DROP + e;
        const sj0 = ss1;
        const sj1 = ss1 + JOINT_WIDTH;
        surf.poly([slabPoint(f, sigma, heightAt, sj0, T0, jy(0)), slabPoint(f, sigma, heightAt, sj1, T0, jy(0)), slabPoint(f, sigma, heightAt, sj1, T1 - d1, jy(0)), slabPoint(f, sigma, heightAt, sj0, T1 - d1, jy(0))], SIDEWALK, { layer: "mud", tint: [0.55, 0.5, 0.45], frame, dirt: 0.5, rank: RANK.detail });
        if (hashN(key, runIx, i, 16) < 0.25 + 0.55 * w) weeds(sj0 - 0.02, sj1 + 0.02, T0 + 0.1, T1 - 0.15, 1, i, 0.5, "sidewalk", tint);
        // Moss in the joint: a strip a hand wide, full along its middle and none at its edges.
        if (!low && hashN(key, runIx, i, 146) < 0.12 + 0.3 * mossK + 0.1 * w) {
          const hw2 = 0.06 + 0.04 * hashN(key, runIx, i, 147);
          const jc = ss1 + JOINT_WIDTH / 2;
          const amt = 0.7 + 0.3 * hashN(key, runIx, i, 148);
          const wearAt = (q: Vec3): number => clamp01(amt * (1 - Math.abs((q[0] - slabX(jc, T0)) * f.tx + (q[2] - slabZ(jc, T0)) * f.tz) / hw2));
          const mp = (s2: number, t: number): P3 => slabPoint(f, sigma, heightAt, s2, t, WALK_TOP + 0.001);
          const mo: Over = { layer: "sidewalk", tint, frame, wear: wearAt, wearKind: "moss", rank: RANK.mark };
          surf.poly([mp(jc - hw2, T0), mp(jc, T0), mp(jc, T1 - d1), mp(jc - hw2, T1 - d1)], SIDEWALK, mo);
          surf.poly([mp(jc, T0), mp(jc + hw2, T0), mp(jc + hw2, T1 - d1), mp(jc, T1 - d1)], SIDEWALK, mo);
        }
        // Tufts out of the joint: low ones, in most joints of an old run, fewer on a busy front.
        const jn = Math.floor((0.02 + 0.3 * hashN(key, runIx, i, 111)) * (0.35 + 1.1 * w + 0.8 * neglected) * (1 - 0.3 * use));
        for (let q = 0; q < jn; q++) {
          const [px, pz] = at(sj0 + JOINT_WIDTH / 2, T0 + 0.15 + (T1 - T0 - 0.3) * hashN(key, runIx, i * 8 + q, 112));
          plant(px, pz, 1, 0.1 + 0.3 * hashN(key, runIx, i * 8 + q, 113), 0.3, key + i * 61 + q * 7, 0, 0);
        }
      }
    }
    // A utility cover on some runs: a rusted lid, and a water meter's small one.
    if (hashN(key, runIx, 0, 20) < 0.5 && b - a > 4) {
      const s = a + (0.2 + 0.6 * hashN(key, runIx, 0, 21)) * (b - a);
      const t = Math.max(inner, f.cw + 0.18) + (out - Math.max(inner, f.cw + 0.18)) * (0.25 + 0.5 * hashN(key, runIx, 0, 22));
      lid(s, t, 0.46, 0.3, 0);
    }
    if (hashN(key, runIx, 0, 23) < 0.35 && b - a > 4) {
      const s = a + (0.15 + 0.7 * hashN(key, runIx, 0, 24)) * (b - a);
      lid(s, out - 0.35, 0.2, 0.2, 1);
    }

    function lid(s: number, t: number, hs: number, ht: number, round: number): void {
      const n = round === 1 ? 8 : 4;
      const pts: P3[] = [];
      for (let k = 0; k < n; k++) {
        const ang = ((k + 0.5) / n) * Math.PI * 2;
        const ps = round === 1 ? Math.cos(ang) * hs * 0.5 : (k === 0 || k === 3 ? -1 : 1) * hs * 0.5;
        const pt2 = round === 1 ? Math.sin(ang) * ht * 0.5 : (k < 2 ? -1 : 1) * ht * 0.5;
        pts.push(slabPoint(f, sigma, heightAt, s + ps, t + pt2, WALK_TOP + 0.004));
      }
      surf.poly(pts, SIDEWALK, { layer: "rust", tint: [0.55, 0.42, 0.36], frame: slabFrame(f, key, runIx, 900 + Math.floor(s), sigma), dirt: 0.25, rank: RANK.top });
    }

    /** A crack: a dark line of three or four bends from one edge of the slab toward the other. */
    function crack(s0: number, s1: number, t0: number, t1: number, l0: number, l1: number, i: number, frame: UvFrame): void {
      tally.slabCracks++;
      const n = 4;
      const sa = s0 + (s1 - s0) * (0.1 + 0.8 * hashN(key, runIx, i, 30));
      const sb = s0 + (s1 - s0) * (0.1 + 0.8 * hashN(key, runIx, i, 31));
      const width = 0.012 + 0.014 * hashN(key, runIx, i, 32);
      const pts: [number, number][] = [];
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const jitter = k === 0 || k === n ? 0 : 0.12 * (s1 - s0) * hashS(key, runIx, i, 40 + k);
        pts.push([sa + (sb - sa) * u + jitter, t0 + (t1 - t0) * u]);
      }
      for (let k = 0; k < n; k++) {
        const [ps, pt0] = pts[k] as [number, number];
        const [qs, qt] = pts[k + 1] as [number, number];
        const el = Math.sqrt((qs - ps) * (qs - ps) + (qt - pt0) * (qt - pt0)) || 1;
        // The perpendicular in (s, t).
        const os = (-(qt - pt0) / el) * width;
        const ot = ((qs - ps) / el) * width;
        const e = (s: number): number => l0 + (l1 - l0) * clamp01((s - s0) / (s1 - s0)) + 0.0015;
        surf.poly([slabPoint(f, sigma, heightAt, ps - os, pt0 - ot, lift(e(ps))), slabPoint(f, sigma, heightAt, qs - os, qt - ot, lift(e(qs))), slabPoint(f, sigma, heightAt, qs + os, qt + ot, lift(e(qs))), slabPoint(f, sigma, heightAt, ps + os, pt0 + ot, lift(e(ps)))], SIDEWALK, { layer: "mud", tint: [0.38, 0.35, 0.32], frame, dirt: 0.2, rank: RANK.detail });
      }
    }

    /** A corner broken off: a triangle of gravel where the slab's corner was. */
    function brokenCorner(s0: number, s1: number, t0: number, tb0: number, tb1: number, l0: number, l1: number, i: number, frame: UvFrame): void {
      tally.brokenCorners++;
      const atEnd = hashN(key, runIx, i, 50) < 0.5;
      const back = hashN(key, runIx, i, 51) < 0.7;
      const size = 0.18 + 0.3 * hashN(key, runIx, i, 52);
      const sc = atEnd ? s1 : s0;
      const sd = atEnd ? -1 : 1;
      const tc = back ? (atEnd ? tb1 : tb0) : t0;
      const td = back ? -1 : 1;
      const e = (atEnd ? l1 : l0) + 0.002;
      surf.poly([slabPoint(f, sigma, heightAt, sc, tc, lift(e)), slabPoint(f, sigma, heightAt, sc + sd * size * 1.1, tc, lift(e)), slabPoint(f, sigma, heightAt, sc + sd * size * 0.35, tc + td * size, lift(e))], SIDEWALK, { layer: "gravel", tint: [0.75, 0.7, 0.62], frame, dirt: 0.45, rank: RANK.top });
      void s0;
    }

    /** Tufts at random places of a rectangle of the slab (`count` sites, `tall`, `dry` as the place's). */
    function grow(s0: number, s1: number, t0: number, t1: number, count: number, i: number, tall: number, dry: number): void {
      for (let c = 0; c < count; c++) {
        const [px, pz] = at(s0 + (s1 - s0) * hashN(key, runIx, i * 16 + c, 120), t0 + (t1 - t0) * hashN(key, runIx, i * 16 + c, 121));
        plant(px, pz, 1, tall * hashN(key, runIx, i * 16 + c, 122), dry, key + i * 67 + c * 13, 0, 0);
      }
    }

    /** Weed and grass blobs in a rectangle of the slab: irregular fans of triangles in the moss layer, tinted green. */
    function weeds(s0: number, s1: number, t0: number, t1: number, count: number, i: number, scale: number, baseLayer: "sidewalk" | "gravel", baseTint: Rgb): void {
      for (let c = 0; c < count; c++) {
        tally.weedBlobs++;
        const cs = s0 + (s1 - s0) * hashN(key, runIx, i * 16 + c, 60);
        const ct = t0 + (t1 - t0) * hashN(key, runIx, i * 16 + c, 61);
        const r = (0.07 + 0.3 * hashN(key, runIx, i * 16 + c, 62) * hashN(key, runIx, i * 16 + c, 63)) * scale;
        // Irregular growth: seven points with swings in radius and angle (kept star-shaped, so the fan stays whole), the whole stretched along a joint-ish direction (a roll), never a regular ring.
        const n = 5;
        const ring: P3[] = [];
        const rot = (hashN(key, runIx, i * 16 + c, 66) - 0.5) * 0.9;
        const stretch = 1.15 + 0.7 * hashN(key, runIx, i * 16 + c, 67);
        for (let k = 0; k < n; k++) {
          const ang = ((k + 0.3 * hashN(key, runIx, i * 16 + c, 90 + k)) / n) * Math.PI * 2;
          const rr = r * (0.72 + 0.42 * hashN(key, runIx, i * 16 + c, 70 + k));
          const ex = Math.cos(ang) * rr * stretch;
          const ey = Math.sin(ang) * rr;
          const rx = ex * Math.cos(rot) - ey * Math.sin(rot);
          const ry = ex * Math.sin(rot) + ey * Math.cos(rot);
          ring.push(slabPoint(f, sigma, heightAt, cs + rx, Math.min(out - 0.003, ct + ry), WALK_TOP + 0.005));
        }
        const hue = hashN(key, runIx, i * 16 + c, 64);
        if (low) {
          surf.poly(ring, SIDEWALK, { layer: "moss", tint: [0.85 + 0.3 * hue, 0.95 + 0.25 * hue, 0.55 + 0.1 * hue], frame: slabFrame(f, key, runIx, i * 16 + c, sigma), rank: RANK.crack });
          continue;
        }
        // Laid as wear over the slab's own surface: full at the centre, none at the rim, so the material's noise breaks the outline. One triangle a side of the ring, each corner's amount its distance from the middle.
        const mid = slabPoint(f, sigma, heightAt, cs, ct, WALK_TOP + 0.005);
        const reach = r * stretch * 1.1;
        const wear = (q: Vec3): number => clamp01((1 - Math.hypot(q[0] - mid[0], q[2] - mid[1]) / reach) * 2.4);
        const patchFrame = slabFrame(f, key, runIx, i * 16 + c, sigma);
        for (let k = 0; k < n; k++) {
          surf.poly([mid, ring[k] as P3, ring[(k + 1) % n] as P3], SIDEWALK, { layer: baseLayer, tint: baseTint, frame: patchFrame, wear, wearKind: hue < 0.3 ? "leaf" : "growth", rank: RANK.crack });
        }
      }
    }
  }
  void smooth;
}

/** A slab's texture frame: the sidewalk layer turned to one of four ways and shifted, by the slab's own roll. */
function slabFrame(f: SideFrame, key: number, run: number, slab: number, sigma: number): UvFrame {
  const q = Math.floor(hashN(key, run, slab, 80) * 4);
  const ux = f.tx;
  const uz = f.tz;
  const vx = f.nx * sigma;
  const vz = f.nz * sigma;
  const sx = q % 2 === 0 ? 1 : -1;
  const sz = q < 2 ? 1 : -1;
  const turned = q === 1 || q === 2;
  return {
    origin: [f.ax + hashN(key, run, slab, 81) * 3, 0, f.az + hashN(key, run, slab, 82) * 3],
    u: turned ? [vx * sx, 0, vz * sx] : [ux * sx, 0, uz * sx],
    v: turned ? [ux * sz, 0, uz * sz] : [vx * sz, 0, vz * sz],
  };
}

export { walkAt };
