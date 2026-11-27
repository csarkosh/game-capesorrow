import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import "../../src/terrain.js";
import { createClientSession } from "@csarkosh/engine/net/client";
import { FakeNetwork } from "@csarkosh/engine/net/fakeNetwork";
import { createHostSession } from "@csarkosh/engine/net/host";
import { PERFECT_NETWORK, type NetworkConditions } from "@csarkosh/engine/net/transport";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { createForest } from "@csarkosh/engine/sim/forest";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { addPlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import {
  CAR_BYTES, MOVER_BYTES, WALK, WALK_PROTOCOL, decodeWalkSnapshot, encodeWalkSnapshot, type WalkMover, type WalkSnapshot,
} from "../../src/net.js";
import { WALK_RULES, createWalkWorld, type WalkWorld } from "../../src/sim.js";
import { seatPlace, doorPlace } from "../../src/sim/car/seats.js";
import { groundCar } from "../../src/sim/car/start.js";
import { ENTER_TICKS, INTERACT_BIT, FULL_SPEED, OWED_MAX, TOWN_SPEED, WHEELBASE } from "../../src/sim/car/tuning.js";
import { newInside } from "../../src/sim/inside/rooms.js";
import { ENTERING, FOOT, LEAVING, SEATED, type Car, type Ride } from "../../src/sim/car/types.js";
import { speedLimitAt } from "../../src/sim/car/limit.js";
import { siteFor } from "../townWorld/world.js";

const SEED = 20261121;
const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

const forest = createForest(SEED);
const { anchor } = siteFor(SEED);

const ride = (car: number, seat: number, phase: Ride["phase"], ticks = 0): Ride => ({ car, seat, phase, ticks });
const mover = (id: number, r: Ride, x = 0): WalkMover => ({
  id, pos: { x, y: 3, z: 4 }, vel: { x: 0, y: 0, z: 0 }, yaw: 1, pitch: 0, grounded: true, ride: r, inside: newInside(),
});
const aCar = (id: number, more: Partial<Car> = {}): Car => ({
  id, x: 100.25, y: 2.5, z: -300.5, hx: 0.6, hz: 0.8, speed: 27.3, slip: -1.5, steer: 0.31,
  controls: { throttle: 1, turn: -0.5, handbrake: true }, lights: true, owed: 0, seats: [3, 0, 4, 0], ...more,
});

const snap: WalkSnapshot = {
  tick: 4000,
  lastProcessedInput: 77,
  players: [mover(3, ride(1, 0, SEATED)), mover(4, ride(1, 2, ENTERING, 41), 5)],
  cars: [aCar(1)],
};

describe("the car on the wire", () => {
  it("a snapshot with riders and a car survives the wire", () => {
    const back = decodeWalkSnapshot(encodeWalkSnapshot(snap));
    const car = back.cars[0] as Car;
    expect(car.seats).toEqual([3, 0, 4, 0]);
    expect(car.speed).toBeCloseTo(27.3, 2);
    expect(car.slip).toBeCloseTo(-1.5, 2);
    expect(car.hx * car.hx + car.hz * car.hz).toBeCloseTo(1, 12);
    expect(car.hx).toBeCloseTo(0.6, 3);
    expect(car.steer).toBeCloseTo(0.31, 3);
    expect(car.controls.throttle).toBeCloseTo(1, 2);
    expect(car.controls.turn).toBeCloseTo(-0.5, 2);
    expect([car.id, car.controls.handbrake, car.lights]).toEqual([1, true, true]);
    expect([car.x, car.y, car.z]).toEqual([100.25, 2.5, -300.5]);
    expect((back.players[0] as WalkMover).ride).toEqual({ car: 1, seat: 0, phase: SEATED, ticks: 0 });
    expect((back.players[1] as WalkMover).ride).toEqual({ car: 1, seat: 2, phase: ENTERING, ticks: 41 });
  }, timeLimit(60_000));

  it("carries the flags apart, a rider on foot as no ride and a reverse speed", () => {
    const shot: WalkSnapshot = {
      ...snap,
      players: [mover(3, { car: 2, seat: -1, phase: FOOT, ticks: 9 })],
      cars: [aCar(2, { speed: -6, controls: { throttle: -1, turn: 1, handbrake: false }, lights: true }), aCar(3, { lights: false, controls: { throttle: 0, turn: 0, handbrake: true } })],
    };
    const back = decodeWalkSnapshot(encodeWalkSnapshot(shot));
    expect((back.players[0] as WalkMover).ride).toEqual({ car: 0, seat: 0, phase: FOOT, ticks: 0 });
    const [a, b] = back.cars as [Car, Car];
    expect([a.id, a.speed, a.controls.handbrake, a.lights]).toEqual([2, -6, false, true]);
    expect([b.id, b.controls.handbrake, b.lights]).toEqual([3, true, false]);
  }, timeLimit(60_000));

  it("is laid out as designed: the mover is 31 bytes and the car 35, the car's fields at their offsets", () => {
    expect([MOVER_BYTES, CAR_BYTES, WALK_PROTOCOL]).toEqual([31, 35, 4]);
    const bytes = encodeWalkSnapshot(snap);
    const v = new DataView(bytes);
    const mover1 = 10 + MOVER_BYTES;
    expect([v.getUint8(10 + 24), v.getInt8(10 + 25), v.getUint8(10 + 26), v.getUint8(10 + 27)]).toEqual([1, 0, SEATED, 0]);
    expect([v.getUint8(mover1 + 24), v.getInt8(mover1 + 25), v.getUint8(mover1 + 26), v.getUint8(mover1 + 27)]).toEqual([1, 2, ENTERING, 41]);
    const countAt = 10 + 2 * MOVER_BYTES;
    expect(v.getUint8(countAt)).toBe(1);
    const c = countAt + 1;
    expect(v.getUint8(c)).toBe(1);
    expect(v.getInt32(c + 1, true)).toBe(Math.round(100.25 * 128));
    expect(v.getInt16(c + 13, true)).toBe(Math.round(0.6 * 32767));
    expect(v.getInt16(c + 15, true)).toBe(Math.round(0.8 * 32767));
    expect(v.getInt16(c + 17, true)).toBe(Math.round(27.3 * 256));
    expect(v.getInt16(c + 19, true)).toBe(Math.round(-1.5 * 256));
    expect(v.getInt16(c + 21, true)).toBe(Math.round(0.31 * 32767));
    expect(v.getInt8(c + 23)).toBe(127);
    expect(v.getInt8(c + 24)).toBe(Math.round(-0.5 * 127));
    expect(v.getUint8(c + 25)).toBe(3);
    expect([v.getUint16(c + 26, true), v.getUint16(c + 28, true), v.getUint16(c + 30, true), v.getUint16(c + 32, true)]).toEqual([3, 0, 4, 0]);
    // The steps owed to the driver's late commands are the car's last byte.
    expect(v.getUint8(c + 34)).toBe(0);
    expect(new DataView(encodeWalkSnapshot({ ...snap, cars: [aCar(1, { owed: OWED_MAX })] })).getUint8(c + 34)).toBe(OWED_MAX);
    expect(bytes.byteLength).toBe(countAt + 1 + CAR_BYTES);
  }, timeLimit(60_000));

  it("carries the steps owed, and refuses more than the most a car may owe", () => {
    for (const owed of [0, 1, 3, OWED_MAX]) {
      const back = decodeWalkSnapshot(encodeWalkSnapshot({ ...snap, cars: [aCar(1, { owed })] }));
      expect((back.cars[0] as Car).owed).toBe(owed);
    }
    const bytes = encodeWalkSnapshot(snap);
    new DataView(bytes).setUint8(10 + 2 * MOVER_BYTES + 1 + 34, OWED_MAX + 1);
    expect(() => decodeWalkSnapshot(bytes)).toThrow(/owed/);
  }, timeLimit(60_000));

  it("refuses a car with no heading, since it could be neither driven nor drawn", () => {
    const bytes = encodeWalkSnapshot(snap);
    const v = new DataView(bytes);
    const c = 10 + 2 * MOVER_BYTES + 1;
    v.setInt16(c + 13, 0, true);
    v.setInt16(c + 15, 0, true);
    expect(() => decodeWalkSnapshot(bytes)).toThrow(/heading/);
    // One axis of it zero is a heading along the other.
    v.setInt16(c + 15, 32767, true);
    expect(decodeWalkSnapshot(bytes).cars[0]).toMatchObject({ hx: 0, hz: 1 });
  }, timeLimit(60_000));

  it("a snapshot with no car and one with five players are the right lengths", () => {
    const none = encodeWalkSnapshot({ ...snap, players: [], cars: [] });
    expect(none.byteLength).toBe(10 + 1);
    expect(decodeWalkSnapshot(none).cars).toEqual([]);
    const five = encodeWalkSnapshot({ ...snap, players: [1, 2, 3, 4, 5].map((id) => mover(id, ride(0, 0, FOOT))), cars: [aCar(1)] });
    expect(five.byteLength).toBe(10 + 5 * MOVER_BYTES + 1 + CAR_BYTES);
    expect(decodeWalkSnapshot(five).players.length).toBe(5);
    const two = encodeWalkSnapshot({ ...snap, cars: [aCar(1), aCar(2)] });
    expect(two.byteLength).toBe(10 + 2 * MOVER_BYTES + 1 + 2 * CAR_BYTES);
  }, timeLimit(60_000));

  /** The snapshot's bytes with one mover's ride written over: car, seat, phase. */
  function withRide(index: number, car: number, seat: number, phase: number): ArrayBuffer {
    const buf = encodeWalkSnapshot(snap);
    const v = new DataView(buf);
    const at = 10 + index * MOVER_BYTES + 24;
    v.setUint8(at, car);
    v.setInt8(at + 1, seat);
    v.setUint8(at + 2, phase);
    return buf;
  }

  it("refuses a ride with a phase of none of the four, a seat outside the four, no car, or a seat held twice", () => {
    expect(() => decodeWalkSnapshot(withRide(0, 1, 0, 7))).toThrow(/phase/);
    expect(() => decodeWalkSnapshot(withRide(0, 1, 9, SEATED))).toThrow(/seat/);
    expect(() => decodeWalkSnapshot(withRide(0, 1, -1, SEATED))).toThrow(/seat/);
    expect(() => decodeWalkSnapshot(withRide(0, 1, 4, ENTERING))).toThrow(/seat/);
    expect(() => decodeWalkSnapshot(withRide(0, 0, 0, SEATED))).toThrow(/seat/);
    // Both movers in car 1's seat 0.
    expect(() => decodeWalkSnapshot(withRide(1, 1, 0, SEATED))).toThrow(/one seat/);
    // The same seat in another car, and the same seat by one on foot, are no clash.
    expect(decodeWalkSnapshot(withRide(1, 2, 0, SEATED)).players.length).toBe(2);
    expect(decodeWalkSnapshot(withRide(1, 1, 0, FOOT)).players[1]?.ride).toEqual({ car: 0, seat: 0, phase: FOOT, ticks: 0 });
    expect((decodeWalkSnapshot(encodeWalkSnapshot(snap)).players[0] as WalkMover).ride.phase).toBe(SEATED);
  }, timeLimit(60_000));

  it("refuses a buffer a byte short, a byte long, and one that stops short of its cars", () => {
    const buf = encodeWalkSnapshot(snap);
    expect(() => decodeWalkSnapshot(buf.slice(0, -1))).toThrow(/wrong length/);
    const long = new Uint8Array(buf.byteLength + 1);
    long.set(new Uint8Array(buf));
    expect(() => decodeWalkSnapshot(long.buffer)).toThrow(/wrong length/);
    expect(() => decodeWalkSnapshot(buf.slice(0, 10 + 2 * MOVER_BYTES))).toThrow();
  }, timeLimit(60_000));
});

/** A host's world and a joined client's predicted world, each with the player 1 and the car on an open stretch of the highway. */
function pair(zAt = anchor.z + 5000, hz = 1, speed = 0): { host: WalkWorld; predicted: WalkWorld } {
  const host = createWalkWorld(forest, true);
  const predicted = createWalkWorld(forest, false);
  addPlayer(host, WALK_RULES);
  addPlayer(predicted, WALK_RULES);
  const car = host.state.cars[0] as Car;
  const z = zAt;
  car.x = roadCenterX(SEED, z);
  car.z = z;
  car.hx = 0;
  car.hz = hz;
  car.speed = speed;
  groundCar(host.ground, car);
  car.seats[0] = 1;
  (host.state.players.get(1) as { ride: Ride }).ride = ride(car.id, 0, SEATED);
  return { host, predicted };
}

/** The drive: throttle, a turn under throttle, a brake, then a gentler throttle turning back. */
function drive(i: number): InputCommand {
  const seq = i + 1;
  if (i < 150) return cmd(seq, { moveZ: 1 });
  if (i < 190) return cmd(seq, { moveZ: 1, moveX: 0.3 });
  if (i < 230) return cmd(seq, { moveZ: 1 });
  if (i < 236) return cmd(seq, { moveZ: -1 });
  return cmd(seq, { moveZ: 1, moveX: -0.3 });
}

/** What the engine's client does on a snapshot (`net/client.ts`, `reconcile`), then the replay of what is not yet acknowledged. */
function reconcile(predicted: WalkWorld, snapshot: WalkSnapshot, commands: InputCommand[]): void {
  const truth = snapshot.players.find((p) => p.id === 1) as WalkMover;
  const local = predicted.state.players.get(1) as NonNullable<ReturnType<WalkWorld["state"]["players"]["get"]>>;
  local.pos = { ...truth.pos };
  local.vel = { ...truth.vel };
  local.grounded = truth.grounded;
  local.lastProcessedInput = snapshot.lastProcessedInput;
  predicted.state.tick = snapshot.tick;
  WALK.correct(predicted, local, truth, snapshot);
  for (const c of commands.filter((k) => k.seq > snapshot.lastProcessedInput)) tickPlayers(predicted, new Map([[1, c]]), WALK_RULES);
}

describe("a joined driver's replay", () => {
  const commands = Array.from({ length: 300 }, (_, i) => drive(i));

  /** The host's run to 300, with its snapshot at 200 kept. */
  function hostRun(): { host: WalkWorld; predicted: WalkWorld; at200: WalkSnapshot } {
    const { host, predicted } = pair();
    let at200: WalkSnapshot | null = null;
    commands.forEach((c, i) => {
      tickPlayers(host, new Map([[1, c]]), WALK_RULES);
      if (i === 199) at200 = WALK.snapshot(host, 200);
    });
    return { host, predicted, at200: at200 as unknown as WalkSnapshot };
  }

  it("matches the host's, with the corrected car carried over the wire", () => {
    const { host, predicted, at200 } = hostRun();
    const hostCar = host.state.cars[0] as Car;
    expect(hostCar.speed).toBeGreaterThan(1);
    expect(Math.abs(hostCar.hx)).toBeGreaterThan(0.005);
    reconcile(predicted, decodeWalkSnapshot(encodeWalkSnapshot(at200)), commands);
    const car = predicted.state.cars[0] as Car;
    // What the wire alone can put between the replayed car and the host's, from the wire's own steps (at the designed top speed, so no cap is leaned on).
    // The 100 replayed ticks last T = 100 * TICK_DT = 1.667 s. A place is rounded to 1/128 m, so up to 1/256 m = 0.0039 m an axis.
    // Speed and slip are rounded to 1/256 m/s, so up to 1/512 m/s each, which over T moves the car 2 * (1/512) * T = 0.0065 m.
    // The heading and the steer are rounded to 1/32767, so up to 1.5e-5 each: the heading's error over the distance covered, 30 m/s * T = 50 m, is 0.0008 m,
    // and the steer's turns the car by 30 / WHEELBASE * 1.5e-5 per second, which over T moves it by half of that * T squared * 30 m/s = 0.0070 m.
    // Taken together (each axis may take all of it): about 0.018 m.
    const T = (commands.length - 200) * TICK_DT;
    const half = 1 / 65534;
    const bound = 1 / 256 + (2 / 512) * T + half * 30 * T + ((30 / WHEELBASE) * half * T * T * 30) / 2;
    expect(bound).toBeLessThan(0.02);
    expect(Math.abs(car.x - hostCar.x)).toBeLessThanOrEqual(bound);
    expect(Math.abs(car.z - hostCar.z)).toBeLessThanOrEqual(bound);
    expect(Math.abs(car.speed - hostCar.speed)).toBeLessThanOrEqual(1 / 256);
    expect(Math.abs(car.hx - hostCar.hx)).toBeLessThanOrEqual(half + (30 / WHEELBASE) * half * T);
    expect(Math.abs(car.hz - hostCar.hz)).toBeLessThanOrEqual(half + (30 / WHEELBASE) * half * T);
    const me = predicted.state.players.get(1) as Walkerlike;
    const there = host.state.players.get(1) as Walkerlike;
    // A seated player is placed from the car's place and heading: the same, and a heading's error across the seat's 1 m.
    expect(Math.abs(me.pos.x - there.pos.x)).toBeLessThanOrEqual(bound + 1e-4);
    expect(Math.abs(me.pos.z - there.pos.z)).toBeLessThanOrEqual(bound + 1e-4);
    expect(me.ride).toEqual(there.ride);
    expect(predicted.state.tick).toBe(host.state.tick);
  }, timeLimit(60_000));

  it("is exact when corrected from the host's own state, so the wire's rounding is all that differs", () => {
    const { host, predicted, at200 } = hostRun();
    reconcile(predicted, at200, commands);
    const hostCar = host.state.cars[0] as Car;
    const car = predicted.state.cars[0] as Car;
    expect(car.x).toBeCloseTo(hostCar.x, 9);
    expect(car.z).toBeCloseTo(hostCar.z, 9);
    expect(car.speed).toBeCloseTo(hostCar.speed, 9);
    expect(car.hx).toBeCloseTo(hostCar.hx, 12);
  }, timeLimit(60_000));

  it("is exact across the fade: a car slowed from the full speed to the town's, replayed from a snapshot taken on the way", () => {
    // Start on the highway 20 m before the limit begins to fall, heading south at the full speed, and drive straight on at full throttle.
    let z = anchor.z + 5000;
    while (speedLimitAt(SEED, roadCenterX(SEED, z - 1), z - 1) === FULL_SPEED) z -= 1;
    const start = z + 20;
    const { host, predicted } = pair(start, -1, FULL_SPEED);
    let mid: WalkSnapshot | null = null;
    const slowest = { v: FULL_SPEED };
    // The highway bends, so the driver steers toward the road's centre 20 m ahead; the commands are made from the host's own run.
    const run: InputCommand[] = [];
    for (let i = 0; i < 900; i++) {
      const car = host.state.cars[0] as Car;
      const dx = roadCenterX(SEED, car.z - 20) - car.x;
      const side = (dx * car.hz + 20 * car.hx) / Math.sqrt(dx * dx + 400);
      const c = cmd(i + 1, { moveZ: 1, moveX: Math.max(-1, Math.min(1, side * 3)) });
      run.push(c);
      tickPlayers(host, new Map([[1, c]]), WALK_RULES);
      slowest.v = Math.min(slowest.v, car.speed);
      if (i === 399) mid = WALK.snapshot(host, 400);
    }
    const hostCar = host.state.cars[0] as Car;
    const midSpeed = (mid as unknown as WalkSnapshot).cars[0]?.speed as number;
    // The run did cross the fade: the car went at the full speed at the start, was between the two speeds at the snapshot, and ends at the town's.
    expect(midSpeed).toBeLessThan(FULL_SPEED - 0.5);
    expect(midSpeed).toBeGreaterThan(TOWN_SPEED + 0.5);
    expect(hostCar.speed).toBeLessThan(FULL_SPEED - 3);
    expect(slowest.v).toBeGreaterThan(TOWN_SPEED - 0.2);
    // A joined machine corrected from the host's own state at tick 400 and replaying the rest ends where the host does, bit for bit.
    reconcile(predicted, mid as unknown as WalkSnapshot, run);
    const car = predicted.state.cars[0] as Car;
    expect(car.x).toBe(hostCar.x);
    expect(car.z).toBe(hostCar.z);
    expect(car.speed).toBe(hostCar.speed);
    expect(car.hx).toBe(hostCar.hx);
    expect(car.hz).toBe(hostCar.hz);
  }, timeLimit(60_000));

  it("swallows the commands the host stepped for in advance: corrected from a snapshot whose car is owed a step, the replay lands where the host does", () => {
    // The host's tick 151 has no command from the driver; the command comes on the next tick, and the commands after it on the ones after.
    const host = pair().host;
    const empty = 150;
    for (let i = 0; i < empty; i++) tickPlayers(host, new Map([[1, commands[i] as InputCommand]]), WALK_RULES);
    tickPlayers(host, new Map(), WALK_RULES);
    const snapshot = WALK.snapshot(host, empty);
    expect((snapshot.cars[0] as Car).owed).toBe(1);
    for (let i = empty; i < commands.length; i++) tickPlayers(host, new Map([[1, commands[i] as InputCommand]]), WALK_RULES);
    const { predicted } = pair();
    reconcile(predicted, snapshot, commands);
    expect(predicted.state.cars[0]).toEqual(host.state.cars[0]);
    expect((predicted.state.players.get(1) as Walkerlike).pos).toEqual((host.state.players.get(1) as Walkerlike).pos);
    // Without the debt the replay would take one step more than the host did.
    const { predicted: naive } = pair();
    reconcile(naive, { ...snapshot, cars: [{ ...(snapshot.cars[0] as Car), owed: 0 }] }, commands);
    // The car is a step apart from the host's: not where it is, and within a tick or two of travel at the speed it has (at 15 m/s the drive's last bends turn the car from due north, so which side of the host it lies on is not z's to tell).
    const hostEnd = host.state.cars[0] as Car;
    const naiveEnd = naive.state.cars[0] as Car;
    const apart = Math.hypot(naiveEnd.x - hostEnd.x, naiveEnd.z - hostEnd.z);
    expect(apart).toBeGreaterThan(0.25 * Math.abs(hostEnd.speed) * TICK_DT);
    expect(apart).toBeLessThan(2 * Math.abs(hostEnd.speed) * TICK_DT);
  }, timeLimit(60_000));

  it("takes copies of the snapshot's car and ride, so a replay leaves the snapshot as it was", () => {
    const { predicted, at200 } = hostRun();
    const wire = decodeWalkSnapshot(encodeWalkSnapshot(at200));
    const before = JSON.stringify(wire);
    reconcile(predicted, wire, commands);
    expect(JSON.stringify(wire)).toBe(before);
    expect(predicted.state.cars[0]).not.toBe(wire.cars[0]);
    expect((predicted.state.cars[0] as Car).seats).not.toBe((wire.cars[0] as Car).seats);
    expect((predicted.state.cars[0] as Car).controls).not.toBe((wire.cars[0] as Car).controls);
    expect((predicted.state.players.get(1) as Walkerlike).ride).not.toBe((wire.players[0] as WalkMover).ride);
  }, timeLimit(60_000));

  it("leaves a car and a ride that agree", () => {
    const { predicted, at200 } = hostRun();
    reconcile(predicted, decodeWalkSnapshot(encodeWalkSnapshot(at200)), []);
    const me = predicted.state.players.get(1) as Walkerlike;
    const car = predicted.state.cars.find((c) => c.id === me.ride.car) as Car;
    expect(car.seats[me.ride.seat]).toBe(1);
    expect(me.ride.phase).toBe(SEATED);
  }, timeLimit(60_000));
});

type Walkerlike = { pos: { x: number; y: number; z: number }; ride: Ride };

describe("the car's blend and the view", () => {
  const a: WalkSnapshot = { tick: 10, lastProcessedInput: 1, players: [mover(3, ride(1, 0, SEATED), 0)], cars: [aCar(1, { x: 0, z: 0, hx: 1, hz: 0, speed: 5 })] };
  const b: WalkSnapshot = { tick: 14, lastProcessedInput: 2, players: [mover(3, ride(1, 0, SEATED), 8)], cars: [aCar(1, { x: 8, z: 4, hx: 0, hz: 1, speed: 9, lights: false })] };

  it("blends a car's place as a player's, its heading renormalised, the rest from the later", () => {
    const mid = WALK.blend(a, b, 0.5);
    const car = mid.cars[0] as Car;
    expect([car.x, car.z]).toEqual([4, 2]);
    expect(car.hx * car.hx + car.hz * car.hz).toBeCloseTo(1, 12);
    expect(car.hx).toBeCloseTo(Math.SQRT1_2, 12);
    expect([car.speed, car.lights]).toEqual([9, false]);
    expect(car.seats).toEqual([3, 0, 4, 0]);
    expect(car.seats).not.toBe((b.cars[0] as Car).seats);
    expect(mid.tick).toBe(14);
  }, timeLimit(60_000));

  it("takes a car that was not in the earlier snapshot as it is, and the ride from the later", () => {
    const mid = WALK.blend({ ...a, cars: [] }, { ...b, players: [mover(3, ride(1, 0, ENTERING, 7))] }, 0.5);
    expect((mid.cars[0] as Car).x).toBe(8);
    expect((mid.players[0] as WalkMover).ride).toEqual(ride(1, 0, ENTERING, 7));
  }, timeLimit(60_000));

  function viewWorld(localSeat: number): WalkWorld {
    const world = createWalkWorld(forest, false);
    const me = addPlayer(world, WALK_RULES);
    const car = world.state.cars[0] as Car;
    car.seats[localSeat] = me.id;
    (me as { ride: Ride }).ride = ride(car.id, localSeat, SEATED);
    if (localSeat !== 0) car.seats[0] = 9;
    return world;
  }

  it("draws a seated driver's car from the predicted world and another's from the snapshots", () => {
    const world = viewWorld(0);
    const mine = world.state.cars[0] as Car;
    const other: Car = aCar(2, { seats: [8, 0, 0, 0] });
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [], cars: [aCar(mine.id, { x: -999, z: -999, seats: [1, 0, 0, 0] }), other] };
    const frame = WALK.view(world, 1, between, between);
    expect(frame.cars.length).toBe(2);
    expect(frame.cars.find((c) => c.id === mine.id)).toBe(mine);
    expect(frame.cars.find((c) => c.id === 2)).toEqual(other);
    expect(frame.players.get(1)).toBe(world.state.players.get(1));
  }, timeLimit(60_000));

  it("draws an entering or leaving driver's car from the snapshots, since the predicted world does not step it then", () => {
    for (const phase of [ENTERING, LEAVING] as const) {
      const world = viewWorld(0);
      const me = world.state.players.get(1) as { ride: Ride };
      me.ride = ride(1, 0, phase, 20);
      // The snapshot may not yet (or no longer) have the player in the seat: the choice is not made from it.
      const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [], cars: [aCar(1, { x: 321, z: 654, seats: [phase === ENTERING ? 0 : 1, 0, 0, 0] })] };
      const car = WALK.view(world, 1, between, between).cars[0] as Car;
      expect(car).not.toBe(world.state.cars[0]);
      expect([car.x, car.z]).toEqual([321, 654]);
    }
  }, timeLimit(60_000));

  it("takes the predicted car for a seated driver even when the snapshot has not yet the player at the wheel", () => {
    const world = viewWorld(0);
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [], cars: [aCar(1, { x: 321, z: 654, seats: [0, 0, 0, 0] })] };
    expect(WALK.view(world, 1, between, between).cars[0]).toBe(world.state.cars[0]);
  }, timeLimit(60_000));

  it("draws the world's own cars before a snapshot has come, and the others' rides from the snapshot", () => {
    const world = viewWorld(0);
    expect(WALK.view(world, 1, null, null).cars).toBe(world.state.cars);
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [mover(1, ride(0, 0, FOOT)), mover(8, ride(2, 0, SEATED))], cars: [aCar(2, { seats: [8, 0, 0, 0] })] };
    const frame = WALK.view(world, 1, between, between);
    expect(frame.players.get(8)?.ride).toEqual(ride(2, 0, SEATED));
    expect(frame.players.get(8)?.ride).not.toBe((between.players[1] as WalkMover).ride);
    expect(frame.players.get(1)).toBe(world.state.players.get(1));
  }, timeLimit(60_000));

  it("treats a rider of a car that is not there as on foot, in the view and in the correction", () => {
    const world = viewWorld(0);
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [mover(8, ride(5, 0, SEATED))], cars: [aCar(1)] };
    expect(WALK.view(world, 1, between, between).players.get(8)?.ride).toEqual(ride(0, 0, FOOT));
    const local = world.state.players.get(1) as Walkerlike & { ride: Ride };
    const truth = mover(1, ride(5, 2, SEATED));
    WALK.correct(world, local as never, truth, { ...between, players: [truth] });
    expect(local.ride).toEqual(ride(0, 0, FOOT));
    WALK.correct(world, local as never, mover(1, ride(1, 0, ENTERING, 9)), { ...between, players: [] });
    expect(local.ride).toEqual(ride(1, 0, ENTERING, 9));
  }, timeLimit(60_000));

  it("draws a passenger in the snapshot's car, seated in it, not in the predicted world's", () => {
    const world = viewWorld(1);
    const snapCar = aCar(1, { x: 500, z: 600, hx: 1, hz: 0, seats: [9, 1, 0, 0] });
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [], cars: [snapCar] };
    const frame = WALK.view(world, 1, between, between);
    const car = frame.cars[0] as Car;
    expect(car).not.toBe(world.state.cars[0]);
    expect([car.x, car.z]).toEqual([500, 600]);
    const seat = { x: 0, y: 0, z: 0 };
    seatPlace(car, 1, seat);
    const me = frame.players.get(1) as Walkerlike;
    expect([me.pos.x, me.pos.y, me.pos.z]).toEqual([seat.x, seat.y, seat.z]);
    expect(me.ride).toEqual(ride(1, 1, SEATED));
  }, timeLimit(60_000));
});

describe("two peers over the engine's own sessions", () => {
  function party(prepare: (host: WalkWorld) => void = () => undefined, conditions: NetworkConditions = PERFECT_NETWORK) {
    const net = new FakeNetwork(conditions, 7);
    const [hostSide, clientSide] = net.createPair();
    const hostWorld = createWalkWorld(forest, true);
    prepare(hostWorld);
    const host = createHostSession(WALK, hostWorld, () => net.now, { levelId: forest.levelId, hostPeerId: "host" });
    const client = createClientSession(WALK, createWalkWorld(forest, false), clientSide, () => net.now, { expectedLevelId: forest.levelId });
    const peer = host.addPeer("p1", hostSide);
    net.advance(500);
    const play = (ticks: number, mine: (t: number) => InputCommand): void => {
      for (let t = 0; t < ticks; t++) {
        client.tick(mine(t));
        host.tick(cmd(t + 1));
        net.advance(TICK_DT * 1000);
      }
    };
    return { net, host, client, peer, play };
  }

  it("someone joining late, far from the car, is told where it is and who is in it", () => {
    const p = party((host) => {
      const car = host.state.cars[0] as Car;
      car.x = roadCenterX(SEED, anchor.z + 5000);
      car.z = anchor.z + 5000;
      car.hx = 0;
      car.hz = 1;
      car.lights = true;
      groundCar(host.ground, car);
    });
    // The host's own player rides in the front passenger's seat.
    const hostCar = p.host.world.state.cars[0] as Car;
    hostCar.seats[1] = 1;
    (p.host.world.state.players.get(1) as { ride: Ride }).ride = ride(hostCar.id, 1, SEATED);
    p.play(40, () => cmd(1));
    const mine = p.client.localPlayer();
    expect(Math.abs((mine?.pos.z ?? 0) - hostCar.z)).toBeGreaterThan(1000);
    const frame = p.client.renderState(p.net.now);
    const seen = frame.cars[0] as Car;
    expect(seen.id).toBe(hostCar.id);
    expect(Math.hypot(seen.x - hostCar.x, seen.z - hostCar.z)).toBeLessThan(0.5);
    expect(seen.seats).toEqual([0, 1, 0, 0]);
    expect(seen.lights).toBe(true);
    expect(p.client.world.state.cars[0]?.seats).toEqual([0, 1, 0, 0]);
  }, timeLimit(60_000));

  it("the driver gets in over the wire: the press reaches the host, the client sees ENTERING and then SEATED through snapshots", () => {
    const p = party();
    const car = p.host.world.state.cars[0] as Car;
    const door = { x: 0, z: 0 };
    doorPlace(car, 0, door);
    const there = p.host.world.state.players.get(p.peer) as { pos: { x: number; y: number; z: number } };
    there.pos = { x: door.x, y: (p.host.world.ground?.heightAt(door.x, door.z) ?? 0) + 0.9, z: door.z };
    p.play(10, (t) => cmd(t + 1));
    expect(p.client.localPlayer()?.ride.phase).toBe(FOOT);
    // One press: the bit is on for a single command.
    p.play(1, () => cmd(11, { buttons: INTERACT_BIT }));
    p.play(8, (t) => cmd(12 + t));
    const entering = p.client.localPlayer()?.ride;
    expect(entering?.phase).toBe(ENTERING);
    expect(entering?.car).toBe(car.id);
    expect(p.client.world.state.cars[0]?.seats[0]).toBe(p.peer);
    expect(p.host.world.state.players.get(p.peer)?.ride.phase).toBe(ENTERING);
    p.play(ENTER_TICKS + 10, (t) => cmd(20 + t));
    expect(p.host.world.state.players.get(p.peer)?.ride.phase).toBe(SEATED);
    expect(p.client.localPlayer()?.ride.phase).toBe(SEATED);
    // Seated, the driver's commands drive the car on both ends, and the prediction holds.
    p.play(120, (t) => cmd(100 + t, { moveZ: 1 }));
    const hostCar = p.host.world.state.cars[0] as Car;
    const mine = p.client.world.state.cars[0] as Car;
    expect(hostCar.speed).toBeGreaterThan(1);
    // The ends stand within a tick's travel at the car's own speed (the client is a tick out of step with the host's), and a correction moves the prediction by less than that.
    const tickTravel = Math.max(Math.abs(hostCar.speed), 1) * TICK_DT;
    expect(Math.hypot(mine.x - hostCar.x, mine.z - hostCar.z)).toBeLessThanOrEqual(2 * tickTravel);
    expect(p.client.stats.lastPredictionError).toBeLessThanOrEqual(tickTravel);
  }, timeLimit(60_000));
  it("keeps a joined driver's car where the host's is over a network with latency and jitter", () => {
    // 60 ms each way with 40 ms of jitter: the host's ticks often have no command from the driver, and often two at once.
    const p = party((host) => {
      const start = host.state.cars[0] as Car;
      start.x = roadCenterX(SEED, anchor.z + 5000);
      start.z = anchor.z + 5000;
      start.hx = 0;
      start.hz = 1;
      groundCar(host.ground, start);
    }, { latencyMs: 60, jitterMs: 40, lossRate: 0 });
    const car = p.host.world.state.cars[0] as Car;
    const door = { x: 0, z: 0 };
    doorPlace(car, 0, door);
    const there = p.host.world.state.players.get(p.peer) as { pos: { x: number; y: number; z: number } };
    there.pos = { x: door.x, y: (p.host.world.ground?.heightAt(door.x, door.z) ?? 0) + 0.9, z: door.z };
    p.play(10, (t) => cmd(t + 1));
    p.play(1, () => cmd(11, { buttons: INTERACT_BIT }));
    p.play(ENTER_TICKS + 40, (t) => cmd(12 + t));
    expect(p.host.world.state.players.get(p.peer)?.ride.phase).toBe(SEATED);
    expect(p.client.localPlayer()?.ride.phase).toBe(SEATED);
    // Throttle, a bend, a lift and a bend back: the controls change while commands are late.
    const drive = (t: number): InputCommand => cmd(1000 + t, t < 200 ? { moveZ: 1 } : t < 260 ? { moveZ: 1, moveX: 0.15 } : t < 300 ? { moveZ: 0.2 } : t < 360 ? { moveZ: 1, moveX: -0.15 } : { moveZ: 1 });
    let worst = 0;
    let owedSeen = 0;
    for (let t = 0; t < 500; t++) {
      p.play(1, () => drive(t));
      worst = Math.max(worst, p.client.stats.lastPredictionError);
      owedSeen = Math.max(owedSeen, (p.host.world.state.cars[0] as Car).owed);
    }
    const hostCar = p.host.world.state.cars[0] as Car;
    expect(hostCar.speed).toBeGreaterThan(1);
    // The host did step ahead of late commands (the jitter is a test of the debt), and never past what a tenth of a second allows.
    expect(owedSeen).toBeGreaterThan(0);
    expect(owedSeen).toBeLessThanOrEqual(OWED_MAX);
    // A correction moves the predicted player by what the wire's rounding and a command's controls arriving a tick after the host
    // stepped on the last ones can differ by: well under two ticks of travel at the car's top speed here. Without the debt each
    // empty host tick put the car a whole tick of travel further on than the client's, and the error grew with every one: the same run
    // without it measured 0.46 m, and with it 0.010 m.
    const twoTicks = 2 * FULL_SPEED * TICK_DT;
    expect(worst).toBeLessThan(twoTicks);
  }, timeLimit(60_000));
});
