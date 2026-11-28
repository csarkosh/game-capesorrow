/**
 * The lodging: a hotel's lobby, the stair, the corridor over the lobby and the player's room off it; or, in a motel of one storey, the office and the corridor and room behind it. One design,
 * written against the unit's width, the building's depth and its storeys, and held from a 9.6 m inn to a 29.8 m hotel.
 *
 * The lobby is bright and warm-white: a white stone reception desk with a timber shelf before a wall of vertical timber slats that carries the lodging's own name in lit letters, a suspended ceiling of timber
 * battens with strip lights, hanging lamps, a floor of large pale tiles with carpet insets, a lounge by the front windows (a teal sofa, round pouffes, a low oval table), a few dining tables with shell chairs, a wall of open shelving
 * with a television and full-height curtains at the windows. A small lodging (under 12 m wide) keeps the desk, the slat wall, two armchairs with a low table and the stair.
 *
 * A building of two storeys or more has a stair of two flights and a landing at the lobby's far end from the street door, rising through a slot in the floor slab to floor 2 (the lobby is not open to it: its ceiling is the corridor's floor).
 * Floor 2 is a corridor 1.8 m wide along `s` with shut numbered doors on both sides and the player's room, whose door stands open. At three storeys or more the corridor's other end has the flight above, eight steps built and a barrier across
 * it at the third (a step ladder, paint cans, a dust sheet, a sign), with the dark behind it. A motel of one storey has no stair: the corridor is on the ground floor behind the lobby, through an open doorway.
 *
 * The room is about 4.25 m wide and 6.5 m long: a short entry past a closet front and a shut bathroom door, a king bed with its head on the teal right wall between two wall lamps, a dresser with a television opposite
 * its foot and a desk beside it, a window with a heater under it in the back wall. Where the room is short it keeps the bed and gives up the rest.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { arrivalOf } from "../convert.js";
import { DesignBuilder, FRONT_WALL, cm, mirrorDesign, onWall, type Design, type Slab, type Spot, type Surface, type WallOpening } from "../design.js";
import { footOf } from "../kinds.js";

const { ceil, floor, max, min, round } = Math;

export type LodgingSite = {
  readonly id: number;
  readonly width: number;
  readonly maxDepth: number;
  readonly height: number;
  readonly storeys: number;
  readonly doorS: number;
  readonly doorWidth: number;
  readonly name: string;
};

const TOWARD_BACK: Spot = { s: 0, d: 1 };
const TOWARD_FRONT: Spot = { s: 0, d: -1 };
const TOWARD_RIGHT: Spot = { s: 1, d: 0 };
const TOWARD_LEFT: Spot = { s: -1, d: 0 };

/** The corridor's width between its walls, a wall's thickness, the width of a lane of the stair and the room's inner width and the standing height of the upper floor. */
const CORRIDOR = 1.8;
const WALL = 0.15;
const LANE = 1.6;
const ROOM_W = 4.25;
const UPPER = 3.0;
const RISER = 0.177;

/** A `d` that puts a row of the 0.5 m grid the walking is tested on in the middle of a corridor 1.8 m wide (the walls 15 cm thick): a corridor's `Dc`. */
const alignDc = (v: number): number => floor((v + 0.65) / 0.5) * 0.5 - 0.65;

/** The first word of a name, or its initials where the first word is short: what the lit letters say. */
export function shortName(name: string): string {
  const words = name.split(" ").filter((w) => w.length > 0);
  const first = words[0] ?? "HOTEL";
  if (first.length >= 4 && first.length <= 11) return first.toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
}

export function lodgingDesign(site: LodgingSite): Design {
  // The layout is written with the stair at the right end and the street door in the left half; a door in the right half has the whole of it reflected.
  const flipped = site.doorS > site.width / 2;
  // The layout is held to a grid of half metres (its walls and doors stand on cells of the walking grid), so it is reflected about a width on it.
  const about = floor(site.width * 2) / 2;
  const strip = { slabs: [] as Slab[], surfaces: [] as Surface[] };
  const laid = layout({ ...site, doorS: flipped ? cm(about - site.doorS) : site.doorS }, strip);
  const d = flipped ? mirrorDesign(laid, about) : laid;
  // What is left of the width past the grid of half metres is floor and ceiling and nothing else, at the right end: the ground floor's surface is carried out to it.
  const ground = d.surfaces[0];
  const surfaces = ground !== undefined && ground.kind === "floor" && site.width - about > 0.001 ? [{ ...ground, s1: site.width }, ...d.surfaces.slice(1)] : d.surfaces;
  return strip.slabs.length === 0 ? d : { ...d, slabs: [...d.slabs, ...strip.slabs], surfaces };
}

function layout(site: LodgingSite, strip: { slabs: Slab[]; surfaces: Surface[] }): Design {
  const W = site.width;
  const Wm = floor(site.width * 2) / 2;
  const H = site.height;
  const id = site.id;
  const multi = site.storeys >= 2;
  const D = cm(multi ? min(site.maxDepth, 13) : min(site.maxDepth, 12));
  const F = cm(H + 0.3);
  const top = multi ? cm(F + min(H, UPPER)) : H;
  const yc = multi ? F : 0;
  const b = new DesignBuilder(W, D, top, id, footOf);
  const small = W < 12 || !multi;

  // ---- the corridor's place: `Dc` is its near edge, where a row of the walking grid runs down its middle.
  let Dc: number;
  if (multi) Dc = D < 8 ? 0.35 : max(0.35, alignDc(min(max(0.45, min(4.2, D * 0.33)), D - 3.45)));
  else Dc = alignDc(max(3.6, min(5.0, D * 0.38)) + 0.075 + 0.6) + 0.5;
  Dc = cm(Dc);
  const Fw = cm(Dc - WALL / 2);
  const Bw = cm(Dc + CORRIDOR + WALL / 2);
  const Rd0 = cm(Dc + CORRIDOR + WALL);
  const Ly = cm(D - Rd0);

  // ---- the stair: two flights and a landing at the right end, rising from the lobby to the corridor's floor.
  let Ss = Wm - 0.15 - LANE;
  const nTot = round(F / RISER);
  const nA = ceil(nTot / 2);
  const nB = nTot - nA;
  const ris = F / nTot;
  const yL = cm(nA * ris);
  let run = 0;
  if (multi) {
    const nMax = max(nA, nB);
    const avail = Wm - 0.15 - LANE - 5.3;
    run = cm(max(nMax * 0.2, min(nMax * 0.28, avail)));
    Ss = cm(Wm - 0.15 - LANE - run);
  }
  const Cs0 = 0.15;
  const Cs1 = multi ? Ss : cm(Wm - 0.15);

  // ---- the room: its left wall's place, so that its door's middle is on a cell of the walking grid.
  const Rs0 = multi ? Ss - 0.15 - (ROOM_W + WALL) : Wm - 0.35 - (ROOM_W + WALL);
  const sDoor = floor((Rs0 + 0.775 - 0.25) / 0.5) * 0.5 + 0.25;
  const Rs = cm(sDoor - 0.775);
  const X = (x: number): number => cm(Rs + WALL / 2 + x);
  const Y = (y: number): number => cm(Rd0 + y);
  // The rooms are numbered along the corridor from its far end: odd on the far side, even on the street's, in the 200s on floor 2 and the 100s on a motel's one floor.
  const numBase = multi ? 200 : 100;

  // ---- what is kept clear on the ground floor: the street door's zone and way in, and the stair's foot and its approach.
  const zoneL = site.doorS - site.doorWidth / 2 - 0.55;
  const zoneR = site.doorS + site.doorWidth / 2 + 0.55;
  b.reserve({ s0: zoneL, s1: zoneR, d0: 0, d1: 2.5 });
  b.reserve({ s0: site.doorS - 0.7, s1: site.doorS + 0.7, d0: 0, d1: min(3, D - 1) });
  if (multi) b.reserve({ s0: Ss - 1.3, s1: Wm, d0: Dc - 0.3, d1: Dc + 2 * LANE + 0.4 });

  // ---- floors and ceilings.
  b.slab({ kind: "floor", s0: 0, s1: Wm, d0: FRONT_WALL, d1: D, y: 0, thick: 0, mat: "marble_tile", tint: [1.0, 0.98, 0.94] });
  if (multi) {
    // The corridor's floor, which is the lobby's ceiling: a slab 0.3 m thick over the whole plan, open over the lane that the flight up rises through.
    const hole = { s0: Ss, s1: cm(Ss + run), d0: Dc, d1: cm(Dc + LANE) };
    const piece = (s0: number, s1: number, d0: number, d1: number): void => {
      if (s1 - s0 > 0.01 && d1 - d0 > 0.01) b.slab({ kind: "floor", s0, s1, d0, d1, y: F, thick: 0.3, mat: "carpet", edge: "plaster", tint: [0.55, 0.45, 0.38] });
    };
    piece(0, hole.s0, FRONT_WALL, D);
    piece(hole.s1, Wm, FRONT_WALL, D);
    piece(hole.s0, hole.s1, FRONT_WALL, hole.d0);
    piece(hole.s0, hole.s1, hole.d1, D);
    b.slab({ kind: "ceiling", s0: 0, s1: Wm, d0: FRONT_WALL, d1: D, y: top, thick: 0, mat: "painted", tint: [1.15, 1.1, 1.0] });
  } else {
    b.slab({ kind: "ceiling", s0: 0, s1: Wm, d0: FRONT_WALL, d1: D, y: H, thick: 0, mat: "painted", tint: [1.15, 1.1, 1.0] });
  }

  // ---- the surfaces.
  const surf = (s0: number, s1: number, d0: number, d1: number, y: number): void => b.surface({ kind: "floor", s0, s1, d0, d1, y });
  if (multi) surf(0, Wm, 0, D, 0);
  else surf(0, Wm, 0, cm(Fw + 0.1), 0);
  if (W - Wm > 0.001) {
    strip.slabs.push({ kind: "floor", s0: Wm, s1: W, d0: FRONT_WALL, d1: D, y: 0, thick: 0, mat: "marble_tile", tint: [1.0, 0.98, 0.94] });
    strip.slabs.push({ kind: "ceiling", s0: Wm, s1: W, d0: FRONT_WALL, d1: D, y: top, thick: 0, mat: "painted", tint: [1.15, 1.1, 1.0] });
    if (multi) strip.slabs.push({ kind: "floor", s0: Wm, s1: W, d0: FRONT_WALL, d1: D, y: F, thick: 0.3, mat: "carpet", edge: "plaster", tint: [0.55, 0.45, 0.38] });
  }

  // ---- the walls round the corridor and the room, and the doors in them.
  const level = yc;
  const wallTop = level + (multi ? UPPER : H);
  const cream: readonly [number, number, number] = [0.95, 0.82, 0.62];
  const beige: readonly [number, number, number] = [1.0, 0.88, 0.72];
  const teal: readonly [number, number, number] = [0.08, 0.95, 1.0];
  const opening = (centre: number, from: number, width: number, shut: boolean): WallOpening => ({ a0: cm(centre - width / 2 - from), a1: cm(centre + width / 2 - from), head: cm(level + 2.05), ...(shut ? { shut: true } : {}) });
  const byStart = (x: WallOpening, y: WallOpening): number => x.a0 - y.a0;
  const plate = (s: number, dd: number, face: Spot, n: number): void => b.decorate({ kind: "sign", s, d: dd, y: level + 1.55, face, w: 0.16, h: 0.07, text: String(n) });

  // Front wall of the corridor: shut doors to the rooms on the street's side, a niche for the ice machine, an open way to the lobby in a motel.
  const front: WallOpening[] = [];
  const doorsFront: number[] = [];
  const niche = cm(Cs1 - 3.3);
  if (multi) {
    for (let j = 0; j < 5; j++) {
      const s = cm(Cs1 - 2.4 - 4.4 * j);
      if (s < Cs0 + 1.0 || Math.abs(s - niche) < 1.5) continue;
      doorsFront.push(s);
    }
    for (const s of doorsFront) front.push(opening(s, Cs0, 1.0, true));
    if (niche > Cs0 + 1) front.push(opening(niche, Cs0, 1.2, false));
  } else front.push(opening(cm(Wm * 0.5), Cs0, 2.0, false));
  front.sort(byStart);
  b.wall({ s0: Cs0, d0: Fw, s1: cm(Wm - 0.15), d1: Fw, thick: WALL, y0: level, y1: wallTop, mat: "painted", tint: beige, matBack: "painted", tintBack: cream, openings: front, skirt: "dark_wood" });
  if (multi) b.item("ice_machine", niche, cm(Dc - 0.55), TOWARD_BACK, [], { anywhere: true, y: yc });
  for (let j = 0; j < doorsFront.length; j++) plate(cm((doorsFront[j] as number) + 0.8), Dc + 0.02, TOWARD_BACK, numBase + 2 + 2 * doorsFront.filter((x) => x < (doorsFront[j] as number)).length);

  // Back wall of the corridor: shut doors, the player's open one, and the stair's side where the corridor ends.
  const back: WallOpening[] = [opening(sDoor, Cs0, 1.0, false)];
  const doorsBack: number[] = [];
  for (let j = 1; j < 5; j++) {
    const s = cm(sDoor - 4.4 * j);
    if (s < Cs0 + 1.0) break;
    doorsBack.push(s);
  }
  for (const s of doorsBack) back.push(opening(s, Cs0, 1.0, true));
  back.sort(byStart);
  const backTo = cm(Wm - 0.15);
  b.wall({ s0: Cs0, d0: Bw, s1: backTo, d1: Bw, thick: WALL, y0: level, y1: wallTop, mat: "painted", tint: beige, matBack: "painted", tintBack: cream, openings: back, skirt: "dark_wood" });
  const backNo = (s: number): number => numBase + 1 + 2 * [...doorsBack, sDoor].filter((x) => x < s).length;
  for (const s of doorsBack) plate(cm(s + 0.8), Dc + CORRIDOR - 0.02, TOWARD_FRONT, backNo(s));
  plate(cm(sDoor + 0.8), Dc + CORRIDOR - 0.02, TOWARD_FRONT, backNo(sDoor));
  if (multi) {
    // The corridor ends against the stair's slot: a short wall closes the 20 cm between the flight's lane and the back wall.
    b.wall({ s0: Ss, d0: cm(Dc + LANE - 0.03), s1: Ss, d1: cm(Dc + CORRIDOR + WALL), thick: 0.1, y0: F, y1: wallTop, mat: "painted", tint: cream, openings: [] });
  } else {
    b.wall({ s0: Cs0, d0: Dc, s1: Cs0, d1: Bw, thick: WALL, y0: 0, y1: H, mat: "painted", tint: cream, openings: [] });
  }

  // The corridor's surface, from its far end to where the stair's top meets it; and the flight above floor 2.
  const closed = multi && site.storeys >= 3 && Ss >= 7.45;
  let flightMark: { name: string; s: number; d: number; y: number } | null = null;
  const corrFrom = closed ? 2.39 : 0;
  if (multi) surf(corrFrom, Ss, cm(Dc - 0.05), cm(Dc + CORRIDOR + 0.05), F);
  else surf(0, Wm, cm(Fw - 0.1), cm(Bw + 0.1), 0);
  if (closed) {
    // Eight steps rising toward the corridor's end, a barrier across it at the third, and the dark behind.
    const s0 = Cs0;
    const s1 = cm(Cs0 + 8 * 0.28);
    const rise = 8 * RISER;
    b.display({ s0, s1, d0: Dc, d1: cm(Dc + CORRIDOR), along: "s", y0: cm(F + rise), y1: F, base: F, mat: "oak", rails: [] });
    const sBar = cm(s1 - 3 * 0.28);
    flightMark = { name: "flight", s: cm(sBar + 0.95), d: cm(Dc + CORRIDOR / 2), y: cm(F + (rise * (s1 - (sBar + 0.95))) / (s1 - s0)) };
    b.surface({ kind: "ramp", s0: sBar, s1, d0: Dc, d1: cm(Dc + CORRIDOR), along: "s", y0: cm(F + (rise * (s1 - sBar)) / (s1 - s0)), y1: F });
    b.block({ s: sBar, d: cm(Dc + CORRIDOR / 2), ax: 1, ad: 0, ha: 0.05, hb: CORRIDOR / 2, y0: F, y1: F + 3 });
    b.wall({ s0, d0: Dc, s1: s0, d1: Bw, thick: 0.1, y0: F, y1: wallTop, mat: "painted", tint: [0.1, 0.1, 0.1], tintBack: [0.06, 0.06, 0.06], matBack: "painted", openings: [] });
    b.item("barrier", sBar, cm(Dc + CORRIDOR / 2), TOWARD_RIGHT, [F + 0.53], { anywhere: true, y: F });
    b.item("step_ladder", cm(sBar - 0.5), cm(Dc + 1.4), TOWARD_RIGHT, [F + 0.9], { anywhere: true, y: F });
    b.item("paint_cans", cm(s1 - 0.3), cm(Dc + 0.4), TOWARD_RIGHT, [F], { anywhere: true, y: F });
    b.item("dust_sheet", cm(s1 - 0.7), cm(Dc + CORRIDOR / 2), TOWARD_RIGHT, [F, rise / 8], { anywhere: true, y: F });
    b.decorate({ kind: "sign", s: sBar + 0.06, d: cm(Dc + CORRIDOR / 2), y: F + 1.25, face: TOWARD_RIGHT, w: 0.8, h: 0.4, text: "CLOSED FOR|MAINTENANCE" });
  }

  // The stair itself: flight A up from the lobby, the landing, flight B back to the corridor's floor.
  if (multi) {
    b.stair({ s0: Ss, s1: cm(Ss + run), d0: cm(Dc + LANE + 0.1), d1: cm(Dc + 2 * LANE + 0.1), along: "s", y0: 0, y1: yL, base: 0, mat: "oak", rails: ["lo", "hi"] });
    b.stair({ s0: Ss, s1: cm(Ss + run), d0: Dc, d1: cm(Dc + LANE), along: "s", y0: F, y1: yL, base: 0, mat: "oak", rails: ["lo", "hi"] });
    const lend = cm(Wm - 0.15);
    b.surface({ kind: "floor", s0: cm(Ss + run), s1: lend, d0: Dc, d1: cm(Dc + 2 * LANE + 0.1), y: yL });
    b.slab({ kind: "floor", s0: cm(Ss + run), s1: lend, d0: Dc, d1: cm(Dc + 2 * LANE + 0.1), y: yL, thick: 0.2, mat: "oak", edge: "dark_wood" });
    // The landing's open side toward the lobby is railed: a hull on it is not to step off onto the floor under it.
    b.rail({ s0: cm(Ss + run), d0: Dc, s1: lend, d1: Dc, y: yL, h: 1.0, kind: "bars", mat: "steel" });
    // The shaft's back wall on the ground floor and the corridor's wall above it are the building's; a wall closes the lobby side of the stair's far side.
    b.wall({ s0: Ss, d0: cm(Dc + 2 * LANE + 0.2), s1: lend, d1: cm(Dc + 2 * LANE + 0.2), thick: 0.1, y0: 0, y1: F - 0.3, mat: "painted", tint: [0.9, 0.85, 0.75], openings: [] });
  }

  // ---- the player's room.
  const roomY = yc;
  const hasBath = Ly >= 5.6;
  const entry = hasBath ? 2.2 : 0.8;
  const roomWalls = (): void => {
    const sL = cm(Rs);
    const sR = cm(Rs + ROOM_W + WALL);
    b.wall({ s0: sL, d0: Bw, s1: sL, d1: D, thick: WALL, y0: roomY, y1: wallTop, mat: "painted", tint: cream, matBack: "painted", tintBack: beige, openings: [] });
    b.wall({ s0: sR, d0: Bw, s1: sR, d1: D, thick: WALL, y0: roomY, y1: wallTop, mat: "painted", tint: teal, matBack: "painted", tintBack: cream, openings: [] });
    if (hasBath) {
      const sB = X(2.45);
      b.wall({ s0: sB, d0: Rd0, s1: sB, d1: Y(entry), thick: 0.1, y0: roomY, y1: wallTop, mat: "painted", tint: beige, tintBack: beige, matBack: "painted", openings: [{ a0: 0.35, a1: 1.25, head: cm(roomY + 2.05), shut: true }] });
      b.wall({ s0: sB, d0: Y(entry), s1: cm(sR), d1: Y(entry), thick: 0.1, y0: roomY, y1: wallTop, mat: "painted", tint: beige, matBack: "painted", tintBack: beige, openings: [] });
    }
  };
  roomWalls();
  // The room's floor: the whole of it but the bathroom's block.
  surf(X(0), X(ROOM_W), cm(Bw - 0.1), D, roomY);
  // The bathroom's inside is solid ground to nobody: a block over it, so that no hull is put in a room it has no way into.
  if (hasBath) b.block({ s: cm((X(2.45) + X(ROOM_W)) / 2), d: cm(Rd0 + entry / 2), ax: 1, ad: 0, ha: cm((X(ROOM_W) - X(2.45)) / 2), hb: cm(entry / 2), y0: roomY, y1: roomY + UPPER });
  b.slab({ kind: "floor", s0: cm(Rs), s1: cm(Rs + ROOM_W + WALL), d0: Bw, d1: D, y: cm(roomY + 0.012), thick: 0.0, mat: "carpet", tint: [0.5, 0.4, 0.3] });
  if (!multi) b.slab({ kind: "floor", s0: 0.15, s1: cm(Wm - 0.15), d0: Dc, d1: cm(Dc + CORRIDOR), y: 0.012, thick: 0.0, mat: "carpet", tint: [0.55, 0.45, 0.38] });
  // The door's leaf stands open against the closet wall; the closet front and a number plate.
  b.decorate({ kind: "door_leaf", s: X(0.22), d: Y(0.5), y: roomY + 1.0, face: TOWARD_RIGHT, w: 1.0, h: 2.0 });
  b.decorate({ kind: "closet_front", s: X(0), d: Y(hasBath ? 1.6 : 0.9), y: roomY + 1.05, face: TOWARD_RIGHT, w: hasBath ? 1.0 : 0.6, h: 2.1 });
  // The bed: its head on the right wall, its foot toward the left, between its two bedside tables.
  const yb = cm(min(entry + 0.55 + 0.5 + 0.97, Ly - 0.97 - 0.3));
  const bedS = X(ROOM_W - 1.08 - 0.02);
  b.item("bed", bedS, Y(yb), TOWARD_LEFT, [], { gap: 0, y: roomY });
  for (const sg of [-1, 1]) {
    const dd = Y(yb + sg * 1.2);
    // Both lamps hang over the head of the bed whether or not a bedside table has the room.
    if (yb + sg * 0.78 > entry + 0.2 && yb + sg * 0.78 < Ly - 0.2) {
      b.decorate({ kind: "wall_lamp", s: X(ROOM_W), d: Y(yb + sg * 0.78), y: roomY + 1.45, face: TOWARD_LEFT, w: 0.12, h: 0.2 });
      b.light({ s: X(ROOM_W - 0.2), d: Y(yb + sg * 0.78), y: roomY + 1.45, kind: "lamp", power: 0.35, reach: 1.5, tone: [1, 0.85, 0.6] });
    }
    if (Y(yb + sg * 1.2) > D - 0.4 || yb + sg * 1.2 < entry + 0.3) continue;
    b.item("bedside", X(ROOM_W - 0.27), dd, TOWARD_LEFT, [], { gap: 0, y: roomY + 0.0 });
  }
  if (Ly >= 4.6) {
    b.item("dresser", X(0.3), Y(yb - 0.55), TOWARD_RIGHT, [], { gap: 0, y: roomY });
    if (yb + 0.1 + 1.4 < Ly - 0.1) {
      b.item("desk", X(0.32), Y(yb + 0.85), TOWARD_RIGHT, [], { gap: 0, y: roomY });
      // The chair is drawn tucked under the desk, inside its footprint, so that it holds no more of the way past than the desk does.
      b.item("chair", X(0.32), Y(yb + 0.85), TOWARD_LEFT, [], { gap: -1, y: roomY, mat: "dark_wood" });
      b.decorate({ kind: "forest_picture", s: X(0), d: Y(yb + 0.85), y: roomY + 1.65, face: TOWARD_RIGHT, w: 0.9, h: 0.72 });
      b.light({ s: X(0.4), d: Y(yb + 0.6), y: roomY + 1.2, kind: "lamp", power: 0.35, reach: 1.4, tone: [1, 0.9, 0.7] });
    }
  }
  // The room's small things: a luggage rack with a suitcase, a waste bin, a tray with a kettle and cups on the dresser, an armchair with a floor lamp in the corner by the window, a full-length mirror by the closet.
  if (Ly >= 4.6) {
    for (const dd of [yb + 2.0, yb - 1.7]) if (dd > entry + 0.4 && dd < Ly - 0.4 && b.item("luggage_rack", X(0.35), Y(dd), TOWARD_RIGHT, [], { gap: 0.05, y: roomY })) break;
    b.item("waste_bin", X(0.25), Y(min(Ly - 0.3, yb + 1.75)), TOWARD_RIGHT, [], { gap: 0.02, y: roomY });
    b.item("kettle_tray", X(0.3), Y(yb - 0.85), TOWARD_RIGHT, [], { anywhere: true, y: cm(roomY + 0.85) });
    if (Ly >= 5.2 && b.item("armchair", X(0.7), cm(D - 0.6), TOWARD_RIGHT, [], { gap: 0.05, y: roomY, mat: "mustard" })) {
      b.item("floor_lamp", X(0.3), cm(D - 1.3), TOWARD_RIGHT, [], { gap: 0.02, y: roomY });
      b.light({ s: X(0.3), d: cm(D - 1.3), y: roomY + 1.4, kind: "lamp", power: 0.3, reach: 1.6, tone: [1, 0.85, 0.6] });
    }
    if (yb - 1.25 > (hasBath ? 3.2 : 1.8)) b.decorate({ kind: "mirror", s: X(0), d: Y(hasBath ? 2.7 : 1.7), y: cm(roomY + 1.0), face: TOWARD_RIGHT, w: 0.5, h: 1.7 });
  }
  if (Ly >= 5.2) b.item("footstool", X(2.5), Y(min(yb + 1.4, Ly - 0.7)), TOWARD_LEFT, [], { gap: 0.02, y: roomY });
  // The window in the back wall (a bright pane behind a half-drawn blind) with its heater under it, and what lights the room from it.
  const winX = ROOM_W / 2 + 0.2;
  b.decorate({ kind: "lit_pane", s: X(winX), d: D, y: roomY + 1.5, face: TOWARD_FRONT, w: 1.3, h: 1.25 });
  b.windows.push({ wall: "back", a0: cm(X(winX) - 0.65), a1: cm(X(winX) + 0.65), y0: cm(roomY + 1.5 - 0.625), y1: cm(roomY + 1.5 + 0.625) });
  b.item("heater", X(winX), cm(D - 0.12), TOWARD_FRONT, [], { gap: 0, y: roomY });
  b.decorate({ kind: "curtain_pair", s: X(winX), d: D, y: cm(roomY + (UPPER - 0.2) / 2 + 0.05), face: TOWARD_FRONT, w: 1.3, h: cm(UPPER - 0.2) });
  b.item("smoke_detector", X(ROOM_W / 2), Y(Ly * 0.5), TOWARD_RIGHT, [], { anywhere: true, y: roomY });
  b.item("cornice", 0, 0, TOWARD_RIGHT, [X(0), X(ROOM_W), cm(Rd0 + WALL / 2), D], { anywhere: true, y: roomY });
  b.decorate({ kind: "light_switch", s: X(0), d: Y(1.0), y: cm(roomY + 1.2), face: TOWARD_RIGHT, w: 0.08, h: 0.12 });
  b.decorate({ kind: "fire_plan", s: X(0.25), d: Y(0.5), y: cm(roomY + 1.5), face: TOWARD_RIGHT, w: 0.3, h: 0.4 });
  b.light({ s: X(winX), d: cm(D - 0.5), y: roomY + 1.5, kind: "glow", power: 0.6, reach: 2.6, tone: [0.85, 0.92, 1] });
  b.light({ s: X(2.0), d: Y(min(2.4, Ly * 0.4)), y: roomY + 2.5, kind: "lamp", power: 0.25, reach: 2.4, tone: [1, 0.92, 0.78] });

  // ---- the corridor's fittings: wall lamps every 4 m, an exit sign toward the stair.
  const lampY = level + 1.9;
  for (let s = Cs0 + 2; s < Cs1 - 1; s += 4) {
    b.decorate({ kind: "wall_lamp", s: cm(s), d: Dc, y: lampY, face: TOWARD_BACK, w: 0.12, h: 0.2 });
    b.light({ s: cm(s), d: cm(Dc + 0.3), y: lampY, kind: "lamp", power: 0.3, reach: 2.2, tone: [1, 0.82, 0.55] });
  }
  if (multi) {
    b.decorate({ kind: "sign", s: cm(Cs1 - 0.9), d: Dc, y: level + 2.45, face: TOWARD_BACK, w: 0.5, h: 0.2, text: "EXIT" });
    b.light({ s: cm(Cs1 - 0.9), d: cm(Dc + 0.3), y: level + 2.45, kind: "glow", power: 0.12, reach: 1.2, tone: [1, 0.2, 0.15] });
  }

  // ---- the lobby.
  const lobbyBack = multi ? D : Fw - WALL;
  const deskLen = cm(max(1.8, min(small ? 2.6 : 3.6, lobbyBack - 3.6)));
  const deskD = cm(lobbyBack - 0.5 - deskLen / 2);
  const deskS = 1.65;
  b.item("reception_desk", deskS, deskD, TOWARD_RIGHT, [deskLen], { gap: 0.05 });
  const slatLen = cm(deskLen + 1.0);
  const slatH = cm(min(H - 0.15, 3.3));
  b.decorate({ kind: "slat_wall", s: 0, d: deskD, y: cm(slatH / 2 + 0.05), face: TOWARD_RIGHT, w: slatLen, h: slatH });
  b.decorate({ kind: "lit_letters", s: 0, d: deskD, y: min(2.35, H - 0.9), face: TOWARD_RIGHT, w: slatLen - 0.4, h: 0.5, text: shortName(site.name) });
  b.light({ s: 0.6, d: deskD, y: 2.2, kind: "strip", power: 0.7, reach: 2.2, tone: [1, 0.9, 0.7] });
  b.person({ s: 0.75, d: cm(deskD + 0.2), face: TOWARD_RIGHT, activity: "till", role: "staff", sits: null, family: "chair" });
  const dsx = cm(deskS + 1.9);
  b.item("carpet_inset", dsx, deskD, TOWARD_BACK, [cm(deskLen + 0.6), 1.8, 1], { anywhere: true });
  const battenFrom = cm(deskD - deskLen / 2 - 0.6);
  b.item("batten_ceiling", 2.2, battenFrom, TOWARD_BACK, [cm(min(deskLen + 1.2, lobbyBack - 0.15 - battenFrom)), 3.6, cm(H - 0.4)], { anywhere: true });
  b.item("pendant_lamp", cm(deskS + 1.3), cm(deskD - deskLen * 0.25), TOWARD_RIGHT, [cm(H - 1.4)], { anywhere: true });
  b.light({ s: cm(deskS + 1.3), d: cm(deskD - deskLen * 0.25), y: cm(H - 1.5), kind: "pendant", beam: 80, power: 2.6, reach: 2.4, tone: [1, 0.92, 0.78] });
  b.item("floor_joints", 0, 0, TOWARD_RIGHT, [W, FRONT_WALL, D, 0.8], { anywhere: true });

  let loungeMark = cm(min(Ss - 3.5, max(4.5, Wm * 0.45)));
  const backD = multi ? D : cm(lobbyBack);
  const hang = H - 0.4;
  /** A lamp or a strip of light of the ceiling's, with the item that draws it where there is one. */
  const downlights = (s0: number, s1: number, d0: number, d1: number, step: number): void => {
    for (let s = s0; s <= s1; s += step) for (let dd = d0; dd <= d1; dd += step) {
      b.item("downlight", cm(s), cm(dd), TOWARD_RIGHT, [], { anywhere: true });
      b.light({ s: cm(s), d: cm(dd), y: cm(H - 0.05), kind: "tube", beam: 80, power: 1.4, reach: 2.2, tone: [1, 0.93, 0.8] });
    }
  };
  if (!small) {
    // ---- (a) reception: the desk and wall are above; two armchairs waiting by a side table, a luggage cart, a rack of brochures.
    const roomy = lobbyBack >= 10;
    const wait = cm(deskD - deskLen / 2 - 1.4);
    if (roomy) b.item("armchair", 4.7, cm(wait - 0.9), TOWARD_LEFT, [], { gap: 0.1, mat: "grey" });
    if (roomy) b.item("armchair", 4.7, cm(wait + 0.9), TOWARD_LEFT, [], { gap: 0.1, mat: "grey" });
    if (roomy) b.item("side_table", 4.75, wait, TOWARD_LEFT, [], { gap: 0.1 });
    if (roomy) b.light({ s: 4.75, d: wait, y: 1.45, kind: "lamp", power: 0.5, reach: 1.3, tone: [1, 0.85, 0.6] });
    if (roomy) b.item("luggage_cart", 3.3, cm(deskD - deskLen / 2 - 0.6), TOWARD_RIGHT, [], { gap: 0.1 });
    b.item("brochure_rack", 0.4, cm(deskD - deskLen / 2 - 1.2), TOWARD_RIGHT, [], { gap: 0.1 });
    if (roomy) b.person({ s: 4.7, d: cm(wait - 0.9), face: TOWARD_LEFT, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });

    // ---- (b) the lounge by the front windows: the corner sofa, pouffes, the oval table on a carpet, and a second group beside it of a grey sofa and two yellow armchairs; floor lamps, side tables with lamps.
    const group = (sx: number, grey: boolean, person: boolean): boolean => {
      if (!b.fits("sofa", sx, 1.0, TOWARD_BACK, [3.2], { gap: 0.05 })) return false;
      b.item("sofa", sx, 1.0, TOWARD_BACK, [grey ? 2.8 : 3.2], { gap: 0.05, ...(grey ? { mat: "grey" } : {}) });
      if (!grey) {
        loungeMark = cm(sx - 1.0);
        b.item("sofa", cm(sx + 1.15), 2.5, TOWARD_LEFT, [2.0], { gap: 0.05 });
        b.item("pouffe", cm(sx - 1.5), 2.3, TOWARD_BACK, [], { gap: 0.05 });
        b.item("pouffe", cm(sx - 0.3), 3.5, TOWARD_BACK, [], { gap: 0.05 });
        b.item("pouffe", cm(sx + 0.6), 3.6, TOWARD_BACK, [], { gap: 0.05 });
        b.item("oval_table", cm(sx - 0.7), 2.6, TOWARD_BACK, [], { gap: 0.05 });
        b.item("tabletop", cm(sx - 0.7), 2.6, TOWARD_BACK, [4], { anywhere: true, y: 0.42 });
      } else {
        b.item("armchair", cm(sx - 0.8), 3.3, TOWARD_FRONT, [], { gap: 0.05, mat: "yellow" });
        b.item("armchair", cm(sx + 0.8), 3.3, TOWARD_FRONT, [], { gap: 0.05, mat: "yellow" });
        b.item("oval_table", sx, 2.3, TOWARD_BACK, [], { gap: 0.05 });
        b.item("tabletop", sx, 2.3, TOWARD_BACK, [3], { anywhere: true, y: 0.42 });
      }
      b.item("carpet_inset", cm(sx - 0.4), 2.3, TOWARD_BACK, [4.4, grey ? 3.6 : 4.4, grey ? 0 : 1], { anywhere: true });
      b.item("floor_lamp", cm(sx + 1.9), 0.7, TOWARD_BACK, [], { gap: 0.05 });
      b.light({ s: cm(sx + 1.9), d: 0.7, y: 1.4, kind: "lamp", power: 0.8, reach: 1.7, tone: [1, 0.85, 0.6] });
      b.item("side_table", cm(sx - 1.9), 0.75, TOWARD_BACK, [], { gap: 0.05 });
      b.light({ s: cm(sx - 1.9), d: 0.75, y: 1.0, kind: "lamp", power: 0.6, reach: 1.3, tone: [1, 0.85, 0.6] });
      b.item("batten_ceiling", cm(sx - 2.3), 2.3, TOWARD_RIGHT, [4.8, 3.6, cm(hang)], { anywhere: true });
      for (let k = 0; k < 3; k++) {
        b.item("pendant_lamp", cm(sx - 1.1 + k * 0.9), cm(2.2 + (k % 2) * 0.7), TOWARD_RIGHT, [cm(H - 1.2 - k * 0.3)], { anywhere: true });
        b.light({ s: cm(sx - 1.1 + k * 0.9), d: cm(2.2 + (k % 2) * 0.7), y: cm(H - 1.3 - k * 0.3), kind: "pendant", beam: 80, power: 2.6, reach: 2.4, tone: [1, 0.9, 0.7] });
      }
      b.light({ s: cm(sx - 0.5), d: 2.3, y: cm(hang), kind: "tube", beam: 40, power: 0.9, reach: 2.2, tone: [1, 0.96, 0.88] });
      if (person) b.person({ s: cm(sx - 0.6), d: 0.95, face: TOWARD_BACK, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });
      return true;
    };
    let placed = 0;
    for (let sx = cm(Ss - 3.2); sx >= 7.4 && placed < 2; sx = cm(sx - 1.0)) if (group(sx, placed === 1, placed === 0)) {
      placed++;
      sx = cm(sx - 5.2);
    }
    // ---- (c) the dining zone: a long table with stools, tables with shell chairs, a coffee station against the back wall.
    const mid = cm(min(Ss * 0.55, Ss - 4.5));
    const longD = cm(D - 6.5);
    if (roomy && b.item("long_table", mid, longD, TOWARD_BACK, [3.4], { gap: 0.1 })) {
      for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) b.item("stool", cm(mid - 1.2 + k * 0.8), cm(longD + sg * 0.75), TOWARD_BACK, [], { gap: 0.02 });
      b.item("tabletop", mid, longD, TOWARD_BACK, [1], { anywhere: true, y: 1.05 });
      b.item("batten_ceiling", cm(mid - 1.9), cm(longD - 0.5), TOWARD_RIGHT, [3.8, 3.4, cm(hang)], { anywhere: true });
      for (let k = 0; k < 3; k++) {
        b.item("pendant_lamp", cm(mid - 1.0 + k * 1.0), longD, TOWARD_RIGHT, [cm(H - 1.0 - 0.35 * (k % 2))], { anywhere: true });
        b.light({ s: cm(mid - 1.0 + k * 1.0), d: longD, y: cm(H - 1.1 - 0.35 * (k % 2)), kind: "pendant", beam: 80, power: 2.6, reach: 2.4, tone: [1, 0.9, 0.7] });
      }
      b.person({ s: cm(mid - 0.4), d: cm(longD + 0.75), face: TOWARD_FRONT, activity: "sit_stool", role: "customer", sits: 0.76, family: "stool" });
    }
    const shades = ["yellow", "green", "grey"];
    const nDin = max(0, min(5, floor((Ss - 6.0) / 2.3)));
    for (let k = 0; k < nDin; k++) {
      const s = cm(5.0 + ((k + 0.5) * (Ss - 7.0)) / nDin);
      const dd = cm(D - 3.2);
      if (!b.item("low_table", s, dd, TOWARD_BACK, [0.5], { gap: 0.05 })) continue;
      b.item("tabletop", s, dd, TOWARD_BACK, [k % 5], { anywhere: true, y: 0.74 });
      for (let j = 0; j < 3; j++) {
        const ang: Spot[] = [TOWARD_BACK, TOWARD_FRONT, TOWARD_LEFT];
        const f = ang[j] as Spot;
        b.item("shell_chair", cm(s + f.s * 0.78), cm(dd + f.d * 0.78), { s: -f.s, d: -f.d }, [], { gap: 0, mat: shades[(k + j) % 3] as string });
      }
      b.item("pendant_lamp", s, dd, TOWARD_RIGHT, [cm(H - 1.3)], { anywhere: true });
      b.light({ s, d: dd, y: cm(H - 1.4), kind: "pendant", beam: 80, power: 2.6, reach: 2.4, tone: [1, 0.9, 0.7] });
    }
    const coffeeLen = cm(min(4.2, Ss * 0.2));
    const coffeeS = cm(min(Ss - 3.0, mid + 4.2));
    b.item("coffee_station", coffeeS, cm(D - 0.38), TOWARD_FRONT, [coffeeLen], { gap: 0.05 });
    b.light({ s: coffeeS, d: cm(D - 0.9), y: 2.4, kind: "strip", power: 0.8, reach: 1.6, tone: [1, 0.9, 0.7] });
    // ---- (d) the media wall: shelving 4.6 m wide filled with a television, books, vases and plants, lit niches.
    b.item("shelf_wall", cm(max(6.2, mid - 5.2)), cm(D - 0.24), TOWARD_FRONT, [4.6], { gap: 0.05 });
    b.light({ s: cm(max(6.2, mid - 5.2)), d: cm(D - 0.7), y: 1.4, kind: "strip", power: 0.7, reach: 1.8, tone: [1, 0.9, 0.7] });
    // ---- (e) the stair hall: a bench and a plant, and a notice by the foot of the stair.
    b.item("window_bench", cm(Ss + 1.8), cm(D - 0.35), TOWARD_FRONT, [1.8], { gap: 0.05 });
    b.item("plant", cm(Ss + 0.5), cm(D - 0.5), TOWARD_FRONT, [], { gap: 0.05 });
    // ---- free-standing things in the middle of the floor: columns on a grid of 6 m, clad in timber, slat screens between the zones, long planters.
    if (roomy) for (let s = 6; s < Ss - 2; s += 6) for (const dd of D >= 12.5 ? [5.4, 9.6] : []) b.item("column", cm(s), cm(dd), TOWARD_BACK, [cm(H), 1], { gap: 0.2 });
    if (roomy) b.item("slat_screen", cm(Ss * 0.5), 4.5, TOWARD_BACK, [2.6], { gap: 0.2 });
    if (roomy) b.item("planter", cm(Ss * 0.62), 0.55, TOWARD_RIGHT, [2.2], { gap: 0.2 });
    if (roomy && D >= 12.5) b.item("planter", cm(Ss - 3.0), cm(D - 5.0), TOWARD_BACK, [2.4], { gap: 0.2 });
    if (roomy) {
      // Furnished to the edges: more planters along the front, benches along the back wall, a second row of columns' worth of plants.
      b.item("planter", cm(Ss * 0.42), 0.55, TOWARD_RIGHT, [1.8], { gap: 0.2 });
      b.item("planter", cm(Ss * 0.82), 0.55, TOWARD_RIGHT, [2.0], { gap: 0.2 });
      for (let s = 3.2; s < Ss - 1; s += 3.4) if (!b.fits("window_bench", s, cm(D - 0.35), TOWARD_FRONT, [1.8], { gap: 0.05 }) || !b.item("window_bench", s, cm(D - 0.35), TOWARD_FRONT, [1.8], { gap: 0.05 })) continue;
      if (D >= 12.5) for (let s = 5.0; s < Ss - 1; s += 4.6) b.item("planter", cm(s), cm(D * 0.5), TOWARD_RIGHT, [1.6], { gap: 0.9 });
      if (D >= 12.5) for (let s = 4.0; s < Ss - 1; s += 5.2) b.item("plant", cm(s), cm(D * 0.38), TOWARD_BACK, [], { gap: 0.9 });
    }
    if (roomy) b.item("planter", cm(Ss * 0.2), 0.55, TOWARD_RIGHT, [2.0], { gap: 0.2 });
    // ---- the ceiling: downlights in rows elsewhere, vents and sprinkler heads.
    downlights(2.4, Ss - 1.2, 2.0, D - 1.0, 2.4);
    for (let k = 0; k < 5; k++) b.item("vent", cm(3 + k * (Ss - 5) / 4), cm(k % 2 === 0 ? D * 0.35 : D * 0.7), TOWARD_RIGHT, [], { anywhere: true });
    for (let s = 3.5; s < Ss - 1; s += 4.5) for (const dd of [cm(D * 0.3), cm(D * 0.72)]) b.item("sprinkler", cm(s), cm(dd), TOWARD_RIGHT, [], { anywhere: true });
  } else {
    // A small lodging: two armchairs and a low table at the right of the desk, a plant.
    const sx = cm(min(Ss - 3.0, max(4.5, Wm * 0.45)));
    b.item("armchair", cm(sx - 0.9), 2.4, TOWARD_RIGHT, [], { gap: 0.05 });
    b.item("armchair", cm(sx + 0.9), 2.4, TOWARD_LEFT, [], { gap: 0.05 });
    b.item("oval_table", sx, 2.4, TOWARD_BACK, [], { gap: 0.05 });
    b.light({ s: sx, d: 2.4, y: cm(H - 0.5), kind: "tube", beam: 40, power: 1.0, reach: 2.4, tone: [1, 0.96, 0.88] });
    b.person({ s: cm(sx - 0.9), d: 2.4, face: TOWARD_RIGHT, activity: "sit_rest", role: "customer", sits: 0.45, family: "chair" });
    downlights(2.4, Ss - 1.2, 1.5, backD - 1.0, 2.4);
  }

  // ---- what fills the walls and the corners: plants, pictures hung in groups, a clock, an extinguisher.
  const spots: readonly (readonly [number, number])[] = [[0.7, 0.7], [Wm - 0.7, 0.7], [Ss - 1.6, backD - 0.7], [cm(Ss * 0.5 - 3.6), backD - 0.7], [cm(Ss * 0.5 + 3.8), backD - 0.7], [0.7, backD - 0.7], [cm(Ss * 0.35), 3.0]];
  const nPlants = small ? 2 : 4;
  for (let k = 0, put = 0; k < spots.length && put < nPlants; k++) if (b.item("plant", (spots[k] as readonly [number, number])[0], (spots[k] as readonly [number, number])[1], TOWARD_BACK, [], { gap: 0.1 })) put++;
  // Pictures in groups along the back wall between what stands against it, and on the left and right walls where nothing does.
  const against = b.items.filter((i) => ["shelf_wall", "coffee_station"].includes(i.kind) && i.d > backD - 0.8).map((i) => [i.s - (i.p[0] ?? 2) / 2 - 0.5, i.s + (i.p[0] ?? 2) / 2 + 0.5] as const);
  let g = 0;
  for (let s = 1.6; s < Ss - 1.0; s += 3.0) {
    if (against.some(([lo, hi]) => s > lo - 0.5 && s < hi + 0.5)) continue;
    b.hang("back", cm(s) , cm(1.75 + 0.15 * (g % 3)), g++ + id);
  }
  if (!small) {
    const cl = onWall("back", cm(Ss * 0.5 + 1), W, D);
    b.decorate({ kind: "clock", s: cl.s, d: backD, y: min(H - 0.5, 3.2), face: cl.face, w: 0.35, h: 0.35 });
  }
  if (multi) {
    // The corridor: pictures between the doors, an extinguisher by the stair.
    const nearDoor = (s: number): boolean => [...doorsFront, ...doorsBack, sDoor, niche].some((x) => Math.abs(x - s) < 1.6);
    for (let s = Cs0 + 4.2; s < Cs1 - 2; s += 4.4) if (!nearDoor(s)) b.hang("front", cm(s), level + 1.6, 1 + (g++ % 2));
    b.decorate({ kind: "extinguisher", s: cm(Cs1 - 2.2), d: Dc, y: level + 1.3, face: TOWARD_BACK, w: 0.15, h: 0.5 });
    for (let s = Cs0 + 2.4; s < Cs1 - 2; s += 4.4) if (!nearDoor(s)) b.decorate({ kind: "art", s: cm(s), d: Dc + CORRIDOR, y: level + 1.6, face: TOWARD_FRONT, w: 0.6, h: 0.45 });
  }

  // ---- the people of the room: none; the room is the player's.
  const marks = [
    { name: "back", s: cm(max(2.5, Ss * 0.3)), d: cm(backD - 1.6), y: 0 },
    { name: "corridor", s: cm(max(Cs0 + 1.2, min(Cs1 - 1.2, sDoor - 2.5))), d: cm(Dc + CORRIDOR / 2), y: yc },
    { name: "stair", s: cm(multi ? Ss - 0.9 : sDoor), d: cm(multi ? Dc + LANE + 1.0 : Fw - 1.0), y: 0 },
    { name: "lounge", s: loungeMark, d: cm(min(4.8, lobbyBack - 1.2)), y: 0 },
    ...(flightMark === null ? [] : [flightMark]),
    { name: "room", s: X(1.2), d: Y(entry + 0.3), y: roomY },
    ...(closed ? [{ name: "beyond", s: cm(Cs0 + 0.6), d: cm(Dc + CORRIDOR / 2), y: F + 1.0 }] : []),
  ];
  const wallFinish = { mat: "painted", tint: [1.15, 1.1, 1.0] as [number, number, number], skirt: "dark_wood" };
  return b.build({
    name: "lodging",
    legacy: false,
    doorS: site.doorS,
    doorWidth: site.doorWidth,
    doorHead: min(2.05, H - 0.2),
    arrive: arrivalOf(W, site.doorS),
    shell: { front: wallFinish, left: wallFinish, right: wallFinish, back: wallFinish, floor: "marble_tile", ceiling: "painted" },
    mood: { exposure: 2.1, ambient: [1, 0.95, 0.85], ambientK: 0.01, day: 0.75, bounce: 1.55, fill: 0.7 },
    ...(multi ? { cuts: [cm(F - 0.15)] } : {}),
    frontCurtains: !small,
    marks,
  });
}

