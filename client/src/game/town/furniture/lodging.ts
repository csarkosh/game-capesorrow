/**
 * What the lodging is made of: the lobby (a reception desk of white stone with a timber shelf, the wall of vertical slats with the lodging's name in lit letters, a ceiling of timber
 * battens with strip lights, pendant lamps, carpet insets, a teal sofa, round pouffes, a low oval table, shell chairs, a wall of open shelving with a television, framed pictures), the corridor's
 * fittings (the barrier across the closed flight and what stands at it, an ice machine) and the player's room (a king bed with its headboard, bedside tables, a dresser with a television, a desk, a footstool,
 * a window with its blind and heater, a closet front, a forest picture). Real sizes: the desk 1.1 m, a sofa's seat 0.45, a bed's top 0.62, a dresser 0.85, a desk 0.76.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { GLYPH_H, textPixels, textRuns } from "../signFont.js";
import { tintOf, type Geo, type Local } from "./kit.js";

/** A tint of `cloth` (whose albedo is the colour of a rust red) that makes it the colour asked for. */
const cloth = (r: number, g: number, b: number): { tint: Rgb } => ({ tint: [r / 0.5, g / 0.2, b / 0.16] });
const TEAL = cloth(0.04, 0.34, 0.38);
const WHITE = cloth(0.8, 0.8, 0.78);
const SHELL: Readonly<Record<string, Rgb>> = { yellow: [0.8, 0.65, 0.08], green: [0.35, 0.5, 0.12], grey: [0.22, 0.24, 0.26] };
/** The cloth of a sofa or an armchair by the item's material name: teal by default, grey, yellow or mustard. */
const fabric = (name: string | undefined, fallback: { tint: Rgb }): { tint: Rgb } => {
  const c = name === undefined ? undefined : SHELL[name] ?? (name === "mustard" ? ([0.7, 0.5, 0.1] as Rgb) : name === "orange" ? ([0.85, 0.36, 0.08] as Rgb) : undefined);
  return c === undefined ? fallback : cloth(c[0], c[1], c[2]);
};

/** The reception desk: a block of white stone 1.1 m high and 0.6 deep with a ledge, a lower timber shelf that wraps one end, a monitor and keyboard and a bell. It faces the customers. */
export function receptionDesk(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 3;
  const h = len / 2;
  L.box(-0.3, 0.3, -h, h, 0, 1.1, "marble_tile", { tint: [1.15, 1.15, 1.13] });
  L.box(-0.3, 0.36, -h - 0.02, h + 0.02, 1.1, 1.13, "marble_tile", { tint: [1.2, 1.2, 1.17] });
  // The timber shelf at the end, at table height, on two legs.
  L.box(0.3, 0.95, h - 1.2, h + 0.02, 0.74, 0.78, "oak", { tint: [0.95, 0.85, 0.75] });
  for (const r of [h - 1.15, h - 0.02]) L.box(0.88, 0.94, r - 0.025, r + 0.025, 0, 0.74, "dark_wood", { tint: [1.2, 1.2, 1.2] }, true, false);
  // A monitor on its stand and a keyboard on the ledge, the clerk's side; a bell on the customers'.
  L.box(-0.12, -0.08, -h + 0.6, -h + 1.15, 1.3, 1.58, "steel", { tint: [0.1, 0.1, 0.1] });
  L.poly([[-0.075, -h + 0.62, 1.32], [-0.075, -h + 1.13, 1.32], [-0.075, -h + 1.13, 1.56], [-0.075, -h + 0.62, 1.56]], [1, 0, 0], "painted", { glow: 0.8, tint: [0.12, 0.2, 0.3] });
  L.box(-0.14, -0.1, -h + 0.85, -h + 0.9, 1.13, 1.3, "steel", { tint: [0.15, 0.15, 0.15] });
  L.box(-0.2, 0.0, -h + 0.7, -h + 1.05, 1.13, 1.15, "steel", { tint: [0.12, 0.12, 0.12] });
  L.frustum(0.2, h - 1.6 + 0.9 - 0.9 + 0.0, 1.13, 1.17, 0.035, 0.03, 8, "brass", undefined, false);
}

/** A sofa facing its front: a base, a seat cushion, a back to 0.85 m, two arms, and loose cushions in black and white. `p0` its length. */
export function sofa(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  L.box(-0.45, 0.45, -h, h, 0, 0.15, "dark_wood", { tint: [0.6, 0.6, 0.6] }, true, false);
  const look = fabric(it.mat, TEAL);
  L.box(-0.2, 0.45, -h + 0.18, h - 0.18, 0.15, 0.45, "cloth", look);
  L.box(-0.45, -0.2, -h, h, 0.15, 0.85, "cloth", look);
  for (const r of [-h, h - 0.18]) L.box(-0.2, 0.45, r, r + 0.18, 0.15, 0.62, "cloth", look);
  const n = Math.max(1, Math.floor(len / 1.1));
  for (let k = 0; k < n; k++) {
    const r = -h + 0.5 + (k * (len - 1)) / Math.max(1, n - 1);
    const dark = hash01(it.id * 5 + k + g.seed, 71) < 0.5;
    L.box(-0.2, -0.1, r - 0.2, r + 0.2, 0.45, 0.85, "cloth", dark ? cloth(0.06, 0.06, 0.07) : WHITE);
  }
}

/** A round pouffe, a little wider in the middle than at the ends, on a timber base: yellow, blue or cream. */
export function pouffe(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const pick = floorPick(it.id + g.seed);
  const cols: Rgb[] = [[0.8, 0.62, 0.08], [0.06, 0.25, 0.55], [0.75, 0.7, 0.6]];
  const c = cols[pick % 3] as Rgb;
  L.frustum(0, 0, 0, 0.07, 0.34, 0.34, 8, "oak", undefined, false);
  L.frustum(0, 0, 0.07, 0.22, 0.34, 0.4, 8, "cloth", cloth(c[0], c[1], c[2]), false, false);
  L.frustum(0, 0, 0.22, 0.38, 0.4, 0.36, 8, "cloth", cloth(c[0], c[1], c[2]));
}
const floorPick = (n: number): number => Math.floor(hash01(n, 72) * 3);

/** A low oval table: an oval top of timber 0.42 m high on four splayed legs. */
export function ovalTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const ring = (y: number, k = 1): [number, number, number][] => Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * 0.3 * k, Math.sin((i / 12) * Math.PI * 2) * 0.65 * k, y]);
  L.poly(ring(0.42), [0, 0, 1], "oak", { tint: [1.1, 0.85, 0.7] });
  L.poly(ring(0.4), [0, 0, -1], "oak", { tint: [0.8, 0.6, 0.5] });
  for (let i = 0; i < 12; i++) {
    const a = ring(0.4)[i] as [number, number, number];
    const b = ring(0.4)[(i + 1) % 12] as [number, number, number];
    L.poly([a, b, [b[0], b[1], 0.42], [a[0], a[1], 0.42]], [a[0] + b[0], a[1] + b[1], 0], "oak", { tint: [0.9, 0.7, 0.55] });
  }
  for (const [a, b] of [[0.2, 0.45], [0.2, -0.45], [-0.2, 0.45], [-0.2, -0.45]] as const) g.tube(L.p(a, b, 0.4), L.p(a * 1.6, b * 1.15, 0.0), 0.02, 4, "dark_wood");
}

/** An upholstered shell chair, seat at 0.46 m on four thin legs: its colour is the item's material name (yellow, green or grey). */
export function shellChair(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const c = SHELL[it.mat ?? "grey"] ?? (SHELL["grey"] as Rgb);
  const look = cloth(c[0], c[1], c[2]);
  L.box(-0.22, 0.22, -0.22, 0.22, 0.42, 0.47, "cloth", look);
  L.box(-0.24, -0.18, -0.23, 0.23, 0.47, 0.85, "cloth", look);
  for (const [a, b] of [[0.17, 0.17], [0.17, -0.17], [-0.17, 0.17], [-0.17, -0.17]] as const) L.box(a - 0.014, a + 0.014, b - 0.014, b + 0.014, 0, 0.42, "dark_wood", undefined, true, false);
}

/** An armchair: a seat, a back and two arms, in a mustard cloth. */
export function armchair(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const look = fabric(it.mat, cloth(0.7, 0.5, 0.1));
  L.box(-0.4, 0.4, -0.4, 0.4, 0.12, 0.2, "dark_wood", { tint: [0.6, 0.6, 0.6] }, true, false);
  L.box(-0.2, 0.4, -0.3, 0.3, 0.2, 0.45, "cloth", look);
  L.box(-0.4, -0.2, -0.4, 0.4, 0.2, 0.85, "cloth", look);
  for (const r of [-0.4, 0.3]) L.box(-0.2, 0.4, r, r + 0.1, 0.2, 0.62, "cloth", look);
}

/** A wall of open shelving boxes with a television in one of them and a few objects: frames, a plant, a green box. Faces the room. `p0` its length. */
export function shelfWall(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  const frame = { tint: [0.8, 0.8, 0.8] as Rgb };
  L.box(-0.22, -0.2, -h, h, 0, 2.2, "dark_wood", { tint: [0.35, 0.35, 0.35] }, false);
  const cols = Math.max(2, Math.round(len / 0.8));
  for (let i = 0; i <= cols; i++) {
    const r = -h + (i * len) / cols;
    L.box(-0.2, 0.2, r - 0.015, r + 0.015, 0.0, 2.2, "oak", frame, true, false);
  }
  for (const y of [0.0, 0.7, 1.4, 2.17]) L.box(-0.2, 0.2, -h, h, y, y + 0.03, "oak", frame);
  // The television in the middle box, and objects in the others.
  const tv = Math.floor(cols / 2);
  const r0 = -h + (tv * len) / cols;
  const w = len / cols;
  L.box(-0.05, 0.0, r0 + 0.08, r0 + w - 0.08, 0.95, 1.38, "steel", { tint: [0.1, 0.1, 0.1] });
  L.poly([[0.005, r0 + 0.11, 0.98], [0.005, r0 + w - 0.11, 0.98], [0.005, r0 + w - 0.11, 1.35], [0.005, r0 + 0.11, 1.35]], [1, 0, 0], "painted", { glow: 0.9, tint: [0.1, 0.22, 0.3] });
  for (let i = 0; i < cols; i++) {
    if (i === tv || hash01(it.id * 7 + i + g.seed, 73) < 0.25) continue;
    const r = -h + ((i + 0.5) * len) / cols;
    const y = [0.03, 0.73, 1.43][Math.floor(hash01(it.id + i * 3 + g.seed, 74) * 3)] as number;
    const kind = Math.floor(hash01(it.id + i * 5 + g.seed, 75) * 3);
    if (kind === 0) L.box(-0.05, 0.1, r - 0.12, r + 0.12, y, y + 0.3, "cloth", cloth(0.2, 0.45, 0.25));
    else if (kind === 1) L.frustum(0.0, r, y, y + 0.28, 0.08, 0.12, 6, "painted", { tint: [0.9, 0.8, 0.6] }, false);
    else L.box(0.0, 0.03, r - 0.15, r + 0.15, y + 0.05, y + 0.35, "paper", { tint: [0.9, 0.5, 0.3] });
  }
}

/** A hanging lamp with a dark shade: a cord from the ceiling and a shade of 8 sides open under, with a glowing disc in it. `p0` the shade's lower edge's height. */
export function pendantLamp(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = it.p[0] ?? g.ceiling - 1.4;
  L.box(-0.004, 0.004, -0.004, 0.004, y + 0.22, g.ceiling, "steel", { tint: [0.1, 0.1, 0.1] }, true, false);
  L.frustum(0, 0, y, y + 0.22, 0.24, 0.07, 8, "steel", { tint: [0.1, 0.1, 0.1] }, false, true);
  const disc = Array.from({ length: 8 }, (_, i): [number, number, number] => [Math.cos((i / 8) * Math.PI * 2) * 0.22, Math.sin((i / 8) * Math.PI * 2) * 0.22, y + 0.015]);
  L.poly(disc, [0, 0, -1], "paper", { glow: 2.2, tint: [1, 0.9, 0.7] });
}

/**
 * A ceiling of timber battens hung under the real one: battens 6 by 12 cm on a 20 cm pitch, running forward `p0` metres from the item's place and spread `p1` metres across (centred on it), their undersides at
 * `p2` (a drawn underside and the two long sides, no ends), with a glowing strip between every third and on rods.
 */
export function battenCeiling(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 4;
  const wide = it.p[1] ?? 3;
  const y1 = it.p[2] ?? g.ceiling - 0.4;
  const n = Math.max(2, Math.floor(wide / 0.2));
  for (let k = 0; k < n; k++) {
    const r = -wide / 2 + (k + 0.5) * (wide / n);
    const t = tintOf(it.id * 3 + k + g.seed, 76, 0.12);
    const look = { tint: [1.1 * t[0], 0.95 * t[1], 0.8 * t[2]] as Rgb };
    L.poly([[0, r - 0.03, y1 - 0.12], [len, r - 0.03, y1 - 0.12], [len, r + 0.03, y1 - 0.12], [0, r + 0.03, y1 - 0.12]], [0, 0, -1], "oak", look);
    L.poly([[0, r - 0.03, y1 - 0.12], [len, r - 0.03, y1 - 0.12], [len, r - 0.03, y1], [0, r - 0.03, y1]], [0, -1, 0], "oak", look);
    L.poly([[0, r + 0.03, y1 - 0.12], [len, r + 0.03, y1 - 0.12], [len, r + 0.03, y1], [0, r + 0.03, y1]], [0, 1, 0], "oak", look);
    if (k % 3 === 1) L.poly([[0.1, r + 0.1, y1 - 0.1], [len - 0.1, r + 0.1, y1 - 0.1], [len - 0.1, r + 0.13, y1 - 0.1], [0.1, r + 0.13, y1 - 0.1]], [0, 0, -1], "paper", { glow: 2, tint: [1, 0.96, 0.88] });
  }
  for (const f of [0.3, len - 0.3]) for (const r of [-wide / 2 + 0.3, wide / 2 - 0.3]) L.box(f - 0.01, f + 0.01, r - 0.01, r + 0.01, y1, g.ceiling, "steel", { tint: [0.15, 0.15, 0.15] }, true, false);
}

/** A rectangle of carpet laid 1 cm proud of the floor: `p0` forward, `p1` across, a teal band across it when `p2` is 1. */
export function carpetInset(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const w = it.p[1] ?? 2;
  L.box(-len / 2, len / 2, -w / 2, w / 2, 0, 0.012, "carpet", { tint: [0.75, 0.78, 0.82] });
  if ((it.p[2] ?? 0) === 1) {
    L.poly([[-len / 2 + 0.2, -w / 2 + 0.01, 0.014], [len / 2 - 0.2, -w / 2 + 0.01, 0.014], [len / 2 - 0.2, -w / 2 + 0.4, 0.014], [-len / 2 + 0.2, -w / 2 + 0.4, 0.014]], [0, 0, 1], "carpet", { tint: [0.05, 1.2, 1.3] });
  }
}

/** A king bed, head to foot along the item's facing (it looks toward the foot): a base with a brown skirt, a mattress, a white duvet with its fold, two pairs of pillows, a headboard of pale timber 1.3 m high. */
export function bed(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const brown = { tint: [1.5, 1.4, 1.25] as Rgb };
  // The base with a warm brown skirt, the mattress on it.
  L.box(-1.05, 1.05, -0.93, 0.93, 0, 0.3, "dark_wood", brown, true, false);
  L.box(-1.0, 1.02, -0.9, 0.9, 0.3, 0.5, "cloth", WHITE);
  // A white duvet over it, turned down at the head in a fold.
  L.box(-0.3, 1.04, -0.96, 0.96, 0.5, 0.58, "cloth", WHITE);
  L.box(-0.42, -0.2, -0.97, 0.97, 0.5, 0.6, "cloth", { tint: [WHITE.tint[0] * 1.1, WHITE.tint[1] * 1.1, WHITE.tint[2] * 1.1] });
  // The duvet drapes over the sides of the bed in a soft edge.
  for (const sg of [-1, 1]) L.box(-0.3, 1.04, sg > 0 ? 0.92 : -0.99, sg > 0 ? 0.99 : -0.92, 0.36, 0.56, "cloth", WHITE, true, false);
  // Two pairs of pillows: one standing against the headboard and one lying before it, each of three layers, thicker in the middle than at the edges, so that it reads as a pillow and not a slab.
  const pillow = (f0: number, f1: number, r0: number, r1: number, y0: number, y1: number): void => {
    const layers = 3;
    for (let k = 0; k < layers; k++) {
      const inset = k === 0 ? 0 : k === 1 ? 0.02 : 0.05;
      const lift = k === layers - 1 ? 0.012 : 0;
      L.box(f0 + inset * (y1 - y0 > 0.2 ? 0.4 : 1), f1 - inset * (y1 - y0 > 0.2 ? 0.4 : 1), r0 + inset, r1 - inset, y0 + ((y1 - y0) * k) / layers, y0 + ((y1 - y0) * (k + 1)) / layers + lift, "cloth", { tint: [WHITE.tint[0] * (1.05 + 0.03 * k), WHITE.tint[1] * (1.05 + 0.03 * k), WHITE.tint[2] * (1.05 + 0.03 * k)] });
    }
  };
  for (const r of [-0.45, 0.45]) {
    pillow(-1.0, -0.88, r - 0.36, r + 0.36, 0.5, 0.98);
    pillow(-0.86, -0.46, r - 0.34, r + 0.34, 0.58, 0.72);
  }
  // A teal throw across the foot.
  L.box(0.62, 0.92, -0.98, 0.98, 0.58, 0.62, "cloth", TEAL);
  L.box(0.62, 0.64, -0.98, 0.98, 0.3, 0.62, "cloth", TEAL, true, false);
  // The headboard, taller and wider than the bed.
  L.box(-1.1, -1.03, -1.2, 1.2, 0.3, 1.35, "oak", { tint: [1.2, 1.1, 1.0] });
}

/** A bedside table hung on the wall: a drawer box at 0.45 to 0.7 m with its front, a telephone on it. */
export function bedside(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.25, 0.25, -0.28, 0.28, 0.45, 0.7, "oak", { tint: [1.0, 0.85, 0.7] });
  L.box(0.25, 0.26, -0.2, 0.2, 0.52, 0.64, "dark_wood", { tint: [0.8, 0.8, 0.8] }, false);
  // A telephone with its handset and a clock with a lit face.
  L.box(-0.12, 0.08, -0.2, -0.02, 0.7, 0.75, "steel", { tint: [0.1, 0.1, 0.1] });
  L.box(-0.12, 0.08, -0.2, -0.02, 0.75, 0.77, "steel", { tint: [0.14, 0.14, 0.14] });
  L.box(-0.06, 0.04, 0.06, 0.2, 0.7, 0.78, "steel", { tint: [0.12, 0.12, 0.12] });
  L.poly([[0.045, 0.09, 0.72], [0.045, 0.17, 0.72], [0.045, 0.17, 0.76], [0.045, 0.09, 0.76]], [1, 0, 0], "paper", { glow: 2.4, tint: [1, 0.2, 0.15] });
}

/** A dresser with a television on it and a small coffee machine: 0.55 by 1.2 m, 0.85 m high, three drawers; it faces the room. */
export function dresser(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.28, 0.28, -0.6, 0.6, 0, 0.85, "oak", { tint: [0.95, 0.8, 0.68] });
  for (let k = 0; k < 3; k++) L.poly([[0.285, -0.55, 0.08 + k * 0.25], [0.285, 0.55, 0.08 + k * 0.25], [0.285, 0.55, 0.28 + k * 0.25], [0.285, -0.55, 0.28 + k * 0.25]], [1, 0, 0], "oak", { tint: [0.8, 0.65, 0.55] });
  L.box(-0.06, 0.0, -0.4, 0.2, 0.85, 1.3, "steel", { tint: [0.1, 0.1, 0.1] });
  L.poly([[0.005, -0.37, 0.88], [0.005, 0.17, 0.88], [0.005, 0.17, 1.27], [0.005, -0.37, 1.27]], [1, 0, 0], "painted", { glow: 0.9, tint: [0.1, 0.16, 0.22] });
  L.box(-0.1, 0.1, 0.3, 0.55, 0.85, 1.12, "steel", { tint: [0.12, 0.12, 0.13] });
}

/** A writing desk, 0.6 by 1.4 m at 0.76 m, with two panel ends and a lamp with a pale shade on it; it faces the room. */
export function desk(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.3, 0.3, -0.7, 0.7, 0.72, 0.76, "oak", { tint: [0.95, 0.8, 0.68] });
  for (const r of [-0.68, 0.64]) L.box(-0.28, 0.28, r, r + 0.04, 0, 0.72, "oak", { tint: [0.9, 0.75, 0.62] }, true, false);
  L.frustum(-0.12, -0.45, 0.76, 0.98, 0.05, 0.03, 6, "steel", undefined, false, false);
  L.frustum(-0.12, -0.45, 0.98, 1.2, 0.13, 0.09, 8, "paper", { glow: 1.6, tint: [1, 0.95, 0.85] }, false, true);
  L.box(0.0, 0.2, 0.05, 0.4, 0.76, 0.78, "paper", { tint: [0.9, 0.9, 0.85] });
}

/** A teal footstool, 0.45 m square and 0.42 m high. */
export function footstool(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.22, 0.22, -0.22, 0.22, 0.05, 0.42, "cloth", TEAL);
  L.box(-0.2, 0.2, -0.2, 0.2, 0, 0.05, "dark_wood", undefined, true, false);
}

/** A heater unit under a window: a pale box 1.0 m wide and 0.5 m high with a grille; it faces the room. */
export function heater(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.12, 0.12, -0.5, 0.5, 0, 0.45, "painted", { tint: [1.35, 1.35, 1.3] });
  for (let k = 0; k < 4; k++) L.poly([[0.125, -0.42, 0.1 + k * 0.07], [0.125, 0.42, 0.1 + k * 0.07], [0.125, 0.42, 0.13 + k * 0.07], [0.125, -0.42, 0.13 + k * 0.07]], [1, 0, 0], "painted", { tint: [0.5, 0.5, 0.5] });
}

/** An ice machine, 0.7 by 0.8 m and 1.8 m high, in white steel with a dark chute. */
export function iceMachine(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.35, 0.35, -0.4, 0.4, 0, 1.8, "painted", { tint: [1.3, 1.3, 1.3] });
  L.box(0.35, 0.37, -0.25, 0.25, 0.9, 1.3, "steel", { tint: [0.1, 0.1, 0.12] });
  L.poly([[0.375, -0.2, 1.4], [0.375, 0.2, 1.4], [0.375, 0.2, 1.6], [0.375, -0.2, 1.6]], [1, 0, 0], "painted", { glow: 1.0, tint: [0.2, 0.5, 0.8] });
}

/** The barrier across the closed flight: two upright posts and two timber rails painted in bands, across the width of the corridor (1.8 m) at `p0` metres up the flight (the floor there). */
export function barrier(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const base = (it.p[0] ?? 0) - (it.y ?? 0);
  for (const r of [-0.85, 0.85]) L.box(-0.04, 0.04, r - 0.04, r + 0.04, base, base + 1.15, "oak", { tint: [1.0, 0.8, 0.5] }, true, false);
  for (const y of [base + 0.55, base + 0.95]) {
    L.box(-0.025, 0.025, -0.85, 0.85, y, y + 0.12, "painted", { tint: [1.3, 1.1, 0.2] });
    for (let k = 0; k < 6; k++) L.poly([[0.03, -0.82 + k * 0.28, y], [0.03, -0.82 + k * 0.28 + 0.12, y], [0.03, -0.82 + k * 0.28 + 0.12, y + 0.12], [0.03, -0.82 + k * 0.28, y + 0.12]], [1, 0, 0], "painted", { tint: [0.08, 0.08, 0.08] });
  }
}

/** A step ladder leaning at the barrier: two rails and four steps, in aluminium. `p0` the height of the step it stands on. */
export function stepLadder(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const base = (it.p[0] ?? 0) - (it.y ?? 0);
  for (const r of [-0.22, 0.22]) {
    L.box(-0.02, 0.02, r - 0.02, r + 0.02, base, base + 1.4, "steel", { tint: [1.5, 1.5, 1.5] }, true, false);
    g.tube(L.p(-0.02, r, base + 1.4), L.p(-0.5, r, base), 0.016, 4, "steel", { tint: [1.5, 1.5, 1.5] });
  }
  for (let k = 0; k < 4; k++) L.box(-0.03 - k * 0.1, 0.03 - k * 0.1, -0.22, 0.22, base + 0.35 + k * 0.28, base + 0.37 + k * 0.28, "steel", { tint: [1.5, 1.5, 1.5] });
}

/** Three or four paint cans on the floor: cylinders of 8 sides with a lid ring and one with a splash, different colours. `p0` the floor's height. */
export function paintCans(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const base = (it.p[0] ?? 0) - (it.y ?? 0);
  const n = 3 + Math.floor(hash01(it.id + g.seed, 77) * 2);
  const cols: Rgb[] = [[0.8, 0.8, 0.75], [0.12, 0.3, 0.55], [0.55, 0.12, 0.1], [0.2, 0.45, 0.2]];
  for (let k = 0; k < n; k++) {
    const f = (k % 2) * 0.28 - 0.14;
    const r = -0.3 + k * 0.22;
    L.frustum(f, r, base, base + 0.2, 0.09, 0.09, 8, "painted", { tint: [1.6, 1.6, 1.6] }, false, false);
    L.frustum(f, r, base + 0.2, base + 0.21, 0.09, 0.09, 8, "steel", { tint: [1.2, 1.2, 1.2] }, false, true);
    const c = cols[k % 4] as Rgb;
    L.poly([[f + 0.093, r - 0.05, base + 0.1], [f + 0.093, r + 0.05, base + 0.1], [f + 0.093, r + 0.05, base + 0.17], [f + 0.093, r - 0.05, base + 0.17]], [1, 0, 0], "painted", { tint: [c[0] * 2, c[1] * 2, c[2] * 2] });
  }
}

/** A dust sheet draped over the lower steps: a few sloping panels of pale cloth following the flight's rise, `p1` a riser high each. */
export function dustSheet(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const base = (it.p[0] ?? 0) - (it.y ?? 0);
  const riser = it.p[1] ?? 0.18;
  for (let k = 0; k < 3; k++) {
    const f0 = k * 0.28 - 0.1;
    const f1 = f0 + 0.28;
    L.poly([[-f0, -0.85, base + (k + 1) * riser + 0.02], [-f1, -0.85, base + (k + 2) * riser + 0.02], [-f1, 0.85, base + (k + 2) * riser + 0.02 + 0.01], [-f0, 0.85, base + (k + 1) * riser + 0.03]], [0, 0, 1], "cloth", WHITE);
  }
}

// ---- hung on the walls

const text = (L: Local, s: string, r0: number, top: number, px: number, f: number, look: { tint: Rgb; glow?: number }): void => {
  const lines = s.split("|");
  lines.forEach((line, k) => {
    const left = r0 - (textPixels(line) * px) / 2;
    const y = top - k * (GLYPH_H * px + px * 2);
    for (const run of textRuns(line)) L.poly([[f, left + run.c0 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r1 * px], [f, left + run.c1 * px, y - run.r0 * px], [f, left + run.c0 * px, y - run.r0 * px]], [1, 0, 0], "painted", look);
  });
};

/** A wall of vertical timber slats 4 cm wide on an 8 cm pitch over a dark backing, one strip a slat: `w` along the wall, `h` high. */
export function slatWall(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const hw = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  L.poly([[0.005, -hw, y0], [0.005, hw, y0], [0.005, hw, y0 + dc.h], [0.005, -hw, y0 + dc.h]], [1, 0, 0], "dark_wood", { tint: [0.35, 0.35, 0.35] });
  const n = Math.floor(dc.w / 0.08);
  for (let k = 0; k < n; k++) {
    const r = -hw + 0.04 + k * 0.08;
    const t = 0.85 + 0.3 * hash01(k * 3 + g.seed, 78);
    L.poly([[0.03, r - 0.02, y0], [0.03, r + 0.02, y0], [0.03, r + 0.02, y0 + dc.h], [0.03, r - 0.02, y0 + dc.h]], [1, 0, 0], "oak", { tint: [1.2 * t, 1.0 * t, 0.85 * t] });
  }
}

/** Letters of the lodging's name, lit warm white, 45 cm high, centred on the wall. */
export function litLetters(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const s = dc.text ?? "";
  const px = Math.min(0.064, (dc.w - 0.2) / Math.max(1, textPixels(s)));
  // Laid four times a fifth of a pixel apart so that each stroke is a little thicker, warm white and glowing.
  const th = px * 0.22;
  for (const [dr, dy] of [[-th, 0], [th, 0], [0, -th], [0, th]] as const) text(L, s, dr, dc.y + (GLYPH_H * px) / 2 + dy, px, 0.07, { tint: [1, 0.95, 0.85], glow: 3 });
}

/** A framed picture of a forest: a frame, a pale sky, vertical trunks in warm browns and blue-green masses of leaves behind them. */
export function forestPicture(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const h = dc.h / 2;
  const y0 = dc.y - h;
  const y1 = dc.y + h;
  L.box(0, 0.03, -w, w, y0, y1, "painted", { tint: [1.4, 1.4, 1.35] }, false);
  L.poly([[0.032, -w + 0.05, y0 + 0.05], [0.032, w - 0.05, y0 + 0.05], [0.032, w - 0.05, y1 - 0.05], [0.032, -w + 0.05, y1 - 0.05]], [1, 0, 0], "painted", { tint: [0.35, 0.55, 0.6] });
  L.poly([[0.034, -w + 0.05, y0 + dc.h * 0.55], [0.034, w - 0.05, y0 + dc.h * 0.55], [0.034, w - 0.05, y1 - 0.05], [0.034, -w + 0.05, y1 - 0.05]], [1, 0, 0], "painted", { tint: [0.15, 0.35, 0.3] });
  const n = 6;
  for (let k = 0; k < n; k++) {
    const r = -w + 0.12 + (k + hash01(k + g.seed, 81) * 0.5) * ((2 * w - 0.24) / n);
    const tw = 0.025 + 0.02 * hash01(k * 3, 82);
    L.poly([[0.036, r - tw, y0 + 0.05], [0.036, r + tw, y0 + 0.05], [0.036, r + tw, y1 - 0.05], [0.036, r - tw, y1 - 0.05]], [1, 0, 0], "painted", { tint: [0.55 + 0.2 * hash01(k, 83), 0.22, 0.12] });
  }
}

/** A window in a wall that is no front wall: a bright pane behind a blind rolled half down, in a pale frame with a sill. `w` and `h` the pane's size, `y` its centre. */
export function litPane(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const h = dc.h / 2;
  const y0 = dc.y - h;
  const y1 = dc.y + h;
  // Where the room has a layer for through glass the window is a cut in the wall with glass set in it (`Design.windows`, `designGeometry.ts`); where it has none it is this bright sheet.
  if (g.out.marked === null) L.poly([[0.01, -w, y0], [0.01, w, y0], [0.01, w, y1], [0.01, -w, y1]], [1, 0, 0], "painted", { glow: 1.3, tint: [0.8, 0.88, 1] });
  // The blind, rolled half down: a pale sheet from the top and its roller.
  const drop = y1 - dc.h * 0.55;
  L.poly([[0.03, -w, drop], [0.03, w, drop], [0.03, w, y1], [0.03, -w, y1]], [1, 0, 0], "paper", { tint: [1.15, 1.15, 1.12], k: 1.1 });
  // Its lower edge, a slat bar.
  L.box(0.02, 0.05, -w, w, drop - 0.025, drop, "paper", { tint: [1.0, 1.0, 0.95] });
  L.tubeR(0.05, y1 - 0.02, -w, w, 0.025, 6, "painted", { tint: [1.3, 1.3, 1.3] });
  L.box(0, 0.05, -w - 0.05, -w, y0 - 0.03, y1 + 0.03, "painted", { tint: [1.3, 1.3, 1.25] }, true, false);
  L.box(0, 0.05, w, w + 0.05, y0 - 0.03, y1 + 0.03, "painted", { tint: [1.3, 1.3, 1.25] }, true, false);
  L.box(0, 0.05, -w - 0.05, w + 0.05, y1, y1 + 0.04, "painted", { tint: [1.3, 1.3, 1.25] });
  L.box(0, 0.12, -w - 0.07, w + 0.07, y0 - 0.05, y0, "painted", { tint: [1.3, 1.3, 1.25] });
}

/** The front of a closet: two sliding doors in timber with a recessed handle each, in a frame. */
export function closetFront(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.03, -w, w, y0, y1, "oak", { tint: [0.85, 0.7, 0.58] });
  L.poly([[0.034, 0, y0 + 0.05], [0.034, 0, y1 - 0.05], [0.034, 0.01, y1 - 0.05], [0.034, 0.01, y0 + 0.05]], [1, 0, 0], "dark_wood", { tint: [0.4, 0.4, 0.4] });
  for (const r of [-0.04, 0.05]) L.box(0.03, 0.05, r - 0.01, r + 0.01, dc.y - 0.15, dc.y + 0.15, "steel", { tint: [1.3, 1.3, 1.3] }, true, false);
}

/** The room's door, open against the wall inside: a timber leaf 4 cm thick, 1.0 m wide and 2.0 m high, standing across the item's forward, with its handle. */
export function doorLeaf(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  // A plain panelled door: the leaf in timber, a stile and rail round it, a tall panel above and a smaller one below, each a little proud. No bar, no lock edge drawn on its face.
  L.box(-0.02, 0.02, -w, w, y0, y1, "oak", { tint: [0.9, 0.7, 0.55] }, true, false);
  const tone = { tint: [0.78, 0.6, 0.46] as Rgb };
  const stile = 0.11;
  for (const [a0, a1, b0, b1] of [[y0 + 0.45, y0 + 0.95, -w + stile, w - stile], [y0 + 1.1, y1 - 0.1, -w + stile, w - stile]] as const) L.box(0.02, 0.032, b0, b1, a0, a1, "oak", tone, false, true);
  // A small lever of dark timber on the latch side.
  L.box(0.02, 0.07, w - 0.12, w - 0.04, dc.y - 0.07, dc.y - 0.05, "dark_wood", { tint: [0.6, 0.5, 0.45] }, false, true);
}

/** A potted plant: a pot of 8 sides and a fan of nine leaves, each a long narrow triangle leaning out, in greens that differ by a hash. */
export function plant(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, 0, 0.32, 0.2, 0.15, 8, "painted", { tint: [1.0, 0.7, 0.5] }, false);
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash01(it.id + g.seed, 86);
    const lean = 0.25 + 0.2 * hash01(k + it.id * 3, 87);
    const tall = 0.8 + 0.4 * hash01(k * 5 + it.id, 88);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const tip: [number, number, number] = [ca * lean * tall, sa * lean * tall, 0.32 + tall * 0.9];
    const w = 0.05;
    const green = 0.8 + 0.4 * hash01(k + it.id * 11, 89);
    L.poly([[ca * 0.02 - sa * w, sa * 0.02 + ca * w, 0.32], [ca * 0.02 + sa * w, sa * 0.02 - ca * w, 0.32], tip], [ca, sa, 0.3], "plaster", { tint: [0.05 * green, 0.3 * green, 0.06 * green] });
  }
}

/** A round wall clock: a rim, a pale face and two hands. */
export function clock(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  L.disc(0, dc.y, 0.17, 0.0, 0.04, 12, "dark_wood", { tint: [0.8, 0.8, 0.8] });
  const face = Array.from({ length: 12 }, (_, i): [number, number, number] => [0.042, Math.cos((i / 12) * Math.PI * 2) * 0.15, dc.y + Math.sin((i / 12) * Math.PI * 2) * 0.15]);
  L.poly(face, [1, 0, 0], "paper", { tint: [1.1, 1.1, 1.05] });
  L.poly([[0.045, -0.006, dc.y], [0.045, 0.006, dc.y], [0.045, 0.004, dc.y + 0.12], [0.045, -0.004, dc.y + 0.12]], [1, 0, 0], "steel", { tint: [0.1, 0.1, 0.1] });
  L.poly([[0.046, 0, dc.y - 0.005], [0.046, 0.09, dc.y + 0.02], [0.046, 0.09, dc.y + 0.03], [0.046, 0, dc.y + 0.005]], [1, 0, 0], "steel", { tint: [0.1, 0.1, 0.1] });
}

/** A fire extinguisher hung on a wall: a red cylinder with a black hose and a bracket, 0.5 m tall; `y` its middle. */
export function extinguisher(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  L.frustum(0.07, 0, dc.y - 0.25, dc.y + 0.2, 0.065, 0.065, 8, "painted", { tint: [2.2, 0.2, 0.15] }, false);
  L.frustum(0.07, 0, dc.y + 0.2, dc.y + 0.26, 0.03, 0.02, 6, "steel", { tint: [0.12, 0.12, 0.12] }, false);
  L.box(0.0, 0.03, -0.05, 0.05, dc.y - 0.1, dc.y + 0.05, "steel", { tint: [0.5, 0.5, 0.5] });
}

/** A luggage rack: a timber frame with straps 0.55 m high, 0.5 by 0.9 m, and a suitcase lying on it. */
export function luggageRack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const f of [-0.22, 0.22]) for (const r of [-0.42, 0.42]) L.box(f - 0.02, f + 0.02, r - 0.02, r + 0.02, 0, 0.5, "dark_wood", undefined, true, false);
  for (const r of [-0.42, -0.14, 0.14, 0.42]) L.box(-0.24, 0.24, r - 0.02, r + 0.02, 0.5, 0.53, "paper", { tint: [0.8, 0.6, 0.4] });
  L.box(-0.2, 0.2, -0.36, 0.36, 0.53, 0.77, "leather", { tint: [0.8, 0.9, 1.1] });
  L.box(-0.2, 0.2, -0.04, 0.04, 0.77, 0.8, "steel", { tint: [0.5, 0.5, 0.5] });
}

/** A waste bin: a round steel bin 28 cm across and 30 cm high. */
export function wasteBin(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, 0, 0.3, 0.12, 0.14, 8, "steel", { tint: [0.45, 0.45, 0.47] }, false, false);
  L.frustum(0, 0, 0.3, 0.305, 0.14, 0.11, 8, "steel", { tint: [0.15, 0.15, 0.15] }, false, true);
}

/** A tray with a kettle and two cups, laid on a dresser (its floor `y`): a dark tray 0.4 by 0.25, a steel kettle and two white cups. */
export function kettleTray(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.12, 0.12, -0.2, 0.2, 0, 0.02, "dark_wood", { tint: [0.9, 0.9, 0.9] });
  L.frustum(0, -0.08, 0.02, 0.2, 0.07, 0.05, 8, "steel", { tint: [1.1, 1.1, 1.15] }, false, true);
  L.box(-0.02, 0.02, -0.17, -0.1, 0.1, 0.12, "steel", { tint: [0.15, 0.15, 0.15] });
  for (const r of [0.06, 0.15]) L.frustum(0.04, r, 0.02, 0.07, 0.03, 0.035, 6, "painted", { tint: [1.5, 1.5, 1.45] }, false, true);
}

/** A smoke detector let into the ceiling: a pale disc 12 cm across with a small red light. */
export function smokeDetector(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = g.ceiling;
  L.frustum(0, 0, y - 0.035, y, 0.07, 0.07, 8, "painted", { tint: [1.5, 1.5, 1.45] }, false, true);
  L.frustum(0.03, 0, y - 0.04, y - 0.035, 0.008, 0.008, 4, "paper", { glow: 3, tint: [1, 0.1, 0.05] }, false, true);
}

/** A cornice: a pale moulding 8 cm deep and 6 cm high where the walls meet the ceiling, round the box `p0..p3` (s0, s1, d0, d1) under the ceiling at `y`. */
export function cornice(g: Geo, it: Item): void {
  const [s0, s1, d0, d1] = [it.p[0] ?? 0, it.p[1] ?? 1, it.p[2] ?? 0, it.p[3] ?? 1];
  const y = g.ceiling;
  const L = g.at(0, 0, { s: 1, d: 0 });
  const look = { tint: [1.3, 1.28, 1.2] as Rgb };
  L.box(s0, s1, d0, d0 + 0.08, y - 0.06, y, "painted", look, false, true);
  L.box(s0, s1, d1 - 0.08, d1, y - 0.06, y, "painted", look, false, true);
  L.box(s0, s0 + 0.08, d0, d1, y - 0.06, y, "painted", look, false, true);
  L.box(s1 - 0.08, s1, d0, d1, y - 0.06, y, "painted", look, false, true);
}

/** Full-height curtains drawn back at each side of a window: two pleated panels 0.4 m wide of a pale cloth, `w` the window's width, `h` their height from the floor `y - h / 2`. */
export function curtainPair(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  for (const side of [-1, 1]) {
    const r0 = side * (dc.w / 2 + 0.05);
    for (let k = 0; k < 8; k++) {
      const a = r0 + side * k * 0.05;
      const b = r0 + side * (k + 1) * 0.05;
      const f0 = k % 2 === 0 ? 0.04 : 0.1;
      const f1 = k % 2 === 0 ? 0.1 : 0.04;
      L.poly([[f0, a, y0], [f1, b, y0], [f1, b, y1], [f0, a, y1]], [1, 0, 0], "carpet", { tint: [1.7, 1.6, 1.5], k: 1 });
    }
    L.box(0.02, 0.04, Math.min(r0, r0 + side * 0.4), Math.max(r0, r0 + side * 0.4), y1 - 0.02, y1 + 0.02, "steel", { tint: [0.3, 0.3, 0.3] });
  }
}

/** A light switch: a pale plate 8 by 12 cm with a toggle. */
export function lightSwitch(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  L.box(0, 0.012, -0.04, 0.04, dc.y - 0.06, dc.y + 0.06, "painted", { tint: [1.5, 1.5, 1.45] }, false);
  L.box(0.012, 0.02, -0.008, 0.008, dc.y - 0.015, dc.y + 0.02, "painted", { tint: [1.2, 1.2, 1.15] }, false);
}

/** The fire plan card on the inside of a door: a framed sheet 0.3 by 0.4 m with the plan's floor and a red arrow. */
export function firePlan(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.012, -w, w, y0, y1, "painted", { tint: [0.4, 0.4, 0.4] }, false);
  L.poly([[0.014, -w + 0.015, y0 + 0.015], [0.014, w - 0.015, y0 + 0.015], [0.014, w - 0.015, y1 - 0.015], [0.014, -w + 0.015, y1 - 0.015]], [1, 0, 0], "paper", { tint: [1.2, 1.2, 1.1] });
  L.poly([[0.016, -w + 0.04, y0 + 0.05], [0.016, w - 0.04, y0 + 0.05], [0.016, w - 0.04, y0 + dc.h * 0.6], [0.016, -w + 0.04, y0 + dc.h * 0.6]], [1, 0, 0], "painted", { tint: [0.45, 0.5, 0.55] });
  L.poly([[0.018, -w * 0.5, y0 + dc.h * 0.2], [0.018, w * 0.3, y0 + dc.h * 0.2], [0.018, w * 0.3, y0 + dc.h * 0.26], [0.018, -w * 0.5, y0 + dc.h * 0.26]], [1, 0, 0], "painted", { tint: [1.4, 0.15, 0.1] });
}
