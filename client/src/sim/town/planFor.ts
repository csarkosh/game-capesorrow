/**
 * The town's plan for a world's seed: `planTown` on the site `siteFor` reads off the coast. A pure
 * function of the world's seed, cached (the cache is only a lookup of what the function already
 * answered, never walked).
 */
import { planTown } from "./plan.js";
import { siteFor } from "./siteFor.js";
import type { TownPlan } from "./types.js";

const PLANS = new Map<number, TownPlan>();

/** The large port's plan for a world's seed. */
export function planFor(worldSeed: number): TownPlan {
  let plan = PLANS.get(worldSeed);
  if (plan === undefined) {
    plan = planTown(siteFor(worldSeed), "port");
    PLANS.set(worldSeed, plan);
  }
  return plan;
}
