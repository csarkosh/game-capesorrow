/**
 * What fills a room's floor and what stands on its furniture, derived from the unit's own record and a hash of the furnishing: chairs
 * round a table (pulled out at odd angles, a different chair for each in a mismatched room), the napkins, caddies, plates and mugs on
 * a table, a booth's two benches, the register, the pastry case and the urns on a counter, stock on a shelf, a desk's screen, lamp and
 * papers, a checkout lane, an endcap, bins and barrels, a cart, a couch, a jukebox, file cabinets, a water cooler, a plant, the jog and the
 * half wall of the back partition, and what hangs from the ceiling. The plan (`interiors.ts`) places the anchors only.
 *
 * Detail is where it is seen: a thing on a table is drawn within about 8 m of the glass, a chair on both tiers' near rows, and nothing
 * behind the partition. Every small thing stands ON what carries it with its own faces 3 cm or more clear of any parallel face.
 */
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { pickOf } from "./buildingKit.js";
import { BAKED, fbox, fcyl, shade, xd, xp, type Ctx } from "./roomKit.js";
import type { Furnishing } from "../../sim/town/types.js";

const AX = { x: 1, z: 0 };
export const NEAR = 9;
export const H = (c: Ctx, k: number, salt = 0): number => hash01(c.seed * 131 + k, 900 + salt);
const dirOf = (f: Furnishing): { x: number; z: number } => ({ x: f.dir.x, z: f.dir.z });
export const up = (v: Rgb, k: number): Rgb => [Math.min(1, v[0] * k), Math.min(1, v[1] * k), Math.min(1, v[2] * k)];

/** A rectangle a thing stands on, in the frame, for what must stand clear of it (a chair, a cone). */
export type Foot = { readonly i: number; readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly h: number };

export type Style = {
  /** Chrome stools and chairs, a long counter, black and white tile: an old diner. */
  readonly chrome: boolean;
  /** Mismatched wooden chairs and a couch: a young cafe. */
  readonly mismatched: boolean;
  readonly modern: boolean;
  readonly seat: readonly Rgb[];
  readonly top: Rgb;
  readonly top2: Rgb;
  readonly metal: Rgb;
};

const WOODS: readonly Rgb[] = [[0.42, 0.27, 0.14], [0.58, 0.42, 0.24], [0.3, 0.2, 0.12], [0.66, 0.55, 0.38], [0.36, 0.34, 0.3], [0.5, 0.18, 0.12], [0.2, 0.32, 0.34], [0.7, 0.66, 0.55]];
const VINYL: readonly Rgb[] = [[0.62, 0.12, 0.1], [0.1, 0.32, 0.34], [0.12, 0.3, 0.16], [0.7, 0.55, 0.15], [0.15, 0.2, 0.4], [0.3, 0.16, 0.1]];

export function styleOf(seed: number, trade: string | null, era: number, opened: number, remodel: number): Style {
  const h = (k: number): number => hash01(seed, 1000 + k);
  const youth = Math.max(opened, remodel);
  const chrome = (trade === "diner" || (trade === "restaurant" && h(1) < 0.3) || (trade === "pizza and burgers" && h(1) < 0.5)) && (opened < 1985 || era < 1965) && h(2) < 0.85;
  const modern = youth >= 1990;
  const mismatched = !chrome && (modern ? h(3) < 0.7 : h(3) < 0.25);
  const base = pickOf(WOODS, seed, 1010);
  const seat: Rgb[] = chrome ? [pickOf(VINYL, seed, 1011)] : mismatched ? [0, 1, 2, 3, 4].map((k) => pickOf(WOODS, seed + k * 17, 1012)) : [base];
  const top: Rgb = chrome ? pickOf([[0.72, 0.7, 0.62], [0.6, 0.66, 0.66], [0.78, 0.74, 0.66]] as readonly Rgb[], seed, 1013) : h(4) < 0.5 ? pickOf(WOODS, seed, 1014) : pickOf([[0.75, 0.72, 0.64], [0.3, 0.28, 0.26], [0.55, 0.6, 0.55]] as readonly Rgb[], seed, 1015);
  return { chrome, mismatched, modern, seat, top, top2: pickOf(WOODS, seed + 5, 1016), metal: [0.66, 0.67, 0.7] };
}

/** True when a spot is clear of the furnishings (except `skip`), of the chairs already stood, of the walls and of the door's way. */
export function free(c: Ctx, s: number, d: number, r: number, skip: number): boolean {
  if (d < 0.6 || d > c.d1 - 0.45 || s < c.s0 + 0.3 || s > c.s1 - 0.3) return false;
  if (Math.abs(s - c.door.s) < c.door.w / 2 + 0.45 + r && d < 2.4) return false;
  for (const f of c.feet) if (f.i !== skip && s > f.s0 - r && s < f.s1 + r && d > f.d0 - r && d < f.d1 + r) return false;
  for (const [a, b] of c.chairs) if (Math.abs(a - s) < 0.44 && Math.abs(b - d) < 0.44) return false;
  return true;
}

/** One chair at (s, d) facing the unit vector (fs, fd): a seat and a back, a few centimetres each way from true. */
export function chair(c: Ctx, s: number, d: number, fs: number, fd: number, col: Rgb, kind: number, yb = 0): void {
  c.chairs.push([s, d]);
  const dir = { x: -fd, z: fs };
  const seatTop = kind === 1 ? 0.48 : 0.45;
  const seat = kind === 1 ? [0.62, 0.1, 0.08] as Rgb : col;
  fbox(c, s, d, yb + 0.04, seatTop - 0.04, 0.2, 0.2, dir, kind === 1 ? c.style.metal : col, up(seat, 1.15), BAKED, false);
  fbox(c, s - fs * 0.18, d - fd * 0.18, yb + seatTop, kind === 1 ? 0.5 : 0.52, 0.19, 0.025, dir, kind === 1 ? c.style.metal : scaled(col, 0.92), kind === 1 ? seat : col, BAKED, false);
}

/** The colour and kind of the k-th chair of furnishing i. */
function chairLook(c: Ctx, i: number, k: number): { col: Rgb; kind: number } {
  const st = c.style;
  return { col: st.seat[(st.mismatched ? Math.floor(H(c, i * 7 + k, 1) * st.seat.length) : 0) % st.seat.length] as Rgb, kind: st.chrome ? 1 : 0 };
}

/** Chairs round a table (a round or a rectangular top) by its size and a roll of its own; some pulled out and turned. */
function chairsAround(c: Ctx, f: Furnishing, i: number): void {
  if (c.detail === "low") return;
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const roll = H(c, i, 2);
  const longSide = f.sx >= 1.05;
  const slots: { u: number; v: number; sg: number; alongP: boolean }[] = [];
  const n = f.sx * f.sd < 0.5 ? 2 : longSide ? (roll < 0.5 ? 4 : 3) : roll < 0.3 ? 2 : roll < 0.7 ? 3 : 4;
  // The long sides first, then the ends.
  if (longSide) {
    slots.push({ u: -f.sx * 0.22, v: 1, sg: 1, alongP: true }, { u: f.sx * 0.22, v: -1, sg: -1, alongP: true }, { u: f.sx * 0.22, v: 1, sg: 1, alongP: true }, { u: -f.sx * 0.22, v: -1, sg: -1, alongP: true });
  } else {
    slots.push({ u: 0, v: 1, sg: 1, alongP: true }, { u: 0, v: -1, sg: -1, alongP: true }, { u: 1, v: 0, sg: 1, alongP: false }, { u: -1, v: 0, sg: -1, alongP: false });
  }
  for (let k = 0; k < Math.min(n, slots.length); k++) {
    const sl = slots[k] as (typeof slots)[number];
    const pull = 0.33 + H(c, i * 5 + k, 3) * 0.2 + (c.style.mismatched ? 0.06 : 0);
    let cs: number;
    let cd: number;
    let fs: number;
    let fd: number;
    if (sl.alongP) {
      cs = f.s + dir.x * sl.u + px * sl.v * (f.sd / 2 + pull);
      cd = f.d + dir.z * sl.u + pd * sl.v * (f.sd / 2 + pull);
      fs = -px * sl.v;
      fd = -pd * sl.v;
    } else {
      cs = f.s + dir.x * sl.u * (f.sx / 2 + pull);
      cd = f.d + dir.z * sl.u * (f.sx / 2 + pull);
      fs = -dir.x * sl.u;
      fd = -dir.z * sl.u;
    }
    // Turned a little: a chair is never square to the table.
    const a = (H(c, i * 11 + k, 4) - 0.5) * (c.style.chrome ? 0.3 : 0.75);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rs = fs * ca - fd * sa;
    const rd = fs * sa + fd * ca;
    if (!free(c, cs, cd, 0.27, i)) continue;
    const { col, kind } = chairLook(c, i, k);
    chair(c, cs, cd, rs, rd, col, kind);
  }
}

/** Things left on a table top at (s, d), the top at `ty`: napkins, a caddy, a plate and a mug, a menu stand, bottles, a flower in a vase, now and then two chairs stacked; several reach 1.0 to 1.2 m, so that they show over a sill. */
function onTable(c: Ctx, f: Furnishing, i: number, ty: number, span: number): void {
  if (f.d > NEAR + 1 || c.detail === "low") return;
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const at = (u: number, v: number): [number, number] => [f.s + dir.x * u + px * v, f.d + dir.z * u + pd * v];
  const n = H(c, i, 5) < 0.12 ? 0 : span < 0.75 ? 1 + (H(c, i, 6) < 0.5 ? 1 : 0) : 2 + (H(c, i, 6) < 0.35 ? 1 : 0);
  const lo = 0.17;
  // Three places along the long axis, taken in an order of the table's own so that no two tables read alike.
  const order = H(c, i, 8) < 0.5 ? [0, 1, -1] : [1, -1, 0];
  for (let k = 0; k < n; k++) {
    const kind = Math.floor(H(c, i * 3 + k, 7) * 8);
    const u = (order[k] as number) * lo;
    const [s, d] = at(u, (H(c, i + k, 9) - 0.5) * 0.1);
    const col = pickOf([[0.8, 0.8, 0.76], [0.15, 0.3, 0.35], [0.6, 0.15, 0.1], [0.85, 0.7, 0.2]] as readonly Rgb[], c.seed + i + k, 1020);
    if (kind === 0) fbox(c, s, d, ty, 0.1, 0.05, 0.04, dir, c.style.metal, up(c.style.metal, 1.1), BAKED, false);
    else if (kind === 1) { fbox(c, s, d, ty, 0.1, 0.06, 0.04, dir, [0.78, 0.4, 0.12], [0.85, 0.5, 0.2], BAKED, false); fcyl(c, s, d, ty + 0.1, 0.02, 0.14, 4, [0.8, 0.12, 0.08], [0.85, 0.2, 0.12], 0.012); }
    else if (kind === 2) { fcyl(c, s, d, ty, 0.12, 0.03, 6, [0.88, 0.88, 0.84], [0.94, 0.94, 0.9]); fcyl(c, s + 0.05, d, ty + 0.03, 0.04, 0.09, 5, col, [0.15, 0.1, 0.07]); }
    else if (kind === 3) { fcyl(c, s, d, ty, 0.035, 0.16, 5, [0.5, 0.65, 0.6], [0.14, 0.4, 0.16], 0.025); fcyl(c, s, d, ty + 0.16, 0.07, 0.22, 5, [0.2, 0.45, 0.18], [0.85, 0.3, 0.4], 0.02); }
    else if (kind === 4) { fbox(c, s, d, ty, 0.3, 0.07, 0.012, dir, [0.2, 0.15, 0.1], [0.2, 0.15, 0.1], BAKED, false); fbox(c, s, d, ty + 0.05, 0.2, 0.035, 0.045, dir, [0.9, 0.88, 0.8], [0.9, 0.88, 0.8], BAKED, false); }
    else if (kind === 5) { fcyl(c, s, d, ty, 0.04, 0.3, 5, col, [0.7, 0.7, 0.66], 0.02); fcyl(c, s + 0.1, d, ty, 0.035, 0.26, 5, scaled(col, 0.7), [0.7, 0.7, 0.66], 0.02); }
    else if (kind === 6 && k === 0 && H(c, i, 10) < 0.5) {
      // Two chairs stacked on the table, the upper one a hand forward and aside so that no face of one lies on a face of the other.
      const fs = -pd;
      const fd = px;
      chair(c, s, d, fs, fd, c.style.seat[0] as Rgb, c.style.chrome ? 1 : 0, ty);
      chair(c, s + px * 0.04 - fs * 0.0 + dir.x * 0.04, d + pd * 0.04 + dir.z * 0.04, fs, fd, c.style.seat[0] as Rgb, c.style.chrome ? 1 : 0, ty + 0.14);
    } else fcyl(c, s, d, ty, 0.05, 0.4, 6, [0.5, 0.15, 0.1], [0.4, 0.1, 0.08], 0.03);
  }
}

function folded(c: Ctx, f: Furnishing, i: number, ty: number): void {
  const dir = dirOf(f);
  const n = Math.max(2, Math.floor(f.sx / 0.34));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const hgt = 0.08 + Math.floor(H(c, i * 9 + k, 9) * 4) * 0.06;
    const col = pickOf([[0.6, 0.2, 0.25], [0.2, 0.3, 0.5], [0.85, 0.8, 0.7], [0.3, 0.45, 0.35], [0.5, 0.5, 0.52], [0.7, 0.55, 0.2]] as readonly Rgb[], c.seed + i * 13 + k, 1021);
    fbox(c, f.s + dir.x * u, f.d + dir.z * u, ty, hgt, (f.sx / n) * 0.4, Math.min(0.28, f.sd * 0.34), dir, col, up(col, 1.15), BAKED, false);
  }
}

/** A table: a top on a post, the chairs round it, and what is on it (folded stacks in a clothing shop). */
export function tableSet(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const st = c.style;
  const hgt = f.h;
  const top = hgt < 0.6 ? scaled(st.top2, 1) : H(c, i, 10) < 0.35 ? st.top2 : st.top;
  const round = f.sx === f.sd && f.sx <= 0.9 && f.sx >= 0.7 && H(c, i, 11) < 0.35 && f.dir.x === 1;
  const ty = hgt;
  if (round) fcyl(c, f.s, f.d, ty - 0.04, f.sx / 2, 0.04, 8, scaled(top, 0.8), top);
  else fbox(c, f.s, f.d, ty - 0.04, 0.04, f.sx / 2, f.sd / 2, dir, scaled(top, 0.8), top);
  fbox(c, f.s, f.d, 0, ty - 0.04, 0.04, 0.04, dir, [0.15, 0.15, 0.16], [0.15, 0.15, 0.16], BAKED, false);
  if (c.detail === "low") return;
  if (c.trade !== null && RACKS.includes(c.trade)) folded(c, f, i, ty);
  else if (hgt > 0.6) {
    onTable(c, f, i, ty, Math.min(f.sx, f.sd));
    chairsAround(c, f, i);
  }
}
const RACKS = ["clothing", "thrift store", "sporting goods", "game shop", "variety store", "video store"];

/**
 * A booth: a bench on each long side with a tall back of slats (gaps between them to see through), a table between with upright things on it.
 * In a window it stands with its long axis into the room, so the street sees its two backs end-on and the table between them.
 */
export function booth(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const vinyl: Rgb = c.style.chrome ? c.style.seat[0] as Rgb : pickOf(VINYL, c.seed + i, 315);
  const wood: Rgb = H(c, i, 12) < 0.5 ? scaled(vinyl, 0.8) : pickOf(WOODS, c.seed + i, 1022);
  const half = f.sd / 2;
  const slats = Math.max(3, Math.floor(f.sx / 0.4));
  for (const sg of [-1, 1]) {
    const mid = (half - 0.25) * sg;
    fbox(c, f.s + px * mid, f.d + pd * mid, 0, 0.45, f.sx / 2, 0.25, dir, vinyl, up(vinyl, 1.2));
    if (c.detail === "low") { fbox(c, f.s + px * (half - 0.04) * sg, f.d + pd * (half - 0.04) * sg, 0.45, 0.65, f.sx / 2, 0.04, dir, wood, wood); continue; }
    // The back: slats with gaps between, over a rail.
    const back = (half - 0.04) * sg;
    fbox(c, f.s + px * back, f.d + pd * back, 0.45, 0.12, f.sx / 2, 0.04, dir, wood, wood);
    for (let k = 0; k < slats; k++) {
      const u = -f.sx / 2 + ((k + 0.5) * f.sx) / slats;
      fbox(c, f.s + dir.x * u + px * back, f.d + dir.z * u + pd * back, 0.57, 0.53, (f.sx / slats) * 0.32, 0.04, dir, wood, wood, BAKED, false);
    }
  }
  const ty = 0.74;
  fbox(c, f.s, f.d, ty - 0.04, 0.04, f.sx / 2 - 0.1, 0.32, dir, scaled(c.style.top, 0.8), c.style.top);
  fbox(c, f.s, f.d, 0, ty - 0.04, 0.05, 0.05, dir, [0.15, 0.15, 0.16], [0.15, 0.15, 0.16], BAKED, false);
  onTable(c, { ...f, sx: f.sx - 0.2, sd: 0.64 }, i, ty, 0.8);
}

/** Stools at a counter: chrome with a red seat in an old diner, plain wood otherwise; one turned out. */
export function stools(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const n = Math.max(1, Math.floor(f.sx / 0.64));
  const seat: Rgb = c.style.chrome ? [0.62, 0.1, 0.08] : pickOf(VINYL, c.seed, 1023);
  const post: Rgb = c.style.chrome ? c.style.metal : [0.3, 0.2, 0.12];
  for (let k = 0; k < n; k++) {
    if (H(c, i * 17 + k, 13) < 0.06) continue;
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const s = f.s + dir.x * u + (H(c, k, 14) - 0.5) * 0.06;
    const d = f.d + dir.z * u;
    fbox(c, s, d, 0, 0.6, 0.03, 0.03, dir, post, post, BAKED, false);
    fbox(c, s, d, 0.6, 0.07, 0.17, 0.17, dir, seat, up(seat, 1.2), BAKED, false);
  }
}

const FOOD = ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers"];

function cupStack(c: Ctx, s: number, d: number, y: number, n: number): void {
  fcyl(c, s, d, y, 0.045, 0.045 * n, 6, [0.92, 0.9, 0.86], [0.95, 0.93, 0.9], 0.05);
}

/** What stands on a counter by its role: a service counter, a back counter, a bar, a shop's till counter, an office's. */
export function counterTop(c: Ctx, f: Furnishing, i: number): void {
  if (c.detail === "low" || f.d > NEAR + 4) return;
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const ct = f.h * 0.92 + 0.05;
  const at = (u: number, v: number): [number, number] => [f.s + dir.x * u + px * v, f.d + dir.z * u + pd * v];
  const L = f.sx;
  const tr = c.trade;
  const back = f.d > c.d1 - 1.7;
  const food = tr !== null && FOOD.includes(tr);
  const room = L - 0.7;
  if (room < 0.4) return;
  if (c.type === "bar") {
    // Taps on a tower, pint glasses, a tip jar, a drip mat.
    const [ts, td] = at(L * 0.18, 0);
    fbox(c, ts, td, ct, 0.2, 0.22, 0.05, dir, c.style.metal, up(c.style.metal, 1.1));
    for (let k = 0; k < 4; k++) { const [s, d] = at(L * 0.18 - 0.15 + k * 0.1, 0); fbox(c, s, d, ct + 0.2, 0.1, 0.015, 0.015, dir, pickOf([[0.6, 0.1, 0.1], [0.15, 0.3, 0.15], [0.7, 0.55, 0.15], [0.2, 0.2, 0.25]] as readonly Rgb[], c.seed + k, 1030), [0.7, 0.7, 0.7], BAKED, false); }
    for (let k = 0; k < 3; k++) { const [s, d] = at(-L * 0.22 + k * 0.2, 0.1 * (k % 2 === 0 ? 1 : -1)); fcyl(c, s, d, ct, 0.04, 0.14, 5, [0.85, 0.7, 0.3], [0.9, 0.78, 0.4], 0.045); }
    const [js, jd] = at(-L * 0.4, 0);
    fcyl(c, js, jd, ct, 0.05, 0.14, 6, [0.78, 0.82, 0.82], [0.2, 0.5, 0.2]);
    return;
  }
  if (food && back) {
    // The back counter: an espresso machine, urns, cups and a row of mugs.
    const [es, ed] = at(-L * 0.2, 0);
    fbox(c, es, ed, ct, 0.36, 0.3, 0.2, dir, [0.38, 0.38, 0.4], [0.62, 0.12, 0.08]);
    fbox(c, es, ed, ct + 0.36, 0.05, 0.26, 0.16, dir, [0.55, 0.55, 0.58], [0.7, 0.7, 0.72]);
    for (let k = 0; k < 2; k++) {
      const [us, ud] = at(L * 0.12 + k * 0.4, 0);
      fcyl(c, us, ud, ct, 0.11, 0.46, 7, [0.62, 0.62, 0.65], [0.7, 0.7, 0.72]);
      fcyl(c, us, ud, ct + 0.46, 0.06, 0.05, 6, [0.2, 0.2, 0.2], [0.25, 0.25, 0.25]);
    }
    const [cs2, cd2] = at(L * 0.42, 0);
    cupStack(c, cs2, cd2, ct, 5);
    for (let k = 0; k < 4; k++) { const [s, d] = at(-L * 0.42 + k * 0.1, 0.12); if (k < 3) fcyl(c, s, d, ct, 0.04, 0.09, 5, pickOf([[0.8, 0.8, 0.76], [0.15, 0.3, 0.35], [0.6, 0.15, 0.1]] as readonly Rgb[], c.seed + k, 1031), [0.15, 0.1, 0.07]); }
    return;
  }
  if (food) {
    // The service counter: the pastry case, a tip jar, a stack of cups; the till is the counter's own.
    const cw = Math.min(0.5, room * 0.28);
    const [ps, pd2] = at(L * 0.28, 0);
    fbox(c, ps, pd2, ct, 0.06, cw, Math.min(0.26, f.sd * 0.4), dir, c.style.metal, [0.5, 0.5, 0.52]);
    const shapes = Math.max(3, Math.floor((cw * 2) / 0.14));
    for (let k = 0; k < shapes; k++) {
      const [s, d] = at(L * 0.28 - cw + (k + 0.5) * ((cw * 2) / shapes), 0);
      const col = pickOf([[0.62, 0.4, 0.2], [0.8, 0.55, 0.65], [0.85, 0.75, 0.5], [0.45, 0.25, 0.12], [0.9, 0.85, 0.75]] as readonly Rgb[], c.seed + k * 5 + i, 1032);
      fbox(c, s, d, ct + 0.06, 0.05 + (k % 3) * 0.025, (cw / shapes) * 0.8, 0.09, dir, col, up(col, 1.15), BAKED, false);
    }
    fbox(c, ps, pd2, ct + 0.3, 0.03, cw + 0.02, Math.min(0.26, f.sd * 0.4) + 0.02, dir, [0.62, 0.72, 0.76], [0.75, 0.85, 0.9], c.lit ? 0.9 : BAKED);
    const [js, jd] = at(-L * 0.38, 0.08);
    fcyl(c, js, jd, ct, 0.05, 0.15, 6, [0.78, 0.82, 0.82], [0.2, 0.5, 0.2]);
    const [cs2, cd2] = at(-L * 0.38, -0.12);
    cupStack(c, cs2, cd2, ct, 6);
    return;
  }
  if (c.type === "office" || c.type === "lobby") {
    // A reception counter with someone's things on it: a screen, a lamp, a holder of leaflets, a framed photo, a bell, a mug.
    const [ms, md] = at(-L * 0.25, 0);
    fbox(c, ms, md, ct, 0.04, 0.1, 0.08, dir, [0.15, 0.15, 0.17], [0.2, 0.2, 0.22], BAKED, false);
    fbox(c, ms, md, ct + 0.04, 0.3, 0.2, 0.025, dir, [0.07, 0.07, 0.08], [0.1, 0.1, 0.1], c.lit ? 0.9 : BAKED);
    const [ls, ld] = at(L * 0.05, 0.05);
    fcyl(c, ls, ld, ct, 0.06, 0.03, 5, [0.15, 0.15, 0.16], [0.2, 0.2, 0.2]);
    fcyl(c, ls, ld, ct + 0.03, 0.015, 0.3, 4, [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]);
    fcyl(c, ls, ld, ct + 0.33, 0.11, 0.12, 6, [0.8, 0.65, 0.2], [0.9, 0.8, 0.4], 0.05);
    const [hs, hd] = at(L * 0.3, 0);
    fbox(c, hs, hd, ct, 0.3, 0.1, 0.04, dir, [0.5, 0.5, 0.52], [0.6, 0.6, 0.62], BAKED, false);
    for (let k = 0; k < 3; k++) fbox(c, hs, hd, ct + 0.08 + k * 0.07, 0.05, 0.06, 0.075, dir, pickOf([[0.8, 0.2, 0.15], [0.2, 0.4, 0.7], [0.9, 0.8, 0.3]] as readonly Rgb[], c.seed + k + i, 1034), [0.9, 0.9, 0.9], BAKED, false);
    const [fs2, fd2] = at(-L * 0.42, 0.05);
    fbox(c, fs2, fd2, ct, 0.2, 0.07, 0.015, dir, [0.3, 0.2, 0.12], [0.5, 0.5, 0.45], BAKED, false);
    return;
  }
  if (tr === "bank" || tr === "credit union" || tr === "post office" || tr === "pharmacy" || tr === "bookstore" || tr === "medical clinic" || tr === "dentist") {
    const [s, d] = at(L * 0.3, 0);
    fbox(c, s, d, ct, 0.18, 0.1, 0.07, dir, [0.15, 0.32, 0.5], [0.2, 0.4, 0.6]);
    const [s2, d2] = at(-L * 0.38, 0.05);
    fbox(c, s2, d2, ct, 0.06, 0.1, 0.07, dir, [0.9, 0.9, 0.86], [0.95, 0.95, 0.92], BAKED, false);
    return;
  }
  // A shop's till counter: a candy rack, a bag stack and a tray of small things.
  const [rs, rd] = at(L * 0.32, 0);
  for (let k = 0; k < 3; k++) {
    const col = pickOf([[0.8, 0.15, 0.1], [0.15, 0.4, 0.7], [0.9, 0.75, 0.1], [0.2, 0.55, 0.3], [0.9, 0.9, 0.85]] as readonly Rgb[], c.seed + k * 3, 1033);
    fbox(c, rs, rd, ct + k * 0.1, 0.1, 0.12, 0.08, dir, col, up(col, 1.15), BAKED, false);
  }
  const [bs, bd] = at(-L * 0.36, 0.05);
  fbox(c, bs, bd, ct, 0.12, 0.1, 0.08, dir, [0.55, 0.4, 0.22], [0.6, 0.46, 0.28], BAKED, false);
  void px;
}

/** A desk: the screen on its foot, a keyboard, papers, a lamp and a mug; the chair behind it, turned a little. */
export function deskSet(c: Ctx, f: Furnishing, i: number): void {
  if (c.detail === "low") return;
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const ty = 0.75;
  const at = (u: number, v: number): [number, number] => [f.s + dir.x * u + px * v, f.d + dir.z * u + pd * v];
  const [ks, kd] = at(-f.sx * 0.1, -f.sd * 0.2);
  fbox(c, ks, kd, ty, 0.03, 0.17, 0.06, dir, [0.18, 0.18, 0.2], [0.22, 0.22, 0.24], BAKED, false);
  if (f.d < NEAR + 3) {
    for (let k = 0; k < 2; k++) {
      if (H(c, i + k, 15) < 0.25) continue;
      const [s, d] = at(f.sx * (0.3 + k * 0.1) - 0.05, f.sd * 0.1 * (k === 0 ? 1 : -1));
      fbox(c, s, d, ty, (k === 0 ? 0.05 : 0.11) + H(c, i * 5 + k, 16) * 0.03, 0.1, 0.07, dir, [0.85, 0.85, 0.8], [0.92, 0.92, 0.88], BAKED, false);
    }
    if (H(c, i, 17) < 0.6) {
      const [ls, ld] = at(-f.sx * 0.4, f.sd * 0.2);
      fcyl(c, ls, ld, ty, 0.06, 0.03, 5, [0.15, 0.15, 0.16], [0.2, 0.2, 0.2]);
      fcyl(c, ls, ld, ty + 0.03, 0.015, 0.26, 4, [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]);
      fcyl(c, ls, ld, ty + 0.29, 0.1, 0.1, 6, [0.1, 0.4, 0.2], [0.2, 0.5, 0.3], 0.04);
    }
  }
  // The staff's chair behind it (on the side away from the street), turned.
  const sg = pd >= 0 ? 1 : -1;
  const cs = f.s + px * sg * (f.sd / 2 + 0.36);
  const cd = f.d + pd * sg * (f.sd / 2 + 0.36);
  const a = (H(c, i, 18) - 0.5) * 0.9;
  if (free(c, cs, cd, 0.27, i)) chair(c, cs, cd, -px * sg * Math.cos(a) - -pd * sg * Math.sin(a), -px * sg * Math.sin(a) + -pd * sg * Math.cos(a), pickOf([[0.1, 0.12, 0.2], [0.2, 0.2, 0.22], [0.3, 0.14, 0.12]] as readonly Rgb[], c.seed + i, 314), 0);
}

/** A bench by a window or the wall, with cushions and a back; a high chair beside one in a cafe. */
export function benchSet(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const wood = pickOf([[0.3, 0.2, 0.12], [0.45, 0.3, 0.16], [0.3, 0.34, 0.3]] as readonly Rgb[], c.seed + i, 1040);
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, wood, up(wood, 1.25));
  if (c.detail === "low") return;
  const px = -dir.z;
  const pd = dir.x;
  let sg = pd >= 0 ? 1 : -1;
  if (Math.abs(dir.z) > 0.7) sg = f.s - c.s0 < c.s1 - f.s ? -1 : 1;
  fbox(c, f.s + px * sg * (f.sd / 2 - 0.02), f.d + pd * sg * (f.sd / 2 - 0.02), f.h, 0.55, f.sx / 2, 0.02, dir, scaled(wood, 0.9), wood, BAKED, false);
  // Cushions, each its own colour, one leaning.
  const n = Math.max(2, Math.floor(f.sx / 0.6));
  for (let k = 0; k < n; k++) {
    if (H(c, i * 5 + k, 41) < 0.15) continue;
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const col = pickOf([[0.6, 0.15, 0.12], [0.15, 0.35, 0.4], [0.8, 0.65, 0.2], [0.3, 0.4, 0.25], [0.55, 0.5, 0.45]] as readonly Rgb[], c.seed + i * 7 + k, 1047);
    fbox(c, f.s + dir.x * u + px * sg * (f.sd / 2 - 0.12), f.d + dir.z * u + pd * sg * (f.sd / 2 - 0.12), f.h + 0.03, 0.3 + (H(c, k + i, 42) < 0.3 ? 0.1 : 0), (f.sx / n) * 0.38, 0.06, dir, col, up(col, 1.2), BAKED, false);
  }
}

export function cabinets(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const col = pickOf([[0.5, 0.52, 0.5], [0.3, 0.38, 0.34], [0.6, 0.56, 0.45], [0.22, 0.24, 0.28]] as readonly Rgb[], c.seed + i, 1041);
  const n = Math.max(1, Math.floor(f.sx / 0.5));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const hgt = f.h - (k % 3 === 2 ? 0.45 : 0);
    fbox(c, f.s + dir.x * u, f.d + dir.z * u, 0, hgt, f.sx / n / 2 - 0.015, f.sd / 2, dir, col, up(col, 1.15));
    // Archive boxes and a binder or two on top, a plant on one.
    if (c.detail === "full" && f.d < NEAR + 3) {
      const r = H(c, i * 9 + k, 43);
      if (r < 0.55) {
        const bc = pickOf([[0.6, 0.5, 0.35], [0.85, 0.85, 0.8], [0.45, 0.35, 0.25]] as readonly Rgb[], c.seed + i + k, 1048);
        fbox(c, f.s + dir.x * u, f.d + dir.z * u, hgt, 0.28, f.sx / n / 2 - 0.1, f.sd / 2 - 0.08, dir, bc, up(bc, 1.15), BAKED, false);
        if (r < 0.25) fbox(c, f.s + dir.x * u, f.d + dir.z * u, hgt + 0.28, 0.26, f.sx / n / 2 - 0.14, f.sd / 2 - 0.12, dir, scaled(bc, 0.85), up(bc, 1.05), BAKED, false);
      } else if (r < 0.7) fcyl(c, f.s + dir.x * u, f.d + dir.z * u, hgt, 0.12, 0.3, 5, [0.2, 0.42, 0.18], [0.3, 0.55, 0.25], 0.02);
    }
  }
}

export function waterCooler(c: Ctx, f: Furnishing): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, 0.95, 0.15, 0.15, dir, [0.85, 0.86, 0.86], [0.9, 0.9, 0.9]);
  if (c.detail === "low") return;
  fcyl(c, f.s, f.d, 0.95, 0.13, 0.4, 8, [0.45, 0.66, 0.85], [0.5, 0.7, 0.9], 0.1);
}

export function plant(c: Ctx, f: Furnishing, i: number): void {
  const green = pickOf([[0.14, 0.36, 0.14], [0.2, 0.42, 0.18], [0.1, 0.3, 0.16]] as readonly Rgb[], c.seed + i, 1042);
  fcyl(c, f.s, f.d, 0, 0.17, 0.34, 6, pickOf([[0.55, 0.28, 0.16], [0.7, 0.7, 0.66], [0.2, 0.25, 0.4]] as readonly Rgb[], c.seed + i, 1043), [0.2, 0.12, 0.08]);
  if (c.detail === "low") return;
  for (let q = 0; q < 3; q++) fcyl(c, f.s + (q - 1) * 0.09, f.d + (q === 1 ? -0.05 : 0.04), 0.3, 0.14, Math.max(0.5, f.h + 0.25 - q * 0.15), 5, green, scaled(green, 1.3), 0.02);
}

/** A gondola's head: a stack of promotional cases, a sign on a post above. */
export function endcap(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, 0.2, f.sx / 2, f.sd / 2, dir, [0.3, 0.26, 0.22], [0.5, 0.5, 0.5]);
  if (c.detail === "low") return;
  const n = Math.max(2, Math.floor(f.sx / 0.32));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    if (H(c, i * 13 + k, 19) < 0.1) continue;
    const tiers = 1 + Math.floor(H(c, i * 7 + k, 20) * 4);
    const col = pickOf([[0.8, 0.15, 0.1], [0.9, 0.75, 0.1], [0.15, 0.45, 0.2], [0.2, 0.3, 0.6], [0.85, 0.85, 0.8], [0.9, 0.5, 0.1]] as readonly Rgb[], c.seed + i * 5 + k, 1044);
    for (let t = 0; t < tiers; t++) fbox(c, f.s + dir.x * u, f.d + dir.z * u, 0.2 + t * 0.25, 0.22, (f.sx / n) * 0.42, f.sd * 0.4, dir, col, up(col, 1.15), BAKED, false);
  }
  const sg = pickOf([[0.85, 0.15, 0.1], [0.95, 0.8, 0.1], [0.1, 0.45, 0.2]] as readonly Rgb[], c.seed + i, 1045);
  fbox(c, f.s, f.d, 1.45, 0.3, f.sx * 0.3, 0.015, dir, sg, sg, c.lit ? 1 : BAKED, false);
}

/** A checkout lane: a belt, a register at its far end, a candy rack at its head and a stack of baskets. */
export function checkout(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const at = (u: number, v: number): [number, number] => [f.s + dir.x * u - dir.z * v, f.d + dir.z * u + dir.x * v];
  fbox(c, f.s, f.d, 0, f.h * 0.9, f.sx / 2, f.sd / 2, dir, [0.5, 0.5, 0.52], [0.16, 0.16, 0.17]);
  if (c.detail === "low") return;
  // The cashier's end is the end nearer the window (the lane's lower d): the register stands there on the counter beside the belt.
  const sg = dir.z >= 0 ? -1 : 1;
  const [rs, rd] = at(sg * (f.sx / 2 - 0.2), 0);
  fbox(c, rs, rd, f.h * 0.9, 0.2, 0.18, 0.15, dir, [0.1, 0.1, 0.11], [0.12, 0.2, 0.15], c.lit ? 0.8 : BAKED);
  const [cs2, cd2] = at(-sg * (f.sx / 2 - 0.15), 0);
  for (let k = 0; k < 3; k++) {
    const col = pickOf([[0.8, 0.15, 0.1], [0.15, 0.4, 0.7], [0.9, 0.75, 0.1], [0.2, 0.55, 0.3]] as readonly Rgb[], c.seed + i * 3 + k, 1046);
    fbox(c, cs2, cd2, f.h * 0.9 + k * 0.1, 0.1, 0.1, 0.1, dir, col, up(col, 1.15), BAKED, false);
  }
  if (H(c, i, 21) < 0.7) {
    const [bs, bd] = at(sg * (f.sx / 2 - 0.65), 0);
    fbox(c, bs, bd, f.h * 0.9, 0.12, 0.2, 0.15, dir, [0.8, 0.2, 0.15], [0.85, 0.28, 0.2], BAKED, false);
  }
}

/** A bin by the trade: a produce bin, a barrel of this and that, a bin of hardware, a coil of rope, a stack of tyres. */
export function bin(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const t = c.trade;
  const roll = H(c, i, 22);
  const col = pickOf([[0.15, 0.3, 0.5], [0.15, 0.4, 0.2], [0.6, 0.25, 0.12], [0.3, 0.3, 0.32], [0.7, 0.1, 0.08]] as readonly Rgb[], c.seed + i, 1050);
  if (t === "auto parts" && roll < 0.5) {
    const r = Math.min(f.sx, f.sd) / 2;
    for (let k = 0; k < 3; k++) fcyl(c, f.s, f.d, k * 0.24, r * 0.95, 0.22, 8, [0.12, 0.12, 0.13], [0.2, 0.2, 0.2]);
    return;
  }
  if (roll < 0.35) {
    const r = Math.min(f.sx, f.sd) / 2;
    fcyl(c, f.s, f.d, 0, r, f.h, 8, col, scaled(col, 0.5));
    if (c.detail === "full") fcyl(c, f.s, f.d, f.h + 0.03, r * 0.78, 0.04, 8, [0.45, 0.35, 0.2], [0.5, 0.4, 0.25]);
    return;
  }
  if (roll < 0.5 && (t === "marine supply" || t === "bait and tackle" || t === "garden and feed")) {
    fcyl(c, f.s, f.d, 0, Math.min(f.sx, f.sd) / 2, 0.26, 8, [0.62, 0.5, 0.3], [0.7, 0.58, 0.36]);
    return;
  }
  fbox(c, f.s, f.d, 0, f.h * 0.7, f.sx / 2, f.sd / 2, dir, col, scaled(col, 0.6));
  if (c.detail === "low") return;
  const goods = (k: number): Rgb => pickOf(t === "grocery" || t === "convenience store" ? [[0.8, 0.15, 0.1], [0.9, 0.6, 0.1], [0.3, 0.55, 0.15], [0.55, 0.15, 0.3]] as readonly Rgb[] : [[0.5, 0.5, 0.52], [0.8, 0.65, 0.1], [0.7, 0.15, 0.1], [0.2, 0.3, 0.5]] as readonly Rgb[], c.seed + i * 3 + k, 1051);
  const n = Math.max(2, Math.floor(f.sx / 0.3));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const g = goods(k);
    fbox(c, f.s + dir.x * u, f.d + dir.z * u, f.h * 0.7 + 0.04, 0.06 + H(c, i * 7 + k, 23) * 0.08, (f.sx / n) * 0.38, f.sd * 0.34, dir, g, up(g, 1.2), BAKED, false);
  }
}

/** A cart: a corral of nested shopping carts, a laundry basket on wheels, or a bus tub cart. */
export function cart(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const t = c.trade;
  const metal: Rgb = [0.62, 0.64, 0.66];
  if (t === "grocery" || t === "convenience store") {
    const n = 2 + Math.floor(H(c, i, 24) * 3);
    for (let k = 0; k < n; k++) {
      const u = -f.sx / 2 + 0.3 + k * Math.max(0.2, (f.sx - 0.6) / Math.max(1, n - 1)) * 0.9;
      fbox(c, f.s + dir.x * u, f.d + dir.z * u, 0.5, 0.35 + k * 0.01, 0.2, f.sd / 2 - 0.05, dir, metal, [0.7, 0.72, 0.74], BAKED, false);
      fbox(c, f.s + dir.x * u, f.d + dir.z * u, 0.05, 0.43, 0.02, f.sd / 2 - 0.1, dir, [0.3, 0.3, 0.32], [0.3, 0.3, 0.32], BAKED, false);
      fbox(c, f.s + dir.x * (u - 0.2), f.d + dir.z * (u - 0.2), 0.93, 0.03, 0.02, f.sd / 2 - 0.1, dir, [0.75, 0.15, 0.1], [0.85, 0.2, 0.15], BAKED, false);
    }
    return;
  }
  if (t === "laundromat") {
    fbox(c, f.s, f.d, 0.22, 0.6, f.sx / 2, f.sd / 2, dir, [0.2, 0.45, 0.7], [0.3, 0.55, 0.8]);
    fbox(c, f.s, f.d, 0.04, 0.18, f.sx / 2 - 0.04, f.sd / 2 - 0.04, dir, [0.3, 0.3, 0.32], [0.3, 0.3, 0.32], BAKED, false);
    return;
  }
  // A bus tub cart: two shelves on posts with grey tubs.
  for (const y of [0.2, 0.7]) fbox(c, f.s, f.d, y, 0.04, f.sx / 2, f.sd / 2, dir, metal, up(metal, 1.1));
  fbox(c, f.s, f.d, 0, 0.2, 0.03, 0.03, dir, [0.25, 0.25, 0.27], [0.25, 0.25, 0.27], BAKED, false);
  if (c.detail === "low") return;
  fbox(c, f.s, f.d, 0.74, 0.22, f.sx * 0.3, f.sd * 0.38, dir, [0.28, 0.3, 0.32], [0.34, 0.36, 0.38], BAKED, false);
  fbox(c, f.s + dir.x * f.sx * 0.1, f.d + dir.z * f.sx * 0.1, 0.24, 0.2, f.sx * 0.28, f.sd * 0.38, dir, [0.85, 0.85, 0.82], [0.9, 0.9, 0.86], BAKED, false);
}

export function couch(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const px = -dir.z;
  const pd = dir.x;
  const col = pickOf([[0.45, 0.2, 0.15], [0.25, 0.35, 0.4], [0.5, 0.45, 0.3], [0.3, 0.38, 0.24], [0.4, 0.3, 0.35]] as readonly Rgb[], c.seed + i, 1052);
  // The back toward the wall behind it (a bench's rule): the nearer side wall for one along a side, larger d for one along the front.
  let sg = pd >= 0 ? 1 : -1;
  if (Math.abs(dir.z) > 0.7) sg = f.s - c.s0 < c.s1 - f.s ? -1 : 1;
  fbox(c, f.s, f.d, 0.08, 0.36, f.sx / 2, f.sd / 2, dir, col, up(col, 1.15));
  fbox(c, f.s + px * sg * (f.sd / 2 - 0.09), f.d + pd * sg * (f.sd / 2 - 0.09), 0.44, 0.38, f.sx / 2, 0.09, dir, scaled(col, 0.9), col);
  for (const k of [-1, 1]) fbox(c, f.s + dir.x * k * (f.sx / 2 - 0.08), f.d + dir.z * k * (f.sx / 2 - 0.08), 0.44, 0.15, 0.08, f.sd / 2 - 0.18, dir, scaled(col, 0.85), scaled(col, 1.05), BAKED, false);
}

/** A jukebox in a tavern, a vending machine anywhere else: a body with a lit window of colour. */
export function machine(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  if (c.type === "office" || c.type === "lobby") {
    // A copier: a body with a lid, a panel that lights.
    fbox(c, f.s, f.d, 0, f.h * 0.85, f.sx / 2, f.sd / 2, dir, [0.8, 0.8, 0.78], [0.86, 0.86, 0.84]);
    fbox(c, f.s, f.d, f.h * 0.85, 0.06, f.sx / 2 - 0.03, f.sd / 2 - 0.03, dir, [0.2, 0.22, 0.25], [0.25, 0.27, 0.3], BAKED, false);
    if (c.detail === "full") fbox(c, f.s, f.d, f.h * 0.6, 0.1, 0.12, f.sd / 2 + 0.03, dir, [0.3, 0.7, 0.9], [0.3, 0.7, 0.9], c.lit ? 1.6 : 0.2, false);
    return;
  }
  const jukebox = c.type === "bar";
  const body: Rgb = jukebox ? [0.3, 0.14, 0.08] : pickOf([[0.7, 0.1, 0.1], [0.12, 0.3, 0.6], [0.8, 0.8, 0.8]] as readonly Rgb[], c.seed + i, 1053);
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, body, up(body, 1.15));
  if (c.detail === "low") return;
  const win: Rgb = jukebox ? pickOf([[1, 0.55, 0.15], [0.3, 0.8, 1], [1, 0.3, 0.5]] as readonly Rgb[], c.seed + i, 1054) : [0.85, 0.9, 0.95];
  fbox(c, f.s, f.d, f.h * 0.45, f.h * 0.42, f.sx * 0.38, f.sd / 2 + 0.03, dir, win, win, c.lit ? 1.8 : 0.25, false);
}

/** One draped dust sheet in a vacant unit: a pale lump over something. */
export function sheet(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const pale: Rgb = [0.74, 0.73, 0.68];
  fbox(c, f.s, f.d, 0, f.h * 0.7, f.sx / 2, f.sd / 2, dir, scaled(pale, 0.9), pale);
  fbox(c, f.s + (H(c, i, 25) - 0.5) * 0.1, f.d, f.h * 0.7, f.h * 0.3, f.sx * 0.3, f.sd * 0.3, dir, scaled(pale, 0.8), scaled(pale, 1.05), BAKED, false);
}

/** The jog or the half wall of the back partition (`partition`): a painted box, a cap on a half wall. */
export function partition(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const half = f.h < c.ceiling - 0.3;
  const paint = scaled(c.paint, 0.72);
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, paint, half ? [0.3, 0.2, 0.12] : paint);
  if (c.detail === "low") return;
  // A baseboard on the front of it.
  const sg = dir.x === 1 ? -1 : 0;
  if (dir.x === 1) fbox(c, f.s, f.d + sg * (f.sd / 2 + 0.015), 0, 0.12, f.sx / 2, 0.015, dir, c.base, c.base, BAKED, false);
  void i;
}

// ---- the ceiling: boxes seen from below (a bottom face the furnishings' boxes do not have)

/** A box hung from the ceiling or lying along it, its bottom and the sides facing the street drawn; `y0` is its bottom over the floor. */
export function cbox(c: Ctx, cs: number, cd: number, y0: number, h: number, ha: number, hb: number, dir: { x: number; z: number }, side: Rgb, bottom: Rgb, glow: number = BAKED): void {
  const { out, xf } = c;
  const ax = dir.x;
  const ad = dir.z;
  const bx = -ad;
  const bd = ax;
  const corner = (ka: number, kb: number): [number, number] => [cs + ax * ha * ka + bx * hb * kb, cd + ad * ha * ka + bd * hb * kb];
  const ring: [number, number][] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const baked = glow === BAKED;
  const fx = { glow: baked ? 1 : glow };
  const yb = y0 + c.floorY;
  out.poly(ring.map(([s, d]) => xp(xf, s, d, yb)).reverse(), [0, -1, 0], baked ? ring.map(([s, d]) => shade(c, bottom, s, d, y0, -1)).reverse() : bottom, undefined, fx);
  const norms: [number, number][] = [[-bx, -bd], [ax, ad], [bx, bd], [-ax, -ad]];
  for (let i = 0; i < 4; i++) {
    const [ns, nd] = norms[i] as [number, number];
    if (nd > 0.35) continue;
    const a = ring[i] as [number, number];
    const b = ring[(i + 1) % 4] as [number, number];
    const alb = nd < -0.5 ? side : scaled(side, 0.82);
    const col: Rgb[] | Rgb = baked ? [shade(c, alb, a[0], a[1], y0, 0), shade(c, alb, b[0], b[1], y0, 0), shade(c, alb, b[0], b[1], y0 + h, 0), shade(c, alb, a[0], a[1], y0 + h, 0)] : alb;
    out.poly([xp(xf, a[0], a[1], yb), xp(xf, b[0], b[1], yb), xp(xf, b[0], b[1], yb + h), xp(xf, a[0], a[1], yb + h)], xd(xf, ns, nd), col, undefined, fx);
  }
}

/** Ceiling fans over the dining floor, an exposed duct, hung signs over the aisles, hung goods: the ceiling's own things, drawn near the glass. */
export function ceilingThings(c: Ctx, furnishings: readonly Furnishing[], lightS: readonly number[]): void {
  if (c.detail !== "full") return;
  const top = c.ceiling;
  const t = c.trade;
  const W = c.s1 - c.s0;
  const reach = Math.min(c.d1 - 0.6, 8.5);
  // An exposed duct along the room (a workshop, a modern shop, a bar), clear of the tubes.
  const ductRoll = H(c, 1, 30);
  const wantDuct = c.type === "workshop" || c.type === "bar" ? ductRoll < 0.6 : c.style.modern ? ductRoll < 0.5 : ductRoll < 0.12;
  if (wantDuct && top >= 2.9) {
    for (let k = 0; k < 6; k++) {
      const s = c.s0 + 0.6 + H(c, k, 31) * (W - 1.2);
      if (lightS.every((ls) => Math.abs(ls - s) > 1.05) && Math.abs(s - c.door.s) > 0.1) {
        cbox(c, s, 0.5 + reach / 2, top - 0.5, 0.45, reach / 2, 0.17, { x: 0, z: 1 }, [0.55, 0.56, 0.58], [0.5, 0.51, 0.53]);
        break;
      }
    }
  }
  // Fans over the tables of an old or a plain dining room: a hub and four blades that do not overlap, hung 4 cm under the ceiling.
  if ((c.type === "dining room" || c.type === "counter service" || c.type === "bar") && H(c, 2, 32) < 0.55 && top >= 2.9) {
    const tables = furnishings.filter((f) => f.kind === "table" && f.d > 2 && f.d < reach);
    const n = Math.min(2, Math.floor(tables.length / 3));
    for (let k = 0; k < n; k++) {
      const tb = tables[Math.floor((tables.length * (k + 0.5)) / Math.max(1, n))] as Furnishing;
      // The fan hangs by its table, kept a blade's length from the walls.
      const fs = Math.min(c.s1 - 0.85, Math.max(c.s0 + 0.85, tb.s + 0.7));
      const fd = Math.min(c.d1 - 0.85, Math.max(1.2, tb.d + 0.4));
      const a = H(c, k, 33) * 1.2;
      fcyl(c, fs, fd, top - 0.738, 0.06, 0.1, 6, [0.2, 0.15, 0.1], [0.2, 0.15, 0.1]);
      c.out.prism(xp(c.xf, fs, fd, c.floorY + top), xp(c.xf, fs, fd, c.floorY + top - 0.64), 0.012, 4, [0.2, 0.15, 0.1], null);
      for (let b = 0; b < 4; b++) {
        const ang = a + (b * Math.PI) / 2;
        const ux = Math.cos(ang);
        const uz = Math.sin(ang);
        cbox(c, fs + ux * 0.42, fd + uz * 0.42, top - 0.75, 0.012, 0.3, 0.07, { x: ux, z: uz }, [0.35, 0.25, 0.15], [0.4, 0.3, 0.18]);
      }
    }
  }
  // Bunting: a string of small flags across the room under the ceiling (a cafe, a bar, a gift shop), sagging between the walls.
  if (t !== null && (FOOD.includes(t) || c.type === "bar" || t === "gift shop") && top >= 2.9 && H(c, 4, 39) < 0.5) {
    const d = 2.2 + H(c, 5, 39) * Math.max(0.5, Math.min(reach, 7) - 2.5);
    const flags = Math.max(8, Math.floor(W / 0.3));
    for (let k = 0; k < flags; k++) {
      const u0 = c.s0 + 0.15 + (k * (W - 0.3)) / flags;
      const u1 = u0 + ((W - 0.3) / flags) * 0.8;
      const sag = (x: number): number => 0.35 * (1 - Math.pow(((x - c.s0) / W) * 2 - 1, 2));
      const y = (x: number): number => top - 0.45 - sag(x);
      const col = pickOf([[0.8, 0.15, 0.1], [0.9, 0.75, 0.1], [0.15, 0.4, 0.7], [0.2, 0.55, 0.3], [0.9, 0.9, 0.85]] as readonly Rgb[], c.seed + k, 1063);
      const m = (u0 + u1) / 2;
      c.out.poly([xp(c.xf, u0, d, c.floorY + y(u0)), xp(c.xf, u1, d, c.floorY + y(u1)), xp(c.xf, m, d, c.floorY + y(m) - 0.2)], xd(c.xf, 0, -1), shade(c, col, m, d, y(m), 0), undefined, { glow: 1 });
    }
  }
  // A pot rack over the back counter of a kitchen's room: a bar hung from the ceiling with pots on it.
  const backCounter = furnishings.find((f) => f.kind === "counter" && f.d > c.d1 - 1.7);
  if (backCounter !== undefined && t !== null && FOOD.includes(t) && top >= 2.9 && H(c, 3, 37) < 0.6) {
    const rs = backCounter.s;
    const rd = backCounter.d - 0.3;
    cbox(c, rs, rd, top - 0.75, 0.04, Math.min(1.0, backCounter.sx / 2 - 0.2), 0.04, AX, [0.2, 0.2, 0.22], [0.25, 0.25, 0.27]);
    for (const sg of [-1, 1]) c.out.prism(xp(c.xf, rs + sg * 0.9, rd, c.floorY + top), xp(c.xf, rs + sg * 0.9, rd, c.floorY + top - 0.72), 0.008, 3, [0.15, 0.15, 0.15], null);
    for (let k = 0; k < 5; k++) {
      const col: Rgb = k % 2 === 0 ? [0.55, 0.55, 0.58] : [0.25, 0.25, 0.27];
      c.out.prism(xp(c.xf, rs - 0.8 + k * 0.4, rd, c.floorY + top - 0.75), xp(c.xf, rs - 0.8 + k * 0.4, rd, c.floorY + top - 0.86), 0.006, 3, [0.15, 0.15, 0.15], null);
      fcyl(c, rs - 0.8 + k * 0.4, rd, top - 1.0, 0.1 - (k % 2) * 0.02, 0.14, 6, col, scaled(col, 1.2), 0.08);
    }
  }
  // A canoe hung from the ceiling of a tackle or a marine shop, on two lines.
  if ((t === "bait and tackle" || t === "marine supply") && top >= 3.0) {
    for (let k = 0; k < 6; k++) {
      const s = c.s0 + 0.9 + H(c, k, 38) * (W - 1.8);
      if (lightS.every((ls) => Math.abs(ls - s) > 1.05)) {
        const col: Rgb = pickOf([[0.6, 0.25, 0.12], [0.2, 0.4, 0.3], [0.7, 0.65, 0.5]] as readonly Rgb[], c.seed, 1062);
        const ha = Math.max(0.6, Math.min(1.6, (c.d1 - 2.4) / 2));
        cbox(c, s, 1.4 + ha, top - 1.05, 0.28, ha, 0.32, { x: 0, z: 1 }, col, scaled(col, 0.7));
        for (const sg of [-1, 1]) c.out.prism(xp(c.xf, s, 1.4 + ha + sg * ha * 0.6, c.floorY + top), xp(c.xf, s, 1.4 + ha + sg * ha * 0.6, c.floorY + top - 0.77), 0.008, 3, [0.15, 0.15, 0.15], null);
        break;
      }
    }
  }
  // Aisle signs over a grocery's gondolas and goods hung in a hardware, marine or tackle shop.
  const aisles = furnishings.filter((f) => f.kind === "endcap");
  if (aisles.length > 0) {
    for (const [k, f] of aisles.entries()) {
      const col = pickOf([[0.15, 0.4, 0.2], [0.75, 0.15, 0.1], [0.15, 0.3, 0.55]] as readonly Rgb[], c.seed + k, 1060);
      cbox(c, f.s, f.d - 0.1, top - 0.65, 0.3, 0.38, 0.02, AX, col, col);
      for (const sg of [-1, 1]) c.out.prism(xp(c.xf, f.s + sg * 0.3, f.d - 0.1, c.floorY + top), xp(c.xf, f.s + sg * 0.3, f.d - 0.1, c.floorY + top - 0.35), 0.006, 3, [0.1, 0.1, 0.1], null);
    }
  } else if (t === "hardware" || t === "marine supply" || t === "bait and tackle" || t === "garden and feed" || t === "sporting goods" || t === "auto parts") {
    const n = Math.min(9, 3 + Math.floor(W / 1.5));
    for (let k = 0; k < n; k++) {
      const s = c.s0 + 0.5 + H(c, k, 34) * (W - 1);
      const d = 2.8 + H(c, k + 20, 35) * (reach - 3.4);
      if (Math.abs(s - c.door.s) < 0.8 && d < 3.4) continue;
      const y = top - 0.9 - H(c, k, 36) * 0.4;
      if (y < 1.95) continue;
      const col = pickOf(t === "marine supply" || t === "bait and tackle" ? [[0.85, 0.3, 0.1], [0.9, 0.8, 0.7], [0.15, 0.3, 0.55]] as readonly Rgb[] : [[0.85, 0.4, 0.08], [0.7, 0.12, 0.1], [0.5, 0.52, 0.55], [0.8, 0.7, 0.1]] as readonly Rgb[], c.seed + k, 1061);
      c.out.prism(xp(c.xf, s, d, c.floorY + top), xp(c.xf, s, d, c.floorY + y + 0.3), 0.006, 3, [0.1, 0.1, 0.1], null);
      if (k % 2 === 0) fcyl(c, s, d, y, 0.15, 0.3, 6, col, up(col, 1.2), 0.1);
      else fbox(c, s, d, y, 0.3, 0.12, 0.12, AX, col, up(col, 1.2), BAKED, false);
    }
  }
}

// ---- the floor: a mat, a checker, a cone, and what a vacant unit's floor holds

/** A flat colour on the floor from (s0, d0) to (s1, d1), `y` over the floor (3 cm or more over the floor's own plane, which is at 0.08). */
function floorQuad(c: Ctx, s0: number, d0: number, s1: number, d1: number, y: number, col: Rgb): void {
  const pts = [[s0, d0], [s1, d0], [s1, d1], [s0, d1]] as const;
  c.out.poly(pts.map(([s, d]) => xp(c.xf, s, d, c.floorY + y)), [0, 1, 0], pts.map(([s, d]) => shade(c, col, s, d, y, 1)), undefined, { glow: 1 });
}

/** A rotated flat square on the floor (a tile that fell, a sheet of mail), side `w`, turned by the unit vector (ux, uz). */
function floorSheet(c: Ctx, s: number, d: number, w: number, l: number, ux: number, uz: number, y: number, col: Rgb): void {
  const pts: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [s + ux * (a as number) * l / 2 - uz * (b as number) * w / 2, d + uz * (a as number) * l / 2 + ux * (b as number) * w / 2]);
  c.out.poly(pts.map(([x, z]) => xp(c.xf, x, z, c.floorY + y)), [0, 1, 0], pts.map(([x, z]) => shade(c, col, x, z, y, 1)), undefined, { glow: 1 });
}

export function floorThings(c: Ctx, checker: Rgb | null): void {
  if (c.detail !== "full") return;
  const dw = c.door;
  const vacant = c.vacant;
  const W = c.s1 - c.s0;
  const standing = (s: number, d: number): boolean => c.feet.some((f) => f.h > 0.2 && s > f.s0 - 0.05 && s < f.s1 + 0.05 && d > f.d0 - 0.05 && d < f.d1 + 0.05);
  if (checker !== null && !vacant) {
    // Black-and-white tile: the dark squares laid 3 cm over the floor, within 7 m of the glass, none where something stands.
    const t = 0.6;
    const nS = Math.floor(W / t);
    const s00 = c.s0 + (W - nS * t) / 2;
    let count = 0;
    for (let b = 0; b * t + 0.2 + t <= Math.min(c.d1 - 0.1, 7.4) && count < 150; b++) {
      for (let a = 0; a < nS && count < 150; a++) {
        if ((a + b) % 2 === 0) continue;
        const s = s00 + a * t;
        const d = 0.2 + b * t;
        if (standing(s + t / 2, d + t / 2)) continue;
        floorQuad(c, s + 0.01, d + 0.01, s + t - 0.01, d + t - 0.01, 0.11, checker);
        count++;
      }
    }
  }
  if (!vacant && H(c, 3, 40) < 0.85) {
    // A mat inside the door: a border, and the mat itself 3 cm over it.
    const mat: Rgb = pickOf([[0.35, 0.12, 0.1], [0.2, 0.2, 0.22], [0.3, 0.22, 0.12], [0.12, 0.25, 0.2]] as readonly Rgb[], c.seed, 1070);
    const a = Math.max(c.s0 + 0.1, dw.s - 0.55);
    const b = Math.min(c.s1 - 0.1, dw.s + 0.55);
    floorQuad(c, a, 0.3, b, 0.95, 0.14, scaled(mat, 1.5));
    floorQuad(c, a + 0.06, 0.36, b - 0.06, 0.89, 0.17, mat);
  }
  if (!vacant && H(c, 4, 41) < 0.14) {
    const side = H(c, 5, 42) < 0.5 ? -1 : 1;
    const s = dw.s + side * (dw.w / 2 + 0.75);
    const d = 1.2 + H(c, 6, 43) * 1.0;
    if (free(c, s, d, 0.2, -1)) fcyl(c, s, d, 0.08, 0.13, 0.55, 5, [0.92, 0.75, 0.08], [0.95, 0.8, 0.1], 0.03);
  }
  if (vacant) {
    // The post that came through the door and nobody picked up; a ceiling tile that came down.
    for (let k = 0; k < 4; k++) {
      const a = H(c, k, 44) * 6.2832;
      const s = dw.s + (H(c, k, 45) - 0.5) * 1.1;
      const d = 0.45 + H(c, k, 46) * 0.7;
      const col = pickOf([[0.88, 0.88, 0.84], [0.8, 0.75, 0.55], [0.7, 0.8, 0.85], [0.85, 0.5, 0.45]] as readonly Rgb[], c.seed + k, 1071);
      floorSheet(c, s, d, 0.2, 0.28, Math.cos(a), Math.sin(a), 0.11 + k * 0.03, col);
    }
    const tile = c.d1 > 5 ? 2.2 + H(c, 7, 47) * (c.d1 - 4.4) : 2.2;
    const ts = c.s0 + 0.8 + H(c, 8, 48) * Math.max(0.2, W - 1.6);
    const a = H(c, 9, 49) * 1.5;
    floorSheet(c, ts, tile, 0.6, 0.6, Math.cos(a), Math.sin(a), 0.11, [0.72, 0.7, 0.62]);
    // The hole it left in the ceiling, dark, 3 cm under the ceiling's plane.
    const hs0 = c.s0 + 0.8 + H(c, 10, 50) * Math.max(0.2, W - 1.6);
    const hd = 1.8 + H(c, 11, 51) * Math.max(0.2, c.d1 - 3.6);
    const hole: [number, number][] = [[hs0 - 0.3, hd - 0.3], [hs0 + 0.3, hd - 0.3], [hs0 + 0.3, hd + 0.3], [hs0 - 0.3, hd + 0.3]];
    c.out.poly(hole.map(([s, d]) => xp(c.xf, s, d, c.floorY + c.ceiling - 0.03)), [0, -1, 0], [0.04, 0.04, 0.045], undefined, { glow: 1 });
  }
}
