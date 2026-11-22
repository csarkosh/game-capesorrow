/** Shared by the town tests: the synthetic sites, and plans made once per seed. */
import { planTown } from "../../src/sim/town/plan.js";
import type { TownSite } from "../../src/sim/town/site.js";
import type { TownPlan } from "../../src/sim/town/types.js";
import { syntheticSite } from "../../src/townMap/syntheticSite.js";

export { syntheticSite };

/** Forty seeds, 1 to 40. */
export const SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => i + 1);

const cache: { seed: number; site: TownSite; plan: TownPlan }[] = [];

/** The site and the large port's plan for a seed, made once. */
export function townFor(seed: number): { site: TownSite; plan: TownPlan } {
  const hit = cache.find((c) => c.seed === seed);
  if (hit) return hit;
  const site = syntheticSite(seed);
  const entry = { seed, site, plan: planTown(site, "port") };
  cache.push(entry);
  return entry;
}

/** A plain 32-bit hash of a plan's JSON, to pin a plan down. */
export function digest(plan: TownPlan): string {
  const text = JSON.stringify(plan);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
