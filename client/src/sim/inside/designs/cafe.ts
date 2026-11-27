/**
 * The cafe: the cafe's room, as the owner's reference picture has it, written against the width and depth it is given.
 *
 * A counter down the left wall from about 1.2 m inside the front to about 60 percent of the depth, with a marble top that overhangs its slatted timber front, a return at its far end
 * and the bartender's aisle open at the front; woven bistro stools along it; behind it a back counter with open shelves and the orange espresso machine, a brass rack hung over it, and the wall
 * of blue and white diamond tile. The floor is pale marble tile in a brick bond, the ceiling glossy white with a row of round flush lights down its middle. Down the right wall a row of slatted
 * timber booths (four to six by the depth, two seats a side across a marble table), against navy panelling with a small brass lamp over each. At the back loose round tables with round-backed chairs, a large
 * bright picture and an air-conditioning unit above it. The room is bright and warm.
 *
 * Where the room is narrow the counter stays and the booths give way: under 5.5 m a single row of small two-seat tables along the right wall (and none under 5 m, where the way past the counter would close).
 * The street door's zone and the way in are reserved, and the counter starts further in where the way reaches its side.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { DesignBuilder, FRONT_WALL, cm, onWall, type Design, type Spot } from "../design.js";
import { arrivalOf } from "../convert.js";
import { footOf } from "../kinds.js";

const { floor, max, min } = Math;

export type CafeSite = { readonly id: number; readonly width: number; readonly maxDepth: number; readonly height: number; readonly doorS: number; readonly doorWidth: number };

/** The counter's sections across the room from the left wall: the back counter, the aisle, the marble top, and where the stools stand. */
export const BACK_D = 0.5;
export const AISLE = 1.0;
export const TOP_D = 0.65;
export const COUNTER_S = BACK_D + AISLE + TOP_D / 2;
export const FRONT_EDGE = BACK_D + AISLE + TOP_D;
export const STOOL_S = FRONT_EDGE + 0.3;
export const LANE_FROM = STOOL_S + 0.25;
/** A booth is 1.15 m from the wall and 2.0 m along it, 2.05 m to the next. */
const BOOTH_DEEP = 1.15;
const BOOTH_LONG = 2.0;
const BOOTH_PITCH = 2.05;
const BOOTH_START = 1.6;

const TOWARD_RIGHT: Spot = { s: 1, d: 0 };
const TOWARD_LEFT: Spot = { s: -1, d: 0 };
const TOWARD_BACK: Spot = { s: 0, d: 1 };
const TOWARD_FRONT: Spot = { s: 0, d: -1 };

/** The depth the cafe is made: 1.5 times the width and 4 m (7.5 to 15), and no more than the building has less a metre. */
export function cafeDepth(width: number, maxDepth: number): number {
  return cm(min(maxDepth, max(7.5, min(15, width * 1.5 + 4))));
}

export function cafeDesign(site: CafeSite): Design {
  const W = site.width;
  const D = cafeDepth(W, site.maxDepth);
  const H = site.height;
  const b = new DesignBuilder(W, D, H, site.id, footOf);
  const roll = (salt: number): number => b.roll(salt);

  // ---- what is kept clear.
  const zoneL = site.doorS - site.doorWidth / 2 - 0.55;
  const zoneR = site.doorS + site.doorWidth / 2 + 0.55;
  const way = max(2.5, min(3, D * 0.45));
  b.reserve({ s0: zoneL, s1: zoneR, d0: 0, d1: 2.5 });
  b.reserve({ s0: site.doorS - 0.7, s1: site.doorS + 0.7, d0: 0, d1: way });

  b.slab({ kind: "floor", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: 0, thick: 0, mat: "marble_tile", tint: [1.05, 1.05, 1.03] });
  b.slab({ kind: "ceiling", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: H, thick: 0, mat: "painted", tint: [1.0, 0.97, 0.9] });
  b.surface({ kind: "floor", s0: 0, s1: W, d0: 0, d1: D, y: 0 });
  b.item("floor_joints", 0, 0, TOWARD_RIGHT, [W, FRONT_WALL, D], { anywhere: true });

  // ---- the counter, from 1.2 m in (further where the way in reaches its side) to about 60 percent of the depth.
  const d0 = site.doorS - 0.7 < LANE_FROM ? way + 0.15 : 1.2;
  const dEndWant = max(d0 + 1.5, min(D * 0.6, D - 2));
  let L = cm(min(dEndWant, D - 0.5) - d0);
  const bar = (len: number): boolean => b.fits("cafe_back", BACK_D / 2, cm(d0 + len / 2), TOWARD_RIGHT, [len], { gap: 0, margin: -0.01 }) && b.fits("cafe_counter", COUNTER_S, cm(d0 + len / 2), TOWARD_RIGHT, [len], { gap: 0 });
  while (L >= 1.0 && !bar(L)) L = cm(L - 0.3);
  const hasBar = L >= 1.0;
  if (!hasBar) L = 0;
  const dEnd = cm(d0 + L);
  const dMid = cm((d0 + dEnd) / 2);
  const stools: Spot[] = [];
  if (hasBar) {
    b.item("cafe_back", BACK_D / 2, dMid, TOWARD_RIGHT, [L], { gap: 0, margin: -0.01 });
    b.item("cafe_counter", COUNTER_S, dMid, TOWARD_RIGHT, [L], { gap: 0 });
    // The return at the far end closes the aisle: a low counter across it, with the same marble top.
    b.wall({ s0: BACK_D, d0: dEnd, s1: BACK_D + AISLE, d1: dEnd, thick: 0.1, y0: 0, y1: 0.96, mat: "oak", openings: [] });
    b.item("espresso", 0.3, cm(d0 + L * 0.3), TOWARD_RIGHT, [], { anywhere: true });
    b.item("brass_rack", cm(BACK_D + AISLE * 0.5 + 0.2), dMid, TOWARD_RIGHT, [cm(L * 0.85), 2.15], { anywhere: true });
    // The tile wall behind the counter, from the back counter's top to as high as the shelves reach and a little over.
    const top = min(H - 0.2, 2.9);
    b.decorate({ kind: "tile_wall", s: 0, d: dMid, y: cm((0.95 + top) / 2), face: TOWARD_RIGHT, w: L, h: cm(top - 0.95) });
    const n = max(3, min(8, floor(L / 0.7)));
    for (let i = 0; i < n; i++) {
      const d = cm(d0 + ((i + 0.5) * L) / n);
      const s = cm(STOOL_S + roll(10 + i) * 0.1);
      if (b.item("bistro_stool", s, d, { s: -1, d: 0 }, [], { gap: 0.03 })) stools.push({ s, d });
    }
    const strips = max(2, Math.round(L / 1.3));
    for (let i = 0; i < strips; i++) b.light({ s: 0.4, d: cm(d0 + ((i + 0.5) * L) / strips), y: 1.95, kind: "strip", power: 0.5, reach: 1.5, tone: [1, 0.88, 0.62] });
  }

  // ---- the round flush lights down the middle of the room, 2 m apart.
  const lightS = cm(W * 0.5 + (hasBar ? 0.5 : 0));
  const nLights = max(2, floor((D - 1.6) / 2) + 1);
  for (let i = 0; i < nLights; i++) {
    const d = cm(1.0 + (i * (D - 1.8)) / (nLights - 1));
    b.item("flush_light", lightS, d, TOWARD_RIGHT, [], { anywhere: true });
    b.light({ s: lightS, d, y: cm(H - 0.1), kind: "pendant", beam: 60, power: 3.5, reach: 3.0, tone: [1, 0.93, 0.8] });
  }

  // ---- the booths down the right wall, or small tables where the room is not wide enough for them.
  const booths: number[] = [];
  const tables: Spot[] = [];
  const seatsAt: { s: number; d: number; face: Spot }[] = [];
  const seats: { s: number; d: number; face: Spot; top: number }[] = [];
  let right = W - 0.6;
  let slots = 0;
  if (W >= 5.5) {
    slots = max(2, min(6, floor((D - BOOTH_START - 2.5) / BOOTH_PITCH)));
    for (let i = 0; i < slots; i++) {
      const dc = cm(BOOTH_START + BOOTH_LONG / 2 + i * BOOTH_PITCH);
      if (!b.item("booth", cm(W - BOOTH_DEEP / 2), dc, TOWARD_LEFT, [], { gap: 0.02, margin: -0.01 })) {
        // Where the way in from the door refused a booth, something smaller stands: a plant, and a newspaper rack beside it.
        b.item("plant", cm(W - 0.45), cm(dc - 0.5), TOWARD_LEFT, [], { gap: 0.05 });
        b.item("newspaper_rack", cm(W - 0.3), cm(dc + 0.5), TOWARD_LEFT, [], { gap: 0.05 });
        continue;
      }
      booths.push(dc);
      b.item("tabletop", cm(W - BOOTH_DEEP / 2), dc, TOWARD_LEFT, [i % 5], { anywhere: true, y: 0.74 });
      const pw = onWall("right", dc, W, D);
      b.decorate({ kind: "panel", s: pw.s, d: pw.d, y: min(1.55, H - 1.2), face: pw.face, w: 1.7, h: 0.95 });
      b.decorate({ kind: "wall_lamp", s: pw.s, d: pw.d, y: min(1.6, H - 0.9), face: pw.face, w: 0.12, h: 0.2 });
      if (H >= 3.4) {
        b.decorate({ kind: "frame_art", s: pw.s, d: cm(dc - 0.5), y: min(2.75, H - 0.5), face: pw.face, w: 0.5, h: 0.65 });
        b.decorate({ kind: "frame_art", s: pw.s, d: cm(dc + 0.45), y: min(2.6, H - 0.6), face: pw.face, w: 0.4, h: 0.5 });
      }
      b.light({ s: cm(W - 0.2), d: dc, y: min(1.6, H - 0.9), kind: "lamp", power: 0.3, reach: 1.4, tone: [1, 0.8, 0.5] });
      seats.push({ s: cm(W - 0.55), d: cm(dc - 0.67), face: TOWARD_BACK, top: 0.48 });
      seats.push({ s: cm(W - 0.55), d: cm(dc + 0.67), face: TOWARD_FRONT, top: 0.48 });
    }
    right = W - BOOTH_DEEP - 0.3;
  } else if (W >= 4.95) {
    for (let dt = 2.2; dt <= D - 2.2; dt += 2.2) {
      const s = cm(W - 0.5);
      if (!b.item("square_table", s, cm(dt), TOWARD_LEFT, [0.3], { gap: 0.05, mat: "marble_tile" })) continue;
      tables.push({ s, d: cm(dt) });
      b.item("tabletop", s, cm(dt), TOWARD_LEFT, [dt > 4 ? 1 : 0], { anywhere: true, y: 0.74 });
      for (const sg of [-1, 1]) {
        const d = cm(dt + sg * 0.6);
        const face: Spot = sg < 0 ? TOWARD_BACK : TOWARD_FRONT;
        if (b.item("chair", s, d, face, [], { gap: 0 })) seatsAt.push({ s, d, face });
      }
    }
    right = W - 0.95;
  }

  // ---- loose round tables with round-backed chairs at the back, across the room from the counter's lane to the right wall's edge.
  const boothsEnd = slots > 0 ? BOOTH_START + slots * BOOTH_PITCH : 0;
  const sL = LANE_FROM + 0.45;
  const sR = W >= 5.5 ? W - 0.7 : right;
  const nT = max(0, min(3, floor((sR - sL) / 1.9)));
  const dBack = cm(max(D - 1.75, boothsEnd + 0.9));
  if (nT > 0 && dBack + 0.9 < D && D >= 5) {
    for (let k = 0; k < nT; k++) {
      const s = cm(nT === 1 ? (sL + sR) / 2 : sL + ((k + 0.5) * (sR - sL)) / nT);
      if (!b.item("low_table", s, dBack, TOWARD_BACK, [0.4], { gap: 0.05, mat: "marble_tile" })) continue;
      tables.push({ s, d: dBack });
      b.item("tabletop", s, dBack, TOWARD_BACK, [(k + 3) % 5], { anywhere: true, y: 0.74 });
      for (const sg of [-1, 1]) {
        const d = cm(dBack + sg * 0.66);
        const face: Spot = sg < 0 ? TOWARD_BACK : TOWARD_FRONT;
        if (b.item("round_chair", s, d, face, [], { gap: 0 })) seatsAt.push({ s, d, face });
      }
    }
  }

  // ---- the back wall: the large picture, with the air-conditioning unit over it.
  const pw = min(1.9, W - 2.2);
  if (pw >= 1.0) {
    const at = onWall("back", cm(W * 0.5 + 0.4), W, D);
    const picY = min(1.75, H - 1.9);
    b.decorate({ kind: "picture", s: at.s, d: at.d, y: picY, face: at.face, w: cm(pw), h: cm(pw * 0.62) });
    b.decorate({ kind: "ac_unit", s: at.s, d: at.d, y: min(H - 0.35, picY + pw * 0.31 + 0.45), face: at.face, w: 0.9, h: 0.3 });
  }

  // ---- more of the room: the pastry case and till at the door end of the counter, cups along it, a chalk menu over the back counter, a sideboard at the back, a bench under the front window, plants,
  // newspapers, fans in the ceiling, shelves and pictures on every bare stretch of the long walls.
  if (hasBar) {
    b.item("pastry_case", COUNTER_S, cm(d0 + 0.75), TOWARD_RIGHT, [1.1], { anywhere: true, y: 1.0 });
    for (let k = 0; (k + 1) * 1.2 + 1.8 < L; k++) b.item("tabletop", COUNTER_S, cm(d0 + 1.9 + k * 1.2), TOWARD_RIGHT, [k % 2 === 0 ? 3 : 4], { anywhere: true, y: 1.0 });
    const menu = onWall("left", dMid, W, D);
    b.decorate({ kind: "chalkboard", s: menu.s, d: menu.d, y: min(H - 0.6, 3.15), face: menu.face, w: min(2.6, L * 0.6), h: 0.6, text: "MENU|ESPRESSO  LATTE  TEA|CROISSANT  CAKE" });
  }
  const roomy = D >= 6.5;
  if (roomy) b.item("sideboard", cm(W * 0.5), cm(D - 0.3), TOWARD_FRONT, [], { gap: 0.05 });
  if (roomy) for (let sx = W - 1.4; sx > LANE_FROM; sx -= 1.2) if (b.item("window_bench", cm(sx), 0.45, TOWARD_BACK, [1.6], { gap: 0.05 })) break;
  const plantAt: readonly (readonly [number, number])[] = [[LANE_FROM + 0.2, 0.6], [W - 0.5, 0.6], [W - 0.5, D - 0.5], [LANE_FROM + 0.3, D - 0.5], [cm(W * 0.5 + 1.4), D - 0.5], [LANE_FROM + 0.4, cm(D * 0.55)]];
  let plants = 0;
  for (const [ps, pd] of plantAt) if (roomy && W >= 6.5 && plants < 4 && b.item("plant", cm(ps), cm(pd), TOWARD_BACK, [], { gap: 0.1 })) plants++;
  if (roomy) for (let k = 0; k < 2; k++) b.item("ceiling_fan", cm(lightS - 1.1), cm(D * (0.3 + 0.4 * k)), TOWARD_RIGHT, [], { anywhere: true });
  const wallSpecs = [
    { kind: "chalkboard", w: 1.2, h: 0.8, y: 1.6, text: "COFFEE BEANS|ROASTED THIS WEEK" },
    { kind: "wall_shelf", w: 1.1, h: 0.4, y: 1.5 },
    { kind: "frame_art", w: 0.7, h: 0.9, y: 1.6 },
    { kind: "mirror", w: 0.8, h: 1.0, y: 1.55 },
    { kind: "frame_art", w: 0.5, h: 0.6, y: 1.5 },
  ];
  b.fillWall("left", 1.4, wallSpecs);
  b.fillWall("right", 1.4, wallSpecs);

  // ---- the people: a barista behind the counter, a pair in each of two or three booths, one or two on the stools, one at a back table.
  if (hasBar) b.person({ s: cm(BACK_D + AISLE / 2), d: cm(d0 + L * 0.5), face: TOWARD_RIGHT, activity: "wipe", role: "staff", sits: null, family: "chair" });
  const nStool = stools.length >= 5 ? 2 : stools.length >= 2 ? 1 : 0;
  const used: number[] = [];
  for (let k = 0; k < 8 && used.length < nStool; k++) {
    const i = floor(roll(50 + k) * stools.length);
    if (!used.includes(i)) used.push(i);
  }
  for (const i of used) {
    const st = stools[i] as Spot;
    b.person({ s: st.s, d: st.d, face: TOWARD_LEFT, activity: "sit_stool", role: "customer", sits: 0.76, family: "stool" });
  }
  const pairs = min(booths.length, 2 + (roll(60) < 0.5 ? 1 : 0));
  for (let i = 0, taken = 0; i < booths.length && taken < pairs; i++) {
    if (roll(61 + i) < 0.4 && booths.length - i > pairs - taken) continue;
    taken++;
    for (const k of [2 * i, 2 * i + 1]) {
      const sd = seats[k] as (typeof seats)[number];
      b.person({ s: sd.s, d: sd.d, face: sd.face, activity: "sit_table", role: "customer", sits: sd.top, family: "chair" });
    }
  }
  if (seatsAt.length > 0) {
    const c = seatsAt[floor(roll(70) * seatsAt.length)] as (typeof seatsAt)[number];
    b.person({ s: c.s, d: c.d, face: c.face, activity: "sit_table", role: "customer", sits: 0.46, family: "chair" });
  }
  void tables;

  const white: [number, number, number] = [1.2, 1.15, 1.05];
  const navy: [number, number, number] = [0.05, 0.083, 0.2];
  return b.build({
    name: "cafe",
    legacy: false,
    doorS: site.doorS,
    doorWidth: site.doorWidth,
    doorHead: min(2.05, H - 0.2),
    arrive: arrivalOf(W, site.doorS),
    shell: {
      front: { mat: "painted", tint: white, skirt: "oak" },
      left: { mat: "glazed_tile", tint: [1.2, 1.18, 1.1], skirt: "oak" },
      right: { mat: "painted", tint: white, wainscot: { h: min(2.2, H - 0.9), mat: "painted", tint: navy }, skirt: "dark_wood" },
      back: { mat: "painted", tint: white, skirt: "oak" },
      floor: "marble_tile",
      ceiling: "painted",
    },
    mood: { exposure: 0.9, ambient: [1, 0.93, 0.82], ambientK: 0.03, day: 0.35 },
  });
}
