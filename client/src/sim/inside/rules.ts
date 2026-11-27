/**
 * Walking into a building in the game's rules: how a player goes through a door and moves in a room (`rooms.ts` says what a room is). A click at a
 * street door holds the player still while the screen goes dark, then the host puts the player in the room, which is built `LIFT` metres over the
 * street; a click at the room's door holds them again and puts them back in the street. It is the car's pattern (`sim/car/rules.ts`): a press on the
 * host, a held phase that counts ticks, and then the move.
 *
 * `insideMove` is the engine's `Rules.move`: it runs on every machine, the host, a client's prediction and its replay of unacknowledged
 * commands. `insidePressed` and `insideStep` run on the host alone.
 *
 * Simulation code: `+ - * /`, `abs`, `min`, `max`, `sqrt` only, and no collection is walked (the host's loop over its players is in `sim.ts`).
 */
import { PLAYER_HALF, TICK_DT } from "@csarkosh/engine/sim/constants";
import { MoveButton, type InputCommand } from "@csarkosh/engine/sim/core";
import type { Forest } from "@csarkosh/engine/sim/forest";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { stepMovement } from "@csarkosh/engine/sim/movement";
import type { SimState, SimWorld } from "@csarkosh/engine/sim/tick";
import { constrainByCars, type CarState, type Rider } from "../car/rules.js";
import { INTERACT_BIT } from "../car/tuning.js";
import { FOOT } from "../car/types.js";
import { townConstrain } from "../town/solid.js";
import { groundAt } from "./designWalk.js";
import {
  arriveAt, arriveIn, arriveOut, constrainInRoom, DOOR_TICKS, fitsInRoom, GOING_IN, GOING_OUT, inRoom, INSIDE, newInside, OUTSIDE, roomDoorAt, roomOf, spotOf, streetDoorAt, type Inside,
  type InsideRoom, type Spot3,
} from "./rooms.js";

/** A player who may be in a room as well as in a car. */
export type Insider = Rider & { inside: Inside };
/** A world of such players, with the forest the rooms are made from and the cars that stand in the street. */
export type InsideWorld = SimWorld<Insider> & { forest: Forest; state: SimState<Insider> & CarState };

/** A walk in a room has no one's boxes to meet: the walls and the furnishings are `constrainInRoom`'s. */
const NO_BOXES: readonly never[] = [];
/** The room a step is for and the height of the hull's feet over its floor when the step began, read by the ground below. A step is made whole before another begins. */
let stepRoom: InsideRoom | null = null;
let stepFeet = 0;
const FLOOR: GroundField = {
  heightAt: (x, z) => {
    const room = stepRoom as InsideRoom;
    const at = inRoom(room, x, z);
    // A place with no ground has the height the feet were at; `walkInRoom` refuses the move that ends there.
    return room.floorY + (groundAt(room.design, at.s - room.s0, at.d, stepFeet) ?? stepFeet);
  },
  // A flight of stairs is a ramp to the walker, and the engine must not slide a walker down it: the ground is always straight up.
  normalAt: (_x, _z, out) => {
    out.x = 0;
    out.y = 1;
    out.z = 0;
  },
};
const SPOT = { x: 0, y: 0, z: 0 };
const NO_VEL = { x: 0, y: 0, z: 0 };
/** How far over the ground a hull's feet may be and still stand on it. */
const STAND = 0.02;

/** Whether a player is held still at a door: going in or going out. */
export function insideHeld(p: { inside: Inside }): boolean {
  return p.inside.phase === GOING_IN || p.inside.phase === GOING_OUT;
}

/**
 * A step of the engine's walking in a room, for a body at rest on the room's design or moving on it (`p.pos` is the hull's centre, `p.vel`, `p.grounded`): the engine's own
 * step on the ground the design has under the hull (no boxes, no water, no jump: the eye would go through a low ceiling), then the hull is kept in the walls and out of the
 * blocks that act at its height (`constrainInRoom`). A move that would end where there is no ground, or inside a block, is refused: the hull stays where it was, at rest.
 * A hull that steps off an edge has only the surface below it under it, and falls to it.
 */
export function walkInRoom(room: InsideRoom, p: { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; grounded: boolean }, cmd: InputCommand): void {
  stepRoom = room;
  stepFeet = p.pos.y - PLAYER_HALF.y - room.floorY;
  const feet0 = stepFeet;
  const walk: InputCommand = { ...cmd, buttons: (cmd.buttons & MoveButton.Jump) !== 0 ? cmd.buttons - MoveButton.Jump : cmd.buttons };
  const after = stepMovement({ pos: p.pos, vel: p.vel, grounded: p.grounded }, walk, TICK_DT, NO_BOXES, PLAYER_HALF, null, FLOOR);
  stepRoom = null;
  constrainInRoom(room, after.pos, after.vel, feet0);
  const at = inRoom(room, after.pos.x, after.pos.z);
  const ground = groundAt(room.design, at.s - room.s0, at.d, feet0);
  if (ground !== null && (fitsInRoom(room, after.pos, feet0) || !fitsInRoom(room, p.pos, feet0))) {
    const feet = after.pos.y - PLAYER_HALF.y - room.floorY;
    if (feet - ground <= STAND) {
      // On the ground: the hull stands on it exactly.
      after.pos.y = room.floorY + ground + PLAYER_HALF.y;
      if (after.vel.y < 0) after.vel.y = 0;
      p.grounded = true;
    } else p.grounded = false;
    p.pos = after.pos;
    p.vel = after.vel;
    return;
  }
  // A pinch between two pieces of furniture that stand closer than a hull is wide, or a step onto nothing: the player stays where they were, and at rest.
  p.vel = { x: 0, y: 0, z: 0 };
}

/**
 * The engine's move, for a player in a room: `walkInRoom` on the room the player is in. Answers false for a player not in a room, so the engine walks them.
 */
export function insideMove(world: InsideWorld, p: Insider, cmd: InputCommand): boolean {
  if (p.inside.phase !== INSIDE) return false;
  const room = roomOf(world.forest.seed, p.inside.place);
  if (room === undefined) {
    p.inside = newInside();
    return false;
  }
  walkInRoom(room, p, cmd);
  return true;
}

/**
 * A press, on the host: the interact bit from a player on foot at a street door starts going in, and from a player in a room at its door starts going out.
 * Answers whether it acted.
 */
export function insidePressed(world: InsideWorld, p: Insider, bits: number): boolean {
  if ((bits & INTERACT_BIT) === 0 || p.ride.phase !== FOOT) return false;
  if (p.inside.phase === OUTSIDE) {
    const room = streetDoorAt(world.forest.seed, p.pos);
    if (room === undefined) return false;
    p.inside = { place: room.id, phase: GOING_IN, ticks: DOOR_TICKS };
    return true;
  }
  if (p.inside.phase === INSIDE) {
    const room = roomOf(world.forest.seed, p.inside.place);
    if (room === undefined || !roomDoorAt(room, p.pos)) return false;
    p.inside = { place: room.id, phase: GOING_OUT, ticks: DOOR_TICKS };
    return true;
  }
  return false;
}

/** Puts a player in a room, at rest on its floor inside the door, grounded. */
function standIn(room: InsideRoom, p: Insider, spot?: Spot3): void {
  const at = spot === undefined ? arriveIn(room) : arriveAt(room, spot);
  p.pos = { x: at.x, y: at.y, z: at.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.grounded = true;
  p.inside = { place: room.id, phase: INSIDE, ticks: 0 };
}

/** Puts a player in the street at a room's door, moved clear of what stands there, on the walked ground, at rest and grounded. */
function standOut(world: InsideWorld, room: InsideRoom, p: Insider): void {
  const at = arriveOut(room);
  SPOT.x = at.x;
  SPOT.y = at.y;
  SPOT.z = at.z;
  NO_VEL.x = 0;
  NO_VEL.y = 0;
  NO_VEL.z = 0;
  constrainByCars(world, SPOT, NO_VEL);
  townConstrain(world, SPOT, NO_VEL);
  const ground = world.ground;
  const y = (ground === null ? room.streetY : ground.heightAt(SPOT.x, SPOT.z)) + PLAYER_HALF.y;
  p.pos = { x: SPOT.x, y, z: SPOT.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.grounded = true;
  p.inside = newInside();
}

/**
 * The host's step for one player, every tick: a hold counts down, and at its end the player is moved through the door. A hold on a room that does not
 * exist (it cannot, on a host that made the press) ends with the player in the street.
 */
export function insideStep(world: InsideWorld, p: Insider): void {
  if (!insideHeld(p)) return;
  p.inside.ticks--;
  if (p.inside.ticks > 0) return;
  const room = roomOf(world.forest.seed, p.inside.place);
  if (room === undefined) {
    p.inside = newInside();
    return;
  }
  if (p.inside.phase === GOING_IN) standIn(room, p);
  else standOut(world, room, p);
}

/**
 * Puts a player straight into room `id`, or out into the street for 0 (and for an id that is no room), with no hold: for the console's `goin` and for
 * tests. A player in a car is not moved. Answers whether the player is where was asked.
 */
export function insidePut(world: InsideWorld, p: Insider, id: number, spot?: string): boolean {
  if (p.ride.phase !== FOOT) return false;
  if (id === 0) {
    const room = p.inside.phase === OUTSIDE ? undefined : roomOf(world.forest.seed, p.inside.place);
    if (room !== undefined) standOut(world, room, p);
    else p.inside = newInside();
    return true;
  }
  const room = roomOf(world.forest.seed, id);
  if (room === undefined) return false;
  if (spot === undefined) {
    standIn(room, p);
    return true;
  }
  // A named place of the room, or nowhere: a player is not put where the room has no such place.
  const at = spotOf(room, spot);
  if (at === undefined) return false;
  standIn(room, p, at);
  return true;
}
