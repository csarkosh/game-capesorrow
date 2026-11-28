import { describe, expect, it } from "vitest";
import { createWatchKeys, relabelMute, type WatchKeyPage, type WatchKeyTarget } from "../../src/game/hand/watchKey.js";
import { WATCH_SEEN, resetWatch } from "../../src/game/hand/watchSeen.js";
import { WATCH_COMMANDS, sayWatch } from "../../src/game/hand/watchCommand.js";

type Ev = { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean; target: EventTarget | null; stopImmediatePropagation?(): void };
const key = (k: string, over: Partial<Ev> = {}): Ev => ({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, ...over });

/** A window with a capture phase and a later (the engine's) listener: an event goes to the capture listeners first, and on unless one stops it. */
function fakeWindow(): { target: WatchKeyTarget; fire(e: Ev): { engine: number }; count(): number } {
  const capture: ((e: Ev) => void)[] = [];
  let engine = 0;
  return {
    target: {
      addEventListener: (_t, f, c) => void (c === true ? capture.push(f) : undefined),
      removeEventListener: (_t, f) => void capture.splice(capture.indexOf(f) >>> 0, 1),
    },
    fire(e) {
      let stopped = false;
      const ev = { ...e, stopImmediatePropagation: () => { stopped = true; } };
      for (const f of [...capture]) {
        f(ev);
        if (stopped) break;
      }
      if (!stopped) engine++;
      return { engine };
    },
    count: () => capture.length,
  };
}

function fakePage(): { page: WatchKeyPage; clicks(): number; cap(): string; aria(): string; rebuild(): void; observers(): number } {
  let clicks = 0;
  const state = { cap: "M", aria: "M" };
  let fire: (() => void) | undefined;
  let observers = 0;
  const button = {
    click: () => void clicks++,
    setAttribute: (n: string, v: string) => void (n === "aria-keyshortcuts" ? (state.aria = v) : undefined),
    querySelector: () => ({ get textContent() { return state.cap; }, set textContent(v: string | null) { state.cap = v ?? ""; } }),
  };
  return {
    page: { querySelector: () => button, observe: (fn) => { fire = fn; observers++; return () => void observers--; } },
    clicks: () => clicks,
    cap: () => state.cap,
    aria: () => state.aria,
    rebuild: () => { state.cap = "M"; state.aria = "M"; fire?.(); },
    observers: () => observers,
  };
}

describe("M is the watch's and N is the sound's (a stopgap until the engine lets a game choose its mute key)", () => {
  it("takes an M before any later listener sees it, and flips the watch once, while play has the controls", () => {
    resetWatch();
    const w = fakeWindow();
    createWatchKeys(w.target, null, () => true);
    expect(w.fire(key("m")).engine).toBe(0);
    expect(WATCH_SEEN.on).toBe(true);
    expect(w.fire(key("m")).engine).toBe(0);
    expect(WATCH_SEEN.on).toBe(false);
    resetWatch();
  });

  it("takes the M from the mute even when play has not the controls, and flips nothing then; and an M typed in a field, a held M and a modified M are the engine's rules and are left alone", () => {
    resetWatch();
    const w = fakeWindow();
    let playing = false;
    createWatchKeys(w.target, null, () => playing);
    expect(w.fire(key("m")).engine).toBe(0);
    expect(WATCH_SEEN.on).toBe(false);
    playing = true;
    const before = w.fire(key("m", { target: { tagName: "INPUT" } as unknown as EventTarget })).engine;
    expect(before).toBe(1);
    expect(WATCH_SEEN.on).toBe(false);
    w.fire(key("m", { repeat: true }));
    w.fire(key("m", { metaKey: true }));
    w.fire(key("m", { ctrlKey: true }));
    expect(WATCH_SEEN.on).toBe(false);
    resetWatch();
  });

  it("presses the mute button for an N by the same rules, and does not for a held N, a typed one or a modified one", () => {
    resetWatch();
    const w = fakeWindow();
    const p = fakePage();
    createWatchKeys(w.target, p.page, () => true);
    w.fire(key("n"));
    expect(p.clicks()).toBe(1);
    w.fire(key("n", { repeat: true }));
    w.fire(key("n", { target: { tagName: "textarea" } as unknown as EventTarget }));
    w.fire(key("n", { altKey: true }));
    expect(p.clicks()).toBe(1);
    // The N did not turn the watch.
    expect(WATCH_SEEN.on).toBe(false);
    // Other keys reach the engine untouched.
    const reached = w.fire(key("w")).engine;
    expect(w.fire(key("f")).engine).toBe(reached + 1);
  });

  it("reads N on the mute button's cap and shortcut, and keeps it so when the engine draws the button again, and lets go of all of it when undone", () => {
    const w = fakeWindow();
    const p = fakePage();
    const undo = createWatchKeys(w.target, p.page, () => true);
    expect(p.cap()).toBe("N");
    expect(p.aria()).toBe("N");
    p.rebuild();
    expect(p.cap()).toBe("N");
    expect(p.aria()).toBe("N");
    expect(w.count()).toBe(1);
    expect(p.observers()).toBe(1);
    undo();
    expect(w.count()).toBe(0);
    expect(p.observers()).toBe(0);
    relabelMute({ querySelector: () => null });
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
    sayWatch(undefined);
    expect(WATCH_SEEN.on).toBe(true);
    resetWatch();
  });
});
