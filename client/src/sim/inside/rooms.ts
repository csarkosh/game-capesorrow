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
import { designFromInterior } from "./convert.js";
import { FRONT_WALL, type Design } from "./design.js";
import { acts, constrainDesign, fitsDesign, groundAt, CLEAR } from "./designWalk.js";
import { barDesign } from "./designs/bar.js";
import { cafeDesign } from "./designs/cafe.js";
import { lodgingDesign } from "./designs/lodging.js";
import { municipalDesign } from "./designs/municipal.js";

export { FRONT_WALL };

const { abs, floor } = Math;

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
/** How far inside a hull's radius a place may be and still fit (`fitsInRoom`). */
const FIT = 0.001;

/** A block a hull standing on the room's floor is pushed out of, as a rectangle in the building's frame (`InsideRoom.solids`): centre (`s`, `d`), its long axis (`ax`, `ad`), half its length along it and half across. */
export type RoomSolid = { readonly s: number; readonly d: number; readonly ax: number; readonly ad: number; readonly ha: number; readonly hb: number };

export type InsideRoom = {
  /** 1 the bar, 2 the cafe, 3 the lodging, 4 the municipal building (the player's office): what `Inside.place` holds. */
  readonly id: number;
  readonly name: "bar" | "cafe" | "lodging" | "office";
  readonly building: number;
  /** The unit of the building the room is, or -1 for the municipal building's, which has no unit (`municipal.ts` makes its inside). */
  readonly unit: number;
  /** The unit's front wall in the world: the ground at the building's left end as the street sees it, the way out of the front (`n`) and along the wall to the right (`t`). A place (s, d) of the room is `o + t * s - n * d`. */
  readonly ox: number;
  readonly oz: number;
  readonly nx: number;
  readonly nz: number;
  readonly tx: number;
  readonly tz: number;
  /** The room: from `s0` to `s1` along the wall (in the building's frame, which the design's own `s` is measured from `s0` of), `depth` deep, `ceiling` high: the design's own measures. */
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
  /** The blocks of the design that act on a hull standing on its floor, in the building's frame: what the street door's tests and a quick look need. */
  readonly solids: readonly RoomSolid[];
  /** What the room is: its walls, floors, furniture, light and people, and what the hull is held by (`design.ts`). Every room has one; the converter makes it for a room with none of its own. */
  readonly design: Design;
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
    const measures = { s0: unit.s0, s1: unit.s1, doorS, doorWidth: unit.door.width };
    const design = name === "bar"
      ? barDesign({ id: place.building * 31 + unit.id, width: unit.s1 - unit.s0, maxDepth: (use?.frame?.depth ?? 0) - 1, height: unit.interior.ceiling, doorS: doorS - unit.s0, doorWidth: unit.door.width, name: unit.tenant?.name ?? "TAVERN" })
      : name === "cafe"
        ? cafeDesign({ id: place.building * 31 + unit.id, width: unit.s1 - unit.s0, maxDepth: (use?.frame?.depth ?? 0) - 1, height: unit.interior.ceiling, doorS: doorS - unit.s0, doorWidth: unit.door.width })
        : name === "lodging"
          ? lodgingDesign({ id: place.building * 31 + unit.id, width: unit.s1 - unit.s0, maxDepth: (use?.frame?.depth ?? 0) - 1, height: unit.interior.ceiling, storeys: plan.buildings[place.building]?.storeys ?? 1, doorS: doorS - unit.s0, doorWidth: unit.door.width, name: unit.tenant?.name ?? "HOTEL" })
          : designFromInterior(name, unit.interior, measures);
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
      depth: design.depth,
      ceiling: design.height,
      doorS,
      doorWidth: unit.door.width,
      streetY,
      floorY: streetY + LIFT,
      solids: solidsOf(design, unit.s0),
      design,
    });
  }
  const hall = plan.places.office;
  const fr = plan.uses[hall.building]?.frame;
  if (fr !== undefined && fr !== null && hall.door !== null) {
    const design = municipalDesign(seed);
    const ox = anchor.x + fr.origin.x;
    const oz = anchor.z + fr.origin.z;
    const doorS = design.doorS;
    const streetY = ground.heightAt(ox + fr.t.x * doorS + fr.n.x * ARRIVE_OUT, oz + fr.t.z * doorS + fr.n.z * ARRIVE_OUT);
    rooms.push({
      id: rooms.length + 1, name: "office", building: hall.building, unit: -1, ox, oz, nx: fr.n.x, nz: fr.n.z, tx: fr.t.x, tz: fr.t.z,
      s0: 0, s1: design.width, depth: design.depth, ceiling: design.height, doorS, doorWidth: design.doorWidth, streetY, floorY: streetY + LIFT, solids: solidsOf(design, 0), design,
    });
  }
  return rooms;
}

/** The blocks of a design that act on a hull standing on its floor, in the building's frame (`s0` is where the room starts in it). */
function solidsOf(design: Design, s0: number): RoomSolid[] {
  const out: RoomSolid[] = [];
  for (const b of design.blocks) if (acts(b, 0)) out.push({ s: b.s + s0, d: b.d, ax: b.ax, ad: b.ad, ha: b.ha, hb: b.hb });
  return out;
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

/** Where a hull's centre arrives in a room: inside its door, on the ground the design has there. */
export function arriveIn(room: InsideRoom): { x: number; y: number; z: number } {
  const at = room.design.arrive;
  const p = fromRoom(room, room.s0 + at.s, at.d);
  const g = groundAt(room.design, at.s, at.d, 0) ?? 0;
  return { x: p.x, y: room.floorY + g + PLAYER_HALF.y, z: p.z };
}

/** Where a hull's centre arrives in the street: out from the room's door, on the walked ground (the caller moves it clear of what stands there). */
export function arriveOut(room: InsideRoom): { x: number; y: number; z: number } {
  const p = fromRoom(room, room.doorS, -ARRIVE_OUT);
  return { x: p.x, y: room.streetY + PLAYER_HALF.y, z: p.z };
}

/**
 * Keeps a hull in a room: inside its four walls and out of what the design holds that acts on a hull whose feet are `feet` metres over the room's floor (the floor itself
 * for none given), sliding along both (the velocity loses its part into what it met). The hull is a circle of `HULL_RADIUS`, as it is to the town's walls; heights are
 * read only for which blocks act (`designWalk.ts`).
 */
export function constrainInRoom(room: InsideRoom, pos: { x: number; z: number }, vel: { x: number; z: number }, feet = 0): void {
  const at = inRoom(room, pos.x, pos.z);
  const local = { s: at.s - room.s0, d: at.d };
  // The velocity in the room's frame: along the wall, and into the room.
  const v = { s: vel.x * room.tx + vel.z * room.tz, d: -(vel.x * room.nx + vel.z * room.nz) };
  constrainDesign(room.design, local, v, feet, HULL_RADIUS + CLEAR);
  const p = fromRoom(room, room.s0 + local.s, local.d);
  pos.x = p.x;
  pos.z = p.z;
  vel.x = room.tx * v.s - room.nx * v.d;
  vel.z = room.tz * v.s - room.nz * v.d;
}

/**
 * Whether a hull's centre stands in a room as `constrainInRoom` means it to: inside the walls, clear of every block that acts at `feet`, with ground under it, to within a
 * millimetre of the hull's radius. A place between two pieces of furniture that stand closer than a hull is wide has no such answer, and `constrainInRoom` leaves a
 * few millimetres of overlap there; `insideMove` (`rules.ts`) then keeps the player where they were.
 */
export function fitsInRoom(room: InsideRoom, pos: { x: number; z: number }, feet = 0): boolean {
  const at = inRoom(room, pos.x, pos.z);
  return fitsDesign(room.design, at.s - room.s0, at.d, feet, HULL_RADIUS, FIT);
}

/** The place a hull stands free nearest to (s, d) on a floor at `y`, within two metres (the place itself when it is free), or the place itself if there is none. */
function clearNear(d: Design, s: number, dd: number, y: number): Spot3 {
  const r = HULL_RADIUS + CLEAR;
  for (let ring = 0; ring <= 20; ring++) {
    for (let k = 0; k < (ring === 0 ? 1 : 8 * ring); k++) {
      // Round a square ring of cells about the place.
      const side = ring === 0 ? 0 : floor(k / (2 * ring));
      const along = ring === 0 ? 0 : (k % (2 * ring)) - ring;
      const ds = side === 0 ? along : side === 1 ? ring : side === 2 ? -along : -ring;
      const dz = side === 0 ? -ring : side === 1 ? along : side === 2 ? ring : -along;
      const ps = s + ds * 0.1;
      const pd = dd + dz * 0.1;
      const g = groundAt(d, ps, pd, y);
      if (g !== null && abs(g - y) < 0.3 && fitsDesign(d, ps, pd, g, r, 0.001)) return { s: ps, d: pd, y: g };
    }
  }
  return { s, d: dd, y };
}

/** A named place of a room: `s` and `d` in the design's frame and the height of the floor there. */
export type Spot3 = { readonly s: number; readonly d: number; readonly y: number };

/**
 * The place a room's design names (`Design.marks`: `room`, `corridor`, `stair`, `lounge`, `flight`, ...), or, for `back`, the back of the room: the nearest place to its back wall's middle where a hull stands
 * clear; or undefined. `door` is where a player arrives.
 */
export function spotOf(room: InsideRoom, name: string): Spot3 | undefined {
  const d = room.design;
  const mark = d.marks?.find((m) => m.name === name);
  if (mark !== undefined) return clearNear(d, mark.s, mark.d, mark.y);
  if (name === "door") return { s: d.arrive.s, d: d.arrive.d, y: groundAt(d, d.arrive.s, d.arrive.d, 0) ?? 0 };
  if (name === "back") {
    for (let back = 1.0; back < d.depth * 0.5; back += 0.25) {
      for (let k = 0; k <= d.width; k += 0.25) {
        const s = d.width / 2 + (k % 0.5 === 0 ? k : -k) / 2;
        if (s < 0.5 || s > d.width - 0.5) continue;
        const y = groundAt(d, s, d.depth - back, 0);
        if (y !== null && fitsDesign(d, s, d.depth - back, y, HULL_RADIUS + CLEAR, 0.001)) return { s, d: d.depth - back, y };
      }
    }
  }
  return undefined;
}

/** Where a hull's centre stands at a named place of a room (the hull's centre is half its height over the floor there). */
export function arriveAt(room: InsideRoom, spot: Spot3): { x: number; y: number; z: number } {
  const p = fromRoom(room, room.s0 + spot.s, spot.d);
  return { x: p.x, y: room.floorY + spot.y + PLAYER_HALF.y, z: p.z };
}
