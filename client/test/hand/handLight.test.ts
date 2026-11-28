import { describe, expect, it } from "vitest";
import { LAMP_ANGLE, LAMP_COLOUR, LAMP_DEFAULT, LAMP_INTENSITY, LAMP_RANGE } from "@csarkosh/engine/game/lampParams";
import type { RenderLamp } from "@csarkosh/engine/game/lite/renderGame";
import { HEADLIGHT_GAIN, lightHeadlights } from "../../src/game/car/headlights.js";
import { NIGHT_LIT_GAIN, TORCH_ANGLE, TORCH_GAIN, TORCH_RANGE, lightTorch, newTorchState, torchGainFor } from "../../src/game/hand/handLight.js";

/** The lamp as the engine hands it to a game's scene each frame: at the eye, along the view, the engine's own angle and range, lit with the walker lamp's state. */
const engineLamp = (): RenderLamp => ({
  at: { x: 1, y: 2, z: 3, dx: 0, dy: 0, dz: 1, angle: LAMP_ANGLE, range: LAMP_RANGE },
  lit: { on: true, state: LAMP_DEFAULT },
});

const FIELDS = ["x", "y", "z", "dx", "dy", "dz", "range"] as const;

describe("the lamp the torch hands the engine, held against the car's, which is known to work", () => {
  const torch = engineLamp();
  const car = engineLamp();
  // A torch at the right hand, pointing ahead and down.
  const place = { x: 10.2, y: 1.52, z: -4.1, dx: -0.1, dy: -0.2, dz: 0 };
  const l = Math.hypot(place.dx, place.dy, 1);
  place.dx /= l;
  place.dy /= l;
  place.dz = 1 / l;
  lightTorch(torch, place, 1, newTorchState());
  lightHeadlights(car, { x: 10, y: 0, z: -4, hx: 0.6, hz: 0.8 });

  it("writes the same fields the headlights write: where it stands, where it points, how far it reaches", () => {
    for (const k of FIELDS) {
      expect(torch.at[k], k).not.toBe(engineLamp().at[k]);
      expect(Number.isFinite(torch.at[k]), k).toBe(true);
      expect(car.at[k], k).not.toBe(engineLamp().at[k]);
    }
    expect(torch.at.x).toBeCloseTo(place.x, 9);
    expect(torch.at.y).toBeCloseTo(place.y, 9);
    expect(torch.at.z).toBeCloseTo(place.z, 9);
  });

  it("points with a unit vector, as the car's does, in the engine's frame", () => {
    for (const lamp of [torch, car]) expect(Math.hypot(lamp.at.dx, lamp.at.dy, lamp.at.dz)).toBeCloseTo(1, 9);
    expect(torch.at.dy).toBeLessThan(0);
  });

  it("hands over a state of its own, with a brightness that is not nothing: the headlights' gain over the walker lamp's, at the same dark grade", () => {
    expect(TORCH_GAIN).toBe(HEADLIGHT_GAIN);
    expect(torch.lit.state).not.toBe(LAMP_DEFAULT);
    expect(torch.lit.state.intensity).toBeCloseTo(LAMP_INTENSITY * TORCH_GAIN, 6);
    expect(torch.lit.state.intensity).toBeGreaterThan(LAMP_INTENSITY * 3);
    expect(car.lit.state.intensity).toBeCloseTo(LAMP_INTENSITY * HEADLIGHT_GAIN, 6);
    expect(torch.lit.on).toBe(true);
  });

  it("has a cone narrower than the engine's and no wider than it, and a reach of 20 m or more", () => {
    expect(torch.at.angle).toBe(TORCH_ANGLE);
    expect(TORCH_ANGLE).toBeGreaterThan(0.5);
    expect(TORCH_ANGLE).toBeLessThanOrEqual(LAMP_ANGLE);
    expect(torch.at.range).toBe(TORCH_RANGE);
    expect(TORCH_RANGE).toBeGreaterThanOrEqual(20);
  });

  it("is a warm white: red at least green at least blue, none of them dark", () => {
    const c = torch.lit.state.colour;
    expect(c.r).toBeGreaterThanOrEqual(c.g);
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    expect(c.b).toBeGreaterThan(0.7);
    // The engine's own warm light for comparison: the torch is a little whiter than the walker lamp.
    expect(c.b / c.r).toBeGreaterThan(LAMP_COLOUR[2] / LAMP_COLOUR[0] - 0.01);
  });

  it("comes on as the hand arrives, and keeps the engine's dread (a dimmer state dims it)", () => {
    const half = engineLamp();
    lightTorch(half, place, 0.5, newTorchState());
    expect(half.lit.state.intensity).toBeCloseTo(LAMP_INTENSITY * TORCH_GAIN * 0.5, 6);
    const dim = engineLamp();
    dim.lit.state = { intensity: LAMP_INTENSITY * 0.6, colour: { r: 1, g: 0.72 * LAMP_COLOUR[1], b: 0.42 * LAMP_COLOUR[2] } };
    lightTorch(dim, place, 1, newTorchState());
    expect(dim.lit.state.intensity).toBeCloseTo(LAMP_INTENSITY * 0.6 * TORCH_GAIN, 6);
    expect(dim.lit.state.colour.b).toBeLessThan(torch.lit.state.colour.b);
  });

  it("is six times at night and about twice by day: the gain follows the hour's lit gain, never over six, never under what the day needs", () => {
    expect(torchGainFor(NIGHT_LIT_GAIN)).toBeCloseTo(TORCH_GAIN, 9);
    expect(torchGainFor(1)).toBeGreaterThan(1.8);
    expect(torchGainFor(1)).toBeLessThan(2.2);
    let last = 0;
    for (const g of [1, 1.3, 1.8, 2.4, NIGHT_LIT_GAIN, 4, 10]) {
      const gain = torchGainFor(g);
      expect(gain).toBeLessThanOrEqual(TORCH_GAIN + 1e-9);
      expect(gain).toBeGreaterThanOrEqual(last);
      last = gain;
    }
    const day = engineLamp();
    lightTorch(day, place, 1, newTorchState(), 1);
    expect(day.lit.state.intensity).toBeCloseTo(LAMP_INTENSITY * torchGainFor(1), 6);
    expect(day.lit.state.intensity).toBeLessThan(torch.lit.state.intensity / 2.5);
  });
});
