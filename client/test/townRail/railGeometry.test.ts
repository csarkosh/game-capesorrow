import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { RAIL_GAUGE, railCenterX } from "../../src/sim/town/rail.js";
import { RAIL_CELL, RAIL_TOP, railCell, type RailCellArrays, type RailLod, type RailWorld } from "../../src/game/town/railGeometry.js";
import { railWorld } from "../../src/game/town/railWorld.js";
import type { MeshArrays } from "../../src/game/town/meshBuilder.js";

const SEEDS = [20261121, 1, 7];

function cellOf(w: RailWorld, k: number, lod: RailLod): RailCellArrays {
  return finish(railCell(w, k, lod));
}

function counts(a: RailCellArrays): { vertices: number; triangles: number } {
  let vertices = 0;
  let triangles = 0;
  for (const m of [a.flat, a.solid]) if (m !== null) {
    vertices += m.positions.length / 3;
    triangles += m.indices.length / 3;
  }
  return { vertices, triangles };
}

function finite(m: MeshArrays | null): boolean {
  if (m === null) return true;
  for (const v of m.positions) if (!Number.isFinite(v)) return false;
  for (const v of m.normals) if (!Number.isFinite(v)) return false;
  for (const i of m.indices) if (i >= m.positions.length / 3) return false;
  return true;
}

describe("the railroad's cells", () => {
  it("are the same arrays whenever and in whatever order they are made", () => {
    for (const seed of SEEDS) {
      const w = railWorld(seed);
      const a = cellOf(w, 3, 0);
      cellOf(w, 7, 1);
      const b = cellOf(w, 3, 0);
      expect(Array.from(b.solid?.positions ?? [])).toEqual(Array.from(a.solid?.positions ?? []));
      expect(Array.from(b.solid?.indices ?? [])).toEqual(Array.from(a.solid?.indices ?? []));
    }
  });

  it("hold finite, well-indexed geometry at every level, and get cheaper with distance", () => {
    for (const seed of SEEDS) {
      const w = railWorld(seed);
      for (const k of [-12, -3, 0, 5, 20]) {
        const c = [cellOf(w, k, 0), cellOf(w, k, 1), cellOf(w, k, 2)];
        for (const a of c) {
          expect(finite(a.solid) && finite(a.flat)).toBe(true);
          expect(a.solid).not.toBeNull();
        }
        expect(counts(c[1] as RailCellArrays).vertices).toBeLessThan(counts(c[0] as RailCellArrays).vertices);
        expect(counts(c[2] as RailCellArrays).vertices).toBeLessThan(counts(c[1] as RailCellArrays).vertices);
      }
    }
  });

  it("lay the rails' heads RAIL_TOP over the ground's bench along 2 km through and beyond the town", () => {
    for (const seed of SEEDS) {
      const w = railWorld(seed);
      let heads = 0;
      let worst = 0;
      for (let k = -8; k < 8; k++) {
        const a = cellOf(w, k, 0);
        const p = (a.solid as MeshArrays).positions;
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i] as number;
          const y = p[i + 1] as number;
          const z = p[i + 2] as number;
          const off = x - railCenterX(seed, z);
          // A vertex on a rail head's top: at the rail's centre line, at the height of a head.
          if (Math.abs(Math.abs(off) - RAIL_GAUGE / 2) > 0.05) continue;
          const ground = w.heightAt(railCenterX(seed, z), z);
          if (y - ground < RAIL_TOP - 0.01 || y - ground > RAIL_TOP + 0.01) continue;
          heads++;
          worst = Math.max(worst, Math.abs(y - ground - RAIL_TOP));
        }
        expect(k * RAIL_CELL).toBeLessThan(2000);
      }
      expect(heads).toBeGreaterThan(1000);
      expect(worst).toBeLessThan(0.005);
    }
  });

  it("stand ties on the bed every 0.55 m near the player and none far off", () => {
    const w = railWorld(1);
    const near = cellOf(w, 10, 0);
    const far = cellOf(w, 10, 1);
    expect(counts(near).triangles).toBeGreaterThan(counts(far).triangles + 128 / 0.55 * 8);
  });
});
