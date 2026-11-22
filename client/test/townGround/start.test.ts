import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { createForest } from "@csarkosh/engine/sim/forest";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { SEA_LEVEL } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { addPlayer } from "@csarkosh/engine/sim/tick";
import { EMPTY_GAME } from "../../src/game.js";
import { WALK_RULES, createWalkWorld } from "../../src/sim.js";
import { townCover } from "../../src/sim/town/clearing.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { townSpawnCells } from "../../src/sim/town/spawnCells.js";
import { townStart } from "../../src/sim/town/start.js";
import { TEN_SEEDS } from "./seeds.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

describe("the player's start in the town", () => {
  it("is the plan's spawn at the FBI office's door: the site's anchor plus the spawn, with its yaw, standing on the made ground above the sea", () => {
    for (const seed of TEN_SEEDS) {
      const start = townStart(seed);
      const { anchor } = siteFor(seed);
      const { spawn } = planFor(seed);
      expect([start.x, start.z, start.yaw]).toEqual([anchor.x + spawn.x, anchor.z + spawn.z, spawn.yaw]);
      expect(townCover(seed, start.x, start.z), `seed ${seed}`).toBe(1);
      expect(elevationSampleAt(seed, start.x, start.z).h, `seed ${seed}`).toBeGreaterThan(SEA_LEVEL + 2);
    }
  });

  it("is where the rules spawn a player, the first place the spiral tries, on every peer", () => {
    for (const seed of [20261121, 1, 424242]) {
      const forest = createForest(seed);
      const host = createWalkWorld(forest, true);
      const predicted = createWalkWorld(forest, false);
      const a = addPlayer(host, WALK_RULES);
      const b = addPlayer(predicted, WALK_RULES);
      const start = townStart(seed);
      expect(a.pos).toEqual(b.pos);
      expect([a.pos.x, a.pos.z, a.yaw]).toEqual([start.x, start.z, start.yaw]);
      expect(a.pos.y).toBeCloseTo(elevationSampleAt(seed, start.x, start.z).h + PLAYER_HALF.y, 9);
    }
  });

  it("is the one place the game, the rules and the worker name, and the worker's cells hold the start's chunk", () => {
    for (const seed of [20261121, 7]) {
      expect(EMPTY_GAME.startOf(seed)).toEqual(townStart(seed));
      const cells = townSpawnCells(seed, PLAYER_HALF);
      const start = townStart(seed);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.length).toBeLessThanOrEqual(4);
      expect(cells).toContainEqual({ cx: Math.floor(start.x / CHUNK_SIZE), cz: Math.floor(start.z / CHUNK_SIZE) });
    }
    const worker = readFileSync(SRC + "world.worker.ts", "utf8");
    expect(worker).toContain("serveWorldWork({ startOf: townStart, spawnCells: townSpawnCells });");
    expect(readFileSync(SRC + "game.ts", "utf8")).toContain("startOf: townStart,");
    expect(readFileSync(SRC + "sim.ts", "utf8")).toContain("townStart(world.forest.seed).yaw");
  });
});
