import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVE_Z, SEA_LEVEL, coastGround, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { SITE_INLAND, SITE_SAMPLES, SITE_STEP, readSite, siteFor, townSeedOf } from "../../src/sim/town/siteFor.js";
import { sampleZ } from "../../src/sim/town/site.js";

import { TEN_SEEDS } from "./seeds.js";
const FIVE_SEEDS = TEN_SEEDS.slice(0, 5);

describe("the town's site, read off the coast", () => {
  it("is anchored on the highway's centre line at the cove, and sampled 512 m either way every 16 m", () => {
    for (const seed of FIVE_SEEDS) {
      const site = siteFor(seed);
      expect(site.anchor).toEqual({ x: roadCenterX(seed, COVE_Z), z: COVE_Z });
      expect([site.step, site.z0, site.inland, site.shoreX.length, site.roadX.length]).toEqual([16, -512, 160, 65, 65]);
      expect([SITE_STEP, SITE_SAMPLES, SITE_INLAND]).toEqual([16, 65, 160]);
      expect(sampleZ(site, 32)).toBe(0);
      // The anchor's own sample is the anchor: the highway at 0.
      expect(site.roadX[32]).toBe(0);
      expect(site.shoreX[32]).toBeLessThan(0);
      site.roadX.forEach((x, i) => expect(x + site.anchor.x).toBe(roadCenterX(seed, site.anchor.z + sampleZ(site, i))));
    }
  });

  it("has the town's own seed: the world's mixed with the constant that says town 1", () => {
    expect(siteFor(20261121).seed).toBe(townSeedOf(20261121));
    expect(townSeedOf(1)).not.toBe(townSeedOf(2));
    expect(townSeedOf(20261121)).not.toBe(20261121);
  });

  // The brief's "every shoreX is negative" holds at the anchor but not along the site: the highway wanders
  // up to 150 m east and west of the anchor's line in the frame (it follows the coast), and the shore with it,
  // so a shore east of the anchor's own x is no fault. What always holds is that the shore is west of the
  // highway at its own z.
  it("puts the shore west of the highway, with the sea just seaward of it and the land just landward", () => {
    for (const seed of FIVE_SEEDS) {
      const site = siteFor(seed);
      for (let i = 0; i < site.shoreX.length; i++) {
        const shore = site.shoreX[i] as number;
        const z = site.anchor.z + sampleZ(site, i);
        expect(shore, `seed ${seed} sample ${i}`).toBeLessThan(site.roadX[i] as number);
        const x = site.anchor.x + shore;
        expect(coastGround(seed, x - 0.25, z).ground.h, `seed ${seed} sample ${i} seaward`).toBeLessThan(SEA_LEVEL);
        expect(coastGround(seed, x + 0.25, z).ground.h, `seed ${seed} sample ${i} landward`).toBeGreaterThan(SEA_LEVEL);
      }
    }
  });

  it("is the same for the same seed, and is read, not remembered: a fresh read gives the same bits", () => {
    for (const seed of FIVE_SEEDS) {
      expect(siteFor(seed)).toBe(siteFor(seed));
      expect(readSite(seed)).toEqual(siteFor(seed));
    }
  });

  it("gives ten seeds ten different shorelines", () => {
    const lines = new Set(TEN_SEEDS.map((seed) => siteFor(seed).shoreX.join(",")));
    expect(lines.size).toBe(10);
    const roads = new Set(TEN_SEEDS.map((seed) => siteFor(seed).roadX.join(",")));
    expect(roads.size).toBe(10);
  });

  it("measures the room the town has: the highway's distance to the shore, at the anchor and over the whole site", () => {
    const rows: string[] = [];
    for (const seed of TEN_SEEDS) {
      const site = siteFor(seed);
      const gap = site.shoreX.map((s, i) => (site.roadX[i] as number) - s);
      const at = gap[32] as number;
      const least = Math.min(...gap);
      const greatest = Math.max(...gap);
      rows.push(`seed ${String(seed).padStart(9)}: highway to shore ${at.toFixed(1)} m at the anchor, least ${least.toFixed(1)} m, greatest ${greatest.toFixed(1)} m`);
      // The town must fit: there is always room for a street between the highway's corridor and the sea.
      expect(least).toBeGreaterThan(40);
      expect(greatest).toBeLessThan(SITE_INLAND * 2);
    }
    process.stderr.write(`${rows.join("\n")}\n`);
  });
});
