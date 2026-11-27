// The dark under the parked vehicles (`props/vehicleShade.ts`): every parked vehicle of a town has a sheet on the ground it stands on, full inside
// and nothing at its outer edge, and none of it lies in a building.
import { describe, expect, it } from "vitest";
import { FOOT_SEED } from "../../src/game/town/footShade.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { trailerShade, trailerShadeLook, vehicleShade, vehicleShadeLook, shadePoints, shadeProfile } from "../../src/game/town/props/vehicleShade.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { penetration, solidsNear } from "../../src/sim/town/solid.js";
import type { BoatTrailer, Vehicle } from "../../src/sim/town/types.js";
import { WORLD_SEEDS } from "./world.js";

/** The sheet a vehicle gets, as its arrays. */
function sheetOf(seed: number, v: Vehicle): ReturnType<MeshBuilder["finish"]> {
  const m = new MeshBuilder();
  vehicleShade(townGround(seed), m, v);
  return m.finish();
}

describe("the dark under a parked vehicle", () => {
  it("is rolled by the vehicle's id and moved by its kind and lift: lighter and wider for a high one", () => {
    const sedan = vehicleShadeLook({ id: 5, kind: "sedan", state: "daily" });
    const truck = vehicleShadeLook({ id: 5, kind: "work truck", state: "daily" });
    const blocks = vehicleShadeLook({ id: 5, kind: "sedan", state: "project" });
    expect(truck.reach).toBeGreaterThan(sedan.reach);
    expect(truck.dark).toBeLessThan(sedan.dark);
    expect(blocks.reach).toBeGreaterThan(sedan.reach);
    expect(blocks.dark).toBeLessThan(sedan.dark);
    const rolled = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => vehicleShadeLook({ id, kind: "sedan", state: "daily" }).reach.toFixed(4)));
    expect(rolled.size).toBeGreaterThan(4);
    for (const id of [1, 2, 3, 40, 999]) {
      for (const kind of ["sedan", "suv", "van", "pickup", "work truck", "camper"] as const) {
        const l = vehicleShadeLook({ id, kind, state: "daily" });
        expect(l.reach).toBeGreaterThanOrEqual(0.3);
        expect(l.reach).toBeLessThanOrEqual(0.75);
        expect(l.dark).toBeLessThanOrEqual(0.97);
        expect(l.dark).toBeGreaterThan(0.55);
      }
    }
  });

  it("falls smoothly from full inside the outline to nothing at the reach", () => {
    expect(shadeProfile(-1, 0.5)).toBe(1);
    expect(shadeProfile(0.5, 0.5)).toBe(0);
    let last = 1;
    for (let d = -0.3; d <= 0.5; d += 0.05) {
      const p = shadeProfile(d, 0.5);
      expect(p).toBeLessThanOrEqual(last + 1e-12);
      last = p;
    }
    // Still a fair share at the outline itself.
    expect(shadeProfile(0, 0.5)).toBeGreaterThan(0.5);
  });

  it("has rings of one count, the outer one clear and the inner ones full", () => {
    const rings = shadePoints(2.2, 0.9, 0.5);
    expect(new Set(rings.map((r) => r.length)).size).toBe(1);
    expect((rings[rings.length - 1] as { v: number }[]).every((p) => p.v === 0)).toBe(true);
    expect((rings[0] as { v: number }[]).every((p) => p.v === 1)).toBe(true);
    // The outer ring is the outline pushed out by the reach: its farthest point forward is the nose and the reach.
    const a = Math.max(...(rings[rings.length - 1] as { a: number }[]).map((p) => p.a));
    expect(a).toBeCloseTo(2.2 + 0.5, 5);
  });

  for (const seed of WORLD_SEEDS) {
    it(`covers every parked vehicle of seed ${seed}, on the ground, clear at its edge and out of the buildings`, () => {
      const g = townGround(seed);
      const vehicles = g.plan.props.vehicles;
      expect(vehicles.length).toBeGreaterThan(20);
      let held = 0;
      let corners = 0;
      for (const v of vehicles) {
        const a = sheetOf(seed, v);
        const n = a.positions.length / 3;
        expect(n, `#${v.id}`).toBeGreaterThan(40);
        const ring = (n - 1) / 6;
        const { dark } = vehicleShadeLook(v);
        for (let i = 0; i < n; i++) {
          const x = a.positions[i * 3] as number;
          const y = a.positions[i * 3 + 1] as number;
          const z = a.positions[i * 3 + 2] as number;
          const vee = a.uvs[i * 2 + 1] as number;
          expect(a.surface[i * 12 + 2]).toBe(FOOT_SEED);
          expect(a.surface[i * 12 + 11]).toBeCloseTo(dark, 5);
          // The outer ring is nothing, the middle and the two inner rings are full (unless held clear where there is no ground).
          if (i >= n - ring) expect(vee, `#${v.id} outer ${i}`).toBe(0);
          corners++;
          // On the ground (the deck where it stands on one), or held clear where there is none to lie on.
          const ground = Math.max(g.heightAt(x, z), g.deckAt(x, z));
          if (vee > 0) {
            expect(Math.abs(y - ground), `#${v.id} corner ${i} of seed ${seed}`).toBeLessThan(0.05);
            for (const id of solidsNear(g.seed, x, z)) expect(penetration(g.seed, id, x, z), `#${v.id} in building ${id}`).toBeLessThanOrEqual(0);
          } else if (Math.abs(y - ground) >= 0.05) held++;
        }
        // The middle is full.
        expect(a.uvs[1], `#${v.id} middle`).toBe(1);
      }
      expect(corners).toBeGreaterThan(vehicles.length * 40);
      // Few corners are held off the ground (a deck's end); nearly none.
      expect(held).toBeLessThan(vehicles.length * 3);
    });
  }

  it("is lighter for a bare trailer than for one with a boat, both about a pickup's", () => {
    const bare = trailerShadeLook({ id: 3, boat: "none" });
    const boat = trailerShadeLook({ id: 3, boat: "skiff" });
    expect(bare.dark).toBeLessThan(boat.dark);
    expect(boat.reach).toBeGreaterThan(0.4);
    expect(boat.reach).toBeLessThan(0.7);
  });

  for (const seed of WORLD_SEEDS) {
    it(`covers every boat trailer of seed ${seed} on the ground, clear at its edge and out of the buildings`, () => {
      const g = townGround(seed);
      const trailers: readonly BoatTrailer[] = g.plan.props.trailers;
      for (const t of trailers) {
        const m = new MeshBuilder();
        trailerShade(g, m, t);
        const a = m.finish();
        const n = a.positions.length / 3;
        expect(n).toBe(121);
        for (let i = 0; i < n; i++) {
          const x = a.positions[i * 3] as number;
          const y = a.positions[i * 3 + 1] as number;
          const z = a.positions[i * 3 + 2] as number;
          const vee = a.uvs[i * 2 + 1] as number;
          if (i >= n - 20) expect(vee).toBe(0);
          if (vee > 0) {
            expect(Math.abs(y - Math.max(g.heightAt(x, z), g.deckAt(x, z))), `trailer #${t.id}`).toBeLessThan(0.05);
            for (const id of solidsNear(g.seed, x, z)) expect(penetration(g.seed, id, x, z)).toBeLessThanOrEqual(0);
          }
        }
        expect(a.uvs[1]).toBe(1);
      }
    });
  }
});
