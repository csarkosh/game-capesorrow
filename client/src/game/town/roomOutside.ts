/**
 * What is seen out of a designed room's windows: a street (or, behind, a yard) laid on the ground outside the wall that has a pane, so that the glass shows a place and not only sky: a sidewalk 3 m deep against
 * the wall, a curb, a roadway 9 m wide, a far sidewalk and plain ground beyond it out to 90 m, a row of low fronts across the road as plain boxes of muted colours with darker rows of windows, utility poles, and a
 * parked car or two. It is seen only blurred through the glass (`roomGlass.ts`, `townBlur.ts`), so it is coarse and cheap (under 1,500 vertices for the front, fewer behind).
 *
 * It is lit by the outside, not by the room: its faces take no glow and no baked light, so the scene's own light and the air colour them (bright by day, dark at night, grey in rain, as the sky above them is); the room's
 * two-bake mix (`NIGHT_RATIOS`) is never put on them. It is a mesh of its own (`RoomArrays.outside`), outside the room's box, nothing to walk on or to reach, and no rain cover. The town below stays hidden.
 */
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { xd, xp, type Xf } from "./roomKit.js";

/** How far below the room's floor the street stands (the door's step), and the roadway below the sidewalk (the curb's height). */
export const STREET_DROP = 0.15;
const CURB = 0.15;
/** The widths of the street from the wall outward (metres): the sidewalk, the roadway, the far sidewalk. */
const WALK = 3;
const ROAD = 9;
const FAR_WALK = 3;
/** How far the ground runs out and how much of the wall's length it reaches beyond each end. */
const REACH = 90;
const ALONG = 15;

const WALLS: readonly Rgb[] = [[0.62, 0.55, 0.48], [0.5, 0.55, 0.58], [0.58, 0.5, 0.45], [0.5, 0.5, 0.46]];

/** Which side of the room the ground is laid on: `front`, where the street is (the room's `d` below 0), or `back`, a yard (`d` over the depth). */
export type OutsideSide = "front" | "back";

export function roomOutside(out: MeshBuilder, xf: Xf, floorY: number, width: number, depth: number, side: OutsideSide, seed: number): void {
  const sign = side === "front" ? -1 : 1;
  // A point out from the wall by `t` metres, at `s` along it and `y` over the room's floor.
  const at = (s: number, t: number, y: number): Vec3 => xp(xf, s, side === "front" ? -t : depth + t, floorY + y);
  const up: Vec3 = [0, 1, 0];
  const toward = xd(xf, 0, -sign);
  const along = xd(xf, 1, 0);
  const quad = (pts: readonly Vec3[], hint: Vec3, c: Rgb, mat: "concrete" | "brick" | "plaster" | "painted"): void => out.poly(pts, hint, c, mat, { glow: 0 });
  const ground = -STREET_DROP;
  const road = ground - CURB;
  const s0 = -ALONG;
  const s1 = width + ALONG;
  // The sidewalk, the roadway, the far sidewalk and the ground beyond (a long strip to each side too).
  quad([at(s0, 0, ground), at(s1, 0, ground), at(s1, WALK, ground), at(s0, WALK, ground)], up, [0.9, 0.9, 0.88], "concrete");
  quad([at(s0, WALK, road), at(s1, WALK, road), at(s1, WALK + ROAD, road), at(s0, WALK + ROAD, road)], up, [0.34, 0.34, 0.35], "concrete");
  quad([at(s0, WALK + ROAD, ground), at(s1, WALK + ROAD, ground), at(s1, WALK + ROAD + FAR_WALK, ground), at(s0, WALK + ROAD + FAR_WALK, ground)], up, [0.9, 0.9, 0.88], "concrete");
  quad([at(s0, WALK, road), at(s1, WALK, road), at(s1, WALK, ground), at(s0, WALK, ground)], xd(xf, 0, sign), [1.0, 1.0, 0.98], "concrete");
  quad([at(s0, WALK + ROAD, road), at(s1, WALK + ROAD, road), at(s1, WALK + ROAD, ground), at(s0, WALK + ROAD, ground)], toward, [0.95, 0.95, 0.93], "concrete");
  const g0 = WALK + ROAD + FAR_WALK;
  quad([at(s0, g0, ground), at(s1, g0, ground), at(s1, REACH, ground), at(s0, REACH, ground)], up, [0.5, 0.55, 0.48], "concrete");
  quad([at(-REACH, 0, ground), at(s0, 0, ground), at(s0, REACH, ground), at(-REACH, REACH, ground)], up, [0.5, 0.55, 0.48], "concrete");
  quad([at(s1, 0, ground), at(width + REACH, 0, ground), at(width + REACH, REACH, ground), at(s1, REACH, ground)], up, [0.5, 0.55, 0.48], "concrete");

  // A box standing on the ground: its four sides and its top, `w` along, `h` high, from `t0` to `t1` out.
  const box = (sa: number, sb: number, t0: number, t1: number, y0: number, y1: number, c: Rgb, mat: "plaster" | "painted" | "brick" = "plaster"): void => {
    quad([at(sa, t0, y0), at(sb, t0, y0), at(sb, t0, y1), at(sa, t0, y1)], toward, c, mat);
    quad([at(sa, t1, y0), at(sb, t1, y0), at(sb, t1, y1), at(sa, t1, y1)], xd(xf, 0, sign), c, mat);
    quad([at(sa, t0, y0), at(sa, t1, y0), at(sa, t1, y1), at(sa, t0, y1)], xd(xf, -1, 0), c, mat);
    quad([at(sb, t0, y0), at(sb, t1, y0), at(sb, t1, y1), at(sb, t0, y1)], along, c, mat);
    quad([at(sa, t0, y1), at(sb, t0, y1), at(sb, t1, y1), at(sa, t1, y1)], up, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], mat);
  };
  // The fronts across the road: a row of boxes 6 to 10 m high, 6 to 14 m wide, in four muted colours, with two rows of darker windows on each face toward the room. Behind the room, a yard: lower and further.
  const front = side === "front";
  const t0 = front ? WALK + ROAD + FAR_WALK + 2 : 14;
  let s = -30;
  for (let k = 0; s < width + 30; k++) {
    const w = 6 + 8 * hash01(seed * 7 + k, 901);
    const h = (front ? 6 : 4) + (front ? 4 : 3) * hash01(seed * 11 + k, 902);
    const c = WALLS[Math.floor(hash01(seed * 13 + k, 903) * WALLS.length)] as Rgb;
    box(s, s + w - 0.4, t0, t0 + 8, ground, ground + h, c);
    const cols = Math.max(2, Math.round((w - 1) / 2.2));
    for (let r = 0; r < Math.floor((h - 1.5) / 3); r++) for (let j = 0; j < cols; j++) {
      const wa = s + 0.6 + (j * (w - 1.6)) / cols;
      const y = ground + 1.6 + r * 3;
      quad([at(wa, t0 - 0.05, y), at(wa + 1.0, t0 - 0.05, y), at(wa + 1.0, t0 - 0.05, y + 1.4), at(wa, t0 - 0.05, y + 1.4)], toward, [0.14, 0.15, 0.17], "painted");
    }
    s += w + (hash01(seed * 17 + k, 904) < 0.3 ? 2.5 : 0);
  }
  // Two or three utility poles on the far sidewalk (or in the yard), a parked car or two at the far curb.
  if (front) {
    for (const p of [width * 0.15, width * 0.6, width * 1.05]) {
      box(p - 0.1, p + 0.1, WALK + ROAD + 1, WALK + ROAD + 1.2, ground, ground + 8, [0.3, 0.26, 0.22], "painted");
      box(p - 1.1, p + 1.1, WALK + ROAD + 1.0, WALK + ROAD + 1.25, ground + 7.4, ground + 7.6, [0.3, 0.26, 0.22], "painted");
    }
    // Two cars a car's length and more apart (in a narrow room's street they would stand through each other).
    for (const [k, p] of [width * 0.35, Math.max(width * 0.85, width * 0.35 + 5)].entries()) {
      const c: Rgb = k === 0 ? [0.5, 0.15, 0.12] : [0.2, 0.28, 0.4];
      box(p - 2.1, p + 2.1, WALK + ROAD - 2.2, WALK + ROAD - 0.4, road, road + 0.85, c, "painted");
      box(p - 1.1, p + 1.1, WALK + ROAD - 2.1, WALK + ROAD - 0.5, road + 0.85, road + 1.35, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], "painted");
    }
  } else {
    for (const p of [width * 0.2, width * 0.7]) box(p - 0.1, p + 0.1, 8, 8.2, ground, ground + 7, [0.3, 0.26, 0.22], "painted");
  }
}
