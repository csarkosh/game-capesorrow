// The rooms' own textures: when they are asked for, what the room waits for and what it is drawn on if they do not come. The renderer's pieces and the
// geometry are replaced by recorders; the rooms, their designs and the layers are the real ones.
import "../../src/terrain.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  made: [] as { material: unknown; pluginVertexData: Float32Array }[],
  asked: [] as ((filled: boolean) => void)[],
  fail: false,
}));

vi.mock("@babylonjs/lite", async (original) => ({
  ...(await original<object>()),
  addToScene: vi.fn(),
  removeFromScene: vi.fn(),
  disposeMeshGpu: vi.fn(),
  createMeshFromData: vi.fn(() => {
    const mesh = { material: null as unknown, pluginVertexData: null as unknown, renderOrder: 0 };
    mocks.made.push(mesh as never);
    return mesh;
  }),
}));

// A room of three corners: one on a layer of the rooms' own (marble), one on a town layer the rooms' set has too (brick), one with no layer.
vi.mock("../../src/game/town/insideGeometry.js", async () => {
  const lite = await import("../../src/game/town/townLayers.js");
  return {
    insideGeometry: () => ({
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      colors: new Float32Array(12),
      uvs: new Float32Array([1, 1, 2, 2, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
      surface: Float32Array.from([
        lite.layerIndex("marble_tile"), 0.4, 0, 1, 0.5, 0.5, 0.5, 0, 0.3, 0, 0, 0,
        lite.layerIndex("brick"), 0.4, 0, 1, 0.5, 0.5, 0.5, 0, 0.3, 0, 0, 0,
        -1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
      ]),
    }),
  };
});

vi.mock("../../src/game/town/interiorTextures.js", () => ({
  createInteriorTextures: vi.fn((_engine: unknown, _low: boolean, _signal: AbortSignal, landed: (filled: boolean) => void) => {
    if (mocks.fail) throw new Error("no device");
    mocks.asked.push(landed);
    return { color: {}, data: {}, done: Promise.resolve(true), pending: () => 0 };
  }),
}));

import { createInteriorTextures } from "../../src/game/town/interiorTextures.js";
import { createInsideParts, type InsideHost } from "../../src/game/town/insideParts.js";
import { roomDrawn } from "../../src/game/insideReady.js";
import { INTERIOR_LAYERS } from "../../src/game/town/interiorLayers.js";
import { layerIndex } from "../../src/game/town/townLayers.js";
import { GOING_IN, INSIDE, OUTSIDE, insideRooms, type Inside } from "../../src/sim/inside/rooms.js";

const SEED = 20261121;
const designed = insideRooms(SEED).find((r) => !r.design.legacy);
const legacy = insideRooms(SEED).find((r) => r.design.legacy);
const townMaterial = { name: "town" };
const roomsMaterial = { name: "rooms" };
let landedFlags: boolean[] = [];

function parts(interior: InsideHost["interior"] | "default" = "default") {
  const host: InsideHost = {
    engine: {} as never,
    scene: {} as never,
    material: townMaterial as never,
    order: 1,
    textured: true,
    ground: { seed: SEED } as never,
    detail: "full",
    uploads: { count: vi.fn(), made: vi.fn(), dropped: vi.fn() } as never,
    interior:
      interior === "default"
        ? { low: false, signal: new AbortController().signal, make: () => ({ material: roomsMaterial as never, landed: (f: boolean) => void landedFlags.push(f) }) }
        : interior,
  };
  return createInsideParts(host);
}

const at = (phase: Inside["phase"], place: number, ticks = 0): Inside => ({ place, phase, ticks });

beforeEach(() => {
  mocks.made.length = 0;
  mocks.asked.length = 0;
  mocks.fail = false;
  landedFlags = [];
  vi.mocked(createInteriorTextures).mockClear();
});

describe("the rooms' textures", () => {
  it("have a designed room to be tested on", () => {
    expect(designed).toBeDefined();
  });

  it("are not asked for in the street, nor by a player walking into a room drawn the old way", () => {
    const p = parts();
    p.frame(at(OUTSIDE, 0));
    p.frame(undefined);
    if (legacy !== undefined) {
      p.frame(at(GOING_IN, legacy.id, 20));
      p.frame(at(INSIDE, legacy.id));
      expect(p.built()).toBe(legacy.id);
      expect(mocks.made[0]?.material).toBe(townMaterial);
    }
    expect(createInteriorTextures).not.toHaveBeenCalled();
    expect(roomDrawn()).toBe(true);
  });

  it("are asked for once, as the hold at a designed room's door begins, and the room waits for them with the screen dark", () => {
    if (designed === undefined) return;
    const p = parts();
    p.frame(at(OUTSIDE, 0));
    expect(createInteriorTextures).not.toHaveBeenCalled();
    p.frame(at(GOING_IN, designed.id, 27));
    p.frame(at(GOING_IN, designed.id, 10));
    p.frame(at(INSIDE, designed.id));
    expect(createInteriorTextures).toHaveBeenCalledTimes(1);
    // Past the hold, inside, and nothing built or drawn: the screen is kept dark (`darkFor`, by `roomDrawn`).
    expect(p.built()).toBe(0);
    expect(mocks.made.length).toBe(0);
    expect(roomDrawn()).toBe(false);
  });

  it("build the room on the rooms' arrays once they have landed, its layers in the rooms' set", () => {
    if (designed === undefined) return;
    const p = parts();
    p.frame(at(GOING_IN, designed.id, 27));
    p.frame(at(INSIDE, designed.id));
    (mocks.asked[0] as (f: boolean) => void)(true);
    p.frame(at(INSIDE, designed.id));
    expect(p.built()).toBe(designed.id);
    expect(roomDrawn()).toBe(true);
    const made = mocks.made[0] as { material: unknown; pluginVertexData: Float32Array };
    expect(made.material).toBe(roomsMaterial);
    // The packed records are 16-bit floats: read the first number of each (the layer).
    const halves = new Uint16Array(made.pluginVertexData.buffer);
    const layerOf = (v: number): number => {
      const h = halves[v * 12] as number;
      return h === 0 ? 0 : (1 + ((h & 0x3ff) / 1024)) * 2 ** (((h >> 10) & 0x1f) - 15) * ((h & 0x8000) !== 0 ? -1 : 1);
    };
    expect(layerOf(0)).toBe(INTERIOR_LAYERS.findIndex((l) => l.name === "marble_tile"));
    expect(layerOf(1)).toBe(INTERIOR_LAYERS.findIndex((l) => l.name === "brick"));
    expect(layerOf(2)).toBe(-1);
    // And is kept for the session: a second entry does not ask again.
    p.frame(at(OUTSIDE, 0));
    p.frame(at(GOING_IN, designed.id, 27));
    expect(createInteriorTextures).toHaveBeenCalledTimes(1);
  });

  it("that do not load leave the room built on the town's arrays, with a warning from the loader and no dark screen", () => {
    if (designed === undefined) return;
    const p = parts();
    p.frame(at(GOING_IN, designed.id, 27));
    p.frame(at(INSIDE, designed.id));
    expect(roomDrawn()).toBe(false);
    (mocks.asked[0] as (f: boolean) => void)(false);
    p.frame(at(INSIDE, designed.id));
    expect(p.built()).toBe(designed.id);
    expect(roomDrawn()).toBe(true);
    expect(mocks.made[0]?.material).toBe(townMaterial);
    const h = new Uint16Array((mocks.made[0] as { pluginVertexData: Float32Array }).pluginVertexData.buffer);
    // Marble has no layer in the town's set: it is the stone (index 9, whose half-float is 0x4880).
    expect(h[0]).toBe(0x4880);
    expect(layerIndex("stone")).toBe(9);
  });

  it("that cannot be made (no device) are a warning, and the room is built on the town's arrays", () => {
    if (designed === undefined) return;
    mocks.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = parts();
    p.frame(at(INSIDE, designed.id));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(p.built()).toBe(designed.id);
    expect(mocks.made[0]?.material).toBe(townMaterial);
    expect(roomDrawn()).toBe(true);
    warn.mockRestore();
  });

  it("are never asked for where the town has no textures: the room is built at once as it was", () => {
    if (designed === undefined) return;
    const p = parts(null);
    p.frame(at(INSIDE, designed.id));
    expect(createInteriorTextures).not.toHaveBeenCalled();
    expect(p.built()).toBe(designed.id);
    expect(roomDrawn()).toBe(true);
  });

  it("are let go of the screen's dark when the part goes", () => {
    if (designed === undefined) return;
    const p = parts();
    p.frame(at(INSIDE, designed.id));
    expect(roomDrawn()).toBe(false);
    p.dispose();
    expect(roomDrawn()).toBe(true);
  });
});

describe("the screen's dark while the room is not drawn", () => {
  it("is kept by darkFor in the phase INSIDE only while the room is not drawn", async () => {
    const { darkFor } = await import("../../src/game/doors.js");
    const { setRoomDrawn } = await import("../../src/game/insideReady.js");
    const walker = (inside: Inside) => ({ inside, ride: { phase: 0 } }) as never;
    setRoomDrawn(false);
    expect([darkFor(walker(at(OUTSIDE, 0))), darkFor(walker(at(INSIDE, 1))), darkFor(walker(at(GOING_IN, 1, 3)))]).toEqual([false, true, true]);
    setRoomDrawn(true);
    expect(darkFor(walker(at(INSIDE, 1)))).toBe(false);
  });
});

describe("what the town's load path asks for", () => {
  const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? files(`${dir}${f}/`) : f.endsWith(".ts") ? [dir + f] : []));

  it("never names the rooms' textures: only insideParts.ts imports the module that loads them, and calls it from the first-entry path", () => {
    const importers = files(SRC).filter((f) => /from "[^"]*interiorTextures\.js"/.test(readFileSync(f, "utf8")));
    // The loader itself imports its set's manifest and the town's loader; nothing imports it but the inside part (a type-only import would not load it).
    expect(importers.map((f) => f.slice(SRC.length))).toEqual(["game/town/insideParts.ts"]);
    const inside = readFileSync(`${SRC}game/town/insideParts.ts`, "utf8");
    expect(inside.match(/createInteriorTextures\(/g)?.length).toBe(1);
    // The one call is in `fetchTextures`, which the frame calls only for a designed room being walked into or stood in.
    expect(inside.match(/fetchTextures\(\)/g)?.length).toBe(1);
    expect(inside).toMatch(/if \(target !== undefined && !target\.design\.legacy\) fetchTextures\(\);/);
  });

  it("is the town's loader that the town makes: no interior file is named by the town's own loading modules", () => {
    for (const f of ["game/town/townTextures.ts", "game/town/townParts.ts", "game/town/townLayers.ts", "assets.ts"]) {
      const text = readFileSync(SRC + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/interior\.(color|data|layers)|interiorTextures|createInteriorTextures/);
    }
  });
});
