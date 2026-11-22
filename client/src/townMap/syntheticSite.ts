/**
 * A synthetic town site, for looking at plans and testing them without a world behind them: a wavy
 * shoreline with a cove at z = 0 and a gently bending highway, from plain arithmetic and a seed.
 * Not simulation code and not part of the game; it only has to be deterministic, and it uses no
 * trigonometry so that a site is the same on every machine too.
 *
 * The coast's trend (the angle of its general line off north) is drawn from the seed, so that towns
 * on different seeds face different shores, as the coast's towns do.
 */
import { hashSeed, next, seededRng } from "../sim/town/rng.js";
import type { TownSite } from "../sim/town/site.js";

/** Smooth 1-D value noise in [-1, 1] on a lattice of the given wavelength, from a seed. */
function smoothNoise(seed: number, z: number, wavelength: number): number {
  const f = z / wavelength;
  const i = Math.floor(f);
  const t = f - i;
  const s = t * t * (3 - 2 * t);
  const a = hashSeed(seed, i) >>> 0;
  const b = hashSeed(seed, i + 1) >>> 0;
  return ((a + (b - a) * s) / 4294967296) * 2 - 1;
}

/** z, straight through the harbour and levelling off beyond 300 m, so that a steep coast does not run into the highway. */
function tilt(z: number): number {
  const a = Math.abs(z);
  if (a <= 300) return z;
  const w = a - 300;
  const t = 300 + (100 * w) / (w + 100);
  return z < 0 ? -t : t;
}

export type SyntheticOptions = {
  /** Force the coast's trend, dx/dz (about -0.8 to 0.8). */
  readonly trend?: number;
};

/** The site for a seed. */
export function syntheticSite(seed: number, options: SyntheticOptions = {}): TownSite {
  const r = seededRng(seed);
  const step = 25;
  const n = 49;
  const z0 = -600;
  const distance = 420 + next(r) * 220; // shoreline's distance from the highway away from the cove
  const trend = options.trend ?? (next(r) * 2 - 1) * 0.8;
  const coveDepth = 50 + next(r) * 40;
  const coveWidth = 150 + next(r) * 80;
  const waveAmp = 8 + next(r) * 14;
  const bendAmp = 12 + next(r) * 24;
  const roadTrend = (next(r) * 2 - 1) * 0.06;
  const inland = 600 + Math.floor(next(r) * 200);
  const waveSeed = hashSeed(seed, 1);
  const bendSeed = hashSeed(seed, 2);

  const shoreX: number[] = [];
  const roadX: number[] = [];
  const road0 = bendAmp * smoothNoise(bendSeed, 0, 700);
  for (let i = 0; i < n; i++) {
    const z = z0 + i * step;
    const t = Math.abs(z) / coveWidth;
    const bump = t < 1 ? (1 - t * t) * (1 - t * t) : 0;
    const x = -distance + trend * tilt(z) + coveDepth * bump + waveAmp * (smoothNoise(waveSeed, z, 260) * 0.7 + smoothNoise(waveSeed + 1, z, 110) * 0.3);
    shoreX.push(Math.min(-60, Math.round(x * 10) / 10));
    const rx = bendAmp * smoothNoise(bendSeed, z, 700) - road0 + roadTrend * z;
    roadX.push(Math.round(rx * 10) / 10);
  }
  return { seed: hashSeed(seed, 0x7369746), anchor: { x: 0, z: 0 }, step, z0, shoreX, roadX, inland };
}
