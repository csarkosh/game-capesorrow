import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { MEAN, matSurface, unnamed, withMat, currentMat } from "../../src/game/town/materials.js";
import { MeshBuilder, SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { LAYER_NAMES, NO_LAYER, layerIndex } from "../../src/game/town/townLayers.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import type { Detail } from "../../src/game/town/townTypes.js";

/**
 * Nothing in the town is a flat colour: every opaque polygon has a photographed surface, its own or its material's
 * (`materials.ts`), and every builder says what its things are made of (none is left to the fallback).
 */

const GAME_SEED = 20261121;
type V3 = readonly [number, number, number];

describe("the town's materials", () => {
  it("has a mean colour for every layer", () => {
    for (const name of LAYER_NAMES) {
      const m = MEAN[name];
      expect(m, name).toBeDefined();
      for (const c of m) expect(c).toBeGreaterThan(0);
    }
  });

  it("lays a board's grain along the board, whichever way the board is put", () => {
    const post: V3[] = [[0, 0, 0], [0.1, 0, 0], [0.1, 2, 0], [0, 2, 0]];
    const rail: V3[] = [[0, 1, 0], [3, 1, 0], [3, 1.1, 0], [0, 1.1, 0]];
    const up = matSurface("wood", post, [0, 0, 1], [0.3, 0.25, 0.2]).frame.u;
    const along = matSurface("wood", rail, [0, 0, 1], [0.3, 0.25, 0.2]).frame.u;
    expect(Math.abs(up[1])).toBeGreaterThan(Math.abs(up[0]));
    expect(Math.abs(along[0])).toBeGreaterThan(Math.abs(along[1]));
  });

  it("keeps the builder's colour: a paintable layer is painted it, any other is tinted to it over the layer's own mean", () => {
    const sq: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    expect(matSurface("plaster", sq, [0, 0, 1], [0.2, 0.3, 0.4]).tint).toBeUndefined();
    const tint = matSurface("concrete", sq, [0, 0, 1], [0.3, 0.3, 0.3]).tint as V3;
    const mean = MEAN.sidewalk;
    for (let k = 0; k < 3; k++) expect((tint[k] as number) * (mean[k] as number)).toBeCloseTo(0.3, 5);
  });

  it("puts back the material before it, and gives a polygon its builder's material, its own name, or a back of what its front is", () => {
    expect(currentMat()).toBeNull();
    const b = new MeshBuilder();
    const sq: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const before = unnamed.polygons;
    withMat("wood", () => {
      b.poly(sq, [0, 0, 1], [0.3, 0.3, 0.3]);
      b.poly(sq, [0, 0, 1], [0.3, 0.3, 0.3], "steel", { back: true });
      expect(currentMat()).toBe("wood");
    });
    b.poly(sq, [0, 0, 1], [0.3, 0.3, 0.3], "brick", { back: true });
    expect(currentMat()).toBeNull();
    expect(unnamed.polygons).toBe(before);
    const a = b.finish();
    const layers = Array.from({ length: a.surface.length / SURFACE_FLOATS }, (_, i) => a.surface[i * SURFACE_FLOATS] as number);
    const [wood, steel, brick] = [layerIndex("planks_weathered"), layerIndex("rust"), layerIndex("brick")];
    expect(layers).toEqual([wood, wood, wood, wood, steel, steel, steel, steel, steel, steel, steel, steel, brick, brick, brick, brick, brick, brick, brick, brick]);
    // With nothing named, it is drawn all the same, and counted.
    b.poly(sq, [0, 0, 1], [0.3, 0.3, 0.3]);
    expect(unnamed.polygons).toBe(before + 1);
    unnamed.polygons = before;
  });

  for (const tier of ["full", "low"] as const satisfies readonly Detail[]) {
    it(`leaves no opaque vertex of the ${tier} town without a surface, and none to the fallback`, () => {
      unnamed.polygons = 0;
      const town = finish(townGeometry(townGround(GAME_SEED), tier, { x: 0, z: 0 }));
      expect(unnamed.polygons).toBe(0);
      let bare = 0;
      let opaque = 0;
      for (const batch of town) {
        // A sign's face reads its own atlas by its UV (`polyUv`), so its vertices carry no layer by design: they are not of these meshes' count.
        if (batch.layer === "sign") continue;
        const s = batch.arrays.surface;
        for (let i = 0; i < s.length; i += SURFACE_FLOATS) {
          const clear = s[i + 7] as number;
          const wire = (s[i + 10] as number) < 0;
          if (clear > 0 || wire) continue;
          opaque++;
          if ((s[i] as number) === NO_LAYER) bare++;
        }
      }
      expect(opaque).toBeGreaterThan(100000);
      expect(bare).toBe(0);
    }, timeLimit(120_000));
  }
});
