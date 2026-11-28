import { describe, expect, it } from "vitest";
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
  it("keeps a lit thing at least as bright", () => {
    expect(litGainAt(19, TITLE_LOOK)).toBeGreaterThanOrEqual(1);
  });
  it("lights windows red", () => {
    expect(TITLE_WINDOWS.colour[0]).toBeGreaterThan(TITLE_WINDOWS.colour[1] * 10);
  });
});
