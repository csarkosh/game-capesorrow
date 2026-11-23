// The parked vehicles that stand as real models: every vehicle of a town has a model or is built in code, the sim's table of sizes is the
// manifest's, each model stands on the ground on its four wheels, the walker's box holds the model's footprint, and no two instances of
// one model and one colour share a look.
import { describe, expect, it } from "vitest";
import { fleetOf } from "../../src/game/town/props/vehicleFleet.js";
import { MANIFEST, manifestOf } from "../../src/game/town/props/vehicleManifest.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { VEHICLE_MODELS } from "../../src/sim/town/port/props/vehicleModels.js";
import { WORLD_SEEDS } from "./world.js";

const SEEDS = WORLD_SEEDS;

describe("the vehicle models", () => {
  it("are the sim's table of sizes: the manifest's footprints, to the millimetre", () => {
    expect(Object.keys(VEHICLE_MODELS).sort()).toEqual(MANIFEST.vehicles.map((v) => v.id).sort());
    for (const v of MANIFEST.vehicles) {
      const m = VEHICLE_MODELS[v.id]!;
      expect(m.length, v.id).toBeCloseTo(v.footprint.length, 3);
      expect(m.width, v.id).toBeCloseTo(v.footprint.width, 3);
    }
  });

  it("are given to every vehicle of a town, or it is a camper built in code", () => {
    for (const seed of SEEDS) {
      const { plan } = townGround(seed);
      for (const v of plan.props.vehicles) {
        if (v.kind === "camper") expect(v.model, `seed ${seed} #${v.id}`).toBe("");
        else expect(manifestOf(v.model).id, `seed ${seed} #${v.id}`).toBe(v.model);
      }
    }
  });

  it("have the kind's own sort: pickups are pickups, derelicts and project cars are the worn models", () => {
    for (const seed of SEEDS) {
      for (const v of townGround(seed).plan.props.vehicles) {
        if (v.kind === "camper") continue;
        if (v.state === "project") expect(v.model).toBe("vehicle.covered");
        else if (v.state === "derelict") expect(["vehicle.covered", "vehicle.derelict_sedan", "vehicle.derelict_truck"]).toContain(v.model);
        else if (v.kind === "pickup") expect(["vehicle.pickup_a", "vehicle.pickup_b"]).toContain(v.model);
        else if (v.kind === "sedan") expect(["vehicle.sedan_a", "vehicle.sedan_b"]).toContain(v.model);
        else if (v.kind === "suv") expect(["vehicle.wagon", "vehicle.hatch"]).toContain(v.model);
        else if (v.kind === "van") expect(v.model).toBe("vehicle.van");
        else expect(["vehicle.flatbed", "vehicle.boxtruck"]).toContain(v.model);
      }
    }
  });
});

describe("the paint", () => {
  it("never gives two neighbours of one model the same colour, and is a spread, not black and charcoal", () => {
    for (const seed of SEEDS) {
      const vs = townGround(seed).plan.props.vehicles.filter((v) => v.model !== "" && v.state !== "derelict" && v.state !== "project");
      let dark = 0;
      for (const [i, a] of vs.entries()) {
        if (a.colour === 2 || a.colour === 3) dark++;
        for (const b of vs.slice(i + 1)) {
          if (a.model !== b.model || (a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 45 * 45) continue;
          expect(a.colour, `seed ${seed} #${a.id} and #${b.id}`).not.toBe(b.colour);
        }
      }
      expect(dark / Math.max(1, vs.length), `seed ${seed}`).toBeLessThan(0.2);
    }
  });
});

describe("the fleet", () => {
  it("stands every vehicle on the ground: each wheel within 5 cm of it and none in it", () => {
    for (const seed of SEEDS) {
      const fleet = fleetOf(townGround(seed), "full");
      expect(fleet.length, `seed ${seed}`).toBeGreaterThan(20);
      for (const f of fleet) {
        for (const c of f.contacts) {
          expect(Math.abs(c.y - c.ground), `seed ${seed} #${f.vehicle.id} ${f.model}`).toBeLessThan(0.05);
          expect(c.y - c.ground, `seed ${seed} #${f.vehicle.id}`).toBeGreaterThan(-0.005);
        }
      }
    }
  });

  it("is drawn from the plan's box: the walker's box holds the model's footprint", () => {
    for (const seed of SEEDS) {
      for (const v of townGround(seed).plan.props.vehicles) {
        if (v.model === "") continue;
        const f = manifestOf(v.model).footprint;
        expect(v.length / 2, `#${v.id}`).toBeGreaterThanOrEqual(Math.max(-f.x[0], f.x[1]) - 0.002);
        expect(v.width / 2, `#${v.id}`).toBeGreaterThanOrEqual(Math.max(-f.z[0], f.z[1]) - 0.002);
      }
    }
  });

  it("draws nothing on the low tier: it keeps its code-built cars", () => {
    expect(fleetOf(townGround(20261121), "low")).toEqual([]);
  });

  it("gives no two vehicles one look: a seed, a paint and a dirt of their own", () => {
    const fleet = fleetOf(townGround(20261121), "full");
    const seen = new Set<string>();
    for (const f of fleet) {
      const key = Array.from(f.data).map((n) => n.toFixed(4)).join(",");
      expect(seen.has(key), `#${f.vehicle.id}`).toBe(false);
      seen.add(key);
    }
  });
});
