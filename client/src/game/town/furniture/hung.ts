/**
 * What hangs on a wall or from the ceiling in the designed rooms: a television with a dim picture, a guitar, a poster, a lettered sign and a board with a name, and bare
 * bulbs on a wire. A decoration faces along `f` (into the room) and its `r` is the viewer's right, so its words read from left to right; it is `y` metres up to its centre, and
 * stands out from the wall by its own few centimetres (a thing laid on a wall is never closer than 3 cm to what is under it).
 *
 * The words are the town's stroke font (`signFont.ts`, the one that letters a street-name blade): one run of lit pixels a quad.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { GLYPH_H, textPixels, textRuns } from "../signFont.js";
import { tintOf, type Geo, type Local } from "./kit.js";

/** A text on a plane at forward distance `f`, its lines (split at "|") centred on `r0` with the top of the first at `top`, the pixel `px` metres square, in `mat` tinted `tint` and glowing when `glow` is given. */
function lettering(L: Local, text: string, r0: number, top: number, px: number, f: number, mat: string, tint: Rgb, glow?: number): void {
  const lines = text.split("|");
  const gap = px * 2;
  lines.forEach((line, k) => {
    const left = r0 - (textPixels(line) * px) / 2;
    const y = top - k * (GLYPH_H * px + gap);
    for (const run of textRuns(line)) {
      const look = glow === undefined ? { tint } : { tint, glow };
      L.poly([[f, left + run.c0 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r0 * px], [f, left + run.c0 * px, y - run.r0 * px]], [1, 0, 0], mat, look);
    }
  });
}

/** The pixel size a text of `lines` lines (the longest `cols` pixels wide) takes to fit `w` by `h` metres, not more than `max`. */
function pixelFor(text: string, w: number, h: number, max: number): number {
  const lines = text.split("|");
  const cols = Math.max(...lines.map(textPixels));
  const rows = lines.length * GLYPH_H + (lines.length - 1) * 2;
  return Math.min(max, w / (cols + 2), h / (rows + 2));
}

/** A television hung on a wall: a dark bezel 5 cm deep round a dim picture, with a stripe of its ticker. */
export function television(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const hw = dc.w / 2;
  const hh = dc.h / 2;
  const y0 = dc.y - hh;
  const y1 = dc.y + hh;
  const bez = 0.025;
  L.box(0.0, 0.05, -hw, hw, y0, y1, "steel", { tint: [0.1, 0.1, 0.1] }, false);
  // The four sides of the bezel, standing 5 cm from the wall, the picture sunk in them.
  L.box(0.0, 0.05, -hw, hw, y1 - bez, y1, "steel", { tint: [0.12, 0.12, 0.12] });
  L.box(0.0, 0.05, -hw, hw, y0, y0 + bez, "steel", { tint: [0.12, 0.12, 0.12] });
  L.box(0.0, 0.05, -hw, -hw + bez, y0, y1, "steel", { tint: [0.12, 0.12, 0.12] });
  L.box(0.0, 0.05, hw - bez, hw, y0, y1, "steel", { tint: [0.12, 0.12, 0.12] });
  const pic = 0.035;
  const warm = hash01(dc.id + g.seed, 41) < 0.5;
  const top: Rgb = warm ? [0.2, 0.17, 0.1] : [0.1, 0.15, 0.22];
  const low: Rgb = warm ? [0.1, 0.07, 0.04] : [0.05, 0.08, 0.12];
  const mid = (y0 + y1) / 2;
  L.poly([[pic, -hw + bez, mid], [pic, hw - bez, mid], [pic, hw - bez, y1 - bez], [pic, -hw + bez, y1 - bez]], [1, 0, 0], "painted", { glow: 1, tint: top });
  L.poly([[pic, -hw + bez, y0 + bez], [pic, hw - bez, y0 + bez], [pic, hw - bez, mid], [pic, -hw + bez, mid]], [1, 0, 0], "painted", { glow: 1, tint: low });
  L.poly([[pic + 0.002, -hw + bez, y0 + bez], [pic + 0.002, hw - bez, y0 + bez], [pic + 0.002, hw - bez, y0 + bez + dc.h * 0.14], [pic + 0.002, -hw + bez, y0 + bez + dc.h * 0.14]], [1, 0, 0], "painted", { glow: 1, tint: [0.22, 0.05, 0.04] });
}

/** A guitar hung by its neck on the wall: two round bouts, a neck and a head, a dark sound hole, each guitar its own wood. */
export function guitar(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const top = dc.y + dc.h / 2;
  const woods = ["oak", "dark_wood", "cloth", "oak"] as const;
  const wood = woods[Math.floor(hash01(dc.id * 13 + g.seed, 42) * woods.length)] as string;
  const look = { tint: tintOf(dc.id + g.seed, 43, 0.15) };
  const lower = 0.17;
  const upper = 0.13;
  const yLower = top - dc.h + lower + 0.02;
  const yUpper = yLower + lower + upper * 0.55;
  L.disc(0, yLower, lower, 0.03, 0.1, 6, wood, look);
  L.disc(0, yUpper, upper, 0.03, 0.1, 6, wood, look);
  // The neck, a long board from the upper bout to the head, and the head.
  const neckTop = top - 0.12;
  L.box(0.03, 0.065, -0.022, 0.022, yUpper, neckTop, "dark_wood", look);
  L.box(0.03, 0.07, -0.035, 0.035, neckTop, top, "dark_wood", look);
  // The sound hole, on the lower bout: a dark disc just proud of the face.
  L.disc(0, yLower + 0.02, 0.045, 0.1, 0.103, 5, "dark_wood", { tint: [0.35, 0.35, 0.35] });
}

/** Invented bills for the posters: words in the town's own font, and the paper and ink each is printed in. */
const BILLS: readonly { readonly text: string; readonly paper: Rgb; readonly ink: Rgb; readonly band: Rgb }[] = [
  { text: "LIVE|SALT SPRUCE", paper: [1.1, 0.95, 0.7], ink: [0.12, 0.08, 0.06], band: [0.6, 0.2, 0.14] },
  { text: "KELP KINGS", paper: [0.35, 0.6, 0.62], ink: [1.8, 1.8, 1.6], band: [0.9, 0.7, 0.2] },
  { text: "OPEN MIC", paper: [0.9, 0.5, 0.35], ink: [0.1, 0.07, 0.06], band: [0.2, 0.3, 0.4] },
  { text: "QUIZ NIGHT", paper: [0.75, 0.8, 0.6], ink: [0.1, 0.1, 0.07], band: [0.5, 0.25, 0.3] },
];

/** A poster: a sheet of paper in a colour with a band across it, a block that stands for a picture, and words. It is 2 cm proud of the wall. */
export function poster(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const bill = BILLS[Math.floor(hash01(dc.id * 7 + g.seed, 44) * BILLS.length)] as (typeof BILLS)[number];
  const hw = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  // A slight tilt is a corner a few millimetres lower: the sheet's top edge.
  const lean = (hash01(dc.id + g.seed, 45) - 0.5) * 0.03;
  L.poly([[0.03, -hw, y0 + lean], [0.03, hw, y0 - lean], [0.03, hw, y1 - lean], [0.03, -hw, y1 + lean]], [1, 0, 0], "paper", { tint: bill.paper });
  L.poly([[0.045, -hw * 0.82, y0 + dc.h * 0.36], [0.045, hw * 0.82, y0 + dc.h * 0.36], [0.045, hw * 0.82, y1 - dc.h * 0.12], [0.045, -hw * 0.82, y1 - dc.h * 0.12]], [1, 0, 0], "painted", { tint: bill.band });
  const px = pixelFor(bill.text, dc.w * 0.92, dc.h * 0.3, 0.02);
  lettering(L, bill.text, 0, y0 + dc.h * 0.3, px, 0.06, "painted", bill.ink);
}

/**
 * A sign: a dark plate with its words across it. An exit sign's letters are its own light (red), any other's are painted cream and lit by the room. `h` is the plate's height;
 * the pixel is the largest that fits.
 */
export function sign(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const text = dc.text ?? "";
  const exit = text === "EXIT";
  const px = pixelFor(text, dc.w, dc.h, 0.05);
  const w = Math.min(dc.w, textPixels(text.split("|")[0] as string) * px + 0.16);
  const hw = w / 2;
  const y0 = dc.y - dc.h / 2;
  L.box(0.0, 0.04, -hw, hw, y0, y0 + dc.h, "painted", { tint: [0.12, 0.12, 0.12] });
  const rows = text.split("|").length * GLYPH_H * px;
  const top = dc.y + rows / 2;
  if (exit) lettering(L, text, 0, top, px, 0.045, "painted", [1, 0.12, 0.08], 1.6);
  else lettering(L, text, 0, top, px, 0.045, "painted", [0.9, 0.82, 0.62]);
}

/** A board with a name on it: dark timber, a pale border, the name in capitals in lines, in brass-coloured paint. */
export function board(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const text = dc.text ?? "";
  const hw = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0.0, 0.04, -hw, hw, y0, y1, "dark_wood", { tint: tintOf(dc.id + g.seed, 46, 0.08) });
  L.box(0.04, 0.06, -hw + 0.04, hw - 0.04, y0 + 0.04, y1 - 0.04, "dark_wood", { tint: [1.5, 1.5, 1.5] }, false);
  const px = pixelFor(text, dc.w - 0.3, dc.h - 0.24, 0.07);
  const rows = text.split("|").length * GLYPH_H * px + (text.split("|").length - 1) * px * 2;
  lettering(L, text, 0, dc.y + rows / 2, px, 0.075, "painted", [1.6, 1.2, 0.5]);
}

/**
 * Bare bulbs on a wire along the item's facing, from its place: `p0` long, `p1` bulbs, hung from the ceiling hooks every 3 m with the wire sagging a little between them. A bulb is
 * a small globe of its own warm light, over a dark socket.
 */
export function bulbString(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 4;
  const n = Math.max(2, Math.round(it.p[1] ?? 4));
  // The wire runs at `wire`, hooked at the ceiling at each end and every few metres; each bulb hangs a hand's length under it, a few centimetres off its neighbour's height.
  const wire = g.ceiling - 0.28;
  const at = (i: number): number => (i * len) / (n - 1);
  L.poly([[0, 0, g.ceiling - 0.1], [0, 0, wire], [0, 0.01, wire], [0, 0.01, g.ceiling - 0.1]], [1, 0, 0], "steel", { tint: [0.15, 0.15, 0.15] });
  L.poly([[len, 0, g.ceiling - 0.1], [len, 0, wire], [len, 0.01, wire], [len, 0.01, g.ceiling - 0.1]], [1, 0, 0], "steel", { tint: [0.15, 0.15, 0.15] });
  for (let i = 0; i + 1 < n; i++) L.poly([[at(i), 0, wire], [at(i + 1), 0, wire], [at(i + 1), 0, wire + 0.014], [at(i), 0, wire + 0.014]], [0, 1, 0], "steel", { tint: [0.15, 0.15, 0.15] });
  for (let i = 0; i < n; i++) {
    const f = at(i);
    const y = g.ceiling - 0.5 + (hash01(it.id * 53 + i + g.seed, 47) - 0.5) * 0.05;
    // The drop from the wire (a thin sheet) and the globe: two four-sided cones of the bulb's own light, over a dark cap.
    L.poly([[f, 0, y + 0.07], [f, 0.008, y + 0.07], [f, 0.008, wire], [f, 0, wire]], [1, 0, 0], "steel", { tint: [0.1, 0.1, 0.1] });
    L.frustum(f, 0, y + 0.03, y + 0.07, 0.014, 0.014, 4, "steel", { tint: [0.12, 0.1, 0.08] }, false, false);
    L.frustum(f, 0, y - 0.01, y + 0.03, 0.04, 0.014, 4, "paper", { glow: 2, tint: [1, 0.78, 0.45] }, false, false);
    L.frustum(f, 0, y - 0.05, y - 0.01, 0.012, 0.04, 4, "paper", { glow: 2, tint: [1, 0.78, 0.45] }, false, false);
  }
}
