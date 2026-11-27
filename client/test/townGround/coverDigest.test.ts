import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { coverD } from "../../src/sim/town/cover.js";
import { planFor } from "../../src/sim/town/planFor.js";

/**
 * The town's cover, to the bit. The cover is read wherever the ground is, and its windows were made to answer in plain
 * numbers and not in small objects (they were about 2 GB of a load's short-lived memory). A change of that kind must
 * change no number: these digests are of the value and both slopes at 200,000 points a seed, with the outlying lots'
 * windows and without, as they were before it.
 */
const DIGESTS: readonly (readonly [number, string])[] = [[20261121, "5f8ce0dd"], [1, "6fd0a614"], [6, "50f7b90a"]];

describe("the town's cover", () => {
  it("is to the bit what it was, on three seeds", () => {
    const f = new Float64Array(1);
    const u = new Uint32Array(f.buffer);
    for (const [seed, digest] of DIGESTS) {
      const plan = planFor(seed);
      let h = 0x811c9dc5;
      let edge = 0;
      const mix = (v: number): void => {
        f[0] = v;
        h = Math.imul(h ^ (u[0] as number), 0x01000193);
        h = Math.imul(h ^ (u[1] as number), 0x01000193);
      };
      for (let i = 0; i < 400; i++) {
        for (let j = 0; j < 500; j++) {
          const x = -700 + i * 3.37 + (j % 7) * 0.13;
          const z = -900 + j * 3.61 + (i % 5) * 0.11;
          for (const lots of [true, false]) {
            const c = coverD(plan, x, z, lots);
            mix(c.v);
            mix(c.dx);
            mix(c.dz);
            if (c.v > 0 && c.v < 1) edge++;
          }
        }
      }
      // Enough of the points are on a window's fading edge, where the arithmetic is: a digest of zeros and ones would hold nothing.
      expect(edge, String(seed)).toBeGreaterThan(50000);
      expect((h >>> 0).toString(16), String(seed)).toBe(digest);
    }
  }, timeLimit(120_000));
});
