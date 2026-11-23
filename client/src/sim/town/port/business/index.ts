/**
 * What is in the buildings: units, tenants, names, signs, rooms and windows (`plan.uses`, one `BuildingUse` a building). Made last,
 * from the finished plan, and only from the `business` stream (`rng.ts`): each building draws from a stream of its own (its id hashed
 * with the stage's), so that a change to one building's draws moves no other building's, and the town-wide choices (which trade
 * goes in which bay, the essentials every town has) from the stage's own stream.
 *
 * Three passes. A: each building's front, its bays and their doors and windows, and which bays are open, shut for the day or vacant.
 * B: the trade of every bay that holds one, with the town's caps (one post office, two banks) and its essentials (a grocery, a post
 * office, a cafe, a hardware store; a union hall in a mill town; lawyers and a title company at the county seat; bait and
 * tackle in a fishing port). C: for each building, the tenant's decade and name, the earlier tenants, the signs, the room and the
 * windows above.
 */
import { OWNER_SURNAMES, PLACE_WORDS, businessName } from "../../names.js";
import { chance, int, pick, range, weighted, type Rng } from "../../rng.js";
import type { Building, BuildingUse, FrontFrame, Landmark, PastTenant, Sign, Tenant, Trade, Unit, UnitState, UpperUse, WindowState, Opening, WindowCover } from "../../types.js";
import { NOW, dec, districtOf, r1, r2, sub, type BizCtx, type BizInput } from "./ctx.js";
import { frontFrame, streetOf } from "./frame.js";
import { furnish } from "./interiors.js";
import { civicSigns, gasSign, motelSign, pickBrand, unitSigns } from "./signs.js";
import { fit, openedDecade, pastTrade, pickTrade } from "./tenants.js";
import { FAMILY, classOf, tradeDef, type TradeDef } from "./trades.js";
import { MIN_BAY, STAIR_STRIP, bayCount, bayGeo, cutFront, type Geo } from "./units.js";
import { dwelling, upperFloor } from "./windows.js";

/** Kinds that carry units of their own with a fixed trade. */
const FIXED: Partial<Record<Building["kind"], Trade>> = { bank: "bank", "gas station": "gas station", motel: "motel", "federal building": "post office", tavern: "tavern", "boarding house": "rooming house" };
/** Kinds that hold ground-floor units (a shop, an office, a lobby). */
const UNIT_KINDS: readonly Building["kind"][] = ["storefront", "office", "tavern", "restaurant", "garage", "big-box store", "warehouse", "hotel", "lodge hall", "boarding house", "depot", "bank", "gas station", "motel", "federal building"];
/** A building with a street door to the stairs of its upper floors. */
const STAIR_KINDS: readonly Building["kind"][] = ["storefront", "office", "tavern", "lodge hall", "bank"];
/** Never shut for the day: the pump, the vacancy sign and the front desk are on round the clock. */
const ROUND_THE_CLOCK: readonly Building["kind"][] = ["gas station", "motel", "hotel", "boarding house"];
const PERSONAL: readonly Trade[] = ["cafe", "diner", "hair salon", "barber", "bakery", "tavern", "restaurant", "tattoo parlor", "gas station"];

type Slot = "open" | "closed" | "vacant";

type Draft = {
  b: Building;
  frame: FrontFrame | null;
  street: string;
  district: string;
  cls: string;
  fixed: Trade | null;
  lotOut: number;
  geos: Geo[];
  /** The frontage each bay's board and windows may use, less a stair strip. */
  avail: { a: number; b: number }[];
  slots: Slot[];
  trades: (Trade | null)[];
  stair: { s: number; width: number } | null;
  landmark: Landmark | null;
};

function lotOutOf(ctx: BizCtx, b: Building, frame: FrontFrame | null): number {
  if (frame === null || b.lot < 0) return 0;
  const lot = ctx.lots[b.lot];
  if (!lot) return 0;
  let best = 0;
  for (const v of lot.polygon) best = Math.max(best, (v.x - frame.origin.x) * frame.n.x + (v.z - frame.origin.z) * frame.n.z);
  return r1(best);
}

export function planUses(input: BizInput, townRng: Rng): BuildingUse[] {
  const { history, townName, buildings, landmarks, harbour } = input;
  const used: string[] = [];
  for (const l of landmarks) used.push(l.name.toLowerCase());
  const taken = (n: string): boolean => used.includes(n.toLowerCase());
  const take = (n: string): void => {
    used.push(n.toLowerCase());
  };
  const workingBoats = harbour.boats.filter((x) => x.state === "working" && (x.kind === "troller" || x.kind === "gillnetter" || x.kind === "crabber")).length;
  const fishing = history.port.handles === "seafood" || history.founding.purpose === "cannery" || buildings.some((b) => b.kind === "cannery") || workingBoats >= 3;
  // Surnames already in a street's or a landmark's name: the families that stayed.
  const wordsIn: string[] = [];
  for (const s of input.streets) wordsIn.push(s.name);
  for (const l of landmarks) wordsIn.push(l.name);
  wordsIn.push(townName, history.founding.founder, history.mill.company);
  const families = OWNER_SURNAMES.filter((sn) => wordsIn.some((w) => w.includes(sn)));
  const streetWords: string[] = [];
  for (const s of input.streets) {
    if (s.kind !== "street" && s.kind !== "main" && s.kind !== "avenue") continue;
    const w = s.name.replace(/ (Street|Avenue)$/, "");
    if (/^[A-Za-z]+$/.test(w) && !streetWords.includes(w)) streetWords.push(w);
  }
  const ctx: BizCtx = {
    ...input,
    base: townRng.state,
    town: townName,
    fishing,
    tourist: history.present.highwayStrip,
    seat: history.countySeat.isSeat,
    millTown: history.founding.purpose === "sawmill" || history.mill.fate === "working",
    families,
    streetWords,
    taken,
    take,
  };
  const vacantShare = history.present.vacantShare;
  const lmOf = (id: number): Landmark | null => landmarks.find((l) => l.building === id) ?? null;

  // ---- Pass A: fronts, bays, states.
  const drafts: Draft[] = [];
  for (const b of buildings) {
    const frame = frontFrame(b);
    const district = districtOf(ctx, b);
    const cls = classOf(b.kind);
    const fixed = FIXED[b.kind] ?? null;
    const d: Draft = { b, frame, street: streetOf(b, frame, input.streets), district, cls, fixed, lotOut: lotOutOf(ctx, b, frame), geos: [], avail: [], slots: [], trades: [], stair: null, landmark: lmOf(b.id) };
    drafts.push(d);
    if (frame === null || b.state === "ruin" || !UNIT_KINDS.includes(b.kind)) continue;
    const rng = sub(ctx.base, b.id, 1);
    // An open warehouse is half the time a business's, half the time just stock.
    if (b.kind === "warehouse" && b.state === "open" && chance(rng, 0.5)) continue;
    const stairSide = STAIR_KINDS.includes(b.kind) && b.storeys > 1 ? (chance(rng, 0.5) ? "left" : "right") : null;
    const minW = MIN_BAY + (stairSide !== null ? STAIR_STRIP : 0);
    let n = bayCount(rng, b.kind, district, frame.width);
    while (n > 1 && frame.width < n * minW) n--;
    const cuts = cutFront(rng, frame.width, n, minW);
    cuts[cuts.length - 1] = frame.width;
    for (let k = 0; k < n; k++) {
      const s0 = cuts[k]!;
      const s1 = cuts[k + 1]!;
      const a = s0 + (stairSide === "left" && k === 0 ? STAIR_STRIP : 0);
      const e = s1 - (stairSide === "right" && k === n - 1 ? STAIR_STRIP : 0);
      d.avail.push({ a, b: e });
      d.geos.push(bayGeo(rng, s0, s1, a, e, b.era, s1 - s0 >= 10.5 && chance(rng, 0.5)));
    }
    if (stairSide !== null) d.stair = { s: r2(stairSide === "left" ? STAIR_STRIP / 2 : frame.width - STAIR_STRIP / 2), width: 1.1 };
    // Which bays are open: a vacant building is vacant throughout; in an open one the bays beyond the first may stand empty (as often as the town's share), and one is always open.
    if (b.state === "vacant") for (let k = 0; k < n; k++) d.slots.push("vacant");
    else {
      const keep = int(rng, 0, n - 1);
      for (let k = 0; k < n; k++) {
        if (k !== keep && n > 1 && chance(rng, vacantShare * 0.5)) d.slots.push("vacant");
        else d.slots.push(chance(rng, cls === "o" ? 0.18 : 0.1) && !ROUND_THE_CLOCK.includes(b.kind) ? "closed" : "open");
      }
    }
    d.trades = d.slots.map(() => null);
  }

  // ---- Pass B: the trades, from the town's own stream.
  const counts: Record<string, number> = {};
  const bump = (t: Trade, by: number): void => {
    counts[t] = (counts[t] ?? 0) + by;
  };
  for (const d of drafts) {
    if (d.geos.length === 0) continue;
    for (let k = 0; k < d.geos.length; k++) {
      if (d.slots[k] === "vacant") continue;
      // A hotel's lobby is its widest bay; the rest of a building with a fixed trade holds that trade in bay 0.
      if (d.fixed !== null && k === 0) {
        d.trades[k] = d.fixed;
        bump(d.fixed, 1);
      } else if (d.b.kind === "hotel" && k === widest(d)) {
        d.trades[k] = "hotel";
      }
    }
  }
  for (const d of drafts) {
    for (let k = 0; k < d.geos.length; k++) {
      if (d.slots[k] === "vacant" || d.trades[k] !== null) continue;
      const g = d.geos[k]!;
      d.trades[k] = pickTrade(townRng, ctx, d.cls, d.district, g.s1 - g.s0, counts);
      if (d.trades[k] === null) d.slots[k] = "vacant";
      else bump(d.trades[k]!, 1);
    }
  }
  // The essentials: every town has them, and a mill, seat or fishing town has what its history calls for.
  const essentials: Trade[] = ["post office", "grocery", "cafe", "hardware"];
  if (ctx.millTown) essentials.push("union hall");
  if (ctx.seat) essentials.push("title company", "law office");
  if (ctx.fishing) essentials.push("bait and tackle", "marine supply");
  for (const want of essentials) {
    if ((counts[want] ?? 0) > 0) continue;
    const def = tradeDef(want);
    let best: { d: Draft; k: number; score: number } | null = null;
    for (const d of drafts) {
      for (let k = 0; k < d.geos.length; k++) {
        const cur = d.trades[k];
        // (A bay that holds another essential is never the one displaced: in a town of few shops one essential could take another's place.)
        if (d.slots[k] === "vacant" || !cur || d.fixed !== null || d.b.kind === "hotel" || essentials.includes(cur)) continue;
        if (!def.at.split("").some((c) => d.cls.includes(c))) continue;
        const g = d.geos[k]!;
        // Prefer the district the trade belongs in, a bay it fits, and a bay whose trade is common (so a rare one is never displaced).
        const score = fit(def, g.s1 - g.s0) * (def.mul[d.district === "core" ? 0 : d.district === "dock" ? 1 : d.district === "highway strip" ? 2 : 3] ?? 0) + (counts[cur] ?? 0) * 0.01 + range(townRng, 0, 0.05);
        if (best === null || score > best.score) best = { d, k, score };
      }
    }
    // Where no bay suits it (a short business street has few), the widest bay of a building that holds such a trade takes it all the same: an essential is never left out.
    if (best === null || best.score <= 0.05) {
      let widestBay: { d: Draft; k: number; w: number } | null = null;
      for (const d of drafts) {
        for (let k = 0; k < d.geos.length; k++) {
          const cur = d.trades[k];
          if (d.slots[k] === "vacant" || !cur || d.fixed !== null || d.b.kind === "hotel" || essentials.includes(cur)) continue;
          if (!def.at.split("").some((c) => d.cls.includes(c))) continue;
          const w = d.geos[k]!.s1 - d.geos[k]!.s0;
          if (widestBay === null || w > widestBay.w) widestBay = { d, k, w };
        }
      }
      if (widestBay !== null) best = { d: widestBay.d, k: widestBay.k, score: 1 };
    }
    if (best !== null && best.score > 0.05) {
      bump(best.d.trades[best.k]!, -1);
      best.d.trades[best.k] = want;
      bump(want, 1);
    }
  }

  // ---- Pass C: each building.
  const out: BuildingUse[] = [];
  let apartmentNo = 0;
  let churchNo = 0;
  const takeName = (stem: string): string => {
    for (let t = 0; t < 40; t++) {
      let name: string;
      switch (stem) {
        case "church": {
          const saints = ctx.names.saints;
          name = `${saints[saints.length - 1 - (churchNo + t) % saints.length]!} Church`;
          break;
        }
        case "stevedore":
          name = `${pick(townRng, OWNER_SURNAMES)} Stevedoring`;
          break;
        default:
          name = chance(townRng, 0.5) ? `${pick(townRng, OWNER_SURNAMES)} Apartments` : `The ${pick(townRng, PLACE_WORDS)} Apartments`;
          break;
      }
      if (!taken(name)) {
        take(name);
        if (stem === "church") churchNo++;
        if (stem === "apartments") apartmentNo++;
        return name;
      }
    }
    return `${stem} ${churchNo + apartmentNo}`;
  };
  for (const d of drafts) out.push(finish(ctx, d, takeName));
  return out;
}


/** A town's post office is the United States', named so; a second would be the town's. */
function postOfficeName(ctx: BizCtx): string {
  const name = ctx.taken("United States Post Office") ? `${ctx.town} Post Office` : "United States Post Office";
  ctx.take(name);
  return name;
}

function widest(d: Draft): number {
  let k = 0;
  for (let j = 1; j < d.geos.length; j++) if (d.geos[j]!.s1 - d.geos[j]!.s0 > d.geos[k]!.s1 - d.geos[k]!.s0) k = j;
  return k;
}

// ---- Pass C.

function finish(ctx: BizCtx, d: Draft, takeName: (stem: string) => string): BuildingUse {
  const { b, frame } = d;
  const rng = sub(ctx.base, b.id, 2);
  const base: BuildingUse = { building: b.id, street: d.street, frame, units: [], stair: d.stair, upper: [], signs: [], windows: [], door: null };
  if (frame === null) return base;

  const units: Unit[] = [];
  const signs: Sign[] = [];
  const nameOf = (trade: Trade, decade: number): string => {
    const def = tradeDef(trade);
    const name = businessName(rng, { noun: def.noun, plain: def.plain, specials: def.specials, opened: decade, personal: PERSONAL.includes(trade), family: FAMILY.includes(trade) }, { town: ctx.town, streets: ctx.streetWords, families: ctx.families, taken: ctx.taken });
    ctx.take(name);
    return name;
  };
  for (let k = 0; k < d.geos.length; k++) {
    const g = d.geos[k]!;
    const av = d.avail[k]!;
    const slot = d.slots[k]!;
    const trade = d.trades[k] ?? null;
    const vacant = slot === "vacant" || trade === null;
    const fixedTrade: Trade | null = d.fixed ?? (b.kind === "hotel" && k === widest(d) ? "hotel" : null);
    const def: TradeDef | null = trade === null ? null : tradeDef(trade);
    let tenant: Tenant | null = null;
    let state: UnitState;
    let vacantSince: number | null = null;
    let past: PastTenant[] = [];
    if (!vacant && def !== null && trade !== null) {
      const opened = openedDecade(rng, b.era, def);
      const lm = d.landmark;
      const name = trade === "post office" ? postOfficeName(ctx) : (b.kind === "bank" || (b.kind === "hotel" && k === widest(d))) && lm !== null ? lm.name : nameOf(trade, opened);
      tenant = { trade, name, opened };
      state = slot === "closed" ? "closed for the day" : "open";
      past = chain(rng, ctx, d.cls, fixedTrade, b.era, opened, null, nameOf);
    } else {
      // Vacant: the last tenant left in a year of the town's decline; the longer ago, the likelier the windows are boarded.
      let k0 = 0;
      while (k0 < 45 && chance(rng, 0.93)) k0++;
      vacantSince = Math.min(NOW - 1, Math.max(dec(b.era) + 2, NOW - 1 - k0));
      const boarded = chance(rng, Math.max(0.1, Math.min(0.9, 0.15 + 0.035 * (NOW - vacantSince) + (d.district === "dock" ? 0.15 : 0))));
      state = boarded ? "vacant boarded" : "vacant for lease";
      past = chain(rng, ctx, d.cls, fixedTrade, b.era, null, vacantSince, nameOf);
    }
    const lit = state === "open";
    const opened = tenant?.opened ?? 0;
    const openings = coverAll(rng, g, state, def);
    const roomDepth = r1(Math.min(frame.depth - 0.3, Math.max(4, Math.min(24, frame.depth - range(rng, 1.5, 4)))));
    const ceiling = r1(Math.min(b.era < 1930 ? 4.3 : b.era < 1970 ? 3.6 : 3.1, b.height - 0.7) - (g.remodel?.what === "dropped fascia" ? 0.4 : 0));
    const type = vacant ? "empty" : def!.interior;
    const room = furnish({ rng, type, trade, lit, s0: g.s0, s1: g.s1, depth: roomDepth, ceiling, doorS: g.door.s, doorW: g.door.width, openings });
    const usigns = unitSigns({
      rng, ctx, b, frame, district: d.district,
      lotOut: b.kind === "gas station" || b.kind === "motel" ? 0 : d.lotOut,
      s0: g.s0, s1: g.s1, a: av.a, bEnd: av.b, door: g.door, fascia: g.fascia, state, trade, name: tenant?.name ?? "", opened, past, vacantSince, openings,
    });
    if (b.kind === "gas station" && !vacant) usigns.push(gasSign(rng, pickBrand(rng), Math.max(b.era, dec(tenant!.opened)), d.lotOut, frame, state === "open"));
    if (b.kind === "motel" && !vacant) usigns.push(motelSign(rng, tenant!.name, Math.max(b.era, tenant!.opened), "open", d.lotOut, frame));
    units.push({
      id: k, s0: g.s0, s1: g.s1, door: g.door, openings, fascia: g.fascia, state, tenant, lit, vacantSince, past, remodel: g.remodel,
      interior: { type, depth: roomDepth, ceiling, furnishings: room.furnishings, lights: room.lights }, signs: usigns,
    });
  }
  signs.push(...civicOf(ctx, d, units.length > 0, rng, takeName));

  // Upper storeys, and the dwellings' windows.
  const upper: UpperUse[] = [];
  let windows: WindowState[] = [];
  let door: BuildingUse["door"] = null;
  if (b.kind === "house" || b.kind === "apartment") {
    const w = dwelling(rng, frame, b.storeys, b.state);
    windows = w.windows;
    door = w.door;
  } else if (b.state !== "ruin" && b.storeys > 1 && UNIT_KINDS.includes(b.kind) && units.length > 0) {
    for (let st = 1; st < b.storeys; st++) {
      const use = upperUse(rng, b, st);
      upper.push({ storey: st, use, windows: upperFloor(rng, frame, st, use, b.state) });
    }
  }
  return { ...base, units, upper, signs, windows, door };
}

/** Kinds whose signs are the building's own (a church's board, the school's name); a unit's signs are on the unit. */
const CIVIC: readonly Building["kind"][] = ["church", "school", "hospital", "courthouse", "federal building", "office", "customs house", "depot", "tsunami refuge", "lodge hall", "fire hall", "port terminal shed", "cannery", "mill shed", "silo", "warehouse", "apartment", "junkyard", "shake mill"];

/** The civic or industrial building's own signs (and an untenanted warehouse's). */
function civicOf(ctx: BizCtx, d: Draft, hasUnits: boolean, rng: Rng, takeName: (stem: string) => string): Sign[] {
  if (d.frame === null || !CIVIC.includes(d.b.kind) || (d.b.kind === "warehouse" && hasUnits)) return [];
  return civicSigns({ rng, ctx, b: d.b, frame: d.frame, lotOut: d.lotOut, landmark: d.landmark?.name ?? null, takeName });
}

/** What a floor above a shop is used for. */
function upperUse(rng: Rng, b: Building, storey: number): UpperUse["use"] {
  if (b.state === "vacant") return "empty";
  switch (b.kind) {
    case "hotel":
    case "boarding house":
    case "motel":
      return "hotel rooms";
    case "lodge hall":
      return storey === 1 ? "lodge hall" : weighted(rng, [["apartments", 3], ["storage", 3], ["empty", 3]] as const);
    case "warehouse":
      return "storage";
    case "federal building":
    case "bank":
      return weighted(rng, [["offices", 6], ["empty", 4]] as const);
    default:
      return weighted(rng, [["apartments", b.era < 1970 ? 45 : 25], ["offices", 30], ["storage", 15], ["empty", 20]] as const);
  }
}

/** The windows of a bay with their coverings: what the street can see in. */
function coverAll(rng: Rng, g: Geo, state: UnitState, def: TradeDef | null): Opening[] {
  const n = g.openings.length;
  // The window the last tenant papered over (a vacant unit's) is one only; boarded fronts are boarded throughout.
  let bricked = -1;
  if (g.remodel?.what === "bricked window" && n > 0) {
    // The opening farthest from the door.
    let far = -1;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs((g.openings[i]!.s0 + g.openings[i]!.s1) / 2 - g.door.s);
      if (dd > far) {
        far = dd;
        bricked = i;
      }
    }
  }
  let papered = -1;
  if (state === "vacant for lease" && n > 0) {
    papered = int(rng, 0, n - 1);
    if (papered === bricked) papered = (papered + 1) % n;
  }
  const res: Opening[] = [];
  for (let i = 0; i < n; i++) {
    const o = g.openings[i]!;
    let cover: WindowCover;
    if (i === bricked) cover = "bricked";
    else if (state === "vacant boarded") cover = chance(rng, 0.2) ? "papered" : "boarded";
    else if (state === "vacant for lease") cover = i === papered && (n > 1 || chance(rng, 0.5)) ? "papered" : "none";
    else if (def === null) cover = "none";
    else {
      const r = range(rng, 0, 1);
      switch (def.interior) {
        case "office":
          // Blinds on a quarter of an office's windows (not half: an office looks into the street like a shop does, and a drawn blind hides the room).
          cover = r < 0.25 ? "blinds" : "none";
          break;
        case "bar":
          cover = r < 0.18 ? "blinds" : "none";
          break;
        case "retail aisles":
          cover = r < 0.5 ? "display" : "none";
          break;
        case "counter service":
        case "dining room":
          cover = r < 0.2 ? "display" : "none";
          break;
        default:
          cover = "none";
          break;
      }
    }
    res.push({ ...o, cover });
  }
  return res;
}

/**
 * The earlier tenants of a bay, oldest first. A building has usually had several in its life (one in about every two decades); a bay
 * that is vacant now includes the tenant that left in `vacantSince`; one that is open includes those before the present tenant's decade.
 */
function chain(rng: Rng, ctx: BizCtx, cls: string, fixed: Trade | null, era: number, opened: number | null, vacantSince: number | null, nameOf: (t: Trade, decade: number) => string): PastTenant[] {
  const eraD = dec(era);
  const top = vacantSince !== null ? dec(vacantSince) : (opened ?? 0) - 10;
  const decades: number[] = [];
  for (let x = eraD; x <= top; x += 10) decades.push(x);
  if (decades.length === 0) return [];
  const n = Math.min(4, decades.length, Math.max(vacantSince !== null ? 1 : 0, Math.round(decades.length * 0.5) + (chance(rng, 0.4) ? 1 : 0)));
  if (n === 0) return [];
  const starts: number[] = [decades[0]!];
  const rest = decades.slice(1);
  for (let j = 1; j < n && rest.length > 0; j++) {
    const at = int(rng, 0, rest.length - 1);
    starts.push(rest[at]!);
    rest.splice(at, 1);
  }
  starts.sort((p, q) => p - q);
  const out: PastTenant[] = [];
  let prev: Trade | null = null;
  for (let j = 0; j < starts.length; j++) {
    const from = starts[j]!;
    const last = j === starts.length - 1;
    const trade: Trade = fixed ?? pastTrade(rng, ctx, cls, from, prev);
    let to: number;
    if (!last) to = starts[j + 1]! + int(rng, 0, 6);
    else if (vacantSince !== null) to = Math.max(from, vacantSince);
    else to = Math.max(from, (opened ?? from) - 1 + int(rng, 0, 3));
    out.push({ trade, name: nameOf(trade, from), from, to });
    prev = trade;
  }
  return out;
}

