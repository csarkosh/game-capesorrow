import { describe, expect, it } from "vitest";
import { MeshBuilder, SURFACE_FLOATS, cutBy, type Vec3 } from "../../src/game/town/meshBuilder.js";
import { EAVE_CODE, EAVE_REACH, EAVE_SHADE, FOOT_CODE, FOOT_REACH, FOOT_UNIT, SOFFIT_SHADE, flatShade, wallShade, type GroundLine, type RoofPlane } from "../../src/game/town/skyShade.js";
import { wallFrame, type Surface } from "../../src/game/town/townSurface.js";

/** A wall 10 m long along +x at z = 0, facing -z, on ground that climbs from 2 m to 3 m along it. */
const GROUND: GroundLine = { ax: 0, az: 0, tx: 1, tz: 0, y: 2, rise: 0.1 };
/** A roof that meets the wall's face at 8 m and falls outward (toward -z) at 1 in 2. */
const ROOF: RoofPlane = { x: 0, z: 0, y: 8, gx: 0, gz: 0.5 };

const area = (p: readonly Vec3[]): number => {
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 1; i + 1 < p.length; i++) {
    const a = p[0] as Vec3;
    const b = p[i] as Vec3;
    const c = p[i + 1] as Vec3;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    ax += u[1] * v[2] - u[2] * v[1];
    ay += u[2] * v[0] - u[0] * v[2];
    az += u[0] * v[1] - u[1] * v[0];
  }
  return Math.sqrt(ax * ax + ay * ay + az * az) / 2;
};

describe("where a wall's corner stands under the sky", () => {
  it("is its height over the ground, which follows the slope", () => {
    const { at, cuts } = wallShade(GROUND, []);
    expect(at([0, 2, 0])[0]).toBeCloseTo(FOOT_CODE * FOOT_UNIT, 6);
    expect(at([10, 3, 0])[0]).toBeCloseTo(FOOT_CODE * FOOT_UNIT, 6);
    expect(at([10, 3 + FOOT_REACH, 0])[0]).toBeCloseTo((FOOT_CODE + FOOT_REACH) * FOOT_UNIT, 6);
    // Straight along the wall and up it: the renderer's interpolation between two corners is the height between them.
    expect(at([5, 4.5, 0])[0]).toBeCloseTo((at([0, 2, 0])[0] + at([10, 7, 0])[0]) / 2, 6);
    // Never 0 (no shade) nor a wire's negative, however deep the wall is buried.
    expect(at([0, -50, 0])[0]).toBe(0.5 * FOOT_UNIT);
    // No roof over it: no depth, and nothing to cut the wall along.
    expect(at([5, 7, 0])[1]).toBe(0);
    expect(cuts).toEqual([]);
  });

  it("is its depth under the roof", () => {
    const { at } = wallShade(GROUND, [ROOF]);
    expect(at([5, 8, 0])[1]).toBeCloseTo(EAVE_CODE, 6);
    expect(at([5, 8 - EAVE_REACH, 0])[1]).toBeCloseTo(EAVE_CODE + EAVE_REACH, 6);
    expect(at([5, 5, 0])[1]).toBeCloseTo(EAVE_CODE + 3, 6);
  });

  it("under two slopes, is its depth under the nearer, and the wall is cut where they meet", () => {
    const other: RoofPlane = { x: 0, z: 0, y: 7.5, gx: 0, gz: -0.5 };
    const crease = [1, 0, 0, -5] as const;
    const shade = wallShade(GROUND, [ROOF, other], [crease]);
    expect(shade.at([5, 7.5, 0])[1]).toBeCloseTo(EAVE_CODE, 6);
    expect(shade.cuts).toEqual([crease]);
    // One slope has no crease.
    expect(wallShade(GROUND, [ROOF], [crease]).cuts).toEqual([]);
  });

  it("a face that sees a fixed share of the sky carries the depth the material eases to that share", () => {
    for (const sky of [SOFFIT_SHADE, EAVE_SHADE, 0.7, 1]) {
      const [foot, eave] = flatShade(sky).at([0, 0, 0]);
      expect(foot).toBe(0);
      const t = Math.min(1, Math.max(0, (eave - EAVE_CODE) / EAVE_REACH));
      const got = EAVE_SHADE + (1 - EAVE_SHADE) * t * t * (3 - 2 * t);
      expect(got).toBeCloseTo(Math.max(sky, EAVE_SHADE), 4);
    }
  });
});

describe("a polygon cut along planes", () => {
  const quad: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 8, 0], [0, 8, 0]];

  it("is itself when no plane crosses it", () => {
    expect(cutBy(quad, [[0, 1, 0, -9], [0, 1, 0, 1]])).toEqual([quad]);
    // A plane along one of its edges does not cut it.
    expect(cutBy(quad, [[0, 1, 0, -8]])).toEqual([quad]);
  });

  it("is pieces of the same area, each on one side of every plane", () => {
    const cuts = [[0, 1, 0, -3], [0, 1, 0, -6], [Math.SQRT1_2, Math.SQRT1_2, 0, -6]] as const;
    const pieces = cutBy(quad, cuts);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(80, 6);
    for (const piece of pieces) {
      for (const c of cuts) {
        const d = piece.map((p) => c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3]);
        expect(Math.min(...d) >= -1e-6 || Math.max(...d) <= 1e-6).toBe(true);
      }
    }
  });
});

describe("a wall laid with its shade", () => {
  const wall: Vec3[] = [[0, 1.5, 0], [10, 1.5, 0], [10, 8, 0], [0, 8, 0]];

  it("is not cut, keeps its colour and its tint, and carries its two codes in its corners", () => {
    const shade = wallShade(GROUND, [ROOF]);
    const surface: Surface = { layer: "brick", frame: wallFrame(0, 0, 1, 0, 1.5), tint: [0.9, 0.8, 0.7], shade };
    const mesh = new MeshBuilder();
    mesh.poly(wall, [0, 0, -1], [0.5, 0.4, 0.3], surface);
    const a = mesh.finish();
    expect(a.positions.length / 3).toBe(4);
    for (let i = 0; i < 4; i++) {
      const p: Vec3 = [a.positions[i * 3] as number, a.positions[i * 3 + 1] as number, a.positions[i * 3 + 2] as number];
      const [foot, eave] = shade.at(p);
      expect(a.colors[i * 4] as number).toBeCloseTo(0.5, 5);
      expect(a.surface[i * SURFACE_FLOATS + 4] as number).toBeCloseTo(0.9, 5);
      expect(a.surface[i * SURFACE_FLOATS + 10] as number).toBeCloseTo(foot, 5);
      expect(a.surface[i * SURFACE_FLOATS + 11] as number).toBeCloseTo(eave, 5);
      // A wire is a first code under -0.5 (`townMaterial.ts`) and a room's hours are 1 or more (`hours.ts`): a wall's is between the two.
      expect(a.surface[i * SURFACE_FLOATS + 10] as number).toBeGreaterThan(0.25 * FOOT_UNIT);
      expect(a.surface[i * SURFACE_FLOATS + 10] as number).toBeLessThan(0.5);
    }
  });

  it("is cut along its shade's planes", () => {
    const shade = wallShade(GROUND, [ROOF, { x: 0, z: 0, y: 8, gx: 0, gz: -0.5 }], [[1, 0, 0, -5]]);
    const mesh = new MeshBuilder();
    mesh.poly(wall, [0, 0, -1], [0.5, 0.4, 0.3], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 1.5), shade });
    expect(mesh.finish().positions.length / 3).toBe(8);
  });

  it("the flat ground's depth rank is kept where the second code would be", () => {
    const mesh = new MeshBuilder();
    mesh.poly(wall, [0, 0, -1], [0.5, 0.4, 0.3], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 1.5), shade: wallShade(GROUND, [ROOF]) }, { rank: 3 });
    expect(mesh.finish().surface[11]).toBe(3);
  });

  it("is laid as it was when it has no shade", () => {
    const mesh = new MeshBuilder();
    mesh.poly(wall, [0, 0, -1], [0.5, 0.4, 0.3], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 1.5) });
    const a = mesh.finish();
    expect(a.positions.length / 3).toBe(4);
    expect(Array.from(a.colors.slice(0, 4))).toEqual([0.5, 0.4, 0.3, 1].map((v) => Math.fround(v)));
    expect(a.surface[10]).toBe(0);
    expect(a.surface[11]).toBe(0);
  });
});
