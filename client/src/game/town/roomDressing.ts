/**
 * What a trade hangs on the walls of its room and stands in its window: a menu board and a clock in a cafe, a pegboard of tools in a
 * hardware store, bottles against a mirror and a lit beer sign in a tavern, a calendar and a licence in an office, a price list over the
 * washers, rods on the wall of a tackle shop; and in the display window the trade's goods on a low backdrop, so that a person across
 * the street can tell what the business is by what shows in the glass. A vacant unit has what the last tenant took down: pale
 * patches where shelving hung and the brackets left on the wall.
 *
 * What the plan causes: the trade (and for a vacant unit the last past tenant's trade), the unit's state, which openings are
 * displays. What is authored: every item, its colours and sizes, which trades get which, and the choice among a trade's two or three
 * kits (a roll from the unit's own number). Everything is lit by the room's baked light (`roomLight.ts`), except the few things that
 * light themselves (a beer sign, a television, a clock's face).
 */
import { withMat } from "./materials.js";
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { pickOf } from "./buildingKit.js";
import { BAKED, fbox, fcyl, shade, wallBox, wallPoint, wallPoly, wallQuad, type Ctx, type WallName } from "./roomKit.js";
import type { Finish, RoomIn } from "./roomShell.js";
import { sillThings, tallThings } from "./roomWindow.js";
import type { Furnishing, Trade } from "../../sim/town/types.js";

const AX = { x: 1, z: 0 };

/** Colours of goods by trade: packaging, authored. */
const GOODS_DEFAULT: readonly Rgb[] = [[0.7, 0.15, 0.1], [0.85, 0.7, 0.15], [0.15, 0.4, 0.2], [0.2, 0.3, 0.6], [0.8, 0.8, 0.75], [0.5, 0.3, 0.15], [0.12, 0.12, 0.13]];
export const GOODS: Partial<Record<Trade, readonly Rgb[]>> = {
  hardware: [[0.85, 0.4, 0.08], [0.8, 0.7, 0.1], [0.12, 0.12, 0.13], [0.5, 0.52, 0.55], [0.15, 0.3, 0.55], [0.7, 0.12, 0.1]],
  grocery: [[0.7, 0.15, 0.1], [0.85, 0.7, 0.15], [0.15, 0.45, 0.2], [0.2, 0.3, 0.6], [0.85, 0.85, 0.8], [0.55, 0.3, 0.12]],
  "convenience store": [[0.8, 0.15, 0.1], [0.9, 0.75, 0.1], [0.15, 0.5, 0.3], [0.2, 0.3, 0.7], [0.9, 0.9, 0.85]],
  "thrift store": [[0.45, 0.3, 0.25], [0.3, 0.35, 0.4], [0.55, 0.5, 0.35], [0.4, 0.2, 0.2], [0.25, 0.3, 0.25], [0.6, 0.55, 0.5]],
  "liquor store": [[0.1, 0.3, 0.12], [0.35, 0.2, 0.08], [0.75, 0.75, 0.7], [0.5, 0.1, 0.1], [0.12, 0.12, 0.3]],
  "bait and tackle": [[0.15, 0.4, 0.2], [0.8, 0.5, 0.1], [0.4, 0.42, 0.45], [0.7, 0.15, 0.1], [0.1, 0.2, 0.4]],
  "marine supply": [[0.1, 0.25, 0.5], [0.85, 0.8, 0.7], [0.75, 0.15, 0.1], [0.3, 0.32, 0.35]],
  bookstore: [[0.45, 0.15, 0.12], [0.15, 0.25, 0.4], [0.55, 0.45, 0.2], [0.2, 0.3, 0.2], [0.3, 0.2, 0.3], [0.7, 0.65, 0.55]],
  "gift shop": [[0.8, 0.4, 0.5], [0.3, 0.55, 0.6], [0.85, 0.75, 0.3], [0.9, 0.9, 0.85], [0.5, 0.35, 0.6]],
  pharmacy: [[0.85, 0.85, 0.85], [0.2, 0.5, 0.7], [0.75, 0.2, 0.2], [0.35, 0.65, 0.35]],
  "auto parts": [[0.8, 0.1, 0.1], [0.12, 0.12, 0.13], [0.85, 0.75, 0.1], [0.2, 0.3, 0.6]],
  bakery: [[0.65, 0.42, 0.2], [0.78, 0.6, 0.35], [0.85, 0.75, 0.55], [0.55, 0.3, 0.15], [0.9, 0.85, 0.8]],
  clothing: [[0.6, 0.2, 0.25], [0.2, 0.3, 0.5], [0.85, 0.8, 0.7], [0.3, 0.45, 0.35], [0.12, 0.12, 0.14]],
  "garden and feed": [[0.2, 0.5, 0.2], [0.55, 0.4, 0.2], [0.8, 0.7, 0.3], [0.5, 0.52, 0.5]],
  "sporting goods": [[0.8, 0.2, 0.1], [0.15, 0.3, 0.6], [0.2, 0.5, 0.25], [0.9, 0.9, 0.85]],
  "fish market": [[0.75, 0.78, 0.8], [0.8, 0.45, 0.35], [0.85, 0.85, 0.82], [0.35, 0.5, 0.6]],
};
export const goodsOf = (trade: Trade | null, seed: number): Rgb => {
  const list = (trade !== null ? GOODS[trade] : undefined) ?? GOODS_DEFAULT;
  return list[Math.floor(hash01(seed, 310) * list.length) % list.length] as Rgb;
};

const CHALK: Rgb = [0.82, 0.84, 0.8];
const WOOD: Rgb = [0.34, 0.22, 0.12];

/** A framed, lettered or coloured board on a wall: a frame, a field and, optionally, rows of "writing" (short bars of a light colour). */
function board(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number, field: Rgb, frame: Rgb, lines: number, ink: Rgb, seed: number): void {
  withMat("painted", () => {
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + h, 0.03, frame);
    wallQuad(c, wall, a - w / 2 + 0.04, a + w / 2 - 0.04, y + 0.04, y + h - 0.04, 0.04, field);
    for (let k = 0; k < lines; k++) {
      const yy = y + h - 0.12 - (k * (h - 0.24)) / Math.max(1, lines);
      const len = (w - 0.3) * (0.45 + hash01(seed + k * 7, 750) * 0.5);
      const x0 = a - w / 2 + 0.12;
      wallQuad(c, wall, x0, x0 + len, yy - 0.03, yy, 0.05, ink);
      // A price at the line's far end.
      if (lines >= 4) wallQuad(c, wall, a + w / 2 - 0.3, a + w / 2 - 0.12, yy - 0.03, yy, 0.05, ink);
    }
  });
}

function clock(c: Ctx, wall: WallName, a: number, y: number, r: number): void {
  withMat("painted", () => {
    const n = 8;
    const rim = (rad: number): ReturnType<typeof wallPoint>[] => Array.from({ length: n }, (_, i) => wallPoint(c, wall, a + Math.cos((i / n) * Math.PI * 2) * rad, y + Math.sin((i / n) * Math.PI * 2) * rad, 0.04));
    const hint = wallPoint(c, wall, a, y, 1);
    const base = wallPoint(c, wall, a, y, 0);
    const face = (rad: number, col: Rgb, off: number): void => {
      const pts = Array.from({ length: n }, (_, i) => wallPoint(c, wall, a + Math.cos((i / n) * Math.PI * 2) * rad, y + Math.sin((i / n) * Math.PI * 2) * rad, off));
      c.out.poly(pts, [hint[0] - base[0], 0, hint[2] - base[2]], col, undefined, { glow: 0.9 });
    };
    void rim;
    face(r, [0.12, 0.1, 0.09], 0.03);
    face(r * 0.82, [0.88, 0.86, 0.8], 0.06);
  });
}

function poster(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number, seed: number): void {
  withMat("cloth", () => {
    const cols: readonly Rgb[] = [[0.7, 0.2, 0.15], [0.15, 0.35, 0.6], [0.85, 0.7, 0.2], [0.2, 0.5, 0.3], [0.8, 0.8, 0.75], [0.4, 0.2, 0.45]];
    const c1 = pickOf(cols, seed, 751);
    const c2 = pickOf(cols, seed + 5, 752);
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + h, 0.03, [0.85, 0.84, 0.8]);
    wallQuad(c, wall, a - w / 2 + 0.03, a + w / 2 - 0.03, y + 0.03, y + h * 0.68, 0.06, c1, BAKED, scaled(c1, 0.75));
    wallQuad(c, wall, a - w / 2 + 0.03, a + w / 2 - 0.03, y + h * 0.72, y + h - 0.03, 0.06, c2);
  });
}

function calendar(c: Ctx, wall: WallName, a: number, y: number): void {
  withMat("cloth", () => {
    wallQuad(c, wall, a - 0.16, a + 0.16, y, y + 0.44, 0.03, [0.86, 0.85, 0.8]);
    wallQuad(c, wall, a - 0.16, a + 0.16, y + 0.32, y + 0.44, 0.06, [0.65, 0.15, 0.12]);
    for (let r = 0; r < 4; r++) wallQuad(c, wall, a - 0.13, a + 0.13, y + 0.04 + r * 0.06, y + 0.065 + r * 0.06, 0.06, [0.35, 0.35, 0.33]);
  });
}

function noticeBoard(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number, seed: number): void {
  withMat("ply", () => {
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + h, 0.03, [0.3, 0.2, 0.1]);
    wallQuad(c, wall, a - w / 2 + 0.03, a + w / 2 - 0.03, y + 0.03, y + h - 0.03, 0.04, [0.55, 0.4, 0.25]);
    const sheets: readonly Rgb[] = [[0.88, 0.88, 0.85], [0.9, 0.85, 0.5], [0.75, 0.85, 0.9], [0.9, 0.7, 0.7]];
    // Sheets pinned on a grid of places (no two overlap), some places left bare, each a little off true.
    const cols = Math.max(1, Math.floor((w - 0.1) / 0.24));
    const rows = Math.max(1, Math.floor((h - 0.1) / 0.28));
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (hash01(seed + r * 7 + k * 13, 753) < 0.35) continue;
        const sx = a - w / 2 + 0.07 + k * ((w - 0.14) / cols) + hash01(seed + k, 754) * 0.04;
        const sy = y + 0.06 + r * ((h - 0.12) / rows) + hash01(seed + r, 755) * 0.04;
        wallQuad(c, wall, sx, sx + 0.14 + hash01(seed + k + r, 756) * 0.04, sy, sy + 0.18 + hash01(seed + k * 3 + r, 757) * 0.05, 0.05, pickOf(sheets, seed + k + r * 5, 758));
      }
    }
  });
}

/** Shelves on a wall: planks with rows of goods in the trade's colours. */
function wallShelves(c: Ctx, wall: WallName, a: number, w: number, y0: number, tiers: number, seed: number): void {
  withMat("wood", () => {
    for (let t = 0; t < tiers; t++) {
      const y = y0 + t * 0.5;
      wallBox(c, wall, a - w / 2, a + w / 2, y, y + 0.03, 0.28, [0.4, 0.28, 0.16]);
      const n = Math.max(3, Math.round(w / 0.17));
      for (let k = 0; k < n; k++) {
        const x0 = a - w / 2 + 0.04 + (k * (w - 0.08)) / n;
        const col = goodsOf(c.trade, seed + t * 31 + k);
        const hh = 0.14 + hash01(seed + t * 7 + k, 759) * 0.18;
        wallQuad(c, wall, x0, x0 + (w / n) * 0.78, y + 0.03, y + 0.03 + hh, 0.16, col, BAKED, scaled(col, 0.8));
      }
    }
  });
}

function pegboard(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number, seed: number): void {
  withMat("ply", () => {
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + h, 0.03, [0.58, 0.46, 0.3]);
    const tools: readonly Rgb[] = [[0.6, 0.6, 0.62], [0.7, 0.15, 0.1], [0.85, 0.65, 0.1], [0.15, 0.15, 0.17], [0.15, 0.3, 0.55], [0.75, 0.5, 0.2]];
    for (let r = 0; r < 3; r++) {
      const n = Math.max(4, Math.round(w / 0.2));
      for (let k = 0; k < n; k++) {
        if (hash01(seed + r * 13 + k, 760) < 0.15) continue;
        const x0 = a - w / 2 + 0.08 + (k * (w - 0.16)) / n;
        const col = pickOf(tools, seed + r * 17 + k, 761);
        const hh = 0.1 + hash01(seed + r * 3 + k, 762) * 0.18;
        wallQuad(c, wall, x0, x0 + 0.05 + hash01(seed + k, 763) * 0.06, y + h - 0.1 - r * (h / 3) - hh, y + h - 0.1 - r * (h / 3), 0.06, col);
      }
    }
  });
}

function neonSign(c: Ctx, wall: WallName, a: number, y: number, w: number, col: Rgb): void {
  withMat("painted", () => {
    wallQuad(c, wall, a - w / 2 - 0.03, a + w / 2 + 0.03, y - 0.03, y + 0.2, 0.03, [0.08, 0.08, 0.09]);
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + 0.17, 0.045, col, c.lit ? (c.whole === true ? 1.8 : 3) : 0.25);
  });
}

/** The two or three kits of wall items a trade picks from (each a list of calls, placed in order along the back wall's free stretches). */
type Item = { w: number; draw: (a: number) => void };
function backWallItems(c: Ctx, seed: number): Item[] {
  const t = c.trade;
  const items: Item[] = [];
  const roll = (k: number): number => hash01(seed, 770 + k);
  const clk = (): Item => ({ w: 0.5, draw: (a) => clock(c, "back", a, 2.35, 0.2) });
  const pst = (k: number): Item => ({ w: 0.7, draw: (a) => poster(c, "back", a, 1.5 + roll(k) * 0.4, 0.5 + roll(k + 1) * 0.2, 0.7 + roll(k + 2) * 0.2, seed + k) });
  switch (t) {
    case "cafe": case "diner": case "restaurant": case "espresso stand": case "pizza and burgers": case "bakery":
      items.push({ w: 2.0, draw: (a) => board(c, "back", a, 1.65, 1.9, 0.95, [0.1, 0.13, 0.1], WOOD, 5, CHALK, seed) });
      items.push(clk(), pst(1));
      break;
    case "tavern":
      items.push({ w: 2.2, draw: (a) => { board(c, "back", a, 1.05, 2.1, 0.12, [0.65, 0.7, 0.72], [0.2, 0.14, 0.1], 0, CHALK, seed); for (let k = 0; k < 14; k++) { const col = pickOf([[0.2, 0.45, 0.2], [0.55, 0.3, 0.1], [0.75, 0.75, 0.7], [0.5, 0.1, 0.1], [0.15, 0.2, 0.4]] as readonly Rgb[], seed + k, 771); const x = a - 1 + k * 0.145; wallQuad(c, "back", x, x + 0.07, 1.17, 1.17 + 0.2 + hash01(seed + k, 772) * 0.1, 0.07, col); } } });
      items.push({ w: 0.9, draw: (a) => neonSign(c, "back", a, 1.95, 0.8, pickOf([[1, 0.2, 0.15], [0.3, 0.6, 1], [1, 0.55, 0.2]] as readonly Rgb[], seed, 773)) });
      items.push({ w: 0.7, draw: (a) => wallQuad(c, "back", a - 0.35, a + 0.35, 1.7, 2.15, 0.04, [0.05, 0.06, 0.08], 0.55) });
      break;
    case "hardware": case "auto parts": case "saw and chain shop": case "marine supply": case "garden and feed":
      items.push({ w: 2.2, draw: (a) => pegboard(c, "back", a, 1.2, 2.1, 1.1, seed) });
      items.push({ w: 1.4, draw: (a) => wallShelves(c, "back", a, 1.3, 0.7, 3, seed) });
      items.push(clk());
      break;
    case "bait and tackle": case "sporting goods":
      items.push({ w: 1.8, draw: (a) => { for (let k = 0; k < 7; k++) { const x = a - 0.8 + k * 0.26; wallQuad(c, "back", x, x + 0.025, 0.5, 2.4 - hash01(seed + k, 774) * 0.3, 0.07, [0.25, 0.2, 0.12]); } } });
      items.push({ w: 1.6, draw: (a) => pegboard(c, "back", a, 1.2, 1.5, 1.0, seed + 3) });
      items.push({ w: 0.9, draw: (a) => { wallQuad(c, "back", a - 0.4, a + 0.4, 1.55, 1.8, 0.05, [0.3, 0.2, 0.12]); wallQuad(c, "back", a - 0.33, a + 0.33, 1.6, 1.74, 0.07, [0.55, 0.62, 0.65]); } });
      break;
    case "grocery": case "convenience store": case "liquor store": case "variety store":
      items.push({ w: 2.2, draw: (a) => wallShelves(c, "back", a, 2.1, 0.6, 3, seed) });
      items.push({ w: 1.6, draw: (a) => board(c, "back", a, 2.0, 1.5, 0.45, [0.75, 0.2, 0.12], [0.2, 0.1, 0.08], 2, [0.95, 0.9, 0.8], seed) });
      items.push(clk());
      break;
    case "laundromat":
      items.push({ w: 1.2, draw: (a) => board(c, "back", a, 1.5, 1.0, 0.7, [0.85, 0.85, 0.8], [0.3, 0.4, 0.5], 5, [0.25, 0.3, 0.35], seed) });
      items.push(clk(), { w: 0.8, draw: (a) => noticeBoard(c, "back", a, 1.4, 0.7, 0.55, seed + 1) });
      break;
    case "hair salon": case "barber": case "tattoo parlor":
      items.push({ w: 2.3, draw: (a) => { wallQuad(c, "back", a - 1.1, a + 1.1, 0.95, 2.1, 0.03, [0.2, 0.2, 0.21]); wallQuad(c, "back", a - 1.05, a + 1.05, 1.0, 2.05, 0.04, [0.58, 0.64, 0.68], BAKED, [0.42, 0.46, 0.5]); } });
      items.push(pst(2), clk());
      break;
    case "clothing": case "thrift store": case "gift shop": case "antiques": case "gallery": case "bookstore": case "jeweler":
      items.push(pst(3), pst(5), clk());
      if (t === "clothing" || t === "thrift store") items.push({ w: 1.1, draw: (a) => curtain(c, a, seed) }, { w: 0.7, draw: (a) => mirror(c, "back", a, 0.5, 0.6, 1.7) });
      items.push({ w: 1.8, draw: (a) => wallShelves(c, "back", a, 1.7, 0.9, 3, seed) });
      break;
    case "dentist": case "medical clinic": case "veterinarian": case "pharmacy":
      items.push(pst(6), { w: 0.9, draw: (a) => board(c, "back", a, 1.6, 0.8, 0.6, [0.9, 0.9, 0.88], [0.4, 0.45, 0.5], 4, [0.3, 0.35, 0.4], seed) }, clk());
      break;
    case "post office":
      items.push({ w: 1.3, draw: (a) => board(c, "back", a, 1.7, 1.2, 0.8, [0.9, 0.9, 0.88], [0.15, 0.2, 0.4], 3, [0.7, 0.15, 0.12], seed) }, { w: 1.0, draw: (a) => wallQuad(c, "back", a - 0.5, a + 0.5, 1.2, 2.2, 0.04, [0.3, 0.3, 0.32]) }, clk());
      break;
    default:
      // Offices and the rest: a licence or two, a calendar, a clock.
      items.push({ w: 0.6, draw: (a) => { wallQuad(c, "back", a - 0.25, a + 0.25, 1.55, 1.95, 0.03, [0.35, 0.28, 0.18]); wallQuad(c, "back", a - 0.21, a + 0.21, 1.59, 1.91, 0.04, [0.88, 0.86, 0.78]); } });
      items.push({ w: 0.5, draw: (a) => calendar(c, "back", a, 1.5) }, clk(), pst(7));
      break;
  }
  return items;
}

/** The back wall's free stretches: between the walls' ends, minus the doorway and what stands in front of it (a jog, a half wall). */
function backSegs(c: Ctx, r: RoomIn, dw: { s: number; w: number }): [number, number][] {
  let segs: [number, number][] = [[c.s0 + 0.25, c.s1 - 0.25]];
  const cut = (b0: number, b1: number): void => {
    const next: [number, number][] = [];
    for (const [a, b] of segs) {
      if (b1 <= a || b0 >= b) next.push([a, b]);
      else {
        if (b0 - a > 0.3) next.push([a, b0]);
        if (b - b1 > 0.3) next.push([b1, b]);
      }
    }
    segs = next;
  };
  cut(dw.s - dw.w - 0.3, dw.s + dw.w + 0.3);
  for (const f of r.interior.furnishings) {
    if (f.kind !== "partition") continue;
    const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
    cut(f.s - ex - 0.1, f.s + ex + 0.1);
  }
  return segs;
}

/** The items spread along the free stretches, in an order of the unit's own. */
function placeBack(c: Ctx, items: Item[], segs: [number, number][], seed: number): void {
  const order = items.map((it, i) => ({ it, k: hash01(seed + i * 11, 775) })).sort((p, q) => p.k - q.k).map((x) => x.it);
  let idx = 0;
  for (const [a, b] of segs) {
    let x = a + (hash01(seed + a * 3, 776) < 0.5 ? 0 : 0.3);
    while (idx < order.length) {
      const it = order[idx] as Item;
      if (x + it.w > b) break;
      withMat("painted", () => it.draw(x + it.w / 2));
      x += it.w + 0.25 + hash01(seed + idx * 3, 777) * 0.3;
      idx++;
    }
  }
}

/** A kitchen's pass-through in the partition: a lit opening in a frame, a shelf with plates on it and a rail of order tickets. */
function passThrough(c: Ctx, a: number, seed: number): void {
  withMat("painted", () => {
    const w = 0.65;
    if (c.whole === true) {
      // The kitchen as seen into from the floor: a warm dim back with a shelf's dark bands and the shapes of someone working, not a sheet of light.
      const g = c.lit ? 0.5 : 0.1;
      wallQuad(c, "back", a - w, a + w, 1.0, 1.75, 0.03, [0.7, 0.55, 0.36], g);
      for (const y of [1.2, 1.45]) wallQuad(c, "back", a - w, a + w, y, y + 0.03, 0.04, [0.25, 0.2, 0.15], g);
      wallQuad(c, "back", a - 0.35, a - 0.12, 1.0, 1.4, 0.04, [0.3, 0.22, 0.16], g);
      wallQuad(c, "back", a + 0.2, a + 0.5, 1.0, 1.3, 0.04, [0.34, 0.28, 0.22], g);
    } else wallQuad(c, "back", a - w, a + w, 1.0, 1.75, 0.03, [1, 0.86, 0.58], c.lit ? 0.95 : 0.15);
    const frame: Rgb = hash01(seed, 790) < 0.5 ? [0.5, 0.5, 0.52] : [0.3, 0.2, 0.12];
    wallQuad(c, "back", a - w - 0.07, a - w, 0.96, 1.8, 0.06, frame);
    wallQuad(c, "back", a + w, a + w + 0.07, 0.96, 1.8, 0.06, frame);
    wallQuad(c, "back", a - w, a + w, 1.75, 1.8, 0.06, frame);
    wallBox(c, "back", a - w - 0.07, a + w + 0.07, 0.94, 0.99, 0.16, frame);
    for (let k = 0; k < 3; k++) {
      if (hash01(seed + k, 791) < 0.25) continue;
      const x = a - w + 0.15 + k * 0.4 + hash01(seed + k, 792) * 0.1;
      wallBox(c, "back", x, x + 0.22, 0.99, 0.99 + 0.04 * (1 + (k % 2)), 0.1, [0.9, 0.9, 0.86]);
    }
    wallBox(c, "back", a - w, a + w, 1.64, 1.67, 0.09, [0.6, 0.6, 0.62]);
    for (let k = 0; k < 4; k++) if (hash01(seed + k * 5, 793) > 0.3) wallQuad(c, "back", a - w + 0.2 + k * 0.28, a - w + 0.27 + k * 0.28, 1.5, 1.64, 0.12, [0.92, 0.92, 0.85]);
  });
}

function exitSign(c: Ctx, a: number): void {
  withMat("painted", () => {
    wallQuad(c, "back", a - 0.19, a + 0.19, 2.22, 2.34, 0.06, [0.08, 0.5, 0.18], c.lit ? 2.2 : 0.2);
  });
}

/** A framed picture hung not quite level: a dark frame, a sky and a darker foot, each polygon turned about its middle by `tilt`. */
function framed(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number, tilt: number, seed: number): void {
  withMat("painted", () => {
    const cs = Math.cos(tilt);
    const sn = Math.sin(tilt);
    const cx = a;
    const cy = y + h / 2;
    const at = (fx: number, fy: number): [number, number] => [cx + fx * cs - fy * sn, cy + fx * sn + fy * cs];
    const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
    const f: Rgb = pickOf([[0.34, 0.22, 0.12], [0.12, 0.1, 0.09], [0.72, 0.66, 0.5], [0.45, 0.45, 0.42]] as readonly Rgb[], seed, 810);
    wallPoly(c, wall, rect(-w / 2, -h / 2, w / 2, h / 2), 0.03, f);
    const sky: Rgb = pickOf([[0.62, 0.7, 0.76], [0.78, 0.72, 0.6], [0.55, 0.6, 0.66]] as readonly Rgb[], seed + 1, 811);
    const ground: Rgb = pickOf([[0.2, 0.32, 0.4], [0.18, 0.34, 0.2], [0.4, 0.28, 0.18], [0.3, 0.3, 0.34]] as readonly Rgb[], seed + 2, 812);
    const m = Math.min(0.04, w * 0.1);
    const split = -h / 2 + m + (h - 2 * m) * (0.3 + hash01(seed, 813) * 0.25);
    wallPoly(c, wall, rect(-w / 2 + m, -h / 2 + m, w / 2 - m, split), 0.06, ground);
    wallPoly(c, wall, rect(-w / 2 + m, split, w / 2 - m, h / 2 - m), 0.06, sky);
  });
}

function coatHooks(c: Ctx, wall: WallName, a: number, seed: number): void {
  withMat("steel", () => {
    wallQuad(c, wall, a - 0.4, a + 0.4, 1.55, 1.63, 0.03, [0.3, 0.2, 0.12]);
    for (let k = 0; k < 4; k++) {
      const x = a - 0.3 + k * 0.2;
      wallQuad(c, wall, x - 0.015, x + 0.015, 1.5, 1.55, 0.06, [0.5, 0.5, 0.52]);
      if (hash01(seed + k, 820) < 0.55) {
        const col = pickOf([[0.2, 0.25, 0.35], [0.45, 0.2, 0.15], [0.3, 0.32, 0.25], [0.7, 0.6, 0.2]] as readonly Rgb[], seed + k, 821);
        wallQuad(c, wall, x - 0.09, x + 0.09, 0.85 + hash01(seed + k, 822) * 0.2, 1.5, 0.09, col);
      }
    }
  });
}

function mirror(c: Ctx, wall: WallName, a: number, y: number, w: number, h: number): void {
  withMat("painted", () => {
    wallQuad(c, wall, a - w / 2, a + w / 2, y, y + h, 0.03, [0.35, 0.3, 0.22]);
    wallQuad(c, wall, a - w / 2 + 0.04, a + w / 2 - 0.04, y + 0.04, y + h - 0.04, 0.06, [0.62, 0.7, 0.74], BAKED, [0.42, 0.48, 0.52]);
  });
}

/**
 * A dartboard as one reads on a wall at arm's length (a room a person stands in, `RoomIn.whole`): a round backing, a ring of black for the numbers, twenty wedges in
 * four rings (double and treble in red and green, the singles cream and black, the colours alternating) and a bull. 45 cm across as a real one is.
 */
function dartBoardWhole(c: Ctx, wall: WallName, a: number, y: number): void {
  const n = 20;
  const rim = 0.225;
  const at = (k: number, r: number): [number, number] => [a + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r];
  const disc = (r: number, sides: number): [number, number][] => Array.from({ length: sides }, (_, i) => [a + Math.cos((i / sides) * Math.PI * 2) * r, y + Math.sin((i / sides) * Math.PI * 2) * r]);
  const cream: Rgb = [0.82, 0.76, 0.58];
  const black: Rgb = [0.06, 0.06, 0.06];
  const red: Rgb = [0.7, 0.12, 0.1];
  const green: Rgb = [0.1, 0.42, 0.2];
  withMat("painted", () => {
    wallPoly(c, wall, disc(rim + 0.035, 16), 0.03, [0.12, 0.08, 0.05]);
    wallPoly(c, wall, disc(rim, 20), 0.06, black);
    // Each ring from `r0` to `r1`, the wedges alternating between two colours (`odd` swaps them).
    const ring = (r0: number, r1: number, one: Rgb, two: Rgb, odd: boolean): void => {
      for (let k = 0; k < n; k++) wallPoly(c, wall, [at(k, r0), at(k + 1, r0), at(k + 1, r1), at(k, r1)], 0.09, (k % 2 === 0) !== odd ? one : two);
    };
    ring(0.172, 0.187, red, green, false);
    ring(0.115, 0.172, black, cream, false);
    ring(0.1, 0.115, red, green, false);
    ring(0.03, 0.1, black, cream, false);
    wallPoly(c, wall, disc(0.03, 10), 0.09, green);
    wallPoly(c, wall, disc(0.013, 8), 0.12, red);
  });
}

function dartBoard(c: Ctx, wall: WallName, a: number, y: number): void {
  if (c.whole === true) return dartBoardWhole(c, wall, a, y);
  withMat("painted", () => {
    const ring = (r: number): [number, number][] => Array.from({ length: 8 }, (_, i) => [a + Math.cos((i / 8) * Math.PI * 2 + 0.39) * r, y + Math.sin((i / 8) * Math.PI * 2 + 0.39) * r]);
    wallPoly(c, wall, ring(0.3), 0.03, [0.08, 0.08, 0.08]);
    wallPoly(c, wall, ring(0.22), 0.06, [0.12, 0.35, 0.18]);
    wallPoly(c, wall, ring(0.12), 0.09, [0.7, 0.14, 0.1]);
    wallPoly(c, wall, ring(0.04), 0.12, [0.1, 0.1, 0.1]);
  });
}

function curtain(c: Ctx, a: number, seed: number): void {
  withMat("cloth", () => {
    const col = pickOf([[0.5, 0.15, 0.2], [0.2, 0.3, 0.45], [0.35, 0.4, 0.25]] as readonly Rgb[], seed, 830);
    wallQuad(c, "back", a - 0.55, a + 0.55, 2.1, 2.14, 0.03, [0.2, 0.2, 0.22]);
    for (let k = 0; k < 6; k++) wallQuad(c, "back", a - 0.5 + k * 0.17, a - 0.5 + (k + 1) * 0.17, 0.12, 2.08, 0.06, scaled(col, k % 2 === 0 ? 1 : 0.78));
  });
}

function framesRow(c: Ctx, wall: WallName, a: number, seed: number): void {
  withMat("painted", () => {
    let x = a - 0.55;
    for (let k = 0; k < 3; k++) {
      const w = 0.25 + hash01(seed + k, 870) * 0.2;
      framed(c, wall, x + w / 2, 1.4 + hash01(seed + k * 3, 871) * 0.3, w, w * (0.8 + hash01(seed + k, 872) * 0.5), (hash01(seed + k, 873) - 0.5) * 0.1, seed + k * 13);
      x += w + 0.1;
    }
  });
}

function television(c: Ctx, wall: WallName, a: number): void {
  withMat("painted", () => {
    wallBox(c, wall, a - 0.5, a + 0.5, 1.7, 2.2, 0.12, [0.06, 0.06, 0.07]);
    if (c.whole === true) {
      // Seen from a few metres, a screen is a dark frame round a dim picture: a sky, a green field with a line across it, and two small figures, none of it brighter than a lamp's shade.
      const glow = c.lit ? 0.45 : 0.04;
      const x0 = a - 0.45, x1 = a + 0.45, y0 = 1.75, y1 = 2.15;
      wallQuad(c, wall, x0, x1, y0, y1, 0.16, [0.05, 0.06, 0.08], glow);
      wallQuad(c, wall, x0, x1, y0 + 0.3, y1, 0.19, [0.22, 0.32, 0.46], glow);
      wallQuad(c, wall, x0, x1, y0, y0 + 0.14, 0.19, [0.12, 0.3, 0.16], glow);
      wallQuad(c, wall, x0, x1, y0 + 0.14, y0 + 0.16, 0.19, [0.55, 0.55, 0.5], glow);
      wallQuad(c, wall, a - 0.22, a - 0.17, y0 + 0.16, y0 + 0.27, 0.19, [0.6, 0.15, 0.12], glow);
      wallQuad(c, wall, a + 0.1, a + 0.15, y0 + 0.16, y0 + 0.27, 0.19, [0.2, 0.25, 0.55], glow);
      // A score along the foot.
      wallQuad(c, wall, x0 + 0.04, x0 + 0.3, y0 + 0.02, y0 + 0.06, 0.22, [0.5, 0.5, 0.45], glow);
      return;
    }
    wallQuad(c, wall, a - 0.45, a + 0.45, 1.75, 2.15, 0.16, [0.2, 0.35, 0.5], c.lit ? 1.4 : 0.1);
  });
}

function mountedFish(c: Ctx, wall: WallName, a: number, seed: number): void {
  withMat("painted", () => {
    wallQuad(c, wall, a - 0.42, a + 0.42, 1.55, 1.95, 0.03, [0.3, 0.2, 0.11]);
    const body: Rgb = pickOf([[0.55, 0.65, 0.7], [0.6, 0.5, 0.35], [0.45, 0.6, 0.5]] as readonly Rgb[], seed, 880);
    wallPoly(c, wall, [[a - 0.34, 1.75], [a - 0.2, 1.86], [a + 0.12, 1.84], [a + 0.24, 1.75], [a + 0.12, 1.66], [a - 0.2, 1.64]], 0.06, body);
    wallPoly(c, wall, [[a + 0.24, 1.75], [a + 0.36, 1.86], [a + 0.36, 1.64]], 0.06, scaled(body, 0.75));
  });
}

function antlers(c: Ctx, wall: WallName, a: number): void {
  withMat("wood", () => {
    wallQuad(c, wall, a - 0.15, a + 0.15, 1.7, 1.9, 0.03, [0.3, 0.2, 0.11]);
    for (const sg of [-1, 1]) {
      wallPoly(c, wall, [[a + sg * 0.08, 1.9], [a + sg * 0.14, 1.9], [a + sg * 0.34, 2.25], [a + sg * 0.28, 2.25]], 0.06, [0.75, 0.68, 0.55]);
      wallPoly(c, wall, [[a + sg * 0.22, 2.06], [a + sg * 0.4, 2.09], [a + sg * 0.4, 2.14], [a + sg * 0.22, 2.11]], 0.06, [0.75, 0.68, 0.55]);
    }
  });
}

function beerSign(c: Ctx, wall: WallName, a: number, seed: number): void {
  withMat("painted", () => {
    const col = pickOf([[0.9, 0.7, 0.1], [0.8, 0.15, 0.1], [0.15, 0.5, 0.25], [0.2, 0.4, 0.8]] as readonly Rgb[], seed, 881);
    wallQuad(c, wall, a - 0.32, a + 0.32, 1.55, 2.0, 0.03, [0.08, 0.08, 0.09]);
    if (c.whole === true) {
      // A backlit sign at arm's length: the coloured field with a cream label on it that has lines of lettering, and a dark rule across it, at a glow that does not blow out.
      const g = c.lit ? 0.85 : 0.15;
      wallQuad(c, wall, a - 0.28, a + 0.28, 1.6, 1.95, 0.06, col, g);
      wallQuad(c, wall, a - 0.28, a + 0.28, 1.6, 1.64, 0.09, scaled(col, 0.5), g);
      wallQuad(c, wall, a - 0.2, a + 0.2, 1.72, 1.86, 0.09, [0.9, 0.87, 0.76], g);
      for (let k = 0; k < 3; k++) wallQuad(c, wall, a - 0.16 + k * 0.02, a + 0.16 - k * 0.04, 1.75 + k * 0.035, 1.775 + k * 0.035, 0.12, [0.15, 0.12, 0.1], g);
      return;
    }
    wallQuad(c, wall, a - 0.28, a + 0.28, 1.6, 1.95, 0.06, col, c.lit ? 2.0 : 0.3);
    wallQuad(c, wall, a - 0.2, a + 0.2, 1.72, 1.82, 0.09, [0.95, 0.93, 0.85], c.lit ? 2.2 : 0.3);
  });
}

function certificates(c: Ctx, wall: WallName, a: number, seed: number): void {
  withMat("cloth", () => {
    for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) {
      const x = a - 0.55 + q * 0.38;
      const y = 1.35 + r * 0.42;
      wallQuad(c, wall, x, x + 0.3, y, y + 0.34, 0.03, [0.3, 0.22, 0.12]);
      wallQuad(c, wall, x + 0.03, x + 0.27, y + 0.03, y + 0.31, 0.06, [0.9, 0.88, 0.8]);
      if (hash01(seed + r * 3 + q, 882) < 0.7) wallQuad(c, wall, x + 0.07, x + 0.23, y + 0.15, y + 0.17, 0.09, [0.3, 0.3, 0.33]);
    }
  });
}

/**
 * The party walls: a run of things from near the front to the partition, one after another with a gap between, chosen by the trade and the
 * unit's own rolls, and left out where a tall piece of furniture stands against the wall or the partition's jog meets it. The menu board
 * hangs over a service counter on its wall.
 */
function sideWalls(c: Ctx, r: RoomIn, seed: number): void {
  withMat("painted", () => {
    const fs = r.interior.furnishings;
    const food = c.trade !== null && ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers"].includes(c.trade);
    const bar = c.type === "bar";
    const office = c.type === "office" || c.type === "lobby";
    const clothes = c.trade !== null && ["clothing", "thrift store"].includes(c.trade);
    const handy = c.trade !== null && ["hardware", "auto parts", "marine supply", "garden and feed", "bait and tackle", "sporting goods", "saw and chain shop"].includes(c.trade);
    (["left", "right"] as WallName[]).forEach((wall, wi) => {
      const wallS = wall === "left" ? c.s0 : c.s1;
      const reach = (f: Furnishing): number => (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
      const near = (f: Furnishing): boolean => Math.abs(f.s - wallS) - reach(f) < 0.7;
      const span = (f: Furnishing): [number, number] => {
        const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
        return [f.d - ez, f.d + ez];
      };
      let end = c.d1 - 0.4;
      for (const f of fs) if (f.kind === "partition" && near(f)) end = Math.min(end, span(f)[0] - 0.3);
      const taken: [number, number][] = [];
      for (const f of fs) if (near(f) && (f.h > 1.25 || f.kind === "partition")) taken.push(span(f));
      // The menu board over the service counter on this wall.
      if (food || bar) {
        const cn = fs.find((f) => f.kind === "counter" && Math.abs(f.dir.z) > 0.7 && near(f) && f.sx >= 1.8);
        if (cn !== undefined && c.ceiling >= 2.9) {
          const w = Math.min(2.2, cn.sx - 0.3);
          board(c, wall, cn.d, 1.78, w, 0.8, [0.1, 0.13, 0.1], WOOD, bar ? 3 : 6, CHALK, seed + wi);
          taken.push([cn.d - w / 2 - 0.1, cn.d + w / 2 + 0.1]);
        }
      }
      const blocked = (a0: number, a1: number): boolean => taken.some(([t0, t1]) => a1 > t0 - 0.15 && a0 < t1 + 0.15);
      let x = 0.9 + hash01(seed + wi, 840) * 0.9;
      let k = 0;
      while (x < end - 0.6 && k < 9) {
        const roll = hash01(seed + wi * 17 + k * 5, 841);
        const cats = food ? [0, 0, 1, 3, 4, 16, 9, 11] : bar ? [5, 6, 10, 13, 13, 12, 11, 3] : office ? [0, 15, 15, 2, 3, 7, 9] : clothes ? [0, 8, 4, 1, 9] : handy ? [14, 14, 2, 3, 1, 14] : [0, 1, 2, 3, 4, 9];
        const kind = cats[Math.min(cats.length - 1, Math.floor(roll * cats.length))] as number;
        const w = [0.6, 0.7, 1.3, 0.5, 0.9, 0.8, 0.7, 0.5, 0.7, 1.3, 1.1, 1.0, 0.7, 0.7, 1.4, 1.3, 1.2][kind] as number;
        const a = x + w / 2;
        if (a + w / 2 > end) break;
        if (!blocked(a - w / 2, a + w / 2)) {
          const s = seed + wi * 31 + k * 7;
          const tilt = (hash01(s, 842) - 0.5) * 0.12;
          switch (kind) {
            case 0: framed(c, wall, a, 1.35 + hash01(s, 843) * 0.4, 0.45 + hash01(s, 844) * 0.25, 0.35 + hash01(s, 845) * 0.25, tilt, s); break;
            case 1: poster(c, wall, a, 1.3 + hash01(s, 846) * 0.3, 0.5 + hash01(s, 847) * 0.2, 0.7 + hash01(s, 848) * 0.2, s); break;
            case 2: noticeBoard(c, wall, a, 1.3, 1.0, 0.7, s); break;
            case 3: clock(c, wall, a, 1.75 + hash01(s, 849) * 0.2, 0.18); break;
            case 4: coatHooks(c, wall, a, s); break;
            case 5: dartBoard(c, wall, a, 1.6); break;
            case 6: neonSign(c, wall, a, 1.9, 0.55, pickOf([[1, 0.2, 0.15], [0.3, 0.6, 1], [1, 0.55, 0.2]] as readonly Rgb[], s, 850)); break;
            case 7: calendar(c, wall, a, 1.45); break;
            case 9: framesRow(c, wall, a, s); break;
            case 10: television(c, wall, a); break;
            case 11: mountedFish(c, wall, a, s); break;
            case 12: antlers(c, wall, a); break;
            case 13: beerSign(c, wall, a, s); break;
            case 14: pegboard(c, wall, a, 1.0, 1.3, 1.2, s); break;
            case 15: certificates(c, wall, a, s); break;
            case 16: board(c, wall, a, 1.3, 1.1, 0.9, [0.1, 0.13, 0.1], WOOD, 5, CHALK, s); break;
            default: mirror(c, wall, a, 0.9, 0.5, 1.2); break;
          }
        }
        x += w + 0.25 + hash01(seed + k, 851) * 0.5;
        k++;
      }
      // A high shelf of stock or crockery along the wall over everything else: the room's upper walls are what the street sees first.
      if (c.ceiling >= 2.9 && hash01(seed + wi, 860) < 0.85) {
        const y0 = Math.min(2.8, c.ceiling - 0.95);
        let xs = 0.8 + hash01(seed + wi, 861) * 0.6;
        while (xs + 0.9 < end) {
          const w = Math.min(1.1 + hash01(seed + xs * 7, 862) * 1.1, end - xs - 0.05);
          if (!blocked(xs, xs + w)) wallShelves(c, wall, xs + w / 2, w, y0, c.ceiling >= 3.6 ? 2 : 1, seed + wi * 53 + Math.floor(xs * 3));
          xs += w + 0.25 + hash01(seed + xs * 3, 863) * 0.5;
        }
      }
    });
  });
}

/** What a vacant unit holds on its walls: pale patches where the last tenant's shelving hung, brackets, and a hole or two. */
function ghosts(c: Ctx, r: RoomIn, dw: { s: number; w: number }): void {
  withMat("painted", () => {
    const last = r.past.length > 0 ? (r.past[r.past.length - 1] as { trade: Trade }).trade : null;
    const seed = c.seed;
    const pale = (k: number): Rgb => [0.62 + k * 0.05, 0.6 + k * 0.05, 0.54 + k * 0.05];
    const n = 2 + Math.floor(hash01(seed, 780) * 3);
    // The patches come one after another along the wall (none over another), the doorway skipped.
    let x = c.s0 + 0.3 + hash01(seed, 782) * 0.5;
    for (let k = 0; k < n; k++) {
      const w = 0.7 + hash01(seed + k, 781) * 0.9;
      if (x < dw.s + dw.w + 0.2 && x + w > dw.s - dw.w - 0.2) x = dw.s + dw.w + 0.25;
      if (x + w > c.s1 - 0.2) break;
      const y = 0.9 + hash01(seed + k * 3, 783) * 0.7;
      wallQuad(c, "back", x, x + w, y, y + 0.35 + hash01(seed + k, 784) * 0.5, 0.03, pale(k % 3));
      // Shelf brackets: three small dark ticks on the patch.
      for (let b = 0; b < 3; b++) wallQuad(c, "back", x + 0.05 + (b * (w - 0.1)) / 2, x + 0.08 + (b * (w - 0.1)) / 2, y - 0.06, y + 0.02, 0.06, [0.25, 0.24, 0.22]);
      x += w + 0.2 + hash01(seed + k, 785) * 0.4;
    }
    void last;
    // A hole in the plaster, and the tape of a poster.
    const hs = c.s0 + 0.6 + hash01(seed, 785) * Math.max(0.1, c.s1 - c.s0 - 1.2);
    if (Math.abs(hs - dw.s) > dw.w + 0.2) wallQuad(c, "back", hs, hs + 0.28, 0.5, 0.74, 0.02, [0.12, 0.11, 0.1]);
  });
}

/** The type of what follows the depth in a furnishing call (`fbox`, `fcyl`). */
type AfterDepth<T extends unknown[]> = T extends [unknown, unknown, unknown, ...infer R] ? R : never;
/** A box and a cylinder in a display window's goods: set from the glass, so their depth `d` is metres behind it as it was, and the glass stands `c.glassIn` deeper in a masonry front than it did. */
const winBox = (c: Ctx, s: number, d: number, ...r: AfterDepth<Parameters<typeof fbox>>): ReturnType<typeof fbox> => fbox(c, s, d + c.glassIn, ...r);
const winCyl = (c: Ctx, s: number, d: number, ...r: AfterDepth<Parameters<typeof fcyl>>): ReturnType<typeof fcyl> => fcyl(c, s, d + c.glassIn, ...r);

/** A display window's goods: a low backdrop a little way in, a riser, and the trade's goods across it. */
function displayWindow(c: Ctx, sa: number, sb: number, sill: number, head: number, seed: number): void {
  withMat("painted", () => {
    const t = c.trade;
    const full = c.detail === "full";
    const back: Rgb = pickOf([[0.5, 0.2, 0.17], [0.22, 0.3, 0.4], [0.72, 0.66, 0.52], [0.2, 0.32, 0.22], [0.15, 0.15, 0.17], [0.6, 0.55, 0.45]] as readonly Rgb[], seed, 340);
    const bd = 0.75 + c.glassIn;
    const bh = Math.min(0.75, (head - sill) * 0.42);
    // The backdrop: a low panel, its foot shaded, with a rail along its top, so the room shows over it.
    const pa = [sa + 0.08, sb - 0.08];
    const p = [wallPointFrame(c, pa[0] as number, bd, sill + 0.15), wallPointFrame(c, pa[1] as number, bd, sill + 0.15), wallPointFrame(c, pa[1] as number, bd, sill + 0.15 + bh), wallPointFrame(c, pa[0] as number, bd, sill + 0.15 + bh)];
    c.out.poly(p, [c.xf.nx, 0, c.xf.nz], [shade(c, scaled(back, 0.8), pa[0] as number, bd, sill + 0.15, 0), shade(c, scaled(back, 0.8), pa[1] as number, bd, sill + 0.15, 0), shade(c, back, pa[1] as number, bd, sill + 0.15 + bh, 0), shade(c, back, pa[0] as number, bd, sill + 0.15 + bh, 0)], undefined, { glow: 1 });
    if (!full) return;
    const mid = (sa + sb) / 2;
    const width = sb - sa - 0.3;
    // A glass too narrow for the goods shows only its backdrop: the riser's ends would stand where a toolbox's or a stack of cans' do.
    if (width < 0.6) return;
    winBox(c, mid, 0.5, sill - 0.02, 0.1 + hash01(seed, 799) * 0.07, width / 2, 0.36, AX, [0.3, 0.22, 0.14], [0.42, 0.32, 0.2]);
    const y0 = sill + 0.12;
    const u = (k: number, n: number): number => sa + 0.15 + ((k + 0.5) * width) / n;
    // A good for each 42 cm of the glass: in a window narrower than 84 cm, one, where two would stand touching (a pot's side against a toolbox's end).
    const n = Math.max(1, Math.floor(width / 0.42));
    const col = (k: number): Rgb => goodsOf(t, seed + k * 3);
    switch (t) {
      case "hardware": case "auto parts": case "saw and chain shop": case "marine supply": case "garden and feed": {
        // Stacked paint cans, a red toolbox, a coil, pots of green for the garden.
        for (let k = 0; k < n; k++) {
          const s = u(k, n);
          const kind = (k + Math.floor(hash01(seed, 790) * 3)) % 3;
          if (kind === 0) { for (let r = 0; r < 3 - (k % 2); r++) for (let q = 0; q <= 2 - r; q++) winCyl(c, s + (q - (2 - r) / 2) * 0.17, 0.5, y0 + r * 0.17, 0.08, 0.16, 6, col(k + r), [0.75, 0.75, 0.72]); }
          else if (kind === 1) { winBox(c, s, 0.5, y0, 0.2, 0.2, 0.1, AX, [0.7, 0.12, 0.08], [0.78, 0.2, 0.12]); winBox(c, s, 0.5, y0 + 0.2, 0.05, 0.1, 0.04, AX, [0.2, 0.2, 0.2], [0.25, 0.25, 0.25]); }
          else { winCyl(c, s, 0.5, y0, 0.1, 0.18, 6, [0.5, 0.25, 0.15], [0.2, 0.12, 0.08]); winCyl(c, s, 0.5, y0 + 0.18, 0.12, 0.28, 5, [0.15, 0.4, 0.14], [0.2, 0.5, 0.18], 0.02); }
        }
        break;
      }
      case "grocery": case "convenience store": case "fish market": case "bakery": case "liquor store": case "variety store": {
        for (let k = 0; k < n; k++) {
          const s = u(k, n);
          const cc = col(k);
          winBox(c, s, 0.5, y0, 0.16, (width / n) * 0.42, 0.14, AX, [0.5, 0.36, 0.2], [0.42, 0.3, 0.16]);
          if (t === "bakery") winBox(c, s, 0.5, y0 + 0.16, 0.12, (width / n) * 0.36, 0.1, AX, cc, scaled(cc, 1.2), BAKED, false);
          else for (let q = 0; q < 3; q++) winCyl(c, s + (q - 1) * 0.1, 0.5, y0 + 0.16, 0.06, 0.1 + hash01(seed + k + q, 791) * 0.08, 6, cc, scaled(cc, 1.15), 0.045);
          if (t === "liquor store" || t === "grocery") winCyl(c, s, 0.62, y0 + 0.16, 0.05, 0.34, 6, pickOf([[0.1, 0.3, 0.12], [0.35, 0.2, 0.08], [0.6, 0.1, 0.1]] as readonly Rgb[], seed + k, 792), [0.7, 0.7, 0.65], 0.03);
        }
        break;
      }
      case "clothing": case "thrift store": {
        const m = Math.max(1, Math.floor(width / 0.8));
        for (let k = 0; k < m; k++) {
          const s = u(k, m);
          const cc = col(k + 7);
          // A mannequin: legs, a torso in the colour of the season, a head.
          winCyl(c, s, 0.5, y0, 0.07, 0.55, 5, [0.7, 0.68, 0.64], [0.7, 0.68, 0.64], 0.05);
          winBox(c, s, 0.5, y0 + 0.55, 0.5, 0.17, 0.09, AX, cc, scaled(cc, 1.1));
          winCyl(c, s, 0.5, y0 + 1.05, 0.06, 0.2, 6, [0.82, 0.8, 0.76], [0.82, 0.8, 0.76], 0.05);
        }
        break;
      }
      case "bookstore": {
        for (let k = 0; k < n * 2; k++) {
          const cc = col(k + 2);
          const s = sa + 0.15 + ((k + 0.5) * width) / (n * 2);
          winBox(c, s, 0.5, y0 + (k % 3) * 0.02, 0.22 + hash01(seed + k, 793) * 0.12, (width / (n * 2)) * 0.4, 0.07, AX, cc, scaled(cc, 1.2), BAKED, false);
        }
        break;
      }
      case "bait and tackle": case "sporting goods": {
        for (let k = 0; k < Math.max(3, Math.floor(width / 0.3)); k++) {
          const s = sa + 0.2 + k * 0.3;
          if (s > sb - 0.1) break;
          withMat("rope", () => c.out.prism(((): [number, number, number] => wallPointFrame(c, s, 0.45, y0))(), wallPointFrame(c, s + 0.12, 0.62, y0 + 1.0 + hash01(seed + k, 794) * 0.3), 0.012, 4, [0.2, 0.17, 0.1]));
        }
        winBox(c, mid - width * 0.28, 0.5, y0, 0.2, 0.2, 0.12, AX, [0.14, 0.4, 0.2], [0.2, 0.5, 0.26]);
        winCyl(c, mid + width * 0.25, 0.5, y0, 0.14, 0.28, 8, [0.8, 0.15, 0.1], [0.9, 0.9, 0.88]);
        break;
      }
      case "pharmacy": {
        for (let k = 0; k < n; k++) for (let r = 0; r < 3 - (k % 2); r++) winBox(c, u(k, n), 0.5, y0 + r * 0.14, 0.13, 0.12 - r * 0.02, 0.07, AX, col(k + r), scaled(col(k + r), 1.15), BAKED, false);
        break;
      }
      case "jeweler": case "gallery": case "gift shop": case "antiques": {
        for (let k = 0; k < n; k++) {
          const s = u(k, n);
          const cc = col(k);
          if (t === "jeweler") { winBox(c, s, 0.5, y0, 0.16 + (k % 3) * 0.06, 0.07, 0.07, AX, [0.07, 0.06, 0.08], [0.1, 0.09, 0.12]); winBox(c, s, 0.5, y0 + 0.2 + (k % 3) * 0.06, 0.03, 0.05, 0.05, AX, [0.9, 0.78, 0.35], [1, 0.9, 0.5]); }
          else if (t === "gallery") {
            // A frame and its canvas, no wider than the window's share of each: in a narrow window two stood in one plane, over each other.
            const half = Math.min(0.17, width / n / 2 - 0.015);
            winBox(c, s, 0.52, y0, 0.45 + (k % 2) * 0.12, half, 0.02, AX, [0.15, 0.12, 0.1], cc);
            winBox(c, s, 0.45, y0 + 0.05, 0.3, Math.max(0.02, half - 0.04), 0.015, AX, cc, scaled(cc, 1.1), BAKED, false);
          }
          else { winCyl(c, s, 0.5, y0, 0.09, 0.2 + hash01(seed + k, 795) * 0.2, 6, cc, scaled(cc, 1.2), 0.06); }
        }
        break;
      }
      default: {
        for (let k = 0; k < n; k++) {
          const hgt = 0.2 + hash01(seed * 5 + k, 341) * 0.45;
          winBox(c, u(k, n), 0.5, y0, hgt, (width / n) * 0.35, 0.12, AX, col(k), scaled(col(k), 1.15), BAKED, false);
        }
      }
    }
  });
}

const wallPointFrame = (c: Ctx, s: number, d: number, y: number): [number, number, number] => [c.xf.ox + c.xf.tx * s - c.xf.nx * d, c.floorY + y, c.xf.oz + c.xf.tz * s - c.xf.nz * d];

/** The dressing of one room: the trade's items on the back wall, a few on the side walls, the display windows' goods, a vacant unit's ghosts. */
export function dressRoom(c: Ctx, r: RoomIn, fin: Finish, dw: { s: number; open: boolean; w: number }): void {
  void fin;
  const full = c.detail === "full";
  const seed = c.seed;
  if (c.vacant) {
    if (full) ghosts(c, r, dw);
    return;
  }
  if (full) {
    const segs = backSegs(c, r, dw);
    const food = c.trade !== null && ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers"].includes(c.trade);
    if (food) {
      // The kitchen's pass-through takes the first stretch wide enough; what is left takes the rest.
      const i = segs.findIndex(([a, b]) => b - a >= 1.9);
      if (i >= 0) {
        const [a, b] = segs[i] as [number, number];
        const mid = a + 0.8 + hash01(seed, 794) * Math.max(0, b - a - 1.6);
        passThrough(c, mid, seed);
        segs.splice(i, 1, ...([[a, mid - 0.85], [mid + 0.85, b]] as [number, number][]).filter(([p, q]) => q - p > 0.3));
      }
    }
    placeBack(c, backWallItems(c, seed), segs, seed);
    // A high shelf of stock or crockery over the whole back wall where the ceiling is high enough, above everything hung below it.
    if (c.ceiling >= 3.3) for (const [a, b] of segs) if (b - a > 0.8 && hash01(seed + a * 5, 864) < 0.85) wallShelves(c, "back", (a + b) / 2, Math.min(b - a, 2.6), Math.min(2.65, c.ceiling - 0.75), 1, seed + Math.floor(a * 7));
    if (c.ceiling >= 2.6 && hash01(seed, 795) < 0.85) exitSign(c, dw.s);
    sideWalls(c, r, seed);
  }
  // The sills' plants, jars, curtains and lights, and the tall things that show over them.
  sillThings(c, r.openings);
  tallThings(c, seed);
  for (const [k, o] of r.openings.entries()) {
    if (o.cover !== "display") continue;
    // A table, a booth or a case the plan put in the window is the display: no riser is laid over it.
    if (r.interior.furnishings.some((f) => f.d - f.sd / 2 < 1.3 && f.s + f.sx / 2 > Math.min(o.s0, o.s1) - 0.1 && f.s - f.sx / 2 < Math.max(o.s0, o.s1) + 0.1)) continue;
    displayWindow(c, Math.min(o.s0, o.s1), Math.max(o.s0, o.s1), o.sill, o.head, seed * 11 + k);
  }
}
