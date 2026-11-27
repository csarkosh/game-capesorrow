import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { speedLimitAt } from "../../src/sim/car/limit.js";
import { FULL_SPEED, TOWN_SPEED } from "../../src/sim/car/tuning.js";
import { coverD } from "../../src/sim/town/cover.js";
import { WORLD_SEEDS, planFor, siteFor } from "../townWorld/world.js";

/** The centre of a convex polygon's corners, in the plan's frame. */
function centreOf(polygon: readonly { x: number; z: number }[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of polygon) {
    x += p.x / polygon.length;
    z += p.z / polygon.length;
  }
  return { x, z };
}

/** The farthest north (+z) any block of the town's own districts reaches, in world metres. */
function lastBlockZ(seed: number): number {
  let z = -Infinity;
  for (const b of planFor(seed).blocks) {
    if (b.district === "outskirts") continue;
    for (const p of b.polygon) z = Math.max(z, p.z + COVE_Z);
  }
  return z;
}

describe("the car's speed limit by place", () => {
  it("the limit is TOWN_SPEED inside a block", () => {
    expect(WORLD_SEEDS.length).toBeGreaterThanOrEqual(3);
    for (const seed of WORLD_SEEDS) {
      const { anchor } = siteFor(seed);
      const blocks = planFor(seed).blocks.filter((b) => b.district !== "outskirts");
      expect(blocks.length).toBeGreaterThan(5);
      for (const b of blocks) {
        const c = centreOf(b.polygon);
        expect(speedLimitAt(seed, anchor.x + c.x, COVE_Z + c.z)).toBe(TOWN_SPEED);
      }
    }
  }, timeLimit(300_000));

  it("the limit is FULL_SPEED far from the town", () => {
    for (const seed of WORLD_SEEDS) {
      const { anchor } = siteFor(seed);
      for (const north of [2_000, 20_000]) {
        const z = anchor.z + north;
        expect(speedLimitAt(seed, roadCenterX(seed, z), z)).toBe(FULL_SPEED);
      }
    }
  }, timeLimit(300_000));

  it("the limit never jumps along the highway out of town", () => {
    for (const seed of WORLD_SEEDS) {
      const end = lastBlockZ(seed) + 600;
      let before = Number.NaN;
      let slowest = Infinity;
      let reached = -1;
      for (let z = siteFor(seed).anchor.z; z <= end; z += 1) {
        const v = speedLimitAt(seed, roadCenterX(seed, z), z);
        expect(v).toBeGreaterThanOrEqual(TOWN_SPEED);
        expect(v).toBeLessThanOrEqual(FULL_SPEED);
        if (!Number.isNaN(before)) expect(Math.abs(v - before)).toBeLessThan(0.1);
        before = v;
        slowest = Math.min(slowest, v);
        if (v === FULL_SPEED && reached < 0) reached = z;
      }
      // The walk does start in the town and does end at the full speed, so the check above ran across the whole rise.
      expect(slowest).toBe(TOWN_SPEED);
      expect(before).toBe(FULL_SPEED);
      expect(reached).toBeGreaterThan(0);
    }
  }, timeLimit(300_000));

  it("an outlying lot does not lower the limit", () => {
    // Seed 1 has outlying lots that stand clear of every block (the blocks' and the quay's cover is 0 at their centres).
    const seed = 1;
    const plan = planFor(seed);
    const { anchor } = siteFor(seed);
    const lots = plan.blocks.filter((b) => b.district === "outskirts");
    expect(lots.length).toBeGreaterThan(0);
    let clear = 0;
    for (const lot of lots) {
      const c = centreOf(lot.polygon);
      const wx = anchor.x + c.x;
      const wz = COVE_Z + c.z;
      const without = coverD(plan, wx - anchor.x, wz - COVE_Z, false).v;
      // With the lots the cover is whole at their centre: a limit that read it would be TOWN_SPEED.
      expect(coverD(plan, c.x, c.z, true).v).toBe(1);
      const limit = speedLimitAt(seed, wx, wz);
      expect(limit).toBe(TOWN_SPEED + (FULL_SPEED - TOWN_SPEED) * (1 - without));
      if (without === 0) {
        clear++;
        expect(limit).toBe(FULL_SPEED);
      }
    }
    // Two of seed 1's lots stand clear of the blocks; the other lots are in reach of a block's fade, and take that part of it.
    expect(clear).toBeGreaterThanOrEqual(1);
  }, timeLimit(300_000));

  it("the quay is the town's", () => {
    for (const seed of WORLD_SEEDS) {
      const { a, b } = planFor(seed).quay;
      const { anchor } = siteFor(seed);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(speedLimitAt(seed, anchor.x + a.x + (b.x - a.x) * t, COVE_Z + a.z + (b.z - a.z) * t)).toBe(TOWN_SPEED);
      }
    }
  }, timeLimit(300_000));

  it("it is a pure function of the seed and the place", () => {
    const places: [number, number, number][] = [];
    for (const seed of WORLD_SEEDS) {
      for (const z of [-300, 0, 150, 500, 700, 800, 1000, 5000]) places.push([seed, roadCenterX(seed, z) + 7, z]);
    }
    const first = places.map(([s, x, z]) => speedLimitAt(s, x, z));
    // Other seeds and places in between, and the places again in the other order.
    speedLimitAt(12345, 0, 0);
    speedLimitAt(1, 5, 5);
    expect(places.map(([s, x, z]) => speedLimitAt(s, x, z))).toEqual(first);
    const backwards = [...places].reverse().map(([s, x, z]) => speedLimitAt(s, x, z)).reverse();
    expect(backwards).toEqual(first);
  }, timeLimit(300_000));
});
