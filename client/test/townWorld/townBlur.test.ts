// The rooms seen through their glass out of focus (`townBlur.ts`): what the geometry is on the tier that reads the frame behind its glass,
// against the tier that draws each room to a painted sheet, and what the pane's plugin asks of the renderer.
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { FRAME_BLOCK, FRAME_PROJECTION_NAME } from "@csarkosh/engine/game/lite/frameBlock";
import { THROUGH_SEED } from "../../src/game/town/buildingKit.js";
import { SURFACE_FLOATS } from "../../src/game/town/meshBuilder.js";
import { HAZE_SEED } from "../../src/game/town/roomHaze.js";
import { BLUR_FROM, BLUR_FULL, TAPS, townBlurPlugin } from "../../src/game/town/townBlur.js";
import { townGeometry, townGround, type TownBatch } from "../../src/game/town/townGeometry.js";

const SEED = 20261121;
const ground = townGround(SEED);
const sheet = finish(townGeometry(ground, "full", { x: 0, z: 0 }));
const through = finish(townGeometry(ground, "full", { x: 0, z: 0 }, undefined, true));

const vertices = (town: readonly TownBatch[], layer: TownBatch["layer"]): number => town.filter((b) => b.layer === layer).reduce((n, b) => n + b.arrays.positions.length / 3, 0);
/** The seeds of the glass layer's vertices (a pane's own is 0 to 1; a marked pane's is `THROUGH_SEED` more). */
const seeds = (town: readonly TownBatch[]): number[] => town.filter((b) => b.layer === "glass").flatMap((b) => Array.from({ length: b.arrays.positions.length / 3 }, (_, i) => b.arrays.surface[i * SURFACE_FLOATS + 2] as number));

describe("the town's geometry where the rooms are read through their glass", () => {
  it("has no haze and no painted sheet: the rooms are drawn whole, so the standing layer holds more", () => {
    expect(vertices(sheet, "haze")).toBeGreaterThan(0);
    expect(vertices(through, "haze")).toBe(0);
    expect(vertices(through, "solid")).toBeGreaterThan(vertices(sheet, "solid"));
    // The whole rooms cost what the sheets saved, and no more than a twentieth of the standing layer.
    expect(vertices(through, "solid") - vertices(sheet, "solid")).toBeLessThan(vertices(sheet, "solid") * 0.05);
  });

  it("marks the panes that have a room behind them, and only there", () => {
    const marked = seeds(through).filter((s) => s >= THROUGH_SEED - 0.5);
    const plain = seeds(through).filter((s) => s < THROUGH_SEED - 0.5);
    // A town has shop fronts and it has houses, upper storeys and cars: some panes of each sort.
    expect(marked.length).toBeGreaterThan(400);
    expect(plain.length).toBeGreaterThan(400);
    for (const s of marked) expect(s).toBeLessThan(THROUGH_SEED + 1);
    // No pane's own seed reaches a haze sheet's mark, and the tier with sheets marks none.
    for (const s of plain) expect(s).toBeLessThan(HAZE_SEED - 0.5);
    expect(seeds(sheet).every((s) => s < HAZE_SEED - 0.5)).toBe(true);
  });

  it("is the same glass, pane for pane, as the tier with sheets", () => {
    expect(vertices(through, "glass")).toBe(vertices(sheet, "glass"));
  });
});

describe("the pane's plugin", () => {
  const kept = { colour: () => ({}) as never, depth: () => ({}) as never };
  const plugin = townBlurPlugin(kept, { name: FRAME_BLOCK } as never);
  const code = plugin.getCustomCode?.("fragment") ?? {};
  it("reads the kept frame's colour and its depth, and the frame's projection from the frame's block", () => {
    expect(plugin.getSamplers?.()).toEqual([{ texture: "townKept", sampler: "townKeptSmp" }, { texture: "townKeptDepth", sampleType: "unfilterable-float" }]);
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(main).toContain(`${FRAME_BLOCK}.${FRAME_PROJECTION_NAME}[3].z`);
    expect(main).toContain("textureLoad(townKeptDepth");
    expect(main).toContain(`tbI<${TAPS}`);
    const bound: unknown[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound.length).toBe(2);
  });
  it("blurs from the pane inward, writes the whole pixel, and adds what it read after the air", () => {
    expect(BLUR_FROM).toBeLessThan(BLUR_FULL);
    expect(BLUR_FULL).toBeLessThanOrEqual(2.5);
    const main = code.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(main).toContain("alpha=1.0;");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color+=townBehindC;");
  });
});
