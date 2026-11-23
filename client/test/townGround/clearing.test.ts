import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { generateChunk } from "@csarkosh/engine/sim/chunk";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import { CLUTTER_BUSH, CLUTTER_DRIFTWOOD, CLUTTER_GRASS, CLUTTER_ROCK, CLUTTER_SHRUB, clutterInRect } from "@csarkosh/engine/sim/clutter";
import { CLIFF_MATERIAL } from "@csarkosh/engine/sim/passes/cliffs";
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { shoreStrip } from "@csarkosh/engine/sim/terrain";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { CLUTTER_BUILDING_CLEAR, CLUTTER_STREET_CLEAR, TREE_BUILDING_CLEAR, TREE_STREET_CLEAR, YARD_LIFT, YARD_TREE, clearAt, isPaved, townCover, townFeatureMask, townKeepD, townYardWeight } from "../../src/sim/town/clearing.js";
import { TOWN_INLAND, TOWN_Z_HALF } from "../../src/sim/town/ground.js";
import { contains, segDist } from "../../src/sim/town/geom.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import type { TownPlan } from "../../src/sim/town/types.js";

const SEEDS = [20261121, 1, 424242];
/** A seed whose town leaves a few hectares of the old rectangle unbuilt. */
const CORNER_SEED = 777;

/** The distance from a point of the plan's frame to a building's footprint (0 inside it). */
function toFootprint(plan: TownPlan, id: number, x: number, z: number): number {
  const b = plan.buildings[id] as (typeof plan.buildings)[number];
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const lu = Math.max(0, Math.abs((x - b.centre.x) * u.x + (z - b.centre.z) * u.z) - b.halfAlong);
  const lv = Math.max(0, Math.abs((x - b.centre.x) * v.x + (z - b.centre.z) * v.z) - b.halfAcross);
  return Math.sqrt(lu * lu + lv * lv);
}

/** The distance from a point of the plan's frame to the nearest street's right of way (0 on it), the highway left to the engine. */
function toStreet(plan: TownPlan, x: number, z: number): number {
  let d = Infinity;
  for (const st of plan.streets) {
    if (st.kind === "highway" || st.kind === "wharf") continue;
    d = Math.min(d, Math.max(0, segDist({ x, z }, st.a, st.b) - st.width / 2));
  }
  return d;
}

/** The distance from a point to the nearest street's pavement: beyond the roadway of a street of the grid, or the right of way of any other kind but an alley (whose wheel tracks leave the grass between them, and whose ground cover is for the mask's own test). The verge and the yard behind it grow grass now (`gridFactor`). */
function toPavement(plan: TownPlan, x: number, z: number): number {
  let d = Infinity;
  for (const st of plan.streets) {
    if (st.kind === "highway" || st.kind === "wharf" || st.kind === "alley") continue;
    const grid = st.kind === "street" || st.kind === "main" || st.kind === "avenue";
    d = Math.min(d, Math.max(0, segDist({ x, z }, st.a, st.b) - (grid ? st.roadway / 2 : st.width / 2)));
  }
  return d;
}

/** The distance from a point of the plan's frame to the nearest block. */
function distanceToBlocks(plan: TownPlan, p: { x: number; z: number }): number {
  let d = Infinity;
  for (const b of plan.blocks) for (let k = 0; k < b.polygon.length; k++) d = Math.min(d, segDist(p, b.polygon[k] as { x: number; z: number }, b.polygon[(k + 1) % b.polygon.length] as { x: number; z: number }));
  return d;
}

/** Every tree trunk of every chunk of the town and a margin round it, in the plan's frame. */
function trunksOf(seed: number): { x: number; z: number }[] {
  const site = siteFor(seed);
  const plan = planFor(seed);
  const margin = 96;
  const cx0 = Math.floor((site.anchor.x + plan.bounds.x0 - margin) / CHUNK_SIZE);
  const cx1 = Math.floor((site.anchor.x + plan.bounds.x1 + 330 + margin) / CHUNK_SIZE);
  const cz0 = Math.floor((site.anchor.z + plan.bounds.z0 - margin) / CHUNK_SIZE);
  const cz1 = Math.floor((site.anchor.z + plan.bounds.z1 + margin) / CHUNK_SIZE);
  const out: { x: number; z: number }[] = [];
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      for (const prop of generateChunk(seed, cx, cz).props) {
        if (prop.material !== "trunk") continue;
        out.push({ x: (prop.box.min.x + prop.box.max.x) / 2 - site.anchor.x, z: (prop.box.min.z + prop.box.max.z) / 2 - site.anchor.z });
      }
    }
  }
  return out;
}

describe("the forest by the lot", () => {
  it("keeps every trunk clear of every building and every street, in every chunk of the town, and stands trunks in yards and vacant lots and in the old rectangle's empty corners", () => {
    const rows: string[] = [];
    for (const seed of [...SEEDS, CORNER_SEED]) {
      const plan = planFor(seed);
      const trunks = trunksOf(seed);
      const lotHasBuilding = new Set<number>();
      for (const b of plan.buildings) if (b.lot !== -1) lotHasBuilding.add(b.lot);
      let nearBuilding = 0;
      let onStreet = 0;
      let inYards = 0;
      let inVacant = 0;
      let inPaved = 0;
      let inTown = 0;
      let corners = 0;
      let closest = Infinity;
      for (const t of trunks) {
        for (const b of plan.buildings) {
          if (b.lot === -1) continue;
          const d = toFootprint(plan, b.id, t.x, t.z);
          closest = Math.min(closest, d);
          if (d < TREE_BUILDING_CLEAR) nearBuilding++;
        }
        if (toStreet(plan, t.x, t.z) < TREE_STREET_CLEAR) onStreet++;
        const block = plan.blocks.find((bl) => contains(bl.polygon, t, 0));
        if (block !== undefined) {
          inTown++;
          if (isPaved(block.district)) inPaved++;
          else inYards++;
          const lot = plan.lots.find((l) => l.block === block.id && contains(l.polygon, t, 0));
          if (lot !== undefined && !lotHasBuilding.has(lot.id)) inVacant++;
        }
        // The old rectangle's far corners: inland of the last block, within the footprint's reach.
        if (Math.abs(t.z) < TOWN_Z_HALF && t.x + siteFor(seed).anchor.x - roadCenterX(seed, t.z + COVE_Z) < TOWN_INLAND && t.x > 0 && distanceToBlocks(plan, t) > 30) corners++;
      }
      rows.push(`seed ${seed}: ${trunks.length} trunks, ${inTown} inside blocks (${inYards} in yards, ${inVacant} on vacant lots, ${inPaved} on paved blocks), ${corners} where the old rectangle's corners were; nearest a building ${closest.toFixed(1)} m`);
      process.stderr.write(`${rows[rows.length - 1]}\n`);
      expect(nearBuilding, `seed ${seed} trunks within ${TREE_BUILDING_CLEAR} m of a building`).toBe(0);
      expect(onStreet, `seed ${seed} trunks on a street`).toBe(0);
      expect(inPaved, `seed ${seed} trunks on paved blocks`).toBe(0);
      if (seed !== CORNER_SEED) expect(inYards, `seed ${seed} trunks in yards`).toBeGreaterThan(0);
      if (seed === CORNER_SEED) expect(corners, `seed ${seed} trunks in the unbuilt corners`).toBeGreaterThan(20);
    }
  });

  it("keeps the ground cover and the scrub off every street, off every building and a few metres round it, and off paved blocks; no loose rock or driftwood on the town", () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      const plan = planFor(seed);
      const found = { grass: 0, bush: 0, shrub: 0, rock: 0, wood: 0, onStreet: 0, nearBuilding: 0, paved: 0, yardGrass: 0 };
      for (const [cls, key] of [[CLUTTER_GRASS, "grass"], [CLUTTER_BUSH, "bush"], [CLUTTER_SHRUB, "shrub"], [CLUTTER_ROCK, "rock"], [CLUTTER_DRIFTWOOD, "wood"]] as const) {
        for (let z = plan.bounds.z0 + 60; z < plan.bounds.z1 - 60; z += 128) {
          const lo = site.anchor.x + plan.bounds.x0;
          const hi = site.anchor.x + plan.bounds.x1;
          for (const c of clutterInRect(seed, cls, lo, site.anchor.z + z, hi, site.anchor.z + z + 128)) {
            const p = { x: c.x - site.anchor.x, z: c.z - site.anchor.z };
            if (key === "rock" || key === "wood") {
              if (townCover(seed, c.x, c.z) >= 0.999) found[key]++;
              continue;
            }
            found[key]++;
            if (toPavement(plan, p.x, p.z) < CLUTTER_STREET_CLEAR) found.onStreet++;
            for (const b of plan.buildings) if (b.lot !== -1 && toFootprint(plan, b.id, p.x, p.z) < CLUTTER_BUILDING_CLEAR) found.nearBuilding++;
            const block = plan.blocks.find((bl) => contains(bl.polygon, p, 0));
            if (block !== undefined) {
              if (isPaved(block.district)) found.paved++;
              else if (key === "grass") found.yardGrass++;
            }
          }
        }
      }
      rows.push(`seed ${seed}: grass ${found.grass} (${found.yardGrass} in yards), bushes ${found.bush}, shrubs ${found.shrub}; on streets ${found.onStreet}, near buildings ${found.nearBuilding}, on paved blocks ${found.paved}; loose rock ${found.rock}, driftwood ${found.wood} on the town`);
      process.stderr.write(`${rows[rows.length - 1]}\n`);
      // The verge and the yard behind it grow grass now (and the mask keeps the roadway and its curb, to a metre, clear): an instance is placed by its cell's middle and may stand up to 2 m (a bush's cell) off it, so a few overhang a roadway's edge; fewer than 2 in a thousand.
      expect(found.onStreet / (found.grass + found.bush + found.shrub)).toBeLessThan(0.002);
      expect(found.nearBuilding).toBe(0);
      expect(found.paved).toBe(0);
      expect(found.rock).toBe(0);
      expect(found.wood).toBe(0);
      expect(found.yardGrass, `seed ${seed} grass in yards`).toBeGreaterThan(50);
    }
  });

  it("keeps cliff and boulder boxes off the old rectangle, with boxes standing outside it, and finds them up the coast where the coast has them", () => {
    for (const seed of SEEDS) {
      const site = siteFor(seed);
      let cliffsIn = 0;
      let outside = 0;
      for (let cx = Math.floor((site.anchor.x - 150) / CHUNK_SIZE); cx <= Math.floor((site.anchor.x + 700) / CHUNK_SIZE); cx++) {
        for (let cz = Math.floor((COVE_Z - TOWN_Z_HALF - 96) / CHUNK_SIZE); cz <= Math.floor((COVE_Z + TOWN_Z_HALF + 96) / CHUNK_SIZE); cz++) {
          for (const prop of generateChunk(seed, cx, cz).props) {
            const x = (prop.box.min.x + prop.box.max.x) / 2;
            const z = (prop.box.min.z + prop.box.max.z) / 2;
            const inside = Math.abs(z - COVE_Z) < TOWN_Z_HALF && x - roadCenterX(seed, z) < TOWN_INLAND && x - roadCenterX(seed, z) > -150;
            if (prop.material === CLIFF_MATERIAL && inside) cliffsIn++;
            if (prop.material === "trunk" && !inside) outside++;
          }
        }
      }
      expect(cliffsIn).toBe(0);
      expect(outside).toBeGreaterThan(200);
    }
    const seed = 20261121;
    const road = roadCenterX(seed, 1800);
    let found = 0;
    for (let cx = Math.floor((road - 100) / CHUNK_SIZE); cx <= Math.floor((road + 700) / CHUNK_SIZE); cx++) {
      for (let cz = Math.floor(1700 / CHUNK_SIZE); cz <= Math.floor(2100 / CHUNK_SIZE); cz++) {
        for (const prop of generateChunk(seed, cx, cz).props) if (prop.material === CLIFF_MATERIAL || prop.material === "rock") found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("says by the mask: shut on the street, on a paved block and beside a building, grass and a share of trees in a yard, the forest whole beyond the blocks", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      const at = (p: { x: number; z: number }) => townFeatureMask(seed, site.anchor.x + p.x, site.anchor.z + p.z);
      // The middle of a street: no tree, no cover.
      const street = plan.streets.find((s) => s.kind === "street") as (typeof plan.streets)[number];
      const mid = { x: (street.a.x + street.b.x) / 2, z: (street.a.z + street.b.z) / 2 };
      expect(at(mid).tree).toBe(0);
      expect(at(mid).clutter).toBe(0);
      expect(at(mid).loose).toBe(0);
      // A paved block's middle, and a yard block's.
      const centre = (b: (typeof plan.blocks)[number]) => b.polygon.reduce((acc, p) => ({ x: acc.x + p.x / b.polygon.length, z: acc.z + p.z / b.polygon.length }), { x: 0, z: 0 });
      const paved = plan.blocks.find((b) => isPaved(b.district)) as (typeof plan.blocks)[number];
      expect(at(centre(paved)).tree).toBe(0);
      expect(at(centre(paved)).clutter).toBe(0);
      const yard = plan.blocks.filter((b) => !isPaved(b.district));
      expect(yard.length).toBeGreaterThan(5);
      // Some yard has ground that takes grass and a share of trees, and a building's own wall is shut.
      let grassy = 0;
      let treeShare = 0;
      for (const b of yard) {
        for (const lot of plan.lots.filter((l) => l.block === b.id)) {
          const c = lot.polygon.reduce((acc, p) => ({ x: acc.x + p.x / lot.polygon.length, z: acc.z + p.z / lot.polygon.length }), { x: 0, z: 0 });
          const m = at(c);
          if (m.clutter > 0.9) grassy++;
          if (m.tree > 0 && m.tree <= YARD_TREE + 1e-9) treeShare++;
          expect(m.meadow).toBeGreaterThanOrEqual(0);
        }
      }
      expect(grassy).toBeGreaterThan(20);
      expect(treeShare).toBeGreaterThan(0);
      // Beyond the blocks, far inland: the whole forest, nothing loose held back.
      const far = { x: plan.bounds.x1 + 200, z: 0 };
      expect(at(far)).toEqual({ tree: 1, clutter: 1, meadow: 0, bare: 0 });
    }
  });

  it("lifts what the shore's rules read on a yard, and nowhere else", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      const yard = plan.blocks.find((b) => !isPaved(b.district)) as (typeof plan.blocks)[number];
      const c = yard.polygon.reduce((acc, p) => ({ x: acc.x + p.x / yard.polygon.length, z: acc.z + p.z / yard.polygon.length }), { x: 0, z: 0 });
      expect(townYardWeight(seed, site.anchor.x + c.x, site.anchor.z + c.z)).toBe(1);
      expect(shoreStrip(seed, site.anchor.x + c.x, site.anchor.z + c.z)).toBe(1);
      const paved = plan.blocks.find((b) => isPaved(b.district)) as (typeof plan.blocks)[number];
      const p = paved.polygon.reduce((acc, q) => ({ x: acc.x + q.x / paved.polygon.length, z: acc.z + q.z / paved.polygon.length }), { x: 0, z: 0 });
      expect(shoreStrip(seed, site.anchor.x + p.x, site.anchor.z + p.z)).toBe(0);
      expect(shoreStrip(seed, site.anchor.x + plan.bounds.x1 + 300, site.anchor.z)).toBe(0);
      expect(clearAt(plan, plan.bounds.x1 + 300, 0)).toEqual({ tree: 1, clutter: 1, yard: 0, meadow: 0 });
      expect(YARD_LIFT).toBeGreaterThan(8);
    }
  });

  it("keeps the cliff bands off where the town covers and returns them as the cover falls away, with an exact slope", () => {
    for (const seed of SEEDS) {
      const plan = planFor(seed);
      const site = siteFor(seed);
      const road = (z: number): number => roadCenterX(seed, z);
      const block = plan.blocks[0] as (typeof plan.blocks)[number];
      const c = block.polygon.reduce((acc, p) => ({ x: acc.x + p.x / block.polygon.length, z: acc.z + p.z / block.polygon.length }), { x: 0, z: 0 });
      const z = c.z + COVE_Z;
      const u = site.anchor.x + c.x - road(z);
      // On a block the bands are all gone; far from the town they are all kept.
      expect(townKeepD(u, 0.1, z, seed).v).toBe(0);
      expect(townKeepD(u + 3000, 0, z, seed).v).toBe(1);
      expect(townKeepD(0, 0, z + 5000, seed).v).toBe(1);
      // In between the keep is a smooth fall: its slope in x and in z (at a fixed x) is the derivative of its value. The road's frame: u = x - the road's x at z, so uDz = -(the road's slope).
      const H = 0.0005;
      const keepAtX = (x: number, zz: number): number => townKeepD(x - road(zz), -(road(zz + 0.01) - road(zz - 0.01)) / 0.02, zz, seed).v;
      let tested = 0;
      // Points ringed about the town's blocks, 30 to 140 m off their centres: some lie on the cover's fall.
      for (let k = 0; k < 600 && tested < 12; k++) {
        const bl = plan.blocks[(k * 7) % plan.blocks.length] as (typeof plan.blocks)[number];
        const cc = bl.polygon.reduce((acc, p) => ({ x: acc.x + p.x / bl.polygon.length, z: acc.z + p.z / bl.polygon.length }), { x: 0, z: 0 });
        const dir = k % 4;
        const reach = 30 + ((k * 13) % 110);
        const x = site.anchor.x + cc.x + (dir === 0 ? reach : dir === 1 ? -reach : 0);
        const zz = COVE_Z + cc.z + (dir === 2 ? reach : dir === 3 ? -reach : 0);
        const uu = x - road(zz);
        const uDz = -(road(zz + 0.01) - road(zz - 0.01)) / 0.02;
        const kp = townKeepD(uu, uDz, zz, seed);
        if (kp.v <= 0.02 || kp.v >= 0.98) continue;
        tested++;
        expect(kp.dx).toBeCloseTo((keepAtX(x + H, zz) - keepAtX(x - H, zz)) / (2 * H), 5);
        expect(kp.dz).toBeCloseTo((keepAtX(x, zz + H) - keepAtX(x, zz - H)) / (2 * H), 5);
      }
      expect(tested, `seed ${seed}: a point on the cover's fall`).toBeGreaterThan(3);
    }
  });
});
