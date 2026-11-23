/**
 * The trades of the town's units, and how often each is drawn.
 *
 * THE MIX IS COUNTED, THE REST IS AUTHORED. `OSM_GROUP_COUNT` is the count of storefront businesses in the cached OpenStreetMap
 * extracts of 21 real coastal and near-coastal Washington and Oregon towns (Aberdeen, Hoquiam, Port Angeles, Port Townsend,
 * Astoria, Raymond, South Bend, Cosmopolis, Montesano, Elma, Westport, Ilwaco, Long Beach, Ocean Shores, Oysterville, Tokeland,
 * Port Gamble, McCleary, Pe Ell, Forks, Naselle): tags `shop=`, `amenity=`, `office=`, `craft=`, `tourism=`, `leisure=`,
 * names never read. A group's weight below is its count, split between the trades the group holds by an authored ratio (the
 * tags do not tell a diner from a restaurant). OSM is mapped unevenly, so it gives proportions, not inventories. What a town's
 * history adds (marine trades for a fishing port, a union hall for a mill town, lawyers for a county seat, kites for a town on
 * the tourist road) is authored, and so are the widths, the earliest decades and the multipliers by district.
 */
import type { BuildingKind, InteriorType, Trade } from "../../types.js";

export type Group =
  | "restaurant" | "grocery" | "cafe" | "medical" | "auto" | "fast food" | "bank" | "office" | "gift" | "hair" | "hardware" | "tavern" | "clothing"
  | "post" | "cannabis" | "food bank" | "marine" | "antiques" | "sporting" | "laundromat" | "furniture" | "funeral" | "newspaper" | "video" | "theater";

/** Storefront businesses counted per group over the 21 extracts (846 in all). */
export const OSM_GROUP_COUNT: Readonly<Record<Group, number>> = {
  restaurant: 115, grocery: 98, cafe: 73, medical: 58, auto: 53, "fast food": 51, bank: 51, office: 42, gift: 40, hair: 38, hardware: 35, tavern: 31,
  clothing: 30, post: 18, cannabis: 18, "food bank": 17, marine: 15, antiques: 12, sporting: 11, laundromat: 11, furniture: 10, funeral: 7, newspaper: 6,
  video: 3, theater: 3,
};
export const OSM_TOTAL = 846;
export const GROUPS: readonly Group[] = [
  "restaurant", "grocery", "cafe", "medical", "auto", "fast food", "bank", "office", "gift", "hair", "hardware", "tavern", "clothing",
  "post", "cannabis", "food bank", "marine", "antiques", "sporting", "laundromat", "furniture", "funeral", "newspaper", "video", "theater",
];

/** Where a trade may be drawn: s storefront (and the ground floor of a hotel, a lodge hall), o office building, f restaurant, g garage, b big-box, w warehouse. */
type At = string;
/** A trade's weight multipliers by district: the core, the dock, the highway strip, anywhere else. */
type Mul = readonly [number, number, number, number];
export type Tag = "marine" | "mill" | "seat" | "tourist" | "once";

export type TradeDef = {
  readonly id: Trade;
  readonly group: Group | null;
  /** The word that follows an owner's or a place's name ("Hardware"). */
  readonly noun: string;
  /** What the trade says on a sign with no name ("LAUNDROMAT"), or null where a bare word would be strange. */
  readonly plain: string | null;
  /** The weight, in the group's counts. */
  readonly w: number;
  readonly interior: InteriorType;
  /** The frontage it is drawn for, metres. */
  readonly minW: number;
  readonly maxW: number;
  /** The earliest decade it can open in, and the last it can still be open in (past trades only). */
  readonly from: number;
  readonly until: number | null;
  readonly at: At;
  readonly mul: Mul;
  readonly tag: Tag | null;
  /** The most a town holds (a town has one post office). */
  readonly cap: number;
  /** A second line for a fascia. */
  readonly tagline: readonly string[];
  /** Names that stand for this trade alone. */
  readonly specials: readonly string[];
};

const D: Mul = [1, 0.5, 0.5, 0.4];
function t(
  id: Trade,
  group: Group | null,
  noun: string,
  plain: string | null,
  w: number,
  interior: InteriorType,
  minW: number,
  maxW: number,
  from: number,
  at: At,
  o: { m?: Mul; tag?: Tag; cap?: number; tagline?: readonly string[]; specials?: readonly string[]; until?: number } = {},
): TradeDef {
  return { id, group, noun, plain, w, interior, minW, maxW, from, until: o.until ?? null, at, mul: o.m ?? D, tag: o.tag ?? null, cap: o.cap ?? 99, tagline: o.tagline ?? [], specials: o.specials ?? [] };
}

export const TRADES: readonly TradeDef[] = [
  // restaurants and cafes
  t("diner", "restaurant", "Diner", "DINER", 45, "counter service", 6, 14, 1900, "sf", { m: [1, 1, 1, 0.6], tagline: ["Breakfast all day", "Open 6 to 2", "Home cooking"], specials: ["The Galley", "Short Stack", "Blue Plate"] }),
  t("restaurant", "restaurant", "Restaurant", "RESTAURANT", 70, "dining room", 8, 18, 1900, "sf", { m: [1, 1, 1, 0.6], tagline: ["Steaks - Seafood", "Dinner nightly", "Family dining"], specials: ["Chowder House", "The Crab Pot", "Landing Grill"] }),
  t("cafe", "cafe", "Cafe", "CAFE", 73, "counter service", 5, 11, 1900, "sf", { m: [1.2, 0.7, 0.6, 0.7], tagline: ["Soup - Sandwiches", "Pie", "Coffee"], specials: ["Morning Glory", "The Daily"] }),
  t("espresso stand", "fast food", "Espresso", "COFFEE", 20, "counter service", 3.6, 6, 1990, "sf", { m: [0.7, 0.4, 2.5, 0.8], tagline: ["Drive Thru", "Lattes - Smoothies"] }),
  t("pizza and burgers", "fast food", "Pizza", "PIZZA", 31, "counter service", 6, 12, 1960, "sf", { m: [0.8, 0.5, 2.2, 0.7], tagline: ["Pizza - Burgers", "We Deliver"] }),
  t("tavern", "tavern", "Tavern", "TAVERN", 31, "bar", 7, 18, 1880, "st", { m: [0.2, 1.5, 0.3, 0.3], tagline: ["Cold Beer", "Pool - Pull Tabs", "Live Music Fri"], specials: ["The Anchor", "Wet Boot", "The Net Loft", "Last Call", "Dry Dock"] }),
  // food and general stores
  t("grocery", "grocery", "Grocery", "GROCERY", 52, "retail aisles", 9, 30, 1880, "sb", { m: [1, 0.5, 0.8, 0.9], tagline: ["Meat - Produce", "Groceries - Beer & Wine"] }),
  t("convenience store", "grocery", "Mini Mart", "MINI MART", 36, "retail aisles", 6, 14, 1970, "s", { m: [0.7, 0.8, 2, 1], tagline: ["Open Late", "Ice - Snacks"] }),
  t("bakery", "grocery", "Bakery", "BAKERY", 10, "counter service", 5, 9, 1890, "s", { m: [1.2, 0.5, 0.4, 0.5], tagline: ["Fresh Daily", "Donuts"] }),
  // gifts, galleries, the tourist road
  t("gift shop", "gift", "Gifts", "GIFTS", 27, "retail aisles", 6, 15, 1900, "s", { m: [1.3, 0.3, 1, 0.5], tagline: ["Souvenirs - Cards"] }),
  t("gallery", "gift", "Gallery", "GALLERY", 13, "retail aisles", 6, 14, 1960, "s", { m: [1.4, 0.2, 0.4, 0.4], tagline: ["Local Art", "Prints - Pottery"] }),
  t("kite shop", null, "Kites", "KITES", 5, "retail aisles", 5, 10, 1970, "s", { tag: "tourist", m: [1.5, 0.2, 1, 0.5], tagline: ["Kites - Windsocks"] }),
  t("candy shop", null, "Taffy", "SALTWATER TAFFY", 4, "counter service", 5, 9, 1960, "s", { tag: "tourist", m: [1.5, 0.2, 1, 0.5], tagline: ["Fudge - Taffy"] }),
  // money, offices
  t("bank", "bank", "Bank", null, 33, "office", 8, 15, 1880, "so", { cap: 2, m: [1.5, 0.2, 0.4, 0.2], tagline: ["Member FDIC", "Drive-up"] }),
  t("credit union", "bank", "Credit Union", null, 18, "office", 7, 14, 1950, "so", { cap: 2, m: [1.2, 0.2, 1, 0.3], tagline: ["Member Owned"] }),
  t("real estate office", "office", "Realty", "REAL ESTATE", 18, "office", 5, 12, 1900, "so", { m: [1.3, 0.4, 0.8, 0.3], tagline: ["Homes - Land - Rentals"] }),
  t("insurance office", "office", "Insurance", "INSURANCE", 10, "office", 5, 11, 1900, "so", { m: [1.3, 0.2, 0.8, 0.2], tagline: ["Auto - Home - Life"] }),
  t("law office", "office", "Law Office", null, 6, "office", 5, 11, 1880, "so", { m: [1.5, 0.1, 0.2, 0.1] }),
  t("tax office", "office", "Tax Service", "TAX SERVICE", 8, "office", 4, 9, 1930, "so", { m: [1.2, 0.2, 1, 0.2], tagline: ["Bookkeeping"] }),
  t("title company", null, "Title Company", "TITLE", 4, "office", 5, 11, 1900, "so", { tag: "seat", cap: 2, m: [1.6, 0, 0, 0] }),
  t("bail bonds", null, "Bail Bonds", "BAIL BONDS", 3, "office", 4, 8, 1950, "s", { tag: "seat", cap: 1, m: [1, 1, 0, 0] }),
  t("newspaper office", "newspaper", "Gazette", "NEWS", 3, "office", 6, 14, 1880, "so", { cap: 1, m: [1.4, 0.2, 0.1, 0.1], tagline: ["Weekly since 1890"] }),
  t("print shop", "newspaper", "Printing", "PRINTING", 3, "workshop", 5, 11, 1900, "s", { m: [1, 0.6, 0.8, 0.3], tagline: ["Copies - Signs"] }),
  t("post office", "post", "Post Office", null, 18, "counter service", 8, 20, 1880, "so", { cap: 1, m: [1.2, 0.2, 0.3, 0.2] }),
  // personal services
  t("hair salon", "hair", "Hair", "HAIR", 24, "office", 4, 9, 1960, "s", { m: [1.1, 0.4, 1, 0.9], tagline: ["Walk-ins Welcome", "Cuts - Color"] }),
  t("barber", "hair", "Barber", "BARBER", 8, "office", 3.6, 6.5, 1890, "s", { m: [1.2, 1, 0.5, 0.7], tagline: ["Haircuts", "Shave - Trim"] }),
  t("tattoo parlor", "hair", "Tattoo", "TATTOO", 6, "office", 4, 8, 1990, "s", { m: [0.8, 1.5, 0.8, 0.3] }),
  t("laundromat", "laundromat", "Laundry", "LAUNDROMAT", 11, "laundromat", 7, 16, 1950, "s", { m: [0.6, 1.2, 2.2, 1] }),
  t("funeral home", "funeral", "Funeral Home", null, 7, "lobby", 9, 20, 1890, "s", { cap: 1, m: [1, 0.1, 0.2, 0.6] }),
  // health
  t("medical clinic", "medical", "Clinic", "CLINIC", 33, "office", 6, 16, 1900, "so", { m: [1, 0.2, 1.2, 0.5], tagline: ["Walk-in", "Family Medicine"] }),
  t("dentist", "medical", "Dental", "DENTIST", 10, "office", 5, 11, 1900, "so", { m: [1, 0.1, 1.2, 0.3] }),
  t("veterinarian", "medical", "Animal Hospital", "VETERINARY", 6, "office", 6, 12, 1920, "s", { m: [0.5, 0.2, 1.5, 0.8] }),
  t("pharmacy", "medical", "Pharmacy", "PHARMACY", 9, "retail aisles", 8, 20, 1890, "s", { cap: 2, m: [1.5, 0.2, 1.2, 0.2], tagline: ["Prescriptions", "Drugs - Sundries"] }),
  // cars
  t("auto repair", "auto", "Auto Repair", "AUTO REPAIR", 37, "workshop", 8, 16, 1920, "sg", { m: [0.15, 0.7, 2.5, 1], tagline: ["Brakes - Tune-ups", "Foreign & Domestic"] }),
  t("auto parts", "auto", "Auto Parts", "AUTO PARTS", 11, "retail aisles", 8, 18, 1920, "sg", { m: [0.4, 0.5, 2, 0.5], tagline: ["Batteries - Wipers"] }),
  t("tire shop", "auto", "Tire", "TIRES", 5, "workshop", 8, 15, 1930, "sg", { m: [0.1, 0.5, 2.5, 0.8], tagline: ["New & Used"] }),
  t("saw and chain shop", null, "Saw & Chain", "SAW & CHAIN", 6, "workshop", 6, 14, 1930, "sg", { tag: "mill", m: [0.5, 1, 1.5, 1], tagline: ["Sales - Service - Sharpening"] }),
  // hardware and supply
  t("hardware", "hardware", "Hardware", "HARDWARE", 22, "retail aisles", 9, 22, 1880, "sb", { m: [1.2, 0.4, 0.8, 0.5], tagline: ["Tools - Paint - Keys", "Hardware - Lumber"] }),
  t("garden and feed", "hardware", "Feed & Garden", "FEED & GARDEN", 13, "retail aisles", 8, 22, 1890, "sbw", { m: [0.5, 0.2, 1.6, 1.6], tagline: ["Feed - Seed - Pet Supplies"] }),
  // clothing, books, variety
  t("clothing", "clothing", "Clothing", "CLOTHING", 11, "retail aisles", 6, 14, 1890, "s", { m: [1.4, 0.4, 0.5, 0.3], tagline: ["Men's - Women's - Work Wear"] }),
  t("variety store", "clothing", "Variety", "VARIETY", 11, "retail aisles", 8, 30, 1920, "sb", { m: [1, 0.4, 1.4, 0.4], tagline: ["Everything for Less"] }),
  t("jeweler", "clothing", "Jewelers", "JEWELRY", 4, "retail aisles", 4, 8, 1890, "s", { m: [1.4, 0.1, 0.3, 0.1] }),
  t("bookstore", "clothing", "Books", "BOOKS", 4, "retail aisles", 5, 11, 1960, "s", { m: [1.5, 0.1, 0.3, 0.2], tagline: ["New & Used"] }),
  t("game shop", "video", "Games", "GAMES", 3, "retail aisles", 5, 9, 1990, "s", { m: [1, 0.2, 1.5, 0.2] }),
  t("antiques", "antiques", "Antiques", "ANTIQUES", 7, "retail aisles", 6, 16, 1960, "s", { m: [1.2, 0.8, 0.5, 0.8], tagline: ["Collectibles"] }),
  t("thrift store", "antiques", "Thrift", "THRIFT", 5, "retail aisles", 8, 22, 1960, "sb", { m: [0.7, 1.2, 1.6, 0.4], tagline: ["Donations Welcome"] }),
  t("pawn shop", null, "Pawn", "PAWN", 4, "retail aisles", 5, 10, 1930, "s", { m: [0.6, 2, 1, 0.1], tagline: ["Loans - Guns - Gold"] }),
  t("sporting goods", "sporting", "Sports", "SPORTING GOODS", 11, "retail aisles", 7, 16, 1900, "s", { m: [1, 0.4, 1.2, 0.5], tagline: ["Hunting - Fishing - Licenses"] }),
  t("furniture store", "furniture", "Furniture", "FURNITURE", 10, "retail aisles", 10, 30, 1890, "sbw", { m: [0.8, 0.4, 1.5, 0.4], tagline: ["Appliances - Mattresses"] }),
  t("movie theater", "theater", "Theatre", "THEATRE", 3, "lobby", 10, 16, 1910, "s", { cap: 1, m: [1.5, 0.1, 0.2, 0.1] }),
  // the state's and the county's trades of vice and virtue
  t("cannabis shop", "cannabis", "Cannabis", "CANNABIS", 10, "retail aisles", 5, 11, 2010, "s", { m: [0.6, 1, 2.5, 0.5] }),
  t("liquor store", "cannabis", "Liquor", "LIQUOR", 5, "retail aisles", 6, 12, 1930, "s", { m: [0.8, 1.3, 1.5, 0.5], tagline: ["Beer - Wine - Spirits"] }),
  t("smoke shop", "cannabis", "Smoke Shop", "SMOKES", 3, "retail aisles", 4, 8, 1990, "s", { m: [0.6, 1.3, 1.4, 0.3] }),
  t("food bank", "food bank", "Food Bank", "FOOD BANK", 17, "retail aisles", 8, 20, 1980, "sbw", { cap: 1, m: [0.6, 1.2, 0.8, 0.5], tagline: ["Tues - Thurs 10 to 2"] }),
  // marine trades (a fishing port's)
  t("bait and tackle", "marine", "Bait & Tackle", "BAIT ICE TACKLE", 5, "retail aisles", 5, 12, 1900, "sw", { tag: "marine", m: [0.8, 3, 1, 0.5], tagline: ["Live Bait - Ice - Licenses"] }),
  t("marine supply", "marine", "Marine Supply", "MARINE SUPPLY", 4, "retail aisles", 8, 20, 1900, "sw", { tag: "marine", m: [0.6, 3, 0.6, 0.3], tagline: ["Rope - Chain - Paint"] }),
  t("fish market", "marine", "Fish Market", "FRESH FISH", 6, "counter service", 5, 12, 1890, "s", { tag: "marine", m: [0.8, 3, 0.8, 0.4], tagline: ["Crab - Salmon - Oysters"] }),
  t("boat yard", null, "Boat Works", "BOAT WORKS", 5, "workshop", 12, 40, 1900, "gw", { tag: "marine", m: [0.2, 3, 0.3, 0.3], tagline: ["Repairs - Haulouts"] }),
  t("union hall", null, "Union Hall", "UNION HALL", 3, "office", 8, 16, 1900, "s", { tag: "mill", cap: 1, m: [1, 1, 0.3, 0.3] }),
  t("self storage", null, "Storage", "SELF STORAGE", 6, "empty", 12, 60, 1980, "w", { m: [0.2, 1, 1.5, 1] }),
  // by building kind
  t("gas station", null, "Gas", "GAS", 1, "counter service", 8, 14, 1920, "", { tagline: ["Open 24 Hours"] }),
  t("motel", null, "Motel", null, 1, "lobby", 5, 20, 1940, "", { tagline: ["Weekly Rates"] }),
  t("hotel", null, "Hotel", null, 1, "lobby", 6, 30, 1880, "", { tagline: ["Rooms - Rates by the Week"] }),
  t("rooming house", null, "Rooms", null, 1, "lobby", 4, 20, 1880, "", { tagline: ["Weekly - Monthly"] }),
  t("lodge", null, "Lodge", null, 1, "lobby", 6, 30, 1880, "", {}),
  // trades of the past only
  t("dry goods", null, "Dry Goods", "DRY GOODS", 10, "retail aisles", 7, 15, 1880, "s", { until: 1950 }),
  t("five and dime", null, "5 & 10", "5 & 10 CENT STORE", 6, "retail aisles", 9, 20, 1930, "s", { until: 1990 }),
  t("shoe repair", null, "Shoe Repair", "SHOE REPAIR", 5, "workshop", 4, 7, 1890, "s", { until: 1990 }),
  t("cigar store", null, "Cigars", "CIGARS", 6, "retail aisles", 4, 8, 1880, "s", { until: 1960 }),
  t("photo studio", null, "Studio", "PHOTOGRAPHS", 4, "office", 5, 10, 1890, "s", { until: 1970 }),
  t("video store", null, "Video", "VIDEO", 6, "retail aisles", 7, 14, 1980, "s", { until: 2000 }),
  t("feed store", null, "Feed", "FEED", 5, "retail aisles", 9, 18, 1890, "sw", { until: 1970 }),
  t("hat shop", null, "Hats", "HATS", 3, "retail aisles", 4, 8, 1880, "s", { until: 1950 }),
];

/** A trade by its id (a lookup cache: never walked). */
const BY_ID = new Map<Trade, TradeDef>();
for (const d of TRADES) BY_ID.set(d.id, d);
export function tradeDef(id: Trade): TradeDef {
  return BY_ID.get(id)!;
}

/** The trades that are marine (a fishing port's alone), by tag. */
export const MARINE: readonly Trade[] = TRADES.filter((d) => d.tag === "marine").map((d) => d.id);

/** What a building kind holds, as the letters of `TradeDef.at`. */
export function classOf(kind: BuildingKind): string {
  switch (kind) {
    case "storefront":
    case "hotel":
    case "lodge hall":
    case "boarding house":
    case "depot":
      return "s";
    case "office":
      return "o";
    case "tavern":
      return "t";
    case "restaurant":
      return "f";
    case "garage":
      return "g";
    case "big-box store":
      return "b";
    case "warehouse":
      return "w";
    default:
      return "";
  }
}

/** The trades only the past held can appear on a ghost sign or in `past`; the others are open today. */
export const isPastOnly = (d: TradeDef): boolean => d.until !== null;

/** Trades named for a family or the town, never for a place word. */
export const FAMILY: readonly Trade[] = [
  "funeral home", "law office", "dentist", "insurance office", "medical clinic", "veterinarian", "hardware", "bank", "jeweler", "real estate office",
  "tax office", "title company", "pharmacy", "newspaper office", "furniture store", "clothing", "boat yard", "marine supply",
];
