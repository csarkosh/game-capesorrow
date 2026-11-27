/**
 * People who walk from one business to another: the drawing's, pure, from the plan by hashes, as `outdoorPeople.ts` is. Nothing is kept between
 * frames and nothing is simulated: a walker's place is a function of the day's hour alone, so the same plan gives the same walkers on every machine.
 *
 * A WALKER is one end of a TRIP: out of the door of an open business at game hour `t0`, along the sidewalks, across a street at a corner if it must,
 * and in at the door of another open business. The trip's path is made once (`walkersFor`) as a polyline; where a walker is at an hour is the
 * distance `(hour - t0) * HOUR_S * speed` along it. A walker walks at a speed of their own, 0.95 to 1.7 m/s of real time (`speedOf`), so a trip of 150 m is about a game hour.
 *
 * NOT A MATCHED SET. Each walker has a speed, a line across the walk, a way round a corner and a pair of ends of their own (`speedOf`, `styleOf`, `fit`): two out
 * together differ in speed, none shares a destination or an origin with another out at once, and a faster one that catches a slower takes a line round them.
 *
 * WHY THEY GO is `WALK_REASONS`, a table of data for the owner: a coffee in the morning and on to work, errands between the bank, the post office
 * and the shops, lunch out and back, an evening at a restaurant or a tavern, the night's convenience store. A reason says what it goes from, what it
 * goes to, and how many trips an hour the reference town (`REFERENCE_UNITS` open units) has of it in each stretch of the day; a town's size scales
 * them. Both ends are open at the hours of leaving and arriving. Nearer ends are likelier; a trip is 30 to 220 m of walking.
 *
 * THE PATH. The sidewalks and the crossings at corners make a small graph (`walkNet`): a node at each curb ramp of a corner, a sidewalk edge from
 * a corner to the next along the same side of a street, and a crossing edge straight across a street from the corner on one side of it to the corner
 * on the other. A trip is the shortest way through it from the foot of one door to the foot of the other. Along a sidewalk the walker keeps to a
 * lane 0.35 m to the right of the middle (so two who meet pass), moved sideways by a small search (`lateral`) where a prop, a pole or a person who stands
 * is in the way, and the whole trip is given up where there is no way round. The polyline's corners are turned over about a metre of path, the walker
 * facing along it; it begins `depth` m inside the door's plane (0.7 to 1.9 m: as far in as the room's clear floor allows) at the middle of the door and ends the same way; the door
 * opens for them and shuts behind them (`openDoors.ts`).
 *
 * KEEPING APART. At every instant a walker is clear of every building and every prop's box (`WALK_PROP`), 0.6 m from every stander there at that hour
 * and 0.65 m from every other walker but its partner; a trip that cannot keep all of that is moved in time by its hashes or dropped. No two trips leave one
 * door within 20 real seconds, and the whole town is held under `walkCeilingAt`, counted beside the standers.
 */
import { HOUR_S } from "../dayClock.js";
import { hashN } from "./groundNoise.js";
import { MIN_IN, doorDepth, doorFits, doorLook, doorSet, doorWalkS, leafOf } from "./openDoors.js";
import { isOpen, unitHours, wrapHour, type Hours } from "./hours.js";
import {
  REFERENCE_UNITS, groundOf, inRoadway, isDowntown, openDowntownUnits, outdoorPeopleFor, rectDist, standable, stayHolds, type Disc, type Ground, type OutdoorPerson, type Rect, type Seg,
} from "./outdoorPeople.js";
import { PERSON_MODELS, type PersonModel, type PersonWorld } from "./people.js";
import type { TownGround } from "./townTypes.js";
import type { Building, BuildingUse, Junction, TownPlan, Trade, Unit } from "../../sim/town/types.js";

/**
 * A walker's real speed, metres a second, is the person's own: bell-shaped about `SPEED_MEAN` and kept to the band, so most are between 1.15 and 1.5, about
 * one in eight is a slow walker under 1.1 and about one in eight a brisk one over 1.55. Two who are out together within `SPEED_NEAR` of each other differ by
 * at least `SPEED_GAP` (the game hours' length in real seconds is the day clock's).
 */
export const WALK_SPEED: readonly [number, number] = [0.95, 1.7];
export const SPEED_MEAN = 1.31;
export const SPEED_SD = 0.17;
export const SPEED_GAP = 0.12;
export const SPEED_NEAR = 60;
/** Clear of a prop's box, a building's wall, a stander and another walker (metres). */
export const WALK_PROP = 0.45;
export const WALK_WALL = 0.3;
export const STANDER_CLEAR = 0.6;
export const WALKER_CLEAR = 0.65;
/** How far to the right of the middle of a sidewalk a walker keeps, and how far apart a pair walks (metres). */
export const LANE = 0.35;
export const PAIR_SIDE = 0.7;
/** The least a trip begins and ends inside the door's plane (a place's own is `doorDepth`, `openDoors.ts`: as far in as the room's clear floor allows, up to 1.9 m), where the door has opened for them. */
export const DOOR_IN = MIN_IN;
/** Corners are turned over about this much path on each side of the corner (metres). */
export const TURN_RADIUS = 1.4;
/** The distance between the points a path is resampled at. */
export const PATH_STEP = 0.2;
/** How long a trip may be, and the length the likeliest ones are (metres of walking). */
export const TRIP_LENGTH: readonly [number, number] = [30, 220];
/** Two trips leave one door at least this far apart (game hours: 20 real seconds). */
export const DOOR_GAP = 20 / HOUR_S;
/** One trip in this many has two walking side by side. */
export const PAIR_ONE_IN = 15;
/** A town's pairs are at most this share of its walkers. */
export const PAIR_SHARE = 0.06;
/** No destination or origin has more than about this share of a town's trips. */
export const END_SHARE = 0.06;
/** Two trips that share an end are apart by this much (game hours: 30 real seconds either side of the time they are out), or by a quarter hour where a small town cannot. */
export const END_APART = 30 / HOUR_S;
export const END_APART_SMALL = 0.25;

/**
 * What making a plan's walkers has cost, in work and not seconds (a test holds it to a bound that fits the budget): paths built, lines found, points of a path checked,
 * and fine steps of two walkers compared. Reset when a job begins.
 */
export const WALK_WORK = { builds: 0, lines: 0, points: 0, steps: 0 };
const STATION = 0.25;
const OFF_STEP = 0.15;
const JC = 13;
const NJ = 27;
/** The corner's zone, where the sidewalk is a corner's and not a street's: its ends are this near a node. */
const CORNER_ZONE = 6;
const CELL = 4;
/** How far either side of a crossing's line a walker may cross (metres): the crossing's width, within which each has a line of their own. */
export const CROSS_WIDTH = 1.5;

// ---------------------------------------------------------------------------------------------------------------------------------
// Why they go

export type WalkReasonId = "coffee" | "to work" | "errand" | "lunch out" | "lunch back" | "evening" | "late" | "night";

export type WalkReason = {
  readonly id: WalkReasonId;
  readonly why: string;
  readonly from: readonly Trade[];
  readonly to: readonly Trade[];
  /** Trips an hour of the reference town in each stretch of the day (hours of the clock). */
  readonly bands: readonly { readonly from: number; readonly to: number; readonly rate: number }[];
};

const COFFEE: readonly Trade[] = ["cafe", "espresso stand", "bakery"];
const DINING: readonly Trade[] = ["diner", "restaurant", "pizza and burgers", "cafe"];
const OFFICES: readonly Trade[] = [
  "bank", "credit union", "post office", "insurance office", "real estate office", "law office", "tax office", "title company", "medical clinic", "dentist", "newspaper office", "print shop",
  "union hall",
];
const SHOPS: readonly Trade[] = [
  "clothing", "gift shop", "gallery", "kite shop", "candy shop", "bookstore", "game shop", "jeweler", "antiques", "thrift store", "variety store", "sporting goods",
  "furniture store", "hardware", "pharmacy", "tattoo parlor", "pawn shop", "marine supply", "bait and tackle", "cannabis shop", "grocery", "barber", "hair salon",
];
/** The rest of what takes customers or has staff: a clinic's, a laundromat's, a vet's, a garage's. */
const SERVICES: readonly Trade[] = [
  "laundromat", "veterinarian", "auto repair", "auto parts", "tire shop", "saw and chain shop", "food bank", "funeral home", "bail bonds", "smoke shop", "fish market", "boat yard",
  "garden and feed", "liquor store", "convenience store", "lodge", "self storage",
];
const ERRANDS: readonly Trade[] = ["bank", "credit union", "post office", "pharmacy", "hardware", "grocery", "variety store", "bakery", "convenience store", "liquor store", "garden and feed", "marine supply"];
const NIGHT_PLACES: readonly Trade[] = ["convenience store", "gas station", "motel", "tavern", "liquor store"];
const BOARD: readonly Trade[] = ["hotel", "motel", "rooming house"];

/**
 * The reasons a person walks, as the owner reads them. The rates are trips an hour for the town the table was tuned on; a town with half the
 * open units has half the trips.
 */
export const WALK_REASONS: readonly WalkReason[] = [
  {
    id: "coffee", why: "to a cafe, a bakery or the espresso stand for a coffee before work, from a shop or an office or the room they sleep in",
    from: [...OFFICES, ...SHOPS, ...SERVICES, ...BOARD], to: COFFEE, bands: [{ from: 6.5, to: 9.8, rate: 11.47 }],
  },
  {
    id: "to work", why: "from the coffee on to an office, a bank or a shop that is opening",
    from: COFFEE, to: [...OFFICES, ...SHOPS, ...SERVICES], bands: [{ from: 7, to: 10.2, rate: 8.73 }],
  },
  {
    id: "errand", why: "between the bank, the post office, the pharmacy, the hardware store and the shops in the middle of the morning and the afternoon",
    from: [...ERRANDS, ...OFFICES, ...SHOPS, ...SERVICES, ...COFFEE], to: [...ERRANDS, ...OFFICES, ...SHOPS, ...SERVICES], bands: [{ from: 9.5, to: 11.5, rate: 8.73 }, { from: 11.5, to: 14, rate: 4.37 }, { from: 14, to: 17, rate: 9.83 }],
  },
  {
    id: "lunch out", why: "from an office or a shop to a diner, a restaurant, a pizza place or a cafe at noon",
    from: [...OFFICES, ...SHOPS, ...SERVICES], to: DINING, bands: [{ from: 11.2, to: 13.2, rate: 11.47 }],
  },
  {
    id: "lunch back", why: "from lunch back to an office or a shop",
    from: DINING, to: [...OFFICES, ...SHOPS, ...SERVICES], bands: [{ from: 12.1, to: 14.4, rate: 9.83 }],
  },
  {
    id: "evening", why: "to a restaurant, the tavern or the theater after work, and on from one to another",
    from: [...DINING, "tavern", "movie theater", ...OFFICES, ...SHOPS, ...SERVICES, ...BOARD], to: [...DINING, "tavern", "movie theater"],
    bands: [{ from: 16.8, to: 19, rate: 12.01 }, { from: 19, to: 21.5, rate: 8.73 }],
  },
  {
    id: "late", why: "late: from the tavern to the convenience store, the gas station or the motel",
    from: NIGHT_PLACES, to: NIGHT_PLACES, bands: [{ from: 21.5, to: 24, rate: 4.37 }],
  },
  {
    id: "night", why: "in the dead of night, the rare one between a motel and the gas station",
    from: ["motel", "gas station", "hotel"], to: ["motel", "gas station", "hotel"], bands: [{ from: 0, to: 5, rate: 0.33 }],
  },
];

/**
 * The most people the town may have walking at `hour`, for a town of `units` open downtown units against `REFERENCE_UNITS`: eight from ten to five,
 * four at eight and at eight at night, and one in the small hours, with ramps between. Never fewer than one.
 */
export function walkCeilingAt(hour: number, units: number): number {
  const h = wrapHour(hour);
  const curve: readonly (readonly [number, number])[] = [[0, 1], [5.5, 1], [7, 3], [8, 4.5], [10, 8], [17, 8], [19, 5], [20.5, 4.5], [22, 2], [24, 1]];
  let v = 1;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1] as readonly [number, number];
    const b = curve[i] as readonly [number, number];
    if (h <= b[0]) {
      v = a[1] + ((b[1] - a[1]) * (h - a[0])) / (b[0] - a[0]);
      break;
    }
  }
  return Math.max(1, Math.floor((v * units) / REFERENCE_UNITS + 0.5));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Obstacles, in the plan's frame, made once for a plan

type Obstacles = {
  readonly blocked: (x: number, z: number, wall: number, prop: number) => boolean;
  /** Whether a building's wall is nearer than `wall` (a door's own building too). */
  readonly wallNear: (x: number, z: number, wall: number) => boolean;
};

const cellOf = (x: number, z: number): number => (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096);

function obstaclesOf(g: Ground): Obstacles {
  const cells = new Map<number, number[]>();
  const R = 1 << 20;
  const add = (id: number, x0: number, z0: number, x1: number, z1: number): void => {
    for (let cx = Math.floor((x0 - 1.7) / CELL); cx <= Math.floor((x1 + 1.7) / CELL); cx++) {
      for (let cz = Math.floor((z0 - 1.7) / CELL); cz <= Math.floor((z1 + 1.7) / CELL); cz++) {
        const key = (cx + 4096) * 8192 + (cz + 4096);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [id]);
        else list.push(id);
      }
    }
  };
  const rects: Rect[] = [...g.buildings, ...g.boxes, ...g.benches];
  const nb = g.buildings.length;
  for (const [i, r] of rects.entries()) {
    const e = r.hu + r.hv;
    add(i, r.cx - e, r.cz - e, r.cx + e, r.cz + e);
  }
  const discs: Disc[] = [...g.things];
  for (const [i, d] of discs.entries()) add(R + i, d.x - d.r, d.z - d.r, d.x + d.r, d.z + d.r);
  return {
    blocked(x, z, wall, prop) {
      const list = cells.get(cellOf(x, z));
      if (list === undefined) return false;
      for (const id of list) {
        if (id >= R) {
          const d = discs[id - R] as Disc;
          if (Math.hypot(x - d.x, z - d.z) < d.r + prop) return true;
        } else if (rectDist(rects[id] as Rect, x, z) < (id < nb ? wall : prop)) return true;
      }
      return false;
    },
    wallNear(x, z, wall) {
      const list = cells.get(cellOf(x, z));
      if (list === undefined) return false;
      for (const id of list) if (id < nb && rectDist(rects[id] as Rect, x, z) < wall) return true;
      return false;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The net of sidewalks and crossings

type Node = { readonly x: number; readonly z: number; readonly junction: number; readonly corner: number };

type Edge = {
  readonly kind: "walk" | "cross" | "link";
  readonly a: number;
  readonly b: number;
  readonly len: number;
  /** The unit vector from a to b. */
  readonly tx: number;
  readonly tz: number;
  readonly ax: number;
  readonly az: number;
  /** The street segments it runs along (a sidewalk may pass from one street's id to the next's). */
  readonly segs: readonly Seg[];
  /** For each station along it and each offset to the right of a to b, whether a walker may stand there (made when first wanted). */
  feas: Uint8Array | null;
  /** Whether the edge can be walked at all (made when first wanted). */
  usable: boolean | null;
};

type Net = {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  /** For each node, the edges that meet it. */
  readonly at: readonly (readonly number[])[];
  readonly ground: Ground;
  readonly plan: TownPlan;
  readonly obst: Obstacles;
  /** The edges whose line passes within 6 m of a point, by cell. */
  readonly near: (x: number, z: number) => readonly number[];
};

const nets = new WeakMap<TownPlan, Net>();

/** Where a person waiting at a corner stands on its curb ramp (`outdoorPeople.ts` stands them there too), or null where nothing is clear. */
function rampOf(plan: TownPlan, obst: Obstacles, corner: Junction["corners"][number]): { x: number; z: number } | null {
  if (!corner.walk || !corner.curb || corner.lot === null || corner.v === null) return null;
  let mx = corner.v.x;
  let mz = corner.v.z;
  if (corner.shape === "arc" && corner.c !== null) {
    const dx = corner.v.x - corner.c.x;
    const dz = corner.v.z - corner.c.z;
    const l = Math.hypot(dx, dz) || 1;
    mx = corner.c.x + (dx / l) * corner.radius;
    mz = corner.c.z + (dz / l) * corner.radius;
  }
  const ix = corner.lot.x - mx;
  const iz = corner.lot.z - mz;
  const il = Math.hypot(ix, iz) || 1;
  for (let attempt = 0; attempt < 9; attempt++) {
    const inward = 1 + attempt * 0.4;
    const x = mx + (ix / il) * inward;
    const z = mz + (iz / il) * inward;
    if (standable(plan, x, z, -1, false) && !obst.blocked(x, z, WALK_WALL, WALK_PROP + 0.01)) return { x, z };
  }
  return null;
}

export function walkNet(plan: TownPlan): Net {
  const known = nets.get(plan);
  if (known !== undefined) return known;
  const ground = groundOf(plan);
  const obst = obstaclesOf(ground);
  const segOf = new Map<number, Seg>();
  for (const s of ground.segs) segOf.set(s.street.id, s);
  const nodes: Node[] = [];
  const nodeAt = new Map<string, number>();
  for (const j of plan.junctions) {
    for (const [ci, c] of j.corners.entries()) {
      const r = rampOf(plan, obst, c);
      if (r === null) continue;
      nodeAt.set(`${j.id}:${ci}`, nodes.length);
      nodes.push({ x: r.x, z: r.z, junction: j.id, corner: ci });
    }
  }
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const addEdge = (kind: Edge["kind"], a: number, b: number): void => {
    const key = `${kind}:${Math.min(a, b)}:${Math.max(a, b)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const na = nodes[a] as Node;
    const nb = nodes[b] as Node;
    const len = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (len < 1) return;
    const tx = (nb.x - na.x) / len;
    const tz = (nb.z - na.z) / len;
    const segs: Seg[] = [];
    if (kind === "walk") {
      for (const q of ground.segs) {
        if (Math.abs(q.tx * tx + q.tz * tz) < 0.9) continue;
        let near = false;
        for (let f = 0; f <= 4 && !near; f++) {
          const px = na.x + tx * len * (f / 4);
          const pz = na.z + tz * len * (f / 4);
          const t = Math.min(Math.max((px - q.ax) * q.tx + (pz - q.az) * q.tz, 0), q.len);
          near = Math.hypot(px - q.ax - q.tx * t, pz - q.az - q.tz * t) < q.half + 1.5;
        }
        if (near) segs.push(q);
      }
    }
    edges.push({ kind, a, b, len, tx, tz, ax: na.x, az: na.z, segs, feas: null, usable: null });
  };
  const ends = new Map<string, number | undefined>();
  const endOf = (j: Junction, li: number, left: boolean, seg: Seg): number | undefined => {
    const key = `${j.id}:${li}:${left ? "L" : "R"}`;
    if (ends.has(key)) return ends.get(key);
    const leg = j.legs[li] as Junction["legs"][number];
    const sameWay = leg.dx * seg.tx + leg.dz * seg.tz > 0;
    const sideEdge = seg.edge.sides[(left ? 0 : 1) === (sameWay ? 0 : 1) ? 0 : 1] as Seg["edge"]["sides"][number];
    let made: number | undefined;
    if (sideEdge.walk > 0) {
      const lateral = seg.cw + sideEdge.verge + sideEdge.walk / 2;
      const nx = left ? -leg.dz : leg.dz;
      const nz = left ? leg.dx : -leg.dx;
      for (const out of [1.6, 3.2, 5.5, 8.5, 12]) {
        const along = (left ? leg.bandLeft : leg.bandRight) + out;
        const x = leg.x + leg.dx * along + nx * lateral;
        const z = leg.z + leg.dz * along + nz * lateral;
        if (standable(plan, x, z, -1, true) && !obst.blocked(x, z, WALK_WALL, WALK_PROP + 0.01)) {
          made = nodes.length;
          nodes.push({ x, z, junction: j.id, corner: -1 });
          break;
        }
      }
    }
    ends.set(key, made);
    return made;
  };
  /** The far end of a leg's street where it has no junction to end at (a street's end): the walk's middle a little short of the street's end. */
  const farOf = (j: Junction, li: number, left: boolean, seg: Seg): number | undefined => {
    const key = `far:${j.id}:${li}:${left ? "L" : "R"}`;
    if (ends.has(key)) return ends.get(key);
    const leg = j.legs[li] as Junction["legs"][number];
    const sameWay = leg.dx * seg.tx + leg.dz * seg.tz > 0;
    const sideEdge = seg.edge.sides[(left ? 0 : 1) === (sameWay ? 0 : 1) ? 0 : 1] as Seg["edge"]["sides"][number];
    let made: number | undefined;
    if (sideEdge.walk > 0 && leg.to > 12) {
      const lateral = seg.cw + sideEdge.verge + sideEdge.walk / 2;
      const nx = left ? -leg.dz : leg.dz;
      const nz = left ? leg.dx : -leg.dx;
      for (const back of [1.5, 4, 7, 11, 16]) {
        const x = leg.x + leg.dx * (leg.to - back) + nx * lateral;
        const z = leg.z + leg.dz * (leg.to - back) + nz * lateral;
        if (standable(plan, x, z, -1, true) && !obst.blocked(x, z, WALK_WALL, WALK_PROP + 0.01)) {
          made = nodes.length;
          nodes.push({ x, z, junction: j.id, corner: -2 });
          break;
        }
      }
    }
    ends.set(key, made);
    return made;
  };
  for (const j of plan.junctions) {
    const n = j.legs.length;
    for (const [li, leg] of j.legs.entries()) {
      if (leg.engine || leg.closed || leg.kind === "highway" || leg.kind === "road") continue;
      const seg = segOf.get(leg.street);
      // The next junction along the leg: the nearest one ahead of it, on its line, that has a leg looking back (the street may change its id there).
      let best: { j: Junction; li: number; t: number } | null = null;
      for (const jk of plan.junctions) {
        if (jk.id === j.id) continue;
        // Its leg that looks back along this one: starting near this leg's line, at about the length of this leg's street.
        const lk = jk.legs.findIndex((l) => {
          if (l.engine || l.kind === "highway" || l.dx * leg.dx + l.dz * leg.dz >= -0.9) return false;
          const t = (l.x - leg.x) * leg.dx + (l.z - leg.z) * leg.dz;
          const perp = (l.x - leg.x) * -leg.dz + (l.z - leg.z) * leg.dx;
          return t > 1 && t <= leg.to + 4 && Math.abs(perp) <= 3.5;
        });
        if (lk < 0) continue;
        const l = jk.legs[lk] as Junction["legs"][number];
        const t = (l.x - leg.x) * leg.dx + (l.z - leg.z) * leg.dz;
        if (best === null || t < best.t) best = { j: jk, li: lk, t };
      }
      // Cross this leg, from the corner on its right to the corner on its left (both are on this junction's curb returns).
      const right = nodeAt.get(`${j.id}:${(li - 1 + n) % n}`) ?? (seg === undefined || !leg.walkRight ? undefined : endOf(j, li, false, seg));
      const left = nodeAt.get(`${j.id}:${li}`) ?? (seg === undefined || !leg.walkLeft ? undefined : endOf(j, li, true, seg));
      if (right !== undefined && left !== undefined) {
        const a = nodes[right] as Node;
        const b = nodes[left] as Node;
        if (Math.hypot(a.x - b.x, a.z - b.z) <= 26) addEdge("cross", right, left);
      }
      if (seg === undefined) continue;
      if (best === null) {
        // A street that ends: its sidewalks end near its end.
        if (leg.walkLeft) {
          const a = nodeAt.get(`${j.id}:${li}`) ?? endOf(j, li, true, seg);
          const b = farOf(j, li, true, seg);
          if (a !== undefined && b !== undefined) addEdge("walk", a, b);
        }
        if (leg.walkRight) {
          const a = nodeAt.get(`${j.id}:${(li - 1 + n) % n}`) ?? endOf(j, li, false, seg);
          const b = farOf(j, li, false, seg);
          if (a !== undefined && b !== undefined) addEdge("walk", a, b);
        }
        continue;
      }
      const nk = best.j.legs.length;
      // The leg's left side is the next junction's leg's right side, which is the corner before it. Where a corner has no ramp of its own the sidewalk ends
      // at the junction: its end is a point of the walk's middle just outside the junction's pavement.
      if (leg.walkLeft) {
        const a = nodeAt.get(`${j.id}:${li}`) ?? endOf(j, li, true, seg);
        const b = nodeAt.get(`${best.j.id}:${(best.li - 1 + nk) % nk}`) ?? endOf(best.j, best.li, false, segOf.get((best.j.legs[best.li] as Junction["legs"][number]).street) ?? seg);
        if (a !== undefined && b !== undefined) addEdge("walk", a, b);
      }
      if (leg.walkRight) {
        const a = nodeAt.get(`${j.id}:${(li - 1 + n) % n}`) ?? endOf(j, li, false, seg);
        const b = nodeAt.get(`${best.j.id}:${best.li}`) ?? endOf(best.j, best.li, true, segOf.get((best.j.legs[best.li] as Junction["legs"][number]).street) ?? seg);
        if (a !== undefined && b !== undefined) addEdge("walk", a, b);
      }
    }
  }
  // Round a corner that has no ramp: the two ends of the sidewalks that meet there, joined across its pavement when they are near.
  for (const [i, a] of nodes.entries()) {
    for (let k = i + 1; k < nodes.length; k++) {
      const b = nodes[k] as Node;
      if (b.junction !== a.junction || Math.hypot(a.x - b.x, a.z - b.z) > 7) continue;
      addEdge("link", i, k);
    }
  }
  const at: number[][] = nodes.map(() => []);
  for (const [i, e] of edges.entries()) {
    (at[e.a] as number[]).push(i);
    (at[e.b] as number[]).push(i);
  }
  const cells = new Map<number, number[]>();
  for (const [i, e] of edges.entries()) {
    const x1 = e.ax + e.tx * e.len;
    const z1 = e.az + e.tz * e.len;
    for (let cx = Math.floor((Math.min(e.ax, x1) - 6) / CELL); cx <= Math.floor((Math.max(e.ax, x1) + 6) / CELL); cx++) {
      for (let cz = Math.floor((Math.min(e.az, z1) - 6) / CELL); cz <= Math.floor((Math.max(e.az, z1) + 6) / CELL); cz++) {
        const key = (cx + 4096) * 8192 + (cz + 4096);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [i]);
        else list.push(i);
      }
    }
  }
  const made: Net = { nodes, edges, at, ground, plan, obst, near: (x, z) => cells.get(cellOf(x, z)) ?? [] };
  nets.set(plan, made);
  return made;
}

/** Whether a point is on the sidewalk side of a street's segment that an edge runs along (the street's own walk, with a hand to spare). */
function onWalkOf(e: Edge, x: number, z: number): boolean {
  for (const seg of e.segs) {
    const dn = (x - seg.ax) * seg.nx + (z - seg.az) * seg.nz;
    const side = seg.edge.sides[dn > 0 ? 0 : 1] as Seg["edge"]["sides"][number];
    if (side.walk <= 0) continue;
    const along = (x - seg.ax) * seg.tx + (z - seg.az) * seg.tz;
    if (along < -0.5 || along > seg.len + 0.5) continue;
    const d = Math.abs(dn);
    const lo = seg.cw + side.verge;
    if (d >= lo + 0.1 && d <= lo + side.walk - 0.1 && mergedRuns(side.runs).some((r) => along >= r[0] + 0.1 && along <= r[1] - 0.1)) return true;
    // Where the sidewalk was never poured (a stretch no one paid for, a drive) people walk the strip beside it: from the curb to the right of way's edge.
    if (d >= seg.cw + 0.3 && d <= seg.half - 0.25) return true;
  }
  return false;
}

/** A side's pours as stretches, the ones that meet joined: a walker crosses the joint between two pours. */
const merged = new WeakMap<object, readonly (readonly [number, number])[]>();
function mergedRuns(runs: readonly { readonly s0: number; readonly s1: number }[]): readonly (readonly [number, number])[] {
  const known = merged.get(runs);
  if (known !== undefined) return known;
  const out: [number, number][] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last !== undefined && r.s0 <= last[1] + 0.05) last[1] = Math.max(last[1], r.s1);
    else out.push([r.s0, r.s1]);
  }
  merged.set(runs, out);
  return out;
}

const stationsOf = (e: Edge): number => Math.ceil(e.len / STATION) + 1;
const stationAt = (e: Edge, k: number): number => Math.min(k * STATION, e.len);

/** The point at station `k` of an edge, `off` metres to the right of travel from a to b. */
function pointOn(e: Edge, s: number, off: number): { x: number; z: number } {
  return { x: e.ax + e.tx * s + e.tz * off, z: e.az + e.tz * s - e.tx * off };
}

/** The feasible stations and offsets of an edge, made once: a walk edge's are the walk's, clear of buildings and props; a crossing's the middle line only. */
function feasOf(net: Net, e: Edge): Uint8Array {
  if (e.feas !== null) return e.feas;
  const nk = stationsOf(e);
  const feas = new Uint8Array(nk * NJ);
  for (let k = 0; k < nk; k++) {
    const s = stationAt(e, k);
    const corner = s < CORNER_ZONE || s > e.len - CORNER_ZONE;
    for (let j = 0; j < NJ; j++) {
      if (e.kind !== "walk" && j !== JC) continue;
      const p = pointOn(e, s, (j - JC) * OFF_STEP);
      // A corner's own pavement is the corner's; elsewhere it must be the street's walk.
      let ok = e.kind === "cross" ? true : e.kind === "link" ? !inRoadway(net.plan, p.x, p.z, 0.05) : corner ? !inRoadway(net.plan, p.x, p.z, 0.05) : onWalkOf(e, p.x, p.z);
      if (ok && (s > 0.3 && s < e.len - 0.3) && net.obst.blocked(p.x, p.z, WALK_WALL, WALK_PROP)) ok = false;
      feas[k * NJ + j] = ok ? 1 : 0;
    }
  }
  e.feas = feas;
  return feas;
}

/**
 * The sideways offsets along a run of stations of an edge, as indices (`JC` the middle; more is to the right of travel), the cheapest way from one
 * end to the other: each step moves by at most one offset step, the lane is the aim, and moving costs. `from` and `to` are the first and last
 * station; a `fixed` end must be at the middle (a node's). `extra` says a point is taken (a stander, at the time the walker is there). Null where there is no way.
 */
function lateral(
  net: Net, e: Edge, from: number, to: number, aim: (k: number) => number, fixedStart: boolean, fixedEnd: boolean, extra: ((x: number, z: number, s: number) => boolean) | null, sBase: number,
  crowded: ((x: number, z: number) => boolean) | null = null,
): Int16Array | null {
  WALK_WORK.lines++;
  const feas = feasOf(net, e);
  const dir = to >= from ? 1 : -1;
  const reversed = dir < 0;
  const m = Math.abs(to - from) + 1;
  const INF = 1e9;
  let cost = new Float32Array(NJ).fill(INF);
  const back = new Int8Array(m * NJ);
  // Whether anyone stands near a station at all (known once for each): where no one does, `extra` is not asked of its cells.
  const crowd = new Uint8Array(m);
  const free = (idx: number, j: number): boolean => {
    const k = from + dir * idx;
    const jab = reversed ? 2 * JC - j : j;
    if (feas[k * NJ + jab] === 0) return false;
    if (extra === null) return true;
    if (crowded !== null) {
      if (crowd[idx] === 0) {
        const c = pointOn(e, stationAt(e, k), 0);
        crowd[idx] = crowded(c.x, c.z) ? 1 : 2;
      }
      if (crowd[idx] === 2) return true;
    }
    const s = stationAt(e, k);
    const p = pointOn(e, s, (jab - JC) * OFF_STEP);
    return !extra(p.x, p.z, sBase + Math.abs(s - stationAt(e, from)));
  };
  for (let j = 0; j < NJ; j++) {
    if (fixedStart && j !== JC) continue;
    if (free(0, j)) cost[j] = Math.abs(j - aim(from)) * 0.05;
  }
  let next = new Float32Array(NJ);
  for (let idx = 1; idx < m; idx++) {
    next.fill(INF);
    const a = aim(from + dir * idx);
    for (let j = 0; j < NJ; j++) {
      if (!free(idx, j)) continue;
      let bestC = INF;
      let bestD = 0;
      for (let d = -1; d <= 1; d++) {
        const q = j + d;
        if (q < 0 || q >= NJ) continue;
        const prev = cost[q] as number;
        if (prev >= INF) continue;
        const c = prev + (d === 0 ? 0 : 0.35);
        if (c < bestC) {
          bestC = c;
          bestD = d;
        }
      }
      if (bestC >= INF) continue;
      next[j] = bestC + Math.abs(j - a) * 0.05;
      back[idx * NJ + j] = bestD;
    }
    const swap = cost;
    cost = next;
    next = swap;
  }
  let end = -1;
  let endC = INF;
  for (let j = 0; j < NJ; j++) {
    if (fixedEnd && j !== JC) continue;
    if ((cost[j] as number) < endC) {
      endC = cost[j] as number;
      end = j;
    }
  }
  if (end < 0 || endC >= INF / 2) return null;
  const out = new Int16Array(m);
  let j = end;
  for (let idx = m - 1; idx >= 0; idx--) {
    out[idx] = j;
    j += back[idx * NJ + j] as number;
  }
  return out;
}

/** Whether an edge can be walked at all by a walker with no one else about: its stations in order each have an offset, joined. */
function usableEdge(net: Net, e: Edge): boolean {
  if (e.usable !== null) return e.usable;
  const nk = stationsOf(e);
  e.usable = lateral(net, e, 0, nk - 1, () => JC, true, true, null, 0) !== null;
  return e.usable;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Places: the doors of the open businesses

type Place = {
  readonly id: number;
  readonly building: Building;
  readonly unit: Unit;
  readonly use: BuildingUse;
  readonly trade: Trade;
  readonly hours: Hours;
  /** The door's middle on the wall, in the plan's frame, and the way out of it. */
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  /** The walk edge it comes out on, and how far from the edge's first end the foot of the door is. */
  readonly edge: number;
  readonly s: number;
  readonly perp: number;
  /** How far inside the door's plane a trip begins and ends here (`doorDepth`). */
  readonly depth: number;
  /** The fastest a walker leaves by this door: the leaf opens in about 0.6 s as they begin to walk, and a faster walker would reach its sweep before it is open (`exitCap`). */
  readonly cap: number;
};

export type Walker = {
  readonly id: number;
  readonly reason: WalkReasonId;
  readonly model: PersonModel;
  readonly scale: number;
  /** Where in the clip they start, seconds, and a clip rate near 1 (the drawing sets the rate that matches the speed). */
  readonly offset: number;
  /** Real metres a second. */
  readonly speed: number;
  /** The game hour they leave, 0 up to 24, and the length of the path (metres). */
  readonly t0: number;
  readonly length: number;
  /** The path: x, z pairs in the plan's frame every `PATH_STEP` of path, and the length reached at each. */
  readonly pts: Float32Array;
  readonly cum: Float32Array;
  /** The other of a pair walking side by side, or -1. */
  readonly partner: number;
  /** Whether the quarter-hour rule for ends was used for this trip in place of the strict one (a small town with too few open units). */
  readonly relaxed: boolean;
  readonly from: { readonly building: number; readonly unit: number };
  readonly to: { readonly building: number; readonly unit: number };
};

/** How long a walker is walking, in game hours. */
export const walkHours = (w: Walker): number => w.length / (w.speed * HOUR_S);

/** The distance along a walker's path at `hour`, or -1 where they are not walking. */
export function alongAt(w: Walker, hour: number): number {
  const u = wrapHour(hour - w.t0);
  const s = u * HOUR_S * w.speed;
  return s <= w.length ? s : -1;
}

/**
 * How much faster than the walker's speed their ground is covered at `along` metres of the path: 1 for a lane's walker, up to about 2.5 for a pair's second
 * on the outside of a tight bend (the pair stays abreast, so the outer one goes farther in the same time). The clip's rate follows it.
 */
export function pathSpeed(w: Walker, along: number): number {
  const i = Math.min(Math.max(Math.floor(along / PATH_STEP), 0), w.cum.length - 2);
  const j = Math.min(i + 1, w.cum.length - 2);
  const d = (a: number): number => Math.hypot((w.pts[a * 2 + 2] as number) - (w.pts[a * 2] as number), (w.pts[a * 2 + 3] as number) - (w.pts[a * 2 + 1] as number));
  return Math.max(0.3, (d(i) + d(j)) / (2 * PATH_STEP));
}

/** The place of a walker at `along` metres of their path: x, z (the plan's frame) and the way they face (a yaw, 0 toward +z, growing toward +x). */
export function pathPoint(w: Walker, along: number): { x: number; z: number; yaw: number } {
  const n = w.cum.length;
  const at = (s: number): { x: number; z: number } => {
    const f = Math.min(Math.max(s, 0), w.length) / PATH_STEP;
    const i = Math.min(Math.floor(f), n - 2);
    const u = Math.min(f - i, 1);
    const x0 = w.pts[i * 2] as number;
    const z0 = w.pts[i * 2 + 1] as number;
    return { x: x0 + ((w.pts[i * 2 + 2] as number) - x0) * u, z: z0 + ((w.pts[i * 2 + 3] as number) - z0) * u };
  };
  const p = at(along);
  const a = at(along - 0.3);
  const b = at(along + 0.3);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return { x: p.x, z: p.z, yaw: Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz) };
}

/**
 * Where a walker stands in the world at `hour`, or null where they are not walking. Their height is the town ground's, taken as the mean of the
 * ground over 0.4 m of path each way, so that nobody drops 15 cm the moment they step off a curb with no ramp.
 */
export function walkerWorld(g: TownGround, w: Walker, hour: number): PersonWorld | null {
  const s = alongAt(w, hour);
  if (s < 0) return null;
  const p = pathPoint(w, s);
  let y = 0;
  const taps = [-0.4, -0.2, 0, 0.2, 0.4];
  for (const d of taps) {
    const q = pathPoint(w, Math.min(Math.max(s + d, 0), w.length));
    y += g.heightAt(q.x + g.anchor.x, q.z + g.anchor.z);
  }
  return { x: p.x + g.anchor.x, y: y / taps.length, z: p.z + g.anchor.z, yaw: p.yaw };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The trips

const roll = (a: number, b: number, c: number, d: number): number => hashN(a, b, c, d);

/** A bell-shaped draw about 0, with a spread of 1: four rolls summed. */
const bell = (a: number, b: number, c: number): number => (roll(a, b, c, 75) + roll(a, b, c + 1, 75) + roll(a, b, c + 2, 75) + roll(a, b, c + 3, 75) - 2) * Math.sqrt(3);

/** A walker's own speed, metres a second of real time. */
export const speedOf = (key: number, attempt: number): number => Math.min(WALK_SPEED[1], Math.max(WALK_SPEED[0], SPEED_MEAN + SPEED_SD * bell(key, attempt, 2)));

/** What is a walker's own about their way: the line across the walk (metres right of its middle) and how it wanders, how they take a corner, and how far they bow across a roadway. */
type Style = { readonly aim: number; readonly wander: number; readonly lambda: number; readonly phase: number; readonly radius: number; readonly bow: number; readonly shift: number; readonly corner: number };
const styleOf = (key: number, attempt: number): Style => ({
  aim: Math.max(-1.3, Math.min(1.3, LANE + 0.65 * bell(key, attempt, 10))),
  wander: 0.12 + 0.13 * roll(key, attempt, 14, 76),
  lambda: 8 + 12 * roll(key, attempt, 15, 76),
  phase: 2 * Math.PI * roll(key, attempt, 16, 76),
  radius: 0.9 + 1.3 * roll(key, attempt, 17, 76),
  bow: (roll(key, attempt, 18, 76) - 0.5) * 1.2,
  shift: (roll(key, attempt, 19, 76) - 0.5) * 1.8,
  corner: Math.max(-1, Math.min(1, 0.7 * bell(key, attempt, 20))),
});

type Piece = { readonly e: number; readonly from: number; readonly to: number; readonly fixedStart: boolean; readonly fixedEnd: boolean };

/** Round the corners of a polyline over `TURN_RADIUS` each side and resample it at `PATH_STEP`: the points, and the length reached at each. */
function smooth(poly: readonly { x: number; z: number }[], radius = TURN_RADIUS): { pts: Float32Array; cum: Float32Array; length: number } | null {
  // Drop repeated points.
  const p: { x: number; z: number }[] = [];
  for (const q of poly) {
    const last = p[p.length - 1];
    if (last === undefined || Math.hypot(q.x - last.x, q.z - last.z) > 0.02) p.push(q);
  }
  if (p.length < 2) return null;
  // A corner's two sides may meet in a spur or a loop (a walker's line comes to the curb at one spot and the next sidewalk begins at another): a point that
  // turns the way back on itself within a couple of metres of its neighbours is taken out, apart from the door's own first and last.
  for (let again = true; again && p.length > 6; ) {
    again = false;
    for (let i = 3; i < p.length - 3; i++) {
      const a = p[i - 1] as { x: number; z: number };
      const v = p[i] as { x: number; z: number };
      const b = p[i + 1] as { x: number; z: number };
      const l1 = Math.hypot(v.x - a.x, v.z - a.z);
      const l2 = Math.hypot(b.x - v.x, b.z - v.z);
      if (l1 > 2.5 && l2 > 2.5) continue;
      if ((v.x - a.x) * (b.x - v.x) + (v.z - a.z) * (b.z - v.z) < -0.2 * l1 * l2) {
        p.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  // The lane's stations are a quarter metre apart: take out those a hand's breadth off the line between their neighbours, so a corner's two sides are long
  // straight runs and its arc has room.
  const keep = new Uint8Array(p.length);
  keep[0] = 1;
  keep[p.length - 1] = 1;
  const thin = (lo: number, hi: number): void => {
    const a = p[lo] as { x: number; z: number };
    const b = p[hi] as { x: number; z: number };
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let far = -1;
    let at = 0;
    for (let i = lo + 1; i < hi; i++) {
      const q = p[i] as { x: number; z: number };
      const d = Math.abs((q.x - a.x) * (b.z - a.z) - (q.z - a.z) * (b.x - a.x)) / l;
      if (d > at) {
        at = d;
        far = i;
      }
    }
    if (far >= 0 && at > 0.07) {
      keep[far] = 1;
      thin(lo, far);
      thin(far, hi);
    }
  };
  thin(0, p.length - 1);
  const q: { x: number; z: number }[] = [];
  for (const [i, v] of p.entries()) if (keep[i] === 1) q.push(v);
  p.length = 0;
  p.push(...q);
  const dense: { x: number; z: number }[] = [p[0] as { x: number; z: number }];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1] as { x: number; z: number };
    const v = p[i] as { x: number; z: number };
    const b = p[i + 1] as { x: number; z: number };
    const l1 = Math.hypot(v.x - a.x, v.z - a.z);
    const l2 = Math.hypot(b.x - v.x, b.z - v.z);
    const d1x = (v.x - a.x) / l1;
    const d1z = (v.z - a.z) / l1;
    const d2x = (b.x - v.x) / l2;
    const d2z = (b.z - v.z) / l2;
    const turn = Math.abs(Math.atan2(d1x * d2z - d1z * d2x, d1x * d2x + d1z * d2z));
    if (turn < 0.1) {
      dense.push(v);
      continue;
    }
    // A bend: the quadratic curve from `r` before the corner to `r` after it, with the corner for its control.
    // The first and last bends are the door's own (the way out and in is the one the door was made for); the rest are the walker's.
    const r = Math.min(i <= 2 || i >= p.length - 3 ? TURN_RADIUS : radius, 0.45 * l1, 0.45 * l2);
    const sx = v.x - d1x * r;
    const sz = v.z - d1z * r;
    const ex = v.x + d2x * r;
    const ez = v.z + d2z * r;
    const n = Math.max(4, Math.ceil(turn * 5));
    for (let q = 0; q <= n; q++) {
      const u = q / n;
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * u * (1 - u);
      const w2 = u * u;
      dense.push({ x: w0 * sx + w1 * v.x + w2 * ex, z: w0 * sz + w1 * v.z + w2 * ez });
    }
  }
  dense.push(p[p.length - 1] as { x: number; z: number });
  // Arc length, then resample evenly.
  const acc: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1] as { x: number; z: number };
    const b = dense[i] as { x: number; z: number };
    acc.push((acc[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = acc[acc.length - 1] as number;
  if (total < PATH_STEP * 2) return null;
  const count = Math.ceil(total / PATH_STEP) + 1;
  const length = (count - 1) * PATH_STEP;
  const pts = new Float32Array(count * 2);
  const cum = new Float32Array(count);
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const s = Math.min(i * PATH_STEP * (total / length), total);
    while (seg < acc.length - 1 && (acc[seg] as number) < s) seg++;
    const a = dense[seg - 1] as { x: number; z: number };
    const b = dense[seg] as { x: number; z: number };
    const l = (acc[seg] as number) - (acc[seg - 1] as number) || 1;
    const u = Math.min(Math.max((s - (acc[seg - 1] as number)) / l, 0), 1);
    pts[i * 2] = a.x + (b.x - a.x) * u;
    pts[i * 2 + 1] = a.z + (b.z - a.z) * u;
    cum[i] = i * PATH_STEP;
  }
  return { pts, cum, length };
}

/**
 * A pair's second walker's path, beside the leader's: to the left by `side` metres (negative for the right), the gap breathing about `side` by up to
 * `breathe` over a wavelength of its own, and the partner drifting up to `drift` metres ahead or behind the leader over a longer one. Index for index with
 * the leader's (they stay abreast in time), so its ground speed differs where it goes round a bend or drifts, and its clip rate follows (`pathSpeed`).
 */
function beside(
  w: { pts: Float32Array; cum: Float32Array; length: number }, side: number, breathe: number, lambdaGap: number, phaseGap: number, drift: number, lambdaDrift: number, phaseDrift: number,
): { pts: Float32Array; cum: Float32Array; length: number } {
  const n = w.cum.length;
  const pts = new Float32Array(n * 2);
  const at = (f: number): { x: number; z: number } => {
    const c = Math.min(Math.max(f, 0), n - 1);
    const i = Math.min(Math.floor(c), n - 2);
    const u = c - i;
    return { x: (w.pts[i * 2] as number) + ((w.pts[i * 2 + 2] as number) - (w.pts[i * 2] as number)) * u, z: (w.pts[i * 2 + 1] as number) + ((w.pts[i * 2 + 3] as number) - (w.pts[i * 2 + 1] as number)) * u };
  };
  for (let i = 0; i < n; i++) {
    const along = i * PATH_STEP;
    // The drift and the breathing both die away at a door, so that the two come out of one and go in at one as they did.
    const edge = Math.min(1, Math.min(along, w.length - along) / 6);
    const f = i + (edge * drift * Math.sin((2 * Math.PI * along) / lambdaDrift + phaseDrift)) / PATH_STEP;
    const gap = side + Math.sign(side) * edge * breathe * Math.sin((2 * Math.PI * along) / lambdaGap + phaseGap);
    const a = at(f - 2);
    const b = at(f + 2);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const p = at(f);
    pts[i * 2] = p.x + (-dz / l) * gap;
    pts[i * 2 + 1] = p.z + (dx / l) * gap;
  }
  return { pts, cum: w.cum, length: w.length };
}

type Located = { x: number; z: number };

/** The shortest ways through the net from a place's foot to every node: distances and the edge each node was reached by. */
type Reach = { readonly dist: Float64Array; readonly via: Int32Array };

function reachFrom(net: Net, p: Place): Reach {
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const e0 = net.edges[p.edge] as Edge;
  dist[e0.a] = p.s;
  via[e0.a] = -2 - p.edge;
  dist[e0.b] = e0.len - p.s;
  via[e0.b] = -2 - p.edge;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (done[i] === 0 && (dist[i] as number) < best) {
      best = dist[i] as number;
      u = i;
    }
    if (u < 0) break;
    done[u] = 1;
    for (const ei of net.at[u] as readonly number[]) {
      const e = net.edges[ei] as Edge;
      if (!usableEdge(net, e)) continue;
      const v = e.a === u ? e.b : e.a;
      const c = best + e.len + (e.kind === "cross" ? 6 : 0);
      if (c < (dist[v] as number)) {
        dist[v] = c;
        via[v] = ei;
      }
    }
  }
  return { dist, via };
}

/** The length of the way from a place to another, through the net: also the ends it leaves and enters by. Infinity where there is none. */
function wayTo(net: Net, from: Place, reach: Reach, to: Place): { length: number; exit: number } {
  const ef = net.edges[from.edge] as Edge;
  const et = net.edges[to.edge] as Edge;
  if (from.edge === to.edge) return { length: Math.abs(from.s - to.s), exit: -1 };
  const viaA = (reach.dist[et.a] as number) + to.s;
  const viaB = (reach.dist[et.b] as number) + (et.len - to.s);
  void ef;
  return viaA <= viaB ? { length: viaA, exit: et.a } : { length: viaB, exit: et.b };
}

/** The pieces of the way, in order, from `reach`: ends the first piece at the first node and so on to the node `exit`. */
function piecesOf(net: Net, from: Place, reach: Reach, to: Place, exit: number): { pieces: Piece[]; crossings: number } | null {
  const ef = net.edges[from.edge] as Edge;
  const et = net.edges[to.edge] as Edge;
  const kf = Math.min(Math.round(from.s / STATION), stationsOf(ef) - 1);
  const kt = Math.min(Math.round(to.s / STATION), stationsOf(et) - 1);
  if (from.edge === to.edge) return { pieces: [{ e: from.edge, from: kf, to: kt, fixedStart: false, fixedEnd: false }], crossings: 0 };
  // Walk back from the exit node to the start edge, then turn the list round.
  const chain: { e: number; node: number }[] = [];
  let node = exit;
  for (let guard = 0; guard < 400; guard++) {
    const via = reach.via[node] as number;
    if (via <= -2) break;
    if (via < 0) return null;
    const e = net.edges[via] as Edge;
    chain.push({ e: via, node });
    node = e.a === node ? e.b : e.a;
  }
  const first = node;
  chain.reverse();
  const pieces: Piece[] = [];
  // From the door's foot to the first node along its own edge.
  const lastStation = (e: Edge): number => stationsOf(e) - 1;
  pieces.push({ e: from.edge, from: kf, to: first === ef.a ? 0 : lastStation(ef), fixedStart: false, fixedEnd: true });
  let at = first;
  let crossings = 0;
  for (const { e: ei, node: arrive } of chain) {
    const e = net.edges[ei] as Edge;
    if (e.kind === "cross") crossings++;
    pieces.push({ e: ei, from: at === e.a ? 0 : lastStation(e), to: at === e.a ? lastStation(e) : 0, fixedStart: true, fixedEnd: true });
    at = arrive;
  }
  pieces.push({ e: to.edge, from: at === et.a ? 0 : lastStation(et), to: kt, fixedStart: true, fixedEnd: false });
  return { pieces, crossings };
}

type Standers = { readonly hit: (x: number, z: number, t: number) => boolean; readonly any: (x: number, z: number, r: number) => boolean };

function standersOf(people: readonly OutdoorPerson[]): Standers {
  const cells = new Map<number, OutdoorPerson[]>();
  for (const p of people) {
    const key = cellOf(p.px, p.pz);
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [p]);
    else list.push(p);
  }
  // Whether a stander within `STANDER_CLEAR` of the point is there at hour `t`: the cell of the point and its neighbours are looked at.
  return {
    // Whether anyone stands (at any hour) within `r` of the point: a station with no one near it has no one to keep from.
    any(x, z, r) {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = cells.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
        if (list === undefined) continue;
        for (const p of list) if (Math.abs(p.px - x) < r && Math.abs(p.pz - z) < r) return true;
      }
      return false;
    },
    hit(x, z, t) {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = cells.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
        if (list === undefined) continue;
        for (const p of list) if (Math.abs(p.px - x) < STANDER_CLEAR && Math.abs(p.pz - z) < STANDER_CLEAR && Math.hypot(p.px - x, p.pz - z) < STANDER_CLEAR && stayHolds(p, t)) return true;
      }
      return false;
    },
  };
}

const cache = new WeakMap<TownPlan, readonly Walker[]>();

/** The walkers of a plan (in the plan's own frame): the same plan gives the same walkers. */
export function walkersFor(plan: TownPlan, anchor: { readonly x: number; readonly z: number }): readonly Walker[] {
  const known = cache.get(plan);
  if (known !== undefined) return known;
  const job = walkerJob(plan, anchor);
  for (;;) {
    const step = job.next();
    if (step.done === true) {
      cache.set(plan, step.value);
      return step.value;
    }
  }
}

/** The most walkers there can be at once in a town of `units` open downtown units: the ceiling's peak, which a model's batch is made big enough for. */
export const walkCapacity = (units: number): number => Math.max(1, walkCeilingAt(12, units));

/**
 * The walkers of a plan, made as a job that yields between trips: a renderer that does not want the half second or so the whole takes on one frame runs it
 * a few milliseconds at a time (`walkersFor` runs it to the end). The same plan gives the same walkers either way.
 */
export function* walkerJob(plan: TownPlan, anchor: { readonly x: number; readonly z: number }): Generator<void, readonly Walker[]> {
  WALK_WORK.builds = 0;
  WALK_WORK.lines = 0;
  WALK_WORK.points = 0;
  WALK_WORK.steps = 0;
  const net = walkNet(plan);
  yield;
  // Each edge's walkability is made once, wanted by every trip: made here an edge at a time.
  for (const e of net.edges) {
    usableEdge(net, e);
    yield;
  }
  const standers = standersOf(outdoorPeopleFor(plan, anchor));
  yield;
  const units = openDowntownUnits(plan);
  const out: Walker[] = [];
  if (units === 0 || net.edges.length === 0) return out;
  const places = placesOf(net);
  yield;
  const reaches = new Map<number, Reach>();
  const reachOf = (p: Place): Reach => {
    let r = reaches.get(p.id);
    if (r === undefined) {
      r = reachFrom(net, p);
      reaches.set(p.id, r);
    }
    return r;
  };
  // How many are walking at each twentieth of an hour (a pair counts two), when each door last had someone leave it, and where the trips have been: by origin
  // and by destination, how many and when (so that no two trips out together share an end, and no end has more than its share).
  const load = new Int16Array(24 * 20);
  const leaves = new Map<number, number[]>();
  const hasDests = new Map<number, boolean>();
  // What stands at a point, made once for the point (`staticsAt`).
  const statics = new Map<number, number>();
  const origUse = new Map<number, number>();
  const destUse = new Map<number, number>();
  const origOut = new Map<number, (readonly [number, number])[]>();
  const destOut = new Map<number, (readonly [number, number])[]>();
  const k = units / REFERENCE_UNITS;
  const slot = (t: number): number => Math.floor(wrapHour(t) * 20) % (24 * 20);
  let tripNo = 0;
  // How many trips the day is likely to have, which the share of any one end and the share of the pairs are held to.
  let expected = 0;
  for (const [ri, reason] of WALK_REASONS.entries()) for (const [bi, band] of reason.bands.entries()) expected += Math.floor(band.rate * (band.to - band.from) * k + roll(ri, bi, 1, 70));
  const endCap = Math.max(3, Math.ceil(END_SHARE * 0.9 * expected));
  let pairWalkers = 0;
  for (const [ri, reason] of WALK_REASONS.entries()) {
    for (const [bi, band] of reason.bands.entries()) {
      const want = band.rate * (band.to - band.from) * k;
      const n = Math.floor(want + roll(ri, bi, 1, 70));
      for (let i = 0; i < n; i++) {
        const key = ri * 100000 + bi * 1000 + i;
        const w = yield* tripFor(reason, band, key, tripNo);
        tripNo++;
        if (w === null) {
          yield;
          continue;
        }
        // A pair is the leader and the one after; each is numbered as it is kept.
        const first = out.length;
        for (const [q, x] of w.entries()) out.push({ ...x, id: first + q, partner: w.length > 1 ? first + (1 - q) : -1 });
        if (w.length > 1) pairWalkers += 2;
        yield;
      }
    }
  }
  return out;

  /** Whether `n` more walkers fit under the town's count, in twentieths of an hour from `t0` to `t1`. */
  function loadFits(t0: number, t1: number, n: number): boolean {
    const a = slot(t0);
    const b = slot(t1);
    for (let s = a; ; s = (s + 1) % load.length) {
      if ((load[s] as number) + n > walkCeilingAt(s / 20, units)) return false;
      if (s === b) break;
    }
    return true;
  }

  /** A choice from a list by weights and a roll. */
  function weighted<T>(list: readonly T[], weight: (t: T) => number, at: number): T {
    let sum = 0;
    for (const t of list) sum += weight(t);
    let pickAt = at * sum;
    for (const t of list) {
      pickAt -= weight(t);
      if (pickAt < 0) return t;
    }
    return list[list.length - 1] as T;
  }

  /** Whether the hours [a0, a1] (on a clock that comes round) come within `pad` of [b0, b1]. */
  function near(a0: number, a1: number, b0: number, b1: number, pad: number): boolean {
    for (const sh of [-24, 0, 24]) if (a0 - pad < b1 + sh && b0 + sh < a1 + pad) return true;
    return false;
  }

  /** Whether an end (a door) is free for a trip out from t0 to t1: no trip is out from or to it then, 30 real seconds either side; or, relaxed, none within a quarter hour. */
  function endFree(list: readonly (readonly [number, number])[] | undefined, t0: number, t1: number, relaxed: boolean, end: "from" | "to"): boolean {
    if (list === undefined) return true;
    for (const [a, b] of list) {
      if (relaxed ? (end === "from" ? near(t0, t0, a, a, END_APART_SMALL) : near(t1, t1, b, b, END_APART_SMALL)) : near(t0, t1, a, b, END_APART)) return false;
    }
    return true;
  }

  /** One trip of a reason in a band: its walkers (the pair's two, or one), or null where it could not be made. */
  function* tripFor(reason: WalkReason, band: WalkReason["bands"][number], key: number, no: number): Generator<void, Walker[] | null> {
    for (let attempt = 0; attempt < 64; attempt++) {
      // (Each attempt may be a few milliseconds: the job gives the frame back between them.)
      yield;
      // The first attempts keep the ends apart as the rule says; later ones, where the town has too few open units for it, only a quarter hour apart.
      const relaxed = attempt >= 40;
      const r = (salt: number): number => roll(key, attempt, salt, 71);
      const t0 = band.from + r(1) * (band.to - band.from);
      const speed0 = speedOf(key, attempt);
      const origins = places.filter((p) => reason.from.includes(p.trade) && isOpen(p.hours, t0) && isOpen(p.hours, t0 + 0.05) && usable(p) && hasDest(p, reason) && (origUse.get(p.id) ?? 0) < (relaxed ? endCap * 1.15 : endCap));
      if (origins.length === 0) {
        if (attempt < 48) continue;
        return null;
      }
      const from = weighted(origins, (p) => 1 / (1 + (origUse.get(p.id) ?? 0)) ** 2, r(3));
      const speedTop = from.cap;
      const gaps = leaves.get(from.id) ?? [];
      if (gaps.some((g) => Math.abs(g - t0) < DOOR_GAP || Math.abs(Math.abs(g - t0) - 24) < DOOR_GAP)) continue;
      const reach = reachOf(from);
      // The ends it may go to: open on arrival, 30 to 220 m of walking, the nearer the likelier, those with fewer trips likelier still; none that is out
      // with another trip then (see `endFree`), or has had its share.
      const cands: { p: Place; way: ReturnType<typeof wayTo>; w: number; len: number }[] = [];
      for (const q of places) {
        if (q.id === from.id || !reason.to.includes(q.trade) || !usable(q)) continue;
        if ((destUse.get(q.id) ?? 0) >= (relaxed ? endCap * 1.15 : endCap)) continue;
        const way = wayTo(net, from, reach, q);
        const length = way.length + from.perp + q.perp + from.depth + q.depth;
        if (!Number.isFinite(way.length)) continue;
        if (length < TRIP_LENGTH[0] || length > TRIP_LENGTH[1]) continue;
        const t1 = t0 + length / (speed0 * HOUR_S);
        if (!isOpen(q.hours, t1)) continue;
        if (!endFree(destOut.get(q.id), t0, t1, relaxed, "to")) continue;
        cands.push({ p: q, way, w: 1 / (1 + (length / 70) ** 2) / (1 + (destUse.get(q.id) ?? 0)) ** 2, len: length });
      }
      if (cands.length === 0) continue;
      const chosen = weighted(cands, (c) => c.w, r(4));
      // The cheap gates before the path is made: the origin free then, and room in the town's count, at the speed it will most likely have.
      const t1e = t0 + chosen.len / (Math.min(speed0, speedTop) * HOUR_S);
      if (!endFree(origOut.get(from.id), t0, t1e, relaxed, "from") || !loadFits(t0, t1e, 1)) continue;
      // The trip, at its walker's speed; where that is within `SPEED_GAP` of another walker's who is near them at the same time, at a speed that is not.
      let speed = Math.min(speed0, speedTop);
      for (let tries = 0; tries < 4; tries++) {
        const made = fit(reason, from, chosen.p, chosen.way.exit, reach, t0, speed, key, attempt, no);
        if (made === null) break;
        const length = (made[0] as Walker).length;
        const t1 = t0 + length / (speed * HOUR_S);
        const clash = out.filter((o) => made.every((m) => o.partner !== m.id) && nearInTime(o, made[0] as Walker) && Math.abs(o.speed - speed) < SPEED_GAP);
        if (clash.length > 0) {
          const alt = [0.14, -0.14, 0.28, -0.28, 0.42, -0.42].map((d) => speed + d).find((v) => v >= WALK_SPEED[0] && v <= speedTop && clash.every((o) => Math.abs(o.speed - v) >= SPEED_GAP));
          if (alt === undefined) break;
          speed = alt;
          continue;
        }
        if (!isOpen(chosen.p.hours, t1)) break;
        if (!endFree(destOut.get(chosen.p.id), t0, t1, relaxed, "to") || !endFree(origOut.get(from.id), t0, t1, relaxed, "from")) break;
        if (!loadFits(t0, t1, made.length)) break;
        const a = slot(t0);
        const b = slot(t1);
        for (let s = a; ; s = (s + 1) % load.length) {
          load[s] = (load[s] as number) + made.length;
          if (s === b) break;
        }
        leaves.set(from.id, [...gaps, wrapHour(t0)]);
        origUse.set(from.id, (origUse.get(from.id) ?? 0) + 1);
        destUse.set(chosen.p.id, (destUse.get(chosen.p.id) ?? 0) + 1);
        origOut.set(from.id, [...(origOut.get(from.id) ?? []), [t0, t1]]);
        destOut.set(chosen.p.id, [...(destOut.get(chosen.p.id) ?? []), [t0, t1]]);
        return made.map((m) => ({ ...m, relaxed }));
      }
    }
    return null;
  }

  /** Whether a trip of a reason from a place has anywhere to go, whatever the hour: a place of the kind it goes to within its lengths (made once). */
  function hasDest(p: Place, reason: WalkReason): boolean {
    const key = p.id * 16 + WALK_REASONS.indexOf(reason);
    const known = hasDests.get(key);
    if (known !== undefined) return known;
    const reach = reachOf(p);
    let any = false;
    for (const q of places) {
      if (q.id === p.id || !reason.to.includes(q.trade) || !usable(q)) continue;
      const way = wayTo(net, p, reach, q);
      const length = way.length + p.perp + q.perp + p.depth + q.depth;
      if (Number.isFinite(way.length) && length >= TRIP_LENGTH[0] && length <= TRIP_LENGTH[1]) {
        any = true;
        break;
      }
    }
    hasDests.set(key, any);
    return any;
  }

  /** Whether a place can be walked from at all (its door's edge is usable). */
  function usable(p: Place): boolean {
    return usableEdge(net, net.edges[p.edge] as Edge);
  }

  /** Whether two walkers come within `SPEED_NEAR` of each other at some moment when both are out. */
  function nearInTime(a: Walker, b: Walker): boolean {
    const ha = walkHours(a);
    const hb = walkHours(b);
    const gap = wrapHour(b.t0 - a.t0);
    for (const shift of [gap, gap - 24]) {
      const lo = Math.max(0, shift);
      const hi = Math.min(ha, shift + hb);
      for (let u = lo; u <= hi; u += 2 / HOUR_S) {
        WALK_WORK.steps++;
        const pa = pathPoint(a, u * HOUR_S * a.speed);
        const pb = pathPoint(b, (u - shift) * HOUR_S * b.speed);
        if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < SPEED_NEAR) return true;
      }
    }
    return false;
  }

  /**
   * Whether two walkers going one way near each other (within 8 m, their ways within 18 degrees) are on one line: the mean of their sideways distance over the
   * moments they share, taken every second, is under 0.2 m. Too short a time together (under two moments) is not one line.
   */
  function sameLine(a: Walker, b: Walker): boolean {
    const ha = walkHours(a);
    const hb = walkHours(b);
    const gap = wrapHour(b.t0 - a.t0);
    let sum = 0;
    let n = 0;
    for (const shift of [gap, gap - 24]) {
      const lo = Math.max(0, shift);
      const hi = Math.min(ha, shift + hb);
      for (let u = lo; u <= hi; u += 1 / HOUR_S) {
        WALK_WORK.steps++;
        const p = pathPoint(a, u * HOUR_S * a.speed);
        const q = pathPoint(b, (u - shift) * HOUR_S * b.speed);
        if (Math.hypot(p.x - q.x, p.z - q.z) > 8 || Math.cos(p.yaw - q.yaw) < 0.95) continue;
        sum += Math.abs((q.x - p.x) * Math.cos(p.yaw) - (q.z - p.z) * Math.sin(p.yaw));
        n++;
      }
    }
    return n >= 2 && sum / n < 0.2;
  }

  /** The trip with a line of its own, and kept clear of the walkers already made: a faster one that catches a slower takes a line round it, or the trip is given up. */
  function fit(reason: WalkReason, from: Place, to: Place, exit: number, reach: Reach, t0: number, speed: number, key: number, attempt: number, no: number): Walker[] | null {
    const style = styleOf(key, attempt);
    // What the line-finding made for this trip: the variants differ only in what is not about the line along a sidewalk.
    const memo = new Map<string, Int16Array | null>();
    // (Three ways that fail to make a path at all are enough: what stood in the way stands in the way of the rest.)
    let none = 0;
    for (const [move, bow, shift] of [[0, style.bow, style.shift], [0, style.bow, style.shift / 2], [0, 0, 0], [0.9, 0, 0], [-0.9, 0, 0], [1.5, 0, 0], [-1.5, 0, 0]] as const) {
      if (none >= 3) break;
      const made = build(reason, from, to, exit, reach, t0, speed, key, attempt, no, { ...style, bow, shift, aim: Math.max(-1.3, Math.min(1.3, style.aim + move)) }, memo);
      if (made === null) {
        none++;
        continue;
      }
      if (out.some((o) => made.some((m) => collide(o, m)) || made.some((m) => sameLine(o, m)))) continue;
      return made;
    }
    return null;
  }

  /** Makes the trip's path and checks it; its walkers, or null. */
  function build(reason: WalkReason, from: Place, to: Place, exit: number, reach: Reach, t0: number, speed: number, key: number, attempt: number, no: number, style: Style, memo: Map<string, Int16Array | null>): Walker[] | null {
    WALK_WORK.builds++;
    const route = piecesOf(net, from, reach, to, exit);
    if (route === null) return null;
    const pair = roll(key, attempt, 5, 72) < 1 / PAIR_ONE_IN && pairWalkers + 2 <= PAIR_SHARE * expected * 0.7;
    const tryPath = (aimM: number, wide = false): { pts: Float32Array; cum: Float32Array; length: number } | null => {
      const poly: Located[] = [{ x: from.x - from.nx * from.depth, z: from.z - from.nz * from.depth }, { x: from.x, z: from.z }];
      let s = from.perp;
      for (const piece of route.pieces) {
        const e = net.edges[piece.e] as Edge;
        if (e.kind !== "walk") {
          const na = piece.from === 0 ? e.a : e.b;
          const nb = piece.from === 0 ? e.b : e.a;
          const A = net.nodes[na] as Node;
          const B = net.nodes[nb] as Node;
          // Its own line across: parallel to the crossing, shifted along the curb by their own spot within its width (`shift`), and bowed a little in the way across
          // the roadway. A link round a corner is the plain way.
          const sx = e.kind === "cross" ? -e.tz * style.shift : 0;
          const sz = e.kind === "cross" ? e.tx * style.shift : 0;
          if (e.kind === "cross" && Math.abs(style.bow) > 0.05) poly.push({ x: A.x + sx, z: A.z + sz }, { x: (A.x + B.x) / 2 + sx - e.tz * style.bow, z: (A.z + B.z) / 2 + sz + e.tx * style.bow }, { x: B.x + sx, z: B.z + sz });
          else if (e.kind === "cross") poly.push({ x: A.x + sx, z: A.z + sz }, { x: B.x + sx, z: B.z + sz });
          // (A link round a corner has no point of its own: the walker goes from where they leave one sidewalk to where they join the next.)
          s += e.len;
          continue;
        }
        const extra = (x: number, z: number, along: number): boolean => standerIn(x, z, t0 + along / (speed * HOUR_S));
        const base = s;
        const s0 = stationAt(e, piece.from);
        // Their line: the aim across the walk, and a slow wander about it, from their own place along the way.
        const last = piece.fixedEnd ? Number.POSITIVE_INFINITY : 0;
        // Near a door the line is the usual one, so the way out and in is clear of what stands by it; the line of their own comes in over six metres.
        const rampAt = (kk: number): number => Math.min(1, Math.max(0, (base + Math.abs(stationAt(e, kk) - s0) - 2) / 6), last === 0 ? Math.max(0, Math.abs(stationAt(e, piece.to) - stationAt(e, kk)) - 2) / 6 : last);
        // Coming to a corner (a node, not a door) they reach it at a spot of their own: their line is moved over the last four metres, up to a metre either way.
        const nodeAt = (kk: number): number => {
          const toEnd = piece.fixedEnd ? Math.abs(stationAt(e, piece.to) - stationAt(e, kk)) : Number.POSITIVE_INFINITY;
          const fromStart = piece.fixedStart ? Math.abs(stationAt(e, kk) - s0) : Number.POSITIVE_INFINITY;
          return Math.max(0, 1 - Math.min(toEnd, fromStart) / 4);
        };
        const aimAt = (kk: number): number => (LANE + (aimM - LANE) * rampAt(kk) + style.corner * nodeAt(kk)) / OFF_STEP + JC;
        // Neither end is held to the node's own point: a walker keeps their own offset through a corner, and comes to the curb at a spot of their own.
        const memoKey = `${piece.e}:${piece.from}:${piece.to}:${aimM.toFixed(3)}:${s.toFixed(2)}`;
        let offs = memo.get(memoKey);
        if (offs === undefined) {
          offs = lateral(net, e, piece.from, piece.to, aimAt, false, false, extra, s, (x, z) => standers.any(x, z, 2.7));
          memo.set(memoKey, offs);
        }
        if (offs === null) return null;
        const dir = piece.to >= piece.from ? 1 : -1;
        const feas = feasOf(net, e);
        const m = offs.length;
        for (let i = 0; i < m; i++) {
          const kk = piece.from + dir * i;
          // The cells' offsets are a step apart: the line is eased between them (the mean over a metre and a half), where that is still clear.
          let jt = offs[i] as number;
          if (i >= 4 && i < m - 4) {
            let sum = 0;
            let count = 0;
            for (let q = Math.max(0, i - 6); q <= Math.min(m - 1, i + 6); q++) {
              sum += offs[q] as number;
              count++;
            }
            const eased = sum / count;
            const lo = Math.floor(eased);
            const hi = Math.ceil(eased);
            const jl = dir < 0 ? 2 * JC - lo : lo;
            const jh = dir < 0 ? 2 * JC - hi : hi;
            if (feas[kk * NJ + jl] === 1 && feas[kk * NJ + jh] === 1) jt = eased;
          }
          // The slow wander of their own about it, where the way is clear to either side of it; a smaller one where it is not; none where it is not.
          const wob = (rampAt(kk) * style.wander * Math.sin((2 * Math.PI * (base + Math.abs(stationAt(e, kk) - s0))) / style.lambda + style.phase)) / OFF_STEP;
          for (const part of [1, 0.5]) {
            const jw = jt + part * wob;
            const jlo = dir < 0 ? 2 * JC - Math.floor(jw) : Math.floor(jw);
            const jhi = dir < 0 ? 2 * JC - Math.ceil(jw) : Math.ceil(jw);
            if (jlo >= 0 && jlo < NJ && jhi >= 0 && jhi < NJ && feas[kk * NJ + jlo] === 1 && feas[kk * NJ + jhi] === 1) {
              jt = jw;
              break;
            }
          }
          const jab = dir < 0 ? 2 * JC - jt : jt;
          const p = pointOn(e, stationAt(e, kk), (jab - JC) * OFF_STEP);
          poly.push({ x: p.x, z: p.z });
        }
        s += Math.abs(stationAt(e, piece.to) - stationAt(e, piece.from));
      }
      poly.push({ x: to.x, z: to.z }, { x: to.x - to.nx * to.depth, z: to.z - to.nz * to.depth });
      // Their own way round a corner; a tighter one than the way allows is given a wider.
      for (const radius of wide ? [2.2] : [style.radius, 1.4, 2.2]) {
        const sm = smooth(poly, radius);
        if (sm === null || sm.length < TRIP_LENGTH[0] * 0.8 || sm.length > TRIP_LENGTH[1] * 1.25) return null;
        if (turnsOk(sm)) return sm;
      }
      return null;
    };
    const model = (salt: number): PersonModel => PERSON_MODELS[Math.floor(roll(key, attempt, salt, 73) * PERSON_MODELS.length)] as PersonModel;
    const mk = (path: { pts: Float32Array; cum: Float32Array; length: number }, salt: number, partner: number): Walker => ({
      id: 0, reason: reason.id, model: model(salt), scale: 0.95 + roll(key, attempt, salt + 1, 73) * 0.09, offset: roll(key, attempt, salt + 2, 73) * 60, speed,
      t0: wrapHour(t0), length: path.length, pts: path.pts, cum: path.cum, partner, relaxed: false,
      from: { building: from.building.id, unit: from.unit.id }, to: { building: to.building.id, unit: to.unit.id },
    });
    void no;
    if (pair) {
      // Two people, not a mirrored unit: the gap between them breathes between 0.6 and 0.9 m and the second drifts a little ahead and behind. The leader is to the
      // right of the middle and the other to its left, or the other way about where the first does not fit.
      const q = (salt: number): number => roll(key, attempt, salt, 74);
      for (const sideOf of [1, -1]) {
        // A pair takes its corners wide, so that the one on the inside has room.
        const mate = tryPath(0.38 * sideOf, true);
        if (mate === null) continue;
        const twin = beside(mate, 0.75 * sideOf, 0.15, 6 + q(1) * 8, q(2) * 6.28, 0.25, 26 + q(3) * 26, q(4) * 6.28);
        if (stepsOk(twin) && pathValid(mate, t0, speed) && pathValid(twin, t0, speed)) return [mk(mate, 10, 1), mk(twin, 20, 0)];
      }
    }
    const lead = tryPath(style.aim);
    if (lead === null) return null;
    if (!pathValid(lead, t0, speed)) return null;
    return [mk(lead, 10, -1)];
  }

  /** Whether a stander is at the point when the walker is there. */
  function standerIn(x: number, z: number, t: number): boolean {
    return standers.hit(x, z, t);
  }

  /**
   * What stands at a point, as bits, made once for the point (the plan's, to a hundredth of a metre): bit 0 inside a building or a prop's clear, bit 1 the same with
   * a wall's clear besides, bit 2 not walkable, bit 3 in a roadway, bit 4 near a wall. A path is checked at hundreds of points, and most of them are points
   * the paths before it were at.
   */
  function staticsAt(x: number, z: number): number {
    const key = (Math.round(x * 50) + 100000) * 200003 + (Math.round(z * 50) + 100000);
    const known = statics.get(key);
    if (known !== undefined) return known;
    let bits = 0;
    if (net.obst.blocked(x, z, 0, WALK_PROP)) bits |= 1;
    if (net.obst.blocked(x, z, WALK_WALL, WALK_PROP)) bits |= 2;
    if (!walkable(net, x, z)) bits |= 4;
    if (inRoadway(net.plan, x, z, 0)) bits |= 8;
    if (net.obst.wallNear(x, z, WALK_WALL)) bits |= 16;
    statics.set(key, bits);
    return bits;
  }

  /** Whether the path stays out of everything it must at every point: its first and last metres are the door's, the rest is walkable, clear and apart from standers. */
  function pathValid(path: { pts: Float32Array; cum: Float32Array; length: number }, t0: number, speed: number): boolean {
    const n = path.cum.length;
    WALK_WORK.points += n;
    // A door's lead: from inside the building out across its forecourt (and back in): until the walker is on the walk and clear of the wall.
    const onWalk = (i: number): boolean => (staticsAt(path.pts[i * 2] as number, path.pts[i * 2 + 1] as number) & 20) === 0;
    let head = 0;
    while (head < n && !onWalk(head)) head++;
    let tail = n - 1;
    while (tail > 0 && !onWalk(tail)) tail--;
    if (head > 45 || n - 1 - tail > 45 || head >= tail) return false;
    for (let i = 0; i < n; i++) {
      const x = path.pts[i * 2] as number;
      const z = path.pts[i * 2 + 1] as number;
      const inDoor = i < head || i > tail;
      const bits = staticsAt(x, z);
      if ((bits & (inDoor ? 1 : 2)) !== 0) return false;
      // The roadway and the walk are looked at every third point (0.6 m), the people who stand every other (0.4 m): nothing there is smaller.
      if (i % 3 === 0 && (bits & (inDoor ? 8 : 4)) !== 0) return false;
      if (i % 2 === 0 && standerIn(x, z, t0 + (path.cum[i] as number) / (speed * HOUR_S))) return false;
    }
    return true;
  }
}

/** The sharpest a walker turns: over 1.2 m of path, in radians (a hundred degrees a metre). Except in a door's first three metres, where a pair's second turns tighter. */
export const MAX_TURN = (125 * Math.PI) / 180;

/** Whether a path turns more slowly than `MAX_TURN` over every 1.2 m of it. */
function turnsOk(path: { pts: Float32Array; cum: Float32Array }): boolean {
  const n = path.cum.length;
  for (let i = 15; i + 3 < n - 15; i++) {
    const a = Math.atan2((path.pts[i * 2] as number) - (path.pts[(i - 3) * 2] as number), (path.pts[i * 2 + 1] as number) - (path.pts[(i - 3) * 2 + 1] as number));
    const b = Math.atan2((path.pts[(i + 3) * 2] as number) - (path.pts[i * 2] as number), (path.pts[(i + 3) * 2 + 1] as number) - (path.pts[i * 2 + 1] as number));
    let turn = Math.abs(a - b);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn >= MAX_TURN) return false;
  }
  return true;
}

/** Whether a path's points never jump: each step is about `PATH_STEP`, so an offset path of a tight corner is not allowed. */
function stepsOk(path: { pts: Float32Array; cum: Float32Array }): boolean {
  // (A door's first and last three metres are left out: the corner there is tight, and a pair's two come through the same door.)
  for (let i = 15; i < path.cum.length - 15; i++) {
    const d = Math.hypot((path.pts[i * 2] as number) - (path.pts[i * 2 - 2] as number), (path.pts[i * 2 + 1] as number) - (path.pts[i * 2 - 1] as number));
    if (d < PATH_STEP * 0.2 || d > PATH_STEP * 2.6) return false;
  }
  return true;
}

/** Whether two walkers come nearer than `WALKER_CLEAR` at any instant (looked at every tenth of a second). */
export function collide(a: Walker, b: Walker): boolean {
  const ha = walkHours(a);
  const hb = walkHours(b);
  const gap = wrapHour(b.t0 - a.t0);
  // b leaves `gap` hours after a (or a leaves 24 - gap after b): the overlap in a's own time.
  for (const shift of [gap, gap - 24]) {
    const lo = Math.max(0, shift);
    const hi = Math.min(ha, shift + hb);
    if (hi <= lo) continue;
    const step = 0.1 / HOUR_S;
    for (let u = lo; u <= hi; u += step) {
      WALK_WORK.steps++;
      const pa = pathPoint(a, u * HOUR_S * a.speed);
      const pb = pathPoint(b, (u - shift) * HOUR_S * b.speed);
      if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < WALKER_CLEAR) return true;
    }
  }
  return false;
}

/** The crossings of the net, as pairs of points, for the tests and for looking. */
export function crossingsOf(plan: TownPlan): readonly (readonly [number, number, number, number])[] {
  const net = walkNet(plan);
  return net.edges.filter((e) => e.kind === "cross").map((e) => {
    const a = net.nodes[e.a] as Node;
    const b = net.nodes[e.b] as Node;
    return [a.x, a.z, b.x, b.z] as const;
  });
}

/** The nodes of the net (a curb ramp each), for the tests. */
export function rampsOf(plan: TownPlan): readonly { readonly x: number; readonly z: number }[] {
  return walkNet(plan).nodes;
}

function nearSegment(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Whether a walker may be at a point that is not in a door's lead: on a sidewalk (or a corner's pavement), or on a crossing at a corner. */
export function walkable(net: Net, x: number, z: number): boolean {
  const near = net.near(x, z);
  for (const i of near) {
    const e = net.edges[i] as Edge;
    if (e.kind !== "cross") continue;
    if (nearSegment(e.ax, e.az, e.ax + e.tx * e.len, e.az + e.tz * e.len, x, z) <= CROSS_WIDTH) return true;
  }
  if (inRoadway(net.plan, x, z, 0)) return false;
  for (const i of near) {
    const e = net.edges[i] as Edge;
    if (e.kind !== "walk") continue;
    if (nearSegment(e.ax, e.az, e.ax + e.tx * e.len, e.az + e.tz * e.len, x, z) < 3.2 && (onWalkOf(e, x, z) || Math.hypot(x - e.ax, z - e.az) < CORNER_ZONE + 1 || Math.hypot(x - e.ax - e.tx * e.len, z - e.az - e.tz * e.len) < CORNER_ZONE + 1)) return true;
  }
  return false;
}

/**
 * The fastest a walker may leave a door at: the leaf begins to open as they begin to walk and takes its own `openS` to open, so a walker too fast is in the
 * leaf's sweep (and nearer than a body's width of it) before it is open. Found by walking the leaf's opening against walkers of each speed.
 */
function exitCap(building: number, unit: Unit): number {
  const look = doorLook(building, unit.id);
  const leaf = leafOf(unit.door, look);
  const a0 = Math.abs(doorWalkS(unit.door) - (leaf.hingeLow ? leaf.s0 : leaf.s1));
  const b0 = doorDepth(unit) - doorSet(unit);
  for (let v = WALK_SPEED[1]; v > WALK_SPEED[0]; v -= 0.025) {
    let clear = true;
    for (let t = 0; t <= look.openS + 0.1 && clear; t += 1 / 60) {
      const u = Math.min(1, t / look.openS);
      const ang = look.maxAngle * u * u * (3 - 2 * u);
      if (ang < 0.01) continue;
      const lx = Math.cos(ang);
      const ly = Math.sin(ang);
      const b = b0 - v * t;
      const along = Math.min(Math.max(a0 * lx + b * ly, 0), leaf.width);
      if (Math.hypot(a0 - along * lx, b - along * ly) < 0.32) clear = false;
    }
    if (clear) return v;
  }
  return WALK_SPEED[0];
}

/** The door's places of a net: every open downtown unit with a door on a sidewalk edge. */
export function placesOf(net: Net): Place[] {
  const plan = net.plan;
  const out: Place[] = [];
  const byId = new Map<number, Building>();
  for (const b of plan.buildings) byId.set(b.id, b);
  for (const use of plan.uses) {
    const b = byId.get(use.building);
    const fr = use.frame;
    if (b === undefined || fr === null) continue;
    if (!isDowntown(plan.lots[b.lot]?.district)) continue;
    for (const unit of use.units) {
      if (unit.state !== "open" || unit.tenant === null) continue;
      const hours = unitHours(b, unit);
      if (hours === null) continue;
      // The middle of the leaf that opens (a pair of doors opens its right-hand leaf: `openDoors.ts`).
      const ds = doorWalkS(unit.door);
      const x = fr.origin.x + fr.t.x * ds;
      const z = fr.origin.z + fr.t.z * ds;
      // The walk edge nearest in front of the door.
      let best = -1;
      let bestS = 0;
      let bestD = 9;
      for (const [ei, e] of net.edges.entries()) {
        if (e.kind !== "walk") continue;
        const s0 = (x - e.ax) * e.tx + (z - e.az) * e.tz;
        if (s0 < -3 || s0 > e.len + 3) continue;
        const s = Math.min(Math.max(s0, 0.5), e.len - 0.5);
        const fx = e.ax + e.tx * s - x;
        const fz = e.az + e.tz * s - z;
        const d = Math.hypot(fx, fz);
        // In front of the door: the walk is out from it, not behind the wall.
        if (fx * fr.n.x + fz * fr.n.z < -0.6 || d >= bestD) continue;
        best = ei;
        bestS = s;
        bestD = d;
      }
      if (best < 0 || !usableEdge(net, net.edges[best] as Edge)) continue;
      // The door opens into the room, so a room with less clear floor before it than the leaf sweeps has no walkers.
      if (!doorFits(unit)) continue;
      out.push({ id: out.length, building: b, unit, use, trade: unit.tenant.trade, hours, x, z, nx: fr.n.x, nz: fr.n.z, edge: best, s: bestS, perp: bestD, depth: doorDepth(unit), cap: exitCap(b.id, unit) });
    }
  }
  return out;
}

export { REFERENCE_UNITS };
