/**
 * What the bar is made of that is a fixture and not a seat: the counter with its foot rail, the back bar with rows of varied bottles, the column and the archway with its
 * shut door. Real sizes: the counter's top at 1.07 m, its foot rail at 22 cm; the back bar's lower counter at 0.9 m and its shelves above.
 */
import type { Item } from "../../../sim/inside/design.js";
import { hash01 } from "../meshBuilder.js";
import { tintOf, type Geo } from "./kit.js";

/**
 * The bar counter: a body of upright dark boards (each its own strip, a tone off its neighbour's) on a darker plinth, a top 0.7 m deep that overhangs the boards by 5 cm with a bevelled
 * edge, a brass foot rail on short brackets, and a few glasses.
 */
export function barCounter(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  // The body behind the boards, and the plinth.
  L.box(-0.3, 0.28, -h, h, 0.1, 1.02, "dark_wood", { tint: [0.45, 0.45, 0.45] });
  L.box(-0.3, 0.3, -h, h, 0, 0.1, "dark_wood", { tint: [0.45, 0.45, 0.45] }, true, false);
  // The boards of the front, 14 cm each, in vertical strips 2 cm proud of the body, a tone off each other's.
  const n = Math.max(2, Math.round(len / 0.14));
  const w = len / n;
  for (let i = 0; i < n; i++) {
    const k = 0.7 + 0.45 * hash01(i * 13 + it.id + g.seed, 15);
    L.poly([[0.3, -h + i * w + 0.003, 0.1], [0.3, -h + (i + 1) * w - 0.003, 0.1], [0.3, -h + (i + 1) * w - 0.003, 1.02], [0.3, -h + i * w + 0.003, 1.02]], [1, 0, 0], "dark_wood", { tint: [k, k, k] });
  }
  // The top: a slab that overhangs the boards by 5 cm, with a bevel up to its top face.
  L.box(-0.35, 0.35, -h - 0.02, h + 0.02, 1.02, 1.045, "oak", { tint: [0.8, 0.7, 0.7] });
  L.box(-0.35, 0.325, -h - 0.02, h + 0.02, 1.045, 1.07, "oak", { tint: [0.8, 0.7, 0.7] });
  L.poly([[0.35, -h - 0.02, 1.045], [0.35, h + 0.02, 1.045], [0.325, h + 0.02, 1.07], [0.325, -h - 0.02, 1.07]], [1, 0, 1], "oak", { tint: [0.9, 0.8, 0.8] });
  // The foot rail, in brass, 12 cm out from the boards and 22 cm up, on a short bracket at each metre or so.
  L.tubeR(0.42, 0.22, -h + 0.05, h - 0.05, 0.022, 8, "brass");
  const nb = Math.max(1, Math.round(len / 1.1));
  for (let i = 1; i < nb; i++) {
    const r = -h + (i * len) / nb;
    L.box(0.3, 0.42, r - 0.012, r + 0.012, 0.2, 0.24, "brass", undefined, true, false);
  }
  // Glasses on the bar: two or three, pale.
  const glasses = 2 + Math.floor(hash01(it.id + g.seed, 12) * 2);
  for (let k = 0; k < glasses; k++) {
    const r = -h + 0.5 + hash01(it.id * 7 + k + g.seed, 13) * (len - 1);
    L.frustum(0.05 + hash01(it.id * 5 + k, 14) * 0.2, r, 1.07, 1.19, 0.034, 0.04, 6, "glass", { tint: [1.4, 1.5, 1.5] }, false);
  }
}

/** Bottle colours: amber, green, clear, dark, blue, a label's red: each a plain albedo the bottle's own light tints. */
const BOTTLES: readonly (readonly [number, number, number])[] = [[0.55, 0.3, 0.08], [0.1, 0.32, 0.12], [0.75, 0.8, 0.75], [0.07, 0.05, 0.04], [0.12, 0.2, 0.45], [0.55, 0.1, 0.08], [0.5, 0.4, 0.12]];

/**
 * The back bar: a lower counter at 0.9 m with its top, and over it three open shelves against the wall carrying rows of bottles of different heights and colours (a gap here
 * and there where one has been taken down), with a strip of warm light under each shelf. It faces the room along `f`, and the wall it stands against is at `f = -0.3`.
 */
export function backBar(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  const look = { tint: tintOf(it.id + g.seed, 21, 0.05) };
  L.box(-0.3, 0.3, -h, h, 0.08, 0.9, "dark_wood", look);
  L.box(-0.3, 0.3, -h, h, 0, 0.08, "dark_wood", { tint: [0.7, 0.7, 0.7] }, false);
  L.box(-0.3, 0.33, -h - 0.01, h + 0.01, 0.9, 0.94, "oak", { tint: [0.55, 0.5, 0.5] });
  const shelves = [1.22, 1.56, 1.9];
  // A dark glossy panel behind the bottles, so that they stand out: a mirror gone dark, just off the wall.
  L.poly([[-0.285, -h + 0.04, 0.94], [-0.285, h - 0.04, 0.94], [-0.285, h - 0.04, 2.06], [-0.285, -h + 0.04, 2.06]], [1, 0, 0], "glass", { tint: [0.1, 0.12, 0.11] });
  // The uprights at the two ends and one between, and the top board.
  const ups = Math.max(2, Math.round(len / 1.6) + 1);
  for (let i = 0; i < ups; i++) {
    const r = -h + 0.02 + (i * (len - 0.04)) / (ups - 1);
    L.box(-0.3, -0.02, r - 0.02, r + 0.02, 0.94, 2.06, "dark_wood", look);
  }
  L.box(-0.3, -0.02, -h, h, 2.06, 2.1, "dark_wood", look);
  for (const y of shelves) {
    L.box(-0.3, -0.02, -h + 0.04, h - 0.04, y, y + 0.03, "dark_wood", look, true);
    // A strip of light under the board above it.
    L.poly([[-0.04, -h + 0.1, y + 0.31], [-0.04, h - 0.1, y + 0.31], [-0.04, h - 0.1, y + 0.335], [-0.04, -h + 0.1, y + 0.335]], [1, 0, 0], "paper", { glow: 1.3, tint: [1, 0.76, 0.42] });
  }
  // The bottles, a row on each shelf: the same bottle is never the same height or colour twice running. A long bar has them further apart, not more of them.
  const per = Math.max(1, Math.min(26, Math.floor((len - 0.2) / 0.17)));
  shelves.forEach((y, row) => {
    for (let k = 0; k < per; k++) {
      const id = it.id * 977 + row * 131 + k;
      if (hash01(id + g.seed, 22) < 0.14) continue;
      const kind = Math.floor(hash01(id + g.seed, 23) * BOTTLES.length);
      const col = BOTTLES[kind] as readonly [number, number, number];
      const tall = 0.2 + hash01(id, 24) * 0.12;
      const r = -h + 0.12 + k * ((len - 0.24) / Math.max(1, per - 1)) + (hash01(id, 25) - 0.5) * 0.03;
      const f = -0.14 + (hash01(id, 26) - 0.5) * 0.06;
      const rad = 0.03 + hash01(id, 27) * 0.012;
      const body = tall * 0.62;
      const tint = [col[0] * 2.2, col[1] * 2.2, col[2] * 2.2] as const;
      // A four-sided body and neck: a bottle seen from the room, which is where the back bar is seen from.
      L.frustum(f, r, y + 0.03, y + 0.03 + body, rad, rad, 4, "glass", { tint }, false, false);
      L.frustum(f, r, y + 0.03 + body, y + 0.03 + tall, rad * 0.45, rad * 0.35, 4, "glass", { tint }, false, true);
    }
  });
}

/** A square concrete column from the floor to the ceiling, with a skirting of dark timber at its foot. */
export function column(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const H = it.p[0] ?? 3;
  L.box(-0.23, 0.23, -0.23, 0.23, 0, H, "concrete", { tint: tintOf(it.id + g.seed, 31, 0.05) }, true, false);
  L.box(-0.245, 0.245, -0.245, 0.245, 0, 0.12, "dark_wood");
}

/**
 * The archway in the back wall: a plastered surround 10 cm proud of the wall, 1.1 m wide with a round head, round the shut door of the restrooms, which is set in the wall's own plane.
 * It faces the room along `f`; the wall is at `f = -0.13`.
 */
export function archway(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const w = (it.p[0] ?? 1.1) / 2;
  const wall = -0.13;
  const proud = wall + 0.1;
  // The door's own leaf, 3 cm off the wall, with a round head: a rectangle to 1.75 m and a half-circle over it.
  const spring = 1.75;
  const arc: [number, number, number][] = [];
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    arc.push([wall + 0.03, w * Math.cos(a), spring + w * Math.sin(a)]);
  }
  L.poly([[wall + 0.03, -w, 0], [wall + 0.03, w, 0], ...arc.map((q) => [q[0], q[1], q[2]] as [number, number, number])], [1, 0, 0], "dark_wood", { tint: [1.1, 0.95, 0.9] });
  // Two panels on the leaf, and a brass handle.
  L.box(wall + 0.03, wall + 0.05, -w + 0.12, -0.04, 0.2, 1.1, "dark_wood", { tint: [0.7, 0.7, 0.7] });
  L.box(wall + 0.03, wall + 0.05, 0.04, w - 0.12, 0.2, 1.1, "dark_wood", { tint: [0.7, 0.7, 0.7] });
  L.box(wall + 0.03, wall + 0.075, w - 0.2, w - 0.17, 0.98, 1.1, "brass", undefined, true);
  // The surround: a vertical strip over each stretch of the head's curve up to a straight top, the reveal of the curve, and the two pilasters up to the top.
  const outer = w + 0.2;
  const top = spring + w + 0.15;
  for (let i = 0; i < seg; i++) {
    const a0 = arc[i] as [number, number, number];
    const a1 = arc[i + 1] as [number, number, number];
    L.poly([[proud, a0[1], a0[2]], [proud, a1[1], a1[2]], [proud, a1[1], top], [proud, a0[1], top]], [1, 0, 0], "plaster");
    L.poly([[wall, a0[1], a0[2]], [wall, a1[1], a1[2]], [proud, a1[1], a1[2]], [proud, a0[1], a0[2]]], [0, -(a0[1] + a1[1]) / 2, -((a0[2] + a1[2]) / 2 - spring)], "plaster", { k: 0.8 });
  }
  for (const sgn of [-1, 1]) L.box(wall, proud, sgn * w, sgn * outer, 0, top, "plaster");
  L.box(wall, proud + 0.02, -outer - 0.02, outer + 0.02, top, top + 0.05, "plaster");
}
