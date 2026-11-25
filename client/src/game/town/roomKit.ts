/**
 * What the parts of a room (`roomShell.ts` for its surfaces, `roomGeometry.ts` for what stands in it, `roomDressing.ts` for what hangs on
 * its walls and what a trade puts in the window) are built with: the building's frame (`Xf`: `s` along the front from its left end, `d`
 * into the building from its face), the context of one room, a box in the frame and a quad on a wall, both lit from the room's baked
 * light (`roomLight.ts`) at each corner, so that a surface is brighter where the room is.
 */
import { scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { MURK, depthHaze, type RoomField } from "./roomLight.js";
import type { Fx } from "./townSurface.js";
import type { InteriorType, Trade } from "../../sim/town/types.js";
import type { Foot, Style } from "./roomFill.js";
import type { Detail } from "./townTypes.js";

/** A building's front as the world sees it: the frame's origin on the ground, its outward normal, along-direction, and its size. */
export type Xf = { readonly ox: number; readonly oz: number; readonly nx: number; readonly nz: number; readonly tx: number; readonly tz: number; readonly width: number; readonly depth: number };

/** A point of the frame: `s` along, `d` in, `y` up (absolute). */
export const xp = (xf: Xf, s: number, d: number, y: number): Vec3 => [xf.ox + xf.tx * s - xf.nx * d, y, xf.oz + xf.tz * s - xf.nz * d];
/** The world direction of a direction (ds, dd) of the frame's plane. */
export const xd = (xf: Xf, ds: number, dd: number): Vec3 => [xf.tx * ds - xf.nx * dd, 0, xf.tz * ds - xf.nz * dd];

/** A glow of this says "lit by the room's baked light", not a glow of its own (a tube's, a neon's, a lit cooler's front). */
export const BAKED = -1;

export type Ctx = {
  readonly out: MeshBuilder;
  readonly xf: Xf;
  readonly floorY: number;
  readonly seed: number;
  readonly lit: boolean;
  readonly vacant: boolean;
  readonly detail: Detail;
  readonly trade: Trade | null;
  readonly field: RoomField;
  readonly ceiling: number;
  readonly s0: number;
  readonly s1: number;
  /** The back wall's `d`. */
  readonly d1: number;
  /** The building's era, for what is old in the room. */
  readonly era: number;
  n: number;
  /** Where the chairs stand, so that two tables do not both put one in a place. */
  readonly chairs: [number, number][];
  readonly type: InteriorType;
  /** The wall's paint and the baseboard's colour, for the things built of the same. */
  readonly paint: Rgb;
  readonly base: Rgb;
  /** Where the door is (`s`, and its width), which nothing stands in the way of. */
  readonly door: { readonly s: number; readonly w: number };
  /** The footprints of the furnishings, for what must stand clear of them. */
  readonly feet: readonly Foot[];
  /** The unit's own fittings: chrome or wood, matched or not, how young. */
  readonly style: Style;
};

/** An albedo lit by the room at a point (`yl` over the floor): what the room's light makes of it; a surface close to the floor is dimmer (it is lit from above and shaded by what is round it). */
export function shade(c: Ctx, albedo: Rgb, s: number, d: number, yl: number, up: number): Rgb {
  const e = c.field.at(s, d, yl, up);
  const k = up > 0.5 ? 1 : 0.7 + 0.3 * Math.min(1, Math.max(0, yl / 0.35));
  // Past the front of the room a thing runs to the murk: its own colour and contrast go, so the back reads as dim shapes (`roomLight.ts`).
  const h = depthHaze(d);
  return [(albedo[0] + (MURK[0] - albedo[0]) * h) * e[0] * k, (albedo[1] + (MURK[1] - albedo[1]) * h) * e[1] * k, (albedo[2] + (MURK[2] - albedo[2]) * h) * e[2] * k];
}

/**
 * A box in the frame: centre (`cs`, `cd`), base `y0` over the floor, height `h`, half-length `ha` along `dir` (a unit vector in the (s, d)
 * plane) and half `hb` across it. Only the faces a person outside could see: those that do not face away from the street (their normal's
 * `d` part is not positive), and the top. A `glow` of `BAKED` lights it from the room; any other is the box's own (a tube, a neon).
 */
export function fbox(c: Ctx, cs: number, cd: number, y0: number, h: number, ha: number, hb: number, dir: { x: number; z: number }, side: Rgb, top: Rgb, glow: number = BAKED, sides = true): void {
  const { out, xf } = c;
  const ax = dir.x;
  const ad = dir.z;
  const bx = -ad;
  const bd = ax;
  const corner = (ka: number, kb: number): [number, number] => [cs + ax * ha * ka + bx * hb * kb, cd + ad * ha * ka + bd * hb * kb];
  const ring: [number, number][] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const norms: [number, number][] = [[-bx, -bd], [ax, ad], [bx, bd], [-ax, -ad]];
  const baked = glow === BAKED;
  const fx: Fx = { glow: baked ? 1 : glow };
  const yb = y0 + c.floorY;
  const yt = yb + h;
  for (let i = 0; i < 4; i++) {
    const [ns, nd] = norms[i] as [number, number];
    if (nd > 0.35) continue;
    if (!sides && nd > -0.5) continue;
    const a = ring[i] as [number, number];
    const b = ring[(i + 1) % 4] as [number, number];
    const alb = nd < -0.5 ? side : scaled(side, 0.82);
    const pts: Vec3[] = [xp(xf, a[0], a[1], yb), xp(xf, b[0], b[1], yb), xp(xf, b[0], b[1], yt), xp(xf, a[0], a[1], yt)];
    const cols: Rgb[] | Rgb = baked ? [shade(c, alb, a[0], a[1], y0, 0), shade(c, alb, b[0], b[1], y0, 0), shade(c, alb, b[0], b[1], y0 + h, 0), shade(c, alb, a[0], a[1], y0 + h, 0)] : alb;
    out.poly(pts, xd(xf, ns, nd), cols, undefined, fx);
  }
  const cols: Rgb[] | Rgb = baked ? ring.map(([s, d]) => shade(c, top, s, d, y0 + h, 1)) : top;
  out.poly(ring.map(([s, d]) => xp(xf, s, d, yt)), [0, 1, 0], cols, undefined, fx);
}

/** The faces of the room a thing can hang on. */
export type WallName = "back" | "left" | "right";

/** The point of a wall at `a` along it (`s` for the back wall, `d` for a side wall) and `y` over the floor, `off` off its face (into the room). */
export function wallPoint(c: Ctx, wall: WallName, a: number, y: number, off: number): Vec3 {
  switch (wall) {
    case "back": return xp(c.xf, a, c.d1 - off, c.floorY + y);
    case "left": return xp(c.xf, c.s0 + off, a, c.floorY + y);
    case "right": return xp(c.xf, c.s1 - off, a, c.floorY + y);
  }
}

/** The (s, d) of a wall's point, for lighting it. */
function wallSD(c: Ctx, wall: WallName, a: number, off: number): [number, number] {
  return wall === "back" ? [a, c.d1 - off] : wall === "left" ? [c.s0 + off, a] : [c.s1 - off, a];
}

/**
 * A thing laid on a wall is put on one of the steps of depth, 3 cm apart (3, 6, 9 and 12 cm off the wall), the nearest above the offset it was
 * asked for: two things one over the other are never closer than 3 cm, which the depth buffer holds apart at 60 m. Offsets from 8 cm out
 * (a shelf's depth) are left as they are.
 */
export function ladder(off: number): number {
  return off >= 0.08 ? off : off <= 0.035 ? 0.03 : off <= 0.045 ? 0.06 : off <= 0.055 ? 0.09 : 0.12;
}

/** The direction a wall's face looks (into the room), as a hint for a polygon laid on it. */
export function wallFacing(c: Ctx, wall: WallName): Vec3 {
  return wall === "back" ? xd(c.xf, 0, -1) : wall === "left" ? xd(c.xf, 1, 0) : xd(c.xf, -1, 0);
}

/**
 * A rectangle on a wall: from `a0` to `a1` along it and `y0` to `y1` over the floor, `off` off the wall, in `albedo` lit by the room, or
 * with its own `glow` (a lit sign, a clock's face) when it is given. `warm` is a colour it is multiplied by for a second tone at its foot
 * (a gradient, a sheet of paper faded at the top): `foot` is its albedo at `y0` where it is not the same as at `y1`.
 */
export function wallQuad(c: Ctx, wall: WallName, a0: number, a1: number, y0: number, y1: number, offAsked: number, albedo: Rgb, glow: number = BAKED, foot?: Rgb): void {
  const baked = glow === BAKED;
  const off = ladder(offAsked);
  const p = [wallPoint(c, wall, a0, y0, off), wallPoint(c, wall, a1, y0, off), wallPoint(c, wall, a1, y1, off), wallPoint(c, wall, a0, y1, off)];
  const lo = foot ?? albedo;
  const cols: Rgb[] | Rgb = baked
    ? [shade(c, lo, ...wallSD(c, wall, a0, off), y0, 0), shade(c, lo, ...wallSD(c, wall, a1, off), y0, 0), shade(c, albedo, ...wallSD(c, wall, a1, off), y1, 0), shade(c, albedo, ...wallSD(c, wall, a0, off), y1, 0)]
    : albedo;
  c.out.poly(p, wallFacing(c, wall), cols, undefined, { glow: baked ? 1 : glow });
}

/** A flat polygon on a wall through points (`a` along the wall, `y` over the floor), `off` off it (the steps of `ladder`), lit by the room: a tilted frame, a dartboard. */
export function wallPoly(c: Ctx, wall: WallName, pts: readonly (readonly [number, number])[], offAsked: number, albedo: Rgb, glow: number = BAKED): void {
  const off = ladder(offAsked);
  const baked = glow === BAKED;
  c.out.poly(pts.map(([a, y]) => wallPoint(c, wall, a, y, off)), wallFacing(c, wall), baked ? pts.map(([a, y]) => shade(c, albedo, ...wallSD(c, wall, a, off), y, 0)) : albedo, undefined, { glow: baked ? 1 : glow });
}

/** A box standing out from a wall: a frame, a shelf, a board with depth. `depth` is how far it stands out. Lit from the room. */
export function wallBox(c: Ctx, wall: WallName, a0: number, a1: number, y0: number, y1: number, depth: number, albedo: Rgb, edge: Rgb = scaled(albedo, 0.7)): void {
  wallQuad(c, wall, a0, a1, y0, y1, depth, albedo);
  // Its top, which a person looking in from above the sill could see, and its end toward the front of the room.
  const top = [wallPoint(c, wall, a0, y1, 0), wallPoint(c, wall, a1, y1, 0), wallPoint(c, wall, a1, y1, depth), wallPoint(c, wall, a0, y1, depth)];
  const [s0, d0] = wallSD(c, wall, a0, depth * 0.5);
  const [s1, d1] = wallSD(c, wall, a1, depth * 0.5);
  c.out.poly(top, [0, 1, 0], [shade(c, edge, s0, d0, y1, 1), shade(c, edge, s1, d1, y1, 1), shade(c, edge, s1, d1, y1, 1), shade(c, edge, s0, d0, y1, 1)], undefined, { glow: 1 });
}

/** An upright drum or post in the frame, lit from the room (one colour a face, from the light at its foot and top); radius `r` at the foot and `rt` at the top. */
export function fcyl(c: Ctx, s: number, d: number, y0: number, r: number, h: number, sides: number, side: Rgb, top: Rgb, rt: number = r): void {
  const { out, xf } = c;
  const yb = y0 + c.floorY;
  const yt = yb + h;
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a), Math.sin(a)]);
  }
  const fx: Fx = { glow: 1 };
  for (let i = 0; i < sides; i++) {
    const [c0, s0] = ring[i] as [number, number];
    const [c1, s1] = ring[(i + 1) % sides] as [number, number];
    // Only the faces turned toward the street show (a face whose normal points in, `d` part positive, is behind the drum).
    const mx = c0 + c1;
    const mz = s0 + s1;
    if (mz > 0.9) continue;
    const k = 0.75 + 0.25 * (1 - Math.min(1, Math.abs(mx)));
    const col = shade(c, scaled(side, k), s + (mx / 2) * r, d + (mz / 2) * r, y0 + h * 0.5, 0);
    out.poly([xp(xf, s + c0 * r, d + s0 * r, yb), xp(xf, s + c1 * r, d + s1 * r, yb), xp(xf, s + c1 * rt, d + s1 * rt, yt), xp(xf, s + c0 * rt, d + s0 * rt, yt)], xd(xf, mx, mz), col, undefined, fx);
  }
  if (rt > 0) out.poly(ring.map(([cx, sz]) => xp(xf, s + cx * rt, d + sz * rt, yt)), [0, 1, 0], shade(c, top, s, d, y0 + h, 1), undefined, fx);
}
