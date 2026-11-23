/**
 * The draws the room's furniture used to take from the building's stream, and nothing else. The room is now laid out from a stream of its own
 * (`interiors.ts`), but the building's signs and everything after the room draw from the same stream and must find it where it always was:
 * a sign laid out differently would stand differently against the front, and the town's fronts have been checked against one another only
 * as the stream gave them. So the old layout's rolls are made here and thrown away, and the later draws are what they were.
 */
import { chance, int, pick, range, type Rng } from "../../rng.js";
import type { FurnishingKind, InteriorType, Trade, Vec } from "../../types.js";

const AX: Vec = { x: 1, z: 0 };
const AD: Vec = { x: 0, z: 1 };
const SKEW: readonly Vec[] = [AX, AD, { x: 0.6, z: 0.8 }, { x: 0.8, z: 0.6 }, { x: -0.6, z: 0.8 }];

export type LegacyInput = {
  readonly rng: Rng;
  readonly type: InteriorType;
  readonly trade: Trade | null;
  readonly lit: boolean;
  readonly s0: number;
  readonly s1: number;
  readonly depth: number;
  readonly ceiling: number;
  readonly doorS: number;
  readonly doorW: number;
  readonly openings: readonly { readonly s0: number; readonly s1: number }[];
};

const COOLER: readonly Trade[] = ["grocery", "convenience store", "fish market", "liquor store", "bakery"];
const RACKS: readonly Trade[] = ["clothing", "thrift store", "sporting goods", "game shop", "variety store", "video store"];
const CASES: readonly Trade[] = ["jeweler", "antiques", "pawn shop", "pharmacy"];
const CRATES: readonly Trade[] = ["hardware", "garden and feed", "thrift store", "marine supply", "bait and tackle", "auto parts", "fish market", "grocery"];

export function legacyDraws(i: LegacyInput): void {
  const { rng } = i;
  const sMin = i.s0 + 0.2;
  const sMax = i.s1 - 0.2;
  const W = sMax - sMin;
  const dz0 = i.doorS - i.doorW / 2 - 0.45;
  const dz1 = i.doorS + i.doorW / 2 + 0.45;
  const left = i.doorS - sMin;
  const right = sMax - i.doorS;
  // The side of the door with the most floor, and the other.
  const far: "left" | "right" = left < right ? "right" : "left";
  const near: "left" | "right" = far === "left" ? "right" : "left";
  const wallS = (side: "left" | "right", inset: number): number => (side === "left" ? sMin + inset : sMax - inset);
  const toward = (side: "left" | "right"): number => (side === "left" ? 1 : -1);

  const put = (...args: unknown[]): boolean => {
    void args;
    return false;
  };
  const skew = (): Vec => pick(rng, SKEW);
  // Each window's span outside the door's zone: a display beside the door never stands in it.
  const windows: { c: number; w: number }[] = [];
  for (const o of i.openings) {
    let lo = o.s0 + 0.1;
    let hi = o.s1 - 0.1;
    if ((o.s0 + o.s1) / 2 < i.doorS) hi = Math.min(hi, dz0 - 0.12);
    else lo = Math.max(lo, dz1 + 0.12);
    if (hi - lo >= 0.6) windows.push({ c: (lo + hi) / 2, w: hi - lo + 0.3 });
  }
  const trade = i.trade;
  const backD = i.depth - 0.7;

  switch (i.type) {
    case "retail aisles": {
      // The window first: what the street sees.
      const display: FurnishingKind = trade !== null && (CASES.includes(trade) || trade === "bookstore") ? "display case" : trade !== null && RACKS.includes(trade) ? "rack" : chance(rng, 0.5) ? "display case" : "table";
      for (const w of windows.slice(0, 3)) put(display, w.c, 0.65, Math.min(Math.max(0.5, w.w - 0.3), 2.2), display === "rack" ? 0.5 : 0.7, display === "table" ? 0.8 : 1.1, AX);
      put("counter", wallS(far, 0.5), 3.4, 2.4, 0.7, 1.05, AD);
      const aisle: FurnishingKind = trade !== null && RACKS.includes(trade) ? "rack" : "shelf run";
      // A run of shelving is broken by cross-aisles every 4 metres, as real ones are.
      const run = (kind: FurnishingKind, s: number, d0: number, d1: number, sd: number, h: number): void => {
        for (let d = d0; d + 1.5 <= d1; d += 4.9) put(kind, s, (d + Math.min(d + 4, d1)) / 2, Math.min(4, d1 - d), sd, h, AD);
      };
      if (W >= 4) run("shelf run", wallS(near, 0.35), 3.2, i.depth - 1.2, 0.45, 1.9);
      const n = Math.min(W > 18 ? 9 : 5, Math.floor((W - 2.2) / 2.2));
      for (let k = 0; k < n; k++) {
        const s = sMin + 1.8 + k * 2.2;
        if (aisle === "rack") for (let d = 3.5; d < i.depth - 1; d += 2.4) put("rack", s, d, 1.4, 0.5, 1.6, AX);
        else run("shelf run", s, 4.2, i.depth - 1.2, 0.55, 1.6);
      }
      if (trade !== null && COOLER.includes(trade)) put("cooler", (sMin + sMax) / 2, i.depth - 0.65, Math.min(W - 1, 5), 0.8, 2, AX);
      if (trade !== null && CASES.includes(trade)) {
        put("display case", wallS(far, 0.5), 5.6, 1.6, 0.6, 1.1, AD);
        put("display case", wallS(near, 0.5), 3.2, 1.6, 0.6, 1.1, AD);
      }
      if (trade !== null && CRATES.includes(trade)) put("stacked crates", wallS(far, 0.6), 4.6, 0.9, 0.9, 1.1, skew());
      if (trade === "pharmacy" || trade === "bookstore") put("counter", (sMin + sMax) / 2, i.depth - 0.9, Math.min(W - 1.4, 3.6), 0.7, 1.05, AX);
      break;
    }
    case "counter service": {
      const L = Math.max(2, Math.min(i.depth - 4.5, 6));
      put("counter", wallS(far, 0.65), 2.8 + L / 2, 0.7, L, 1.05, AD);
      put("stool row", wallS(far, 0.65) + toward(far) * 0.85, 2.8 + L / 2, 0.45, L - 0.4, 0.75, AD);
      for (const w of windows.slice(0, 3)) {
        if (w.w >= 1.7) put("booth", w.c, 0.9, 1.6, 0.95, 1.2, AX);
        else put("table", w.c, 0.9, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.7, 0.75, AX);
      }
      const tn = int(rng, 1, 4);
      for (let k = 0; k < tn; k++) put("table", sMin + 1.4 + (k % 2) * 1.9 + (chance(rng, 0.5) ? 0.2 : 0), 4.4 + Math.floor(k / 2) * 2.1, 0.8, 0.8, 0.75, skew());
      put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1.2, 4.5), 0.8, 1.05, AX);
      put("display case", wallS(near, 0.5), 3.4, 1.5, 0.6, 1.2, AD);
      if (trade === "post office") {
        put("rack", (sMin + sMax) / 2, i.depth - 0.4, Math.min(W - 1, 3), 0.4, 2, AX);
        put("bench", wallS(near, 0.4), 3.6, 1.6, 0.4, 0.45, AD);
        put("desk", wallS(near, 0.9), 6, 1.4, 0.7, 0.75, AX);
      }
      break;
    }
    case "dining room": {
      for (const w of windows.slice(0, 3)) put("table", w.c, 0.95, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.8, 0.75, AX);
      put("desk", wallS(near, 0.6), 2.9, 0.6, 0.5, 1.1, AX);
      for (let d = 3.4; d < i.depth - 1; d += 2.1) put("booth", wallS(far, 0.55), d, 1.9, 0.95, 1.2, AD);
      for (let ds = 0; ds < 4; ds++) for (let ss = 0; ss < 3; ss++) put("table", sMin + 1.1 + 1.7 + ss * 2.1, 3.4 + ds * 2.3, 0.85, 0.85, 0.75, chance(rng, 0.25) ? skew() : AX);
      put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1, 4), 0.8, 1.05, AX);
      break;
    }
    case "bar": {
      const L = Math.max(2.5, Math.min(i.depth - 4, 9));
      put("counter", wallS(far, 0.95), 3 + L / 2, 0.7, L, 1.1, AD);
      put("shelf run", wallS(far, 0.2), 3 + L / 2, 0.35, L, 1.9, AD);
      put("stool row", wallS(far, 1.55), 3 + L / 2, 0.4, L - 0.4, 0.75, AD);
      for (const w of windows.slice(0, 2)) put("table", w.c, 0.95, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.8, 0.75, AX);
      if (W >= 4.5) put("pool table", (sMin + sMax) / 2 + toward(near) * 0.2, i.depth - 3, 2.6, 1.4, 0.85, chance(rng, 0.4) ? { x: 0.8, z: 0.6 } : AX);
      for (let d = 3.6, k = 0; k < 3; d += 2.2, k++) put("booth", wallS(near, 0.55), d, 1.9, 0.95, 1.2, AD);
      put("table", (sMin + sMax) / 2, 6.2, 0.8, 0.8, 0.75, skew());
      break;
    }
    case "office": {
      for (const w of windows.slice(0, 2)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      const personal = trade === "hair salon" || trade === "barber" || trade === "tattoo parlor";
      if (personal) {
        for (let d = 3.4, k = 0; k < 3; d += 1.8, k++) put("counter", wallS(far, 0.5), d, 1.4, 0.5, 0.9, AD);
        put("rack", wallS(near, 0.4), 3.6, 1.2, 0.4, 1.7, AD);
        put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1.2, 2.4), 0.7, 1.0, AX);
      } else if (trade === "bank" || trade === "credit union") {
        put("counter", (sMin + sMax) / 2, 4.4, Math.max(2, W - 2.6), 0.7, 1.1, AX);
        put("desk", wallS(far, 1.1), 7, 1.6, 0.8, 0.75, AX);
        put("desk", wallS(near, 1.1), 8.4, 1.6, 0.8, 0.75, skew());
        put("rack", (sMin + sMax) / 2, i.depth - 0.4, Math.min(W - 1, 2.4), 0.5, 1.8, AX);
      } else if (trade === "union hall") {
        put("table", (sMin + sMax) / 2, 5, 2.6, 0.9, 0.75, AX);
        put("table", (sMin + sMax) / 2, 7.6, 2.6, 0.9, 0.75, AX);
        for (let k = 0; k < 4; k++) put("bench", sMin + 1 + k * 1.1, 9.6, 1, 0.4, 0.45, AX);
        put("desk", wallS(far, 0.8), 3.4, 1.4, 0.7, 0.75, AX);
        put("rack", wallS(near, 0.3), 5, 1, 0.4, 1.8, AD);
      } else {
        put("counter", wallS(far, 0.7), 3.2, 1.8, 0.6, 1.05, AX);
        const dn = int(rng, 2, 4);
        for (let k = 0; k < dn; k++) put("desk", sMin + 1.3 + (k % 2) * 2.6, 5 + Math.floor(k / 2) * 2.4, 1.6, 0.8, 0.75, chance(rng, 0.3) ? skew() : AX);
        put("rack", sMin + 0.8, i.depth - 0.4, 1.0, 0.5, 1.8, AX);
        put("rack", sMax - 0.8, i.depth - 0.4, 1.0, 0.5, 1.8, AX);
      }
      break;
    }
    case "laundromat": {
      const L = Math.max(2, Math.min(i.depth - 3.4, 7.5));
      put("washer row", sMin + 0.6, 3 + L / 2, 0.9, L, 1.1, AD);
      if (W >= 5.5) put("washer row", sMax - 0.6, 3 + L / 2, 0.9, L, 1.1, AD);
      if (W >= 8) put("washer row", (sMin + sMax) / 2, 3.4 + (L - 1) / 2, 1, L - 1, 1.1, AD);
      for (const w of windows.slice(0, 1)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      put("table", (sMin + sMax) / 2 + toward(near) * 0.6, i.depth - 1.4, 1.8, 0.9, 0.9, AX);
      put("counter", wallS(far, 0.6), 2.9, 1.6, 0.6, 1.05, AX);
      break;
    }
    case "workshop": {
      const nl = W >= 8.5 ? 2 : 1;
      for (let k = 0; k < nl; k++) put("lift", sMin + W * ((k + 1) / (nl + 1)), i.depth / 2 + 0.6, 1.2, 4.4, 2, AD);
      put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1.4, 5), 0.7, 0.95, AX);
      put("rack", wallS(far, 0.4), 4, 1.2, 0.5, 1.8, AD);
      put("shelf run", wallS(near, 0.3), 5, 4, 0.45, 1.9, AD);
      put("stacked crates", wallS(far, 0.7), i.depth - 2, 0.9, 0.9, 1.3, skew());
      put("table", sMin + 1.1, 3.5, 1.2, 0.8, 0.9, skew());
      break;
    }
    case "lobby": {
      put("desk", wallS(far, 0.9), 3.4, 2.2, 0.8, 1.1, AX);
      for (const w of windows.slice(0, 2)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      put("rack", wallS(near, 0.3), 4, 1, 0.4, 1.7, AD);
      for (let k = 0; k < 3; k++) put("bench", sMin + 1.2 + k * 1.6, 7 + (k % 2) * 0.3, 1.4, 0.45, 0.45, AX);
      put("table", (sMin + sMax) / 2, 5.2, 1, 0.8, 0.5, skew());
      if (trade === "movie theater") {
        put("display case", wallS(near, 0.6), 3.4, 1.8, 0.6, 1.1, AD);
        put("counter", wallS(far, 0.6), 5.4, 2.2, 0.7, 1.1, AD);
      }
      break;
    }
    default: {
      // Empty: what the last tenant left behind.
      const w = windows.length > 0 ? windows[windows.length - 1]!.c : (sMin + sMax) / 2;
      put("ladder", w, i.depth - 0.3, 0.5, 0.12, 2.4, AX);
      put("paint cans", w + 0.9, i.depth - 0.5, 0.5, 0.5, 0.35, skew());
      put("paint cans", w + 1.5, i.depth - 0.8, 0.4, 0.4, 0.35, AX);
      put("stacked crates", wallS(near, 0.6), 4.6, 0.9, 0.9, 1.2, skew());
      put("stacked crates", wallS(far, 0.6), 6.2, 1.0, 0.9, 0.8, skew());
      if (chance(rng, 0.7)) put("shelf run", wallS(far, 0.3), 3.2 + (i.depth - 4.4) / 2, i.depth - 4.4, 0.45, 1.8, AD);
      if (chance(rng, 0.5)) put("counter", (sMin + sMax) / 2, i.depth * 0.55, Math.min(W - 1.6, 3), 0.7, 1.05, AX);
      put("paint cans", sMin + 0.7, 3.2, 0.5, 0.5, 0.35, AX);
      break;
    }
  }
  // Light fixtures: a grid over the floor, and a neon sign in a bar's window.
  if (i.type === "bar" && windows.length > 0) range(rng, 1.7, 2.1);
}
