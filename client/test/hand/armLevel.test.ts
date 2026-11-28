import { describe, expect, it } from "vitest";
import { ARM_LIFT_MAX, ARM_NIGHT_FLOOR, ARM_ROOM_OPEN, ARM_ROOM_SHUT, armLevel, armLift } from "../../src/game/hand/armLevel.js";
import { daylightAt, litGainAt } from "../../src/look.js";
import { emptyTownReady, townSurfaceCode } from "../../src/game/town/townMaterial.js";

describe("how lit the arms are where the player stands", () => {
  it("is full outdoors at noon, and well under a fifth of that at 22:00, and rises with the day between", () => {
    const noon = armLevel(daylightAt(12), "street");
    const night = armLevel(daylightAt(22), "street");
    expect(noon).toBeCloseTo(1, 3);
    expect(night).toBeLessThan(noon / 5);
    expect(night).toBeCloseTo(ARM_NIGHT_FLOOR, 3);
    const dawn = armLevel(daylightAt(6.3), "street");
    expect(dawn).toBeGreaterThanOrEqual(night);
    expect(dawn).toBeLessThanOrEqual(noon);
    // Never above 1, never below the floor, whatever the day.
    for (const d of [-1, 0, 0.3, 1, 2]) {
      expect(armLevel(d, "street")).toBeGreaterThanOrEqual(ARM_NIGHT_FLOOR);
      expect(armLevel(d, "street")).toBeLessThanOrEqual(1);
    }
  });

  it("is a room's own in a room: its middle level where it is lit, and dim in a shut shop, a little more by day through the glass", () => {
    expect(armLevel(0, "open room")).toBe(ARM_ROOM_OPEN);
    expect(armLevel(1, "open room")).toBe(ARM_ROOM_OPEN);
    expect(armLevel(0, "shut room")).toBe(ARM_ROOM_SHUT);
    expect(armLevel(1, "shut room")).toBeGreaterThan(ARM_ROOM_SHUT);
    expect(armLevel(1, "shut room")).toBeLessThan(ARM_ROOM_OPEN);
    // A lit room is dimmer than noon outdoors and brighter than a night street.
    expect(ARM_ROOM_OPEN).toBeLessThan(armLevel(1, "street"));
    expect(ARM_ROOM_OPEN).toBeGreaterThan(armLevel(0, "street"));
  });

  it("lifts a hand by a lit torch by no more than 0.15 of its albedo, by day and at night, and not at all with the torch off", () => {
    for (const hour of [3, 12, 22]) {
      const gain = litGainAt(hour);
      // The lift is added to a glow, which the material multiplies by the hour's lit gain.
      expect(armLift(1, gain) * gain).toBeLessThanOrEqual(ARM_LIFT_MAX + 1e-9);
      expect(armLift(0, gain)).toBe(0);
      expect(armLift(0.5, gain)).toBeLessThan(armLift(1, gain));
    }
  });

  it("is in the arms' material only: the arm variant's code reads the uniform, no other variant's does, and the town's record holds it", () => {
    expect(townSurfaceCode(false, false, false, undefined, true, true)).toContain("material.armLevel.x");
    expect(townSurfaceCode(false, false, false, undefined, true, true)).toContain("material.armLevel.y");
    expect(townSurfaceCode(false, false, false, undefined, true, false)).not.toContain("armLevel");
    expect(townSurfaceCode(false, false, false, undefined, false, false)).not.toContain("armLevel");
    expect(emptyTownReady().armLevel).toEqual([1, 0, 0, 0]);
  });
});
