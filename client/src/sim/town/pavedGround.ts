/**
 * Every piece of ground the town paves that is not a street: the paved districts' blocks (the core, the dock end, the working
 * waterfront, the mill's site, industrial flats, the highway strip), and the aprons of the businesses that stand alone beyond
 * the last blocks on a lot that is otherwise a yard: a gas station's forecourt and a motel's or a fire hall's lot. One list of
 * convex polygons in the plan's frame, made once from the plan and cached, that the drawing lays its patches by
 * (`game/town/groundGeometry.ts`) and the clearing shuts its ground cover, trees and strip by (`clearing.ts`), so the two cannot
 * disagree about where there is paving. (A street's own ground is the streets'; a yard's drive and walk are the lot's.)
 *
 * An apron is the part of its lot a vehicle uses: from the frontage back to a little behind the building, `APRON_BEHIND`, and in
 * from the lot's sides by `APRON_SIDE`, so that the lot's own edges are left to weeds. Its frontage is kept `APRON_FRONT` back from
 * the street's edge.
 *
 * Simulation code: `+ - * /`, `abs`, `min`, `max`, `sqrt`.
 */
import { bearingU, bearingV } from "./bearings.js";
import { area, clipHalfPlane, orient, type Poly } from "./geom.js";
import type { BuildingKind, District, TownPlan } from "./types.js";

/** Which districts are paved: the ground between their buildings is the town's own surface. The rest are yards. */
const PAVED: Readonly<Record<District, boolean>> = {
  core: true,
  dock: true,
  waterfront: true,
  mill: true,
  "mill housing": false,
  residential: false,
  "highway strip": true,
  civic: false,
  industrial: true,
  outskirts: false,
};

/** Whether a district's blocks are paved (its lots' ground is the town's surface) and not yards. */
export function isPaved(district: District): boolean {
  return PAVED[district];
}

/** The kinds of lone business whose lot is paved where a vehicle stands (asphalt). */
const APRON_KINDS: readonly BuildingKind[] = ["gas station", "motel", "fire hall"];

/** An apron keeps this far in from its lot's sides and back, and from the street's edge, metres: the margin that is left to weeds. */
export const APRON_SIDE = 2.5;
export const APRON_FRONT = 0.5;
/** It reaches this far past the building's back face, metres. */
export const APRON_BEHIND = 3;

export type PavedGround = {
  readonly kind: "block" | "apron";
  /** The block the ground is of (an apron's lot's block). */
  readonly block: number;
  /** An apron's lot, and -1 for a block. */
  readonly lot: number;
  readonly district: District;
  /** The polygon, convex, wound counter-clockwise, in the plan's frame. */
  readonly polygon: Poly;
};

const CACHE = new WeakMap<TownPlan, readonly PavedGround[]>();

/** The paved ground of a plan that is not a street. */
export function pavedGround(plan: TownPlan): readonly PavedGround[] {
  const hit = CACHE.get(plan);
  if (hit !== undefined) return hit;
  const out: PavedGround[] = [];
  for (const b of plan.blocks) if (PAVED[b.district]) out.push({ kind: "block", block: b.id, lot: -1, district: b.district, polygon: orient(b.polygon) });
  for (const b of plan.buildings) {
    if (b.lot < 0 || !APRON_KINDS.includes(b.kind)) continue;
    const lot = plan.lots[b.lot];
    if (lot === undefined || PAVED[lot.district]) continue;
    const poly = orient(lot.polygon);
    const f = lot.front;
    let fmax = -Infinity;
    for (const q of poly) fmax = Math.max(fmax, q.x * f.x + q.z * f.z);
    // How far the building's back face lies from the frontage.
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const reach = Math.abs(u.x * f.x + u.z * f.z) * b.halfAlong + Math.abs(v.x * f.x + v.z * f.z) * b.halfAcross;
    const dMax = fmax - (b.centre.x * f.x + b.centre.z * f.z) + reach + APRON_BEHIND;
    // The frontage is the edge whose outward normal is most nearly the lot's front.
    let best = -Infinity;
    let front = -1;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as { x: number; z: number };
      const q = poly[(i + 1) % poly.length] as { x: number; z: number };
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      if (!(len > 3)) continue;
      const score = (ez / len) * f.x + (-ex / len) * f.z;
      if (score > best) {
        best = score;
        front = i;
      }
    }
    if (front < 0) continue;
    let cut: Poly = poly;
    for (let i = 0; i < poly.length && cut.length >= 3; i++) {
      const p = poly[i] as { x: number; z: number };
      const q = poly[(i + 1) % poly.length] as { x: number; z: number };
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      if (!(len > 1e-9)) continue;
      // The outward normal of a counter-clockwise edge; keep what lies `inset` inside it.
      const nx = ez / len;
      const nz = -ex / len;
      const inset = i === front ? APRON_FRONT : APRON_SIDE;
      cut = clipHalfPlane(cut, { x: -nx, z: -nz }, -(nx * p.x + nz * p.z) + inset);
    }
    // And no deeper than the building's back and the margin behind it.
    if (cut.length >= 3) cut = clipHalfPlane(cut, f, fmax - dMax);
    if (cut.length < 3 || area(cut) < 40) continue;
    out.push({ kind: "apron", block: lot.block, lot: lot.id, district: lot.district, polygon: cut });
  }
  CACHE.set(plan, out);
  return out;
}
