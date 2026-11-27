/**
 * Who is outside in the downtown, and why: people who STAND or SIT somewhere for a reason, at the hours that reason holds. This is the drawing's,
 * not the simulation's, as `people.ts` is: nothing here is in the plan, nothing is kept between frames, and the same plan gives the same people
 * on every machine (every draw is a hash of a unit's, a bench's or a corner's id and the slot's index, never a random function or the clock).
 * `people.ts` keeps the people inside the rooms; this file is the street's.
 *
 * A person outside is a SLOT: a place, a reason, a clip (one of the models' clips; there is no walking clip) and the hours of the day
 * they are there. `REASONS` is the table of reasons as data, a row each, for the owner to read and change: what a reason needs near it, where the
 * person stands against it, the clips and how often each, how many it puts at one place at once, and its bands (the stretches of the day it holds,
 * each with how many stays it tries at a place, and how long each lasts). A slot's own start and its length are drawn from its band by a hash, and its
 * edges are moved by up to a quarter hour, so that a street does not fill or empty on the stroke of an hour. A game hour is two real minutes, so a
 * stay is half an hour at the least (a real minute), mostly 0.6 to 1.5 hours, a bench's 1 to 3 and a corner's 0.3 to 0.5: what the eye turns away
 * from it finds again, and a street changes slowly, since nobody walks in or out.
 *
 * DOWNTOWN is the core, dock and waterfront districts' lots, the benches and corners beside them, and the quay's apron where they stand on it.
 * No one is put on a house street, the highway strip or at the mill.
 *
 * A BUSINESS'S OWN HOURS BIND: a slot tied to a unit is inside that unit's opening hours (`unitHours`); a vacant or shut unit gives none, and a
 * tavern's last people leave at its closing.
 *
 * WHERE EXACTLY. On the sidewalk or the apron: out of every roadway (each street's own width and the curb returns' discs), out of every building,
 * more than `PROP_CLEAR` from any prop's box (`plan.props`, the benches but their own, the sidewalk's signs, the harbour's lights and the quay's
 * bollards), out of every door's way (its width and a step each side, a person's depth in front), at least `PEOPLE_APART` from anyone there at the
 * same time but a pair talking (0.9 to 1.1 m apart, each turned to the other and opened toward the street), and where the walk is wide enough, with a
 * metre of it clear to pass. Every place is a world place, and its height is the town ground's (`outdoorWorld`).
 *
 * HOW MANY. A small rural town's street has a person at a shop's window, not a row of them: a reason caps how many it puts at one place at once
 * (`cap`), a trade caps all the reasons at one unit (`unitCap`), and the whole downtown is held under a ceiling that follows the hour of the day and
 * the town's open units (`ceilingAt`): the means are tuned to sit under it, and a last pass drops, in the order of a hash, whoever would take it over.
 *
 * WHICH WAY. Nobody faces a blank wall or a pole with their nose at it (`facingClear`). A person who waits faces the street or along it, a person
 * on a phone or with a cup anywhere but into the wall, a window shopper the glass of a display window, a leaner straight out from the wall they lean
 * on, a bench's sitter as the bench does.
 *
 * The same trade of care keeps neighbours different: nobody within `NEIGHBOUR` of another at the same time is the same model.
 */
import { unitHours, wrapHour, type Hours } from "./hours.js";
import { hashN } from "./groundNoise.js";
import { PERSON_MODELS, type Activity, type PersonModel, type PersonSeat, type PersonWorld } from "./people.js";
import { BOLLARD_STEP, freePieces } from "./quayGeometry.js";
import type { TownGround } from "./townTypes.js";
import { bearingU } from "../../sim/town/bearings.js";
import { QUAY_APRON } from "../../sim/town/levels.js";
import type { Block, Building, BuildingUse, District, Junction, Street, StreetEdge, TownPlan, Trade, Unit } from "../../sim/town/types.js";

/** The districts whose streets are downtown. */
export const DOWNTOWN: readonly District[] = ["core", "dock", "waterfront"];
export const isDowntown = (d: District | undefined): boolean => d !== undefined && DOWNTOWN.includes(d);

/** How far a person stands from any prop's box, a roadway's edge and a building's wall, at least (metres). */
export const PROP_CLEAR = 0.4;
export const ROAD_CLEAR = 0.45;
export const WALL_CLEAR = 0.3;
/** How far apart two strangers at the same hour stand, at least; and how far a pair that talk (who face each other) from 0.9 to 1.1. */
export const PEOPLE_APART = 1.6;
export const PAIR_APART = 0.9;
export const PAIR_FAR = 1.1;
/** How far a pair's two turn from facing each other, toward the street (radians: 15 to 30 degrees). */
export const PAIR_OPEN: readonly [number, number] = [0.26, 0.52];
/** Within this, two people at the same time are not the same model. */
export const NEIGHBOUR = 3.5;
/** A step either side of a door, and how far out from the wall the door's way reaches (metres). */
export const DOOR_STEP = 0.9;
export const DOOR_OUT = 2.4;
/** How much of a walk is kept clear to pass, where the walk is as wide as `PASS_FROM`. */
export const PASS = 1;
export const PASS_FROM = 1.7;
/** Half the width of a standing person, which the clear passage is measured from. */
const BODY = 0.3;
/** The height of the seat of a bench (its plank's top), which `peopleParts` sets a sitter by. */
export const BENCH_SEAT = 0.45;
/** Where the bench's back is drawn: the front face of its back is this far behind the bench's middle (`props/streetGeometry.ts`), and a sitter's hips are `SIT_BEHIND` behind their origin. */
export const BENCH_BACK = 0.3;
export const SIT_BEHIND = 0.14;
/** The open downtown units of the town the table was tuned on ("sorrow"): a quay of a smaller downtown has proportionally fewer people. */
export const REFERENCE_UNITS = 46;
/** How far out from the wall's face a leaner's body origin is (metres), which is how far the models' hips and shoulder blades stand from it, and the least width of blank wall a leaner needs. */
export const LEAN_OUT = 0.345;
export const LEAN_BLANK = 0.9;
/** Beyond an opening's, a door's, a unit's edge or a sign's reach, a leaner keeps this far from it along the wall. */
const LEAN_EDGE = 0.25;
/** How far ahead of a person is looked at for a wall or a pole (metres): two points, half this and this. */
export const FACE_REACH = 1;
/** How far out from a display window's glass a shopper stands is the reason's; this is how far from the glass a wiper stands: an arm's length. */
const WIPE_OUT: readonly [number, number] = [0.45, 0.6];

/** An edge of a band: a clock hour, or an offset from the unit's opening or closing (a closing after midnight is counted past 24). */
export type Edge = readonly ["abs", number] | readonly ["open", number] | readonly ["close", number];
const abs = (h: number): Edge => ["abs", h];
const open = (h: number): Edge => ["open", h];
const close = (h: number): Edge => ["close", h];

/** A stretch of the day that a reason holds: `mean` stays are tried for each place (the whole number below it, or the one above by chance), each of `stay` hours. A try that finds no clear spot at its hours, with no one nearer than they should stand, or a place already as full as it may be, is not there, so the town's room sets how many there are. */
export type Band = { readonly from: Edge; readonly to: Edge; readonly mean: number; readonly stay: readonly [number, number] };

/** Where a person stands against what they are there for. */
export type Spot =
  /** Facing the glass of a display window about `out` from it, in front of the opening. */
  | { readonly kind: "glass"; readonly out: readonly [number, number] }
  /** Beside the door, off the door's way: `gap` from the door's edge along the front and `out` from the wall. All of a place's people stand on one side. A leaner is on blank wall instead. */
  | { readonly kind: "beside"; readonly gap: readonly [number, number]; readonly out: readonly [number, number] }
  /** On a bench. */
  | { readonly kind: "bench" }
  /** At the curb's ramp of a street corner. */
  | { readonly kind: "corner" }
  /** On the quay's apron: `off` metres seaward of the quay line. */
  | { readonly kind: "apron"; readonly off: readonly [number, number] };

export type ReasonId =
  | "morning drink" | "lunch" | "errand" | "window shopping" | "shopkeeper" | "break" | "bench" | "corner" | "tavern" | "dinner" | "theater" | "night shop" | "round the clock"
  | "quay at first light" | "quay by day" | "quay at dusk" | "waiting";

/** What a row's acts may be: a clip, a pair (one talks, one listens, or holds a cup in place of listening), or a pair with a cup each. */
export type Act = Activity | "pair" | "cups";

export type Reason = {
  readonly id: ReasonId;
  /** Why they are there, in a line. */
  readonly why: string;
  /** What it needs: units of these trades, an always-open unit, a bench, a corner or the quay. */
  readonly needs: { readonly trades: readonly Trade[] } | { readonly roundTheClock: readonly Trade[] } | { readonly place: "bench" | "corner" | "quay" | "any" };
  readonly spot: Spot;
  /** The clips and how often each. */
  readonly acts: readonly (readonly [Act, number])[];
  /** The most people this reason puts at one place at once, and how far apart two of them who are not a pair stand there (metres). */
  readonly cap: number;
  readonly apart: number;
  readonly bands: readonly Band[];
};

const COFFEE: readonly Trade[] = ["cafe", "espresso stand", "bakery"];
const WINDOWS: readonly Trade[] = [
  "clothing", "gift shop", "gallery", "kite shop", "candy shop", "bookstore", "game shop", "jeweler", "antiques", "thrift store", "variety store", "sporting goods",
  "furniture store", "hardware", "pharmacy", "tattoo parlor", "pawn shop", "marine supply", "bait and tackle", "phone shop",
];
const OFFICES: readonly Trade[] = [
  "bank", "credit union", "post office", "insurance office", "real estate office", "law office", "tax office", "title company", "medical clinic", "dentist", "newspaper office", "print shop",
  "union hall",
];
/** Where a paper cup of coffee is right outside, at night as by day. */
const CUP_AT: readonly Trade[] = [...COFFEE, "diner", "convenience store", "gas station"];

/** The most people at one unit at once, over all its reasons: a tavern's door four, a cafe's three, an office's two, and two anywhere else. */
export function unitCap(trade: Trade): number {
  if (trade === "tavern" || trade === "movie theater") return 4;
  if (COFFEE.includes(trade) || trade === "diner") return 3;
  return 2;
}

/**
 * The reasons, as the owner reads them. A band's hours are the clock's (a closing after midnight counts past 24); where a band's edge is the unit's
 * opening or closing, the unit's own hours (moved by an hour or none from its trade's) are used; a slot never goes outside the unit's hours.
 * The clips are the models': `wait` (hands in pockets, looks up and down the street), `arms` (folded), `lean` (against a wall), `call`, `phone`, `cup`
 * (a coffee, a sip now and then), `look` (a window), `sit_rest` and `sit_phone` (on a bench), `talk` and `listen` (the two of a pair), `idle` rarely.
 */
export const REASONS: readonly Reason[] = [
  {
    id: "morning drink", why: "a coffee outside a cafe, a bakery or the espresso stand: one with a cup, one on the phone, a pair talking",
    needs: { trades: [...COFFEE, "diner"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.55, 1.3] }, cap: 3, apart: PEOPLE_APART,
    acts: [["cup", 5], ["phone", 2], ["pair", 3]],
    bands: [{ from: open(0), to: abs(10.5), mean: 4.5, stay: [0.5, 1.2] }],
  },
  {
    id: "lunch", why: "waiting for a table or a pickup at a diner, a restaurant or a pizza place: one waiting, or a pair",
    needs: { trades: ["diner", "restaurant", "pizza and burgers", "cafe"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.55, 1.4] }, cap: 2, apart: PEOPLE_APART,
    acts: [["wait", 3], ["arms", 2], ["phone", 3], ["call", 1], ["idle", 0.4], ["pair", 3]],
    bands: [{ from: abs(11), to: abs(14.5), mean: 3.4, stay: [0.5, 1.1] }
    ],
  },
  {
    id: "window shopping", why: "looking in a display window, more at lunch and after three: one at a window, never a row",
    needs: { trades: WINDOWS }, spot: { kind: "glass", out: [0.8, 1.1] }, cap: 1, apart: PEOPLE_APART,
    acts: [["look", 1]],
    bands: [
      { from: abs(10.5), to: close(-0.3), mean: 11, stay: [0.5, 1.3] },
    ],
  },
  {
    id: "shopkeeper", why: "the shopkeeper at their own door just after opening and just before closing, or at their own glass with a cloth",
    needs: { trades: [...WINDOWS, ...COFFEE, "diner", "barber", "hair salon", "grocery"] }, spot: { kind: "beside", gap: [0.7, 1.1], out: [0.4, 0.6] }, cap: 1, apart: PEOPLE_APART,
    acts: [["arms", 2], ["idle", 2], ["wipe", 1]],
    bands: [
      { from: open(0.05), to: open(1), mean: 1.82, stay: [0.5, 0.8] },
      { from: close(-1.2), to: close(-0.05), mean: 1.82, stay: [0.5, 0.8] },
    ],
  },
  {
    id: "errand", why: "a minute outside the grocery, the pharmacy or the hardware store on the way home: waiting for someone, or on the phone",
    needs: { trades: ["grocery", "pharmacy", "hardware", "convenience store", "liquor store", "bakery"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.5, 1.4] }, cap: 2, apart: PEOPLE_APART,
    acts: [["phone", 3], ["wait", 3], ["arms", 1], ["call", 2], ["idle", 0.4], ["pair", 1]],
    bands: [
      { from: abs(9.5), to: abs(12), mean: 1.2, stay: [0.5, 1.1] },
      { from: abs(12), to: abs(19), mean: 5.5, stay: [0.5, 1.1] },
    ],
  },
  {
    id: "break", why: "a break outside an office, a bank or the post office at about ten, noon and three: leaning on the wall, on the phone, with a cup",
    needs: { trades: OFFICES }, spot: { kind: "beside", gap: [1.1, 4.2], out: [0.4, 0.9] }, cap: 2, apart: 2.5,
    acts: [["lean", 3], ["phone", 3], ["call", 2], ["cup", 2], ["pair", 1.5]],
    bands: [
      { from: abs(9.5), to: abs(16.5), mean: 7, stay: [0.5, 1] },
      { from: abs(11.5), to: abs(13.5), mean: 2.5, stay: [0.5, 1] },
    ],
  },
  {
    id: "bench", why: "sitting on a bench: an old man most of the morning, a rest at noon and in the afternoon, never in the dead of night; one to a bench",
    needs: { place: "bench" }, spot: { kind: "bench" }, cap: 1, apart: PEOPLE_APART,
    acts: [["sit_rest", 4], ["sit_phone", 2]],
    bands: [
      { from: abs(7), to: abs(12), mean: 3, stay: [1, 3] },
      { from: abs(12), to: abs(17.5), mean: 3.2, stay: [1, 2.5] },
      { from: abs(17.5), to: abs(20.5), mean: 1.6, stay: [1, 2] },
    ],
  },
  {
    id: "corner", why: "waiting to cross at a corner of a downtown street: one at a corner",
    needs: { place: "corner" }, spot: { kind: "corner" }, cap: 1, apart: PEOPLE_APART,
    acts: [["wait", 3], ["phone", 2], ["arms", 1], ["call", 1], ["idle", 0.3]],
    bands: [
      { from: abs(7.5), to: abs(20.5), mean: 9, stay: [0.3, 0.5] },
      { from: abs(11), to: abs(17.5), mean: 4.5, stay: [0.3, 0.5] },
    ],
  },
  {
    id: "tavern", why: "outside a tavern from early evening until it closes: talking in pairs, on the phone, leaning on the wall, waiting; the last leave at closing",
    needs: { trades: ["tavern"] }, spot: { kind: "beside", gap: [0.8, 4.5], out: [0.8, 2.0] }, cap: 4, apart: PEOPLE_APART,
    acts: [["pair", 4], ["call", 1], ["phone", 2], ["lean", 2], ["wait", 2]],
    bands: [
      { from: abs(16.5), to: abs(20), mean: 5.5, stay: [0.6, 1.5] },
      { from: abs(20), to: abs(23), mean: 6.12, stay: [0.6, 1.8] },
      { from: abs(23), to: close(0), mean: 3.6, stay: [0.5, 1.2] },
    ],
  },
  {
    id: "dinner", why: "outside a restaurant between six and nine: a pair, or one waiting",
    needs: { trades: ["restaurant", "pizza and burgers"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.6, 1.5] }, cap: 2, apart: PEOPLE_APART,
    acts: [["pair", 3], ["phone", 1], ["wait", 2], ["arms", 1]],
    bands: [{ from: abs(18), to: abs(21), mean: 4.5, stay: [0.5, 1] }],
  },
  {
    id: "theater", why: "outside the movie theater for the half hour before seven and nine: a small group",
    needs: { trades: ["movie theater"] }, spot: { kind: "beside", gap: [0.9, 2.6], out: [0.7, 1.6] }, cap: 4, apart: PEOPLE_APART,
    acts: [["pair", 3], ["phone", 2], ["wait", 2], ["arms", 1]],
    bands: [
      { from: abs(18.2), to: abs(19.2), mean: 3.0, stay: [0.5, 0.8] },
      { from: abs(20.2), to: abs(21.2), mean: 3.0, stay: [0.5, 0.8] },
    ],
  },
  {
    id: "night shop", why: "outside the convenience store or the laundromat in the evening and at night while it is open: one, on the phone or leaning, with a cup at the convenience store",
    needs: { trades: ["convenience store", "laundromat", "liquor store"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.5, 1.3] }, cap: 2, apart: PEOPLE_APART,
    acts: [["phone", 3], ["call", 2], ["lean", 2], ["cup", 2]],
    bands: [{ from: abs(18.5), to: close(0), mean: 4.4, stay: [0.5, 1.2] }],
  },
  {
    id: "round the clock", why: "the one person at a business that never shuts, even in the dead of night",
    needs: { roundTheClock: ["hotel", "motel", "gas station"] }, spot: { kind: "beside", gap: [0.9, 2.4], out: [0.5, 1.2] }, cap: 1, apart: PEOPLE_APART,
    acts: [["phone", 3], ["call", 2], ["lean", 2], ["cup", 2]],
    bands: [
      { from: abs(0), to: abs(5), mean: 1.05, stay: [0.5, 1] },
      { from: abs(21), to: abs(24), mean: 2.1, stay: [0.5, 1.1] },
    ],
  },
  {
    id: "quay at first light", why: "the boats' crews by the piers at first light: waiting, arms folded, on a call, or a pair each with a cup",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.4, 2.8] }, cap: 3, apart: PEOPLE_APART,
    acts: [["wait", 3], ["arms", 2], ["call", 1], ["cups", 3]],
    bands: [{ from: abs(5), to: abs(8), mean: 0.7, stay: [0.6, 1.5] }],
  },
  {
    id: "quay by day", why: "looking at the water through the day: waiting, arms folded, or on a call",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.6, 3.0] }, cap: 3, apart: PEOPLE_APART,
    acts: [["wait", 3], ["arms", 2], ["call", 1]],
    bands: [{ from: abs(8), to: abs(18), mean: 6, stay: [0.6, 1.5] }],
  },
  {
    id: "quay at dusk", why: "almost nobody after dark: one looking at the lights on the water",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.6, 3.0] }, cap: 2, apart: PEOPLE_APART,
    acts: [["wait", 2], ["arms", 1], ["call", 1]],
    bands: [{ from: abs(18), to: abs(22), mean: 0.5, stay: [0.5, 1] }],
  },
  {
    id: "waiting", why: "someone waiting outside any open business for a lift, a friend or a call: only where the day would otherwise leave a small town's street empty (`DAY_FLOOR`)",
    needs: { place: "any" }, spot: { kind: "beside", gap: [0.9, 7], out: [0.5, 2.2] }, cap: 1, apart: PEOPLE_APART,
    acts: [["wait", 3], ["arms", 2], ["phone", 3], ["call", 1]],
    bands: [{ from: abs(7.5), to: abs(20), mean: 0, stay: [0.5, 0.9] }],
  },
];

/** The fewest people a downtown with a place to stand them has outside, by the hour: about 6 in 10 of the ceiling from half past ten to five, 4 in 10 from half past seven to eight at night, and a person or two for the smallest. */
export const DAY_FLOOR = (hour: number, units: number): number =>
  hour >= 10.5 && hour < 17 ? Math.max(2, Math.floor(ceilingAt(hour, units) * 0.6)) : hour >= 7.5 && hour < 20 ? Math.max(hour >= 10 && hour < 17 ? 2 : 1, Math.floor(ceilingAt(hour, units) * 0.4)) : 0;

/**
 * The most people the downtown may have outside at `hour` (0 up to 24): the late morning's and afternoon's 28, 12 at 08:00 and 20:00, 3 in the small
 * hours, and the ramps between, scaled by how many open units the town has against `REFERENCE_UNITS` (never fewer than two). The table's means are set to sit under it, and a last pass enforces it.
 */
export function ceilingAt(hour: number, units: number): number {
  const h = wrapHour(hour);
  const curve: readonly (readonly [number, number])[] = [[0, 4], [1, 3], [5, 3], [8, 12], [10.5, 28], [17, 28], [20, 12], [23, 8], [24, 4]];
  let v = 3;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1] as readonly [number, number];
    const b = curve[i] as readonly [number, number];
    if (h <= b[0]) {
      v = a[1] + ((b[1] - a[1]) * (h - a[0])) / (b[0] - a[0]);
      break;
    }
  }
  // (Never more than the curve's own most, 28 with the quay's: a downtown built up past `REFERENCE_UNITS` has more places to stand at, not more people out at once.)
  return Math.max(2, Math.floor((v * Math.min(units, REFERENCE_UNITS)) / REFERENCE_UNITS));
}

/** A person outside: where and which way, what they are doing, and the hours they are there. */
export type OutdoorPerson = {
  readonly id: number;
  readonly reason: ReasonId;
  /** The world's x and z, and the way they face as a yaw (0 looks toward +z, as `PersonWorld`'s). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** The same place in the plan's own frame (the world's less the anchor), which the placing and the tests read. */
  readonly px: number;
  readonly pz: number;
  readonly model: PersonModel;
  readonly scale: number;
  readonly offset: number;
  readonly rate: number;
  readonly activity: Activity;
  /** The hours they are there: their own start and end, wrapped (a stay may cross midnight). */
  readonly hours: Hours & object;
  /** The start, from 0 up to 24, and how long they stay, hours. */
  readonly start: number;
  readonly length: number;
  /** The unit they are there for and its building, or -1 for a bench, a corner or the quay. */
  readonly building: number;
  readonly unit: number;
  /** The unit's own opening hours, which this stay is inside, or null where none binds. */
  readonly unitHours: Hours | null;
  /** The block (of the plan's) the place is by, which is downtown, or -1 for the quay. */
  readonly block: number;
  /** The district of the lot, block or stretch of quay the place is by. */
  readonly district: District;
  /** The bench they sit on (a furniture id), or -1. */
  readonly bench: number;
  readonly seat: PersonSeat | null;
  /** The other of a pair that talk, or -1. */
  readonly partner: number;
  /** The place they stand at, which caps how many are there at once: a unit, a bench, a corner or a stretch of quay, by a key. */
  readonly place: string;
};

/** The people of a plan's downtown; the world's places are `plan` plus the anchor. */
export type OutdoorPlan = readonly OutdoorPerson[];

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan's obstacles, in the plan's frame, made once for a plan.

export type Rect = { readonly cx: number; readonly cz: number; readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number };
export type Disc = { readonly x: number; readonly z: number; readonly r: number };
/** A curb return: the pavement fills the triangle of its two tangent points and the curbs' meeting point, outside the circle the return is round about (whose centre is in the sidewalk's corner). */
type Fillet = { readonly c: Disc; readonly pts: readonly [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }] };
export type Seg = {
  readonly street: Street;
  readonly edge: StreetEdge;
  readonly ax: number;
  readonly az: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly len: number;
  /** Half the roadway, from the centre line to the curb. */
  readonly cw: number;
  readonly half: number;
};
type DoorWay = { readonly building: number; readonly ox: number; readonly oz: number; readonly tx: number; readonly tz: number; readonly nx: number; readonly nz: number; readonly s0: number; readonly s1: number };

export type Ground = {
  readonly plan: TownPlan;
  readonly segs: readonly Seg[];
  readonly fillets: readonly Fillet[];
  readonly buildings: readonly Rect[];
  readonly boxes: readonly Rect[];
  readonly benches: readonly (Rect & { readonly id: number })[];
  readonly things: readonly Disc[];
  readonly doors: readonly DoorWay[];
  readonly blocks: readonly { readonly block: Block; readonly box: { x0: number; z0: number; x1: number; z1: number } }[];
};

export const rectDist = (r: Rect, x: number, z: number): number => {
  const dx = x - r.cx;
  const dz = z - r.cz;
  const a = dx * r.ux + dz * r.uz;
  const b = -dx * r.uz + dz * r.ux;
  return Math.hypot(Math.max(Math.abs(a) - r.hu, 0), Math.max(Math.abs(b) - r.hv, 0));
};

/** The distance from (x, z) to a segment, and where along it the nearest point is (metres from its start). */
function segNear(s: Seg, x: number, z: number): { d: number; s: number } {
  const t = Math.min(s.len, Math.max(0, (x - s.ax) * s.tx + (z - s.az) * s.tz));
  return { d: Math.hypot(x - (s.ax + s.tx * t), z - (s.az + s.tz * t)), s: t };
}

const grounds = new WeakMap<TownPlan, Ground>();

export function groundOf(plan: TownPlan): Ground {
  const known = grounds.get(plan);
  if (known !== undefined) return known;
  const segs: Seg[] = plan.streets.map((street) => {
    const dx = street.b.x - street.a.x;
    const dz = street.b.z - street.a.z;
    const len = Math.hypot(dx, dz);
    return {
      street, edge: plan.edges[street.id] as StreetEdge, ax: street.a.x, az: street.a.z, tx: dx / len, tz: dz / len, nx: -dz / len, nz: dx / len, len, cw: street.roadway / 2, half: street.width / 2,
    };
  });
  const fillets: Fillet[] = [];
  for (const j of plan.junctions) for (const c of j.corners) if (c.shape === "arc" && c.c !== null && c.v !== null) fillets.push({ c: { x: c.c.x, z: c.c.z, r: c.radius }, pts: [c.ta, c.v, c.tb] });
  const buildings: Rect[] = plan.buildings.map((b) => {
    const u = bearingU(b.bearing);
    return { cx: b.centre.x, cz: b.centre.z, ux: u.x, uz: u.z, hu: b.halfAlong, hv: b.halfAcross };
  });
  const boxes: Rect[] = plan.props.solids.map((b) => ({ cx: b.cx, cz: b.cz, ux: b.ux, uz: b.uz, hu: b.hu, hv: b.hv }));
  const benches: (Rect & { id: number })[] = [];
  const things: Disc[] = [];
  for (const f of plan.props.furniture) {
    if (f.kind === "bench") benches.push({ id: f.id, cx: f.x, cz: f.z, ux: f.hx, uz: f.hz, hu: 0.88, hv: 0.34 });
    else things.push({ x: f.x, z: f.z, r: f.kind === "planter" ? 0.55 : 0.3 });
  }
  for (const l of plan.harbour.lights) things.push({ x: l.x, z: l.z, r: 0.5 });
  // The sidewalk's signs: a board or a post at the place its unit's frame says.
  const doors: DoorWay[] = [];
  for (const use of plan.uses) {
    const fr = use.frame;
    if (fr === null) continue;
    const door = (s: number, width: number): void => {
      doors.push({ building: use.building, ox: fr.origin.x, oz: fr.origin.z, tx: fr.t.x, tz: fr.t.z, nx: fr.n.x, nz: fr.n.z, s0: s - width / 2 - DOOR_STEP, s1: s + width / 2 + DOOR_STEP });
    };
    for (const u of use.units) {
      door(u.door.s, u.door.width);
      for (const sign of u.signs) if (sign.place.wall === "sidewalk" || sign.place.wall === "lot edge") things.push({ x: fr.origin.x + fr.t.x * sign.place.s + fr.n.x * sign.place.out, z: fr.origin.z + fr.t.z * sign.place.s + fr.n.z * sign.place.out, r: 0.55 });
    }
    if (use.stair !== null) door(use.stair.s, use.stair.width);
    if (use.door !== null) door(use.door.s, use.door.width);
    for (const sign of use.signs) if (sign.place.wall === "sidewalk" || sign.place.wall === "lot edge") things.push({ x: fr.origin.x + fr.t.x * sign.place.s + fr.n.x * sign.place.out, z: fr.origin.z + fr.t.z * sign.place.s + fr.n.z * sign.place.out, r: 0.55 });
  }
  // The quay's bollards.
  const anchor = { x: 0, z: 0 };
  for (const w of plan.quay.wet) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    const tx = (w.b.x - w.a.x) / len;
    const tz = (w.b.z - w.a.z) / len;
    for (const [p0, p1] of freePieces({ plan, anchor } as unknown as TownGround, w.a, w.b)) {
      for (let s = p0 + BOLLARD_STEP / 2; s < p1 - 1; s += BOLLARD_STEP) things.push({ x: w.a.x + tx * s + plan.quay.seaward.x * (QUAY_APRON - 1.3), z: w.a.z + tz * s + plan.quay.seaward.z * (QUAY_APRON - 1.3), r: 0.26 });
    }
  }
  const blocks = plan.blocks.map((block) => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of block.polygon) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
    return { block, box: { x0, z0, x1, z1 } };
  });
  const made: Ground = { plan, segs, fillets, buildings, boxes, benches, things, doors, blocks };
  grounds.set(plan, made);
  return made;
}

/** The distance from a point to a polygon's edge (0 inside it). */
function polyDist(poly: readonly { x: number; z: number }[], x: number, z: number): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const a = poly[k] as { x: number; z: number };
    const b = poly[i] as { x: number; z: number };
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return inside ? 0 : best;
}

/** The block a point is nearest to (within `within` metres), or null: the district a place is by. */
export function blockNear(plan: TownPlan, x: number, z: number, within: number): { block: Block; d: number } | null {
  const g = groundOf(plan);
  let best: { block: Block; d: number } | null = null;
  for (const { block, box } of g.blocks) {
    if (x < box.x0 - within || x > box.x1 + within || z < box.z0 - within || z > box.z1 + within) continue;
    const d = polyDist(block.polygon, x, z);
    if (d <= within && (best === null || d < best.d)) best = { block, d };
  }
  return best;
}

function inTriangle(t: Fillet["pts"], x: number, z: number): boolean {
  const side = (a: { x: number; z: number }, b: { x: number; z: number }): number => (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
  const d0 = side(t[0], t[1]);
  const d1 = side(t[1], t[2]);
  const d2 = side(t[2], t[0]);
  return !((d0 < 0 || d1 < 0 || d2 < 0) && (d0 > 0 || d1 > 0 || d2 > 0));
}

/** The roadways' segments and curb returns by cell of four metres, so that a point is looked at against the few near it and not all of them (made once for a plan's ground). */
type RoadIndex = Map<number, { segs: Seg[]; fillets: Ground["fillets"][number][] }>;
const roadIndexes = new WeakMap<Ground, RoadIndex>();
/** The most margin a point may be asked about with the index (a longer one looks at everything). */
const ROAD_MARGIN = 1.2;

function roadIndexOf(g: Ground): RoadIndex {
  const known = roadIndexes.get(g);
  if (known !== undefined) return known;
  const index: RoadIndex = new Map();
  const put = (x0: number, z0: number, x1: number, z1: number, add: (cell: { segs: Seg[]; fillets: Ground["fillets"][number][] }) => void): void => {
    for (let cx = Math.floor(x0 / 4); cx <= Math.floor(x1 / 4); cx++) {
      for (let cz = Math.floor(z0 / 4); cz <= Math.floor(z1 / 4); cz++) {
        const key = (cx + 8192) * 16384 + (cz + 8192);
        let cell = index.get(key);
        if (cell === undefined) {
          cell = { segs: [], fillets: [] };
          index.set(key, cell);
        }
        add(cell);
      }
    }
  };
  for (const s of g.segs) {
    const e = s.cw + ROAD_MARGIN;
    put(Math.min(s.ax, s.ax + s.tx * s.len) - e, Math.min(s.az, s.az + s.tz * s.len) - e, Math.max(s.ax, s.ax + s.tx * s.len) + e, Math.max(s.az, s.az + s.tz * s.len) + e, (c) => c.segs.push(s));
  }
  for (const f of g.fillets) {
    const xs = f.pts.map((p) => p.x);
    const zs = f.pts.map((p) => p.z);
    put(Math.min(...xs) - ROAD_MARGIN, Math.min(...zs) - ROAD_MARGIN, Math.max(...xs) + ROAD_MARGIN, Math.max(...zs) + ROAD_MARGIN, (c) => c.fillets.push(f));
  }
  roadIndexes.set(g, index);
  return index;
}

/** Whether a point is in a roadway (a street's, an alley's, a flight of stairs', or a curb return's), with `margin` to spare. */
export function inRoadway(plan: TownPlan, x: number, z: number, margin: number): boolean {
  const g = groundOf(plan);
  if (margin <= ROAD_MARGIN) {
    const cell = roadIndexOf(g).get((Math.floor(x / 4) + 8192) * 16384 + (Math.floor(z / 4) + 8192));
    if (cell === undefined) return false;
    for (const s of cell.segs) if (segNear(s, x, z).d < s.cw + margin) return true;
    for (const f of cell.fillets) {
      if (Math.hypot(x - f.c.x, z - f.c.z) <= f.c.r - margin) continue;
      if (inTriangle(f.pts, x, z)) return true;
    }
    return false;
  }
  for (const s of g.segs) {
    if (segNear(s, x, z).d < s.cw + margin) return true;
  }
  for (const f of g.fillets) {
    if (Math.hypot(x - f.c.x, z - f.c.z) <= f.c.r - margin) continue;
    if (inTriangle(f.pts, x, z)) return true;
  }
  return false;
}

/** The sidewalk under a point: the street, how far from its centre line and the walk's inner and outer edges, or null where none lies there. */
export function walkAt(g: Ground, x: number, z: number): { seg: Seg; d: number; lo: number; hi: number } | null {
  let best: { seg: Seg; d: number; lo: number; hi: number } | null = null;
  for (const seg of g.segs) {
    const k = seg.street.kind;
    if (k !== "main" && k !== "street" && k !== "avenue") continue;
    const near = segNear(seg, x, z);
    if (near.d > seg.half + 0.5) continue;
    // Only the stretch of the street the point lies beside (its end is a junction, whose corners are the corners' own).
    const along = (x - seg.ax) * seg.tx + (z - seg.az) * seg.tz;
    if (along < 0 || along > seg.len) continue;
    const side = (x - seg.ax) * seg.nx + (z - seg.az) * seg.nz > 0 ? 0 : 1;
    const e = seg.edge.sides[side] as StreetEdge["sides"][number];
    if (e.walk <= 0) continue;
    const hi = seg.cw + e.verge + e.walk;
    const lo = seg.cw + e.verge;
    if (near.d < lo + 0.1 || near.d > hi - 0.1) continue;
    if (!e.runs.some((r) => along >= r.s0 + 0.3 && along <= r.s1 - 0.3)) continue;
    if (best === null || Math.abs(near.d - (lo + hi) / 2) < Math.abs(best.d - (best.lo + best.hi) / 2)) best = { seg, d: near.d, lo, hi };
  }
  return best;
}

/** Whether a point is clear of everything it must be clear of, but other people. `own`: the bench they sit on (a furniture id) or -1. */
export function standable(plan: TownPlan, x: number, z: number, own = -1, onWalk = true): boolean {
  return whyNot(plan, x, z, own, onWalk) === "";
}

/** Why a point is not standable, or "" where it is (for the tests and for looking). `wallOk`: a building's wall may be near (a leaner's back is on it). */
export function whyNot(plan: TownPlan, x: number, z: number, own = -1, onWalk = true, wallOk = false): string {
  const g = groundOf(plan);
  if (inRoadway(plan, x, z, ROAD_CLEAR)) return "roadway";
  for (const b of g.buildings) if (Math.abs(x - b.cx) < b.hu + b.hv + 2 && Math.abs(z - b.cz) < b.hu + b.hv + 2 && rectDist(b, x, z) < (wallOk ? 0.05 : WALL_CLEAR)) return "building";
  for (const b of g.boxes) if (Math.abs(x - b.cx) < b.hu + b.hv + 2 && Math.abs(z - b.cz) < b.hu + b.hv + 2 && rectDist(b, x, z) < PROP_CLEAR) return "prop";
  for (const b of g.benches) if (b.id !== own && rectDist(b, x, z) < PROP_CLEAR) return "bench";
  for (const t of g.things) if (Math.hypot(x - t.x, z - t.z) < t.r + PROP_CLEAR) return "thing";
  for (const d of g.doors) {
    const dx = x - d.ox;
    const dz = z - d.oz;
    const s = dx * d.tx + dz * d.tz;
    const out = dx * d.nx + dz * d.nz;
    if (s > d.s0 && s < d.s1 && out > -0.6 && out < DOOR_OUT) return "door";
  }
  if (onWalk) {
    const w = walkAt(g, x, z);
    if (w === null) return "no walk";
    // With a walk wide enough to pass on, a metre of it is left clear on one side.
    if (w.hi - w.lo >= PASS_FROM && Math.max(w.d - BODY - w.lo, w.hi - (w.d + BODY)) < PASS) return "passage";
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The slots

/** A unit's hours as an interval of the clock: from `lo` and until `hi` (past 24 for a closing after midnight). */
export function span(h: Hours): { lo: number; hi: number } {
  if (h === "always") return { lo: 0, hi: 24 };
  return { lo: h.open, hi: h.close <= h.open ? h.close + 24 : h.close };
}

const edgeAt = (e: Edge, lo: number, hi: number): number => (e[0] === "abs" ? e[1] : e[0] === "open" ? lo + e[1] : hi + e[1]);

/** Whether two stays overlap in time (each from 0 up to 24 and `length` long, on a clock that comes round), with `pad` hours to spare. */
export function sameTime(a: { start: number; length: number }, b: { start: number; length: number }, pad = 0): boolean {
  for (const k of [-24, 0, 24]) if (a.start < b.start + k + b.length + pad && b.start + k < a.start + a.length + pad) return true;
  return false;
}

/** Whether a stay holds at `hour` (0 up to 24). */
export function stayHolds(p: { start: number; length: number }, hour: number): boolean {
  const t = wrapHour(hour);
  return (t >= p.start && t < p.start + p.length) || t + 24 < p.start + p.length;
}

const roll = (a: number, b: number, c: number, d: number): number => hashN(a, b, c, d);
const pick = <T>(list: readonly (readonly [T, number])[], r: number): T => {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let at = r * sum;
  for (const [v, w] of list) {
    at -= w;
    if (at < 0) return v;
  }
  return (list[list.length - 1] as readonly [T, number])[0];
};
const turn = (fx: number, fz: number, radians: number): [number, number] => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [fx * c - fz * s, fx * s + fz * c];
};
const yawOf = (fx: number, fz: number): number => Math.atan2(fx, fz);

/** The vector (fx, fz) turned by `radians` toward the vector (nx, nz), whichever way round that is. */
function openedToward(fx: number, fz: number, nx: number, nz: number, radians: number): [number, number] {
  const cross = fx * nz - fz * nx;
  return turn(fx, fz, cross < 0 ? -radians : radians);
}

type Draft = Omit<OutdoorPerson, "id" | "model" | "partner" | "px" | "pz">;
type Placed = OutdoorPerson;

type Place = { x: number; z: number; fx: number; fz: number };

const cache = new WeakMap<TownPlan, readonly OutdoorPerson[]>();

/** The district of a unit's lot (the building's), or undefined for a building on piles. */
const lotDistrict = (plan: TownPlan, b: Building): District | undefined => plan.lots[b.lot]?.district;

/** The open units of a plan's downtown, which the ceiling and the quay's share follow. */
export function openDowntownUnits(plan: TownPlan): number {
  return plan.uses.reduce((n, use) => {
    const b = plan.buildings.find((c) => c.id === use.building);
    return n + (b !== undefined && isDowntown(lotDistrict(plan, b)) ? use.units.filter((u) => u.state === "open").length : 0);
  }, 0);
}

/**
 * The stretches of a unit's front wall a person may lean on, as [from, to] along the front: the wall between its openings (a bricked-up one is
 * wall), its door, the stair's door, a sign at a person's height and the unit's own ends, each with `LEAN_EDGE` to spare, kept where at least
 * `LEAN_BLANK` of it is left. A front that tells no more than that is not leaned on.
 */
export function leanStretches(use: BuildingUse, unit: Unit, width: number): readonly (readonly [number, number])[] {
  const bars: [number, number][] = [];
  const bar = (a: number, b: number): void => void bars.push([a - LEAN_EDGE, b + LEAN_EDGE]);
  for (const o of unit.openings) if (o.cover !== "bricked") bar(o.s0, o.s1);
  bar(unit.door.s - unit.door.width / 2, unit.door.s + unit.door.width / 2);
  if (use.stair !== null) bar(use.stair.s - use.stair.width / 2, use.stair.s + use.stair.width / 2);
  for (const sign of [...unit.signs, ...use.signs]) if (sign.place.wall === "front" && sign.place.h < 2.4) bar(sign.place.s - 0.75, sign.place.s + 0.75);
  bars.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = Math.max(0, unit.s0) + LEAN_EDGE;
  const end = Math.min(width, unit.s1) - LEAN_EDGE;
  for (const [a, b] of bars) {
    if (a - at >= LEAN_BLANK && Math.min(a, end) - at >= LEAN_BLANK) out.push([at, Math.min(a, end)]);
    at = Math.max(at, b);
  }
  if (end - at >= LEAN_BLANK) out.push([at, end]);
  return out;
}

/**
 * Everyone outside in the downtown, in the plan's own frame plus `anchor` (the world's): the same plan gives the same people.
 */
export function outdoorPeopleFor(plan: TownPlan, anchor: { readonly x: number; readonly z: number }): readonly OutdoorPerson[] {
  const known = cache.get(plan);
  if (known !== undefined) return known;
  let placed: Placed[] = [];
  const byId = new Map<number, Building>();
  for (const b of plan.buildings) byId.set(b.id, b);
  const units = openDowntownUnits(plan);

  /**
   * A place is free if no one at the same time is nearer than they should stand (`apart` for the same place, `PEOPLE_APART` for any other).
   * The caps hold at every moment: the most at one place at once, counting the two of a pair, stays under the reason's and under the unit's.
   */
  const free = (x: number, z: number, start: number, length: number, where: string, apart: number): boolean => {
    for (const q of placed) {
      if (Math.hypot(q.px - x, q.pz - z) < (q.place === where ? apart : PEOPLE_APART) && sameTime(q, { start, length }, 0.05)) return false;
    }
    return true;
  };
  const most = (match: (q: Placed) => boolean, start: number, length: number): number => {
    const mine = { start, length };
    const near = placed.filter((q) => match(q) && sameTime(q, mine));
    let best = 0;
    for (const t of [start, ...near.map((q) => q.start)]) {
      if (!stayHolds(mine, t)) continue;
      best = Math.max(best, near.filter((q) => stayHolds(q, t)).length);
    }
    return best;
  };
  const room = (where: string, reason: ReasonId, caps: readonly [number, number], add: number, start: number, length: number): boolean =>
    most((q) => q.place === where, start, length) + add <= caps[0] && most((q) => q.place === where && q.reason === reason, start, length) + add <= caps[1];

  const modelFor = (x: number, z: number, start: number, length: number, key: number, idx: number): PersonModel => {
    const used = new Set<PersonModel>();
    for (const q of placed) if (Math.hypot(q.px - x, q.pz - z) < NEIGHBOUR && sameTime(q, { start, length }, 0.25)) used.add(q.model);
    const first = Math.floor(roll(key, idx, 0, 31) * PERSON_MODELS.length);
    for (let k = 0; k < PERSON_MODELS.length; k++) {
      const m = PERSON_MODELS[(first + k) % PERSON_MODELS.length] as PersonModel;
      if (!used.has(m)) return m;
    }
    return PERSON_MODELS[first] as PersonModel;
  };
  const commit = (d: Draft, p: Place, key: number, idx: number, partner = -1): number => {
    const id = placed.length;
    placed.push({
      ...d, id, x: p.x + anchor.x, z: p.z + anchor.z, yaw: yawOf(p.fx, p.fz), model: modelFor(p.x, p.z, d.start, d.length, key, idx), partner, px: p.x, pz: p.z,
    });
    return id;
  };
  const link = (a: number, b: number): void => {
    (placed[a] as { partner: number }).partner = b;
    (placed[b] as { partner: number }).partner = a;
  };
  /** The two clips of a pair: one talks, one listens (or, over a morning coffee, sometimes holds a cup instead); or a cup each. Which of the two talks is a hash's. */
  const pairClips = (act: Act, reason: ReasonId, key: number, idx: number): [Activity, Activity] => {
    if (act === "cups") return ["cup", "cup"];
    const second: Activity = reason === "morning drink" && roll(key, idx, 14, 39) < 0.35 ? "cup" : "listen";
    return roll(key, idx, 15, 39) < 0.5 ? ["talk", second] : [second, "talk"];
  };

  /** The hours a band gives a person of `key`'s idx-th slot, inside the unit's, or null where none is left (or the stay would be shorter than the band's least). */
  const stay = (band: Band, key: number, idx: number, unit: Hours | null): { start: number; length: number } | null => {
    const u = unit === null ? { lo: -Infinity, hi: Infinity } : span(unit);
    const lo0 = unit === null ? 0 : u.lo;
    const hi0 = unit === null ? 24 : u.hi;
    // The band's edges are the person's own: moved by up to a quarter hour.
    const lo = Math.max(edgeAt(band.from, lo0, hi0) + (roll(key, idx, 1, 32) - 0.5) * 0.5, u.lo);
    const hi = Math.min(edgeAt(band.to, lo0, hi0) + (roll(key, idx, 2, 32) - 0.5) * 0.5, u.hi);
    const want = band.stay[0] + roll(key, idx, 3, 32) * (band.stay[1] - band.stay[0]);
    if (hi - lo < band.stay[0]) return null;
    const length = Math.min(want, hi - lo);
    const start = lo + roll(key, idx, 4, 32) * (hi - lo - length);
    return { start: wrapHour(start), length };
  };
  const hoursOfStay = (start: number, length: number): Hours & object => ({ open: wrapHour(start), close: wrapHour(start + length) });

  const rollStyle = (reason: Reason, key: number, idx: number): { scale: number; offset: number; rate: number } => ({
    scale: 0.95 + roll(key, idx, reason.bands.length, 33) * 0.09,
    offset: roll(key, idx, 0, 34) * 60,
    rate: 0.85 + roll(key, idx, 0, 35) * 0.25,
  });

  /** How many stays a band tries at a place: the whole number under its mean, and one more by chance. */
  const count = (band: Band, key: number, b: number): number => Math.floor(band.mean + roll(key, b, 0, 36));

  // --- Reasons tied to a unit.
  const byUnits: { use: BuildingUse; unit: Unit; b: Building; fr: NonNullable<BuildingUse["frame"]>; hours: Hours; trade: Trade; key: number; block: number; district: District }[] = [];
  for (const use of plan.uses) {
    const b = byId.get(use.building);
    const fr = use.frame;
    if (b === undefined || fr === null || !isDowntown(lotDistrict(plan, b))) continue;
    for (const unit of use.units) {
      if (unit.state !== "open" || unit.tenant === null) continue;
      const hours = unitHours(b, unit);
      if (hours === null) continue;
      const trade = unit.tenant.trade;
      const key = b.id * 131 + unit.id;
      const lot = plan.lots[b.lot] as { block: number; district: District };
      byUnits.push({ use, unit, b, fr, hours, trade, key, block: lot.block, district: lot.district });
      for (const reason of REASONS) {
        const needs = reason.needs;
        if ("trades" in needs) {
          if (!needs.trades.includes(trade)) continue;
        } else if ("roundTheClock" in needs) {
          if (hours !== "always" || !needs.roundTheClock.includes(trade)) continue;
        } else continue;
        const rIdx = REASONS.indexOf(reason);
        // A shopkeeper stands at their own door at some of the shops only.
        if (reason.id === "shopkeeper" && roll(key, rIdx, 0, 37) > 0.6) continue;
        const sideBias = roll(key, rIdx, 1, 38) < 0.5 ? -1 : 1;
        for (const [bandIx, band] of reason.bands.entries()) {
          const n = count(band, key * 7 + rIdx, bandIx);
          for (let k = 0; k < n; k++) {
            const idx = rIdx * 1000 + bandIx * 100 + k;
            const when = stay(band, key, idx, hours);
            if (when === null) continue;
            let act = pick(reason.acts, roll(key, idx, 5, 39));
            // A paper cup at night is the convenience store's and the gas station's; anywhere else a phone.
            if (act === "cup" && (reason.id === "night shop" || reason.id === "round the clock") && !CUP_AT.includes(trade)) act = "phone";
            const base: Draft = {
              reason: reason.id, x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: act === "pair" || act === "cups" ? "talk" : act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
              building: b.id, unit: unit.id, unitHours: hours, block: lot.block, district: lot.district, bench: -1, seat: null, place: `u${b.id}:${unit.id}`,
            };
            placeAtUnit(reason, unit, use, fr, base, act, trade, key, idx, sideBias);
          }
        }
      }
    }
  }

  /** Places a person (or a pair) in front of a unit by its reason's spot and its clip: the first of a few tries that is clear, clear of a wall or a pole ahead of them and with room at the place. */
  function placeAtUnit(reason: Reason, unit: Unit, use: BuildingUse, fr: NonNullable<BuildingUse["frame"]>, base: Draft, act: Act, trade: Trade, key: number, idx: number, sideBias: number): void {
    const spot = reason.spot;
    const P = (s: number, out: number): { x: number; z: number } => ({ x: fr.origin.x + fr.t.x * s + fr.n.x * out, z: fr.origin.z + fr.t.z * s + fr.n.z * out });
    const pair = act === "pair" || act === "cups";
    const wipe = act === "wipe";
    const lean = act === "lean";
    const caps: readonly [number, number] = [unitCap(trade), reason.cap];
    // One who looks at glass faces a window, not a wall; every other is held clear of a wall or a pole ahead.
    const glassSpot = spot.kind === "glass" || wipe;
    const stretches = lean ? leanStretches(use, unit, fr.width) : [];
    if (lean && stretches.length === 0) return;
    const [ca, cb] = pairClips(act, reason.id, key, idx);
    for (let attempt = 0; attempt < (reason.id === "waiting" ? 16 : 8); attempt++) {
      const r = (salt: number): number => roll(key, idx, attempt * 8 + salt, 40);
      let s = 0;
      let out = 0;
      let fx = -fr.n.x;
      let fz = -fr.n.z;
      if (spot.kind === "glass" || wipe) {
        // At a display window (a shopkeeper at any glass, an arm's length from it), facing the glass.
        const glass = unit.openings.filter((o) => (wipe ? o.cover === "display" || o.cover === "none" : o.cover === "display") && o.s1 - o.s0 > 0.7);
        if (glass.length === 0) return;
        const o = glass[Math.floor(r(0) * glass.length)] as (typeof glass)[number];
        s = o.s0 + 0.35 + r(1) * (o.s1 - o.s0 - 0.7);
        const range = wipe ? WIPE_OUT : spot.kind === "glass" ? spot.out : WIPE_OUT;
        out = range[0] + r(2) * (range[1] - range[0]);
        [fx, fz] = turn(-fr.n.x, -fr.n.z, (r(3) - 0.5) * (wipe ? 0.2 : 0.4));
      } else if (lean) {
        // Blank wall: the back to it, facing straight out, a few degrees off square.
        const st = stretches[Math.floor(r(0) * stretches.length)] as (typeof stretches)[number];
        s = st[0] + LEAN_BLANK / 2 + r(1) * (st[1] - st[0] - LEAN_BLANK);
        out = LEAN_OUT;
        [fx, fz] = turn(fr.n.x, fr.n.z, (r(3) - 0.5) * 0.14);
      } else if (spot.kind === "beside") {
        // Beside the door, to the side the place keeps (the other side on later tries), out of its way.
        const side = attempt % 2 === 0 ? sideBias : -sideBias;
        const gap = spot.gap[0] + r(1) * (spot.gap[1] - spot.gap[0]);
        s = unit.door.s + side * (unit.door.width / 2 + gap);
        out = spot.out[0] + r(2) * (spot.out[1] - spot.out[0]);
        if (s < unit.s0 + 0.3 || s > unit.s1 - 0.3) continue;
        // Facing: one who waits, the street or along it; one with a phone or a cup anywhere but into the wall.
        const wide = base.activity === "phone" || base.activity === "call" || base.activity === "cup";
        const turnBy = (wide ? 0.1 + r(3) * 1.35 : 0.25 + r(3) * 0.85) * (r(4) < 0.5 ? -1 : 1);
        [fx, fz] = turn(fr.n.x, fr.n.z, turnBy);
      } else continue;
      if (pair) {
        // Two a metre apart along the front, turned to each other and each opened a little toward the street.
        const gap = PAIR_APART + r(5) * (PAIR_FAR - PAIR_APART);
        if (s - gap / 2 < unit.s0 + 0.3 || s + gap / 2 > unit.s1 - 0.3) continue;
        const a = P(s - gap / 2, out);
        const b = P(s + gap / 2, out);
        const [afx, afz] = openedToward(fr.t.x, fr.t.z, fr.n.x, fr.n.z, PAIR_OPEN[0] + r(6) * (PAIR_OPEN[1] - PAIR_OPEN[0]));
        const [bfx, bfz] = openedToward(-fr.t.x, -fr.t.z, fr.n.x, fr.n.z, PAIR_OPEN[0] + r(7) * (PAIR_OPEN[1] - PAIR_OPEN[0]));
        if (!standable(plan, a.x, a.z) || !standable(plan, b.x, b.z) || !facingClear(plan, a.x, a.z, afx, afz) || !facingClear(plan, b.x, b.z, bfx, bfz)) continue;
        if (!free(a.x, a.z, base.start, base.length, base.place, reason.apart) || !free(b.x, b.z, base.start, base.length, base.place, reason.apart)) continue;
        if (!room(base.place, reason.id, caps, 2, base.start, base.length)) return;
        const first = commit({ ...base, activity: ca }, { ...a, fx: afx, fz: afz }, key, idx);
        const second = commit({ ...base, activity: cb, ...rollStyle(reason, key, idx + 500) }, { ...b, fx: bfx, fz: bfz }, key, idx + 500);
        link(first, second);
        return;
      }
      const p = P(s, out);
      if (!standableAt(p.x, p.z, lean) || (!glassSpot && !facingClear(plan, p.x, p.z, fx, fz)) || !free(p.x, p.z, base.start, base.length, base.place, reason.apart)) continue;
      if (!room(base.place, reason.id, caps, 1, base.start, base.length)) return;
      commit(base, { ...p, fx, fz }, key, idx);
      return;
    }
  }
  /** Whether a spot is standable: a leaner's is one that is only too near the wall behind them, which they lean on. */
  function standableAt(x: number, z: number, lean: boolean): boolean {
    if (!lean) return standable(plan, x, z);
    return whyNot(plan, x, z, -1, true, true) === "";
  }

  // The places the floor falls back to when no business has room: a corner's curb ramp, a bench.
  const cornerSpots: { key: number; where: string; mx: number; mz: number; ix: number; iz: number; il: number; block: Block }[] = [];
  const benchSpots: { f: (typeof plan.props.furniture)[number]; block: Block }[] = [];

  // --- Benches.
  for (const f of plan.props.furniture) {
    if (f.kind !== "bench") continue;
    const near = blockNear(plan, f.x, f.z, 16);
    if (near === null || !isDowntown(near.block.district)) continue;
    benchSpots.push({ f, block: near.block });
    const reason = REASONS.find((r) => r.id === "bench") as Reason;
    const rIdx = REASONS.indexOf(reason);
    const where = `f${f.id}`;
    for (const [bandIx, band] of reason.bands.entries()) {
      const n = count(band, f.id * 7 + rIdx, bandIx);
      for (let k = 0; k < n; k++) {
        const idx = rIdx * 1000 + bandIx * 100 + k;
        const when = stay(band, f.id, idx, null);
        if (when === null) continue;
        if (!free(f.x, f.z, when.start, when.length, where, reason.apart) || !room(where, reason.id, [reason.cap, reason.cap], 1, when.start, when.length)) continue;
        sitOnBench(f, near.block, reason, idx, when, pick(reason.acts, roll(f.id, idx, 5, 39)) as Activity);
      }
    }
  }

  /** Sits a person on a bench for `when`: they look across its place to the street, as the bench does. */
  function sitOnBench(f: (typeof plan.props.furniture)[number], block: Block, reason: Reason, idx: number, when: { start: number; length: number }, act: Activity): void {
    const left = { x: -f.hz, z: f.hx };
    const lot = plan.lots[f.lot];
    const side = lot === undefined ? 1 : -f.hz * lot.front.x + f.hx * lot.front.z >= 0 ? 1 : -1;
    const [fx, fz] = turn(left.x * side, left.z * side, (roll(f.id, idx, 7, 41) - 0.5) * 0.12);
    // Sat so the back of the hips is on the bench's back (drawn 0.30 m behind the bench's middle: `BENCH_BACK`), a little off the middle along it.
    const off = (roll(f.id, idx, 8, 41) - 0.5) * 0.3;
    const base: Draft = {
      reason: "bench", x: 0, z: 0, yaw: 0, ...rollStyle(reason, f.id, idx), activity: act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
      building: -1, unit: -1, unitHours: null, block: block.id, district: block.district, bench: f.id, seat: { furnishing: -1, top: BENCH_SEAT, family: "chair" }, place: `f${f.id}`,
    };
    commit(base, { x: f.x + f.hx * off - left.x * side * (BENCH_BACK - SIT_BEHIND), z: f.z + f.hz * off - left.z * side * (BENCH_BACK - SIT_BEHIND), fx, fz }, f.id, idx);
  }

  // --- Corners.
  const corners = plan.junctions.filter((j) => j.corners.length > 0 && (j.kind === "four-way" || j.kind === "tee" || j.kind === "skew" || j.kind === "bend"));
  for (const j of corners) {
    const near = blockNear(plan, j.x, j.z, 22);
    if (near === null || !isDowntown(near.block.district)) continue;
    cornersOf(j, near.block);
  }

  function cornersOf(j: Junction, block: Block): void {
    const reason = REASONS.find((r) => r.id === "corner") as Reason;
    const rIdx = REASONS.indexOf(reason);
    for (const [ci, c] of j.corners.entries()) {
      if (!c.walk || !c.curb || c.lot === null || c.v === null) continue;
      const key = j.id * 17 + ci;
      const where = `c${j.id}:${ci}`;
      // The middle of the curb return (the corner of the two curbs where it is not round), and in from it toward the sidewalk's corner.
      let mx = c.v.x;
      let mz = c.v.z;
      if (c.shape === "arc" && c.c !== null) {
        const dx = c.v.x - c.c.x;
        const dz = c.v.z - c.c.z;
        const l = Math.hypot(dx, dz) || 1;
        mx = c.c.x + (dx / l) * c.radius;
        mz = c.c.z + (dz / l) * c.radius;
      }
      const ix = c.lot.x - mx;
      const iz = c.lot.z - mz;
      const il = Math.hypot(ix, iz) || 1;
      cornerSpots.push({ key, where, mx, mz, ix, iz, il, block });
      for (const [bandIx, band] of reason.bands.entries()) {
        const n = count(band, key * 7 + rIdx, bandIx);
        for (let k = 0; k < n; k++) {
          const idx = rIdx * 1000 + bandIx * 100 + k;
          const when = stay(band, key, idx, null);
          if (when === null) continue;
          standAtCorner(cornerSpots[cornerSpots.length - 1] as (typeof cornerSpots)[number], when, key, idx, null);
        }
      }
    }
  }

  /** Puts a person at a corner's curb ramp for `when`, on the first clear try of four; `act` is the clip, or null for the corner reason's own draw. */
  function standAtCorner(c: (typeof cornerSpots)[number], when: { start: number; length: number }, key: number, idx: number, act: Activity | null): boolean {
    const reason = REASONS.find((r) => r.id === "corner") as Reason;
    for (let attempt = 0; attempt < 4; attempt++) {
      const inward = 0.85 + attempt * 0.35 + roll(key, idx, attempt, 42) * 0.3;
      const x = c.mx + (c.ix / c.il) * inward;
      const z = c.mz + (c.iz / c.il) * inward;
      // Across the roadway, along one of the two crossings: out from the sidewalk's corner, turned toward one leg or the other.
      const [fx, fz] = turn(-c.ix / c.il, -c.iz / c.il, (roll(key, idx, 9, 42) < 0.5 ? -1 : 1) * (0.5 + roll(key, idx, 10, 42) * 0.5));
      if (!standable(plan, x, z, -1, false) || !facingClear(plan, x, z, fx, fz) || !free(x, z, when.start, when.length, c.where, reason.apart)) continue;
      if (!room(c.where, reason.id, [reason.cap, reason.cap], 1, when.start, when.length)) return false;
      const base: Draft = {
        reason: "corner", x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: act ?? (pick(reason.acts, roll(key, idx, 5, 39)) as Activity), hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
        building: -1, unit: -1, unitHours: null, block: c.block.id, district: c.block.district, bench: -1, seat: null, place: c.where,
      };
      commit(base, { x, z, fx, fz }, key, idx);
      return true;
    }
    return false;
  }

  // --- The quay. A small downtown has a small quay's worth of people: the means follow the town's open downtown units.
  const quayShare = Math.min(1, units / REFERENCE_UNITS);
  for (const w of plan.quay.wet) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    const tx = (w.b.x - w.a.x) / len;
    const tz = (w.b.z - w.a.z) / len;
    const sx = plan.quay.seaward.x;
    const sz = plan.quay.seaward.z;
    const pieces = freePieces({ plan, anchor: { x: 0, z: 0 } } as unknown as TownGround, w.a, w.b);
    // A place every 14 m along the apron, where it is downtown and no deck leaves it.
    for (const [p0, p1] of pieces) {
      const slots = Math.max(1, Math.floor((p1 - p0) / 14));
      for (let q = 0; q < slots; q++) {
        const s0 = p0 + ((p1 - p0) * (q + 0.5)) / slots;
        const key = 900000 + Math.round(s0 * 10);
        const where = `q${key}`;
        const cx = w.a.x + tx * s0;
        const cz = w.a.z + tz * s0;
        const near = blockNear(plan, cx, cz, 70);
        if (near === null || !isDowntown(near.block.district)) continue;
        for (const reason of REASONS) {
          if (!("place" in reason.needs) || reason.needs.place !== "quay") continue;
          const rIdx = REASONS.indexOf(reason);
          const spot = reason.spot as Extract<Spot, { kind: "apron" }>;
          for (const [bandIx, band] of reason.bands.entries()) {
            const n = count({ ...band, mean: band.mean * quayShare }, key * 7 + rIdx, bandIx);
            for (let k = 0; k < n; k++) {
              const idx = rIdx * 1000 + bandIx * 100 + k;
              const when = stay(band, key, idx, null);
              if (when === null) continue;
              const act = pick(reason.acts, roll(key, idx, 5, 39));
              const pair = act === "cups";
              const [ca, cb] = pairClips(act, reason.id, key, idx);
              const base: Draft = {
                reason: reason.id, x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: pair ? ca : (act as Activity), hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
                building: -1, unit: -1, unitHours: null, block: near.block.id, district: near.block.district, bench: -1, seat: null, place: where,
              };
              for (let attempt = 0; attempt < 6; attempt++) {
                const along = s0 + (roll(key, idx, attempt, 43) - 0.5) * 9;
                const off = spot.off[0] + roll(key, idx, attempt, 44) * (spot.off[1] - spot.off[0]);
                const at = (s: number): { x: number; z: number } => ({ x: w.a.x + tx * s + sx * off, z: w.a.z + tz * s + sz * off });
                const onApron = (p: { x: number; z: number }): boolean => {
                  const t = (p.x - w.a.x) * tx + (p.z - w.a.z) * tz;
                  return pieces.some(([a, b]) => t > a + 0.8 && t < b - 0.8);
                };
                if (pair) {
                  const gap = PAIR_APART + roll(key, idx, 16, 43) * (PAIR_FAR - PAIR_APART);
                  const a = at(along - gap / 2);
                  const b = at(along + gap / 2);
                  const [afx, afz] = openedToward(tx, tz, sx, sz, PAIR_OPEN[0] + roll(key, idx, 11, 43) * (PAIR_OPEN[1] - PAIR_OPEN[0]));
                  const [bfx, bfz] = openedToward(-tx, -tz, sx, sz, PAIR_OPEN[0] + roll(key, idx, 12, 43) * (PAIR_OPEN[1] - PAIR_OPEN[0]));
                  if (!onApron(a) || !onApron(b) || !standable(plan, a.x, a.z, -1, false) || !standable(plan, b.x, b.z, -1, false)) continue;
                  if (!facingClear(plan, a.x, a.z, afx, afz) || !facingClear(plan, b.x, b.z, bfx, bfz)) continue;
                  if (!free(a.x, a.z, base.start, base.length, where, reason.apart) || !free(b.x, b.z, base.start, base.length, where, reason.apart)) continue;
                  if (!room(where, reason.id, [reason.cap, reason.cap], 2, base.start, base.length)) break;
                  const first = commit(base, { ...a, fx: afx, fz: afz }, key, idx);
                  const second = commit({ ...base, activity: cb, ...rollStyle(reason, key, idx + 500) }, { ...b, fx: bfx, fz: bfz }, key, idx + 500);
                  link(first, second);
                  break;
                }
                const p = at(along);
                // Looking at the water, or a little along the quay.
                const [fx, fz] = turn(sx, sz, (roll(key, idx, 13, 43) - 0.5) * 0.7);
                if (!onApron(p) || !standable(plan, p.x, p.z, -1, false) || !facingClear(plan, p.x, p.z, fx, fz) || !free(p.x, p.z, base.start, base.length, where, reason.apart)) continue;
                if (!room(where, reason.id, [reason.cap, reason.cap], 1, base.start, base.length)) break;
                commit(base, { ...p, fx, fz }, key, idx);
                break;
              }
            }
          }
        }
      }
    }
  }

  // --- The floor: a small town's street is not left empty by the day. Walk the day by tenths and, where too few are out, put one more at an open business
  // (the first of them in a hash's order that has the room), staying from then for half an hour or more.
  for (let step = 75; step < 200; step++) {
    const t = step / 10;
    for (let more = 0; more < 8; more++) {
      if (placed.filter((p) => stayHolds(p, t)).length >= DAY_FLOOR(t, units)) break;
      const before = placed.length;
      const order = [...byUnits].sort((a, b) => roll(a.key, step, more, 60) - roll(b.key, step, more, 60) || a.key - b.key);
      for (const c of order) {
        const u = span(c.hours);
        const start = t - roll(c.key, step, more, 61) * 0.1;
        const length = Math.min(0.5 + roll(c.key, step, more, 62) * 0.4, u.hi - start - 0.01);
        if (u.lo > start || length < 0.5) continue;
        const reason = REASONS.find((r) => r.id === "waiting") as Reason;
        const idx = 90000 + step * 8 + more;
        const act = pick(reason.acts, roll(c.key, idx, 5, 39));
        const base: Draft = {
          reason: "waiting", x: 0, z: 0, yaw: 0, ...rollStyle(reason, c.key, idx), activity: act as Activity, hours: hoursOfStay(start, length), start: wrapHour(start), length,
          building: c.b.id, unit: c.unit.id, unitHours: c.hours, block: c.block, district: c.district, bench: -1, seat: null, place: `u${c.b.id}:${c.unit.id}`,
        };
        placeAtUnit(reason, c.unit, c.use, c.fr, base, act, c.trade, c.key, idx, roll(c.key, idx, 1, 38) < 0.5 ? -1 : 1);
        if (placed.length > before) break;
      }
      // No business had room: a corner's curb ramp, or a bench.
      if (placed.length === before) {
        const when = { start: wrapHour(t), length: 0.3 + roll(step, more, 0, 64) * 0.2 };
        const corners = [...cornerSpots].sort((a, b) => roll(a.key, step, more, 65) - roll(b.key, step, more, 65) || a.key - b.key);
        for (const c of corners.slice(0, 6)) if (placed.length === before) standAtCorner(c, when, c.key, 95000 + step * 8 + more, "wait");
      }
      if (placed.length === before) {
        const reason = REASONS.find((r) => r.id === "bench") as Reason;
        const benches = [...benchSpots].sort((a, b) => roll(a.f.id, step, more, 66) - roll(b.f.id, step, more, 66) || a.f.id - b.f.id);
        for (const { f, block } of benches.slice(0, 6)) {
          const length = 1 + roll(f.id, step, more, 67) * 1.5;
          const where = `f${f.id}`;
          if (!free(f.x, f.z, t, length, where, reason.apart) || !room(where, reason.id, [reason.cap, reason.cap], 1, t, length)) continue;
          sitOnBench(f, block, reason, 95000 + step * 8 + more, { start: wrapHour(t), length }, "sit_rest");
          break;
        }
      }
      if (placed.length === before) break;
    }
  }

  placed = thinned(placed, units);
  const out: readonly OutdoorPerson[] = placed;
  cache.set(plan, out);
  return out;
}

/**
 * The people left once the downtown is held under `ceilingAt` at every moment (every twentieth of an hour): where there are too many, whoever the hash
 * puts last goes (the two of a pair together), and the rest are numbered again.
 */
function thinned(all: readonly Placed[], units: number): Placed[] {
  const gone = new Set<number>();
  const rank = (p: Placed): number => hashN(Math.min(p.id, p.partner < 0 ? p.id : p.partner), 7, 7, 51);
  for (let step = 0; step < 24 * 20; step++) {
    const t = step / 20;
    const cap = ceilingAt(t, units);
    const here = all.filter((p) => !gone.has(p.id) && stayHolds(p, t));
    if (here.length <= cap) continue;
    here.sort((a, b) => rank(b) - rank(a) || b.id - a.id);
    let n = here.length;
    for (const p of here) {
      if (n <= cap) break;
      gone.add(p.id);
      n--;
      if (p.partner >= 0 && !gone.has(p.partner)) {
        gone.add(p.partner);
        n--;
      }
    }
  }
  const keep = all.filter((p) => !gone.has(p.id));
  const index = new Map<number, number>();
  for (const [i, p] of keep.entries()) index.set(p.id, i);
  return keep.map((p, i) => ({ ...p, id: i, partner: p.partner < 0 ? -1 : (index.get(p.partner) ?? -1) }));
}

/** Whether a person at (x, z) facing (fx, fz) has a metre ahead of them clear of a wall, a prop's box and a pole (looked at half a metre and a metre out). */
export function facingClear(plan: TownPlan, x: number, z: number, fx: number, fz: number): boolean {
  const g = groundOf(plan);
  for (const d of [FACE_REACH / 2, FACE_REACH]) {
    const px = x + fx * d;
    const pz = z + fz * d;
    for (const b of g.buildings) if (Math.abs(px - b.cx) < b.hu + b.hv + 2 && Math.abs(pz - b.cz) < b.hu + b.hv + 2 && rectDist(b, px, pz) < 0.1) return false;
    for (const b of g.boxes) if (Math.abs(px - b.cx) < b.hu + b.hv + 2 && Math.abs(pz - b.cz) < b.hu + b.hv + 2 && rectDist(b, px, pz) < 0.15) return false;
    for (const b of g.benches) if (rectDist(b, px, pz) < 0.1) return false;
    for (const t of g.things) if (Math.hypot(px - t.x, pz - t.z) < t.r + 0.1) return false;
  }
  return true;
}

/** Whether a person is there at `hour`. */
export function isThere(p: OutdoorPerson, hour: number): boolean {
  return stayHolds(p, hour);
}

/** Where a person stands in the world: the town ground's height there, or the apron's deck. */
export function outdoorWorld(g: TownGround, p: OutdoorPerson): PersonWorld {
  const deck = g.deckAt(p.x, p.z);
  return { x: p.x, y: Number.isFinite(deck) ? Math.max(deck, g.heightAt(p.x, p.z)) : g.heightAt(p.x, p.z), z: p.z, yaw: p.yaw };
}
