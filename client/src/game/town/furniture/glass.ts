/**
 * Clear glass as the rooms draw it. The solid layer has no blended pass, so a pane is not drawn: what is drawn is how it reads, a thin dark frame round the
 * pane, a faint pale line just inside its top and its bottom edge, and two thin diagonal glints across it. `glassPanel` takes the pane's four corners (bottom
 * left, bottom right, top right, top left) in whatever space its `poly` lays polygons in.
 */
import type { Look } from "./kit.js";

type P3 = readonly [number, number, number];
export type PolyFn = (pts: readonly P3[], hint: P3, mat: string, look: Look) => void;

const lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const FRAME: Look = { tint: [0.2, 0.2, 0.22] };
const LINE: Look = { tint: [0.9, 0.97, 1.0], glow: 0.75 };
const GLINT: Look = { tint: [0.85, 0.93, 1.0], glow: 0.55 };

/** One pane of clear glass: the frame (2 cm), the two pale lines (6 mm) and the two glints (3 cm and 2 cm wide), 8 quads. `hint` is a normal of the pane. */
export function glassPanel(poly: PolyFn, a: P3, b: P3, c: P3, d: P3, hint: P3): void {
  const w = dist(a, b);
  const h = dist(a, d);
  if (!(w > 0.1 && h > 0.1)) return;
  const at = (u: number, v: number): P3 => lerp(lerp(a, b, u), lerp(d, c, u), v);
  const quad = (u0: number, v0: number, u1: number, v1: number, look: Look): void => poly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], hint, "steel", look);
  const fu = 0.02 / w;
  const fv = 0.02 / h;
  quad(0, 0, 1, fv, FRAME);
  quad(0, 1 - fv, 1, 1, FRAME);
  quad(0, fv, fu, 1 - fv, FRAME);
  quad(1 - fu, fv, 1, 1 - fv, FRAME);
  const lv = 0.006 / h;
  quad(fu, fv, 1 - fu, fv + lv, LINE);
  quad(fu, 1 - fv - lv, 1 - fu, 1 - fv, LINE);
  // Two diagonals, leaning the same way, one a third of the way across and one near the end.
  const diag = (u: number, wid: number, run: number): void => {
    const x0 = u;
    const x1 = Math.min(1 - fu, u + run);
    poly([at(x0, fv + lv), at(x0 + wid / w, fv + lv), at(x1 + wid / w, 1 - fv - lv), at(x1, 1 - fv - lv)], hint, "steel", GLINT);
  };
  diag(Math.min(0.55, 0.2 + 0.1 / w), 0.03, Math.min(0.28, 0.35 / w));
  diag(Math.min(0.8, 0.5 + 0.2 / w), 0.02, Math.min(0.2, 0.25 / w));
}
