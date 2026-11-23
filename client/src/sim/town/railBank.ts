/**
 * How wide the railroad's bed is, bench and bank, from what the plan knows: the bench's half width and the bank's width as it grows with how far
 * the grade line stands from the ground (`railGround.ts` lays the ground by these; the plan keeps its blocks clear of the bank by them).
 * Imports nothing of the ground, so the plan may read it.
 */
import { RAIL_BED_HALF } from "./rail.js";

/** The bench's flat shoulder beyond the ballast, metres: the bench is `RAIL_BENCH_HALF` wide each side of the centre. */
export const RAIL_SHOULDER = 0.75;
export const RAIL_BENCH_HALF = RAIL_BED_HALF + RAIL_SHOULDER;
/** The bank's width on level ground, metres. */
export const RAIL_BANK_MIN = 2;
/** The bank's metres of width for each metre the grade line stands off the land (saturating), and the most it adds. */
export const RAIL_BANK_SLOPE = 5;
export const RAIL_BANK_EXTRA = 28;

/** The bank's width where the grade line stands `m` metres off the ground, and its slope in `m`. */
export function bankWidthD(m: number): { v: number; dm: number } {
  const s = Math.sqrt(m * m + 1);
  const q = RAIL_BANK_SLOPE * (s - 1);
  const dq = (RAIL_BANK_SLOPE * m) / s;
  const L = RAIL_BANK_EXTRA;
  const den = L + q;
  return { v: RAIL_BANK_MIN + (L * q) / den, dm: ((L * L) / (den * den)) * dq };
}
