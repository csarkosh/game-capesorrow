/**
 * The doors that open for the people who walk through them: the drawing's, pure, from the plan and the walkers' list alone. Nothing is kept between frames: the
 * angle of a door at an instant is a function of the hour, so the same plan gives the same doors on every machine, and the door and the walker, drawn from one hour
 * (`peopleParts.ts` runs the hour on between the day clock's pushes), never disagree by a step.
 *
 * - **Which doors.** The door of every unit a trip begins or ends at (`Walker.from`, `Walker.to`): a shop's, with one leaf that swings (a pair of doors is one leaf of
 *   two opening: the one at the right as you go in). A house's door and a door nobody walks through are as they were, shut.
 * - **How it moves.** The leaf turns about its hinge edge INTO the room, to 80 to 95 degrees (its own, by a roll on the unit), in about 0.6 s from shut with an eased
 *   start and stop, is held while the walker is in the doorway, and closes on a closer, slower (1.4 to 2.2 s, its own), easing to the latch. The hinge is on the
 *   frame's left or right by a roll on the unit (the pull is on the other side: `frontGeometry.ts`).
 * - **When.** For someone leaving the door begins to open as they begin (they are 1.8 to 2 m back from its plane, out of the leaf's sweep: it swings into their side), so it is open before they cross; for someone arriving it begins when they are
 *   `ARRIVE_LEAD` short of it. It is held until they are `HOLD_PAST` past the leaf. A second walker soon after finds the leaf still open, or opens it again from the
 *   angle it has closed to, with no jump: each door's day is a list of keyframes made by following its walkers in time order, and the angle at an instant is read
 *   from it. (A walker's two ends at one door in a day are two walkers.)
 * - **Who is seen.** A trip begins and ends `doorDepth` metres inside the door's plane (as far as the room's clear floor allows, up to `MAX_IN`). Someone inside
 *   with the door shut is not drawn (`hiddenByDoor`): they are drawn from the instant the opening door shows them, already walking, and until it has shut behind them.
 * - **The vertex stage** (`townMaterial.ts`, `DOOR_VERTEX`) turns the leaf: `movingDoors` lists the doors that are not shut at an hour, as the uniforms want them.
 *
 * The door does not open for the player, and nobody reaches for a handle: the leaf opens by itself a moment before the walker, as an automatic door would.
 */
import { HOUR_S } from "../dayClock.js";
import { hashN } from "./groundNoise.js";
import { wrapHour } from "./hours.js";
import type { BuildingUse, Furnishing, TownPlan, Unit } from "../../sim/town/types.js";
import type { Walker } from "./walkers.js";

/** How far inside the door's plane a trip may begin and end at the most (metres): inside the room's sheet (`BACKDROP_AT`, 2.4 m). */
export const MAX_IN = 2.0;
/**
 * The least (metres): the leaf swings INTO the room through a sweep as long as itself, and a walker inside the door must be out of it while it opens: a leaf of 0.95 m
 * crosses the middle of the doorway up to 0.82 m in, a body is 0.25 m, and the door takes about half a second to pass the middle. A room with less clear floor in front of
 * its door has no walkers (`walkers.ts`: `placesOf`).
 */
export const MIN_IN = 1.8;
/** How far a furnishing is kept off the line a walker takes in (metres), and how wide that line is, a body and a bit. */
const CLEAR = 0.35;
const LINE = 0.4;
/** The leaf's width limit: a pair's one leaf is half the opening (see `frontGeometry.ts`). */
export const LEAF_THICK = 0.045;
/** How far short of the plane (metres) an arriving walker is when the door begins to open, and how far past it they are when it is let go. */
export const ARRIVE_LEAD = 1.4;
export const HOLD_PAST = 0.7;
/** The leaf is called shut (and a walker inside is not drawn) under this angle (radians): twelve degrees. */
export const SHUT_BELOW = (12 * Math.PI) / 180;

/** How a door looks and moves, rolled on the building's id and the unit's. */
export type DoorLook = {
  /** The hinge is on the frame's left (the lower stations of the unit's front). */
  readonly hingeNeg: boolean;
  /** The angle the leaf opens to (radians), and the real seconds it takes to open from shut and to close from open. */
  readonly maxAngle: number;
  readonly openS: number;
  readonly closeS: number;
};

export function doorLook(building: number, unit: number): DoorLook {
  const r = (salt: number): number => hashN(building, unit, salt, 4410);
  return {
    hingeNeg: r(1) < 0.5,
    maxAngle: ((80 + 15 * r(2)) * Math.PI) / 180,
    openS: 0.5 + 0.2 * r(3),
    closeS: 1.4 + 0.8 * r(4),
  };
}

/** A door this wide or wider is a pair of leaves of half its width, and the one at the right as you go in (the higher stations of the frame) is the one that opens. */
/** (The plan rolls a single door 0.95 to 1.1 m and a wide one 1.8 m: 1.4 parts them. At 1.1 a single door that rolled its top width was a pair of 0.55 m leaves, and a walker through the open half passed 0.25 m from the open leaf, a body's own radius.) */
export const PAIR_FROM = 1.4;
export const isPair = (width: number): boolean => width >= PAIR_FROM;

/** The leaf that opens, in the frame's stations: from `s0` to `s1`, with its hinge at the low end (`hingeLow`) or the high; a pair's is the right-hand half, hinged at its outer jamb. */
export function leafOf(door: { readonly s: number; readonly width: number }, look: DoorLook): { s0: number; s1: number; hingeLow: boolean; width: number } {
  if (isPair(door.width)) return { s0: door.s, s1: door.s + door.width / 2, hingeLow: false, width: door.width / 2 };
  return { s0: door.s - door.width / 2, s1: door.s + door.width / 2, hingeLow: look.hingeNeg, width: door.width };
}

/** Where along the front a walker goes in and out: the middle of the leaf that opens. */
export const doorWalkS = (door: { readonly s: number; readonly width: number }): number => (isPair(door.width) ? door.s + door.width / 4 : door.s);

/** How far the leaf's plane stands in from the wall's face: the recess of an entry, else a flush door's 10 cm. */
export const doorSet = (u: Pick<Unit, "door">): number => (u.door.recess > 0 ? u.door.recess : 0.1);

/** Whether the room has the clear floor the leaf needs beyond its plane (`MIN_IN`): else the door has no walkers. */
export const doorFits = (u: Pick<Unit, "door" | "interior">): boolean => doorDepth(u) - doorSet(u) >= MIN_IN;

/** How deep inside the door's plane (measured from the wall's face, so past a recess too) a trip begins and ends: the room's clear floor in front of the door, up to `MAX_IN` (under `MIN_IN` the door has no walkers). */
export function doorDepth(u: Pick<Unit, "door" | "interior">): number {
  const s = doorWalkS(u.door);
  let free = Math.min(MAX_IN + doorSet(u), u.interior.depth - 0.6);
  for (const f of u.interior.furnishings) free = Math.min(free, reachOf(f, s));
  return free;
}

/** How far in from the door's plane a furnishing begins to be in the way of a body walking straight in at station `s` (a large number where it is not). */
function reachOf(f: Furnishing, s: number): number {
  // Its extent is taken as the box that holds it (a skew one is larger than itself, which keeps a walker clear).
  const hs = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
  const hd = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
  if (Math.abs(f.s - s) > hs + LINE / 2 + CLEAR * 0.5) return 99;
  return f.d - hd - CLEAR;
}

/** A shop door that opens: where it is (the plan's frame), the way out of it and along its wall, its look, and its day as keyframes. */
export type Door = {
  readonly building: number;
  readonly unit: number;
  /** The middle of the door on the wall, in the plan's frame; the way out (into the street) and the wall's direction at the right as seen from the street. */
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly tx: number;
  readonly tz: number;
  readonly width: number;
  /** How far inside the door's plane the trips here begin and end (`doorDepth`). */
  readonly depth: number;
  /** How far the leaf's plane stands in from the wall's face (metres). */
  readonly set: number;
  readonly look: DoorLook;
  /** Keyframes, in hours: a segment from `t[i]` to `t[i + 1]` is `kind[i]` (0 opens, 1 is held, 2 closes) between the angles `a[i]` and `a[i + 1]`. */
  readonly t: Float64Array;
  readonly a: Float64Array;
  readonly kind: Uint8Array;
};

export type DoorBook = {
  readonly doors: readonly Door[];
  readonly byUnit: ReadonlyMap<number, number>;
  readonly anchor: { readonly x: number; readonly z: number };
};

/** The key of a unit in `DoorBook.byUnit`. */
export const unitKey = (building: number, unit: number): number => building * 4096 + unit;

const smoothstep = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

/** The angle of door `d` at `hour` (radians, 0 shut). */
export function angleAt(d: Door, hour: number): number {
  const n = d.t.length;
  if (n === 0) return 0;
  for (const shift of [0, 24, -24]) {
    const h = hour + shift;
    if (h < (d.t[0] as number) || h > (d.t[n - 1] as number)) continue;
    // The segment h is in: the last keyframe at or before it.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((d.t[mid] as number) <= h) lo = mid;
      else hi = mid;
    }
    const t0 = d.t[lo] as number;
    const t1 = d.t[hi] as number;
    const a0 = d.a[lo] as number;
    const a1 = d.a[hi] as number;
    const u = t1 > t0 ? (h - t0) / (t1 - t0) : 1;
    const k = d.kind[lo] as number;
    return k === 1 ? a0 : a0 + (a1 - a0) * smoothstep(u);
  }
  return 0;
}

/** One walker's passage of a door: when the leaf is first asked to open, and when it is let go (hours). */
type Call = { readonly from: number; readonly to: number };

/**
 * The doors of a plan that its walkers go through, each with its day. `walkers` is the list `walkersFor` made; `anchor` moves the plan's frame into the world.
 */
export function doorsFor(plan: TownPlan, anchor: { readonly x: number; readonly z: number }, walkers: readonly Walker[]): DoorBook {
  const uses = new Map<number, BuildingUse>();
  for (const use of plan.uses) uses.set(use.building, use);
  const calls = new Map<number, Call[]>();
  const unitOf = (building: number, unit: number): { use: BuildingUse; u: Unit } | null => {
    const use = uses.get(building);
    const u = use?.units.find((x) => x.id === unit);
    return use === undefined || u === undefined ? null : { use, u };
  };
  const note = (key: number, c: Call): void => {
    const list = calls.get(key);
    if (list === undefined) calls.set(key, [c]);
    else list.push(c);
  };
  for (const w of walkers) {
    const a = unitOf(w.from.building, w.from.unit);
    const b = unitOf(w.to.building, w.to.unit);
    if (a === null || b === null) continue;
    const speed = w.speed * HOUR_S;
    // Out: they cross the leaf's plane `depth - set` into their path. The leaf opens into the room, so the walker, who begins `MIN_IN` to `MAX_IN` back from it, is clear of the sweep when it begins to move: it begins as they do.
    const tOut = w.t0 + (doorDepth(a.u) - doorSet(a.u)) / speed;
    note(unitKey(w.from.building, w.from.unit), { from: w.t0, to: tOut + HOLD_PAST / speed });
    // In: they cross it `depth` short of the end of their path, and the leaf begins to open when they are `ARRIVE_LEAD` short of it.
    const tIn = w.t0 + (w.length - (doorDepth(b.u) - doorSet(b.u))) / speed;
    note(unitKey(w.to.building, w.to.unit), { from: tIn - ARRIVE_LEAD / speed, to: tIn + HOLD_PAST / speed });
  }
  const doors: Door[] = [];
  const byUnit = new Map<number, number>();
  for (const [key, list] of calls) {
    const building = Math.floor(key / 4096);
    const unit = key - building * 4096;
    const found = unitOf(building, unit);
    if (found === null || found.use.frame === null) continue;
    const fr = found.use.frame;
    const u = found.u;
    const look = doorLook(building, unit);
    const x = fr.origin.x + fr.t.x * u.door.s;
    const z = fr.origin.z + fr.t.z * u.door.s;
    const t: number[] = [];
    const a: number[] = [];
    const kind: number[] = [];
    // The day's calls in time order (as if the day began at the first call: calls come as hours, some past 24 or before 0 where a trip crosses midnight).
    const sorted = [...list].map((c) => ({ from: c.from, to: c.to })).sort((p, q) => p.from - q.from);
    const merged: Call[] = [];
    for (const c of sorted) {
      const last = merged[merged.length - 1];
      if (last !== undefined && c.from <= last.to) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, c.to) };
      else merged.push({ from: c.from, to: c.to });
    }
    const openH = look.openS / HOUR_S;
    const closeH = look.closeS / HOUR_S;
    // Following the leaf, call by call: where it is when a call begins (still closing from the last, or shut), then it opens, is held, and closes.
    let closing: { t0: number; a0: number } | null = null;
    const push = (tt: number, aa: number, kk: number): void => {
      t.push(tt);
      a.push(aa);
      kind.push(kk);
    };
    for (const c of merged) {
      const start = c.from;
      let a0 = 0;
      if (closing === null) push(start, 0, 0);
      else {
        const dur = closeH * (closing.a0 / look.maxAngle);
        push(closing.t0, closing.a0, 2);
        if (start < closing.t0 + dur) {
          // Still closing: it opens again from the angle it has.
          a0 = closing.a0 * (1 - smoothstep((start - closing.t0) / dur));
          push(start, a0, 0);
        } else {
          push(closing.t0 + dur, 0, 1);
          push(start, 0, 0);
        }
      }
      push(start + openH * (1 - a0 / look.maxAngle), look.maxAngle, 1);
      push(c.to, look.maxAngle, 2);
      closing = { t0: c.to, a0: look.maxAngle };
    }
    if (closing !== null) push(closing.t0 + closeH * (closing.a0 / look.maxAngle), 0, 1);
    byUnit.set(key, doors.length);
    doors.push({
      building, unit, x, z, nx: fr.n.x, nz: fr.n.z, tx: fr.t.x, tz: fr.t.z, width: u.door.width, depth: doorDepth(u), set: doorSet(u), look,
      t: Float64Array.from(t), a: Float64Array.from(a), kind: Uint8Array.from(kind),
    });
  }
  return { doors, byUnit, anchor };
}

/** A door that is not shut at an hour, as the vertex stage wants it (`townMaterial.ts`, `DoorMove`): hinge place in the world, the leaf's shut direction and the way into the room. */
/** (`width` is the leaf's.) */
export type MovingDoor = { readonly door: Door; readonly hx: number; readonly hz: number; readonly ux: number; readonly uz: number; readonly nx: number; readonly nz: number; readonly width: number; readonly angle: number };

/** The hinge's place and the two directions of a door (the plan's frame moved into the world by `anchor`). */
export function hingeOf(d: Door, anchor: { readonly x: number; readonly z: number }): { hx: number; hz: number; ux: number; uz: number; nx: number; nz: number; width: number } {
  // The leaf that opens (`leafOf`): the whole opening, or the right-hand half of a pair.
  const leaf = leafOf({ s: 0, width: d.width }, d.look);
  const s = leaf.hingeLow ? leaf.s0 : leaf.s1;
  const k = leaf.hingeLow ? 1 : -1;
  return {
    width: leaf.width,
    hx: anchor.x + d.x + d.tx * s - d.nx * d.set,
    hz: anchor.z + d.z + d.tz * s - d.nz * d.set,
    ux: d.tx * k,
    uz: d.tz * k,
    // Into the room: against the way out.
    nx: -d.nx,
    nz: -d.nz,
  };
}

/** The doors that are not shut at `hour`, the most open first. */
export function movingDoors(book: DoorBook, hour: number): MovingDoor[] {
  const out: MovingDoor[] = [];
  for (const door of book.doors) {
    const angle = angleAt(door, wrapHour(hour));
    if (angle < 0.002) continue;
    out.push({ door, ...hingeOf(door, book.anchor), angle });
  }
  return out.sort((p, q) => q.angle - p.angle);
}

/** Whether a walker is not drawn at `hour`, `along` metres into their path: they are inside the room (within their door's depth of either end) and the door is shut. */
export function hiddenByDoor(book: DoorBook, w: Walker, along: number, hour: number): boolean {
  const near = (building: number, unit: number, inside: boolean): boolean => {
    const i = book.byUnit.get(unitKey(building, unit));
    if (i === undefined) return false;
    const d = book.doors[i] as Door;
    return inside && angleAt(d, wrapHour(hour)) < SHUT_BELOW;
  };
  const from = book.byUnit.get(unitKey(w.from.building, w.from.unit));
  const to = book.byUnit.get(unitKey(w.to.building, w.to.unit));
  if (from !== undefined && along < (book.doors[from] as Door).depth - (book.doors[from] as Door).set) return near(w.from.building, w.from.unit, true);
  if (to !== undefined && along > w.length - ((book.doors[to] as Door).depth - (book.doors[to] as Door).set)) return near(w.to.building, w.to.unit, true);
  return false;
}
