import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COMFORT, checkPath, samplePath } from "@csarkosh/engine/game/film/cameraPath";
import { filmGroundAt } from "@csarkosh/engine/game/film/filmMode";
import { SEA_LEVEL } from "@csarkosh/engine/sim/olympic";
import { elevationAt } from "@csarkosh/engine/sim/terrain";
import { TITLE_SEED, downtownCentre, titlePath } from "../../src/film/titlePath.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { planFor } from "../../src/sim/town/planFor.js";

const SEEDS = [TITLE_SEED, 7, 20261121];

/** Where a world point lands across the frame, -1 to 1 (0 at the middle), by a pinhole with a vertical `fov` and a 2:1 frame. */
function screenX(v: { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number }, p: { x: number; y: number; z: number }): number {
  const dx = p.x - v.x, dy = p.y - v.y, dz = p.z - v.z;
  const fx = Math.sin(v.yaw) * Math.cos(v.pitch), fz = Math.cos(v.yaw) * Math.cos(v.pitch);
  const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  const depth = dx * fx + dz * fz + dy * -Math.sin(v.pitch);
  const right = dx * rx + dz * rz;
  return right / depth / (Math.tan((v.fov ?? 0.9) / 2) * 2);
}

describe("the title path", () => {
  for (const seed of SEEDS) {
    it(`is comfortable and starts over water, seed ${seed}`, () => {
      const path = titlePath(seed);
      expect(checkPath(path, 24, COMFORT, filmGroundAt(seed))).toEqual([]);
      const k = path.keys[0]!;
      expect(elevationAt(seed, k.at[0], k.at[2])).toBeLessThan(SEA_LEVEL);
    });
    it(`keeps the downtown in the middle 40 % of the frame, seed ${seed}`, () => {
      const path = titlePath(seed);
      const c = downtownCentre(seed);
      for (const t of [0, 32]) {
        const x = screenX(samplePath(path, t), { x: c.x, y: 5, z: c.z });
        expect(Math.abs(x)).toBeLessThanOrEqual(0.2);
      }
    });
  }
  it("sees the town's made ground", () => {
    const { anchor } = siteFor(TITLE_SEED);
    const q = planFor(TITLE_SEED).quay;
    const w = q.wet[0]!;
    const wx = (w.a.x + w.b.x) / 2 + anchor.x, wz = (w.a.z + w.b.z) / 2 + anchor.z;
    // The quay's own ground stands well above the sea: the town's made ground is in elevationAt (the coast there is a shelf of a few metres).
    expect(elevationAt(TITLE_SEED, wx - q.seaward.x * 10, wz - q.seaward.z * 10)).toBeGreaterThan(SEA_LEVEL + 1);
  });
});
