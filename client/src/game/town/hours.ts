/**
 * When a unit is open. This is the drawing's, not the simulation's: the plan says what a unit is (its trade) and whether it is open or
 * shut for the day, and these hours say what a business of that trade keeps in a small coastal town. A room's light follows them
 * (`townMaterial.ts` dims a shut room by the hour of day) and so do its people (`peopleParts.ts` shows nobody in a shut unit).
 *
 * Pure: no engine, no DOM. The same trade and the same unit seed give the same hours on every machine.
 *
 * An hour is whole, 0 to 23; a close of midnight is written 0. A `close` less than the `open` means the unit shuts after midnight (a
 * tavern, 11 to 2). Each unit's own opening and closing are moved by an hour or none from the table's, by a hash of its seed, so that a
 * street does not go dark in one minute.
 *
 * A vertex of a room carries its unit's hours as one number (`hoursCode`) in a float it has to spare, and the shader decodes it with the
 * arithmetic of `openShare` below, written from this file's own constants (`townMaterial.ts`).
 *
 * **Night codes** are a second band of codes above `ALWAYS_CODE`, for what follows the dark and not a shop's day: a street lamp's lens, a
 * home's lit window, a porch light. A night code is an on-step and an off-step: on at dusk less half an hour plus the step times four
 * minutes (a lamp comes on up to about three hours after dusk, each a few minutes from its neighbour like a photocell), off at a quarter
 * hour of the night from 20:00 to 02:30 or, with the last off-step, at dawn. `nightCode` makes one and `nightShare` reads it, with a fade
 * of two minutes each side (a lamp does not take ten minutes to come on); the shader's decode (`townMaterial.ts`, `HOURS_CODE`) is the
 * same arithmetic from the same constants. The night is measured from noon (12 up to 36), so an off-step after midnight is later than an
 * on-step in the evening and a pair whose off is before its on is simply never lit.
 */
import type { Building, Trade, Unit } from "../../sim/town/types.js";
import { hashN } from "./groundNoise.js";

export type Hours = { readonly open: number; readonly close: number } | "always";

/** The hours of a day. */
export const HOURS_PER_DAY = 24;
/** A pair's code is `CODE_BASE + open * CODE_STRIDE + close`: 1 to 576, so every code is exact in a 16-bit float. */
export const CODE_BASE = 1;
export const CODE_STRIDE = 24;
/** The code of a unit that is never shut. */
export const ALWAYS_CODE = 600;
/**
 * Dusk and dawn, the hours the sun goes under and comes back over 2 degrees of altitude (the engine's own `sunAltitudeDeg`; a test holds that
 * these two agree with it, so a change to the engine's sun fails there and does not leave lamps on at noon).
 */
export const DUSK_HOUR = 18.14;
export const DAWN_HOUR = 5.86;
/** The night codes: 601 up to 2000, all exact in a 16-bit float (whole numbers are exact to 2048). */
export const NIGHT_BASE = ALWAYS_CODE + 1;
/** A lamp's on-steps: on at `DUSK_HOUR - NIGHT_LEAD_HOURS + step * ON_STEP_HOURS`, 50 of them (to about 2.8 hours after dusk). */
export const ON_STEPS = 50;
export const ON_STEP_HOURS = 1 / 15;
export const NIGHT_LEAD_HOURS = 0.5;
/** The off-steps: the quarter hours from `OFF_FIRST_HOUR` (20:00) to 02:30, 27 of them, and the last, 27, which is dawn. */
export const OFF_STEPS = 28;
export const OFF_STEP_HOURS = 0.25;
export const OFF_FIRST_HOUR = 20;
export const UNTIL_DAWN = OFF_STEPS - 1;
/** How long a night lamp takes to come on or go out, hours each side of its time (two minutes). */
export const NIGHT_FADE_HOURS = 1 / 30;

/** How long the lights take to come up and to go down, hours: they change over this much either side of the hour (a sixth of an hour each way). */
export const FADE_HOURS = 1 / 6;

const always: Hours = "always";
const h = (open: number, close: number): Hours => ({ open, close });

/** The kinds of building that are never shut (the plan keeps them from being shut for the day: `business/index.ts`, `ROUND_THE_CLOCK`). */
const ROUND_THE_CLOCK: readonly Building["kind"][] = ["gas station", "motel", "hotel", "boarding house"];

const OFFICE = h(9, 17);
const RETAIL = h(10, 18);
const EARLY = h(8, 17);

/**
 * The hours of each trade, authored. Where the owner's list did not name a trade, a line says what such a business keeps: a feed store
 * opens with the farm's day, a video store and a cigar store stay open into the evening, and the trades of the past only (none is open
 * now; they have a line so that a table with a missing one is a failing test) keep a shop's day.
 */
const TABLE: Readonly<Record<Trade, Hours>> = {
  "gas station": always, "motel": always, "hotel": always, "rooming house": always, "lodge": always, "bail bonds": always, "self storage": always,
  "convenience store": h(6, 0), "tavern": h(11, 2), "laundromat": h(6, 23), "cannabis shop": h(9, 23), "liquor store": h(10, 23),
  "pizza and burgers": h(11, 23), "movie theater": h(16, 0), "smoke shop": h(10, 22), "restaurant": h(11, 22), "grocery": h(7, 22),
  "diner": h(6, 21), "pharmacy": h(9, 21), "tattoo parlor": h(12, 20), "union hall": h(9, 21),
  "insurance office": OFFICE, "real estate office": OFFICE, "law office": OFFICE, "tax office": OFFICE, "title company": OFFICE, "bank": OFFICE,
  "credit union": OFFICE, "post office": OFFICE, "newspaper office": OFFICE, "funeral home": OFFICE, "print shop": OFFICE,
  "medical clinic": h(8, 18), "dentist": h(8, 17), "veterinarian": h(8, 17),
  "bakery": h(6, 15), "cafe": h(6, 17), "espresso stand": h(5, 16), "bait and tackle": h(5, 18), "fish market": h(8, 17), "boat yard": h(7, 16),
  "marine supply": h(7, 17), "hardware": h(7, 18), "auto repair": EARLY, "auto parts": EARLY, "tire shop": EARLY, "saw and chain shop": EARLY,
  "garden and feed": EARLY, "food bank": h(10, 14),
  "clothing": RETAIL, "variety store": RETAIL, "jeweler": RETAIL, "bookstore": RETAIL, "game shop": RETAIL, "gift shop": RETAIL, "gallery": RETAIL,
  "kite shop": RETAIL, "candy shop": RETAIL, "antiques": RETAIL, "thrift store": RETAIL, "pawn shop": RETAIL, "sporting goods": RETAIL,
  "furniture store": RETAIL, "hair salon": h(9, 18), "barber": h(9, 18),
  // Trades of the past only.
  "dry goods": RETAIL, "five and dime": RETAIL, "shoe repair": RETAIL, "cigar store": h(10, 22), "photo studio": RETAIL, "video store": h(11, 21),
  "feed store": EARLY, "hat shop": RETAIL,
};

/** Every trade that has a line (a test holds that none is missing). */
export const TRADES_WITH_HOURS: readonly Trade[] = Object.keys(TABLE) as Trade[];

export const wrapHour = (x: number): number => ((x % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;

/** -1, 0 or +1 hour by a hash of the unit's seed and what is moved: none in three of five, one either way in one of five each. */
function nudge(seed: number, salt: number): number {
  const r = hashN(seed, salt, 0, 4417);
  return r < 0.2 ? -1 : r >= 0.8 ? 1 : 0;
}

/**
 * The hours of a unit of `trade` in a building of `buildingKind`, moved by its own `seed`; null for a unit that has none (a vacant one,
 * of no trade). A unit of a building that never shuts is always open, whatever its trade.
 */
export function hoursOf(trade: Trade | null, buildingKind: Building["kind"], seed: number): Hours | null {
  if (trade === null) return null;
  const base = ROUND_THE_CLOCK.includes(buildingKind) ? always : TABLE[trade];
  if (base === "always") return always;
  return { open: wrapHour(base.open + nudge(seed, 1)), close: wrapHour(base.close + nudge(seed, 2)) };
}

/** The hours of a unit as the drawing keeps them: none for a unit the plan has shut for the day (it is unlit at every hour) or vacant. */
export function unitHours(b: Building, u: Unit): Hours | null {
  return u.state === "open" ? hoursOf(u.tenant?.trade ?? null, b.kind, b.id * 31 + u.id) : null;
}

/** Whether a unit with these hours is open at `hour` (0 up to 24). */
export function isOpen(hours: Hours, hour: number): boolean {
  if (hours === "always") return true;
  const t = wrapHour(hour);
  return hours.open < hours.close ? t >= hours.open && t < hours.close : t >= hours.open || t < hours.close;
}

/**
 * How lit a unit is at `hour`, 0 to 1: 1 well inside its hours, 0 well outside, and half at the hour itself, rising and falling over
 * `FADE_HOURS` each side of it. A pure function of the hour, so the shader and the people agree. (The shader's own text is the same
 * arithmetic: the distance to the nearer edge, which way it lies, and a ramp.)
 */
export function openShare(hours: Hours, hour: number): number {
  if (hours === "always") return 1;
  const t = wrapHour(hour);
  const edge = (e: number): number => {
    const d = Math.abs(t - e);
    return Math.min(d, HOURS_PER_DAY - d);
  };
  const near = Math.min(edge(hours.open), edge(hours.close));
  const k = 0.5 + ((isOpen(hours, t) ? 1 : -1) * near) / (2 * FADE_HOURS);
  return Math.min(1, Math.max(0, k));
}

/** The hours as one number a vertex can carry in a 16-bit float, exactly: 0 for none, `ALWAYS_CODE` for always, else the pair's. */
export function hoursCode(hours: Hours | null): number {
  if (hours === null) return 0;
  if (hours === "always") return ALWAYS_CODE;
  return CODE_BASE + hours.open * CODE_STRIDE + hours.close;
}

/** The hours a code stands for (the test's, and for reading a record back). */
export function hoursOfCode(code: number): Hours | null {
  if (code <= 0) return null;
  if (code === ALWAYS_CODE) return always;
  if (code > ALWAYS_CODE) return null;
  const k = code - CODE_BASE;
  const open = Math.floor(k / CODE_STRIDE);
  return { open, close: k - open * CODE_STRIDE };
}

/** The code of a night pair: `on` 0 to 49 (`ON_STEPS`), `off` 0 to 27 (`OFF_STEPS`; `UNTIL_DAWN` is dawn). */
export function nightCode(on: number, off: number): number {
  return NIGHT_BASE + on * OFF_STEPS + off;
}

/** Whether a code is a night code. */
export function isNightCode(code: number): boolean {
  return code >= NIGHT_BASE && code < NIGHT_BASE + ON_STEPS * OFF_STEPS;
}

/** When a night code comes on and goes off, in hours from noon (12 up to 36: 24.5 is half past midnight). */
export function nightTimes(code: number): { on: number; off: number } {
  const k = code - NIGHT_BASE;
  const on = Math.floor(k / OFF_STEPS);
  const off = k - on * OFF_STEPS;
  return {
    on: DUSK_HOUR - NIGHT_LEAD_HOURS + on * ON_STEP_HOURS,
    off: off >= UNTIL_DAWN ? DAWN_HOUR + HOURS_PER_DAY : OFF_FIRST_HOUR + off * OFF_STEP_HOURS,
  };
}

/**
 * How lit a night code is at `hour`, 0 to 1: 0 by day, 1 between its times, half at a time itself and ramping over `NIGHT_FADE_HOURS`
 * either side. (The shader's own text is the same arithmetic.)
 */
export function nightShare(code: number, hour: number): number {
  const { on, off } = nightTimes(code);
  const t = wrapHour(hour);
  if (off <= on) return 0;
  const n = t >= 12 ? t : t + HOURS_PER_DAY;
  const near = Math.min(Math.abs(n - on), Math.abs(n - off));
  const inside = n >= on && n < off;
  return Math.min(1, Math.max(0, 0.5 + ((inside ? 1 : -1) * near) / (2 * NIGHT_FADE_HOURS)));
}
