/**
 * The console's `map`: `map open` shows the large map as if the game were paused, without pausing it (for a link to open on, and for a screen
 * where the pointer cannot be locked), `map close` puts it away, and `map to bar|cafe|lodging|office` makes a place the destination. The
 * address keeps it (`close` is the default and is left out). The command only says what is asked; the minimap reads it each frame.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import type { PlaceKind } from "./mapData.js";

const PLACES: readonly string[] = ["bar", "cafe", "lodging", "office"];

export const MAP_COMMANDS: readonly CommandSpec[] = [
  {
    name: "map",
    kind: "view",
    validate: (args) =>
      (args.length === 1 && (args[0] === "open" || args[0] === "close")) || (args.length === 2 && args[0] === "to" && PLACES.includes(args[1] as string))
        ? null
        : "map takes open, close, or to and one of bar, cafe, lodging, office",
    scriptValue: (args) => args.join(" "),
    defaultValue: "close",
  },
];

/** What the console has asked of the map: the large form open whatever the pause, and a place to go to that has not yet been made the destination. */
export const mapAsk: { open: boolean; to: PlaceKind | null } = { open: false, to: null };

/** Takes the arguments of a `map` command as given. */
export function askMap(args: readonly string[]): void {
  if (args[0] === "open") mapAsk.open = true;
  else if (args[0] === "close") mapAsk.open = false;
  else if (args[0] === "to") mapAsk.to = args[1] as PlaceKind;
}
