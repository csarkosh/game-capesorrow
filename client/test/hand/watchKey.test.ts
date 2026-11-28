import { describe, expect, it } from "vitest";
import { createWatchKey, isWatchKey, type WatchKeyTarget } from "../../src/game/hand/watchKey.js";
import { WATCH_SEEN, resetWatch } from "../../src/game/hand/watchSeen.js";
import { WATCH_COMMANDS, sayWatch } from "../../src/game/hand/watchCommand.js";

type Ev = { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean; target: EventTarget | null };
const key = (k: string, over: Partial<Ev> = {}): Ev => ({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, ...over });

function fakeWindow(): { target: WatchKeyTarget; fire(e: Ev): void; count(): number } {
  const l: ((e: Ev) => void)[] = [];
  return {
    target: { addEventListener: (_t, f) => void l.push(f), removeEventListener: (_t, f) => void l.splice(l.indexOf(f) >>> 0, 1) },
    fire: (e) => l.forEach((f) => f(e)),
    count: () => l.length,
  };
}

describe("G is the watch's key (M stays the engine's mute)", () => {
  it("flips the watch once for each press of G while play has the controls, in a car or on foot alike", () => {
    resetWatch();
    const w = fakeWindow();
    createWatchKey(w.target, () => true);
    w.fire(key("g"));
    expect(WATCH_SEEN.on).toBe(true);
    w.fire(key("g"));
    expect(WATCH_SEEN.on).toBe(false);
    w.fire(key("G"));
    expect(WATCH_SEEN.on).toBe(true);
    resetWatch();
  });

  it("does nothing for M or N or any other key, and stops none of them", () => {
    resetWatch();
    const w = fakeWindow();
    createWatchKey(w.target, () => true);
    let stopped = 0;
    for (const k of ["m", "n", "f", "w", "c", "v", "h"]) w.fire({ ...key(k), stopImmediatePropagation: () => void stopped++ } as Ev);
    expect(WATCH_SEEN.on).toBe(false);
    expect(stopped).toBe(0);
  });

  it("ignores a held G, a modified G, a G typed in a field, and a G when play has not the controls", () => {
    resetWatch();
    const w = fakeWindow();
    let playing = false;
    createWatchKey(w.target, () => playing);
    w.fire(key("g"));
    playing = true;
    w.fire(key("g", { repeat: true }));
    w.fire(key("g", { ctrlKey: true }));
    w.fire(key("g", { altKey: true }));
    w.fire(key("g", { metaKey: true }));
    w.fire(key("g", { target: { tagName: "INPUT" } as unknown as EventTarget }));
    w.fire(key("g", { target: { tagName: "textarea" } as unknown as EventTarget }));
    w.fire(key("g", { target: { isContentEditable: true } as unknown as EventTarget }));
    expect(WATCH_SEEN.on).toBe(false);
  });

  it("takes the key in G's place where the layout types a letter of another script, and no other such key", () => {
    expect(isWatchKey({ ...key("п"), code: "KeyG" })).toBe(true);
    expect(isWatchKey({ ...key("м"), code: "KeyM" })).toBe(false);
    expect(isWatchKey(key("g"))).toBe(true);
    expect(isWatchKey(key("m"))).toBe(false);
  });

  it("is released on dispose", () => {
    const w = fakeWindow();
    const undo = createWatchKey(w.target, () => true);
    expect(w.count()).toBe(1);
    undo();
    expect(w.count()).toBe(0);
  });

  it("has the console's `watch on|off`, kept out of the address when off", () => {
    resetWatch();
    const spec = WATCH_COMMANDS[0]!;
    expect(spec.validate([])).toBeNull();
    expect(spec.validate(["on"])).toBeNull();
    expect(spec.validate(["off"])).toBeNull();
    expect(spec.validate(["up"])).not.toBeNull();
    expect(spec.defaultValue).toBe(false);
    sayWatch("on");
    expect(WATCH_SEEN.on).toBe(true);
    sayWatch("off");
    expect(WATCH_SEEN.on).toBe(false);
    resetWatch();
  });
});
