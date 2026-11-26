import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { createClientSession } from "@csarkosh/engine/net/client";
import { FakeNetwork } from "@csarkosh/engine/net/fakeNetwork";
import { createHostSession } from "@csarkosh/engine/net/host";
import { PERFECT_NETWORK } from "@csarkosh/engine/net/transport";
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
import { ENTER_TICKS, INTERACT_BIT } from "../../src/sim/car/tuning.js";
import { ENTERING, FOOT, SEATED, type Car, type Ride } from "../../src/sim/car/types.js";
import { siteFor } from "../townWorld/world.js";

const SEED = 20261121;
const cmd = (seq: number, more: Partial<InputCommand> = {}): InputCommand => ({ seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...more });

const forest = createForest(SEED);
const { anchor } = siteFor(SEED);

const ride = (car: number, seat: number, phase: Ride["phase"], ticks = 0): Ride => ({ car, seat, phase, ticks });
const mover = (id: number, r: Ride, x = 0): WalkMover => ({
  id, pos: { x, y: 3, z: 4 }, vel: { x: 0, y: 0, z: 0 }, yaw: 1, pitch: 0, grounded: true, ride: r,
});
const aCar = (id: number, more: Partial<Car> = {}): Car => ({
  id, x: 100.25, y: 2.5, z: -300.5, hx: 0.6, hz: 0.8, speed: 27.3, slip: -1.5, steer: 0.31,
  controls: { throttle: 1, turn: -0.5, handbrake: true }, lights: true, seats: [3, 0, 4, 0], ...more,
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
  });

  it("carries the flags apart, a seat of -1 and a reverse speed", () => {
    const shot: WalkSnapshot = {
      ...snap,
      players: [mover(3, { car: 2, seat: -1, phase: FOOT, ticks: 0 })],
      cars: [aCar(2, { speed: -6, controls: { throttle: -1, turn: 1, handbrake: false }, lights: true }), aCar(3, { lights: false, controls: { throttle: 0, turn: 0, handbrake: true } })],
    };
    const back = decodeWalkSnapshot(encodeWalkSnapshot(shot));
    expect((back.players[0] as WalkMover).ride.seat).toBe(-1);
    const [a, b] = back.cars as [Car, Car];
    expect([a.id, a.speed, a.controls.handbrake, a.lights]).toEqual([2, -6, false, true]);
    expect([b.id, b.controls.handbrake, b.lights]).toEqual([3, true, false]);
  });

  it("is laid out as designed: the mover is 28 bytes and the car 34, the car's fields at their offsets", () => {
    expect([MOVER_BYTES, CAR_BYTES, WALK_PROTOCOL]).toEqual([28, 34, 2]);
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
    expect(bytes.byteLength).toBe(countAt + 1 + CAR_BYTES);
  });

  it("a snapshot with no car and one with five players are the right lengths", () => {
    const none = encodeWalkSnapshot({ ...snap, players: [], cars: [] });
    expect(none.byteLength).toBe(10 + 1);
    expect(decodeWalkSnapshot(none).cars).toEqual([]);
    const five = encodeWalkSnapshot({ ...snap, players: [1, 2, 3, 4, 5].map((id) => mover(id, ride(0, 0, FOOT))), cars: [aCar(1)] });
    expect(five.byteLength).toBe(10 + 5 * MOVER_BYTES + 1 + CAR_BYTES);
    expect(decodeWalkSnapshot(five).players.length).toBe(5);
    const two = encodeWalkSnapshot({ ...snap, cars: [aCar(1), aCar(2)] });
    expect(two.byteLength).toBe(10 + 2 * MOVER_BYTES + 1 + 2 * CAR_BYTES);
  });

  it("refuses a buffer a byte short, a byte long, and one that stops short of its cars", () => {
    const buf = encodeWalkSnapshot(snap);
    expect(() => decodeWalkSnapshot(buf.slice(0, -1))).toThrow(/wrong length/);
    const long = new Uint8Array(buf.byteLength + 1);
    long.set(new Uint8Array(buf));
    expect(() => decodeWalkSnapshot(long.buffer)).toThrow(/wrong length/);
    expect(() => decodeWalkSnapshot(buf.slice(0, 10 + 2 * MOVER_BYTES))).toThrow();
  });
});

/** A host's world and a joined client's predicted world, each with the player 1 and the car on an open stretch of the highway. */
function pair(): { host: WalkWorld; predicted: WalkWorld } {
  const host = createWalkWorld(forest, true);
  const predicted = createWalkWorld(forest, false);
  addPlayer(host, WALK_RULES);
  addPlayer(predicted, WALK_RULES);
  const car = host.state.cars[0] as Car;
  const z = anchor.z + 5000;
  car.x = roadCenterX(SEED, z);
  car.z = z;
  car.hx = 0;
  car.hz = 1;
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
    expect(Math.abs(hostCar.hx)).toBeGreaterThan(0.05);
    reconcile(predicted, decodeWalkSnapshot(encodeWalkSnapshot(at200)), commands);
    const car = predicted.state.cars[0] as Car;
    expect(car.x).toBeCloseTo(hostCar.x, 2);
    expect(car.z).toBeCloseTo(hostCar.z, 2);
    expect(car.speed).toBeCloseTo(hostCar.speed, 2);
    expect(car.hx).toBeCloseTo(hostCar.hx, 3);
    expect(car.hz).toBeCloseTo(hostCar.hz, 3);
    const me = predicted.state.players.get(1) as Walkerlike;
    const there = host.state.players.get(1) as Walkerlike;
    expect(me.pos.x).toBeCloseTo(there.pos.x, 2);
    expect(me.pos.z).toBeCloseTo(there.pos.z, 2);
    expect(me.ride).toEqual(there.ride);
    expect(predicted.state.tick).toBe(host.state.tick);
  });

  it("is exact when corrected from the host's own state, so the wire's rounding is all that differs", () => {
    const { host, predicted, at200 } = hostRun();
    reconcile(predicted, at200, commands);
    const hostCar = host.state.cars[0] as Car;
    const car = predicted.state.cars[0] as Car;
    expect(car.x).toBeCloseTo(hostCar.x, 9);
    expect(car.z).toBeCloseTo(hostCar.z, 9);
    expect(car.speed).toBeCloseTo(hostCar.speed, 9);
    expect(car.hx).toBeCloseTo(hostCar.hx, 12);
  });

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
  });

  it("leaves a car and a ride that agree", () => {
    const { predicted, at200 } = hostRun();
    reconcile(predicted, decodeWalkSnapshot(encodeWalkSnapshot(at200)), []);
    const me = predicted.state.players.get(1) as Walkerlike;
    const car = predicted.state.cars.find((c) => c.id === me.ride.car) as Car;
    expect(car.seats[me.ride.seat]).toBe(1);
    expect(me.ride.phase).toBe(SEATED);
  });
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
  });

  it("takes a car that was not in the earlier snapshot as it is, and the ride from the later", () => {
    const mid = WALK.blend({ ...a, cars: [] }, { ...b, players: [mover(3, ride(1, 0, ENTERING, 7))] }, 0.5);
    expect((mid.cars[0] as Car).x).toBe(8);
    expect((mid.players[0] as WalkMover).ride).toEqual(ride(1, 0, ENTERING, 7));
  });

  function viewWorld(localSeat: number): WalkWorld {
    const world = createWalkWorld(forest, false);
    const me = addPlayer(world, WALK_RULES);
    const car = world.state.cars[0] as Car;
    car.seats[localSeat] = me.id;
    (me as { ride: Ride }).ride = ride(car.id, localSeat, SEATED);
    if (localSeat !== 0) car.seats[0] = 9;
    return world;
  }

  it("draws the local driver's car from the predicted world and another's from the snapshots", () => {
    const world = viewWorld(0);
    const mine = world.state.cars[0] as Car;
    const other: Car = aCar(2, { seats: [8, 0, 0, 0] });
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [], cars: [aCar(mine.id, { x: -999, z: -999, seats: [1, 0, 0, 0] }), other] };
    const frame = WALK.view(world, 1, between, between);
    expect(frame.cars.length).toBe(2);
    expect(frame.cars.find((c) => c.id === mine.id)).toBe(mine);
    expect(frame.cars.find((c) => c.id === 2)).toEqual(other);
    expect(frame.players.get(1)).toBe(world.state.players.get(1));
  });

  it("draws the world's own cars before a snapshot has come, and the others' rides from the snapshot", () => {
    const world = viewWorld(0);
    expect(WALK.view(world, 1, null, null).cars).toBe(world.state.cars);
    const between: WalkSnapshot = { tick: 12, lastProcessedInput: 0, players: [mover(1, ride(0, 0, FOOT)), mover(8, ride(2, 0, SEATED))], cars: [] };
    const frame = WALK.view(world, 1, between, between);
    expect(frame.players.get(8)?.ride).toEqual(ride(2, 0, SEATED));
    expect(frame.players.get(8)?.ride).not.toBe((between.players[1] as WalkMover).ride);
    expect(frame.players.get(1)).toBe(world.state.players.get(1));
  });

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
  });
});

describe("two peers over the engine's own sessions", () => {
  function party(prepare: (host: WalkWorld) => void = () => undefined) {
    const net = new FakeNetwork(PERFECT_NETWORK, 7);
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
  });

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
    expect(Math.hypot(mine.x - hostCar.x, mine.z - hostCar.z)).toBeLessThan(1.5);
    expect(p.client.stats.lastPredictionError).toBeLessThan(0.5);
  });
});
