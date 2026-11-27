/**
 * The inside of the municipal building: the fourth room a player can walk into, and the one the player's office is in. The plan holds nothing for it
 * (`plan.uses` of the building has no unit and no interior, and the plan must not change: its digests are pinned), so its inside is made here from the
 * building's own front frame alone, the same on every peer, as a plan's `Interior` in the plan's own types so that the town's room builders draw it.
 *
 * What it is: the building's whole front width and `DEPTH` deep or less, a hall with the street door (the place's pair of doors) at its middle `C`, the city
 * clerk's counter on the left of the hall and the sheriff's on the right (which side is which does not vary), a partition across the room at `P` behind the
 * counters with two doorways in it, one into the player's office (left of the way in, at `C - 2.4`) and one a shut door (right, at `C + 3.0`; nobody
 * goes through it and it is solid), and the player's office behind the partition, closed by a partition on each side. Benches, plants, a water cooler and a
 * low table stand along the front wall and in the hall, none in the door's zone nor in the way from the door to the office's doorway.
 *
 * Nothing here says what the building is to the town but a city's and a sheriff's: no other service is named in it.
 *
 * Simulation code: the arithmetic of AGENTS.md ("The simulation's rules") applies, and collections are never walked for their order.
 */
import { hashSeed } from "../town/rng.js";
import { planFor } from "../town/planFor.js";
import type { Furnishing, Interior, RoomLight } from "../town/types.js";

const { floor, max, min, round } = Math;

/** The most the room is deep, its ceiling, and the thickness of a partition (metres). */
export const MUNICIPAL_DEPTH = 14;
export const MUNICIPAL_CEILING = 3.6;
export const PARTITION = 0.15;
/** The width of the doorways in the back partition. */
export const DOORWAY = 1.1;
/** The way from the street door to the office's doorway, as the width of a capsule round the line between them, and the door's zone (beside the door and out from the front wall). */
export const WAY_WIDTH = 1.6;
export const DOOR_ZONE_DEEP = 2.4;
export const DOOR_ZONE_SIDE = 0.45;

/** A thing in the room that is not one of the plan's furnishings: it is drawn by the municipal room's own dressing and is solid. */
export type MunicipalFixture = { readonly kind: "door" | "flag"; readonly s: number; readonly d: number; /** Half its length along `s` and half across. */ readonly ha: number; readonly hb: number };

/** Someone who stands or sits in the room, at a fixed place of the room's frame. `sits` is the seat's height over the floor for a sitter. */
export type MunicipalPerson = {
  readonly s: number;
  readonly d: number;
  readonly face: { readonly s: number; readonly d: number };
  readonly activity: "idle" | "till" | "talk" | "wait" | "sit_rest" | "look";
  readonly role: "staff" | "customer";
  readonly sits: number | null;
};

/** Where the room's own dressing goes, in the room's frame. */
export type MunicipalMarks = {
  /** The partition's face (toward the hall) at `d = back`: the stations the boards over the counters are centred on. */
  readonly back: number;
  readonly cityS: number;
  readonly sheriffS: number;
  /** The office's doorway, the shut door's, and the office's two side partitions (stations). */
  readonly officeDoor: number;
  readonly shutDoor: number;
  readonly officeLeft: number;
  readonly officeRight: number;
  /** The flag's stand. */
  readonly flag: { readonly s: number; readonly d: number };
  /** The stations of the hall's front windows, in the building's front wall's own stations from its left end (the street side's rhythm, `plainFront`), with their index along the front (which the window's look is rolled by). */
  readonly bays: readonly { readonly s: number; readonly index: number }[];
};

export type Municipal = {
  readonly building: number;
  readonly width: number;
  readonly depth: number;
  readonly doorS: number;
  readonly doorWidth: number;
  readonly interior: Interior;
  readonly fixtures: readonly MunicipalFixture[];
  readonly people: readonly MunicipalPerson[];
  readonly marks: MunicipalMarks;
};

const cm = (x: number): number => round(x * 100) / 100;
const AXIS_S = { x: 1, z: 0 };
const AXIS_D = { x: 0, z: 1 };

/** A hash of the building's id and a salt to [0, 1): the town's own multiplication hash (`hash01` of `game/town/meshBuilder.ts`), written out here since the simulation imports nothing of the game. */
function hash01(n: number, salt: number): number {
  let h = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const furnishing = (kind: Furnishing["kind"], s: number, d: number, sx: number, sd: number, h: number, dir: { x: number; z: number } = AXIS_S): Furnishing => ({ kind, s: cm(s), d: cm(d), sx: cm(sx), sd: cm(sd), h, dir });

const MADE = new Map<number, Municipal>();

/** The municipal building's inside for a world's seed. */
export function municipalInterior(seed: number): Municipal {
  let made = MADE.get(seed);
  if (made === undefined) {
    made = make(seed);
    MADE.set(seed, made);
  }
  return made;
}

function make(seed: number): Municipal {
  const plan = planFor(seed);
  const office = plan.places.office;
  const use = plan.uses[office.building];
  const frame = use?.frame;
  if (frame === undefined || frame === null || office.door === null) throw new Error("the municipal building has no front to make a room behind");
  const W = frame.width;
  const D = cm(min(MUNICIPAL_DEPTH, frame.depth - 1.5));
  const C = office.door.s;
  const door = office.door.width;
  const roll = (salt: number): number => hash01(hashSeed(seed, office.building), salt);
  // The back partition stands 7.2 m in, or 2.4 m short of the back wall in a shallow building.
  const P = cm(min(7.2, D - 2.4));
  const gO = cm(C - 2.4);
  const gS = cm(C + 3.0);
  const half = DOORWAY / 2;
  const left = cm(C - 6.2);
  const right = cm(C - 0.3);
  const od = D - P;
  const f: Furnishing[] = [];

  // ---- the walls inside: the back partition in three stretches round its two doorways, and the office's two side partitions.
  const stretch = (a: number, b: number): void => {
    if (b - a > 0.05) f.push(furnishing("partition", (a + b) / 2, P, b - a, PARTITION, MUNICIPAL_CEILING));
  };
  stretch(0, gO - half);
  stretch(gO + half, gS - half);
  stretch(gS + half, W);
  for (const s of [left, right]) f.push(furnishing("partition", s, (P + D) / 2, D - P, PARTITION, MUNICIPAL_CEILING, AXIS_D));

  // ---- the city clerk's counter, left of the hall: the counter along s at d 4.4, a desk and two cabinets behind it.
  const cityFrom = 0.8;
  const cityTo = cm(C - 3.0);
  f.push(furnishing("counter", (cityFrom + cityTo) / 2, 4.4, cityTo - cityFrom, 0.7, 1.05));
  f.push(furnishing("desk", 1.9, 5.7, 1.6, 0.8, 0.75));
  f.push(furnishing("cabinet", 3.4, 6.8, 1.4, 0.55, 1.3));
  f.push(furnishing("cabinet", 5.0, 6.8, 1.2, 0.55, 1.3));

  // ---- the sheriff's, right of the hall: the same shape mirrored, with two desks and two cabinets behind it.
  const sheriffFrom = cm(C + 3.0);
  const sheriffTo = cm(W - 0.8);
  f.push(furnishing("counter", (sheriffFrom + sheriffTo) / 2, 4.4, sheriffTo - sheriffFrom, 0.7, 1.05));
  f.push(furnishing("desk", W - 1.9, 5.7, 1.6, 0.8, 0.75));
  f.push(furnishing("desk", W - 3.9, 5.7, 1.6, 0.8, 0.75));
  // The cabinets keep clear of the shut door (its right jamb is at `C + 3.55`; a hall's width is never under 19 m).
  f.push(furnishing("cabinet", W - 3.4, 6.8, 1.4, 0.55, 1.3));
  f.push(furnishing("cabinet", W - 5.2, 6.8, 1.4, 0.55, 1.3));

  // ---- the hall: benches against the front wall either side of the door, plants, a cooler, a low table and the flag. Nothing in the door's zone.
  const benchLeft = f.length;
  f.push(furnishing("bench", C - 3.1, 0.62, 1.8, 0.45, 0.45));
  const rightBench = roll(1) < 0.7;
  const benchRight = rightBench ? f.length : -1;
  if (rightBench) f.push(furnishing("bench", C + 3.1, 0.62, 1.8, 0.45, 0.45));
  // The plants stand just outside the door's zone, one a little further out in some towns.
  f.push(furnishing("plant", C - 2.0 - (roll(2) < 0.4 ? 0.1 : 0), 0.55, 0.4, 0.4, 1.2));
  f.push(furnishing("plant", C + 2.0 + (roll(3) < 0.4 ? 0.1 : 0), 0.55, 0.4, 0.4, 1.1));
  f.push(furnishing("water cooler", C + (rightBench ? 4.5 : 3.4), 0.45, 0.3, 0.3, 1.4));
  f.push(furnishing("table", C + 2.7, 2.8, 0.9, 0.5, 0.45));
  // The flag stands against the partition between the clock and the shut door, where it hides neither counter's board from the door.
  const flag = { s: cm(C + 1.25), d: cm(P - 0.4) };

  // ---- the player's office behind the partition: a desk, a couch against the right wall, two cabinets on the back wall, a plant, a table with a lamp.
  f.push(furnishing("desk", C - 4.4, P + min(2.4, od * 0.35), 1.6, 0.8, 0.75));
  f.push(furnishing("cabinet", C - 5.1, D - 0.3, 1.4, 0.55, 1.3));
  f.push(furnishing("cabinet", C - 1.4, D - 0.3, 1.4, 0.55, 1.3));
  f.push(furnishing("plant", C - 5.8, P + 0.6, 0.4, 0.4, 1.3));
  const roomy = od >= 4.5;
  const couch = f.length;
  if (roomy) {
    f.push(furnishing("couch", C - 0.85, P + 2.4, 1.8, 0.85, 0.85, AXIS_D));
    f.push(furnishing("table", C - 0.95, P + 4.2, 0.7, 0.5, 0.45, AXIS_D));
  }

  const lights: RoomLight[] = [];
  // Tubes on a grid of about 4 m over the hall and the staff's side, all on; pendants over the office.
  const rows = [1.6, 5.4];
  const cols = max(2, round(W / 4));
  for (const d of rows) for (let k = 0; k < cols; k++) lights.push({ s: cm(((k + 0.5) * W) / cols), d, h: 3.5, on: true, kind: "tube" });
  lights.push({ s: cm(C - 3.2), d: cm(P + od * 0.5), h: 3.3, on: true, kind: "pendant" });
  lights.push({ s: cm(C - 1.2), d: cm(P + od * 0.5), h: 3.3, on: true, kind: "pendant" });
  // The lamp by the table in the office, and one in the hall by the benches.
  if (roomy) lights.push({ s: cm(C - 1.4), d: cm(P + 5.0), h: 1.1, on: true, kind: "lamp" });
  lights.push({ s: cm(C - 4.6), d: 0.55, h: 1.1, on: true, kind: "lamp" });

  const interior: Interior = { type: "lobby", depth: D, ceiling: MUNICIPAL_CEILING, furnishings: f, lights, thin: false };

  const fixtures: MunicipalFixture[] = [
    { kind: "door", s: gS, d: P, ha: half, hb: PARTITION / 2 },
    { kind: "flag", s: flag.s, d: flag.d, ha: 0.25, hb: 0.25 },
  ];

  // ---- the people: a clerk behind the city's counter, a deputy behind the sheriff's, and one or two visitors.
  const people: MunicipalPerson[] = [
    { s: cm(3.2), d: 5.05, face: { s: 0, d: -1 }, activity: "till", role: "staff", sits: null },
    { s: cm(W - 4.9), d: 5.05, face: { s: 0, d: -1 }, activity: "idle", role: "staff", sits: null },
    // A visitor on the left bench, looking into the hall.
    { s: cm(C - 3.1 - 0.4), d: 0.62, face: { s: 0, d: 1 }, activity: "sit_rest", role: "customer", sits: 0.45 },
  ];
  if (roll(4) < 0.6) people.push({ s: cm(2.8 + roll(5)), d: 3.55, face: { s: 0, d: 1 }, activity: "wait", role: "customer", sits: null });
  else if (benchRight >= 0) people.push({ s: cm(C + 3.1 + 0.4), d: 0.62, face: { s: 0, d: 1 }, activity: "sit_rest", role: "customer", sits: 0.45 });
  void benchLeft;
  void couch;

  // ---- the front windows' stations, as the street side lays them out (`plainFront`, `game/town/openingsGeometry.ts`): from the wall's middle, a bay every 3.4 m, none within 4.4 m of the door.
  const spacing = 3.4;
  const n = max(0, floor((W - 1.6) / spacing) + 1);
  const bays: { s: number; index: number }[] = [];
  for (let j = 0; j < n; j++) {
    const s = W / 2 + (j - (n - 1) / 2) * spacing + (hash01(office.building * 3 + j, 482) - 0.5) * 0.5;
    if (Math.abs(s - C) < 4.4) continue;
    bays.push({ s: cm(s), index: j });
  }

  return {
    building: office.building,
    width: W,
    depth: D,
    doorS: C,
    doorWidth: door,
    interior,
    fixtures,
    people,
    marks: { back: P, cityS: cm((cityFrom + cityTo) / 2), sheriffS: cm((sheriffFrom + sheriffTo) / 2), officeDoor: gO, shutDoor: gS, officeLeft: left, officeRight: right, flag, bays },
  };
}
