/**
 * The room behind a unit's glass, and what is in it, lit by its own lights. `roomShell.ts` builds the floor, ceiling and walls as grids lit
 * from the room's baked light (`roomLight.ts`); this file stands in it the plan's furnishings (`unit.interior.furnishings`) and lights as
 * forms that read as what they are from the sidewalk: shelf runs with rows of goods, counters with a till, tables, booths, stools, a
 * bar, coolers with lit fronts, washers in a row with their round doors, desks with a screen, racks of clothes, crates, ladders and paint
 * cans, a lift with a car on it. `roomDressing.ts` hangs what a trade puts on its walls and stands in its window.
 *
 * Everything is drawn in the building's own frame (`Xf`: `s` along the front from its left end, `d` into the building from its face), as
 * the plan gives it, and only the faces a person on the street could see are built (a room that is `whole`, `RoomIn.whole`, has every face). What is authored: the colours of goods by trade, the
 * heights, the number of tiers and items. What the plan causes: which furnishings stand where, which lights are on, whether the unit is
 * open, shut or vacant (the light's, in `roomLight.ts`).
 */
import { hoursCode } from "./hours.js";
import { withMat } from "./materials.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { pickOf } from "./buildingKit.js";
import { BAKED, fbox, shade as lightShade, xd, xp, type Ctx } from "./roomKit.js";
import { BACKDROP_AT, BACKDROP_MIN_BEHIND, roomField, type DayOpening } from "./roomLight.js";
import { backdrop } from "./roomBackdrop.js";
import { roomHaze } from "./roomHaze.js";
import { finishOf, roomShell, type RoomIn } from "./roomShell.js";
import { dressRoom, goodsOf } from "./roomDressing.js";
import { PLAIN_FROM, benchSet, bin, feetOf, booth, cabinets, cart, ceilingThings, checkout, counterTop, couch, deskSet, endcap, floorThings, machine, partition, plant, sheet, stools, styleOf, tableSet, waterCooler, type Foot } from "./roomFill.js";
import { carpetRoll, chairStack, highTable, leaner, stand, windowBar } from "./roomWindow.js";
import type { Furnishing, RoomLight } from "../../sim/town/types.js";

export { xp, type Xf } from "./roomKit.js";
export type { RoomIn } from "./roomShell.js";

const AX = { x: 1, z: 0 };
const dirOf = (f: Furnishing): { x: number; z: number } => ({ x: f.dir.x, z: f.dir.z });
const pickGoods = (c: Ctx, k: number): Rgb => goodsOf(c.trade, c.seed + k * 7);
const shade = (v: Rgb, k: number): Rgb => scaled(v, k);

/** A deep shelf run's stock as a few bands of colour on each long face that shows: one quad a tier, the goods blended, no single item. */
function plainBands(c: Ctx, f: Furnishing, i: number, dir: { x: number; z: number }): void {
  const px = -dir.z;
  const pd = dir.x;
  const tiers = Math.max(2, Math.min(3, Math.floor(f.h / 0.7)));
  for (const sg of [1, -1]) {
    // A face that points away from the street shows only at a slant; one against a party wall is never seen (in a room a person stands in both show).
    if (sg * pd > 0.35 && c.whole !== true) continue;
    const fsx = f.s + px * sg * (f.sd / 2 + 0.03);
    if (fsx < c.s0 + 0.05 || fsx > c.s1 - 0.05) continue;
    const hint = xd(c.xf, px * sg, pd * sg);
    const at = (u: number, yy: number): Vec3 => xp(c.xf, f.s + dir.x * u + px * sg * (f.sd / 2 + 0.03), f.d + dir.z * u + pd * sg * (f.sd / 2 + 0.03), c.floorY + yy);
    for (let t = 0; t < tiers; t++) {
      const y = 0.2 + (t * (f.h - 0.35)) / tiers;
      const ih = (f.h - 0.35) / tiers - 0.08;
      const col = pickGoods(c, i * 97 + t * 13 + sg * 7);
      const lo = lightShade(c, scaled(col, 0.75), fsx, f.d, y, 0);
      const hi = lightShade(c, col, fsx, f.d, y + ih, 0);
      c.out.poly([at(-f.sx / 2 + 0.03, y), at(f.sx / 2 - 0.03, y), at(f.sx / 2 - 0.03, y + ih), at(-f.sx / 2 + 0.03, y + ih)], hint, [lo, lo, hi, hi], undefined, { glow: 1 });
    }
  }
}

function shelfRun(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const frame: Rgb = [0.5, 0.5, 0.5];
  const body: Rgb = [0.3, 0.26, 0.22];
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, body, frame);
  if (c.plain === true) return plainBands(c, f, i, dir);
  if (c.detail === "low") return;
  // Goods on the long faces that look toward the room: a plank at each tier and a row of packages on it, drawn on the face 3 and 5.5 cm proud of it (each layer its own depth).
  const tiers = Math.max(2, Math.min(5, Math.floor(f.h / 0.45)));
  const cap = c.detail === "full" ? 11 : 4;
  const bottles = c.type === "bar" && f.sd < 0.4;
  const items = bottles ? Math.max(3, Math.min(cap + 8, Math.floor(f.sx / 0.12))) : Math.max(2, Math.min(cap, Math.floor(f.sx / 0.26)));
  const px = -dir.z;
  const pd = dir.x;
  const face = (sg: number): void => {
    // A face that points away from the street shows only at a slant; both are drawn, each to its own side of the run.
    const nd = sg * pd;
    if (nd > 0.35 && c.whole !== true) return;
    // A face against a party wall is never seen.
    const fsx = f.s + px * sg * (f.sd / 2 + 0.1);
    if (fsx < c.s0 + 0.05 || fsx > c.s1 - 0.05) return;
    const ox = px * sg;
    const od = pd * sg;
    const along = (u: number, off: number, y: number): Vec3 => xp(c.xf, f.s + dir.x * u + ox * (f.sd / 2 + off), f.d + dir.z * u + od * (f.sd / 2 + off), c.floorY + y);
    const hint = xd(c.xf, ox, od);
    for (let t = 0; t < tiers; t++) {
      const y = 0.18 + (t * (f.h - 0.3)) / tiers;
      const plank = lightShade(c, frame, f.s + ox * f.sd / 2, f.d + od * f.sd / 2, y, 0);
      c.out.poly([along(-f.sx / 2, 0.03, y), along(f.sx / 2, 0.03, y), along(f.sx / 2, 0.03, y + 0.025), along(-f.sx / 2, 0.03, y + 0.025)], hint, plank, undefined, { glow: 1 });
      for (let k = 0; k < items; k++) {
        const u0 = -f.sx / 2 + (k * f.sx) / items + (bottles ? 0.03 : 0.02);
        const u1 = -f.sx / 2 + ((k + 1) * f.sx) / items - (bottles ? 0.03 : 0.02);
        // A vacant unit's shelving is empty but for what was left; a sold-out gap is a gap in any.
        if ((c.vacant && hash01(c.seed + i * 29 + t * 3 + k, 313) < 0.9) || hash01(c.seed + i * 19 + t * 11 + k, 312) < 0.08) continue;
        const ih = Math.min(bottles ? 0.4 : 0.36, (f.h - 0.3) / tiers - 0.06) * (bottles ? 0.8 + hash01(c.seed + i * 31 + t * 5 + k, 311) * 0.2 : 0.55 + hash01(c.seed + i * 31 + t * 5 + k, 311) * 0.5);
        const col = pickGoods(c, i * 97 + t * 13 + k + sg * 7);
        const mid = f.s + dir.x * ((u0 + u1) / 2) + ox * (f.sd / 2);
        const midD = f.d + dir.z * ((u0 + u1) / 2) + od * (f.sd / 2);
        c.out.poly([along(u0, 0.055, y + 0.03), along(u1, 0.055, y + 0.03), along(u1, 0.055, y + 0.03 + ih), along(u0, 0.055, y + 0.03 + ih)], hint, [lightShade(c, scaled(col, 0.8), mid, midD, y, 0), lightShade(c, scaled(col, 0.8), mid, midD, y, 0), lightShade(c, col, mid, midD, y + ih, 0), lightShade(c, col, mid, midD, y + ih, 0)], undefined, { glow: bottles && c.lit ? 1.7 : 1 });
      }
    }
  };
  face(1);
  face(-1);
  // Boxes of reserve stock on top of tall shelving, above head height.
  if (c.detail === "full" && f.h >= 1.9 && f.d < 12) {
    const n = Math.max(2, Math.floor(f.sx / 0.45));
    for (let k = 0; k < n; k++) {
      if (hash01(c.seed + i * 23 + k, 314) < 0.2) continue;
      const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
      const col = pickGoods(c, i * 61 + k);
      fbox(c, f.s + dir.x * u, f.d + dir.z * u, f.h, 0.18 + hash01(c.seed + i + k, 315) * 0.15, (f.sx / n) * 0.4, f.sd * 0.4, dir, col, shade(col, 1.15), BAKED, false);
    }
  }
}

function counter(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const wood: Rgb = hash01(c.seed + i, 312) < 0.5 ? [0.32, 0.2, 0.11] : [0.55, 0.52, 0.45];
  fbox(c, f.s, f.d, 0, f.h * 0.92, f.sx / 2, f.sd / 2, dir, wood, wood);
  fbox(c, f.s, f.d, f.h * 0.92, 0.05, f.sx / 2 + 0.03, f.sd / 2 + 0.05, dir, shade(wood, 0.7), [0.6, 0.58, 0.52]);
  // The till: a dark box with its screen.
  fbox(c, f.s - dir.x * f.sx * 0.15, f.d - dir.z * f.sx * 0.15, f.h * 0.92 + 0.05, 0.2, 0.18, 0.15, dir, [0.1, 0.1, 0.11], [0.12, 0.2, 0.15], c.lit ? 0.8 : BAKED);
  counterTop(c, f, i);
}

function displayCase(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, f.h * 0.9, f.sx / 2, f.sd / 2, dir, [0.55, 0.55, 0.54], [0.75, 0.82, 0.86], c.lit ? 0.9 : BAKED);
  if (c.detail === "low") return;
  for (let k = 0; k < 6; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / 6;
    fbox(c, f.s + dir.x * u, f.d + dir.z * u, f.h * 0.9, 0.06, 0.05, 0.05, dir, pickGoods(c, i * 11 + k), pickGoods(c, i * 11 + k + 5), c.lit ? 1 : BAKED, false);
  }
}

function cooler(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  // Its front is lit all day: a cooler runs whatever the unit does.
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, [0.78, 0.88, 0.95], [0.85, 0.85, 0.85], c.lit ? 1.5 : 0.7);
  if (c.detail === "low") return;
  const n = Math.max(2, Math.floor(f.sx / 0.65));
  for (let b = 0; b < 3; b++) {
    for (let k = 0; k < n; k++) {
      const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
      const col = pickGoods(c, i * 53 + b * 9 + k);
      fbox(c, f.s + dir.x * u, f.d + dir.z * u, 0.25 + b * (f.h - 0.4) / 3, (f.h - 0.4) / 3 - 0.08, (f.sx / n) * 0.4, f.sd * 0.3, dir, col, col, c.lit ? 1.2 : 0.5, false);
    }
  }
}

function washers(c: Ctx, f: Furnishing): void {
  const dir = dirOf(f);
  const n = Math.max(1, Math.floor(f.sx / 0.72));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const s = f.s + dir.x * u;
    const d = f.d + dir.z * u;
    fbox(c, s, d, 0, f.h, (f.sx / n) * 0.45, f.sd / 2, dir, [0.82, 0.83, 0.84], [0.9, 0.9, 0.9]);
    if (c.detail === "low") continue;
    // The round door: an octagon on the face that looks at the street (the box's face with the most of its normal against the front).
    const px = -dir.z;
    const pd = dir.x;
    const sign = pd > 0 ? -1 : 1;
    const fs = s + px * sign * (f.sd / 2 + 0.03);
    const fd = d + pd * sign * (f.sd / 2 + 0.03);
    const ring: Vec3[] = [];
    for (let m = 0; m < 8; m++) {
      const ang = (m / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 0.2;
      ring.push(xp(c.xf, fs + dir.x * Math.cos(ang) * r, fd + dir.z * Math.cos(ang) * r, c.floorY + f.h * 0.5 + Math.sin(ang) * r));
    }
    c.out.poly(ring, xd(c.xf, px * sign, pd * sign), [0.12, 0.16, 0.2], undefined, { glow: 0.3 });
  }
}

function rack(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  if (c.type === "office" || c.type === "lobby" || (c.type === "counter service" && c.trade === "post office")) {
    // A rack of leaflets: a tall frame with rows of pockets, each its own colour.
    fbox(c, f.s, f.d, 0, 1.6, f.sx / 2, f.sd / 2, dir, [0.35, 0.36, 0.38], [0.45, 0.46, 0.48]);
    if (c.detail === "low") return;
    const cols = Math.max(2, Math.floor(f.sx / 0.2));
    for (let r = 0; r < 4; r++) for (let q = 0; q < cols; q++) {
      if (hash01(c.seed + i * 17 + r * 5 + q, 330) < 0.15) continue;
      const col = pickGoods(c, i * 71 + r * 9 + q);
      fbox(c, f.s + dir.x * (-f.sx / 2 + ((q + 0.5) * f.sx) / cols), f.d + dir.z * (-f.sx / 2 + ((q + 0.5) * f.sx) / cols), 0.5 + r * 0.28, 0.2, (f.sx / cols) * 0.4, f.sd / 2 + 0.03, dir, col, shade(col, 1.15), BAKED, false);
    }
    return;
  }
  const rail: Rgb = [0.5, 0.5, 0.52];
  fbox(c, f.s, f.d, 1.45, 0.03, f.sx / 2, 0.02, dir, rail, rail, BAKED, false);
  for (const sg of [-1, 1]) fbox(c, f.s + dir.x * sg * (f.sx / 2 - 0.03), f.d + dir.z * sg * (f.sx / 2 - 0.03), 0, 1.45, 0.02, 0.02, dir, rail, rail, BAKED, false);
  if (c.detail === "low") return;
  const n = Math.max(3, Math.floor(f.sx / 0.12));
  const px = -dir.z;
  const pd = dir.x;
  for (let k = 0; k < Math.min(n, 18); k++) {
    const u = -f.sx / 2 + 0.08 + (k * (f.sx - 0.16)) / Math.min(n, 18);
    const col = pickGoods(c, i * 41 + k);
    const hgt = 0.7 + hash01(c.seed + i * 3 + k, 318) * 0.4;
    const s = f.s + dir.x * u;
    const d = f.d + dir.z * u;
    const w = Math.min(0.2, ((f.sx - 0.16) / Math.min(n, 18)) * 0.45);
    // A garment is a flat panel hung across the rail, seen from the street.
    const sgn = pd > 0 ? -1 : 1;
    withMat("cloth", () => c.out.poly([xp(c.xf, s - dir.x * w, d - dir.z * w, c.floorY + 1.43), xp(c.xf, s + dir.x * w, d + dir.z * w, c.floorY + 1.43), xp(c.xf, s + dir.x * w, d + dir.z * w, c.floorY + 1.43 - hgt), xp(c.xf, s - dir.x * w, d - dir.z * w, c.floorY + 1.43 - hgt)], xd(c.xf, px * sgn, pd * sgn), col, undefined, { glow: BAKED }));
  }
}

function crates(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const n = c.plain === true ? 1 : 1 + Math.floor(hash01(c.seed + i, 319) * 3);
  for (let k = 0; k < n; k++) {
    const col: Rgb = hash01(c.seed + i * 5 + k, 320) < 0.5 ? [0.45, 0.32, 0.18] : [0.2, 0.3, 0.45];
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const stack = c.plain === true ? 2 : 1 + Math.floor(hash01(c.seed + i * 7 + k, 321) * 3);
    for (let t = 0; t < stack; t++) fbox(c, f.s + dir.x * u, f.d + dir.z * u, t * 0.31, 0.3, Math.min(0.3, f.sx / n / 2), f.sd / 2, dir, col, shade(col, 1.15));
  }
}

function ladder(c: Ctx, f: Furnishing): void {
  const s = f.s;
  const d = f.d;
  for (const sg of [-1, 1]) withMat("steel", () => c.out.prism(xp(c.xf, s + sg * 0.2, d + 0.6, c.floorY), xp(c.xf, s + sg * 0.2, d, c.floorY + Math.min(2.4, f.h)), 0.022, 4, [0.6, 0.6, 0.62]));
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    withMat("steel", () => c.out.prism(xp(c.xf, s - 0.2, d + 0.6 * (1 - t), c.floorY + Math.min(2.4, f.h) * t), xp(c.xf, s + 0.2, d + 0.6 * (1 - t), c.floorY + Math.min(2.4, f.h) * t), 0.012, 4, [0.62, 0.62, 0.64], null));
  }
}

function paintCans(c: Ctx, f: Furnishing, i: number): void {
  const cols: Rgb[] = [[0.85, 0.85, 0.8], [0.6, 0.55, 0.4], [0.7, 0.3, 0.2], [0.8, 0.8, 0.75]];
  const n = c.plain === true ? 1 : 3 + Math.floor(hash01(c.seed + i, 322) * 3);
  // The cans stand on a grid (none overlaps another), a few places left empty.
  for (let k = 0; k < n; k++) {
    const gx = (k % 3) - 1;
    const gz = Math.floor(k / 3);
    const step = Math.min(0.27, Math.max(0.21, (f.sx - 0.1) / 2));
    const p = xp(c.xf, f.s + gx * step, Math.max(0.3, f.d + (gz - 0.5) * 0.27), c.floorY);
    withMat("steel", () => c.out.cylinder(p[0], p[2], c.floorY + 0.05, 0.1, 0.2, 6, cols[k % 4] as Rgb, [0.5, 0.5, 0.5]));
  }
}

function poolTable(c: Ctx, f: Furnishing): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, 0.78, f.sx / 2, f.sd / 2, dir, [0.2, 0.12, 0.07], [0.1, 0.35, 0.2]);
}

function lift(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  for (const sg of [-1, 1]) fbox(c, f.s + dir.x * sg * f.sx * 0.42, f.d + dir.z * sg * f.sx * 0.42, 0, 2.1, 0.08, 0.1, dir, [0.8, 0.65, 0.1], [0.8, 0.65, 0.1], BAKED, false);
  const col: Rgb = pickOf([[0.5, 0.1, 0.1], [0.15, 0.25, 0.4], [0.4, 0.4, 0.42], [0.15, 0.3, 0.18]] as readonly Rgb[], c.seed + i, 325);
  fbox(c, f.s, f.d, 1.1, 0.5, f.sx * 0.38, f.sd * 0.4, dir, col, shade(col, 1.2));
  fbox(c, f.s, f.d, 1.6, 0.4, f.sx * 0.2, f.sd * 0.34, dir, shade(col, 0.9), shade(col, 1.1), BAKED, false);
}

function furnishing(c: Ctx, f: Furnishing, i: number): void {
  switch (f.kind) {
    case "shelf run": return withMat("wood", () => shelfRun(c, f, i));
    case "counter": return withMat("painted", () => counter(c, f, i));
    case "table": return withMat("wood", () => tableSet(c, f, i));
    case "booth": return withMat("boards", () => booth(c, f, i));
    case "stool row": return withMat("wood", () => stools(c, f, i));
    case "display case": return withMat("painted", () => displayCase(c, f, i));
    case "cooler": return withMat("painted", () => cooler(c, f, i));
    case "washer row": return withMat("painted", () => washers(c, f));
    case "desk": return withMat("wood", () => deskSet(c, f, i));
    case "rack": return withMat("steel", () => rack(c, f, i));
    case "stacked crates": return withMat("wood", () => crates(c, f, i));
    case "ladder": return withMat("steel", () => ladder(c, f));
    case "paint cans": return withMat("steel", () => paintCans(c, f, i));
    case "bench": return withMat("wood", () => benchSet(c, f, i));
    case "pool table": return withMat("wood", () => poolTable(c, f));
    case "lift": return withMat("steel", () => lift(c, f, i));
    case "partition": return withMat("boards", () => partition(c, f, i));
    case "endcap": return withMat("painted", () => endcap(c, f, i));
    case "checkout": return withMat("painted", () => checkout(c, f, i));
    case "bin": return withMat("plastic", () => bin(c, f, i));
    case "cart": return withMat("steel", () => cart(c, f, i));
    case "couch": return withMat("cloth", () => couch(c, f, i));
    case "machine": return withMat("painted", () => machine(c, f, i));
    case "cabinet": return withMat("painted", () => cabinets(c, f, i));
    case "water cooler": return withMat("painted", () => waterCooler(c, f));
    case "plant": return withMat("plant", () => plant(c, f, i));
    case "sheet": return withMat("cloth", () => sheet(c, f, i));
    case "windowbar": return withMat("wood", () => windowBar(c, f, i));
    case "hightable": return withMat("wood", () => highTable(c, f, i));
    case "stand": return withMat("wood", () => stand(c, f, i));
    case "stack": return withMat("wood", () => chairStack(c, f, i));
    case "roll": return withMat("rubber", () => carpetRoll(c, f, i));
    case "leaner": return withMat("wood", () => leaner(c, f, i));
  }
}

function lights(c: Ctx, list: readonly RoomLight[], ceiling: number, dead: readonly boolean[]): void {
  withMat("painted", () => {
    const NEON: readonly Rgb[] = [[1, 0.15, 0.12], [0.2, 0.55, 1], [1, 0.5, 0.15], [0.3, 1, 0.45]];
    list.forEach((l, i) => {
      const y = Math.min(l.h, ceiling - 0.05);
      const on = l.on && dead[i] !== true;
      switch (l.kind) {
        case "tube": {
          const dull: Rgb = dead[i] === true ? [0.38, 0.38, 0.34] : [0.55, 0.55, 0.52];
          fbox(c, l.s, l.d, y - 0.04, 0.04, 0.6, 0.05, AX, on ? [1, 0.97, 0.88] : dull, on ? [1, 0.97, 0.88] : dull, on ? 3.5 : BAKED);
          break;
        }
        case "pendant": {
          const p = xp(c.xf, l.s, l.d, c.floorY + y);
          withMat("steel", () => c.out.prism(xp(c.xf, l.s, l.d, c.floorY + ceiling), p, 0.008, 3, [0.1, 0.1, 0.1], null));
          withMat("painted", () => c.out.cylinder(p[0], p[2], c.floorY + y - 0.2, 0.2, 0.2, 6, on ? [0.95, 0.8, 0.45] : [0.35, 0.3, 0.2], [1, 0.9, 0.6], 0.05));
          break;
        }
        case "neon": {
          const col = pickOf(NEON, c.seed + i, 326);
          fbox(c, l.s, l.d, y, 0.04, 0.45, 0.02, AX, on ? col : scaled(col, 0.25), on ? col : scaled(col, 0.25), on ? 4 : 0.3, false);
          break;
        }
        case "lamp":
          fbox(c, l.s, l.d, y - 0.2, 0.2, 0.09, 0.09, AX, on ? [1, 0.85, 0.5] : [0.4, 0.35, 0.28], on ? [1, 0.85, 0.5] : [0.4, 0.35, 0.28], on ? 2.2 : 0.4, false);
          break;
      }
    });
  });
}

/** How much of the day an opening lets into the room, by what covers it. */
const THROUGH: Record<string, number> = { none: 1, display: 0.7, blinds: 0.5, papered: 0.45, boarded: 0, bricked: 0 };

/**
 * Where the doorway in the back partition is, from the unit's own number: a station of the back wall clear of what stands against it (a jog or a
 * half wall hides the stretch behind it), and whether it is open on a back room (else a shut door).
 */
export function doorwayOf(seed: number, s0: number, s1: number, blocked: readonly (readonly [number, number])[] = []): { s: number; open: boolean; w: number } {
  const w = 0.45;
  const lo0 = s0 + w + 0.35;
  const hi0 = s1 - w - 0.35;
  // The free stretches between the blocked ones; the doorway goes in the widest.
  let segs: [number, number][] = [[lo0, Math.max(lo0 + 0.1, hi0)]];
  for (const [b0, b1] of blocked) {
    const next: [number, number][] = [];
    for (const [a, b] of segs) {
      if (b1 + w < a || b0 - w > b) next.push([a, b]);
      else {
        if (b0 - w - a > 0.05) next.push([a, b0 - w]);
        if (b - (b1 + w) > 0.05) next.push([b1 + w, b]);
      }
    }
    segs = next;
  }
  if (segs.length === 0) segs = [[lo0, Math.max(lo0 + 0.1, hi0)]];
  const best = segs.reduce((p, q) => (q[1] - q[0] > p[1] - p[0] ? q : p));
  return { s: best[0] + hash01(seed, 327) * Math.max(0.1, best[1] - best[0]), open: hash01(seed, 741) < 0.55, w };
}

/** The room of one unit: between `r.s0` and `r.s1` across, from the face (`d` 0) to `interior.depth`, from the floor to the ceiling. */
export function roomGeometry(out: MeshBuilder, r: RoomIn): void {
  out.withHours(hoursCode(r.hours ?? null), () => room(out, r));
}

function room(out: MeshBuilder, r: RoomIn): void {
  const { xf, floorY, interior, detail } = r;
  const full = detail === "full";
  // A room a person stands in is drawn whole to its back wall, as one seen through its glass is, and with every face of everything.
  const whole = r.whole === true;
  const vacant = r.state === "vacant for lease" || r.state === "vacant boarded";
  const lit = r.lit;
  // What stands against the back wall hides the stretch behind it: the doorway goes where the partition shows.
  const blocked: [number, number][] = [];
  for (const f of interior.furnishings) {
    if (f.kind !== "partition") continue;
    const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
    blocked.push([f.s - ex, f.s + ex]);
  }
  const dw = doorwayOf(r.id, r.s0, r.s1, blocked);
  const day: DayOpening[] = r.openings.map((o) => ({ s0: Math.min(o.s0, o.s1), s1: Math.max(o.s0, o.s1), through: THROUGH[o.cover] ?? 1 }));
  // A tube has failed more often in an old unit that has had many tenants (nobody replaced it).
  const wear = vacant ? 0 : Math.min(0.3, 0.04 + 0.03 * r.past.length + (r.era < 1950 ? 0.03 : 0));
  const field = roomField({
    s0: r.s0, s1: r.s1, depth: interior.depth, ceiling: interior.ceiling, lights: interior.lights, openings: day, lit, vacant, furnishings: interior.furnishings,
    seed: r.id, wear, step: full ? 0.75 : 2.0, backLamp: dw.open && !vacant ? dw.s : null, exposure: interior.type === "bar" ? 0.42 : undefined,
  });
  const fin = finishOf(r);
  const feet: Foot[] = feetOf(interior.furnishings);
  const c: Ctx = {
    out, xf, floorY, seed: r.id, lit, vacant, detail, trade: r.trade, field, ceiling: interior.ceiling, s0: r.s0, s1: r.s1, d1: interior.depth, era: r.era, glassIn: r.glassIn ?? 0, n: 0, chairs: [],
    // A room that is in use ends, as drawn, at a painted sheet a little behind its front; a vacant one is drawn bare to its back wall.
    cut: r.through !== true && !whole && !vacant && interior.depth > BACKDROP_AT + BACKDROP_MIN_BEHIND ? BACKDROP_AT : undefined,
    type: interior.type, paint: fin.wall.paint, base: fin.base, door: { s: r.door.s, w: r.door.width }, feet, style: styleOf(r.id, r.trade, r.era, r.opened, r.remodel?.decade ?? 0),
    ...(whole ? { whole: true } : {}),
  };
  // The furnishings: all of them on the full tier, the largest few on the low.
  let list = interior.furnishings.map((f, i) => ({ f, i }));
  if (!full) list = [...list.filter(({ f }) => f.kind === "partition"), ...[...list].filter(({ f }) => f.kind !== "partition").sort((a, b) => b.f.sx * b.f.sd - a.f.sx * a.f.sd).slice(0, 6)];
  // The grid lines of the floor at the edges of what stands on it.
  const big = list.filter(({ f }) => f.sx * f.sd >= 0.5 && f.h >= 0.4).sort((a, b) => b.f.sx * b.f.sd - a.f.sx * a.f.sd).slice(0, 6);
  const anchors = { s: [] as number[], d: [] as number[] };
  for (const { f } of big) {
    const ex = (Math.abs(f.dir.x) * f.sx + Math.abs(f.dir.z) * f.sd) / 2;
    const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
    anchors.s.push(f.s - ex - 0.05, f.s + ex + 0.05);
    anchors.d.push(f.d - ez - 0.05, f.d + ez + 0.05);
  }
  roomShell(c, r, fin, anchors, dw);
  if (c.cut !== undefined && r.haze !== undefined) roomHaze(r.haze, xf, floorY, r.s0, r.s1, interior.ceiling, c.cut, field.veil, !full);
  if (c.cut !== undefined) backdrop(c, c.cut, interior.furnishings, interior.lights, field.dead, fin.floor.paint, fin.wall.paint, fin.ceiling.paint);
  for (const { f, i } of list) {
    // What stands wholly behind the sheet is on the sheet, painted, and not drawn.
    const ez = (Math.abs(f.dir.z) * f.sx + Math.abs(f.dir.x) * f.sd) / 2;
    if (c.cut !== undefined && f.d - ez > c.cut - 0.04) continue;
    // A small thing takes the veil at one depth, its own middle's (`Ctx.veilD`).
    const own: Ctx = ez <= 0.4 ? { ...c, n: i, veilD: f.d } : { ...c, n: i };
    // Past `PLAIN_FROM` (in a room with no sheet) a furnishing is its big shape, not its small parts; in a room a person stands in it is all of it.
    furnishing(full && !whole && f.d > PLAIN_FROM && f.kind !== "partition" ? { ...own, detail: "low", plain: true } : own, f, i);
  }
  floorThings(c, fin.checker);
  dressRoom(c, r, fin, dw);
  ceilingThings(c, interior.furnishings, interior.lights.map((l) => l.s));
  // The room's fixtures are drawn at the floor's height: their y is metres over the floor.
  lights(c, interior.lights, interior.ceiling, field.dead);
  if (!lit && !vacant) {
    // A shut unit keeps a night light on at the back.
    withMat("painted", () => fbox(c, (r.s0 + r.s1) / 2, interior.depth - 0.4, 2.0, 0.1, 0.2, 0.04, AX, [1, 0.85, 0.5], [1, 0.85, 0.5], 2));
  }
}
