/**
 * Where the signs at the town's junctions stand: a STOP sign on the right of each approach that stops, a DEAD END sign where a street
 * that ends begins, the planter's sign where a sharp crossing closed a leg, the street-name blades at one corner of each junction with
 * a pavement, and a PAVEMENT ENDS sign where a road out of town turns to gravel. It is the one list of them: the drawing
 * (`game/town/signGeometry.ts`) builds each sign from it, and what a car knocks down (`knockables.ts`) is read from it, so the two
 * cannot disagree about where a sign is.
 *
 * The junctions are taken in whatever frame they are given in (the drawing's and the car's are the world's: the plan's, moved by the
 * town's anchor), and `ax`, `az` move what the plan holds apart from its legs (the place the pavement ends) into it.
 *
 * Simulation code: `+ - * /`, `sqrt`, `min` only.
 */
import { SIGN_BEHIND_CURB, hasPavement, stopSignSpot } from "./junctions.js";
import { pavementPolygon } from "./junctionShape.js";
import type { Junction, JunctionCorner, JunctionLeg, TownPlan, Vec } from "./types.js";

export type JunctionSignKind = "stop" | "dead end" | "planter" | "blades" | "pavement ends";

/**
 * A sign: where its face's centre line meets the ground (`x`, `z`), the way it faces (`nx`, `nz`: toward the traffic it is for; a
 * blades' post has none, 0 and 0), and the junction it belongs to, as an index into the list given.
 */
export type JunctionSign = { readonly kind: JunctionSignKind; readonly x: number; readonly z: number; readonly nx: number; readonly nz: number; readonly junction: number };

/** What of a junction the signs are placed from: its legs and corners in the frame the signs are wanted in, and the outline of its pavement (empty where it has none of its own). */
export type SignedJunction = Pick<Junction, "blades" | "pavementEnds"> & {
  readonly legs: readonly JunctionLeg[];
  readonly corners: readonly JunctionCorner[];
  readonly closed: readonly JunctionLeg[];
  readonly polygon: readonly Vec[];
};

/** How far a sign's post stands behind its face, metres: a sign's post is at (x - nx * POST_BEHIND, z - nz * POST_BEHIND). */
export const POST_BEHIND = 0.05;

/** Where the blades' post of a junction stands, or null where its corner has no place for one. */
export function bladesSpot(j: SignedJunction): Vec | null {
  const b = j.blades;
  if (b === null) return null;
  const k = j.corners[b.corner] as JunctionCorner;
  if (k.shape === "arc" && k.c !== null && k.v !== null) {
    // Half a metre behind the curb on the corner's middle.
    const vx = k.v.x - k.c.x;
    const vz = k.v.z - k.c.z;
    const vl = Math.sqrt(vx * vx + vz * vz) || 1;
    return { x: k.c.x + (vx / vl) * (k.radius - 0.55), z: k.c.z + (vz / vl) * (k.radius - 0.55) };
  }
  if (k.v !== null) return { x: k.v.x, z: k.v.z };
  return null;
}

/** Every sign of the junctions, in the junctions' order and, within one, in the order the drawing lays them. */
export function junctionSigns(junctions: readonly SignedJunction[], ax: number, az: number): JunctionSign[] {
  const out: JunctionSign[] = [];
  for (let n = 0; n < junctions.length; n++) {
    const j = junctions[n] as SignedJunction;
    if (j.polygon.length >= 3) {
      for (const l of j.legs) {
        if (l.engine || l.closed) continue;
        if (l.stops && l.stopLine !== null) {
          // The right of the approach: the traffic comes toward the junction along -d, so its right is the leg's left.
          const spot = stopSignSpot(l) as { s: number; lat: number };
          const s = spot.s;
          const lat = spot.lat;
          out.push({ kind: "stop", x: l.x + l.dx * s - l.dz * lat, z: l.z + l.dz * s + l.dx * lat, nx: l.dx, nz: l.dz, junction: n });
        }
        if (l.deadEnd) {
          // At the entrance of a street that ends: for traffic leaving the junction, on its right, facing back toward the junction.
          const s = l.mouth + 7;
          const lat = -(l.half + SIGN_BEHIND_CURB);
          out.push({ kind: "dead end", x: l.x + l.dx * s - l.dz * lat, z: l.z + l.dz * s + l.dx * lat, nx: -l.dx, nz: -l.dz, junction: n });
        }
      }
      for (const l of j.closed) {
        // The planter's sign: DEAD END, on the planter, facing the street's traffic.
        const s = l.mouth + 0.4;
        out.push({ kind: "planter", x: l.x + l.dx * s, z: l.z + l.dz * s, nx: l.dx, nz: l.dz, junction: n });
      }
      const p = bladesSpot(j);
      if (p !== null) out.push({ kind: "blades", x: p.x, z: p.z, nx: 0, nz: 0, junction: n });
    }
    if (j.pavementEnds !== null) {
      const e = j.pavementEnds;
      const width = j.legs[1]?.roadway ?? 6;
      // On the road's right, facing the traffic that leaves town along it.
      const lat = -(Math.min(width, 6) / 2 + 1.2);
      out.push({ kind: "pavement ends", x: e.x + ax - e.dz * lat, z: e.z + az + e.dx * lat, nx: -e.dx, nz: -e.dz, junction: n });
    }
  }
  return out;
}

const shiftLeg = (l: JunctionLeg, ax: number, az: number): JunctionLeg => ({ ...l, x: l.x + ax, z: l.z + az });
const shiftVec = (v: Vec | null, ax: number, az: number): Vec | null => (v === null ? null : { x: v.x + ax, z: v.z + az });

/** The plan's junctions moved by (`ax`, `az`), with what the signs are placed from: as the drawing's own (`game/town/junctionWorld.ts`) moves them. */
export function signedJunctions(plan: TownPlan, ax: number, az: number): SignedJunction[] {
  return plan.junctions.map((j): SignedJunction => {
    const legs = j.legs.map((l) => shiftLeg(l, ax, az));
    const corners = j.corners.map((k): JunctionCorner => ({ ...k, v: shiftVec(k.v, ax, az), ta: shiftVec(k.ta, ax, az) as Vec, tb: shiftVec(k.tb, ax, az) as Vec, c: shiftVec(k.c, ax, az) }));
    const closed = j.closed.map((l) => shiftLeg(l, ax, az));
    return { blades: j.blades, pavementEnds: j.pavementEnds, legs, corners, closed, polygon: hasPavement(j) && legs.length >= 2 ? pavementPolygon(legs, corners) : [] };
  });
}
