// The dark under the people (`peopleShade.ts`), its pure side: a list of places becomes the instances' floats, and a person's place is under their
// feet, larger for a sitter.
import { describe, expect, it } from "vitest";
import { personShade, shadeFloats, SIT_HALF, STAND_HALF, type ShadePlace } from "../../src/game/town/peopleShade.js";

const place = (over: Partial<ShadePlace> = {}): ShadePlace => ({ x: 10, y: 2, z: -5, yaw: 0, halfAcross: 0.3, halfAlong: 0.2, strength: 0.4, ...over });

describe("the dark under a person", () => {
  it("writes a matrix and a strength for each place, and as many as there is room for", () => {
    const matrices = new Float32Array(16 * 2);
    const data = new Float32Array(4 * 2);
    expect(shadeFloats([place(), place({ x: 1 }), place({ x: 2 })], matrices, data)).toBe(2);
    expect(Array.from(data)).toEqual([expect.closeTo(0.4, 5), 0, 0, 0, expect.closeTo(0.4, 5), 0, 0, 0]);
    // Facing +z with no turn: across is x, along is z, and it stands a little over the ground.
    expect(matrices[0]).toBeCloseTo(0.3, 6);
    expect(matrices[10]).toBeCloseTo(0.2, 6);
    expect(matrices[5]).toBe(1);
    expect(matrices[12]).toBe(10);
    expect(matrices[13]).toBeGreaterThan(2);
    expect(matrices[13]).toBeLessThan(2.05);
    expect(matrices[14]).toBe(-5);
    expect(matrices[15]).toBe(1);
    expect(matrices[16 + 12]).toBe(1);
  });

  it("turns with the yaw: the long way follows the way the person faces", () => {
    const matrices = new Float32Array(16);
    shadeFloats([place({ yaw: Math.PI / 2 })], matrices, new Float32Array(4));
    // Facing +x: the along axis (third column) points along x and the across axis along -z.
    expect(matrices[8]).toBeCloseTo(0.2, 6);
    expect(matrices[10]).toBeCloseTo(0, 6);
    expect(matrices[2]).toBeCloseTo(-0.3, 6);
    expect(matrices[0]).toBeCloseTo(0, 6);
  });

  it("is under the feet, wider across than along, and larger for a sitter", () => {
    const at = { x: 3, y: 1.5, z: 4, yaw: 1 };
    const stand = personShade({ at, person: { seat: null, scale: 1 } });
    const sit = personShade({ at, person: { seat: {}, scale: 1 } });
    expect([stand.x, stand.y, stand.z, stand.yaw]).toEqual([3, 1.5, 4, 1]);
    expect(stand.halfAcross).toBe(STAND_HALF[0]);
    expect(stand.halfAcross).toBeGreaterThan(stand.halfAlong);
    expect(sit.halfAcross).toBe(SIT_HALF[0]);
    expect(sit.halfAcross).toBeGreaterThan(stand.halfAcross);
    expect(personShade({ at, person: { seat: null, scale: 1.05 } }).halfAcross).toBeCloseTo(STAND_HALF[0] * 1.05, 6);
    // Much lighter than a car's dark.
    expect(stand.strength).toBeLessThan(0.7);
  });
});
