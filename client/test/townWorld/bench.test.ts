import { describe, expect, it } from "vitest";
import { benchSide } from "../../src/game/town/props/streetGeometry.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import type { Furniture } from "../../src/sim/town/types.js";

/**
 * A bench on a sidewalk lies along the kerb and looks at the street, its back to the buildings. It was once drawn a quarter turn off the
 * footprint the plan gives it (1.7 m along the street's heading), so it looked along the street; and nothing said which side its back was.
 * The side is the one the bench's lot fronts (`Lot.front`, the unit vector from the lot toward its street).
 */
const ground = (front: { x: number; z: number } | null): TownGround => ({ plan: { lots: front === null ? [] : [{ front }] } }) as unknown as TownGround;
const bench = (hx: number, hz: number): Furniture => ({ id: 1, kind: "bench", x: 0, z: 0, hx, hz, state: 0, lean: 0, colour: 0, lot: 0, seed: 1 }) as Furniture;

describe("a bench's facing", () => {
  it("looks the way its lot fronts, whichever way the street's heading runs", () => {
    // Heading +x: the place's left is +z. A lot fronting +z has its street on the left.
    expect(benchSide(ground({ x: 0, z: 1 }), bench(1, 0))).toBe(1);
    expect(benchSide(ground({ x: 0, z: -1 }), bench(1, 0))).toBe(-1);
    // The same street walked the other way: the left is -z.
    expect(benchSide(ground({ x: 0, z: 1 }), bench(-1, 0))).toBe(-1);
    // A skew street (a 3-4-5 bearing).
    expect(benchSide(ground({ x: -0.8, z: 0.6 }), bench(0.6, 0.8))).toBe(1);
    expect(benchSide(ground({ x: 0.8, z: -0.6 }), bench(0.6, 0.8))).toBe(-1);
  });

  it("looks left where it has no lot", () => {
    expect(benchSide(ground(null), bench(1, 0))).toBe(1);
  });
});
