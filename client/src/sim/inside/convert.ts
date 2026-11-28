/**
 * The converter: a design made from the plan's one-floor record of a room (`Unit.interior`), for the rooms that have no design of their own yet. It is one
 * floor, the furnishings as blocks, and nothing drawn: a design that is `legacy` is drawn by the street's room builder in its `whole` mode, as it always was
 * (`game/town/insideGeometry.ts`), so the room looks and walks as it did. The designs that replace it (`designs/`) state their own walls, floors and furniture.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { HULL_RADIUS } from "../town/hull.js";
import type { Interior } from "../town/types.js";
import { type Block, type Design, type DesignPerson, type Finish } from "./design.js";

const { max, min } = Math;

/** Where a player arrives: this far inside the room's door. */
export const ARRIVE_IN = 1.1;
/** Furnishings lower than this are stepped over (a dust sheet on the floor), and are no block. */
export const LOW = 0.25;
const PLAIN: Finish = { mat: "plaster" };

/** The measures a room is made from. `s0` is the unit's left end in the building's frame, which the plan's furnishings are measured from. */
export type Measures = { readonly s0: number; readonly s1: number; readonly doorS: number; readonly doorWidth: number };

/** Where a hull's centre arrives for a room of this width, inside its door and clear of the side walls. */
export function arrivalOf(width: number, doorS: number): { s: number; d: number } {
  return { s: min(width - HULL_RADIUS - 0.01, max(HULL_RADIUS + 0.01, doorS)), d: ARRIVE_IN };
}

/** One-floor design of a plan record: its furnishings (and any `extra` blocks and `people`) as blocks on a flat floor. `doorS` is in the room's own frame, from its left end. */
export function designFromInterior(name: string, i: Interior, m: Measures, extra: readonly Block[] = [], people: readonly DesignPerson[] = []): Design {
  const width = m.s1 - m.s0;
  const blocks: Block[] = [];
  for (const f of i.furnishings) {
    if (f.h < LOW) continue;
    blocks.push({ s: f.s - m.s0, d: f.d, ax: f.dir.x, ad: f.dir.z, ha: f.sx / 2, hb: f.sd / 2, y0: 0, y1: f.h });
  }
  for (const b of extra) blocks.push(b);
  const doorS = m.doorS - m.s0;
  return {
    name, legacy: true, width, depth: i.depth, height: i.ceiling, doorS, doorWidth: m.doorWidth, doorHead: 2.2, arrive: arrivalOf(width, doorS),
    surfaces: [{ kind: "floor", s0: 0, s1: width, d0: 0, d1: i.depth, y: 0 }], blocks, walls: [], slabs: [], stairs: [], rails: [], items: [], decor: [], lights: [], people,
    shell: { front: PLAIN, left: PLAIN, right: PLAIN, back: PLAIN, floor: "plaster", ceiling: "plaster" },
    mood: { exposure: 0.7, ambient: [1, 0.92, 0.78], ambientK: 0.022, day: 0.3 },
  };
}
