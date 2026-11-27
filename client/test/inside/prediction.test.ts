import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { MoveButton, type InputCommand } from "@csarkosh/engine/sim/core";
import { createForest } from "@csarkosh/engine/sim/forest";
import { addPlayer, tickPlayers } from "@csarkosh/engine/sim/tick";
import { decodeWalkSnapshot, encodeWalkSnapshot, WALK, type WalkMover, type WalkSnapshot } from "../../src/net.js";
import { createWalkWorld, WALK_RULES, type WalkWorld } from "../../src/sim.js";
import { INSIDE, roomOf, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { insidePut } from "../../src/sim/inside/rules.js";

const SEED = 20261121;
const forest = createForest(SEED);

const command = (i: number): InputCommand => ({
  seq: i + 1,
  moveZ: i % 250 < 160 ? 1 : -1,
  moveX: i % 90 < 30 ? 1 : i % 90 > 60 ? -1 : 0,
  yaw: (i * 0.041) % 6.2831,
  pitch: 0,
  buttons: (i % 300 < 100 ? MoveButton.Sprint : 0) | (i % 111 === 0 ? MoveButton.Jump : 0),
});
const commands = Array.from({ length: 400 }, (_, i) => command(i));

/** What the engine's client does on a snapshot (`net/client.ts`, `reconcile`), then the replay of what is not yet acknowledged. */
function reconcile(predicted: WalkWorld, snapshot: WalkSnapshot, replay: InputCommand[]): void {
  const truth = snapshot.players.find((p) => p.id === 1) as WalkMover;
  const local = predicted.state.players.get(1) as NonNullable<ReturnType<WalkWorld["state"]["players"]["get"]>>;
  local.pos = { ...truth.pos };
  local.vel = { ...truth.vel };
  local.grounded = truth.grounded;
  local.lastProcessedInput = snapshot.lastProcessedInput;
  predicted.state.tick = snapshot.tick;
  WALK.correct(predicted, local, truth, snapshot);
  for (const c of replay.filter((k) => k.seq > snapshot.lastProcessedInput)) tickPlayers(predicted, new Map([[1, c]]), WALK_RULES);
}

/** A host with the player in the room `id`, its run to 400 commands, and the snapshot after the 150th kept. */
function hostRun(id: number): { host: WalkWorld; predicted: WalkWorld; at150: WalkSnapshot; room: InsideRoom } {
  const host = createWalkWorld(forest, true);
  const predicted = createWalkWorld(forest, false);
  addPlayer(host, WALK_RULES);
  addPlayer(predicted, WALK_RULES);
  insidePut(host, host.state.players.get(1)!, id);
  let at150: WalkSnapshot | null = null;
  commands.forEach((c, i) => {
    tickPlayers(host, new Map([[1, c]]), WALK_RULES);
    if (i === 149) at150 = WALK.snapshot(host, 150);
  });
  return { host, predicted, at150: at150 as unknown as WalkSnapshot, room: roomOf(SEED, id) as InsideRoom };
}

describe("a joined player's replay inside a room", () => {
  for (const id of [1, 2, 3]) {
    it(`ends where the host does, to the bit, when corrected from the host's own state (room ${id})`, () => {
      const { host, predicted, at150 } = hostRun(id);
      reconcile(predicted, at150, commands);
      const me = predicted.state.players.get(1)!;
      const there = host.state.players.get(1)!;
      expect(me.inside).toEqual(there.inside);
      expect(me.inside.phase).toBe(INSIDE);
      expect(me.pos).toEqual(there.pos);
      expect(me.vel).toEqual(there.vel);
      expect(me.grounded).toBe(there.grounded);
      expect(predicted.state.tick).toBe(host.state.tick);
    }, timeLimit(120_000));
  }

  it("lands within the wire's rounding of the host's when the snapshot comes over the wire", () => {
    const { host, predicted, at150 } = hostRun(1);
    reconcile(predicted, decodeWalkSnapshot(encodeWalkSnapshot(at150)), commands);
    const me = predicted.state.players.get(1)!;
    const there = host.state.players.get(1)!;
    expect(me.inside).toEqual(there.inside);
    // A place rounds to 1/128 m; walking 250 ticks on from it keeps a room's walls and furnishings in the way, so the error cannot grow past a few of those.
    expect(Math.abs(me.pos.x - there.pos.x)).toBeLessThan(0.1);
    expect(Math.abs(me.pos.z - there.pos.z)).toBeLessThan(0.1);
  }, timeLimit(120_000));
});
