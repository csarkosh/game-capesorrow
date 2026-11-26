/**
 * The sky a wall sees, carried in its corners. Under an overcast sky nothing casts a shadow, and what shows a building's form is that the
 * places which see less of the sky are darker: the foot of a wall, where it meets the ground, the strip under an eave, the inside of a window's
 * or a door's opening. The town has no pass for this, so the builders work out where each corner of a wall stands (how far over the ground, how
 * far under the roof) and the corner carries it in two floats of its surface record that a textured corner had no use for
 * (`MeshBuilder.poly`). The material turns the two into how much of the sky's light the pixel takes (`townMaterial.ts`, `SKY_CODE`): the
 * sky's light and its reflection are dimmed, the sun's is not, and the surface's own colour is left as it is.
 *
 * - **The foot**: the pixel takes `FOOT_SHADE` of the sky's light at the ground, rising to all of it `FOOT_REACH` m over the ground. The ground
 *   along a wall is taken as a straight line between its two ends, so the band follows a wall that stands on a slope. What stands at the foot
 *   carries it too: a house's foundation and corner boards, a shopfront's bulkheads and water table.
 * - **The eave**: `EAVE_SHADE` where the wall meets the roof over it, rising to all of it `EAVE_REACH` m under the roof. The roof is its planes
 *   (a gable's two slopes, a hip's four, a shed's one), so a gable end is shaded along its rakes and a shed's side walls along its slope.
 *
 * Both distances are straight along a wall, so the renderer's interpolation between a polygon's corners is exact and no wall is cut for them
 * (but along a gable end's ridge line, where the roof over it changes from one slope to the other).
 */
import type { Vec3 } from "./meshBuilder.js";
import type { Cut, Shade } from "./townSurface.js";

/** How much of the sky's light a wall takes at the ground, and how many metres up it that fades out; the same where the roof meets it, and how many metres down. */
export const FOOT_SHADE = 0.45;
export const FOOT_REACH = 0.8;
export const EAVE_SHADE = 0.45;
export const EAVE_REACH = 0.9;
/** The underside of a roof's overhang, which sees the ground and none of the sky. */
export const SOFFIT_SHADE = 0.3;
/**
 * How a corner carries the two distances (`Shade.at`): its height over the ground plus `FOOT_CODE`, and its depth under the roof plus
 * `EAVE_CODE`, so that neither is ever 0, which is a corner with no shade, nor under -0.5, which in the first of the two floats is a wire
 * (`townMaterial.ts`, `WIRE_VERTEX`).
 */
export const FOOT_CODE = 8;
export const EAVE_CODE = 1;
/**
 * The first of the two floats is also where a room's corner carries its hours (`hours.ts`), a whole number of 1 or more. So a foot's code is
 * kept under a half: a metre of it is `FOOT_UNIT`, and it stops at `FOOT_MOST` metres, far over any reach. A 16-bit float is as exact for small
 * numbers as for large ones, so nothing is lost by it.
 */
export const FOOT_UNIT = 1 / 256;
export const FOOT_MOST = 120;
/** The first float of a corner `over` metres over the ground. */
export function footCode(over: number): number {
  return Math.min(FOOT_MOST, Math.max(0.5, FOOT_CODE + over)) * FOOT_UNIT;
}
/** The faces inside an opening (`reveal`, `buildingKit.ts`): its jambs, its sill (which looks up, and sees more) and its head (which looks down, and sees none). */
export const REVEAL_JAMB = 0.6;
export const REVEAL_SILL = 0.8;
export const REVEAL_HEAD = 0.5;

/** The ground along a wall, as a line: its height where the wall starts (`ax`, `az`), and its rise per metre along the wall's direction (`tx`, `tz`). */
export type GroundLine = { readonly ax: number; readonly az: number; readonly tx: number; readonly tz: number; readonly y: number; readonly rise: number };

/** A plane of a roof: its height over (`x`, `z`) and its rise per metre along the world's x and z. */
export type RoofPlane = { readonly x: number; readonly z: number; readonly y: number; readonly gx: number; readonly gz: number };

/**
 * The shade of a wall that stands on `ground` under the roof `roof` (none for a flat roof, whose wall stands over it, and for a ruin). `creases` are
 * planes where two of the roof's planes meet over the wall (a gable end's ridge line), which the wall is cut along.
 */
export function wallShade(ground: GroundLine, roof: readonly RoofPlane[], creases: readonly Cut[] = []): Shade {
  const over = (p: Vec3): number => p[1] - ground.y - ground.rise * ((p[0] - ground.ax) * ground.tx + (p[2] - ground.az) * ground.tz);
  const under = (r: RoofPlane, p: Vec3): number => r.y + r.gx * (p[0] - r.x) + r.gz * (p[2] - r.z) - p[1];
  const at = (p: Vec3): readonly [number, number] => {
    const foot = footCode(over(p));
    if (roof.length === 0) return [foot, 0];
    let depth = Infinity;
    for (const r of roof) depth = Math.min(depth, under(r, p));
    return [foot, Math.max(0.5, EAVE_CODE + depth)];
  };
  return { at, cuts: roof.length < 2 ? [] : creases };
}

/** The shade of a face that sees a fixed share `sky` of the sky wherever it is (a soffit): the eave's code that gives it. */
export function flatShade(sky: number): Shade {
  // The material eases the eave's ramp (`SKY_CODE`): t * t * (3 - 2 * t). Its inverse by bisection, once.
  const want = Math.min(1, Math.max(0, (sky - EAVE_SHADE) / (1 - EAVE_SHADE)));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (t * t * (3 - 2 * t) < want) lo = t;
    else hi = t;
  }
  const code: readonly [number, number] = [0, EAVE_CODE + ((lo + hi) / 2) * EAVE_REACH];
  return { at: () => code, cuts: [] };
}
