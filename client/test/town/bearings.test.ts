import { describe, expect, it } from "vitest";
import { BEARINGS, COMPASS, bearingU, bearingV, gridAngle, nearestBearing } from "../../src/sim/town/bearings.js";

describe("bearings", () => {
  it("are Pythagorean triples, and the degrees written beside each are its angle from north toward east", () => {
    for (const t of BEARINGS) {
      expect(t.a * t.a + t.b * t.b).toBe(t.c * t.c);
      expect(t.b).toBeGreaterThanOrEqual(0);
      const deg = (Math.atan2(t.a, t.b) * 180) / Math.PI;
      expect(Math.abs(deg - t.deg)).toBeLessThan(0.01);
    }
  });

  it("hold every angle the brief names, each on both hands", () => {
    const want: [number, number, number, number][] = [
      [0, 1, 1, 0], [7, 24, 25, 16.26], [5, 12, 13, 22.62], [8, 15, 17, 28.07], [3, 4, 5, 36.87], [20, 21, 29, 43.6],
      [21, 20, 29, 46.4], [4, 3, 5, 53.13], [15, 8, 17, 61.93], [12, 5, 13, 67.38], [24, 7, 25, 73.74],
    ];
    for (const [a, b, c, deg] of want) {
      const hit = BEARINGS.find((t) => t.a === a && t.b === b && t.c === c);
      expect(hit?.deg, `${a},${b},${c}`).toBe(deg);
      if (a !== 0) expect(BEARINGS.find((t) => t.a === -a && t.b === b && t.c === c)?.deg).toBe(-deg);
    }
    expect(COMPASS.deg).toBe(0);
  });

  it("give orthonormal axes", () => {
    for (const t of BEARINGS) {
      const u = bearingU(t);
      const v = bearingV(t);
      expect(Math.abs(u.x * u.x + u.z * u.z - 1)).toBeLessThan(1e-12);
      expect(Math.abs(u.x * v.x + u.z * v.z)).toBeLessThan(1e-12);
      expect(v.x).toBeGreaterThanOrEqual(0); // v points inland
    }
  });

  it("find the triple nearest a line, a line having no sense", () => {
    expect(nearestBearing(0, 1)).toBe(COMPASS);
    expect(nearestBearing(0, -1)).toBe(COMPASS);
    expect(nearestBearing(3, 4).deg).toBe(36.87);
    expect(nearestBearing(-3, -4).deg).toBe(36.87);
    expect(nearestBearing(-3, 4).deg).toBe(-36.87);
    expect(nearestBearing(0.001, 1)).toBe(COMPASS);
  });

  it("measure the angle between two grids as at most a quarter turn", () => {
    const a = BEARINGS.find((t) => t.deg === 73.74)!;
    const b = BEARINGS.find((t) => t.deg === -73.74)!;
    expect(gridAngle(a, b)).toBeCloseTo(32.52, 2);
    expect(gridAngle(COMPASS, a)).toBe(73.74);
  });
});
