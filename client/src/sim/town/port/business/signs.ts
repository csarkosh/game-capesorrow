/**
 * The signs of the units and of the civic and industrial buildings, as data for the drawing (nothing here is drawn yet).
 *
 * WHAT CAUSES EACH SIGN. A sign is made in the decade its tenant opened, in the style of that decade (hand-painted before 1950,
 * neon and porcelain enamel in the 1950s and 60s, backlit plastic boxes 1970 to 1999, vinyl from 2000), and ages from there: its
 * condition falls with the years, rises where a unit is kept up, and falls further where the unit has stood vacant. A new tenant
 * who could not afford a new board (one in seven, where there was an earlier tenant) left the old fascia up, so its words no
 * longer match the trade, and hung a vinyl banner with the new name below it. Ghost signs are the paint of an earlier tenant on
 * old brick, left on a side wall or above the second storey. Neon is lit only while the unit is open and the sign has not failed
 * (a tube out since a storm). A pole sign stands at the lot's edge only where the building sits well back from the street.
 */
import { MASCOTS, SERVICE_TIMES, GAS_BRANDS, OWNER_SURNAMES } from "../../names.js";
import { chance, int, pick, range, weighted, type Rng } from "../../rng.js";
import type { Building, FrontFrame, PastTenant, Sign, SignKind, SignPlace, SignStyle, Trade, UnitState } from "../../types.js";
import { NOW, dec, r2, type BizCtx } from "./ctx.js";
import { tradeDef } from "./trades.js";

/** The style a sign of this decade is in. */
export function styleOf(decade: number): SignStyle {
  return decade < 1950 ? "hand-painted" : decade < 1970 ? "neon and porcelain" : decade < 2000 ? "backlit box" : "vinyl";
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** A sign's condition: it falls with age, a kept-up unit's is repainted now and then, a vacant unit's is neglected. */
export function conditionOf(rng: Rng, decade: number, kept: boolean, vacantYears: number): number {
  const age = NOW - decade;
  return r2(clamp01(0.98 - age * 0.007 + (kept ? 0.18 : 0) - vacantYears * 0.012 + range(rng, -0.1, 0.1)));
}

const phone = (rng: Rng): string => `555-01${String(int(rng, 0, 99)).padStart(2, "0")}`;
const HOURS = ["OPEN DAILY 7 TO 3", "MON-FRI 9 TO 5", "TUES-SAT 10 TO 6", "MON-SAT 9 TO 5:30", "CLOSED SUNDAY", "OPEN 7 DAYS 8 TO 8"] as const;

function lit(rng: Rng, style: SignStyle, kind: SignKind, state: UnitState, condition: number): boolean {
  if (state !== "open") return false;
  if (style !== "neon and porcelain" && style !== "backlit box" && kind !== "open") return false;
  // A tube that has been out since the last storm.
  return condition > 0.4 && !chance(rng, 0.12);
}

export type UnitSignInput = {
  readonly rng: Rng;
  readonly ctx: BizCtx;
  readonly b: Building;
  readonly frame: FrontFrame;
  readonly district: string;
  /** How far in front of the building the lot's street edge lies. */
  readonly lotOut: number;
  readonly s0: number;
  readonly s1: number;
  /** The frontage a board over the windows spans (the bay less a stair strip). */
  readonly a: number;
  readonly bEnd: number;
  readonly door: { readonly s: number; readonly width: number };
  readonly fascia: number;
  readonly state: UnitState;
  readonly trade: Trade | null;
  readonly name: string;
  readonly opened: number;
  readonly past: readonly PastTenant[];
  readonly vacantSince: number | null;
  readonly openings: readonly { readonly s0: number; readonly s1: number }[];
};

export function unitSigns(i: UnitSignInput): Sign[] {
  const { rng, b, frame } = i;
  const out: Sign[] = [];
  const open = i.state === "open" || i.state === "closed for the day";
  const old = b.material === "brick" && b.era < 1960;
  const doorSide = (s: number): "left" | "right" => (s < i.door.s ? "left" : "right");
  const mid = (i.a + i.bEnd) / 2;
  const make = (kind: SignKind, lines: string[], decade: number, place: SignPlace, o: { trade?: Trade | null; mismatch?: boolean; cond?: number; style?: SignStyle } = {}): void => {
    const style = o.style ?? styleOf(decade);
    const vacantYears = i.vacantSince === null ? 0 : NOW - i.vacantSince;
    const condition = r2(o.cond ?? conditionOf(rng, decade, open, vacantYears));
    out.push({ kind, lines, style, decade, condition, lit: lit(rng, style, kind, i.state, condition), trade: o.trade === undefined ? i.trade : o.trade, mismatch: o.mismatch ?? false, place });
  };
  const front = (s: number, h: number, door: SignPlace["door"], out = 0): SignPlace => ({ wall: "front", s: r2(s), h: r2(h), out, door });
  const end = i.s0 <= 0.001 && i.s1 >= frame.width - 0.001 ? (chance(rng, 0.5) ? "left" : "right") : i.s0 <= 0.001 ? "left" : i.s1 >= frame.width - 0.001 ? "right" : null;

  if (open) {
    const def = tradeDef(i.trade!);
    const tag = def.tagline.length > 0 ? pick(rng, def.tagline) : null;
    const name = i.name;
    // An earlier tenant's board left up (one in seven, where there was one): the fascia no longer matches the trade, and a banner names the new one.
    const stale = i.past.length > 0 && chance(rng, 0.15);
    const dec0 = Math.max(i.opened, b.era);
    if (stale) {
      const last = i.past[i.past.length - 1]!;
      const d0 = dec(last.from);
      make("fascia", [last.name], d0, front(mid, i.fascia, "over"), { trade: last.trade, mismatch: true, cond: conditionOf(rng, d0, false, 0) * 0.7 });
      make("banner", [name.toUpperCase(), chance(rng, 0.5) ? "NOW OPEN" : "UNDER NEW MANAGEMENT"], Math.max(2000, dec0), front(mid, i.fascia + 0.6, "over"), { style: "vinyl" });
    } else if (chance(rng, 0.93)) {
      make("fascia", tag !== null && chance(rng, 0.45) ? [name, tag] : [name], dec0, front(mid, i.fascia, "over"));
    }
    if (b.storeys >= 1 && i.district === "core" && chance(rng, dec0 < 1970 ? 0.22 : 0.07)) {
      const left = chance(rng, 0.5);
      make("blade", [def.plain ?? name], dec0, { wall: "front", s: r2(left ? i.door.s - i.door.width / 2 - 0.5 : i.door.s + i.door.width / 2 + 0.5), h: r2(range(rng, 3, 3.6)), out: 0.9, door: left ? "left" : "right" });
    }
    if (chance(rng, 0.3) && i.openings.length > 0) {
      let k = 0;
      for (let j = 1; j < i.openings.length; j++) if (i.openings[j]!.s1 - i.openings[j]!.s0 > i.openings[k]!.s1 - i.openings[k]!.s0) k = j;
      const o = i.openings[k]!;
      const lines = chance(rng, 0.5) ? [name] : [tag ?? def.plain ?? name, pick(rng, HOURS)];
      make("glass", lines, Math.max(dec0, 1900), front((o.s0 + o.s1) / 2, range(rng, 1.7, 2.1), doorSide((o.s0 + o.s1) / 2)));
    }
    if (chance(rng, 0.45) && i.openings.length > 0 && def.interior !== "empty") {
      // The OPEN sign hangs in the window nearest the door.
      let k = 0;
      let bestD = 1e9;
      for (let j = 0; j < i.openings.length; j++) {
        const d = Math.abs((i.openings[j]!.s0 + i.openings[j]!.s1) / 2 - i.door.s);
        if (d < bestD) {
          bestD = d;
          k = j;
        }
      }
      const o = i.openings[k]!;
      const od = Math.max(1950, dec0);
      make("open", [i.state === "open" ? "OPEN" : "CLOSED"], od, front((o.s0 + o.s1) / 2, range(rng, 1.2, 1.5), doorSide((o.s0 + o.s1) / 2)), { style: od >= 2000 ? "backlit box" : styleOf(od) });
    }
    if (def.interior !== "office" && def.interior !== "lobby" && chance(rng, def.interior === "dining room" || def.interior === "counter service" || def.id === "antiques" || def.id === "tavern" ? 0.3 : 0.12)) {
      const left = chance(rng, 0.5);
      make("sandwich", [tag ?? def.plain ?? name], Math.max(dec0, 1970), { wall: "sidewalk", s: r2(i.door.s + (left ? -1 : 1) * (i.door.width / 2 + 0.9)), h: 0, out: 0.7, door: left ? "left" : "right" });
    }
    if (def.interior !== "office" && def.interior !== "lobby" && chance(rng, 0.14)) {
      make("banner", [chance(rng, 0.5) ? "SALE" : chance(rng, 0.5) ? "NOW HIRING" : "GRAND OPENING"], 2020, front(mid, i.fascia + 0.6, "over"), { style: "vinyl" });
    }
    if (end !== null && chance(rng, old ? 0.2 : 0.07)) {
      make("wall", [name, tag ?? def.plain ?? ""].filter((x) => x !== ""), dec0, { wall: end, s: r2(range(rng, 1.5, Math.min(8, frame.depth * 0.4))), h: r2(b.storeys > 1 ? range(rng, 4.4, 6.5) : range(rng, 3, 3.8)), out: 0, door: "none" });
    }
    if (i.lotOut > 6 && (i.district === "highway strip" || i.lotOut > 10) && chance(rng, 0.8)) {
      const left = chance(rng, 0.5);
      make("pole", [name, ...(tag !== null ? [tag] : [])], dec0, { wall: "lot edge", s: r2(left ? -range(rng, 1.5, 5) : frame.width + range(rng, 1.5, 5)), h: r2(range(rng, 5.5, 9)), out: r2(Math.max(1, i.lotOut - 1)), door: "none" });
    }
    if (old && i.past.length > 0 && chance(rng, 0.12)) ghost(i, make, end, front);
    // Every open unit says who it is: if no board or banner names the tenant, a fascia does.
    if (!out.some((s) => !s.mismatch && (s.kind === "fascia" || s.kind === "blade" || s.kind === "wall" || s.kind === "pole" || (s.kind === "banner" && s.lines[0] === name.toUpperCase())))) {
      make("fascia", [name], dec0, front(mid, i.fascia, "over"));
    }
    return out;
  }

  // A vacant unit: the notice in the glass, the last tenant's board going, and sometimes an older tenant's paint on the brick.
  const since = i.vacantSince ?? 2010;
  const vd = Math.max(1990, dec(since));
  make("lease", ["FOR LEASE", phone(rng)], vd, front(i.openings.length > 0 ? (i.openings[0]!.s0 + i.openings[0]!.s1) / 2 : mid, range(rng, 1.4, 1.9), i.openings.length > 0 ? doorSide((i.openings[0]!.s0 + i.openings[0]!.s1) / 2) : "over"), { trade: null, cond: r2(clamp01(range(rng, 0.35, 0.9))) });
  if (i.past.length > 0 && chance(rng, 0.8)) {
    const last = i.past[i.past.length - 1]!;
    const d0 = dec(last.from);
    make("fascia", [last.name], d0, front(mid, i.fascia, "over"), { trade: last.trade, mismatch: true, cond: conditionOf(rng, d0, false, NOW - since) * 0.8 });
  }
  if (old && i.past.length > 0 && chance(rng, 0.3)) ghost(i, make, end, front);
  return out;
}

type Make = (kind: SignKind, lines: string[], decade: number, place: SignPlace, o?: { trade?: Trade | null; mismatch?: boolean; cond?: number; style?: SignStyle }) => void;

/** A faded sign of an earlier tenant, painted on a side wall or above the second storey of an old brick front. */
function ghost(i: UnitSignInput, make: Make, end: "left" | "right" | null, front: (s: number, h: number, door: SignPlace["door"], out?: number) => SignPlace): void {
  const { rng, b, frame } = i;
  const old = i.past[int(rng, 0, Math.max(0, Math.min(1, i.past.length - 1)))]!;
  const d0 = Math.min(1950, dec(old.from));
  const trade = tradeDef(old.trade);
  const lines = [old.name.toUpperCase(), trade.plain ?? ""].filter((x) => x !== "");
  if (end !== null) make("ghost", lines, d0, { wall: end, s: r2(range(rng, 1.5, Math.min(8, frame.depth * 0.4))), h: r2(b.storeys > 1 ? range(rng, 4.2, 6) : range(rng, 2.8, 3.6)), out: 0, door: "none" }, { trade: old.trade, mismatch: true, cond: r2(range(rng, 0.05, 0.28)), style: "hand-painted" });
  else if (b.storeys > 1) make("ghost", lines, d0, front((i.a + i.bEnd) / 2, range(rng, 4.6, 6), "over"), { trade: old.trade, mismatch: true, cond: r2(range(rng, 0.05, 0.28)), style: "hand-painted" });
}

// ---- Gas, motels, and the civic and industrial buildings.

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** A price of the present day: $4.59 to $5.89 a gallon, with the tenth of a cent every price sign carries ("4.899"). */
function price(rng: Rng, lo: number): string {
  const c = int(rng, lo, lo + 60);
  return `${Math.floor(c / 100)}.${pad2(c - Math.floor(c / 100) * 100)}9`;
}

/** The pole sign of a gas station: an invented brand, and the present day's prices. */
export function gasSign(rng: Rng, brand: string, decade: number, lotOut: number, frame: FrontFrame, kept: boolean): Sign {
  const reg = int(rng, 459, 529);
  const fmt = (c: number): string => `${Math.floor(c / 100)}.${pad2(c - Math.floor(c / 100) * 100)}9`;
  const style: SignStyle = decade < 1950 ? "hand-painted" : decade < 1970 ? "neon and porcelain" : "backlit box";
  const cond = conditionOf(rng, decade, kept, 0);
  return {
    kind: "pole",
    lines: [brand, `REGULAR ${fmt(reg)}`, `PLUS ${fmt(reg + int(rng, 20, 40))}`, `PREMIUM ${fmt(reg + int(rng, 50, 80))}`, `DIESEL ${price(rng, reg + 10)}`],
    style,
    decade,
    condition: cond,
    lit: kept && cond > 0.4,
    trade: "gas station",
    mismatch: false,
    place: { wall: "lot edge", s: r2(chance(rng, 0.5) ? -range(rng, 2, 4) : frame.width + range(rng, 2, 4)), h: r2(range(rng, 6, 8.5)), out: r2(Math.max(1, lotOut - 1)), door: "none" },
  };
}

export function pickBrand(rng: Rng): string {
  return pick(rng, GAS_BRANDS);
}

/** A motel's pole sign: its name and VACANCY (or NO VACANCY, or the weekly rate an older one still advertises). */
export function motelSign(rng: Rng, name: string, decade: number, state: "open" | "vacant", lotOut: number, frame: FrontFrame): Sign {
  const style = styleOf(decade >= 2000 ? 1990 : decade);
  const cond = conditionOf(rng, decade, state === "open", 0);
  const second = state === "open" ? weighted(rng, [["VACANCY", 5], ["NO VACANCY", 3], ["WEEKLY RATES", 1]] as const) : "VACANCY";
  return {
    kind: "pole",
    lines: [name, second, ...(chance(rng, 0.4) ? ["FREE WI-FI"] : decade < 1990 ? ["COLOR TV"] : [])],
    style,
    decade,
    condition: cond,
    lit: state === "open" && cond > 0.4 && second !== "NO VACANCY",
    trade: "motel",
    mismatch: false,
    place: { wall: "lot edge", s: r2(chance(rng, 0.5) ? -range(rng, 2, 5) : frame.width + range(rng, 2, 5)), h: r2(range(rng, 6, 9)), out: r2(Math.max(1, lotOut - 1.5)), door: "none" },
  };
}

export type CivicInput = {
  readonly rng: Rng;
  readonly ctx: BizCtx;
  readonly b: Building;
  readonly frame: FrontFrame;
  readonly lotOut: number;
  /** The landmark's name, if the building is one. */
  readonly landmark: string | null;
  readonly takeName: (stem: string) => string;
};

/** The signs a civic or industrial building carries as a whole (none for a house). */
export function civicSigns(i: CivicInput): Sign[] {
  const { rng, b, frame, ctx, landmark } = i;
  const state = b.state;
  const kept = state === "open";
  const out: Sign[] = [];
  const cond = (d: number): number => (state === "ruin" ? r2(range(rng, 0.03, 0.15)) : conditionOf(rng, d, kept, state === "vacant" ? 12 : 0));
  const add = (kind: SignKind, lines: string[], decade: number, place: SignPlace, style?: SignStyle, trade: Trade | null = null): void => {
    const st = style ?? styleOf(decade);
    const c = cond(decade);
    out.push({ kind, lines, style: st, decade, condition: c, lit: kept && c > 0.4 && (st === "neon and porcelain" || st === "backlit box") && !chance(rng, 0.1), trade, mismatch: false, place });
  };
  const wall = (s: number, h: number, door: SignPlace["door"] = "over"): SignPlace => ({ wall: "front", s: r2(s), h: r2(h), out: 0, door });
  const lotEdge = (s: number, h: number, extra = 1): SignPlace => ({ wall: "lot edge", s: r2(s), h: r2(h), out: r2(Math.max(0.8, i.lotOut - extra)), door: "none" });
  const side = (): "left" | "right" => (chance(rng, 0.5) ? "left" : "right");
  const W = frame.width;
  const town = ctx.townName;
  const sideWall = (lines: string[], decade: number, style?: SignStyle, trade: Trade | null = null): void =>
    add("wall", lines, decade, { wall: side(), s: r2(range(rng, 2, Math.max(3, Math.min(10, frame.depth * 0.35)))), h: r2(b.storeys > 1 ? range(rng, 4, 8) : range(rng, 3, 5.5)), out: 0, door: "none" }, style ?? "hand-painted", trade);
  switch (b.kind) {
    case "church": {
      const name = landmark ?? i.takeName("church");
      add("board", [name, ...pick(rng, SERVICE_TIMES)], b.era >= 1970 ? Math.max(b.era, 1970) : 1950, lotEdge(range(rng, 0.1, 0.3) * W, 1.7, 1.5), b.era >= 1970 ? "backlit box" : "hand-painted");
      break;
    }
    case "school": {
      add("board", [landmark ?? `${town} School`.toUpperCase()], dec(b.era), wall(W / 2, Math.min(b.height - 1, 7.5)));
      add("board", [`HOME OF THE ${pick(rng, MASCOTS).toUpperCase()}`, "WELCOME BACK"], 2000, lotEdge(range(rng, 0.65, 0.9) * W, 1.9, 1.5), "backlit box");
      break;
    }
    case "hospital":
      add("board", [landmark ?? `${town} Hospital`], dec(b.era), lotEdge(range(rng, 0.1, 0.3) * W, 2, 2), "backlit box");
      add("board", ["EMERGENCY"], dec(b.era), wall(range(rng, 0.65, 0.85) * W, 3.2, "right"), "backlit box");
      break;
    case "courthouse":
      add("board", [(landmark ?? `${ctx.history.countySeat.county} Courthouse`).toUpperCase()], dec(b.era), wall(W / 2, Math.min(b.height - 1.2, 8)), "hand-painted");
      break;
    case "federal building":
      add("board", ["UNITED STATES POST OFFICE"], dec(b.era), wall(W / 2, 4.2), "hand-painted", "post office");
      add("board", ["FEDERAL BUILDING", `ERECTED ${b.era}`], dec(b.era), wall(W * range(rng, 0.7, 0.85), 1.5, "right"), "hand-painted");
      break;
    case "office":
      if (landmark !== null) add("board", [landmark, "AUTHORIZED PERSONNEL ONLY"], 1990, wall(range(rng, 0.7, 0.9) * W, 1.5, "right"), "backlit box");
      break;
    case "customs house":
      add("board", [`${town} CUSTOMS HOUSE`, "PORT OF ENTRY"], dec(b.era), wall(W / 2, Math.min(b.height - 1.5, 6)), "hand-painted");
      break;
    case "depot":
      add("board", [town.toUpperCase(), ctx.names.railroad.toUpperCase()], dec(b.era), wall(W / 2, 3.6), "hand-painted");
      break;
    case "tsunami refuge":
      add("board", ["TSUNAMI", "VERTICAL EVACUATION", "REFUGE"], 2010, wall(W / 2, 5.5), "vinyl");
      break;
    case "lodge hall":
      add("board", [landmark ?? "Lodge", `No. ${int(rng, 12, 840)}`], dec(b.era), wall(W / 2, b.storeys > 1 ? 7 : 4), "hand-painted");
      break;
    case "fire hall":
      add("board", ["FIRE STATION", `${ctx.history.countySeat.county.toUpperCase()} FIRE DISTRICT No. ${int(rng, 1, 24)}`], dec(b.era), wall(W / 2, 3.6), "backlit box");
      break;
    case "port terminal shed":
      add("board", [`PORT OF ${town.toUpperCase()}`, "TERMINAL", pick(rng, ["LOG EXPORT", "BULK CARGO", "AUTO IMPORT", "SEAFOOD LANDING"] as const), `TENANT: ${i.takeName("stevedore")}`, "NO ADMITTANCE"], 1990, lotEdge(range(rng, 0.1, 0.4) * W, 2.2, 1.5), "backlit box");
      break;
    case "cannery":
      sideWall([`${town} Packing Co.`, "Salmon - Halibut - Crab"], dec(b.era));
      break;
    case "mill shed":
      if (landmark !== null) add("board", [ctx.history.mill.company], dec(b.era), lotEdge(range(rng, 0.1, 0.4) * W, 2, 1.5), "hand-painted");
      break;
    case "silo":
      sideWall([pick(rng, ["GRAIN", "SOY MEAL", "CHIPS"] as const)], 1970, "hand-painted");
      break;
    case "warehouse":
      sideWall([`${pick(rng, OWNER_SURNAMES)} Storage`], dec(b.era));
      break;
    case "apartment": {
      const nm = i.takeName("apartments");
      add("board", [nm], dec(b.era), { wall: "front", s: r2(W * range(rng, 0.15, 0.4)), h: 2.3, out: 0, door: "left" }, undefined);
      break;
    }
    case "junkyard":
      add("board", ["AUTO WRECKING", "WE BUY JUNK CARS"], 1970, lotEdge(range(rng, 0.1, 0.5) * W, 2.4, 1), "hand-painted");
      break;
    case "shake mill":
      sideWall(["SHAKE & SHINGLE"], dec(b.era));
      break;
    default:
      break;
  }
  return out;
}

