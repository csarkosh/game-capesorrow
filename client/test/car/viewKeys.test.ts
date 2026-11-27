import { describe, expect, it } from "vitest";
import { BEHIND_KEY, CINE_KEY, createViewKeys, type KeyPress, type KeyTarget } from "../../src/game/car/viewKeys.js";

/** A keyboard: what was listened for, and a way to press. */
function keyboard(): KeyTarget & { fire(type: string, event?: KeyPress): void; count(): number } {
  const listeners = new Map<string, ((event: KeyPress) => void)[]>();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
    fire(type, event = {}) {
      for (const l of listeners.get(type) ?? []) l(event);
    },
    count: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
  };
}

describe("the view's keys", () => {
  it("looks behind while C is down and not after it is let go", () => {
    const k = keyboard();
    const keys = createViewKeys(k, () => true);
    expect(keys.behind()).toBe(false);
    k.fire("keydown", { code: BEHIND_KEY });
    expect(keys.behind()).toBe(true);
    k.fire("keyup", { code: BEHIND_KEY });
    expect(keys.behind()).toBe(false);
  });

  it("switches the cinematic view with each press of V, and not with a held key's repeats", () => {
    const k = keyboard();
    const keys = createViewKeys(k, () => true);
    k.fire("keydown", { code: CINE_KEY });
    expect(keys.cine()).toBe(true);
    k.fire("keydown", { code: CINE_KEY, repeat: true });
    expect(keys.cine()).toBe(true);
    k.fire("keyup", { code: CINE_KEY });
    k.fire("keydown", { code: CINE_KEY });
    expect(keys.cine()).toBe(false);
  });

  it("takes no key while play does not have the controls, or while the key is typed into a field", () => {
    const k = keyboard();
    let playing = false;
    const keys = createViewKeys(k, () => playing);
    k.fire("keydown", { code: CINE_KEY });
    k.fire("keydown", { code: BEHIND_KEY });
    expect([keys.cine(), keys.behind()]).toEqual([false, false]);
    playing = true;
    for (const target of [{ tagName: "INPUT" }, { tagName: "textarea" }, { tagName: "DIV", isContentEditable: true }]) {
      k.fire("keydown", { code: CINE_KEY, target });
      k.fire("keydown", { code: BEHIND_KEY, target });
    }
    expect([keys.cine(), keys.behind()]).toEqual([false, false]);
    k.fire("keydown", { code: CINE_KEY, target: { tagName: "CANVAS" } });
    expect(keys.cine()).toBe(true);
  });

  it("lets the look behind go when the menu takes the controls or the window loses the keyboard, though the key never came up", () => {
    const k = keyboard();
    let playing = true;
    const keys = createViewKeys(k, () => playing);
    k.fire("keydown", { code: BEHIND_KEY });
    playing = false;
    expect(keys.behind()).toBe(false);
    playing = true;
    expect(keys.behind()).toBe(true);
    k.fire("blur");
    expect(keys.behind()).toBe(false);
    // The key let go under a menu is let go.
    k.fire("keydown", { code: BEHIND_KEY });
    playing = false;
    k.fire("keyup", { code: BEHIND_KEY });
    playing = true;
    expect(keys.behind()).toBe(false);
  });

  it("switches the cinematic view off when told the player is out of the car, and takes its listeners away when disposed", () => {
    const k = keyboard();
    const keys = createViewKeys(k, () => true);
    k.fire("keydown", { code: CINE_KEY });
    keys.cineOff();
    expect(keys.cine()).toBe(false);
    expect(k.count()).toBe(3);
    keys.dispose();
    expect(k.count()).toBe(0);
  });

  it("answers false for ever where there is no keyboard", () => {
    const keys = createViewKeys(null, () => true);
    expect([keys.behind(), keys.cine()]).toEqual([false, false]);
    keys.dispose();
  });
});
