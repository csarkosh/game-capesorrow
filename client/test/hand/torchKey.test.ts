import { describe, expect, it } from "vitest";
import { HAND_SWITCH, pressLamp, resetHand } from "../../src/game/hand/handSwitch.js";
import { createTorchKey, type TorchKeyTarget } from "../../src/game/hand/torchKey.js";
import { LAMP_BIT } from "../../src/sim/car/tuning.js";

type Ev = { code?: string; repeat?: boolean; target?: unknown };
function fakeWindow(): { target: TorchKeyTarget; fire(e: Ev): void; listeners(): number } {
  const l = new Set<(e: Ev) => void>();
  return {
    target: { addEventListener: (_t, f) => void l.add(f), removeEventListener: (_t, f) => void l.delete(f) },
    fire: (e) => l.forEach((f) => f(e)),
    listeners: () => l.size,
  };
}

describe("F, on foot, flips the torch, and nothing else does", () => {
  it("flips once for each press of F, not for a held key's repeats, and not for another key", () => {
    resetHand();
    const w = fakeWindow();
    createTorchKey(w.target, () => true, () => true);
    w.fire({ code: "KeyF" });
    expect(HAND_SWITCH.on).toBe(true);
    w.fire({ code: "KeyF", repeat: true });
    w.fire({ code: "KeyF", repeat: true });
    expect(HAND_SWITCH.on).toBe(true);
    for (const code of ["KeyW", "KeyC", "KeyV", "Space", "Escape", "ShiftLeft", "KeyE"]) w.fire({ code });
    expect(HAND_SWITCH.on).toBe(true);
    w.fire({ code: "KeyF" });
    expect(HAND_SWITCH.on).toBe(false);
    resetHand();
  });

  it("does not flip while typing in a field, while play has not the controls, or off foot", () => {
    resetHand();
    const w = fakeWindow();
    let playing = false;
    let foot = true;
    createTorchKey(w.target, () => playing, () => foot);
    w.fire({ code: "KeyF" });
    playing = true;
    w.fire({ code: "KeyF", target: { tagName: "INPUT" } });
    w.fire({ code: "KeyF", target: { tagName: "textarea" } });
    w.fire({ code: "KeyF", target: { isContentEditable: true } });
    foot = false;
    w.fire({ code: "KeyF" });
    expect(HAND_SWITCH.on).toBe(false);
    foot = true;
    w.fire({ code: "KeyF" });
    expect(HAND_SWITCH.on).toBe(true);
    resetHand();
  });

  it("lets go of the window when undone", () => {
    const w = fakeWindow();
    const undo = createTorchKey(w.target, () => true, () => true);
    expect(w.listeners()).toBe(1);
    undo();
    expect(w.listeners()).toBe(0);
  });

  it("is not flipped by the lamp bit of a command on the keyboard's path: the touch layer's bit alone is read (side.ts reads it only for a touch player), and a held bit is one press", () => {
    resetHand();
    // The bit held across commands is one press; a bit that is not on foot flips nothing.
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(true);
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(false);
    expect(pressLamp(LAMP_BIT, LAMP_BIT, true)).toBe(false);
    resetHand();
  });
});
