/**
 * The terrain as the engine draws it, against the highway's mesh outside the town (`highwayCells.ts`). The engine's clipmap (`clipTerrain.ts` builds its real
 * rings: spacing, blend toward the coarser ring, upper envelope) is a mesh the cells' surface (the ground's height plus the roadway's lift, a depth step
 * ahead) must stand over. Nothing cuts the terrain under the highway's bed, and nothing can: the road's corridor sets the bed to the grade line whatever the place
 * laid under it (`corridorInto`, `|u| <= ROAD_BED_HALF`), so this measures what the uncut terrain leaves, at the stretches of the road with the steepest grade and the
 * steepest side slope, well outside the town and the plan's record, with the camera standing on the road.
 *
 * Measured: the terrain never stands over the mesh by more than the depth step on the full tiers (the closest it comes is a centimetre under it, at the bed's edge),
 * and on the low tier, whose rings are 2 m, it stands up to about a centimetre over it at the bed's edge within 10 m.
 */
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { roadCenterX, roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { drawnTerrain, type QualityTier } from "./clipTerrain.js";

/** The flat layer's depth lead at distance d (see `terrainUnderStreets.test.ts`), metres. */
const depthStep = (d: number): number => 1.43e-4 * d * d;
/** The roadway's lift, and the shoulder's (`highwayLook.ts`: ROADWAY_LIFT, and 4 mm under it). */
const LIFT = 0.012;
const SHOULDER_LIFT = 0.008;

const SEEDS: readonly number[] = [seedFromToken("wall-shade"), 20261121];

/** The stretches well outside the town (z beyond 900 m of the anchor either way, and past the plan's record) with the steepest grade and the steepest side slope. */
function worstStretches(seed: number): { name: string; z: number }[] {
  let grade = { z: 0, v: 0 };
  let side = { z: 0, v: 0 };
  for (let z = -4000; z < 4000; z += 8) {
    if (Math.abs(z) < 1100) continue;
    const c = roadCenterX(seed, z);
    const g = Math.abs(roadGradeAt(seed, z).dz);
    if (g > grade.v) grade = { z, v: g };
    const h0 = elevationSampleAt(seed, c, z).h;
    const s = Math.max(Math.abs(elevationSampleAt(seed, c + 9, z).h - h0), Math.abs(elevationSampleAt(seed, c - 9, z).h - h0)) / 3.5;
    if (s > side.v) side = { z, v: s };
  }
  return [{ name: "steepest grade", z: grade.z }, { name: "steepest side slope", z: side.z }];
}

/** How far the drawn terrain stands over the mesh's surface (the ground plus its lift and the depth step), the most over the bed within 130 m of a camera on the road at z: negative where it stands under. */
function overshoot(seed: number, z: number, tier: QualityTier): { over: number; at: string } {
  const c = roadCenterX(seed, z);
  const T = drawnTerrain(seed, c, z, tier);
  let worst = -Infinity;
  let at = "";
  for (let dz = -130; dz <= 130; dz += 2) {
    const zz = z + dz;
    const cx = roadCenterX(seed, zz);
    for (const u of [-ROAD_BED_HALF, -4, -2, 0, 2, 4, ROAD_BED_HALF]) {
      const x = cx + u;
      const drawn = T.heightAt(x, zz);
      if (Number.isNaN(drawn)) continue;
      const d = Math.hypot(x - c, dz);
      // The asphalt (|u| under the ragged edge, 3.3 m or more) at the roadway's lift, the gravel beyond it at the shoulder's.
      const lift = Math.abs(u) > 3.3 ? SHOULDER_LIFT : LIFT;
      const over = drawn - (elevationSampleAt(seed, x, zz).h + lift + depthStep(d));
      if (over > worst) {
        worst = over;
        at = `dz ${dz}, u ${u}, ${d.toFixed(0)} m from the camera, rings of ${T.spacingAt(x, zz)} m`;
      }
    }
  }
  return { over: worst, at };
}

describe("the terrain the engine draws under the highway outside the town", () => {
  for (const seed of SEEDS) {
    for (const tier of ["medium", "low"] as const) {
      it(`seed ${seed}, ${tier} tier: does not stand over the mesh at the steepest grade and side slope`, () => {
        for (const { name, z } of worstStretches(seed)) {
          const { over, at } = overshoot(seed, z, tier);
          console.log(`seed ${seed} ${tier} ${name} at z ${z} (x ${roadCenterX(seed, z).toFixed(1)}): the terrain stands ${(over * 100).toFixed(2)} cm over the mesh at worst (${at})`);
          // The full tiers: under it everywhere. The low tier's 2 m rings lift the bed's edge by a centimetre or so more than the shoulder's 8 mm and the depth step hold.
          expect(over, `seed ${seed} ${tier} ${name}`).toBeLessThan(tier === "low" ? 0.015 : 0);
        }
      }, 300_000);
    }
  }
});
