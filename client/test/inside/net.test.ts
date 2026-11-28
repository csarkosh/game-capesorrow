import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { createForest } from "@csarkosh/engine/sim/forest";
import { addPlayer } from "@csarkosh/engine/sim/tick";
import { decodeWalkSnapshot, encodeWalkSnapshot, MOVER_BYTES, WALK, WALK_PROTOCOL, whereIs, type WalkMover, type WalkSnapshot } from "../../src/net.js";
import { createWalkWorld, WALK_RULES } from "../../src/sim.js";
import { doorPlace } from "../../src/sim/car/seats.js";
import { INTERACT_BIT } from "../../src/sim/car/tuning.js";
import { ENTERING, FOOT } from "../../src/sim/car/types.js";
import { GOING_IN, GOING_OUT, INSIDE, newInside, OUTSIDE, type Inside } from "../../src/sim/inside/rooms.js";

const forest = createForest(20261121);

const mover = (id: number, inside: Inside, x = 0): WalkMover => ({
  id, pos: { x, y: 3, z: 4 }, vel: { x: 0, y: 0, z: 0 }, yaw: 1, pitch: 0, grounded: true, ride: { car: 0, seat: 0, phase: FOOT, ticks: 0 }, inside,
});
const snapOf = (players: WalkMover[]): WalkSnapshot => ({ tick: 9, lastProcessedInput: 3, players, cars: [] });
const HEAD = 10;

describe("a player's place by the rooms on the wire", () => {
  it("survives a round trip in each phase, three bytes a player after the ride", () => {
    const players = [
      mover(1, newInside()),
      mover(2, { place: 3, phase: GOING_IN, ticks: 27 }, 1),
      mover(3, { place: 2, phase: INSIDE, ticks: 0 }, 2),
      mover(4, { place: 1, phase: GOING_OUT, ticks: 5 }, 3),
    ];
    const bytes = encodeWalkSnapshot(snapOf(players));
    expect(bytes.byteLength).toBe(HEAD + 4 * MOVER_BYTES + 1);
    expect(WALK_PROTOCOL).toBe(5);
    expect(WALK.protocolVersion).toBe(5);
    const back = decodeWalkSnapshot(bytes);
    expect(back.players.map((p) => p.inside)).toEqual(players.map((p) => p.inside));
    const v = new DataView(bytes);
    // The mover's last three bytes: the room, the phase, the ticks.
    const at = HEAD + 1 * MOVER_BYTES + 28;
    expect([v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2)]).toEqual([3, GOING_IN, 27]);
    expect(MOVER_BYTES).toBe(31);
  }, timeLimit(60_000));

  /** The snapshot's one mover, with its place by the rooms written over. */
  function withInside(place: number, phase: number, ticks = 0): ArrayBuffer {
    const buf = encodeWalkSnapshot(snapOf([mover(1, newInside())]));
    const v = new DataView(buf);
    v.setUint8(HEAD + 28, place);
    v.setUint8(HEAD + 29, phase);
    v.setUint8(HEAD + 30, ticks);
    return buf;
  }

  it("refuses a phase of none of the four, a room with the phase outside, and no room in a room", () => {
    expect(() => decodeWalkSnapshot(withInside(1, 4))).toThrow(/phase/);
    expect(() => decodeWalkSnapshot(withInside(0, 255))).toThrow(/phase/);
    expect(() => decodeWalkSnapshot(withInside(1, OUTSIDE))).toThrow(/room/);
    expect(() => decodeWalkSnapshot(withInside(0, INSIDE))).toThrow(/room/);
    expect(() => decodeWalkSnapshot(withInside(0, GOING_IN))).toThrow(/room/);
    expect(decodeWalkSnapshot(withInside(2, GOING_OUT, 9)).players[0]?.inside).toEqual({ place: 2, phase: GOING_OUT, ticks: 9 });
    // The municipal building's room is the fourth.
    expect(decodeWalkSnapshot(withInside(4, INSIDE, 0)).players[0]?.inside).toEqual({ place: 4, phase: INSIDE, ticks: 0 });
    // A player in the street has no place and no ticks, whatever the bytes said.
    expect(decodeWalkSnapshot(withInside(0, OUTSIDE, 12)).players[0]?.inside).toEqual(newInside());
  }, timeLimit(60_000));

  it("is the host's word on the local player, copied by correct()", () => {
    const world = createWalkWorld(forest, false);
    const local = addPlayer(world, WALK_RULES);
    const truth = mover(1, { place: 2, phase: INSIDE, ticks: 0 });
    WALK.correct(world, local, truth, snapOf([truth]));
    expect(local.inside).toEqual(truth.inside);
    expect(local.inside).not.toBe(truth.inside);
    const out = mover(1, newInside());
    WALK.correct(world, local, out, snapOf([out]));
    expect(local.inside.phase).toBe(OUTSIDE);
  }, timeLimit(60_000));

  it("is taken by the host's snapshot as a copy", () => {
    const world = createWalkWorld(forest, true);
    const p = addPlayer(world, WALK_RULES);
    p.inside = { place: 1, phase: GOING_IN, ticks: 4 };
    const shot = WALK.snapshot(world, 0);
    p.inside.ticks = 3;
    expect(shot.players[0]?.inside).toEqual({ place: 1, phase: GOING_IN, ticks: 4 });
  }, timeLimit(60_000));
});

describe("who a player sees by the rooms", () => {
  it("names where a player is: the room in a room or leaving it, else the street", () => {
    expect([whereIs(newInside()), whereIs({ place: 2, phase: GOING_IN, ticks: 3 }), whereIs({ place: 2, phase: INSIDE, ticks: 0 }), whereIs({ place: 2, phase: GOING_OUT, ticks: 3 })]).toEqual([0, 0, 2, 2]);
  });

  function viewFor(local: Inside, others: WalkMover[]): number[] {
    const world = createWalkWorld(forest, false);
    const me = addPlayer(world, WALK_RULES);
    me.inside = local;
    const view = WALK.view(world, me.id, snapOf([mover(me.id, local), ...others]), null);
    return [...view.players.keys()].sort((a, b) => a - b);
  }

  it("shows the street to the street and a room to those in it, and no one else", () => {
    const street = mover(5, newInside());
    const goingIn = mover(6, { place: 1, phase: GOING_IN, ticks: 9 });
    const inOne = mover(7, { place: 1, phase: INSIDE, ticks: 0 });
    const leavingOne = mover(8, { place: 1, phase: GOING_OUT, ticks: 9 });
    const inTwo = mover(9, { place: 2, phase: INSIDE, ticks: 0 });
    // The local player is the first the world made, id 1.
    expect(viewFor(newInside(), [street, goingIn, inOne, leavingOne, inTwo])).toEqual([1, 5, 6]);
    expect(viewFor({ place: 1, phase: INSIDE, ticks: 0 }, [street, goingIn, inOne, leavingOne, inTwo])).toEqual([1, 7, 8]);
    expect(viewFor({ place: 2, phase: GOING_OUT, ticks: 3 }, [street, inOne, inTwo])).toEqual([1, 9]);
    // Going in, the local player is still in the street.
    expect(viewFor({ place: 1, phase: GOING_IN, ticks: 3 }, [street, inOne])).toEqual([1, 5]);
  }, timeLimit(60_000));

  it("carries a remote player's place by the rooms into the view", () => {
    const world = createWalkWorld(forest, false);
    const me = addPlayer(world, WALK_RULES);
    const there = mover(7, { place: 3, phase: INSIDE, ticks: 0 });
    me.inside = { place: 3, phase: INSIDE, ticks: 0 };
    const view = WALK.view(world, me.id, snapOf([mover(me.id, me.inside), there]), null);
    expect(view.players.get(7)?.inside).toEqual(there.inside);
  }, timeLimit(60_000));
});

describe("a press, on the host", () => {
  it("is the car's first for a player in the street, and the door's only when the car did not act", () => {
    const world = createWalkWorld(forest, true);
    const p = addPlayer(world, WALK_RULES);
    const car = world.state.cars[0]!;
    const at = { x: 0, z: 0 };
    doorPlace(car, 0, at);
    p.pos = { x: at.x, y: car.y + 0.9, z: at.z };
    WALK.pressed(world, p, INTERACT_BIT);
    expect(p.ride.phase).toBe(ENTERING);
    expect(p.inside.phase).toBe(OUTSIDE);
  }, timeLimit(60_000));
});
