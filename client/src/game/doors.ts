/**
 * The doors of the town's buildings as the screen shows them: the line at a door ("Click to go in"), whether the screen is dark while a player goes through,
 * and the console's `goin`, which puts the host's player in a room to look at it. The rules are `sim/inside/rules.ts`; the line asks the same questions
 * of the same functions as the host's press does (`streetDoorAt`, `roomDoorAt`), so the line and the action agree.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import { FOOT } from "../sim/car/types.js";
import { GOING_IN, GOING_OUT, INSIDE, insideRooms, OUTSIDE, roomDoorAt, roomOf, streetDoorAt } from "../sim/inside/rooms.js";
import type { Walker } from "../sim.js";
import { GO_IN, GO_OUT } from "./words.js";

/** What the line at a door says to a player on foot: to go in at a street door, to go out at a room's door, else nothing (and nothing during a hold). `seed` is the world's, or null where there is none. */
export function doorLine(self: Walker | undefined, seed: number | null): string | null {
  if (self === undefined || seed === null || self.ride.phase !== FOOT) return null;
  if (self.inside.phase === OUTSIDE) return streetDoorAt(seed, self.pos) === undefined ? null : GO_IN;
  if (self.inside.phase !== INSIDE) return null;
  const room = roomOf(seed, self.inside.place);
  return room !== undefined && roomDoorAt(room, self.pos) ? GO_OUT : null;
}

/** Whether the screen is dark: while the player is held at a door, going in or going out. Never from the click, only from the state the host has told. */
export function darkFor(self: Walker | undefined): boolean {
  return self !== undefined && (self.inside.phase === GOING_IN || self.inside.phase === GOING_OUT);
}

/** The places `goin` names: the rooms' names, and `out` for the street. */
export const GOIN_PLACES: readonly string[] = ["bar", "cafe", "lodging", "out"];

/** The room id `goin` names in a world, 0 for the street, or undefined when the name is not a place or the world has no such room. */
export function goinTarget(seed: number, name: string): number | undefined {
  if (name === "out") return 0;
  const rooms = insideRooms(seed);
  for (let i = 0; i < rooms.length; i++) if (rooms[i]?.name === name) return rooms[i]?.id;
  return undefined;
}

/** The console's `goin bar`, `goin cafe`, `goin lodging` and `goin out`: kept in the address, so a link opens in the room, and `out` (its default) is left out of it. */
export const INSIDE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "goin",
    kind: "view",
    validate: (args) => (args.length === 1 && GOIN_PLACES.includes(args[0] as string) ? null : "goin takes bar, cafe, lodging or out"),
    scriptValue: (args) => args[0] as string,
    defaultValue: "out",
  },
];
