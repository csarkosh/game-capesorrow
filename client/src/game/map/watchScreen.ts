/**
 * The watch's screen: the surface the player's left-wrist watch shows (`hand/watchSeen.ts` says where its lit face is in the view each frame), which draws one
 * app at a time. The map is the first and, for now, the only app; the next is added by writing another `WatchApp` (see ARCHITECTURE.md, "The watch").
 *
 * This file is the screen's own: where the canvas goes (a CSS `matrix3d` that carries the canvas's square onto the face's four corners, so the round face is drawn in
 * perspective on the 3D watch), how it fades in as the wrist comes up, how large its backing is, and its status line (the game's clock). `minimap.ts` makes the
 * canvas and lends it, since the same canvas is the corner map in a car and the large map when paused.
 */
import type { MapCtx } from "./mapCtx.js";
import type { Palette } from "./mapStyle.js";

/**
 * The screen's own size in css pixels, before the matrix carries it onto the face: 180 square, the square that bounds the round lit face (`WATCH_SEEN.quad` is that square's corners),
 * clipped to the circle inscribed in it.
 */
export const WATCH_W = 180, WATCH_H = 180;
/** The ring that pins for places off the map stand on, just inside the circle's edge, pixels from its centre. */
export const WATCH_RING = 74;
/** The most the screen's backing is across, in pixels, and the change in the face's size that makes it be made again. */
export const WATCH_BACKING_MAX = 512, WATCH_BACKING_MIN = 64, WATCH_HYSTERESIS = 0.1;
/** The raised arm's `raised` below which the screen is dark, and at which it is whole. */
export const FADE_FROM = 0.6, FADE_TO = 1;

/** What an app on the watch is: a name, and a drawing of itself on a screen `w` by `h` css pixels, `dpr` backing pixels to a css pixel. */
export interface WatchApp {
  readonly name: string;
  draw(ctx: MapCtx, w: number, h: number, dpr: number): void;
}

/** How much of the screen shows for a `raised` arm: nothing below 0.6, all of it at 1. */
export function fadeFor(raised: number): number {
  const t = (raised - FADE_FROM) / (FADE_TO - FADE_FROM);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * The backing's width in pixels for a face that is `faceWidth` css pixels across in the view, at a device pixel ratio: that times the ratio, held to 64 and 512, and left as it
 * is (`current`) until it would change by more than 10 percent, so that an arm that bobs does not resize the canvas.
 */
export function watchBacking(faceWidth: number, dpr: number, current: number): number {
  const want = Math.min(WATCH_BACKING_MAX, Math.max(WATCH_BACKING_MIN, Math.round(faceWidth * dpr)));
  if (current <= 0) return want;
  return Math.abs(want - current) / current > WATCH_HYSTERESIS ? want : current;
}

/** The game's hour (0 to 24) as the clock reads it, HH:MM. */
export function formatClock(hour: number): string {
  const total = Math.floor((((hour % 24) + 24) % 24) * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The matrix, as sixteen numbers in the order `matrix3d` takes them, that carries a rectangle `w` by `h` (at the origin) onto four corners in the order top left, top right, bottom right,
 * bottom left (`c`: x, y pairs in pixels): the projective map of a square onto a quadrilateral, scaled to the rectangle. For an upright rectangle of the same size it is the identity.
 */
export function quadMatrix(c: ArrayLike<number>, w: number, h: number): number[] {
  const v = (i: number): number => c[i] as number;
  const x0 = v(0), y0 = v(1), x1 = v(2), y1 = v(3), x2 = v(4), y2 = v(5), x3 = v(6), y3 = v(7);
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, k: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0;
    b = x3 - x0;
    d = y1 - y0;
    e = y3 - y0;
    g = 0;
    k = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + k * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + k * y3;
  }
  // From the unit square to the rectangle: the columns are divided by the rectangle's sides.
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
}

/** Where a point of the rectangle lands under a matrix of `quadMatrix`. */
export function applyMatrix(m: readonly number[], x: number, y: number): { x: number; y: number } {
  const wv = m[3] as number * x + (m[7] as number) * y + 1;
  return { x: ((m[0] as number) * x + (m[4] as number) * y + (m[12] as number)) / wv, y: ((m[1] as number) * x + (m[5] as number) * y + (m[13] as number)) / wv };
}

export function matrixCss(m: readonly number[]): string {
  return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(7))).join(",")})`;
}

/** What `place` needs of the element: its style. */
export type Placed = { style: { transform: string } };

/**
 * Lays the screen on the face: writes the element's transform only when a corner has moved by more than 0.2 px since the last write, so a still arm costs no style write
 * and a moving one at most one a frame. `quad` is the face in the view's fractions (x across, y down), `vw` and `vh` the view's size in pixels. Answers whether it wrote.
 */
export function createPlacement(el: Placed): { place(quad: ArrayLike<number>, vw: number, vh: number): boolean; forget(): void } {
  const last = new Float64Array(8).fill(Number.NaN);
  const px = new Float64Array(8);
  return {
    place(quad, vw, vh) {
      let moved = false;
      for (let i = 0; i < 8; i++) {
        px[i] = (quad[i] as number) * (i % 2 === 0 ? vw : vh);
        if (!(Math.abs(px[i] as number - (last[i] as number)) <= 0.2)) moved = true;
      }
      if (!moved) return false;
      el.style.transform = matrixCss(quadMatrix(px, WATCH_W, WATCH_H));
      last.set(px);
      return true;
    },
    forget: () => last.fill(Number.NaN),
  };
}

/** The status line at the top of the round screen (twelve o'clock, inside the circle): the game's clock, small, so that the screen reads as a watch. One drawing operation. */
export function drawWatchStatus(ctx: MapCtx, w: number, pal: Palette, hour: number): void {
  // In the panel's text colour, which is darker than the street names' by day, so that it reads on the cream.
  ctx.text(formatClock(hour), w / 2, 14, { size: 8.5, colour: pal.panelText, halo: pal.land, bold: true });
}

/** A thin dark vignette at the rim, so that the screen meets the watch's domed glass softly: two rings, a wide faint one and a narrow darker. Two drawing operations. */
export function drawWatchRim(ctx: MapCtx, w: number, h: number): void {
  const ring = ctx.newPath();
  ring.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  ctx.stroke(ring, "#000000", 18, { alpha: 0.14 });
  ctx.stroke(ring, "#000000", 6, { alpha: 0.32 });
}

/** Where the watch's clock and its destination line stand, in the screen's own pixels: no pin's distance is written under either. */
export const WATCH_KEEP_OUT: readonly { x0: number; y0: number; x1: number; y1: number }[] = [
  { x0: 65, y0: 6, x1: 115, y1: 22 },
  { x0: 30, y0: 24, x1: 150, y1: 47 },
];
