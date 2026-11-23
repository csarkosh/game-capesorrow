/**
 * Small deterministic helpers for the street and yard drawing: a hash of several integers to [0, 1) and a smooth 1-D value noise,
 * both by integer multiplication only (`hash01`'s own way), so every machine draws the same wear. Nothing here calls a random
 * function: a thing is worn where something caused it (age, use, trees, vacancy), and the hash only says by how much.
 */
import { hash01 } from "./meshBuilder.js";

/** A hash of up to four integers (a street's id, a side, a slab's index, a salt) to [0, 1). */
export function hashN(a: number, b = 0, c = 0, d = 0): number {
  return hash01(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791), (d | 0) + 7);
}

/** The same, to [-1, 1). */
export function hashS(a: number, b = 0, c = 0, d = 0): number {
  return hashN(a, b, c, d) * 2 - 1;
}

/** Smooth 1-D value noise in [0, 1) with features about `wavelength` metres long, the key choosing the curve. */
export function vnoise(key: number, x: number, wavelength: number): number {
  const u = x / wavelength;
  const i = Math.floor(u);
  const f = u - i;
  const s = f * f * (3 - 2 * f);
  return hashN(key, i, 0, 91) * (1 - s) + hashN(key, i + 1, 0, 91) * s;
}

/** Smoothstep. */
export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
