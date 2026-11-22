/**
 * Names for a town and its streets, from a simple authored generator that follows the patterns the
 * research lists: a founder's or his kin's name, a home town, a naval survey name, "Port" something,
 * a description; numbered streets one way and named the other, the two plats named differently.
 *
 * PLACEHOLDERS. Every list below is authored here for the first version, not sourced: the names are
 * ordinary English, Scots, Scandinavian and Spanish-looking words picked to sound like the coast's
 * settlers, and none is a Native word (the research is explicit that those must come from the
 * nations' own sources). Replace the lists, never the patterns, when real name material exists.
 */
import { chance, int, pick, shuffled, type Rng, weighted } from "./rng.js";

const SURNAMES = [
  "Ashby", "Brannock", "Calloway", "Dunmore", "Ellery", "Fairchild", "Garrick", "Hadley", "Ingram", "Jessup",
  "Kendrick", "Lowell", "Marlow", "Norcross", "Ostrander", "Pruitt", "Quill", "Rowan", "Sorensen", "Thorne",
  "Underhill", "Vance", "Whitcomb", "Yardley", "Lindqvist", "Halvorsen", "Mackay", "Tolliver", "Brightwell", "Corbin",
] as const;

const GIVEN = [
  "Ada", "Clara", "Edith", "Eliza", "Frances", "Hattie", "Ida", "Julia", "Lena", "Martha", "Nora", "Ruth",
  "Oliver", "Walter", "Henry", "Albert", "Edwin", "Frank", "Silas", "Amos",
] as const;

/** The naval officers whose names a survey left on a harbour ("Port" + one). */
const SURVEY = ["Brackett", "Carrow", "Dunstan", "Fenwick", "Garland", "Harlow", "Kestrel", "Lyle", "Merrick", "Penhallow"] as const;

const HOME_TOWNS = ["Aberlady", "Thomaston", "Penzance", "Falmouth", "Kingsbridge", "Bangor", "Dunbar", "Camden", "Stornoway", "Bath"] as const;

const DESCRIPTIVE = ["Fairharbor", "Deepwater", "Cedar Cove", "Broad Reach", "Gull Point", "Bright Haven", "Long Spit", "Wide Water"] as const;

const KIN_ENDINGS = ["ville", "port", "haven", "dale"] as const;

const COUNTIES = ["Marlow", "Stafford", "Redfield", "Thorne", "Carden", "Alder", "Harrow"] as const;

const SEAT_TOWNS = ["Montclare", "Elmstead", "Highgate", "Westerly", "Oakridge", "Harlan", "Ferndown", "Bellmont"] as const;

const MAIN_STREETS = ["Water", "Front", "Commercial"] as const;

/** Shore-parallel streets of the claimant's plat after the first: what a settler named streets for. */
const ALONG_STREETS = ["Commerce", "Market", "Church", "School", "Cherry", "Spring", "Pine", "Union"] as const;

const HIGHWAYS = ["Coast Highway", "Harbor Highway", "Pacific Highway", "Bayshore Highway"] as const;

const SAINTS = ["St. Andrew's", "St. Mark's", "St. Olaf's", "St. Paul's", "Grace", "Trinity", "First Baptist", "Bethel", "Zion Lutheran", "Our Lady of the Sea"] as const;

const LODGES = ["Elks", "Odd Fellows", "Masonic", "Eagles", "Moose", "Knights of Pythias", "Sons of Norway"] as const;

const COMPANY_FORMS = [
  (s: string, t: string) => `${t} Land and Improvement Company`,
  (s: string, t: string) => `${s} & ${t} Townsite Company`,
  (s: string, t: string) => `${t} Land Company`,
] as const;

const MILL_FORMS = [
  (s: string) => `${s} Lumber Company`,
  (s: string) => `${s} Mill Company`,
  (s: string) => `${s} & Sons Lumber`,
] as const;

const RAILROADS = ["Coast Northern Railway", "Sound & Harbor Railroad", "Pacific Shore Line", "Western Terminal Railway"] as const;

export type TownNames = {
  readonly founder: string;
  readonly founderGiven: string;
  readonly claimant: string;
  readonly kinGiven: string;
  /** The town's name by pattern; the history picks one by what the town was founded for. */
  readonly town: {
    readonly founder: string;
    readonly kin: string;
    readonly home: string;
    readonly survey: string;
    readonly descriptive: string;
  };
  readonly company: string;
  readonly railroad: string;
  readonly millCompany: string;
  readonly county: string;
  readonly seatTown: string;
  readonly avenue: string;
  readonly highway: string;
  readonly wharf: string;
  readonly hotel: string;
  /** The claimant's shore-parallel streets (the first is the main street). */
  readonly along: readonly string[];
  /** The claimant's streets down to the water, named for people. */
  readonly cross: readonly string[];
  /** The land company's streets one way, named for its partners and investors. */
  readonly named: readonly string[];
  /** Where the land company's numbered streets begin. */
  readonly numberedFrom: number;
  readonly saints: readonly string[];
  readonly lodges: readonly string[];
};

/** Everything a town's names are made of, from the names stream only. */
export function makeNames(rng: Rng): TownNames {
  const surnames = shuffled(rng, SURNAMES);
  const givens = shuffled(rng, GIVEN);
  const founder = surnames[0]!;
  const founderGiven = givens[0]!;
  const kinGiven = pick(rng, GIVEN.slice(0, 12));
  const claimantSurname = chance(rng, 0.6) ? founder : surnames[1]!;
  const claimant = `${givens[1]!} ${claimantSurname}`;
  const home = pick(rng, HOME_TOWNS);
  const towns = {
    founder: chance(rng, 0.5) ? founder : `${founder}'s Landing`,
    kin: `${kinGiven}${pick(rng, KIN_ENDINGS).toLowerCase()}`,
    home,
    survey: `Port ${pick(rng, SURVEY)}`,
    descriptive: pick(rng, DESCRIPTIVE),
  };
  const partner = surnames[2]!;
  const form = COMPANY_FORMS[int(rng, 0, COMPANY_FORMS.length - 1)]!;
  const mill = MILL_FORMS[int(rng, 0, MILL_FORMS.length - 1)]!;
  const main = pick(rng, MAIN_STREETS);
  const along = [main, ...shuffled(rng, ALONG_STREETS)];
  // Streets for people, for the claimant's plat: kin's given names and surnames mixed.
  const cross = shuffled(rng, [...givens.slice(2, 14), ...surnames.slice(3, 10)]);
  const named = shuffled(rng, surnames.slice(2));
  return {
    founder,
    founderGiven,
    claimant,
    kinGiven,
    town: towns,
    company: form(partner, towns.descriptive),
    railroad: pick(rng, RAILROADS),
    millCompany: mill(founder),
    county: `${pick(rng, COUNTIES)} County`,
    seatTown: pick(rng, SEAT_TOWNS),
    avenue: `${partner} Avenue`,
    highway: pick(rng, HIGHWAYS),
    wharf: `${surnames[1]!} Wharf`,
    hotel: pick(rng, ["Hotel", "Grand Hotel", "House"]) === "House" ? `${founder} House` : `${surnames[3]!} Hotel`,
    along,
    cross,
    named,
    numberedFrom: int(rng, 1, 6),
    saints: shuffled(rng, SAINTS),
    lodges: shuffled(rng, LODGES),
  };
}

/** The town's name for a purpose: customs ports take a survey name, mill towns a founder's, and so on. */
export function townNameFor(n: TownNames, purpose: "sawmill" | "cannery" | "customs" | "railhead", rng: Rng): string {
  const pattern = weighted(
    rng,
    purpose === "customs"
      ? ([["survey", 6], ["home", 1], ["descriptive", 1]] as const)
      : purpose === "sawmill"
        ? ([["founder", 4], ["kin", 2], ["home", 2], ["descriptive", 2]] as const)
        : purpose === "cannery"
          ? ([["descriptive", 4], ["home", 2], ["founder", 2], ["kin", 2]] as const)
          : ([["home", 3], ["descriptive", 3], ["kin", 3], ["survey", 1]] as const),
  );
  return n.town[pattern];
}

/** 1st, 2nd, 3rd, 4th, ... 11th, 12th, 21st. */
export function ordinal(n: number): string {
  const last = n - Math.floor(n / 10) * 10;
  const tens = n - Math.floor(n / 100) * 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
