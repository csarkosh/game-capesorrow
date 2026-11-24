/**
 * What the track-clearance test and the scratch measurement share: the distance from each kind of thing the plan places to the railroad's two
 * lines (the main line beside the highway, the town's own spur), by kind. Pure functions of a plan and its site.
 */
import { orientedRect, type Poly } from "../../src/sim/town/geom.js";
import { RAIL_BED_HALF } from "../../src/sim/town/rail.js";
import { mainLineOf } from "../../src/sim/town/railLine.js";
import type { TownSite } from "../../src/sim/town/site.js";
import type { TownPlan } from "../../src/sim/town/types.js";
import { footprint, lineDist, lineSegDist, lineShapeDist, PROP_CLEAR, BUILDING_CLEAR, type Line } from "../../src/sim/town/railKeepOut.js";

export { PROP_CLEAR, BUILDING_CLEAR };
/** The ballast bed's half width (the spur's and the main line's), metres. */
export const BED_HALF = RAIL_BED_HALF;

/** A building's footprint as the town draws it (a house with its porch and its addition). */
export function buildingShape(plan: TownPlan, id: number): Poly {
  const b = plan.buildings[id] as TownPlan["buildings"][number];
  return footprint(b.centre, b.halfAlong, b.halfAcross, b.bearing, b.front, b.kind);
}

/** A parked vehicle's box: five metres by two, along its heading. */
function carShape(x: number, z: number, hx: number, hz: number, half = 2.5, wide = 1): Poly {
  return orientedRect({ x, z }, half, wide, { x: hx, z: hz }, { x: -hz, z: hx });
}

export function spurLine(plan: TownPlan): Line {
  return plan.rail.spurs[0]?.points ?? [];
}

export type Hit = { readonly kind: string; readonly id: number; readonly d: number; readonly on: "spur" | "main" };

/** Everything the plan placed within its clearance of either line, by kind. */
export function onTracks(plan: TownPlan, site: TownSite): Hit[] {
  const lines: { on: "spur" | "main"; line: Line }[] = [{ on: "spur", line: spurLine(plan) }, { on: "main", line: mainLineOf(site) }];
  const out: Hit[] = [];
  const add = (kind: string, id: number, d: number, on: "spur" | "main", clear: number): void => {
    if (d < BED_HALF + clear) out.push({ kind, id, d, on });
  };
  const p = plan.props;
  const outlying = new Map(plan.outskirts.map((o) => [o.building, o]));
  for (const { on, line } of lines) {
    if (line.length < 2) continue;
    for (const b of plan.buildings) {
      if (b.kind === "pier") continue;
      const kind = outlying.has(b.id) ? "outlying building" : "building";
      add(kind, b.id, lineShapeDist(line, buildingShape(plan, b.id)), on, BUILDING_CLEAR);
    }
    for (const f of p.fences) add("fence", f.id, lineSegDist(line, { x: f.ax, z: f.az }, { x: f.bx, z: f.bz }), on, PROP_CLEAR);
    for (const v of p.vehicles) add("vehicle", v.id, lineShapeDist(line, carShape(v.x, v.z, v.hx, v.hz)), on, PROP_CLEAR);
    for (const t of p.trailers) add("trailer", t.id, lineShapeDist(line, carShape(t.x, t.z, t.hx, t.hz, t.length / 2, t.width / 2)), on, PROP_CLEAR);
    for (const o of p.bins) add("bin", o.id, lineDist(line, o), on, PROP_CLEAR);
    for (const o of p.mailboxes) add("mailbox", o.id, lineDist(line, o), on, PROP_CLEAR);
    for (const o of p.gear) add("gear", o.id, lineDist(line, o), on, PROP_CLEAR);
    for (const o of p.furniture) add("furniture", o.id, lineDist(line, o), on, PROP_CLEAR);
    p.litter.forEach((o, i) => add("litter", i, lineDist(line, o), on, PROP_CLEAR));
    for (const o of p.poles) add("pole", o.id, lineDist(line, o), on, PROP_CLEAR);
    for (const l of plan.harbour.lights) add("light", 0, lineDist(line, l), on, PROP_CLEAR);
    (plan.harbour.terminal?.yard ?? []).forEach((y, i) => add("terminal yard", i, lineShapeDist(line, orientedRect({ x: y.x, z: y.z }, y.halfX, y.halfZ, { x: 1, z: 0 }, { x: 0, z: 1 })), on, PROP_CLEAR));
  }
  return out;
}
