/**
 * The inside of the municipal building: the fourth room a player can walk into, and the one the player's office is in. The plan holds nothing for it (`plan.uses` of the
 * building has no unit and no interior, and the plan must not change: its digests are pinned), so what it is built on is the building's own front frame alone, the same on every peer:
 * the whole front's width, the depth the building has (at most `MUNICIPAL_DEPTH`), the plan's door and the stations of the hall's front windows as the street side lays them out.
 * The room itself is `hall.ts`, a design open through the building's storeys.
 *
 * Nothing here says what the building is to the town but a city's and a sheriff's: no other service is named in it.
 *
 * Simulation code: the arithmetic of AGENTS.md ("The simulation's rules") applies, and collections are never walked for their order.
 */
import { planFor } from "../../town/planFor.js";
import type { Design } from "../design.js";
import { hallDesign } from "./hall.js";

const { floor, max, min, round } = Math;

/** The most the room is deep (metres). */
export const MUNICIPAL_DEPTH = 14;

/** What the room is built on: the building, its front's width, the depth the room has, the door, the storeys, and the stations of the hall's front windows with their index along the front. */
export type MunicipalFrame = {
  readonly building: number;
  readonly width: number;
  readonly depth: number;
  readonly doorS: number;
  readonly doorWidth: number;
  readonly storeys: number;
  readonly bays: readonly { readonly s: number; readonly index: number }[];
};

const cm = (x: number): number => round(x * 100) / 100;

/** A hash of the building's id and a salt to [0, 1): the town's own multiplication hash (`hash01` of `game/town/meshBuilder.ts`), written out here since the simulation imports nothing of the game. */
function hash01(n: number, salt: number): number {
  let h = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const FRAMES = new Map<number, MunicipalFrame>();

/** The municipal building's frame for a world's seed. */
export function municipalFrame(seed: number): MunicipalFrame {
  let made = FRAMES.get(seed);
  if (made === undefined) {
    made = make(seed);
    FRAMES.set(seed, made);
  }
  return made;
}

function make(seed: number): MunicipalFrame {
  const plan = planFor(seed);
  const office = plan.places.office;
  const use = plan.uses[office.building];
  const frame = use?.frame;
  if (frame === undefined || frame === null || office.door === null) throw new Error("the municipal building has no front to make a room behind");
  const W = frame.width;
  const C = office.door.s;
  // The street side's windows: from the wall's middle, a bay every 3.4 m, none within 4.4 m of the door (`plainFront`, `game/town/openingsGeometry.ts`).
  const spacing = 3.4;
  const n = max(0, floor((W - 1.6) / spacing) + 1);
  const bays: { s: number; index: number }[] = [];
  for (let j = 0; j < n; j++) {
    const s = W / 2 + (j - (n - 1) / 2) * spacing + (hash01(office.building * 3 + j, 482) - 0.5) * 0.5;
    if (Math.abs(s - C) < 4.4) continue;
    bays.push({ s: cm(s), index: j });
  }
  return { building: office.building, width: W, depth: cm(min(MUNICIPAL_DEPTH, frame.depth - 1.5)), doorS: C, doorWidth: office.door.width, storeys: plan.buildings[office.building]?.storeys ?? 2, bays };
}

const DESIGNS = new Map<number, Design>();

/** The municipal building's design for a world's seed. */
export function municipalDesign(seed: number): Design {
  let made = DESIGNS.get(seed);
  if (made === undefined) {
    const m = municipalFrame(seed);
    made = hallDesign({ id: m.building, width: m.width, depth: m.depth, doorS: m.doorS, doorWidth: m.doorWidth, storeys: m.storeys });
    DESIGNS.set(seed, made);
  }
  return made;
}
