/**
 * Seeded randomness for the town plan: mulberry32 over `Math.imul`, exact on every engine, and one
 * independent stream per stage, each made by hashing the site's seed with the stage's own constant.
 * Adding a draw in one stage therefore never changes what another stage draws.
 */

export type Rng = { state: number };

/** The stages, each with its own constant. Never renumber one: add a new constant instead (and raise TOWN_GEN). */
export const STAGE = {
  history: 0x68697374,
  plats: 0x706c6174,
  streets: 0x73747265,
  lots: 0x6c6f7473,
  buildings: 0x626c6467,
  landmarks: 0x6c6e646b,
  names: 0x6e616d65,
  ends: 0x656e6473,
  roads: 0x726f6164,
  harbour: 0x68627272,
} as const;

export type Stage = keyof typeof STAGE;

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

/** A 32-bit hash of a seed and a tag (FNV-1a over two words, then a finishing mix). */
export function hashSeed(seed: number, tag: number): number {
  let h = FNV_OFFSET;
  h = Math.imul(h ^ (seed | 0), FNV_PRIME);
  h = Math.imul(h ^ (tag | 0), FNV_PRIME);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return h | 0;
}

/** The stream of one stage for one town. */
export function stageRng(townSeed: number, stage: Stage): Rng {
  return { state: hashSeed(townSeed, STAGE[stage]) };
}

/** A stream of its own for a seed (the synthetic sites use it). */
export function seededRng(seed: number): Rng {
  return { state: hashSeed(seed, 0x73656564) };
}

/** mulberry32: the next number in [0, 1). */
export function next(r: Rng): number {
  r.state = (r.state + 0x6d2b79f5) | 0;
  let t = r.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A float in [lo, hi). */
export function range(r: Rng, lo: number, hi: number): number {
  return lo + next(r) * (hi - lo);
}

/** An integer in [lo, hi], both included. */
export function int(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(next(r) * (hi - lo + 1));
}

/** True with probability p. */
export function chance(r: Rng, p: number): boolean {
  return next(r) < p;
}

/** One element of a non-empty array. */
export function pick<T>(r: Rng, items: readonly T[]): T {
  return items[Math.floor(next(r) * items.length)]!;
}

/** One of `[item, weight]` pairs, by weight. */
export function weighted<T>(r: Rng, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const it of items) total += it[1];
  let x = next(r) * total;
  for (const it of items) {
    x -= it[1];
    if (x < 0) return it[0];
  }
  return items[items.length - 1]![0];
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled<T>(r: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}
