import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { MoveButton, type InputCommand } from "@csarkosh/engine/sim/core";
import { addPlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { WALK } from "../../src/net.js";
import { WALK_RULES, type Walker, type WalkWorld } from "../../src/sim.js";
import { newCar } from "../../src/sim/car/start.js";
import { INTERACT_BIT } from "../../src/sim/car/tuning.js";
import { FOOT, type Car } from "../../src/sim/car/types.js";
import { arriveIn, arriveOut, DOOR_IN, DOOR_TICKS, fromRoom, GOING_IN, GOING_OUT, inRoom, INSIDE, OUTSIDE, roomDoorAt, roomOf, streetDoorAt, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { insideHeld, insidePressed, insidePut } from "../../src/sim/inside/rules.js";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";
import { townConstrain } from "../../src/sim/town/solid.js";
import { groundOf, worldFor } from "../townWorld/world.js";
import { GAME_SEEDS } from "./seeds.js";

const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

/** A world of a seed with no players and the one car at its start. */
function fresh(seed: number): WalkWorld {
  const world = worldFor(seed);
  world.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: seed | 0, cars: [newCar(seed, 1)] };
  return world;
}

/** A player on foot at a street door's arrival point, on the ground there. */
function atStreetDoor(world: WalkWorld, room: InsideRoom): Walker {
  const p = addPlayer(world, WALK_RULES);
  const at = arriveOut(room);
  p.pos = { x: at.x, y: groundOf(world).heightAt(at.x, at.z) + PLAYER_HALF.y, z: at.z };
  p.grounded = true;
  return p;
}

function tick(world: WalkWorld, p: Walker, n: number, make: (i: number) => Partial<InputCommand> | null = () => null): void {
  for (let i = 0; i < n; i++) {
    const more = make(i);
    tickPlayers(world, more === null ? new Map() : new Map([[p.id, cmd(p.lastProcessedInput + 1, more)]]), WALK_RULES);
  }
}

/** A deterministic walk: forward and back, strafing, turning, with sprints and the jump button now and then. */
function walk(i: number): Partial<InputCommand> {
  const phase = i % 300;
  return {
    moveZ: phase < 200 ? 1 : phase < 260 ? -1 : 0,
    moveX: i % 170 < 40 ? 1 : i % 170 > 120 ? -1 : 0,
    yaw: (i * 0.037) % 6.2831,
    buttons: (i % 400 < 150 ? MoveButton.Sprint : 0) | (i % 97 === 0 ? MoveButton.Jump : 0),
  };
}

/** How far a point is from a furnishing's rectangle (0 inside it). */
function awayFrom(room: InsideRoom, b: InsideRoom["solids"][number], s: number, d: number): number {
  const ds = s - b.s;
  const dd = d - b.d;
  const la = ds * b.ax + dd * b.ad;
  const lb = -ds * b.ad + dd * b.ax;
  const ea = la - Math.max(-b.ha, Math.min(b.ha, la));
  const eb = lb - Math.max(-b.hb, Math.min(b.hb, lb));
  return Math.hypot(ea, eb);
}

describe.each(GAME_SEEDS)("going through a door, seed %i", (seed) => {
  it("holds a player pressing at the street door for the door's ticks, then stands them inside at the room's door", () => {
    for (const room of roomsOf(seed)) {
      const world = fresh(seed);
      const p = atStreetDoor(world, room);
      const before = { ...p.pos };
      expect(streetDoorAt(seed, p.pos)?.id).toBe(room.id);
      expect(insidePressed(world, p, INTERACT_BIT)).toBe(true);
      expect(p.inside).toEqual({ place: room.id, phase: GOING_IN, ticks: DOOR_TICKS });
      expect(insideHeld(p)).toBe(true);
      // Held: the commands do not move them, but they turn the look.
      tick(world, p, DOOR_TICKS - 1, () => ({ moveZ: 1, yaw: 1 }));
      expect(p.inside.phase, room.name).toBe(GOING_IN);
      expect(p.pos).toEqual(before);
      expect(p.yaw).toBe(1);
      tick(world, p, 1);
      expect(p.inside, room.name).toEqual({ place: room.id, phase: INSIDE, ticks: 0 });
      const at = arriveIn(room);
      expect([p.pos.x, p.pos.y, p.pos.z]).toEqual([at.x, at.y, at.z]);
      expect([p.vel.x, p.vel.y, p.vel.z, p.grounded]).toEqual([0, 0, 0, true]);
      expect(insideHeld(p)).toBe(false);
    }
  }, timeLimit(120_000));

  it("does nothing for a press away from any door, without the interact bit, or on a seat of the car", () => {
    const world = fresh(seed);
    const room = roomsOf(seed)[0] as InsideRoom;
    const p = atStreetDoor(world, room);
    expect(insidePressed(world, p, 0)).toBe(false);
    expect(p.inside.phase).toBe(OUTSIDE);
    p.pos = { ...p.pos, x: p.pos.x + room.nx * 6, z: p.pos.z + room.nz * 6 };
    expect(insidePressed(world, p, INTERACT_BIT)).toBe(false);
    expect(p.inside).toEqual({ place: 0, phase: OUTSIDE, ticks: 0 });
  }, timeLimit(120_000));

  it("keeps a player inside the room's walls, out of its furnishings, on its floor, and moving, with the jump button pressed now and then", () => {
    for (const room of roomsOf(seed)) {
      const world = fresh(seed);
      const p = atStreetDoor(world, room);
      insidePut(world, p, room.id);
      const start = { ...p.pos };
      let farthest = 0;
      for (let i = 0; i < 600; i++) {
        tick(world, p, 1, walk.bind(null, i));
        const label = `${room.name} tick ${i}`;
        const at = inRoom(room, p.pos.x, p.pos.z);
        expect(at.s, label).toBeGreaterThanOrEqual(room.s0 + HULL_RADIUS - 1e-3);
        expect(at.s, label).toBeLessThanOrEqual(room.s1 - HULL_RADIUS + 1e-3);
        expect(at.d, label).toBeGreaterThanOrEqual(HULL_RADIUS - 1e-3);
        expect(at.d, label).toBeLessThanOrEqual(room.depth - HULL_RADIUS + 1e-3);
        // The nearest of the room's solids (one check a tick: a hall holds hundreds).
        let nearest = Infinity;
        for (const b of room.solids) nearest = Math.min(nearest, awayFrom(room, b, at.s, at.d));
        expect(nearest, label).toBeGreaterThanOrEqual(HULL_RADIUS - 1e-3);
        expect(p.pos.y, label).toBeCloseTo(room.floorY + PLAYER_HALF.y, 6);
        expect(p.inside.phase).toBe(INSIDE);
        farthest = Math.max(farthest, Math.hypot(p.pos.x - start.x, p.pos.z - start.z));
      }
      expect(farthest, `${room.name} is walked in`).toBeGreaterThan(1);
    }
  }, timeLimit(120_000));

  it("leaves y unchanged for a jump in a room", () => {
    const room = roomsOf(seed)[0] as InsideRoom;
    const world = fresh(seed);
    const p = atStreetDoor(world, room);
    insidePut(world, p, room.id);
    const y = p.pos.y;
    tick(world, p, 20, () => ({ buttons: MoveButton.Jump }));
    expect(p.pos.y).toBe(y);
    expect(p.grounded).toBe(true);
    expect(p.vel.y).toBe(0);
  }, timeLimit(120_000));

  it("holds a player pressing at the room's door, then puts them in the street on the ground, outside every building", () => {
    for (const room of roomsOf(seed)) {
      const world = fresh(seed);
      const p = atStreetDoor(world, room);
      insidePut(world, p, room.id);
      expect(roomDoorAt(room, p.pos)).toBe(true);
      expect(insidePressed(world, p, INTERACT_BIT)).toBe(true);
      expect(p.inside).toEqual({ place: room.id, phase: GOING_OUT, ticks: DOOR_TICKS });
      const held = { ...p.pos };
      tick(world, p, DOOR_TICKS - 1, () => ({ moveZ: 1 }));
      expect(p.pos).toEqual(held);
      tick(world, p, 1);
      expect(p.inside).toEqual({ place: 0, phase: OUTSIDE, ticks: 0 });
      expect(p.pos.y).toBeCloseTo(groundOf(world).heightAt(p.pos.x, p.pos.z) + PLAYER_HALF.y, 9);
      expect([p.vel.x, p.vel.y, p.vel.z, p.grounded]).toEqual([0, 0, 0, true]);
      expect(streetDoorAt(seed, p.pos)?.id, room.name).toBe(room.id);
      const moved = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      townConstrain(world, moved, { x: 0, y: 0, z: 0 });
      expect(moved, `${room.name}: the town does not move them`).toEqual(p.pos);
    }
  }, timeLimit(120_000));

  it("does nothing for a press in a room away from its door", () => {
    for (const room of roomsOf(seed)) {
      const world = fresh(seed);
      const p = atStreetDoor(world, room);
      insidePut(world, p, room.id);
      const deep = fromRoom(room, (room.s0 + room.s1) / 2, room.depth - 0.6);
      p.pos = { x: deep.x, y: p.pos.y, z: deep.z };
      if (inRoom(room, deep.x, deep.z).d <= DOOR_IN) continue;
      expect(roomDoorAt(room, p.pos)).toBe(false);
      expect(insidePressed(world, p, INTERACT_BIT)).toBe(false);
      expect(p.inside.phase).toBe(INSIDE);
    }
  }, timeLimit(120_000));

  it("cannot board the car from inside, however the car stands below", () => {
    const room = roomsOf(seed)[0] as InsideRoom;
    const world = fresh(seed);
    const p = atStreetDoor(world, room);
    insidePut(world, p, room.id);
    const car = world.state.cars[0] as Car;
    // The car's every door, set at the player's place in plan, then the press as the host takes it.
    for (let k = 0; k < 4; k++) {
      const deep = fromRoom(room, (room.s0 + room.s1) / 2, room.depth - 0.6);
      p.pos = { x: deep.x, y: p.pos.y, z: deep.z };
      car.x = p.pos.x + (k - 1.5) * 0.4;
      car.z = p.pos.z;
      WALK.pressed(world, p, INTERACT_BIT);
      expect(p.ride.phase).toBe(FOOT);
      expect(car.seats).toEqual([0, 0, 0, 0]);
    }
  }, timeLimit(120_000));

  it("is put in a room and out of it, with no hold, by insidePut", () => {
    const room = roomsOf(seed)[1] as InsideRoom;
    const world = fresh(seed);
    const p = atStreetDoor(world, room);
    expect(insidePut(world, p, 9)).toBe(false);
    expect(insidePut(world, p, room.id)).toBe(true);
    expect(p.inside).toEqual({ place: room.id, phase: INSIDE, ticks: 0 });
    expect(roomOf(seed, room.id)).toBe(room);
    expect(insidePut(world, p, 0)).toBe(true);
    expect(p.inside.phase).toBe(OUTSIDE);
    expect(streetDoorAt(seed, p.pos)?.id).toBe(room.id);
  }, timeLimit(120_000));
});

function roomsOf(seed: number): readonly InsideRoom[] {
  const rooms: InsideRoom[] = [];
  for (let id = 1; id <= 3; id++) rooms.push(roomOf(seed, id) as InsideRoom);
  return rooms;
}
