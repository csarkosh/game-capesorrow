/**
 * The shell of a unit's room: its floor, ceiling, back wall and the two party walls, as grids of quads (about 0.75 m on the full tier,
 * coarse on the low) so that the room's baked light (`roomLight.ts`) falls on them as it does on a real room: a bright floor under the
 * tubes and by the glass, a wall that darkens toward the back, a failed tube's dim patch. The surfaces are the town's scanned layers
 * where one fits (plank floors, concrete, plaster painted a colour, painted board, panelling, brick), tinted per unit, with a baseboard,
 * a wainscot where the trade or the age has one, and a doorway at the back to a back room (or a shut door).
 *
 * What the plan causes: the finish. An unlit vacant unit keeps the last tenant's paint (`past`), faded and stained; a unit that was
 * remodelled in the seventies has panelling; an old building has plank floors and a pressed-tin ceiling; the trade picks the colours
 * (a laundromat's pale blue and white, a bar's dark wood, an office's grey and carpet). What is authored: every colour, the heights and
 * spacings, how much each state stains.
 *
 * A room that is `whole` (a person stands in it, `RoomIn.whole`) also has its front wall, on the inside: the wall cut round the unit's own
 * openings and door, each window a bright pane with its frame (the pane shows the day and no street), and the door shut in its frame.
 */
import { type Hours } from "./hours.js";
import { withMat, type MatRef } from "./materials.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { PAINTS, pickOf } from "./buildingKit.js";
import { frameColour } from "./windowGeometry.js";
import { PANE_SETBACK, glassSheet } from "./roomGlass.js";
import { slatColour } from "./windowDressing.js";
import { BAKED, FACE_D, fbox, shade, wallPoint, xd, xp, type Ctx, type Xf } from "./roomKit.js";
import { VEIL_FROM, VEIL_TO } from "./roomLight.js";
import type { LayerName } from "./townLayers.js";
import type { Surface, UvFrame } from "./townSurface.js";
import type { Interior, Opening, PastTenant, Trade, Unit, UnitState } from "../../sim/town/types.js";
import type { Detail } from "./townTypes.js";

/** What `roomGeometry` is handed about the unit besides its room. */
export type RoomIn = {
  /** Where the room's haze goes (`roomHaze.ts`): a blended layer drawn before the glass. A room given none has no haze, only its veil and its sheet. */
  readonly haze?: MeshBuilder;
  /** The room is seen through its glass out of focus (`townBlur.ts`): it is drawn whole to its back wall, with no veil, sheet or haze. */
  readonly through?: boolean;
  readonly xf: Xf;
  readonly floorY: number;
  readonly s0: number;
  readonly s1: number;
  readonly interior: Interior;
  readonly state: UnitState;
  readonly lit: boolean;
  /** The unit's opening hours (`hours.ts`), which every layered vertex of its room carries; null for none (a unit shut for the day). */
  readonly hours?: Hours | null;
  readonly trade: Trade | null;
  readonly id: number;
  readonly era: number;
  /** The decade the tenant opened (0 for a vacant unit). */
  readonly opened: number;
  readonly detail: Detail;
  readonly openings: readonly Opening[];
  readonly remodel: Unit["remodel"];
  readonly past: readonly PastTenant[];
  readonly vacantSince: number | null;
  readonly door: { readonly s: number; readonly width: number; /** Where the door's head is, metres over the floor, as the street side draws it (the front's, 2.2 m or on an old tall front 2.65). None given is 2.2. */ readonly head?: number };
  /**
   * A person stands in this room, so it is built whole: as `through` builds it (to its back wall, with no sheet and no haze) and with nothing left
   * out for being unseen from the street: every side of every box, the underside of what hangs, the back room's doorway closed, and a front
   * wall on the inside (`roomShell.ts`). It is meant to be built into a `MeshBuilder` that lays backs (`insideGeometry.ts`).
   */
  readonly whole?: boolean;
  /** Dressing of a room's own, drawn last in a whole room with the room's context (the municipal hall's boards, flag and map: `municipalDecor.ts`). */
  readonly extras?: (c: Ctx) => void;
  /** How much deeper than 7 cm the unit's glass stands in its wall (the deeper openings of a masonry front: `glassOffOf`, `windowGeometry.ts`); what hangs in the window (`sillThings`) moves in with it. None given is 0. */
  readonly glassIn?: number;
};

/** A surface: the layer it is painted on (null for flat colour), its colour, and the gain that lifts a dark scanned picture to that colour. */
export type Layered = { readonly layer: LayerName | null; readonly paint: Rgb; readonly gain: Rgb };
export type Finish = {
  readonly wall: Layered;
  readonly wainscot: (Layered & { readonly h: number }) | null;
  readonly floor: Layered;
  readonly ceiling: Layered;
  readonly base: Rgb;
  /** A painted band round the wall at a height (a grocer's stripe), or null. */
  readonly stripe: { readonly y: number; readonly h: number; readonly paint: Rgb } | null;
  /** How stained the surfaces are (0 to 1). */
  readonly stain: number;
  /** A picture rail: a trim band round the wall under the ceiling, or null. */
  readonly rail: Rgb | null;
  /** The colour of the dark squares of a black-and-white tile floor, or null. */
  readonly checker: Rgb | null;
};

/** The reciprocal of a layer's mean colour (linear), so a tint of a colour on it comes out that colour on average. A paintable layer carries its paint as it is. */
const GAIN: Partial<Record<LayerName, Rgb>> = {
  planks_weathered: [7.4, 8, 10], planks_peeling: [8.6, 6.2, 7.8], concrete_board: [5.8, 6.6, 9.3], sidewalk: [3.5, 4, 5.7], plywood: [4.8, 8.2, 18.9], brick: [3.9, 6, 9.5], stone: [11, 15, 27],
};
const ONE: Rgb = [1, 1, 1];
const lay = (layer: LayerName | null, paint: Rgb): Layered => ({ layer, paint, gain: layer === null ? ONE : GAIN[layer] ?? ONE });

/** Paint by trade: what the walls of a unit of this trade are painted, authored. */
const TRADE_PAINT: Partial<Record<Trade, readonly Rgb[]>> = {
  cafe: [[0.72, 0.6, 0.38], [0.5, 0.58, 0.45], [0.66, 0.42, 0.3]], diner: [[0.7, 0.66, 0.5], [0.45, 0.6, 0.55], [0.7, 0.5, 0.38]], restaurant: [[0.5, 0.2, 0.18], [0.6, 0.52, 0.4]], bakery: [[0.78, 0.7, 0.5], [0.72, 0.5, 0.45]],
  "espresso stand": [[0.45, 0.3, 0.2]], "pizza and burgers": [[0.7, 0.28, 0.2], [0.75, 0.62, 0.3]],
  grocery: [[0.72, 0.72, 0.62], [0.6, 0.68, 0.55]], "convenience store": [[0.75, 0.75, 0.7]], "liquor store": [[0.35, 0.2, 0.15]],
  hardware: [[0.58, 0.6, 0.55], [0.7, 0.66, 0.5]], "garden and feed": [[0.55, 0.6, 0.45]], "bait and tackle": [[0.4, 0.5, 0.5], [0.5, 0.45, 0.35]], "marine supply": [[0.38, 0.45, 0.52]], "auto parts": [[0.62, 0.62, 0.6]],
  clothing: [[0.75, 0.7, 0.66], [0.62, 0.4, 0.45]], "thrift store": [[0.6, 0.62, 0.52], [0.62, 0.5, 0.45]], antiques: [[0.38, 0.22, 0.2], [0.3, 0.38, 0.3]], "gift shop": [[0.7, 0.55, 0.55], [0.5, 0.62, 0.65]], gallery: [[0.8, 0.8, 0.78]],
  bookstore: [[0.45, 0.32, 0.22], [0.5, 0.52, 0.4]], jeweler: [[0.3, 0.2, 0.25]], pharmacy: [[0.75, 0.78, 0.78]], "variety store": [[0.7, 0.68, 0.55]],
  "hair salon": [[0.7, 0.55, 0.6], [0.55, 0.65, 0.68]], barber: [[0.5, 0.2, 0.2], [0.3, 0.4, 0.5]], "tattoo parlor": [[0.15, 0.13, 0.15]],
  dentist: [[0.7, 0.78, 0.8]], "medical clinic": [[0.72, 0.78, 0.76]], veterinarian: [[0.65, 0.75, 0.7]],
  laundromat: [[0.68, 0.78, 0.8], [0.8, 0.82, 0.78]], "post office": [[0.7, 0.7, 0.62]], "movie theater": [[0.35, 0.12, 0.12]],
};
const TRADE_STRIPE: Partial<Record<Trade, Rgb>> = { grocery: [0.15, 0.4, 0.2], "convenience store": [0.6, 0.15, 0.12], pharmacy: [0.15, 0.4, 0.55], laundromat: [0.2, 0.45, 0.65], "pizza and burgers": [0.15, 0.3, 0.15], hardware: [0.7, 0.2, 0.1] };

/** The finish of a unit's room, from its record. */
export function finishOf(r: RoomIn): Finish {
  let f: Finish = { ...finishBase(r), checker: null, rail: null };
  const open = r.state !== "vacant for lease" && r.state !== "vacant boarded";
  if (open) {
    const type = r.interior.type;
    const food = r.trade !== null && ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers", "fish market"].includes(r.trade);
    // A strong dado in another colour and another material than the wall's: tile in a kitchen's room, dark panelling in a bar, a painted band elsewhere.
    if (type === "bar") f = { ...f, wainscot: { ...lay("planks_weathered", [0.16, 0.09, 0.05]), h: 1.2 }, rail: [0.1, 0.06, 0.04] };
    else if (food && hash01(r.id, 727) < 0.7) f = { ...f, wainscot: { ...lay(null, pickOf([[0.85, 0.85, 0.8], [0.35, 0.5, 0.45], [0.75, 0.82, 0.85], [0.8, 0.7, 0.55]] as readonly Rgb[], r.id, 728)), h: 1.2 }, rail: [0.25, 0.2, 0.15] };
    else if (type !== "workshop" && type !== "laundromat" && (f.wainscot === null || hash01(r.id, 723) < 0.3)) {
      const band: Rgb = hash01(r.id, 724) < 0.4 ? scaled(f.wall.paint, 0.5) : pickOf([[0.2, 0.32, 0.3], [0.4, 0.2, 0.18], [0.22, 0.26, 0.4], [0.5, 0.42, 0.25], [0.25, 0.4, 0.22]] as readonly Rgb[], r.id, 725);
      f = { ...f, wainscot: { ...lay(null, band), h: 0.9 + hash01(r.id, 726) * 0.3 } };
    }
    if (f.rail === null && type !== "workshop" && hash01(r.id, 729) < 0.55) f = { ...f, rail: scaled(f.wall.paint, 0.45) };
    // A ceiling darker than the walls, so that the room stops glowing as a pale box.
    if (type !== "bar") f = { ...f, ceiling: { ...f.ceiling, paint: scaled(f.ceiling.paint, 0.6) } };
  }
  // An old diner has black-and-white tile.
  if (open && r.trade === "diner" && (r.opened < 1985 || r.era < 1965) && hash01(r.id, 722) < 0.8) f = { ...f, floor: lay(null, [0.74, 0.72, 0.64]), checker: [0.12, 0.12, 0.13] };
  return f;
}

function finishBase(r: RoomIn): Omit<Finish, "checker" | "rail"> {
  const vacant = r.state === "vacant for lease" || r.state === "vacant boarded";
  const type = r.interior.type;
  // A vacant unit keeps the last tenant's paint; an open one its own trade's; a plain one a colour of the town's.
  const last = r.past.length > 0 ? r.past[r.past.length - 1] : undefined;
  const palTrade = vacant ? last?.trade ?? null : r.trade;
  const list = palTrade !== null ? TRADE_PAINT[palTrade] : undefined;
  let paint: Rgb = list !== undefined ? pickOf(list, r.id, 710) : pickOf(PAINTS, r.id, 711);
  const dec = r.remodel?.decade ?? 0;
  const old = r.era < 1950;
  const stain = vacant ? Math.min(1, 0.35 + 0.015 * (2026 - (r.vacantSince ?? 2010))) : 0.1 + (old ? 0.08 : 0);
  if (vacant) paint = [paint[0] * 0.75 + 0.1, paint[1] * 0.75 + 0.1, paint[2] * 0.75 + 0.09];
  const stripe = !vacant && r.trade !== null && TRADE_STRIPE[r.trade] !== undefined && hash01(r.id, 712) < 0.7 ? { y: 1.0, h: 0.14, paint: TRADE_STRIPE[r.trade] as Rgb } : null;
  const ceilingPaint: Rgb = old ? [0.58, 0.55, 0.46] : [0.58, 0.58, 0.55];
  if (vacant) {
    return {
      wall: lay("stucco", paint), wainscot: null,
      floor: type === "workshop" || r.era >= 1960 ? lay("sidewalk", [0.3, 0.29, 0.26]) : lay("planks_weathered", [0.3, 0.26, 0.2]),
      ceiling: lay(null, scaled(ceilingPaint, 0.8)), base: [0.2, 0.18, 0.15], stripe: null, stain,
    };
  }
  switch (type) {
    case "bar":
      return { wall: lay("planks_weathered", [0.4, 0.24, 0.12]), wainscot: null, floor: lay("planks_weathered", [0.28, 0.17, 0.09]), ceiling: lay(null, [0.26, 0.2, 0.15]), base: [0.12, 0.08, 0.05], stripe: null, stain };
    case "dining room":
    case "counter service": {
      const beadboard = old || hash01(r.id, 713) < 0.4;
      const wain: Rgb = hash01(r.id, 714) < 0.5 ? [0.55, 0.5, 0.4] : [0.3, 0.42, 0.36];
      return {
        wall: lay("stucco", paint), wainscot: beadboard ? { ...lay("planks_weathered", wain), h: 1.05 } : null,
        floor: old && hash01(r.id, 715) < 0.6 ? lay("planks_weathered", [0.4, 0.28, 0.16]) : lay("sidewalk", hash01(r.id, 716) < 0.5 ? [0.66, 0.62, 0.52] : [0.5, 0.5, 0.46]),
        ceiling: lay(null, ceilingPaint), base: scaled(wain, 0.6), stripe, stain,
      };
    }
    case "laundromat":
      return { wall: lay("stucco", paint), wainscot: null, floor: lay("sidewalk", [0.56, 0.58, 0.56]), ceiling: lay(null, [0.64, 0.64, 0.62]), base: [0.3, 0.38, 0.42], stripe, stain };
    case "workshop":
      return { wall: lay("concrete_board", [0.5, 0.5, 0.47]), wainscot: null, floor: lay("sidewalk", [0.3, 0.3, 0.3]), ceiling: lay(null, [0.4, 0.4, 0.38]), base: [0.2, 0.2, 0.2], stripe: null, stain: stain + 0.12 };
    case "office":
    case "lobby": {
      const panelled = dec >= 1960 && dec < 1980;
      const bank = r.trade === "bank" || r.trade === "credit union";
      return {
        wall: panelled ? lay("planks_weathered", [0.42, 0.28, 0.16]) : lay("stucco", paint),
        wainscot: (old && r.era < 1930) || bank ? { ...lay("planks_weathered", [0.38, 0.25, 0.14]), h: 1.1 } : null,
        floor: bank && old ? lay("planks_weathered", [0.32, 0.22, 0.13]) : lay("stucco", pickOf([[0.2, 0.25, 0.32], [0.3, 0.26, 0.22], [0.22, 0.3, 0.26]] as readonly Rgb[], r.id, 717)),
        ceiling: lay(null, ceilingPaint), base: [0.2, 0.17, 0.14], stripe: null, stain,
      };
    }
    default: {
      // Retail: an old shop has plank floors, a newer one vinyl; one remodelled in the seventies is panelled.
      const panelled = dec >= 1965 && dec < 1985 && hash01(r.id, 718) < 0.6;
      return {
        wall: panelled ? lay("planks_weathered", [0.42, 0.28, 0.16]) : lay("stucco", paint),
        wainscot: old && hash01(r.id, 719) < 0.35 ? { ...lay("planks_weathered", [0.42, 0.34, 0.24]), h: 1.0 } : null,
        floor: old && r.trade !== "grocery" && r.trade !== "pharmacy" ? lay("planks_weathered", pickOf([[0.42, 0.3, 0.18], [0.36, 0.26, 0.15], [0.5, 0.4, 0.26]] as readonly Rgb[], r.id, 720)) : lay("sidewalk", pickOf([[0.62, 0.6, 0.5], [0.48, 0.5, 0.5], [0.58, 0.52, 0.44]] as readonly Rgb[], r.id, 721)),
        ceiling: lay(null, ceilingPaint), base: scaled(paint, 0.55), stripe, stain,
      };
    }
  }
}

/** Positions from `a` to `b` about `step` apart, with the `anchors` between (an edge of a thing standing on the floor), none closer than 0.16 m. */
function lines(a: number, b: number, step: number, anchors: readonly number[], cap: number): number[] {
  const n = Math.max(1, Math.round((b - a) / step));
  const xs: number[] = [];
  for (let k = 1; k < n; k++) xs.push(a + ((b - a) * k) / n);
  for (const x of anchors) if (x > a + 0.15 && x < b - 0.15) xs.push(x);
  xs.sort((p, q) => p - q);
  const out: number[] = [a];
  for (const x of xs) if (x - (out[out.length - 1] as number) >= 0.16 && b - x >= 0.16) out.push(x);
  out.push(b);
  if (out.length > cap) {
    // Too many lines: the plain spacing only.
    const plain: number[] = [a];
    for (let k = 1; k < n; k++) plain.push(a + ((b - a) * k) / n);
    plain.push(b);
    return plain;
  }
  return out;
}

/** Where the veil's ramp is cut into a surface that runs from the glass back: its start, its middle and its end (`roomLight.ts`). */
const VEIL_LINES: readonly number[] = [VEIL_FROM, (VEIL_FROM + VEIL_TO) / 2, VEIL_TO];

const frac = (xs: readonly number[]): number[] => xs.map((x) => (x - (xs[0] as number)) / ((xs[xs.length - 1] as number) - (xs[0] as number)));

/** The world direction of a frame direction, as a unit vector (the surface's texture axes). */
const unit3 = (v: Vec3): Vec3 => {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : v;
};

/** A finish laid on a surface that runs from `origin` along `u` and `v`: its layer, framed as given, or none for flat paint. */
function layerSurface(f: Layered, origin: Vec3, u: Vec3, v: Vec3): Surface | undefined {
  return f.layer === null ? undefined : { layer: f.layer, frame: { origin, u: unit3(u), v: unit3(v) } as UvFrame, tint: f.gain };
}

export type Band = { y0: number; y1: number; f: Layered; kind: "base" | "wain" | "wall" | "stripe"; /** The material the band is of, in the place of its kind's (a designed room's wainscot of dark timber). */ mat?: MatRef };

/** The colour of a pane in daylight, a pale overcast one, and how strongly it lights itself (the day's glow: it is dark at night, `DAY_GLOW_CODE` in `townMaterial.ts`). */
const PANE: Rgb = [0.8, 0.86, 0.92];
const PANE_GLOW = 1.15;
/** How much of the day an opening lets through, by what covers it (as the room's own light takes it, `THROUGH` in `roomGeometry.ts`). */
const LETS: Record<string, number> = { none: 1, display: 0.7, blinds: 0.5, papered: 0.45, boarded: 0, bricked: 0 };
/** A door's leaf of the tints the back door has, and the window frame's bar, how wide a bar of a frame is, and how far a bar stands proud of the wall (3 cm, the step the depth buffer holds apart: `ladder` in `roomKit.ts`). */
const BAR = 0.06;
const PROUD = 0.03;

/**
 * The front wall of a room a person stands in, on its inside face at `FACE_D` and looking into the room: the wall's bands cut round the openings the
 * unit has (and its door), a bright pane in each window with its frame (and what covers it: slats, paper, boards), and the door shut in its frame, as
 * the street side lays them out (`frontGeometry.ts`). A pane shows the day and not the street: it is a sheet that glows with the daylight and is dark at night.
 */
export function frontWall(c: Ctx, r: Pick<RoomIn, "door" | "openings">, bands: readonly Band[]): void {
  const { out, xf, floorY, s0, s1 } = c;
  const top = c.ceiling;
  const d0 = FACE_D;
  const full = c.detail === "full";
  const dw = r.door.width;
  const doorHead = Math.min(r.door.head ?? 2.2, top - 0.1);
  type Hole = { a0: number; a1: number; y0: number; y1: number; cover: string };
  const holes: Hole[] = [{ a0: Math.max(s0, r.door.s - dw / 2), a1: Math.min(s1, r.door.s + dw / 2), y0: 0, y1: doorHead, cover: "door" }];
  // Each opening the street side has, but a bricked one (which is wall on the inside); one that crosses another is dropped, as `cutWall` drops it.
  for (const o of r.openings) {
    if (o.cover === "bricked") continue;
    const h: Hole = { a0: Math.max(s0, Math.min(o.s0, o.s1)), a1: Math.min(s1, Math.max(o.s0, o.s1)), y0: Math.max(0.02, o.sill), y1: Math.min(top - 0.05, o.head), cover: o.cover };
    if (h.a1 - h.a0 < 0.1 || h.y1 - h.y0 < 0.1) continue;
    if (holes.some((k) => h.a0 < k.a1 - 1e-3 && h.a1 > k.a0 + 1e-3 && h.y0 < k.y1 - 1e-3 && h.y1 > k.y0 + 1e-3)) continue;
    holes.push(h);
  }
  const noise = (a: number, b: number, k: number): number => hash01(c.seed * 131 + a * 17 + b * 29, 760 + k) - 0.5;
  const P = (a: number, y: number, off: number): Vec3 => xp(xf, a, d0 + off, floorY + y);
  const into = xd(xf, 0, 1);

  // ---- the wall: each band cut into strips at the holes' heights, and each strip into the stretches between the holes that cross it
  const piece = (a0: number, a1: number, y0: number, y1: number, b: Band, k: number): void => {
    if (a1 - a0 < 0.03 || y1 - y0 < 0.02) return;
    const cstep = b.kind === "base" ? 3 : b.kind === "wain" || b.kind === "stripe" ? 1.6 : full ? 1.25 : 5;
    const us = lines(a0, a1, cstep, [], 43);
    const rows = b.kind === "wall" ? Math.max(1, Math.round((y1 - y0) / (full ? 0.95 : 3.6))) : 1;
    const vs: number[] = [];
    for (let q = 0; q <= rows; q++) vs.push(y0 + ((y1 - y0) * q) / rows);
    const origin = P(a0, y0, 0);
    const along = xd(xf, a1 - a0, 0);
    withMat(b.mat ?? (b.kind === "base" || b.kind === "stripe" ? "boards" : "plaster"), () => out.litGrid(origin, along, [0, y1 - y0, 0], frac(us), frac(vs), into, (i, j) => {
      const y = vs[j] as number;
      let mod = 1 + noise(i * 3 + k, j, 3) * 0.12;
      if (y < 0.5) mod *= 0.9;
      return shade(c, scaled(b.f.paint, mod * 0.66), us[i] as number, d0, y, 0);
    }, layerSurface(b.f, origin, along, [0, 1, 0]), { glow: 1 }));
  };
  let k = 6;
  for (const b of bands) {
    const ys = [b.y0, b.y1];
    for (const h of holes) for (const y of [h.y0, h.y1]) if (y > b.y0 + 1e-3 && y < b.y1 - 1e-3) ys.push(y);
    ys.sort((p, q) => p - q);
    for (let t = 0; t + 1 < ys.length; t++) {
      const ya = ys[t] as number;
      const yb = ys[t + 1] as number;
      if (yb - ya < 1e-3) continue;
      const mid = (ya + yb) / 2;
      const blocked = holes.filter((h) => h.y0 <= mid && mid <= h.y1).sort((p, q) => p.a0 - q.a0);
      let at = s0;
      for (const h of blocked) {
        if (h.a0 > at) piece(at, h.a0, ya, yb, b, k++);
        at = Math.max(at, h.a1);
      }
      if (s1 > at) piece(at, s1, ya, yb, b, k++);
    }
  }

  // ---- what is laid in the holes
  /** A flat quad on the wall's plane or `off` into the room, lit by the room. */
  const flat = (a0: number, a1: number, y0: number, y1: number, off: number, albedo: Rgb, mat: MatRef): void => {
    const at = (a: number, y: number): Rgb => shade(c, albedo, a, d0 + off, y, 0);
    withMat(mat, () => out.poly([P(a0, y0, off), P(a1, y0, off), P(a1, y1, off), P(a0, y1, off)], into, [at(a0, y0), at(a1, y0), at(a1, y1), at(a0, y1)], undefined, { glow: 1 }));
  };
  /** A pane: a bright sheet on the wall's plane that follows the day (the hours code 0 is the day's glow), `lets` of it let through. */
  const pane = (a0: number, a1: number, y0: number, y1: number, lets: number, colour: Rgb = PANE, glow: number = PANE_GLOW, setback = PANE_SETBACK): void => {
    // Where the room has a layer for through glass (`roomGlass.ts`), a pane is that: a sheet set back into the wall's thickness, with the reveal drawn round it, read out of focus over the sky.
    if (c.glass != null && glow === PANE_GLOW) {
      if (setback >= 0.05) {
        const rev = scaled(frameColour(c.seed, c.era, false), 0.85);
        const face = (pts: readonly Vec3[], n: Vec3, a: number, y: number): void => withMat("painted", () => out.poly(pts, n, shade(c, rev, a, d0, y, 0), undefined, { glow: 1 }));
        face([P(a0, y0, 0), P(a0, y0, -setback), P(a0, y1, -setback), P(a0, y1, 0)], xd(xf, 1, 0), a0, (y0 + y1) / 2);
        face([P(a1, y0, 0), P(a1, y0, -setback), P(a1, y1, -setback), P(a1, y1, 0)], xd(xf, -1, 0), a1, (y0 + y1) / 2);
        face([P(a0, y0, 0), P(a1, y0, 0), P(a1, y0, -setback), P(a0, y0, -setback)], [0, 1, 0], (a0 + a1) / 2, y0);
        face([P(a0, y1, 0), P(a1, y1, 0), P(a1, y1, -setback), P(a0, y1, -setback)], [0, -1, 0], (a0 + a1) / 2, y1);
      }
      glassSheet(c.glass, [P(a0, y0, -setback), P(a1, y0, -setback), P(a1, y1, -setback), P(a0, y1, -setback)], into, c.seed * 31 + Math.round(a0 * 10) + Math.round(y0 * 7), [y1 - y0, a1 - a0]);
      return;
    }
    withMat("painted", () => out.withHours(0, () => out.poly([P(a0, y0, 0), P(a1, y0, 0), P(a1, y1, 0), P(a0, y1, 0)], into, scaled(colour, lets), undefined, { glow })));
  };
  const frame = frameColour(c.seed, c.era, false);
  /** A bar of a frame, proud of the wall. */
  const bar = (a0: number, a1: number, y0: number, y1: number, colour: Rgb): void => flat(a0, a1, y0, y1, PROUD, colour, "painted");

  holes.forEach((h, n) => {
    if (h.cover === "door") return;
    const lets = LETS[h.cover] ?? 1;
    if (h.cover === "boarded") {
      flat(h.a0, h.a1, h.y0, h.y1, 0, [0.6, 0.45, 0.28], "ply");
      for (const f of [0.25, 0.7]) bar(h.a0 - 0.04, h.a1 + 0.04, h.y0 + (h.y1 - h.y0) * f, h.y0 + (h.y1 - h.y0) * f + 0.1, [0.42, 0.32, 0.2]);
      return;
    }
    if (h.cover === "papered") pane(h.a0, h.a1, h.y0, h.y1, 1, [0.86, 0.8, 0.62], 0.5);
    else pane(h.a0, h.a1, h.y0, h.y1, lets);
    if (h.cover === "blinds") {
      // Slats hanging from the head, part raised, each a thin dark band with the daylight between.
      const seed = c.seed + n;
      const drop = (h.y1 - h.y0) * (0.4 + hash01(seed, 432) * 0.55);
      const col = slatColour(seed);
      for (let y = h.y1 - 0.06; y > h.y1 - drop; y -= 0.12) flat(h.a0, h.a1, y - 0.07, y, PROUD * 0.5, scaled(col, 0.9), "cloth");
    }
    // The frame: four bars round the opening, a bar a pane's height up across an old front's tall window, and a sill board.
    bar(h.a0 - BAR, h.a1 + BAR, h.y0 - BAR, h.y0, frame);
    bar(h.a0 - BAR, h.a1 + BAR, h.y1, h.y1 + BAR, frame);
    bar(h.a0 - BAR, h.a0, h.y0, h.y1, frame);
    bar(h.a1, h.a1 + BAR, h.y0, h.y1, frame);
    if (c.era < 1930 && h.y1 - h.y0 > 1.8) bar(h.a0, h.a1, h.y1 - 0.5, h.y1 - 0.45, frame);
    if (full && h.y0 > 0.3) withMat("wood", () => fbox(c, (h.a0 + h.a1) / 2, d0 + 0.08, h.y0 - 0.04, 0.04, (h.a1 - h.a0) / 2 + 0.06, 0.08, { x: 1, z: 0 }, scaled(frame, 0.9), frame));
  });

  // ---- the door: its leaf (a board kick panel, glass over it, a board or glass over that) in a frame, with its casing and a brass pull
  const door = holes[0] as Hole;
  const leaf: Rgb = c.vacant ? [0.32, 0.28, 0.22] : pickOf([[0.35, 0.22, 0.14], [0.45, 0.45, 0.42], [0.3, 0.34, 0.3]] as readonly Rgb[], c.seed, 742);
  const leafTop = Math.min(2.05, doorHead - 0.05);
  flat(door.a0, door.a1, 0, 0.8, 0, leaf, "boards");
  pane(door.a0, door.a1, 0.8, leafTop, 1, PANE, PANE_GLOW, 0.03);
  if (doorHead > 2.3) pane(door.a0, door.a1, leafTop, doorHead, 1, PANE, PANE_GLOW, 0.03);
  else flat(door.a0, door.a1, leafTop, doorHead, 0, leaf, "boards");
  const w9 = 0.09;
  bar(door.a0, door.a0 + w9, 0, doorHead, leaf);
  bar(door.a1 - w9, door.a1, 0, doorHead, leaf);
  bar(door.a0, door.a1, 0.76, 0.86, leaf);
  bar(door.a0, door.a1, leafTop - 0.05, leafTop + 0.05, leaf);
  bar(door.a0, door.a1, doorHead - w9, doorHead, leaf);
  if (dw > 1.4) bar((door.a0 + door.a1) / 2 - 0.03, (door.a0 + door.a1) / 2 + 0.03, 0, doorHead, leaf);
  bar(door.a0 - 0.08, door.a0, 0, doorHead + 0.08, frame);
  bar(door.a1, door.a1 + 0.08, 0, doorHead + 0.08, frame);
  bar(door.a0 - 0.08, door.a1 + 0.08, doorHead, doorHead + 0.08, frame);
  withMat("steel", () => fbox(c, door.a1 - 0.17, d0 + 0.05, 0.95, 0.15, 0.02, 0.05, { x: 1, z: 0 }, [0.6, 0.5, 0.2], [0.65, 0.55, 0.25]));
}

/** What the shell hands back for what stands in it: where the doorway to the back room is. */
export type ShellOut = { readonly doorS: number; readonly doorW: number; readonly open: boolean };

/**
 * Builds the shell into `c.out`: the floor and ceiling, the three walls in bands (baseboard, wainscot, wall, with a stripe where there is
 * one), the doorway at the back and its recess or a shut door. `anchors` are the stations of the furnishings' edges on the floor
 * (`s` and `d`), where the floor's grid has its lines so that a shadow under a counter has an edge.
 */
export function roomShell(c: Ctx, r: RoomIn, fin: Finish, anchors: { s: number[]; d: number[] }, dw: { s: number; open: boolean; w: number }): ShellOut {
  const { out, xf, floorY } = c;
  const full = c.detail === "full";
  const d0 = FACE_D;
  // Where the room as drawn ends: its back wall, or the painted sheet that stands for the rest of it (`roomBackdrop.ts`).
  const sheet = c.cut !== undefined;
  const d1 = c.cut ?? c.d1;
  const { s0, s1 } = c;
  const top = c.ceiling;
  const vacant = c.vacant;
  const step = full ? 1.0 : 2.2;
  const noise = (a: number, b: number, k: number): number => hash01(c.seed * 131 + a * 17 + b * 29, 740 + k) - 0.5;
  const surf = (f: Layered, origin: Vec3, u: Vec3, v: Vec3): Surface | undefined => layerSurface(f, origin, u, v);
  const stain = fin.stain;
  // The doorway: at a station of the back wall where no tall furnishing stands, 0.9 m wide; open (a lit back room) or shut (a door).
  const doorW = dw.w;
  const ds = dw.s;
  const open = dw.open;

  // ---- floor
  {
    const us = lines(s0, s1, full ? step : 4, anchors.s, full ? 12 : 3);
    // The veil's ramp is cut into the floor, the ceiling and the side walls at every detail: a strip from the glass to the back wall would run it out over the whole room.
    const vs = lines(d0, d1, full ? step : 4, [...anchors.d, ...VEIL_LINES], full ? 25 : 7);
    const origin = xp(xf, s0, d0, floorY + 0.08);
    withMat(c.era < 1950 ? "boards" : "concrete", () => out.litGrid(origin, xd(xf, s1 - s0, 0), xd(xf, 0, d1 - d0), frac(us), frac(vs), [0, 1, 0], (i, j) => {
      const s = us[i] as number;
      const d = vs[j] as number;
      const mottle = 1 + noise(i, j, 0) * (0.12 + stain * 0.3);
      const a = scaled(fin.floor.paint, mottle * c.field.under(s, d));
      return shade(c, a, s, d, 0, 1);
    }, surf(fin.floor, origin, xd(xf, 1, 0), xd(xf, 0, 1)), { glow: 1 }));
  }
  // ---- ceiling
  {
    const cstep = full ? 1.6 : 99;
    const us = lines(s0, s1, cstep, [], 8);
    const vs = lines(d0, d1, cstep, VEIL_LINES, 15);
    const origin = xp(xf, s0, d0, floorY + top);
    withMat("plaster", () => out.litGrid(origin, xd(xf, s1 - s0, 0), xd(xf, 0, d1 - d0), frac(us), frac(vs), [0, -1, 0], (i, j) => {
      const s = us[i] as number;
      const d = vs[j] as number;
      const leak = vacant && noise(i, j, 1) > 0.18 ? 0.7 : 1;
      return shade(c, scaled(fin.ceiling.paint, (1 + noise(i, j, 2) * 0.1) * leak), s, d, top, -1);
    }, surf(fin.ceiling, origin, xd(xf, 1, 0), xd(xf, 0, 1)), { glow: 1 }));
  }

  // ---- the walls, in bands from the floor up
  const bandsOf = (): { y0: number; y1: number; f: Layered; kind: "base" | "wain" | "wall" | "stripe" }[] => {
    const bands: { y0: number; y1: number; f: Layered; kind: "base" | "wain" | "wall" | "stripe" }[] = [];
    let y = 0;
    if (full) {
      bands.push({ y0: 0, y1: 0.12, f: lay(null, fin.base), kind: "base" });
      y = 0.12;
    }
    const wh = fin.wainscot !== null ? Math.min(fin.wainscot.h, top - 0.8) : 0;
    if (fin.wainscot !== null && wh > y) {
      bands.push({ y0: y, y1: wh, f: fin.wainscot, kind: "wain" });
      y = wh;
    }
    if (fin.stripe !== null && full && fin.stripe.y > y && fin.stripe.y + fin.stripe.h < top - 0.5) {
      bands.push({ y0: y, y1: fin.stripe.y, f: fin.wall, kind: "wall" });
      bands.push({ y0: fin.stripe.y, y1: fin.stripe.y + fin.stripe.h, f: lay(null, fin.stripe.paint), kind: "stripe" });
      y = fin.stripe.y + fin.stripe.h;
    }
    if (fin.rail !== null && top - 0.62 > y + 0.3) {
      bands.push({ y0: y, y1: top - 0.62, f: fin.wall, kind: "wall" });
      bands.push({ y0: top - 0.62, y1: top - 0.5, f: lay(null, fin.rail), kind: "stripe" });
      y = top - 0.5;
    }
    bands.push({ y0: y, y1: top, f: fin.wall, kind: "wall" });
    return bands;
  };
  const bands = bandsOf();
  const wallGrid = (wall: "back" | "left" | "right", a0: number, a1: number, y0: number, y1: number, f: Layered, kind: string, k: number): void => {
    if (a1 - a0 < 0.05 || y1 - y0 < 0.02) return;
    const cstep = kind === "base" ? 3 : kind === "wain" || kind === "stripe" ? 1.6 : full ? 1.25 : 5;
    const us = lines(a0, a1, cstep, wall === "back" ? [] : VEIL_LINES, 43);
    const rows = kind === "wall" ? Math.max(1, Math.round((y1 - y0) / (full ? 0.95 : 3.6))) : 1;
    const vs: number[] = [];
    for (let q = 0; q <= rows; q++) vs.push(y0 + ((y1 - y0) * q) / rows);
    const origin = wallPoint(c, wall, a0, y0, 0);
    const along: Vec3 = wall === "back" ? xd(xf, a1 - a0, 0) : xd(xf, 0, a1 - a0);
    const facing: Vec3 = wall === "back" ? xd(xf, 0, -1) : wall === "left" ? xd(xf, 1, 0) : xd(xf, -1, 0);
    const where = (a: number): [number, number] => (wall === "back" ? [a, d1] : wall === "left" ? [s0, a] : [s1, a]);
    withMat(kind === "base" || kind === "stripe" ? "boards" : "plaster", () => out.litGrid(origin, along, [0, y1 - y0, 0], frac(us), frac(vs), facing, (i, j) => {
      const a = us[i] as number;
      const y = vs[j] as number;
      const [s, d] = where(a);
      const wallK = wall === "back" ? 0.72 : 0.6;
      let mod = 1 + noise(i * 3 + k, j, 3) * (0.1 + stain * 0.25);
      // Water stains under the ceiling of a vacant or an old room, and the foot's dirt.
      if (kind === "wall" && y > top - 0.9 && noise(i + k * 7, 0, 4) > 0.2 - stain * 0.3) mod *= 1 - 0.25 * stain - (vacant ? 0.12 : 0);
      if (y < 0.5 && stain > 0.2) mod *= 0.85;
      return shade(c, scaled(f.paint, mod * wallK), s, d, y, 0);
    }, surf(f, origin, along, [0, 1, 0]), { glow: 1 }));
  };
  const doorTop = 2.05;
  for (const b of bands) {
    const y0 = b.y0;
    const y1 = b.y1;
    // The back wall round the doorway: left of it, right of it, and over it.
    if (sheet) {
      // No back wall: the sheet is there.
    } else if (full) {
      wallGrid("back", s0, ds - doorW - 0.06, y0, y1, b.f, b.kind, 1);
      wallGrid("back", ds + doorW + 0.06, s1, y0, y1, b.f, b.kind, 2);
      if (y1 > doorTop) wallGrid("back", ds - doorW - 0.06, ds + doorW + 0.06, Math.max(y0, doorTop), y1, b.f, b.kind, 3);
    } else wallGrid("back", s0, s1, y0, y1, b.f, b.kind, 1);
    wallGrid("left", d0, d1, y0, y1, b.f, b.kind, 4);
    wallGrid("right", d0, d1, y0, y1, b.f, b.kind, 5);
  }

  if (c.whole === true) frontWall(c, r, bands);

  // ---- the doorway at the back (the low tier's back wall is whole)
  if (!full || sheet) return { doorS: ds, doorW, open: false };
  const dj = 0.06;
  const trim = vacant ? [0.35, 0.33, 0.3] as Rgb : [0.55, 0.52, 0.45] as Rgb;
  if (full) {
    withMat("boards", () => fbox(c, ds - doorW - dj / 2, d1 - 0.03, 0, doorTop, dj / 2, 0.03, { x: 1, z: 0 }, trim, trim, BAKED, false));
    withMat("boards", () => fbox(c, ds + doorW + dj / 2, d1 - 0.03, 0, doorTop, dj / 2, 0.03, { x: 1, z: 0 }, trim, trim, BAKED, false));
    withMat("boards", () => fbox(c, ds, d1 - 0.03, doorTop, 0.06, doorW + dj, 0.03, { x: 1, z: 0 }, trim, trim, BAKED, false));
  }
  const rx = (s: number, d: number, y: number): Vec3 => xp(xf, s, d, floorY + y);
  if (open) {
    // A back room: a short passage with a floor, two sides and a far wall, lit by a lamp in it when the unit is open.
    const deep = Math.max(0.3, Math.min(1.6, xf.depth - d1 - 0.1));
    const glowing = c.lit ? 0.42 : 0.07;
    const wallC: Rgb = c.lit ? [0.62, 0.5, 0.36] : [0.3, 0.3, 0.3];
    withMat("plaster", () => {
      out.poly([rx(ds - doorW, d1 + deep, 0), rx(ds + doorW, d1 + deep, 0), rx(ds + doorW, d1 + deep, doorTop), rx(ds - doorW, d1 + deep, doorTop)], xd(xf, 0, -1), wallC, undefined, { glow: glowing });
      out.poly([rx(ds - doorW, d1, 0), rx(ds - doorW, d1 + deep, 0), rx(ds - doorW, d1 + deep, doorTop), rx(ds - doorW, d1, doorTop)], xd(xf, 1, 0), scaled(wallC, 0.7), undefined, { glow: glowing * 0.8 });
      out.poly([rx(ds + doorW, d1, 0), rx(ds + doorW, d1 + deep, 0), rx(ds + doorW, d1 + deep, doorTop), rx(ds + doorW, d1, doorTop)], xd(xf, -1, 0), scaled(wallC, 0.55), undefined, { glow: glowing * 0.8 });
      out.poly([rx(ds - doorW, d1, 0.01), rx(ds + doorW, d1, 0.01), rx(ds + doorW, d1 + deep, 0.01), rx(ds - doorW, d1 + deep, 0.01)], [0, 1, 0], scaled(wallC, 0.8), undefined, { glow: glowing * 1.2 });
      out.poly([rx(ds - doorW, d1, doorTop), rx(ds + doorW, d1, doorTop), rx(ds + doorW, d1 + deep, doorTop), rx(ds - doorW, d1 + deep, doorTop)], [0, -1, 0], scaled(wallC, 0.3), undefined, { glow: glowing * 0.4 });
    });
  } else if (full) {
    // A shut door: a painted board door in the frame, with a knob.
    const leaf: Rgb = vacant ? [0.32, 0.28, 0.22] : pickOf([[0.35, 0.22, 0.14], [0.45, 0.45, 0.42], [0.3, 0.34, 0.3]] as readonly Rgb[], c.seed, 742);
    const p = [rx(ds - doorW, d1 - 0.02, 0), rx(ds + doorW, d1 - 0.02, 0), rx(ds + doorW, d1 - 0.02, doorTop), rx(ds - doorW, d1 - 0.02, doorTop)];
    withMat("boards", () => out.poly(p, xd(xf, 0, -1), [shade(c, leaf, ds - doorW, d1, 0, 0), shade(c, leaf, ds + doorW, d1, 0, 0), shade(c, leaf, ds + doorW, d1, doorTop, 0), shade(c, leaf, ds - doorW, d1, doorTop, 0)], undefined, { glow: 1 }));
    const kp = rx(ds + doorW - 0.1, d1 - 0.04, 1.0);
    withMat("steel", () => out.cylinder(kp[0], kp[2], kp[1] - 0.03, 0.035, 0.06, 5, [0.6, 0.5, 0.25], [0.7, 0.6, 0.3]));
    if (c.type === "counter service" || c.type === "dining room") {
      // A kitchen's swing door: a lit porthole, a push plate and a kick plate of steel.
      const ring: Vec3[] = [];
      for (let m = 0; m < 8; m++) ring.push(rx(ds + Math.cos((m / 8) * Math.PI * 2 + Math.PI / 8) * 0.13, d1 - 0.05, 1.5 + Math.sin((m / 8) * Math.PI * 2 + Math.PI / 8) * 0.13));
      withMat("painted", () => out.poly(ring, xd(xf, 0, -1), [0.95, 0.82, 0.55], undefined, { glow: c.lit ? 1.6 : 0.2 }));
      withMat("steel", () => out.poly([rx(ds - doorW + 0.04, d1 - 0.05, 0.02), rx(ds + doorW - 0.04, d1 - 0.05, 0.02), rx(ds + doorW - 0.04, d1 - 0.05, 0.3), rx(ds - doorW + 0.04, d1 - 0.05, 0.3)], xd(xf, 0, -1), [shade(c, [0.62, 0.62, 0.65], ds, d1, 0.1, 0), shade(c, [0.62, 0.62, 0.65], ds, d1, 0.1, 0), shade(c, [0.62, 0.62, 0.65], ds, d1, 0.3, 0), shade(c, [0.62, 0.62, 0.65], ds, d1, 0.3, 0)], undefined, { glow: 1 }));
    }
  }
  return { doorS: ds, doorW, open };
}
