/**
 * The keys that change the view from the car and nothing else: C, held, looks behind; V switches the cinematic view on and off. They are
 * the player's own screen's, so they are no part of the command the simulation is sent: this listens to the keyboard itself, and only
 * while play has the controls (`playing`: the pointer is locked to the game) and the key is not being typed into a field.
 */

export type ViewKeys = {
  /** Whether the look-behind key is down. */
  behind(): boolean;
  /** Whether the cinematic view is on. */
  cine(): boolean;
  /** Switches the cinematic view off: the player is out of the car. */
  cineOff(): void;
  dispose(): void;
};

/** What the keys are listened for on: a window, or anything that takes its listeners (a test's). */
export type KeyTarget = {
  addEventListener(type: string, listener: (event: KeyPress) => void): void;
  removeEventListener(type: string, listener: (event: KeyPress) => void): void;
};

/** What of a key's event is read (a blur has none of it). */
export type KeyPress = { code?: string; repeat?: boolean; target?: unknown };

export const BEHIND_KEY = "KeyC", CINE_KEY = "KeyV";

/** Whether the event is aimed at something that takes text, where a letter is a letter. */
function typing(target: unknown): boolean {
  const el = target as { isContentEditable?: boolean; tagName?: unknown } | null | undefined;
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The view's keys on `target` (null where there is no keyboard to listen to: both answers stay false). */
export function createViewKeys(target: KeyTarget | null, playing: () => boolean): ViewKeys {
  let behind = false;
  let cine = false;
  const down = (e: KeyPress): void => {
    if (e.repeat === true || typing(e.target) || !playing()) return;
    if (e.code === BEHIND_KEY) behind = true;
    else if (e.code === CINE_KEY) cine = !cine;
  };
  // A key let go is let go wherever it happens, so no view is left turned by a key that came up while a menu was open.
  const up = (e: KeyPress): void => {
    if (e.code === BEHIND_KEY) behind = false;
  };
  const blur = (): void => {
    behind = false;
  };
  target?.addEventListener("keydown", down);
  target?.addEventListener("keyup", up);
  target?.addEventListener("blur", blur);
  return {
    behind: () => behind && playing(),
    cine: () => cine,
    cineOff() {
      cine = false;
    },
    dispose() {
      target?.removeEventListener("keydown", down);
      target?.removeEventListener("keyup", up);
      target?.removeEventListener("blur", blur);
      behind = false;
      cine = false;
    },
  };
}
