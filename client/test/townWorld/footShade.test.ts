import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { FOOT_DARK, FOOT_OUT, FOOT_SEED, footLook, footShade, type FootWall } from "../../src/game/town/footShade.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import type { Building } from "../../src/sim/town/types.js";

/** Level ground at 2 m, far from any town's buildings, with a deck only where `deck` says. */
function ground(deck: (x: number, z: number) => number = () => -Infinity): TownGround {
  return { seed: 7, heightAt: () => 2, deckAt: deck } as unknown as TownGround;
}

/** A rectangle 10 m by 6 m standing far outside the town: its four walls, each from left to right as seen from outside. */
function box(): FootWall[] {
  const x0 = 6_000;
  const z0 = 6_000;
  const c: [number, number][] = [[x0, z0], [x0 + 10, z0], [x0 + 10, z0 + 6], [x0, z0 + 6]];
  const n: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  return c.map(([ax, az], i) => {
    const [bx, bz] = c[(i + 1) % 4] as [number, number];
    const [nx, nz] = n[i] as [number, number];
    return { ax, az, bx, bz, nx, nz, length: Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) };
  });
}

const b = { id: 41 } as unknown as Building;

describe("the dark on the ground at a wall's foot", () => {
  it("has a reach and a depth of the building's own, near the set ones", () => {
    const looks = [1, 2, 3, 40, 41, 999].map(footLook);
    for (const l of looks) {
      expect(l.reach).toBeGreaterThanOrEqual(FOOT_OUT * 0.75);
      expect(l.reach).toBeLessThanOrEqual(FOOT_OUT * 1.25);
      expect(l.dark).toBeGreaterThanOrEqual(FOOT_DARK * 0.8);
      expect(l.dark).toBeLessThanOrEqual(FOOT_DARK * 1.1);
    }
    expect(new Set(looks.map((l) => l.reach.toFixed(4))).size).toBeGreaterThan(3);
    expect(footLook(41)).toEqual(footLook(41));
  });

  it("is a sheet along each wall and a fan at each corner, dark at the wall and clear at its reach", () => {
    const m = new MeshBuilder();
    footShade(ground(), m, b, box(), false, 0);
    const a = m.take();
    const n = a.positions.length / 3;
    const { reach, dark } = footLook(41);
    // Walls of 10 m and 6 m in strips of at most 6 m: two, one, two, one; and four corners. Four corners each.
    expect(n).toBe((2 + 1 + 2 + 1 + 4) * 4);
    let atWall = 0;
    for (let i = 0; i < n; i++) {
      const x = (a.positions[i * 3] as number) - 6_000;
      const y = a.positions[i * 3 + 1] as number;
      const z = (a.positions[i * 3 + 2] as number) - 6_000;
      const v = a.uvs[i * 2 + 1] as number;
      // How far outside the rectangle the corner stands.
      const dx = Math.max(-x, 0, x - 10);
      const dz = Math.max(-z, 0, z - 6);
      const out = Math.sqrt(dx * dx + dz * dz);
      expect(y).toBeCloseTo(2.06, 3);
      expect(a.surface[i * 12 + 2]).toBe(FOOT_SEED);
      expect(a.surface[i * 12 + 11]).toBeCloseTo(dark, 5);
      if (v === 1) {
        expect(out).toBeLessThan(1e-3);
        atWall++;
      } else {
        expect(v).toBe(0);
        expect(out).toBeGreaterThan(reach * 0.99);
        expect(out).toBeLessThan(reach * 1.01);
      }
    }
    // Two corners of each strip and one of each fan stand at the wall.
    expect(atWall).toBe(6 * 2 + 4);
  });

  it("lies on a pile building's deck, and not where the deck ends", () => {
    const whole = new MeshBuilder();
    footShade(ground(() => 5), whole, b, box(), true, 5);
    const laid = whole.take();
    expect(laid.positions.length / 3).toBe(40);
    for (let i = 1; i < laid.positions.length; i += 3) expect(laid.positions[i]).toBeCloseTo(5.06, 3);
    const none = new MeshBuilder();
    footShade(ground(), none, b, box(), true, 5);
    expect(none.vertices).toBe(0);
    // A deck that ends at the south wall: no strip before that wall, and no fan at its two corners.
    const part = new MeshBuilder();
    footShade(ground((_x, z) => (z > 6_000 - 0.2 ? 5 : -Infinity)), part, b, box(), true, 5);
    expect(part.take().positions.length / 3).toBe((1 + 2 + 1 + 2) * 4);
  });
});
