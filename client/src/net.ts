/**
 * The game as the network's sessions see it (`@csarkosh/engine/net/game`): a snapshot holds the players' places and
 * where each is in a car and by the rooms of the town's buildings, and the cars; a press on the host is the car's (`carPressed`: getting in
 * and out, the lamps) or a door's (`insidePressed`); the host's word corrects the local player's ride and room and every car in the predicted world, so that the replay of the
 * commands not yet acknowledged drives the car as the host does; and a frame is drawn from the state, the local
 * driver's car from the predicted world and the rest from the blended snapshots.
 */
import { blendPosition, lerpAngle } from "@csarkosh/engine/net/client";
import type { NetGame, SnapshotMover } from "@csarkosh/engine/net/game";
import {
  MessageType, dequantizePitch, dequantizePosition, dequantizeYaw, quantizePitch, quantizePosition, quantizeVelocity, quantizeYaw,
} from "@csarkosh/engine/net/wire";
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import { carPressed, newRide } from "./sim/car/rules.js";
import { insidePressed } from "./sim/inside/rules.js";
import { seatPlace } from "./sim/car/seats.js";
import { OWED_MAX } from "./sim/car/tuning.js";
import { ENTERING, FOOT, LEAVING, SEATED, type Car, type Ride } from "./sim/car/types.js";
import { GOING_IN, GOING_OUT, INSIDE, newInside, OUTSIDE, type Inside } from "./sim/inside/rooms.js";
import { WALK_RULES, type WalkState, type WalkWorld, type Walker } from "./sim.js";

/** What two ends must share to drive and walk together: the wire's layout and the rules the step runs by (the car's speed limit by place is one), so an end with other rules is refused at the welcome. */
export const WALK_PROTOCOL = 5;

export type WalkMover = SnapshotMover & { pitch: number; ride: Ride; inside: Inside };
export type WalkSnapshot = { tick: number; lastProcessedInput: number; players: WalkMover[]; cars: Car[] };

/** The type, the tick, the last input taken, and how many players follow. */
const HEAD_BYTES = 1 + 4 + 4 + 1;
/**
 * An id, a place, a velocity, a yaw, a pitch, whether the player stands, the ride (a car's id, a seat (signed), a phase and its ticks), and where the
 * player is by the rooms: the room's id (0 in the street), a phase and its ticks.
 */
export const MOVER_BYTES = 2 + 12 + 6 + 2 + 1 + 1 + 4 + 3;
/**
 * A car, at the offsets from its start: the id (0), the place (1 to 12), the heading (13 to 16), the speed and the slip
 * (17 to 20), the steer (21 to 22), the throttle (23) and the turn (24), a flags byte (25), four seats (26 to 33), and the
 * steps owed to the driver's late commands (34), 0 to `OWED_MAX`.
 */
export const CAR_BYTES = 1 + 12 + 4 + 4 + 2 + 2 + 1 + 8 + 1;

const HEADING_SCALE = 32767;
const SPEED_SCALE = 256;
const CONTROL_SCALE = 127;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function int16(v: number, scale: number): number {
  return Math.round(clamp(v * scale, -32768, 32767));
}

/**
 * A ride as read off the wire, or an error: a snapshot comes from another player's machine, so a phase must be one of the four,
 * a rider must name a car and a seat of the four, and no two riders may hold one seat. A player on foot has no ride but `newRide()`.
 */
function readRide(car: number, seat: number, phase: number, ticks: number, taken: Set<number>): Ride {
  if (phase !== FOOT && phase !== ENTERING && phase !== SEATED && phase !== LEAVING) throw new Error("a snapshot of the game with a ride of no phase");
  if (phase === FOOT) return newRide();
  if (car === 0 || seat < 0 || seat > 3) throw new Error("a snapshot of the game with a rider in no seat");
  const key = car * 4 + seat;
  if (taken.has(key)) throw new Error("a snapshot of the game with two riders in one seat");
  taken.add(key);
  return { car, seat, phase, ticks };
}

/**
 * A player's place by the rooms as read off the wire, or an error: a phase must be one of the four, and the room's id is 0 exactly when the player is
 * in the street. (Whether the id names a room is the rules' to find: `insideMove` puts a player of no room back in the street.)
 */
function readInside(place: number, phase: number, ticks: number): Inside {
  if (phase !== OUTSIDE && phase !== GOING_IN && phase !== INSIDE && phase !== GOING_OUT) throw new Error("a snapshot of the game with a player of no phase in a room");
  if ((place === 0) !== (phase === OUTSIDE)) throw new Error("a snapshot of the game with a player whose room does not fit where they are");
  return phase === OUTSIDE ? newInside() : { place, phase, ticks };
}

/** Where a player is for the purpose of who can see whom: the room's id while in a room (or leaving it, still there), else 0, the street. */
export function whereIs(inside: Inside): number {
  return inside.phase === INSIDE || inside.phase === GOING_OUT ? inside.place : 0;
}

function copyCar(car: Car): Car {
  return { ...car, controls: { ...car.controls }, seats: [...car.seats] };
}

export function encodeWalkSnapshot(snapshot: WalkSnapshot): ArrayBuffer {
  const buffer = new ArrayBuffer(HEAD_BYTES + snapshot.players.length * MOVER_BYTES + 1 + snapshot.cars.length * CAR_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MessageType.Snapshot);
  view.setUint32(1, snapshot.tick, true);
  view.setUint32(5, snapshot.lastProcessedInput >>> 0, true);
  view.setUint8(9, snapshot.players.length);
  let o = HEAD_BYTES;
  for (const p of snapshot.players) {
    view.setUint16(o, p.id, true);
    view.setInt32(o + 2, quantizePosition(p.pos.x), true);
    view.setInt32(o + 6, quantizePosition(p.pos.y), true);
    view.setInt32(o + 10, quantizePosition(p.pos.z), true);
    view.setInt16(o + 14, quantizeVelocity(p.vel.x), true);
    view.setInt16(o + 16, quantizeVelocity(p.vel.y), true);
    view.setInt16(o + 18, quantizeVelocity(p.vel.z), true);
    view.setUint16(o + 20, quantizeYaw(p.yaw), true);
    view.setInt8(o + 22, quantizePitch(p.pitch));
    view.setUint8(o + 23, p.grounded ? 1 : 0);
    view.setUint8(o + 24, p.ride.car);
    view.setInt8(o + 25, p.ride.seat);
    view.setUint8(o + 26, p.ride.phase);
    view.setUint8(o + 27, p.ride.ticks);
    view.setUint8(o + 28, p.inside.place);
    view.setUint8(o + 29, p.inside.phase);
    view.setUint8(o + 30, p.inside.ticks);
    o += MOVER_BYTES;
  }
  view.setUint8(o, snapshot.cars.length);
  o += 1;
  for (const c of snapshot.cars) {
    view.setUint8(o, c.id);
    view.setInt32(o + 1, quantizePosition(c.x), true);
    view.setInt32(o + 5, quantizePosition(c.y), true);
    view.setInt32(o + 9, quantizePosition(c.z), true);
    view.setInt16(o + 13, int16(c.hx, HEADING_SCALE), true);
    view.setInt16(o + 15, int16(c.hz, HEADING_SCALE), true);
    view.setInt16(o + 17, int16(c.speed, SPEED_SCALE), true);
    view.setInt16(o + 19, int16(c.slip, SPEED_SCALE), true);
    view.setInt16(o + 21, int16(c.steer, HEADING_SCALE), true);
    view.setInt8(o + 23, Math.round(clamp(c.controls.throttle * CONTROL_SCALE, -127, 127)));
    view.setInt8(o + 24, Math.round(clamp(c.controls.turn * CONTROL_SCALE, -127, 127)));
    view.setUint8(o + 25, (c.controls.handbrake ? 1 : 0) | (c.lights ? 2 : 0));
    for (let s = 0; s < 4; s++) view.setUint16(o + 26 + s * 2, c.seats[s] as number, true);
    view.setUint8(o + 34, c.owed);
    o += CAR_BYTES;
  }
  return buffer;
}

export function decodeWalkSnapshot(buffer: ArrayBuffer): WalkSnapshot {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEAD_BYTES || view.getUint8(0) !== MessageType.Snapshot) throw new Error("not a snapshot of the game");
  const count = view.getUint8(9);
  const carsAt = HEAD_BYTES + count * MOVER_BYTES;
  if (buffer.byteLength < carsAt + 1) throw new Error("a snapshot of the game of the wrong length");
  const carCount = view.getUint8(carsAt);
  if (buffer.byteLength !== carsAt + 1 + carCount * CAR_BYTES) throw new Error("a snapshot of the game of the wrong length");
  const players: WalkMover[] = [];
  /** The seats the riders hold, as car * 4 + seat: no two riders share one. */
  const taken = new Set<number>();
  let o = HEAD_BYTES;
  for (let i = 0; i < count; i++) {
    players.push({
      id: view.getUint16(o, true),
      pos: { x: dequantizePosition(view.getInt32(o + 2, true)), y: dequantizePosition(view.getInt32(o + 6, true)), z: dequantizePosition(view.getInt32(o + 10, true)) },
      // A velocity rides at a place's scale, in sixteen bits.
      vel: { x: dequantizePosition(view.getInt16(o + 14, true)), y: dequantizePosition(view.getInt16(o + 16, true)), z: dequantizePosition(view.getInt16(o + 18, true)) },
      yaw: dequantizeYaw(view.getUint16(o + 20, true)),
      pitch: dequantizePitch(view.getInt8(o + 22)),
      grounded: view.getUint8(o + 23) === 1,
      ride: readRide(view.getUint8(o + 24), view.getInt8(o + 25), view.getUint8(o + 26), view.getUint8(o + 27), taken),
      inside: readInside(view.getUint8(o + 28), view.getUint8(o + 29), view.getUint8(o + 30)),
    });
    o += MOVER_BYTES;
  }
  o += 1;
  const cars: Car[] = [];
  for (let i = 0; i < carCount; i++) {
    let hx = view.getInt16(o + 13, true) / HEADING_SCALE;
    let hz = view.getInt16(o + 15, true) / HEADING_SCALE;
    // The heading is a unit vector; the wire's rounding is taken out of its length.
    const length = Math.sqrt(hx * hx + hz * hz);
    // A car of no heading cannot be driven or drawn: only a broken host sends one.
    if (!(length > 0)) throw new Error("a snapshot of the game with a car of no heading");
    hx /= length;
    hz /= length;
    const owed = view.getUint8(o + 34);
    if (owed > OWED_MAX) throw new Error("a snapshot of the game with a car owed more than it may be");
    const flags = view.getUint8(o + 25);
    cars.push({
      id: view.getUint8(o),
      x: dequantizePosition(view.getInt32(o + 1, true)),
      y: dequantizePosition(view.getInt32(o + 5, true)),
      z: dequantizePosition(view.getInt32(o + 9, true)),
      hx,
      hz,
      speed: view.getInt16(o + 17, true) / SPEED_SCALE,
      slip: view.getInt16(o + 19, true) / SPEED_SCALE,
      steer: view.getInt16(o + 21, true) / HEADING_SCALE,
      controls: { throttle: view.getInt8(o + 23) / CONTROL_SCALE, turn: view.getInt8(o + 24) / CONTROL_SCALE, handbrake: (flags & 1) !== 0 },
      lights: (flags & 2) !== 0,
      owed,
      seats: [view.getUint16(o + 26, true), view.getUint16(o + 28, true), view.getUint16(o + 30, true), view.getUint16(o + 32, true)],
    });
    o += CAR_BYTES;
  }
  return { tick: view.getUint32(1, true), lastProcessedInput: view.getUint32(5, true), players, cars };
}

/** A car `alpha` of the way from `a` to `b`: its place blended as a player's, its heading blended and made a unit again, the rest as `b` has it. */
function blendCar(a: Car, b: Car, alpha: number): Car {
  const to = copyCar(b);
  const at = blendPosition({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, alpha);
  let hx = a.hx + (b.hx - a.hx) * alpha;
  let hz = a.hz + (b.hz - a.hz) * alpha;
  const length = Math.sqrt(hx * hx + hz * hz);
  if (length > 0) {
    hx /= length;
    hz /= length;
  } else {
    hx = b.hx;
    hz = b.hz;
  }
  return { ...to, x: at.x, y: at.y, z: at.z, hx, hz };
}

export const WALK: NetGame<WalkWorld, Walker, WalkSnapshot, WalkState, never> = {
  protocolVersion: WALK_PROTOCOL,
  rules: WALK_RULES,
  encodeSnapshot: encodeWalkSnapshot,
  decodeSnapshot: decodeWalkSnapshot,
  // The game says nothing of its own over the wire but its snapshots.
  encodeEvent: () => new ArrayBuffer(0),
  decodeEvent: () => null,
  snapshot: (world, lastProcessedInput) => ({
    tick: world.state.tick,
    lastProcessedInput,
    players: [...world.state.players.values()].map((p) => ({ id: p.id, pos: p.pos, vel: p.vel, yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, ride: { ...p.ride }, inside: { ...p.inside } })),
    cars: world.state.cars.map(copyCar),
  }),
  tracked: () => [],
  /**
   * A press is the car's (a door, a seat, the lamps: `carPressed`) or a building's door (`insidePressed`). A player in the street presses the car first,
   * and the door only if the car's rules did not act on them; a player in a room presses only the door. It says nothing to the player.
   */
  pressed: (world, player, bits) => {
    if (player.inside.phase === OUTSIDE) {
      const before = player.ride;
      carPressed(world, player, bits);
      if (player.ride === before) insidePressed(world, player, bits);
    } else {
      insidePressed(world, player, bits);
    }
    return null;
  },
  /** The host's word on the local player's ride and on every car, as copies: the snapshot is kept for blending, and the replay that follows moves the cars. */
  correct: (world, local, truth, snapshot) => {
    // A rider of a car the snapshot does not hold is on foot.
    local.ride = truth.ride.phase === FOOT || snapshot.cars.some((c) => c.id === truth.ride.car) ? { ...truth.ride } : newRide();
    local.inside = { ...truth.inside };
    world.state.cars = snapshot.cars.map(copyCar);
  },
  blend: (a, b, alpha) => ({
    tick: b.tick,
    lastProcessedInput: b.lastProcessedInput,
    players: b.players.map((to) => {
      const from = a.players.find((p) => p.id === to.id);
      return from === undefined ? to : { ...to, pos: blendPosition(from.pos, to.pos, alpha), yaw: lerpAngle(from.yaw, to.yaw, alpha) };
    }),
    cars: b.cars.map((to) => {
      const from = a.cars.find((c) => c.id === to.id);
      return from === undefined ? copyCar(to) : blendCar(from, to, alpha);
    }),
  }),
  view(world, localId, between) {
    const local = world.state.players.get(localId);
    // The predicted world steps a car only while the local player is seated at its wheel; that car is the world's own, so the camera and the car never disagree. Every other car stands where the blended pair has it.
    const driven = local !== undefined && local.ride.phase === SEATED && local.ride.seat === 0 ? local.ride.car : 0;
    const cars = between === null ? world.state.cars : between.cars.map((c) => (c.id === driven ? (world.state.cars.find((w) => w.id === c.id) ?? c) : c));
    const players = new Map<number, Walker>();
    // A room is built 60 m over the street: a player is shown only to those where they are, the street's players to each other and a room's to those in it.
    const here = local === undefined ? 0 : whereIs(local.inside);
    // The others stand where the blended pair has them; the local player is the predicted world's own.
    for (const p of between?.players ?? []) {
      if (p.id === localId || whereIs(p.inside) !== here) continue;
      const known = p.ride.phase === FOOT || cars.some((c) => c.id === p.ride.car);
      players.set(p.id, { id: p.id, pos: cloneVec3(p.pos), vel: cloneVec3(p.vel), yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, lastProcessedInput: 0, ride: known ? { ...p.ride } : newRide(), inside: { ...p.inside } });
    }
    if (local === undefined) return { tick: world.state.tick, players, nextEntityId: world.state.nextEntityId, rngSeed: world.state.rngSeed, cars };
    // A rider other than the driver sits in the car as the blended pair has it, so the body is in the car that is drawn and not where the host's car will be a moment on. With no snapshot the cars are the world's, and the body is already in its seat.
    const rides = local.ride.phase === SEATED || local.ride.phase === LEAVING;
    const car = between !== null && rides && driven === 0 ? cars.find((c) => c.id === local.ride.car) : undefined;
    if (car !== undefined && local.ride.seat >= 0 && local.ride.seat <= 3) {
      const at = { x: 0, y: 0, z: 0 };
      seatPlace(car, local.ride.seat, at);
      players.set(localId, { ...local, pos: at });
    } else {
      players.set(localId, local);
    }
    return { tick: world.state.tick, players, nextEntityId: world.state.nextEntityId, rngSeed: world.state.rngSeed, cars };
  },
};
