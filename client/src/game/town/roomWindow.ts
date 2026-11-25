/**
 * What stands and hangs in the window zone, and what tall things show over the sill: a window bar with its stools, a high table, a tiered
 * stand of pastries or goods, the stacked chairs, rolled carpet and leaning door a vacant unit leaves, a coat tree, a floor lamp, a rack of
 * newspapers, a high chair; and on the glass itself the sill's plants (some dead), a row of jars or bottles, a half-curtain on a rod, string
 * lights, a cat's bed. Every roll is the unit's own (a hash of it and of the window), so that no two windows of one unit read alike.
 */
import { withMat } from "./materials.js";
import { hash01, scaled, type Rgb } from "./meshBuilder.js";
import { pickOf } from "./buildingKit.js";
import { BAKED, fbox, fcyl, shade, xd, xp, type Ctx } from "./roomKit.js";
import { H, NEAR, free, highTableSeats, up, windowBarSeats } from "./roomFill.js";
import type { Furnishing, Opening } from "../../sim/town/types.js";

const AX = { x: 1, z: 0 };
const dirOf = (f: Furnishing): { x: number; z: number } => ({ x: f.dir.x, z: f.dir.z });
const FOOD = ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers"];

function stool(c: Ctx, s: number, d: number, h: number, seat: Rgb, post: Rgb): void {
  fbox(c, s, d, 0, h, 0.03, 0.03, AX, post, post, BAKED, false);
  fbox(c, s, d, h, 0.06, 0.17, 0.17, AX, seat, up(seat, 1.2), BAKED, false);
}

/** A window bar: a narrow counter at the glass with a rail, and stools behind it facing the street; cups, a plant, a menu on it. */
export function windowBar(c: Ctx, f: Furnishing, i: number): void {
  const wood: Rgb = pickOf([[0.4, 0.26, 0.14], [0.6, 0.5, 0.35], [0.3, 0.3, 0.32]] as readonly Rgb[], c.seed + i, 1100);
  const cd = f.d - f.sd / 2 + 0.22;
  fbox(c, f.s, cd, 0, 1.0, f.sx / 2, 0.2, AX, scaled(wood, 0.8), wood);
  fbox(c, f.s, cd, 1.0, 0.04, f.sx / 2 + 0.02, 0.22, AX, scaled(wood, 0.7), wood);
  if (c.detail === "low") return;
  const seat: Rgb = c.style.chrome ? [0.62, 0.1, 0.08] : pickOf([[0.2, 0.3, 0.35], [0.6, 0.15, 0.1], [0.3, 0.2, 0.12]] as readonly Rgb[], c.seed + i, 1101);
  const n = Math.max(1, Math.floor(f.sx / 0.75));
  for (const { k, s: ss, d: sd } of windowBarSeats(c, f, i)) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    stool(c, ss, sd, 0.68, seat, c.style.metal);
    // Something on the counter in front of it.
    const r = H(c, i * 7 + k, 103);
    const ty = 1.04;
    if (r < 0.3) fcyl(c, f.s + u, cd, ty, 0.04, 0.09, 5, [0.85, 0.85, 0.8], [0.15, 0.1, 0.07]);
    else if (r < 0.5) fcyl(c, f.s + u, cd, ty, 0.035, 0.28, 5, [0.2, 0.45, 0.2], [0.8, 0.3, 0.4], 0.02);
    else if (r < 0.65) fbox(c, f.s + u, cd, ty, 0.22, 0.07, 0.012, AX, [0.2, 0.15, 0.1], [0.2, 0.15, 0.1], BAKED, false);
  }
}

/** A high table with two stools: a round top at 1.05 m, a bottle and a candle or a menu on it. */
export function highTable(c: Ctx, f: Furnishing, i: number): void {
  const top: Rgb = pickOf([[0.3, 0.2, 0.12], [0.55, 0.5, 0.42], [0.2, 0.2, 0.22]] as readonly Rgb[], c.seed + i, 1103);
  fcyl(c, f.s, f.d, 1.0, f.sx / 2 + 0.05, 0.05, 8, scaled(top, 0.8), top);
  fbox(c, f.s, f.d, 0, 1.0, 0.04, 0.04, AX, [0.15, 0.15, 0.16], [0.15, 0.15, 0.16], BAKED, false);
  if (c.detail === "low") return;
  const seat: Rgb = pickOf([[0.2, 0.3, 0.35], [0.6, 0.15, 0.1], [0.3, 0.2, 0.12], [0.15, 0.15, 0.17]] as readonly Rgb[], c.seed + i, 1104);
  for (const q of highTableSeats(c, f, i)) stool(c, q.s, q.d, 0.68, seat, c.style.metal);
  const col = pickOf([[0.15, 0.4, 0.2], [0.5, 0.25, 0.1], [0.75, 0.75, 0.7]] as readonly Rgb[], c.seed + i, 1105);
  fcyl(c, f.s - 0.1, f.d, 1.05, 0.04, 0.3, 5, col, [0.7, 0.7, 0.66], 0.02);
  fcyl(c, f.s + 0.1, f.d, 1.05, 0.05, 0.08, 5, [0.8, 0.75, 0.6], [1, 0.8, 0.4]);
}

/** A tiered stand: three shelves stepping back, each with its row of pastries or goods; the colours are the trade's. */
export function stand(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const food = c.trade !== null && FOOD.includes(c.trade);
  const wood: Rgb = pickOf([[0.4, 0.26, 0.14], [0.65, 0.6, 0.5], [0.25, 0.25, 0.27]] as readonly Rgb[], c.seed + i, 1106);
  const tiers = 3;
  const palette: readonly Rgb[] = food ? [[0.62, 0.4, 0.2], [0.8, 0.55, 0.65], [0.85, 0.75, 0.5], [0.45, 0.25, 0.12], [0.9, 0.85, 0.75]] : [[0.8, 0.15, 0.1], [0.15, 0.4, 0.7], [0.9, 0.75, 0.1], [0.2, 0.55, 0.3], [0.9, 0.9, 0.85], [0.5, 0.3, 0.6]];
  for (let t = 0; t < tiers; t++) {
    const depth = f.sd / 2 - t * 0.1;
    const y = 0.4 + t * 0.32;
    // The shelves step back: the lowest is nearest the glass.
    const dd = -f.sd / 2 + depth + t * 0.12;
    fbox(c, f.s, f.d + dd * 0 + (t * 0.1 - 0.15), y, 0.04, f.sx / 2, depth - 0.02, dir, scaled(wood, 0.8), wood);
    if (c.detail === "low") continue;
    const n = Math.max(2, Math.floor(f.sx / 0.2));
    for (let k = 0; k < n; k++) {
      if (H(c, i * 17 + t * 5 + k, 107) < 0.12) continue;
      const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
      const col = pickOf(palette, c.seed + i * 13 + t * 7 + k, 1107);
      fbox(c, f.s + u, f.d + (t * 0.1 - 0.15), y + 0.04, 0.07 + H(c, i + t + k, 108) * (food ? 0.04 : 0.12), (f.sx / n) * 0.36, depth * 0.55, dir, col, up(col, 1.2), BAKED, false);
    }
  }
  fbox(c, f.s - f.sx / 2 + 0.03, f.d - 0.1, 0, 1.3, 0.025, 0.04, dir, scaled(wood, 0.7), scaled(wood, 0.7), BAKED, false);
  fbox(c, f.s + f.sx / 2 - 0.03, f.d - 0.1, 0, 1.3, 0.025, 0.04, dir, scaled(wood, 0.7), scaled(wood, 0.7), BAKED, false);
}

/** A tower of stacked chairs left in a vacant unit. */
export function chairStack(c: Ctx, f: Furnishing, i: number): void {
  const col = pickOf([[0.3, 0.2, 0.12], [0.35, 0.36, 0.38], [0.6, 0.15, 0.1]] as readonly Rgb[], c.seed + i, 1108);
  const n = Math.min(6, Math.floor(f.h / 0.2));
  for (let k = 0; k < n; k++) fbox(c, f.s + (k % 2) * 0.03, f.d, 0.04 + k * 0.2, 0.18, 0.2, 0.2, AX, col, up(col, 1.15), BAKED, false);
  fbox(c, f.s, f.d - 0.16 + 0.0, 0.04, n * 0.2 + 0.1, 0.19, 0.02, AX, scaled(col, 0.9), col, BAKED, false);
}

/** A roll of carpet stood on end, and a door leaning on the wall behind (a slanted face). */
export function carpetRoll(c: Ctx, f: Furnishing, i: number): void {
  const col = pickOf([[0.45, 0.2, 0.18], [0.3, 0.32, 0.4], [0.5, 0.42, 0.28]] as readonly Rgb[], c.seed + i, 1109);
  fcyl(c, f.s, f.d, 0, f.sx / 2, f.h, 8, col, scaled(col, 1.3));
  fcyl(c, f.s, f.d, f.h, f.sx / 2 - 0.05, 0.02, 8, [0.15, 0.12, 0.1], [0.3, 0.25, 0.2]);
}

export function leaner(c: Ctx, f: Furnishing, i: number): void {
  const col = pickOf([[0.5, 0.4, 0.3], [0.75, 0.75, 0.7], [0.3, 0.32, 0.3]] as readonly Rgb[], c.seed + i, 1110);
  const lean = 0.35;
  const w = f.sx / 2;
  const pts: [number, number, number][] = [[f.s - w, f.d - lean / 2, 0.1], [f.s + w, f.d - lean / 2, 0.1], [f.s + w, f.d + lean / 2, f.h], [f.s - w, f.d + lean / 2, f.h]];
  c.out.poly(pts.map(([s, d, y]) => xp(c.xf, s, d, c.floorY + y)), xd(c.xf, 0, -1), pts.map(([s, d, y]) => shade(c, y < 1 ? scaled(col, 0.8) : col, s, d, y, 0)), undefined, { glow: 1 });
}

// ---- tall things that show over the sill

/** A coat tree, a floor lamp, a rack of newspapers, a high chair, a tall plant: three to five in the first 7 m, in free spots by the walls. */
export function tallThings(c: Ctx, seed: number): void {
  withMat("painted", () => {
    if (c.detail !== "full" || c.vacant) return;
    const food = c.trade !== null && FOOD.includes(c.trade);
    const office = c.type === "office" || c.type === "lobby";
    const bar = c.type === "bar";
    const n = 3 + Math.floor(H(c, 60, 120) * 3);
    for (let k = 0; k < n; k++) {
      const side = H(c, k, 121) < 0.5 ? c.s0 + 0.45 : c.s1 - 0.45;
      const d = 1.0 + H(c, k, 122) * Math.min(6.5, c.d1 - 2.2);
      const s = H(c, k, 123) < 0.8 ? side : c.door.s + (H(c, k, 124) < 0.5 ? -1 : 1) * (c.door.w / 2 + 1.0);
      if (!free(c, s, d, 0.3, -1)) continue;
      const kind = Math.floor(H(c, k + seed, 125) * (food ? 5 : bar ? 3 : office ? 4 : 3));
      const which = food ? [0, 1, 2, 3, 4][kind] : bar ? [1, 4, 5][kind] : office ? [0, 1, 4, 2][kind] : [1, 4, 0][kind];
      c.chairs.push([s, d]);
      if (which === 0) {
        // A coat tree: a pole, a foot and hooks with a coat or two.
        withMat("wood", () => fcyl(c, s, d, 0, 0.2, 0.05, 6, [0.2, 0.14, 0.1], [0.2, 0.14, 0.1]));
        withMat("wood", () => fcyl(c, s, d, 0.05, 0.025, 1.8, 4, [0.25, 0.17, 0.1], [0.25, 0.17, 0.1]));
        for (let q = 0; q < 2; q++) if (H(c, k * 3 + q, 126) < 0.7) withMat("cloth", () => fbox(c, s + (q ? 0.1 : -0.1), d, 0.9 + q * 0.1, 0.7, 0.07, 0.1, AX, pickOf([[0.2, 0.25, 0.35], [0.45, 0.2, 0.15], [0.3, 0.32, 0.25]] as readonly Rgb[], c.seed + k + q, 1111), [0.3, 0.3, 0.3], BAKED, false));
      } else if (which === 1) {
        // A floor lamp: a foot, a pole and a lit shade.
        withMat("steel", () => fcyl(c, s, d, 0, 0.14, 0.03, 6, [0.15, 0.15, 0.16], [0.2, 0.2, 0.2]));
        withMat("steel", () => fcyl(c, s, d, 0.03, 0.015, 1.5, 4, [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]));
        withMat("cloth", () => fcyl(c, s, d, 1.5, 0.17, 0.3, 6, c.lit ? [1, 0.85, 0.55] : [0.5, 0.45, 0.35], [1, 0.9, 0.6], 0.11));
      } else if (which === 2) {
        // A rack of newspapers: a box with coloured heads, tall.
        fbox(c, s, d, 0, 1.25, 0.25, 0.12, AX, [0.4, 0.4, 0.42], [0.5, 0.5, 0.52]);
        for (let q = 0; q < 4; q++) withMat("cloth", () => fbox(c, s, d - 0.02, 0.35 + q * 0.22, 0.14, 0.22, 0.13, AX, pickOf([[0.85, 0.85, 0.8], [0.8, 0.75, 0.5], [0.7, 0.8, 0.85]] as readonly Rgb[], c.seed + k + q, 1112), [0.9, 0.9, 0.88], BAKED, false));
      } else if (which === 3) {
        // A high chair: a seat on legs with a tall back and a tray.
        withMat("wood", () => fbox(c, s, d, 0.5, 0.05, 0.17, 0.17, AX, [0.5, 0.35, 0.2], [0.6, 0.45, 0.28]));
        withMat("wood", () => fbox(c, s, d, 0, 0.5, 0.04, 0.04, AX, [0.4, 0.3, 0.2], [0.4, 0.3, 0.2], BAKED, false));
        withMat("wood", () => fbox(c, s, d + 0.15, 0.55, 0.45, 0.17, 0.02, AX, [0.5, 0.35, 0.2], [0.5, 0.35, 0.2], BAKED, false));
      } else {
        const green: Rgb = pickOf([[0.14, 0.36, 0.14], [0.2, 0.42, 0.18], [0.1, 0.3, 0.16]] as readonly Rgb[], c.seed + k, 1113);
        fcyl(c, s, d, 0, 0.18, 0.4, 6, pickOf([[0.55, 0.28, 0.16], [0.7, 0.7, 0.66], [0.2, 0.25, 0.4]] as readonly Rgb[], c.seed + k, 1114), [0.2, 0.12, 0.08]);
        for (let q = 0; q < 3; q++) withMat("plant", () => fcyl(c, s + (q - 1) * 0.1, d, 0.38, 0.15, 1.1 - q * 0.2, 5, green, scaled(green, 1.3), 0.02));
      }
    }
    void hash01;
    void NEAR;
  });
}

// ---- the glass and the sill

/** Plants (some dead), jars, a half-curtain, string lights and a cat's bed in the unit's windows, by the unit's and the window's own rolls. */
export function sillThings(c: Ctx, openings: readonly Opening[]): void {
  withMat("plant", () => {
    if (c.detail !== "full") return;
    const food = c.trade !== null && FOOD.includes(c.trade);
    for (const [k, o] of openings.entries()) {
      if (o.cover !== "none" && o.cover !== "blinds" && o.cover !== "display") continue;
      const lo = Math.min(o.s0, o.s1);
      const hi = Math.max(o.s0, o.s1);
      if (hi - lo < 0.9) continue;
      const r = (n: number): number => hash01(c.seed * 7 + k * 31 + n, 1130);
      const sill = o.sill;
      // A row of jars or bottles along the sill, or a cat's bed, or nothing.
      if (o.cover !== "display" && r(1) < 0.4) {
        const n = 3 + Math.floor(r(2) * 4);
        const x0 = lo + 0.3 + r(3) * 0.4;
        for (let q = 0; q < n && x0 + q * 0.17 < hi - 0.3; q++) {
          const col = pickOf([[0.2, 0.45, 0.3], [0.6, 0.35, 0.15], [0.75, 0.75, 0.7], [0.25, 0.35, 0.6], [0.7, 0.2, 0.15]] as readonly Rgb[], c.seed + k * 9 + q, 1131);
          withMat("plastic", () => fcyl(c, x0 + q * 0.17, 0.2, sill, 0.05, 0.14 + (q % 3) * 0.06, 5, col, scaled(col, 1.3), 0.03));
        }
      } else if (o.cover !== "display" && r(4) < 0.2) {
        const s = lo + 0.35 + r(5) * (hi - lo - 0.7);
        withMat("cloth", () => fcyl(c, s, 0.3, sill, 0.22, 0.08, 8, [0.5, 0.35, 0.3], [0.62, 0.5, 0.42]));
        if (r(6) < 0.6) withMat("cloth", () => fcyl(c, s, 0.3, sill + 0.08, 0.1, 0.1, 6, [0.8, 0.5, 0.2], [0.85, 0.6, 0.3], 0.07));
      }
      // A plant at an end of the sill: green, or dead and brown.
      if (r(7) < 0.4) {
        const end = r(8) < 0.5 ? lo + 0.2 : hi - 0.2;
        const dead = r(9) < 0.3;
        const leaf: Rgb = dead ? [0.4, 0.3, 0.15] : [0.18, 0.4, 0.16];
        withMat("painted", () => fcyl(c, end, 0.28, sill, 0.1, 0.2, 6, pickOf([[0.55, 0.28, 0.16], [0.7, 0.7, 0.66], [0.2, 0.25, 0.4]] as readonly Rgb[], c.seed + k, 1132), [0.2, 0.12, 0.08]));
        for (let q = 0; q < 3; q++) fcyl(c, end + (q - 1) * 0.06, 0.28, sill + 0.18, 0.07, (dead ? 0.15 : 0.3) + q * 0.07, 5, leaf, scaled(leaf, 1.3), 0.015);
      }
      // A half-curtain on a rod across the lower half of the glass (a cafe's, mostly).
      if (o.cover === "none" && (food ? r(10) < 0.45 : r(10) < 0.12)) {
        const y1 = sill + 0.62;
        const y0 = sill + 0.28;
        const col = pickOf([[0.85, 0.8, 0.7], [0.7, 0.3, 0.3], [0.3, 0.4, 0.5], [0.9, 0.9, 0.85]] as readonly Rgb[], c.seed + k, 1133);
        withMat("wood", () => fbox(c, (lo + hi) / 2, 0.22, y1, 0.02, (hi - lo) / 2 - 0.05, 0.015, AX, [0.2, 0.15, 0.1], [0.2, 0.15, 0.1], BAKED, false));
        const n = Math.max(3, Math.floor((hi - lo) / 0.3));
        for (let q = 0; q < n; q++) {
          const s0 = lo + 0.05 + (q * (hi - lo - 0.1)) / n;
          const s1 = s0 + ((hi - lo - 0.1) / n) * 0.96;
          const tone = scaled(col, q % 2 === 0 ? 1 : 0.82);
          const bot = y0 + (q % 3) * 0.03;
          const pts: [number, number, number][] = [[s0, 0.18, bot], [s1, 0.18, bot], [s1, 0.18, y1], [s0, 0.18, y1]];
          withMat("cloth", () => c.out.poly(pts.map(([s, d, y]) => xp(c.xf, s, d, c.floorY + y)), xd(c.xf, 0, -1), pts.map(([s, d, y]) => shade(c, tone, s, d, y, 0)), undefined, { glow: 1 }));
        }
      }
      // String lights across the top of the glass: small bulbs that glow while the unit is open.
      if (o.cover === "none" && c.lit && r(11) < 0.28) {
        const n = Math.max(4, Math.floor((hi - lo) / 0.22));
        for (let q = 0; q < n; q++) {
          const s = lo + 0.1 + (q * (hi - lo - 0.2)) / (n - 1);
          const col = pickOf([[1, 0.8, 0.4], [1, 0.4, 0.3], [0.5, 0.9, 0.5], [0.5, 0.7, 1]] as readonly Rgb[], c.seed + q, 1134);
          withMat("painted", () => fbox(c, s, 0.13, o.head - 0.12 - (q % 2) * 0.04, 0.04, 0.02, 0.02, AX, col, col, 2.5, false));
        }
      }
    }
  });
}
