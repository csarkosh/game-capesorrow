import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { addPlayer } from "@csarkosh/engine/sim/tick";
import { fitsDesign } from "../../src/sim/inside/designWalk.js";
import { arriveAt, arriveIn, inRoom, insideRooms, roomOf, spotOf, INSIDE, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { insidePut } from "../../src/sim/inside/rules.js";
import { WALK_RULES, type WalkWorld } from "../../src/sim.js";
import { newCar } from "../../src/sim/car/start.js";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";
import { townStart } from "../../src/sim/town/start.js";
import { worldFor } from "../townWorld/world.js";
import { CELL, centre, flood } from "./designHelpers.js";

const GAME_SEEDS: readonly number[] = [20261121, 1, 6, 1175766972];
const SEEDS = [...GAME_SEEDS, ...Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => !GAME_SEEDS.includes(s))];

describe("the named places of the rooms", () => {
  it("are places a hull stands free in, and are reached from the arrival, on every seed", () => {
    for (const seed of SEEDS) {
      for (const room of insideRooms(seed)) {
        const d = room.design;
        const names = ["door", "back", ...(d.marks ?? []).map((m) => m.name).filter((n) => n !== "beyond")];
        const reach = flood(d, d.arrive);
        for (const name of names) {
          const at = spotOf(room, name);
          const label = `seed ${seed} ${room.name} ${name}`;
          expect(at, label).toBeDefined();
          expect(fitsDesign(d, at!.s, at!.d, at!.y, HULL_RADIUS, 0.002), `${label}: a hull stands free there`).toBe(true);
          // Within a cell of one the fill reached, on its level.
          const near = reach.states.some((s) => Math.abs(centre(s.i, s.j).s - at!.s) < CELL && Math.abs(centre(s.i, s.j).d - at!.d) < CELL && Math.abs(s.h - at!.y) < 0.5);
          // (A room still drawn by the street's builder has doorways off the grid the fill walks; its places are held to being free.)
          if (!d.legacy) expect(near, `${label}: reached from the arrival`).toBe(true);
        }
      }
    }
  }, timeLimit(300_000));

  it("put a player there: insidePut with a name stands them at the place, and at no place the room does not name", () => {
    const seed = 20261121;
    const world = worldFor(seed) as WalkWorld;
    world.state = { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: seed | 0, cars: [newCar(seed, 1)] };
    const p = addPlayer(world, WALK_RULES);
    const lodging = roomOf(seed, 3) as InsideRoom;
    expect(insidePut(world, p, 3, "nowhere")).toBe(false);
    expect(insidePut(world, p, 3, "room")).toBe(true);
    const at = spotOf(lodging, "room")!;
    const want = arriveAt(lodging, at);
    expect([p.pos.x, p.pos.y, p.pos.z]).toEqual([want.x, want.y, want.z]);
    expect(p.inside.phase).toBe(INSIDE);
    expect(p.pos.y - PLAYER_HALF.y - lodging.floorY).toBeGreaterThan(3);
    const here = inRoom(lodging, p.pos.x, p.pos.z);
    expect(Math.abs(here.s - lodging.s0 - at.s)).toBeLessThan(1e-6);
    // No name: the arrival, as before.
    expect(insidePut(world, p, 3)).toBe(true);
    const a = arriveIn(lodging);
    expect([p.pos.x, p.pos.y, p.pos.z]).toEqual([a.x, a.y, a.z]);
    // The cafe's back.
    expect(insidePut(world, p, 2, "back")).toBe(true);
    expect(insidePut(world, p, 0)).toBe(true);
  }, timeLimit(120_000));

  it("print each room's frame and the spawn, for aiming (the console's aim is computed from the spawn)", () => {
    for (const seed of [1175766972, 20261121]) {
      const start = townStart(seed);
      const lines = insideRooms(seed).map((r) => `${r.name}: ox ${r.ox.toFixed(2)} oz ${r.oz.toFixed(2)} n (${r.nx.toFixed(3)}, ${r.nz.toFixed(3)}) t (${r.tx.toFixed(3)}, ${r.tz.toFixed(3)}) s0 ${r.s0.toFixed(2)} floorY ${r.floorY.toFixed(2)}`);
      console.log(`[frames] seed ${seed}: spawn x ${start.x.toFixed(2)} z ${start.z.toFixed(2)}\n[frames] ${lines.join("\n[frames] ")}`);
    }
  }, timeLimit(120_000));
});
