/**
 * How the town's people answer the player: the screen's own, worked out each frame from the people as they are drawn, the cars and the local
 * player, as what a car knocks down is (`knocked.ts`). The people are a schedule (`outdoorPeople.ts`, `walkers.ts`, `people.ts`): where each is at
 * an hour is fixed, and nothing here changes it. What this keeps is, for each person it has cause to, a small move away from where the schedule
 * has them and back, a turn of the body, and what they say.
 *
 * - **A car.** A person who is in the way a moving car is going (inside the strip its body will sweep, less than `LEAP_LEAD` seconds ahead of its
 *   nose, or already under it) jumps out of it: sideways to the nearer side of the strip that is clear of a wall, a hop, in `LEAP_SECONDS`, then
 *   turns on the driver and says something mean (`MEAN`). They stay out of the road while a car is near and then walk back.
 * - **The player on foot.** A person the player walks into is knocked back a step along the player's way, leaning away, and is annoyed
 *   (`BUMPED`). Walked into again, they are pushed further, to `SHOVE_MOST` in all; then they go back. One who is seated is not moved.
 * - **A greeting.** A person the player on foot comes within `GREET_NEAR` of, face to face or in passing, greets the detective by the hour
 *   (`greetingsAt`): most of those who walk, some of those who stand; a stander turns to them. Not twice within `GREET_AGAIN` seconds.
 * - **Talk.** Two who stand or walk together, with the player within `CHAT_NEAR`, say a line now and then, in turn, of the kind of place they
 *   are at (`CHATTER`).
 *
 * No clip is made for any of this (the models carry none of a jump or a stumble): the body is moved, hopped, leaned and turned as it plays the
 * clip it was playing. Pure arithmetic over records; nothing is thrown or left not a number whatever `dt` is.
 */
import { CAR_LENGTH, CAR_WIDTH } from "../../sim/car/tuning.js";
import { BUMPED, CHATTER, MEAN, greetingsAt, type Venue } from "../peopleWords.js";
import type { ReasonId } from "./outdoorPeople.js";
import type { WalkReasonId } from "./walkers.js";
import type { Trade } from "../../sim/town/types.js";

/** What two who walk together talk of, by why they walk. */
export const WALK_VENUE: { readonly [R in WalkReasonId]: Venue } = {
  "coffee": "cafe", "to work": "work", "errand": "shop", "lunch out": "restaurant", "lunch back": "work", "evening": "bar", "late": "bar", "night": "street",
};

/** What two who stand outside together talk of, by why they are there. */
export function venueOfReason(reason: ReasonId): Venue {
  if (reason === "tavern") return "bar";
  if (reason === "morning drink") return "cafe";
  if (reason === "lunch" || reason === "dinner") return "restaurant";
  if (reason === "break") return "work";
  if (reason === "errand" || reason === "window shopping" || reason === "shopkeeper" || reason === "night shop") return "shop";
  return "street";
}

/** What two in a room talk of, by the trade of the unit (null where it has none). */
export function venueOfTrade(trade: Trade | null): Venue {
  if (trade === "tavern") return "bar";
  if (trade === "cafe" || trade === "espresso stand" || trade === "bakery") return "cafe";
  if (trade === "diner" || trade === "restaurant" || trade === "pizza and burgers") return "restaurant";
  return trade === null ? "street" : "shop";
}

/** How far ahead of a car's nose, in seconds of its travel, a person in its way jumps; how long the jump takes; how high (m). */
export const LEAP_LEAD = 0.8, LEAP_SECONDS = 0.36, LEAP_HOP = 0.24;
/** A person's own radius (m), how far clear of the car's strip a jump lands (m), and the slowest car (m/s over the ground) anyone jumps from. */
export const BODY = 0.3, LEAP_CLEAR = 0.7, LEAP_FROM = 1.2;
/** How far a car's threat is looked for (m), and how long a person stays out of the road after the last car near them (s). */
export const LEAP_REACH = 16, LEAP_STAY = 2.2;
/** A bump: how near the player's middle is to a person's (m), how fast the player must be closing (m/s), how far the person is knocked back (m), in how long (s), and the most they are pushed in all (m). */
export const BUMP_NEAR = 0.62, BUMP_FROM = 0.5, BUMP_BACK = 0.55, BUMP_SECONDS = 0.32, SHOVE_MOST = 1.7;
/** How long a knocked-back person stays there (s), how long anyone takes to walk back (s), and the lean of a jump and of a stumble (rad). */
export const BUMP_STAY = 1.8, HOME_SECONDS = 1.1, LEAP_LEAN = 0.3, BUMP_LEAN = 0.34;
/** A greeting: how near (m), the seconds before the same person greets again, the seconds between any two greetings, and the share of walkers and of standers who greet at all. */
export const GREET_NEAR = 3.4, GREET_AGAIN = 90, GREET_GAP = 2.5, GREET_WALKERS = 0.85, GREET_STANDERS = 0.4;
/** Talk: how near the player must be (m), and the least and most seconds between one pair's lines. */
export const CHAT_NEAR = 8, CHAT_GAP: readonly [number, number] = [4.5, 9];
/** How long a line is shown (s): its least, and more for each letter; and the most lines shown at once. */
export const SAY_LEAST = 2.2, SAY_PER_LETTER = 0.045, SAID_MOST = 4;
/** How long a turn toward someone takes to come and to go (s), and how long a greeter stays turned (s). */
const TURN_EASE = 0.3, GREET_TURN = 1.6;

/** A person as the frame draws them, before any move of this file's: where and which way, their size, and what this needs to know of them. */
export type Seen = {
  /** A number of their own, the same every frame. */
  readonly key: number;
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly scale: number;
  readonly walking: boolean; readonly seated: boolean;
  /** In a room, behind its walls: no car reaches them. */
  readonly sheltered: boolean;
  /** One of a designed room's people (`PlacedPerson.room`): their places are made with the furniture, and walking into them is stopped by their block, so they are never shoved (they still say their word). */
  readonly fixed?: boolean;
  /** The key of the one they stand or walk with, or -1. */
  readonly partner: number;
  readonly venue: Venue;
};

/** A car as the frame draws it. */
export type ReactCar = { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly speed: number; readonly slip: number };
/** The local player: where their feet are, how they move over the ground, and whether they are on foot. */
export type ReactPlayer = { readonly x: number; readonly y: number; readonly z: number; readonly vx: number; readonly vz: number; readonly onFoot: boolean };

/** What a body is moved by this frame: a shift, a lift, a turn added to its yaw, and a lean of `lean` radians toward the unit direction (`lx`, `lz`). */
export type Nudge = { dx: number; dy: number; dz: number; yaw: number; lx: number; lz: number; lean: number };

/** A line being said: by whom, the words, where their head is, and how long it has been shown of how long. */
export type Said = { key: number; text: string; x: number; y: number; z: number; age: number; life: number; kind: "mean" | "bumped" | "greeting" | "chatter" };

/** What is kept of a person who has had cause to react. */
type Mind = {
  /** Where they are off their schedule now, and the move in hand: from, to, how far into how long, its hop and its lean. */
  ox: number; oz: number; fx: number; fz: number; tx: number; tz: number; t: number; dur: number; hop: number; lean: number; lx: number; lz: number;
  /** Seconds they stay where the move left them before they walk back; whether the move in hand is the walk back. */
  stay: number; home: boolean;
  /** The yaw they are turned to (absolute) and for how much longer; how far into the turn they are. */
  turnTo: number; turnLeft: number; turned: number;
  /** When (the set's clock, seconds) they last jumped, were bumped, greeted and talked; and how many lines they have said. */
  leapt: number; bumped: number; greeted: number; talked: number; lines: number;
  /** The frame they were last seen. */
  stamp: number;
};

export type ReactSet = { readonly minds: Map<number, Mind>; readonly said: Said[]; clock: number; stamp: number; lastGreeting: number };

export function newReact(): ReactSet {
  return { minds: new Map(), said: [], clock: 0, stamp: 0, lastGreeting: -1e9 };
}

/** A number from 0 to 1 for two counts: the same for the same counts. */
export function chance(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function wrap(a: number): number {
  const w = a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  return Number.isFinite(w) ? w : 0;
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function mindOf(set: ReactSet, key: number): Mind {
  let m = set.minds.get(key);
  if (m === undefined) {
    m = { ox: 0, oz: 0, fx: 0, fz: 0, tx: 0, tz: 0, t: 0, dur: 0, hop: 0, lean: 0, lx: 1, lz: 0, stay: 0, home: false, turnTo: 0, turnLeft: 0, turned: 0, leapt: -1e9, bumped: -1e9, greeted: -1e9, talked: -1e9, lines: 0, stamp: set.stamp };
    set.minds.set(key, m);
  }
  return m;
}

/** Begins a move of a person from where they are off their schedule to (`tx`, `tz`) off it. */
function move(m: Mind, tx: number, tz: number, dur: number, hop: number, lean: number, lx: number, lz: number, stay: number): void {
  m.fx = m.ox;
  m.fz = m.oz;
  m.tx = tx;
  m.tz = tz;
  m.t = 0;
  m.dur = dur;
  m.hop = hop;
  m.lean = lean;
  m.lx = lx;
  m.lz = lz;
  m.stay = stay;
  m.home = false;
}

/** Says a line: in place of what the same person was saying, and in place of the oldest talk where there is no room. */
function say(set: ReactSet, p: Seen, text: string, kind: Said["kind"]): void {
  const life = SAY_LEAST + SAY_PER_LETTER * text.length;
  const at = { key: p.key, text, x: p.x, y: p.y + 1.95 * p.scale, z: p.z, age: 0, life, kind };
  const own = set.said.findIndex((q) => q.key === p.key);
  if (own >= 0) {
    set.said[own] = at;
    return;
  }
  if (set.said.length >= SAID_MOST) {
    // Talk gives way first, then whatever is oldest; talk itself is not said into a full house.
    let drop = set.said.findIndex((q) => q.kind === "chatter");
    if (drop < 0) {
      if (kind === "chatter") return;
      drop = 0;
      for (let i = 1; i < set.said.length; i++) if ((set.said[i] as Said).age > (set.said[drop] as Said).age) drop = i;
    }
    set.said.splice(drop, 1);
  }
  set.said.push(at);
}

/** A line of a table for a person: by their key and how many they have said. */
function lineOf(table: readonly string[], key: number, n: number): string {
  return table[Math.floor(chance(key, n * 7 + 3) * table.length) % table.length] as string;
}

/**
 * One frame. `people` are those drawn now, where their schedule has them; `cars` the cars; `player` the local player, or null where there is
 * none. `blocked(x, z)` says whether a place is in a wall or a thing that stands (a jump does not land in one). `hour` is the hour of day.
 */
export function stepReact(set: ReactSet, people: readonly Seen[], cars: readonly ReactCar[], player: ReactPlayer | null, dt: number, hour: number, blocked: (x: number, z: number) => boolean): void {
  const step = dt > 0 && dt < 0.25 ? dt : dt >= 0.25 ? 0.25 : 0;
  set.clock += step;
  set.stamp++;
  const now = set.clock;

  // The moves in hand go on, and those who have stayed their time walk back.
  for (const p of people) {
    const m = set.minds.get(p.key);
    if (m === undefined) continue;
    m.stamp = set.stamp;
    if (m.dur > 0) {
      m.t += step;
      const s = smooth(m.t / m.dur);
      m.ox = m.fx + (m.tx - m.fx) * s;
      m.oz = m.fz + (m.tz - m.fz) * s;
      if (m.t >= m.dur) {
        m.ox = m.tx;
        m.oz = m.tz;
        m.dur = 0;
        m.hop = 0;
        m.lean = 0;
        if (m.home) m.home = false;
      }
    } else if (m.ox !== 0 || m.oz !== 0) {
      m.stay -= step;
      if (m.stay <= 0) {
        move(m, 0, 0, HOME_SECONDS, 0, 0, 1, 0, 0);
        m.home = true;
      }
    }
    if (m.turnLeft > 0) {
      m.turnLeft -= step;
      m.turned = Math.min(1, m.turned + step / TURN_EASE);
    } else m.turned = Math.max(0, m.turned - step / TURN_EASE);
  }

  // A car: whoever is in its way jumps out of it.
  for (const c of cars) {
    const v = Math.hypot(c.speed, c.slip);
    if (!(v >= LEAP_FROM)) continue;
    const len = Math.hypot(c.hx, c.hz);
    if (!(len > 1e-6)) continue;
    const hx = c.hx / len;
    const hz = c.hz / len;
    // The way the car goes (its heading and its right, (hz, -hx)), and the right of that way.
    const dx = (hx * c.speed + hz * c.slip) / v;
    const dz = (hz * c.speed - hx * c.slip) / v;
    const nx = dz;
    const nz = -dx;
    // The strip its body sweeps is as wide as the body lies across its way: its width going straight, more when it slides.
    const half = Math.abs(hx * dx + hz * dz) * (CAR_WIDTH / 2) + Math.abs(hx * nx + hz * nz) * (CAR_LENGTH / 2);
    const nose = Math.abs(hx * dx + hz * dz) * (CAR_LENGTH / 2) + Math.abs(hx * nx + hz * nz) * (CAR_WIDTH / 2);
    for (const p of people) {
      if (p.seated || p.sheltered) continue;
      const m0 = set.minds.get(p.key);
      const px = p.x + (m0?.ox ?? 0);
      const pz = p.z + (m0?.oz ?? 0);
      const rx = px - c.x;
      const rz = pz - c.z;
      if (Math.abs(rx) > LEAP_REACH || Math.abs(rz) > LEAP_REACH) continue;
      const along = rx * dx + rz * dz;
      const across = rx * nx + rz * nz;
      const reach = half + BODY;
      if (Math.abs(across) >= reach) {
        // Clear of it, but a car this near keeps a person who jumped from walking back under it.
        if (m0 !== undefined && (m0.ox !== 0 || m0.oz !== 0) && !m0.home && Math.abs(along) < 7 && Math.abs(across) < reach + 3) m0.stay = Math.max(m0.stay, LEAP_STAY);
        continue;
      }
      // Behind its tail, or further ahead than it will be in a moment: no threat yet.
      if (along < -nose - BODY || along - nose > v * LEAP_LEAD + 0.4) continue;
      const m = mindOf(set, p.key);
      // Already jumping clear of this strip.
      if (m.dur > 0 && !m.home && m.hop > 0) continue;
      // To the side they are already on, unless a wall is there and the other side is open.
      let side = across >= 0 ? 1 : -1;
      if (across === 0) side = chance(p.key, 5) < 0.5 ? 1 : -1;
      const far = (s: number): number => s * (reach + LEAP_CLEAR) - across;
      const lands = (s: number): boolean => !blocked(px + nx * far(s), pz + nz * far(s));
      if (!lands(side) && lands(-side)) side = -side;
      const by = far(side);
      move(m, m.ox + nx * by, m.oz + nz * by, LEAP_SECONDS, LEAP_HOP, LEAP_LEAN, nx * side, nz * side, LEAP_STAY);
      // On the driver: turned to the car, and a word for them, not more than once in a while.
      m.turnTo = Math.atan2(c.x - px, c.z - pz);
      m.turnLeft = LEAP_STAY;
      if (now - m.leapt > 3.5) {
        say(set, p, lineOf(MEAN, p.key, m.lines++), "mean");
        m.leapt = now;
      }
    }
  }

  if (player !== null && player.onFoot) {
    const speed = Math.hypot(player.vx, player.vz);
    for (const p of people) {
      const m0 = set.minds.get(p.key);
      const px = p.x + (m0?.ox ?? 0);
      const pz = p.z + (m0?.oz ?? 0);
      const rx = px - player.x;
      const rz = pz - player.z;
      if (Math.abs(p.y - player.y) > 1.6) continue;
      const d = Math.hypot(rx, rz);
      // Walked into: knocked back a step the way the player is going, and annoyed.
      if (d < BUMP_NEAR && speed > 0) {
        const closing = d > 1e-6 ? (player.vx * rx + player.vz * rz) / d : speed;
        if (closing >= BUMP_FROM) {
          const m = mindOf(set, p.key);
          if (!(m.dur > 0 && !m.home && now - m.bumped < BUMP_SECONDS)) {
            // Away from the player: half the player's way, half straight off them.
            let ax = player.vx / speed + (d > 1e-6 ? rx / d : 0);
            let az = player.vz / speed + (d > 1e-6 ? rz / d : 0);
            const al = Math.hypot(ax, az) || 1;
            ax /= al;
            az /= al;
            if (!p.seated && p.fixed !== true) {
              let tx = m.ox + ax * BUMP_BACK;
              let tz = m.oz + az * BUMP_BACK;
              const off = Math.hypot(tx, tz);
              if (off > SHOVE_MOST) {
                tx *= SHOVE_MOST / off;
                tz *= SHOVE_MOST / off;
              }
              if (blocked(p.x + tx, p.z + tz)) {
                tx = m.ox;
                tz = m.oz;
              }
              move(m, tx, tz, BUMP_SECONDS, 0, BUMP_LEAN, ax, az, BUMP_STAY);
              m.turnTo = Math.atan2(-rx, -rz);
              m.turnLeft = BUMP_STAY;
            }
            if (now - m.bumped > 2.5) say(set, p, lineOf(BUMPED, p.key, m.lines++), "bumped");
            m.bumped = now;
          }
          continue;
        }
      }
      // In passing: a greeting, from one who has not just been walked into or made to jump.
      if (d < GREET_NEAR && d > BUMP_NEAR && now - set.lastGreeting >= GREET_GAP) {
        const m = set.minds.get(p.key);
        if (m !== undefined && (now - m.greeted < GREET_AGAIN || now - m.bumped < 20 || now - m.leapt < 20)) continue;
        // Most of those who walk, some of those who stand: the same ones each time.
        if (chance(p.key, 11) >= (p.walking ? GREET_WALKERS : GREET_STANDERS)) continue;
        // Face to face: the player is ahead of them, or they are ahead of the player.
        const facing = (-rx * Math.sin(p.yaw) - rz * Math.cos(p.yaw)) / (d || 1);
        const seen = speed > 0.2 ? (player.vx * rx + player.vz * rz) / (speed * (d || 1)) : 0;
        if (facing < 0.25 && seen < 0.5) continue;
        const mind = mindOf(set, p.key);
        say(set, p, lineOf(greetingsAt(hour), p.key, mind.lines++), "greeting");
        mind.greeted = now;
        set.lastGreeting = now;
        if (!p.walking && !p.seated) {
          mind.turnTo = Math.atan2(-rx, -rz);
          mind.turnLeft = GREET_TURN;
        }
      }
    }
  }

  // Talk: two who are together, with the player near, a line now and then, in turn.
  if (player !== null) {
    for (const p of people) {
      if (p.partner < 0 || p.key > p.partner) continue;
      const q = people.find((o) => o.key === p.partner);
      if (q === undefined) continue;
      if (Math.hypot(p.x - player.x, p.z - player.z) > CHAT_NEAR || Math.abs(p.y - player.y) > 2.5) continue;
      const a = mindOf(set, p.key);
      const b = mindOf(set, q.key);
      const last = Math.max(a.talked, b.talked);
      // Nobody chats while they are jumping, knocked back or greeting.
      if (a.dur > 0 || b.dur > 0 || now - Math.max(a.leapt, b.leapt, a.bumped, b.bumped) < 4 || now - Math.max(a.greeted, b.greeted) < 2.5) continue;
      const turns = a.lines + b.lines;
      const gap = CHAT_GAP[0] + (CHAT_GAP[1] - CHAT_GAP[0]) * chance(p.key, turns + 17);
      // The first line comes a moment after the player is in earshot, not the instant they are.
      if (last < -1e8) {
        a.talked = now - gap + 0.8 + chance(p.key, 29) * 1.5;
        continue;
      }
      if (now - last < gap) continue;
      const speaker = turns % 2 === 0 ? p : q;
      const mind = speaker === p ? a : b;
      say(set, speaker, lineOf(CHATTER[speaker.venue], p.key, turns), "chatter");
      mind.lines++;
      a.talked = now;
      b.talked = now;
    }
  }

  // The lines follow their speakers' heads and run out; one whose speaker is no longer drawn goes at once.
  for (let i = set.said.length - 1; i >= 0; i--) {
    const s = set.said[i] as Said;
    s.age += step;
    const p = people.find((o) => o.key === s.key);
    if (p === undefined || s.age >= s.life) {
      set.said.splice(i, 1);
      continue;
    }
    const m = set.minds.get(p.key);
    s.x = p.x + (m?.ox ?? 0);
    s.z = p.z + (m?.oz ?? 0);
    s.y = p.y + 1.95 * p.scale;
  }

  // A person who has been out of sight a while, at rest where their schedule has them, is forgotten (their cooldowns with them).
  if (set.stamp % 240 === 0) {
    for (const [key, m] of set.minds) {
      if (m.stamp < set.stamp - 3600 && m.ox === 0 && m.oz === 0) set.minds.delete(key);
    }
  }
}

/** What a person's body is moved by this frame, into `out`; false (and `out` untouched) for one who is as their schedule has them. `yaw` is the yaw the schedule gives them. */
export function nudgeOf(set: ReactSet, key: number, yaw: number, out: Nudge): boolean {
  const m = set.minds.get(key);
  if (m === undefined) return false;
  const moving = m.dur > 0;
  if (!moving && m.ox === 0 && m.oz === 0 && m.turned === 0) return false;
  const s = moving ? Math.min(1, Math.max(0, m.t / m.dur)) : 0;
  out.dx = m.ox;
  out.dz = m.oz;
  // A hop is an arc over the move; a lean swells and goes with it.
  out.dy = moving ? m.hop * 4 * s * (1 - s) : 0;
  out.lean = moving ? m.lean * Math.sin(Math.PI * s) : 0;
  out.lx = m.lx;
  out.lz = m.lz;
  out.yaw = wrap(m.turnTo - yaw) * smooth(m.turned);
  return true;
}

/**
 * Pairs up the people of rooms for talk: each with the nearest other of the same group (a unit's room) who is within `within` metres and not
 * yet paired, the nearest pairs first. Answers, for each, the place in the list of the one they are with, or -1.
 */
export function pairUp(list: readonly { readonly x: number; readonly z: number; readonly group: string }[], within = 1.7): number[] {
  const partner = list.map(() => -1);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const p = list[a] as (typeof list)[number];
      const q = list[b] as (typeof list)[number];
      if (p.group !== q.group) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d <= within) pairs.push({ a, b, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  for (const { a, b } of pairs) {
    if (partner[a] !== -1 || partner[b] !== -1) continue;
    partner[a] = b;
    partner[b] = a;
  }
  return partner;
}
