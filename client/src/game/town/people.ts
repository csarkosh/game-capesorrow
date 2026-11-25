/**
 * Who stands in the open shops, and where: standing people, drawn from the plan's rooms and nothing else. This is the drawing's, not the
 * simulation's: nothing here is in the plan, nothing is kept between frames, and the same plan gives the same people on every machine
 * (each draw is a hash of the building's id, the unit's id and the person's index, never a random function or the clock).
 *
 * WHAT CAUSES A PERSON. A unit is open: then it has people (a unit shut for the day or vacant has none). Most have one member of staff, who
 * stands behind the unit's service point (the first checkout, counter or desk the room has), on the long side of it with the less clear
 * floor to a wall, since the plan puts the counter so that the clerk sees the door; the clerk faces across it into the room. A room with no
 * such furnishing (a laundromat, an empty lobby) has no staff. The room's kind and a hash say how many customers (most rooms none or one),
 * and what the room holds says where each stands: in the queue at the service point, in an aisle facing a run of shelving, at a high
 * table, a window bar, the pool table or the bar, at a row of washers, or, in a dining room, waiting by the door's side wall. There is no
 * sitting clip, so nobody is put on a chair, a stool, a booth or a couch.
 *
 * Every spot is tried against the room's floor: inside it with a margin to each wall, clear of every furnishing's footprint, out of the
 * door's zone and clear of the people already placed; a person with no clear spot among a few tried is not there. What is authored: the
 * distances, the odds, the models' sizes. What the hash draws: who, which model, which way they face (a little off square), how tall, how
 * fast and where in the clip they start, so that no two move in step.
 */
import { hashN } from "./groundNoise.js";
import { buildingLevels } from "./buildingGeometry.js";
import { xd, xp } from "./roomKit.js";
import type { Xf } from "./roomKit.js";
import type { TownGround } from "./townTypes.js";
import type { Building, Furnishing, InteriorType, TownPlan, Unit } from "../../sim/town/types.js";

/** The five models, by credit id (`client/assets/models/people.json`). */
export const PERSON_MODELS = ["person.nathan", "person.eric", "person.sophia", "person.carla", "person.claudia"] as const;
export type PersonModel = (typeof PERSON_MODELS)[number];

/** The length of the one clip every model has, `idle`, seconds. */
export const IDLE_SECONDS = 2.5333;

export type PersonRole = "staff" | "customer";

/** A person's place in their building's own frame (`s` along the front, `d` into the room, as a `Furnishing`'s) and what is needed to draw them. */
export type Person = {
  readonly building: number;
  readonly unit: number;
  readonly s: number;
  readonly d: number;
  /** The way they face, a unit vector in (s, d). */
  readonly face: { readonly s: number; readonly d: number };
  readonly model: PersonModel;
  /** Their height against the model's own, 0.95 to 1.04. */
  readonly scale: number;
  /** Where in the clip they start, seconds. */
  readonly offset: number;
  /** How fast the clip runs for them, 0.85 to 1.1. */
  readonly rate: number;
  readonly role: PersonRole;
};

/** How close to a wall (and the back partition) a person stands, metres. */
export const WALL_MARGIN = 0.35;
/** How far a person stands from any furnishing's footprint, at least. */
export const FURNITURE_CLEAR = 0.3;
/** How far apart two people stand, at least. */
export const PEOPLE_APART = 0.7;
/** Past the door's width on each side, and how deep from the glass, the door's zone reaches. */
export const DOOR_SIDE = 0.45;
export const DOOR_DEEP = 1.6;
/** How far behind a service point staff stand, from its edge. */
const STAFF_OFF = 0.45;
/** A hair more than the least distances above, so that a spot is clear by the tests' own arithmetic too. */
const SLACK = 0.01;

/** Most customers a room of each kind has, and the fewest (a bar is never empty). */
const CUSTOMERS: Record<InteriorType, readonly [number, number]> = {
  "retail aisles": [0, 2], "counter service": [0, 2], "dining room": [0, 2], bar: [1, 3], laundromat: [0, 2], office: [0, 1], workshop: [0, 1], lobby: [0, 1], empty: [0, 0],
};

const SERVICE: readonly Furnishing["kind"][] = ["checkout", "counter", "desk"];
const BROWSED = new Set<Furnishing["kind"]>(["shelf run", "rack", "cooler", "display case", "bin"]);
const STOOD_AT = new Set<Furnishing["kind"]>(["hightable", "windowbar", "pool table"]);

/** A draw in [0, 1) for a person of a unit: the building, the unit, the person's index and what the draw is for. */
const roll = (building: number, unit: number, index: number, salt: number): number => hashN(building, unit, index, salt);

/** The room as people see it: where the floor is (a margin in from the walls), the door's zone, and what stands on it. */
type Floor = {
  readonly s0: number;
  readonly s1: number;
  readonly d0: number;
  readonly d1: number;
  readonly doorS0: number;
  readonly doorS1: number;
  readonly furnishings: readonly Furnishing[];
};

/** A furnishing's long axis (a unit vector), its length, its width. A thing wider than it is long is turned a quarter. */
function longAxis(f: Furnishing): { ax: number; ad: number; len: number; wid: number } {
  if (f.sx >= f.sd) return { ax: f.dir.x, ad: f.dir.z, len: f.sx, wid: f.sd };
  return { ax: -f.dir.z, ad: f.dir.x, len: f.sd, wid: f.sx };
}

/** The distance from a point to a furnishing's footprint (0 inside it). */
export function distanceToFootprint(f: Furnishing, s: number, d: number): number {
  const ds = s - f.s;
  const dd = d - f.d;
  const along = ds * f.dir.x + dd * f.dir.z;
  const across = -ds * f.dir.z + dd * f.dir.x;
  return Math.hypot(Math.max(Math.abs(along) - f.sx / 2, 0), Math.max(Math.abs(across) - f.sd / 2, 0));
}

function clearAt(floor: Floor, s: number, d: number, placed: readonly { s: number; d: number }[]): boolean {
  if (s < floor.s0 || s > floor.s1 || d < floor.d0 || d > floor.d1) return false;
  if (s > floor.doorS0 - SLACK && s < floor.doorS1 + SLACK && d < DOOR_DEEP + SLACK) return false;
  for (const f of floor.furnishings) if (distanceToFootprint(f, s, d) < FURNITURE_CLEAR + SLACK) return false;
  for (const p of placed) if (Math.hypot(p.s - s, p.d - d) < PEOPLE_APART + SLACK) return false;
  return true;
}

/** How far a ray from (s, d) toward the unit vector (ns, nd) goes before it meets a wall of the room. */
function toWall(unit: { s0: number; s1: number; depth: number }, s: number, d: number, ns: number, nd: number): number {
  let t = Infinity;
  if (ns > 1e-9) t = Math.min(t, (unit.s1 - s) / ns);
  if (ns < -1e-9) t = Math.min(t, (unit.s0 - s) / ns);
  if (nd > 1e-9) t = Math.min(t, (unit.depth - d) / nd);
  if (nd < -1e-9) t = Math.min(t, (0 - d) / nd);
  return t;
}

type Spot = { s: number; d: number; fs: number; fd: number };

/** Turns a facing by `radians`. */
function turned(fs: number, fd: number, radians: number): { s: number; d: number } {
  const c = Math.cos(radians);
  const n = Math.sin(radians);
  return { s: fs * c - fd * n, d: fs * n + fd * c };
}

/**
 * The spots beside a furnishing's long side: `sides` in the order tried (+1 and -1 are the two normals of the long axis), each at `off`
 * metres from the edge, slid along the furnishing by each of `slides` (a fraction of half its length), facing it.
 */
function besideLong(f: Furnishing, off: number, sides: readonly number[], slides: readonly number[]): Spot[] {
  const { ax, ad, len, wid } = longAxis(f);
  const out: Spot[] = [];
  for (const t of slides) {
    const u = Math.max(-1, Math.min(1, t)) * Math.max(0, len / 2 - 0.2);
    for (const sg of sides) {
      const ns = -ad * sg;
      const nd = ax * sg;
      const reach = wid / 2 + off;
      out.push({ s: f.s + ax * u + ns * reach, d: f.d + ad * u + nd * reach, fs: -ns, fd: -nd });
    }
  }
  return out;
}


/** The spots at either end of a furnishing's long axis, in line with it, facing the way the customers are (away from `behind`). `first` says which end is tried first. */
function atEnds(f: Furnishing, behind: number, first: boolean): Spot[] {
  const { ax, ad, len } = longAxis(f);
  const reach = len / 2 + STAFF_OFF;
  const ns = ad * behind;
  const nd = -ax * behind;
  const ends = first ? [1, -1] : [-1, 1];
  return ends.map((e) => ({ s: f.s + ax * reach * e, d: f.d + ad * reach * e, fs: ns, fd: nd }));
}

/** Where a person stands to be where they are, at most a few tried: the first that is clear. */
function firstClear(floor: Floor, spots: readonly Spot[], placed: readonly { s: number; d: number }[]): Spot | null {
  for (const spot of spots) if (clearAt(floor, spot.s, spot.d, placed)) return spot;
  return null;
}

function modelFor(building: number, unit: number, index: number, used: Set<PersonModel>): PersonModel {
  const start = Math.floor(roll(building, unit, index, 10) * PERSON_MODELS.length);
  for (let k = 0; k < PERSON_MODELS.length; k++) {
    const m = PERSON_MODELS[(start + k) % PERSON_MODELS.length] as PersonModel;
    if (!used.has(m)) {
      used.add(m);
      return m;
    }
  }
  return PERSON_MODELS[start] as PersonModel;
}

/** A person from a spot: the draws that make them unlike the next. */
function personAt(building: number, unit: number, index: number, spot: Spot, role: PersonRole, used: Set<PersonModel>): Person {
  // Up to 15 degrees either way from square to whatever they face.
  const way = turned(spot.fs, spot.fd, (roll(building, unit, index, 11) * 2 - 1) * ((15 * Math.PI) / 180));
  return {
    building, unit, s: Math.round(spot.s * 1000) / 1000, d: Math.round(spot.d * 1000) / 1000, face: way,
    model: modelFor(building, unit, index, used),
    scale: 0.95 + roll(building, unit, index, 12) * 0.09,
    offset: roll(building, unit, index, 13) * IDLE_SECONDS,
    rate: 0.85 + roll(building, unit, index, 14) * 0.25,
    role,
  };
}

/** The people of one open unit. */
function unitPeople(b: Building, unit: Unit): Person[] {
  const id = b.id;
  const uid = unit.id;
  const room = unit.interior;
  const floor: Floor = {
    s0: unit.s0 + 0.04 + WALL_MARGIN, s1: unit.s1 - 0.04 - WALL_MARGIN, d0: WALL_MARGIN, d1: room.depth - WALL_MARGIN,
    doorS0: unit.door.s - unit.door.width / 2 - DOOR_SIDE, doorS1: unit.door.s + unit.door.width / 2 + DOOR_SIDE, furnishings: room.furnishings,
  };
  const bounds = { s0: unit.s0 + 0.04, s1: unit.s1 - 0.04, depth: room.depth };
  const out: Person[] = [];
  const placed: { s: number; d: number }[] = [];
  const used = new Set<PersonModel>();
  const add = (index: number, spot: Spot, role: PersonRole): void => {
    const p = personAt(id, uid, index, spot, role, used);
    out.push(p);
    placed.push(p);
  };

  // The service point, and the side of it staff stand on: the long side with the less clear floor between it and a wall.
  let service: Furnishing | null = null;
  for (const kind of SERVICE) {
    service = room.furnishings.find((f) => f.kind === kind) ?? null;
    if (service !== null) break;
  }
  let behind = 1;
  let slide = 0;
  if (service !== null) {
    const { ax, ad, wid } = longAxis(service);
    const clear = (sg: number): number => toWall(bounds, service!.s, service!.d, -ad * sg, ax * sg) - wid / 2;
    const a = clear(1);
    const b2 = clear(-1);
    behind = a < b2 - 1e-9 ? 1 : b2 < a - 1e-9 ? -1 : roll(id, uid, 0, 3) < 0.5 ? 1 : -1;
    slide = (roll(id, uid, 0, 4) - 0.5) * 0.9;
    if (roll(id, uid, 0, 1) < 0.85) {
      const front = [slide, 0, slide * -0.6, 0.5, -0.5, 0.25, -0.25];
      // Behind it, 0.45 m off its edge, facing across it. Where the wall is too near for that (the plan puts a counter close to a wall), a little nearer,
      // and failing that at the end of the counter, as a cashier stands at the end of a lane, facing into the room.
      const ordered = [...besideLong(service, STAFF_OFF, [behind], front), ...besideLong(service, STAFF_OFF - 0.1, [behind], [slide, 0]), ...atEnds(service, behind, roll(id, uid, 0, 9) < 0.5)];
      const spot = firstClear(floor, ordered, placed);
      if (spot !== null) add(0, spot, "staff");
    }
  }

  // How many customers: none 45 percent, one 35, two 15, three 5, within what the kind of room allows.
  const [least, most] = CUSTOMERS[room.type];
  const r = roll(id, uid, 1, 2);
  const want = Math.max(least, Math.min(most, r < 0.45 ? 0 : r < 0.8 ? 1 : r < 0.95 ? 2 : 3));
  const browsed = room.furnishings.filter((f) => BROWSED.has(f.kind) && f.sx * f.sd >= 0.3);
  const stood = room.furnishings.filter((f) => STOOD_AT.has(f.kind));
  const washers = room.furnishings.filter((f) => f.kind === "washer row");
  const activities: ("queue" | "browse" | "stand" | "wash" | "wait")[] = [];
  if (service !== null) activities.push("queue");
  if (browsed.length > 0 && room.type !== "laundromat") activities.push("browse");
  if (stood.length > 0) activities.push("stand");
  if (washers.length > 0) activities.push("wash");
  if (room.type === "dining room") activities.push("wait");
  let queueSpot: (Spot & { off: number }) | null = null;
  let queued = 0;
  const customers = activities.length === 0 ? 0 : want;
  for (let k = 0; k < customers; k++) {
    const index = 1 + k;
    const sides = roll(id, uid, index, 5) < 0.5 ? [1, -1] : [-1, 1];
    const t0 = (roll(id, uid, index, 6) - 0.5) * 1.2;
    const slides = [t0, 0, -t0, 0.5, -0.5, 0.8, -0.8];
    const start = Math.floor(roll(id, uid, index, 7) * activities.length);
    let spot: Spot | null = null;
    for (let a = 0; a < activities.length && spot === null; a++) {
      const kind = activities[(start + a) % activities.length] as (typeof activities)[number];
      const pick = <T,>(list: readonly T[], salt: number): T => list[Math.floor(roll(id, uid, index, salt) * list.length)] as T;
      if (kind === "queue" && service !== null) {
        if (queued === 0) {
          // At the customer side, facing the staff, 0.5 m off the service point (further where stools stand along a bar or counter).
          const front = [slide, slide * 0.5, 0, 0.4, -0.4];
          for (const off of [0.5, 0.8, 1.1, 1.4]) {
            const found = firstClear(floor, besideLong(service, off, [-behind], front), placed);
            if (found !== null) {
              spot = found;
              queueSpot = { ...found, off };
              break;
            }
          }
          if (spot !== null) queued = 1;
        } else if (queueSpot !== null) {
          // The next in line, 0.8 m behind the first, on the same line.
          const back: Spot = { s: queueSpot.s - queueSpot.fs * 0.8, d: queueSpot.d - queueSpot.fd * 0.8, fs: queueSpot.fs, fd: queueSpot.fd };
          if (clearAt(floor, back.s, back.d, placed)) {
            spot = back;
            queued++;
          }
        }
      } else if (kind === "browse") {
        const f = pick(browsed, 8);
        spot = firstClear(floor, besideLong(f, 0.55, sides, slides), placed);
      } else if (kind === "stand") {
        const f = pick(stood, 8);
        spot = firstClear(floor, besideLong(f, 0.55, sides, slides), placed);
      } else if (kind === "wash") {
        const f = pick(washers, 8);
        spot = firstClear(floor, besideLong(f, 0.55, sides, slides), placed);
      } else if (kind === "wait") {
        // By the door's side wall, waiting to be seated: facing into the room.
        const leftWall = unit.door.s - unit.s0 < unit.s1 - unit.door.s;
        const wall = leftWall ? floor.s0 : floor.s1;
        const spots: Spot[] = [];
        for (const d of [1.9, 2.5, 3.1, 3.7]) for (const inset of [0.05, 0.6]) spots.push({ s: wall + (leftWall ? inset : -inset), d, fs: 0, fd: 1 });
        spot = firstClear(floor, spots, placed);
      }
    }
    if (spot !== null) add(index, spot, "customer");
  }
  return out;
}

const cache = new WeakMap<TownPlan, readonly Person[]>();

/** Everyone standing in the town's open shops. The same plan gives the same people. */
export function peopleFor(plan: TownPlan): readonly Person[] {
  const known = cache.get(plan);
  if (known !== undefined) return known;
  const byId = new Map<number, Building>();
  for (const b of plan.buildings) byId.set(b.id, b);
  const out: Person[] = [];
  for (const use of plan.uses) {
    const b = byId.get(use.building);
    if (b === undefined || use.frame === null) continue;
    for (const unit of use.units) if (unit.state === "open") out.push(...unitPeople(b, unit));
  }
  cache.set(plan, out);
  return out;
}

/** Where a person stands in the world, and which way they face (yaw 0 looks toward +z; a body's matrix turns +z toward +x with it). */
export type PersonWorld = { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };

const frames = new WeakMap<TownGround, Map<number, { xf: Xf; floorY: number } | null>>();

/** The building's front frame in the world and the height of its rooms' floor, as the town draws them (`buildingLevels`). */
function frameOf(g: TownGround, plan: TownPlan, building: number): { xf: Xf; floorY: number } | null {
  let byBuilding = frames.get(g);
  if (byBuilding === undefined) {
    byBuilding = new Map();
    frames.set(g, byBuilding);
  }
  const known = byBuilding.get(building);
  if (known !== undefined) return known;
  const b = plan.buildings.find((c) => c.id === building);
  const levels = b === undefined ? null : buildingLevels(g, b);
  const made = levels === null || levels.xf === null ? null : { xf: levels.xf, floorY: levels.frontFloorY };
  byBuilding.set(building, made);
  return made;
}

export function personWorld(g: TownGround, plan: TownPlan, person: Person): PersonWorld {
  const frame = frameOf(g, plan, person.building);
  if (frame === null) throw new Error(`building ${person.building} has no front to stand in`);
  const at = xp(frame.xf, person.s, person.d, frame.floorY);
  const way = xd(frame.xf, person.face.s, person.face.d);
  return { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(way[0], way[2]) };
}
