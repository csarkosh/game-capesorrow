import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOAT_GLOW } from "../../src/game/town/boatGeometry.js";
import { LENS_GLOW } from "../../src/game/town/props/lamps.js";
import { WINDOW_LIGHT_CODE, emptyTownReady, otherLightUniform, windowLightUniform, TOWN_COMPOSE_CODE, hoursCodeFor } from "../../src/game/town/townMaterial.js";
import { PORCH_GLOW, WINDOW_GLOW_MAX, windowLight } from "../../src/game/town/windowNight.js";
import { townParts, townPartsWith } from "../../src/game/town/townParts.js";

describe("the film's window light", () => {
  it("keeps every non-window night light's glow above a window's", () => {
    for (const g of [LENS_GLOW, PORCH_GLOW, BOAT_GLOW]) expect(g).toBeGreaterThan(WINDOW_GLOW_MAX);
    expect(LENS_GLOW).toBeGreaterThanOrEqual(1);
    expect(PORCH_GLOW).toBeGreaterThanOrEqual(1);
  });

  it("gives every lit window a glow in (0, WINDOW_GLOW_MAX]", () => {
    for (let id = 0; id < 1000; id++) {
      const g = windowLight(id, id % 7).glow;
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(WINDOW_GLOW_MAX);
    }
  });

  it("is off by default and carries colour and gain when asked", () => {
    expect(windowLightUniform(undefined)).toEqual([0, 0, 0, 0]);
    expect(windowLightUniform({ colour: [1, 0.05, 0.03], gain: 3 })).toEqual([1, 0.05, 0.03, 3]);
    expect(typeof townPartsWith({})).toBe("function");
    expect(typeof townPartsWith({ windowLight: { colour: [1, 0.05, 0.03], gain: 3 } })).toBe("function");
    expect(typeof townParts).toBe("function");
    const src = readFileSync(new URL("../../src/game/town/townParts.ts", import.meta.url), "utf8");
    expect(src).toContain("ready.townWindowLight = windowLightUniform(opts.windowLight);");
    expect(src).toContain("export const townParts = townPartsWith({});");
  });

  it("has the window branch in its own .wgsl file, gated on the gain, and spliced into the night branch", () => {
    const file = readFileSync(new URL("../../src/game/town/shaders/townWindowLight.wgsl", import.meta.url), "utf8");
    expect(file).toContain("isLitWindow");
    expect(file).toContain("material.townWindowLight.w>0.0");
    expect(file).toContain("tsSurf.w>0.001&&tsSurf.w<=__WINDOW_GLOW_MAX__");
    expect(WINDOW_LIGHT_CODE).toContain(`tsSurf.w<=${WINDOW_GLOW_MAX}`);
    expect(WINDOW_LIGHT_CODE).not.toContain("__");
    expect(hoursCodeFor(false)).toContain(WINDOW_LIGHT_CODE);
    expect(TOWN_COMPOSE_CODE).toContain("color=color+townGlowC*material.townGlow;");
  });

  it("leaves the other night lights' gain at 1 by default and carries the film's value to the uniform", () => {
    expect(otherLightUniform(undefined)).toEqual([1, 0, 0, 0]);
    expect(otherLightUniform({ colour: [1, 0, 0], gain: 3 })).toEqual([1, 0, 0, 0]);
    expect(otherLightUniform({ colour: [1, 0, 0], gain: 3, others: 0.25 })).toEqual([0.25, 0, 0, 0]);
    expect(emptyTownReady().townOtherLight).toEqual([1, 0, 0, 0]);
    const src = readFileSync(new URL("../../src/game/town/townParts.ts", import.meta.url), "utf8");
    expect(src).toContain("ready.townOtherLight = otherLightUniform(opts.windowLight);");
    // The lamps' thrown light is scaled by the same gain where the town part sets it.
    expect(src).toContain("writeLamps(ready, lampList, otherGain)");
  });

  it("applies the other lights' gain only on the branch gated on the window gain", () => {
    const file = readFileSync(new URL("../../src/game/town/shaders/townWindowLight.wgsl", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const gate = file.indexOf("material.townWindowLight.w>0.0");
    const other = file.indexOf("material.townOtherLight");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(other).toBeGreaterThan(gate);
    expect(file.match(/material\.townOtherLight/g)).toHaveLength(1);
    expect(WINDOW_LIGHT_CODE).toContain("material.townOtherLight");
  });

  it("reads the look it is given for every glow's gain, and play's look by default", () => {
    const src = readFileSync(new URL("../../src/game/town/townParts.ts", import.meta.url), "utf8");
    expect(src).toContain("opts: { windowLight?: WindowLight; look?: Partial<GameLook> }");
    expect(src).toContain("opts.look ?? PORTASHTON_LOOK");
    expect(src).not.toMatch(/litGainAt\((hour|shownHour)\)/);
    expect(src.match(/litGainAt\((hour|shownHour), look\)/g)).toHaveLength(3);
  });
});
