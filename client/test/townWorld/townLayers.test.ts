import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { creditsModel } from "@csarkosh/engine/game/credits";
import { LAYER_NAMES, LAYER_SIZE, PAINT_GAIN, TOWN_LAYERS, WEAR_OVERLAY } from "../../src/game/town/townLayers.js";
import { PORTASHTON_ASSETS } from "../../src/assets.js";

const TEXTURES = fileURLToPath(new URL("../../assets/textures/", import.meta.url));
const OWN_CREDITS = creditsModel(readFileSync(fileURLToPath(new URL("../../../CREDITS.md", import.meta.url)), "utf8"));

/** The width and height a WebP file's header gives, for any of its three forms. */
function webpSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
  const kind = bytes.subarray(12, 16).toString();
  if (kind === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  expect(kind).toBe("VP8 ");
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

describe("the town's texture manifest", () => {
  it("lists the layers the code names, in order, with unique contiguous indices and names", () => {
    expect(TOWN_LAYERS.map((l) => l.name)).toEqual([...LAYER_NAMES]);
    expect(TOWN_LAYERS.map((l) => l.index)).toEqual(TOWN_LAYERS.map((_, i) => i));
    expect(new Set(TOWN_LAYERS.map((l) => l.name)).size).toBe(TOWN_LAYERS.length);
    expect(TOWN_LAYERS.length).toBe(22);
    expect(LAYER_SIZE).toBe(512);
    expect(PAINT_GAIN).toBe(2);
    for (const name of Object.values(WEAR_OVERLAY)) expect(LAYER_NAMES).toContain(name);
  });

  it("gives every layer a real-world tile size, says which are the project's estimates, and which are painted", () => {
    for (const l of TOWN_LAYERS) {
      expect(l.tile[0], l.name).toBeGreaterThan(0.2);
      expect(l.tile[1], l.name).toBeGreaterThan(0.2);
      expect(typeof l.tileEstimated).toBe("boolean");
    }
    const estimated = TOWN_LAYERS.filter((l) => l.tileEstimated).map((l) => l.id).sort();
    expect(estimated).toEqual(["Bricks097", "Concrete047A", "CorrugatedSteel006A", "Plaster007", "PaintedMetal013", "Road012B", "WoodSiding009"].sort());
    expect(TOWN_LAYERS.filter((l) => l.paintable).map((l) => l.name)).toEqual(["siding_painted", "metal_aged", "stucco", "roof_shingle"]);
    // Two sizes the catalogue lists for its sets.
    expect(TOWN_LAYERS.find((l) => l.id === "WoodSiding010")?.tile).toEqual([1.4, 1.4]);
    expect(TOWN_LAYERS.find((l) => l.id === "Ground110")?.tile).toEqual([2.1, 2.1]);
  });

  it("has two files for every layer, 512 x 512 WebP, under 8 MB together", () => {
    // A checkout that has not fetched the Git LFS objects (the cloud's test job) holds each file's pointer: there the
    // size is the one the pointer names and the header cannot be read. The deploy refuses to build from pointers
    // (`tools/deploy/lib/lfsPointers.mjs`), which is where a pointer would do harm.
    let total = 0;
    for (const l of TOWN_LAYERS) {
      for (const file of [l.color, l.data]) {
        const path = TEXTURES + file;
        expect(existsSync(path), file).toBe(true);
        const bytes = readFileSync(path);
        const pointer = bytes.length < 1024 && bytes.subarray(0, 12).toString() === "version http";
        const size = pointer ? Number(/^size (\d+)$/m.exec(bytes.toString())?.[1]) : bytes.length;
        total += size;
        expect(size, file).toBeGreaterThan(1000);
        if (!pointer) expect(webpSize(bytes), file).toEqual([512, 512]);
      }
    }
    expect(total).toBeLessThan(8 * 1000 * 1000);
    expect(statSync(TEXTURES + "town.layers.json").size).toBeGreaterThan(1000);
  });

  it("is registered with the engine by the names the layers' files give", () => {
    for (const l of TOWN_LAYERS) {
      expect(Object.hasOwn(PORTASHTON_ASSETS.textures, `textures/${l.color}`), l.color).toBe(true);
      expect(Object.hasOwn(PORTASHTON_ASSETS.textures, `textures/${l.data}`), l.data).toBe(true);
    }
    // The town's 44 files and the rooms' 24 (`interiorLayers.test.ts` holds those to their own manifest).
    expect(Object.keys(PORTASHTON_ASSETS.textures).length).toBe(TOWN_LAYERS.length * 2 + 24);
  });

  it("is credited: a section in CREDITS.md for each scanned layer, under the layer's credit id, and none for the generated one", () => {
    const ids = new Set(OWN_CREDITS.map((e) => e.id));
    for (const l of TOWN_LAYERS) {
      if (l.generated) {
        expect(l.credit).toBeNull();
        continue;
      }
      expect(l.credit, l.name).toBe(`town.${l.id}`);
      expect(ids.has(l.credit as string), l.name).toBe(true);
    }
    expect(OWN_CREDITS.filter((e) => e.id.startsWith("town.")).length).toBe(TOWN_LAYERS.filter((l) => !l.generated).length);
  });
});
