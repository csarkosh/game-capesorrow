/**
 * What the size tests and the before/after table measure of a plan: how much of the street has a building near it, which blocks of the
 * grid were left as woods and whether streets wrap them, how many dwellings stand against how many shop units, and whether a shop's
 * door opens onto a sidewalk. Pure functions of a `TownPlan`.
 */
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { contains, dist, orient, orientedRect, segDist, type Vec } from "../../src/sim/town/geom.js";
import type { Building, BuildingUse, Street, TownPlan } from "../../src/sim/town/types.js";
import { walkAt } from "../../src/sim/town/port/edges.js";

/** The streets a town's grid is made of and its alleys: not the highway, the wharf's deck or the rail. */
export function isTownStreet(s: Street): boolean {
  return s.kind !== "highway" && s.kind !== "wharf" && s.kind !== "rail";
}

/** The distance from a point to a building's footprint (0 inside it). */
export function footprintDist(b: Building, p: Vec): number {
  const poly = orientedRect(b.centre, b.halfAlong, b.halfAcross, bearingU(b.bearing), bearingV(b.bearing));
  let inside = true;
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as Vec;
    const c = poly[(k + 1) % poly.length] as Vec;
    d = Math.min(d, segDist(p, a, c));
    if ((c.x - a.x) * (p.z - a.z) - (c.z - a.z) * (p.x - a.x) < 0) inside = false;
  }
  return inside ? 0 : d;
}

/**
 * Whether a building is near a point: its footprint (or its centre, `by` "centre") within `reach`; a building on a big lot (over 2,500 m2:
 * a school's ground, a mill's yard) is near wherever its lot is, since the whole ground is what the street serves.
 */
export function nearBuilding(plan: TownPlan, b: Building, p: Vec, reach: number, by: "centre" | "footprint"): boolean {
  if (by === "centre") return dist(b.centre, p) <= reach;
  const lot = b.lot >= 0 ? plan.lots[b.lot] : undefined;
  if (lot !== undefined && Math.abs(polyArea(lot.polygon)) > 2500) {
    for (let k = 0; k < lot.polygon.length; k++) if (segDist(p, lot.polygon[k] as Vec, lot.polygon[(k + 1) % lot.polygon.length] as Vec) <= reach) return true;
  }
  return footprintDist(b, p) <= reach;
}

function polyArea(poly: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec;
    const q = poly[(i + 1) % poly.length] as Vec;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/**
 * Street length in metres (the town's streets and alleys, not the highway, the wharf or the rail), and how much of it has no building near
 * (`nearBuilding`; a pier is none), sampled every 10 m.
 */
export function streetsWithoutBuildings(plan: TownPlan, reach = 20, by: "centre" | "footprint" = "footprint"): { total: number; empty: number; share: number } {
  const real = plan.buildings.filter((b) => b.kind !== "pier");
  let total = 0;
  let empty = 0;
  for (const st of plan.streets) {
    if (!isTownStreet(st)) continue;
    const len = dist(st.a, st.b);
    const n = Math.max(1, Math.round(len / 10));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = { x: st.a.x + (st.b.x - st.a.x) * t, z: st.a.z + (st.b.z - st.a.z) * t };
      total += len / n;
      if (!real.some((b) => nearBuilding(plan, b, p, reach, by))) empty += len / n;
    }
  }
  return { total, empty, share: total > 0 ? empty / total : 0 };
}

/** The woods blocks that streets run along on every side (an edge of 15 m or more has a grid street or the highway along it). */
export function woodsEnclosed(plan: TownPlan): { land: number; budget: number; landEnclosed: number; budgetEnclosed: number } {
  const out = { land: 0, budget: 0, landEnclosed: 0, budgetEnclosed: 0 };
  const along = (a: Vec, b: Vec): boolean => {
    const len = dist(a, b);
    if (len < 15) return true;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    for (const st of plan.streets) {
      if (st.kind === "alley" || st.kind === "wharf" || st.kind === "rail") continue;
      const sl = dist(st.a, st.b);
      if (sl < 1) continue;
      const cos = Math.abs(((st.b.x - st.a.x) * dx + (st.b.z - st.a.z) * dz) / sl);
      if (cos < 0.97) continue;
      if (segDist(mid, st.a, st.b) <= st.width / 2 + 3) return true;
    }
    return false;
  };
  for (const w of plan.woods) {
    let all = true;
    for (let k = 0; k < w.polygon.length; k++) if (!along(w.polygon[k] as Vec, w.polygon[(k + 1) % w.polygon.length] as Vec)) all = false;
    if (w.why === "land") {
      out.land++;
      if (all) out.landEnclosed++;
    } else {
      out.budget++;
      if (all) out.budgetEnclosed++;
    }
  }
  return out;
}

/**
 * The length of the grid's streets (not alleys or the highway) with woods the plan left on both sides of them (a point 8 m past the right of way on
 * each side is in a woods block), sampled every 10 m, and with woods on one side: the owner's "no street runs past woods on both sides unless it is the way to something".
 */
export function streetsBesideWoods(plan: TownPlan): { both: number; one: number; total: number } {
  const woods = plan.woods.map((w) => ({ poly: orient(w.polygon), ...bounds(w.polygon) }));
  const inWoods = (p: Vec): boolean => woods.some((w) => p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1 && contains(w.poly, p));
  let both = 0;
  let one = 0;
  let total = 0;
  for (const st of plan.streets) {
    if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
    const len = dist(st.a, st.b);
    const n = Math.max(1, Math.round(len / 10));
    const dx = (st.b.x - st.a.x) / len;
    const dz = (st.b.z - st.a.z) / len;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = st.a.x + (st.b.x - st.a.x) * t;
      const z = st.a.z + (st.b.z - st.a.z) * t;
      const off = st.width / 2 + 8;
      const l = inWoods({ x: x - dz * off, z: z + dx * off });
      const r = inWoods({ x: x + dz * off, z: z - dx * off });
      total += len / n;
      if (l && r) both += len / n;
      else if (l || r) one += len / n;
    }
  }
  return { both, one, total };
}

function bounds(poly: readonly Vec[]): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  return { x0, x1, z0, z1 };
}

/**
 * Households in a building. AUTHORED, NOT RESEARCHED: a house is one; an apartment house has 3 flats a storey, a rooming house 3 rooms a
 * storey, and an upper storey of a block of shops that is apartments has 2 flats. A ruin houses nobody.
 */
export const FLATS_APARTMENT = 3;
export const ROOMS_BOARDING = 3;
export const FLATS_OVER_SHOPS = 2;

export function dwellingsOf(plan: TownPlan): { houses: number; flats: number; apartments: number; rooms: number; total: number } {
  const useOf = new Map<number, BuildingUse>();
  for (const u of plan.uses) useOf.set(u.building, u);
  let houses = 0;
  let apartments = 0;
  let rooms = 0;
  let flats = 0;
  for (const b of plan.buildings) {
    if (b.state === "ruin") continue;
    if (b.kind === "house") houses++;
    else if (b.kind === "apartment") apartments += FLATS_APARTMENT * b.storeys;
    else if (b.kind === "boarding house") rooms += ROOMS_BOARDING * b.storeys;
    else {
      const u = useOf.get(b.id);
      if (u) for (const up of u.upper) if (up.use === "apartments") flats += FLATS_OVER_SHOPS;
    }
  }
  return { houses, flats, apartments, rooms, total: houses + flats + apartments + rooms };
}

/** Shop units (every bay of every building's street front), the vacant ones, and the taverns (the units of a tavern, and any other unit with a tavern's trade). */
export function unitsOf(plan: TownPlan): { units: number; vacant: number; taverns: number } {
  let units = 0;
  let vacant = 0;
  let taverns = 0;
  for (const u of plan.uses) {
    const isTavern = plan.buildings[u.building]!.kind === "tavern";
    for (const q of u.units) {
      units++;
      if (q.tenant === null) vacant++;
      if (isTavern || q.tenant?.trade === "tavern") taverns++;
    }
  }
  return { units, vacant, taverns };
}

/** The box round the buildings (the piers and, with `grid`, the outlying single buildings of the outskirts left out), as its width and height. */
export function extentOf(plan: TownPlan, grid = false): { w: number; h: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const b of plan.buildings) {
    if (grid && (b.kind === "pier" || (b.lot >= 0 && plan.blocks[plan.lots[b.lot]!.block]!.district === "outskirts"))) continue;
    x0 = Math.min(x0, b.centre.x);
    x1 = Math.max(x1, b.centre.x);
    z0 = Math.min(z0, b.centre.z);
    z1 = Math.max(z1, b.centre.z);
  }
  return { w: x1 - x0, h: z1 - z0 };
}

/** Where a unit's street door opens: the point a metre and a half out from the front wall at the door. */
export function doorSpot(use: BuildingUse, unitIndex: number): { p: Vec; mid: Vec } | null {
  const f = use.frame;
  if (f === null) return null;
  const u = use.units[unitIndex];
  if (!u) return null;
  const s = u.door.s;
  return {
    p: { x: f.origin.x + f.t.x * s + f.n.x * 1.5, z: f.origin.z + f.t.z * s + f.n.z * 1.5 },
    mid: { x: f.origin.x + f.t.x * (f.width / 2) + f.n.x * 1.5, z: f.origin.z + f.t.z * (f.width / 2) + f.n.z * 1.5 },
  };
}

/**
 * Every unit door that has no sidewalk run at its station: `{building, unit, street, side, s}` for each door of `plan.uses` whose front stands on a
 * grid street (the nearest grid street's edge to the middle of the front, within 20 m: not the highway, whose bed has no sidewalk, and not a
 * building set further back) and stands on a side of it with no sidewalk run at the door's station (the station clamped to the street).
 */
export function doorsWithoutSidewalk(plan: TownPlan): { building: number; unit: number; street: number; side: number; s: number }[] {
  const out: { building: number; unit: number; street: number; side: number; s: number }[] = [];
  for (const use of plan.uses) {
    const b = plan.buildings[use.building] as Building;
    if (b.kind === "pier" || use.frame === null) continue;
    for (let k = 0; k < use.units.length; k++) {
      const spot = doorSpot(use, k);
      if (spot === null) continue;
      const hit = nearestStreet(plan, spot.mid);
      if (hit === null) continue;
      const len = dist(hit.street.a, hit.street.b);
      const s = Math.max(0, Math.min(len, ((spot.p.x - hit.street.a.x) * (hit.street.b.x - hit.street.a.x) + (spot.p.z - hit.street.a.z) * (hit.street.b.z - hit.street.a.z)) / len));
      const edge = plan.edges.find((e) => e.street === hit.street.id);
      if (!edge) continue;
      const side = edge.sides[hit.side];
      if (side === undefined || walkAt(side, s) === null) out.push({ building: use.building, unit: k, street: hit.street.id, side: hit.side, s });
    }
  }
  return out;
}

/** The grid street whose edge is nearest a point, within 20 m, and the side of it the point is on (0 left of a to b, 1 right). */
export function nearestStreet(plan: TownPlan, p: Vec): { street: Street; side: number } | null {
  let best: { street: Street; side: number } | null = null;
  let bestD = 20;
  for (const st of plan.streets) {
    if (st.kind !== "street" && st.kind !== "main" && st.kind !== "avenue") continue;
    const len = dist(st.a, st.b);
    if (len < 1) continue;
    const d = segDist(p, st.a, st.b) - st.width / 2;
    if (d < bestD) {
      const t = (-(p.x - st.a.x) * (st.b.z - st.a.z) + (p.z - st.a.z) * (st.b.x - st.a.x)) / len;
      bestD = d;
      best = { street: st, side: t >= 0 ? 0 : 1 };
    }
  }
  return best;
}
