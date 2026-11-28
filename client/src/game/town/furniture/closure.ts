/**
 * What closes a stair that is shut: the way games close a way a player may not take, with real mass the player understands before reaching it, in two or three layers of different kinds of thing, lit, with the stair
 * seen to go on beyond it. A hotel's flight shut for maintenance is a plywood hoarding with a door, a sign, tape and the things a crew leaves; a town hall's flight shut to the public is a glazed screen with a card
 * reader, brass posts and a rope. Each piece is its own item (`sim/inside/designs/lodging.ts`, `hall.ts` place them) so that a closure is many things, never one bar.
 */
import type { Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { glassPanel } from "./glass.js";
import type { Geo } from "./kit.js";

const BLACK: Rgb = [0.08, 0.08, 0.09];

/**
 * A hoarding across a flight's foot: sheets of plywood painted off-white on a timber frame with a kicker, 1.2 m wide each and 2.0 m high, a shut door 0.9 by 1.95 m with hinges, a hasp and a padlock, a strip of black and
 * yellow tape across it at 1.0 m, and the signs on it: a red, white and black DANGER plate, a yellow CAUTION plate and a printed notice (all as boards: their words are decor). `p0` its width; it faces the corridor.
 */
export function hoarding(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const w = it.p[0] ?? 1.7;
  const h = w / 2;
  L.box(-0.05, 0.05, -h, h, 0, 2.0, "painted", { tint: [1.35, 1.32, 1.25] }, true, true);
  // The timber frame: posts every sheet, a kicker at the foot, a rail across the head.
  const sheets = Math.max(1, Math.round(w / 1.2));
  for (let k = 0; k <= sheets; k++) {
    const r = -h + (k * w) / sheets;
    L.box(0.05, 0.1, r - 0.04, r + 0.04, 0, 2.0, "oak", { tint: [1.0, 0.85, 0.65] }, true, false);
  }
  L.box(0.05, 0.1, -h, h, 0, 0.12, "oak", { tint: [0.9, 0.8, 0.6] });
  L.box(0.05, 0.1, -h, h, 1.94, 2.0, "oak", { tint: [1.0, 0.85, 0.65] });
  // The door: a shut leaf 0.9 by 1.95 m, hinges, a hasp and a padlock.
  const dr = Math.max(-h + 0.3, Math.min(h - 1.2, -0.2));
  L.box(0.1, 0.13, dr, dr + 0.9, 0, 1.95, "oak", { tint: [1.1, 1.0, 0.85] }, true, false);
  for (const y of [0.3, 1.6]) L.box(0.13, 0.15, dr, dr + 0.08, y, y + 0.1, "steel", { tint: [0.3, 0.3, 0.32] });
  L.box(0.13, 0.15, dr + 0.78, dr + 0.9, 1.0, 1.06, "steel", { tint: [0.5, 0.5, 0.52] });
  L.box(0.13, 0.17, dr + 0.84, dr + 0.9, 0.9, 0.98, "brass", undefined);
  // The tape: black and yellow across the face at 1.0 m.
  for (let k = 0; k < Math.floor(w / 0.12); k++) L.poly([[0.101, -h + k * 0.12, 1.0], [0.101, -h + k * 0.12 + 0.06, 1.0], [0.101, -h + k * 0.12 + 0.06, 1.08], [0.101, -h + k * 0.12, 1.08]], [1, 0, 0], "painted", { tint: k % 2 === 0 ? [1.5, 1.2, 0.05] : BLACK });
  // The plates: the danger plate (red, white, black), the caution plate (yellow), a printed notice (white), as flat boards; their words are `sign` hangings in the design.
  L.box(0.1, 0.12, h - 0.65, h - 0.2, 1.45, 1.8, "painted", { tint: [1.3, 0.1, 0.08] }, false);
  L.box(0.1, 0.12, h - 0.65, h - 0.2, 1.2, 1.4, "painted", { tint: [1.5, 1.25, 0.05] }, false);
  L.box(0.1, 0.12, h - 0.6, h - 0.25, 0.6, 0.9, "painted", { tint: [1.5, 1.5, 1.45] }, false);
}

/** A tan floor-protection sheet laid on the floor, 1.2 m wide and `p0` long (default 2 m) along its facing, taped at its edges. */
export function floorSheet(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  L.box(0, len, -0.6, 0.6, 0, 0.012, "paper", { tint: [0.75, 0.62, 0.42] });
  for (const r of [-0.6, 0.57]) L.box(0, len, r, r + 0.03, 0.012, 0.014, "painted", { tint: [1.4, 1.2, 0.2] }, false);
}

/** A yellow A-frame sign 60 cm wide and 90 cm high on two legs, with black bars for its words (the words are a hanging on the hoarding): STAIR CLOSED / MAINTENANCE IN PROGRESS. */
export function aFrame(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const f of [-0.22, 0.22]) {
    L.poly([[f, -0.3, 0], [f * 0.1, -0.3, 0.9], [f * 0.1, 0.3, 0.9], [f, 0.3, 0]], [f < 0 ? -1 : 1, 0, 0.2], "painted", { tint: [1.5, 1.2, 0.05] });
  }
  for (const [y, w] of [[0.7, 0.22], [0.55, 0.2], [0.4, 0.16]] as const) L.poly([[0.13, -w, y], [0.13, w, y], [0.13, w, y + 0.06], [0.13, -w, y + 0.06]], [1, 0, 0.2], "painted", { tint: BLACK });
}

/** A traffic cone, 50 cm: orange with a white collar. */
export function cone(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.17, 0.17, -0.17, 0.17, 0, 0.03, "steel", { tint: [0.3, 0.3, 0.3] });
  L.frustum(0, 0, 0.03, 0.5, 0.13, 0.025, 8, "painted", { tint: [1.5, 0.45, 0.05] }, false, true);
  L.frustum(0, 0, 0.26, 0.34, 0.08, 0.065, 8, "painted", { tint: [1.5, 1.5, 1.45] }, false, false);
}

/** A work light on a three-legged stand, 1.7 m: the legs and a lamp head that glows cool white. */
export function workLight(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    g.tube(L.p(0, 0, 1.4), L.p(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0), 0.012, 4, "steel", { tint: [0.15, 0.15, 0.16] });
  }
  L.box(-0.02, 0.02, -0.02, 0.02, 1.35, 1.6, "steel", { tint: [0.15, 0.15, 0.16] }, true, false);
  L.box(-0.06, 0.1, -0.22, 0.22, 1.6, 1.85, "steel", { tint: [0.2, 0.2, 0.22] });
  L.poly([[0.101, -0.2, 1.62], [0.101, 0.2, 1.62], [0.101, 0.2, 1.83], [0.101, -0.2, 1.83]], [1, 0, 0], "paper", { glow: 4, tint: [0.85, 0.95, 1.1] });
}

/** Boards stacked and leaning on the wall: six timbers 2.4 m long leaning at a slope against what is behind. */
export function boardsStack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (let k = 0; k < 6; k++) L.poly([[-0.05 + k * 0.012, -0.2 + k * 0.07, 0], [0.04 + k * 0.012, -0.2 + k * 0.07, 0], [0.7, -0.2 + k * 0.07, 2.2], [0.62, -0.2 + k * 0.07, 2.2]], [1, 0, 0.3], "oak", { tint: [0.9 + 0.1 * hash01(k + it.id, 61), 0.75, 0.55] });
}

/** A bucket, 30 cm, with a mop handle in it. */
export function bucket(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, 0, 0.3, 0.14, 0.17, 8, "steel", { tint: [0.9, 0.35, 0.1] }, false, false);
  g.tube(L.p(0, 0, 0.1), L.p(0.2, 0.05, 1.2), 0.01, 4, "oak", { tint: [0.8, 0.65, 0.4] });
}

/** A tool chest: a red steel box 60 by 30 cm and 40 high with a lid and a handle. */
export function toolChest(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.15, 0.15, -0.3, 0.3, 0, 0.4, "painted", { tint: [1.3, 0.12, 0.08] });
  L.box(-0.16, 0.16, -0.31, 0.31, 0.4, 0.43, "steel", { tint: [0.35, 0.35, 0.37] });
  L.box(-0.02, 0.02, -0.1, 0.1, 0.43, 0.47, "steel", { tint: [0.3, 0.3, 0.32] });
}

/** Two or three rubble sacks, 80 cm tall, slumped and pale. */
export function rubbleSacks(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const [f, r, h] of [[0, 0, 0.8], [0.1, 0.5, 0.7], [-0.05, -0.45, 0.6]] as const) L.frustum(f, r, 0, h, 0.25, 0.2, 6, "paper", { tint: [0.9, 0.85, 0.7] }, false, true);
}

/** An orange extension lead trailing along the floor `p0` metres from the item's place (default 2) along its facing. */
export function extensionLead(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const steps = 5;
  for (let k = 0; k < steps; k++) {
    const a = (k * len) / steps;
    const b = ((k + 1) * len) / steps;
    L.box(a, b, 0.02 * Math.sin(k * 1.7) - 0.015, 0.02 * Math.sin(k * 1.7) + 0.015, 0, 0.03, "painted", { tint: [1.5, 0.5, 0.05] }, true, true);
  }
}

/** A sheet of clear polythene hung from the ceiling part-way up a flight: a pale frame, a few vertical creases; `p0` its width, `p1` its height. */
export function polythene(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const w = it.p[0] ?? 1.6;
  const h = it.p[1] ?? 2.0;
  glassPanel((pts, hint, mat, look) => L.poly(pts, hint, mat, look), [0, -w / 2, 0], [0, w / 2, 0], [0, w / 2, h], [0, -w / 2, h], [1, 0, 0]);
  for (const r of [-0.35, 0.1, 0.5]) L.poly([[0.005, r * w * 0.5, 0.1], [0.005, r * w * 0.5 + 0.015, 0.1], [0.005, r * w * 0.5 + 0.015, h - 0.1], [0.005, r * w * 0.5, h - 0.1]], [1, 0, 0], "painted", { tint: [1.2, 1.25, 1.3], glow: 0.5 });
}

/**
 * A glazed screen across a stair's foot: dark frames 2.2 m high and `p0` wide with a glazed door in it (shut, a pull handle) and a card reader on its frame at 1.1 m with a small red light: the same vocabulary as the
 * hall's glazed office fronts. The flight is seen through it rising.
 */
export function glassScreen(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const w = it.p[0] ?? 2;
  const h = w / 2;
  const frame = { tint: [0.14, 0.14, 0.16] as Rgb };
  L.box(-0.04, 0.04, -h, h, 0, 0.08, "steel", frame);
  L.box(-0.04, 0.04, -h, h, 2.12, 2.2, "steel", frame);
  const n = Math.max(2, Math.round(w / 1.0));
  for (let k = 0; k <= n; k++) {
    const r = -h + (k * w) / n;
    L.box(-0.04, 0.04, r - 0.03, r + 0.03, 0, 2.2, "steel", frame, true, false);
  }
  for (let k = 0; k < n; k++) {
    const r0 = -h + (k * w) / n + 0.03;
    const r1 = -h + ((k + 1) * w) / n - 0.03;
    glassPanel((pts, hint, mat, look) => L.poly(pts, hint, mat, look), [0.03, r0, 0.09], [0.03, r1, 0.09], [0.03, r1, 2.11], [0.03, r0, 2.11], [1, 0, 0]);
  }
  // A pull handle on the door (the middle bay), and the reader with its red light.
  L.box(0.04, 0.1, 0.05, 0.08, 0.95, 1.15, "brass", undefined, false);
  L.box(0.04, 0.07, h - 0.12, h - 0.02, 1.0, 1.2, "steel", { tint: [0.18, 0.18, 0.2] }, false);
  L.poly([[0.071, h - 0.08, 1.15], [0.071, h - 0.05, 1.15], [0.071, h - 0.05, 1.18], [0.071, h - 0.08, 1.18]], [1, 0, 0], "paper", { glow: 3, tint: [1.2, 0.1, 0.08] });
}

/** Two brass posts 0.95 m high on round bases of 33 cm with a dark red rope hung between them across the approach; `p0` the gap between them (default 1.6). */
export function ropePosts(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const gap = it.p[0] ?? 1.6;
  const h = gap / 2;
  for (const r of [-h, h]) {
    L.frustum(0, r, 0, 0.04, 0.165, 0.14, 10, "brass", undefined, false, true);
    L.frustum(0, r, 0.04, 0.93, 0.025, 0.025, 6, "brass", undefined, false, false);
    L.frustum(0, r, 0.93, 0.97, 0.05, 0.03, 8, "brass", undefined, false, true);
  }
  const sag = [0.0, 0.04, 0.07, 0.04, 0.0];
  for (let k = 0; k < sag.length - 1; k++) {
    g.tube(L.p(0, -h + (k * gap) / 4, 0.88 - (sag[k] as number)), L.p(0, -h + ((k + 1) * gap) / 4, 0.88 - (sag[k + 1] as number)), 0.02, 5, "cloth", { tint: [1.3, 0.1, 0.15] });
  }
}
