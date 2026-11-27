/**
 * The rooms a player can walk into: the bar, the cafe and the lodging of the town's plan (`plan.places`), each the room of its unit as the
 * plan furnished it (`Unit.interior`). A room a player stands in is not the one behind the shop's glass: it is the same room built again
 * `LIFT` metres over the street at the same place on the map, where nothing of the town reaches and no one outside is shown it. A player goes
 * between the two at the door, behind a screen gone dark (`rules.ts`), so the building stays the solid it is to everyone in the street.
 *
 * Everything here is a function of the world's seed, the same on every peer: the room's frame is its unit's front wall in the world, its
 * floor a height taken from the walked ground at its street door, and its solids the plan's furnishings as rectangles.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { walkGround } from "../car/start.js";
import { HULL_RADIUS } from "../town/hull.js";
import { planFor } from "../town/planFor.js";
import { siteFor } from "../town/siteFor.js";
import type { Place } from "../town/types.js";

const { abs, max, min, sqrt } = Math;

/** Where a player is by a room: in the street, held at the street door while the screen goes dark, in the room, held at the room's door. */
export const OUTSIDE = 0, GOING_IN = 1, INSIDE = 2, GOING_OUT = 3;
/** A player's place by the rooms: the room's id (0 in the street), the phase, and the ticks left of a hold. */
export type Inside = { place: number; phase: 0 | 1 | 2 | 3; ticks: number };
export const newInside = (): Inside => ({ place: 0, phase: OUTSIDE, ticks: 0 });

/** How far over its street door's ground a room's floor is: clear of every roof and tree of the town, and within the reach of the engine's rain cover (100 m), which a roof there stops. */
export const LIFT = 60;
/** The ticks a player is held at a door while the screen goes dark, each way (at 60 a second). */
export const DOOR_TICKS = 27;
/** How near a door a player presses to go through: metres along the wall past the door's edge, and metres off the wall. */
export const DOOR_SIDE = 0.6, DOOR_OUT = 1.8, DOOR_IN = 2.0;
/** How far the feet may be over or under the street door's ground. */
export const DOOR_HEIGHT = 1.2;
/** Where a player arrives: this far inside the room's door, and this far out from the wall in the street. */
export const ARRIVE_IN = 1.1, ARRIVE_OUT = 0.9;
/** The first of the room's depth is the front wall's thickness (the room's shell starts there, `game/town/roomShell.ts`). */
export const FRONT_WALL = 0.15;
/** A hull stops this far short of a wall or a piece of furniture. */
const CLEAR = 0.01;
/** Furnishings lower than this are stepped over (a dust sheet on the floor). */
const LOW = 0.25;
const PASSES = 8;
/** How far inside a hull's radius a place may be and still fit (`fitsInRoom`). */
const FIT = 0.001;

/** A furnishing as a rectangle in the room's frame: centre (`s`, `d`), its long axis (`ax`, `ad`), half its length along it and half across. */
export type RoomSolid = { readonly s: number; readonly d: number; readonly ax: number; readonly ad: number; readonly ha: number; readonly hb: number };

export type InsideRoom = {
  /** 1 the bar, 2 the cafe, 3 the lodging: what `Inside.place` holds. */
  readonly id: number;
  readonly name: "bar" | "cafe" | "lodging";
  readonly building: number;
  readonly unit: number;
  /** The unit's front wall in the world: the ground at the building's left end as the street sees it, the way out of the front (`n`) and along the wall to the right (`t`). A place (s, d) of the room is `o + t * s - n * d`. */
  readonly ox: number;
  readonly oz: number;
  readonly nx: number;
  readonly nz: number;
  readonly tx: number;
  readonly tz: number;
  /** The room: from `s0` to `s1` along the wall, `depth` deep, `ceiling` high. */
  readonly s0: number;
  readonly s1: number;
  readonly depth: number;
  readonly ceiling: number;
  /** The door's centre along the wall, and its width. */
  readonly doorS: number;
  readonly doorWidth: number;
  /** The walked ground at the street door, and the room's floor, `LIFT` over it. */
  readonly streetY: number;
  readonly floorY: number;
  readonly solids: readonly RoomSolid[];
};

const ROOMS = new Map<number, readonly InsideRoom[]>();

/** The rooms of a world, in the order of their ids. */
export function insideRooms(seed: number): readonly InsideRoom[] {
  let rooms = ROOMS.get(seed);
  if (rooms === undefined) {
    rooms = make(seed);
    ROOMS.set(seed, rooms);
  }
  return rooms;
}

/** The room of an id, or undefined. */
export function roomOf(seed: number, id: number): InsideRoom | undefined {
  const rooms = insideRooms(seed);
  for (let i = 0; i < rooms.length; i++) if ((rooms[i] as InsideRoom).id === id) return rooms[i];
  return undefined;
}

function make(seed: number): readonly InsideRoom[] {
  const plan = planFor(seed);
  const { anchor } = siteFor(seed);
  const ground = walkGround(seed);
  const places: readonly (readonly [InsideRoom["name"], Place])[] = [["bar", plan.places.bar], ["cafe", plan.places.cafe], ["lodging", plan.places.lodging]];
  const rooms: InsideRoom[] = [];
  for (let i = 0; i < places.length; i++) {
    const [name, place] = places[i] as (typeof places)[number];
    const use = plan.uses[place.building];
    const fr = use?.frame;
    const unit = use?.units.find((u) => u.id === place.unit);
    if (fr === undefined || fr === null || unit === undefined) continue;
    const ox = anchor.x + fr.origin.x;
    const oz = anchor.z + fr.origin.z;
    const doorS = unit.door.s;
    const streetY = ground.heightAt(ox + fr.t.x * doorS + fr.n.x * ARRIVE_OUT, oz + fr.t.z * doorS + fr.n.z * ARRIVE_OUT);
    const solids: RoomSolid[] = [];
    for (const f of unit.interior.furnishings) {
      if (f.h < LOW) continue;
      solids.push({ s: f.s, d: f.d, ax: f.dir.x, ad: f.dir.z, ha: f.sx / 2, hb: f.sd / 2 });
    }
    rooms.push({
      id: i + 1,
      name,
      building: place.building,
      unit: unit.id,
      ox,
      oz,
      nx: fr.n.x,
      nz: fr.n.z,
      tx: fr.t.x,
      tz: fr.t.z,
      s0: unit.s0,
      s1: unit.s1,
      depth: unit.interior.depth,
      ceiling: unit.interior.ceiling,
      doorS,
      doorWidth: unit.door.width,
      streetY,
      floorY: streetY + LIFT,
      solids,
    });
  }
  return rooms;
}

/** A place of the world in a room's frame: metres along its wall, and into the room (negative in the street). */
export function inRoom(room: InsideRoom, x: number, z: number): { s: number; d: number } {
  const dx = x - room.ox;
  const dz = z - room.oz;
  return { s: dx * room.tx + dz * room.tz, d: -(dx * room.nx + dz * room.nz) };
}

/** A place of a room's frame in the world. */
export function fromRoom(room: InsideRoom, s: number, d: number): { x: number; z: number } {
  return { x: room.ox + room.tx * s - room.nx * d, z: room.oz + room.tz * s - room.nz * d };
}

/** The room whose street door a hull's centre is at, or undefined: in front of the door, within reach of the wall, with its feet near the ground there. */
export function streetDoorAt(seed: number, pos: { x: number; y: number; z: number }): InsideRoom | undefined {
  const rooms = insideRooms(seed);
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i] as InsideRoom;
    if (abs(pos.y - PLAYER_HALF.y - room.streetY) > DOOR_HEIGHT) continue;
    const at = inRoom(room, pos.x, pos.z);
    if (at.d > 0.3 || at.d < -DOOR_OUT) continue;
    if (abs(at.s - room.doorS) > room.doorWidth / 2 + DOOR_SIDE) continue;
    return room;
  }
  return undefined;
}

/** Whether a hull in a room is at its door. */
export function roomDoorAt(room: InsideRoom, pos: { x: number; z: number }): boolean {
  const at = inRoom(room, pos.x, pos.z);
  return at.d <= DOOR_IN && abs(at.s - room.doorS) <= room.doorWidth / 2 + DOOR_SIDE;
}

/** Where a hull's centre arrives in a room: inside its door, on its floor. */
export function arriveIn(room: InsideRoom): { x: number; y: number; z: number } {
  const p = fromRoom(room, min(room.s1 - HULL_RADIUS - CLEAR, max(room.s0 + HULL_RADIUS + CLEAR, room.doorS)), ARRIVE_IN);
  return { x: p.x, y: room.floorY + PLAYER_HALF.y, z: p.z };
}

/** Where a hull's centre arrives in the street: out from the room's door, on the walked ground (the caller moves it clear of what stands there). */
export function arriveOut(room: InsideRoom): { x: number; y: number; z: number } {
  const p = fromRoom(room, room.doorS, -ARRIVE_OUT);
  return { x: p.x, y: room.streetY + PLAYER_HALF.y, z: p.z };
}

/**
 * Keeps a hull in a room: inside its four walls and out of its furnishings, sliding along both (the velocity loses its part into what it met).
 * The hull is a circle of `HULL_RADIUS`, as it is to the town's walls; heights are not read (a jump is not made in a room, `rules.ts`).
 */
export function constrainInRoom(room: InsideRoom, pos: { x: number; z: number }, vel: { x: number; z: number }): void {
  const at = inRoom(room, pos.x, pos.z);
  // The velocity in the room's frame: along the wall, and into the room.
  let vs = vel.x * room.tx + vel.z * room.tz;
  let vd = -(vel.x * room.nx + vel.z * room.nz);
  const r = HULL_RADIUS + CLEAR;
  const sLo = room.s0 + r;
  const sHi = room.s1 - r;
  const dLo = FRONT_WALL + r;
  const dHi = room.depth - r;
  const walls = (): void => {
    if (at.s < sLo) { at.s = sLo; vs = max(0, vs); }
    if (at.s > sHi) { at.s = sHi; vs = min(0, vs); }
    if (at.d < dLo) { at.d = dLo; vd = max(0, vd); }
    if (at.d > dHi) { at.d = dHi; vd = min(0, vd); }
  };
  walls();
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < room.solids.length; i++) {
      const b = room.solids[i] as RoomSolid;
      const ds = at.s - b.s;
      const dd = at.d - b.d;
      // The hull's centre in the furnishing's own axes: along it, and across (the across axis is (-ad, ax)).
      const la = ds * b.ax + dd * b.ad;
      const lb = -ds * b.ad + dd * b.ax;
      const qa = max(-b.ha, min(b.ha, la));
      const qb = max(-b.hb, min(b.hb, lb));
      const ea = la - qa;
      const eb = lb - qb;
      const d2 = ea * ea + eb * eb;
      if (d2 >= r * r) continue;
      let na: number;
      let nb: number;
      let push: number;
      if (d2 > 0) {
        const dist = sqrt(d2);
        na = ea / dist;
        nb = eb / dist;
        push = r - dist;
      } else {
        // The centre is inside the rectangle: out by its nearest side.
        const toA = b.ha - abs(la);
        const toB = b.hb - abs(lb);
        if (toA < toB) { na = la < 0 ? -1 : 1; nb = 0; push = toA + r; } else { na = 0; nb = lb < 0 ? -1 : 1; push = toB + r; }
      }
      // The way out in the room's frame.
      const ns = na * b.ax - nb * b.ad;
      const nd = na * b.ad + nb * b.ax;
      at.s += ns * push;
      at.d += nd * push;
      const into = vs * ns + vd * nd;
      if (into < 0) { vs -= ns * into; vd -= nd * into; }
      moved = true;
    }
    walls();
    if (!moved) break;
  }
  const p = fromRoom(room, at.s, at.d);
  pos.x = p.x;
  pos.z = p.z;
  vel.x = room.tx * vs - room.nx * vd;
  vel.z = room.tz * vs - room.nz * vd;
}

/**
 * Whether a hull's centre stands in a room as `constrainInRoom` means it to: inside the walls and clear of every furnishing, to within a millimetre of the
 * hull's radius. A place between two pieces of furniture that stand closer than a hull is wide has no such answer, and `constrainInRoom` leaves a
 * few millimetres of overlap there; `insideMove` (`rules.ts`) then keeps the player where they were.
 */
export function fitsInRoom(room: InsideRoom, pos: { x: number; z: number }): boolean {
  const at = inRoom(room, pos.x, pos.z);
  const r = HULL_RADIUS - FIT;
  if (at.s < room.s0 + r || at.s > room.s1 - r || at.d < FRONT_WALL + r || at.d > room.depth - r) return false;
  for (let i = 0; i < room.solids.length; i++) {
    const b = room.solids[i] as RoomSolid;
    const ds = at.s - b.s;
    const dd = at.d - b.d;
    const la = ds * b.ax + dd * b.ad;
    const lb = -ds * b.ad + dd * b.ax;
    const ea = la - max(-b.ha, min(b.ha, la));
    const eb = lb - max(-b.hb, min(b.hb, lb));
    if (ea * ea + eb * eb < r * r) return false;
  }
  return true;
}
