/**
 * The chunk cells a world's first spawn reads, so the world's worker can make them with the first scene:
 * the cells the box a hull is tested against covers at the town's start, one to four of them, where the
 * spiral's first place is tried. A head start for whoever generates chunks ahead, never a promise: a spawn
 * that goes on to another place reads whatever cells it needs.
 */
import type { BoxSource } from "@csarkosh/engine/sim/boxSource";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { groundSpawn } from "@csarkosh/engine/sim/spawnGround";
import type { Vec3 } from "@csarkosh/engine/sim/core";
import { townStart } from "./start.js";

export function townSpawnCells(seed: number, half: Vec3): { cx: number; cz: number }[] {
  const start = townStart(seed);
  const cells: { cx: number; cz: number }[] = [];
  // The spiral's own first test, against a source that only notes what it is asked for.
  const noting: BoxSource = {
    near(min, max) {
      for (let cx = Math.floor(min.x / CHUNK_SIZE); cx <= Math.floor(max.x / CHUNK_SIZE); cx++) {
        for (let cz = Math.floor(min.z / CHUNK_SIZE); cz <= Math.floor(max.z / CHUNK_SIZE); cz++) {
          if (!cells.some((cell) => cell.cx === cx && cell.cz === cz)) cells.push({ cx, cz });
        }
      }
      return [];
    },
  };
  groundSpawn(noting, seed, start.x, start.z, half);
  return cells;
}
