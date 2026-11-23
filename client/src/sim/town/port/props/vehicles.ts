/**
 * Where vehicles stand, and why. Each comes from the history the plan already holds:
 *
 * - **At the curb** of the core and the old streets, thick outside the open diner, tavern and grocery (a unit's trade draws cars to its
 *   door, a vacant front draws none) and sparse where the fronts are vacant; one side of a narrow street and both of the main street;
 *   each a few degrees crooked and a hand's width to half a metre off the curb; never in a junction, a crosswalk, a drive's mouth or
 *   an alley's, nor on the spawn. A street with no curb has them pulled onto the shoulder.
 * - **In the drive and the yard** of a house, by whether it is lived in and how the yard is kept: a daily driver in a mown lot's drive,
 *   trucks in a bare one, a project car on blocks under a tarp and a dead one sunk in the grass of a neglected one.
 * - **In the lots of businesses**: the highway strip's painted stalls, a few cars by a business that draws them, work trucks at the
 *   shops that keep them, a dumped car on a vacant paved lot.
 * - **On the apron at the harbour**: trucks, and trailers waiting for their boats.
 *
 * Every draw is from a stream of its own (`sub`), so a draw added in one place moves no other.
 */
import { bearingU, bearingV } from "../../bearings.js";
import { orient } from "../../geom.js";
import { chance, next, range, type Rng } from "../../rng.js";
import type { Block, BoatTrailer, Vehicle, VehicleKind, VehicleLoad, VehicleSpot, VehicleState } from "../../types.js";
import { boxAt, boxInside, turned } from "./boxes.js";
import { at, contextOf, drawOf, pickIndex, sub, type Context, type LotInfo, type StreetFrame } from "./context.js";
import { put, type Out } from "./out.js";
import * as T from "./tuning.js";

void contextOf;

/** Tags of the streams (never renumbered). */
export const TAG = { curb: 1, lot: 2, strip: 3, harbour: 4, pole: 5, mail: 6, fence: 7, bin: 8, gear: 9, trailer: 10, dedupe: 11 } as const;

function weightedKind(rng: Rng, table: T.W<VehicleKind>): VehicleKind {
  return table[pickIndex(table.map((e) => e[1]), next(rng))]![0];
}

function paint(rng: Rng): number {
  return pickIndex(T.PAINT_WEIGHTS, next(rng));
}

/** Dimensions of a kind at an age (a new full-size pickup is long, an old one short). */
function dims(kind: VehicleKind, age: number): readonly [number, number] {
  if (kind === "pickup") return age < 0.3 ? T.DIMS["pickup new"] : age > 0.65 ? T.DIMS["pickup old"] : T.DIMS.pickup;
  return T.DIMS[kind];
}

function loadFor(rng: Rng, kind: VehicleKind, state: VehicleState): VehicleLoad {
  const r = next(rng);
  if (state === "derelict") return r < 0.2 ? "tarp" : "none";
  if (kind === "work truck") return r < 0.55 ? "flatbed" : "rack";
  if (kind === "pickup") {
    if (state === "work") return r < 0.4 ? "gear" : r < 0.65 ? "rack" : r < 0.8 ? "ladder" : "firewood";
    return r < 0.1 ? "gear" : r < 0.16 ? "firewood" : "none";
  }
  if (kind === "van") return r < 0.3 ? "rack" : "none";
  return "none";
}

export type VehicleSpec = { kind: VehicleKind; x: number; z: number; hx: number; hz: number; spot: VehicleSpot; lot: number; state: VehicleState; age?: number; idle?: number };

/** Draws the vehicle's own record (age, paint, load) and returns it (the caller puts it down). */
export function makeVehicle(out: Out, rng: Rng, v: VehicleSpec, eraAge = 0.5): Vehicle {
  const age = v.age ?? Math.min(1, Math.max(0, eraAge + range(rng, -0.5, 0.5) * (v.state === "derelict" ? 0.4 : 1) + (v.state === "derelict" ? 0.35 : 0)));
  const idle = v.idle ?? (v.state === "derelict" ? range(rng, 0.75, 1) : v.state === "project" ? range(rng, 0.5, 0.85) : v.state === "work" ? range(rng, 0.05, 0.35) : range(rng, 0, 0.22));
  const [length, width] = dims(v.kind, age);
  return {
    id: out.id(), kind: v.kind, x: v.x, z: v.z, hx: v.hx, hz: v.hz, colour: paint(rng), age, state: v.state, load: loadFor(rng, v.kind, v.state), spot: v.spot, lot: v.lot, idle, seed: Math.floor(next(rng) * 0x7fffffff), length, width,
  };
}

/** Puts a vehicle down if its box is free. */
export function placeVehicle(ctx: Context, out: Out, rng: Rng, v: VehicleSpec, lot: LotInfo | null, eraAge: number, margin = 0.6): boolean {
  const veh = makeVehicle(out, rng, v, eraAge);
  const box = boxAt(v.x, v.z, v.hx, v.hz, veh.length, veh.width);
  if (!put(ctx, out, box, "vehicle", { lot, margin })) return false;
  out.vehicles.push(veh);
  return true;
}

// ---- The age of a place ---------------------------------------------------------------------------------------------------------

/** How old the cars of a lot are: a house of the 1950s keeps older cars than a new one, an untended yard older still. */
function eraAge(info: LotInfo): number {
  const era = info.building?.era ?? 1960;
  return Math.min(0.9, Math.max(0.1, (2020 - era) / 260 + (1 - info.yard.kept) * 0.35));
}

// ---- Along the curb ------------------------------------------------------------------------------------------------------------

/** How strongly the open businesses on a street's frontage draw cars at distance `s` along it: and how many vacant fronts stand there. */
function attraction(ctx: Context, f: StreetFrame, side: 0 | 1): { s: number; w: number; vacant: boolean }[] {
  const list: { s: number; w: number; vacant: boolean }[] = [];
  for (const l of ctx.lots) {
    if (l.street !== f.street.id || l.building === undefined) continue;
    const b = l.building;
    const s = (b.centre.x - f.ax) * f.tx + (b.centre.z - f.az) * f.tz;
    const w = drawOf(b, l.use) * (l.side === side ? 1 : 0.5);
    list.push({ s, w, vacant: b.state !== "open" });
  }
  return list;
}

/** Cars at the door of each building that draws them (an open diner, a tavern, the grocery): a few, in the stalls nearest it, before the rest of the curb is filled. */
function doorCars(ctx: Context, out: Out): void {
  for (const info of ctx.lots) {
    const b = info.building;
    if (b === undefined || info.street < 0) continue;
    const f = ctx.frames[info.street] as StreetFrame;
    const st = f.street;
    if (st.kind !== "main" && st.kind !== "avenue" && st.kind !== "street") continue;
    const draw = drawOf(b, info.use);
    if (draw < 0.5) continue;
    const rng = sub(ctx.seed0, TAG.curb, 400000 + info.lot.id);
    const side = info.side;
    const edge = f.edge.sides[side];
    if (!edge.curb) continue;
    const sign = side === 0 ? 1 : -1;
    const want = Math.min(4, Math.round(draw * (1 + next(rng) * 2.2)));
    const sb = (b.centre.x - f.ax) * f.tx + (b.centre.z - f.az) * f.tz;
    let made = 0;
    for (let k = 0; k < 14 && made < want; k++) {
      const s = sb + range(rng, -12, 12);
      if (s < 3 || s > f.length - 3) continue;
      const kind = weightedKind(rng, T.KIND_COMMON);
      const [length, width] = dims(kind, 0.5);
      const tc = f.hw - range(rng, T.CURB_GAP.min, T.CURB_GAP.max) - width / 2;
      if (tc - width / 2 < T.CENTRE_KEEP || (st.roadway < T.TWO_SIDES_FROM && st.roadway - (f.hw - tc + width / 2) < T.TRAFFIC_WIDTH)) continue;
      const face = (side === 1 ? 1 : -1) * (chance(rng, T.WRONG_WAY) ? -1 : 1);
      const hd = turned(f.tx * face, f.tz * face, range(rng, -T.CROOK, T.CROOK));
      const pos = at(f, s, sign * tc);
      if (placeVehicle(ctx, out, rng, { kind, x: pos.x, z: pos.z, hx: hd.x, hz: hd.z, spot: "curb", lot: -1, state: "daily" }, null, 0.35, 0.45)) made++;
      void length;
    }
  }
}

function curbVehicles(ctx: Context, out: Out): void {
  doorCars(ctx, out);
  for (const f of ctx.frames) {
    if (f === undefined) continue;
    const st = f.street;
    if (st.kind !== "main" && st.kind !== "avenue" && st.kind !== "street") continue;
    const era = f.edge.era;
    const sides: (0 | 1)[] = st.roadway >= T.TWO_SIDES_FROM ? [0, 1] : [sub(ctx.seed0, TAG.curb, st.id * 3).state & 1 ? 0 : 1];
    for (const side of sides) {
      const rng = sub(ctx.seed0, TAG.curb, st.id * 3 + 1 + side);
      const edge = f.edge.sides[side];
      const sign = side === 0 ? 1 : -1;
      const attract = attraction(ctx, f, side);
      let s = range(rng, 1, 4);
      while (s < f.length - 3) {
        let w = 0;
        let vac = 0;
        for (const a of attract) {
          const d = Math.abs(a.s - s);
          if (d < T.DRAW_REACH) {
            if (a.vacant) vac = Math.max(vac, 1 - d / T.DRAW_REACH);
            else w += a.w * (1 - d / T.DRAW_REACH);
          }
        }
        const p = Math.min(0.88, (T.CURB_BASE[era] * (1 - vac * (1 - T.VACANT_FRONT)) + T.DRAW_GAIN * Math.min(1, w)));
        if (!chance(rng, p)) {
          s += range(rng, T.STALL.min, T.STALL.max) * 0.8;
          continue;
        }
        const derelict = (era === "old" || era === "edge") && vac > 0.3 && chance(rng, 0.12);
        const kind = weightedKind(rng, derelict ? T.KIND_OLD : w > 0.6 || era === "core" ? T.KIND_COMMON : era === "later" ? T.KIND_TIDY : T.KIND_COMMON);
        const state: VehicleState = derelict ? "derelict" : "daily";
        const [length, width] = dims(kind, 0.5);
        const gap = range(rng, T.CURB_GAP.min, T.CURB_GAP.max);
        let tc: number;
        if (edge.curb) tc = f.hw - gap - width / 2;
        else {
          const out2 = Math.min(0.9, edge.verge - 0.3);
          if (out2 < 0.3) {
            s += 3;
            continue;
          }
          tc = f.hw + out2 - width / 2;
        }
        // The inner edge keeps off the centre line, and the traffic's width is left on a one-sided street.
        const inner = tc - width / 2;
        const sc = s + length / 2;
        if (inner < T.CENTRE_KEEP || (sides.length === 1 && st.roadway - (f.hw - tc + width / 2) < T.TRAFFIC_WIDTH)) {
          s += range(rng, 4, 8);
          continue;
        }
        const wrong = chance(rng, T.WRONG_WAY);
        const face = (side === 1 ? 1 : -1) * (wrong ? -1 : 1);
        const hd = turned(f.tx * face, f.tz * face, range(rng, -T.CROOK, T.CROOK));
        const pos = at(f, sc, sign * tc);
        const ok = placeVehicle(ctx, out, rng, { kind, x: pos.x, z: pos.z, hx: hd.x, hz: hd.z, spot: edge.curb ? "curb" : "pull-off", lot: -1, state, age: derelict ? 0.9 : undefined }, null, era === "core" ? 0.35 : 0.5, 0.45);
        s += (ok ? length : 0) + range(rng, 0.6, 2.4) + (ok ? 0 : 2.5);
      }
    }
  }
}

// ---- A lot's own ---------------------------------------------------------------------------------------------------------------

/** A free place in a lot for a box of this size, by a few tries; the heading comes from `heading`. */
export function scatter(ctx: Context, out: Out, info: LotInfo, rng: Rng, length: number, width: number, opts: { depth0: number; depth1: number; heading: (rng: Rng) => { x: number; z: number }; margin?: number; inset?: number; tries?: number; keep?: number }): { x: number; z: number; hx: number; hz: number } | null {
  const tries = opts.tries ?? 24;
  const d1 = Math.min(opts.depth1, info.depth - 1);
  if (d1 <= opts.depth0 || info.frontLen < 3) return null;
  for (let k = 0; k < tries; k++) {
    const s = range(rng, 0.5, info.frontLen - 0.5);
    const d = range(rng, opts.depth0, d1);
    const x = info.ox + info.tx * s + info.dx * d;
    const z = info.oz + info.tz * s + info.dz * d;
    const h = opts.heading(rng);
    const box = boxAt(x, z, h.x, h.z, length, width);
    const hit = tryFree(ctx, box, info, opts.margin ?? 0.8, opts.inset ?? 0.4, opts.keep);
    if (hit) return { x, z, hx: h.x, hz: h.z };
  }
  return null;
}

/** How far from a house a vehicle keeps: what an owner added to it (a lean-to or a carport reaches 3.5 m from a wall) is drawn, not planned. */
export const HOUSE_KEEP = 3.6;
function tryFree(ctx: Context, box: ReturnType<typeof boxAt>, info: LotInfo, margin: number, inset: number, keep = HOUSE_KEEP): boolean {
  const b = info.building;
  const house = b !== undefined && (b.kind === "house" || b.kind === "boarding house");
  return boxInside(box, info.poly, inset) && !ctx.occ.hits(box, margin) && !ctx.bocc.hits(box, house ? keep : 1.0);
}

/** A heading along the way into the lot or back out, or across, each a few degrees crooked. */
export function headingOf(info: LotInfo, mode: "along" | "across" | "any", crook = 0.07): (rng: Rng) => { x: number; z: number } {
  return (rng) => {
    const m = mode === "any" ? (next(rng) < 0.55 ? "along" : "across") : mode;
    const sg = next(rng) < 0.5 ? 1 : -1;
    const bx = m === "along" ? info.dx : info.tx;
    const bz = m === "along" ? info.dz : info.tz;
    return turned(bx * sg, bz * sg, range(rng, -crook, crook));
  };
}

function yardKindsKept(info: LotInfo): boolean {
  return info.yard.kind === "mown";
}

function houseVehicles(ctx: Context, out: Out, info: LotInfo): void {
  const b = info.building;
  const rng = sub(ctx.seed0, TAG.lot, info.lot.id);
  const state = b === undefined ? "vacant lot" : b.state;
  const yk = info.yard.kind;
  const age = eraAge(info);
  const lotId = info.lot.id;
  // The drive's vehicle.
  const drive = info.shape.drive;
  if (b !== undefined && drive !== null) {
    const p = state === "open" ? T.DRIVE_VEHICLE.open : state === "vacant" ? T.DRIVE_VEHICLE.vacant : T.DRIVE_VEHICLE.ruin;
    if (chance(rng, p)) {
      const dead = state !== "open" && chance(rng, 0.6);
      const table = yk === "bare" || yk === "tall" ? T.KIND_WORKING : yardKindsKept(info) ? T.KIND_TIDY : b.era <= 1950 ? T.KIND_OLD : T.KIND_COMMON;
      const kind = weightedKind(rng, table);
      const [length] = dims(kind, 0.5);
      // The drive runs on past the house's front where the house stands to one side: try depths along it, nearest the street first (or anywhere along it), for a free one.
      const [, width] = dims(kind, 0.5);
      const sg = next(rng) < 0.5 ? 1 : -1;
      const deep = Math.min(drive.length + 14, info.depth - length / 2 - 1.2);
      const start = 0.7 + length / 2;
      const order = next(rng) < 0.5;
      for (let k = 0; k < 10; k++) {
        const dd = order ? start + (deep - start) * (k / 9) * (k / 9) : start + range(rng, 0, Math.max(0, deep - start));
        if (deep < start) break;
        const h = turned(drive.dx * sg, drive.dz * sg, range(rng, -0.03, 0.03));
        const x = drive.x + drive.dx * dd;
        const z = drive.z + drive.dz * dd;
        if (!tryFree(ctx, boxAt(x, z, h.x, h.z, length, width), info, 0.5, 0.3)) continue;
        const state2: VehicleState = dead ? "derelict" : kind === "work truck" || (kind === "pickup" && (yk === "bare" || yk === "tall") && chance(rng, 0.5)) ? "work" : "daily";
        placeVehicle(ctx, out, rng, { kind, x, z, hx: h.x, hz: h.z, spot: "drive", lot: lotId, state: state2 }, null, age, 0.2);
        break;
      }
    }
  }
  if (b === undefined) return;
  const lived = state === "open";
  // A second vehicle on the yard.
  if (lived && chance(rng, T.SECOND_VEHICLE[yk] ?? 0)) {
    const kind = weightedKind(rng, yk === "bare" ? T.KIND_WORKING : T.KIND_COMMON);
    const [length, width] = dims(kind, 0.5);
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3.5, depth1: 16, heading: headingOf(info, "any") });
    if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "yard", lot: lotId, state: kind === "work truck" ? "work" : "daily" }, info, age);
  }
  // A project car on blocks under a tarp.
  if (lived && (yk === "shaggy" || yk === "tall" || yk === "bare" || yk === "mossy") && chance(rng, T.PROJECT_CAR)) {
    const kind: VehicleKind = next(rng) < 0.5 ? "sedan" : "pickup";
    const [length, width] = dims(kind, 0.8);
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: 4, depth1: 18, heading: headingOf(info, "any"), keep: 2.4 });
    if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "yard", lot: lotId, state: "project", age: range(rng, 0.7, 1) }, info, age);
  }
  // A dead one in the grass.
  const dprob = T.DERELICT_YARD[yk] ?? [0, 0];
  if (chance(rng, lived ? dprob[0] : dprob[1])) {
    const kind = weightedKind(rng, T.KIND_OLD);
    const [length, width] = dims(kind, 0.9);
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: 4, depth1: 22, heading: headingOf(info, "any", 0.18) });
    if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "yard", lot: lotId, state: "derelict" }, info, 0.9);
  }
  // A travel trailer in a side yard.
  if (lived && (yk === "bare" || yk === "shaggy" || yk === "mossy" || yk === "tall") && info.frontLen > 14 && chance(rng, T.CAMPER)) {
    const [length, width] = dims("camper", 0.5);
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: 6, depth1: 22, heading: headingOf(info, "any", 0.1) });
    if (sp !== null) placeVehicle(ctx, out, rng, { kind: "camper", x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "yard", lot: lotId, state: yk === "tall" || chance(rng, 0.3) ? "derelict" : "daily" }, info, age);
  }
}

/** A boat on its trailer in a yard: more near the harbour. */
function boatTrailers(ctx: Context, out: Out, info: LotInfo): void {
  const b = info.building;
  if (b === undefined || b.state === "ruin") return;
  const rng = sub(ctx.seed0, TAG.trailer, info.lot.id);
  const near = info.harbour < T.HARBOUR_NEAR || info.lot.district === "mill housing" || info.lot.district === "dock";
  const p = (near ? T.BOAT_NEAR : T.BOAT_FAR) * (b.state === "open" ? 1 : 0.35);
  if (!chance(rng, p)) return;
  const skiff = chance(rng, T.BOAT_SKIFF);
  const length = skiff ? range(rng, 5.2, 6.2) : range(rng, 6.4, 7.8);
  const width = 2.35;
  const sp = scatter(ctx, out, info, rng, length, width, { depth0: 5, depth1: 20, heading: headingOf(info, "any", 0.12), margin: 0.9, keep: 2.4 });
  if (sp === null) return;
  const tr = makeTrailer(out, rng, { x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, boat: skiff ? "skiff" : "runabout", lot: info.lot.id, length, width, kept: info.yard.kept });
  const box = boxAt(sp.x, sp.z, sp.hx, sp.hz, length, width);
  if (put(ctx, out, box, "trailer", { lot: info, margin: 0.9 })) out.trailers.push(tr);
}

export function makeTrailer(out: Out, rng: Rng, t: { x: number; z: number; hx: number; hz: number; boat: BoatTrailer["boat"]; lot: number; length: number; width: number; kept: number }): BoatTrailer {
  return {
    id: out.id(), x: t.x, z: t.z, hx: t.hx, hz: t.hz, boat: t.boat, colour: Math.floor(next(rng) * 8), tarp: t.boat !== "none" && chance(rng, T.BOAT_TARP + (1 - t.kept) * 0.25),
    weeds: Math.min(1, Math.max(0, (0.55 - t.kept) * 1.6 + range(rng, -0.15, 0.2))), lot: t.lot, seed: Math.floor(next(rng) * 0x7fffffff), length: t.length, width: t.width,
  };
}

// ---- Business lots ---------------------------------------------------------------------------------------------------------------

/** The highway strip's painted stalls (the same rule `game/town/groundGeometry.ts` paints them by), and a car in some. */
function stripStalls(ctx: Context, out: Out, block: Block): void {
  const rng = sub(ctx.seed0, TAG.strip, block.id);
  const poly = orient(block.polygon);
  let best = 0;
  let from = poly[0]!;
  let to = poly[1]!;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    const l = Math.sqrt((c.x - a.x) * (c.x - a.x) + (c.z - a.z) * (c.z - a.z));
    if (l > best) {
      best = l;
      from = a;
      to = c;
    }
  }
  const tx = (to.x - from.x) / best;
  const tz = (to.z - from.z) / best;
  const ix = -tz;
  const iz = tx;
  const footprints = ctx.lots.filter((l) => l.lot.block === block.id && l.building !== undefined);
  const corner = (b: NonNullable<LotInfo["building"]>): { x: number; z: number }[] => {
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => ({ x: b.centre.x + u.x * b.halfAlong * a! + v.x * b.halfAcross * c!, z: b.centre.z + u.z * b.halfAlong * a! + v.z * b.halfAcross * c! }));
  };
  const polys = footprints.map((l) => orient(corner(l.building!)));
  const clear = (x: number, z: number): boolean => polys.every((pl) => {
    const near = pl.some((c) => Math.sqrt((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z)) <= T.STALL_CLEAR);
    return !near && !insidePoly(pl, x, z, T.STALL_CLEAR);
  });
  for (let s = T.STALL_SETBACK + T.STALL_PITCH; s < best - T.STALL_SETBACK; s += T.STALL_PITCH) {
    const ax = from.x + tx * s + ix * T.STALL_SETBACK;
    const az = from.z + tz * s + iz * T.STALL_SETBACK;
    const bx = ax + ix * T.STALL_LENGTH;
    const bz = az + iz * T.STALL_LENGTH;
    const ok = [0, 0.25, 0.5, 0.75, 1].every((k) => {
      const x = ax + (bx - ax) * k;
      const z = az + (bz - az) * k;
      return insidePoly(poly, x, z, -0.5) && clear(x, z);
    });
    if (!ok) continue;
    // The business that draws cars: the nearest open building of the block.
    let draw = 0;
    for (const l of footprints) {
      const b = l.building!;
      const d = Math.sqrt((b.centre.x - ax) * (b.centre.x - ax) + (b.centre.z - az) * (b.centre.z - az));
      if (d < 45) draw = Math.max(draw, drawOf(b, l.use) * (1 - d / 45));
    }
    if (!chance(rng, Math.min(0.8, T.STRIP_STALL * (0.4 + draw * 1.4)))) continue;
    const kind = weightedKind(rng, next(rng) < 0.12 ? T.KIND_WORKING : T.KIND_COMMON);
    const inward = next(rng) < 0.72 ? 1 : -1;
    const h = turned(ix * inward, iz * inward, range(rng, -0.035, 0.035));
    const [length] = dims(kind, 0.5);
    const mid = T.STALL_SETBACK + T.STALL_LENGTH / 2;
    const cx = from.x + tx * (s + range(rng, -0.22, 0.22)) + ix * (mid + (length > 5.4 ? 0 : 0));
    const cz = from.z + tz * (s + range(rng, -0.22, 0.22)) + iz * mid;
    // A stall is 2.7 m wide: a wide vehicle takes it.
    placeVehicle(ctx, out, rng, { kind: kind === "work truck" || kind === "camper" ? "pickup" : kind, x: cx, z: cz, hx: h.x, hz: h.z, spot: "lot", lot: -1, state: "daily" }, null, 0.4, 0.05);
  }
}

function insidePoly(poly: readonly { x: number; z: number }[], x: number, z: number, tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    if (ex * (z - a.z) - ez * (x - a.x) < -tol * Math.sqrt(ex * ex + ez * ez)) return false;
  }
  return true;
}

function businessVehicles(ctx: Context, out: Out, info: LotInfo): void {
  const b = info.building;
  const rng = sub(ctx.seed0, TAG.lot, info.lot.id);
  const district = info.lot.district;
  const lotId = info.lot.id;
  if (b === undefined) {
    // A vacant lot next to an open business takes its overflow; a bare paved one holds a dumped car now and then.
    let nearDraw = 0;
    for (const n of info.neighbours) {
      const o = ctx.lots[n] as LotInfo;
      if (o.building !== undefined) nearDraw = Math.max(nearDraw, drawOf(o.building, o.use));
    }
    const n = nearDraw > 0.4 ? 1 + Math.floor(next(rng) * 3 * Math.min(1, nearDraw)) : 0;
    for (let i = 0; i < n; i++) {
      const kind = weightedKind(rng, T.KIND_COMMON);
      const [length, width] = dims(kind, 0.5);
      const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3, depth1: 14, heading: headingOf(info, "across", 0.06) });
      if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "lot", lot: lotId, state: "daily" }, info, 0.4);
    }
    if (n === 0 && chance(rng, 0.12)) {
      const [length, width] = dims("sedan", 0.9);
      const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3, depth1: 14, heading: headingOf(info, "any", 0.12) });
      if (sp !== null) placeVehicle(ctx, out, rng, { kind: next(rng) < 0.5 ? "sedan" : "pickup", x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "lot", lot: lotId, state: "derelict" }, info, 0.9);
    }
    return;
  }
  if (district === "highway strip") return;
  const draw = drawOf(b, info.use);
  const works = info.trade !== null && T.WORK_TRADES.includes(info.trade);
  // The lot's own cars, by the business's draw, kept off the street's side of the lot where the curb has them.
  const n = Math.floor(draw * T.LOT_CARS_MAX * next(rng) * (district === "core" ? 0.3 : 1));
  for (let i = 0; i < n; i++) {
    const kind = weightedKind(rng, works ? T.KIND_WORKING : T.KIND_COMMON);
    const [length, width] = dims(kind, 0.5);
    const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3, depth1: 18, heading: headingOf(info, "across", 0.06), margin: 0.5 });
    if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "lot", lot: lotId, state: kind === "work truck" ? "work" : "daily" }, info, 0.4);
  }
  if (works && b.state === "open") {
    for (let i = 0; i < 1 + Math.floor(next(rng) * 2); i++) {
      const kind: VehicleKind = next(rng) < 0.55 ? "work truck" : next(rng) < 0.5 ? "van" : "pickup";
      const [length, width] = dims(kind, 0.5);
      const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3, depth1: 20, heading: headingOf(info, "any", 0.08) });
      if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "lot", lot: lotId, state: "work" }, info, 0.5);
    }
  }
  if (b.kind === "junkyard") {
    for (let i = 0; i < 3 + Math.floor(next(rng) * 5); i++) {
      const kind = weightedKind(rng, T.KIND_OLD);
      const [length, width] = dims(kind, 0.9);
      const sp = scatter(ctx, out, info, rng, length, width, { depth0: 3, depth1: 30, heading: headingOf(info, "any", 0.2), margin: 0.3 });
      if (sp !== null) placeVehicle(ctx, out, rng, { kind, x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz, spot: "lot", lot: lotId, state: "derelict" }, info, 0.95, 0.3);
    }
  }
}

// ---- The harbour -----------------------------------------------------------------------------------------------------------------

function harbourVehicles(ctx: Context, out: Out): void {
  const plan = ctx.plan;
  const working = plan.harbour.boats.filter((b) => b.state === "working").length;
  const aprons = plan.decks.filter((d) => d.kind === "apron" || d.kind === "wharf");
  for (const d of aprons) {
    const rng = sub(ctx.seed0, TAG.harbour, d.id);
    // The deck's long axis: `axis` where it is longer along it, the way across where not.
    const alongLong = d.halfAlong >= d.halfAcross;
    const ax = alongLong ? d.axis.x : -d.axis.z;
    const az = alongLong ? d.axis.z : d.axis.x;
    const half = alongLong ? d.halfAlong : d.halfAcross;
    const short = alongLong ? d.halfAcross : d.halfAlong;
    const vx = -az;
    const vz = ax;
    if (short < 2.6 || half < 6) continue;
    const n = Math.min(10, Math.floor((working * 0.45 + 1.5) * Math.min(1, (half * short * 4) / 500) * (0.5 + next(rng))));
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const a = range(rng, -half + 4, half - 4);
        const c = range(rng, -(short - 2.1), short - 2.1);
        const x = d.centre.x + ax * a + vx * c;
        const z = d.centre.z + az * a + vz * c;
        const sg = next(rng) < 0.5 ? 1 : -1;
        const trailerOnly = next(rng) < 0.3;
        const kind: VehicleKind = next(rng) < 0.55 ? "pickup" : next(rng) < 0.5 ? "work truck" : "van";
        const h = turned(ax * sg, az * sg, range(rng, -0.04, 0.04));
        if (trailerOnly) {
          const length = range(rng, 5.4, 6.4);
          const box = boxAt(x, z, h.x, h.z, length, 2.35);
          if (ctx.occ.hits(box, 0.8)) continue;
          const hasBoat = next(rng) < 0.25;
          const tr = makeTrailer(out, rng, { x, z, hx: h.x, hz: h.z, boat: hasBoat ? "skiff" : "none", lot: -1, length, width: 2.35, kept: 0.7 });
          if (put(ctx, out, box, "trailer", { margin: 0.8 })) out.trailers.push(tr);
          break;
        }
        if (placeVehicle(ctx, out, rng, { kind, x, z, hx: h.x, hz: h.z, spot: "harbour", lot: -1, state: kind === "work truck" ? "work" : "daily" }, null, 0.55, 0.8)) break;
      }
    }
  }
}

// ---- All of it -------------------------------------------------------------------------------------------------------------------

export function planVehicles(ctx: Context, out: Out): void {
  for (const info of ctx.lots) {
    const b = info.building;
    const house = b !== undefined && (b.kind === "house" || b.kind === "boarding house" || b.kind === "apartment");
    if (info.yard.kind !== "paved" && (house || b === undefined) && info.lot.district !== "highway strip") {
      if (b === undefined && info.lot.district !== "residential" && info.lot.district !== "outskirts" && info.lot.district !== "mill housing") continue;
      houseVehicles(ctx, out, info);
      boatTrailers(ctx, out, info);
    } else if (info.yard.kind === "paved" || info.lot.district === "highway strip" || !house) {
      businessVehicles(ctx, out, info);
    }
  }
  for (const block of ctx.plan.blocks) if (block.district === "highway strip") stripStalls(ctx, out, block);
  curbVehicles(ctx, out);
  harbourVehicles(ctx, out);
}
