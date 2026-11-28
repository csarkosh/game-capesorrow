/**
 * The municipal hall as a design: one room open through three storeys (two where the building has two), behind the building's whole front and `depth` deep or less.
 *
 * The hall is the front of the plan, a polished concrete floor, a red brick wall on the left over a timber lining, board-marked concrete on the right (the tallest wall, with the
 * mural), glass balls of light hung at many heights on thin wires from a black grid under the ceiling and the day through the front's windows. A wide timber stair with glass sides
 * rises along the left wall to a gallery on floor 2 that runs along the back and down the right wall behind a clear glass rail. Behind glazed fronts with dark frames: on floor 1
 * the CITY CLERK (with a counter open to the hall and a clerk), PERMITS and RECORDS; on floor 2, off the gallery, the player's office (an open doorway and a plate with a room
 * number alone), INVESTIGATIONS, EVIDENCE (a shut door), DEPUTIES and the SHERIFF (with a counter open to the gallery and a deputy); on floor 3, seen across the hall, the MAYOR
 * and the COUNCIL, and the narrow flight up to them, behind a barrier with the plate STAFF ONLY. Floor 3 is never walked. The city is on the left and the sheriff on the right in every town.
 *
 * Nothing here says what the building is to the town but a city's and a sheriff's.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { arrivalOf } from "../convert.js";
import { DesignBuilder, FRONT_WALL, cm, type Design, type Spot } from "../design.js";
import { footOf } from "../kinds.js";

const { ceil, floor, max, min, round } = Math;

const TOWARD_RIGHT: Spot = { s: 1, d: 0 };
const TOWARD_LEFT: Spot = { s: -1, d: 0 };
const TOWARD_BACK: Spot = { s: 0, d: 1 };
const TOWARD_FRONT: Spot = { s: 0, d: -1 };

/** A storey's height. */
export const HALL_STOREY = 3.6;
/** The width of a doorway (on the walking grid, a hull needs 0.5 m of slack in the middle of one). */
const DOOR = 1.5;
/** The width of the stair, and of the gallery along the back and down the right wall. */
const STAIR_W = 2.4;
const GALLERY = 1.6;

/** What the plan says of the building: its id, the front's width, the depth the room has, the door and how many storeys. */
export type HallSite = { readonly id: number; readonly width: number; readonly depth: number; readonly doorS: number; readonly doorWidth: number; readonly storeys: number };

const half = (x: number): number => floor(x * 2) / 2;
const halfUp = (x: number): number => ceil(x * 2 - 1e-9) / 2;

export function hallDesign(site: HallSite): Design {
  const W = site.width;
  const D = cm(site.depth);
  const C = site.doorS;
  // A shallow hall has its storeys a little lower, so that the stair's run, which has to start a step in from the front wall, is no steeper than a hull climbs.
  const F = D >= 12 ? HALL_STOREY : 3.0;
  // A shallow hall (under 12 m deep) has two storeys: there is no depth for a third floor's flight to climb in.
  const n = site.storeys >= 3 && D >= 12 ? 3 : 2;
  const H = cm(F * n);
  const b = new DesignBuilder(W, D, H, site.id, footOf);
  const roll = (salt: number): number => b.roll(salt);
  const white = [1.15, 1.12, 1.05] as const;
  const dark = [0.12, 0.12, 0.13] as const;

  // ---- the plan of it: the hall in front, a band of rooms behind it, the stair along the left wall, the gallery over the band and down the right wall.
  const band = D >= 12 ? 5.6 : 3.9;
  const Bd = cm(half(D - band));
  const Rb = cm(D - Bd);
  const Dg = cm(Bd + (Rb >= 5 ? GALLERY : 1.4));
  const run = cm(max(4.0, min(6.0, Bd - 1.2)));
  const dFoot = cm(Bd - run);
  const sStair1 = cm(0.15 + STAIR_W);
  const so0 = 3.0;
  const sR = cm(half(W - 2.0));
  const dR = cm(max(3.0, Bd - 6.5));
  const Y2 = F;
  const Y3 = 2 * F;
  const eps = 0.3;

  // ---- floors and ceiling.
  b.slab({ kind: "floor", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: 0, thick: 0, mat: "concrete", tint: [1.35, 1.35, 1.3] });
  b.slab({ kind: "floor", s0: 0, s1: W, d0: Bd, d1: D, y: Y2, thick: 0.3, mat: "oak", edge: "painted", tint: [0.95, 0.9, 0.85] });
  b.slab({ kind: "floor", s0: sR, s1: W, d0: dR, d1: Bd, y: Y2, thick: 0.3, mat: "oak", edge: "painted", tint: [0.95, 0.9, 0.85] });
  // Floor 3's slab has a stairwell over the staff flight (it goes on up to floor 3's landing): the slab is cut away from where the flight's head reaches the slab's underside (2.0 m of headroom) to the landing's front.
  const rEnd = n === 3 ? cm(half(W - 3.2)) : cm(W - 0.15);
  const flight = { s0: cm(rEnd + 0.2), s1: cm(W - 0.35), d0: cm(Dg + 0.3), d1: cm(D - 1.0) };
  const well = { s0: cm(flight.s0 - 0.1), s1: cm(flight.s1 + 0.1), d0: cm(flight.d0 + ((flight.d1 - flight.d0) * (F - 2.3)) / F), d1: flight.d1 };
  if (n === 3) {
    const piece3 = (s0: number, s1: number, d0: number, d1: number): void => {
      if (s1 - s0 > 0.01 && d1 - d0 > 0.01) b.slab({ kind: "floor", s0, s1, d0, d1, y: Y3, thick: 0.3, mat: "oak", edge: "painted", tint: [0.95, 0.9, 0.85] });
    };
    piece3(0, well.s0, Bd, D);
    piece3(well.s1, W, Bd, D);
    piece3(well.s0, well.s1, Bd, well.d0);
    piece3(well.s0, well.s1, well.d1, D);
  }
  b.slab({ kind: "ceiling", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: H, thick: 0, mat: "painted", tint: white });
  b.surface({ kind: "floor", s0: 0, s1: W, d0: 0, d1: D, y: 0 });
  b.surface({ kind: "floor", s0: 0, s1: W, d0: Bd, d1: D, y: Y2 });
  b.surface({ kind: "floor", s0: sR, s1: W, d0: dR, d1: Bd, y: Y2 });

  // ---- what is kept clear: the street door's zone, the lane from it to the offices and the stair, and the approach to the offices' fronts.
  b.reserve({ s0: C - site.doorWidth / 2 - 0.55, s1: C + site.doorWidth / 2 + 0.55, d0: 0, d1: 3.2 });
  b.reserve({ s0: C - 1.1, s1: C + 1.1, d0: 0, d1: Bd });
  b.reserve({ s0: 0, s1: C, d0: max(0.9, dFoot - 1.0), d1: dFoot + 1.4 });
  b.reserve({ s0: 0, s1: W, d0: Bd - 2.0, d1: Bd });
  b.reserve({ s0: 0, s1: sStair1 + 0.6, d0: dFoot - 1.0, d1: Bd });

  // ---- the stair: oak treads 2.4 m wide, glass sides, a timber handrail, rising along the left wall to the gallery's floor where it meets the band.
  b.stair({ s0: 0.15, s1: sStair1, d0: dFoot, d1: Bd, along: "d", y0: 0, y1: Y2, base: 0, mat: "oak", rails: ["lo", "hi"], glass: true });

  // ---- a glazed front: dark low wall to `low`, clear glass over it to 2.5 above the floor (or open, over a counter), a header over each doorway.
  type Front = { s0: number; s1: number; d: number; y: number; doors: readonly { c: number; shut?: boolean }[]; open?: readonly [number, number] };
  const front = (f: Front): void => {
    const top = f.y + F - eps;
    let at = f.s0;
    const stretch = (s0: number, s1: number): void => {
      if (s1 - s0 < 0.2) return;
      const inOpen = f.open !== undefined && s0 >= f.open[0] - 0.01 && s1 <= f.open[1] + 0.01;
      const lowTop = inOpen ? f.y + 1.05 : f.y + 1.0;
      b.wall({ s0, d0: f.d, s1, d1: f.d, thick: 0.1, y0: f.y, y1: lowTop, mat: "painted", tint: inOpen ? [0.55, 0.45, 0.35] : dark, matBack: "painted", tintBack: inOpen ? [0.55, 0.45, 0.35] : dark, openings: [] });
      if (!inOpen) {
        b.block({ s: (s0 + s1) / 2, d: f.d, ax: 1, ad: 0, ha: (s1 - s0) / 2, hb: 0.06, y0: f.y + 1.0, y1: f.y + 2.5 });
        b.decorate({ kind: "glazing", s: (s0 + s1) / 2, d: f.d, y: f.y + 1.75, face: TOWARD_FRONT, w: cm(s1 - s0), h: 1.5 });
      } else {
        b.block({ s: (s0 + s1) / 2, d: f.d, ax: 1, ad: 0, ha: (s1 - s0) / 2, hb: 0.06, y0: f.y + 2.5, y1: top });
      }
      b.wall({ s0, d0: f.d, s1, d1: f.d, thick: 0.1, y0: f.y + 2.5, y1: top, mat: "painted", tint: white, matBack: "painted", tintBack: white, openings: [] });
    };
    for (const door of f.doors) {
      stretch(at, door.c - DOOR / 2);
      b.wall({ s0: door.c - DOOR / 2, d0: f.d, s1: door.c + DOOR / 2, d1: f.d, thick: 0.1, y0: f.y + 2.2, y1: top, mat: "painted", tint: dark, matBack: "painted", tintBack: dark, openings: [] });
      if (door.shut === true) b.wall({ s0: door.c - DOOR / 2, d0: f.d, s1: door.c + DOOR / 2, d1: f.d, thick: 0.1, y0: f.y, y1: f.y + 2.2, mat: "painted", tint: [0.5, 0.32, 0.2], matBack: "painted", tintBack: [0.5, 0.32, 0.2], openings: [] });
      at = door.c + DOOR / 2;
    }
    stretch(at, f.s1);
  };
  const partition = (s: number, d0: number, d1: number, y: number): void => {
    b.wall({ s0: s, d0, s1: s, d1, thick: 0.1, y0: y, y1: y + F - eps, mat: "painted", tint: white, matBack: "painted", tintBack: white, openings: [] });
  };
  /** A lettered plate over a doorway: its words on a dark ground, facing the hall or the gallery. */
  const plate = (s: number, d: number, y: number, face: Spot, text: string, w = 1.1): void => b.decorate({ kind: "sign", s, d, y, face, w, h: 0.24, text });
  const doorAt = (a: number): number => halfUp(a + DOOR / 2 + 0.2);

  // ---- floor 1: three offices behind glass at the back of the hall, a closet under the stair's head.
  const sEnd = cm(W - 0.15);
  const w1 = (sEnd - so0) / 3;
  const p1 = cm(half(so0 + w1));
  const p2 = cm(half(so0 + 2 * w1));
  const offs: readonly [number, number][] = [[so0, p1], [p1, p2], [p2, sEnd]];
  partition(so0, Bd, D, 0);
  b.wall({ s0: 0.15, d0: Bd, s1: so0, d1: Bd, thick: 0.1, y0: 0, y1: F - eps, mat: "painted", tint: white, matBack: "painted", tintBack: white, openings: [] });
  b.block({ s: (0.15 + so0) / 2, d: (Bd + D) / 2, ax: 1, ad: 0, ha: (so0 - 0.15) / 2, hb: (D - Bd) / 2, y0: 0, y1: F });
  partition(p1, Bd, D, 0);
  partition(p2, Bd, D, 0);
  const names1 = ["CITY CLERK", "PERMITS", "RECORDS"];
  const doors1: number[] = [];
  for (let k = 0; k < offs.length; k++) {
    const [a, c] = offs[k] as readonly [number, number];
    const door = k === 0 ? doorAt(a + 0.2) : doorAt(a + 1.0);
    doors1.push(door);
    front({ s0: a, s1: c, d: Bd, y: 0, doors: [{ c: door }], ...(k === 0 ? { open: [door + DOOR / 2, c] as const } : {}) });
    plate((a + c) / 2 + (k === 0 ? -0.5 : 0), Bd - 0.06, 2.35, TOWARD_FRONT, names1[k] as string, 1.5);
  }
  // The city clerk: the counter's staff side with a desk, shelves, a clerk. Permits: two desks and a cabinet. Records: rows of shelving.
  const [a0, c0] = offs[0] as readonly [number, number];
  b.person({ s: cm(c0 - 1.4), d: cm(Bd + 0.75), face: TOWARD_FRONT, activity: "till", role: "staff", sits: null, family: "chair" });
  b.item("desk", cm(a0 + 1.2), cm(Bd + 2.9), TOWARD_FRONT, [], { gap: 0.1 });
  b.item("chair", cm(a0 + 1.2), cm(Bd + 3.4), TOWARD_FRONT, [], { gap: -1, mat: "dark_wood" });
  b.item("shelf_wall", cm(c0 - 1.6), cm(D - 0.24), TOWARD_FRONT, [2.2], { gap: 0.05 });
  const [a1, c1] = offs[1] as readonly [number, number];
  b.item("desk", cm(a1 + 1.4), cm(Bd + 2.6), TOWARD_FRONT, [], { gap: 0.1 });
  b.item("desk", cm(c1 - 1.4), cm(Bd + 2.6), TOWARD_FRONT, [], { gap: 0.1 });
  b.item("shelf_wall", cm((a1 + c1) / 2), cm(D - 0.24), TOWARD_FRONT, [2.4], { gap: 0.05 });
  b.person({ s: cm(c1 - 1.4), d: cm(Bd + 3.2), face: TOWARD_FRONT, activity: "idle", role: "staff", sits: null, family: "chair" });
  const [a2, c2] = offs[2] as readonly [number, number];
  for (const dd of [Bd + 2.2, Bd + 3.6]) b.item("shelf_wall", cm((a2 + c2) / 2 + 0.6), cm(dd), TOWARD_FRONT, [min(2.6, (c2 - a2) - 1.8)], { gap: 0.05 });
  b.item("shelf_wall", cm(c2 - 0.3), cm(D - 0.6), TOWARD_LEFT, [2.0], { gap: 0.05 });
  for (const [a, c] of offs) {
    b.light({ s: cm((a + c) / 2), d: cm(Bd + 1.4), y: F - 0.45, kind: "tube", beam: 40, power: 1.4, reach: 2.2, tone: [1, 0.96, 0.88] });
    b.light({ s: cm((a + c) / 2), d: cm(Bd + 3.4), y: F - 0.45, kind: "tube", beam: 40, power: 1.4, reach: 2.2, tone: [1, 0.96, 0.88] });
    b.item("downlight", cm((a + c) / 2), cm(Bd + 1.4), TOWARD_RIGHT, [F - eps], { anywhere: true });
    b.item("downlight", cm((a + c) / 2), cm(Bd + 3.4), TOWARD_RIGHT, [F - eps], { anywhere: true });
  }

  // ---- floor 2: the gallery's rail, and five rooms off it. The staff stair's slot is at the right end where there is a third floor.
  const nRooms = 5;
  const wr = (rEnd - 0.15) / nRooms;
  const cuts: number[] = [0.15];
  for (let k = 1; k < nRooms; k++) cuts.push(cm(half(0.15 + k * wr)));
  cuts.push(rEnd);
  const names2 = ["", "INVESTIGATIONS", "EVIDENCE", "DEPUTIES", "SHERIFF"];
  const rail = (s0: number, d0: number, s1: number, d1: number, y: number): void => b.rail({ s0, d0, s1, d1, y, h: 1.0, kind: "glass", mat: "oak" });
  rail(sStair1, Bd, sR, Bd, Y2);
  rail(sR, dR, sR, Bd, Y2);
  rail(sR, dR, W - 0.05, dR, Y2);
  if (n === 3) rail(0.1, Bd, W - 0.1, Bd, Y3);
  for (let k = 1; k < nRooms; k++) partition(cuts[k] as number, Dg, D, Y2);
  partition(rEnd, Dg, D, Y2);
  let player = { s: 0, d: 0 };
  let stair3: { name: string; s: number; d: number; y: number } | null = null;
  for (let k = 0; k < nRooms; k++) {
    const a = cuts[k] as number;
    const c = cuts[k + 1] as number;
    const shut = k === 2;
    const door = k === 0 ? halfUp(a + 1.2) : halfUp(a + 1.1);
    const sheriff = k === nRooms - 1;
    front({ s0: a, s1: c, d: Dg, y: Y2, doors: [{ c: door, ...(shut ? { shut: true } : {}) }], ...(sheriff ? { open: [door + DOOR / 2, c] as const } : {}) });
    if (k === 0) {
      // The player's room: an open doorway and a plate that gives only its number.
      b.decorate({ kind: "sign", s: cm(door + DOOR / 2 + 0.25), d: Dg - 0.06, y: Y2 + 1.55, face: TOWARD_FRONT, w: 0.16, h: 0.07, text: String(200 + 2 * floor(roll(1) * 14) + 1) });
      player = { s: door, d: Dg };
    } else plate((a + c) / 2, Dg - 0.06, Y2 + 2.35, TOWARD_FRONT, names2[k] as string, 1.4);
    // What stands in each room.
    const mid = (a + c) / 2;
    if (k === 0) {
      // The player's own room, the most cared-for of the small ones. The way in from the doorway is kept clear.
      b.reserve({ s0: door - 0.85, s1: door + 0.85, d0: Dg, d1: Dg + 1.3 });
      const desk = { s: cm(c - 0.9), d: cm(Dg + 1.5) };
      b.item("desk", desk.s, desk.d, TOWARD_LEFT, [], { gap: 0.05, y: Y2 });
      b.item("desk_set", desk.s, desk.d, TOWARD_LEFT, [], { anywhere: true, y: cm(Y2 + 0.76) });
      b.item("chair", cm(c - 1.5), desk.d, TOWARD_RIGHT, [], { gap: -1, y: Y2, mat: "dark_wood" });
      // A visitor's chair across the desk, a rug between, a bin by the desk.
      b.item("chair", cm(c - 2.15), cm(Dg + 1.6), TOWARD_RIGHT, [], { gap: 0.05, y: Y2, mat: "leather" });
      b.item("carpet_inset", cm(c - 1.75), cm(Dg + 2.0), TOWARD_BACK, [2.0, 1.6, 0], { anywhere: true, y: Y2 });
      b.item("waste_bin", cm(c - 0.35), cm(Dg + 2.35), TOWARD_LEFT, [], { gap: 0.02, y: Y2 });
      // The back wall: a coat stand with a coat and hat, the window between, two filing cabinets (one with a box on it).
      b.item("coat_stand", cm(a + 0.4), cm(D - 0.35), TOWARD_FRONT, [], { gap: 0.02, y: Y2 });
      b.decorate({ kind: "lit_pane", s: cm(a + 1.55), d: D, y: Y2 + 1.55, face: TOWARD_FRONT, w: 1.1, h: 1.2 });
      b.windows.push({ wall: "back", a0: cm(a + 1.0), a1: cm(a + 2.1), y0: cm(Y2 + 0.95), y1: cm(Y2 + 2.15) });
      b.decorate({ kind: "clock", s: cm(a + 1.55), d: D, y: Y2 + 2.65, face: TOWARD_FRONT, w: 0.32, h: 0.32 });
      b.item("filing_cabinet", cm(c - 0.62), cm(D - 0.3), TOWARD_FRONT, [], { gap: 0.02, y: Y2 });
      b.item("filing_cabinet", cm(c - 1.15), cm(D - 0.3), TOWARD_FRONT, [], { gap: 0.02, y: Y2 });
      // The left wall: the sofa, the cork board with the coast map over it, and a second board with pinned papers and string.
      b.item("sofa", cm(a + 0.5), cm(Dg + 1.9), TOWARD_RIGHT, [1.6], { gap: 0.05, y: Y2, mat: "grey" });
      b.decorate({ kind: "coast_map", s: a, d: cm(Dg + 1.9), y: Y2 + 1.75, face: TOWARD_RIGHT, w: 1.2, h: 0.85 });
      b.decorate({ kind: "pin_board", s: a, d: cm(Dg + 3.15), y: Y2 + 1.6, face: TOWARD_RIGHT, w: 0.85, h: 0.75 });
      // The right wall: a shelf unit by the back, and a framed certificate above the desk.
      b.item("shelf_wall", cm(c - 0.24), cm(D - 0.95), TOWARD_LEFT, [0.9], { gap: 0.02, y: Y2 });
      b.decorate({ kind: "certificate", s: c, d: desk.d, y: Y2 + 1.7, face: TOWARD_LEFT, w: 0.34, h: 0.26 });
      // Light: a ceiling fixture, the banker's lamp's warm pool, a light over the map, the day from the window.
      b.item("downlight", cm((a + c) / 2), cm(Dg + 2.0), TOWARD_RIGHT, [Y3 - eps], { anywhere: true });
      b.light({ s: cm((a + c) / 2), d: cm(Dg + 2.0), y: Y3 - eps - 0.05, kind: "tube", beam: 20, power: 1.6, reach: 2.6, tone: [1, 0.96, 0.88] });
      b.light({ s: cm(desk.s + 0.18), d: cm(desk.d - 0.05), y: Y2 + 1.15, kind: "lamp", power: 0.9, reach: 1.4, tone: [1, 0.82, 0.5] });
      b.light({ s: cm(a + 0.5), d: cm(Dg + 1.9), y: Y2 + 2.4, kind: "lamp", power: 0.7, reach: 1.6, tone: [1, 0.92, 0.75] });
      b.light({ s: cm(a + 1.55), d: cm(D - 0.5), y: Y2 + 1.55, kind: "glow", power: 0.8, reach: 3.0, tone: [0.85, 0.92, 1] });
    } else if (k === 1) {
      b.item("desk", cm(mid), cm(Dg + 1.5), TOWARD_FRONT, [], { gap: 0.1, y: Y2 });
      b.item("shelf_wall", cm(mid), cm(D - 0.24), TOWARD_FRONT, [min(2.2, c - a - 0.8)], { gap: 0.05, y: Y2 });
      b.light({ s: cm(mid), d: cm(Dg + 1.5), y: Y2 + F - 0.5, kind: "tube", beam: 40, power: 1.2, reach: 2.2, tone: [1, 0.96, 0.88] });
    } else if (k === 3) {
      b.item("desk", cm(mid - 0.7), cm(Dg + 1.5), TOWARD_FRONT, [], { gap: 0.1, y: Y2 });
      b.item("desk", cm(mid + 0.7), cm(Dg + 1.5), TOWARD_FRONT, [], { gap: 0.1, y: Y2 });
      b.light({ s: cm(mid), d: cm(Dg + 1.5), y: Y2 + F - 0.5, kind: "tube", beam: 40, power: 1.2, reach: 2.2, tone: [1, 0.96, 0.88] });
    } else if (sheriff) {
      b.person({ s: cm(c - 1.2), d: cm(Dg + 0.75), face: TOWARD_FRONT, activity: "idle", role: "staff", sits: null, family: "chair", y: Y2 });
      b.item("desk", cm(door - 0.2), cm(Dg + 2.2), TOWARD_FRONT, [], { gap: 0.1, y: Y2 });
      b.item("shelf_wall", cm(mid + 0.6), cm(D - 0.24), TOWARD_FRONT, [2.0], { gap: 0.05, y: Y2 });
      b.light({ s: cm(mid), d: cm(Dg + 1.5), y: Y2 + F - 0.5, kind: "tube", beam: 40, power: 1.2, reach: 2.2, tone: [1, 0.96, 0.88] });
    }
    if (shut) b.block({ s: (a + c) / 2, d: (Dg + D) / 2, ax: 1, ad: 0, ha: (c - a) / 2, hb: (D - Dg) / 2, y0: Y2, y1: Y3 });
  }
  // The staff stair: a narrow flight to floor 3 behind a barrier with a plate; drawn, never walked.
  if (n === 3) {
    // The flight goes on up through the well in floor 3's slab to a landing at floor 3's level (`flight`, `well`); a rail runs round the well on floor 3, and floor 3 is seen up it: the landing, a lit sign on its back wall.
    b.display({ s0: flight.s0, s1: flight.s1, d0: flight.d0, d1: flight.d1, along: "d", y0: Y2, y1: Y3, base: Y2, mat: "oak", rails: ["lo", "hi"] });
    b.rail({ s0: well.s0, d0: well.d0, s1: well.s1, d1: well.d0, y: Y3, h: 1.0, kind: "glass", mat: "oak" });
    b.rail({ s0: well.s0, d0: well.d0, s1: well.s0, d1: well.d1, y: Y3, h: 1.0, kind: "glass", mat: "oak" });
    b.rail({ s0: well.s1, d0: well.d0, s1: well.s1, d1: well.d1, y: Y3, h: 1.0, kind: "glass", mat: "oak" });
    b.decorate({ kind: "sign", s: cm((flight.s0 + flight.s1) / 2), d: cm(D - 0.04), y: cm(Y3 + 2.1), face: TOWARD_FRONT, w: 1.2, h: 0.26, text: "THIRD FLOOR" });
    b.light({ s: cm((flight.s0 + flight.s1) / 2), d: cm(D - 0.6), y: cm(Y3 + 2.6), kind: "tube", beam: 6, power: 1.6, reach: 3.6, tone: [1, 0.96, 0.88] });
    b.item("downlight", cm((flight.s0 + flight.s1) / 2), cm(D - 0.6), TOWARD_RIGHT, [], { anywhere: true });
    b.block({ s: (rEnd + W) / 2, d: (Dg + D) / 2, ax: 1, ad: 0, ha: (W - rEnd) / 2, hb: (D - Dg) / 2, y0: Y2, y1: Y3 });
    // The closure: a glazed screen in dark frames across the flight's foot with a glazed door and a card reader (solid, the whole width of the stair, 2.2 m high), brass posts with a dark red rope before it, plates on it, a directory
    // on the wall beside it and a downlight over it. The flight is seen through it rising to the lit landing.
    const cs = cm((flight.s0 + flight.s1) / 2);
    const sw = cm(flight.s1 - flight.s0 + 0.2);
    b.block({ s: cs, d: cm(Dg + 0.18), ax: 1, ad: 0, ha: sw / 2 + 0.05, hb: 0.12, y0: Y2, y1: Y2 + 2.3 });
    b.item("glass_screen", cs, cm(Dg + 0.18), TOWARD_FRONT, [sw], { anywhere: true, y: Y2 });
    b.item("rope_posts", cs, cm(Dg - 0.55), TOWARD_FRONT, [cm(sw - 0.4)], { anywhere: true, y: Y2 });
    b.decorate({ kind: "sign", s: cm(cs + 0.35), d: cm(Dg + 0.08), y: cm(Y2 + 1.55), face: TOWARD_FRONT, w: 0.46, h: 0.34, text: "THIRD FLOOR|BY APPOINTMENT" });
    b.decorate({ kind: "sign", s: cm(cs + 0.35), d: cm(Dg + 0.08), y: cm(Y2 + 1.12), face: TOWARD_FRONT, w: 0.34, h: 0.18, text: "STAFF ONLY" });
    b.decorate({ kind: "board", s: cm(W - 0.02), d: cm(Dg - 0.3), y: cm(Y2 + 1.5), face: TOWARD_LEFT, w: 0.6, h: 0.9, text: "1 CITY CLERK|2 SHERIFF|3 MAYOR" });
    b.item("downlight", cs, cm(Dg - 0.3), TOWARD_RIGHT, [cm(Y3 - eps)], { anywhere: true });
    b.light({ s: cs, d: cm(Dg - 0.3), y: cm(Y3 - eps - 0.05), kind: "tube", beam: 20, power: 1.4, reach: 2.6, tone: [1, 0.95, 0.85] });
    // `goin office stair3 right`: the gallery a few metres from the closure, looking at it.
    stair3 = { name: "stair3", s: cm(max(2.0, cs - 3.0)), d: cm(Bd + 0.7), y: Y2 };
    b.decorate({ kind: "sign", s: rEnd + 0.06, d: cm(Dg + 0.9), y: Y2 + 1.3, face: TOWARD_RIGHT, w: 0.9, h: 0.4, text: "STAFF ONLY" });
    // Floor 3: the mayor and the council behind glass, seen across the hall.
    const mid3 = cm(half(W / 2));
    front({ s0: 0.15, s1: mid3, d: Dg, y: Y3, doors: [{ c: halfUp(1.6) }] });
    front({ s0: mid3, s1: rEnd, d: Dg, y: Y3, doors: [{ c: halfUp(mid3 + 1.6) }] });
    partition(mid3, Dg, D, Y3);
    plate(halfUp(1.6) + 1.9, Dg - 0.06, Y3 + 2.35, TOWARD_FRONT, "MAYOR", 1.2);
    plate(halfUp(mid3 + 1.6) + 1.9, Dg - 0.06, Y3 + 2.35, TOWARD_FRONT, "COUNCIL", 1.4);
    b.item("desk", cm(halfUp(1.6) + 2.2), cm(Dg + 2.0), TOWARD_FRONT, [], { anywhere: true, y: Y3 });
    b.item("long_table", cm((mid3 + sEnd) / 2), cm(Dg + 2.0), TOWARD_FRONT, [min(4.0, sEnd - mid3 - 1.4)], { anywhere: true, y: Y3 });
    b.light({ s: cm(W * 0.25), d: cm(Dg + 1.5), y: Y3 + F - 0.5, kind: "tube", beam: 40, power: 1.2, reach: 2.4, tone: [1, 0.96, 0.88] });
    b.light({ s: cm(W * 0.75), d: cm(Dg + 1.5), y: Y3 + F - 0.5, kind: "tube", beam: 40, power: 1.2, reach: 2.4, tone: [1, 0.96, 0.88] });
  }
  // Light along the galleries.
  for (let s = 2.0; s < W - 1.0; s += 2.4) {
    b.item("downlight", cm(s), cm(Bd + 0.7), TOWARD_RIGHT, [Y3 - eps], { anywhere: true });
    b.light({ s: cm(s), d: cm(Bd + 0.7), y: Y3 - eps - 0.05, kind: "tube", beam: 40, power: 1.0, reach: 2.2, tone: [1, 0.95, 0.85] });
  }
  for (let d = dR + 0.8; d < Bd - 0.4; d += 2.0) {
    b.item("downlight", cm(W - 1.0), cm(d), TOWARD_RIGHT, [Y3 - eps], { anywhere: true });
    b.light({ s: cm(W - 1.0), d: cm(d), y: Y3 - eps - 0.05, kind: "tube", beam: 40, power: 1.0, reach: 2.2, tone: [1, 0.95, 0.85] });
  }

  // ---- the hall: lounge seating, plants, benches, a notice board.
  const LS0 = cm(C + 1.8);
  const LS1 = cm(sR - 0.4);
  if (LS1 - LS0 > 3.0) {
    const cx = cm((LS0 + LS1) / 2);
    b.item("sofa", cx, 0.75, TOWARD_BACK, [min(2.4, LS1 - LS0 - 0.4)], { gap: 0.05, mat: "grey" });
    b.item("sofa", cx, cm(Bd - 2.9), TOWARD_FRONT, [min(2.4, LS1 - LS0 - 0.4)], { gap: 0.05, mat: "grey" });
    for (const dx of [-1.5, 1.5]) b.item("armchair", cm(cx + dx), cm(Bd * 0.5 - 0.3), dx < 0 ? TOWARD_RIGHT : TOWARD_LEFT, [], { gap: 0.05, mat: "orange" });
    b.item("low_table", cx, cm(Bd * 0.5 - 0.3), TOWARD_BACK, [0.5], { gap: 0.05 });
    b.item("tabletop", cx, cm(Bd * 0.5 - 0.3), TOWARD_BACK, [1], { anywhere: true, y: 0.74 });
    b.item("low_table", cm(cx + 1.0), cm(1.9), TOWARD_BACK, [0.35], { gap: 0.05 });
    b.person({ s: cm(cx - 0.5), d: 0.95, face: TOWARD_BACK, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });
    b.person({ s: cm(cx + 1.5 - 0.1), d: cm(Bd * 0.5 - 0.3), face: TOWARD_LEFT, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });
  }
  const LL0 = cm(sStair1 + 0.8);
  const LL1 = cm(C - 1.6);
  if (LL1 - LL0 > 2.0) {
    const cx = cm((LL0 + LL1) / 2);
    b.item("window_bench", cx, 0.55, TOWARD_BACK, [min(2.2, LL1 - LL0 - 0.3)], { gap: 0.05 });
    b.item("armchair", cm(cx - 0.9), cm(Bd - 3.0), TOWARD_FRONT, [], { gap: 0.05, mat: "orange" });
    b.item("armchair", cm(cx + 0.9), cm(Bd - 3.0), TOWARD_FRONT, [], { gap: 0.05, mat: "orange" });
    b.item("low_table", cx, cm(Bd - 4.6), TOWARD_BACK, [0.4], { gap: 0.05 });
    b.person({ s: cm(cx - 0.9), d: cm(Bd - 3.0), face: TOWARD_FRONT, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });
    b.person({ s: cm(C - 2.4), d: cm(Bd - 1.0), face: TOWARD_BACK, activity: "wait", role: "customer", sits: null, family: "chair" });
  }
  for (const [s, d] of [[0.5, 0.6], [W - 0.5, 0.6], [sStair1 + 0.4, 0.6], [C - 2.0, 0.6], [C + 2.0, 0.6], [0.5, Bd - 0.5], [W - 0.5, dR - 0.6], [sR - 0.4, Bd - 0.6]] as const) b.item("plant", cm(s), cm(d), TOWARD_BACK, [], { gap: 0.1 });
  for (const s of [3.4, C + 3.8]) b.item("planter", cm(s), 0.55, TOWARD_RIGHT, [1.8], { gap: 0.1 });
  b.decorate({ kind: "board", s: 0, d: cm(dFoot - 1.4), y: 1.7, face: TOWARD_RIGHT, w: 1.1, h: 0.8, text: "NOTICES" });

  // ---- the light of the hall: glass balls hung at many heights from the grid, the day, downlights under the gallery.
  const cols = max(3, round((W - 5) / 3.2));
  let ball = 0;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < cols; k++) {
      const s = cm(2.6 + ((k + (row % 2) * 0.5) * (W - 5.2)) / max(1, cols - 0.5));
      const d = cm(1.6 + row * ((Bd - 3.0) / 2.5));
      if (s > W - 1.0) continue;
      const y = cm(4.2 + (H - 1.6 - 4.2) * ((ball * 0.61803) % 1));
      const r = cm(0.15 + 0.07 * roll(300 + ball));
      b.item("glass_ball", s, d, TOWARD_RIGHT, [y, r], { anywhere: true });
      b.light({ s, d, y, kind: "bulb", beam: 2, power: 3.0, reach: 3.6, tone: [1, 0.9, 0.72] });
      ball++;
    }
  }
  b.item("lamp_grid", 0, 0, TOWARD_RIGHT, [H - 0.12, 0.8, cm(W - 0.8), 0.8, cm(Bd - 0.4), 2.6], { anywhere: true });

  // ---- the walls: pictures in groups on the brick and the lining, the mural on the tallest wall, board-marked concrete's joints.
  let g = 0;
  const ph = (wall: "left" | "right" | "back" | "front", along: number, y: number): void => void b.hang(wall, cm(along), cm(y), g++ + site.id);
  ph("left", 1.8, 1.8);
  ph("left", cm(dFoot - 1.0 > 3.5 ? dFoot - 1.2 : 3.2), 2.0);
  ph("left", cm(Bd - 1.2), Y2 + 2.1);
  ph("left", cm(dFoot + 1.5), Y2 + 2.0);
  ph("left", cm(Dg + 0.2), Y2 + 1.8);
  ph("right", 2.2, 1.8);
  ph("right", cm(Bd - 1.4), 1.9);
  const mw = cm(Bd - dR - 0.4);
  b.decorate({ kind: "mural", s: W, d: cm((dR + Bd) / 2 - 0.2), y: cm(Y2 + 2.0 + (H - 0.8 - Y2 - 2.0) / 2), face: TOWARD_LEFT, w: cm(max(4.0, mw + 2.0)), h: cm(H - 0.8 - Y2 - 2.0) });
  b.decorate({ kind: "concrete_joints", s: W, d: cm(D / 2), y: cm(H / 2), face: TOWARD_LEFT, w: cm(D - 0.3), h: H });
  // The front wall between the windows.
  for (const s of [2.2, W - 2.2]) b.hang("front", s, 2.2, 3);
  // The gallery's wall behind the rooms is theirs; the gallery's end walls carry a few more.
  b.hang("left", cm(Dg + 0.2), Y2 + 1.8, 1);

  // ---- the places `goin office <name>` stands at.
  const marks = [
    { name: "hall", s: cm(C - 2.0), d: 1.6, y: 0 },
    { name: "floor3", s: cm(C), d: 1.8, y: 0 },
    { name: "stair", s: cm(0.15 + STAIR_W / 2), d: cm(dFoot - 0.6), y: 0 },
    { name: "gallery", s: cm(half(W * 0.55) + 0.25), d: cm(Bd + 0.8), y: Y2 },
    { name: "room", s: cm(player.s), d: cm(Dg + 1.2), y: Y2 },
    { name: "counter", s: cm(c0 - 2.2), d: cm(Bd - 0.8), y: 0 },
    ...(stair3 === null ? [] : [stair3]),
  ];
  const wallBrick = { mat: "brick", tint: [1.0, 0.95, 0.9] as [number, number, number], wainscot: { h: F, mat: "oak", tint: [0.85, 0.7, 0.55] as [number, number, number] } };
  return b.build({
    name: "office",
    legacy: false,
    doorS: site.doorS,
    doorWidth: site.doorWidth,
    doorHead: 2.9,
    arrive: arrivalOf(W, site.doorS),
    shell: {
      front: { mat: "painted", tint: white, skirt: "dark_wood" },
      left: wallBrick,
      right: { mat: "concrete", tint: [1.45, 1.45, 1.4] },
      back: { mat: "brick", tint: [1.0, 0.95, 0.9], skirt: "dark_wood" },
      floor: "concrete",
      ceiling: "painted",
    },
    mood: { exposure: 1.3, ambient: [1, 0.96, 0.9], ambientK: 0.04, day: 0.6, bounce: 0.95 },
    marks,
  });
}
