/**
 * The empty game's HUD: what the page asks of any game's (`PageHud`) and no
 * more. A line of status, a line that shows for a few seconds, and a Pause
 * button for a screen with no keyboard to press Esc on. Built with DOM APIs
 * and `textContent`: a status line may carry words that came over the wire.
 */
import type { PageHud } from "@csarkosh/engine/game/sessionGame";

const STYLE = `
.walk-hud { position: absolute; inset: 0; pointer-events: none; font: 14px/1.4 ui-monospace, Menlo, monospace; color: #e8e8ea; }
.walk-hud .dark { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
.walk-hud .line { position: absolute; left: 0; right: 0; text-align: center; text-shadow: 0 1px 2px #000; }
.walk-hud .status { top: 46%; }
.walk-hud .flash { bottom: 12%; }
.walk-hud .prompt { top: 56%; }
.walk-hud .prompt.pressable { pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; padding: 10px 0; }
.walk-hud button { position: absolute; top: 12px; right: 12px; pointer-events: auto; font: inherit; color: inherit; background: #0008; border: 1px solid #fff4; border-radius: 4px; padding: 4px 10px; }
`;

/** How long the screen takes to go black, and to clear, in milliseconds: a door's hold is longer than the first, so the screen is black before a player is moved. */
export const DARK_MS = 200, CLEAR_MS = 450;

/**
 * The page's HUD with a line at a door: the line, or none, and what a press of it does (a touch player's interact); and a black cover over the
 * scene (under the lines) that goes dark and clears by a fade, for walking through a door.
 */
export type WalkHud = PageHud & { setPrompt(line: string | null, press?: { down(): void; up(): void }): void; setDark(dark: boolean): void };

/** A line of status alone, for a start's waits and its failure. */
export function createStatusLine(container: HTMLElement): { setStatus(line: string | null): void; dispose(): void } {
  const hud = createWalkHud(container, null);
  return { setStatus: hud.setStatus, dispose: hud.dispose };
}

export function createWalkHud(container: HTMLElement, hooks: { onPause(): void } | null): WalkHud {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "walk-hud";
  // First in the root, so that every line is over it.
  const cover = document.createElement("div");
  cover.className = "dark";
  const status = document.createElement("div");
  status.className = "line status";
  const flash = document.createElement("div");
  flash.className = "line flash";
  const pause = document.createElement("button");
  pause.type = "button";
  pause.hidden = true;
  pause.addEventListener("click", () => hooks?.onPause());
  const prompt = document.createElement("div");
  prompt.className = "line prompt";
  // A press of the line is the interact's: down on the pointer's going down, up on its going up or being taken.
  let press: { down(): void; up(): void } | null = null;
  let pressing = false;
  const release = (): void => {
    if (!pressing) return;
    pressing = false;
    press?.up();
  };
  prompt.addEventListener("pointerdown", (e) => {
    if (press === null || pressing) return;
    e.preventDefault();
    pressing = true;
    press.down();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) prompt.addEventListener(type, release);
  root.append(cover, status, flash, prompt, pause);
  container.append(style, root);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    setStatus(line) {
      status.textContent = line ?? "";
    },
    flash(line, ms) {
      flash.textContent = line;
      if (flashTimer !== null) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flash.textContent = "";
        flashTimer = null;
      }, ms);
    },
    setPrompt(line, next) {
      // A line that goes while it is held lets go first.
      if (line === null || next === undefined) release();
      press = line === null ? null : (next ?? null);
      prompt.textContent = line ?? "";
      prompt.classList.toggle("pressable", press !== null);
    },
    setDark(dark) {
      cover.style.transition = `opacity ${dark ? DARK_MS : CLEAR_MS}ms ease`;
      cover.style.opacity = dark ? "1" : "0";
    },
    // The empty game carries no lamp, so there is no hint of one to show.
    setLamp: () => undefined,
    setPause(shown) {
      pause.hidden = shown === null || hooks === null;
      if (shown !== null) pause.textContent = `Pause (${shown.key})`;
    },
    dispose() {
      if (flashTimer !== null) clearTimeout(flashTimer);
      root.remove();
      style.remove();
    },
  };
}
