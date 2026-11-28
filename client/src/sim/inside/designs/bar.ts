/**
 * The bar: the tavern's room, as the owner's reference pictures have it, written against the width and depth it is given.
 *
 * A long dark-wood bar down the left wall from near the front to two-thirds of the depth, with a foot rail and a row of round wooden stools; behind it a back
 * bar of shelves full of bottles with two televisions over it. The floor is dark wide planks, the right wall is exposed brick with high-top tables and
 * stools along it and guitars and posters hung high, lower round tables with chairs in the middle toward the back, and one square concrete column where the
 * room is 7 m wide or more. Warm bare bulbs hang on strings in rows the length of the room, brightest over the bar. At the back a plastered archway with a shut
 * door under a sign, a banquette with tables along the wall, and a board with the tavern's name. A bartender stands behind the bar, a few people sit on the stools and at the tables.
 *
 * Where the room is narrow the order along it is kept and the repeats dropped (no high-tops under 5.7 m, no column under 7 m, a shorter bar, fewer tables); the bar
 * starts further in where the street door is near the left wall, and the street door's zone and the way in are reserved so that nothing is put on them.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { FRONT_WALL, DesignBuilder, cm, onWall, type Design, type Spot } from "../design.js";
import { arrivalOf } from "../convert.js";
import { footOf } from "../kinds.js";

const { floor, max, min, round } = Math;

/** What the bar is made from: the unit's own measures in the room's frame (`doorS` from the room's left end), the building's depth less a metre, and its name. */
export type BarSite = {
  readonly id: number;
  readonly width: number;
  readonly maxDepth: number;
  readonly height: number;
  readonly doorS: number;
  readonly doorWidth: number;
  readonly name: string;
};

/** The bar's sections across the room, from the left wall: the back bar's depth, the aisle for the bartender, the counter's top, and where the stools stand. */
export const BACK_D = 0.6;
export const AISLE = 0.95;
export const TOP_D = 0.7;
export const COUNTER_S = BACK_D + AISLE + TOP_D / 2;
export const FRONT_EDGE = BACK_D + AISLE + TOP_D;
export const STOOL_S = FRONT_EDGE + 0.3;
/** Where the room's free floor begins, to the right of the stools. */
export const LANE_FROM = STOOL_S + 0.25;

const TOWARD_RIGHT: Spot = { s: 1, d: 0 };
const TOWARD_LEFT: Spot = { s: -1, d: 0 };
const TOWARD_BACK: Spot = { s: 0, d: 1 };
const TOWARD_FRONT: Spot = { s: 0, d: -1 };
/** Small turns, as unit vectors, for a chair pulled out and a stool pushed back. */
const TURNS: readonly (readonly [number, number])[] = [[1, 0], [0.96, 0.28], [0.96, -0.28], [0.8, 0.6], [0.8, -0.6]];

const turn = (f: Spot, k: number): Spot => {
  const [c, sn] = TURNS[k % TURNS.length] as readonly [number, number];
  return { s: cm(f.s * c - f.d * sn), d: cm(f.s * sn + f.d * c) };
};

/** The depth the bar is made: the room needs about 1.6 times its width and 2.5 m (8 to 15), and no more than the building has less a metre. */
export function barDepth(width: number, maxDepth: number): number {
  return cm(min(maxDepth, max(8, min(15, width * 1.6 + 2.5))));
}

/** The words of a sign on at most two lines, split at the space nearest the middle, in capitals. */
export function lettered(text: string): string {
  const t = text.toUpperCase();
  if (t.length <= 14) return t;
  let at = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (at < 0 || Math.abs(i - t.length / 2) < Math.abs(at - t.length / 2))) at = i;
  return at < 0 ? t : t.slice(0, at) + "|" + t.slice(at + 1);
}

export function barDesign(site: BarSite): Design {
  const W = site.width;
  const D = barDepth(W, site.maxDepth);
  const H = site.height;
  const id = site.id;
  const b = new DesignBuilder(W, D, H, id, footOf);
  const roll = (salt: number): number => b.roll(salt);

  // ---- what is kept clear: the street door's zone, and the way in from it, 1.4 m wide and 3 m long (less in a shallow room).
  const zoneL = site.doorS - site.doorWidth / 2 - 0.55;
  const zoneR = site.doorS + site.doorWidth / 2 + 0.55;
  const way = max(2.5, min(3, D * 0.45));
  b.reserve({ s0: zoneL, s1: zoneR, d0: 0, d1: 2.5 });
  b.reserve({ s0: site.doorS - 0.7, s1: site.doorS + 0.7, d0: 0, d1: way });

  // ---- the bar: from near the front, further in where the way in reaches the bar's side, to about two-thirds of the depth.
  const d0 = site.doorS - 0.7 < LANE_FROM ? way + 0.15 : 1.4;
  const dEndWant = max(d0 + 1.2, min(D * 0.68, D - 1.5));
  // A bar that does not fit as long as wanted is made shorter until it does (and is left out where nothing of it fits).
  let L = cm(min(dEndWant, D - 0.4) - d0);
  const bar = (len: number): boolean => b.fits("back_bar", BACK_D / 2, cm(d0 + len / 2), TOWARD_RIGHT, [len], { gap: 0, margin: -0.01 }) && b.fits("bar_counter", COUNTER_S, cm(d0 + len / 2), TOWARD_RIGHT, [len], { gap: 0 });
  while (L >= 0.9 && !bar(L)) L = cm(L - 0.3);
  const hasBar = L >= 0.9;
  if (!hasBar) L = 0;
  const dEnd = cm(d0 + L);
  const dMid = cm((d0 + dEnd) / 2);
  if (hasBar) {
    b.item("back_bar", BACK_D / 2, dMid, TOWARD_RIGHT, [L], { gap: 0, margin: -0.01 });
    b.item("bar_counter", COUNTER_S, dMid, TOWARD_RIGHT, [L], { gap: 0 });
  }
  // The bartender's aisle is shut at the front end by a half-height partition and open at the back.
  if (hasBar) b.wall({ s0: BACK_D, d0: d0, s1: BACK_D + AISLE, d1: d0, thick: 0.08, y0: 0, y1: 1.05, mat: "dark_wood", boards: 0.12, openings: [] });
  b.slab({ kind: "floor", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: 0, thick: 0, mat: "dark_wood", tint: [0.9, 0.9, 0.9] });
  b.slab({ kind: "ceiling", s0: 0, s1: W, d0: FRONT_WALL, d1: D, y: H, thick: 0, mat: "ceiling_dark", tint: [0.35, 0.35, 0.35] });
  b.surface({ kind: "floor", s0: 0, s1: W, d0: 0, d1: D, y: 0 });

  // Stools along the bar, each a little different: pulled out, turned.
  const stools: Spot[] = [];
  const nStools = hasBar ? max(1, floor(L / 0.62)) : 0;
  for (let i = 0; i < nStools; i++) {
    const d = cm(d0 + ((i + 0.5) * L) / nStools);
    const s = cm(STOOL_S + roll(10 + i) * 0.1);
    if (b.item("stool", s, d, turn(TOWARD_LEFT, i + id), [], { gap: 0.03 })) stools.push({ s, d });
  }

  // Two televisions over the back bar, one if it is short.
  const tvAt = !hasBar ? [] : L >= 2.4 ? [d0 + L * 0.28, d0 + L * 0.72] : [d0 + L * 0.5];
  const tvY = min(2.55, H - 0.8);
  for (const d of tvAt) {
    const w = onWall("left", cm(d), W, D);
    b.decorate({ kind: "television", s: w.s, d: w.d, y: tvY, face: w.face, w: 0.95, h: 0.55 });
    b.light({ s: 0.35, d: cm(d), y: tvY, kind: "glow", power: 0.1, reach: 1.6, tone: [0.55, 0.68, 1] });
    // And a spill of it onto the shelves under the screen.
    b.light({ s: 0.5, d: cm(d), y: 1.75, kind: "glow", power: 0.12, reach: 1.1, tone: [0.5, 0.65, 1] });
  }
  // The back bar's shelves are lit from under their top.
  const strips = hasBar ? max(2, round(L / 1.3)) : 0;
  for (let i = 0; i < strips; i++) b.light({ s: 0.5, d: cm(d0 + ((i + 0.5) * L) / strips), y: 1.95, kind: "strip", power: 0.5, reach: 1.3, tone: [1, 0.78, 0.46] });

  // ---- one square column where the room is wide, hugging the right wall like a pilaster in the line of its tables, with the exit sign on its face toward the front.
  if (W >= 7) {
    const colD = cm(D * 0.44);
    const colS = cm(W - 0.25);
    if (b.item("column", colS, colD, TOWARD_FRONT, [H], { gap: 0.1, margin: -0.03 })) {
      b.decorate({ kind: "sign", s: colS, d: cm(colD - 0.25), y: min(2.4, H - 1.2), face: TOWARD_FRONT, w: 0.5, h: 0.2, text: "EXIT" });
      b.light({ s: colS, d: cm(colD - 0.35), y: min(2.4, H - 1.2), kind: "glow", power: 0.07, reach: 1.0, tone: [1, 0.2, 0.15] });
    }
  }

  // ---- the right wall: high-top tables with stools, where the room has the width for a way beside them.
  const highTops = W >= 5.65;
  const stoolsHigh: Spot[] = [];
  const highTables: number[] = [];
  if (highTops) {
    // A row along the brick wall the whole length, a table every 1.6 m.
    for (let k = 0, dh = 2.4; dh <= D - 1.9; k++, dh += 1.6) {
      if (!b.item("high_table", cm(W - 0.62), cm(dh), TOWARD_LEFT, [0.36], { gap: 0.05 })) continue;
      highTables.push(cm(dh));
      for (const dd of [-0.34, 0.34]) {
        const s = cm(W - 1.25);
        const d = cm(dh + dd);
        if (b.item("stool", s, d, turn(TOWARD_RIGHT, k + (dd > 0 ? 1 : 0)), [], { gap: 0.02 })) stoolsHigh.push({ s, d });
      }
    }
  }
  const sL = LANE_FROM + 0.1;
  const sR = highTops ? W - 1.6 : W - 0.5;
  const lane = sR - sL;

  // ---- a pool table in the back third where the room is 9 m wide or more, with a way round it.
  if (W >= 9 && D >= 11) b.item("pool_table", cm(sL + lane * 0.5), cm(D * 0.74), TOWARD_RIGHT, [], { gap: 0.9 });

  // ---- lower round tables with chairs toward the back: against the right wall's side of the way, so that the way beside them stays wide; one or two across.
  const tables: Spot[] = [];
  const chairs: { s: number; d: number; face: Spot }[] = [];
  if (lane >= 2.6) {
    const across = lane >= 4.8 ? [sL + lane * 0.3, sR - 0.9] : [sR - 0.9];
    // A row down the middle of the floor the whole length, a table every 2.2 m, where the way left beside it is 1.2 m (its own chairs keep clear of the bar's side).
    for (let r = 0, dt = max(2.7, d0 + 1.2); dt <= D - 2.3 && r < (lane >= 4.8 ? 4 : 7); r++, dt += lane >= 4.8 ? 2.8 : 2.2) {
      for (let k = 0; k < across.length; k++) {
        const s = cm(across[k] as number);
        const d = cm(dt + (roll(30 + r * 3 + k) - 0.5) * 0.3);
        if (!b.item("low_table", s, d, TOWARD_BACK, [0.42], { gap: 0.05 })) continue;
        tables.push({ s, d });
        const sides: Spot[] = [TOWARD_BACK, TOWARD_FRONT];
        if (lane >= 3.8 && k === across.length - 1) sides.push(TOWARD_RIGHT);
        // A third chair on the side toward the bar where 1.2 m of way is left beyond it.
        if (s - sL >= 2.1) sides.push(TOWARD_LEFT);
        for (let j = 0; j < sides.length; j++) {
          const f = sides[j] as Spot;
          const out = 0.66 + roll(40 + r * 7 + k * 3 + j) * 0.1;
          const cs = cm(s + f.s * out);
          const cd = cm(d + f.d * out);
          // A chair faces the table: its front looks the way back to it.
          const face = turn({ s: -f.s, d: -f.d }, r + k + j);
          if (b.item("chair", cs, cd, face, [], { gap: 0 })) chairs.push({ s: cs, d: cd, face });
        }
      }
    }
  }

  // ---- the back: a banquette with tables along the wall, the archway with its sign, the name board.
  const arch = cm(max(LANE_FROM + 0.8, min(W - 1.25, W * 0.78)));
  b.item("archway", arch, cm(D - 0.13), TOWARD_FRONT, [1.1], { gap: 0 });
  const archFace = onWall("back", arch, W, D);
  b.decorate({ kind: "sign", s: archFace.s, d: archFace.d, y: min(2.8, H - 0.9), face: archFace.face, w: 1.7, h: 0.2, text: "RESTROOMS" });
  const bx0 = LANE_FROM + 0.3;
  const bx1 = arch - 0.95;
  const bLen = cm(bx1 - bx0);
  const seated: { s: number; d: number; face: Spot }[] = [];
  if (bLen >= 1.4) {
    b.item("banquette", cm((bx0 + bx1) / 2), cm(D - 0.33), TOWARD_FRONT, [bLen], { gap: 0 });
    const nT = max(1, floor(bLen / 1.55));
    for (let i = 0; i < nT; i++) {
      const s = cm(bx0 + ((i + 0.5) * bLen) / nT);
      if (!b.item("square_table", s, cm(D - 1.08), TOWARD_FRONT, [0.38], { gap: 0 })) continue;
      tables.push({ s, d: cm(D - 1.08) });
      const cs = cm(s);
      const cd = cm(D - 1.08 - 0.38 - 0.27);
      if (b.item("chair", cs, cd, turn(TOWARD_BACK, i + 1), [], { gap: 0 })) chairs.push({ s: cs, d: cd, face: TOWARD_BACK });
      seated.push({ s, d: cm(D - 0.36), face: TOWARD_FRONT });
    }
  }
  const nameLo = max(0.7, LANE_FROM - 0.4);
  const nameHi = arch - 0.9;
  if (nameHi - nameLo >= 1.2) {
    const text = lettered(site.name);
    const lines = text.split("|");
    // The letters are as large as the room's stretch of wall allows up to 4.5 cm a pixel (a letter 31 cm high), and the board is as wide as its words with a margin.
    const cols = max(...lines.map((l) => l.length * 6 - 1));
    const px = min(0.045, (min(nameHi - nameLo, 3.6) - 0.5) / cols);
    const w = cm(cols * px + 0.5);
    const h = cm((lines.length * 7 + (lines.length - 1) * 2) * px + 0.3);
    const wb = onWall("back", cm((nameLo + nameHi) / 2), W, D);
    b.decorate({ kind: "board", s: wb.s, d: wb.d, y: min(2.65, H - 0.9), face: wb.face, w, h, text });
  }

  // ---- the right wall's hangings: guitars and posters, alternate, spread along it.
  const slots = max(2, min(5, floor((D - 2.2) / 1.6)));
  const order = ["guitar", "poster", "guitar", "poster", "guitar"];
  for (let i = 0; i < slots; i++) {
    const along = cm(1.5 + ((i + 0.5) * (D - 3.0)) / slots);
    const w = onWall("right", along, W, D);
    const kind = order[i] as string;
    if (kind === "guitar") b.decorate({ kind, s: w.s, d: w.d, y: min(2.75, H - 0.8), face: w.face, w: 0.38, h: 1.0 });
    else b.decorate({ kind, s: w.s, d: w.d, y: min(2.1, H - 1.3), face: w.face, w: 0.62, h: 0.9 });
  }

  // ---- the bulbs, on wires the length of the room, about 0.8 m apart along a row and a little off each other's height: one row over the bar and the others spread over the rest (four in a room 7 m wide).
  const nRows = max(2, min(6, round(W / 1.75)));
  const rows = [cm(COUNTER_S + 0.1)];
  for (let k = 1; k < nRows; k++) rows.push(cm(sL + 0.4 + ((k - 1) * (W - 0.9 - (sL + 0.4))) / max(1, nRows - 2)));
  for (let k = 0; k < rows.length; k++) {
    const s = rows[k] as number;
    const from = 0.9 + roll(70 + k) * 0.3;
    const len = cm(D - 0.7 - from);
    const n = max(2, floor(len / 0.8) + 1);
    const high: number[] = [];
    for (let i = 0; i < n; i++) high.push(cm(H - 0.4 - roll(80 + k * 40 + i) * 0.4));
    b.item("bulb_string", s, from, TOWARD_BACK, [len, n, ...high], { anywhere: true });
    for (let i = 0; i < n; i++) {
      b.light({ s, d: cm(from + (i * len) / (n - 1)), y: high[i] as number, kind: "bulb", power: k === 0 ? 0.2 : 0.12, reach: 1.7, tone: [1, 0.62, 0.28] });
    }
  }

  // ---- what stands on the tables and the bar.
  for (let i = 0; i < highTables.length; i++) b.item("tabletop", cm(W - 0.62), highTables[i] as number, TOWARD_LEFT, [i % 3], { anywhere: true, y: 1.05 });
  for (let i = 0; i < tables.length; i++) b.item("tabletop", (tables[i] as Spot).s, (tables[i] as Spot).d, TOWARD_BACK, [(i + 1) % 4], { anywhere: true, y: 0.74 });
  if (hasBar) for (let k = 0; k * 1.3 + 0.5 < L; k++) b.item("tabletop", COUNTER_S + 0.05, cm(d0 + 0.5 + k * 1.3), TOWARD_RIGHT, [k % 5 === 2 ? 2 : k % 2 === 0 ? 1 : 3], { anywhere: true, y: 1.07 });

  // ---- the ceiling: beams across the room, two metres and a half apart.
  for (let d = 1.6; d < D - 0.6; d += 2.4) b.item("beam", cm(W / 2), cm(d), TOWARD_BACK, [cm(W - 0.1)], { anywhere: true });

  // ---- more of the room: a jukebox by the bar's end, kegs and crates by the archway, a dartboard, boards, signs, shelves, mirrors and coat hooks on every bare stretch of the long walls.
  if (hasBar && dEnd + 1.5 < D - 1.2) b.item("jukebox", 0.32, cm(dEnd + 0.9), TOWARD_RIGHT, [], { gap: 0.05 });
  if (W >= 5.7) b.item("keg_stack", cm(W - 0.45), cm(D - 0.45), TOWARD_LEFT, [], { gap: 0.05 });
  b.item("crate_stack", cm(min(W - 1.6, arch + 1.3)), cm(D - 0.4), TOWARD_FRONT, [], { gap: 0.05 });
  const dartAt = onWall("right", cm(D * 0.58), W, D);
  b.decorate({ kind: "dartboard", s: dartAt.s, d: dartAt.d, y: 1.7, face: dartAt.face, w: 1.0, h: 0.6 });
  const neon: readonly string[] = ["SALT ALE", "FOG LAGER", "OPEN", "KELP STOUT"];
  const specs = [
    { kind: "chalkboard", w: 1.3, h: 0.9, y: 1.6, text: "TODAY|FISH AND CHIPS|CLAM CHOWDER|HOUSE ALE" },
    { kind: "neon_sign", w: 1.0, h: 0.4, y: 1.7, text: neon[id % 4] as string },
    { kind: "wall_shelf", w: 1.0, h: 0.4, y: 1.5 },
    { kind: "mirror", w: 0.7, h: 1.0, y: 1.55 },
    { kind: "coat_hooks", w: 0.9, h: 0.5, y: 1.6 },
    { kind: "neon_sign", w: 1.0, h: 0.4, y: 1.7, text: neon[(id + 1) % 4] as string },
    { kind: "poster", w: 0.62, h: 0.9, y: 1.55 },
  ];
  // The left wall is the one by the door: its neon sits further down the wall, after the board, the shelf and the mirror, and is two thirds the size.
  const leftSpecs = [
    specs[0] as (typeof specs)[number],
    specs[2] as (typeof specs)[number],
    specs[3] as (typeof specs)[number],
    { kind: "neon_sign", w: 0.67, h: 0.27, y: 1.7, text: neon[id % 4] as string },
    specs[4] as (typeof specs)[number],
    { kind: "neon_sign", w: 0.67, h: 0.27, y: 1.7, text: neon[(id + 1) % 4] as string },
    specs[6] as (typeof specs)[number],
  ];
  b.fillWall("left", 1.4, leftSpecs);
  b.fillWall("right", 1.4, specs);
  // Higher up: neon over the back bar, bunting down the right wall.
  if (hasBar && H >= 3.6) for (let k = 0; k < 2; k++) {
    const w = onWall("left", cm(d0 + L * (0.28 + 0.44 * k)), W, D);
    b.decorate({ kind: "neon_sign", s: w.s, d: w.d, y: min(3.2, H - 0.6), face: w.face, w: 1.2, h: 0.4, text: neon[(id + 2 + k) % 4] as string });
  }
  if (H >= 3.8) {
    const bw = onWall("right", cm(D / 2), W, D);
    b.decorate({ kind: "bunting", s: bw.s, d: bw.d, y: min(3.5, H - 0.5), face: bw.face, w: cm(D - 2.4), h: 0.3 });
  }

  // ---- the people: the bar is busy at night, eight to twelve in a room 7 by 14 m: a bartender behind the bar, four or so on its stools, some at the low tables, two or three at the high-tops, one on the banquette.
  if (hasBar) b.person({ s: cm(BACK_D + AISLE / 2), d: cm(d0 + L * 0.45), face: TOWARD_RIGHT, activity: "wipe", role: "staff", sits: null, family: "chair" });
  const taken = min(4, max(1, round(stools.length * 0.35)));
  const used: number[] = [];
  for (let k = 0; k < stools.length * 3 && used.length < min(taken, stools.length); k++) {
    const i = floor(roll(50 + k) * stools.length);
    if (!used.includes(i)) used.push(i);
  }
  for (const i of used) {
    const st = stools[i] as Spot;
    b.person({ s: st.s, d: st.d, face: TOWARD_LEFT, activity: "sit_stool", role: "customer", sits: 0.76, family: "stool" });
  }
  // The low tables: two to a table where it has the chairs, about every other table.
  let atTables = 0;
  for (let i = 0; i < chairs.length && atTables < 5; i++) {
    if (roll(100 + i) >= 0.42) continue;
    const c = chairs[i] as (typeof chairs)[number];
    b.person({ s: c.s, d: c.d, face: c.face, activity: i % 2 === 0 ? "sit_table" : "sit_rest", role: "customer", sits: 0.46, family: "chair" });
    atTables++;
  }
  if (seated.length > 0 && roll(61) < 0.8) {
    const c = seated[floor(roll(62) * seated.length)] as (typeof seated)[number];
    b.person({ s: c.s, d: c.d, face: c.face, activity: "sit_rest", role: "customer", sits: 0.46, family: "chair" });
  }
  let atHigh = 0;
  for (let i = 0; i < stoolsHigh.length && atHigh < 3; i++) {
    if (roll(120 + i) >= 0.4) continue;
    const st = stoolsHigh[i] as Spot;
    b.person({ s: st.s, d: st.d, face: TOWARD_RIGHT, activity: "sit_stool", role: "customer", sits: 0.76, family: "stool" });
    atHigh++;
  }

  return b.build({
    name: "bar",
    legacy: false,
    doorS: site.doorS,
    doorWidth: site.doorWidth,
    doorHead: min(2.05, H - 0.2),
    arrive: arrivalOf(W, site.doorS),
    shell: {
      front: { mat: "plaster_dark", tint: [0.6, 0.6, 0.6], wainscot: { h: 1.1, mat: "dark_wood", tint: [0.6, 0.6, 0.6] }, skirt: "dark_wood" },
      left: { mat: "dark_wood", tint: [0.45, 0.45, 0.45], boards: 0.14, skirt: "dark_wood" },
      right: { mat: "brick", tint: [0.7, 0.7, 0.7], skirt: "dark_wood" },
      back: { mat: "plaster_dark", tint: [0.6, 0.6, 0.6], wainscot: { h: 1.1, mat: "dark_wood", tint: [0.6, 0.6, 0.6] }, skirt: "dark_wood" },
      floor: "dark_wood",
      ceiling: "ceiling_dark",
    },
    mood: { exposure: 0.38, ambient: [1, 0.75, 0.5], ambientK: 0.006, day: 0.08 },
  });
}
