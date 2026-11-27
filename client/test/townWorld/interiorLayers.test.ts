import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { creditsModel } from "@csarkosh/engine/game/credits";
import { CAPE_ASSETS } from "../../src/assets.js";
import { INTERIOR_COLOR_SIZE, INTERIOR_DATA_SIZE, INTERIOR_LAYERS } from "../../src/game/town/interiorLayers.js";
import { INTERIOR_MATERIALS, MATERIAL_NAMES } from "../../src/game/town/interiorMaterials.js";
import { INTERIOR_ONLY_NAMES, TOWN_LAYERS } from "../../src/game/town/townLayers.js";
import { matLayer } from "../../src/game/town/materials.js";
import { INTERIOR_SET, TOWN_SET, townDefinitions, townSurfaceCode } from "../../src/game/town/townMaterial.js";
import { interiorTextureBytes } from "../../src/game/town/interiorTextures.js";
import { townTextureBytes } from "../../src/game/town/townTextures.js";

const TEXTURES = fileURLToPath(new URL("../../assets/textures/", import.meta.url));
const CREDITS = creditsModel(readFileSync(fileURLToPath(new URL("../../../CREDITS.md", import.meta.url)), "utf8"));

function webpSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  const kind = bytes.subarray(12, 16).toString();
  if (kind === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

describe("the rooms' texture set (interior.layers.json)", () => {
  it("lists the eight layers of its own first (seven scanned, one generated), then the four outdoor ones it shares with the town, with contiguous indices", () => {
    expect(INTERIOR_LAYERS.map((l) => l.index)).toEqual(INTERIOR_LAYERS.map((_, i) => i));
    expect(INTERIOR_LAYERS.slice(0, 8).map((l) => l.name)).toEqual([...INTERIOR_ONLY_NAMES]);
    expect(INTERIOR_LAYERS.slice(8).map((l) => l.name)).toEqual(["brick", "sidewalk", "stucco", "rust"]);
    expect(INTERIOR_LAYERS.length).toBe(12);
    for (const name of INTERIOR_LAYERS.slice(8).map((l) => l.name)) {
      const mine = INTERIOR_LAYERS.find((l) => l.name === name);
      const town = TOWN_LAYERS.find((l) => l.name === name);
      expect(mine?.id, name).toBe(town?.id);
      expect(mine?.tile, name).toEqual(town?.tile);
      expect(mine?.paintable, name).toBe(town?.paintable);
    }
  });

  it("gives every layer a tile size, a mean colour and a credit", () => {
    const ids = new Set(CREDITS.map((e) => e.id));
    for (const l of INTERIOR_LAYERS) {
      expect(l.tile[0], l.name).toBeGreaterThan(0.2);
      expect(l.tile[1], l.name).toBeGreaterThan(0.2);
      expect(l.mean.length, l.name).toBe(3);
      for (const c of l.mean) expect(c, l.name).toBeGreaterThan(0.01);
      // The generated paint layer has no source and no credit, as the town's shingles have none.
      if (l.generated) expect(l.credit, l.name).toBeNull();
      else expect(ids.has(l.credit as string), `${l.name}: ${l.credit}`).toBe(true);
    }
    // Only the seven of its own are credited as the rooms'; the four it shares keep the town's credit.
    expect(INTERIOR_LAYERS.filter((l) => (l.credit ?? "").startsWith("interior.")).length).toBe(7);
    expect(CREDITS.filter((e) => e.id.startsWith("interior.")).length).toBe(7);
  });

  it("has two files for every layer, colour at 512 and data at 256, and about a megabyte in all", () => {
    expect(INTERIOR_COLOR_SIZE).toBe(512);
    expect(INTERIOR_DATA_SIZE).toBe(256);
    let total = 0;
    for (const l of INTERIOR_LAYERS) {
      for (const [file, side] of [[l.color, 512], [l.data, 256]] as const) {
        const path = TEXTURES + file;
        expect(existsSync(path), file).toBe(true);
        const bytes = readFileSync(path);
        // A checkout without the Git LFS objects holds each file's pointer (the cloud's test job): the size is the one it names.
        const pointer = bytes.length < 1024 && bytes.subarray(0, 12).toString() === "version http";
        total += pointer ? Number(/^size (\d+)$/m.exec(bytes.toString())?.[1]) : bytes.length;
        if (!pointer) expect(webpSize(bytes), file).toEqual([side, side]);
        expect(file.startsWith("interior."), file).toBe(true);
      }
    }
    expect(total).toBeLessThan(2 * 1000 * 1000);
  });

  it("is registered with the engine by the names its files give", () => {
    for (const l of INTERIOR_LAYERS) {
      expect(Object.hasOwn(CAPE_ASSETS.textures, `textures/${l.color}`), l.color).toBe(true);
      expect(Object.hasOwn(CAPE_ASSETS.textures, `textures/${l.data}`), l.data).toBe(true);
    }
  });

  it("takes under 22 MB of the GPU's memory with its mips (21.0 MB), and the low tier a quarter of that", () => {
    const bytes = interiorTextureBytes(false);
    // (512 x 512 + 256 x 256) texels x 4 bytes x 12 layers x 4/3 for the mip chain.
    expect(bytes).toBe(Math.round((512 * 512 + 256 * 256) * 4 * 12 * (4 / 3)));
    expect(bytes).toBeLessThan(22 * 1024 * 1024);
    expect(interiorTextureBytes(true)).toBeLessThan(bytes / 3.9);
    // And a third of the town's, which is not touched by it.
    expect(bytes).toBeLessThan(townTextureBytes(false) / 2.5);
  });
});

describe("the interior materials", () => {
  it("each name is laid on a layer that the rooms' set holds", () => {
    expect(MATERIAL_NAMES.length).toBeGreaterThan(15);
    const layers = new Set(INTERIOR_LAYERS.map((l) => l.name));
    for (const name of MATERIAL_NAMES) {
      const layer = matLayer((INTERIOR_MATERIALS[name] as (typeof INTERIOR_MATERIALS)[string]).mat);
      expect(layers.has(layer), `${name} -> ${layer}`).toBe(true);
    }
  });

  it("puts the seven new pictures behind the seven names that have their own", () => {
    const own = (n: string): string => matLayer((INTERIOR_MATERIALS[n] as (typeof INTERIOR_MATERIALS)[string]).mat);
    expect(own("marble_tile")).toBe("marble_tile");
    expect(own("carpet")).toBe("carpet");
    expect(own("oak")).toBe("oak");
    expect(own("dark_wood")).toBe("dark_wood");
    expect(own("cloth")).toBe("cloth");
    expect(own("leather")).toBe("cloth");
    expect(own("glazed_tile")).toBe("glazed_tile");
    expect(own("cane")).toBe("cane");
  });
});

describe("the plugin on the rooms' set", () => {
  it("has a table of the set's 12 layers and no bare-metal line, and the town's is as it was", () => {
    const rooms = townDefinitions(false, INTERIOR_SET);
    expect(rooms).toContain("array<vec4<f32>,12>");
    expect(townDefinitions(false)).toBe(townDefinitions(false, TOWN_SET));
    expect(townDefinitions(false)).toContain(`array<vec4<f32>,${TOWN_LAYERS.length}>`);
    expect(townSurfaceCode(false, false, false, INTERIOR_SET)).not.toMatch(/metallic=/);
    expect(townSurfaceCode(false)).toMatch(/metallic=/);
    // Every colour the rooms' own layers carry is as it is: none is paint (a tint is the colour over the layer's mean).
    for (const l of INTERIOR_LAYERS.slice(0, 8)) expect(l.paintable, l.name).toBe(false);
  });
});
