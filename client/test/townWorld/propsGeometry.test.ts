import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { propsGeometry } from "../../src/game/town/props/index.js";
import { groundAt } from "../../src/game/town/props/kit.js";
import { vehicleGeometry } from "../../src/game/town/props/vehicleGeometry.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { WORLD_SEEDS } from "./world.js";

const GAME_SEED = 20261121;
/** The pass's budget over the town: vertices it may add, a tier each. */
const BUDGET = { full: 200_000, low: 60_000 } as const;

function build(seed: number, detail: "full" | "low"): { vertices: number; mesh: MeshBuilder } {
  const g = townGround(seed);
  const solid = new MeshBuilder();
  const glass = new MeshBuilder();
  const flat = new MeshBuilder();
  const run = propsGeometry(g, { solid: () => solid, glass: () => glass, flat: () => flat }, detail, () => false);
  while (!run.next().done) {
    /* to the end */
  }
  return { vertices: solid.vertices + glass.vertices + flat.vertices, mesh: solid };
}

describe("the props, drawn", () => {
  it("adds no more than the budget's vertices to the game's town, on either tier", () => {
    for (const tier of ["full", "low"] as const) {
      const { vertices } = build(GAME_SEED, tier);
      expect(vertices, tier).toBeGreaterThan(tier === "full" ? 100_000 : 20_000);
      expect(vertices, tier).toBeLessThanOrEqual(BUDGET[tier]);
    }
  });

  it("makes only finite positions, unit normals and indices that exist", () => {
    for (const seed of [GAME_SEED, WORLD_SEEDS[1] as number]) {
      for (const tier of ["full", "low"] as const) {
        const a = build(seed, tier).mesh.finish();
        let bad = 0;
        for (let i = 0; i < a.positions.length; i++) if (!Number.isFinite(a.positions[i] as number)) bad++;
        for (let i = 0; i < a.normals.length; i += 3) {
          const l = Math.hypot(a.normals[i] as number, a.normals[i + 1] as number, a.normals[i + 2] as number);
          if (!(Math.abs(l - 1) < 1e-3)) bad++;
        }
        for (const k of a.indices) if (k >= a.positions.length / 3) bad++;
        expect(bad, `seed ${seed} ${tier}`).toBe(0);
      }
    }
  });

  it("stands each vehicle on the ground, not in it and not over it (the lowest point of its tyres)", () => {
    const g = townGround(GAME_SEED);
    let checked = 0;
    for (const v of g.plan.props.vehicles) {
      if (v.state === "project" || v.kind === "camper") continue;
      const m = new MeshBuilder();
      vehicleGeometry(g, { solid: () => m, glass: () => new MeshBuilder() }, v, "full");
      let low = Infinity;
      m.forEachPosition(0, (_x, y) => {
        low = Math.min(low, y);
      });
      const ground = groundAt(g, g.anchor.x + v.x, g.anchor.z + v.z);
      // A slope moves the lowest tyre by a few centimetres; a derelict sits a little lower on flat tyres.
      expect(low - ground, `vehicle ${v.id} ${v.kind}`).toBeGreaterThan(-0.45);
      expect(low - ground, `vehicle ${v.id} ${v.kind}`).toBeLessThan(0.45);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
