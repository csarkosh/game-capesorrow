/**
 * `roadCentreX` is the engine's `roadCenterX` to the bit, with the answer at the last seed and z asked kept: asked in an order that
 * repeats and alternates seeds and z, so that a stale entry would show.
 */
import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { roadCentreX } from "../../src/sim/town/roadCentre.js";

describe("roadCentreX", () => {
  it("equals roadCenterX by Object.is, whatever the order of the asks", () => {
    const seeds = [20261121, 1, 7];
    let s = 12345;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const asks: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      const seed = seeds[Math.floor(rnd() * 3)] as number;
      const z = COVE_Z + (rnd() - 0.5) * 30000;
      // Twice in a row, then another seed at the same z, then the same seed at another z, then back.
      asks.push([seed, z], [seed, z]);
      asks.push([seeds[(seeds.indexOf(seed) + 1) % 3] as number, z]);
      asks.push([seed, z + 1], [seed, z]);
    }
    for (const [seed, z] of asks) expect(Object.is(roadCentreX(seed, z), roadCenterX(seed, z)), `seed ${seed} z ${z}`).toBe(true);
    expect(asks.length).toBeGreaterThan(300);
  });

  it("tells +0 from -0 in z: the kept answer is used only for the very same number", () => {
    const order: number[][] = [[0, -0], [-0, 0], [0, -0, 0], [-0, 0, -0]];
    for (const seed of [20261121, 1, 7]) {
      for (const zs of order) {
        // Another z first, so that each order starts from a miss.
        roadCentreX(seed, 5);
        for (const z of zs) expect(Object.is(roadCentreX(seed, z), roadCenterX(seed, z)), `seed ${seed} z ${Object.is(z, -0) ? "-0" : "+0"}`).toBe(true);
      }
    }
  });
});
