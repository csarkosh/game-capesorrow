// The designed rooms' layers laid on the rooms' arrays and on the town's, on the real rooms of two worlds; and the loader that fills the arrays, when it fails.
import "../../src/terrain.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lite = vi.hoisted(() => ({ decode: vi.fn(), updates: 0 }));
vi.mock("@babylonjs/lite", async (original) => ({
  ...(await original<object>()),
  createTexture2DArray: vi.fn(() => ({})),
  updateTexture2DArrayFromPixels: vi.fn(() => void lite.updates++),
}));
vi.mock("@csarkosh/engine/game/groundLayers", () => ({ decodeGroundLayer: lite.decode }));
vi.mock("@csarkosh/engine/game/assetUrls", () => ({ textureUrl: (name: string) => `/${name}` }));

import { retargetLayers } from "../../src/game/town/insideLayers.js";
import { insideGeometry } from "../../src/game/town/insideGeometry.js";
import { INTERIOR_LAYERS } from "../../src/game/town/interiorLayers.js";
import { createInteriorTextures } from "../../src/game/town/interiorTextures.js";
import { SURFACE_FLOATS, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { INTERIOR_BASE, INTERIOR_ONLY_NAMES, TOWN_LAYERS } from "../../src/game/town/townLayers.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";

const SEEDS = [20261121, 1175766972];

const copy = (a: MeshArrays): MeshArrays => ({ ...a, uvs: a.uvs.slice(), surface: a.surface.slice() });
const layers = (a: MeshArrays): Set<number> => {
  const out = new Set<number>();
  for (let i = 0; i < a.surface.length; i += SURFACE_FLOATS) out.add(a.surface[i] as number);
  return out;
};

describe("a designed room's layers", () => {
  for (const seed of SEEDS) {
    const g = townGround(seed);
    for (const room of insideRooms(seed).filter((r) => !r.design.legacy)) {
      const built = insideGeometry(g, room, "full");
      it(`seed ${seed} ${room.name}: names the rooms' own layers while it is built, and every layer is on the arrays it is laid on`, () => {
        const own = [...layers(built)].filter((l) => l >= INTERIOR_BASE);
        expect(own.length).toBeGreaterThan(1);
        for (const l of own) expect(INTERIOR_ONLY_NAMES[l - INTERIOR_BASE]).toBeDefined();
        const inRooms = copy(built);
        retargetLayers(inRooms, "interior");
        for (const l of layers(inRooms)) expect(l === -1 || (l >= 0 && l < INTERIOR_LAYERS.length), `rooms' layer ${l}`).toBe(true);
        const inTown = copy(built);
        retargetLayers(inTown, "town");
        for (const l of layers(inTown)) expect(l === -1 || (l >= 0 && l < TOWN_LAYERS.length), `town's layer ${l}`).toBe(true);
        // The same vertices keep a layer or none: nothing is lost or made flat by the move (a builder's mistake would show as a new -1).
        for (let i = 0; i < built.surface.length; i += SURFACE_FLOATS) {
          expect((inRooms.surface[i] as number) === -1, `vertex ${i / SURFACE_FLOATS}`).toBe((built.surface[i] as number) === -1);
          expect((inTown.surface[i] as number) === -1).toBe((built.surface[i] as number) === -1);
        }
      });

      it(`seed ${seed} ${room.name}: is not worn on the rooms' arrays and keeps its pictures at true scale and its colours`, () => {
        const a = copy(built);
        retargetLayers(a, "interior");
        let worn = 0;
        for (let i = 0; i < a.surface.length; i += SURFACE_FLOATS) {
          if ((a.surface[i] as number) < 0) continue;
          worn += (a.surface[i + 1] as number) + (a.surface[i + 8] as number);
          for (let k = 4; k < 7; k++) {
            const t = a.surface[i + k] as number;
            expect(Number.isFinite(t) && t > 0 && t <= 10).toBe(true);
          }
        }
        expect(worn).toBe(0);
        // A layer both sets hold keeps its UV exactly.
        for (let v = 0; v < built.surface.length / SURFACE_FLOATS; v++) {
          const was = built.surface[v * SURFACE_FLOATS] as number;
          if (was >= 0 && was < INTERIOR_BASE && TOWN_LAYERS[was] !== undefined && INTERIOR_LAYERS.some((l) => l.name === TOWN_LAYERS[was]?.name)) {
            expect(a.uvs[v * 2]).toBe(built.uvs[v * 2]);
          }
        }
      });

      it(`seed ${seed} ${room.name}: lays each of its own pictures out in metres, not one texel`, () => {
        // Each of the rooms' own layers that the room uses covers many tiles of its picture where it spans metres, and its UVs vary: a floor, wall or small thing is not one flat colour or one stretched texel.
        for (const name of INTERIOR_ONLY_NAMES) {
          const index = INTERIOR_BASE + INTERIOR_ONLY_NAMES.indexOf(name);
          const layer = INTERIOR_LAYERS.find((l) => l.name === name);
          const us = new Set<number>();
          let any = false;
          for (let v = 0; v < built.surface.length / SURFACE_FLOATS; v++) {
            if (built.surface[v * SURFACE_FLOATS] !== index) continue;
            any = true;
            us.add(Math.round((built.uvs[v * 2] as number) * 1000));
            us.add(Math.round((built.uvs[v * 2 + 1] as number) * 1000));
          }
          if (!any) continue;
          expect(us.size, `${name} in ${room.name}`).toBeGreaterThan(3);
          expect(layer?.tile[0]).toBeGreaterThan(0.2);
        }
      });
    }
  }
});

describe("the rooms' arrays' loader", () => {
  beforeEach(() => {
    lite.decode.mockReset();
    lite.updates = 0;
  });

  it("fetches the 24 files, makes the two arrays once and says it filled them", async () => {
    lite.decode.mockImplementation(async (_url: string, size: number) => new Uint8ClampedArray(size * size * 4));
    const landed = vi.fn();
    const made = createInteriorTextures({} as never, false, new AbortController().signal, landed);
    expect(await made.done).toBe(true);
    expect(landed).toHaveBeenCalledWith(true);
    expect(lite.decode).toHaveBeenCalledTimes(24);
    expect(lite.updates).toBe(2);
    const urls = lite.decode.mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.startsWith("/textures/interior."))).toBe(true);
    // Colour at 512, data at 256 (and half of each on the low tier).
    expect(lite.decode.mock.calls.filter((c) => (c[0] as string).endsWith(".color.webp")).every((c) => c[1] === 512)).toBe(true);
    expect(lite.decode.mock.calls.filter((c) => (c[0] as string).endsWith(".data.webp")).every((c) => c[1] === 256)).toBe(true);
  });

  it("settles false with one warning when a file does not come, and fills nothing", async () => {
    lite.decode.mockImplementation(async (url: string, size: number) => {
      if (url.includes("marble_tile.data")) throw new Error("404");
      return new Uint8ClampedArray(size * size * 4);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const landed = vi.fn();
    const made = createInteriorTextures({} as never, true, new AbortController().signal, landed);
    expect(await made.done).toBe(false);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(landed).toHaveBeenCalledWith(false);
    expect(lite.updates).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/rooms' textures did not load/);
    expect(made.pending()).toBe(0);
    warn.mockRestore();
  });

  it("is silent when the renderer has gone (the signal aborted)", async () => {
    const controller = new AbortController();
    lite.decode.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const landed = vi.fn();
    expect(await createInteriorTextures({} as never, false, controller.signal, landed).done).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
