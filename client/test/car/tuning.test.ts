import { describe, expect, it } from "vitest";
import { manifestOf } from "../../src/game/town/props/vehicleManifest.js";
import { AXLE_FRONT, AXLE_REAR, CAR_HEIGHT, CAR_LENGTH, CAR_WIDTH, TRACK, WHEELBASE, WHEEL_RADIUS } from "../../src/sim/car/tuning.js";

describe("the car's body numbers", () => {
  // The simulation cannot read the model's manifest, so the sedan's numbers are copied into `tuning.ts`: this holds the copy to it.
  const sedan = manifestOf("vehicle.sedan_a");

  it("are the sedan's footprint, wheels, wheelbase and track in the model manifest", () => {
    expect([CAR_LENGTH, CAR_WIDTH, CAR_HEIGHT]).toEqual([sedan.footprint.length, sedan.footprint.width, sedan.footprint.height]);
    const [fl, fr, rl, rr] = sedan.wheels as [typeof sedan.wheels[number], typeof sedan.wheels[number], typeof sedan.wheels[number], typeof sedan.wheels[number]];
    expect([fl.x, fr.x]).toEqual([AXLE_FRONT, AXLE_FRONT]);
    expect([rl.x, rr.x]).toEqual([AXLE_REAR, AXLE_REAR]);
    expect([Math.abs(fl.z), Math.abs(fr.z), Math.abs(rl.z), Math.abs(rr.z)]).toEqual([TRACK / 2, TRACK / 2, TRACK / 2, TRACK / 2]);
    for (const w of sedan.wheels) expect(w.r).toBe(WHEEL_RADIUS);
    expect((sedan as unknown as { wheelbase: number }).wheelbase).toBe(WHEELBASE);
    expect((sedan as unknown as { track: number }).track).toBe(TRACK);
    expect(AXLE_FRONT - AXLE_REAR).toBeCloseTo(WHEELBASE, 9);
  });
});
