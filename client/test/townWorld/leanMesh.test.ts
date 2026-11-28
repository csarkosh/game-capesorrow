import { describe, expect, it } from "vitest";
import type { Mesh } from "@babylonjs/lite";
import { createLeaner, leanMesh } from "../../src/game/town/leanMesh.js";

/**
 * A mesh's arrays are let go once the GPU has them: the town's vertices were held twice, in the tab and on the GPU.
 * These are the rules of when; the saving itself is measured in a browser, not here.
 */

type Fake = Record<string, unknown>;
const fake = (plugin: boolean): Fake => ({
  _cpuPositions: new Float32Array(9), _cpuNormals: new Float32Array(9), _cpuUvs: new Float32Array(6), _cpuColors: new Float32Array(12), _cpuIndices: new Uint32Array(3),
  ...(plugin ? { pluginVertexData: new Float32Array(36) } : {}),
  _gpu: {},
});
const lean = (m: Fake): boolean => leanMesh(m as unknown as Mesh);

describe("letting go of a mesh's arrays", () => {
  it("drops what the mesh was made from at once, and is done when it carries no plugin data", () => {
    const m = fake(false);
    expect(lean(m)).toBe(true);
    for (const k of ["_cpuPositions", "_cpuNormals", "_cpuUvs", "_cpuColors", "_cpuIndices"]) expect(m[k]).toBeNull();
  });

  it("keeps the plugin's data until the plugin's buffer has been written at the data's version", () => {
    const m = fake(true);
    expect(lean(m)).toBe(false);
    expect(m._cpuPositions).toBeNull();
    expect(m.pluginVertexData).toBeInstanceOf(Float32Array);
    // The buffer is there but was written for an older version of the data.
    m.pluginVertexVersion = 2;
    m._gpu = { _pluginVertexBuffer: {}, _pluginVertexVersion: 1 };
    expect(lean(m)).toBe(false);
    expect(m.pluginVertexData).toBeInstanceOf(Float32Array);
    m._gpu = { _pluginVertexBuffer: {}, _pluginVertexVersion: 2 };
    expect(lean(m)).toBe(true);
    expect(m.pluginVertexData).toBeUndefined();
    expect(lean(m)).toBe(true);
  });

  it("asks each frame only of the meshes that still hold something", () => {
    const leaner = createLeaner();
    const a = fake(false);
    const b = fake(true);
    leaner.add(a as unknown as Mesh);
    leaner.add(b as unknown as Mesh);
    expect(leaner.waiting()).toBe(2);
    leaner.step();
    expect(leaner.waiting()).toBe(1);
    b._gpu = { _pluginVertexBuffer: {}, _pluginVertexVersion: 0 };
    leaner.step();
    expect(leaner.waiting()).toBe(0);
    expect(b.pluginVertexData).toBeUndefined();
  });

  it("forgets a mesh it is told to let go of, so a released mesh is not waited for", () => {
    const leaner = createLeaner();
    const a = fake(true);
    const b = fake(true);
    leaner.add(a as unknown as Mesh);
    leaner.add(b as unknown as Mesh);
    leaner.remove(a as unknown as Mesh);
    expect(leaner.waiting()).toBe(1);
    leaner.step();
    expect(a._cpuPositions).not.toBeNull();
    expect(b._cpuPositions).toBeNull();
  });
});
