/**
 * Which trade a unit holds, today and before.
 *
 * A trade's weight is its counted weight (`trades.ts`) times its multiplier for the district, times how well the unit's frontage
 * suits it, times what the town's history asks. THE HISTORY'S RULES, each tested:
 *  - marine trades (bait and tackle, marine supply, a fish market, a boat yard) only where the town fishes: the history's cargo is
 *    seafood or it began as a cannery, or it has a cannery or working boats in its harbour;
 *  - a union hall where the town's mill was or is a working one (every town's is), and a saw and chain shop likewise;
 *  - lawyers, a title company and a bail bondsman at the county seat, and none of the last two elsewhere;
 *  - kites and taffy only on the tourist road (the history's highway strip), and more galleries and gift shops there;
 *  - trades never open before their invention: an espresso stand after 1990, a cannabis shop after 2010, a credit union after 1950.
 */
import { chance, weighted, type Rng } from "../../rng.js";
import type { Trade } from "../../types.js";
import { districtIndex, type BizCtx } from "./ctx.js";
import { TRADES, tradeDef, type TradeDef } from "./trades.js";

/** How well a bay of width `w` suits a trade. */
export function fit(d: TradeDef, w: number): number {
  if (w < d.minW - 1.5) return 0;
  if (w < d.minW) return 0.3;
  if (w > d.maxW * 1.6) return 0.15;
  if (w > d.maxW) return 0.6;
  return 1;
}

/** The history's factor on a trade: 0 where the town may not have it. */
function allowed(ctx: BizCtx, d: TradeDef): number {
  switch (d.tag) {
    case "marine":
      return ctx.fishing ? 1 : 0;
    case "mill":
      return ctx.millTown ? 1 : 0;
    case "seat":
      return ctx.seat ? 1 : 0;
    case "tourist":
      return ctx.tourist ? 1 : 0;
    default:
      break;
  }
  let k = 1;
  if (ctx.tourist && (d.id === "gallery" || d.id === "gift shop")) k *= 2;
  if (ctx.seat && (d.id === "law office" || d.id === "tax office")) k *= 2;
  if (ctx.fishing && (d.id === "tavern" || d.id === "diner")) k *= 1.2;
  return k;
}

/** The letters of the trades a building of this class holds. */
function atOk(d: TradeDef, cls: string): boolean {
  for (const c of cls) if (d.at.includes(c)) return true;
  return false;
}

/** A trade for a bay open today, or null if none will do. `counts` holds how many of each the town already has (to hold each trade's cap). */
export function pickTrade(rng: Rng, ctx: BizCtx, cls: string, district: string, width: number, counts: Readonly<Record<string, number>>): Trade | null {
  const di = districtIndex(district);
  const items: (readonly [Trade, number])[] = [];
  for (const d of TRADES) {
    if (d.until !== null || d.w < 2 || !atOk(d, cls)) continue;
    if ((counts[d.id] ?? 0) >= d.cap) continue;
    const w = d.w * d.mul[di]! * fit(d, width) * allowed(ctx, d);
    if (w > 0) items.push([d.id, w]);
  }
  if (items.length === 0) return null;
  return weighted(rng, items);
}

/** The trade an earlier tenant held in `decade`: any that existed then and that the town may hold, not the one beside it in time (`avoid`). */
export function pastTrade(rng: Rng, ctx: BizCtx, cls: string, decade: number, avoid: Trade | null): Trade {
  const items: (readonly [Trade, number])[] = [];
  for (const d of TRADES) {
    if (d.w < 2 || !atOk(d, cls) || d.id === avoid || d.id === "post office") continue;
    if (d.from > decade + 9 || (d.until !== null && decade > d.until)) continue;
    // A bank, a pharmacy or a newspaper is one or two to a town: not the tenant of every bay in its time.
    const w = d.w * allowed(ctx, d) * (d.cap <= 2 ? 0.25 : 1);
    if (w > 0) items.push([d.id, w]);
  }
  // A class with no trades of its own (a gas station, a motel) is held by the same trade.
  if (items.length === 0) return avoid ?? "grocery";
  return weighted(rng, items);
}

/** The decade a tenant of a unit opened: recent more often than not (a turnover of about two decades), never before the building's era or the trade's invention. */
export function openedDecade(rng: Rng, era: number, d: TradeDef): number {
  let k = 0;
  while (k < 13 && chance(rng, 0.68)) k++;
  return Math.max(era, d.from, 2020 - 10 * k);
}

export const countOf = (counts: Record<string, number>, t: Trade): number => counts[t] ?? 0;
export { tradeDef };
