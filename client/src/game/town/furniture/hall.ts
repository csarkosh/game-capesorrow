/**
 * What the municipal hall has of its own: glass balls of light hung on thin wires from a black grid under the ceiling, the grid, glazed fronts with dark frames, the large black
 * and white mural of an old town's street, and the joint lines of board-marked concrete.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import { glassPanel } from "./glass.js";
import type { Geo } from "./kit.js";

/** A glass ball of light: radius `p1` (about 0.14 to 0.22), its centre `p0` over the floor, on a wire up to the grid, which is 0.12 under the ceiling. */
export function glassBall(g: Geo, it: Item): void {
  const y = it.p[0] ?? 5;
  const r = it.p[1] ?? 0.18;
  const L = g.at(it.s, it.d, it.face);
  const top = g.ceiling - 0.12;
  g.tube([it.s, it.d, y + r * 0.9], [it.s, it.d, top], 0.004, 4, "steel", { tint: [0.15, 0.15, 0.15] });
  // The sphere in four stacks of eight sides, pale warm and glowing.
  const prof: readonly (readonly [number, number])[] = [[-1, 0], [-0.62, 0.78], [0, 1], [0.62, 0.78], [1, 0.3]];
  for (let k = 0; k + 1 < prof.length; k++) {
    const a = prof[k] as readonly [number, number];
    const b = prof[k + 1] as readonly [number, number];
    L.frustum(0, 0, y + a[0] * r, y + b[0] * r, a[1] * r + 0.001, b[1] * r + 0.001, 8, "paper", { glow: 2.6, tint: [1, 0.92, 0.76] }, false, false);
  }
  L.frustum(0, 0, y + r * 0.95, y + r * 1.15, 0.03, 0.03, 6, "steel", { tint: [0.15, 0.15, 0.15] }, false, true);
}

/** The black grid under the ceiling the balls hang from: beams across and along the hall every `p5` m, over `p1..p4` (s0, s1, d0, d1) at the height `p0`. */
export function lampGrid(g: Geo, it: Item): void {
  const y = it.p[0] ?? g.ceiling - 0.12;
  const [s0, s1, d0, d1] = [it.p[1] ?? 0, it.p[2] ?? 10, it.p[3] ?? 0, it.p[4] ?? 10];
  const pitch = it.p[5] ?? 2.4;
  const L = g.at(0, 0, { s: 1, d: 0 });
  const black = { tint: [0.1, 0.1, 0.11] as Rgb };
  // The face `f` of the local frame is `s`, `r` is `d`.
  for (let d = d0; d <= d1 + 0.01; d += (d1 - d0) / Math.max(1, Math.round((d1 - d0) / pitch))) L.box(s0, s1, d - 0.03, d + 0.03, y, y + 0.1, "steel", black);
  for (let s = s0; s <= s1 + 0.01; s += (s1 - s0) / Math.max(1, Math.round((s1 - s0) / pitch))) L.box(s - 0.03, s + 0.03, d0, d1, y - 0.04, y + 0.06, "steel", black);
}

/** A glazed front: dark mullions every 1.4 m or so and a pane of clear glass between them (`glassPanel`), `w` by `h`, its middle at `y`. */
export function glazing(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const n = Math.max(1, Math.ceil(dc.w / 1.4));
  const pw = dc.w / n;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  for (let i = 0; i < n; i++) {
    const r0 = -dc.w / 2 + i * pw + 0.01;
    const r1 = -dc.w / 2 + (i + 1) * pw - 0.01;
    glassPanel((pts, hint, mat, look) => L.poly(pts, hint, mat, look), [0.02, r0, y0], [0.02, r1, y0], [0.02, r1, y1], [0.02, r0, y1], [1, 0, 0]);
  }
  for (let i = 0; i <= n; i++) {
    const r = -dc.w / 2 + i * pw;
    L.box(0, 0.05, r - 0.03, r + 0.03, y0, y1, "steel", { tint: [0.14, 0.14, 0.16] }, true, false);
  }
}

/** The mural: a street of an old town in grey tones from simple shapes: a pale sky, a row of buildings of different heights with their windows and a door each, a clock tower, a lamp post and the road. */
export function mural(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  const grey = (v: number): Rgb => [v, v, v];
  const quad = (f: number, r0: number, r1: number, a: number, b: number, v: number, glow?: number): void => L.poly([[f, r0, a], [f, r1, a], [f, r1, b], [f, r0, b]], [1, 0, 0], "painted", glow === undefined ? { tint: grey(v) } : { tint: grey(v), glow });
  quad(0.02, -w, w, y0, y1, 0.9);
  // A thin black border, and the road along the foot.
  const road = y0 + dc.h * 0.12;
  quad(0.025, -w, w, y0, road, 0.28);
  quad(0.028, -w + dc.w * 0.1, -w + dc.w * 0.32, y0 + dc.h * 0.05, y0 + dc.h * 0.065, 0.85);
  quad(0.028, w - dc.w * 0.4, w - dc.w * 0.18, y0 + dc.h * 0.05, y0 + dc.h * 0.065, 0.85);
  const n = 9;
  const bw = dc.w / n;
  for (let k = 0; k < n; k++) {
    const r0 = -w + k * bw + 0.04;
    const r1 = -w + (k + 1) * bw - 0.04;
    const top = road + dc.h * (0.3 + 0.38 * hash01(k * 3 + g.seed, 140));
    const v = 0.2 + 0.4 * hash01(k * 5 + 1, 141);
    quad(0.03, r0, r1, road, top, v);
    // A cornice and rows of windows, three to a building.
    quad(0.032, r0 - 0.03, r1 + 0.03, top, top + 0.1, v * 0.7);
    const cols = Math.max(2, Math.round((r1 - r0) / 0.6));
    const rows = Math.max(2, Math.floor((top - road - 0.9) / 0.9));
    for (let j = 0; j < cols; j++) for (let i = 0; i < rows; i++) {
      const c = r0 + ((j + 0.5) * (r1 - r0)) / cols;
      const yy = road + 1.0 + i * 0.9;
      quad(0.034, c - 0.14, c + 0.14, yy, yy + 0.5, 0.06);
    }
    quad(0.034, (r0 + r1) / 2 - 0.2, (r0 + r1) / 2 + 0.2, road, road + 0.85, 0.05);
  }
  // The clock tower: a taller narrow block with a white face and a peaked top.
  const tc = -w + 3.5 * bw;
  quad(0.04, tc - 0.45, tc + 0.45, road, y1 - dc.h * 0.12, 0.34);
  L.poly([[0.04, tc - 0.5, y1 - dc.h * 0.12], [0.04, tc + 0.5, y1 - dc.h * 0.12], [0.04, tc, y1 - 0.05]], [1, 0, 0], "painted", { tint: grey(0.14) });
  quad(0.042, tc - 0.22, tc + 0.22, y1 - dc.h * 0.3, y1 - dc.h * 0.3 + 0.44, 0.96);
  quad(0.044, tc - 0.015, tc + 0.015, y1 - dc.h * 0.3 + 0.22, y1 - dc.h * 0.3 + 0.4, 0.05);
  quad(0.044, tc - 0.12, tc + 0.01, y1 - dc.h * 0.3 + 0.215, y1 - dc.h * 0.3 + 0.235, 0.05);
  // A lamp post and the frame.
  const lp = w - bw * 1.4;
  quad(0.046, lp - 0.02, lp + 0.02, road, road + dc.h * 0.35, 0.04);
  quad(0.046, lp - 0.12, lp + 0.12, road + dc.h * 0.35, road + dc.h * 0.37, 0.04);
  for (const [a, b] of [[y0, y0 + 0.06], [y1 - 0.06, y1]] as const) quad(0.05, -w, w, a, b, 0.05);
  for (const [a, b] of [[-w, -w + 0.06], [w - 0.06, w]] as const) quad(0.05, a, b, y0, y1, 0.05);
}

/** The joint lines of board-marked concrete: a dark thin line every 30 cm across the wall, `w` by `h`, and the same boards' ends staggered in short ticks. */
export function concreteJoints(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const n = Math.floor(dc.h / 0.3);
  const y0 = dc.y - dc.h / 2;
  for (let k = 1; k < n; k++) {
    const y = y0 + k * 0.3;
    L.poly([[0.004, -dc.w / 2, y], [0.004, dc.w / 2, y], [0.004, dc.w / 2, y + 0.012], [0.004, -dc.w / 2, y + 0.012]], [1, 0, 0], "painted", { tint: [0.28, 0.28, 0.27] });
  }
}

/** A cork board with a map of the coast pinned to it: a timber frame, the cork, a sheet of pale paper with the sea down one side, the land, a road and three red pins. */
export function coastMap(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.03, -w, w, y0, y1, "dark_wood", { tint: [0.9, 0.9, 0.9] }, false);
  L.poly([[0.032, -w + 0.04, y0 + 0.04], [0.032, w - 0.04, y0 + 0.04], [0.032, w - 0.04, y1 - 0.04], [0.032, -w + 0.04, y1 - 0.04]], [1, 0, 0], "painted", { tint: [1.0, 0.7, 0.4] });
  const a = -w * 0.7;
  const b = w * 0.7;
  const lo = y0 + dc.h * 0.15;
  const hi = y1 - dc.h * 0.15;
  L.poly([[0.034, a, lo], [0.034, b, lo], [0.034, b, hi], [0.034, a, hi]], [1, 0, 0], "painted", { tint: [1.4, 1.35, 1.1] });
  L.poly([[0.036, a, lo], [0.036, a + (b - a) * 0.45, lo], [0.036, a + (b - a) * 0.34, (lo + hi) / 2], [0.036, a + (b - a) * 0.5, hi], [0.036, a, hi]], [1, 0, 0], "painted", { tint: [0.5, 0.65, 0.75] });
  L.poly([[0.038, a + (b - a) * 0.6, lo], [0.038, a + (b - a) * 0.63, lo], [0.038, a + (b - a) * 0.63, hi], [0.038, a + (b - a) * 0.6, hi]], [1, 0, 0], "painted", { tint: [0.35, 0.33, 0.3] });
  for (let k = 0; k < 3; k++) {
    const r = a + (b - a) * (0.65 + 0.1 * k);
    const y = lo + (hi - lo) * (0.25 + 0.25 * k);
    L.poly([[0.04, r, y], [0.04, r + 0.035, y], [0.04, r + 0.035, y + 0.035], [0.04, r, y + 0.035]], [1, 0, 0], "painted", { tint: [1.3, 0.1, 0.08] });
  }
}

/** A filing cabinet, 0.45 by 0.6 m and 1.35 m high: a grey steel body of three drawers with handles, a cardboard box on top. */
export function filingCabinet(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.23, 0.23, -0.3, 0.3, 0, 1.35, "steel", { tint: [0.9, 0.95, 0.95] });
  for (let k = 0; k < 3; k++) {
    const y = 0.08 + k * 0.42;
    L.poly([[0.232, -0.27, y], [0.232, 0.27, y], [0.232, 0.27, y + 0.36], [0.232, -0.27, y + 0.36]], [1, 0, 0], "steel", { tint: [1.0, 1.05, 1.05] });
    L.box(0.232, 0.25, -0.07, 0.07, y + 0.27, y + 0.3, "steel", { tint: [0.35, 0.35, 0.37] }, false);
    L.box(0.233, 0.236, -0.12, 0.12, y + 0.13, y + 0.2, "paper", { tint: [1.1, 1.05, 0.9] }, false);
  }
  L.box(-0.17, 0.17, -0.22, 0.22, 1.35, 1.6, "paper", { tint: [0.78, 0.62, 0.42] });
  L.box(-0.172, 0.172, -0.222, 0.222, 1.5, 1.52, "paper", { tint: [0.55, 0.43, 0.28] });
}

/** A coat stand: a turned post on a cross foot with six hooks, a long coat and a hat on it. */
export function coatStand(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  L.box(-0.2, 0.2, -0.03, 0.03, 0, 0.04, "dark_wood", { tint: [1.3, 1.2, 1.1] });
  L.box(-0.03, 0.03, -0.2, 0.2, 0, 0.04, "dark_wood", { tint: [1.3, 1.2, 1.1] });
  L.box(-0.025, 0.025, -0.025, 0.025, 0.04, 1.8, "dark_wood", { tint: [1.3, 1.2, 1.1] }, true, true);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.tube(L.p(0, 0, 1.7), L.p(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 1.78), 0.01, 4, "dark_wood");
  }
  // The coat hangs from a hook: a long grey-brown shape wider at the shoulders, and a hat over another.
  L.poly([[0.1, -0.2, 1.68], [0.1, 0.2, 1.68], [0.14, 0.2, 0.75], [0.14, -0.2, 0.75]], [1, 0, 0], "cloth", { tint: [0.9, 0.8, 0.7] });
  L.poly([[0.04, -0.17, 1.66], [0.04, 0.17, 1.66], [0.1, 0.2, 1.68], [0.1, -0.2, 1.68]], [0, 0, 1], "cloth", { tint: [0.9, 0.8, 0.7] });
  L.frustum(-0.12, 0.0, 1.76, 1.8, 0.2, 0.2, 8, "cloth", { tint: [0.7, 0.62, 0.55] }, false, true);
  L.frustum(-0.12, 0.0, 1.8, 1.9, 0.12, 0.1, 8, "cloth", { tint: [0.7, 0.62, 0.55] }, false, true);
}

/** What lies on a desk top (its floor `y` the top's height): an old typewriter, a telephone, a mug, a stack of folders, a banker's lamp with a green glass shade; in the desk's own frame. */
export function deskSet(g: Geo, it: Item): void {
  const L = g.at(it.s, it.d, it.face);
  // The typewriter: a dark body with a platen and a row of keys, a sheet in it.
  L.box(-0.2, 0.05, -0.55, -0.15, 0, 0.1, "steel", { tint: [0.12, 0.12, 0.13] });
  L.box(-0.2, -0.12, -0.55, -0.15, 0.1, 0.17, "steel", { tint: [0.12, 0.12, 0.13] });
  L.box(-0.2, -0.1, -0.5, -0.2, 0.17, 0.22, "paper", { tint: [1.3, 1.3, 1.2] });
  for (let k = 0; k < 4; k++) L.box(0.02, 0.05, -0.52 + k * 0.1, -0.46 + k * 0.1, 0.1, 0.12, "steel", { tint: [0.35, 0.35, 0.37] });
  // The telephone, black, with its handset.
  L.box(0.05, 0.25, 0.35, 0.55, 0, 0.07, "steel", { tint: [0.1, 0.1, 0.1] });
  L.box(0.08, 0.12, 0.33, 0.57, 0.07, 0.1, "steel", { tint: [0.12, 0.12, 0.12] });
  // A mug, and a stack of folders in manila and one green.
  L.frustum(0.2, 0.05, 0, 0.1, 0.04, 0.045, 8, "painted", { tint: [1.5, 1.5, 1.4] }, false, true);
  for (let k = 0; k < 4; k++) L.box(-0.05 + 0.01 * (k % 2), 0.2, 0.05 + 0.01 * (k % 3), 0.35, k * 0.025, (k + 1) * 0.025, "paper", { tint: k === 2 ? [0.4, 0.6, 0.45] : [0.85, 0.7, 0.45] });
  // The banker's lamp: a brass stem and a green glass shade that glows.
  L.box(-0.2, -0.05, -0.1, 0.0, 0, 0.03, "brass");
  L.box(-0.14, -0.11, -0.06, -0.04, 0.03, 0.3, "brass", undefined, true, false);
  L.box(-0.24, 0.0, -0.1, 0.05, 0.3, 0.36, "painted", { glow: 1.6, tint: [0.3, 0.8, 0.45] });
  L.box(-0.24, 0.0, -0.1, 0.05, 0.36, 0.38, "brass");
}

/** A board with papers pinned to it and string between the pins: a timber frame, cork, a dozen sheets of different sizes, red pins and a red string running from one to another. No faces and no names. */
export function pinBoard(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.03, -w, w, y0, y1, "dark_wood", { tint: [0.9, 0.9, 0.9] }, false);
  L.poly([[0.032, -w + 0.04, y0 + 0.04], [0.032, w - 0.04, y0 + 0.04], [0.032, w - 0.04, y1 - 0.04], [0.032, -w + 0.04, y1 - 0.04]], [1, 0, 0], "painted", { tint: [1.0, 0.7, 0.4] });
  const pins: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const r = -w + 0.12 + hash01(k * 7 + dc.id, 150) * (2 * w - 0.34);
    const y = y0 + 0.1 + hash01(k * 11 + dc.id, 151) * (dc.h - 0.34);
    const pw = 0.09 + 0.07 * hash01(k, 152);
    const ph = 0.11 + 0.08 * hash01(k, 153);
    L.poly([[0.034 + 0.0005 * k, r, y], [0.034 + 0.0005 * k, r + pw, y], [0.034 + 0.0005 * k, r + pw, y + ph], [0.034 + 0.0005 * k, r, y + ph]], [1, 0, 0], "paper", { tint: [1.2 - 0.12 * hash01(k, 154), 1.2 - 0.1 * hash01(k, 155), 1.1] });
    // Two grey lines of illegible type on each sheet.
    for (const f of [0.35, 0.65]) L.poly([[0.0365, r + 0.012, y + ph * f], [0.0365, r + pw - 0.012, y + ph * f], [0.0365, r + pw - 0.012, y + ph * f + 0.006], [0.0365, r + 0.012, y + ph * f + 0.006]], [1, 0, 0], "painted", { tint: [0.4, 0.4, 0.4] });
    pins.push([r + pw / 2, y + ph - 0.015]);
    L.poly([[0.038, r + pw / 2 - 0.008, y + ph - 0.023], [0.038, r + pw / 2 + 0.008, y + ph - 0.023], [0.038, r + pw / 2 + 0.008, y + ph - 0.007], [0.038, r + pw / 2 - 0.008, y + ph - 0.007]], [1, 0, 0], "painted", { tint: [1.4, 0.1, 0.08] });
  }
  // The string from pin to pin, as thin quads.
  for (let k = 0; k + 1 < pins.length; k++) {
    const [r0, a0] = pins[k] as [number, number];
    const [r1, a1] = pins[k + 1] as [number, number];
    L.poly([[0.039, r0, a0], [0.039, r1, a1], [0.039, r1, a1 + 0.004], [0.039, r0, a0 + 0.004]], [1, 0, 0], "painted", { tint: [1.1, 0.12, 0.1] });
  }
}

/** A small framed certificate: a dark frame, a cream sheet, lines of illegible type and a seal. */
export function certificate(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const w = dc.w / 2;
  const y0 = dc.y - dc.h / 2;
  const y1 = dc.y + dc.h / 2;
  L.box(0, 0.025, -w, w, y0, y1, "dark_wood", { tint: [0.8, 0.8, 0.8] }, false);
  L.poly([[0.027, -w + 0.02, y0 + 0.02], [0.027, w - 0.02, y0 + 0.02], [0.027, w - 0.02, y1 - 0.02], [0.027, -w + 0.02, y1 - 0.02]], [1, 0, 0], "paper", { tint: [1.25, 1.2, 1.0] });
  for (let k = 0; k < 6; k++) {
    const y = y1 - 0.06 - k * (dc.h - 0.14) * 0.13;
    const half = (w - 0.05) * (k === 0 ? 0.6 : 0.9 - 0.1 * (k % 2));
    L.poly([[0.029, -half, y], [0.029, half, y], [0.029, half, y + 0.005], [0.029, -half, y + 0.005]], [1, 0, 0], "painted", { tint: [0.35, 0.35, 0.38] });
  }
  L.frustum(0.03, w * 0.45, y0 + 0.05, y0 + 0.052, 0.025, 0.025, 8, "painted", { tint: [1.3, 0.2, 0.15] }, false, true);
}
