/**
 * Who is outside in the downtown, and why: people who STAND or SIT somewhere for a reason, at the hours that reason holds. This is the drawing's,
 * not the simulation's, as `people.ts` is: nothing here is in the plan, nothing is kept between frames, and the same plan gives the same people
 * on every machine (every draw is a hash of a unit's, a bench's or a corner's id and the slot's index, never a random function or the clock).
 * `people.ts` keeps the people inside the rooms; this file is the street's.
 *
 * A person outside is a SLOT: a place, a reason, a clip (one of the twelve the models carry; there is no walking clip) and the hours of the day
 * they are there. `REASONS` is the table of reasons as data, a row each, for the owner to read and change: what a reason needs near it, where the
 * person stands against it, the clips and how often each, and its bands (the stretches of the day it holds, each with how many people it gives a
 * place, and how long each stays). A slot's own start and its length are drawn from its band by a hash, and its edges are moved by up to a quarter
 * hour, so that a street does not fill or empty on the stroke of an hour; most stays are twenty minutes to an hour, so a place has several people
 * in a row through the day, not one standing from nine to five.
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
 * same time but a pair talking (`PAIR_APART`, facing each other), and where the walk is wide enough, with a metre of it clear to pass. Every place
 * is a world place, and its height is the town ground's (`outdoorWorld`).
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
/** How far apart two people at the same hour stand, at least; and a pair that talk, who face each other. */
export const PEOPLE_APART = 0.8;
export const PAIR_APART = 0.9;
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
/** The open downtown units of the town the table was tuned on ("sorrow"): a quay of a smaller downtown has proportionally fewer people. */
export const REFERENCE_UNITS = 46;

/** An edge of a band: a clock hour, or an offset from the unit's opening or closing (a closing after midnight is counted past 24). */
export type Edge = readonly ["abs", number] | readonly ["open", number] | readonly ["close", number];
const abs = (h: number): Edge => ["abs", h];
const open = (h: number): Edge => ["open", h];
const close = (h: number): Edge => ["close", h];

/** A stretch of the day that a reason holds: `mean` stays are tried for each place (the whole number below it, or the one above by chance), each of `stay` hours. A try that finds no clear spot at its hours, with no one nearer than they should stand, is not there, so the town's room sets how many there are. */
export type Band = { readonly from: Edge; readonly to: Edge; readonly mean: number; readonly stay: readonly [number, number] };

/** Where a person stands against what they are there for. */
export type Spot =
  /** Facing the glass about `out` from it, in front of an opening. */
  | { readonly kind: "glass"; readonly out: readonly [number, number] }
  /** Beside the door, off the door's way: `gap` from the door's edge along the front and `out` from the wall. All of a place's people stand on one side. */
  | { readonly kind: "beside"; readonly gap: readonly [number, number]; readonly out: readonly [number, number] }
  /** On a bench. */
  | { readonly kind: "bench" }
  /** At the curb's ramp of a street corner. */
  | { readonly kind: "corner" }
  /** On the quay's apron: `off` metres seaward of the quay line. */
  | { readonly kind: "apron"; readonly off: readonly [number, number] };

export type ReasonId =
  | "morning drink" | "lunch" | "errand" | "window shopping" | "shopkeeper" | "break" | "bench" | "corner" | "tavern" | "dinner" | "theater" | "night shop" | "round the clock"
  | "quay at first light" | "quay by day" | "quay at dusk";

export type Reason = {
  readonly id: ReasonId;
  /** Why they are there, in a line. */
  readonly why: string;
  /** What it needs: units of these trades, an always-open unit, a bench, a corner or the quay. */
  readonly needs: { readonly trades: readonly Trade[] } | { readonly roundTheClock: readonly Trade[] } | { readonly place: "bench" | "corner" | "quay" };
  readonly spot: Spot;
  /** The clips and how often each: a pair is two people who talk. */
  readonly acts: readonly (readonly [Activity | "pair", number])[];
  readonly bands: readonly Band[];
};

const COFFEE: readonly Trade[] = ["cafe", "espresso stand", "bakery"];
const WINDOWS: readonly Trade[] = [
  "clothing", "gift shop", "gallery", "kite shop", "candy shop", "bookstore", "game shop", "jeweler", "antiques", "thrift store", "variety store", "sporting goods",
  "furniture store", "hardware", "pharmacy", "tattoo parlor", "pawn shop", "marine supply", "bait and tackle", "cannabis shop",
];
const OFFICES: readonly Trade[] = [
  "bank", "credit union", "post office", "insurance office", "real estate office", "law office", "tax office", "title company", "medical clinic", "dentist", "newspaper office", "print shop",
  "union hall",
];

/**
 * The reasons, as the owner reads them. A band's hours are the clock's (a closing after midnight counts past 24); where a band's edge is the unit's
 * opening or closing, the unit's own hours (moved by an hour or none from its trade's) are used; a slot never goes outside the unit's hours.
 */
export const REASONS: readonly Reason[] = [
  {
    id: "morning drink", why: "a coffee outside a cafe, a bakery or the espresso stand: one with a drink, one on the phone, a pair talking",
    needs: { trades: [...COFFEE, "diner"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.55, 1.3] },
    acts: [["drink", 4], ["phone", 2], ["pair", 3]],
    bands: [{ from: open(0), to: abs(10), mean: 15, stay: [0.25, 0.7] }],
  },
  {
    id: "lunch", why: "waiting for a table or a pickup at a diner, a restaurant or a pizza place: one waiting, or a pair",
    needs: { trades: ["diner", "restaurant", "pizza and burgers", "cafe"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.55, 1.4] },
    acts: [["phone", 3], ["idle", 2], ["pair", 3]],
    bands: [{ from: abs(11.5), to: abs(13.5), mean: 12, stay: [0.2, 0.55] }],
  },
  {
    id: "window shopping", why: "looking in a shop's window, more at lunch and after three",
    needs: { trades: WINDOWS }, spot: { kind: "glass", out: [0.7, 0.95] },
    acts: [["browse", 1]],
    bands: [
      { from: abs(10.5), to: abs(12), mean: 4.2, stay: [0.15, 0.4] },
      { from: abs(12), to: abs(14), mean: 6.6, stay: [0.15, 0.4] },
      { from: abs(14), to: abs(15), mean: 3.6, stay: [0.15, 0.4] },
      { from: abs(15), to: close(-0.3), mean: 7.8, stay: [0.15, 0.45] },
    ],
  },
  {
    id: "shopkeeper", why: "the shopkeeper at their own door just after opening and just before closing",
    needs: { trades: [...WINDOWS, ...COFFEE, "diner", "barber", "hair salon", "grocery"] }, spot: { kind: "beside", gap: [0.7, 1.1], out: [0.4, 0.6] },
    acts: [["idle", 2], ["wipe", 1]],
    bands: [
      { from: open(0.05), to: open(0.5), mean: 3, stay: [0.15, 0.3] },
      { from: close(-0.5), to: close(-0.05), mean: 3, stay: [0.1, 0.25] },
    ],
  },
  {
    id: "errand", why: "a minute outside the grocery, the pharmacy or the hardware store on the way home: on the phone, a drink, waiting for someone",
    needs: { trades: ["grocery", "pharmacy", "hardware", "convenience store", "liquor store", "bakery"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.5, 1.4] },
    acts: [["phone", 3], ["idle", 2], ["drink", 1], ["pair", 1]],
    bands: [
      { from: abs(9.5), to: abs(12), mean: 3.6, stay: [0.15, 0.4] },
      { from: abs(15), to: abs(19), mean: 9, stay: [0.15, 0.45] },
    ],
  },
  {
    id: "break", why: "a break outside an office, a bank or the post office at about ten, noon and three",
    needs: { trades: OFFICES }, spot: { kind: "beside", gap: [1.1, 4.2], out: [0.4, 0.9] },
    acts: [["phone", 3], ["idle", 2]],
    bands: [
      { from: abs(10), to: abs(10.5), mean: 6, stay: [0.15, 0.3] },
      { from: abs(12), to: abs(13), mean: 8.4, stay: [0.2, 0.5] },
      { from: abs(15), to: abs(15.5), mean: 5.4, stay: [0.15, 0.3] },
    ],
  },
  {
    id: "bench", why: "sitting on a bench: an old man most of the morning, lunch at noon, a rest in the afternoon, never in the dead of night",
    needs: { place: "bench" }, spot: { kind: "bench" },
    acts: [["sit_table", 3], ["sit_eat", 0]],
    bands: [
      { from: abs(7), to: abs(11), mean: 7.5, stay: [0.8, 2.2] },
      { from: abs(11.5), to: abs(13.5), mean: 6, stay: [0.4, 0.8] },
      { from: abs(14), to: abs(17.5), mean: 7.5, stay: [0.3, 1.2] },
      { from: abs(17.5), to: abs(20), mean: 4.5, stay: [0.3, 0.9] },
    ],
  },
  {
    id: "corner", why: "waiting to cross at a corner of a downtown street",
    needs: { place: "corner" }, spot: { kind: "corner" },
    acts: [["idle", 3], ["phone", 1]],
    bands: [
      { from: abs(7.5), to: abs(9.5), mean: 4.2, stay: [0.05, 0.15] },
      { from: abs(11.5), to: abs(13.5), mean: 6.6, stay: [0.05, 0.15] },
      { from: abs(15.5), to: abs(18), mean: 7.8, stay: [0.05, 0.15] },
      { from: abs(18), to: abs(20.5), mean: 3.6, stay: [0.05, 0.15] },
    ],
  },
  {
    id: "tavern", why: "outside a tavern from early evening until it closes: talking in pairs, a drink, a phone; the last leave at closing",
    needs: { trades: ["tavern"] }, spot: { kind: "beside", gap: [0.8, 4.5], out: [0.8, 2.0] },
    acts: [["pair", 4], ["drink", 3], ["phone", 2]],
    bands: [
      { from: abs(16.5), to: abs(17.5), mean: 3.6, stay: [0.3, 0.8] },
      { from: abs(17.5), to: abs(20), mean: 14.4, stay: [0.3, 0.9] },
      { from: abs(20), to: abs(23), mean: 21, stay: [0.3, 1.1] },
      { from: abs(23), to: close(0), mean: 12, stay: [0.2, 0.7] },
    ],
  },
  {
    id: "dinner", why: "outside a restaurant between six and nine: a pair",
    needs: { trades: ["restaurant", "pizza and burgers"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.6, 1.5] },
    acts: [["pair", 3], ["phone", 1]],
    bands: [{ from: abs(18), to: abs(21), mean: 12, stay: [0.2, 0.5] }],
  },
  {
    id: "theater", why: "outside the movie theater for the half hour before seven and nine: a small group",
    needs: { trades: ["movie theater"] }, spot: { kind: "beside", gap: [0.9, 2.6], out: [0.7, 1.6] },
    acts: [["pair", 3], ["phone", 2], ["idle", 1]],
    bands: [
      { from: abs(18.4), to: abs(18.8), mean: 9, stay: [0.3, 0.55] },
      { from: abs(20.4), to: abs(20.8), mean: 9, stay: [0.3, 0.55] },
    ],
  },
  {
    id: "night shop", why: "outside the convenience store or the laundromat in the evening and at night while it is open: one, on the phone or with a drink",
    needs: { trades: ["convenience store", "laundromat", "liquor store"] }, spot: { kind: "beside", gap: [0.9, 4.2], out: [0.5, 1.3] },
    acts: [["phone", 3], ["drink", 2]],
    bands: [{ from: abs(18.5), to: close(0), mean: 15, stay: [0.15, 0.5] }],
  },
  {
    id: "round the clock", why: "the one person at a business that never shuts, even in the dead of night",
    needs: { roundTheClock: ["hotel", "motel", "gas station"] }, spot: { kind: "beside", gap: [0.9, 2.4], out: [0.5, 1.2] },
    acts: [["phone", 3], ["drink", 2]],
    bands: [
      { from: abs(0), to: abs(5), mean: 1.8, stay: [0.2, 0.5] },
      { from: abs(21), to: abs(24), mean: 4.5, stay: [0.2, 0.6] },
    ],
  },
  {
    id: "quay at first light", why: "the boats' crews by the piers at first light, with a drink or talking",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.4, 2.8] },
    acts: [["drink", 3], ["pair", 3], ["phone", 1]],
    bands: [{ from: abs(5), to: abs(8), mean: 0.7, stay: [0.4, 1.2] }],
  },
  {
    id: "quay by day", why: "looking at the water through the day, or on the phone",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.6, 3.0] },
    acts: [["idle", 3], ["phone", 1]],
    bands: [{ from: abs(8), to: abs(18), mean: 7.2, stay: [0.3, 1.0] }],
  },
  {
    id: "quay at dusk", why: "almost nobody after dark: one looking at the lights on the water",
    needs: { place: "quay" }, spot: { kind: "apron", off: [1.6, 3.0] },
    acts: [["idle", 2], ["phone", 1]],
    bands: [{ from: abs(18), to: abs(22), mean: 0.5, stay: [0.2, 0.6] }],
  },
];

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
};

/** The people of a plan's downtown; the world's places are `plan` plus the anchor. */
export type OutdoorPlan = readonly OutdoorPerson[];

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan's obstacles, in the plan's frame, made once for a plan.

type Rect = { readonly cx: number; readonly cz: number; readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number };
type Disc = { readonly x: number; readonly z: number; readonly r: number };
/** A curb return: the pavement fills the triangle of its two tangent points and the curbs' meeting point, outside the circle the return is round about (whose centre is in the sidewalk's corner). */
type Fillet = { readonly c: Disc; readonly pts: readonly [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }] };
type Seg = {
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

type Ground = {
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

const rectDist = (r: Rect, x: number, z: number): number => {
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

function groundOf(plan: TownPlan): Ground {
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

/** Whether a point is in a roadway (a street's, an alley's, a flight of stairs', or a curb return's), with `margin` to spare. */
export function inRoadway(plan: TownPlan, x: number, z: number, margin: number): boolean {
  const g = groundOf(plan);
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

/** Why a point is not standable, or "" where it is (for the tests and for looking). */
export function whyNot(plan: TownPlan, x: number, z: number, own = -1, onWalk = true): string {
  const g = groundOf(plan);
  if (inRoadway(plan, x, z, ROAD_CLEAR)) return "roadway";
  for (const b of g.buildings) if (Math.abs(x - b.cx) < b.hu + b.hv + 2 && Math.abs(z - b.cz) < b.hu + b.hv + 2 && rectDist(b, x, z) < WALL_CLEAR) return "building";
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
function span(h: Hours): { lo: number; hi: number } {
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

type Draft = Omit<OutdoorPerson, "id" | "model" | "partner" | "px" | "pz">;
type Placed = OutdoorPerson;

type Place = { x: number; z: number; fx: number; fz: number };

const cache = new WeakMap<TownPlan, readonly OutdoorPerson[]>();

/** The district of a unit's lot (the building's), or undefined for a building on piles. */
const lotDistrict = (plan: TownPlan, b: Building): District | undefined => plan.lots[b.lot]?.district;

/**
 * Everyone outside in the downtown, in the plan's own frame plus `anchor` (the world's): the same plan gives the same people.
 */
export function outdoorPeopleFor(plan: TownPlan, anchor: { readonly x: number; readonly z: number }): readonly OutdoorPerson[] {
  const known = cache.get(plan);
  if (known !== undefined) return known;
  const placed: Placed[] = [];
  const byId = new Map<number, Building>();
  for (const b of plan.buildings) byId.set(b.id, b);

  // A place is taken if anyone there at the same time is nearer than they should be, and the model is chosen not to be a neighbour's.
  const free = (x: number, z: number, start: number, length: number, except: number): boolean => {
    for (const q of placed) {
      if (q.id === except) continue;
      if (Math.hypot(q.px - x, q.pz - z) < PEOPLE_APART && sameTime(q, { start, length }, 0.05)) return false;
    }
    return true;
  };
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

  /** The hours a band gives a person of `key`'s idx-th slot, inside the unit's, or null where none is left. */
  const stay = (band: Band, key: number, idx: number, unit: Hours | null): { start: number; length: number } | null => {
    const u = unit === null ? { lo: -Infinity, hi: Infinity } : span(unit);
    const lo0 = unit === null ? 0 : u.lo;
    const hi0 = unit === null ? 24 : u.hi;
    // The band's edges are the person's own: moved by up to a quarter hour.
    const lo = Math.max(edgeAt(band.from, lo0, hi0) + (roll(key, idx, 1, 32) - 0.5) * 0.5, u.lo);
    const hi = Math.min(edgeAt(band.to, lo0, hi0) + (roll(key, idx, 2, 32) - 0.5) * 0.5, u.hi);
    const want = band.stay[0] + roll(key, idx, 3, 32) * (band.stay[1] - band.stay[0]);
    const length = Math.min(want, hi - lo);
    if (length < Math.min(0.1, band.stay[0] * 0.6) || hi <= lo) return null;
    const start = lo + roll(key, idx, 4, 32) * (hi - lo - length);
    return { start: wrapHour(start), length };
  };
  const hoursOfStay = (start: number, length: number): Hours & object => ({ open: wrapHour(start), close: wrapHour(start + length) });

  const rollStyle = (reason: Reason, key: number, idx: number): { scale: number; offset: number; rate: number } => ({
    scale: 0.95 + roll(key, idx, reason.bands.length, 33) * 0.09,
    offset: roll(key, idx, 0, 34) * 60,
    rate: 0.85 + roll(key, idx, 0, 35) * 0.25,
  });

  /** How many a band gives a place: the whole number under its mean, and one more by chance. */
  const count = (band: Band, key: number, b: number): number => Math.floor(band.mean + roll(key, b, 0, 36));

  // --- Reasons tied to a unit.
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
            const act = pick(reason.acts, roll(key, idx, 5, 39));
            const base: Draft = {
              reason: reason.id, x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: act === "pair" ? "talk" : act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
              building: b.id, unit: unit.id, unitHours: hours, block: lot.block, district: lot.district, bench: -1, seat: null,
            };
            placeAtUnit(reason, unit, fr, base, key, idx, sideBias, act === "pair");
          }
        }
      }
    }
  }

  /** Places a person (or a pair) in front of a unit by its reason's spot: the first of a few tries that is clear. */
  function placeAtUnit(reason: Reason, unit: Unit, fr: NonNullable<BuildingUse["frame"]>, base: Draft, key: number, idx: number, sideBias: number, pair: boolean): void {
    const spot = reason.spot;
    const P = (s: number, out: number): { x: number; z: number } => ({ x: fr.origin.x + fr.t.x * s + fr.n.x * out, z: fr.origin.z + fr.t.z * s + fr.n.z * out });
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = (salt: number): number => roll(key, idx, attempt * 8 + salt, 40);
      let s = 0;
      let out = 0;
      let fx = -fr.n.x;
      let fz = -fr.n.z;
      if (spot.kind === "glass") {
        const glass = unit.openings.filter((o) => o.cover !== "bricked" && o.cover !== "boarded" && o.s1 - o.s0 > 0.7);
        if (glass.length === 0) return;
        const o = glass[Math.floor(r(0) * glass.length)] as (typeof glass)[number];
        s = o.s0 + 0.35 + r(1) * (o.s1 - o.s0 - 0.7);
        out = spot.out[0] + r(2) * (spot.out[1] - spot.out[0]);
        [fx, fz] = turn(-fr.n.x, -fr.n.z, (r(3) - 0.5) * 0.4);
      } else if (spot.kind === "beside") {
        // Beside the door, to the side the place keeps (the other side on later tries), out of its way.
        const side = attempt % 2 === 0 ? sideBias : -sideBias;
        const gap = spot.gap[0] + r(1) * (spot.gap[1] - spot.gap[0]);
        s = unit.door.s + side * (unit.door.width / 2 + gap);
        out = spot.out[0] + r(2) * (spot.out[1] - spot.out[0]);
        if (s < unit.s0 + 0.3 || s > unit.s1 - 0.3) continue;
        // Facing along the front or a little toward the street, never at the wall; a shopkeeper who wipes faces the glass.
        if (base.activity === "wipe") [fx, fz] = turn(-fr.n.x, -fr.n.z, (r(3) - 0.5) * 0.3);
        else {
          const toStreet = (0.25 + r(3) * 0.8) * (r(4) < 0.5 ? -1 : 1);
          [fx, fz] = turn(fr.n.x, fr.n.z, toStreet);
        }
      } else continue;
      if (pair) {
        // Two facing each other along the front, about a metre apart.
        const a = P(s - PAIR_APART / 2, out);
        const b = P(s + PAIR_APART / 2, out);
        if (!standable(plan, a.x, a.z) || !standable(plan, b.x, b.z)) continue;
        if (!free(a.x, a.z, base.start, base.length, -1) || !free(b.x, b.z, base.start + 0.05, base.length, -1)) continue;
        const shift = (roll(key, idx, 6, 41) - 0.5) * 0.15;
        const first = commit(base, { ...a, ...turned(fr.t.x, fr.t.z, (r(5) - 0.5) * 0.3) }, key, idx);
        const second = commit({ ...base, start: wrapHour(base.start + shift + 0.04), ...rollStyle(reason, key, idx + 500) }, { ...b, ...turned(-fr.t.x, -fr.t.z, (r(6) - 0.5) * 0.3) }, key, idx + 500);
        link(first, second);
        return;
      }
      const p = P(s, out);
      const why = whyNot(plan, p.x, p.z);
      if (why !== "" || !free(p.x, p.z, base.start, base.length, -1)) {
        continue;
      }
      commit(base, { ...p, fx, fz }, key, idx);
      return;
    }
  }

  // --- Benches.
  for (const f of plan.props.furniture) {
    if (f.kind !== "bench") continue;
    const near = blockNear(plan, f.x, f.z, 16);
    if (near === null || !isDowntown(near.block.district)) continue;
    const reason = REASONS.find((r) => r.id === "bench") as Reason;
    const rIdx = REASONS.indexOf(reason);
    for (const [bandIx, band] of reason.bands.entries()) {
      const n = count(band, f.id * 7 + rIdx, bandIx);
      for (let k = 0; k < n; k++) {
        const idx = rIdx * 1000 + bandIx * 100 + k;
        const when = stay(band, f.id, idx, null);
        if (when === null) continue;
        if (!free(f.x, f.z, when.start, when.length, -1)) continue;
        // At noon they eat; otherwise they sit with nothing in hand.
        const noon = band.from[1] === 11.5;
        const act: Activity = noon ? "sit_eat" : "sit_table";
        // The bench looks across its place to the street; the sitter looks where it does.
        const left = { x: -f.hz, z: f.hx };
        const lot = plan.lots[f.lot];
        const side = lot === undefined ? 1 : -f.hz * lot.front.x + f.hx * lot.front.z >= 0 ? 1 : -1;
        const [fx, fz] = turn(left.x * side, left.z * side, (roll(f.id, idx, 7, 41) - 0.5) * 0.2);
        // Sat a little forward of the back, and to one end of the bench when it is a short sit.
        const off = (roll(f.id, idx, 8, 41) - 0.5) * 0.3;
        const base: Draft = {
          reason: "bench", x: 0, z: 0, yaw: 0, ...rollStyle(reason, f.id, idx), activity: act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
          building: -1, unit: -1, unitHours: null, block: near.block.id, district: near.block.district, bench: f.id, seat: { furnishing: -1, top: BENCH_SEAT, family: "chair" },
        };
        commit(base, { x: f.x + f.hx * off + left.x * side * 0.04, z: f.z + f.hz * off + left.z * side * 0.04, fx, fz }, f.id, idx);
      }
    }
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
      for (const [bandIx, band] of reason.bands.entries()) {
        const n = count(band, key * 7 + rIdx, bandIx);
        for (let k = 0; k < n; k++) {
          const idx = rIdx * 1000 + bandIx * 100 + k;
          const when = stay(band, key, idx, null);
          if (when === null) continue;
          for (let attempt = 0; attempt < 4; attempt++) {
            const inward = 0.85 + attempt * 0.35 + roll(key, idx, attempt, 42) * 0.3;
            const x = mx + (ix / il) * inward;
            const z = mz + (iz / il) * inward;
            if (!standable(plan, x, z, -1, false) || !free(x, z, when.start, when.length, -1)) continue;
            // Across the roadway, along one of the two crossings: out from the sidewalk's corner, turned toward one leg or the other.
            const [fx, fz] = turn(-ix / il, -iz / il, (roll(key, idx, 9, 42) < 0.5 ? -1 : 1) * (0.5 + roll(key, idx, 10, 42) * 0.5));
            const act = pick(reason.acts, roll(key, idx, 5, 39)) as Activity;
            const base: Draft = {
              reason: "corner", x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
              building: -1, unit: -1, unitHours: null, block: block.id, district: block.district, bench: -1, seat: null,
            };
            commit(base, { x, z, fx, fz }, key, idx);
            break;
          }
        }
      }
    }
  }

  // --- The quay. A small downtown has a small quay's worth of people: the means follow the town's open downtown units.
  const openUnits = plan.uses.reduce((n, use) => {
    const b = byId.get(use.building);
    return n + (b !== undefined && isDowntown(lotDistrict(plan, b)) ? use.units.filter((u) => u.state === "open").length : 0);
  }, 0);
  const quayShare = Math.min(1, openUnits / REFERENCE_UNITS);
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
              const pair = act === "pair";
              const base: Draft = {
                reason: reason.id, x: 0, z: 0, yaw: 0, ...rollStyle(reason, key, idx), activity: pair ? "talk" : act, hours: hoursOfStay(when.start, when.length), start: when.start, length: when.length,
                building: -1, unit: -1, unitHours: null, block: near.block.id, district: near.block.district, bench: -1, seat: null,
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
                  const a = at(along - PAIR_APART / 2);
                  const b = at(along + PAIR_APART / 2);
                  if (!onApron(a) || !onApron(b) || !standable(plan, a.x, a.z, -1, false) || !standable(plan, b.x, b.z, -1, false)) continue;
                  if (!free(a.x, a.z, base.start, base.length, -1) || !free(b.x, b.z, base.start, base.length, -1)) continue;
                  const first = commit(base, { ...a, ...turned(tx, tz, (roll(key, idx, 11, 43) - 0.5) * 0.4) }, key, idx);
                  const second = commit({ ...base, start: wrapHour(base.start + 0.03), ...rollStyle(reason, key, idx + 500) }, { ...b, ...turned(-tx, -tz, (roll(key, idx, 12, 43) - 0.5) * 0.4) }, key, idx + 500);
                  link(first, second);
                  break;
                }
                const p = at(along);
                if (!onApron(p) || !standable(plan, p.x, p.z, -1, false) || !free(p.x, p.z, base.start, base.length, -1)) continue;
                // Looking at the water, or a little along the quay; a drink in hand looks out as well.
                const [fx, fz] = turn(sx, sz, (roll(key, idx, 13, 43) - 0.5) * 0.7);
                commit(base, { ...p, fx, fz }, key, idx);
                break;
              }
            }
          }
        }
      }
    }
  }

  const out: readonly OutdoorPerson[] = placed;
  cache.set(plan, out);
  return out;
}

/** The turn of a facing by `radians`, as an object a place takes. */
function turned(fx: number, fz: number, radians: number): { fx: number; fz: number } {
  const [x, z] = turn(fx, fz, radians);
  return { fx: x, fz: z };
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
