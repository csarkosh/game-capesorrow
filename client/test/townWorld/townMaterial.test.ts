import { describe, expect, it } from "vitest";
import { PAINT_GAIN, TOWN_LAYERS, layerIndex } from "../../src/game/town/townLayers.js";
import { PAINT_CODE, PAINT_K, PAINT_UNITS, RANK_CODE, TOWN_ATTRIBUTE, TOWN_PACK_A, TOWN_PACK_B, TOWN_PACK_C, TOWN_PACK_HALVES, TOWN_TINT_ATTRIBUTE, TOWN_UNPACK, TOWN_VERTEX_FLOATS, TOWN_WEAR_ATTRIBUTE, emptyTownReady, townDefinitions, townSurfaceCode, townSurfacePlugin } from "../../src/game/town/townMaterial.js";
import { PAINT_RANKS, paintAlpha, paintRank } from "../../src/game/town/paint.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { SURFACE_PACKED_BYTES } from "../../src/game/town/surfacePack.js";
import { townTextureBytes, townTextureSize } from "../../src/game/town/townTextures.js";

describe("the town's material plugin", () => {
  it("writes the layer table from the manifest: a row of tile size and gain for each layer, and the overlays' indices", () => {
    const defs = townDefinitions(false);
    expect(defs).toContain(`array<vec4<f32>,${TOWN_LAYERS.length}>`);
    // The layer table, and the nine rows of the wear kinds' grades (moss, rust, peel, algae, grime, oil, growth, leaf, damp).
    expect(defs.match(/vec4<f32>\(/g)?.length).toBe(TOWN_LAYERS.length + 9);
    expect(defs).toContain(`TOWN_MOSS:i32=${layerIndex("moss")}`);
    expect(defs).toContain(`TOWN_RUST:i32=${layerIndex("rust")}`);
    // A paintable layer's gain is the paint gain; the others' is one.
    const rows = defs.slice(defs.indexOf("=array<vec4<f32>", defs.indexOf("townInfo"))).split("vec4<f32>(").slice(1, TOWN_LAYERS.length + 1);
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

  it("declares its vertex data as the packer lays it out, 16 bytes: two 16-bit floats, then three 32-bit words", () => {
    expect(TOWN_VERTEX_FLOATS).toBe(SURFACE_FLOATS);
    const ready = emptyTownReady();
    const plugin = townSurfacePlugin({ color: {} as never, data: {} as never }, ready, false);
    const attributes = plugin.getVertexAttributes?.() ?? [];
    expect(attributes.map((a) => [a.name, a.offset, a.stride, a.format])).toEqual([[TOWN_PACK_HALVES, 0, 16, "float16x2"], [TOWN_PACK_A, 4, 16, "uint32"], [TOWN_PACK_B, 8, 16, "uint32"], [TOWN_PACK_C, 12, 16, "uint32"]]);
    expect(attributes.every((a) => a.stride === SURFACE_PACKED_BYTES)).toBe(true);
    // The vertex stage unpacks them into the names the rest of it reads, first thing.
    const vertex = plugin.getCustomCode?.("vertex") ?? {};
    expect(vertex.CUSTOM_VERTEX_MAIN_BEGIN).toBe(TOWN_UNPACK);
    for (const name of [TOWN_ATTRIBUTE, TOWN_TINT_ATTRIBUTE, TOWN_WEAR_ATTRIBUTE]) expect(TOWN_UNPACK).toContain(`let ${name}=`);
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

  it("draws a rank of paint PAINT_UNITS steps ahead in the vertex stage of the materials that are not the flat ground's, and nothing for a vertex of alpha 1", () => {
    const vertex = (ranked: boolean): string => {
      const plugin = townSurfacePlugin({ color: {} as never, data: {} as never }, emptyTownReady(), false, undefined, ranked);
      return plugin.getCustomCode?.("vertex")?.CUSTOM_VERTEX_MAIN_END ?? "";
    };
    expect(vertex(false)).toContain(PAINT_CODE);
    expect(vertex(false)).not.toContain(RANK_CODE);
    expect(vertex(true)).toContain(RANK_CODE);
    expect(vertex(true)).not.toContain(PAINT_CODE);
    // One rank is `1 / PAINT_RANKS` of alpha, and the line moves the depth by PAINT_UNITS steps of the 24-bit buffer for it.
    expect(PAINT_K / PAINT_RANKS).toBeCloseTo(PAINT_UNITS / 2 ** 24, 12);
    expect(PAINT_CODE).toContain("(1.0-color.a)");
    // A rank survives the colour's float, and rank 0 is alpha 1.
    expect(paintAlpha(0)).toBe(1);
    for (let r = 0; r < PAINT_RANKS; r++) expect(paintRank(Math.fround(paintAlpha(r)))).toBe(r);
  });
});
