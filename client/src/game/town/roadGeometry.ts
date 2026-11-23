/**
 * The roads out of town (`plan.roads`) and what they end at. A road is drawn as strips that follow the ground, its
 * surface by its length: asphalt while it is paved, gravel, and at the last two wheel tracks with the ground between;
 * the width narrows along it as the plan says. Where it ends the plan names a destination, drawn crudely, each with
 * what the place needs:
 *
 * - **A cemetery**: a plot of 36 by 28 m behind a fence of posts and two rails with a gap where the road comes in, and three rows of headstones.
 * - **A landing**: a gravel flat where logs were loaded, and stacks of logs at its edge.
 * - **A gravel pit**: a gravel flat with a darker floor.
 * - **A water tank**: a tank on four legs on a gravel pad.
 * - **A gate**: two posts and a bar across the road.
 *
 * The destinations' standing parts go in the solid layer; none is a wall to the rules.
 */
import { RANK, flatSurfaceFor } from "./groundSurfaces.js";
import { Surface } from "./surface.js";
import { FENCE, GRAVEL, HEADSTONE, LOG, ROAD_ASPHALT, TANK, TIMBER, TRACK } from "./palette.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";
import { STREET_LIFT } from "./streetGeometry.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import type { Road } from "../../sim/town/types.js";

/** A road lies this far over the ground, under every street's asphalt (the least of them is about 0.081). */
export const ROAD_LIFT = STREET_LIFT + 0.014;
/** The wheel tracks: a track's width and the distance of its middle from the road's centre, metres. */
export const TRACK_WIDTH = 0.7;
export const TRACK_OFFSET = 1;
/** A strip is cut every this many metres along a road. */
export const ROAD_TILE = 6;

const UP: Vec3 = [0, 1, 0];

export function roadGeometry(g: TownGround, flat: Sink, solid: Sink): void {
  const surf = new Surface(g, flat);
  for (const road of g.plan.roads) {
    const pts = road.points.map((p) => ({ x: g.anchor.x + p.x, z: g.anchor.z + p.z, w: p.width, s: p.surface }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as (typeof pts)[number];
      const b = pts[i] as (typeof pts)[number];
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      if (!(len > 0.1)) continue;
      const tx = (b.x - a.x) / len;
      const tz = (b.z - a.z) / len;
      const nx = tz;
      const nz = -tx;
      const n = Math.max(1, Math.ceil(len / ROAD_TILE));
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const at = (t: number, off: number): [number, number] => [a.x + (b.x - a.x) * t + nx * off, a.z + (b.z - a.z) * t + nz * off];
        const wAt = (t: number): number => a.w + (b.w - a.w) * t;
        const surface = (t0 + t1) / 2 < 0.5 ? a.s : b.s;
        const strip = (o0: number, o1: number, colour: Rgb, lift: number): void => {
          // The strip's corners, off the centre line by `o0` and `o1` of the half width (or metres where `abs`).
          const corners = [at(t0, o0), at(t1, o0), at(t1, o1), at(t0, o1)];
          const pp = corners.map(([x, z]): Vec3 => [x, g.heightAt(x, z) + lift, z]);
          if (pp.every((q) => q[1] - lift < SEA + 0.1)) return;
          surf.lay(flat(corners[0]![0], corners[0]![1]), pp, pp.map(() => lift), colour, flatSurfaceFor(colour, g.anchor), RANK.mark);
        };
        const w0 = wAt(t0) / 2;
        const w1 = wAt(t1) / 2;
        if (surface === "tracks") {
          for (const sg of [-1, 1]) strip(sg * (TRACK_OFFSET - TRACK_WIDTH / 2), sg * (TRACK_OFFSET + TRACK_WIDTH / 2), TRACK, ROAD_LIFT);
        } else {
          // The road's width at each end of the tile, the corners tapering along it.
          const c = [at(t0, -w0), at(t1, -w1), at(t1, w1), at(t0, w0)];
          const pp = c.map(([x, z]): Vec3 => [x, g.heightAt(x, z) + ROAD_LIFT, z]);
          if (!pp.every((q) => q[1] - ROAD_LIFT < SEA + 0.1)) {
            const colour = surface === "paved" ? ROAD_ASPHALT : GRAVEL;
            surf.lay(flat(c[0]![0], c[0]![1]), pp, pp.map(() => ROAD_LIFT), colour, flatSurfaceFor(colour, g.anchor), RANK.mark);
          }
        }
      }
    }
    destinationGeometry(g, road, flat, solid);
  }
}

function destinationGeometry(g: TownGround, road: Road, flat: Sink, solid: Sink): void {
  const d = road.destination;
  const x = g.anchor.x + d.x;
  const z = g.anchor.z + d.z;
  const last = road.points[road.points.length - 1] as Road["points"][number];
  const before = road.points[Math.max(0, road.points.length - 3)] as Road["points"][number];
  const dl = Math.sqrt((last.x - before.x) * (last.x - before.x) + (last.z - before.z) * (last.z - before.z)) || 1;
  // The road's direction at its end, and across it.
  const ox = (last.x - before.x) / dl;
  const oz = (last.z - before.z) / dl;
  const nx = oz;
  const nz = -ox;
  const at = (s: number, t: number): [number, number] => [x + ox * s + nx * t, z + oz * s + nz * t];
  const h = (px: number, pz: number): number => g.heightAt(px, pz);
  const disc = (cx: number, cz: number, r: number, colour: Rgb, lift: number): void => {
    // A 12-gon as fans from its middle, so each tile follows the ground (corners from a table, no trigonometry).
    const ring = RING12.map(([c, s]): [number, number] => [cx + r * c, cz + r * s]);
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k] as [number, number];
      const q = ring[(k + 1) % ring.length] as [number, number];
      const tri: [number, number][] = [[cx, cz], p, q];
      const pp = tri.map(([px, pz]): Vec3 => [px, h(px, pz) + lift, pz]);
      if (pp.every((v) => v[1] - lift < SEA + 0.1)) continue;
      flat(cx, cz).poly(pp, UP, colour, flatSurfaceFor(colour, g.anchor));
    }
  };
  const post = (px: number, pz: number, height: number, colour: Rgb): void => solid(px, pz).box(px, pz, h(px, pz) - 0.05, 1, 0, 0.08, 0.08, height, colour, colour);
  const bar = (ax: number, az: number, bx: number, bz: number, y: number, colour: Rgb, thick = 0.05): void => {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (!(len > 0.01)) return;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    solid(mx, mz).box(mx, mz, Math.max(h(ax, az), h(bx, bz)) + y, ux, uz, len / 2, thick, thick * 2, colour, colour);
  };
  switch (d.kind) {
    case "cemetery": {
      // A plot of 36 by 28 m past the road's end, its fence with a gap on the road's side.
      const half = { s: 18, t: 14 };
      const c0 = at(half.s + 2, 0);
      const cx = c0[0];
      const cz = c0[1];
      const corner = (ss: number, tt: number): [number, number] => [cx + ox * ss * half.s + nx * tt * half.t, cz + oz * ss * half.s + nz * tt * half.t];
      const sides: [[number, number], [number, number], boolean][] = [
        [corner(-1, -1), corner(1, -1), false],
        [corner(1, -1), corner(1, 1), false],
        [corner(1, 1), corner(-1, 1), false],
        [corner(-1, 1), corner(-1, -1), true],
      ];
      for (const [p, q, gapSide] of sides) {
        const len = Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
        const m = Math.ceil(len / 4);
        // From the second post: the first is the last of the side before (a corner's post is one post).
        for (let k = 1; k <= m; k++) {
          const t = k / m;
          const px = p[0] + (q[0] - p[0]) * t;
          const pz = p[1] + (q[1] - p[1]) * t;
          if (gapSide && Math.abs(t - 0.5) < 0.12) continue;
          post(px, pz, 1.1, FENCE);
        }
        for (const y of [0.45, 0.9]) {
          if (gapSide) {
            const mx = (p[0] + q[0]) / 2;
            const mz = (p[1] + q[1]) / 2;
            const gx = ((q[0] - p[0]) / len) * 1.7;
            const gz = ((q[1] - p[1]) / len) * 1.7;
            bar(p[0], p[1], mx - gx, mz - gz, y, FENCE);
            bar(mx + gx, mz + gz, q[0], q[1], y, FENCE);
          } else bar(p[0], p[1], q[0], q[1], y, FENCE);
        }
      }
      // Three rows of headstones, facing the road.
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 6; col++) {
          const [sx, sz] = [cx + ox * (-6 + row * 6) + nx * (-10 + col * 4), cz + oz * (-6 + row * 6) + nz * (-10 + col * 4)];
          solid(sx, sz).box(sx, sz, h(sx, sz) - 0.05, nx, nz, 0.3, 0.08, 0.95, HEADSTONE, HEADSTONE);
        }
      }
      break;
    }
    case "landing": {
      const [cx, cz] = at(d.radius * 0.6, 0);
      disc(cx, cz, d.radius * 0.8, GRAVEL, ROAD_LIFT);
      // Stacks of logs at the edge, three to a stack.
      for (const t of [-8, 0, 8]) {
        const [lx, lz] = at(d.radius * 1.05, t);
        for (let k = 0; k < 3; k++) solid(lx, lz).box(lx + nx * (k - 1) * 1.1, lz + nz * (k - 1) * 1.1, h(lx, lz) + (k === 1 ? 0.9 : 0), ox, oz, 3.2, 0.5, 0.9, LOG, LOG);
      }
      break;
    }
    case "gravel pit": {
      const [cx, cz] = at(d.radius * 0.5, 0);
      disc(cx, cz, d.radius * 0.8, GRAVEL, ROAD_LIFT);
      disc(cx + ox * 2, cz + oz * 2, d.radius * 0.45, TRACK, ROAD_LIFT + 0.004);
      break;
    }
    case "water tank": {
      const [cx, cz] = at(5, 0);
      disc(cx, cz, 7, GRAVEL, ROAD_LIFT);
      const base = Math.max(h(cx - 1.5, cz - 1.5), h(cx + 1.5, cz + 1.5), h(cx - 1.5, cz + 1.5), h(cx + 1.5, cz - 1.5));
      for (const [lx, lz] of [[-1.7, -1.7], [1.7, -1.7], [1.7, 1.7], [-1.7, 1.7]] as const) solid(cx + lx, cz + lz).box(cx + lx, cz + lz, h(cx + lx, cz + lz) - 0.05, 1, 0, 0.15, 0.15, base - h(cx + lx, cz + lz) + 4.05, FENCE, FENCE);
      solid(cx, cz).box(cx, cz, base + 4, ox, oz, 2.4, 2.4, 3.2, TANK, TANK);
      break;
    }
    case "gate": {
      const half = last.width / 2 + 0.8;
      const a = at(1, -half);
      const b = at(1, half);
      post(a[0], a[1], 1.7, TIMBER);
      post(b[0], b[1], 1.7, TIMBER);
      bar(a[0], a[1], b[0], b[1], 1.0, FENCE, 0.06);
      bar(a[0], a[1], b[0], b[1], 1.4, FENCE, 0.06);
      break;
    }
  }
}

/** A circle's twelve corners as (cos, sin), written once. */
const RING12: readonly (readonly [number, number])[] = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5],
  [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];
