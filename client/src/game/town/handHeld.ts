/**
 * What a person holds in their right hand: the models carry a paper coffee cup and a phone as two small primitives skinned to that hand, and a body
 * is drawn with the one its clip holds and with none other. Pure: `peopleParts.ts` draws by it, and the tests hold it.
 *
 * A `cup` clip holds the cup. A `drink` clip holds it too, but only in a room where a paper cup is what is served: a cafe, a bakery, a diner, an
 * espresso stand or a convenience store (at a tavern, a bar or a restaurant a `drink` is a glass the clip's own hand makes, so no cup is drawn).
 * A `phone`, a `call` and a `sit_phone` clip hold the phone, anywhere. Every other clip holds nothing.
 */
import type { TownPlan, Trade } from "../../sim/town/types.js";
import type { Activity } from "./people.js";

export type Held = "cup" | "phone" | null;

/** The trades whose `drink` is a paper cup. */
export const PAPER_CUP_TRADES: readonly Trade[] = ["cafe", "bakery", "diner", "espresso stand", "convenience store"];

/** What a body playing `activity` holds, where `trade` is the trade of the unit they are at (null outdoors, or at no unit). */
export function heldBy(activity: Activity, trade: Trade | null): Held {
  if (activity === "cup") return "cup";
  if (activity === "drink") return trade !== null && PAPER_CUP_TRADES.includes(trade) ? "cup" : null;
  if (activity === "phone" || activity === "call" || activity === "sit_phone") return "phone";
  return null;
}

/** The trade of the unit `unit` of `building`, or null where there is none (a bench, a corner, the quay, a vacant unit). */
export function tradeAt(plan: TownPlan, building: number, unit: number): Trade | null {
  if (unit < 0) return null;
  return plan.uses.find((u) => u.building === building)?.units.find((u) => u.id === unit)?.tenant?.trade ?? null;
}
