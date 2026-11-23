/**
 * The room behind a unit's glass, and what is in it: a floor, a ceiling, the back wall and the two party walls (their faces turned
 * inward, since nobody sees them from outside), and the plan's furnishings (`unit.interior.furnishings`) and lights as simple forms that
 * read as what they are from the sidewalk: shelf runs with rows of small boxes of goods, counters with a till, tables, booths, stools, a
 * bar, coolers with lit fronts, washers in a row with their round doors, desks with a screen, racks of clothes, crates, ladders and paint
 * cans, a lift with a car on it. The lights are tubes, pendants, neon and lamps that glow when the plan has them on.
 *
 * The room lights itself (`fx.glow`): a room's surfaces are not lit by the sun that cannot reach them, and the plan says how bright the
 * room is by its state: an open unit's lit, a shut one's dim with a night light, a vacant one's grey. Everything here is drawn in the
 * building's own frame (`Xf`: `s` along the front from its left end, `d` into the building from its face), as the plan gives it, and
 * only the faces a person on the street could see are built.
 *
 * What is authored, not researched: the colours (rooms by their type, goods by the trade), the heights, the number of tiers and items, the
 * glow of each state. What the plan causes: which furnishings stand where, which lights are on, whether the unit is open, shut or vacant.
 */
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { ROOM_GLOW, PAINTS, pickOf } from "./buildingKit.js";
import type { Furnishing, Interior, RoomLight, Trade, UnitState } from "../../sim/town/types.js";
import type { Detail } from "./townTypes.js";
import type { Fx } from "./townSurface.js";

/** A building's front as the world sees it: the frame's origin on the ground, its outward normal, along-direction, and its size. */
export type Xf = { readonly ox: number; readonly oz: number; readonly nx: number; readonly nz: number; readonly tx: number; readonly tz: number; readonly width: number; readonly depth: number };

/** A point of the frame: `s` along, `d` in, `y` up (absolute). */
export const xp = (xf: Xf, s: number, d: number, y: number): Vec3 => [xf.ox + xf.tx * s - xf.nx * d, y, xf.oz + xf.tz * s - xf.nz * d];
/** The world direction of a direction (ds, dd) of the frame's plane. */
const xd = (xf: Xf, ds: number, dd: number): Vec3 => [xf.tx * ds - xf.nx * dd, 0, xf.tz * ds - xf.nz * dd];

type Pal = { wall: Rgb; floor: Rgb; floor2: Rgb; ceiling: Rgb };

function palette(type: Interior["type"], id: number, era: number, vacant: boolean): Pal {
  const p = pickOf(PAINTS, id, 301);
  const light = (c: Rgb): Rgb => [Math.min(0.8, c[0] * 1.05 + 0.04), Math.min(0.8, c[1] * 1.05 + 0.04), Math.min(0.8, c[2] * 1.05 + 0.03)];
  if (vacant) return { wall: scaled([0.58, 0.56, 0.5], 0.8 + hash01(id, 302) * 0.3), floor: [0.26, 0.24, 0.21], floor2: [0.3, 0.28, 0.24], ceiling: [0.42, 0.41, 0.38] };
  switch (type) {
    case "dining room":
    case "counter service":
      return { wall: light(p), floor: [0.62, 0.6, 0.55], floor2: [0.17, 0.17, 0.17], ceiling: [0.5, 0.5, 0.47] };
    case "bar":
      return { wall: [0.24, 0.15, 0.1], floor: [0.2, 0.13, 0.08], floor2: [0.17, 0.11, 0.07], ceiling: [0.16, 0.12, 0.09] };
    case "laundromat":
      return { wall: [0.66, 0.7, 0.72], floor: [0.5, 0.52, 0.52], floor2: [0.46, 0.48, 0.48], ceiling: [0.72, 0.72, 0.7] };
    case "office":
    case "lobby":
      return { wall: light(p), floor: [0.26, 0.3, 0.34], floor2: [0.24, 0.28, 0.32], ceiling: [0.52, 0.52, 0.5] };
    case "workshop":
      return { wall: [0.5, 0.5, 0.48], floor: [0.3, 0.3, 0.3], floor2: [0.27, 0.27, 0.27], ceiling: [0.4, 0.4, 0.38] };
    default:
      return { wall: era < 1950 ? scaled(light(p), 0.9) : light(p), floor: era < 1950 ? [0.33, 0.24, 0.15] : [0.5, 0.47, 0.4], floor2: era < 1950 ? [0.29, 0.21, 0.13] : [0.45, 0.42, 0.36], ceiling: [0.5, 0.5, 0.47] };
  }
}

/** The colours of goods by trade: packaging, authored. */
const GOODS_DEFAULT: readonly Rgb[] = [[0.7, 0.15, 0.1], [0.85, 0.7, 0.15], [0.15, 0.4, 0.2], [0.2, 0.3, 0.6], [0.8, 0.8, 0.75], [0.5, 0.3, 0.15], [0.12, 0.12, 0.13]];
const GOODS: Partial<Record<Trade, readonly Rgb[]>> = {
  hardware: [[0.85, 0.4, 0.08], [0.8, 0.7, 0.1], [0.12, 0.12, 0.13], [0.5, 0.52, 0.55], [0.15, 0.3, 0.55], [0.7, 0.12, 0.1]],
  grocery: [[0.7, 0.15, 0.1], [0.85, 0.7, 0.15], [0.15, 0.45, 0.2], [0.2, 0.3, 0.6], [0.85, 0.85, 0.8], [0.55, 0.3, 0.12]],
  "thrift store": [[0.45, 0.3, 0.25], [0.3, 0.35, 0.4], [0.55, 0.5, 0.35], [0.4, 0.2, 0.2], [0.25, 0.3, 0.25], [0.6, 0.55, 0.5]],
  "liquor store": [[0.1, 0.3, 0.12], [0.35, 0.2, 0.08], [0.75, 0.75, 0.7], [0.5, 0.1, 0.1], [0.12, 0.12, 0.3]],
  "bait and tackle": [[0.15, 0.4, 0.2], [0.8, 0.5, 0.1], [0.4, 0.42, 0.45], [0.7, 0.15, 0.1], [0.1, 0.2, 0.4]],
  bookstore: [[0.45, 0.15, 0.12], [0.15, 0.25, 0.4], [0.55, 0.45, 0.2], [0.2, 0.3, 0.2], [0.3, 0.2, 0.3], [0.7, 0.65, 0.55]],
  "gift shop": [[0.8, 0.4, 0.5], [0.3, 0.55, 0.6], [0.85, 0.75, 0.3], [0.9, 0.9, 0.85], [0.5, 0.35, 0.6]],
  pharmacy: [[0.85, 0.85, 0.85], [0.2, 0.5, 0.7], [0.75, 0.2, 0.2], [0.35, 0.65, 0.35]],
  "auto parts": [[0.8, 0.1, 0.1], [0.12, 0.12, 0.13], [0.85, 0.75, 0.1], [0.2, 0.3, 0.6]],
};

type Ctx = { out: MeshBuilder; xf: Xf; floorY: number; seed: number; glow: number; lit: boolean; detail: Detail; trade: Trade | null; n: number };

/**
 * A box in the frame: centre (`cs`, `cd`), base `y0`, height `h`, half-length `ha` along `dir` (a unit vector in the (s, d) plane) and half
 * `hb` across it. Only the faces a person outside could see: those that do not face away from the street (their normal's `d` part is
 * not positive), and the top.
 */
export function fbox(c: Ctx, cs: number, cd: number, y0: number, h: number, ha: number, hb: number, dir: { x: number; z: number }, side: Rgb, top: Rgb, glow: number = c.glow, sides = true): void {
  const { out, xf } = c;
  const ax = dir.x;
  const ad = dir.z;
  const bx = -ad;
  const bd = ax;
  const corner = (ka: number, kb: number): [number, number] => [cs + ax * ha * ka + bx * hb * kb, cd + ad * ha * ka + bd * hb * kb];
  const ring: [number, number][] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const norms: [number, number][] = [[-bx, -bd], [ax, ad], [bx, bd], [-ax, -ad]];
  const fx: Fx = { glow };
  y0 += c.floorY;
  const y1 = y0 + h;
  for (let i = 0; i < 4; i++) {
    const [ns, nd] = norms[i] as [number, number];
    if (nd > 0.35) continue;
    if (!sides && nd > -0.5) continue;
    const a = ring[i] as [number, number];
    const b = ring[(i + 1) % 4] as [number, number];
    out.poly([xp(xf, a[0], a[1], y0), xp(xf, b[0], b[1], y0), xp(xf, b[0], b[1], y1), xp(xf, a[0], a[1], y1)], xd(xf, ns, nd), nd < -0.5 ? side : scaled(side, 0.82), undefined, fx);
  }
  out.poly(ring.map(([s, d]) => xp(xf, s, d, y1)), [0, 1, 0], top, undefined, fx);
}

const AX = { x: 1, z: 0 };
const dirOf = (f: Furnishing): { x: number; z: number } => ({ x: f.dir.x, z: f.dir.z });
const pickGoods = (c: Ctx, k: number): Rgb => {
  const list = (c.trade !== null ? GOODS[c.trade] : undefined) ?? GOODS_DEFAULT;
  return list[Math.floor(hash01(c.seed + k * 7, 310) * list.length) % list.length] as Rgb;
};
const shade = (v: Rgb, k: number): Rgb => scaled(v, k);

function shelfRun(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const frame: Rgb = [0.5, 0.5, 0.5];
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dir, [0.22, 0.2, 0.18], frame);
  if (c.detail === "low") return;
  const tiers = Math.max(2, Math.min(5, Math.floor(f.h / 0.42)));
  const cap = c.detail === "full" ? 9 : 5;
  const items = Math.max(2, Math.min(cap, Math.floor(f.sx / 0.26)));
  const vx = dir.x;
  const vd = dir.z;
  for (let t = 0; t < tiers; t++) {
    const y = 0.18 + (t * (f.h - 0.3)) / tiers;
    fbox(c, f.s, f.d, y, 0.025, f.sx / 2, f.sd / 2 + 0.01, dir, frame, frame, c.glow, false);
    for (let k = 0; k < items; k++) {
      const u = -f.sx / 2 + ((k + 0.5) * f.sx) / items;
      const ih = Math.min(0.36, (f.h - 0.3) / tiers - 0.06) * (0.55 + hash01(c.seed + i * 31 + t * 5 + k, 311) * 0.5);
      const iw = (f.sx / items) * 0.42;
      const col = pickGoods(c, i * 97 + t * 13 + k);
      // The front rows face the street when the run is parallel to it, and an aisle's face its end: the item is a thin box on the shelf's near edge.
      fbox(c, f.s + vx * u, f.d + vd * u, y + 0.03, ih, iw, f.sd * 0.28, dir, col, shade(col, 1.1), c.glow, false);
    }
  }
}

function counter(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const wood: Rgb = hash01(c.seed + i, 312) < 0.5 ? [0.32, 0.2, 0.11] : [0.55, 0.52, 0.45];
  fbox(c, f.s, f.d, 0, f.h * 0.92, f.sx / 2, f.sd / 2, dir, wood, wood);
  fbox(c, f.s, f.d, f.h * 0.92, 0.05, f.sx / 2 + 0.03, f.sd / 2 + 0.05, dir, shade(wood, 0.7), [0.6, 0.58, 0.52]);
  // The till: a dark box with its screen.
  fbox(c, f.s - dir.x * f.sx * 0.15, f.d - dir.z * f.sx * 0.15, f.h * 0.92 + 0.05, 0.2, 0.18, 0.15, dir, [0.1, 0.1, 0.11], [0.12, 0.2, 0.15], c.lit ? 0.8 : c.glow);
}

function table(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const top: Rgb = hash01(c.seed + i, 313) < 0.5 ? [0.55, 0.5, 0.42] : [0.3, 0.2, 0.12];
  fbox(c, f.s, f.d, 0.7, 0.05, f.sx / 2, f.sd / 2, dir, shade(top, 0.8), top);
  fbox(c, f.s, f.d, 0, 0.7, 0.05, 0.05, dir, [0.15, 0.15, 0.16], [0.15, 0.15, 0.16], c.glow, false);
  if (c.detail === "low") return;
  const chair: Rgb = pickOf([[0.6, 0.15, 0.1], [0.15, 0.3, 0.35], [0.3, 0.2, 0.12], [0.35, 0.36, 0.38]] as readonly Rgb[], c.seed + i, 314);
  for (const sg of [-1, 1]) {
    const cs = f.s + dir.z * sg * (f.sd / 2 + 0.3);
    const cd = f.d - dir.x * sg * (f.sd / 2 + 0.3);
    fbox(c, cs, cd, 0.04, 0.42, 0.2, 0.2, AX, chair, shade(chair, 1.15), c.glow, false);
    fbox(c, cs, cd + sg * 0.19, 0.46, 0.45, 0.2, 0.03, AX, chair, chair, c.glow, false);
  }
}

function booth(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const vinyl: Rgb = pickOf([[0.6, 0.12, 0.1], [0.1, 0.3, 0.32], [0.14, 0.3, 0.16], [0.3, 0.18, 0.1]] as readonly Rgb[], c.seed, 315);
  fbox(c, f.s, f.d, 0, 0.46, f.sx / 2, f.sd / 2, dir, vinyl, shade(vinyl, 1.2));
  // The back: along the long side away from the window's middle.
  const px = -dir.z;
  const pd = dir.x;
  const k = hash01(c.seed + i, 316) < 0.5 ? 1 : -1;
  fbox(c, f.s + px * k * (f.sd / 2 - 0.06), f.d + pd * k * (f.sd / 2 - 0.06), 0.46, 0.65, f.sx / 2, 0.06, dir, vinyl, shade(vinyl, 1.05));
  void i;
}

function stools(c: Ctx, f: Furnishing): void {
  const dir = dirOf(f);
  const n = Math.max(1, Math.floor(f.sx / 0.62));
  for (let k = 0; k < n; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const s = f.s + dir.x * u;
    const d = f.d + dir.z * u;
    fbox(c, s, d, 0, 0.6, 0.03, 0.03, dir, [0.55, 0.55, 0.58], [0.55, 0.55, 0.58], c.glow, false);
    fbox(c, s, d, 0.6, 0.07, 0.17, 0.17, dir, [0.55, 0.1, 0.08], [0.65, 0.14, 0.1], c.glow, false);
  }
}

function displayCase(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, f.h * 0.9, f.sx / 2, f.sd / 2, dir, [0.55, 0.55, 0.54], [0.75, 0.82, 0.86], c.lit ? 0.9 : c.glow);
  if (c.detail === "low") return;
  for (let k = 0; k < 6; k++) {
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / 6;
    fbox(c, f.s + dir.x * u, f.d + dir.z * u, f.h * 0.9, 0.06, 0.05, 0.05, dir, pickGoods(c, i * 11 + k), pickGoods(c, i * 11 + k + 5), c.lit ? 1 : c.glow, false);
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
    const fs = s + px * sign * (f.sd / 2 + 0.01);
    const fd = d + pd * sign * (f.sd / 2 + 0.01);
    const ring: Vec3[] = [];
    for (let m = 0; m < 8; m++) {
      const ang = (m / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 0.2;
      ring.push(xp(c.xf, fs + dir.x * Math.cos(ang) * r, fd + dir.z * Math.cos(ang) * r, c.floorY + f.h * 0.5 + Math.sin(ang) * r));
    }
    c.out.poly(ring, xd(c.xf, px * sign, pd * sign), [0.12, 0.16, 0.2], undefined, { glow: 0.3 });
  }
}

function desk(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const wood: Rgb = hash01(c.seed + i, 317) < 0.5 ? [0.42, 0.3, 0.18] : [0.45, 0.46, 0.46];
  fbox(c, f.s, f.d, 0.7, 0.05, f.sx / 2, f.sd / 2, dir, shade(wood, 0.8), wood);
  fbox(c, f.s + dir.x * f.sx * 0.35, f.d + dir.z * f.sx * 0.35, 0, 0.7, f.sx * 0.12, f.sd / 2 - 0.04, dir, shade(wood, 0.9), shade(wood, 0.9), c.glow, false);
  if (c.detail === "low") return;
  fbox(c, f.s, f.d, 0.75, 0.3, 0.2, 0.03, dir, [0.07, 0.07, 0.08], [0.1, 0.1, 0.1], c.lit ? 0.9 : c.glow);
  fbox(c, f.s - dir.z * (f.sd / 2 + 0.35), f.d + dir.x * (f.sd / 2 + 0.35), 0.04, 0.9, 0.24, 0.24, AX, [0.1, 0.12, 0.2], [0.14, 0.16, 0.26], c.glow, false);
}

function rack(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const rail: Rgb = [0.5, 0.5, 0.52];
  fbox(c, f.s, f.d, 1.45, 0.03, f.sx / 2, 0.02, dir, rail, rail, c.glow, false);
  for (const sg of [-1, 1]) fbox(c, f.s + dir.x * sg * (f.sx / 2 - 0.03), f.d + dir.z * sg * (f.sx / 2 - 0.03), 0, 1.45, 0.02, 0.02, dir, rail, rail, c.glow, false);
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
    const w = 0.2;
    // A garment is a flat panel hung across the rail, seen from the street.
    const sgn = pd > 0 ? -1 : 1;
    c.out.poly([xp(c.xf, s - dir.x * w, d - dir.z * w, c.floorY + 1.43), xp(c.xf, s + dir.x * w, d + dir.z * w, c.floorY + 1.43), xp(c.xf, s + dir.x * w, d + dir.z * w, c.floorY + 1.43 - hgt), xp(c.xf, s - dir.x * w, d - dir.z * w, c.floorY + 1.43 - hgt)], xd(c.xf, px * sgn, pd * sgn), col, undefined, { glow: c.glow });
  }
}

function crates(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  const n = 1 + Math.floor(hash01(c.seed + i, 319) * 3);
  for (let k = 0; k < n; k++) {
    const col: Rgb = hash01(c.seed + i * 5 + k, 320) < 0.5 ? [0.45, 0.32, 0.18] : [0.2, 0.3, 0.45];
    const u = -f.sx / 2 + ((k + 0.5) * f.sx) / n;
    const stack = 1 + Math.floor(hash01(c.seed + i * 7 + k, 321) * 3);
    for (let t = 0; t < stack; t++) fbox(c, f.s + dir.x * u, f.d + dir.z * u, t * 0.3, 0.28, Math.min(0.3, f.sx / n / 2), f.sd / 2, dir, col, shade(col, 1.15));
  }
}

function ladder(c: Ctx, f: Furnishing): void {
  const s = f.s;
  const d = f.d;
  for (const sg of [-1, 1]) c.out.prism(xp(c.xf, s + sg * 0.2, d + 0.6, c.floorY), xp(c.xf, s + sg * 0.2, d, c.floorY + Math.min(2.4, f.h)), 0.022, 4, [0.6, 0.6, 0.62]);
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    c.out.prism(xp(c.xf, s - 0.2, d + 0.6 * (1 - t), c.floorY + Math.min(2.4, f.h) * t), xp(c.xf, s + 0.2, d + 0.6 * (1 - t), c.floorY + Math.min(2.4, f.h) * t), 0.012, 4, [0.62, 0.62, 0.64], null);
  }
}

function paintCans(c: Ctx, f: Furnishing, i: number): void {
  const cols: Rgb[] = [[0.85, 0.85, 0.8], [0.6, 0.55, 0.4], [0.7, 0.3, 0.2], [0.8, 0.8, 0.75]];
  c.out.poly([xp(c.xf, f.s - 0.5, f.d - 0.5, c.floorY + 0.01), xp(c.xf, f.s + 0.5, f.d - 0.5, c.floorY + 0.01), xp(c.xf, f.s + 0.5, f.d + 0.5, c.floorY + 0.01), xp(c.xf, f.s - 0.5, f.d + 0.5, c.floorY + 0.01)], [0, 1, 0], [0.7, 0.7, 0.66], undefined, { glow: c.glow });
  const n = 3 + Math.floor(hash01(c.seed + i, 322) * 3);
  for (let k = 0; k < n; k++) {
    const p = xp(c.xf, f.s + (hash01(c.seed + i * 9 + k, 323) - 0.5) * 0.8, f.d + (hash01(c.seed + i * 9 + k, 324) - 0.5) * 0.8, c.floorY);
    c.out.cylinder(p[0], p[2], c.floorY + 0.01, 0.1, 0.2, 6, cols[k % 4] as Rgb, [0.5, 0.5, 0.5]);
  }
}

function bench(c: Ctx, f: Furnishing): void {
  fbox(c, f.s, f.d, 0, f.h, f.sx / 2, f.sd / 2, dirOf(f), [0.3, 0.2, 0.12], [0.38, 0.27, 0.16]);
}

function poolTable(c: Ctx, f: Furnishing): void {
  const dir = dirOf(f);
  fbox(c, f.s, f.d, 0, 0.78, f.sx / 2, f.sd / 2, dir, [0.2, 0.12, 0.07], [0.1, 0.35, 0.2]);
}

function lift(c: Ctx, f: Furnishing, i: number): void {
  const dir = dirOf(f);
  for (const sg of [-1, 1]) fbox(c, f.s + dir.x * sg * f.sx * 0.42, f.d + dir.z * sg * f.sx * 0.42, 0, 2.1, 0.08, 0.1, dir, [0.8, 0.65, 0.1], [0.8, 0.65, 0.1], c.glow, false);
  const col: Rgb = pickOf([[0.5, 0.1, 0.1], [0.15, 0.25, 0.4], [0.4, 0.4, 0.42], [0.15, 0.3, 0.18]] as readonly Rgb[], c.seed + i, 325);
  fbox(c, f.s, f.d, 1.1, 0.5, f.sx * 0.38, f.sd * 0.4, dir, col, shade(col, 1.2));
  fbox(c, f.s, f.d, 1.6, 0.4, f.sx * 0.2, f.sd * 0.34, dir, shade(col, 0.9), shade(col, 1.1), c.glow, false);
}

function furnishing(c: Ctx, f: Furnishing, i: number): void {
  switch (f.kind) {
    case "shelf run": return shelfRun(c, f, i);
    case "counter": return counter(c, f, i);
    case "table": return table(c, f, i);
    case "booth": return booth(c, f, i);
    case "stool row": return stools(c, f);
    case "display case": return displayCase(c, f, i);
    case "cooler": return cooler(c, f, i);
    case "washer row": return washers(c, f);
    case "desk": return desk(c, f, i);
    case "rack": return rack(c, f, i);
    case "stacked crates": return crates(c, f, i);
    case "ladder": return ladder(c, f);
    case "paint cans": return paintCans(c, f, i);
    case "bench": return bench(c, f);
    case "pool table": return poolTable(c, f);
    case "lift": return lift(c, f, i);
  }
}

function lights(c: Ctx, list: readonly RoomLight[], ceiling: number): void {
  const NEON: readonly Rgb[] = [[1, 0.15, 0.12], [0.2, 0.55, 1], [1, 0.5, 0.15], [0.3, 1, 0.45]];
  list.forEach((l, i) => {
    const y = Math.min(l.h, ceiling - 0.05);
    switch (l.kind) {
      case "tube":
        fbox(c, l.s, l.d, y - 0.04, 0.04, 0.6, 0.05, AX, l.on ? [1, 0.97, 0.88] : [0.55, 0.55, 0.52], l.on ? [1, 0.97, 0.88] : [0.55, 0.55, 0.52], l.on ? 3.5 : 0.6);
        break;
      case "pendant": {
        const p = xp(c.xf, l.s, l.d, c.floorY + y);
        c.out.prism(xp(c.xf, l.s, l.d, c.floorY + ceiling), p, 0.008, 3, [0.1, 0.1, 0.1], null);
        c.out.cylinder(p[0], p[2], c.floorY + y - 0.2, 0.2, 0.2, 6, l.on ? [0.95, 0.8, 0.45] : [0.35, 0.3, 0.2], [1, 0.9, 0.6], 0.05);
        break;
      }
      case "neon": {
        const col = pickOf(NEON, c.seed + i, 326);
        fbox(c, l.s, l.d, y, 0.04, 0.45, 0.02, AX, l.on ? col : scaled(col, 0.25), l.on ? col : scaled(col, 0.25), l.on ? 4 : 0.3, false);
        break;
      }
      case "lamp":
        fbox(c, l.s, l.d, y - 0.2, 0.2, 0.09, 0.09, AX, l.on ? [1, 0.85, 0.5] : [0.4, 0.35, 0.28], l.on ? [1, 0.85, 0.5] : [0.4, 0.35, 0.28], l.on ? 2.2 : 0.4, false);
        break;
    }
  });
}

/**
 * The room of one unit: between `s0` and `s1` across, from the face (`d` 0) to `interior.depth`, from the floor to the ceiling. `state`
 * and `lit` set how bright it lights itself; `era` and the interior's type its colours.
 */
export function roomGeometry(
  out: MeshBuilder, xf: Xf, floorY: number, s0: number, s1: number, interior: Interior, state: UnitState, lit: boolean, trade: Trade | null, id: number, era: number, detail: Detail,
): void {
  const vacant = state === "vacant for lease" || state === "vacant boarded";
  const k = vacant ? ROOM_GLOW.vacant : lit ? ROOM_GLOW.open : ROOM_GLOW.shut;
  const c: Ctx = { out, xf, floorY, seed: id, glow: k, lit, detail, trade, n: 0 };
  const pal = palette(interior.type, id, era, vacant);
  const warm: Rgb = lit ? [1.05, 0.95, 0.76] : [0.9, 0.95, 1];
  const tone = (col: Rgb): Rgb => [col[0] * warm[0], col[1] * warm[1], col[2] * warm[2]];
  const top = floorY + interior.ceiling;
  const d0 = 0.15;
  const d1 = interior.depth;
  const fx: Fx = { glow: k };
  const quad = (a: [number, number, number], b: [number, number, number], cc: [number, number, number], dd: [number, number, number], hint: Vec3, col: Rgb): void => {
    out.poly([xp(xf, a[0], a[1], a[2]), xp(xf, b[0], b[1], b[2]), xp(xf, cc[0], cc[1], cc[2]), xp(xf, dd[0], dd[1], dd[2])], hint, tone(col), undefined, fx);
  };
  const toward = (ds: number, dd: number): Vec3 => xd(xf, ds, dd);
  // The floor (two tones in a diner's checker, in a band), the ceiling, the back wall, the two party walls.
  const fl = floorY + 0.02;
  quad([s0, d0, fl], [s1, d0, fl], [s1, d1, fl], [s0, d1, fl], [0, 1, 0], pal.floor);
  if (interior.type === "dining room" || interior.type === "counter service") {
    const n = Math.max(2, Math.floor((s1 - s0) / 0.6));
    for (let q = 0; q < n; q += 2) quad([s0 + (q * (s1 - s0)) / n, d0, fl + 0.005], [s0 + ((q + 1) * (s1 - s0)) / n, d0, fl + 0.005], [s0 + ((q + 1) * (s1 - s0)) / n, d1, fl + 0.005], [s0 + (q * (s1 - s0)) / n, d1, fl + 0.005], [0, 1, 0], pal.floor2);
  } else if (interior.type !== "empty") {
    quad([s0 + 0.05, d0, fl + 0.004], [s1 - 0.05, d0, fl + 0.004], [s1 - 0.05, d1 * 0.5, fl + 0.004], [s0 + 0.05, d1 * 0.5, fl + 0.004], [0, 1, 0], pal.floor2);
  }
  quad([s0, d0, top], [s1, d0, top], [s1, d1, top], [s0, d1, top], [0, -1, 0], pal.ceiling);
  quad([s0, d1, floorY], [s1, d1, floorY], [s1, d1, top], [s0, d1, top], toward(0, -1), scaled(pal.wall, 0.8));
  quad([s0, d0, floorY], [s0, d1, floorY], [s0, d1, top], [s0, d0, top], toward(1, 0), scaled(pal.wall, 0.62));
  quad([s1, d0, floorY], [s1, d1, floorY], [s1, d1, top], [s1, d0, top], toward(-1, 0), scaled(pal.wall, 0.62));
  if (detail !== "low") {
    // The back: a door, and over it the exit sign, which is lit whenever the building is kept up.
    const dw = Math.min(0.5, (s1 - s0) * 0.3);
    const ds = s0 + (s1 - s0) * (0.2 + hash01(id, 327) * 0.6);
    quad([ds - dw, d1 - 0.02, floorY], [ds + dw, d1 - 0.02, floorY], [ds + dw, d1 - 0.02, floorY + 2.05], [ds - dw, d1 - 0.02, floorY + 2.05], toward(0, -1), [0.3, 0.22, 0.14]);
    if (!vacant) out.poly([xp(xf, ds - 0.15, d1 - 0.03, floorY + 2.3), xp(xf, ds + 0.15, d1 - 0.03, floorY + 2.3), xp(xf, ds + 0.15, d1 - 0.03, floorY + 2.18), xp(xf, ds - 0.15, d1 - 0.03, floorY + 2.18)], toward(0, -1), [0.1, 0.8, 0.25], undefined, { glow: 2.5 });
    if (vacant) {
      // Patches where the last tenant's fixtures came off the wall.
      for (let p = 0; p < 3; p++) {
        const ps = s0 + 0.4 + hash01(id * 3 + p, 328) * Math.max(0.1, s1 - s0 - 1.2);
        const pw = 0.4 + hash01(id * 3 + p, 329) * 0.7;
        quad([ps, d1 - 0.015, floorY + 0.8 + p * 0.3], [ps + pw, d1 - 0.015, floorY + 0.8 + p * 0.3], [ps + pw, d1 - 0.015, floorY + 1.5 + p * 0.3], [ps, d1 - 0.015, floorY + 1.5 + p * 0.3], toward(0, -1), scaled(pal.wall, 0.8 + hash01(id + p, 330) * 0.35));
      }
    }
  }
  // The furnishings: all of them on the full tier, the largest few on the low.
  let list = interior.furnishings.map((f, i) => ({ f, i }));
  if (detail === "low") list = [...list].sort((a, b) => b.f.sx * b.f.sd - a.f.sx * a.f.sd).slice(0, 6);
  for (const { f, i } of list) furnishing({ ...c, n: i, out, xf, floorY }, f, i);
  // The room's fixtures are drawn at the floor's height: their y is metres over the floor.
  lights(c, interior.lights, interior.ceiling);
  if (!lit && !vacant) {
    // A shut unit keeps a night light on at the back.
    fbox(c, (s0 + s1) / 2, d1 - 0.4, 2.0, 0.1, 0.2, 0.04, AX, [1, 0.85, 0.5], [1, 0.85, 0.5], 2);
  }
}

/**
 * What a shop window with a display holds: a backdrop of painted board a metre in, a riser and the goods on it. `sa` to `sb` is the opening
 * in the frame's `s`, `sill` and `head` its heights over the floor.
 */
export function displayWindow(out: MeshBuilder, xf: Xf, floorY: number, sa: number, sb: number, sill: number, head: number, seed: number, trade: Trade | null, lit: boolean, detail: Detail): void {
  const c: Ctx = { out, xf, floorY, seed, glow: lit ? 0.9 : 0.35, lit, detail, trade, n: 0 };
  const back: Rgb = pickOf([[0.5, 0.18, 0.15], [0.2, 0.3, 0.4], [0.75, 0.7, 0.55], [0.18, 0.3, 0.2], [0.12, 0.12, 0.14]] as readonly Rgb[], seed, 340);
  const quad = (s0: number, s1: number, y0: number, y1: number, d: number, col: Rgb): void => {
    out.poly([xp(xf, s0, d, floorY + y0), xp(xf, s1, d, floorY + y0), xp(xf, s1, d, floorY + y1), xp(xf, s0, d, floorY + y1)], xd(xf, 0, -1), col, undefined, { glow: c.glow });
  };
  quad(sa, sb, sill, head - 0.15, 0.9, back);
  if (detail === "low") return;
  const mid = (sa + sb) / 2;
  const n = Math.max(2, Math.floor((sb - sa) / 0.45));
  fbox(c, mid, 0.5, sill - 0.02, 0.12, (sb - sa) / 2 - 0.1, 0.35, AX, [0.3, 0.22, 0.14], [0.42, 0.32, 0.2], c.glow, false);
  for (let k = 0; k < n; k++) {
    const u = sa + 0.15 + ((k + 0.5) * (sb - sa - 0.3)) / n;
    const hgt = 0.2 + hash01(seed * 5 + k, 341) * 0.45;
    const col = pickGoods(c, k + seed);
    fbox(c, u, 0.5, sill + 0.1, hgt, (sb - sa - 0.3) / n * 0.35, 0.12, AX, col, shade(col, 1.15), c.glow, false);
  }
}
