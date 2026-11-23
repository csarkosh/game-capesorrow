/**
 * How a sign is set: the face, weight, case and layout of its lettering and its colours, from its style, its decade, its kind and a number of
 * its own (its building's id and its place), so that no two signs of a street are set alike. Pure; the painter (`signPaint.ts`) reads it
 * with a canvas, and a test reads it with none. The faces are generic families with fallbacks (the fonts a browser is likely to have), never
 * a file: where a face is missing the next is used.
 *
 * Authored, not researched: the faces each style leans toward (hand-painted boards before 1950 in serif, sign-painter block letters and a
 * few slab faces and scripts; neon and porcelain of the 1950s and 60s in script and block; backlit boxes of 1970 to 1999 in sans and block; vinyl
 * from 2000 in sans, narrow, block and a few serifs), and the colour tables. Each is rolled from the sign's own number.
 */
import { hash01 } from "./meshBuilder.js";
import type { SignSpec } from "./townTypes.js";

export type Face = "serif" | "block" | "script" | "sans" | "slab" | "narrow" | "mono";
export const FACE_STACKS: Readonly<Record<Face, string>> = {
  serif: "Georgia, 'Times New Roman', Times, serif",
  block: "Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif",
  script: "'Brush Script MT', 'Snell Roundhand', 'Segoe Script', 'Apple Chancery', cursive",
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  slab: "Rockwell, 'Courier New', Georgia, serif",
  narrow: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  mono: "'Courier New', Courier, monospace",
};

export type SignLook = {
  readonly face: Face;
  readonly weight: number;
  readonly italic: boolean;
  /** Capitals only (a board of the old days, a neon sign), or the line as it was given. */
  readonly caps: boolean;
  /** The lines flush left rather than centred. */
  readonly left: boolean;
  /** Letters set uneven: each a little off the line and off the vertical (a hand's work). */
  readonly uneven: boolean;
};

type Weighted<T> = readonly [T, number];
function weighted<T>(roll: number, list: readonly Weighted<T>[]): T {
  let total = 0;
  for (const [, w] of list) total += w;
  let at = roll * total;
  for (const [v, w] of list) {
    at -= w;
    if (at < 0) return v;
  }
  return (list[list.length - 1] as Weighted<T>)[0];
}

const FACES_BY_STYLE: Readonly<Record<string, readonly Weighted<Face>[]>> = {
  "hand-painted": [["serif", 4], ["block", 3], ["slab", 2], ["script", 1]],
  "neon and porcelain": [["script", 5], ["block", 2.5], ["sans", 2]],
  "backlit box": [["sans", 5], ["block", 3], ["serif", 2]],
  vinyl: [["sans", 4.5], ["narrow", 2], ["block", 2], ["serif", 1.5]],
};

export function lookOf(spec: { readonly style: string; readonly kind: string; readonly seed: number; readonly decade: number }): SignLook {
  const r = (salt: number): number => hash01(spec.seed, 600 + salt);
  let face = weighted(r(1), FACES_BY_STYLE[spec.style] ?? FACES_BY_STYLE.vinyl!);
  // A board naming a church or a court keeps to a serif; a gas price is a plain sans.
  if (spec.kind === "board" && spec.style === "hand-painted") face = r(2) < 0.7 ? "serif" : "slab";
  if (spec.kind === "ghost") face = r(2) < 0.5 ? "serif" : "block";
  const old = spec.style === "hand-painted";
  return {
    face,
    weight: face === "block" ? 400 : r(3) < 0.5 ? 700 : 400,
    italic: face !== "block" && face !== "script" && r(4) < 0.12,
    caps: old || spec.style === "neon and porcelain" || face === "block" || r(5) < 0.4,
    left: spec.kind === "fascia" ? false : spec.kind === "board" && r(6) < 0.3,
    uneven: old || spec.kind === "ghost" || spec.kind === "sandwich",
  };
}

export type Rgb255 = readonly [number, number, number];

const OLD_GROUNDS: readonly (readonly [Rgb255, Rgb255, Rgb255])[] = [
  [[238, 228, 196], [24, 40, 30], [150, 40, 30]],
  [[22, 52, 38], [226, 196, 110], [230, 225, 205]],
  [[16, 16, 18], [226, 200, 120], [200, 60, 50]],
  [[110, 28, 22], [236, 222, 180], [226, 196, 110]],
  [[30, 42, 84], [236, 226, 196], [210, 170, 80]],
  [[214, 196, 150], [40, 30, 22], [120, 30, 24]],
];
const PORCELAIN: readonly (readonly [Rgb255, Rgb255, Rgb255])[] = [
  [[236, 232, 222], [190, 34, 34], [30, 60, 150]],
  [[30, 60, 130], [250, 240, 220], [220, 60, 50]],
  [[200, 44, 36], [250, 245, 235], [250, 210, 80]],
  [[20, 20, 22], [255, 90, 80], [90, 200, 255]],
];
const BOX: readonly (readonly [Rgb255, Rgb255, Rgb255])[] = [
  [[245, 242, 230], [200, 30, 30], [30, 60, 140]],
  [[250, 220, 70], [20, 20, 24], [200, 30, 30]],
  [[210, 40, 36], [250, 248, 240], [250, 220, 70]],
  [[30, 80, 160], [250, 250, 245], [250, 220, 70]],
  [[240, 240, 235], [20, 100, 60], [20, 20, 24]],
];
const VINYL: readonly (readonly [Rgb255, Rgb255, Rgb255])[] = [
  [[24, 30, 40], [240, 240, 235], [210, 170, 60]],
  [[236, 236, 232], [24, 30, 40], [190, 40, 40]],
  [[20, 80, 70], [245, 245, 240], [230, 200, 90]],
  [[160, 34, 38], [248, 246, 240], [30, 30, 34]],
  [[52, 52, 56], [245, 200, 50], [245, 245, 240]],
];

/** The ground, lettering and accent colours of a sign of this style, rolled from its number; lettering on glass and paint on a wall are the lettering alone. */
export function coloursOf(style: string, kind: string, seed: number): { bg: Rgb255; fg: Rgb255; accent: Rgb255 } {
  const table = style === "hand-painted" ? OLD_GROUNDS : style === "neon and porcelain" ? PORCELAIN : style === "backlit box" ? BOX : VINYL;
  const row = table[Math.floor(hash01(seed, 610) * table.length) % table.length] as readonly [Rgb255, Rgb255, Rgb255];
  if (kind === "open") return { bg: [14, 14, 16], fg: [255, 70, 60], accent: [90, 190, 255] };
  if (kind === "sandwich") return { bg: [34, 44, 38], fg: [240, 240, 232], accent: [236, 200, 90] };
  if (kind === "lease") return { bg: [244, 242, 236], fg: [190, 30, 30], accent: [30, 30, 34] };
  return { bg: row[0], fg: row[1], accent: row[2] };
}
