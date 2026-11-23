/**
 * Public stairs. A street that would climb more than `STAIR_GRADE` (15 percent) between two blocks is not built as a street: where
 * the coast's own ground under its line is that steep over `STAIR_WINDOW` metres, that stretch of the right of way is a flight of
 * steps (as Astoria and Seattle have them) and the street is cut there, the flight its own `stair` street with the
 * name of the street it interrupts. Only ground the plan knows is read: the site's grid of the coast's own heights.
 */
import { dist, lerpVec, type Vec } from "../geom.js";
import { groundAt, type GroundGrid } from "../site.js";
import type { StreetKind } from "../types.js";

/** The grade over `STAIR_WINDOW` metres above which a street is a stair, and the spacing of the samples along it, metres. */
export const STAIR_GRADE = 0.15;
export const STAIR_WINDOW = 16;
export const STAIR_SAMPLE = 4;
/** A flight is at least this long, and a street left beside it at least this long (or it is dropped), metres. */
export const STAIR_LEAST = 10;
export const STAIR_STREET_LEAST = 8;

type Cuttable = { a: Vec; b: Vec; kind: StreetKind; name: string };

/** The stretches of a street (distances along it) that are steeper than a street may be. */
export function stairSpans(grid: GroundGrid, a: Vec, b: Vec): [number, number][] {
  const len = dist(a, b);
  const n = Math.max(1, Math.floor(len / STAIR_SAMPLE));
  const w = Math.max(1, Math.round(STAIR_WINDOW / (len / n)));
  const hs: number[] = [];
  for (let k = 0; k <= n; k++) {
    const p = lerpVec(a, b, k / n);
    hs.push(groundAt(grid, p.x, p.z));
  }
  const spans: [number, number][] = [];
  for (let k = 0; k + w <= n; k++) {
    const run = (w * len) / n;
    if (Math.abs((hs[k + w] as number) - (hs[k] as number)) / run <= STAIR_GRADE) continue;
    const lo = (k * len) / n;
    const hi = ((k + w) * len) / n;
    const last = spans[spans.length - 1];
    if (last !== undefined && lo <= last[1] + STAIR_SAMPLE) last[1] = Math.max(last[1], hi);
    else spans.push([lo, hi]);
  }
  return spans.filter(([lo, hi]) => hi - lo >= STAIR_LEAST);
}

/** A street cut where it is too steep: its pieces in order, each the street or a flight of steps. */
export function splitAtStairs<T extends Cuttable>(st: T, grid: GroundGrid, level: (p: Vec) => boolean = () => false): T[] {
  const len = dist(st.a, st.b);
  if (len < 1e-6) return [st];
  // Where the ground is made level (the fill behind the quay) there is no slope to climb, whatever the coast's own was under it.
  const spans = stairSpans(grid, st.a, st.b).filter(([lo, hi]) => ![lo, (lo + hi) / 2, hi].some((s) => level(lerpVec(st.a, st.b, s / len))));
  if (spans.length === 0) return [st];
  const out: T[] = [];
  let at = 0;
  const piece = (lo: number, hi: number, kind: StreetKind): void => {
    const name = kind === "stair" ? `${st.name} Stair` : st.name;
    out.push({ ...st, a: lerpVec(st.a, st.b, lo / len), b: lerpVec(st.a, st.b, hi / len), kind, name });
  };
  for (const [lo, hi] of spans) {
    if (lo - at >= STAIR_STREET_LEAST) piece(at, lo, st.kind);
    piece(lo, hi, "stair");
    at = hi;
  }
  if (len - at >= STAIR_STREET_LEAST) piece(at, len, st.kind);
  return out;
}
