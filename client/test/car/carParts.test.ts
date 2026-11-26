import { describe, expect, it, vi } from "vitest";
import { CAPACITY, CAR_MODEL, PATCH_AHEAD_UNITS, PATCH_ALPHA, PATCH_LIFT, createCarParts, drawnOf, patchGeometry } from "../../src/game/car/carParts.js";
import { SHADE_AHEAD_UNITS } from "../../src/game/town/townParts.js";
import { manifestOf } from "../../src/game/town/props/vehicleManifest.js";
import type { Car } from "../../src/sim/car/types.js";

function car(x: number, id = 1): Car {
  return { id, x, y: 0, z: 0, hx: 1, hz: 0, speed: 10, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, owed: 0, seats: [0, 0, 0, 0] };
}

// The model is never begun: the poses need only the ground.
const parts = () => createCarParts({ groundAt: () => 0 } as unknown as Parameters<typeof createCarParts>[0]);

describe("the car's frames", () => {
  it("draws the car the local player drives between the last tick's car and this tick's, by alpha, as the eye is", () => {
    const p = parts();
    p.frame([car(0)], 10, 0.5, 0.016, 1);
    // The first frame has no tick before it: the car as it is.
    expect(p.pose(1)?.x).toBe(0);
    p.frame([car(1)], 11, 0.25, 0.016, 1);
    expect(p.pose(1)?.x).toBeCloseTo(0.25, 6);
    // Another frame of the same tick: the same two cars, a later alpha.
    p.frame([car(1)], 11, 0.75, 0.016, 1);
    expect(p.pose(1)?.x).toBeCloseTo(0.75, 6);
  });

  it("blends over the one tick the eye does when a frame saw two pass", () => {
    const p = parts();
    p.frame([car(0)], 10, 0, 0.016, 1);
    p.frame([car(1)], 11, 0.5, 0.016, 1);
    // Two ticks at once: the car moved from 1 m to 3 m, and the blend starts a tick back, at 2 m: halfway on is 2.5 m.
    p.frame([car(3)], 13, 0.5, 0.016, 1);
    expect(p.pose(1)?.x).toBeCloseTo(2.5, 6);
  });

  it("draws every other car as it is: already blended for the frame, so alpha does not lag it", () => {
    const p = parts();
    p.frame([car(0)], 10, 0.5, 0.016, 0);
    p.frame([car(1)], 11, 0.25, 0.016, 0);
    expect(p.pose(1)?.x).toBe(1);
    // A car another player drives is not the local player's even when the local player is in one.
    p.frame([car(5, 2), car(2)], 12, 0.25, 0.016, 2);
    expect(p.pose(1)?.x).toBe(2);
    expect(p.pose(2)?.x).toBe(5);
  });

  it("poses the driven car whatever the count of cars, though only a few are drawn", () => {
    const p = parts();
    const cars = [car(0, 1), car(1, 2), car(2, 3), car(3, 4), car(4, 5), car(77, 6)];
    p.frame(cars, 1, 0, 0.016, 6);
    expect(p.pose(6)?.x).toBe(77);
    expect(p.pose(5)).not.toBeNull();
  });

  describe("which cars are drawn", () => {
    const pick = (ids: number[], driven: number): number[] => {
      const out: number[] = [];
      const n = drawnOf(ids, CAPACITY, driven, out);
      return out.slice(0, n);
    };
    it("draws all of three, the driven one first among them", () => {
      expect(pick([7, 8, 9], 7)).toEqual([0, 1, 2]);
    });
    it("draws the driven car last of five in the place of the fourth", () => {
      const got = pick([1, 2, 3, 4, 5], 5);
      expect(got).toHaveLength(4);
      expect(got).toContain(4);
      expect(got).not.toContain(3);
      expect(got).toEqual([0, 1, 2, 4]);
    });
    it("draws the first four of five when the driven car is the second", () => {
      expect(pick([1, 2, 3, 4, 5], 2)).toEqual([0, 1, 2, 3]);
    });
    it("draws the first four of four with none driven", () => {
      expect(pick([1, 2, 3, 4], 0)).toEqual([0, 1, 2, 3]);
    });
    it("draws the driven third of six, and the first four", () => {
      expect(pick([1, 2, 3, 4, 5, 6], 3)).toEqual([0, 1, 2, 3]);
    });
    it("draws none of none, and leaves a driven car that is not there out", () => {
      expect(pick([], 5)).toEqual([]);
      expect(pick([1, 2, 3, 4, 5], 99)).toEqual([0, 1, 2, 3]);
    });
  });

  it("answers null for a car the frame does not have, and poses without the model", () => {
    const p = parts();
    p.frame([car(0)], 1, 0, 0.016, 0);
    expect(p.pose(1)).not.toBeNull();
    expect(p.pose(9)).toBeNull();
    p.frame([], 2, 0, 0.016, 0);
    expect(p.pose(1)).toBeNull();
  });

  it("goes on posing, seeing and being let go with no model, and says nothing", () => {
    const p = parts();
    const warn = vi.spyOn(console, "warn");
    p.frame([car(0)], 1, 0, 0.1, 0);
    p.frame([car(0)], 2, 0, 0.1, 0);
    p.seen([]);
    p.dispose();
    p.frame([car(0)], 3, 0, 0.1, 0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the patch under the car", () => {
  const g = patchGeometry();
  const at = (v: number): [number, number, number] => [g.positions[v * 3] as number, g.positions[v * 3 + 1] as number, g.positions[v * 3 + 2] as number];
  const vertices = g.positions.length / 3;

  it("lies PATCH_LIFT over the wheels' plane, inside the footprint like the parked cars' patch", () => {
    const f = manifestOf(CAR_MODEL).footprint;
    let hl = 0;
    let hw = 0;
    for (let v = 0; v < vertices; v++) {
      const [x, y, z] = at(v);
      expect(y).toBeCloseTo(PATCH_LIFT, 6);
      hl = Math.max(hl, Math.abs(x));
      hw = Math.max(hw, Math.abs(z));
    }
    expect(hl).toBeCloseTo(f.length / 2 - 0.3, 6);
    expect(hw).toBeCloseTo(f.width / 2 - 0.22, 6);
  });

  it("is wound with every face up and carries an up normal on each vertex", () => {
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [at(g.indices[t] as number), at(g.indices[t + 1] as number), at(g.indices[t + 2] as number)];
      const u = [b[0] - a[0], b[2] - a[2]];
      const w = [c[0] - a[0], c[2] - a[2]];
      expect((u[1] as number) * (w[0] as number) - (u[0] as number) * (w[1] as number)).toBeGreaterThan(0);
    }
    for (let v = 0; v < vertices; v++) expect(g.normals[v * 3 + 1]).toBe(1);
  });

  it("is full dark from the middle to the inner ring and clear at the rim", () => {
    expect(g.colors.length).toBe(vertices * 4);
    expect(g.colors[3]).toBe(1);
    for (let v = 1; v <= 8; v++) expect(g.colors[v * 4 + 3]).toBe(1);
    for (let v = 9; v <= 16; v++) expect(g.colors[v * 4 + 3]).toBe(0);
    expect(PATCH_ALPHA).toBeCloseTo(0.9, 6);
  });
});

describe("the patch's depth step", () => {
  it("is the town's own, so the patch sits where the dark at the walls' feet does", () => {
    expect(PATCH_AHEAD_UNITS).toBe(SHADE_AHEAD_UNITS);
  });
});
