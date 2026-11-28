import { describe, expect, it, vi } from "vitest";
import { noParts } from "@csarkosh/engine/game/lite/noParts";
import type { RenderHost, RenderMakeLate } from "@csarkosh/engine/game/lite/renderGame";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { boundsOf, retireStandIns, townParts } from "../../src/game/town/townParts.js";
import { createForest } from "@csarkosh/engine/sim/forest";
import "../../src/terrain.js";

/** A host with only what the town's side reads of it, and a scheduler that keeps what it is handed. */
function fakeHost(forest: RenderHost["forest"], tier: RenderHost["tier"] = "medium"): { host: RenderHost; begun: { name: string | undefined; slices: Slices }[]; cancelled: object[] } {
  const begun: { name: string | undefined; slices: Slices }[] = [];
  const cancelled: object[] = [];
  const host = {
    tier,
    chained: true,
    forest,
    jobs: { begin: (_o: object, slices: Slices, _p?: boolean, name?: string) => begun.push({ name, slices }), cancel: (o: object) => cancelled.push(o) },
    uploads: { count: () => undefined, made: () => undefined, dropped: () => undefined },
  } as unknown as RenderHost;
  return { host, begun, cancelled };
}

const fakeMake = { engine: {}, scene: {}, shared: {}, air: () => ({ name: "air" }), wetAt: () => ({}), ahead: () => ({ name: "ahead" }), hardCover: undefined } as unknown as RenderMakeLate;

describe("the town's part of the renderer", () => {
  it("is the engine's no-parts side with the town added: every point the same, the same api", () => {
    const { host } = fakeHost(null);
    const base = noParts(host);
    const mine = townParts(host);
    // The town's side says one thing more: its glass reads the frame the opaque draws left (`townBlur.ts`), so the medium tier keeps it.
    expect(Object.keys(mine.side).sort()).toEqual([...Object.keys(base.side), "keepsFrame"].sort());
    expect(mine.side.keepsFrame).toBe(true);
    expect(Object.keys(mine.api)).toEqual(Object.keys(base.api));
    mine.api.setUnsettle(0.25);
    expect(mine.side.look.unsettle).toBe(0.25);
    expect(mine.side.waiting()).toBe(0);
  });

  it("makes nothing in a world with no forest", () => {
    const { host, begun } = fakeHost(null);
    const { side } = townParts(host);
    side.late(fakeMake);
    expect(begun).toEqual([]);
    expect(side.waiting()).toBe(0);
    side.releaseBodies();
    side.release();
  });

  it("builds the town as a job of the renderer's scheduler, a slice at a time, and says what it waits for until it is made", () => {
    const { host, begun, cancelled } = fakeHost(createForest(20261121));
    const { side } = townParts(host);
    // The fake engine has no device to make the texture arrays on: the town is then built as flat colour, and says so once.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    side.late(fakeMake);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/texture arrays could not be made/);
    warn.mockRestore();
    expect(begun.length).toBe(1);
    expect((begun[0] as (typeof begun)[number]).name).toBe("town");
    expect(side.waiting()).toBe(1);
    // The first slice is the streets', the quay's and the wharf's: the job is not done after it.
    const first = (begun[0] as (typeof begun)[number]).slices.next();
    expect(first.done).toBe(false);
    // Let go, it cancels what it began.
    side.releaseBodies();
    expect(cancelled.length).toBe(1);
    expect(side.waiting()).toBe(0);
  });

  it("bounds a batch by its box: its middle and half its diagonal", () => {
    const positions = new Float32Array([0, 0, 0, 10, 4, 0, 10, 0, 20]);
    const b = boundsOf(positions);
    expect([b.x, b.y, b.z]).toEqual([5, 2, 10]);
    expect(b.radius).toBeCloseTo(Math.sqrt(100 + 16 + 400) / 2, 5);
  });

  it("lets each stand-in go once when its model is made, keeps the rest in order, and keeps a model's stand-ins that has not landed", () => {
    type M = { id: number; model?: string };
    const list: M[] = [{ id: 1 }, { id: 2, model: "a" }, { id: 3, model: "b" }, { id: 4 }, { id: 5, model: "a" }];
    const dropped: number[] = [];
    const landed = new Set<string>();
    retireStandIns(list, (m) => landed.has(m), (m) => dropped.push(m.id));
    expect(list.length).toBe(5);
    expect(dropped).toEqual([]);
    landed.add("a");
    retireStandIns(list, (m) => landed.has(m), (m) => dropped.push(m.id));
    expect(dropped).toEqual([2, 5]);
    expect(list.map((m) => m.id)).toEqual([1, 3, 4]);
    // Asked again, nothing is let go twice; the model whose file failed never lands, so its stand-in stays.
    retireStandIns(list, (m) => landed.has(m), (m) => dropped.push(m.id));
    expect(dropped).toEqual([2, 5]);
    expect(list.map((m) => m.id)).toEqual([1, 3, 4]);
  });
});
