/**
 * The flashlight's switch for a player on foot. The game's sim has no lamp for a walker (the lamp bit only works the car's lights, from the
 * driver's seat: `carPressed`), and a walker's torch is nobody's business but the one who holds it: another player's screen never draws it. So the
 * switch is the screen's own and not on the wire: F (or the page's lamp button) flips it, and the renderer and the page's lamp button read it.
 * One record for the page, since there is one local player on a screen; `resetHand` puts it back when a session ends.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";

export type HandSwitch = {
  /** The torch is on (the player's own, on foot). */
  on: boolean;
  /** The console's `hand on`: the hand is shown up whatever the lamp does, for looking at it. `hand off` puts it back to following the lamp. */
  forced: boolean;
  /** Whether the lamp bit was down at the last command, so a held key is one press. */
  down: boolean;
};

export const HAND_SWITCH: HandSwitch = { on: false, forced: false, down: false };

/** Flips the torch (the page's lamp button calls this too). */
export function toggleTorch(): void {
  HAND_SWITCH.on = !HAND_SWITCH.on;
}

/**
 * Reads a command's buttons: a lamp bit that was not down a command ago is a press, and a press on foot flips the torch. Returns whether it flipped.
 * A player in a car presses the car's lamps instead (the sim's), so the torch is left as it was.
 */
export function pressLamp(buttons: number, lampBit: number, onFoot: boolean): boolean {
  const down = (buttons & lampBit) !== 0;
  const press = down && !HAND_SWITCH.down;
  HAND_SWITCH.down = down;
  if (!press || !onFoot) return false;
  toggleTorch();
  return true;
}

/** Whether the torch is lit for a player: on foot with it on. */
export function torchLit(onFoot: boolean): boolean {
  return onFoot && HAND_SWITCH.on;
}

/** Whether the hand is shown up: the torch is lit, or the console forced it. */
export function handWanted(lit: boolean): boolean {
  return HAND_SWITCH.forced || lit;
}

export function resetHand(): void {
  HAND_SWITCH.on = false;
  HAND_SWITCH.forced = false;
  HAND_SWITCH.down = false;
}

/**
 * The console's `hand`, for looking at the hand and the light: `hand on` raises the hand and lights the torch (as F does), `hand up` raises the hand alone (the
 * lamp as it is), `hand off` lowers it and puts the torch out. Kept out of the address when it is `off`.
 */
export const HAND_COMMANDS: readonly CommandSpec[] = [
  {
    name: "hand",
    kind: "view",
    validate: (args) => (args.length === 0 || (args.length === 1 && (args[0] === "on" || args[0] === "off" || args[0] === "up")) ? null : "hand takes on, up or off"),
    scriptValue: (args) => (args[0] === "up" ? "up" : args[0] !== "off"),
    defaultValue: false,
  },
];

/** Applies the console's word: `on`, `up` or `off`. */
export function sayHand(word: string | undefined): void {
  if (word === "off") {
    HAND_SWITCH.forced = false;
    HAND_SWITCH.on = false;
    return;
  }
  HAND_SWITCH.forced = true;
  if (word !== "up") HAND_SWITCH.on = true;
}
