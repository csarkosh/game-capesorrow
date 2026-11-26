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
import { currentMat, isMat, surfaceOn, type MatRef } from "./materials.js";
import { noteFace, standOff } from "./faceLedger.js";
import { REVEAL_HEAD, REVEAL_JAMB, REVEAL_SILL } from "./skyShade.js";

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
export function wquad(out: MeshBuilder, w: WallRef, s0: number, y0: number, s1: number, y1: number, off: number, colour: Rgb, surface?: Surface | MatRef, fx?: Fx, inward = false): number {
  const k = inward ? -1 : 1;
  // A face asked for where another already stands (a plate over a frame, a sticker over a plate) stands a step further out (`faceLedger.ts`).
  const a = wat(w, s0, y0, off);
  const b = wat(w, s1, y0, off);
  // Out from the wall for a face over its plane, further in for one behind it (a pane's paper, a room's decoration), so none is pushed toward the wall's own faces.
  const dir = off < -0.001 ? -1 : 1;
  const o = off + dir * standOff(w.nx * k, w.nz * k, a[0], a[2], b[0], b[2], y0, y1, k === 1 ? dir : (-dir as 1 | -1));
  out.poly([wat(w, s0, y0, o), wat(w, s1, y0, o), wat(w, s1, y1, o), wat(w, s0, y1, o)], [w.nx * k, 0, w.nz * k], colour, surface, fx);
  return o;
}

/**
 * A box on a wall from `off0` to `off1` (off1 the farther out): its face, its top and its two ends, and its bottom when `under` (by default when it is a hand deep or more: a trim on the wall has none) (an
 * awning's soffit, a canopy's underside, a sill's, which are seen from the street; a bulkhead standing on the ground says false). `buttStart` is for a box whose start end stands against another box (a corner board against the one that wraps the corner), so it has no end face there.
 */
export function wbox(out: MeshBuilder, w: WallRef, s0: number, s1: number, y0: number, y1: number, off0: number, off1: number, colour: Rgb, top: Rgb = colour, under?: boolean, surface?: Surface | MatRef, back = false, buttStart = false): void {
  wquad(out, w, s0, y0, s1, y1, off1, colour, surface);
  // The other faces are of what the face is: the same material, or the face's own surface laid by each face's own lie.
  const side = (pts: readonly Vec3[], n: Vec3, c: Rgb): void => out.poly(pts, n, c, surface === undefined || isMat(surface) ? surface : surfaceOn(surface, pts, n));
  side([wat(w, s0, y1, off0), wat(w, s1, y1, off0), wat(w, s1, y1, off1), wat(w, s0, y1, off1)], [0, 1, 0], top);
  if (under ?? (off1 - off0 >= 0.1 || off0 > 0.3)) side([wat(w, s0, y0, off0), wat(w, s1, y0, off0), wat(w, s1, y0, off1), wat(w, s0, y0, off1)], [0, -1, 0], scaled(colour, 0.6));
  // Its back, toward the wall: a parapet or a cornice stands over the wall's top, where there is no wall behind it, and is seen from the roof. Asked for with `back` by what stands over a wall's top, and laid by itself under a canopy or a porch deeper than 40 cm and by a post or a column that stands off the wall (a trim or a sill on the wall has none). The back stands 3 cm in from the wall's own plane, so that no sign or plate laid on the wall under it is a face in its plane.
  if (back || off1 - off0 > 0.4 || off0 > 0.3) {
    // It stands clear of every face already laid in its plane (`faceLedger.ts`): 3 cm in from the wall's own plane at the least.
    const o0 = off0 + 0.03;
    const e = wat(w, s0, y0, o0);
    const f = wat(w, s1, y0, o0);
    const o = o0 + standOff(-w.nx, -w.nz, e[0], e[2], f[0], f[2], y0, y1, -1);
    side([wat(w, s0, y0, o), wat(w, s1, y0, o), wat(w, s1, y1, o), wat(w, s0, y1, o)], [-w.nx, 0, -w.nz], scaled(colour, 0.7));
  }
  // The box's ends are faces on the ledger too, so what is put beside it later stands clear of them.
  const e0 = wat(w, s0, y0, off0);
  const e0b = wat(w, s0, y0, off1);
  const e1 = wat(w, s1, y0, off0);
  const e1b = wat(w, s1, y0, off1);
  // A box that butts against another at its start (`buttStart`) has no end face there: it is inside the other box, and is no face of the town.
  if (!buttStart) noteFace(-w.tx, -w.tz, e0[0], e0[2], e0b[0], e0b[2], y0, y1);
  noteFace(w.tx, w.tz, e1[0], e1[2], e1b[0], e1b[2], y0, y1);
  if (!buttStart) side([wat(w, s0, y0, off0), wat(w, s0, y0, off1), wat(w, s0, y1, off1), wat(w, s0, y1, off0)], [-w.tx, 0, -w.tz], scaled(colour, 0.85));
  side([wat(w, s1, y0, off0), wat(w, s1, y0, off1), wat(w, s1, y1, off1), wat(w, s1, y1, off0)], [w.tx, 0, w.tz], scaled(colour, 0.85));
}

/** A hole in a wall: between two stations and two heights. Holes of one wall never overlap (`cutWall` drops the later of two that do). */
export type Hole = { readonly s0: number; readonly s1: number; readonly y0: number; readonly y1: number };

/**
 * The wall from its foot `baseY` to its top (`topA` at its start, `topB` at its end, so a shed's wall slopes) as quads around the
 * `holes`: the wall is cut into columns at every hole's edges, and in each column into the pieces between the holes. `surfaceOf`
 * gives a piece its surface (so the texture runs on across the holes as one wall) and `wearFrom` its wear gradient.
 */
export function cutWall(
  out: MeshBuilder, w: WallRef, baseY: number, topA: number, topB: number, holes: readonly Hole[], colour: Rgb, surfaceOf: (band: 0 | 1) => Surface, bandY?: number,
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
    // The wall's own face is on the ledger, so nothing is put within 2.45 cm of it that is not meant to be (`faceLedger.ts`).
    const wa = wat(w, x0, ya, 0);
    const wb = wat(w, x1, ya, 0);
    noteFace(w.nx, w.nz, wa[0], wa[2], wb[0], wb[2], ya, Math.max(yb0, yb1));
    // The wall's foot is a band of its own (its wear has its own kinds): a piece that crosses the band's line is cut along it.
    if (bandY !== undefined && ya < bandY - 0.01 && Math.min(yb0, yb1) > bandY + 0.01) {
      out.poly([wat(w, x0, ya, 0), wat(w, x1, ya, 0), wat(w, x1, bandY, 0), wat(w, x0, bandY, 0)], hint, colour, surfaceOf(0));
      out.poly([wat(w, x0, bandY, 0), wat(w, x1, bandY, 0), wat(w, x1, yb1, 0), wat(w, x0, yb0, 0)], hint, colour, surfaceOf(1));
      return;
    }
    // A top edge that meets the base at one end makes the piece a triangle: no corner is listed twice (a zero-area triangle in the fan).
    const pts: Vec3[] = [wat(w, x0, ya, 0), wat(w, x1, ya, 0)];
    if (yb1 - ya > 0.004) pts.push(wat(w, x1, yb1, 0));
    if (yb0 - ya > 0.004) pts.push(wat(w, x0, yb0, 0));
    out.poly(pts, hint, colour, surfaceOf(bandY !== undefined && Math.max(yb0, yb1) <= bandY + 0.01 ? 0 : 1));
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

/**
 * The colour of glass in daylight (its own tint; the sky's and the street's reflection are the material's) and how clear it is. Authored. A
 * pane keeps back a third of what is behind it under a pale film (`GLASS_FILM` in `townMaterial.ts`): enough that a room is seen through it and
 * its bareness is not. It was 0.93, and the film black; at 0.5 the people at the front of a room were ghosts.
 */
export const GLASS_TINT: Rgb = [0.34, 0.4, 0.44];
export const GLASS_CLEAR = 0.66;

/** What a pane's glass is like: how grimy (0 to 1) and how far, at most, its reflecting normal is turned from the wall's (radians; old glass more). */
/** A pane's own look. `through`: what is behind it is read from the kept frame and shown out of focus (`townBlur.ts`): a shop's room. */
export type PaneLook = { readonly dirt?: number; readonly tilt?: number; readonly through?: boolean };

/** What is added to the seed of a pane that is seen through out of focus: a pane's own seed is 0 to 1, a haze sheet's 2 (`roomHaze.ts`), so 4 to 5 is such a pane (`townMaterial.ts` reads it). */
export const THROUGH_SEED = 4;

/**
 * A pane of glass in the blended layer: on the wall between two stations and heights, `off` off its face. Each pane has a turn of its own
 * (from where it is, so the same pane is the same every build): neighbouring panes reflect a little differently, as old glass does.
 */
export function pane(glass: MeshBuilder, w: WallRef, s0: number, y0: number, s1: number, y1: number, off: number, clear = GLASS_CLEAR, tint: Rgb = GLASS_TINT, look: PaneLook = {}): void {
  const key = Math.round(w.ax * 7 + w.az * 13 + s0 * 101 + y0 * 211 + (s1 - s0) * 31);
  const amp = look.tilt ?? 0.03;
  const seed = hash01(key, 8801);
  const fx: Fx = {
    clear, dirt: look.dirt ?? 0.3, seed: look.through === true ? seed + THROUGH_SEED : seed, size: [y1 - y0, s1 - s0],
    tilt: [(hash01(key, 8802) * 2 - 1) * amp, (hash01(key, 8803) * 2 - 1) * amp],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
  wquad(glass, w, s0, y0, s1, y1, off, tint, undefined, fx, false);
}

/**
 * The four faces of a hole's reveal, `depth` deep (into the building), the hole running from station `sa` to `sb` (sa < sb) and from `y0` to `y1`.
 * Of the material its builder is working in, or `mat`, or painted (a jamb is painted wood or the wall's own render).
 */
export function reveal(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, depth: number, colour: Rgb, sillColour: Rgb = colour, mat?: Surface | MatRef, sillMat?: Surface | MatRef): void {
  const t: Vec3 = [w.tx, 0, w.tz];
  const nt: Vec3 = [-w.tx, 0, -w.tz];
  // A surface given for the wall's own plane (a deep recess's returns are the wall's) is laid on each face by that face's own lie.
  const given = mat ?? currentMat() ?? "painted";
  // Inside the opening less of the sky is seen (`skyShade.ts`): the colour is darkened, and a surface's own tint with it.
  const face = (pts: readonly Vec3[], n: Vec3, c: Rgb, sky: number, of: Surface | MatRef = given): void => {
    if (isMat(of)) return out.poly(pts, n, scaled(c, sky), of);
    const on = surfaceOn(of, pts, n);
    out.poly(pts, n, scaled(c, sky), on.tint === undefined ? on : { ...on, tint: scaled(on.tint, sky) });
  };
  face([wat(w, sa, y0, 0), wat(w, sa, y0, -depth), wat(w, sa, y1, -depth), wat(w, sa, y1, 0)], t, colour, REVEAL_JAMB);
  face([wat(w, sb, y0, 0), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sb, y1, 0)], nt, colour, REVEAL_JAMB);
  face([wat(w, sa, y0, 0), wat(w, sb, y0, 0), wat(w, sb, y0, -depth), wat(w, sa, y0, -depth)], [0, 1, 0], sillColour, REVEAL_SILL, sillMat ?? given);
  face([wat(w, sa, y1, 0), wat(w, sb, y1, 0), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [0, -1, 0], colour, REVEAL_HEAD);
}

/** How far a door's casing stands out of the wall: the boards up each side (6 cm) and the one across the head (7 cm). */
const CASING_SIDE_OUT = 0.06;
export const CASING_HEAD_OUT = 0.07;
/** The same on the low tier, which keeps its thinner casing (3 cm at the sides, 4 cm at the head). */
const CASING_SIDE_OUT_LOW = 0.03;
const CASING_HEAD_OUT_LOW = 0.04;

/**
 * A door's leaf in its hole: the leaf fills the hole from edge to edge, `depth` in from the wall's face, and the hole's reveal runs exactly to
 * the leaf (wherever the ledger put it), so there is no gap round a door from any angle and nothing is seen past it. The threshold is `sill`. `full` is the full tier, which gives the casing its deeper boards.
 * Returns the leaf's offset: what is put on the leaf (a panel, a light, a handle) stands off from that.
 */
export function doorIn(out: MeshBuilder, w: WallRef, h: Hole, depth: number, leaf: Rgb, leafMat: Surface | MatRef, jamb: Rgb, sill: Rgb = jamb, jambMat?: Surface | MatRef, casing?: Rgb, full = false): number {
  const o = wquad(out, w, h.s0, h.y0, h.s1, h.y1, -depth, leaf, leafMat);
  reveal(out, w, h.s0, h.s1, h.y0, h.y1, -o, jamb, sill, jambMat, "concrete");
  if (casing !== undefined) {
    // The casing: a board up each side of the hole and one across its head, standing out of the wall with its edges.
    const bar = 0.09;
    // (From a hand over the sill: a porch's deck or a step stands against the wall below that.)
    wbox(out, w, h.s0 - bar, h.s0, h.y0 + 0.08, h.y1, 0, full ? CASING_SIDE_OUT : CASING_SIDE_OUT_LOW, casing, casing, true, "painted");
    wbox(out, w, h.s1, h.s1 + bar, h.y0 + 0.08, h.y1, 0, full ? CASING_SIDE_OUT : CASING_SIDE_OUT_LOW, casing, casing, true, "painted");
    wbox(out, w, h.s0 - bar - 0.02, h.s1 + bar + 0.02, h.y1, h.y1 + bar + 0.02, 0, full ? CASING_HEAD_OUT : CASING_HEAD_OUT_LOW, casing, casing, true, "painted");
  }
  return o;
}

/**
 * A pair of boarded doors in their hole (a church's, a hall's): the leaves fill the hole and the reveal runs to them (`doorIn`), a panel above and
 * below on each, the dark line where they meet, and a pull on each.
 */
export function pairedDoors(out: MeshBuilder, w: WallRef, h: Hole, depth: number, col: Rgb, jamb: Rgb, sill: Rgb = jamb): void {
  const o = doorIn(out, w, h, depth, col, "boards", jamb, sill);
  const m = (h.s0 + h.s1) / 2;
  for (const [a, e] of [[h.s0 + 0.12, m - 0.08], [m + 0.08, h.s1 - 0.12]] as const) {
    wquad(out, w, a, h.y0 + 0.25, e, h.y0 + 1.0, o + 0.03, scaled(col, 0.8), "boards");
    wquad(out, w, a, h.y0 + 1.15, e, h.y1 - 0.2, o + 0.03, scaled(col, 0.8), "boards");
  }
  wquad(out, w, m - 0.012, h.y0, m + 0.012, h.y1, o + 0.03, scaled(col, 0.35), "boards");
  for (const k of [-1, 1]) wquad(out, w, m + k * 0.1 - 0.02, h.y0 + 0.95, m + k * 0.1 + 0.02, h.y0 + 1.2, o + 0.06, [0.5, 0.42, 0.2], "steel");
}

/**
 * A glazed frame that fills a rectangle of a wall's plane: four bars `bar` wide at `off`, edge to edge, and the pane between them a centimetre
 * behind (the glass of a shop's door or its transom: the room is seen through it and through nothing else).
 */
export function glazed(out: MeshBuilder, glass: MeshBuilder, w: WallRef, s0: number, y0: number, s1: number, y1: number, off: number, bar: number, colour: Rgb, mat: Surface | MatRef, look: PaneLook = {}): void {
  wquad(out, w, s0, y0, s1, y0 + bar, off, colour, mat);
  wquad(out, w, s0, y1 - bar, s1, y1, off, colour, mat);
  wquad(out, w, s0, y0 + bar, s0 + bar, y1 - bar, off, colour, mat);
  wquad(out, w, s1 - bar, y0 + bar, s1, y1 - bar, off, colour, mat);
  pane(glass, w, s0 + bar, y0 + bar, s1 - bar, y1 - bar, off - 0.01, GLASS_CLEAR, GLASS_TINT, look);
}

/** A frame round a hole: four bars `bar` wide laid `off` off the wall. */
export function frameBars(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, bar: number, off: number, colour: Rgb, mat?: Surface | MatRef): void {
  const m = mat ?? currentMat() ?? "painted";
  wquad(out, w, sa - bar, y0 - bar, sb + bar, y0, off, colour, m);
  wquad(out, w, sa - bar, y1, sb + bar, y1 + bar, off, colour, m);
  wquad(out, w, sa - bar, y0, sa, y1, off, colour, m);
  wquad(out, w, sb, y0, sb + bar, y1, off, colour, m);
}
