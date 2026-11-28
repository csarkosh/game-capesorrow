/**
 * The game's HUD: what the page asks of any game's (`PageHud`), a line of status, a line that shows for a few seconds, the line at a car's
 * door, the people's captions, the black cover for a door, the map in the corner (`game/map/`), and, for a keyboard, the Pause button at the
 * top left under the page's mute button and the lamp's hint at the bottom left, drawn as Day Hike's are (the touch layer has its own
 * buttons, and the page hides these on a touch screen). Built with DOM APIs and `textContent`: a status line may carry words that came
 * over the wire.
 */
import { lineIcon } from "@csarkosh/engine/game/icons";
import type { PageHud } from "@csarkosh/engine/game/sessionGame";
import { MAP_BUTTON_LABEL, PAUSE_LABEL } from "./game/words.js";
import { WATCH_SEEN, toggleWatch } from "./game/hand/watchSeen.js";
import type { MapFrame } from "./game/map/mapFeed.js";
import { createMinimap } from "./game/map/minimap.js";

const STYLE = `
.walk-hud { position: absolute; inset: 0; pointer-events: none; font: 14px/1.4 ui-monospace, Menlo, monospace; color: #e8e8ea; }
.walk-hud .dark { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
.walk-hud .line { position: absolute; left: 0; right: 0; text-align: center; text-shadow: 0 1px 2px #000; }
.walk-hud .status { top: 46%; }
.walk-hud .flash { bottom: 12%; }
/* On a narrow screen the map in the corner (148 px) stands where this line's text would run: the line goes over it. */
@media (max-width: 519px) { .walk-hud .flash { bottom: 176px; } }
.walk-hud .prompt { top: 56%; }
.walk-hud .prompt.pressable { pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; padding: 10px 0; }
.walk-hud .say { position: absolute; transform: translate(-50%, -100%); max-width: 22em; padding: 3px 8px; border-radius: 6px; background: #0b0d10b8; color: #f0efe9; font: 13px/1.3 ui-sans-serif, system-ui, sans-serif; text-align: center; white-space: normal; text-shadow: 0 1px 1px #000; will-change: transform, opacity; }
.walk-hud .say.mean { color: #ffd9c2; }
/* The lamp's hint and the Pause button are Day Hike's (game-dayhike client/src/game/hud.ts), to the pixel: the rules are repeated here, not shared. */
/* The lamp's hint, for a keyboard: the lamp's icon and its key, at the bottom left corner (the map and the roster sit at the right), as faint as the touch controls sit and lit with the lamp. Hidden by default: the touch layer has its own button. */
.walk-hud .lamp {
  position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  display: none; align-items: center; gap: 8px; padding: 6px 10px 6px 8px;
  color: #fff; background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 22px;
  font: 500 13px/1 system-ui, sans-serif; opacity: 0.35; transition: opacity 300ms ease-out, box-shadow 300ms ease-out;
}
.walk-hud .lamp.shown { display: flex; }
.walk-hud .lamp.lit { opacity: 1; box-shadow: 0 0 0 1px #ffd24d; }
.walk-hud .lamp svg { width: 22px; height: 22px; display: block; }
.walk-hud .lamp .key, .walk-hud .pause .key, .walk-hud .mapbtn .key {
  display: inline-block; min-width: 1.4em; padding: 3px 5px; text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.45); border-bottom-width: 2px; border-radius: 4px;
  font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 0.04em;
}
/* The map button, under the lamp's hint at the same gap as the Pause button is under the mute (10 px): the watch's switch, lit with the same yellow ring while the watch is on. It is a button on every screen: on a touch screen it stands over the touch layer's own lamp button. */
.walk-hud .mapbtn {
  position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  display: none; align-items: center; gap: 8px; padding: 6px 10px 6px 8px; pointer-events: auto; cursor: pointer;
  color: #fff; background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 22px;
  font: 500 13px/1 system-ui, sans-serif; opacity: 0.35; transition: opacity 300ms ease-out, box-shadow 300ms ease-out;
}
.walk-hud .mapbtn.shown { display: flex; }
.walk-hud .mapbtn.lit { opacity: 1; box-shadow: 0 0 0 1px #ffd24d; }
.walk-hud .mapbtn:hover, .walk-hud .mapbtn:focus-visible { opacity: 1; }
.walk-hud .mapbtn:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px; }
.walk-hud .mapbtn svg { width: 22px; height: 22px; display: block; }
.walk-hud .mapbtn.touch { bottom: calc(208px + env(safe-area-inset-bottom, 0px)); }
/* The Pause button, for a keyboard: the bars and the key that pauses, at the top left corner where the touch layer's own Pause sits; the page's mute sits over it. As faint as the lamp's hint, up under the pointer and on focus, and pressed it pauses as the key does. Hidden by default. */
.walk-hud .pause {
  /* Under the mute button, 44px tall at 14px from the corner. */
  position: absolute; left: calc(14px + env(safe-area-inset-left, 0px)); top: calc(68px + env(safe-area-inset-top, 0px));
  display: none; align-items: center; gap: 8px; height: 44px; box-sizing: border-box; padding: 0 12px 0 10px;
  pointer-events: auto; cursor: pointer;
  color: #fff; background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 22px;
  font: 500 13px/1 system-ui, sans-serif; opacity: 0.35; transition: opacity 120ms ease-out;
}
.walk-hud .pause.shown { display: flex; }
.walk-hud .pause:hover, .walk-hud .pause:focus-visible { opacity: 1; }
.walk-hud .pause:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px; }
.walk-hud .pause svg { width: 22px; height: 22px; display: block; }
`;

/** How long the screen takes to go black, and to clear, in milliseconds: a door's hold is longer than the first, so the screen is black before a player is moved. */
export const DARK_MS = 200, CLEAR_MS = 450;

/**
 * The page's HUD with a line at a door: the line, or none, and what a press of it does (a touch player's interact); and a black cover over the
 * scene (under the lines) that goes dark and clears by a fade, for walking through a door.
 */
export type WalkHud = PageHud & {
  setPrompt(line: string | null, press?: { down(): void; up(): void }): void;
  /** What the lamp's hint shows the icon of: the hand torch on foot, the car's headlights while the local player drives, or null where F switches no lamp (a passenger, a player getting in or out), which hides the hint. */
  setLampKind(kind: LampKind | null): void;
  /** The hint now: its kind, its key and whether it is lit, or null while none shows. */
  lamp(): { kind: LampKind; key: string; on: boolean } | null;
  /** The Pause button now: its key, or null while none shows. */
  pause(): { key: string } | null;
  setDark(dark: boolean): void;
  /** The lines the town's people are saying, each over its speaker's head: across and down as shares of the view, the words, and how much of it shows. */
  /** The local player as the map is to show them, or null where there is none (the map is then hidden). */
  setMap(frame: MapFrame | null): void;
  setSpeech(lines: readonly { readonly x: number; readonly y: number; readonly text: string; readonly alpha: number; readonly depth: number; readonly mean: boolean }[]): void;
};

/** What the lamp's hint draws: the hand torch, or the car's headlights. */
export type LampKind = "lamp" | "headlights";

/**
 * The car's headlights as a line icon, in the strokes of the engine's (`lineIcon`: 24 units, 1.6 wide, round ends and joins): the lamp's
 * housing, a D, and three beams leaving it.
 */
function lineIconOf(paths: readonly string[]): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function headlightIcon(): SVGSVGElement {
  return lineIconOf(["M3.5 7.5h5.5a4.5 4.5 0 0 1 0 9H3.5z", "M15.5 8.5l5-2", "M16 12h5", "M15.5 15.5l5 2"]);
}

/** A folded map as a line icon, in the same strokes: three panels, and the two folds. */
export function mapIcon(): SVGSVGElement {
  return lineIconOf(["M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z", "M9 4.5v13", "M15 6.5v13"]);
}

/** A line of status alone, for a start's waits and its failure. */
export function createStatusLine(container: HTMLElement): { setStatus(line: string | null): void; dispose(): void } {
  const hud = createWalkHud(container, null);
  return { setStatus: hud.setStatus, dispose: hud.dispose };
}

/** The lamp's hint and the Pause button, as Day Hike's HUD makes them: the button's click is the hook's. */
function makeControls(hooks: { onPause(): void }): { lamp: HTMLElement; lampKey: HTMLElement; pause: HTMLElement; pauseKey: HTMLElement; mapBtn: HTMLElement } {
  const lamp = document.createElement("div");
  lamp.className = "lamp";
  lamp.setAttribute("aria-hidden", "true");
  const lampKey = document.createElement("span");
  lampKey.className = "key";
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "pause";
  pause.setAttribute("aria-label", PAUSE_LABEL);
  const pauseKey = document.createElement("span");
  pauseKey.className = "key";
  pause.append(lineIcon("pause"), pauseKey);
  pause.addEventListener("click", () => hooks.onPause());
  const mapBtn = document.createElement("button");
  mapBtn.type = "button";
  mapBtn.className = "mapbtn";
  mapBtn.setAttribute("aria-label", MAP_BUTTON_LABEL);
  mapBtn.setAttribute("aria-keyshortcuts", "G");
  const mapKey = document.createElement("span");
  mapKey.className = "key";
  mapKey.textContent = "G";
  mapBtn.append(mapIcon(), mapKey);
  mapBtn.addEventListener("click", () => toggleWatch());
  return { lamp, lampKey, pause, pauseKey, mapBtn };
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
  // The people's lines: a few captions, made as they are needed and kept, under the status and the prompt.
  const says: HTMLDivElement[] = [];
  const speech = document.createElement("div");
  speech.className = "speech";
  // The lamp's hint and the Pause button: the game's own HUD has them (a status line alone has none).
  const controls = hooks === null ? null : makeControls(hooks);
  root.append(cover, speech, status, flash, prompt, ...(controls === null ? [] : [controls.lamp, controls.mapBtn, controls.pause]));
  container.append(style, root);
  // The map in the corner: only the game's own HUD has one (a status line alone has none), and only where there is a page to put it on.
  const map = hooks === null || typeof window === "undefined" ? null : createMinimap(container, hooks);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  // The shell says whether a lamp's hint is wanted, with its key and whether the lamp is on; the game says which lamp it is. The hint shows when both do.
  let wanted: { key: string; on: boolean } | null = null;
  let kind: LampKind | null = null;
  let drawn: LampKind | null = null;
  const icons: Record<LampKind, SVGSVGElement | null> = { lamp: null, headlights: null };
  const paintLamp = (): void => {
    if (controls === null) return;
    const { lamp, lampKey } = controls;
    const show = wanted !== null && kind !== null;
    lamp.classList.toggle("shown", show);
    lamp.classList.toggle("lit", show && wanted?.on === true);
    lampKey.textContent = show ? (wanted?.key ?? "") : "";
    const k = kind;
    if (show && k !== null && k !== drawn) {
      const icon = (icons[k] ??= k === "lamp" ? lineIcon("lamp") : headlightIcon());
      lamp.replaceChildren(icon, lampKey);
      drawn = k;
    }
  };
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
    setMap(frame) {
      map?.frame(frame);
      if (controls !== null) {
        // The map button is there while there is a player to wear the watch; lit while the watch is on; on a touch screen it stands over the touch layer's lamp button.
        controls.mapBtn.classList.toggle("shown", frame !== null);
        controls.mapBtn.classList.toggle("lit", WATCH_SEEN.on);
        controls.mapBtn.classList.toggle("touch", frame?.touch === true);
      }
    },
    setDark(dark) {
      cover.style.transition = `opacity ${dark ? DARK_MS : CLEAR_MS}ms ease`;
      cover.style.opacity = dark ? "1" : "0";
    },
    setSpeech(lines) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as (typeof lines)[number];
        let el = says[i];
        if (el === undefined) {
          el = document.createElement("div");
          speech.append(el);
          says.push(el);
        }
        // `textContent`, as every line of the HUD is set.
        if (el.textContent !== line.text) el.textContent = line.text;
        el.className = line.mean ? "say mean" : "say";
        el.style.left = `${(line.x * 100).toFixed(2)}%`;
        el.style.top = `${(line.y * 100).toFixed(2)}%`;
        el.style.opacity = line.alpha.toFixed(2);
        // Smaller the further off, within what is still read.
        el.style.fontSize = `${Math.max(10.5, Math.min(14, 15 - line.depth * 0.22)).toFixed(1)}px`;
        el.hidden = false;
      }
      for (let i = lines.length; i < says.length; i++) (says[i] as HTMLDivElement).hidden = true;
    },
    setLamp(state) {
      wanted = state;
      paintLamp();
    },
    setLampKind(next) {
      kind = next;
      paintLamp();
    },
    lamp: () => (controls !== null && controls.lamp.classList.contains("shown") && drawn !== null ? { kind: drawn, key: controls.lampKey.textContent ?? "", on: controls.lamp.classList.contains("lit") } : null),
    setPause(state) {
      if (controls === null) return;
      controls.pause.classList.toggle("shown", state !== null);
      controls.pauseKey.textContent = state?.key ?? "";
    },
    pause: () => (controls !== null && controls.pause.classList.contains("shown") ? { key: controls.pauseKey.textContent ?? "" } : null),
    dispose() {
      if (flashTimer !== null) clearTimeout(flashTimer);
      map?.dispose();
      root.remove();
      style.remove();
    },
  };
}
