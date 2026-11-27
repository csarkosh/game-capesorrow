// The parked vehicles the ground holds (`sim/town/parked.ts`): the plan puts a few where the made ground is no plane (seed 6 parks curb
// cars on a street of the old plat that runs along a bank), and every reader outside the plan leaves the same ones out: the drawn fleet,
// the code-built cars, the oil stains and the props' solids. The predicate reads the ground the town is drawn on.
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { groundStains } from "../../src/game/town/groundStains.js";
import { groundAt } from "../../src/game/town/props/kit.js";
import { fleetOf } from "../../src/game/town/props/vehicleFleet.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import { absentVehicles, isVehicleBox, parkedGroundAt, standingVehicles } from "../../src/sim/town/parked.js";
import { propSolids } from "../../src/sim/town/propSolid.js";
import { STRIDE } from "../../src/sim/town/solid.js";
import { WORLD_SEEDS } from "./world.js";

function stains(g: TownGround): number[] {
  const m = new MeshBuilder();
  groundStains(g, () => m);
  return Array.from(m.finish().positions);
}

describe("the parked vehicles the ground holds", () => {
  it("leaves out a vehicle of seed 6 on its bank, and most of every town's", () => {
    for (const seed of WORLD_SEEDS) {
      const all = townGround(seed).plan.props.vehicles.length;
      const left = absentVehicles(seed).length;
      expect(standingVehicles(seed).length + left, `seed ${seed}`).toBe(all);
      expect(left, `seed ${seed}`).toBeLessThan(all * 0.15);
      if (seed === 6) expect(left).toBeGreaterThan(0);
    }
  });

  it("reads the ground the town is drawn on, without the drawing's lift", () => {
    for (const seed of WORLD_SEEDS) {
      const g = townGround(seed);
      for (const v of g.plan.props.vehicles.slice(0, 30)) {
        const x = g.anchor.x + v.x;
        const z = g.anchor.z + v.z;
        expect(parkedGroundAt(seed, x, z), `seed ${seed} #${v.id}`).toBeCloseTo(groundAt(g, x, z) - 0.015, 6);
      }
    }
  });

  it("is the same list for the fleet, the stains and the solids", () => {
    for (const seed of WORLD_SEEDS) {
      const g = townGround(seed);
      const standing = standingVehicles(seed);
      const absent = absentVehicles(seed);
      // The fleet: the standing vehicles that have a model, in order.
      expect(fleetOf(g, "full").map((f) => f.vehicle.id), `seed ${seed}`).toEqual(standing.filter((v) => v.model !== "").map((v) => v.id));
      // The stains: what a plan holding only the standing vehicles would lay.
      const only = { ...g, plan: { ...g.plan, props: { ...g.plan.props, vehicles: standing } } };
      expect(stains(g), `seed ${seed}`).toEqual(stains(only));
      // The solids: every standing vehicle's box and none of an absent one's.
      const solids = propSolids(seed);
      const boxes = [];
      for (let i = 0; i < solids.rects.length / STRIDE; i++) {
        const o = i * STRIDE;
        boxes.push({ cx: solids.rects[o]! - g.anchor.x, cz: solids.rects[o + 1]! - g.anchor.z, ux: solids.rects[o + 2]!, uz: solids.rects[o + 3]!, hu: solids.rects[o + 4]!, hv: solids.rects[o + 5]! });
      }
      const near = (b: { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number }, v: (typeof standing)[number]): boolean =>
        Math.abs(b.cx - v.x) < 1e-6 && Math.abs(b.cz - v.z) < 1e-6 && isVehicleBox({ ...b, cx: v.x, cz: v.z }, v);
      for (const v of standing) expect(boxes.some((b) => near(b, v)), `seed ${seed} #${v.id}`).toBe(true);
      for (const v of absent) expect(boxes.some((b) => near(b, v)), `seed ${seed} #${v.id}`).toBe(false);
    }
  });
});
