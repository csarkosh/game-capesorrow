/**
 * The world's own site for a world seed, for the map page and the tests: `siteFor`, read off the coast,
 * with the made ground's reach inland raised to at least 320 m (the value the site is moving to), so that
 * a plan looked at here is the plan the game will get whatever `siteFor`'s own value is today.
 */
import "../terrain.js";
import { siteFor } from "../sim/town/siteFor.js";
import type { TownSite } from "../sim/town/site.js";

export const MIN_INLAND = 320;

const SITES = new Map<number, TownSite>();

export function realSite(worldSeed: number): TownSite {
  let site = SITES.get(worldSeed);
  if (site === undefined) {
    const read = siteFor(worldSeed);
    site = read.inland >= MIN_INLAND ? read : { ...read, inland: MIN_INLAND };
    SITES.set(worldSeed, site);
  }
  return site;
}
