/**
 * The room a player stands in, as arrays. It is not the one drawn behind the shop's glass: it is the same room (the same unit, the same plan
 * record `Unit.interior`, the same frame along the wall) built a second time, `LIFT` metres over the street at the same place on the map
 * (`sim/inside/rooms.ts`), where nothing of the town reaches. It is built whole (`RoomIn.whole`): to its back wall, with every face of everything
 * and a front wall on the inside, into a builder that lays every face's back (`MeshBuilder`'s `backs`), so no face of it is see-through from any
 * side. `insideParts.ts` makes a mesh of it while a player is in it and lets it go when they leave.
 *
 * That is the room whose design is the converter's (`legacy`); a room with a design of its own is drawn from it by `designGeometry.ts` (`designedGeometry` below), with the same front wall.
 *
 * What it is built from is what the street side is built from (`planFront`, `frontGeometry.ts`): the unit's own state, hours, finish and light, so
 * a shop shut for the night is as dark inside as it looks from the street. Only its place differs: the floor is at the height the simulation
 * holds the player's feet at, and the frame is the building's own (a test holds it equal to the room's).
 */
import type { InsideRoom } from "../../sim/inside/rooms.js";
import { municipalInterior } from "../../sim/inside/designs/municipal.js";
import type { Opening } from "../../sim/town/types.js";
import { buildingLevels, roofOver } from "./buildingGeometry.js";
import { pickOf } from "./buildingKit.js";
import { designMesh } from "./designGeometry.js";
import { municipalDecor } from "./municipalDecor.js";
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

/**
 * The hidden room as arrays: one set for the solid layer (a whole room has no haze, and its panes are sheets in it). A room whose design is not the converter's is drawn from its
 * design (`designGeometry.ts`); the rest by the street's room builder, as they always were.
 */
export function insideGeometry(g: TownGround, room: InsideRoom, detail: Detail, report?: (part: string, vertices: number) => void): MeshArrays {
  if (!room.design.legacy) return designedGeometry(g, room, detail, report);
  if (room.unit === -1) return municipalGeometry(g, room, detail);
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

/** A room drawn from its design: the unit's own front (its windows, its hours) with the design's walls, floors and furniture behind it, in the design's own frame (`s` from the unit's left end). */
function designedGeometry(g: TownGround, room: InsideRoom, detail: Detail, report?: (part: string, vertices: number) => void): MeshArrays {
  const b = g.plan.buildings[room.building];
  const use = g.plan.uses[room.building];
  const u = use?.units.find((x) => x.id === room.unit);
  if (b === undefined || b.id !== room.building || use === undefined || u === undefined) throw new Error(`the town has no unit ${room.unit} of building ${room.building} for the room ${room.id}`);
  const frame = buildingLevels(g, b).xf;
  if (frame === null) throw new Error(`building ${room.building} has no front wall frame`);
  // The design's own `s` runs from the unit's left end: the frame is the building's, moved along its wall to there.
  const xf = { ...frame, ox: frame.ox + frame.tx * u.s0, oz: frame.oz + frame.tz * u.s0, width: room.design.width, depth: room.design.depth };
  return designMesh({
    design: room.design,
    xf,
    floorY: room.floorY,
    seed: b.id * 31 + u.id,
    hours: unitHours(b, u),
    detail,
    front: { openings: u.openings.map((o) => ({ ...o, s0: o.s0 - u.s0, s1: o.s1 - u.s0 })), era: b.era, doorHead: doorHeadOf(b.era, u.fascia) },
    ...(report === undefined ? {} : { report }),
  });
}

/** The most neutral trade the dressing has for a hall of offices: a bank's wooden floor and wainscot and what an office hangs (licences, a calendar, a clock), and nothing of a shop's. */
const HALL_TRADE = "bank";
/** The year the hall's fittings date from, for the style of its furniture. */
const HALL_OPENED = 1940;

/**
 * The municipal building's room: its inside is made by `sim/inside/municipal.ts` from the building's frame (the plan holds none), and drawn through the same whole-room path.
 * Its front windows are the street side's (`plainFront`, `openingsGeometry.ts`): the same stations along the front wall, at its sill and head heights, in the look the street side
 * rolls for each (blinds, or a bright pane). The street side skips a window the ground stands too high for; this does not.
 */
function municipalGeometry(g: TownGround, room: InsideRoom, detail: Detail): MeshArrays {
  const b = g.plan.buildings[room.building];
  if (b === undefined || b.id !== room.building) throw new Error(`the town has no building ${room.building} for the room ${room.id}`);
  const levels = buildingLevels(g, b);
  const xf = levels.xf;
  if (xf === null) throw new Error(`building ${room.building} has no front wall frame`);
  const m = municipalInterior(g.seed);
  // The street side's front wall runs from its end `a` along `t`, which may run the other way from the frame's `s`: a wall station `w` is the frame's `(w - s0w) * sign`.
  const fs = levels.sides[levels.frontAt] as (typeof levels.sides)[number];
  const [ax, az] = levels.corner(fs[0], fs[1]);
  const [bx, bz] = levels.corner(fs[2], fs[3]);
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  const sign = tx * xf.tx + tz * xf.tz >= 0 ? 1 : -1;
  const s0w = (xf.ox - ax) * tx + (xf.oz - az) * tz;
  const shape = roofOver(b, levels);
  const fh = (shape.wallTop - levels.floorY) / Math.max(1, b.storeys);
  const sill = fh * 0.3;
  const high = Math.min(1.5, fh * 0.55);
  const openings: Opening[] = [];
  for (const bay of m.marks.bays) {
    const state = pickOf(["blinds", "curtained", "lit", "dark", "blinds"] as const, b.id * 5 + bay.index, 483);
    // The bay's station is in the wall's own stations from its start (the front wall's `a`).
    const frameS = sign * (bay.s - s0w);
    openings.push({ s0: frameS - 0.5, s1: frameS + 0.5, sill, head: sill + high, cover: state === "blinds" ? "blinds" : "none", widened: false });
  }
  const out = new MeshBuilder(true);
  roomGeometry(out, {
    whole: true,
    xf,
    floorY: room.floorY - FLOOR_LIFT,
    s0: 0,
    s1: m.width,
    interior: m.interior,
    state: "open",
    lit: true,
    hours: "always",
    trade: HALL_TRADE,
    id: b.id * 31 + 7,
    era: b.era,
    opened: HALL_OPENED,
    detail,
    openings,
    remodel: null,
    past: [],
    vacantSince: null,
    door: { s: m.doorS, width: m.doorWidth, head: 2.9 },
    glassIn: -glassOffOf(detail === "full", isMasonry(b.material)) - 0.07,
    extras: municipalDecor(m),
  });
  return out.take();
}
