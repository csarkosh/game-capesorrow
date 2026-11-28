/**
 * The console's `map`: `map open` shows the large map as if the game were paused, without pausing it (for a link to open on, and for a screen
 * where the pointer cannot be locked), `map close` puts it away, and `map to bar|cafe|lodging|office` makes a place the destination. The
 * address keeps it (`close` is the default and is left out). The command only says what is asked; the minimap reads it each frame.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import type { WatchSeen } from "../hand/watchSeen.js";
import type { PlaceKind } from "./mapData.js";

const PLACES: readonly string[] = ["bar", "cafe", "lodging", "office"];

export const MAP_COMMANDS: readonly CommandSpec[] = [
  {
    name: "map",
    kind: "view",
    validate: (args) =>
      (args.length === 1 && (args[0] === "open" || args[0] === "close" || args[0] === "watch" || args[0] === "unwatch" || args[0] === "dash" || args[0] === "undash")) || (args.length === 2 && args[0] === "to" && PLACES.includes(args[1] as string))
        ? null
        : "map takes open, close, watch, unwatch, dash, undash, or to and one of bar, cafe, lodging, office",
    scriptValue: (args) => args.join(" "),
    defaultValue: "close",
  },
];

/** What the console has asked of the map: the large form open whatever the pause, and a place to go to that has not yet been made the destination. */
export const mapAsk: { open: boolean; to: PlaceKind | null; watch: boolean; dash: boolean } = { open: false, to: null, watch: false, dash: false };

/** A watch face the map draws on when `map watch` is asked for, with no arm to carry it: the round face's bounding square, about a quarter of the view's height across, a third across and two thirds down, a little tilted. */
export const WATCH_FIXTURE: WatchSeen = { on: true, shown: true, raised: 1, quad: new Float32Array([0.32, 0.55, 0.45, 0.575, 0.442, 0.795, 0.312, 0.77]) };

/** Takes the arguments of a `map` command as given. */
export function askMap(args: readonly string[]): void {
  if (args[0] === "open") mapAsk.open = true;
  else if (args[0] === "close") mapAsk.open = false;
  else if (args[0] === "watch") mapAsk.watch = true;
  else if (args[0] === "unwatch") mapAsk.watch = false;
  else if (args[0] === "dash") mapAsk.dash = true;
  else if (args[0] === "undash") mapAsk.dash = false;
  else if (args[0] === "to") mapAsk.to = args[1] as PlaceKind;
}
