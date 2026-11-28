/**
 * Seats and tables for the designed rooms, at real sizes: a stool's seat at 0.76 m, a chair's at 0.46, a high-top's table at 1.05 and a low round table's at 0.74.
 * Each is a few dozen faces, and each varies a little by the item's `id` (a seat's colour a few percent off, a leg's lean, a stool turned) so that no two are alike.
 */
import type { Item } from "../../../sim/inside/design.js";
import { hash01 } from "../meshBuilder.js";
import { tintOf, type Geo } from "./kit.js";

/** A round wooden stool: a seat of 8 sides at 0.76 m on four legs. */
export function stool(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const look = { tint: tintOf(it.id + g.seed, 1, 0.12) };
  L.frustum(0, 0, 0.7, 0.76, 0.2, 0.2, 8, it.mat ?? "oak", look);
  for (const [a, b] of [[0.11, 0.11], [0.11, -0.11], [-0.11, 0.11], [-0.11, -0.11]] as const) L.box(a - 0.016, a + 0.016, b - 0.016, b + 0.016, 0, 0.7, "dark_wood", look, true, false);
}

/** A chair facing its front: a seat at 0.46 m, four legs, the back's two uprights and a broad slat. */
export function chair(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const look = { tint: tintOf(it.id + g.seed, 2, 0.12) };
  const mat = it.mat ?? "oak";
  L.box(-0.2, 0.2, -0.2, 0.2, 0.43, 0.46, mat, look);
  for (const r of [-0.18, 0.18]) {
    L.box(0.16, 0.2, r - 0.015, r + 0.015, 0, 0.43, mat, look, true, false);
    L.box(-0.2, -0.16, r - 0.015, r + 0.015, 0, 0.9, mat, look, true, false);
  }
  L.box(-0.2, -0.17, -0.18, 0.18, 0.62, 0.84, mat, look);
}

/** A high-top table: a round top of 12 sides at 1.05 m on one post with a foot. */
export function highTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const rad = it.p[0] ?? 0.36;
  const look = { tint: tintOf(it.id + g.seed, 3, 0.1) };
  L.frustum(0, 0, 1.01, 1.05, rad, rad, 12, it.mat ?? "oak", look);
  L.frustum(0, 0, 0, 1.01, 0.04, 0.04, 6, "dark_wood", look, false, false);
  L.frustum(0, 0, 0, 0.03, 0.2, 0.18, 8, "dark_wood", look);
}

/** A low round table: a round top of 12 sides at 0.74 m on a post with a foot. */
export function lowTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const rad = it.p[0] ?? 0.42;
  const look = { tint: tintOf(it.id + g.seed, 4, 0.1) };
  L.frustum(0, 0, 0.7, 0.74, rad, rad, 12, it.mat ?? "oak", look);
  L.frustum(0, 0, 0, 0.7, 0.035, 0.035, 6, "dark_wood", look, false, false);
  L.frustum(0, 0, 0, 0.03, 0.22, 0.2, 8, "dark_wood", look);
}

/** A small square table against the banquette: a top at 0.74 m on four legs. */
export function squareTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const h = it.p[0] ?? 0.38;
  const look = { tint: tintOf(it.id + g.seed, 5, 0.1) };
  L.box(-h, h, -h, h, 0.7, 0.74, it.mat ?? "oak", look);
  for (const a of [-1, 1]) for (const b of [-1, 1]) L.box(a * (h - 0.05) - 0.02, a * (h - 0.05) + 0.02, b * (h - 0.05) - 0.02, b * (h - 0.05) + 0.02, 0, 0.7, "dark_wood", look, true, false);
}

/** A banquette along a wall: seat cushions at 0.45 m and a back to 1.0 m in separate stretches, in leather, on a timber base. */
export function banquette(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const n = Math.max(1, Math.round(len / 0.6));
  const w = len / n;
  L.box(-0.28, 0.26, -len / 2, len / 2, 0, 0.22, "dark_wood");
  for (let i = 0; i < n; i++) {
    const r0 = -len / 2 + i * w + 0.01;
    const r1 = -len / 2 + (i + 1) * w - 0.01;
    const look = { tint: [1 + (hash01(it.id * 31 + i, 6) - 0.5) * 0.12, 1 + (hash01(it.id * 31 + i, 7) - 0.5) * 0.12, 1] as const };
    L.box(-0.24, 0.26, r0, r1, 0.22, 0.45, "leather", look);
    L.box(-0.3, -0.16, r0, r1, 0.45, 1.0, "leather", look);
  }
}
