/**
 * M flips the watch (the map on the player's left wrist), and sound takes N. A STOPGAP: the engine's mute button owns M (`MUTE_HOTKEY` is a hard-coded "M" in the engine's
 * `game/muteButton.ts`, pressed by `isMuteKey` from a listener of its own on the window), and until the engine lets a game choose that key, the game must take M before the
 * engine sees it. So this listens on the window in the capture phase, which runs before any listener of the engine's:
 *
 * - an M that `isMuteKey` would take is stopped there (`stopImmediatePropagation`) and flips the watch, by the rules of F (`torchKey.ts`): a key-down that is not a repeat,
 *   with the pointer locked to the game, not aimed at a field. (An M typed in a field is the engine's rule too: it is not a mute key then, and is left alone.) With the
 *   pointer not locked it is taken from the mute and flips nothing, so M never mutes;
 * - an N by the same rules presses the engine's mute button (`.mute`), and the button's key cap and its `aria-keyshortcuts` are changed to read N, and kept so if the
 *   engine draws the button again (a watch on the page's body).
 *
 * The engine change that will replace this lets a game name the key of its mute; then this file shrinks to the one listener `torchKey.ts` is (M flipping the watch).
 */
import { isMuteKey } from "@csarkosh/engine/game/muteButton";
import { toggleWatch } from "./watchSeen.js";

export const WATCH_KEY = "KeyM", SOUND_KEY = "n";

type Ev = { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean; target: EventTarget | null; stopImmediatePropagation?(): void; preventDefault?(): void };

/** What the keys are listened for on: a window, or anything that takes its listeners (a test's). */
export type WatchKeyTarget = {
  addEventListener(type: string, listener: (event: Ev) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Ev) => void, capture?: boolean): void;
};

/** The few things of the page this reads (a test's own stand in). */
export type WatchKeyPage = {
  querySelector(selector: string): { click(): void; setAttribute(name: string, value: string): void; querySelector(selector: string): { textContent: string | null } | null } | null;
  /** Calls `fn` when the body's children change, and returns the undoing; none where there is no way to watch. */
  observe?(fn: () => void): () => void;
};

function typing(target: unknown): boolean {
  const el = target as { isContentEditable?: boolean; tagName?: unknown } | null | undefined;
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The mute button's key cap and shortcut, read N. */
export function relabelMute(page: WatchKeyPage): void {
  const button = page.querySelector(".mute");
  if (button === null) return;
  button.setAttribute("aria-keyshortcuts", "N");
  const cap = button.querySelector(".key");
  if (cap !== null && cap.textContent !== "N") cap.textContent = "N";
}

/** Listens for M and N on `target` (null: no keyboard); `playing` says play has the controls. Returns the undoing. */
export function createWatchKeys(target: WatchKeyTarget | null, page: WatchKeyPage | null, playing: () => boolean): () => void {
  const down = (e: Ev): void => {
    if (isMuteKey(e)) {
      // The engine's mute is not for M any more: it never sees it, and the watch flips if play has the controls.
      e.stopImmediatePropagation?.();
      if (playing()) toggleWatch();
      return;
    }
    const typed = e.key.length === 1 ? e.key.toLowerCase() : "";
    if (typed === SOUND_KEY && !(e.ctrlKey || e.altKey || e.metaKey || e.repeat || typing(e.target))) {
      e.stopImmediatePropagation?.();
      page?.querySelector(".mute")?.click();
    }
  };
  target?.addEventListener("keydown", down, true);
  let unwatch: (() => void) | undefined;
  if (page !== null) {
    relabelMute(page);
    unwatch = page.observe?.(() => relabelMute(page));
  }
  return () => {
    target?.removeEventListener("keydown", down, true);
    unwatch?.();
  };
}

/** The real page's side: `document` and a MutationObserver on its body. */
export function realPage(): WatchKeyPage | null {
  if (typeof document === "undefined") return null;
  return {
    querySelector: (s) => document.querySelector(s) as ReturnType<WatchKeyPage["querySelector"]>,
    observe: (fn) => {
      if (typeof MutationObserver === "undefined") return () => undefined;
      const o = new MutationObserver(fn);
      o.observe(document.body, { childList: true, subtree: true });
      return () => o.disconnect();
    },
  };
}
