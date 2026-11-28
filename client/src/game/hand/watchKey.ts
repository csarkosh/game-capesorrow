/**
 * G flips the watch (the map on the player's left wrist), by the rules of F (`torchKey.ts`) and of the engine's own letter keys: a key-down that is not a repeat, with the pointer
 * locked to the game (play has the controls), no Ctrl, Alt or Cmd held, not aimed at a field where a letter is a letter, on foot and in a car alike. It is G, or, where the layout types
 * a letter of another script, the key in G's place (as the engine's mute reads M, `isMuteKey`). M is the engine's mute and is not touched here.
 */
import { toggleWatch } from "./watchSeen.js";

export const WATCH_KEY = "KeyG";

type Ev = { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean; target: EventTarget | null };

/** What the key is listened for on: a window, or anything that takes its listeners (a test's). */
export type WatchKeyTarget = {
  addEventListener(type: string, listener: (event: Ev) => void): void;
  removeEventListener(type: string, listener: (event: Ev) => void): void;
};

function typing(target: unknown): boolean {
  const el = target as { isContentEditable?: boolean; tagName?: unknown } | null | undefined;
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Whether a press is the watch's key: the G the layout types, or, where it types a letter of another script, the key in G's place. */
export function isWatchKey(e: Ev): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || typing(e.target)) return false;
  const typed = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (typed === "g") return true;
  return e.code === WATCH_KEY && /^\p{L}$/u.test(typed) && !/^[a-z]$/.test(typed);
}

/** Listens for G on `target` (null: no keyboard); `playing` says play has the controls. Returns the undoing. */
export function createWatchKey(target: WatchKeyTarget | null, playing: () => boolean): () => void {
  const down = (e: Ev): void => {
    if (playing() && isWatchKey(e)) toggleWatch();
  };
  target?.addEventListener("keydown", down);
  return () => target?.removeEventListener("keydown", down);
}
