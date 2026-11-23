/**
 * The bays of a building's street front: how many, how wide, where each door is and where its windows run.
 *
 * WHAT CAUSES EACH VARIATION. Widths are cut from the building's own stream: a 15 m lot that was two 25 ft lots once becomes a
 * 5 m barber and a 10 m shop, a 9 m one stays whole. A door is where the unit's plan put it: an old shop has a recessed entry (centred
 * on its bay, a third in, or at the corner), a postwar one a flush door at an end; a building of two storeys or more has a narrow
 * street door at one end for the stairs, which takes that end's frontage. Window runs fill what the doors leave, between piers
 * of different widths, so no two bays share a rhythm. A building's era sets its sill and head (a bulkhead and a transom before 1920,
 * glass nearly to the floor after 1960), so the boards over two neighbours' windows hang at different heights; and about half of
 * the buildings of before 1960 had one change made since (`remodel`): an opening widened over the pier, one bricked in, the fascia
 * dropped over the transom, a flush door in place of the recess.
 */
import { chance, int, next, range, weighted, type Rng } from "../../rng.js";
import type { Opening, Unit } from "../../types.js";
import { SIZING } from "../sizing.js";
import { dec, r1, r2 } from "./ctx.js";

/** The narrowest bay (an espresso stand's), and the width of the stair strip at an end. */
export const MIN_BAY = 3.6;
export const STAIR_STRIP = 1.4;

export type Geo = {
  s0: number;
  s1: number;
  door: Unit["door"];
  openings: Opening[];
  fascia: number;
  remodel: Unit["remodel"];
};

/** The boundaries of `n` bays across `total` metres, none narrower than `minW`: `[0, c1, ..., total]`. */
export function cutFront(rng: Rng, total: number, n: number, minW: number): number[] {
  if (n <= 1) return [0, total];
  for (let attempt = 0; attempt < 40; attempt++) {
    const pts: number[] = [];
    for (let i = 0; i < n - 1; i++) pts.push(r1(range(rng, minW, total - minW)));
    pts.sort((p, q) => p - q);
    const all = [0, ...pts, total];
    let ok = true;
    for (let i = 1; i < all.length; i++) if (all[i]! - all[i - 1]! < minW) ok = false;
    if (ok) return all;
  }
  const out = [0];
  for (let i = 1; i < n; i++) out.push(r1((total * i) / n));
  out.push(total);
  return out;
}

/** The bays' count for a building front `W` metres wide: older and narrower fronts stay whole, wide ones were split among several shops. */
export function bayCount(rng: Rng, kind: string, district: string, W: number): number {
  if (kind === "storefront" && district === "highway strip") {
    // A strip of shops under one roof: a bay every 6 to 12 m.
    if (W >= 30) return Math.max(2, Math.min(SIZING.STRIP_BAYS_MAX, int(rng, Math.floor(W / 14), Math.floor(W / 8))));
    if (W >= 18) return int(rng, 2, 3);
    return 1;
  }
  if (kind === "storefront" || kind === "office") {
    if (W < 9.2) return 1;
    if (W < 12) return chance(rng, 0.35) ? 2 : 1;
    return weighted(rng, [[1, 3], [2, 5], [3, 2]] as const);
  }
  if (kind === "lodge hall") return W >= 13 ? 2 : 1;
  if (kind === "hotel") return W >= 14 && chance(rng, 0.7) ? 2 : 1;
  return 1;
}

/** Heights of the glass and the board over it, from the front's age. */
function heights(rng: Rng, era: number): { sill: number; head: number; fascia: number } {
  if (era < 1920) {
    const head = r2(range(rng, 2.7, 3.1));
    return { sill: r2(range(rng, 0.55, 0.85)), head, fascia: r2(head + range(rng, 0.3, 0.5)) };
  }
  if (era < 1960) {
    const head = r2(range(rng, 2.5, 2.8));
    return { sill: r2(range(rng, 0.4, 0.6)), head, fascia: r2(head + range(rng, 0.2, 0.35)) };
  }
  const head = r2(range(rng, 2.3, 2.5));
  return { sill: r2(range(rng, 0.7, 0.9)), head, fascia: r2(head + range(rng, 0.25, 0.5)) };
}

/**
 * The door, the openings and the fascia of one bay. `a` and `b` are the stretch of its frontage a door and windows may use (the bay
 * less a stair strip at an end), `wide` asks for a double door (a big shop), and `era` is the front's.
 */
export function bayGeo(rng: Rng, s0: number, s1: number, a: number, b: number, era: number, wide: boolean): Geo {
  const w = b - a;
  const doorW = r2(Math.min(wide ? 1.8 : range(rng, 0.95, 1.1), Math.max(0.9, w - 1.4)));
  const old = era < 1940;
  const place = weighted(rng, old ? ([["centre", 3], ["third", 3], ["corner", 2]] as const) : ([["end", 5], ["centre", 2], ["third", 2]] as const));
  const lo = a + doorW / 2 + 0.2;
  const hi = b - doorW / 2 - 0.2;
  let s: number;
  const left = next(rng) < 0.5;
  if (place === "centre") s = a + w * range(rng, 0.42, 0.58);
  else if (place === "third") s = a + w * (left ? range(rng, 0.2, 0.33) : range(rng, 0.67, 0.8));
  else s = left ? lo : hi;
  s = r2(Math.max(lo, Math.min(hi, s)));
  const recess = old && chance(rng, 0.7) ? r2(range(rng, 0.9, 1.4)) : 0;
  const h = heights(rng, era);

  // Windows fill what the door leaves, each run between piers of its own widths.
  const openings: Opening[] = [];
  const run = (x0: number, x1: number): void => {
    const L = x1 - x0;
    if (L < 0.9) return;
    const panes = L > 7.2 ? 3 : L > 3.6 ? 2 : 1;
    const pier = range(rng, 0.35, 0.85);
    const inner = L - 2 * pier;
    if (inner < 0.5) return;
    const gap = panes > 1 ? 0.25 : 0;
    const pw = (inner - gap * (panes - 1)) / panes;
    for (let i = 0; i < panes; i++) {
      const o0 = x0 + pier + i * (pw + gap);
      openings.push({ s0: r2(o0), s1: r2(o0 + pw), sill: h.sill, head: h.head, cover: "none", widened: false });
    }
  };
  run(a + 0.1, s - doorW / 2 - 0.1);
  run(s + doorW / 2 + 0.1, b - 0.1);

  let fascia = h.fascia;
  let remodel: Unit["remodel"] = null;
  const door = { s, width: doorW, recess };
  if (era < 1960 ? chance(rng, 0.5) : chance(rng, 0.2)) {
    const span = Math.max(0, Math.floor((2010 - era - 10) / 10));
    const decade = Math.min(2010, dec(era) + 10 + int(rng, 0, span) * 10);
    const what = weighted(rng, [["widened window", 4], ["bricked window", era < 1960 ? 2 : 0], ["dropped fascia", 3], ["new door", recess > 0 ? 3 : 0]] as const);
    if (what === "widened window" && openings.length > 0) {
      // The second tenant cut the pier away on the side of the door: the opening nearest it is wider than its neighbours.
      let k = 0;
      let bestD = 1e9;
      for (let i = 0; i < openings.length; i++) {
        const d = Math.abs((openings[i]!.s0 + openings[i]!.s1) / 2 - s);
        if (d < bestD) {
          bestD = d;
          k = i;
        }
      }
      const o = openings[k]!;
      const towards = (o.s0 + o.s1) / 2 < s ? 1 : -1;
      const grow = r2(range(rng, 0.35, 0.7));
      openings[k] = towards > 0 ? { ...o, s1: r2(Math.min(s - doorW / 2 - 0.1, o.s1 + grow)), sill: r2(Math.max(0.3, o.sill - 0.3)), widened: true } : { ...o, s0: r2(Math.max(s + doorW / 2 + 0.1, o.s0 - grow)), sill: r2(Math.max(0.3, o.sill - 0.3)), widened: true };
      remodel = { decade, what };
    } else if (what === "bricked window" && openings.length > 1) {
      remodel = { decade, what };
    } else if (what === "dropped fascia") {
      // A slipcover over the transom: the board is lower and the glass shorter than the building's age says.
      fascia = r2(range(rng, 2.65, 2.95));
      for (let i = 0; i < openings.length; i++) openings[i] = { ...openings[i]!, head: Math.min(openings[i]!.head, 2.4) };
      remodel = { decade, what };
    } else if (what === "new door") {
      door.recess = 0;
      remodel = { decade, what };
    }
  }
  return { s0, s1, door, openings, fascia, remodel };
}
