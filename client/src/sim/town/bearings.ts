/**
 * Grid bearings as Pythagorean triples. A grid's bearing is `(a, b, c)` with a*a + b*b = c*c, the
 * unit direction `(a/c, b/c)` in the site's (x, z): a is the east part, b the north part, so the
 * angle is measured from north toward east, as a yaw is. Rotating a point into and out of a grid's
 * frame is exact arithmetic with no trigonometry.
 *
 * `deg` is the angle in degrees, a plain number written beside each triple for display only: no
 * decision is made on a computed angle, only on the triples (cross products) and on these numbers.
 */
export type Bearing = { readonly a: number; readonly b: number; readonly c: number; readonly deg: number };

/** The east-leaning triples, with their angle written beside each. Mirrors (negative a) are made below. */
const LEANING: readonly Bearing[] = [
  { a: 7, b: 24, c: 25, deg: 16.26 },
  { a: 5, b: 12, c: 13, deg: 22.62 },
  { a: 8, b: 15, c: 17, deg: 28.07 },
  { a: 3, b: 4, c: 5, deg: 36.87 },
  { a: 20, b: 21, c: 29, deg: 43.6 },
  { a: 21, b: 20, c: 29, deg: 46.4 },
  { a: 4, b: 3, c: 5, deg: 53.13 },
  { a: 15, b: 8, c: 17, deg: 61.93 },
  { a: 12, b: 5, c: 13, deg: 67.38 },
  { a: 24, b: 7, c: 25, deg: 73.74 },
  // Extra triples that fill the gaps, so that a shore's own line is matched closely.
  { a: 9, b: 40, c: 41, deg: 12.68 },
  { a: 12, b: 35, c: 37, deg: 18.92 },
  { a: 28, b: 45, c: 53, deg: 31.89 },
  { a: 33, b: 56, c: 65, deg: 30.51 },
  { a: 48, b: 55, c: 73, deg: 41.12 },
  { a: 35, b: 12, c: 37, deg: 71.08 },
];

/** True north, a grid to the compass. */
export const COMPASS: Bearing = { a: 0, b: 1, c: 1, deg: 0 };

/** Every bearing: the compass, each leaning triple, and each turned to the other hand. */
export const BEARINGS: readonly Bearing[] = [
  COMPASS,
  ...LEANING,
  ...LEANING.map((t): Bearing => ({ a: -t.a, b: t.b, c: t.c, deg: -t.deg })),
];

/** The unit vector along a bearing (a grid's `u` axis). */
export function bearingU(t: Bearing): { x: number; z: number } {
  return { x: t.a / t.c, z: t.b / t.c };
}

/** The unit vector across a bearing (a grid's `v` axis): `u` turned a quarter toward the east, so inland for a shore grid. */
export function bearingV(t: Bearing): { x: number; z: number } {
  return { x: t.b / t.c, z: -t.a / t.c };
}

/** The bearing closest to a line's direction (dx, dz), a line having no sense (north-east and south-west are one). */
export function nearestBearing(dx: number, dz: number): Bearing {
  let best = COMPASS;
  let bestScore = Infinity;
  for (const t of BEARINGS) {
    // |sin| of the angle between the two lines, up to the common factor of dx and dz's length.
    const score = Math.abs(t.a * dz - t.b * dx) / t.c;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** The angle between two grids in degrees, in [0, 90]: a grid has four faces, so no two are more than a quarter turn apart. */
export function gridAngle(p: Bearing, q: Bearing): number {
  let d = Math.abs(p.deg - q.deg);
  if (d > 90) d = 180 - d;
  return d;
}

/** The bearings whose angle off the compass lies in [lo, hi] degrees (either hand). */
export function bearingsBetween(lo: number, hi: number): Bearing[] {
  return BEARINGS.filter((t) => Math.abs(t.deg) >= lo && Math.abs(t.deg) <= hi);
}
