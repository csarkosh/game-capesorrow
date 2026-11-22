/**
 * The site's shore between its samples: a cubic Hermite spline through the shoreline's x at each
 * sample (monotone, Fritsch-Carlson, so it never swings past the samples either side of a headland's
 * tip), with a continuous first derivative everywhere, so the made ground's gradient stays exact.
 * Flat before the first sample and after the last, where it is the end sample's x with no slope.
 */
import type { TownSite } from "./site.js";

export type ShoreSpline = {
  readonly z0: number;
  readonly step: number;
  readonly y: readonly number[];
  /** The slope at each sample, metres of x per metre of z; 0 at both ends. */
  readonly m: readonly number[];
};

const SPLINES = new WeakMap<TownSite, ShoreSpline>();

/** The spline of a site's shore, made once for the site. */
export function shoreSplineOf(site: TownSite): ShoreSpline {
  const cached = SPLINES.get(site);
  if (cached !== undefined) return cached;
  const y = site.shoreX;
  const n = y.length;
  const m: number[] = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    const a = ((y[k] as number) - (y[k - 1] as number)) / site.step;
    const b = ((y[k + 1] as number) - (y[k] as number)) / site.step;
    // The harmonic mean of the two secants where they agree in sign, and 0 at a turning point.
    m[k] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  const spline: ShoreSpline = { z0: site.z0, step: site.step, y, m };
  SPLINES.set(site, spline);
  return spline;
}

/**
 * The shore's x in the site's frame at `zr` (metres north of the anchor), its slope in z and the slope's
 * own slope: the first derivative is continuous, the second is not at the samples.
 */
export function shoreXAt(spline: ShoreSpline, zr: number): { v: number; dz: number; dz2: number } {
  const last = spline.y.length - 1;
  const s = (zr - spline.z0) / spline.step;
  if (s <= 0) return { v: spline.y[0] as number, dz: 0, dz2: 0 };
  if (s >= last) return { v: spline.y[last] as number, dz: 0, dz2: 0 };
  const k = Math.floor(s);
  const t = s - k;
  const y0 = spline.y[k] as number;
  const y1 = spline.y[k + 1] as number;
  const m0 = spline.m[k] as number;
  const m1 = spline.m[k + 1] as number;
  const t2 = t * t;
  const t3 = t2 * t;
  const h = spline.step;
  return {
    v: (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1,
    dz: ((6 * t2 - 6 * t) * y0 + (-6 * t2 + 6 * t) * y1) / h + (3 * t2 - 4 * t + 1) * m0 + (3 * t2 - 2 * t) * m1,
    dz2: (((12 * t - 6) * y0 + (-12 * t + 6) * y1) / h + (6 * t - 4) * m0 + (6 * t - 2) * m1) / h,
  };
}
