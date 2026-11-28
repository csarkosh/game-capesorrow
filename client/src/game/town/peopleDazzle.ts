/**
 * What the town's people do when the player's torch is shone in their face: the screen's own, as the other reactions are (`peopleReact.ts`), and each
 * player sees their own. Pure arithmetic over records; it reads the torch as the hand left it (`hand/handParts.ts`: its lens, its axis, whether it is
 * lit) and the people as they are drawn.
 *
 * - **Who is dazzled.** A person whose head is inside the torch's cone (its own cone: half of `TORCH_ANGLE`), within `DAZZLE_REACH` metres, with nothing
 *   of a wall or a thing that stands between (the `blocked` of the other reactions, tried along the beam), facing within `DAZZLE_FACING` of the player
 *   (a light on the back of a head dazzles nobody), for more than `DAZZLE_AFTER` seconds of being lit. A person seen through the glass of a shop (one of a
 *   room's, while the player is in the street) does not react; one in a room the player is in does. Only the `DAZZLE_MOST` nearest react at once, only
 *   people within reach are looked at, and only while the torch is lit and the player is on foot. The car's headlights do not dazzle anyone.
 * - **The reaction.** They stop what they are doing (a person who walks is held where they stood, and walks home to their path afterwards), turn their
 *   body `DAZZLE_TURN` away from the player and throw an arm up (`shield`: the weight of a second clip mixed into theirs, which `peopleParts.ts`
 *   reads, easing in over `DAZZLE_IN`), for as long as the light is on them and `DAZZLE_HOLD` seconds after. Then they lower it over `DAZZLE_OUT`, turn to the
 *   player with a look for `DAZZLE_LOOK` seconds and go back to what they were doing.
 * - **A word.** On going into the shielding pose they say a line, marked mean: from `DAZZLED`, or, if they were dazzled within `DAZZLE_AGAIN` seconds
 *   before, from `DAZZLED_AGAIN`, and then they go straight to the pose with no wait. The line is chosen by a hash of the person and the moment, and
 *   not one another person is saying now.
 */
import { DAZZLED, DAZZLED_AGAIN } from "../peopleWords.js";
import { chance, mindOf, move, say, wrap, type ReactSet, type ReactPlayer, type Seen } from "./peopleReact.js";

/** How far a torch dazzles (m), the share of its cone's half angle that counts, how far round from facing the player still sees the light (rad), and how long the light must be on them (s). */
export const DAZZLE_REACH = 9, DAZZLE_FACING = (100 * Math.PI) / 180, DAZZLE_AFTER = 0.33;
/** The most who react at once. */
export const DAZZLE_MOST = 4;
/** How long the arm takes to come up and to go down (s), how long it stays after the light has gone (s), how long they look at the player after (s), and how soon again counts as "again" (s). */
export const DAZZLE_IN = 0.25, DAZZLE_OUT = 0.45, DAZZLE_HOLD = 1, DAZZLE_LOOK = 1.3, DAZZLE_AGAIN_WITHIN = 6;
/** How far off facing the player the body turns, radians. */
export const DAZZLE_TURN = 0.85;
/** The height of a head over the feet (m, at scale 1), and how fast a walker walks home to their path (m/s). */
export const HEAD_HEIGHT = 1.62, HOME_SPEED = 1.7;

/** The torch as this needs it: lit and on, its lens and its unit axis, the cone's half angle (rad). */
export type DazzleTorch = { readonly lit: boolean; readonly x: number; readonly y: number; readonly z: number; readonly dx: number; readonly dy: number; readonly dz: number };

type Person = {
  /** Seconds the light has been on them (decays when it is not). */
  lit: number;
  /** The weight of the shielding clip, 0 to 1, and the stage: 0 nothing, 1 shielding (light on them or held), 2 lowering, 3 looking back. */
  weight: number;
  stage: 0 | 1 | 2 | 3;
  /** Seconds the pose is still held after the light left them; seconds left of the look back. */
  hold: number;
  look: number;
  /** When (the set's clock) they last went into the pose, and how often. */
  last: number;
  times: number;
  /** A walker's anchor: where they stood when they were dazzled. */
  ax: number;
  az: number;
  anchored: boolean;
  /** The frame they were last seen. */
  stamp: number;
};

export type DazzleSet = { readonly people: Map<number, Person>; clock: number; stamp: number };

export function newDazzle(): DazzleSet {
  return { people: new Map(), clock: 0, stamp: 0 };
}

function personOf(set: DazzleSet, key: number): Person {
  let p = set.people.get(key);
  if (p === undefined) {
    p = { lit: 0, weight: 0, stage: 0, hold: 0, look: 0, last: -1e9, times: 0, ax: 0, az: 0, anchored: false, stamp: set.stamp };
    set.people.set(key, p);
  }
  return p;
}

/** The weight of the shielding clip for a person now (0 for one who is not dazzled): `peopleParts.ts` mixes it into their clip. */
export function shieldOf(set: DazzleSet, key: number): number {
  return set.people.get(key)?.weight ?? 0;
}

/** Whether a person is in the torch's light by its cone and reach, facing the player, with a clear line: the test of the header, without the time. */
export function inBeam(p: Seen, ox: number, oz: number, torch: DazzleTorch, half: number, player: ReactPlayer, blocked: (x: number, z: number) => boolean): boolean {
  const hx = p.x + ox;
  const hz = p.z + oz;
  const hy = p.y + HEAD_HEIGHT * p.scale;
  const vx = hx - torch.x;
  const vy = hy - torch.y;
  const vz = hz - torch.z;
  const d = Math.hypot(vx, vy, vz);
  if (!(d > 0.2) || d > DAZZLE_REACH) return false;
  // Inside the cone: the angle between the beam's axis and the way to their head.
  if ((vx * torch.dx + vy * torch.dy + vz * torch.dz) / d < Math.cos(half)) return false;
  // Facing the player: the angle between the way they face and the way to the player is within `DAZZLE_FACING` (yaw 0 faces +z, sin yaw is x).
  const px = player.x - hx;
  const pz = player.z - hz;
  const pl = Math.hypot(px, pz);
  if (pl > 0.05) {
    const facing = (px * Math.sin(p.yaw) + pz * Math.cos(p.yaw)) / pl;
    if (facing < Math.cos(DAZZLE_FACING)) return false;
  }
  // Clear: nothing that stands between the lens and their head, tried every half metre along the beam (the last half metre is theirs).
  const steps = Math.floor((d - 0.4) / 0.5);
  for (let i = 1; i <= steps; i++) {
    const t = (i * 0.5) / d;
    if (blocked(torch.x + vx * t, torch.z + vz * t)) return false;
  }
  return true;
}

/** The line a person says now: from the table for a first or a repeat, by a hash of them and the moment, and not one that someone else is saying. */
export function dazzleLine(set: ReactSet, key: number, times: number, again: boolean, now: number): string {
  const table = again ? DAZZLED_AGAIN : DAZZLED;
  const start = Math.floor(chance(key, times * 13 + Math.floor(now * 10) + 5) * table.length) % table.length;
  for (let k = 0; k < table.length; k++) {
    const text = table[(start + k) % table.length] as string;
    if (!set.said.some((s) => s.text === text && s.key !== key)) return text;
  }
  return table[start] as string;
}

/**
 * One frame. `react` is the people's record (this moves them through it), `people` those drawn now, `torch` the torch (null where there is none), `half` its
 * cone's half angle, `player` the local player or null, `inRoom` whether the player is in a room (the room's people are then eligible, and are not otherwise),
 * `blocked(x, z)` the reactions' own test of a wall.
 */
export function stepDazzle(
  set: DazzleSet, react: ReactSet, people: readonly Seen[], torch: DazzleTorch | null, half: number, player: ReactPlayer | null, dt: number, inRoom: boolean, blocked: (x: number, z: number) => boolean,
): void {
  const step = dt > 0 && dt < 0.25 ? dt : dt >= 0.25 ? 0.25 : 0;
  set.clock += step;
  set.stamp++;
  const now = set.clock;
  const on = torch !== null && torch.lit && player !== null && player.onFoot;
  // Nothing to do: the torch is off and nobody is still in the pose.
  if (!on && set.people.size === 0) return;
  // Who is in the light now, nearest first, so that the nearest few are the ones that react.
  const candidates: { p: Seen; d: number }[] = [];
  if (on) {
    for (const p of people) {
      if (p.sheltered && !inRoom) continue;
      if (Math.abs(p.y - player.y) > 2.2) continue;
      const m = react.minds.get(p.key);
      if (!inBeam(p, m?.ox ?? 0, m?.oz ?? 0, torch, half, player, blocked)) continue;
      candidates.push({ p, d: Math.hypot(p.x - torch.x, p.z - torch.z) });
    }
    candidates.sort((a, b) => a.d - b.d || a.p.key - b.p.key);
  }
  const lit = new Set<number>();
  let active = 0;
  for (const q of set.people.values()) if (q.stage === 1) active++;
  for (const { p } of candidates) {
    const q = personOf(set, p.key);
    // A person already shielding is kept lit; a new one is counted in only while there is room for them.
    if (q.stage === 1 || active < DAZZLE_MOST || q.lit > 0) lit.add(p.key);
  }
  for (const p of people) {
    const q = set.people.get(p.key);
    if (q === undefined && !lit.has(p.key)) continue;
    const d = q ?? personOf(set, p.key);
    d.stamp = set.stamp;
    const inLight = lit.has(p.key);
    const m = mindOf(react, p.key);
    if (inLight) d.lit += step;
    else d.lit = Math.max(0, d.lit - step * 2);
    const again = now - d.last < DAZZLE_AGAIN_WITHIN;
    if (d.stage === 0 || d.stage === 3) {
      if (inLight && (again || d.lit > DAZZLE_AFTER) && active < DAZZLE_MOST) {
        // Into the pose: turned away from the player, a walker held where they are, and a word.
        d.stage = 1;
        d.hold = DAZZLE_HOLD;
        d.times++;
        active++;
        d.look = 0;
        const px = player === null ? p.x : player.x;
        const pz = player === null ? p.z : player.z;
        const toward = Math.atan2(px - p.x, pz - p.z);
        // Which way they turn away: the way they were already facing most, the same each time for the same person.
        const side = wrap(p.yaw - toward) >= 0 ? 1 : -1;
        m.turnTo = toward + side * DAZZLE_TURN;
        m.turnLeft = 60;
        if (p.walking && !d.anchored) {
          d.ax = p.x + m.ox;
          d.az = p.z + m.oz;
          d.anchored = true;
          m.dur = 0;
        }
        say(react, p, dazzleLine(react, p.key, d.times, again, now), "mean");
        d.last = now;
      }
    }
    if (d.stage === 1) {
      if (inLight) d.hold = DAZZLE_HOLD;
      else d.hold -= step;
      d.last = now;
      d.weight = Math.min(1, d.weight + step / DAZZLE_IN);
      if (d.hold <= 0) {
        d.stage = 2;
        m.turnLeft = 0;
      }
    } else if (d.stage === 2) {
      d.weight = Math.max(0, d.weight - step / DAZZLE_OUT);
      if (d.weight <= 0) {
        // Lowered: a look at the player, and then back to what they were doing.
        d.stage = 3;
        d.look = DAZZLE_LOOK;
        if (player !== null) m.turnTo = Math.atan2(player.x - p.x, player.z - p.z);
        m.turnLeft = DAZZLE_LOOK;
        if (d.anchored) {
          d.anchored = false;
          // A walker walks home to their path, at a walk.
          const dist = Math.hypot(m.ox, m.oz);
          move(m, 0, 0, Math.max(1.1, dist / HOME_SPEED), 0, 0, 1, 0, 0);
          m.home = true;
        }
      }
    } else if (d.stage === 3) {
      d.look -= step;
      if (d.look <= 0) d.stage = 0;
    }
    // A walker who is held stays where they stood: their place off their schedule is the difference between the two.
    if (d.anchored && d.stage !== 3) {
      m.ox = d.ax - p.x;
      m.oz = d.az - p.z;
      m.dur = 0;
      m.stay = 1e9;
    }
    if (d.stage === 0 && d.weight <= 0 && d.lit <= 0) set.people.delete(p.key);
  }
  // One who is no longer drawn is let go.
  if (set.stamp % 120 === 0) for (const [key, q] of set.people) if (q.stamp < set.stamp - 600) set.people.delete(key);
}
