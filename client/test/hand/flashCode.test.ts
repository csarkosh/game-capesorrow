import { describe, expect, it } from "vitest";
import { FLASH_CODE, emptyTownReady, townSurfaceCode } from "../../src/game/town/townMaterial.js";
import { HAND_SWITCH, handWanted, pressLamp, resetHand, torchLit } from "../../src/game/hand/handSwitch.js";
import { LAMP_BIT } from "../../src/sim/car/tuning.js";

describe("the flashlight in the rooms' materials", () => {
  it("is compiled into the indoor path (the night variants) and not into the street's", () => {
    expect(townSurfaceCode(false, false, false, undefined, false)).not.toContain("flashC");
    expect(townSurfaceCode(false, false, false, undefined, true)).toContain(FLASH_CODE);
    expect(townSurfaceCode(true, false, false, undefined, true)).toContain("flashC");
    // The street's material, ranked ground and signs have none.
    expect(townSurfaceCode(false, true, false, undefined, false)).not.toContain("flashC");
    expect(townSurfaceCode(false, false, true, undefined, false)).not.toContain("flashC");
  });

  it("reads nothing while the torch is off, and its uniforms are in the town's record, four floats each", () => {
    expect(FLASH_CODE.startsWith("if(material.flashC.w>0.001")).toBe(true);
    const ready = emptyTownReady();
    for (const k of ["flashP", "flashD", "flashC"]) expect(ready[k]).toHaveLength(4);
    expect(ready.flashC?.[3]).toBe(0);
  });
});

describe("the torch's switch on foot", () => {
  it("flips on the press of the lamp bit on foot, once for a held key, and not in a car", () => {
    resetHand();
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(true);
    expect(torchLit(true)).toBe(true);
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(false);
    pressLamp(0, LAMP_BIT, true);
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(true);
    expect(torchLit(true)).toBe(false);
    pressLamp(0, LAMP_BIT, false);
    expect(pressLamp(LAMP_BIT, LAMP_BIT, false)).toBe(false);
    expect(HAND_SWITCH.on).toBe(false);
    resetHand();
  });

  it("is lit only on foot, and the hand is wanted up when lit or when the console says", () => {
    resetHand();
    HAND_SWITCH.on = true;
    expect(torchLit(true)).toBe(true);
    expect(torchLit(false)).toBe(false);
    expect(handWanted(true)).toBe(true);
    HAND_SWITCH.on = false;
    expect(handWanted(false)).toBe(false);
    HAND_SWITCH.forced = true;
    expect(handWanted(false)).toBe(true);
    resetHand();
  });
});
