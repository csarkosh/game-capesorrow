/**
 * What fills a room's walls, ceiling and surfaces so that it is not bare: chalk boards with their words, neon signs of invented names, a dartboard, small shelves with their objects, a mirror, a rail of coat hooks,
 * bunting; a jukebox, kegs and crates, a newspaper rack, a pastry case, a sideboard, a bench under a window; a beam and a ceiling fan; and the few small things that stand on a table top or a counter (glasses, a candle, a menu
 * stand, cups and saucers, a tip jar, a till). Each is cheap, and varies by a hash.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { GLYPH_H, textPixels, textRuns } from "../signFont.js";
import { tintOf, type Geo, type Local } from "./kit.js";

/** A line of text on a plane `f` out from the wall, its middle at `r0`, its top at `top`, a pixel `px` square. */
function words(L: Local, s: string, r0: number, top: number, px: number, f: number, look: { tint: Rgb; glow?: number }): void {
  const lines = s.split("|");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] as string;
    const left = r0 - (textPixels(line) * px) / 2;
    const y = top - k * (GLYPH_H * px + px * 2);
    for (const run of textRuns(line)) L.poly([[f, left + run.c0 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r0 * px], [f, left + run.c0 * px, y - run.r0 * px]], [1, 0, 0], "painted", look);
  }
}
const fit = (s: string, w: number, h: number, max: number): number => {
  const lines = s.split("|");
  const cols = Math.max(...lines.map(textPixels));
  return Math.min(max, w / (cols + 2), h / (lines.length * GLYPH_H + (lines.length - 1) * 2 + 2));
};

/** A chalk board in a timber frame, written on in white (`text` in lines split at `|`, or the specials), with a line of chalk under the heading. */
export function chalkboard(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const text = dc.text ?? "TODAY|SOUP AND BREAD|CATCH OF THE DAY|PIE";
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  L.box(0, 0.035, -w, w, y0, y0 + dc.h, "dark_wood", { tint: [0.9, 0.9, 0.9] }, false);
  L.poly([[0.037, -w + 0.04, y0 + 0.04], [0.037, w - 0.04, y0 + 0.04], [0.037, w - 0.04, y0 + dc.h - 0.04], [0.037, -w + 0.04, y0 + dc.h - 0.04]], [1, 0, 0], "painted", { tint: [0.1, 0.13, 0.11] });
  const px = fit(text, dc.w - 0.2, dc.h - 0.2, 0.03);
  words(L, text, 0, dc.y + (text.split("|").length * (GLYPH_H * px + px * 2)) / 2 - px, px, 0.04, { tint: [1.5, 1.5, 1.4] });
}

/** A neon sign: a dark plate with its words in glowing tube, in red, blue or amber by the item's id. */
export function neonSign(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const text = dc.text ?? "OPEN";
  const cols: Rgb[] = [[1.0, 0.15, 0.1], [0.2, 0.5, 1.0], [1.0, 0.6, 0.15]];
  const c = cols[Math.floor(hash01(dc.id + g.seed, 91) * 3)] as Rgb;
  const w = dc.w / 2;
  L.box(0, 0.03, -w, w, dc.y - dc.h / 2, dc.y + dc.h / 2, "painted", { tint: [0.1, 0.1, 0.1] }, false);
  const px = fit(text, dc.w - 0.12, dc.h - 0.12, 0.035);
  words(L, text, 0, dc.y + (text.split("|").length * (GLYPH_H * px + px * 2)) / 2 - px, px, 0.04, { tint: c, glow: 2.4 });
}

/** A dartboard on a round backing with its rings of black, green and red, and a small score board beside it. */
export function dartboard(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  L.disc(0, dc.y, 0.3, 0, 0.04, 12, "dark_wood", { tint: [0.5, 0.5, 0.5] });
  const rings: [number, Rgb][] = [[0.23, [0.1, 0.1, 0.1]], [0.16, [0.7, 0.1, 0.08]], [0.1, [0.15, 0.4, 0.2]], [0.05, [0.7, 0.1, 0.08]], [0.02, [0.9, 0.85, 0.7]]];
  rings.forEach(([r, c], k) => {
    const ring = Array.from({ length: 12 }, (_, i): [number, number, number] => [0.042 + k * 0.001, Math.cos((i / 12) * Math.PI * 2) * r, dc.y + Math.sin((i / 12) * Math.PI * 2) * r]);
    L.poly(ring, [1, 0, 0], "painted", { tint: [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6] });
  });
  L.box(0, 0.03, 0.42, 0.82, dc.y - 0.2, dc.y + 0.2, "dark_wood", { tint: [0.6, 0.6, 0.6] }, false);
  L.poly([[0.032, 0.44, dc.y - 0.18], [0.032, 0.8, dc.y - 0.18], [0.032, 0.8, dc.y + 0.18], [0.032, 0.44, dc.y + 0.18]], [1, 0, 0], "painted", { tint: [0.1, 0.13, 0.11] });
  words(L, "301", 0.62, dc.y + 0.1, 0.02, 0.034, { tint: [1.5, 1.5, 1.4] });
}

/** A small shelf with a few things on it: cups, a pot plant, a stack of books, a bottle; `w` along the wall. */
export function wallShelf(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  L.box(0, 0.18, -w, w, dc.y - 0.02, dc.y + 0.02, "dark_wood", { tint: [1.0, 1.0, 1.0] });
  for (const r of [-w + 0.05, w - 0.05]) L.box(0, 0.12, r - 0.01, r + 0.01, dc.y - 0.12, dc.y - 0.02, "dark_wood", undefined, true, false);
  const n = Math.max(2, Math.floor(dc.w / 0.28));
  for (let k = 0; k < n; k++) {
    const r = -w + 0.15 + (k * (dc.w - 0.3)) / Math.max(1, n - 1);
    const kind = Math.floor(hash01(dc.id * 7 + k + g.seed, 92) * 4);
    if (kind === 0) L.frustum(0.09, r, dc.y + 0.02, dc.y + 0.1, 0.04, 0.035, 6, "painted", { tint: [1.4, 1.3, 1.1] }, false);
    else if (kind === 1) L.frustum(0.09, r, dc.y + 0.02, dc.y + 0.14, 0.045, 0.06, 6, "painted", { tint: [1.1, 0.6, 0.4] }, false);
    else if (kind === 2) L.box(0.04, 0.14, r - 0.07, r + 0.07, dc.y + 0.02, dc.y + 0.13, "cloth", { tint: [0.4, 1.2, 1.4] });
    else L.frustum(0.09, r, dc.y + 0.02, dc.y + 0.25, 0.03, 0.02, 5, "glass", { tint: [1.2, 1.8, 1.2] }, false);
  }
}

/** A mirror in a dark frame: a glass that has gone dim, with a pale diagonal where the light catches it. */
export function mirror(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.04, -w, w, y0, y1, "dark_wood", { tint: [0.7, 0.7, 0.7] }, false);
  L.poly([[0.042, -w + 0.04, y0 + 0.04], [0.042, w - 0.04, y0 + 0.04], [0.042, w - 0.04, y1 - 0.04], [0.042, -w + 0.04, y1 - 0.04]], [1, 0, 0], "glass", { tint: [0.2, 0.22, 0.22] });
  L.poly([[0.044, -w * 0.5, y0 + 0.04], [0.044, -w * 0.2, y0 + 0.04], [0.044, w * 0.4, y1 - 0.04], [0.044, w * 0.1, y1 - 0.04]], [1, 0, 0], "glass", { tint: [0.5, 0.52, 0.5] });
}

/** A rail of timber with coat hooks and a coat or two hung from them. */
export function coatHooks(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  L.box(0, 0.03, -w, w, dc.y - 0.04, dc.y + 0.04, "dark_wood", { tint: [1.0, 1.0, 1.0] });
  const n = Math.max(3, Math.floor(dc.w / 0.2));
  for (let k = 0; k < n; k++) {
    const r = -w + 0.1 + (k * (dc.w - 0.2)) / (n - 1);
    L.box(0.03, 0.1, r - 0.012, r + 0.012, dc.y - 0.02, dc.y, "brass", undefined, true, false);
    if (hash01(dc.id * 5 + k + g.seed, 93) < 0.4) {
      const c = 0.3 + 0.5 * hash01(dc.id + k, 94);
      L.box(0.04, 0.12, r - 0.1, r + 0.1, dc.y - 0.75, dc.y - 0.04, "cloth", { tint: [c * 1.2, c * 0.9, c * 0.7] });
    }
  }
}

/** Bunting: a string along the wall at `y` with a flag every 20 cm, a triangle of pale cloth in four colours. */
export function bunting(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const cols: Rgb[] = [[0.9, 0.3, 0.2], [0.95, 0.8, 0.3], [0.3, 0.55, 0.8], [0.9, 0.9, 0.85]];
  L.poly([[0.06, -w, dc.y], [0.06, w, dc.y - 0.1], [0.06, w, dc.y - 0.09], [0.06, -w, dc.y + 0.01]], [1, 0, 0], "steel", { tint: [0.15, 0.15, 0.15] });
  const n = Math.floor(dc.w / 0.22);
  for (let k = 0; k < n; k++) {
    const r = -w + 0.11 + k * 0.22;
    const y = dc.y - ((r + w) / dc.w) * 0.1;
    const c = cols[k % 4] as Rgb;
    L.poly([[0.06, r - 0.08, y], [0.06, r + 0.08, y - 0.01], [0.06, r, y - 0.2]], [1, 0, 0], "cloth", { tint: [c[0] * 2, c[1] * 5, c[2] * 6] });
  }
}

/** A jukebox: a dark timber body with a rounded top, a lit panel of amber and a row of buttons, on a plinth. It faces the room. */
export function jukebox(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.3, 0.3, -0.42, 0.42, 0, 1.3, "dark_wood", { tint: [0.9, 0.7, 0.6] });
  L.frustum(0, 0, 1.3, 1.5, 0.3, 0.14, 8, "dark_wood", { tint: [0.9, 0.7, 0.6] }, false, true);
  L.poly([[0.302, -0.34, 0.75], [0.302, 0.34, 0.75], [0.302, 0.34, 1.3], [0.302, -0.34, 1.3]], [1, 0, 0], "paper", { glow: 1.5, tint: [1, 0.6, 0.2] });
  for (let k = 0; k < 5; k++) L.poly([[0.304, -0.3 + k * 0.13, 0.55], [0.304, -0.21 + k * 0.13, 0.55], [0.304, -0.21 + k * 0.13, 0.65], [0.304, -0.3 + k * 0.13, 0.65]], [1, 0, 0], "painted", { glow: 1.2, tint: [0.2 + 0.3 * (k % 2), 0.8, 0.3] });
  L.box(-0.3, 0.3, -0.42, 0.42, 0, 0.1, "steel", { tint: [0.1, 0.1, 0.1] }, true, false);
}

/** Kegs stacked: two upright and one on top, in steel with bands. */
export function kegStack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const r of [-0.2, 0.2]) L.frustum(0, r, 0, 0.5, 0.2, 0.2, 8, "steel", { tint: [1.5, 1.5, 1.5] });
  L.frustum(0, 0, 0.5, 1.0, 0.2, 0.2, 8, "steel", { tint: [1.4, 1.4, 1.5] });
  for (const y of [0.1, 0.4]) L.frustum(0, -0.2, y, y + 0.03, 0.205, 0.205, 8, "steel", { tint: [0.4, 0.4, 0.4] }, false, false);
}

/** Crates stacked, three high, timber slatted, the top one a little turned. */
export function crateStack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (let k = 0; k < 3; k++) {
    const t = tintOf(it.id + k + g.seed, 95, 0.15);
    const off = k === 2 ? 0.05 : 0;
    L.box(-0.28 + off, 0.28 + off, -0.38, 0.38, k * 0.33, k * 0.33 + 0.31, "oak", { tint: [0.8 * t[0], 0.7 * t[1], 0.6 * t[2]] });
    L.poly([[0.285 + off, -0.34, k * 0.33 + 0.12], [0.285 + off, 0.34, k * 0.33 + 0.12], [0.285 + off, 0.34, k * 0.33 + 0.16], [0.285 + off, -0.34, k * 0.33 + 0.16]], [1, 0, 0], "dark_wood", { tint: [0.4, 0.4, 0.4] });
  }
}

/** A rack of newspapers: a steel frame on legs with three papers on it. */
export function newspaperRack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const r of [-0.25, 0.25]) L.box(-0.1, -0.07, r - 0.01, r + 0.01, 0, 1.2, "steel", { tint: [0.3, 0.3, 0.3] }, true, false);
  for (let k = 0; k < 3; k++) {
    const y = 0.5 + k * 0.22;
    L.poly([[-0.08, -0.22, y], [0.1, -0.22, y - 0.05], [0.1, 0.22, y - 0.05], [-0.08, 0.22, y]], [1, 0, 1], "paper", { tint: [0.95 - 0.1 * k, 0.92, 0.85] });
    L.poly([[0.1, -0.22, y - 0.05], [0.1, 0.22, y - 0.05], [0.1, 0.22, y - 0.12], [0.1, -0.22, y - 0.12]], [1, 0, 0], "painted", { tint: [0.3, 0.3, 0.35 + 0.2 * k] });
  }
}

/** A glass pastry case on the counter, `p0` of it long: a timber base, a glass box with two shelves of pastries (small domes in browns and pinks), and a till beside it. `p1` is the counter's top. */
export function pastryCase(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 1.1;
  const h = len / 2;
  L.box(-0.24, 0.24, -h, h, 0, 0.08, "dark_wood", { tint: [0.8, 0.8, 0.8] });
  for (const y of [0.1, 0.32]) {
    L.box(-0.22, 0.22, -h + 0.04, h - 0.04, y, y + 0.015, "glass", { tint: [1.2, 1.4, 1.3] });
    const n = Math.floor(len / 0.2);
    for (let k = 0; k < n; k++) {
      const c = hash01(it.id * 3 + k + y * 10 + g.seed, 96);
      L.frustum((c - 0.5) * 0.2, -h + 0.14 + k * 0.2, y + 0.015, y + 0.07, 0.05, 0.03, 5, "painted", { tint: c < 0.5 ? [1.2, 0.8, 0.45] : [1.4, 0.8, 0.85] }, false);
    }
  }
  L.box(-0.24, 0.24, -h, h, 0.5, 0.52, "dark_wood", { tint: [0.8, 0.8, 0.8] });
  for (const r of [-h, h - 0.02]) L.box(-0.24, 0.24, r, r + 0.02, 0.08, 0.5, "glass", { tint: [1.3, 1.5, 1.4] });
  L.poly([[0.24, -h, 0.1], [0.24, h, 0.1], [0.24, h, 0.5], [0.24, -h, 0.5]], [1, 0, 0], "glass", { tint: [1.0, 1.2, 1.1], k: 0.7 });
  L.box(-0.15, 0.15, h + 0.12, h + 0.5, 0, 0.2, "steel", { tint: [0.15, 0.15, 0.15] });
  L.poly([[0.16, h + 0.16, 0.12], [0.16, h + 0.46, 0.12], [0.16, h + 0.46, 0.18], [0.16, h + 0.16, 0.18]], [1, 0, 0], "painted", { glow: 1.0, tint: [0.2, 0.7, 0.4] });
}

/** A small sideboard with a water jug and glasses, a tray of cutlery and a stack of plates, facing the room. */
export function sideboard(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.22, 0.22, -0.6, 0.6, 0.08, 0.86, "oak", { tint: [0.9, 0.7, 0.55] });
  L.box(-0.22, 0.22, -0.6, 0.6, 0, 0.08, "dark_wood", { tint: [0.5, 0.5, 0.5] }, true, false);
  L.poly([[0.222, -0.55, 0.12], [0.222, -0.02, 0.12], [0.222, -0.02, 0.8], [0.222, -0.55, 0.8]], [1, 0, 0], "oak", { tint: [0.75, 0.6, 0.5] });
  L.poly([[0.222, 0.02, 0.12], [0.222, 0.55, 0.12], [0.222, 0.55, 0.8], [0.222, 0.02, 0.8]], [1, 0, 0], "oak", { tint: [0.75, 0.6, 0.5] });
  L.frustum(0, -0.4, 0.86, 1.08, 0.07, 0.05, 8, "glass", { tint: [1.3, 1.6, 1.5] }, false, false);
  for (let k = 0; k < 3; k++) L.frustum(0.05, -0.15 + k * 0.1, 0.86, 0.96, 0.03, 0.035, 6, "glass", { tint: [1.4, 1.6, 1.5] }, false);
  L.box(-0.1, 0.1, 0.2, 0.5, 0.86, 0.89, "steel", { tint: [1.3, 1.3, 1.3] });
  L.frustum(0, 0.4, 0.89, 0.97, 0.1, 0.1, 8, "painted", { tint: [1.5, 1.5, 1.5] }, false);
}

/** A bench under a window: a timber seat with two navy cushions and a thin back. `p0` its length. */
export function windowBench(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 1.6;
  const h = len / 2;
  L.box(-0.25, 0.25, -h, h, 0, 0.4, "oak", { tint: [1.2, 0.85, 0.6] });
  const n = Math.max(1, Math.round(len / 0.8));
  for (let k = 0; k < n; k++) L.box(-0.22, 0.22, -h + (k * len) / n + 0.03, -h + ((k + 1) * len) / n - 0.03, 0.4, 0.48, "cloth", { tint: [0.1, 0.4, 1.9] });
  L.box(-0.27, -0.23, -h, h, 0.4, 0.9, "oak", { tint: [1.2, 0.85, 0.6] });
}

/** A ceiling beam across the room at the ceiling: a timber 14 cm wide and 25 cm deep, `p0` long, along the item's `r`. */
export function beam(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 4;
  const t = tintOf(it.id + g.seed, 97, 0.08);
  L.box(-0.07, 0.07, -len / 2, len / 2, g.ceiling - 0.25, g.ceiling, "dark_wood", { tint: [0.5 * t[0], 0.5 * t[1], 0.5 * t[2]] }, true, false);
}

/** A ceiling fan: a stem, a hub and four blades turned a little different ways, in pale timber. */
export function ceilingFan(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = g.ceiling - 0.35;
  L.box(-0.015, 0.015, -0.015, 0.015, y, g.ceiling, "steel", { tint: [0.4, 0.4, 0.4] }, true, false);
  L.frustum(0, 0, y - 0.1, y, 0.1, 0.07, 8, "steel", { tint: [0.4, 0.4, 0.4] }, true, false);
  const turn = hash01(it.id + g.seed, 98) * 0.5;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + turn;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const wd = 0.07;
    L.poly([[ca * 0.1 - sa * wd, sa * 0.1 + ca * wd, y - 0.04], [ca * 0.65 - sa * wd, sa * 0.65 + ca * wd, y - 0.04], [ca * 0.65 + sa * wd, sa * 0.65 - ca * wd, y - 0.04], [ca * 0.1 + sa * wd, sa * 0.1 - ca * wd, y - 0.04]], [0, 0, -1], "oak", { tint: [0.9, 0.7, 0.5] });
  }
}

/** What stands on a table top or a counter (the item's floor is its top): `p0` 0 a glass, a candle and a menu stand; 1 a glass, a napkin holder and salt and pepper; 2 a tip jar and a till; 3 cups on saucers and a plate; 4 a vase of flowers. */
export function tabletop(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const k = Math.floor(it.p[0] ?? 0);
  const j = (n: number): number => (hash01(it.id * 13 + n + g.seed, 99) - 0.5) * 0.2;
  const glass = { tint: [1.4, 1.6, 1.5] as Rgb };
  if (k === 0) {
    L.frustum(j(1), j(2) - 0.12, 0, 0.12, 0.032, 0.038, 6, "glass", glass, false);
    L.frustum(j(3), j(4) + 0.1, 0, 0.07, 0.03, 0.03, 6, "painted", { tint: [1.6, 1.5, 1.2] }, false);
    L.poly([[j(3), j(4) + 0.1, 0.07], [j(3) + 0.012, j(4) + 0.1, 0.1], [j(3) - 0.012, j(4) + 0.1, 0.1]], [0, 1, 0], "paper", { glow: 2.5, tint: [1, 0.7, 0.3] });
    L.box(j(5) - 0.02, j(5) + 0.02, 0.1, 0.18, 0, 0.12, "painted", { tint: [1.3, 1.2, 1.0] }, true, false);
  } else if (k === 1) {
    L.frustum(j(1), j(2) - 0.1, 0, 0.12, 0.032, 0.038, 6, "glass", glass, false);
    L.box(-0.05, 0.05, 0.05, 0.14, 0, 0.1, "steel", { tint: [1.3, 1.3, 1.3] });
    L.frustum(j(3), j(4) + 0.18, 0, 0.07, 0.015, 0.012, 5, "glass", glass, false);
    L.frustum(j(5), j(6) + 0.22, 0, 0.07, 0.015, 0.012, 5, "painted", { tint: [0.4, 0.4, 0.4] }, false);
  } else if (k === 2) {
    L.frustum(j(1), j(2) - 0.15, 0, 0.18, 0.07, 0.07, 8, "glass", { tint: [1.5, 1.7, 1.6] }, false);
    L.frustum(j(1), j(2) - 0.15, 0.18, 0.2, 0.07, 0.07, 8, "steel", { tint: [1.2, 1.2, 1.2] }, false, true);
    L.box(-0.15, 0.15, 0.1, 0.45, 0, 0.18, "steel", { tint: [0.15, 0.15, 0.17] });
    L.poly([[0.151, 0.14, 0.1], [0.151, 0.41, 0.1], [0.151, 0.41, 0.16], [0.151, 0.14, 0.16]], [1, 0, 0], "painted", { glow: 1.0, tint: [0.2, 0.7, 0.4] });
  } else if (k === 3) {
    for (const r of [-0.18, 0.1]) {
      L.frustum(0, r, 0, 0.01, 0.07, 0.07, 8, "painted", { tint: [1.5, 1.5, 1.4] }, false);
      L.frustum(0, r, 0.01, 0.07, 0.04, 0.05, 6, "painted", { tint: [1.5, 1.5, 1.4] }, false);
    }
    L.frustum(j(1) + 0.1, 0.3, 0, 0.012, 0.09, 0.09, 8, "painted", { tint: [1.5, 1.5, 1.4] }, false);
  } else {
    L.frustum(0, 0, 0, 0.18, 0.04, 0.06, 6, "glass", glass, false, false);
    for (let n = 0; n < 5; n++) {
      const a = (n / 5) * Math.PI * 2;
      L.poly([[Math.cos(a) * 0.01, Math.sin(a) * 0.01, 0.17], [Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.3], [Math.cos(a + 0.4) * 0.07, Math.sin(a + 0.4) * 0.07, 0.27]], [0, 0, 1], "painted", { tint: [1.5, 0.5 + 0.4 * (n % 2), 0.5] });
    }
  }
}
