import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { groundCover } from "@csarkosh/engine/sim/clutter";
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { activeTerrainVariant, elevationAt, shoreHeight, shoreStrip } from "@csarkosh/engine/sim/terrain";
import { townFeatureMask, townStripWeight, YARD_LIFT } from "../../src/sim/town/clearing.js";
import { RAIL_BED_HALF, RAIL_OFFSET, railCenterX } from "../../src/sim/town/rail.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { VERGE_H_HI, VERGE_H_LO, VERGE_SEA_MARGIN, VERGE_SEA_RAMP, corridorWeight, madeWeight } from "../../src/sim/town/verge.js";

/** Four worlds: three whose town is pinned in the ground's digests and one with a low, flat bay. */
const SEEDS = [20261121, 1, 6, 7];
/** The paint stops reading sand at this height (the engine's `COAST_FADE_END`): where `shoreHeight` is above it the ground paints as soil. */
const NO_SAND_FROM = 9;
/** A stretch of coast well clear of the town (the plan reaches 600 m and the made ground's fade 160 m beyond it). */
const OUTSIDE = [1500, -1500, 2400, -2400, 3300, -3300];

function mask(seed: number, x: number, z: number): { tree: number; clutter: number; meadow: number; loose?: number } {
  return (activeTerrainVariant().featureMask as (s: number, x: number, z: number) => { tree: number; clutter: number; meadow: number; loose?: number })(seed, x, z);
}

/** The made ground nobody claimed: no yard, block or street strip of the town's own, dry land, whole cover. */
function unclaimedFill(seed: number): { x: number; z: number; h: number }[] {
  const ax = siteFor(seed).anchor.x;
  const found: { x: number; z: number; h: number }[] = [];
  for (let z = -440; z <= 440; z += 10) {
    for (let x = ax - 120; x <= ax + 120; x += 10) {
      if (townStripWeight(seed, x, z) !== 0 || madeWeight(seed, x, z) !== 1) continue;
      const h = elevationAt(seed, x, z);
      if (h >= VERGE_H_HI) found.push({ x, z, h });
    }
  }
  return found;
}

describe("the made ground and the highway's corridor are not beach", () => {
  it("(a) unclaimed fill in the town reads as ground that paints as soil, never sand, and has no trees on it", () => {
    for (const seed of SEEDS) {
      const fill = unclaimedFill(seed);
      expect(fill.length, `seed ${seed}`).toBeGreaterThan(20);
      let low = 0;
      for (const p of fill) {
        const w = shoreStrip(seed, p.x, p.z);
        expect(w, `seed ${seed} at ${p.x},${p.z}`).toBe(1);
        expect(shoreHeight(seed, p.x, p.z, p.h), `seed ${seed}`).toBe(p.h + YARD_LIFT);
        expect(shoreHeight(seed, p.x, p.z, p.h)).toBeGreaterThanOrEqual(NO_SAND_FROM);
        // Where the ground stood in the beach's band (under 9 m) the mask shuts the trees the lift would let in.
        if (p.h < 4) {
          low++;
          expect(mask(seed, p.x, p.z).tree, `seed ${seed}`).toBe(0);
        }
      }
      expect(low, `seed ${seed}: some of the fill stands in the sand band`).toBeGreaterThan(0);
    }
  });

  it("(a) the weeds on it are patches: rough grass in some, thin cover and bare soil in others, never one value", () => {
    for (const seed of SEEDS) {
      const meadow: number[] = [];
      const clutter: number[] = [];
      for (const p of unclaimedFill(seed)) {
        if (p.h < 4.5) continue;
        const m = mask(seed, p.x, p.z);
        meadow.push(m.meadow);
        clutter.push(m.clutter);
      }
      expect(meadow.length, `seed ${seed}`).toBeGreaterThan(10);
      expect(Math.max(...meadow), `seed ${seed}`).toBeGreaterThan(0.3);
      expect(Math.min(...meadow), `seed ${seed}`).toBeLessThan(0.05);
      expect(Math.min(...clutter), `seed ${seed}`).toBeLessThan(0.6);
      expect(Math.max(...clutter), `seed ${seed}`).toBe(1);
    }
  });

  it("(b) between the highway and the railroad, inside the town and out, the ground is not beach", () => {
    for (const seed of SEEDS) {
      for (const z of [...OUTSIDE, -300, 150, 330]) {
        const cx = roadCenterX(seed, z);
        for (const u of [-23, -20, -16, -12, -8, -4, 0, 4]) {
          const x = cx + u;
          const h = elevationAt(seed, x, z);
          if (h < VERGE_H_HI) continue;
          expect(corridorWeight(seed, x, z), `seed ${seed} z ${z} u ${u}`).toBe(1);
          expect(shoreStrip(seed, x, z), `seed ${seed} z ${z} u ${u}`).toBe(1);
          expect(shoreHeight(seed, x, z, h), `seed ${seed} z ${z} u ${u}`).toBeGreaterThanOrEqual(NO_SAND_FROM);
        }
      }
    }
  });

  it("(b) the corridor reaches the railroad's margin: whole to 6 m past the ballast, then falling over the ramp", () => {
    const edge = RAIL_OFFSET + RAIL_BED_HALF + VERGE_SEA_MARGIN;
    for (const seed of SEEDS) {
      for (const z of OUTSIDE) {
        const cx = roadCenterX(seed, z);
        expect(corridorWeight(seed, cx - edge, z), `seed ${seed} z ${z}`).toBe(1);
        const mid = corridorWeight(seed, cx - edge - VERGE_SEA_RAMP / 2, z);
        expect(mid).toBeGreaterThan(0.2);
        expect(mid).toBeLessThan(0.8);
        expect(corridorWeight(seed, cx - edge - VERGE_SEA_RAMP, z)).toBe(0);
        // The rail's own centre is 16 m seaward of the highway's.
        expect(railCenterX(seed, z)).toBe(cx - RAIL_OFFSET);
      }
    }
  });

  it("(c) the real beach seaward of the margin outside the town is beach as it was, and meets the new ground over a few metres", () => {
    let beach = 0;
    let ramped = 0;
    for (const seed of SEEDS) {
      for (let z = 1200; z <= 4200; z += 60) {
        for (const sign of [1, -1]) {
          const zz = sign * z;
          const cx = roadCenterX(seed, zz);
          const gone = RAIL_OFFSET + RAIL_BED_HALF + VERGE_SEA_MARGIN + VERGE_SEA_RAMP;
          for (let s = 2; s <= 42; s += 4) {
            const x = cx - gone - s;
            const h = elevationAt(seed, x, zz);
            if (h < 0.2 || h > 3.5) continue;
            beach++;
            expect(shoreStrip(seed, x, zz), `seed ${seed} z ${zz}`).toBe(0);
            expect(shoreHeight(seed, x, zz, h)).toBe(h);
            expect(mask(seed, x, zz).tree).toBeGreaterThanOrEqual(0);
          }
          // Inside the ramp the weight is partial: the soft edge, a few metres wide (the paint reads h + 12 w, soil from 9 m).
          const xr = cx - (RAIL_OFFSET + RAIL_BED_HALF + VERGE_SEA_MARGIN) - VERGE_SEA_RAMP / 2;
          const hr = elevationAt(seed, xr, zz);
          if (hr >= VERGE_H_HI && hr < 4) {
            ramped++;
            const w = shoreStrip(seed, xr, zz);
            expect(w).toBeGreaterThan(0);
            expect(w).toBeLessThan(1);
          }
        }
      }
    }
    expect(beach).toBeGreaterThan(50);
    expect(ramped).toBeGreaterThan(0);
  });

  it("(d) the cove's beach below the quay and its bank keeps its strip as the town's own left it, and paints as beach", () => {
    let beach = 0;
    for (const seed of SEEDS) {
      const ax = siteFor(seed).anchor.x;
      for (let z = COVE_Z - 120; z <= COVE_Z + 120; z += 6) {
        for (let x = ax - 140; x <= ax + 10; x += 2) {
          const h = elevationAt(seed, x, z);
          if (h <= 0.1 || h >= VERGE_H_LO) continue;
          beach++;
          expect(shoreStrip(seed, x, z), `seed ${seed} at ${x},${z}`).toBe(townStripWeight(seed, x, z));
        }
      }
    }
    expect(beach).toBeGreaterThan(20);
  });

  it("(d) under the sea nothing is lifted, whatever the town's cover says", () => {
    for (const seed of SEEDS) {
      const ax = siteFor(seed).anchor.x;
      for (let z = -200; z <= 200; z += 20) {
        for (let x = ax - 220; x <= ax - 120; x += 10) {
          const h = elevationAt(seed, x, z);
          if (h > 0.1) continue;
          expect(shoreStrip(seed, x, z), `seed ${seed} at ${x},${z} h ${h}`).toBe(townStripWeight(seed, x, z));
        }
      }
    }
  });
});

describe("grass stays off the roadway, the ballast and the paved ground", () => {
  it("has no ground cover on the highway's roadway or the railroad's ballast, in the town and out", () => {
    for (const seed of SEEDS) {
      for (const z of [...OUTSIDE, -300, 150, 330]) {
        const cx = roadCenterX(seed, z);
        for (const u of [-3, -1, 0, 1, 3]) {
          expect(groundCover(seed, cx + u, z).grass, `road seed ${seed} z ${z} u ${u}`).toBe(0);
        }
        for (const o of [-2, 0, 2]) {
          const x = cx - RAIL_OFFSET + o;
          const m = mask(seed, x, z);
          expect(m.clutter, `ballast seed ${seed} z ${z} o ${o}`).toBe(0);
          expect(m.meadow, `ballast seed ${seed} z ${z} o ${o}`).toBe(0);
          expect(groundCover(seed, x, z).grass).toBe(0);
        }
      }
    }
  });

  it("leaves the town's own mask alone where it shuts the ground cover (paved blocks, streets, buildings): the verge adds nothing there", () => {
    let shut = 0;
    for (const seed of SEEDS) {
      const ax = siteFor(seed).anchor.x;
      for (let z = -440; z <= 440; z += 7) {
        for (let x = ax - 120; x <= ax + 120; x += 7) {
          const town = townFeatureMask(seed, x, z);
          if (town.clutter !== 0) continue;
          shut++;
          const m = mask(seed, x, z);
          expect(m.clutter, `seed ${seed} at ${x},${z}`).toBe(0);
          // Whatever meadow the town's own mask carries there it keeps (it multiplies a shut cover): the verge adds none.
          expect(m.meadow, `seed ${seed} at ${x},${z}`).toBeLessThanOrEqual(town.meadow);
        }
      }
    }
    expect(shut).toBeGreaterThan(1000);
  });

  it("changes nothing on a yard, a block or a street that the town's own strip already holds", () => {
    let own = 0;
    for (const seed of SEEDS) {
      const ax = siteFor(seed).anchor.x;
      for (let z = -440; z <= 440; z += 9) {
        for (let x = ax - 120; x <= ax + 120; x += 9) {
          if (townStripWeight(seed, x, z) !== 1) continue;
          own++;
          const m = mask(seed, x, z);
          const t = townFeatureMask(seed, x, z);
          const x0 = railCenterX(seed, z);
          // Not within the railroad's own say, which this test does not measure.
          if (Math.abs(x - x0) < 14) continue;
          expect(m.clutter, `seed ${seed} at ${x},${z}`).toBe(t.clutter);
          expect(m.meadow).toBe(t.meadow);
          expect(m.tree).toBe(t.tree);
        }
      }
    }
    expect(own).toBeGreaterThan(1000);
  });
});
