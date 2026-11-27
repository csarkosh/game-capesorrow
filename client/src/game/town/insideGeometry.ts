/**
 * The room a player stands in, as arrays. It is not the one drawn behind the shop's glass: it is the same room (the same unit, the same plan
 * record `Unit.interior`, the same frame along the wall) built a second time, `LIFT` metres over the street at the same place on the map
 * (`sim/inside/rooms.ts`), where nothing of the town reaches. It is built whole (`RoomIn.whole`): to its back wall, with every face of everything
 * and a front wall on the inside, into a builder that lays every face's back (`MeshBuilder`'s `backs`), so no face of it is see-through from any
 * side. `insideParts.ts` makes a mesh of it while a player is in it and lets it go when they leave.
 *
 * What it is built from is what the street side is built from (`planFront`, `frontGeometry.ts`): the unit's own state, hours, finish and light, so
 * a shop shut for the night is as dark inside as it looks from the street. Only its place differs: the floor is at the height the simulation
 * holds the player's feet at, and the frame is the building's own (a test holds it equal to the room's).
 */
import type { InsideRoom } from "../../sim/inside/rooms.js";
import { buildingLevels } from "./buildingGeometry.js";
import { unitHours } from "./hours.js";
import { MeshBuilder, type MeshArrays } from "./meshBuilder.js";
import { roomGeometry } from "./roomGeometry.js";
import { glassOffOf, isMasonry } from "./windowGeometry.js";
import type { Detail, TownGround } from "./townTypes.js";

/** How far over the floor's own height the shell draws its floor: the room is drawn at `floorY` with its floor at `floorY + FLOOR_LIFT` (`roomShell.ts`). */
export const FLOOR_LIFT = 0.08;

/** The head of a unit's door over its floor as the street side draws it (`planFront`): 2.2 m, or on an old tall front 2.65. */
export function doorHeadOf(era: number, fascia: number): number {
  return era < 1940 && fascia > 3.1 ? 2.65 : 2.2;
}

/** The room of the plan as the arrays of the hidden room: one set for the solid layer (a whole room has no haze, and its panes are sheets in it). */
export function insideGeometry(g: TownGround, room: InsideRoom, detail: Detail): MeshArrays {
  const b = g.plan.buildings[room.building];
  const use = g.plan.uses[room.building];
  const u = use?.units.find((x) => x.id === room.unit);
  if (b === undefined || b.id !== room.building || use === undefined || u === undefined) throw new Error(`the town has no unit ${room.unit} of building ${room.building} for the room ${room.id}`);
  const xf = buildingLevels(g, b).xf;
  if (xf === null) throw new Error(`building ${room.building} has no front wall frame`);
  const out = new MeshBuilder(true);
  const lit = u.state === "open";
  roomGeometry(out, {
    whole: true,
    xf,
    // The room is drawn with its floor at `FLOOR_LIFT` over the height it is given, and the simulation's floor is the surface itself.
    floorY: room.floorY - FLOOR_LIFT,
    // As the street side: 4 cm in from the party walls, which is where the room's own walls are drawn.
    s0: u.s0 + 0.04,
    s1: u.s1 - 0.04,
    interior: u.interior,
    state: u.state,
    lit,
    hours: unitHours(b, u),
    trade: u.tenant?.trade ?? null,
    id: b.id * 31 + u.id,
    era: b.era,
    opened: u.tenant?.opened ?? 0,
    detail,
    openings: u.openings,
    remodel: u.remodel,
    past: u.past,
    vacantSince: u.vacantSince,
    door: { s: u.door.s, width: u.door.width, head: doorHeadOf(b.era, u.fascia) },
    glassIn: -glassOffOf(detail === "full", isMasonry(b.material)) - 0.07,
  });
  return out.take();
}
