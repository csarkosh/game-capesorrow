/**
 * The shapes of the vehicle types, as cross-sections along their length, and the paint they come in. None is a real make or model: each is
 * the proportions of its type (a mid-size pickup about 5.4 x 1.9 x 1.8 m, a compact sedan about 4.6 x 1.8 x 1.45 m).
 *
 * A body is lofted through stations from the rear bumper (x = 0) to the nose (x = length). Each station is `[x, top, belt, w, wTop]`:
 * the height of the roof (or the hood, or the deck there), of the beltline (the lower edge of the glass), the half width at the belt and at the roof's edge.
 * Glass is where a station interval lies inside `side` (the side windows) or `screens` (the windscreen and rear glass), in metres.
 */
import type { Rgb } from "../meshBuilder.js";
import type { VehicleKind } from "../../../sim/town/types.js";

export type Station = readonly [x: number, top: number, belt: number, w: number, wTop: number];
export type Shape = {
  /** The length and width the stations are drawn for. */
  readonly L: number;
  readonly W: number;
  /** The height of the body's underside, and the wheels: x of each axle, radius, tyre width. */
  readonly sill: number;
  readonly axles: readonly number[];
  readonly r: number;
  readonly tw: number;
  readonly stations: readonly Station[];
  /** Station indices at which the surface creases (a new row begins a different surface: a cab's back wall). */
  readonly creases: readonly number[];
  readonly side: readonly (readonly [number, number])[];
  readonly screens: readonly (readonly [number, number])[];
  /** A pickup's open bed: from x0 to x1, the rail's height and the floor's. */
  readonly bed?: { readonly x0: number; readonly x1: number; readonly floor: number };
  /** A door seam's x positions, and the mirrors' x. */
  readonly doors: readonly number[];
  readonly mirror: number;
  /** The beltline's height at the mirrors, for drawing them. */
  readonly seats: readonly number[];
};

export const SHAPES: Readonly<Record<Exclude<VehicleKind, "work truck" | "camper">, Shape>> = {
  sedan: {
    L: 4.6, W: 1.8, sill: 0.17, axles: [0.95, 3.65], r: 0.31, tw: 0.2,
    stations: [
      [0.0, 0.86, 0.8, 0.82, 0.72], [0.12, 0.93, 0.87, 0.87, 0.77], [0.55, 0.98, 0.92, 0.9, 0.8], [1.05, 1.0, 0.94, 0.905, 0.81], [1.35, 1.18, 0.94, 0.9, 0.77],
      [1.75, 1.42, 0.95, 0.9, 0.73], [2.5, 1.45, 0.95, 0.9, 0.74], [2.95, 1.42, 0.95, 0.9, 0.74], [3.25, 1.2, 0.93, 0.9, 0.77], [3.45, 0.99, 0.91, 0.9, 0.8],
      [3.9, 0.95, 0.86, 0.9, 0.81], [4.35, 0.88, 0.78, 0.88, 0.78], [4.6, 0.66, 0.6, 0.83, 0.72],
    ],
    creases: [], side: [[1.55, 2.4], [2.55, 3.1]], screens: [[1.3, 1.7], [3.0, 3.42]], doors: [1.55, 2.5, 3.2], mirror: 3.15, seats: [2.15, 2.9],
  },
  suv: {
    L: 4.8, W: 1.9, sill: 0.24, axles: [1.0, 3.8], r: 0.36, tw: 0.24,
    stations: [
      [0.0, 0.98, 0.92, 0.87, 0.8], [0.06, 1.12, 0.97, 0.91, 0.81], [0.2, 1.66, 1.0, 0.93, 0.79], [0.5, 1.7, 1.0, 0.94, 0.8], [1.5, 1.72, 1.0, 0.95, 0.81],
      [2.5, 1.7, 1.0, 0.95, 0.81], [3.0, 1.6, 1.0, 0.95, 0.8], [3.35, 1.3, 0.99, 0.95, 0.82], [3.6, 1.1, 0.96, 0.95, 0.84], [4.2, 1.04, 0.9, 0.94, 0.85],
      [4.7, 0.95, 0.82, 0.92, 0.84], [4.8, 0.72, 0.6, 0.88, 0.8],
    ],
    creases: [], side: [[0.4, 1.25], [1.35, 2.2], [2.3, 3.0]], screens: [[0.06, 0.32], [3.0, 3.55]], doors: [1.3, 2.25, 3.05], mirror: 3.45, seats: [1.8, 2.7],
  },
  van: {
    L: 5.3, W: 2.0, sill: 0.26, axles: [1.0, 4.2], r: 0.36, tw: 0.24,
    stations: [
      [0.0, 1.85, 0.95, 0.96, 0.9], [0.08, 1.95, 1.0, 0.98, 0.9], [3.4, 2.0, 1.05, 1.0, 0.92], [3.85, 1.96, 1.06, 1.0, 0.91], [4.4, 1.3, 1.02, 1.0, 0.9],
      [5.0, 1.16, 0.95, 0.98, 0.88], [5.3, 0.88, 0.7, 0.93, 0.82],
    ],
    creases: [], side: [[3.25, 3.85]], screens: [[3.85, 4.35]], doors: [3.2, 3.9], mirror: 4.3, seats: [3.55],
  },
  pickup: {
    L: 5.4, W: 1.9, sill: 0.28, axles: [1.0, 4.3], r: 0.38, tw: 0.26,
    stations: [
      [0.0, 1.08, 1.04, 0.93, 0.84], [0.1, 1.1, 1.05, 0.95, 0.86], [1.85, 1.1, 1.05, 0.95, 0.86], [1.9, 1.74, 1.05, 0.94, 0.8], [2.05, 1.76, 1.05, 0.94, 0.79],
      [2.6, 1.78, 1.06, 0.94, 0.78], [3.0, 1.76, 1.06, 0.94, 0.78], [3.35, 1.4, 1.06, 0.94, 0.8], [3.65, 1.16, 1.04, 0.94, 0.83], [4.1, 1.12, 1.0, 0.94, 0.85],
      [4.8, 1.08, 0.98, 0.93, 0.85], [5.25, 0.98, 0.9, 0.92, 0.85], [5.4, 0.8, 0.72, 0.88, 0.8],
    ],
    creases: [3], side: [[2.15, 2.6], [2.7, 3.15]], screens: [[3.1, 3.6]], bed: { x0: 0.1, x1: 1.85, floor: 0.82 }, doors: [2.1, 2.65, 3.2], mirror: 3.5, seats: [2.4, 2.95],
  },
};

/** Paint colours, by index (a table `PAINT_WEIGHTS` in the plan's tuning gives the weights): white, silver, black, charcoal, blue, red, green, tan, maroon, teal, yellow, orange. Linear colours. */
export const PAINT: readonly Rgb[] = [
  [0.55, 0.55, 0.53], [0.3, 0.31, 0.32], [0.025, 0.025, 0.03], [0.07, 0.075, 0.08], [0.04, 0.09, 0.2], [0.3, 0.03, 0.03],
  [0.03, 0.11, 0.06], [0.27, 0.21, 0.13], [0.12, 0.02, 0.04], [0.03, 0.17, 0.17], [0.45, 0.34, 0.04], [0.36, 0.12, 0.03],
];

/** The body layer's own mean colour in linear light (`roof_bitumen`: the smoothest and most even of the town's layers, matt like old paint, where the painted-metal layer is ribbed sheet and the board-formed concrete grooved): a tint is the paint over it, so a vertex shows the paint. */
export const PAINT_LAYER_MEAN: Rgb = [0.0437, 0.0379, 0.0348];
export function paintTint(c: Rgb): Rgb {
  return [Math.min(40, c[0] / PAINT_LAYER_MEAN[0]), Math.min(40, c[1] / PAINT_LAYER_MEAN[1]), Math.min(40, c[2] / PAINT_LAYER_MEAN[2])];
}

export const GLASS_CAR: Rgb = [0.03, 0.045, 0.06];
export const CABIN: Rgb = [0.012, 0.014, 0.017];
export const SEAT: Rgb = [0.05, 0.045, 0.04];
export const TYRE: Rgb = [0.018, 0.018, 0.02];
export const RIM: Rgb = [0.22, 0.22, 0.23];
export const BUMPER: Rgb = [0.04, 0.04, 0.045];
export const CHROME: Rgb = [0.3, 0.3, 0.31];
export const LAMP: Rgb = [0.6, 0.58, 0.5];
export const TAIL: Rgb = [0.3, 0.02, 0.02];
export const PLATE: Rgb = [0.6, 0.6, 0.55];
export const TARP_BLUE: Rgb = [0.04, 0.16, 0.42];
export const TARP_SILVER: Rgb = [0.3, 0.3, 0.3];
export const UNDER: Rgb = [0.02, 0.02, 0.02];
