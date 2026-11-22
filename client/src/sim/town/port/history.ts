/**
 * The large port's history: drawn first, and every part of the form is derived from it. The draws
 * follow what the research found real Washington ports to be: a sawmill for most, a cannery, a
 * government act (customs), or a railroad terminus bet that came good; a claimant's plat along the
 * water and a land company's or railroad's to the compass behind it; a railroad along the shore;
 * a fire that rebuilt the core in brick; the 1893 bust; a county seat that is often elsewhere; the
 * public port after 1911; a mill that closed between 1980 and 2009 or still works.
 */
import { bearingsBetween, type Bearing } from "../bearings.js";
import { chance, int, next, pick, weighted, type Rng } from "../rng.js";
import type { ShoreFacts } from "../shore.js";
import { townNameFor, type TownNames } from "../names.js";
import type { EventKind, FirstPlatBasis, FoundingPurpose, History, HistoryEvent, PortCargo } from "../types.js";

/** The smallest angle off the compass at which a plat is laid "to the shore" or "to the cove": below it, the first plat was laid to something else. */
const SHORE_MIN_DEG = 25;

/** What the first plat is laid to, and so the bearing: the shore's own line when it runs far enough off the compass, else the cove's flank, else the first wharf. */
export function firstPlatBasis(rng: Rng, shore: ShoreFacts): { basis: FirstPlatBasis; bearing: Bearing } {
  if (Math.abs(shore.bearing.deg) >= SHORE_MIN_DEG) return { basis: "shore", bearing: shore.bearing };
  // The cove's flank: the steeper of the two sides of the cove.
  const flank = Math.abs(shore.flankNorth.deg) >= Math.abs(shore.flankSouth.deg) ? shore.flankNorth : shore.flankSouth;
  if (Math.abs(flank.deg) >= SHORE_MIN_DEG) return { basis: "cove", bearing: flank };
  // The shore runs near the compass: the claimant laid his plat to the line of his wharf, which ran
  // out at an angle to reach deep water. The angle is drawn from the table, 28 to 50 degrees off the compass.
  const options = bearingsBetween(28, 50);
  return { basis: "wharf", bearing: pick(rng, options) };
}

const BASIS_TEXT: Record<FirstPlatBasis, string> = {
  shore: "laid out along the water, its streets running with the shore",
  cove: "laid out to the flank of the cove, its streets turned to follow the curve of the water",
  wharf: "laid out to the line of his wharf, which ran out at a slant to reach deep water, so the streets lean away from the compass",
};

const PURPOSE_TEXT: Record<FoundingPurpose, (founder: string, town: string) => string> = {
  sawmill: (f, t) => `${f} builds a steam sawmill at the head of the cove, and ${t} gathers around it.`,
  cannery: (f, t) => `${f} sets up a salmon cannery on pilings in the cove, and ${t} grows up beside it.`,
  customs: (f, t) => `An act of Congress makes ${t} a port of entry, and ${f} is sent as its first collector.`,
  railhead: (f, t) => `${f} stakes a claim on the cove on the word that a railroad will end here, and calls the place ${t}.`,
};

/** Draws the history of one large port from the history stream. */
export function makeHistory(rng: Rng, names: TownNames, shore: ShoreFacts): { history: History; townName: string } {
  const purpose = weighted<FoundingPurpose>(rng, [
    ["sawmill", 5],
    ["cannery", 2],
    ["customs", 2],
    ["railhead", 2],
  ]);
  const townName = townNameFor(names, purpose, rng);
  const foundingYear =
    purpose === "sawmill" ? int(rng, 1851, 1875) : purpose === "customs" ? int(rng, 1851, 1866) : purpose === "cannery" ? int(rng, 1870, 1889) : int(rng, 1883, 1889);
  const founder = names.founder;

  const { basis, bearing } = firstPlatBasis(rng, shore);
  const firstPlatYear = foundingYear + int(rng, 0, 2);
  const secondBy: "land company" | "railroad" = purpose === "railhead" ? "railroad" : chance(rng, 0.3) ? "railroad" : "land company";
  const secondLo = Math.max(1883, firstPlatYear + 1);
  const secondYear = int(rng, Math.min(secondLo, 1892), 1892);
  const secondCompany = secondBy === "railroad" ? names.railroad : names.company;

  const hasRail = purpose === "railhead" || secondBy === "railroad" || chance(rng, 0.75);
  const railYear = hasRail ? (purpose === "railhead" || secondBy === "railroad" ? secondYear + int(rng, 0, 4) : int(rng, Math.max(1888, secondYear), 1912)) : 0;

  const hasFire = chance(rng, 0.65);
  const fireYear = hasFire ? int(rng, 1889, 1922) : 0;
  const burned = hasFire ? weighted<"core" | "both">(rng, [["core", 4], ["both", 5]]) : "core";

  const bust = chance(rng, 0.55);
  const peakYear = bust ? int(rng, 1889, 1892) : int(rng, 1900, 1912);

  const isSeat = chance(rng, 0.28);
  const seatYear = int(rng, 1862, 1900);

  const portYear = int(rng, 1911, 1921);
  const handles = weighted<PortCargo>(rng, [["logs", 3], ["grain", 2], ["seafood", 2], ["autos", 1], ["general cargo", 2]]);

  const millStart = purpose === "sawmill" ? foundingYear : int(rng, Math.max(1885, foundingYear), 1915);
  const working = chance(rng, 0.35);
  const closedYear = working ? null : int(rng, 1980, 2009);
  const cleanup = !working && chance(rng, 0.6);

  let vacant = 0.1 + (bust ? 0.1 : 0) + (working ? 0 : 0.08) + (hasFire ? 0 : 0.04) + next(rng) * 0.14;
  vacant = Math.round(Math.min(0.45, vacant) * 100) / 100;
  const tsunamiRefuge = chance(rng, 0.7);
  const highwayStrip = chance(rng, 0.85);

  const events: HistoryEvent[] = [];
  const ev = (year: number, kind: EventKind, text: string): void => {
    events.push({ year, kind, text });
  };
  ev(foundingYear, "founding", PURPOSE_TEXT[purpose](`${names.founderGiven} ${founder}`, townName));
  ev(firstPlatYear, "first plat", `${names.claimant} files the town's first plat, ${BASIS_TEXT[basis]}.`);
  ev(
    secondYear,
    "second plat",
    `The ${secondCompany} plats the land behind the water to the compass, with ${names.avenue}, a hundred feet wide, running up from the harbour. Where its grid meets the first, the streets do not line up.`,
  );
  if (hasRail) {
    ev(
      railYear,
      "railroad",
      secondBy === "railroad" || purpose === "railhead"
        ? `The ${names.railroad} reaches ${townName} and lays its track along the shore, between the water and the town.`
        : `The ${names.railroad} reaches ${townName} and lays its track along the shore, between the water and the town, cutting the waterfront off from the streets.`,
    );
  }
  ev(peakYear, "boom", `${townName} counts its boom: hotels, banks and brick blocks go up, and the empty blocks of the new plat are sold on the strength of what is coming.`);
  if (bust) ev(1893, "bust", `The panic of 1893 stops the boom. Builders leave, lots stand empty, and what was built before the crash is what the town keeps.`);
  if (hasFire) {
    ev(
      fireYear,
      "fire",
      burned === "core"
        ? `Fire burns the wooden business blocks of ${townName}; it is rebuilt in ${fireYear >= 1922 ? "concrete and brick" : "brick"}, and the main street is widened.`
        : `Fire runs along the piles and burns the wooden core and the waterfront of ${townName} together; both are rebuilt in ${fireYear >= 1922 ? "concrete and brick" : "brick"}, and the main street is widened.`,
    );
  }
  if (isSeat) ev(seatYear, "county seat", `${townName} wins the county seat from ${names.seatTown}, and builds a courthouse on the hill.`);
  else ev(seatYear, "county seat", `The county seat goes to ${names.seatTown}, inland, though ${townName} is the larger town and pays most of the county's taxes.`);
  ev(portYear, "port", `Voters create the Port of ${townName} under the Port District Act of 1911; its terminal handles ${handles} today.`);
  if (millStart > foundingYear || purpose !== "sawmill") {
    ev(millStart, "mill", `The ${names.millCompany} opens a mill on the shore beside the town, and builds rows of houses for its workers.`);
  }
  if (working) {
    ev(2000, "mill", `The ${names.millCompany}'s mill still runs, with a smaller crew every decade.`);
  } else {
    ev(
      closedYear!,
      "mill",
      cleanup
        ? `The ${names.millCompany}'s mill closes, and its site goes under a state cleanup order; most of it has been cleared.`
        : `The ${names.millCompany}'s mill closes. Its site stands fenced and unsold, the sheds left as they were.`,
    );
  }
  ev(
    2026,
    "present",
    `Today ${Math.round(vacant * 100)} in 100 storefronts in the core stand vacant${tsunamiRefuge ? ", a tower on the hill is the town's refuge from the tsunami" : ""}${highwayStrip ? ", and motels, a big-box store and gas stations line the highway" : ""}.`,
  );

  // A total order: by year, then by the order they were drawn.
  const order = events.map((e, i) => ({ e, i }));
  order.sort((p, q) => p.e.year - q.e.year || p.i - q.i);

  const history: History = {
    kind: "port",
    founding: { purpose, year: foundingYear, founder },
    firstPlat: { year: firstPlatYear, by: names.claimant, basis, bearing },
    secondPlat: { year: secondYear, by: secondBy, company: secondCompany },
    railroad: hasRail ? { year: railYear } : null,
    fire: hasFire ? { year: fireYear, burned } : null,
    boom: { peakYear, bust1893: bust },
    countySeat: { isSeat, seatTown: names.seatTown, county: names.county, year: seatYear },
    port: { year: portYear, handles },
    mill: { company: names.millCompany, startYear: millStart, fate: working ? "working" : "closed", closedYear, cleanup },
    present: { vacantShare: vacant, tsunamiRefuge, highwayStrip },
    events: order.map((o) => o.e),
  };
  return { history, townName };
}
