/**
 * Who is in the open shops, and what they are doing: standing and sitting people, drawn from the plan's rooms and nothing else. This is the
 * drawing's, not the simulation's: nothing here is in the plan, nothing is kept between frames, and the same plan gives the same people on
 * every machine (each draw is a hash of the building's id, the unit's id and the person's index, never a random function or the clock).
 *
 * WHAT CAUSES A PERSON. A unit is open: then it has people (a unit shut for the day or vacant has none). They are in the front of the room,
 * within `FRONT_ZONE` of the glass, which is where the room is lit and seen. Each does what people do in that kind of room, at something it
 * holds: staff stand behind the service point and work the till (a bartender wipes the bar); in an office someone sits at a desk and types;
 * in a dining room, a cafe or a counter service room customers sit at tables and booths and eat; at a bar they sit on the stools, stand at
 * a high table with a drink or play pool; in a shop they browse the shelves, racks and cases or wait at the till; in a laundromat they load
 * a washer, fold, wait on a bench or look at their phone; in a workshop someone works at a bench. Where the service point is deeper than the
 * zone, the staff work at something in it instead (stock a shelf, wipe a front table), and if nothing there gives them work there is no staff.
 *
 * WHERE THEY SIT is where the room is drawn with a seat (`seatsOf`, the drawing's own arithmetic, so a sitter is on a seat that stands).
 * Every spot is tried against the room's floor: a standing person is inside it with a margin to each wall, clear of every furnishing's
 * footprint and of the chairs, out of the door's zone and clear of the people already placed, and never faces the glass (unless their task
 * is at something in the window); a person with no clear spot among those tried is not there. What the hash draws: who, which model, which
 * way a standing person faces (a little off square), how tall, how fast and where in the clip they start, so that no two move in step.
 */
import { unitHours, type Hours } from "./hours.js";
import { hashN } from "./groundNoise.js";
import { buildingLevels } from "./buildingGeometry.js";
import { feetOf, roomSeats, styleOf, type Seat, type SeatCtx } from "./roomFill.js";
import { BACKDROP_AT } from "./roomLight.js";
import { xd, xp } from "./roomKit.js";
import type { Xf } from "./roomKit.js";
import type { TownGround } from "./townTypes.js";
import type { Building, Furnishing, FurnishingKind, InteriorType, TownPlan, Unit } from "../../sim/town/types.js";

/** The five models, by credit id (`client/assets/models/people.json`). */
export const PERSON_MODELS = ["person.nathan", "person.eric", "person.sophia", "person.carla", "person.claudia"] as const;
export type PersonModel = (typeof PERSON_MODELS)[number];

/** The clips the models carry: what a person can be doing. A model that lacks one plays `idle` in its place (said once on the console). */
export const ACTIVITIES = [
  "idle", "browse", "till", "phone", "talk", "drink", "wipe", "fold", "sit_table", "sit_eat", "sit_type", "sit_stool",
  "wait", "arms", "lean", "call", "cup", "listen", "look", "sit_rest", "sit_phone",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export type PersonRole = "staff" | "customer";

/** A place to sit that a person is on: which furnishing it belongs to, the height of its top over the floor and its family of clips. */
export type PersonSeat = { readonly furnishing: number; readonly top: number; readonly family: "chair" | "stool" };

/** A person's place in their building's own frame (`s` along the front, `d` into the room, as a `Furnishing`'s) and what is needed to draw them. A sitter's place is the floor under the middle of their seat. */
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
  /** Where in their clip they start, seconds (they are worked on by the clip's own length). */
  readonly offset: number;
  /** How fast the clip runs for them, 0.85 to 1.1. */
  readonly rate: number;
  /** Their unit's opening hours (`hours.ts`): they are shown only while it is open. Null where the unit has none (it is always shown). */
  readonly hours: Hours | null;
  readonly role: PersonRole;
  /** The clip they play. */
  readonly activity: Activity;
  /** The seat they sit on, or null for a standing person. */
  readonly seat: PersonSeat | null;
  /** The index of the furnishing their task is at (the till, the shelf, the table), or null. */
  readonly target: number | null;
};

/** How far from the glass people are placed, metres (`d`): in front of the room's painted sheet (`roomBackdrop.ts`), which is the part of the room that is drawn. */
export const FRONT_ZONE = BACKDROP_AT - 0.35;
/** How close to a wall (and the back partition) a standing person stands, metres. */
export const WALL_MARGIN = 0.35;
/** How far a person stands from any furnishing's footprint, at least. */
export const FURNITURE_CLEAR = 0.3;
/** How far apart two standing people stand, at least; with a sitter in the pair, `SEATED_APART`. */
export const PEOPLE_APART = 0.7;
export const SEATED_APART = 0.45;
/** How far a standing person stands from a chair, at least. */
const CHAIR_CLEAR = 0.4;
/** Past the door's width on each side, and how deep from the glass, the door's zone reaches. */
export const DOOR_SIDE = 0.45;
export const DOOR_DEEP = 1.6;
/** A furnishing whose centre is within this of the glass stands in the window: a task at it may face the street. */
export const WINDOW_DEPTH = 1.7;
/** A standing person's facing is never within this many degrees of straight out through the glass. */
export const GLASS_ARC = 60;
/** How far behind a service point staff stand, from its edge. */
const STAFF_OFF = 0.45;
/** A hair more than the least distances above, so that a spot is clear by the tests' own arithmetic too. */
const SLACK = 0.01;

/** Most customers a room of each kind has, and the fewest (a bar is never empty). Seated ones in rooms that serve food and drink are more. */
const CUSTOMERS: Record<InteriorType, readonly [number, number]> = {
  "retail aisles": [0, 2], "counter service": [0, 4], "dining room": [0, 4], bar: [1, 5], laundromat: [0, 2], office: [0, 1], workshop: [0, 0], lobby: [0, 1], empty: [0, 0],
};

const SERVICE: readonly FurnishingKind[] = ["checkout", "counter", "desk"];
const BROWSED = new Set<FurnishingKind>(["shelf run", "rack", "cooler", "display case", "bin", "stand", "endcap"]);
const WORKED = new Set<FurnishingKind>(["bench", "rack", "machine", "lift"]);

/** A draw in [0, 1) for a person of a unit: the building, the unit, the person's index and what the draw is for. */
const roll = (building: number, unit: number, index: number, salt: number): number => hashN(building, unit, index, salt);

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

/** How far a ray from (s, d) toward the unit vector (ns, nd) goes before it meets a wall of the room. */
function toWall(unit: { s0: number; s1: number; depth: number }, s: number, d: number, ns: number, nd: number): number {
  let t = Infinity;
  if (ns > 1e-9) t = Math.min(t, (unit.s1 - s) / ns);
  if (ns < -1e-9) t = Math.min(t, (unit.s0 - s) / ns);
  if (nd > 1e-9) t = Math.min(t, (unit.depth - d) / nd);
  if (nd < -1e-9) t = Math.min(t, (0 - d) / nd);
  return t;
}

/** A place and the way to face there. */
type Spot = { s: number; d: number; fs: number; fd: number };
/** A thing to do at a spot: the clip, the furnishing it is at, and the seat if it is a sitter's. */
type Task = Spot & { activity: Activity; target: number | null; seat: Seat | null };

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

/** The spots at either end of a furnishing's long axis, in line with it, facing the furnishing (the end of a counter, where a cashier stands). `first` says which end is tried first. */
function atEnds(f: Furnishing, first: boolean): Spot[] {
  const { ax, ad, len } = longAxis(f);
  const reach = len / 2 + STAFF_OFF;
  const ends = first ? [1, -1] : [-1, 1];
  return ends.map((e) => ({ s: f.s + ax * reach * e, d: f.d + ad * reach * e, fs: -ax * e, fd: -ad * e }));
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

/** The facing of a standing person at a spot: up to 15 degrees either way from square to what they face. A sitter faces as the seat does. */
function facingOf(building: number, unit: number, index: number, spot: Spot, sitting: boolean): { s: number; d: number } {
  if (sitting) return { s: spot.fs, d: spot.fd };
  return turned(spot.fs, spot.fd, (roll(building, unit, index, 11) * 2 - 1) * ((15 * Math.PI) / 180));
}

/** Whether a facing points out through the glass: within `GLASS_ARC` degrees of straight out (toward d = 0). */
export function facesGlass(face: { readonly s: number; readonly d: number }): boolean {
  return -face.d > Math.cos((GLASS_ARC * Math.PI) / 180);
}

/** The seats a unit's room is drawn with, by furnishing, from the drawing's own arithmetic (`roomSeats`). */
export function unitSeats(b: Building, unit: Unit): Seat[][] {
  const inner = { s0: unit.s0 + 0.04, s1: unit.s1 - 0.04 };
  const seed = b.id * 31 + unit.id;
  const trade = unit.tenant?.trade ?? null;
  const ctx: SeatCtx = {
    seed, style: styleOf(seed, trade, b.era, unit.tenant?.opened ?? 0, unit.remodel?.decade ?? 0), feet: feetOf(unit.interior.furnishings),
    door: { s: unit.door.s, w: unit.door.width }, s0: inner.s0, s1: inner.s1, d1: unit.interior.depth, chairs: [], detail: "full", trade,
  };
  return roomSeats(ctx, unit.interior.furnishings);
}

/** The people of one open unit. */
function unitPeople(b: Building, unit: Unit): Person[] {
  const id = b.id;
  const uid = unit.id;
  const room = unit.interior;
  const furn = room.furnishings;
  const top = Math.min(room.depth - WALL_MARGIN, FRONT_ZONE);
  const inner = { s0: unit.s0 + 0.04, s1: unit.s1 - 0.04 };
  const bounds = { s0: inner.s0, s1: inner.s1, depth: room.depth };
  const doorS0 = unit.door.s - unit.door.width / 2 - DOOR_SIDE;
  const doorS1 = unit.door.s + unit.door.width / 2 + DOOR_SIDE;
  const seatsBy = unitSeats(b, unit);
  const allSeats = seatsBy.flat();
  // Chairs are in the way of a person standing; seats drawn at tables and desks only (a stool row's and a bench's are in their furnishing's footprint).
  const chairObstacles = allSeats.filter((q) => q.family === "chair" && (furn[q.furnishing] as Furnishing).kind !== "booth" && (furn[q.furnishing] as Furnishing).kind !== "bench" && (furn[q.furnishing] as Furnishing).kind !== "couch");

  type Draft = { s: number; d: number; sitting: boolean; role: PersonRole; index: number; activity: Activity; face: { s: number; d: number }; seat: Seat | null; target: number | null; zoneCounter: boolean };
  const drafts: Draft[] = [];
  const taken = new Set<string>();
  const seatKey = (q: Seat): string => `${q.furnishing}:${q.s.toFixed(3)}:${q.d.toFixed(3)}`;

  /** Whether a standing person may stand here, with this facing, for a task at `target`. */
  const standClear = (t: Spot, index: number, target: number | null): boolean => {
    const face = facingOf(id, uid, index, t, false);
    const inWindow = target !== null && (furn[target] as Furnishing).d <= WINDOW_DEPTH;
    if (facesGlass(face) && !inWindow) return false;
    if (t.s < inner.s0 + WALL_MARGIN || t.s > inner.s1 - WALL_MARGIN || t.d < WALL_MARGIN || t.d > top) return false;
    if (t.s > doorS0 - SLACK && t.s < doorS1 + SLACK && t.d < DOOR_DEEP + SLACK) return false;
    for (const f of furn) if (distanceToFootprint(f, t.s, t.d) < FURNITURE_CLEAR + SLACK) return false;
    for (const q of chairObstacles) if (Math.hypot(q.s - t.s, q.d - t.d) < CHAIR_CLEAR + SLACK) return false;
    for (const p of drafts) if (Math.hypot(p.s - t.s, p.d - t.d) < (p.sitting ? SEATED_APART : PEOPLE_APART) + SLACK) return false;
    return true;
  };
  /** Whether a seat may be sat on: free, in the front zone, inside the room and no other furnishing's, apart from the people there. */
  const seatClear = (q: Seat): boolean => {
    if (taken.has(seatKey(q)) || q.d > top || q.d < 0.2 || q.s < inner.s0 + 0.2 || q.s > inner.s1 - 0.2) return false;
    for (const [k, f] of furn.entries()) if (k !== q.furnishing && distanceToFootprint(f, q.s, q.d) < 0.05) return false;
    for (const p of drafts) if (Math.hypot(p.s - q.s, p.d - q.d) < SEATED_APART + SLACK) return false;
    return true;
  };
  const place = (t: Task, index: number, role: PersonRole, zoneCounter = false): boolean => {
    if (t.seat !== null) {
      if (!seatClear(t.seat)) return false;
      taken.add(seatKey(t.seat));
    } else if (!standClear(t, index, t.target)) return false;
    drafts.push({ s: t.s, d: t.d, sitting: t.seat !== null, role, index, activity: t.activity, face: facingOf(id, uid, index, t, t.seat !== null), seat: t.seat, target: t.target, zoneCounter });
    return true;
  };
  const firstTask = (tasks: readonly Task[], index: number, role: PersonRole, zoneCounter = false): boolean => {
    for (const t of tasks) if (place(t, index, role, zoneCounter)) return true;
    return false;
  };
  const stand = (f: Furnishing, k: number, spots: readonly Spot[], activity: Activity): Task[] => spots.map((s) => ({ ...s, activity, target: k, seat: null }));
  const sit = (q: Seat, activity: Activity): Task => ({ s: q.s, d: q.d, fs: q.fs, fd: q.fd, activity, target: q.furnishing, seat: q });
  const indexed = furn.map((f, k) => ({ f, k }));

  // ---- Staff
  const index0 = 0;
  const staffOn = roll(id, uid, 0, 1) < 0.9;
  const slideA = (roll(id, uid, 0, 4) - 0.5) * 0.9;
  const front = [slideA, 0, slideA * -0.6, 0.5, -0.5, 0.25, -0.25];
  let service: { f: Furnishing; k: number } | null = null;
  for (const kind of SERVICE) {
    const hit = indexed.find((q) => q.f.kind === kind);
    if (hit !== undefined) {
      service = hit;
      break;
    }
  }
  /** Spots behind a counter (the long side with less clear floor to a wall), a little nearer, and at its end; facing it. */
  const behindOf = (f: Furnishing): { sg: number; spots: Spot[] } => {
    const { ax, ad, wid } = longAxis(f);
    const clear = (sg: number): number => toWall(bounds, f.s, f.d, -ad * sg, ax * sg) - wid / 2;
    const a = clear(1);
    const c = clear(-1);
    const sg = a < c - 1e-9 ? 1 : c < a - 1e-9 ? -1 : roll(id, uid, 0, 3) < 0.5 ? 1 : -1;
    return { sg, spots: [...besideLong(f, STAFF_OFF, [sg], front), ...besideLong(f, STAFF_OFF - 0.1, [sg], [slideA, 0]), ...atEnds(f, roll(id, uid, 0, 9) < 0.5)] };
  };
  let behind = 1;
  if (service !== null) behind = behindOf(service.f).sg;
  const office = room.type === "office" || room.type === "lobby";
  const deskSeats = indexed.filter((q) => q.f.kind === "desk").flatMap((q) => seatsBy[q.k] as Seat[]);
  let staffAtCounter = false;
  if (staffOn && room.type !== "laundromat" && room.type !== "empty") {
    let done = false;
    if (room.type === "workshop") {
      for (const { f, k } of indexed) {
        if (done || !WORKED.has(f.kind)) continue;
        done = firstTask(stand(f, k, besideLong(f, 0.5, roll(id, uid, 0, 5) < 0.5 ? [1, -1] : [-1, 1], front), "till"), index0, "staff");
      }
    } else {
      if (office) for (const q of deskSeats) if (!done) done = firstTask([sit(q, "sit_type")], index0, "staff");
      if (!done && service !== null) {
        const bar = room.type === "bar";
        const activity: Activity = bar && roll(id, uid, 0, 15) < 0.5 ? "wipe" : "till";
        done = firstTask(stand(service.f, service.k, behindOf(service.f).spots, activity), index0, "staff", true);
        staffAtCounter = done;
      }
      if (!done) {
        // The service point is out of the front zone (or has no room behind it): work at something in it instead.
        for (const { f, k } of indexed) {
          if (done || f.d > top + 1) continue;
          const sides = roll(id, uid, 0, 5) < 0.5 ? [1, -1] : [-1, 1];
          if (BROWSED.has(f.kind) && f.kind !== "stand") done = firstTask(stand(f, k, besideLong(f, 0.55, sides, front), "browse"), index0, "staff");
          else if ((f.kind === "table" || f.kind === "hightable" || f.kind === "pool table") && (room.type === "dining room" || room.type === "counter service" || room.type === "bar")) done = firstTask(stand(f, k, besideLong(f, 0.5, sides, front), "wipe"), index0, "staff");
          else if (f.kind === "counter" || f.kind === "checkout") done = firstTask(stand(f, k, behindOf(f).spots, "till"), index0, "staff", true);
        }
      }
    }
  }

  // ---- Customers
  const [least, most] = CUSTOMERS[room.type];
  const r = roll(id, uid, 1, 2);
  const seatedRoom = room.type === "dining room" || room.type === "counter service";
  const raw = room.type === "bar" ? 1 + (r < 0.15 ? 0 : r < 0.4 ? 1 : r < 0.65 ? 2 : r < 0.85 ? 3 : 4) : seatedRoom ? (r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.7 ? 2 : r < 0.88 ? 3 : 4) : r < 0.3 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
  const want = Math.max(least, Math.min(most, raw));
  type Kind = "queue" | "aisle" | "seat" | "stool" | "hightable" | "pool" | "wash" | "fold" | "bench" | "wall" | "work";
  const kinds: Kind[] = [];
  switch (room.type) {
    case "retail aisles": kinds.push("aisle", "queue"); break;
    case "counter service": case "dining room": kinds.push("seat", "seat", "stool", "queue", "aisle"); break;
    case "bar": kinds.push("stool", "stool", "hightable", "pool", "seat"); break;
    case "laundromat": kinds.push("wash", "fold", "bench", "wall"); break;
    case "office": kinds.push("work", "bench", "queue"); break;
    case "lobby": kinds.push("bench", "wall", "queue"); break;
    default: break;
  }
  let queued = 0;
  let queueFirst: Task | null = null;
  let lastTable = -1;
  const seatsOfKinds = (ks: FurnishingKind[]): Seat[] => indexed.filter((q) => ks.includes(q.f.kind)).flatMap((q) => seatsBy[q.k] as Seat[]);
  for (let k = 0; k < want && kinds.length > 0; k++) {
    const index = 1 + k;
    const sides = roll(id, uid, index, 5) < 0.5 ? [1, -1] : [-1, 1];
    const t0 = (roll(id, uid, index, 6) - 0.5) * 1.2;
    const slides = [t0, 0, -t0, 0.5, -0.5, 0.8, -0.8];
    const start = Math.floor(roll(id, uid, index, 7) * kinds.length);
    const shuffled = (list: readonly { f: Furnishing; k: number }[], salt: number): { f: Furnishing; k: number }[] => {
      const n = list.length;
      const at = n === 0 ? 0 : Math.floor(roll(id, uid, index, salt) * n);
      return list.map((_, j) => list[(at + j) % n] as { f: Furnishing; k: number });
    };
    let done = false;
    for (let a = 0; a < kinds.length && !done; a++) {
      const kind = kinds[(start + a) % kinds.length] as Kind;
      const phoneOrTalk: Activity = roll(id, uid, index, 16) < 0.5 ? "phone" : "talk";
      switch (kind) {
        case "queue": {
          if (service === null) break;
          if (queued === 0) {
            const tasks: Task[] = [];
            for (const off of [0.5, 0.8, 1.1, 1.4]) tasks.push(...stand(service.f, service.k, besideLong(service.f, off, [-behind], [slideA, slideA * 0.5, 0, 0.4, -0.4]), phoneOrTalk));
            for (const t of tasks) {
              if (place(t, index, "customer")) {
                queueFirst = t;
                queued = 1;
                done = true;
                break;
              }
            }
          } else if (queueFirst !== null) {
            // The next in line, 0.8 m behind the first, on the same line.
            const back: Task = { ...queueFirst, s: queueFirst.s - queueFirst.fs * 0.8, d: queueFirst.d - queueFirst.fd * 0.8 };
            if (place(back, index, "customer")) {
              queued++;
              done = true;
            }
          }
          break;
        }
        case "aisle": {
          const act: Activity = roll(id, uid, index, 17) < 0.75 ? "browse" : "phone";
          for (const { f, k: fk } of shuffled(indexed.filter((q) => BROWSED.has(q.f.kind)), 8)) {
            if (done) break;
            done = firstTask(stand(f, fk, besideLong(f, 0.55, sides, slides), act), index, "customer");
          }
          break;
        }
        case "seat": {
          const seats = seatsOfKinds(["table", "booth"]);
          // The same table as the last sitter half the time: two at one table face each other.
          const order = seats.map((_, j) => seats[(Math.floor(roll(id, uid, index, 8) * seats.length) + j) % seats.length] as Seat);
          const same = lastTable >= 0 && roll(id, uid, index, 18) < 0.5 ? order.filter((q) => q.furnishing === lastTable) : [];
          const act: Activity = roll(id, uid, index, 19) < 0.6 ? "sit_eat" : "sit_table";
          for (const q of [...same, ...order]) {
            if (place(sit(q, act), index, "customer")) {
              lastTable = q.furnishing;
              done = true;
              break;
            }
          }
          break;
        }
        case "stool": {
          const stools = seatsOfKinds(["stool row", "windowbar"]);
          const order = stools.map((_, j) => stools[(Math.floor(roll(id, uid, index, 8) * stools.length) + j) % stools.length] as Seat);
          for (const q of order) {
            // Seated at a window bar, side-on to the glass: not looking out through it.
            const turnedQ: Seat = (furn[q.furnishing] as Furnishing).kind === "windowbar" ? { ...q, fs: roll(id, uid, index, 12) < 0.5 ? 1 : -1, fd: 0 } : q;
            if (place(sit(turnedQ, "sit_stool"), index, "customer")) {
              done = true;
              break;
            }
          }
          break;
        }
        case "hightable": {
          const tables = indexed.filter((q) => q.f.kind === "hightable");
          // The table of the last person at one, the other side of it, if there is one: two facing each other across it.
          const ordered = [...tables.filter((q) => q.k === lastTable), ...shuffled(tables.filter((q) => q.k !== lastTable), 8)];
          const act: Activity = roll(id, uid, index, 20) < 0.6 ? "drink" : "talk";
          for (const { f, k: fk } of ordered) {
            if (done) break;
            done = firstTask(stand(f, fk, besideLong(f, 0.55, sides, [0]), act), index, "customer");
            if (done) lastTable = fk;
          }
          break;
        }
        case "pool": {
          const act: Activity = roll(id, uid, index, 21) < 0.6 ? "talk" : "idle";
          for (const { f, k: fk } of indexed.filter((q) => q.f.kind === "pool table")) if (!done) done = firstTask(stand(f, fk, besideLong(f, 0.6, sides, slides), act), index, "customer");
          break;
        }
        case "wash": {
          for (const { f, k: fk } of shuffled(indexed.filter((q) => q.f.kind === "washer row"), 8)) if (!done) done = firstTask(stand(f, fk, besideLong(f, 0.55, sides, slides), "browse"), index, "customer");
          break;
        }
        case "fold": {
          for (const { f, k: fk } of shuffled(indexed.filter((q) => q.f.kind === "table" || q.f.kind === "leaner"), 8)) if (!done) done = firstTask(stand(f, fk, besideLong(f, 0.5, sides, slides), "fold"), index, "customer");
          break;
        }
        case "bench": {
          const seats = seatsOfKinds(["bench", "couch"]);
          const order = seats.map((_, j) => seats[(Math.floor(roll(id, uid, index, 8) * seats.length) + j) % seats.length] as Seat);
          for (const q of order) {
            if (place(sit(q, "sit_table"), index, "customer")) {
              done = true;
              break;
            }
          }
          break;
        }
        case "wall": {
          // By a side wall looking at a phone, turned toward the room.
          const left = roll(id, uid, index, 22) < 0.5;
          const wallS = left ? inner.s0 + WALL_MARGIN : inner.s1 - WALL_MARGIN;
          const tasks: Task[] = [];
          for (const dd of [2.2, 3.0, 3.7, 2.6, 3.4]) for (const inset of [0.02, 0.5]) tasks.push({ s: wallS + (left ? inset : -inset), d: dd, fs: left ? 1 : -1, fd: 0, activity: "phone", target: null, seat: null });
          done = firstTask(tasks, index, "customer");
          break;
        }
        case "work": {
          // Standing by a cabinet or the water cooler, or the copier: on the phone or looking something up.
          const act: Activity = roll(id, uid, index, 23) < 0.5 ? "phone" : "browse";
          for (const { f, k: fk } of shuffled(indexed.filter((q) => q.f.kind === "cabinet" || q.f.kind === "water cooler" || q.f.kind === "machine" || q.f.kind === "rack"), 8)) {
            if (!done) done = firstTask(stand(f, fk, besideLong(f, 0.55, sides, slides), act), index, "customer");
          }
          break;
        }
      }
    }
  }

  // A customer at the counter and the clerk across it: about half the time they talk.
  if (staffAtCounter && queueFirst !== null && roll(id, uid, 1, 24) < 0.5) {
    const clerk = drafts.find((p) => p.role === "staff" && p.zoneCounter);
    const guest = drafts.find((p) => p.role === "customer" && !p.sitting && p.target === (service === null ? -2 : service.k));
    if (clerk !== undefined && guest !== undefined) {
      clerk.activity = "talk";
      guest.activity = "talk";
    }
  }

  const used = new Set<PersonModel>();
  return drafts.map((p) => ({
    building: id, unit: uid, s: Math.round(p.s * 1000) / 1000, d: Math.round(p.d * 1000) / 1000, face: p.face,
    model: modelFor(id, uid, p.index, used),
    scale: 0.95 + roll(id, uid, p.index, 12) * 0.09,
    offset: roll(id, uid, p.index, 13) * 60,
    rate: 0.85 + roll(id, uid, p.index, 14) * 0.25,
    hours: unitHours(b, unit), role: p.role, activity: p.activity,
    seat: p.seat === null ? null : { furnishing: p.seat.furnishing, top: p.seat.top, family: p.seat.family },
    target: p.target,
  }));
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
