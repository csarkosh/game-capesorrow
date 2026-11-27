/**
 * What a hotel's lobby has beside the reception's: a luggage cart, a brochure rack, a long communal table with its stools' company, a coffee station (a counter with a machine and cups and a lit fridge), screens of upright
 * timber slats, long planters, floor lamps, side tables with lamps, and what is let into a ceiling (downlights, vents, sprinkler heads). The slat screen has the same slats as the reception's wall.
 */
import type { Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { tintOf, type Geo } from "./kit.js";

/** A luggage cart: a brass frame on four small wheels with a rail round it and a suitcase or two on it. */
export function luggageCart(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  for (const f of [-0.25, 0.25]) for (const r of [-0.5, 0.5]) L.box(f - 0.01, f + 0.01, r - 0.01, r + 0.01, 0.06, 1.4, "brass", undefined, true, false);
  L.box(-0.28, 0.28, -0.52, 0.52, 0.2, 0.23, "brass", undefined);
  L.box(-0.28, 0.28, -0.52, 0.52, 1.37, 1.4, "brass", undefined);
  for (let k = 0; k < 2; k++) {
    const c = [0.1, 0.12, 0.3][k] as number;
    L.box(-0.2, 0.2, -0.45 + k * 0.5, -0.05 + k * 0.5, 0.23, 0.23 + 0.5 - k * 0.15, "cloth", { tint: [c * 2, c * 3 + 0.2 * k, 1.2 - c] });
  }
  for (const f of [-0.22, 0.22]) for (const r of [-0.45, 0.45]) L.frustum(f, r, 0, 0.06, 0.03, 0.03, 6, "steel", { tint: [0.15, 0.15, 0.15] }, false);
}

/** A rack of brochures: a steel stand with three tiers of pocketed leaflets. */
export function brochureRack(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.1, 0.1, -0.25, 0.25, 0.0, 1.5, "steel", { tint: [0.5, 0.5, 0.5] }, false);
  for (let k = 0; k < 3; k++) {
    const y = 0.55 + k * 0.32;
    L.poly([[0.1, -0.25, y], [0.14, -0.25, y + 0.2], [0.14, 0.25, y + 0.2], [0.1, 0.25, y]], [1, 0, 1], "steel", { tint: [0.3, 0.3, 0.3] });
    for (let j = 0; j < 4; j++) {
      const c: Rgb = [0.5 + 0.5 * hash01(it.id * 7 + k * 4 + j + g.seed, 101), 0.4 + 0.4 * hash01(it.id + k * 3 + j, 102), 0.3 + 0.5 * hash01(it.id * 5 + j + k, 103)];
      L.poly([[0.101, -0.22 + j * 0.12, y + 0.02], [0.101, -0.13 + j * 0.12, y + 0.02], [0.141, -0.13 + j * 0.12, y + 0.17], [0.141, -0.22 + j * 0.12, y + 0.17]], [1, 0, 1], "paper", { tint: c });
    }
  }
}

/** A long communal table: a timber top 0.9 m wide at 1.05 m on two trestle ends, with a few cups, a bowl of fruit and a laptop on it. */
export function longTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 3;
  const h = len / 2;
  L.box(-0.45, 0.45, -h, h, 1.01, 1.05, "oak", { tint: tintOf(it.id + g.seed, 104, 0.06) });
  for (const r of [-h + 0.3, h - 0.3]) {
    L.box(-0.4, 0.4, r - 0.03, r + 0.03, 0, 1.01, "dark_wood", { tint: [0.9, 0.9, 0.9] }, true, false);
  }
  L.box(-0.03, 0.03, -h + 0.3, h - 0.3, 0.5, 0.54, "dark_wood", { tint: [0.9, 0.9, 0.9] });
  const n = Math.floor(len / 0.8);
  for (let k = 0; k < n; k++) {
    const r = -h + 0.4 + k * ((len - 0.8) / Math.max(1, n - 1));
    const side = hash01(it.id * 3 + k + g.seed, 105) < 0.5 ? -0.2 : 0.2;
    L.frustum(side, r, 1.05, 1.11, 0.04, 0.035, 6, "painted", { tint: [1.5, 1.5, 1.4] }, false);
  }
  L.frustum(0, 0, 1.05, 1.1, 0.14, 0.1, 8, "painted", { tint: [1.5, 1.2, 0.8] }, false);
}

/** A coffee station against a wall: a counter 0.7 deep and 1 m high with a steel machine and cups, a cupboard, and at its end a fridge 1.9 m high with a lit glass front. `p0` its length. */
export function coffeeStation(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 3;
  const h = len / 2;
  const fr = 0.8;
  L.box(-0.35, 0.35, -h, h - fr, 0, 0.95, "oak", { tint: [0.85, 0.7, 0.58] });
  L.box(-0.35, 0.38, -h - 0.01, h - fr, 0.95, 1.0, "marble_tile", { tint: [1.1, 1.1, 1.08] });
  L.box(-0.2, 0.2, -h + 0.2, -h + 0.75, 1.0, 1.4, "steel", { tint: [1.3, 1.3, 1.35] });
  L.box(0.2, 0.3, -h + 0.35, -h + 0.6, 1.1, 1.14, "steel", { tint: [0.5, 0.5, 0.5] });
  const n = Math.floor((len - fr - 1.0) / 0.2);
  for (let k = 0; k < n; k++) L.frustum(0.05, -h + 0.9 + k * 0.2, 1.0, 1.08, 0.035, 0.04, 6, "painted", { tint: [1.5 - 0.3 * (k % 2), 1.5, 1.4] }, false);
  L.box(-0.35, 0.35, h - fr, h, 0, 1.9, "steel", { tint: [1.2, 1.2, 1.25] });
  L.poly([[0.352, h - fr + 0.06, 0.15], [0.352, h - 0.06, 0.15], [0.352, h - 0.06, 1.8], [0.352, h - fr + 0.06, 1.8]], [1, 0, 0], "paper", { glow: 1.1, tint: [0.75, 0.9, 1.0] });
  for (const y of [0.6, 1.0, 1.4]) L.poly([[0.354, h - fr + 0.08, y], [0.354, h - 0.08, y], [0.354, h - 0.08, y + 0.02], [0.354, h - fr + 0.08, y + 0.02]], [1, 0, 0], "steel", { tint: [0.4, 0.4, 0.4] });
}

/** A screen of upright timber slats 4 cm wide on an 8 cm pitch, 2.2 m high, on a dark rail at the foot and the head; the same slats as the reception's wall. `p0` its length. */
export function slatScreen(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2.5;
  const h = len / 2;
  L.box(-0.06, 0.06, -h, h, 0, 0.06, "dark_wood", { tint: [0.6, 0.6, 0.6] });
  L.box(-0.06, 0.06, -h, h, 2.14, 2.2, "dark_wood", { tint: [0.6, 0.6, 0.6] });
  const n = Math.floor(len / 0.08);
  for (let k = 0; k < n; k++) {
    const r = -h + 0.04 + k * 0.08;
    const t = 0.85 + 0.3 * hash01(k * 3 + it.id + g.seed, 106);
    for (const f of [-0.02, 0.02]) L.poly([[f, r - 0.02, 0.06], [f, r + 0.02, 0.06], [f, r + 0.02, 2.14], [f, r - 0.02, 2.14]], [Math.sign(f), 0, 0], "oak", { tint: [1.2 * t, 1.0 * t, 0.85 * t] });
  }
}

/** A long planter: a timber trough 0.6 wide and 0.5 high and a row of plants in it, to 1.2 m, different heights and greens. `p0` its length. */
export function planter(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const len = it.p[0] ?? 2;
  const h = len / 2;
  L.box(-0.3, 0.3, -h, h, 0, 0.5, "dark_wood", { tint: [0.9, 0.9, 0.9] });
  const n = Math.max(2, Math.floor(len / 0.45));
  for (let k = 0; k < n; k++) {
    const r = -h + 0.25 + k * ((len - 0.5) / Math.max(1, n - 1));
    const tall = 0.45 + 0.6 * hash01(it.id * 9 + k + g.seed, 107);
    const green = 0.8 + 0.4 * hash01(it.id + k * 3, 108);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + k;
      L.poly([[Math.cos(a) * 0.03, r + Math.sin(a) * 0.03, 0.5], [Math.cos(a + 1.5) * 0.03, r + Math.sin(a + 1.5) * 0.03, 0.5], [Math.cos(a) * 0.2, r + Math.sin(a) * 0.2, 0.5 + tall]], [Math.cos(a), Math.sin(a), 0.3], "painted", { tint: [0.1 * green, 0.5 * green, 0.12 * green] });
    }
  }
}

/** A floor lamp: a thin steel stem on a round foot with a pale drum shade that glows. */
export function floorLamp(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, 0, 0.03, 0.17, 0.15, 8, "steel", { tint: [0.3, 0.3, 0.3] }, false);
  L.box(-0.01, 0.01, -0.01, 0.01, 0.03, 1.3, "steel", { tint: [0.4, 0.4, 0.4] }, true, false);
  L.frustum(0, 0, 1.25, 1.6, 0.17, 0.15, 8, "paper", { glow: 1.8, tint: [1, 0.9, 0.7] }, false, true);
}

/** A side table: a round top at 0.55 m on three legs, with a table lamp and a book on it. */
export function sideTable(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, 0.52, 0.55, 0.25, 0.25, 8, "oak", { tint: tintOf(it.id + g.seed, 109, 0.1) });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    g.tube(L.p(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.52), L.p(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0), 0.015, 4, "dark_wood");
  }
  L.frustum(0, 0, 0.55, 0.7, 0.07, 0.05, 6, "brass", undefined, false, false);
  L.frustum(0, 0, 0.7, 0.9, 0.15, 0.1, 8, "paper", { glow: 1.8, tint: [1, 0.9, 0.7] }, false, true);
  L.box(0.1, 0.2, 0.05, 0.2, 0.55, 0.58, "paper", { tint: [0.9, 0.3, 0.3] });
}

/** A downlight let into the ceiling: a small disc of light 14 cm across in a thin ring. */
export function downlight(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = g.ceiling;
  const ring = (r: number, z: number): [number, number, number][] => Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r, z]);
  L.poly(ring(0.09, y - 0.005), [0, 0, -1], "steel", { tint: [1.3, 1.3, 1.3] });
  L.poly(ring(0.07, y - 0.009), [0, 0, -1], "paper", { glow: 3.2, tint: [1, 0.95, 0.85] });
}

/** A ceiling vent: a pale square grille of slots. */
export function vent(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  const y = g.ceiling - 0.006;
  L.poly([[-0.25, -0.25, y], [0.25, -0.25, y], [0.25, 0.25, y], [-0.25, 0.25, y]], [0, 0, -1], "painted", { tint: [1.3, 1.3, 1.25] });
  for (let k = 0; k < 4; k++) L.poly([[-0.2, -0.17 + k * 0.1, y - 0.003], [0.2, -0.17 + k * 0.1, y - 0.003], [0.2, -0.12 + k * 0.1, y - 0.003], [-0.2, -0.12 + k * 0.1, y - 0.003]], [0, 0, -1], "painted", { tint: [0.35, 0.35, 0.35] });
}

/** A sprinkler head: a small brass stem and a round deflector. */
export function sprinkler(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.frustum(0, 0, g.ceiling - 0.05, g.ceiling, 0.012, 0.012, 4, "brass", undefined, false, false);
  L.frustum(0, 0, g.ceiling - 0.062, g.ceiling - 0.05, 0.03, 0.03, 6, "brass", undefined, false, true);
}
