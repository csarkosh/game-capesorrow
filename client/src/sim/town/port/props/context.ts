/**
 * What the props stage reads of the finished plan, gathered once: each street's frame, each lot's record (its building, yard, trade,
 * the street it fronts and the side), the lots that neighbour each other, how near the harbour each lot is, and the places that nothing
 * may stand on (a junction's pavement and crosswalks, a drive's and an alley's mouth, a street's end, the spawn, every building).
 */
import { bearingU, bearingV } from "../../bearings.js";
import { orient, segCross, segDist, type Poly } from "../../geom.js";
import { yardShape, type YardShape } from "../../yardShapes.js";
import { hashSeed, next, type Rng } from "../../rng.js";
import type { Building, BuildingUse, Lot, StreetEdge, Street, TownPlan, Trade, Vec, Yard } from "../../types.js";
import { PROP_OFFSET } from "../../railKeepOut.js";
import { boxAt, Occupancy, type Box } from "./boxes.js";
import { CLEAR_DRIVE, CLEAR_JUNCTION, CLEAR_END, DRAW, DRAW_DEFAULT, DRAW_KIND } from "./tuning.js";

/** The plan as the stage needs it: everything but the props themselves. */
export type BasePlan = Omit<TownPlan, "props">;

export type StreetFrame = {
  readonly street: Street;
  readonly edge: StreetEdge;
  readonly ax: number;
  readonly az: number;
  readonly tx: number;
  readonly tz: number;
  /** The left normal (a positive lateral offset lies left of the direction). */
  readonly nx: number;
  readonly nz: number;
  readonly length: number;
  readonly hw: number;
};

/** A point at `s` along a street and `t` to its left. */
export function at(f: StreetFrame, s: number, t: number): Vec {
  return { x: f.ax + f.tx * s + f.nx * t, z: f.az + f.tz * s + f.nz * t };
}

export type LotInfo = {
  readonly lot: Lot;
  readonly poly: Poly;
  readonly building: Building | undefined;
  readonly use: BuildingUse | undefined;
  readonly yard: Yard;
  readonly shape: YardShape;
  /** The street it fronts (index into frames), or -1, and the side of it (0 left, 1 right). */
  readonly street: number;
  readonly side: 0 | 1;
  /** The lot's frame: the frontage's first end, the unit vector along the frontage, the unit vector into the lot, the frontage's length and the lot's greatest depth. */
  readonly ox: number;
  readonly oz: number;
  readonly tx: number;
  readonly tz: number;
  readonly dx: number;
  readonly dz: number;
  readonly frontLen: number;
  readonly depth: number;
  /** A building stands here and is open (it has a use); and the trade of its main open unit. */
  readonly lived: boolean;
  readonly trade: Trade | null;
  /** Distance of the lot's middle from the quay, metres. */
  readonly harbour: number;
  /** Lots that share a boundary with this one. */
  readonly neighbours: readonly number[];
  /** A number of the lot's own. */
  readonly salt: number;
};

export type Context = {
  readonly plan: BasePlan;
  readonly frames: readonly (StreetFrame | undefined)[];
  readonly lots: readonly LotInfo[];
  readonly occ: Occupancy;
  /** Only the buildings (for what may stand up against them: a fence along a lot line). */
  readonly bocc: Occupancy;
  readonly seed0: number;
};

/** A stream of one category and one id: a draw added to one category moves no other's. */
export function sub(seed0: number, tag: number, id: number): Rng {
  return { state: hashSeed(hashSeed(seed0, tag), id) };
}

/** How strongly a building draws cars to its door when it is open: the sum over its open units, at most 1.4. */
export function drawOf(b: Building, use: BuildingUse | undefined): number {
  if (b.state !== "open") return 0;
  let w: number = DRAW_KIND[b.kind as keyof typeof DRAW_KIND] ?? 0;
  if (use !== undefined) {
    for (const u of use.units) {
      if (u.state !== "open" || u.tenant === null) continue;
      w += DRAW[u.tenant.trade] ?? DRAW_DEFAULT;
    }
  }
  return Math.min(1.4, w);
}

export function frameOfStreet(street: Street, edge: StreetEdge): StreetFrame | undefined {
  const dx = street.b.x - street.a.x;
  const dz = street.b.z - street.a.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (!(length > 4)) return undefined;
  const tx = dx / length;
  const tz = dz / length;
  return { street, edge, ax: street.a.x, az: street.a.z, tx, tz, nx: -tz, nz: tx, length, hw: street.roadway / 2 };
}

/** The part of a building's footprint as a box (its own axes). */
export function buildingBox(b: Building): Box {
  const u = bearingU(b.bearing);
  void bearingV;
  return { cx: b.centre.x, cz: b.centre.z, ux: u.x, uz: u.z, hu: b.halfAlong, hv: b.halfAcross };
}

export function contextOf(plan: BasePlan, seed0: number): Context {
  const frames: (StreetFrame | undefined)[] = plan.streets.map((s) => {
    const e = plan.edges[s.id];
    return e === undefined ? undefined : frameOfStreet(s, e);
  });
  const buildingOf: (Building | undefined)[] = plan.lots.map(() => undefined);
  for (const b of plan.buildings) if (b.lot >= 0 && b.kind !== "pier") buildingOf[b.lot] = b;
  const useOf = (id: number): BuildingUse | undefined => plan.uses[id];

  const lots: LotInfo[] = [];
  const quay = plan.quay;
  for (const lot of plan.lots) {
    const poly = orient(lot.polygon);
    const yard = plan.yards[lot.id] as Yard;
    const shape = yardShape(plan as TownPlan, lot.id);
    const b = buildingOf[lot.id];
    const front = shape.front;
    let ox = 0;
    let oz = 0;
    let tx = 1;
    let tz = 0;
    let dx = 0;
    let dz = 1;
    let frontLen = 0;
    if (front !== null) {
      const ex = front.b.x - front.a.x;
      const ez = front.b.z - front.a.z;
      frontLen = Math.sqrt(ex * ex + ez * ez);
      ox = front.a.x;
      oz = front.a.z;
      tx = ex / frontLen;
      tz = ez / frontLen;
      dx = -tz;
      dz = tx;
    }
    let depth = 0;
    for (const p of poly) depth = Math.max(depth, (p.x - ox) * dx + (p.z - oz) * dz);
    // The street it fronts: the nearest street of the town's grid (not the highway's bed or a stair) to the frontage's middle.
    const mx = ox + tx * frontLen * 0.5;
    const mz = oz + tz * frontLen * 0.5;
    let best = -1;
    let bestD = Infinity;
    for (const f of frames) {
      if (f === undefined || f.street.kind === "stair" || f.street.kind === "rail") continue;
      const d = segDist({ x: mx, z: mz }, f.street.a, f.street.b) - f.street.width / 2;
      if (d < bestD) {
        bestD = d;
        best = f.street.id;
      }
    }
    const sf = best >= 0 ? (frames[best] as StreetFrame) : undefined;
    const side: 0 | 1 = sf !== undefined && (mx - sf.ax) * sf.nx + (mz - sf.az) * sf.nz > 0 ? 0 : 1;
    const use = b === undefined ? undefined : useOf(b.id);
    let trade: Trade | null = null;
    if (use !== undefined) for (const u of use.units) if (u.state === "open" && u.tenant !== null && trade === null) trade = u.tenant.trade;
    let hd = Infinity;
    {
      const qx = quay.b.x - quay.a.x;
      const qz = quay.b.z - quay.a.z;
      const q2 = qx * qx + qz * qz;
      const k = q2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - quay.a.x) * qx + (mz - quay.a.z) * qz) / q2));
      const ex = mx - (quay.a.x + qx * k);
      const ez = mz - (quay.a.z + qz * k);
      hd = Math.sqrt(ex * ex + ez * ez);
    }
    lots.push({
      lot, poly, building: b, use, yard, shape, street: best, side, ox, oz, tx, tz, dx, dz, frontLen, depth,
      lived: b !== undefined && b.state === "open", trade, harbour: hd, neighbours: [], salt: hashSeed(seed0, lot.id * 7 + 3),
    });
  }
  // Neighbours: lots whose boundaries touch (two corners of one within a hand of the other's outline).
  const boxes = lots.map((l) => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of l.poly) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    return [x0, z0, x1, z1] as const;
  });
  const near: number[][] = lots.map(() => []);
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      const a = boxes[i] as readonly number[];
      const c = boxes[j] as readonly number[];
      if (a[0]! > c[2]! + 0.7 || c[0]! > a[2]! + 0.7 || a[1]! > c[3]! + 0.7 || c[1]! > a[3]! + 0.7) continue;
      const pa = (lots[i] as LotInfo).poly;
      const pb = (lots[j] as LotInfo).poly;
      let touching = 0;
      for (const p of pa) for (let k = 0; k < pb.length; k++) if (segDist(p, pb[k] as Vec, pb[(k + 1) % pb.length] as Vec) < 0.7) touching++;
      for (const p of pb) for (let k = 0; k < pa.length; k++) if (segDist(p, pa[k] as Vec, pa[(k + 1) % pa.length] as Vec) < 0.7) touching++;
      if (touching >= 2) {
        (near[i] as number[]).push(j);
        (near[j] as number[]).push(i);
      }
    }
  }
  const withNeighbours = lots.map((l, i) => ({ ...l, neighbours: near[i] as number[] }));

  // The places nothing may stand on.
  const occ = new Occupancy();
  for (const j of plan.junctions) {
    for (const leg of [...j.legs, ...j.closed]) {
      if (leg.engine) continue;
      const len = Math.max(leg.mouth, leg.bandLeft, leg.bandRight, 0) + CLEAR_JUNCTION;
      occ.add(boxAt(leg.x + leg.dx * len * 0.5, leg.z + leg.dz * len * 0.5, leg.dx, leg.dz, len, 2 * Math.max(leg.outer, leg.half + 1)), "keep:junction");
    }
    // The junction's middle, where the legs' reference points may lie off it.
    if (j.kind !== "alley") occ.add(boxAt(j.x, j.z, 1, 0, CLEAR_JUNCTION * 1.6, CLEAR_JUNCTION * 1.6), "keep:junction");
    if (j.alley !== null) {
      const m = j.alley;
      occ.add(boxAt(m.x - m.dx * 3.5, m.z - m.dz * 3.5, m.dx, m.dz, 9, m.width + 2 * CLEAR_DRIVE), "keep:alley");
    }
  }
  // Wherever two streets of the grid cross or meet, whatever the junction's record holds (a sharp crossing's closed legs, a tee's stem).
  for (const fa of frames) {
    for (const fb of frames) {
      if (fa === undefined || fb === undefined || fa.street.id >= fb.street.id) continue;
      const ka = fa.street.kind;
      const kb = fb.street.kind;
      if (ka === "stair" || kb === "stair" || ka === "rail" || kb === "rail" || ka === "alley" || kb === "alley") continue;
      const x = segCross(fa.street.a, fa.street.b, fb.street.a, fb.street.b);
      const reach = fa.street.width / 2 + fb.street.width / 2 + CLEAR_JUNCTION;
      // Where a junction's own record is, its boxes are made.
      const at0 = x === null ? null : { x: fa.street.a.x + (fa.street.b.x - fa.street.a.x) * x.t, z: fa.street.a.z + (fa.street.b.z - fa.street.a.z) * x.t };
      if (at0 !== null && plan.junctions.some((j) => j.kind !== "alley" && (j.x - at0.x) * (j.x - at0.x) + (j.z - at0.z) * (j.z - at0.z) < 100)) continue;
      if (x === null) {
        // A street that ends on another's side: its end lies within the other's right of way.
        const dEnds = Math.min(segDist(fa.street.a, fb.street.a, fb.street.b), segDist(fa.street.b, fb.street.a, fb.street.b), segDist(fb.street.a, fa.street.a, fa.street.b), segDist(fb.street.b, fa.street.a, fa.street.b));
        if (dEnds > 1.5) continue;
        const ends = [fa.street.a, fa.street.b, fb.street.a, fb.street.b];
        const p = ends.reduce((best, e) => {
          const d = Math.min(segDist(e, fa.street.a, fa.street.b), segDist(e, fb.street.a, fb.street.b));
          return d < best.d ? { d, e } : best;
        }, { d: Infinity, e: ends[0] as Vec }).e;
        occ.add(boxAt(p.x, p.z, fa.tx, fa.tz, reach * 1.2, reach * 1.2), "keep:junction");
      } else {
        const px = fa.street.a.x + (fa.street.b.x - fa.street.a.x) * x.t;
        const pz = fa.street.a.z + (fa.street.b.z - fa.street.a.z) * x.t;
        occ.add(boxAt(px, pz, fa.tx, fa.tz, reach * 1.2, reach * 1.2), "keep:junction");
      }
    }
  }
  for (const e of plan.ends) occ.add(boxAt(e.x - e.dx * 3, e.z - e.dz * 3, e.dx, e.dz, CLEAR_END * 2 + 6, 14), "keep:end");
  occ.add(boxAt(plan.spawn.x, plan.spawn.z, 1, 0, 9, 9), "keep:spawn");
  for (const l of withNeighbours) {
    const d = l.shape.drive;
    if (d !== null) occ.add(boxAt(d.x - d.dx * 3.5, d.z - d.dz * 3.5, d.dx, d.dz, 7, 2 * d.half + 2 * CLEAR_DRIVE), "keep:drive");
  }
  for (const l of withNeighbours) {
    const w = l.shape.walk;
    if (w !== null) occ.add(boxAt(w.x + w.dx * w.length * 0.5, w.z + w.dz * w.length * 0.5, w.dx, w.dz, w.length, 2 * w.half + 0.4), "keep:walk");
  }
  // The railroad's corridor: the bed and the props' clearance each side of the main line and the spur, a box to each of their legs.
  for (const line of [plan.rail.main, ...plan.rail.spurs.map((sp) => sp.points)]) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Vec;
      const b = line[i] as Vec;
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      if (len < 1e-6) continue;
      // Grown a little at the ends so that the boxes of a bend overlap, and across so that the clearance holds at the box's corners.
      occ.add(boxAt((a.x + b.x) / 2, (a.z + b.z) / 2, (b.x - a.x) / len, (b.z - a.z) / len, len + 1, 2 * PROP_OFFSET + 0.3), "keep:rail");
    }
  }
  const bocc = new Occupancy();
  for (const b of plan.buildings) {
    if (b.kind === "pier") continue;
    occ.add(buildingBox(b), "building");
    bocc.add(buildingBox(b), "building");
  }
  return { plan, frames, lots: withNeighbours, occ, bocc, seed0 };
}

/** A pick by weights from a plain number in [0, 1). */
export function pickIndex(weights: readonly number[], x: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = x * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] as number;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export { next };
