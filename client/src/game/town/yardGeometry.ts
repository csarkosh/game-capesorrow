/**
 * The ground of each lot where the engine's own grass and dirt cannot do it: what the lot's story (`port/yards.ts`) lays on it.
 *
 * - **A drive** from the street to the house, by its kind: gravel (a bed of it, patchy at its edges with the grass coming in), a dirt
 *   two-track (two bare ruts with grass between), or a concrete ribbon drive (two strips, cracked, mossy at the edges). Where it crosses the verge
 *   the earth is worn bare across the drive's width.
 * - **A front walk** of slabs from the sidewalk to the door, as broken and as overgrown as the yard is neglected (`Yard.walk.wear`).
 * - **A bare yard** has patches of packed dirt and a gravel pad for the vehicles in front of the house; a **shaggy** or **mown** one a worn
 *   path or two; a **mossy** one blobs of moss under its trees.
 * - **The verge** is worn to dirt where people walk (a desire line across it from the curb to the sidewalk, now and then) and where they
 *   park (a gravel pull-off on the verge or the shoulder beside a bare yard).
 *
 * The grass itself is the engine's, shut off where these lie by the mask (`clearing.ts`, `yardShapes.ts`). Nothing here calls a random
 * function: `hashN` of the lot's id. Every number is authored. Props (cars, fences, bins) are another pass.
 */
import { lotIdAt } from "../../sim/town/lotIndex.js";
import { yardShape, type YardRect } from "../../sim/town/yardShapes.js";
import { pavedGround } from "../../sim/town/pavedGround.js";
import type { Street, TownPlan, Yard } from "../../sim/town/types.js";
import { clamp01, hashN, hashS } from "./groundNoise.js";
import { tally } from "./groundTally.js";
import { RANK, type Over } from "./groundSurfaces.js";
import type { Rgb } from "./meshBuilder.js";
import { GRAVEL, SIDEWALK } from "./palette.js";
import { Surface, type P2 } from "./surface.js";
import type { Sink, TownGround } from "./townTypes.js";
import type { UvFrame } from "./townSurface.js";

/** Yard surfaces lie this much over the ground (over what the engine paints, which grows through them). */
export const YARD_OVER = 0.04;

export function yardGeometry(g: TownGround, flat: Sink): void {
  const { plan, anchor } = g;
  const surf = new Surface(g, flat);
  // A lone business's lot is paved over where a vehicle stands (`pavedGround.ts`).
  const apronLots = new Set<number>();
  for (const q of pavedGround(plan)) if (q.kind === "apron") apronLots.add(q.lot);
  for (const yard of plan.yards) {
    if (yard.kind === "paved") continue;
    const lot = plan.lots[yard.lot];
    if (lot === undefined) continue;
    const shape = yardShape(plan, yard.lot);
    const key = Math.imul(yard.lot + 11, 2654435);
    const w = (x: number, z: number): P2 => [x + anchor.x, z + anchor.z];
    /** A point in the rectangle's frame: `a` along (into the lot) and `b` across. */
    const at = (r: YardRect, a: number, b: number): P2 => w(r.x + r.dx * a - r.dz * b, r.z + r.dz * a + r.dx * b);
    const frame = (r: YardRect, k: number): UvFrame => ({ origin: [r.x + anchor.x + hashN(key, k, 0, 1) * 4, 0, r.z + anchor.z + hashN(key, k, 0, 2) * 4], u: [r.dx, 0, r.dz], v: [-r.dz, 0, r.dx] });

    // (A lone business's lot has its apron instead: its walk and any patch would lie a hand's breadth under it.)
    if (!apronLots.has(yard.lot)) {
      if (shape.drive !== null && yard.drive !== null) drive(surf, shape.drive, yard, key, at, frame);
      if (shape.walk !== null && yard.walk !== null) walk(surf, shape.walk, yard.walk.wear, key, at, frame);
      patches(surf, plan, yard, shape.drive, key, w);
    }
    verge(surf, plan, yard, shape.front, shape.drive, key, w);
  }

}

/** A drive: gravel bed, dirt two-track or concrete ribbon, in stretches of 2 m along, its edges wandering. */
function drive(surf: Surface, r: YardRect, yard: Yard, key: number, at: (r: YardRect, a: number, b: number) => P2, frame: (r: YardRect, k: number) => UvFrame): void {
  tally.drives++;
  const kind = yard.drive?.kind ?? "gravel";
  const n = Math.max(1, Math.ceil(r.length / 2));
  for (let i = 0; i < n; i++) {
    const a0 = (r.length * i) / n;
    const a1 = (r.length * (i + 1)) / n;
    const wob = (a: number, k: number): number => 0.07 * hashS(key, Math.round(a * 10), k, 3);
    if (kind === "gravel") {
      const f = frame(r, i);
      const over: Over = { layer: "gravel", tint: [0.88 + 0.1 * hashN(key, i, 0, 4), 0.84, 0.78], frame: f, dirt: 0.22, wear: 0.1 };
      surf.flat([at(r, a0, -r.half + wob(a0, 1)), at(r, a1, -r.half + wob(a1, 1)), at(r, a1, r.half + wob(a1, 2)), at(r, a0, r.half + wob(a0, 2))], YARD_OVER, GRAVEL, over);
    } else {
      // Two tracks, 0.7 m wide, 0.55 m in from each side; grass (the engine's) grows between and beside them.
      for (const sg of [-1, 1]) {
        const c = sg * (r.half - 0.6);
        const hw = 0.33 + 0.05 * hashN(key, i, sg, 5);
        const f = frame(r, i * 2 + (sg > 0 ? 1 : 0));
        const over: Over =
          kind === "dirt"
            ? { layer: "mud", tint: [0.9, 0.86, 0.78], frame: f, dirt: 0.12, wear: 0.05 }
            : { layer: "sidewalk", tint: [0.74 + 0.1 * hashN(key, i, sg, 6), 0.73, 0.69], frame: f, dirt: 0.3, wear: 0.3 };
        surf.flat([at(r, a0, c - hw + wob(a0, sg)), at(r, a1, c - hw + wob(a1, sg)), at(r, a1, c + hw + wob(a1, sg + 3)), at(r, a0, c + hw + wob(a0, sg + 3))], YARD_OVER, SIDEWALK, over);
      }
    }
  }
}

/** A front walk: slabs of 1.2 to 1.6 m, each its own tone; the overgrown ones broken, cracked, with weeds and some gone. */
function walk(surf: Surface, r: YardRect, wear: number, key: number, at: (r: YardRect, a: number, b: number) => P2, frame: (r: YardRect, k: number) => UvFrame): void {
  tally.frontWalks++;
  let a = 0;
  let i = 0;
  while (a < r.length - 0.2) {
    const len = Math.min(r.length - a, 1.2 + 0.4 * hashN(key, i, 0, 10));
    const a1 = a + len;
    const roll = hashN(key, i, 0, 11);
    const gone = wear > 0.55 && hashN(key, i, 0, 12) < 0.25 * wear;
    if (!gone) {
      const t = 0.72 + 0.12 * roll;
      const f = frame(r, i + 20);
      const jitter = 0.03 * hashS(key, i, 0, 13);
      surf.flat([at(r, a + 0.01, -r.half), at(r, a1 - 0.01, -r.half + jitter), at(r, a1 - 0.01, r.half), at(r, a + 0.01, r.half - jitter)], YARD_OVER, SIDEWALK, { layer: "sidewalk", tint: [t, t * 0.99, t * 0.94], frame: f, wear: clamp01(0.1 + 0.6 * wear), dirt: clamp01(0.1 + 0.5 * wear) });
    }
    // Grass over the edge: a blob of moss tinted green, more of them as the walk goes to weeds.
    if (hashN(key, i, 0, 14) < 0.2 + 0.7 * wear) {
      const c = at(r, a + len * hashN(key, i, 0, 15), (hashN(key, i, 0, 16) - 0.5) * r.half * 1.8);
      blob(surf, c, 0.12 + 0.28 * wear * hashN(key, i, 0, 17), YARD_OVER + 0.004, key + i, "moss", [0.9, 1.0, 0.62]);
    }
    a = a1;
    i++;
  }
}

/** A convex blob of six to eight corners, radius `r` with a roll on each, as one polygon. */
function blob(surf: Surface, c: P2, r: number, lift: number, key: number, layer: "mud" | "moss" | "gravel", tint: Rgb, extra: Over = {}): void {
  tally.yardPatches++;
  const n = 7;
  const ring: P2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.4 * hashS(key, k, 0, 30);
    const rr = r * (0.8 + 0.4 * hashN(key, k, 0, 31));
    ring.push([c[0] + Math.cos(a) * rr * 1.15, c[1] + Math.sin(a) * rr]);
  }
  surf.flat(ring, lift, GRAVEL, { layer, tint, frame: { origin: [c[0], 0, c[1]], u: [1, 0, 0], v: [0, 0, 1] }, rank: lift > YARD_OVER + 0.002 ? RANK.detail : RANK.mark, ...extra });
}

/** Patches on the lawn by the yard's kind: packed dirt and a gravel pad (bare), a worn path (shaggy, mown), moss under the trees (mossy). */
function patches(surf: Surface, plan: TownPlan, yard: Yard, drive: YardRect | null, key: number, w: (x: number, z: number) => P2): void {
  const b = plan.buildings.find((q) => q.lot === yard.lot && q.kind !== "pier");
  if (b === undefined) return;
  // A spot about the building: out from its centre by a roll of metres, any way; none if it falls off the lot.
  const around = (k: number, near: number, far: number): P2 | null => {
    const ang = hashN(key, k, 0, 40) * Math.PI * 2;
    const d = near + (far - near) * hashN(key, k, 0, 41);
    const x = b.centre.x + Math.cos(ang) * d;
    const z = b.centre.z + Math.sin(ang) * d;
    return lotIdAt(plan, x, z) === yard.lot ? w(x, z) : null;
  };
  void drive;
  const put = (c: P2 | null, r: number, lift: number, k: number, layer: "mud" | "moss" | "gravel", tint: Rgb, extra: Over = {}): void => {
    if (c !== null) blob(surf, c, r, lift, k, layer, tint, extra);
  };
  const reachA = Math.max(b.halfAlong, b.halfAcross);
  if (yard.kind === "bare") {
    const count = 2 + Math.floor(hashN(key, 0, 0, 42) * 3);
    for (let k = 0; k < count; k++) put(around(k, reachA + 1, reachA + 6), 1.0 + 2.2 * hashN(key, k, 0, 43), YARD_OVER, key + k, "mud", [0.9, 0.85, 0.76], { dirt: 0.15, wear: 0.05 });
    put(around(7, reachA + 2, reachA + 5), 2.0 + 1.5 * hashN(key, 7, 0, 44), YARD_OVER + 0.003, key + 7, "gravel", [0.9, 0.85, 0.78], { dirt: 0.25 });
  } else if (yard.kind === "mossy") {
    const count = 3 + Math.floor(hashN(key, 0, 0, 45) * 4);
    for (let k = 0; k < count; k++) put(around(k + 10, reachA + 0.5, reachA + 9), 1.1 + 2.6 * hashN(key, k, 0, 46), YARD_OVER, key + k + 50, "moss", [0.85, 0.95, 0.58]);
  } else if ((yard.kind === "shaggy" || yard.kind === "mown") && hashN(key, 0, 0, 47) < 0.5) {
    const count = 1 + Math.floor(hashN(key, 0, 0, 48) * 2);
    for (let k = 0; k < count; k++) put(around(k + 20, reachA + 0.5, reachA + 5), 0.6 + 1.2 * hashN(key, k, 0, 49), YARD_OVER, key + k + 90, "mud", [0.85, 0.8, 0.72], { dirt: 0.2 });
  }
}

/** The verge worn bare: across a drive's width where it crosses, a desire line from the curb to the sidewalk now and then, and a pull-off for a bare yard. */
function verge(surf: Surface, plan: TownPlan, yard: Yard, front: { a: { x: number; z: number }; b: { x: number; z: number } } | null, drive: YardRect | null, key: number, w: (x: number, z: number) => P2): void {
  if (front === null) return;
  const lot = plan.lots[yard.lot];
  if (lot === undefined) return;
  const mx = (front.a.x + front.b.x) / 2;
  const mz = (front.a.z + front.b.z) / 2;
  const fx = lot.front.x;
  const fz = lot.front.z;
  // The street the lot fronts: a grid street whose right of way's edge runs along the frontage.
  let st: Street | null = null;
  let best = Infinity;
  for (const s of plan.streets) {
    if (s.kind !== "street" && s.kind !== "main" && s.kind !== "avenue") continue;
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const l2 = dx * dx + dz * dz;
    let t = ((mx - s.a.x) * dx + (mz - s.a.z) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.sqrt((mx - s.a.x - dx * t) * (mx - s.a.x - dx * t) + (mz - s.a.z - dz * t) * (mz - s.a.z - dz * t));
    const err = Math.abs(d - s.width / 2);
    if (err < best) {
      best = err;
      st = s;
    }
  }
  if (st === null || best > 1.2) return;
  const edge = plan.edges[st.id];
  if (edge === undefined) return;
  const cw = st.roadway / 2;
  const hw = st.width / 2;
  const dx = st.b.x - st.a.x;
  const dz = st.b.z - st.a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const tx = dx / len;
  const tz = dz / len;
  const sideLeft = (mx - st.a.x) * -tz + (mz - st.a.z) * tx > 0;
  const side = edge.sides[sideLeft ? 0 : 1];
  // Outward from the lot's front line toward the street, in `u` metres; the sidewalk takes the first `walk`, the curb the last 0.4.
  const u0 = side.walk > 0 ? side.walk + 0.1 : 0;
  const u1 = hw - cw - (side.curb ? 0.45 : side.verge * 0.9);
  if (u1 - u0 < 0.4) return;
  // Along the frontage.
  const ax = front.a.x;
  const az = front.a.z;
  const fl = Math.sqrt((front.b.x - ax) * (front.b.x - ax) + (front.b.z - az) * (front.b.z - az));
  const gx = (front.b.x - ax) / fl;
  const gz = (front.b.z - az) / fl;
  const P = (s: number, u: number): P2 => w(ax + gx * s + fx * u, az + gz * s + fz * u);
  const patch = (s0: number, s1: number, k: number, layer: "mud" | "gravel", tint: Rgb): void => {
    const steps = Math.max(1, Math.ceil((u1 - u0) / 1.2));
    for (let i = 0; i < steps; i++) {
      const ua = u0 + ((u1 - u0) * i) / steps;
      const ub = u0 + ((u1 - u0) * (i + 1)) / steps;
      const j = (n: number): number => 0.09 * hashS(key, k * 8 + i, n, 60);
      surf.flat([P(s0 + j(1), ua), P(s1 + j(2), ua), P(s1 + j(3), ub), P(s0 + j(4), ub)], YARD_OVER, GRAVEL, { layer, tint, frame: { origin: [ax, 0, az], u: [gx, 0, gz], v: [fx, 0, fz] }, dirt: 0.2, wear: layer === "mud" ? 0.05 : 0.1, rank: RANK.mark });
    }
  };
  if (drive !== null) {
    const s = (drive.x - ax) * gx + (drive.z - az) * gz;
    patch(s - drive.half - 0.2, s + drive.half + 0.2, 0, yard.drive?.kind === "dirt" || yard.kind === "bare" ? "mud" : "gravel", yard.drive?.kind === "dirt" ? [0.9, 0.85, 0.76] : [0.88, 0.84, 0.78]);
  }
  // A desire line: a bare path 0.5 m wide from the curb to the sidewalk, on a third of the lots (more where the yard is kept).
  if (side.curb && hashN(key, 0, 0, 61) < 0.33) {
    const s = fl * (0.15 + 0.7 * hashN(key, 0, 0, 62));
    patch(s - 0.25, s + 0.25, 1, "mud", [0.85, 0.8, 0.72]);
  }
  // A pull-off for the vehicles of a bare yard: a pad 2.6 m wide and 6 m long beside the pavement.
  if (yard.kind === "bare" && hashN(key, 0, 0, 63) < 0.6) {
    const s = fl * (0.1 + 0.4 * hashN(key, 0, 0, 64));
    patch(s, Math.min(fl - 0.3, s + 6), 2, "gravel", [0.85, 0.8, 0.72]);
  }
}
