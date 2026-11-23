/**
 * Every number that decides what stands in the streets, yards and docks (`props/`). **All of them are authored, none researched**:
 * the research found no source for how many cars a small port town parks or how often a yard has a fence. They follow how the
 * small towns of this coast look (cars at the diner, a dead truck in the blackberries, a boat in the side yard), and they live here, in
 * one place, so a share can be changed without reading the code that draws on it.
 */
import type { BinKind, FenceKind, GearKind, Trade, VehicleKind } from "../../types.js";

/** A weighted choice: `[value, weight]`. */
export type W<T> = readonly (readonly [T, number])[];

// ---- The streets: curbs and shoulders -------------------------------------------------------------------------------------------

/** The share of stalls along a curb that hold a car, before the open businesses are counted, by the street's era. */
export const CURB_BASE: Readonly<Record<"core" | "old" | "later" | "edge", number>> = { core: 0.08, old: 0.05, later: 0.03, edge: 0.02 };
/** What an open business adds to the stalls near it (times its `DRAW`, falling off linearly to nothing at `DRAW_REACH` metres), at most. */
export const DRAW_GAIN = 0.9;
export const DRAW_REACH = 28;
/** A vacant or ruined building's frontage holds a car this share as often as the base. */
export const VACANT_FRONT = 0.1;
/** A stall's length along the curb and how much the gaps between cars vary, metres. */
export const STALL = { min: 5.6, max: 8.8 };
/** A parked car's gap from the curb's face (the wheels are rarely right at it), metres. */
export const CURB_GAP = { min: 0.12, max: 0.62 };
/** How far a car may be crooked, as the sine of its angle (0.045 is about 2.6 degrees). */
export const CROOK = 0.045;
/** Streets whose roadway is under this park along one side only; wider ones (the main street, the avenue) along both. */
export const TWO_SIDES_FROM = 9.6;
/** The share of cars that face the wrong way on the side they stand (a small town's habit). */
export const WRONG_WAY = 0.12;
/** The clearance a parked car keeps from a junction's pavement, a drive's mouth, an alley's mouth and a street's end, metres. */
export const CLEAR_JUNCTION = 6;
export const CLEAR_DRIVE = 1.6;
export const CLEAR_END = 4;
/** The least a car's inner edge may stand from a roadway's centre line, and the clear width left for traffic beside a one-sided row, metres. */
export const CENTRE_KEEP = 0.9;
export const TRAFFIC_WIDTH = 4.8;
/** On a street with no curb: the share of stretches where a car has pulled onto the shoulder, per 40 m of a lot's frontage. */
export const PULL_OFF = 0.35;

/** How strongly each trade draws cars when it is open (a diner and a tavern most). Authored. */
export const DRAW: Readonly<Partial<Record<Trade, number>>> = {
  diner: 1, tavern: 1, restaurant: 0.8, "pizza and burgers": 0.7, cafe: 0.6, "espresso stand": 0.6, grocery: 0.8, "convenience store": 0.6,
  bakery: 0.4, hardware: 0.5, "post office": 0.7, bank: 0.5, "credit union": 0.4, pharmacy: 0.5, "medical clinic": 0.6, "liquor store": 0.5,
  "cannabis shop": 0.5, "thrift store": 0.4, "variety store": 0.4, "auto parts": 0.4, "auto repair": 0.5, "garden and feed": 0.4, "food bank": 0.5,
  "fish market": 0.5, "bait and tackle": 0.4, "marine supply": 0.4, laundromat: 0.4, "smoke shop": 0.3, motel: 0.5, "gas station": 0.7,
};
/** What a building of this kind that is no shop draws: the school, the hospital, the churches, the hall. */
export const DRAW_KIND = { church: 0.35, school: 0.5, hospital: 1, "fire hall": 0.2, "lodge hall": 0.3, "big-box store": 1, motel: 0.5, "gas station": 0.7, restaurant: 0.8, tavern: 1 } as const;
/** The default draw of an open unit that has no entry above. */
export const DRAW_DEFAULT = 0.25;

/** Kinds of vehicle at a curb or in a drive, by what the neighbourhood is: weights. */
export const KIND_COMMON: W<VehicleKind> = [["sedan", 0.3], ["suv", 0.24], ["pickup", 0.28], ["van", 0.06], ["work truck", 0.05], ["camper", 0.0]];
export const KIND_WORKING: W<VehicleKind> = [["pickup", 0.4], ["work truck", 0.3], ["van", 0.12], ["sedan", 0.1], ["suv", 0.08]];
export const KIND_TIDY: W<VehicleKind> = [["suv", 0.34], ["sedan", 0.34], ["pickup", 0.2], ["van", 0.06], ["work truck", 0.0], ["camper", 0.06]];
export const KIND_OLD: W<VehicleKind> = [["pickup", 0.42], ["sedan", 0.28], ["suv", 0.12], ["van", 0.1], ["work truck", 0.08]];
/** Trades that park work trucks and vans at their door. */
export const WORK_TRADES: readonly Trade[] = ["auto repair", "hardware", "garden and feed", "boat yard", "marine supply", "saw and chain shop", "tire shop", "auto parts", "self storage"];

/** Paint colours (indices into the drawing's table, `game/town/props/vehicleStyle.ts`) with the weight each has among parked vehicles. */
export const PAINT_COUNT = 12;
export const PAINT_WEIGHTS: readonly number[] = [0.2, 0.17, 0.15, 0.13, 0.08, 0.07, 0.05, 0.04, 0.03, 0.03, 0.03, 0.02];

/** The odds a vehicle is of a given age: the neighbourhood's age moves the range (a 1950s street's cars are older). */
export const AGE = { newest: 0.0, oldest: 1.0 };

// ---- Lots: what a household keeps ----------------------------------------------------------------------------------------------

/** A house lot's drive holds a vehicle, by the state of the house. */
export const DRIVE_VEHICLE = { open: 0.58, vacant: 0.1, ruin: 0.04 };
/** A second vehicle on the yard of an open house, by the yard's kind. */
export const SECOND_VEHICLE: Readonly<Record<string, number>> = { mown: 0.1, shaggy: 0.18, mossy: 0.14, bare: 0.25, tall: 0.1, brush: 0.05, paved: 0 };
/** A dead vehicle in the grass: by the yard's kind, for an open house and a vacant one. */
export const DERELICT_YARD: Readonly<Record<string, readonly [number, number]>> = { tall: [0.22, 0.45], brush: [0.2, 0.4], shaggy: [0.05, 0.25], bare: [0.1, 0.2], mossy: [0.08, 0.3], mown: [0.0, 0.05], paved: [0, 0.15] };
/** A project car on blocks under a tarp: the share of open houses with an untidy yard. */
export const PROJECT_CAR = 0.14;
/** A travel trailer or camper in a side yard, for a house with room. */
export const CAMPER = 0.045;
/** A boat on a trailer, in a house's yard: near the harbour, and away from it. */
export const BOAT_NEAR = 0.45;
export const BOAT_FAR = 0.09;
/** How near the quay (metres) a lot is called near the harbour, and the extra share in a mill's housing or the dock district. */
export const HARBOUR_NEAR = 260;
/** Of boats on trailers: those under a tarp, and the weeds grown through the trailer (the weight of a lot that is not kept). */
export const BOAT_TARP = 0.3;
export const BOAT_SKIFF = 0.55;

/** Paved lots (a business's parking): the cars in a row by the building, by how much the building draws. */
export const LOT_CARS_MAX = 4;
/** A stall in the highway strip holds a car this often when its business is open (the painted rows `groundGeometry.ts` draws). */
export const STRIP_STALL = 0.22;
/** Mirrors `game/town/groundGeometry.ts` (a test holds the two together): the painted stalls' length, pitch and setback, and the clearance from buildings. */
export const STALL_LENGTH = 5.5;
export const STALL_PITCH = 2.7;
export const STALL_SETBACK = 1.2;
export const STALL_CLEAR = 1.5;

// ---- Fences ----------------------------------------------------------------------------------------------------------------------

/** The share of house lots with a picket fence round the front yard, by how kept the yard is (0 to 1). */
export const PICKET_FRONT = 0.16;
/** A board fence along the back or one side: the share of open houses, and of businesses with a yard behind. */
export const BOARD_SIDE = 0.16;
/** Post-and-wire along the front or a side of an edge or outlying lot. */
export const WIRE_EDGE = 0.3;
/** Chain-link all round a working yard: the share of such lots, and of houses with dogs or gear. */
export const CHAIN_WORK = 0.5;
export const CHAIN_HOUSE = 0.04;
/** Trades and building kinds that keep a fenced yard. */
export const FENCED_TRADES: readonly Trade[] = ["auto repair", "boat yard", "tire shop", "saw and chain shop", "self storage", "garden and feed", "marine supply"];
export const FENCED_KINDS = ["junkyard", "warehouse", "mill shed", "cannery", "port terminal shed", "silo", "garage", "shake mill"] as const;
/** A fence's panel and post spacing, metres; the share of panels that have come down in a run, by how worn the run is. */
export const PANEL = 2.4;
/** The kinds' weights in a lot's own mix when a lot is fenced at all but the cause has not named the kind. */
export const FENCE_FALLBACK: W<FenceKind> = [["board", 0.5], ["wire", 0.3], ["picket", 0.2]];
/** A gate hangs open this often. */
export const GATE_OPEN = 0.35;

// ---- Bins, mailboxes, gear ------------------------------------------------------------------------------------------------------

/** Wheeled carts of a house: put away by the side of the house (the tidy) or left by the curb; the share of houses with any, and left out. */
export const CART_HOUSE = 0.8;
export const CART_OUT = 0.4;
export const CART_TIPPED = 0.07;
/** A second cart (recycling), the share of houses that have one. */
export const CART_SECOND = 0.5;
/** Curb-side mailboxes on streets with no sidewalk: one per lot, and the share of lots (a few have none), and a cluster box in later additions. */
export const MAILBOX = 0.82;
export const CLUSTER_LATER = 0.5;
/** A mailbox leans or lists this often. */
export const MAILBOX_LEAN = 0.35;
/** Cart colours (indices into the drawing's table), by weight. */
export const CART_COLOURS: readonly number[] = [0.4, 0.3, 0.2, 0.1];
/** Crab pots in a stack, firewood, a propane tank and pallets for a fisherman's yard and an ordinary one. */
export const POTS_STACK = { min: 5, max: 8 };
export const FISHER_GEAR: W<GearKind> = [["pots", 0.24], ["buoys", 0.16], ["totes", 0.16], ["coil", 0.16], ["net", 0.16], ["pallet stack", 0.12]];
export const YARD_GEAR: W<GearKind> = [["firewood", 0.45], ["propane", 0.3], ["pallet stack", 0.25]];
export const BIN_KIND_BEHIND: W<BinKind> = [["dumpster", 0.7], ["pallets", 0.2], ["drum", 0.1]];

// ---- Poles and wires -------------------------------------------------------------------------------------------------------------

/** The spacing of poles along a line, metres, by the street's era (the older streets' lines are tighter and more ragged). */
export const POLE_SPACING: Readonly<Record<"core" | "old" | "later" | "edge", readonly [number, number]>> = { core: [35, 40], old: [35, 44], later: [38, 45], edge: [40, 45] };
/** A pole's height, metres; the share that lean (by a hand's width to a half metre at the top), that have a stub beside them, a transformer, and the junctions that have a streetlight. */
export const POLE_HEIGHT = { min: 9.5, max: 12 };
export const POLE_LEAN = 0.12;
export const POLE_STUB = 0.07;
export const POLE_TRANSFORMER = 0.14;
export const JUNCTION_LIGHT = 0.4;
/** A crossarm on the streets of these eras (the rest have pin brackets): the share. */
export const CROSSARM: Readonly<Record<"core" | "old" | "later" | "edge", number>> = { core: 0.55, old: 0.85, later: 0.3, edge: 0.45 };
/** A building's service drop is made when a pole of its street is within this many metres. */
export const DROP_REACH = 38;
/** The lateral distance of a pole from the curb's back, on a street with a verge, and without (inside a narrow sidewalk's edge), and from the shoulder's outer edge, metres. */
export const POLE_VERGE_MIN = 0.9;
export const POLE_ON_WALK = 0.32;
export const POLE_SHOULDER_IN = 0.25;

/** The room a kind of vehicle is planned for, metres (`[length, width]`): the largest footprint of its models (`vehicleModels.ts`), so a stall or a curb space planned by it holds whichever model the vehicle turns out to be. A vehicle's own box is its model's; a camper has no model and keeps this size. */
export const DIMS: Readonly<Record<VehicleKind | "pickup old" | "pickup new", readonly [number, number]>> = {
  pickup: [5.22, 2.12], "pickup old": [5.13, 1.91], "pickup new": [5.22, 2.12], sedan: [5.0, 1.84], suv: [5.03, 1.86], van: [4.9, 2.37], "work truck": [6.03, 2.64], camper: [6.6, 2.3],
};
