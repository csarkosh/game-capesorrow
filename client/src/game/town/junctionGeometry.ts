/**
 * A junction's own surfaces: the pavement the legs end on, bounded by its curb returns; the curb along each return that has one; the
 * sidewalk of each corner as one piece filling the corner to the two lot lines, where both legs have a sidewalk; the curb ramps with
 * their dome panels, where the corner was rebuilt and the sides have curb and sidewalk; and, at a leg a sharp crossing closed, the
 * strip that closes it and the planter that stops it.
 *
 * A corner has a curb return and a sidewalk only where both legs it joins have them on the sides that meet (`JunctionCorner.curb`,
 * `.walk`, from `port/edges.ts`); where a leg has no curb the pavement turns in a plain radius of asphalt, ragged at its edge, into a
 * gravel shoulder: no curb, no corner sidewalk, no ramp.
 *
 * Heights: every surface lies over the walked ground (`streetField.ts`), which the junction's pavement is cut into by its legs' deepest
 * curb: the pavement `ROADWAY_LIFT`, the sidewalk `WALK_LIFT`, a curb's top at the lots' level read a quarter metre beyond the curb line
 * over a face down to the gutter. The junction is draped over the ground as the strips are, with no plane of its own.
 */
import { onLeg, cornerPolygon, arcPoints, RAMP_RUN, RAMP_LANDING, DOME_DEPTH, type ShapedLeg } from "../../sim/town/junctionShape.js";
import { CURB_OUT } from "../../sim/town/streetField.js";
import type { JunctionCorner, JunctionLeg, Vec } from "../../sim/town/types.js";
import { clamp01, hashN, hashS, smooth } from "./groundNoise.js";
import type { Over } from "./groundSurfaces.js";
import type { Rgb } from "./meshBuilder.js";
import { ASPHALT, CURB, DOME, GRAVEL, PLANTER, SIDEWALK } from "./palette.js";
import { CURB_WIDTH, ROADWAY_LIFT, WALK_LIFT } from "./streetGeometry.js";
import type { WJunction } from "./junctionWorld.js";
import { triangulate, type P2, type P3, type RoadSet, type Surface } from "./surface.js";
import type { Sink, TownGround } from "./townTypes.js";
import type { UvFrame } from "./townSurface.js";

/** The dome panel lies this much over the ramp it is on, metres. */
const DOME_OVER = 0.004;
/** A planter's height and depth, metres. */
export const PLANTER_HEIGHT = 0.5;
export const PLANTER_DEPTH = 0.8;
/** The ground beside a curb is read this far past the curb line: the lots' level. */
const BEYOND = CURB_OUT + 0.01;

const p2 = (v: Vec): P2 => [v.x, v.z];

/** The distance from a point to the nearest edge of a polygon. */
function edgeDistance(poly: readonly Vec[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (a.x + ex * t);
    const dz = z - (a.z + ez * t);
    best = Math.min(best, dx * dx + dz * dz);
  }
  return Math.sqrt(best);
}

export function junctionGeometry(g: TownGround, surf: Surface, solid: Sink, paved: readonly WJunction[], road: RoadSet, pavements: RoadSet): void {
  for (const j of paved) {
    const key = Math.imul(j.id + 3, 2654435);
    if (j.polygon.length >= 3) {
      const pts = j.polygon.map(p2);
      for (const [a, b, c] of triangulate(pts)) {
        road.note([pts[a] as P2, pts[b] as P2, pts[c] as P2]);
        pavements.note([pts[a] as P2, pts[b] as P2, pts[c] as P2]);
      }
      // The pavement's asphalt, its texture along the first leg, dirtier toward its edge (the gutter), the more where a corner has no curb.
      const leg = j.legs[0] as JunctionLeg;
      const frame: UvFrame = { origin: [j.x + hashN(key, 0, 0, 1) * 5, 0, j.z + hashN(key, 0, 0, 2) * 5], u: [-leg.dz, 0, leg.dx], v: [leg.dx, 0, leg.dz] };
      const plain = j.corners.some((k) => !k.curb);
      const sf = 0.86 + 0.28 * hashN(key, 0, 0, 3);
      const over: Over = {
        layer: hashN(key, 0, 0, 4) < 0.25 ? "asphalt_dark" : "asphalt",
        tint: [sf, sf, sf * 0.98],
        frame,
        dirt: (v) => clamp01(0.1 + (0.2 + (plain ? 0.2 : 0)) * smooth(2.2, 0, edgeDistance(j.polygon, v[0], v[2]))),
        wear: 0.03,
      };
      surf.fill(pts, ROADWAY_LIFT, ASPHALT, surf.depthFor(pts, 9, 2), over);
    }
    for (const k of j.corners) corner(g, surf, j.legs, k, key);
    for (const l of j.closed) closedLeg(surf, solid, l, road);
    for (const r of j.ramp) {
      const l = j.legs[r.leg] as JunctionLeg;
      ramp(surf, l, r.side, r.s0, r.s1, key);
    }
  }
}

/** A corner: with a curb return, the curb along it and the sidewalk behind it; without, a plain radius into gravel. */
function corner(g: TownGround, surf: Surface, legs: readonly JunctionLeg[], k: JunctionCorner, key: number): void {
  if (k.shape === "straight") return;
  const a = legs[k.from] as JunctionLeg;
  const b = legs[k.to] as JunctionLeg;
  if (a.engine && b.engine) return;
  const ckey = key ^ Math.imul(k.from + 1, 40503);
  if (k.shape === "arc" && k.c !== null) {
    const c = k.c;
    const arc = arcPoints(c, k.ta, k.tb, k.radius);
    if (!k.curb) {
      // No curb: the asphalt's edge is the arc and a gravel shoulder runs out beyond it, both ragged: gravel over the asphalt's edge by a few centimetres, and out toward the centre of the arc by a metre or so.
      const frame: UvFrame = { origin: [c.x, 0, c.z], u: [1, 0, 0], v: [0, 0, 1] };
      for (let i = 0; i + 1 < arc.length; i++) {
        const p = arc[i] as Vec;
        const q = arc[i + 1] as Vec;
        const shift = (v: Vec, inward: number, ix: number): Vec => {
          // Toward the centre by `inward`, negative away from it (over the asphalt).
          const dx = v.x - c.x;
          const dz = v.z - c.z;
          const l = Math.sqrt(dx * dx + dz * dz) || 1;
          void ix;
          return { x: v.x - (dx / l) * inward, z: v.z - (dz / l) * inward };
        };
        const w0 = 0.9 + 0.6 * hashN(ckey, i, 0, 5);
        const w1 = 0.9 + 0.6 * hashN(ckey, i + 1, 0, 5);
        const o0 = -0.04 - 0.12 * hashN(ckey, i, 0, 6);
        const o1 = -0.04 - 0.12 * hashN(ckey, i + 1, 0, 6);
        surf.flat([p2(shift(p, o0, i)), p2(shift(q, o1, i)), p2(shift(q, w1, i)), p2(shift(p, w0, i))], ROADWAY_LIFT - 0.004, GRAVEL, { layer: "gravel", tint: [0.95, 0.9, 0.82], frame, dirt: (v) => clamp01(0.2 + 0.6 * smooth(0, 1.4, Math.sqrt((v[0] - c.x) * (v[0] - c.x) + (v[2] - c.z) * (v[2] - c.z)) - k.radius + 1.4)), wear: 0.12 });
      }
      return;
    }
    // The curb along the return, its top at the lots' level (read beyond the curb line) and its face down to the gutter.
    const outward = (q: Vec, d: number): Vec => {
      const dx = c.x - q.x;
      const dz = c.z - q.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      return { x: q.x + (dx / l) * d, z: q.z + (dz / l) * d };
    };
    const inset = (q: Vec): Vec => ({ x: c.x + ((q.x - c.x) * (k.radius - CURB_WIDTH)) / k.radius, z: c.z + ((q.z - c.z) * (k.radius - CURB_WIDTH)) / k.radius });
    const topY = (q: Vec): number => {
      const o = outward(q, BEYOND);
      return g.heightAt(o.x, o.z) + WALK_LIFT;
    };
    const roadY = (q: Vec): number => g.heightAt(q.x, q.z) + ROADWAY_LIFT;
    for (let i = 0; i + 1 < arc.length; i++) {
      const p = arc[i] as Vec;
      const q = arc[i + 1] as Vec;
      const pi = inset(p);
      const qi = inset(q);
      const sh = 0.72 + 0.16 * hashN(ckey, i, 0, 7);
      const top: Over = { layer: "sidewalk", tint: [sh, sh * 0.99, sh * 0.94], wear: 0.12, dirt: 0.25 };
      surf.polyY([[p.x, p.z, topY(p)], [q.x, q.z, topY(q)], [qi.x, qi.z, topY(qi)], [pi.x, pi.z, topY(pi)]] as P3[], CURB, top);
      // The face, looking over the roadway: away from the arc's centre.
      const mx = (p.x + q.x) / 2 - c.x;
      const mz = (p.z + q.z) / 2 - c.z;
      const ml = Math.sqrt(mx * mx + mz * mz) || 1;
      const yb0 = roadY(p);
      const yb1 = roadY(q);
      if (topY(p) - yb0 > 0.01 || topY(q) - yb1 > 0.01) {
        const faceOver: Over = { layer: "sidewalk", tint: [sh * 0.9, sh * 0.89, sh * 0.85], wear: 0.1, dirt: (v) => clamp01(0.55 - (v[1] - Math.min(yb0, yb1)) * 4.5) };
        surf.faceY(p2(p), p2(q), yb0, topY(p), yb1, topY(q), [mx / ml, mz / ml], CURB, faceOver);
      }
    }
  }
  // The sidewalk of the corner, inside the curb's back, where both legs have one.
  if (!k.walk || k.lot === null) return;
  const wide = (l: JunctionLeg): ShapedLeg => ({ ...l, half: l.half + (l.engine ? 0 : CURB_WIDTH) });
  const shrink = (q: Vec): Vec => (k.c === null ? q : { x: k.c.x + ((q.x - k.c.x) * (k.radius - CURB_WIDTH)) / k.radius, z: k.c.z + ((q.z - k.c.z) * (k.radius - CURB_WIDTH)) / k.radius });
  const inner: JunctionCorner = k.shape === "arc" && k.c !== null ? { ...k, radius: k.radius - CURB_WIDTH, ta: shrink(k.ta), tb: shrink(k.tb) } : k;
  const poly = cornerPolygon(wide(a), wide(b), inner);
  if (poly.length < 3) return;
  const pts = poly.map(p2);
  // A corner is a newer, lighter pour than the runs beside it (it was rebuilt with the ramps), cracked and dirty at its back.
  const lot = k.lot;
  const frame: UvFrame = { origin: [lot.x + hashN(ckey, 0, 0, 8) * 3, 0, lot.z + hashN(ckey, 0, 0, 9) * 3], u: [a.dx, 0, a.dz], v: [-a.dz, 0, a.dx] };
  const back = (v: readonly [number, number, number]): number => Math.sqrt((v[0] - lot.x) * (v[0] - lot.x) + (v[2] - lot.z) * (v[2] - lot.z));
  const reach = Math.max(1, ...poly.map((q) => Math.sqrt((q.x - lot.x) * (q.x - lot.x) + (q.z - lot.z) * (q.z - lot.z))));
  const sh = 0.64 + 0.1 * hashN(ckey, 0, 0, 10);
  const over: Over = { layer: "sidewalk", tint: [sh, sh * 0.99, sh * 0.94], frame, wear: (v) => clamp01(0.05 + 0.16 * smooth(reach * 0.7, 0, back(v))), dirt: (v) => clamp01(0.06 + 0.3 * smooth(reach * 0.8, 0, back(v))) };
  // Lifted a little higher than the slabs' own (a corner has no trough under it): 2.8 cm over the ground, the most a slab's heave reaches.
  surf.fill(pts, WALK_LIFT + 0.016, SIDEWALK, surf.depthFor(pts, 6, 2), over);
  // An expansion joint or two across the corner's piece, and its crack.
  void hashS;
}

/** A curb ramp: from the roadway's gutter up to a landing, and the dome panel at its foot; laid in strips across so it follows the ground's own cut. */
function ramp(surf: Surface, l: JunctionLeg, side: 1 | -1, s0: number, s1: number, key: number): void {
  const at = (s: number, u: number): P2 => {
    const q = onLeg(l, s, side * (l.half + u));
    return [q.x, q.z];
  };
  const us = [0, 0.1, 0.2, 0.3, 0.45, 0.7, 1.0, 1.4, RAMP_RUN, RAMP_RUN + RAMP_LANDING];
  const sh = 0.84 + 0.1 * hashN(key, l.street, side, 11);
  const over: Over = { layer: "sidewalk", tint: [sh, sh * 0.99, sh * 0.95], wear: 0.05, dirt: 0.12 };
  for (let i = 0; i + 1 < us.length; i++) {
    surf.flat([at(s0, us[i] as number), at(s1, us[i] as number), at(s1, us[i + 1] as number), at(s0, us[i + 1] as number)], WALK_LIFT, SIDEWALK, over);
  }
  // The dome panel at its foot, 2 ft deep, in strips too.
  const d: Rgb = DOME;
  const ds = [0, 0.1, 0.2, 0.3, 0.45, DOME_DEPTH];
  for (let i = 0; i + 1 < ds.length; i++) {
    surf.flat([at(s0, ds[i] as number), at(s1, ds[i] as number), at(s1, ds[i + 1] as number), at(s0, ds[i + 1] as number)], WALK_LIFT + DOME_OVER, d, { layer: "sidewalk", tint: [0.95, 0.72, 0.08], wear: 0.1, dirt: 0.15 });
  }
}

/** A leg a sharp crossing closed: the strip that fills between the pavement and its first full tile, and the planter across its end. */
function closedLeg(surf: Surface, solid: Sink, l: JunctionLeg, road: RoadSet): void {
  const q = (s: number, side: number): P2 => {
    const v = onLeg(l, s, side);
    return [v.x, v.z];
  };
  if (l.mouth - Math.min(l.bandLeft, l.bandRight) > 0.02) road.tile([q(l.bandRight, -l.half), q(l.mouth, -l.half), q(l.mouth, l.half), q(l.bandLeft, l.half)], ROADWAY_LIFT, ASPHALT);
  const mid = onLeg(l, l.mouth + PLANTER_DEPTH / 2, 0);
  const base = surf.g.heightAt(mid.x, mid.z) + ROADWAY_LIFT;
  solid(mid.x, mid.z).box(mid.x, mid.z, base, -l.dz, l.dx, l.half, PLANTER_DEPTH / 2, PLANTER_HEIGHT, CURB, PLANTER);
}
