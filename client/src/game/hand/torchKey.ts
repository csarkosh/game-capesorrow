/**
 * F, on foot, flips the torch, and nothing else does. The key is read from the keyboard itself, as the view's keys are (`car/viewKeys.ts`), and not from the lamp bit
 * of the command: that bit is a level the sampler raises for as long as a key or the touch layer's button asks, and the same bit is the car's switch, so a torch flipped by
 * it could be flipped by anything that raised it (a key held over a pause, a touch, a replayed command). A key-down that is not a repeat, while play has the controls and
 * the key is not being typed into a field, with the player on foot, is one flip. A touch player's lamp button still arrives as the bit (`pressLamp`).
 */
import { toggleTorch } from "./handSwitch.js";

/** What the key is listened for on: a window, or anything that takes its listeners (a test's). */
export type TorchKeyTarget = {
  addEventListener(type: string, listener: (event: { code?: string; repeat?: boolean; target?: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { code?: string; repeat?: boolean; target?: unknown }) => void): void;
};

export const TORCH_KEY = "KeyF";

function typing(target: unknown): boolean {
  const el = target as { isContentEditable?: boolean; tagName?: unknown } | null | undefined;
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Listens for F on `target` (null: no keyboard). `playing` says play has the controls, `onFoot` that the local player is on foot. Returns the listener's undoing. */
export function createTorchKey(target: TorchKeyTarget | null, playing: () => boolean, onFoot: () => boolean): () => void {
  const down = (e: { code?: string; repeat?: boolean; target?: unknown }): void => {
    if (e.code !== TORCH_KEY || e.repeat === true || typing(e.target) || !playing() || !onFoot()) return;
    toggleTorch();
  };
  target?.addEventListener("keydown", down);
  return () => target?.removeEventListener("keydown", down);
}
