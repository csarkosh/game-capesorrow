import { describe, expect, it } from "vitest";
import { PAINT_GAIN, TOWN_LAYERS, layerIndex } from "../../src/game/town/townLayers.js";
import { TOWN_ATTRIBUTE, TOWN_TINT_ATTRIBUTE, TOWN_VERTEX_FLOATS, emptyTownReady, townDefinitions, townSurfaceCode, townSurfacePlugin } from "../../src/game/town/townMaterial.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { townTextureBytes, townTextureSize } from "../../src/game/town/townTextures.js";

describe("the town's material plugin", () => {
  it("writes the layer table from the manifest: a row of tile size and gain for each layer, and the overlays' indices", () => {
    const defs = townDefinitions(false);
    expect(defs).toContain(`array<vec4<f32>,${TOWN_LAYERS.length}>`);
    expect(defs.match(/vec4<f32>\(/g)?.length).toBe(TOWN_LAYERS.length);
    expect(defs).toContain(`TOWN_MOSS:i32=${layerIndex("moss")}`);
    expect(defs).toContain(`TOWN_RUST:i32=${layerIndex("rust")}`);
    // A paintable layer's gain is the paint gain; the others' is one.
    const rows = defs.slice(defs.indexOf("=array<vec4<f32>")).split("vec4<f32>(").slice(1, TOWN_LAYERS.length + 1);
    TOWN_LAYERS.forEach((l, i) => expect(rows[i]).toContain(`,${l.paintable ? PAINT_GAIN.toFixed(1) : "1.0"},0.0)`));
    expect(defs).not.toContain("${");
  });

  it("has no unfilled slot in its code, and a cheaper wear and overlay on the low tier", () => {
    for (const low of [false, true]) {
      expect(townDefinitions(low)).not.toContain("${");
      expect(townSurfaceCode(low)).not.toContain("${");
    }
    expect(townDefinitions(true).length).toBeLessThan(townDefinitions(false).length);
    expect(townSurfaceCode(true).length).toBeLessThan(townSurfaceCode(false).length);
    // Both read the tint and the layer from their varyings, and nothing runs until the arrays are filled.
    expect(townSurfaceCode(false)).toContain("material.townReady>0.5");
    expect(townSurfaceCode(false)).toContain("vTownTint");
  });

  it("declares its vertex data as the builder lays it out: eight floats, the surface then the tint", () => {
    expect(TOWN_VERTEX_FLOATS).toBe(SURFACE_FLOATS);
    const ready = emptyTownReady();
    const plugin = townSurfacePlugin({ color: {} as never, data: {} as never }, ready, false);
    const attributes = plugin.getVertexAttributes?.() ?? [];
    expect(attributes.map((a) => [a.name, a.offset, a.stride])).toEqual([[TOWN_ATTRIBUTE, 0, 32], [TOWN_TINT_ATTRIBUTE, 16, 32]]);
    expect(plugin.priority).toBe(200);
    expect(plugin.getSamplers?.().map((s) => s.texture)).toEqual(["townColor", "townData"]);
    const out: { texture: unknown; sampler?: false }[] = [];
    plugin.bindTextures?.(out as never);
    expect(out[1]?.sampler).toBe(false);
    // Flat colour until the arrays are filled: the one uniform starts at zero.
    expect(ready.townReady).toEqual([0]);
  });

  it("costs a quarter of the memory on the low tier", () => {
    expect(townTextureSize(true)).toBe(256);
    expect(townTextureSize(false)).toBe(512);
    expect(townTextureBytes(true) * 4).toBeCloseTo(townTextureBytes(false), -1);
    // The full tier's two arrays with their mip chains: about 62 MB.
    expect(townTextureBytes(false) / 1e6).toBeCloseTo(61.6, 0);
  });
});
