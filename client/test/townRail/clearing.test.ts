import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { generateChunk } from "@csarkosh/engine/sim/chunk";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { CLUTTER_BUSH, CLUTTER_DRIFTWOOD, CLUTTER_FERN, CLUTTER_GRASS, CLUTTER_ROCK, CLUTTER_SHRUB, clutterInRect } from "@csarkosh/engine/sim/clutter";
import { RAIL_CORRIDOR_HALF, railCenterX } from "../../src/sim/town/rail.js";
import { RAIL_CLEAR_REACH, railFeatureMask } from "../../src/sim/town/railClearing.js";

const SEEDS = [20261121, 1, 424242];
/** A stretch of line a kilometre and more from the town (the town is at z = 0), 2 km long. */
const Z0 = 1200;
const Z1 = 3200;

describe("nothing grows on the railroad", () => {
  it("stands no trunk in the corridor and stands trunks right up beside it, in every chunk of 2 km of line on three seeds", () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      let inside = 0;
      let beside = 0;
      let nearest = Infinity;
      let total = 0;
      for (let cz = Math.floor(Z0 / CHUNK_SIZE); cz <= Math.floor(Z1 / CHUNK_SIZE); cz++) {
        const zMid = (cz + 0.5) * CHUNK_SIZE;
        const lo = Math.floor((railCenterX(seed, zMid) - 60) / CHUNK_SIZE);
        const hi = Math.floor((railCenterX(seed, zMid) + 60) / CHUNK_SIZE);
        for (let cx = lo; cx <= hi; cx++) {
          for (const prop of generateChunk(seed, cx, cz).props) {
            if (prop.material !== "trunk") continue;
            const x = (prop.box.min.x + prop.box.max.x) / 2;
            const z = (prop.box.min.z + prop.box.max.z) / 2;
            const off = Math.abs(x - railCenterX(seed, z));
            total++;
            if (off < RAIL_CORRIDOR_HALF) inside++;
            else if (off < RAIL_CORRIDOR_HALF + 12) beside++;
            if (off < nearest) nearest = off;
          }
        }
      }
      rows.push(`seed ${seed}: ${total} trunks, ${inside} in the corridor, ${beside} within 12 m of it, nearest ${nearest.toFixed(1)} m`);
      expect(inside, rows.join("\n")).toBe(0);
      expect(beside, rows.join("\n")).toBeGreaterThan(0);
    }
  });

  it("stands no grass, bush, shrub, fern, stone or driftwood in the corridor", () => {
    for (const seed of SEEDS) {
      let inside = 0;
      let beside = 0;
      for (const cls of [CLUTTER_GRASS, CLUTTER_BUSH, CLUTTER_SHRUB, CLUTTER_FERN, CLUTTER_ROCK, CLUTTER_DRIFTWOOD]) {
        for (let z = Z0; z < Z0 + 600; z += 100) {
          const x = railCenterX(seed, z + 50);
          for (const c of clutterInRect(seed, cls, x - 30, z, x + 30, z + 100)) {
            const off = Math.abs(c.x - railCenterX(seed, c.z));
            if (off < RAIL_CORRIDOR_HALF) inside++;
            else if (off < RAIL_CORRIDOR_HALF + 12) beside++;
          }
        }
      }
      expect(inside, `seed ${seed}`).toBe(0);
      expect(beside, `seed ${seed}: some stands beside it`).toBeGreaterThan(0);
    }
  });

  it("hands the mask back untouched beyond its reach", () => {
    const mask = { tree: 0.5, clutter: 0.25, meadow: 0, bare: 0 };
    expect(railFeatureMask(1, railCenterX(1, 100) + RAIL_CLEAR_REACH + 1, 100, mask)).toBe(mask);
    const at = railFeatureMask(1, railCenterX(1, 100) + 1, 100, mask);
    expect(at.tree).toBe(0);
    expect(at.clutter).toBe(0);
    expect(at.loose).toBe(0);
  });
});
