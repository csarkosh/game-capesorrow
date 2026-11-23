/**
 * The room behind a unit's front: furniture placed so that it reads, full, from the sidewalk through the glass.
 *
 * WHAT CAUSES THE LAYOUT. The trade's kind of room (`InteriorType`) and the unit's own record (a hash of it, `sig`; the year it opened and
 * the year it was remodelled) decide what stands where. The room ends at a back partition whose depth fits the trade (a cafe or diner 7 to
 * 11 m, a shop 10 to 16 m, an office 6 to 9 m: `partitionDepth`, from the unit's own hash, so no two units share one); a jog (an L of
 * partition) or a half wall breaks it in some. Something stands in each window (a display, a booth, a bench), because that is what the
 * street sees; the counter or the bar is on the side of the door with the most floor, so the clerk sees the door; tables stand in rows
 * with a table gone here and two pushed together there; aisles of shelving run from near the front to the partition with an endcap at
 * each head, checkout lanes by the door; desks in an office, racks in a clothing shop, bins in a hardware store. A table or a desk here
 * and there is turned on a skew (a 3-4-5 bearing), as furniture is. Nothing stands in the door's zone (the door's width and 0.45 m either
 * side, 2.4 m deep). A vacant unit holds what the last tenant left: a ladder, paint cans, crates, a dust sheet, a stretch of shelving.
 *
 * The plan carries the anchors only. What stands round and on them (chairs round a table, what is on a counter, the stock on a shelf)
 * is drawn from a hash of the unit and the furnishing (`roomFill.ts`), the same on every machine.
 */
import { chance, int, pick, range, type Rng } from "../../rng.js";
import type { Furnishing, FurnishingKind, InteriorType, RoomLight, Trade, Vec } from "../../types.js";
import { r2 } from "./ctx.js";

const AX: Vec = { x: 1, z: 0 };
const AD: Vec = { x: 0, z: 1 };
const SKEW: readonly Vec[] = [AX, AD, { x: 0.6, z: 0.8 }, { x: 0.8, z: 0.6 }, { x: -0.6, z: 0.8 }];
const MAX_THINGS = 80;

export type RoomInput = {
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
  /** A hash of the unit (its building, its place in it, its tenant's name). */
  readonly sig: number;
  /** The year the tenant opened and the year of the unit's last remodel (0 for none): how old the fittings are. */
  readonly opened: number;
  readonly remodel: number;
};

export type Room = { furnishings: Furnishing[]; lights: RoomLight[] };

/** A number in [0, 1) from a hash and a salt (integer arithmetic only). */
function h01(sig: number, salt: number): number {
  let h = Math.imul((sig | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A hash of a name (its letters, in integer arithmetic). */
export function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 0x01000193);
  return h | 0;
}

/** The back partition's depth range by the kind of room, in metres. */
const DEPTHS: Record<InteriorType, readonly [number, number]> = {
  "counter service": [7, 11], "dining room": [7.5, 11], bar: [8, 13], "retail aisles": [10, 16], office: [6, 9], lobby: [6, 9], laundromat: [8, 12], workshop: [10, 16], empty: [8, 14],
};

/** Where the back partition stands: a depth in its trade's range from a hash of the unit, and never deeper than the building's room. */
export function partitionDepth(type: InteriorType, sig: number, roomDepth: number): number {
  const [lo, hi] = DEPTHS[type];
  return r2(Math.min(roomDepth, lo + (hi - lo) * h01(sig, 1)));
}

const COOLER: readonly Trade[] = ["grocery", "convenience store", "fish market", "liquor store", "bakery"];
const RACKS: readonly Trade[] = ["clothing", "thrift store", "sporting goods", "game shop", "variety store", "video store"];
const CASES: readonly Trade[] = ["jeweler", "antiques", "pawn shop", "pharmacy"];
const CRATES: readonly Trade[] = ["hardware", "garden and feed", "thrift store", "marine supply", "bait and tackle", "auto parts", "fish market", "grocery"];
const BINS: readonly Trade[] = ["hardware", "garden and feed", "marine supply", "bait and tackle", "auto parts", "sporting goods"];
const FOOD: readonly Trade[] = ["cafe", "diner", "restaurant", "bakery", "espresso stand", "pizza and burgers"];

export function furnish(i: RoomInput): Room {
  const { rng } = i;
  const hs = (k: number): number => h01(i.sig, k);
  const sMin = i.s0 + 0.2;
  const sMax = i.s1 - 0.2;
  const dMin = 0.25;
  const D = i.depth;
  const W = sMax - sMin;
  const dz0 = i.doorS - i.doorW / 2 - 0.45;
  const dz1 = i.doorS + i.doorW / 2 + 0.45;
  const boxes: { f: Furnishing; x0: number; x1: number; z0: number; z1: number }[] = [];
  const left = i.doorS - sMin;
  const right = sMax - i.doorS;
  // The side of the door with the most floor, and the other.
  const far: "left" | "right" = left < right ? "right" : "left";
  const near: "left" | "right" = far === "left" ? "right" : "left";
  const wallS = (side: "left" | "right", inset: number): number => (side === "left" ? sMin + inset : sMax - inset);
  const toward = (side: "left" | "right"): number => (side === "left" ? 1 : -1);
  const trade = i.trade;
  const young = Math.max(i.opened, i.remodel) >= 1990;
  const old = i.opened > 0 && i.opened < 1970;

  const place = (kind: FurnishingKind, cs: number, cd: number, sx: number, sd: number, h: number, dir: Vec, ex: number, ez: number, edge: boolean): boolean => {
    if (boxes.length >= MAX_THINGS) return false;
    if (!edge && (cs - ex < sMin || cs + ex > sMax || cd - ez < dMin || cd + ez > D - 0.2)) return false;
    if (!edge && cs + ex > dz0 && cs - ex < dz1 && cd - ez < 2.4) return false;
    // Two things never touch or overlap: a 2 cm gap at least, so that no two faces of one height meet edge to edge.
    for (const o of boxes) if (cs - ex < o.x1 + 0.02 && cs + ex > o.x0 - 0.02 && cd - ez < o.z1 + 0.02 && cd + ez > o.z0 - 0.02) return false;
    boxes.push({ f: { kind, s: r2(cs), d: r2(cd), sx: r2(sx), sd: r2(sd), h: r2(h), dir }, x0: cs - ex, x1: cs + ex, z0: cd - ez, z1: cd + ez });
    return true;
  };
  const put = (kind: FurnishingKind, cs: number, cd: number, sx: number, sd: number, h: number, dir: Vec = AX): boolean => {
    const ex = (Math.abs(dir.x) * sx + Math.abs(dir.z) * sd) / 2;
    const ez = (Math.abs(dir.z) * sx + Math.abs(dir.x) * sd) / 2;
    return place(kind, cs, cd, sx, sd, h, dir, ex, ez, false);
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
  const backD = D - 0.7;
  const full = i.type !== "empty";

  // ---- The back partition: a jog (an L of partition standing out from one end of the back wall) or, in a room that serves food, a half wall.
  // `blocked` is the stretch of floor in front of it that nothing else takes.
  const ceilTop = i.ceiling - 0.04;
  const pm = hs(11);
  // A room with a long counter along its far wall keeps that wall clear to the partition: its jog is on the near side.
  const jogSide: "left" | "right" = i.type === "bar" || i.type === "counter service" || i.type === "dining room" || hs(12) < 0.5 ? near : far;
  const jogW = 1.6 + hs(13) * 1.6;
  const jogJ = 1.3 + hs(14) * 0.9;
  if (W >= 4.2 && D >= 6 && pm < 0.5 && i.type !== "laundromat") {
    const outer = jogSide === "left" ? i.s0 + 0.04 : i.s1 - 0.04;
    const sc = outer + toward(jogSide) * (jogW / 2);
    // The face of the partition that stands out (parallel to the back wall) and its return to the wall.
    place("partition", sc, D - jogJ + 0.075, jogW, 0.15, ceilTop, AX, jogW / 2, 0.075, true);
    const innerS = outer + toward(jogSide) * (jogW - 0.075);
    // The return stops 2 cm short of the face and stands 3 cm lower: two boxes of one height meeting edge to edge would lay two faces in one plane.
    place("partition", innerS, D - 0.01 - (jogJ - 0.18) / 2, jogJ - 0.18, 0.15, ceilTop - 0.03, AD, 0.075, (jogJ - 0.18) / 2, true);
  } else if (W >= 5 && D >= 6.5 && pm < 0.85 && (trade !== null && (FOOD.includes(trade) || i.type === "bar"))) {
    const len = Math.min(W - 2.4, 2 + hs(15) * 2.2);
    const sc = wallS(jogSide, 0.1 + len / 2);
    place("partition", sc, D - 1.55, len, 0.12, 1.1, AX, len / 2, 0.06, true);
  }
  const jogged = boxes.length > 0;

  switch (i.type) {
    case "retail aisles": {
      const grocery = trade === "grocery" || trade === "convenience store";
      // The window first: what the street sees.
      const display: FurnishingKind = grocery ? "bin" : trade !== null && BINS.includes(trade) ? "bin" : trade !== null && (CASES.includes(trade) || trade === "bookstore") ? "display case" : trade !== null && RACKS.includes(trade) ? "rack" : chance(rng, 0.5) ? "display case" : "table";
      for (const w of windows.slice(0, 3)) {
        if (display === "bin") put("bin", w.c, 0.85, Math.min(Math.max(0.6, w.w - 0.4), 1.4), 0.7, 0.9, AX);
        else put(display, w.c, 0.65, Math.min(Math.max(0.5, w.w - 0.3), 2.2), display === "rack" ? 0.5 : 0.7, display === "table" ? 0.8 : 1.1, AX);
      }
      // The checkout lanes by the door (a grocery's) or the till counter (any other shop's).
      if (grocery) {
        const lanes = W >= 9 ? 2 : 1;
        for (let k = 0; k < lanes; k++) put("checkout", wallS(near, 0.6 + k * 1.5), 2.2, 1.9, 0.8, 0.95, AD);
        put("cart", wallS(far, 0.6), 1.6, 1.3, 0.6, 1, AD);
      } else if (trade !== null && BINS.includes(trade)) put("counter", wallS(near, 0.5), 2.2, 1.6, 0.6, 1.05, AD);
      else put("counter", wallS(far, 0.5), 3.4, 2.4, 0.7, 1.05, AD);
      const aisle: FurnishingKind = trade !== null && RACKS.includes(trade) ? "rack" : "shelf run";
      const endZ = D - 1.6;
      // A run of shelving is broken by cross-aisles every 4 metres, as real ones are; each aisle has an endcap at its head.
      const run = (kind: FurnishingKind, s: number, d0: number, d1: number, sd: number, h: number, head: boolean): void => {
        for (let d = d0; d + 1.5 <= d1; d += 4.9) {
          put(kind, s, (d + Math.min(d + 4, d1)) / 2, Math.min(4, d1 - d), sd, h, AD);
          if (head && d === d0 && grocery) put("endcap", s, d - 0.42, 1.0, 0.6, 1.4, AX);
        }
      };
      if (W >= 4) run("shelf run", wallS(near, 0.35), 3.6, endZ, 0.45, 1.9, false);
      const n = Math.min(W > 18 ? 9 : 6, Math.floor((W - 2.2) / 2.2));
      for (let k = 0; k < n; k++) {
        const s = sMin + 1.8 + k * 2.2;
        if (aisle === "rack") {
          for (let d = 3.5; d < endZ; d += 2.2) put("rack", s, d, 1.4, 0.5, 1.6, hs(20 + k) < 0.3 ? skew() : AX);
        } else if (trade !== null && BINS.includes(trade) && k % 2 === 1) {
          for (let d = 3.6; d < endZ - 0.4; d += 1.1) put("bin", s, d, 0.8, 0.7, 0.85, AX);
        } else run("shelf run", s, 3.6, endZ, 0.55, 1.6, true);
      }
      if (trade !== null && RACKS.includes(trade)) {
        put("table", wallS(far, 0.9), 3.6, 1.3, 0.8, 0.8, AX);
        put("table", (sMin + sMax) / 2, 5.1, 1.2, 0.8, 0.8, skew());
      }
      if (trade !== null && COOLER.includes(trade)) put("cooler", (sMin + sMax) / 2, D - 0.65, Math.min(W - 1, 5), 0.8, 2, AX);
      if (trade !== null && CASES.includes(trade)) {
        put("display case", wallS(far, 0.5), 5.6, 1.6, 0.6, 1.1, AD);
        put("display case", wallS(near, 0.5), 3.2, 1.6, 0.6, 1.1, AD);
      }
      if (trade !== null && CRATES.includes(trade)) {
        put("stacked crates", wallS(far, 0.6), 4.6, 0.9, 0.9, 1.1, skew());
        put("stacked crates", wallS(near, 0.6), D - 1.2, 0.9, 0.9, 1.3, skew());
      }
      if (trade === "pharmacy" || trade === "bookstore") put("counter", (sMin + sMax) / 2, D - 0.9, Math.min(W - 1.4, 3.6), 0.7, 1.05, AX);
      put("plant", wallS(near, 0.35), 1.2, 0.4, 0.4, 1.0, AX);
      break;
    }
    case "counter service": {
      const L = Math.max(2, Math.min(D - 4.4, 6));
      const chrome = old && trade === "diner";
      const counterD = 2.8 + L / 2;
      put("counter", wallS(far, 0.65), counterD, chrome ? Math.min(D - 3.9, 7) : L, 0.7, 1.05, AD);
      put("stool row", wallS(far, 0.65) + toward(far) * 0.85, counterD, L - 0.4, 0.45, 0.75, AD);
      const exclEnd = counterD + L / 2 + 0.7;
      for (const w of windows.slice(0, 3)) {
        if (w.w >= 1.9) put("booth", w.c, 1.2, 1.6, 1.7, 1.1, AX);
        else put("table", w.c, 1.35, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.7, 0.75, AX);
      }
      put("counter", (sMin + sMax) / 2 + toward(far) * 0.2, backD, Math.min(W - 1.2, 4.5), 0.8, 1.05, AX);
      put("cart", wallS(near, 0.5), D - 1.7, 0.9, 0.6, 1, AX);
      if (trade === "post office") {
        put("rack", (sMin + sMax) / 2, D - 0.4, Math.min(W - 1, 3), 0.4, 2, AX);
        put("bench", wallS(near, 0.4), 3.6, 1.6, 0.4, 0.45, AD);
        put("desk", wallS(near, 0.9), 6, 1.4, 0.7, 0.75, AX);
      } else {
        if (W >= 6 && W < 24) put("bench", wallS(near, 0.3), 2.8, 1.5, 0.4, 0.45, AD);
        if (young && W >= 6.5 && hs(30) < 0.8) {
          put("couch", wallS(near, 0.55), 4.9, 1.9, 0.85, 0.85, AD);
          put("table", wallS(near, 1.55), 4.9, 0.7, 0.5, 0.45, AD);
        }
        put("plant", wallS(near, 0.35), 1.2, 0.4, 0.4, 1.0, AX);
      }
      tablesFill(sMin, sMax, 3.3, D - 2.1, 2.1, 1.8, (d, sa, sb) => (d < exclEnd ? (far === "left" ? [sa + 1.95, sb] : [sa, sb - 1.95]) : [sa, sb]));
      if (trade !== "post office") put("display case", wallS(near, 0.5), 3.4, 1.5, 0.6, 1.2, AD);
      break;
    }
    case "dining room": {
      for (const w of windows.slice(0, 3)) {
        if (w.w >= 1.9) put("booth", w.c, 1.2, 1.6, 1.7, 1.1, AX);
        else put("table", w.c, 1.35, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.8, 0.75, AX);
      }
      put("desk", wallS(near, 0.6), 2.9, 0.6, 0.5, 1.1, AX);
      let lastBooth = 2.6;
      for (let d = 3.5; d < D - 2.4; d += 2.1) if (put("booth", wallS(far, 0.95), d, 1.9, 1.7, 1.1, AD)) lastBooth = d;
      put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1, 4), 0.8, 1.05, AX);
      put("cart", wallS(near, 0.5), D - 1.7, 0.9, 0.6, 1, AX);
      put("plant", wallS(near, 0.35), 1.2, 0.4, 0.4, 1.0, AX);
      tablesFill(sMin, sMax, 3.4, D - 2.1, 2.1, 1.8, (d, sa, sb) => (d < lastBooth + 1.2 ? (far === "left" ? [sa + 2.5, sb] : [sa, sb - 2.5]) : [sa, sb]));
      break;
    }
    case "bar": {
      const L = Math.max(2.5, Math.min(D - 4, 9));
      put("counter", wallS(far, 0.95), 3 + L / 2, L, 0.7, 1.1, AD);
      put("shelf run", wallS(far, 0.2), 3 + L / 2, L, 0.35, 1.9, AD);
      put("stool row", wallS(far, 1.55), 3 + L / 2, L - 0.4, 0.4, 0.75, AD);
      for (const w of windows.slice(0, 2)) put("table", w.c, 1.35, Math.min(0.8, Math.max(0.5, w.w - 0.3)), 0.8, 0.75, AX);
      if (W >= 4.5 && D >= 8.5) put("pool table", (sMin + sMax) / 2 + toward(near) * 0.2, D - 2.9, 2.6, 1.4, 0.85, chance(rng, 0.4) ? { x: 0.8, z: 0.6 } : AX);
      put("machine", wallS(near, 0.4), 2.9, 0.8, 0.55, 1.5, AD);
      for (let d = 4.2, k = 0; k < 3 && d < D - 2; d += 2.1, k++) put("booth", wallS(near, 0.95), d, 1.9, 1.7, 1.1, AD);
      tablesFill(sMin, sMax, 3.4, D - 2.4, 2.4, 2.2, (d, sa, sb) => (d < 3 + L + 0.8 ? (far === "left" ? [sa + 2.9, sb - 2.5] : [sa + 2.5, sb - 2.9]) : [sa + 0.6, sb - 0.6]));
      break;
    }
    case "office": {
      for (const w of windows.slice(0, 2)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      const personal = trade === "hair salon" || trade === "barber" || trade === "tattoo parlor";
      if (personal) {
        for (let d = 3.4, k = 0; k < 4 && d < D - 1.5; d += 1.8, k++) put("counter", wallS(far, 0.5), d, 1.4, 0.5, 0.9, AD);
        put("rack", wallS(near, 0.4), 3.6, 1.2, 0.4, 1.7, AD);
        put("bench", wallS(near, 0.4), 5.4, 1.6, 0.4, 0.45, AD);
        put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1.2, 2.4), 0.7, 1.0, AX);
      } else if (trade === "bank" || trade === "credit union") {
        put("counter", (sMin + sMax) / 2, 3.6, Math.max(2, W - 2.6), 0.7, 1.1, AX);
        put("desk", wallS(far, 1.1), 5.4, 1.6, 0.8, 0.75, AX);
        put("desk", wallS(near, 1.1), 6.2, 1.6, 0.8, 0.75, skew());
        put("rack", (sMin + sMax) / 2, D - 0.4, Math.min(W - 1, 2.4), 0.5, 1.8, AX);
      } else if (trade === "union hall") {
        put("table", (sMin + sMax) / 2, 4, 2.6, 0.9, 0.75, AX);
        put("table", (sMin + sMax) / 2, 6.2, 2.6, 0.9, 0.75, AX);
        for (let k = 0; k < 4; k++) put("bench", sMin + 1 + k * 1.1, D - 1.2, 1, 0.4, 0.45, AX);
        put("desk", wallS(far, 0.8), 3.4, 1.4, 0.7, 0.75, AX);
      } else {
        put("counter", wallS(far, 0.7), 3.0, 1.8, 0.6, 1.05, AX);
        const dn = int(rng, 3, 5);
        for (let k = 0; k < dn; k++) put("desk", sMin + 1.3 + (k % 2) * 2.7, 4.6 + Math.floor(k / 2) * 2.0, 1.6, 0.8, 0.75, chance(rng, 0.3) ? skew() : AX);
        if (W >= 8) put("desk", sMin + 6.4, 4.6, 1.6, 0.8, 0.75, AX);
      }
      put("cabinet", wallS(far, 0.3), D - 1.4, 1.6, 0.55, 1.3, AD);
      put("cabinet", (sMin + sMax) / 2 + (hs(40) - 0.5) * 2, D - 0.4, 1.8, 0.5, 1.3, AX);
      put("water cooler", wallS(near, 0.3), D - 0.5, 0.3, 0.3, 1.4, AX);
      put("plant", wallS(near, 0.35), 1.3, 0.4, 0.4, 1.1, AX);
      put("plant", wallS(far, 0.35), D - 0.6, 0.4, 0.4, 1.3, AX);
      break;
    }
    case "laundromat": {
      const L = Math.max(2, Math.min(D - 3.4, 7.5));
      put("washer row", sMin + 0.6, 3 + L / 2, L, 0.9, 1.1, AD);
      if (W >= 5.5) put("washer row", sMax - 0.6, 3 + L / 2, L, 0.9, 1.1, AD);
      if (W >= 8) put("washer row", (sMin + sMax) / 2, 3.4 + (L - 1) / 2, L - 1, 1, 1.1, AD);
      for (const w of windows.slice(0, 1)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      put("table", (sMin + sMax) / 2 + toward(near) * 0.6, D - 1.4, 1.8, 0.9, 0.9, AX);
      put("counter", wallS(far, 0.6), 2.9, 1.6, 0.6, 1.05, AX);
      put("cart", wallS(near, 0.9), 2.7, 0.7, 0.5, 0.8, AX);
      put("machine", wallS(near, 0.4), D - 1.2, 0.8, 0.55, 1.8, AD);
      put("plant", wallS(near, 0.35), 1.3, 0.4, 0.4, 1.0, AX);
      break;
    }
    case "workshop": {
      const nl = W >= 8.5 ? 2 : 1;
      for (let k = 0; k < nl; k++) put("lift", sMin + W * ((k + 1) / (nl + 1)), D / 2 + 0.6, 4.4, 1.2, 2, AD);
      put("counter", (sMin + sMax) / 2, backD, Math.min(W - 1.4, 5), 0.7, 0.95, AX);
      put("rack", wallS(far, 0.4), 4, 1.2, 0.5, 1.8, AD);
      put("shelf run", wallS(near, 0.3), 5, 4, 0.45, 1.9, AD);
      put("cabinet", wallS(far, 0.45), D - 2.4, 1.4, 0.6, 1.3, AD);
      put("stacked crates", wallS(far, 0.7), D - 1.2, 0.9, 0.9, 1.3, skew());
      put("bin", wallS(near, 0.6), 2.6, 0.8, 0.8, 0.9, AX);
      put("table", sMin + 1.1, 3.5, 1.2, 0.8, 0.9, skew());
      break;
    }
    case "lobby": {
      put("desk", wallS(far, 0.9), 3.4, 2.2, 0.8, 1.1, AX);
      for (const w of windows.slice(0, 2)) put("bench", w.c, 0.6, Math.min(1.8, w.w - 0.2), 0.45, 0.45, AX);
      put("rack", wallS(near, 0.3), 4, 1, 0.4, 1.7, AD);
      for (let k = 0; k < 3; k++) put("bench", sMin + 1.2 + k * 1.6, D - 1.2 + (k % 2) * 0.3, 1.4, 0.45, 0.45, AX);
      put("table", (sMin + sMax) / 2, 5.2, 1, 0.8, 0.5, skew());
      put("couch", wallS(near, 0.55), 5.6, 1.8, 0.85, 0.85, AD);
      put("plant", wallS(near, 0.35), 1.3, 0.4, 0.4, 1.1, AX);
      put("water cooler", wallS(far, 0.3), D - 0.5, 0.3, 0.3, 1.4, AX);
      if (trade === "movie theater") {
        put("display case", wallS(near, 0.6), 3.4, 1.8, 0.6, 1.1, AD);
        put("counter", wallS(far, 0.6), 5.4, 2.2, 0.7, 1.1, AD);
      }
      break;
    }
    default: {
      // Empty: what the last tenant left behind.
      const w = windows.length > 0 ? windows[windows.length - 1]!.c : (sMin + sMax) / 2;
      // The ladder leans on the partition where the jog leaves it room; the cans stand by it, or by the first wall.
      for (const s of [w, sMin + 0.8, sMax - 0.8, (sMin + sMax) / 2, w - 1.2, w + 1.2]) if (put("ladder", s, D - 0.3, 0.5, 0.12, 2.4, AX)) break;
      for (const s of [w + 0.9, sMin + 0.7, sMax - 0.7, (sMin + sMax) / 2 + 0.6, w - 0.9]) if (put("paint cans", s, D - 0.5, 0.5, 0.5, 0.35, skew())) break;
      put("paint cans", w + 1.5, D - 0.8, 0.4, 0.4, 0.35, AX);
      put("stacked crates", wallS(near, 0.6), 4.6, 0.9, 0.9, 1.2, skew());
      put("stacked crates", wallS(far, 0.6), 6.2, 1.0, 0.9, 0.8, skew());
      put("sheet", (sMin + sMax) / 2 + (hs(50) - 0.5) * 2, 3.8 + hs(51) * 2, 1.4 + hs(52), 0.9, 0.9, AX);
      if (hs(53) < 0.6) put("sheet", wallS(near, 0.7), D - 1.4, 1.2, 0.8, 0.75, skew());
      if (chance(rng, 0.7)) put("shelf run", wallS(far, 0.3), 3.2 + (D - 4.4) / 2, D - 4.4, 0.45, 1.8, AD);
      if (chance(rng, 0.5)) put("counter", (sMin + sMax) / 2, D * 0.55, Math.min(W - 1.6, 3), 0.7, 1.05, AX);
      put("paint cans", sMin + 0.7, 3.2, 0.5, 0.5, 0.35, AX);
      break;
    }
  }

  /** Rows of tables across the room from `d0` to `d1`: the rows' spans come from `span`; one in ten is missing, one in ten has a neighbour pushed against it. */
  function tablesFill(sA: number, sB: number, d0: number, d1: number, pitchD: number, pitchS: number, span: (d: number, sa: number, sb: number) => [number, number]): void {
    let row = 0;
    for (let d = d0; d <= d1 + 0.01; d += pitchD, row++) {
      const [a, b] = span(d, sA, sB);
      const n = Math.floor((b - a) / pitchS);
      if (n < 1) continue;
      const x0 = a + (b - a - (n - 1) * pitchS) / 2;
      for (let k = 0; k < n; k++) {
        const r = hs(100 + row * 11 + k);
        const s = x0 + k * pitchS;
        if (r < 0.08) continue;
        const wide = r > 0.74;
        const dir = hs(300 + row * 7 + k) < 0.18 ? skew() : AX;
        const sx = wide ? 1.2 : 0.8;
        const sd = wide ? 0.75 : 0.8;
        put("table", s + (hs(200 + row * 5 + k) - 0.5) * 0.3, d + (hs(250 + row * 5 + k) - 0.5) * 0.3, sx, sd, 0.75, dir);
        if (r >= 0.08 && r < 0.17) put("table", s + (sx + 0.8) / 2 + 0.03, d, 0.8, 0.8, 0.75, AX);
      }
    }
  }

  // A modest room still has a handful of things in it: crates and shelving along the partition.
  if (full) for (let s = sMin + 0.7; boxes.length < 8 && s < sMax - 0.5; s += 1.3) put(boxes.length % 2 === 0 ? "stacked crates" : "shelf run", s, D - 0.5, boxes.length % 2 === 0 ? 0.8 : 1.1, 0.5, 1.2, AX);
  void jogged;

  // Light fixtures: pendants over the tables of a room that eats or drinks, a grid of tubes or lamps over the floor of any other.
  const lights: RoomLight[] = [];
  const kind: RoomLight["kind"] = i.type === "dining room" || i.type === "bar" || i.type === "counter service" ? "pendant" : i.type === "lobby" ? "lamp" : "tube";
  const anchors = boxes.filter((b) => b.f.kind === "table" && b.f.h > 0.6 && b.f.d > 2.4 && b.f.d < D - 1).filter((_, k) => k % 2 === 0).slice(0, 7);
  if (kind === "pendant" && anchors.length >= 2) {
    for (let k = 0; k < anchors.length; k++) lights.push({ s: r2((anchors[k] as (typeof anchors)[number]).f.s + (h01(i.sig, 400 + k) - 0.5) * 0.5), d: r2((anchors[k] as (typeof anchors)[number]).f.d + (h01(i.sig, 420 + k) - 0.5) * 0.4), h: r2(i.ceiling - 0.7 - h01(i.sig, 440 + k) * 0.35), on: i.lit, kind });
    const front = windows.length > 0 ? windows[0]!.c : (sMin + sMax) / 2;
    lights.push({ s: r2(front), d: 1.3, h: r2(i.ceiling - 0.8), on: i.lit, kind });
  } else {
    const nS = Math.max(1, Math.min(5, Math.floor(W / 2.4)));
    const nD = D >= 9 ? 3 : 2;
    for (let a = 0; a < nS; a++) {
      for (let b = 0; b < nD; b++) {
        const h = kind === "pendant" ? i.ceiling - 0.8 : kind === "lamp" ? 1.1 : i.ceiling - 0.15;
        const ls = sMin + ((a + 0.5) * W) / nS;
        const ld = ((b + 0.5) * (D - 0.4)) / nD + 0.2;
        // A fixture is not hung where a partition stands (a tube is 1.2 m long).
        if (boxes.some((o) => o.f.kind === "partition" && ls + 0.7 > o.x0 && ls - 0.7 < o.x1 && ld + 0.2 > o.z0 && ld - 0.2 < o.z1)) continue;
        lights.push({ s: r2(ls), d: r2(ld), h: r2(h), on: i.lit, kind });
      }
    }
  }
  if (i.type === "bar" && windows.length > 0) lights.push({ s: r2(windows[0]!.c), d: 0.3, h: r2(range(rng, 1.7, 2.1)), on: i.lit, kind: "neon" });
  return { furnishings: boxes.map((b) => b.f), lights };
}
