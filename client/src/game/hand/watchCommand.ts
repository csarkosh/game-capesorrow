/** The console's `watch`, for looking at the left arm and the watch: `watch on` raises it, `watch off` lowers it. Kept out of the address when it is off. */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import { WATCH_SEEN } from "./watchSeen.js";

export const WATCH_COMMANDS: readonly CommandSpec[] = [
  {
    name: "watch",
    kind: "view",
    validate: (args) => (args.length === 0 || (args.length === 1 && (args[0] === "on" || args[0] === "off")) ? null : "watch takes on or off"),
    scriptValue: (args) => args[0] !== "off",
    defaultValue: false,
  },
];

/** Applies the console's word. */
export function sayWatch(word: string | undefined): void {
  WATCH_SEEN.on = word !== "off";
}
