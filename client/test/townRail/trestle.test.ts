import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";
import { railCenterX } from "../../src/sim/town/rail.js";
import { TRESTLE_HALF, TRESTLE_TOP, constrainTrestle, trestleTopAt, withTrestles, type SpanSource } from "../../src/sim/town/railDeck.js";
import type { RailSpan } from "../../src/sim/town/railSpans.js";
import { railCell, type RailWorld } from "../../src/game/town/railGeometry.js";
import { railWorld } from "../../src/game/town/railWorld.js";
import { baseGround } from "../../src/sim/town/decks.js";

const SEED = 7;
/** The coast has no sea over the line, so a trestle and a causeway are laid by hand where a test wants them. */
const TRESTLE: RailSpan = { kind: "trestle", a: 2000, b: 2100, depth: 3 };
const CAUSEWAY: RailSpan = { kind: "causeway", a: 2300, b: 2330, depth: 1 };
const spans: SpanSource = (_seed, z0, z1) => [TRESTLE, CAUSEWAY].filter((s) => s.b >= z0 && s.a <= z1);

describe("a trestle's deck", () => {
  it("is floor a player can walk on, TRESTLE_TOP over the grade line, within its half width and its length only", () => {
    const z = 2050;
    const cx = railCenterX(SEED, z);
    expect(trestleTopAt(SEED, cx, z, spans)).toBeCloseTo(roadGradeAt(SEED, z).h + TRESTLE_TOP, 9);
    expect(trestleTopAt(SEED, cx + TRESTLE_HALF - 0.01, z, spans)).not.toBeNull();
    expect(trestleTopAt(SEED, cx + TRESTLE_HALF + 0.01, z, spans)).toBeNull();
    expect(trestleTopAt(SEED, railCenterX(SEED, 1900), 1900, spans)).toBeNull();
    expect(trestleTopAt(SEED, railCenterX(SEED, 2315), 2315, spans)).toBeNull();
    // The deck comes up from the bench at its ends.
    const near = trestleTopAt(SEED, railCenterX(SEED, 2000 - 5.9), 2000 - 5.9, spans) as number;
    expect(near - roadGradeAt(SEED, 2000 - 5.9).h).toBeLessThan(0.05);
    const field = withTrestles(baseGround(SEED), SEED, spans);
    expect(field.heightAt(cx, z)).toBeCloseTo(roadGradeAt(SEED, z).h + TRESTLE_TOP, 9);
    const n = { x: 0, y: 0, z: 0 };
    field.normalAt(cx, z, n);
    expect(n).toEqual({ x: 0, y: 1, z: 0 });
    // Off the deck the field is the base's own.
    const base = baseGround(SEED);
    expect(field.heightAt(cx + 20, z)).toBe(base.heightAt(cx + 20, z));
  });

  it("holds a hull on the deck inboard of its rails and one below it outside", () => {
    const z = 2050;
    const cx = railCenterX(SEED, z);
    const top = roadGradeAt(SEED, z).h + TRESTLE_TOP;
    // On the deck, within a hull's radius of the side: pushed in.
    const inside = { x: cx + TRESTLE_HALF - 0.1, y: top + PLAYER_HALF.y, z };
    const vel = { x: 1, y: 0, z: 0 };
    expect(constrainTrestle(SEED, inside, vel, spans)).toBe(true);
    expect(inside.x).toBeCloseTo(cx + TRESTLE_HALF - HULL_RADIUS, 9);
    expect(vel.x).toBe(0);
    expect(constrainTrestle(SEED, { x: cx, y: top + PLAYER_HALF.y, z }, { x: 0, y: 0, z: 0 }, spans)).toBe(false);
    const below = { x: cx + 0.2, y: top - 3 + PLAYER_HALF.y, z };
    expect(constrainTrestle(SEED, below, { x: 0, y: 0, z: 0 }, spans)).toBe(true);
    expect(Math.abs(below.x - cx)).toBeGreaterThanOrEqual(TRESTLE_HALF + HULL_RADIUS - 1e-9);
  });
});

describe("a trestle and a causeway drawn", () => {
  it("make finite geometry over a span laid by hand, with piles, deck and riprap", () => {
    const w: RailWorld = { ...railWorld(SEED), spans: (z0, z1) => spans(SEED, z0, z1) };
    for (const k of [15, 16, 17, 18]) {
      const a = finish(railCell(w, k, 0));
      const lighter = finish(railCell(w, k, 2));
      const p = (a.solid as NonNullable<typeof a.solid>).positions;
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
      expect((lighter.solid?.positions.length ?? 0)).toBeLessThan(p.length);
    }
    const plain = finish(railCell(railWorld(SEED), 16, 0));
    const withTrestle = finish(railCell(w, 15, 0));
    // The cell with the trestle holds a deck's worth more than a bare bed cell of the same length.
    expect((withTrestle.solid as NonNullable<typeof withTrestle.solid>).positions.length).toBeGreaterThan((plain.solid as NonNullable<typeof plain.solid>).positions.length);
  });
});
