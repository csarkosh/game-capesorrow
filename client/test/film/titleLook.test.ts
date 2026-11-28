import { describe, expect, it } from "vitest";
import { sunPositionAt } from "@csarkosh/engine/game/sky";
import { PORTASHTON_LOOK, litGainAt } from "../../src/look.js";
import { TITLE_LOOK, TITLE_WINDOWS } from "../../src/film/titleLook.js";

describe("the title look", () => {
  it("has a glow, one palette and no warm highlight", () => {
    expect(TITLE_LOOK.glow).toBeDefined();
    expect(TITLE_LOOK.grades.length).toBe(0);
    expect(TITLE_LOOK.palette.highlights.r).toBeLessThanOrEqual(TITLE_LOOK.palette.highlights.g);
  });
  it("leaves the game's look alone", () => {
    expect(PORTASHTON_LOOK.glow).toBeUndefined();
    expect(PORTASHTON_LOOK.grades!.length).toBeGreaterThan(0);
    expect(litGainAt(23)).toBeGreaterThan(2);
  });
  it("holds an hour after sunset, with the sun between -0.05 and -0.1, under 24", () => {
    expect(TITLE_LOOK.hour).toBeLessThan(24);
    expect(TITLE_LOOK.hour).toBeGreaterThan(12);
    const y = sunPositionAt(TITLE_LOOK.hour).y;
    expect(y).toBeLessThanOrEqual(-0.05);
    expect(y).toBeGreaterThanOrEqual(-0.1);
  });
  it("pins its weather and its palette", () => {
    expect(TITLE_LOOK.weather).toMatchObject({ cloudCover: 0.85, mist: 0.35, rain: 0, wetness: 0.8, dread: 0 });
    expect(TITLE_LOOK.palette.shadows).toMatchObject({ r: 0.02, g: 0.05, b: 0.06 });
    expect(TITLE_LOOK.palette.highlights).toMatchObject({ r: 0.62, g: 0.82, b: 0.8 });
    expect(TITLE_LOOK.palette.contrast).toBe(1.5);
  });
  it("has no grade, so its glow gain is 1 at its hour (the film's own, not play's dusk grade)", () => {
    expect(litGainAt(TITLE_LOOK.hour, TITLE_LOOK)).toBe(1);
    expect(litGainAt(TITLE_LOOK.hour)).toBeGreaterThan(1);
  });
  it("catches the red windows in the glow and dims the other night lights", () => {
    // A red window's glow colour [1, 0.06, 0.04] has a luminance of about 0.23, times the window's glow (0.35 to 0.75), the gain and the exposure: most cross 0.35, few cross 0.8.
    expect(TITLE_LOOK.glow?.threshold).toBe(0.35);
    expect(TITLE_LOOK.glow?.strength).toBe(0.12);
    expect(TITLE_WINDOWS.others).toBe(0.25);
  });
  it("lights windows red", () => {
    expect(TITLE_WINDOWS.colour[0]).toBeGreaterThan(TITLE_WINDOWS.colour[1] * 10);
  });
});
