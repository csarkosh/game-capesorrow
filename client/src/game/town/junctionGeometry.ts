/**
 * A junction's own surfaces: the pavement the legs end on, bounded by its curb returns; the curb along each return; the sidewalk
 * of each corner as one piece filling the corner to the two lot lines; the curb ramps with their dome panels; and, at a leg a sharp
 * crossing closed, the strip that closes it and the planter that stops it.
 *
 * Heights: the pavement lies `ROADWAY_LIFT` over the ground like every roadway, so it shares its height with each leg's strip at the
 * mouth (the vertices there are the same points, at the same lift). Where the ground rolls, that is the way the legs' cross-slopes
 * are resolved into the junction: the junction is draped over the ground as the strips are, with no plane of its own, so a leg
 * that tilts across meets the junction at the same tilt, and a junction on a hillside tilts with the hill.
 */
import { onLeg, cornerPolygon, arcPoints, RAMP_RUN, RAMP_LANDING, DOME_DEPTH, type ShapedLeg } from "../../sim/town/junctionShape.js";
import type { JunctionCorner, JunctionLeg, Vec } from "../../sim/town/types.js";
import type { Rgb } from "./meshBuilder.js";
import { ASPHALT, CURB, DOME, PLANTER, SIDEWALK } from "./palette.js";
import { CURB_RISE, CURB_WIDTH, ROADWAY_LIFT, WALK_LIFT } from "./streetGeometry.js";
import type { WJunction } from "./junctionWorld.js";
import { triangulate, type P2, type P3, type RoadSet, type Surface } from "./surface.js";
import type { Sink, TownGround } from "./townTypes.js";

/** The dome panel lies this much over the ramp it is on, metres. */
const DOME_OVER = 0.004;
/** A planter's height and depth, metres. */
export const PLANTER_HEIGHT = 0.5;
export const PLANTER_DEPTH = 0.8;

const p2 = (v: Vec): P2 => [v.x, v.z];

export function junctionGeometry(_g: TownGround, surf: Surface, solid: Sink, paved: readonly WJunction[], road: RoadSet, pavements: RoadSet): void {
  for (const j of paved) {
    if (j.polygon.length >= 3) {
      const pts = j.polygon.map(p2);
      for (const [a, b, c] of triangulate(pts)) {
        road.note([pts[a] as P2, pts[b] as P2, pts[c] as P2]);
        pavements.note([pts[a] as P2, pts[b] as P2, pts[c] as P2]);
      }
      surf.fill(pts, ROADWAY_LIFT, ASPHALT, surf.depthFor(pts, 9, 2));
    }
    for (const k of j.corners) corner(surf, j.legs, k);
    for (const l of j.closed) closedLeg(surf, solid, l, road);
    for (const r of j.ramp) {
      const l = j.legs[r.leg] as JunctionLeg;
      ramp(surf, l, r.side, r.s0, r.s1);
    }
  }
}

/** A corner: the curb along its return and the sidewalk behind it. */
function corner(surf: Surface, legs: readonly JunctionLeg[], k: JunctionCorner): void {
  if (k.shape === "straight") return;
  const a = legs[k.from] as JunctionLeg;
  const b = legs[k.to] as JunctionLeg;
  if (a.engine && b.engine) return;
  if (k.shape === "arc" && k.c !== null) {
    const arc = arcPoints(k.c, k.ta, k.tb, k.radius);
    const inset = (q: Vec): Vec => ({ x: (k.c as Vec).x + ((q.x - (k.c as Vec).x) * (k.radius - CURB_WIDTH)) / k.radius, z: (k.c as Vec).z + ((q.z - (k.c as Vec).z) * (k.radius - CURB_WIDTH)) / k.radius });
    for (let i = 0; i + 1 < arc.length; i++) {
      const p = arc[i] as Vec;
      const q = arc[i + 1] as Vec;
      const pi = inset(p);
      const qi = inset(q);
      surf.flat([p2(p), p2(q), p2(qi), p2(pi)], WALK_LIFT, CURB);
      // The face, looking over the roadway: away from the arc's centre.
      const mx = (p.x + q.x) / 2 - k.c.x;
      const mz = (p.z + q.z) / 2 - k.c.z;
      const ml = Math.sqrt(mx * mx + mz * mz) || 1;
      surf.face(p2(p), p2(q), ROADWAY_LIFT, WALK_LIFT, [mx / ml, mz / ml], CURB);
    }
  }
  // The sidewalk of the corner, inside the curb's back.
  if (k.lot === null) return;
  const wide = (l: JunctionLeg): ShapedLeg => ({ ...l, half: l.half + (l.engine ? 0 : CURB_WIDTH) });
  const shrink = (q: Vec): Vec => (k.c === null ? q : { x: k.c.x + ((q.x - k.c.x) * (k.radius - CURB_WIDTH)) / k.radius, z: k.c.z + ((q.z - k.c.z) * (k.radius - CURB_WIDTH)) / k.radius });
  const inner: JunctionCorner = k.shape === "arc" && k.c !== null ? { ...k, radius: k.radius - CURB_WIDTH, ta: shrink(k.ta), tb: shrink(k.tb) } : k;
  const poly = cornerPolygon(wide(a), wide(b), inner);
  if (poly.length < 3) return;
  const pts = poly.map(p2);
  surf.fill(pts, WALK_LIFT, SIDEWALK, surf.depthFor(pts, 6, 2));
  // The sidewalk's outer edges, the two lot lines, down to the ground.
  let cx = 0;
  let cz = 0;
  for (const q of poly) {
    cx += q.x;
    cz += q.z;
  }
  cx /= poly.length;
  cz /= poly.length;
  const lot = k.lot;
  for (const [from, to] of [[onLeg(a, a.bandLeft, a.outer), lot], [lot, onLeg(b, b.bandRight, -b.outer)]] as const) {
    const ex = to.x - from.x;
    const ez = to.z - from.z;
    const el = Math.sqrt(ex * ex + ez * ez);
    if (!(el > 0.05)) continue;
    let nx = ez / el;
    let nz = -ex / el;
    if (nx * ((from.x + to.x) / 2 - cx) + nz * ((from.z + to.z) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    surf.face(p2(from), p2(to), 0, WALK_LIFT, [nx, nz], CURB);
  }
}

/** A curb ramp: from the roadway's gutter up to a landing, and the dome panel at its foot. */
function ramp(surf: Surface, l: JunctionLeg, side: 1 | -1, s0: number, s1: number): void {
  const at = (s: number, u: number, lift: number): P3 => {
    const q = onLeg(l, s, side * (l.half + u));
    return [q.x, q.z, lift];
  };
  const slope = (u: number): number => ROADWAY_LIFT + (CURB_RISE * u) / RAMP_RUN;
  surf.poly([at(s0, 0, ROADWAY_LIFT), at(s1, 0, ROADWAY_LIFT), at(s1, RAMP_RUN, WALK_LIFT), at(s0, RAMP_RUN, WALK_LIFT)], SIDEWALK);
  surf.poly([at(s0, RAMP_RUN, WALK_LIFT), at(s1, RAMP_RUN, WALK_LIFT), at(s1, RAMP_RUN + RAMP_LANDING, WALK_LIFT), at(s0, RAMP_RUN + RAMP_LANDING, WALK_LIFT)], SIDEWALK);
  const d: Rgb = DOME;
  surf.poly([at(s0, 0, slope(0) + DOME_OVER), at(s1, 0, slope(0) + DOME_OVER), at(s1, DOME_DEPTH, slope(DOME_DEPTH) + DOME_OVER), at(s0, DOME_DEPTH, slope(DOME_DEPTH) + DOME_OVER)], d);
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
