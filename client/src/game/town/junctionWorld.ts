/**
 * The plan's junctions in the world's frame (the plan's plus the town's anchor), each with the polygon of its pavement and its
 * ramps. A junction that shares a pavement (four-way, tee, skew, highway) has legs, corners and a pavement polygon; the
 * others (an alley's mouth, a road end, a stair, a rail crossing) have their legs and no corners.
 */
import { CROSSWALK_WIDTH, UNMARKED_CROSSWALK, hasPavement } from "../../sim/town/junctions.js";
import { pavementPolygon, rampsOf, type Ramp } from "../../sim/town/junctionShape.js";
import type { Junction, JunctionCorner, JunctionLeg, Vec } from "../../sim/town/types.js";
import type { TownGround } from "./townTypes.js";

export type WJunction = Omit<Junction, "legs" | "corners" | "closed"> & {
  readonly legs: readonly JunctionLeg[];
  readonly corners: readonly JunctionCorner[];
  readonly closed: readonly JunctionLeg[];
  /** The pavement's outline, counter-clockwise; empty for a junction with no pavement of its own. */
  readonly polygon: readonly Vec[];
  readonly ramp: readonly Ramp[];
};

const shiftLeg = (l: JunctionLeg, ax: number, az: number): JunctionLeg => ({ ...l, x: l.x + ax, z: l.z + az });
const shiftVec = (v: Vec | null, ax: number, az: number): Vec | null => (v === null ? null : { x: v.x + ax, z: v.z + az });

export function worldJunctions(g: TownGround): WJunction[] {
  const { anchor } = g;
  return g.plan.junctions.map((j) => {
    const legs = j.legs.map((l) => shiftLeg(l, anchor.x, anchor.z));
    const corners = j.corners.map((k): JunctionCorner => ({ ...k, v: shiftVec(k.v, anchor.x, anchor.z), ta: shiftVec(k.ta, anchor.x, anchor.z) as Vec, tb: shiftVec(k.tb, anchor.x, anchor.z) as Vec, c: shiftVec(k.c, anchor.x, anchor.z), lot: shiftVec(k.lot, anchor.x, anchor.z) }));
    const closed = j.closed.map((l) => shiftLeg(l, anchor.x, anchor.z));
    const pave = hasPavement(j);
    return {
      ...j,
      x: j.x + anchor.x,
      z: j.z + anchor.z,
      legs,
      corners,
      closed,
      polygon: pave && legs.length >= 2 ? pavementPolygon(legs, corners) : [],
      ramp: pave ? rampsOf(legs, j.ramps, { marked: CROSSWALK_WIDTH, unmarked: UNMARKED_CROSSWALK }) : [],
    };
  });
}
