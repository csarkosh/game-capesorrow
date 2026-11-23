/**
 * The signs at the town's junctions, as simple true shapes on posts: a STOP sign on the right of each approach that stops, the green
 * street-name blades at one corner of each junction with a pavement, a DEAD END sign where a street that ends begins, the
 * planter's sign where a sharp crossing closed a leg, and a PAVEMENT ENDS sign where a road out of town turns to gravel.
 *
 * - **STOP** (section 4, MUTCD 2B and 2A): a red octagon 30 in (0.76 m) across the flats, its bottom 7 ft (2.13 m) above the curb's top, on
 *   a post 1 ft (0.3 m) behind the curb's face, before the stop line and the crosswalk, facing the traffic that comes to it; the word
 *   in white.
 * - **Street-name blades** (section 4, MUTCD 2D): green, one post at a corner of the junction between two different streets, a blade
 *   for each street, each parallel to the street it names, in capitals 4.5 in (0.114 m) tall; the highway and the plan's streets by
 *   their names, the suffix as ST, AVE or HWY. The text is geometry (`signFont.ts`), on both faces of each blade on the full tier; the
 *   low tier's blades are blank.
 * - Other signs are yellow with black words (a rectangle for DEAD END, a diamond for PAVEMENT ENDS, 36 in).
 *
 * A sign faces along its normal `n`, the way the traffic it is for comes from; its right (as the reader sees it) is (-n.z, n.x).
 */
import { SIGN_BEHIND_CURB, STOP_SIGN_SIZE, stopSignSpot } from "../../sim/town/junctions.js";
import type { JunctionCorner, JunctionLeg, Vec } from "../../sim/town/types.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";
import { FLAG_POLE, SIGN_BLACK, SIGN_GREEN, SIGN_RED, SIGN_WHITE, SIGN_YELLOW } from "./palette.js";
import { GLYPH_H, textPixels, textRuns } from "./signFont.js";
import { WALK_LIFT } from "./streetGeometry.js";
import type { WJunction } from "./junctionWorld.js";
import type { Surface } from "./surface.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";

/** A STOP sign: its width across the flats, the height of its bottom over the curb's top, and the width of its post, metres. */
export const STOP_SIZE = STOP_SIGN_SIZE;
export const SIGN_HEIGHT = 2.13;
const POST_RADIUS = 0.04;
/** A blade's height, its capital letters' height (4.5 in) and its two blades' heights over the curb, metres. */
export const BLADE_HEIGHT = 0.2;
export const BLADE_CAPITAL = 0.114;
const BLADE_ABOVE = [2.55, 2.3] as const;

type Plane = { x: number; y: number; z: number; nx: number; nz: number };

/** How far in front of a sign's face its lettering stands: the face is at 1.2 cm, and a face's layers are 2 cm or more apart. */
const LETTER_OFF = 0.035;

/** A corner of a sign: `u` to the reader's right and `v` up from its centre. */
function corner(c: Plane, u: number, v: number, off: number): Vec3 {
  return [c.x - c.nz * u + c.nx * off, c.y + v, c.z + c.nx * u + c.nz * off];
}

/** A flat shape on a sign, on its front (`off` over the face) and its back. */
function plate(solid: Sink, c: Plane, shape: readonly (readonly [number, number])[], front: Rgb | null, back: Rgb | null): void {
  const b = solid(c.x, c.z);
  if (front !== null) b.poly(shape.map(([u, v]) => corner(c, u, v, 0.012)), [c.nx, 0, c.nz], front);
  if (back !== null) b.poly(shape.map(([u, v]) => corner(c, u, v, -0.012)), [-c.nx, 0, -c.nz], back);
}

/** Words on a sign's face, or on both faces: `pixel` metres a pixel, the first row's top at `top` over the centre, centred across. */
function words(solid: Sink, c: Plane, text: string, pixel: number, top: number, colour: Rgb, both: boolean): void {
  const b = solid(c.x, c.z);
  const width = textPixels(text) * pixel;
  for (const run of textRuns(text)) {
    const u0 = run.c0 * pixel - width / 2;
    const u1 = run.c1 * pixel - width / 2;
    const v0 = top - run.r0 * pixel;
    const v1 = top - run.r1 * pixel;
    b.poly([corner(c, u0, v0, LETTER_OFF), corner(c, u1, v0, LETTER_OFF), corner(c, u1, v1, LETTER_OFF), corner(c, u0, v1, LETTER_OFF)], [c.nx, 0, c.nz], colour);
    // On the back the reader's right is the other way.
    if (both) b.poly([corner(c, -u0, v0, -LETTER_OFF), corner(c, -u1, v0, -LETTER_OFF), corner(c, -u1, v1, -LETTER_OFF), corner(c, -u0, v1, -LETTER_OFF)], [-c.nx, 0, -c.nz], colour);
  }
}

function post(solid: Sink, g: TownGround, x: number, z: number, top: number): void {
  const base = g.heightAt(x, z);
  solid(x, z).cylinder(x, z, base - 0.1, POST_RADIUS, top - base + 0.1, 6, FLAG_POLE, FLAG_POLE);
}

/** An octagon of the given width across its flats, as corners round the sign's centre. */
export function octagon(across: number): [number, number][] {
  const r = across / 2;
  const k = r * 0.41421356;
  return [[r, -k], [r, k], [k, r], [-k, r], [-r, k], [-r, -k], [-k, -r], [k, -r]];
}

/** The abbreviation a blade uses for the street's kind: ST, AVE, HWY. */
export function bladeText(name: string): string {
  return name
    .toUpperCase()
    .replace(/ STREET$/, " ST")
    .replace(/ AVENUE$/, " AVE")
    .replace(/ HIGHWAY$/, " HWY");
}

export function stopSign(solid: Sink, g: TownGround, x: number, z: number, nx: number, nz: number, full: boolean): void {
  // The post's top is the sign's top; the sign's bottom is `SIGN_HEIGHT` over the curb's top (the ground plus the sidewalk's lift).
  const ground = g.heightAt(x, z);
  const bottom = ground + WALK_LIFT + SIGN_HEIGHT;
  const half = STOP_SIZE / 2;
  const c: Plane = { x, y: bottom + half, z, nx, nz };
  post(solid, g, x - nx * 0.05, z - nz * 0.05, bottom + STOP_SIZE);
  // The white rim and the red face lie side by side in one plane (a ring and an octagon), not one over the other.
  const rim = octagon(STOP_SIZE);
  const face = octagon(STOP_SIZE * 0.92);
  plate(solid, c, rim, null, FLAG_POLE);
  plate(solid, c, face, SIGN_RED, null);
  for (let k = 0; k < 8; k++) {
    const l = (k + 1) % 8;
    plate(solid, c, [rim[k] as [number, number], rim[l] as [number, number], face[l] as [number, number], face[k] as [number, number]], SIGN_WHITE, null);
  }
  if (full) words(solid, c, "STOP", 0.026, (7 * 0.026) / 2, SIGN_WHITE, false);
}

/** A rectangular sign: yellow with black words (DEAD END). */
function rectSign(solid: Sink, g: TownGround, x: number, z: number, nx: number, nz: number, text: string, w: number, h: number, pixel: number, full: boolean): void {
  const ground = g.heightAt(x, z);
  const bottom = ground + WALK_LIFT + SIGN_HEIGHT;
  const c: Plane = { x, y: bottom + h / 2, z, nx, nz };
  post(solid, g, x - nx * 0.05, z - nz * 0.05, bottom + h);
  plate(solid, c, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], SIGN_YELLOW, FLAG_POLE);
  if (full) words(solid, c, text, pixel, (GLYPH_H * pixel) / 2, SIGN_BLACK, false);
}

/** A yellow diamond with two lines of words (PAVEMENT ENDS), 36 in on a side. */
function diamondSign(solid: Sink, g: TownGround, x: number, z: number, nx: number, nz: number, lines: readonly string[], full: boolean): void {
  const side = 0.91;
  const half = side * 0.7071;
  const ground = g.heightAt(x, z);
  const bottom = ground + 1.5;
  const c: Plane = { x, y: bottom + half, z, nx, nz };
  post(solid, g, x - nx * 0.05, z - nz * 0.05, bottom + half);
  plate(solid, c, [[0, -half], [half, 0], [0, half], [-half, 0]], SIGN_YELLOW, FLAG_POLE);
  if (full) {
    const pixel = 0.0125;
    lines.forEach((line, i) => words(solid, { ...c, y: c.y - (i - (lines.length - 1) / 2) * 0.14 }, line, pixel, (GLYPH_H * pixel) / 2, SIGN_BLACK, false));
  }
}

/** An end-of-road marker (MUTCD 2C, Type 4): a red diamond 18 in (0.46 m) on a side, its bottom 4 ft (1.22 m) over the traveled way, facing the traffic that comes to the end. */
export const MARKER_SIDE = 0.46;
export const MARKER_HEIGHT = 1.22;
export function endMarker(solid: Sink, g: TownGround, x: number, z: number, nx: number, nz: number, roadLift: number): void {
  const d = MARKER_SIDE * 0.7071;
  const bottom = g.heightAt(x, z) + roadLift + MARKER_HEIGHT;
  const c: Plane = { x, y: bottom + d, z, nx, nz };
  post(solid, g, x - nx * 0.05, z - nz * 0.05, bottom + d);
  plate(solid, c, [[0, -d], [d, 0], [0, d], [-d, 0]], SIGN_RED, FLAG_POLE);
}

/** A blade: green, `length` metres long, its long axis along (ax, az), its faces across it. */
function blade(solid: Sink, g: TownGround, x: number, z: number, y: number, ax: number, az: number, name: string, full: boolean): void {
  const text = bladeText(name);
  const pixel = BLADE_CAPITAL / GLYPH_H;
  const length = textPixels(text) * pixel + 0.16;
  // The face's normal is across the blade's long axis; its reader's right is along the axis.
  // The blade hangs from the post's side, its near end clear of the post (a blade through the post would have the post's faces in the planes of its own).
  const out = length / 2 + POST_RADIUS + 0.03;
  const c: Plane = { x: x + ax * out, y, z: z + az * out, nx: az, nz: -ax };
  void g;
  plate(solid, c, [[-length / 2, -BLADE_HEIGHT / 2], [length / 2, -BLADE_HEIGHT / 2], [length / 2, BLADE_HEIGHT / 2], [-length / 2, BLADE_HEIGHT / 2]], SIGN_GREEN, SIGN_GREEN);
  if (full) words(solid, c, text, pixel, (GLYPH_H * pixel) / 2, SIGN_WHITE, true);
}

export function signGeometry(g: TownGround, surf: Surface, solid: Sink, junctions: readonly WJunction[], detail: Detail = "full"): void {
  void surf;
  const full = detail === "full";
  for (const j of junctions) {
    if (j.polygon.length >= 3) {
      for (const l of j.legs) {
        if (l.engine || l.closed) continue;
        if (l.stops && l.stopLine !== null) {
          // The right of the approach: the traffic comes toward the junction along -d, so its right is the leg's left.
          const spot = stopSignSpot(l) as { s: number; lat: number };
          const s = spot.s;
          const lat = spot.lat;
          stopSign(solid, g, l.x + l.dx * s - l.dz * lat, l.z + l.dz * s + l.dx * lat, l.dx, l.dz, full);
        }
        if (l.deadEnd) {
          // At the entrance of a street that ends: for traffic leaving the junction, on its right, facing back toward the junction.
          const s = l.mouth + 7;
          const lat = -(l.half + SIGN_BEHIND_CURB);
          rectSign(solid, g, l.x + l.dx * s - l.dz * lat, l.z + l.dz * s + l.dx * lat, -l.dx, -l.dz, "DEAD END", 0.76, 0.4, 0.014, full);
        }
      }
      for (const l of j.closed) {
        // The planter's sign: DEAD END, on the planter, facing the street's traffic.
        const s = l.mouth + 0.4;
        rectSign(solid, g, l.x + l.dx * s, l.z + l.dz * s, l.dx, l.dz, "DEAD END", 0.76, 0.4, 0.014, full);
      }
      if (j.blades !== null) bladesAt(solid, g, j, full);
    }
    if (j.pavementEnds !== null) {
      const e = j.pavementEnds;
      const width = j.legs[1]?.roadway ?? 6;
      // On the road's right, facing the traffic that leaves town along it.
      const lat = -(Math.min(width, 6) / 2 + 1.2);
      diamondSign(solid, g, e.x + g.anchor.x - e.dz * lat, e.z + g.anchor.z + e.dx * lat, -e.dx, -e.dz, ["PAVEMENT", "ENDS"], full);
    }
  }
}

/** The two blades of a junction on a post of their own at a corner, the upper naming the first leg's street. */
function bladesAt(solid: Sink, g: TownGround, j: WJunction, full: boolean): void {
  const b = j.blades;
  if (b === null) return;
  const k = j.corners[b.corner] as JunctionCorner;
  let p: Vec | null = null;
  if (k.shape === "arc" && k.c !== null && k.v !== null) {
    // Half a metre behind the curb on the corner's middle.
    const vx = k.v.x - k.c.x;
    const vz = k.v.z - k.c.z;
    const vl = Math.sqrt(vx * vx + vz * vz) || 1;
    p = { x: k.c.x + (vx / vl) * (k.radius - 0.55), z: k.c.z + (vz / vl) * (k.radius - 0.55) };
  } else if (k.v !== null) p = { x: k.v.x, z: k.v.z };
  if (p === null) return;
  const top = g.heightAt(p.x, p.z) + WALK_LIFT + 2.9;
  post(solid, g, p.x, p.z, top);
  const ground = g.heightAt(p.x, p.z) + WALK_LIFT;
  [0, 1].forEach((i) => {
    const l = j.legs[b.legs[i] as number] as JunctionLeg;
    blade(solid, g, p.x, p.z, ground + (BLADE_ABOVE[i] as number), l.dx, l.dz, l.name, full);
  });
}
