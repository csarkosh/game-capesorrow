/**
 * What every part of a building is drawn with: a wall as a frame of its own (`WallRef`: its end `a`, its unit direction along it, its
 * outward normal), small helpers that put a quad or a box on a wall by metres along it, metres up and metres off its face, the
 * `cutWall` that builds a wall around its holes (so that a window is a hole in the wall, with a reveal, and a room behind it, never a
 * dark rectangle laid on a face), and the colours the parts are drawn in. Pure: arrays in, arrays out.
 *
 * "Off" is metres off the wall's face: positive is out into the street, negative is in, into the building.
 */
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import type { Fx, Surface } from "./townSurface.js";

export type WallRef = {
  readonly ax: number;
  readonly az: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly length: number;
};

export const wallRef = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): WallRef => {
  const length = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  return { ax, az, tx: (bx - ax) / length, tz: (bz - az) / length, nx, nz, length };
};

/** The point `s` metres along the wall, at height `y` and `off` metres off its face. */
export const wat = (w: WallRef, s: number, y: number, off: number): Vec3 => [w.ax + w.tx * s + w.nx * off, y, w.az + w.tz * s + w.nz * off];

/** A quad standing on the wall between two stations and two heights, `off` off its face, facing out (or in when `inward`). */
export function wquad(out: MeshBuilder, w: WallRef, s0: number, y0: number, s1: number, y1: number, off: number, colour: Rgb, surface?: Surface, fx?: Fx, inward = false): void {
  const k = inward ? -1 : 1;
  out.poly([wat(w, s0, y0, off), wat(w, s1, y0, off), wat(w, s1, y1, off), wat(w, s0, y1, off)], [w.nx * k, 0, w.nz * k], colour, surface, fx);
}

/**
 * A box on a wall from `off0` to `off1` (off1 the farther out): its face, its top and its two ends, and its bottom when `under` (an
 * awning's soffit, a canopy's underside, which is seen from the street).
 */
export function wbox(out: MeshBuilder, w: WallRef, s0: number, s1: number, y0: number, y1: number, off0: number, off1: number, colour: Rgb, top: Rgb = colour, under = false, surface?: Surface): void {
  wquad(out, w, s0, y0, s1, y1, off1, colour, surface);
  out.poly([wat(w, s0, y1, off0), wat(w, s1, y1, off0), wat(w, s1, y1, off1), wat(w, s0, y1, off1)], [0, 1, 0], top);
  if (under) out.poly([wat(w, s0, y0, off0), wat(w, s1, y0, off0), wat(w, s1, y0, off1), wat(w, s0, y0, off1)], [0, -1, 0], scaled(colour, 0.6));
  out.poly([wat(w, s0, y0, off0), wat(w, s0, y0, off1), wat(w, s0, y1, off1), wat(w, s0, y1, off0)], [-w.tx, 0, -w.tz], scaled(colour, 0.85));
  out.poly([wat(w, s1, y0, off0), wat(w, s1, y0, off1), wat(w, s1, y1, off1), wat(w, s1, y1, off0)], [w.tx, 0, w.tz], scaled(colour, 0.85));
}

/** A hole in a wall: between two stations and two heights. Holes of one wall never overlap (`cutWall` drops the later of two that do). */
export type Hole = { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number };

/**
 * The wall from its foot `baseY` to its top (`topA` at its start, `topB` at its end, so a shed's wall slopes) as quads around the
 * `holes`: the wall is cut into columns at every hole's edges, and in each column into the pieces between the holes. `surfaceOf`
 * gives a piece its surface (so the texture runs on across the holes as one wall) and `wearFrom` its wear gradient.
 */
export function cutWall(
  out: MeshBuilder, w: WallRef, baseY: number, topA: number, topB: number, holes: readonly Hole[], colour: Rgb, surfaceOf: () => Surface,
): void {
  const topAt = (s: number): number => topA + ((topB - topA) * s) / w.length;
  // Drop a hole that overlaps an earlier one, and clamp the rest to the wall.
  const kept: Hole[] = [];
  for (const h of holes) {
    const c: Hole = { s0: Math.max(0.02, h.s0), s1: Math.min(w.length - 0.02, h.s1), y0: Math.max(baseY + 0.02, h.y0), y1: Math.min(Math.min(topA, topB) - 0.05, h.y1) };
    if (c.s1 - c.s0 < 0.1 || c.y1 - c.y0 < 0.1) continue;
    if (kept.some((k) => c.s0 < k.s1 - 1e-3 && c.s1 > k.s0 + 1e-3 && c.y0 < k.y1 - 1e-3 && c.y1 > k.y0 + 1e-3)) continue;
    kept.push(c);
  }
  const stops = [0, w.length];
  for (const h of kept) stops.push(h.s0, h.s1);
  stops.sort((a, b) => a - b);
  const hint: Vec3 = [w.nx, 0, w.nz];
  const piece = (x0: number, x1: number, ya: number, yb0: number, yb1: number): void => {
    // From height `ya` (flat) up to the top edge, which is `yb0` at x0 and `yb1` at x1.
    if (Math.min(yb0, yb1) - ya < 0.005 && Math.max(yb0, yb1) - ya < 0.01) return;
    out.poly([wat(w, x0, ya, 0), wat(w, x1, ya, 0), wat(w, x1, yb1, 0), wat(w, x0, yb0, 0)], hint, colour, surfaceOf());
  };
  for (let i = 0; i + 1 < stops.length; i++) {
    const x0 = stops[i] as number;
    const x1 = stops[i + 1] as number;
    if (x1 - x0 < 1e-4) continue;
    const mid = (x0 + x1) / 2;
    const here = kept.filter((h) => h.s0 <= mid && h.s1 >= mid).sort((a, b) => a.y0 - b.y0);
    let y = baseY;
    for (const h of here) {
      if (h.y0 > y + 0.004) piece(x0, x1, y, h.y0, h.y0);
      y = Math.max(y, h.y1);
    }
    piece(x0, x1, y, topAt(x0), topAt(x1));
  }
}

/** Colours of what is behind glass and what frames it. Authored, not researched. */
export const PAINTS: readonly Rgb[] = [
  [0.62, 0.6, 0.55], [0.55, 0.57, 0.52], [0.34, 0.36, 0.33], [0.5, 0.26, 0.2], [0.24, 0.32, 0.4], [0.7, 0.66, 0.5], [0.42, 0.5, 0.44], [0.72, 0.7, 0.66],
];
export const pickOf = <T>(list: readonly T[], id: number, salt: number): T => list[Math.floor(hash01(id, salt) * list.length) % list.length] as T;
/** Trim and frame colours: white vinyl, aluminium, painted wood in a few. */
export const TRIM_WHITE: Rgb = [0.68, 0.68, 0.65];
export const ALUMINIUM: Rgb = [0.4, 0.42, 0.44];
export const WOOD_DARK: Rgb = [0.12, 0.08, 0.05];

/** A unit's fill of light by what it is: the share of its surfaces' colour that lights itself. */
export const ROOM_GLOW = { open: 0.5, shut: 0.16, vacant: 0.2 } as const;

/** The colour of glass in daylight (its own tint; the sky's reflection is the material's) and how clear it is. Authored. */
export const GLASS_TINT: Rgb = [0.34, 0.4, 0.44];
export const GLASS_CLEAR = 0.82;

/** A pane of glass in the blended layer: on the wall between two stations and heights, `off` off its face. */
export function pane(glass: MeshBuilder, w: WallRef, s0: number, y0: number, s1: number, y1: number, off: number, clear = GLASS_CLEAR, tint: Rgb = GLASS_TINT): void {
  wquad(glass, w, s0, y0, s1, y1, off, tint, undefined, { clear }, false);
}

/** The four faces of a hole's reveal, `depth` deep (into the building), the hole running from station `sa` to `sb` (sa < sb) and from `y0` to `y1`. */
export function reveal(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, depth: number, colour: Rgb, sillColour: Rgb = colour): void {
  const t: Vec3 = [w.tx, 0, w.tz];
  const nt: Vec3 = [-w.tx, 0, -w.tz];
  out.poly([wat(w, sa, y0, 0), wat(w, sa, y0, -depth), wat(w, sa, y1, -depth), wat(w, sa, y1, 0)], t, scaled(colour, 0.85));
  out.poly([wat(w, sb, y0, 0), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sb, y1, 0)], nt, scaled(colour, 0.85));
  out.poly([wat(w, sa, y0, 0), wat(w, sb, y0, 0), wat(w, sb, y0, -depth), wat(w, sa, y0, -depth)], [0, 1, 0], sillColour);
  out.poly([wat(w, sa, y1, 0), wat(w, sb, y1, 0), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [0, -1, 0], scaled(colour, 0.7));
}

/** A frame round a hole: four bars `bar` wide laid `off` off the wall. */
export function frameBars(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, bar: number, off: number, colour: Rgb): void {
  wquad(out, w, sa - bar, y0 - bar, sb + bar, y0, off, colour);
  wquad(out, w, sa - bar, y1, sb + bar, y1 + bar, off, colour);
  wquad(out, w, sa - bar, y0, sa, y1, off, colour);
  wquad(out, w, sb, y0, sb + bar, y1, off, colour);
}
