import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { generateChunk } from "@csarkosh/engine/sim/chunk";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { CLUTTER_BUSH, CLUTTER_GRASS, CLUTTER_ROCK, CLUTTER_SHRUB, clutterInRect } from "@csarkosh/engine/sim/clutter";
import { CLIFF_MATERIAL } from "@csarkosh/engine/sim/passes/cliffs";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { townCover, townFeatureMask, townKeepD } from "../../src/sim/town/clearing.js";
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { TOWN_INLAND, TOWN_Z_HALF, inFootprint } from "../../src/sim/town/ground.js";
import { siteFor } from "../../src/sim/town/siteFor.js";

const SEEDS = [20261121, 1, 424242];

/** Whether the box (any of it) lies on the made ground proper. */
function onFootprint(seed: number, box: { min: { x: number; z: number }; max: { x: number; z: number } }): boolean {
  for (const x of [box.min.x, (box.min.x + box.max.x) / 2, box.max.x]) {
    for (const z of [box.min.z, (box.min.z + box.max.z) / 2, box.max.z]) if (inFootprint(seed, x, z)) return true;
  }
  return false;
}

describe("the made ground is clear of forest", () => {
  it("keeps every trunk, rock and cliff box off the footprint, with boxes standing outside it", () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      // Every chunk over the footprint's bounding box and a margin round it.
      let minX = Infinity;
      for (let i = 0; i < site.shoreX.length; i++) minX = Math.min(minX, site.anchor.x + (site.shoreX[i] as number));
      let maxX = -Infinity;
      for (let z = -TOWN_Z_HALF; z <= TOWN_Z_HALF; z += 16) maxX = Math.max(maxX, roadCenterX(seed, COVE_Z + z) + TOWN_INLAND);
      const margin = 96;
      const cx0 = Math.floor((minX - margin) / CHUNK_SIZE);
      const cx1 = Math.floor((maxX + margin) / CHUNK_SIZE);
      const cz0 = Math.floor((COVE_Z - TOWN_Z_HALF - margin) / CHUNK_SIZE);
      const cz1 = Math.floor((COVE_Z + TOWN_Z_HALF + margin) / CHUNK_SIZE);
      const counts = { trunk: 0, rock: 0, cliff: 0 };
      const inside = { trunk: 0, rock: 0, cliff: 0 };
      let chunks = 0;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          chunks++;
          for (const prop of generateChunk(seed, cx, cz).props) {
            const kind = prop.material === "trunk" ? "trunk" : prop.material === "rock" ? "rock" : prop.material === CLIFF_MATERIAL ? "cliff" : null;
            if (kind === null) continue;
            counts[kind]++;
            if (onFootprint(seed, prop.box)) inside[kind]++;
          }
        }
      }
      rows.push(`seed ${seed}: ${chunks} chunks, boxes (trunk/boulder/cliff) ${counts.trunk}/${counts.rock}/${counts.cliff}, inside the footprint ${inside.trunk}/${inside.rock}/${inside.cliff}`);
      expect(inside, `seed ${seed}`).toEqual({ trunk: 0, rock: 0, cliff: 0 });
      // Boxes do stand beyond it: the forest is there.
      expect(counts.trunk, `seed ${seed} trunks outside`).toBeGreaterThan(200);
    }
    process.stderr.write(`${rows.join("\n")}\n`);
  });

  it("counts what it means to: the same census finds cliff and boulder boxes where the coast has them, up the coast past the town's reach", () => {
    const seed = 20261121;
    const road = roadCenterX(seed, 1800);
    let cliffs = 0;
    let rocks = 0;
    for (let cx = Math.floor((road - 100) / CHUNK_SIZE); cx <= Math.floor((road + 700) / CHUNK_SIZE); cx++) {
      for (let cz = Math.floor(1700 / CHUNK_SIZE); cz <= Math.floor(2100 / CHUNK_SIZE); cz++) {
        for (const prop of generateChunk(seed, cx, cz).props) {
          if (prop.material === CLIFF_MATERIAL) cliffs++;
          if (prop.material === "rock") rocks++;
        }
      }
    }
    process.stderr.write(`control census past the town: ${cliffs} cliff boxes, ${rocks} boulder boxes\n`);
    expect(cliffs + rocks).toBeGreaterThan(0);
  });

  it("keeps the ground cover and the scrub off the footprint too, and reports the loose rocks", () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const found = { grass: 0, bush: 0, shrub: 0, rock: 0 };
      for (let z = -TOWN_Z_HALF; z < TOWN_Z_HALF; z += 96) {
        const road = roadCenterX(seed, COVE_Z + z);
        const lo = road - 60;
        const hi = road + TOWN_INLAND;
        for (const [cls, key] of [[CLUTTER_GRASS, "grass"], [CLUTTER_BUSH, "bush"], [CLUTTER_SHRUB, "shrub"], [CLUTTER_ROCK, "rock"]] as const) {
          found[key] += clutterInRect(seed, cls, lo, z, hi, z + 96).filter((c) => inFootprint(seed, c.x, c.z)).length;
        }
      }
      rows.push(`seed ${seed}: clutter on the footprint: grass ${found.grass}, bushes ${found.bush}, shrubs ${found.shrub}, loose rocks ${found.rock}`);
      expect(found.grass + found.bush + found.shrub).toBe(0);
    }
    process.stderr.write(`${rows.join("\n")}\n`);
  });

  it("holds the forest off by the mask and gives it back over the blend", () => {
    for (const seed of SEEDS) {
      const road = roadCenterX(seed, COVE_Z);
      expect(townFeatureMask(seed, road + 100, COVE_Z)).toEqual({ tree: 0, clutter: 0, meadow: 0, bare: 0 });
      expect(townFeatureMask(seed, road + TOWN_INLAND + 80, COVE_Z)).toEqual({ tree: 1, clutter: 1, meadow: 0, bare: 0 });
      expect(townFeatureMask(seed, road + 100, TOWN_Z_HALF + 80)).toEqual({ tree: 1, clutter: 1, meadow: 0, bare: 0 });
      let last = 0;
      for (let d = 0; d <= 40; d += 2) {
        const tree = townFeatureMask(seed, road + TOWN_INLAND + d, COVE_Z).tree;
        expect(tree).toBeGreaterThanOrEqual(last);
        last = tree;
      }
      expect(townCover(seed, road + 100, COVE_Z)).toBe(1);
    }
  });

  it("keeps the cliff bands off the footprint and returns them over the blend, with an exact slope", () => {
    expect(townKeepD(50, 0.1, 0).v).toBe(0);
    expect(townKeepD(TOWN_INLAND + 80, 0, 0).v).toBe(1);
    expect(townKeepD(50, 0, TOWN_Z_HALF + 80).v).toBe(1);
    const H = 0.0005;
    for (const [u, z] of [[TOWN_INLAND + 10, 0], [50, TOWN_Z_HALF + 15], [TOWN_INLAND + 30, TOWN_Z_HALF + 30]] as const) {
      const uDz = 0.2;
      const k = townKeepD(u, uDz, z);
      // The road's frame: u moves with x, and with z by uDz.
      const fdx = (townKeepD(u + H, uDz, z).v - townKeepD(u - H, uDz, z).v) / (2 * H);
      const fdz = (townKeepD(u + uDz * H, uDz, z + H).v - townKeepD(u - uDz * H, uDz, z - H).v) / (2 * H);
      expect(k.dx).toBeCloseTo(fdx, 6);
      expect(k.dz).toBeCloseTo(fdz, 6);
    }
  });
});
