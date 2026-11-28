import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { STEP_UP, stairBlocks, wallBlocks, type Design } from "../../src/sim/inside/design.js";
import { acts, groundAt } from "../../src/sim/inside/designWalk.js";
import { CELL, GALLERY, R, STAIR_FROM, STAIR_TO, centre, explore, flood, reached, rest, roomOfDesign, standAt, standsAt, stepTo, testDesign, walkTo, walkable, whereIs } from "./designHelpers.js";

/** The test-only design: a ground floor, a flight up to a gallery over its back with a rail, and a room under the gallery. */
describe("walking on levels, on a design of a hall with a gallery", () => {
  const design = testDesign();
  const room = roomOfDesign(design);

  it("has a surface for each level and a ramp, and a block under the low part of the ramp", () => {
    expect(design.surfaces.map((s) => s.kind)).toEqual(["floor", "floor", "ramp"]);
    const under = stairBlocks(design.stairs[0] as NonNullable<Design["stairs"][0]>).filter((b) => b.y0 === 0 && b.hb > 0.3);
    expect(under.length).toBeGreaterThan(5);
    // Each slice is as high as the ramp's low edge over it, which is never above the headroom.
    for (const b of under) expect(b.y1).toBeLessThan(1.9);
  });

  it("finds the highest surface within a step up of the feet, and none where none holds", () => {
    // On the gallery over the room, the gallery; under it, the floor, whatever the feet were a step above.
    expect(groundAt(design, 2, 9, GALLERY)).toBe(GALLERY);
    expect(groundAt(design, 2, 9, 0)).toBe(0);
    expect(groundAt(design, 2, 9, GALLERY - STEP_UP - 0.01)).toBe(0);
    expect(groundAt(design, 2, 9, GALLERY - STEP_UP + 0.01)).toBe(GALLERY);
    // The ramp: its height at the middle of its run is half the rise.
    expect(groundAt(design, 8, (STAIR_FROM + STAIR_TO) / 2, 1.6)).toBeCloseTo(GALLERY / 2, 6);
    expect(groundAt(design, -1, 5, 0)).toBeNull();
    expect(groundAt(design, 5, 13, 0)).toBeNull();
  });

  it("acts on a hull only where the block's height range meets the hull's", () => {
    const rail = design.blocks.find((b) => b.y0 === GALLERY && b.hb < 0.05);
    expect(rail).toBeDefined();
    expect(acts(rail as NonNullable<typeof rail>, 0)).toBe(false);
    expect(acts(rail as NonNullable<typeof rail>, GALLERY)).toBe(true);
    const wall = wallBlocks(design.walls[0] as NonNullable<Design["walls"][0]>);
    // A doorway: two stretches and a header over it, which a standing hull's head clears.
    expect(wall.length).toBe(3);
    expect(acts(wall[1] as (typeof wall)[number], 0)).toBe(false);
    expect(acts(wall[0] as (typeof wall)[number], 0)).toBe(true);
  });

  it("reaches the gallery by the stair: a body walked up the flight stands on the gallery", () => {
    const b = standAt(room, 8, 0.6);
    // Up the flight along its middle, on to the gallery.
    walkTo(room, b, 8, 6.8, 200);
    const mid = whereIs(room, b);
    expect(mid.feet).toBeGreaterThan(2);
    walkTo(room, b, 8, 9, 200);
    const top = whereIs(room, b);
    expect(top.feet).toBeCloseTo(GALLERY, 3);
    expect(b.grounded).toBe(true);
    expect(b.pos.y).toBeCloseTo(room.floorY + GALLERY + PLAYER_HALF.y, 3);
  });

  it("is reached everywhere by the flood fill from the arrival: the gallery and the flight are reached, and the area is walkable", () => {
    const reach = flood(design, design.arrive);
    expect(reach.surfaces.size).toBe(design.surfaces.length);
    expect(reach.states.length / walkable(design)).toBeGreaterThan(0.95);
  });

  it("walks to cover 60 percent of what it can reach in 3000 ticks, never off the box, in a block or on nothing", () => {
    const reach = flood(design, design.arrive);
    const w = explore(room, design.arrive, 3000, 5, reach);
    expect(w.worstOutside).toBeLessThan(0.0);
    expect(w.inBlock).toBe(0);
    expect(w.onNothing).toBe(0);
    const covered = reach.states.filter((s) => reached(w.visited, s)).length;
    expect(covered / reach.states.length).toBeGreaterThan(0.6);
  });

  it("has a rail at every open edge of every upper surface: a step outward is refused or lands within a step", () => {
    const reach = flood(design, design.arrive);
    let edges = 0;
    for (const s of reach.states) {
      if (s.h < 0.5) continue;
      const c = centre(s.i, s.j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const to = { s: c.s + di * CELL, d: c.d + dj * CELL };
        const g = stepTo(design, { s: c.s, d: c.d, h: s.h }, to.s, to.d, R);
        if (g === null) edges++;
        else expect(g, `a step from (${c.s}, ${c.d}) at ${s.h} to (${to.s}, ${to.d}) drops to ${g}`).toBeGreaterThanOrEqual(s.h - STEP_UP);
      }
    }
    expect(edges).toBeGreaterThan(10);
  });

  it("does not let a body walk up through the gallery's floor from below, or off its railed edge", () => {
    // From the middle of the hall under the gallery's front edge, straight on: the gallery is overhead and the body stays on the floor.
    const below = standAt(room, 2.5, 9.5);
    // Inside the room under it: it is walked around in its four walls, never lifted.
    for (let i = 0; i < 300; i++) {
      walkTo(room, below, 2.5, 7.8 + (i % 3), 1);
      expect(whereIs(room, below).feet).toBeCloseTo(0, 6);
    }
    // On the gallery, walked at its rail: stopped by it, 0.4 m short, still on the gallery.
    const up = standAt(room, 4, 9, GALLERY);
    const end = walkTo(room, up, 4, 5.5, 200);
    expect(end.feet).toBeCloseTo(GALLERY, 3);
    expect(end.d).toBeGreaterThan(7 + R - 0.05);
    expect(end.d).toBeLessThan(7.6);
  });

  it("stops a body under the low end of the stair, and lets it walk under the high end", () => {
    const open = testDesign({ openStair: true });
    const r2 = roomOfDesign(open);
    // Along the floor from the left near the low end (d = 3.8, the ramp is 1.15 m up there): stopped before the flight.
    const low = standAt(r2, 5.2, 3.8);
    const at = walkTo(r2, low, 9, 3.8, 150);
    expect(at.s).toBeLessThan(7 - R + 0.05);
    expect(at.feet).toBeCloseTo(0, 3);
    // Near the high end (d = 6.5, the ramp is 2.9 m up): walked under, to the flight's far side.
    const high = standAt(r2, 5.2, 6.5);
    const under = walkTo(r2, high, 9.4, 6.5, 150);
    expect(under.s).toBeGreaterThan(8.8);
    expect(under.feet).toBeCloseTo(0, 3);
  });

  it("holds a body on the flight by its sides, and lets it off at either end", () => {
    const b = standAt(room, 8, 3, 0.7);
    // Pushed to the left and to the right along the ramp: it stays on it.
    walkTo(room, b, 6, 3.5, 100);
    expect(whereIs(room, b).s).toBeGreaterThan(7);
    expect(whereIs(room, b).feet).toBeGreaterThan(1);
    walkTo(room, b, 9.5, 4, 100);
    expect(whereIs(room, b).s).toBeLessThan(9);
    // Down the flight and off at its foot: on the floor.
    walkTo(room, b, 8, 0.8, 300);
    expect(whereIs(room, b).feet).toBeCloseTo(0, 3);
  });

  it("lets a body step through a gap in the rail, fall to the floor below, and walk away", () => {
    const gapped = testDesign({ gap: true });
    const r3 = roomOfDesign(gapped);
    const b = standAt(r3, 2.5, 9, GALLERY);
    walkTo(r3, b, 2.5, 5.5, 60);
    // Off the gallery's edge, in the air or already landed, below the gallery's height.
    expect(whereIs(r3, b).feet).toBeLessThan(GALLERY - STEP_UP);
    rest(r3, b, 120);
    const landed = whereIs(r3, b);
    expect(landed.feet).toBeCloseTo(0, 3);
    expect(b.grounded).toBe(true);
    expect(landed.d).toBeLessThan(7);
    // And walks away over the floor.
    const away = walkTo(r3, b, 2.5, 2, 150);
    expect(away.feet).toBeCloseTo(0, 3);
    expect(away.d).toBeLessThan(2.4);
  });

  it("refuses a step onto nothing", () => {
    const b = standAt(room, 9.5, 0.7);
    const before = { ...b.pos };
    // Into the left side of the room, over the edge of every surface: the outer box holds it first; the hull never stands where there is no ground.
    walkTo(room, b, 12, -3, 60);
    expect(standsAt(design, whereIs(room, b).s, whereIs(room, b).d, 0, R)).not.toBeNull();
    expect(b.pos.y).toBe(before.y);
  });
});
