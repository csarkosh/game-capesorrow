/**
 * The doors of the town's buildings as the screen shows them: the line at a door ("Click to go in"), whether the screen is dark while a player goes through,
 * and the console's `goin`, which puts the host's player in a room to look at it. The rules are `sim/inside/rules.ts`; the line asks the same questions
 * of the same functions as the host's press does (`streetDoorAt`, `roomDoorAt`), so the line and the action agree.
 */
import type { CommandSpec } from "@csarkosh/engine/game/commands";
import { FOOT } from "../sim/car/types.js";
import { GOING_IN, GOING_OUT, INSIDE, insideRooms, OUTSIDE, roomDoorAt, roomOf, streetDoorAt, type InsideRoom } from "../sim/inside/rooms.js";
import type { Walker } from "../sim.js";
import { roomDrawn } from "./insideReady.js";
import { GO_IN, GO_OUT } from "./words.js";

/** What the line at a door says to a player on foot: to go in at a street door, to go out at a room's door, else nothing (and nothing during a hold). `seed` is the world's, or null where there is none. */
export function doorLine(self: Walker | undefined, seed: number | null): string | null {
  if (self === undefined || seed === null || self.ride.phase !== FOOT) return null;
  if (self.inside.phase === OUTSIDE) return streetDoorAt(seed, self.pos) === undefined ? null : GO_IN;
  if (self.inside.phase !== INSIDE) return null;
  const room = roomOf(seed, self.inside.place);
  return room !== undefined && roomDoorAt(room, self.pos) ? GO_OUT : null;
}

/**
 * Whether the screen is dark: while the player is held at a door, going in or going out, and while they are inside and the room is not yet drawn (its textures
 * are still arriving, `insideReady.ts`). Never from the click, only from the state the host has told.
 */
export function darkFor(self: Walker | undefined): boolean {
  if (self === undefined) return false;
  return self.inside.phase === GOING_IN || self.inside.phase === GOING_OUT || (self.inside.phase === INSIDE && !roomDrawn());
}

/** The places `goin` names: the rooms' names, and `out` for the street. */
export const GOIN_PLACES: readonly string[] = ["bar", "cafe", "lodging", "office", "out"];

/** The room id `goin` names in a world, 0 for the street, or undefined when the name is not a place or the world has no such room. */
export function goinTarget(seed: number, name: string): number | undefined {
  if (name === "out") return 0;
  const rooms = insideRooms(seed);
  for (let i = 0; i < rooms.length; i++) if (rooms[i]?.name === name) return rooms[i]?.id;
  return undefined;
}

/** The words that say which way to look after a spot: toward the street (`front`), the back wall, the left or the right as one comes in. */
export const GOIN_FACES: readonly string[] = ["front", "back", "left", "right"];

/**
 * The console's `goin bar`, `goin cafe`, `goin lodging`, `goin office` and `goin out`, with an optional named spot of the room after the place (`goin lodging room`, `goin bar back`: the place a design names, see
 * `spotOf`) and an optional word for the way to look after that (`goin cafe back front`): kept in the address, so a link opens there, and `out` (its default) is left out of it.
 */
export const INSIDE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "goin",
    kind: "view",
    validate: (args) =>
      args.length >= 1 && args.length <= 3 && GOIN_PLACES.includes(args[0] as string) && (args.length < 2 || /^[a-z0-9]+$/.test(args[1] as string)) && (args.length < 3 || GOIN_FACES.includes(args[2] as string)) && (args.length === 1 || args[0] !== "out")
        ? null
        : "goin takes bar, cafe, lodging, office or out, then a place of the room and a way to look (front, back, left or right)",
    scriptValue: (args) => args.join(" "),
    defaultValue: "out",
  },
];

/** The yaw that looks the way a word says in a room: toward the street, the back wall, left or right as one comes in (yaw 0 looks along +z, and `sin yaw` is the x of the way). */
export function faceYaw(room: InsideRoom, face: string): number {
  const ds = face === "left" ? -1 : face === "right" ? 1 : 0;
  const dd = face === "front" ? -1 : face === "back" ? 1 : 0;
  const x = room.tx * ds - room.nx * dd;
  const z = room.tz * ds - room.nz * dd;
  return Math.atan2(x, z);
}
