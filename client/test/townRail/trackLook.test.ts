import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { railCell, type RailLod } from "../../src/game/town/railGeometry.js";
import { railWorld } from "../../src/game/town/railWorld.js";
import { MeshBuilder, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { LAYER_NAMES } from "../../src/game/town/townLayers.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { bedGrid, hashAt, lumps, stretchAt, tieAt } from "../../src/game/town/trackLook.js";
import type { Frame } from "../../src/game/town/railConstants.js";
import { spurGeometry } from "../../src/game/town/spurGeometry.js";
import { townGround } from "../../src/game/town/townGeometry.js";

const SEED = 20261121;

function layersOf(a: MeshArrays | null): Set<string> {
  const out = new Set<string>();
  if (a === null) return out;
  for (let i = 0; i < a.positions.length / 3; i++) {
    const l = a.surface[i * SURFACE_FLOATS] as number;
    if (l >= 0) out.add(LAYER_NAMES[l] as string);
  }
  return out;
}

const verticesOf = (k: number, lod: RailLod): number => {
  const c = finish(railCell(railWorld(SEED), k, lod));
  return (c.solid?.positions.length ?? 0) / 3 + (c.flat?.positions.length ?? 0) / 3;
};

describe("the look of the track", () => {
  it("gives every part of a near cell a scanned material: gravel, planks, aged metal and rust", () => {
    const c = finish(railCell(railWorld(SEED), 5, 0));
    const layers = layersOf(c.solid);
    for (const name of ["gravel", "planks_weathered", "metal_aged", "rust"]) expect(layers.has(name), name).toBe(true);
    expect(layersOf(c.flat).has("gravel")).toBe(true);
  });

  it("carries the bed's texture and tone at the levels without ties, and keeps the far levels no dearer than they were", () => {
    for (const lod of [1, 2] as RailLod[]) {
      const c = finish(railCell(railWorld(SEED), 5, lod));
      expect(layersOf(c.solid).has("gravel"), `lod ${lod}`).toBe(true);
    }
    // Before the look: 1852 and 228 vertices in a cell of the plain line.
    expect(verticesOf(5, 1)).toBeLessThanOrEqual(1852);
    expect(verticesOf(5, 2)).toBeLessThanOrEqual(228);
    // The near level may grow up to four times (11457 before).
    expect(verticesOf(5, 0)).toBeLessThanOrEqual(4 * 11457);
  });

  it("draws ties that are individuals: some gone, lengths and heights that differ", () => {
    const look = { seed: SEED, spur: true };
    let gone = 0;
    const heights = new Set<number>();
    for (let j = 0; j < 400; j++) {
      const f: Frame = { x: -300 + j * 0.01, z: 10 + j * 0.55, g: 3, nx: 1, nz: 0 };
      const b = new MeshBuilder();
      tieAt(b, look, f, false);
      if (b.vertices === 0) {
        gone++;
        continue;
      }
      let top = -Infinity;
      b.forEachPosition(0, (_x, y) => {
        top = Math.max(top, y);
      });
      heights.add(Math.round(top * 1000));
    }
    expect(gone).toBeGreaterThan(2);
    expect(gone).toBeLessThan(30);
    expect(heights.size).toBeGreaterThan(10);
  });

  it("pushes the bed's top by no more than 2.2 cm down and 0.8 cm up, and the same at one place whatever is built around it", () => {
    const look = { seed: SEED, spur: false };
    for (let i = 0; i < 500; i++) {
      const d = lumps(look, -300 + i * 0.37, i * 1.13);
      expect(d).toBeGreaterThanOrEqual(-0.022);
      expect(d).toBeLessThanOrEqual(0.008);
    }
    expect(lumps(look, 12.5, 40.25)).toBe(lumps(look, 12.5, 40.25));
    expect(hashAt(1.5, 2.5, 3)).toBe(hashAt(1.5, 2.5, 3));
  });

  it("makes the spur older and weedier than the main line", () => {
    let main = 0;
    let spur = 0;
    for (let i = 0; i < 200; i++) {
      main += stretchAt({ seed: SEED, spur: false }, -400, i * 9).age;
      spur += stretchAt({ seed: SEED, spur: true }, -400, i * 9).age;
    }
    expect(spur).toBeGreaterThan(main * 1.3);
  });

  it("gives the bed's grid the same outline at every level: the toe is the same line", () => {
    const frames: Frame[] = Array.from({ length: 9 }, (_, i) => ({ x: -400, z: i * 4, g: 3, nx: 1, nz: 0 }));
    const widths: number[] = [];
    for (const lod of [0, 1, 2] as const) {
      const b = new MeshBuilder();
      bedGrid(b, frames, { seed: SEED, spur: false }, lod, 0);
      let lo = Infinity;
      let hi = -Infinity;
      b.forEachPosition(0, (x) => {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      });
      widths.push(hi - lo);
    }
    // The near level adds a finer wander of 5 cm at most to the toe.
    expect(Math.abs((widths[0] as number) - (widths[1] as number))).toBeLessThan(0.12);
    expect(Math.abs((widths[1] as number) - (widths[2] as number))).toBeLessThan(0.01);
  });

  it("keeps the low tier's spur to the textured, crowned bed: no ties, plates or weeds", () => {
    const g = townGround(SEED);
    const builders: MeshBuilder[] = [];
    spurGeometry(g, () => {
      const b = new MeshBuilder();
      builders.push(b);
      return b;
    }, "low");
    const low = builders.reduce((n, b) => n + b.vertices, 0);
    // Before the look: 18792.
    expect(low).toBeLessThanOrEqual(18792);
    expect(low).toBeGreaterThan(5000);
  });
});
