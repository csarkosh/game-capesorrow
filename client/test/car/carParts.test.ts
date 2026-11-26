import { describe, expect, it, vi } from "vitest";
import { createCarParts } from "../../src/game/car/carParts.js";
import type { Car } from "../../src/sim/car/types.js";

function car(x: number, id = 1): Car {
  return { id, x, y: 0, z: 0, hx: 1, hz: 0, speed: 10, slip: 0, steer: 0, controls: { throttle: 0, turn: 0, handbrake: false }, lights: false, seats: [0, 0, 0, 0] };
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
