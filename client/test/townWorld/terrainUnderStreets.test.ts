/**
 * The terrain as the engine draws it, against the surfaces the town lays over it. The engine's clipmap (`clipTerrain.ts` builds
 * its real rings, with their spacing, their blend toward the coarser ring and their upper envelope) is a mesh of 1 m (2 m on the
 * low tier) near the camera, so a step of 15 cm over a few metres is not in it: the town cuts the terrain out of sight under its
 * streets and lays flat surfaces a depth step ahead (`streetField.ts`). This measures what the cut leaves, for a camera on the
 * start and one on a street of the low flats, on both tiers, over every flat surface of the town (streets, sidewalks, junctions,
 * curbs, paint, paved blocks):
 *
 * - where the terrain's mesh stands above a surface by more than the cut leaves (the surface's own lift is 1 to 2 cm), and
 * - how much of the terrain under them paints as beach sand (the engine paints by height, and the town's flats stand at 2 to 3 m).
 *
 * The cut is measured in the rings of 2 m or finer (the camera's 64 m on the medium tier, 128 m on the low). Past them the mesh is
 * too coarse to hold a cut of any depth, and the surfaces are held by the depth step, which grows with the square of the distance:
 * over every ring (and the lip of a drop to the sea) it is the depth step that is asserted.
 */
import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { townStart } from "../../src/sim/town/start.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { drawnTerrain, type QualityTier } from "./clipTerrain.js";
import { WORLD_SEEDS } from "./world.js";

/** A seed the game's own token "sorrow" hashes to, whose low flats the owner's pictures are of. */
const SORROW = -2060655827;
const SEEDS: readonly number[] = [SORROW, WORLD_SEEDS[0] as number, WORLD_SEEDS[1] as number];

type Measure = { samples: number; sand: number; under2: number; under5: number; lips: number; all: number; wins: number; worstWin: number };

/**
 * What the engine's depth offset holds: the flat layer is drawn `FLAT_AHEAD_UNITS` (120) of a 24-bit depth buffer's steps ahead, which at
 * distance d from a 0.05 m near plane is 120 / 2^24 * d^2 / 0.05 = 1.43e-4 * d^2 metres (1.4 cm at 10 m, 36 cm at 50 m). The terrain
 * shows over a surface where its mesh stands over it by more than that.
 */
const depthStep = (d: number): number => 1.43e-4 * d * d;

/**
 * Whether the ground falls away steeply (a gradient over 0.4) within 4 m of a point: a street's end at the water's edge, where the
 * made ground drops to the sea. The engine draws the terrain as an upper envelope of its field, lifted over every crest between its
 * vertices, so a 2 m mesh stands a metre over the lip of such a drop and no cut can hold it down (the engine's, noted in
 * ARCHITECTURE.md); those samples are counted apart.
 */
function nearDrop(seed: number, x: number, z: number): boolean {
  for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
    const s = elevationSampleAt(seed, x + dx, z + dz);
    if (Math.hypot(s.dx, s.dz) > 0.4) return true;
  }
  return false;
}

function measure(seed: number, cam: { x: number; z: number }, tier: QualityTier): Measure {
  const g = townGround(seed);
  const batches = finish(townGeometry(g, "full", cam));
  const T = drawnTerrain(seed, cam.x, cam.z, tier);
  const m: Measure = { samples: 0, sand: 0, under2: 0, under5: 0, lips: 0, all: 0, wins: 0, worstWin: 0 };
  for (const b of batches) {
    if (b.layer !== "flat") continue;
    const p = b.arrays.positions;
    const ix = b.arrays.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const i0 = (ix[t] as number) * 3;
      const i1 = (ix[t + 1] as number) * 3;
      const i2 = (ix[t + 2] as number) * 3;
      for (const [a, c] of [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1]] as const) {
        const k = 1 - a - c;
        const x = a * (p[i0] as number) + c * (p[i1] as number) + k * (p[i2] as number);
        const y = a * (p[i0 + 1] as number) + c * (p[i1 + 1] as number) + k * (p[i2 + 1] as number);
        const z = a * (p[i0 + 2] as number) + c * (p[i1 + 2] as number) + k * (p[i2 + 2] as number);
        const sp = T.spacingAt(x, z);
        if (Number.isNaN(sp)) continue;
        const gap = y - T.heightAt(x, z);
        // Every ring in view, a drop to the sea included (nothing excused): where does the terrain win the depth test?
        m.all++;
        const d = Math.max(1, Math.hypot(x - cam.x, z - cam.z));
        if (-gap > depthStep(d)) {
          m.wins++;
          m.worstWin = Math.max(m.worstWin, -gap - depthStep(d));
        }
        if (!(sp <= 2)) continue;
        if (gap < -0.02 && nearDrop(seed, x, z)) {
          m.lips++;
          continue;
        }
        m.samples++;
        if (gap < -0.02) m.under2++;
        if (gap < -0.05) m.under5++;
        if (T.sandAt(x, z) > 0.2) m.sand++;
      }
    }
  }
  return m;
}

/** The camera on the start, and on the middle of the lowest street (the flats the sea is nearest). */
function cameras(seed: number): { x: number; z: number }[] {
  const g = townGround(seed);
  const start = townStart(seed);
  let low = Infinity;
  let at = { x: start.x, z: start.z };
  for (const s of g.plan.streets) {
    if (s.kind !== "street" && s.kind !== "avenue" && s.kind !== "main") continue;
    const x = (s.a.x + s.b.x) / 2 + g.anchor.x;
    const z = (s.a.z + s.b.z) / 2 + g.anchor.z;
    const h = g.heightAt(x, z);
    if (h < low) {
      low = h;
      at = { x, z };
    }
  }
  return [{ x: start.x, z: start.z }, at];
}

describe("the terrain the engine draws under the town's flat surfaces", () => {
  for (const seed of SEEDS) {
    for (const tier of ["medium", "low"] as const) {
      if (tier === "low" && seed !== SORROW) continue;
      it(`seed ${seed}, ${tier} tier: it paints as soil, not sand, and stands under them`, () => {
        for (const cam of cameras(seed)) {
          const m = measure(seed, cam, tier);
          const share = (n: number): number => n / Math.max(1, m.samples);
          console.log(`seed ${seed} ${tier} cam ${cam.x.toFixed(0)},${cam.z.toFixed(0)}: ${m.samples} samples, sand ${(share(m.sand) * 100).toFixed(2)}%, mesh over a surface by 2 cm ${(share(m.under2) * 100).toFixed(2)}%, by 5 cm ${(share(m.under5) * 100).toFixed(2)}% (${m.lips} more at a drop to the sea); over every ring, the terrain beats the depth step at ${m.wins} of ${m.all} samples (by ${m.worstWin.toFixed(3)} m at most)`);
          expect(m.samples).toBeGreaterThan(20_000);
          // The terrain under and beside every street, sidewalk, junction and paved block paints as soil.
          expect(share(m.sand), `sand under the town's flats (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(0.05);
          // The mesh is under them but for a sliver: at most 1.5 percent of the samples stand 2 cm over and 0.6 percent 5 cm over (3.5 and 2 percent on the low tier, whose rings are twice as coarse).
          // Where the terrain beats the engine's depth offset it shows over a street: at the lip of a drop to the sea too, and in the coarse rings.
          expect(m.wins / Math.max(1, m.all), `terrain over a surface, past the depth step (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(1e-4);
          expect(share(m.under2), `mesh 2 cm over a surface (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(tier === "low" ? 0.035 : 0.015);
          expect(share(m.under5), `mesh 5 cm over a surface (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(tier === "low" ? 0.02 : 0.006);
        }
      }, 600_000);
    }
  }
});
