/**
 * The haze in a shop's room: what makes the front of the room, its veil and its painted sheet one thing to the eye.
 *
 * A room in use is drawn to a sheet a little behind its front, which carries the rest of the room as a picture out of focus
 * (`roomBackdrop.ts`), and what stands before the sheet runs to the veil's colour with depth (`roomLight.ts`). That alone leaves a seam: a
 * floor's boards and a wall's plaster keep their grain right up to the sheet, which has none, and a chair two metres in is as sharp as one
 * at the glass. So the air of the room is drawn too, as `SHEETS` see-through sheets across the room between the glass and the painted
 * sheet, each the veil's colour and each taking a little more of what is behind it than the one before: the grain, the edges and the
 * people go by degrees, further in and more, and by the painted sheet the room and the picture are the same soft thing. It is fog in
 * slices: what it does to a place is by how far behind the glass the place is, whatever stands there.
 *
 * The sheets go in a layer of their own that is drawn before the glass (`townParts.ts`, `HAZE_ORDER`), the furthest first, since each is
 * blended over what is already drawn; the glass is then laid over all of it. They are told from a pane by a seed of 2 (a pane's own is 0 to 1), and carry their
 * colour in the floats a pane's size and tilt use (`townMaterial.ts`).
 */
import type { MeshBuilder, Rgb } from "./meshBuilder.js";
import { xd, xp, type Xf } from "./roomKit.js";

/** What marks a sheet of haze in the float a pane keeps its seed in (`townMaterial.ts` reads it). */
export const HAZE_SEED = 2;
/** How many sheets, on the full tier and the low. */
export const SHEETS = 9;
export const SHEETS_LOW = 4;
/** Where behind the glass the first sheet stands, metres; the last is `LAST_BEFORE` in front of the painted sheet. */
export const HAZE_FROM = 0.45;
const LAST_BEFORE = 0.08;
/** How much of what stands at the painted sheet the haze has taken, all sheets together. */
export const HAZE_WHOLE = 0.58;
/** How the haze thickens with depth: 1 is even, 2 is thin at the glass and thick at the back. */
const THICKEN = 2;

/** How much the sheets nearer the glass than `d` have taken of a place `d` behind it (0 to `HAZE_WHOLE`), for `n` sheets up to `cut`. */
export function hazeAt(d: number, cut: number, n: number = SHEETS): number {
  let through = 1;
  for (let k = 0; k < n; k++) if (sheetDepth(k, cut, n) < d) through *= 1 - sheetTakes(k, n);
  return 1 - through;
}

/** Where sheet `k` of `n` stands (0 the nearest the glass). */
function sheetDepth(k: number, cut: number, n: number): number {
  return HAZE_FROM + ((cut - LAST_BEFORE - HAZE_FROM) * k) / Math.max(1, n - 1);
}

/** How much sheet `k` of `n` takes of what is behind it: the room's haze to depth, cut into the sheets' shares (the further sheets take more). */
function sheetTakes(k: number, n: number): number {
  // The haze's optical depth up to a sheet runs as a power of how far in the sheet is; a sheet's share is the step to it.
  const whole = -Math.log(1 - HAZE_WHOLE);
  const upTo = (q: number): number => whole * Math.pow(q / n, THICKEN);
  return 1 - Math.exp(-(upTo(k + 1) - upTo(k)));
}

/** Lays the room's haze into `haze`: sheets across the room from `s0` to `s1`, floor to `ceiling`, the furthest first. */
export function roomHaze(haze: MeshBuilder, xf: Xf, floorY: number, s0: number, s1: number, ceiling: number, cut: number, colour: Rgb, low: boolean): void {
  const n = low ? SHEETS_LOW : SHEETS;
  const facing = xd(xf, 0, -1);
  for (let k = n - 1; k >= 0; k--) {
    const d = sheetDepth(k, cut, n);
    const pts = [xp(xf, s0, d, floorY), xp(xf, s1, d, floorY), xp(xf, s1, d, floorY + ceiling), xp(xf, s0, d, floorY + ceiling)];
    haze.poly(pts, facing, colour, undefined, { clear: 1 - sheetTakes(k, n), seed: HAZE_SEED, size: [colour[0], colour[1]], tilt: [colour[2], 0] });
  }
}
