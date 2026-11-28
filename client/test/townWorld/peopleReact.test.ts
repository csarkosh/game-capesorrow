import { describe, expect, it } from "vitest";
import { restAxes, cameraAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { BUMPED, CHATTER, MEAN, greetingsAt, type Venue } from "../../src/game/peopleWords.js";
import { writeNudged } from "../../src/game/town/peopleParts.js";
import {
  BUMP_BACK, BUMP_STAY, CHAT_NEAR, GREET_AGAIN, HOME_SECONDS, LEAP_CLEAR, LEAP_HOP, LEAP_SECONDS, LEAP_STAY, SAID_MOST, SHOVE_MOST, BODY,
  chance, newReact, nudgeOf, pairUp, stepReact, venueOfReason, venueOfTrade, WALK_VENUE, type Nudge, type ReactCar, type ReactPlayer, type Seen,
} from "../../src/game/town/peopleReact.js";
import { HEAR_FAR, captionsOf, type Caption } from "../../src/game/town/speech.js";
import { CAR_WIDTH } from "../../src/sim/car/tuning.js";

const DT = 1 / 60;
const open = (): boolean => false;
const person = (key: number, x: number, z: number, over: Partial<Seen> = {}): Seen => ({ key, x, y: 0, z, yaw: 0, scale: 1, walking: false, seated: false, sheltered: false, partner: -1, venue: "street", ...over });
/** A car heading +z at (x, z). */
const car = (x: number, z: number, speed: number, slip = 0): ReactCar => ({ x, z, hx: 0, hz: 1, speed, slip });
const walker = (x: number, z: number, vx = 0, vz = 0): ReactPlayer => ({ x, y: 0, z, vx, vz, onFoot: true });
const nudge = (): Nudge => ({ dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 });
/** A key whose greeting chance is under `under` (they greet) or not. */
const keyWith = (greets: boolean, under: number): number => {
  for (let k = 1; k < 500; k++) if ((chance(k, 11) < under) === greets) return k;
  throw new Error("no such key");
};

describe("a person in a car's way", () => {
  it("jumps out of it to the nearer side, with a hop, clear of the strip the car sweeps, and says something mean", () => {
    const set = newReact();
    // 0.4 m right of the car's line and 5 m ahead of its middle, the car at 8 m/s: under a second from its nose.
    const p = person(1, 0.4, 5);
    const n = nudge();
    let highest = 0;
    stepReact(set, [p], [car(0, 0, 8)], null, DT, 12, open);
    expect(set.said.length).toBe(1);
    expect(MEAN).toContain(set.said[0]!.text);
    expect(set.said[0]!.kind).toBe("mean");
    for (let t = 0; t < LEAP_SECONDS + 0.05; t += DT) {
      stepReact(set, [p], [], null, DT, 12, open);
      expect(nudgeOf(set, 1, 0, n)).toBe(true);
      highest = Math.max(highest, n.dy);
      // Leaning the way they go, to the right (+x).
      if (n.lean > 0) expect(n.lx).toBeGreaterThan(0.9);
    }
    // To the right, where they already were, and a clear body's width past the car's side.
    expect(n.dx).toBeCloseTo(CAR_WIDTH / 2 + BODY + LEAP_CLEAR - 0.4, 6);
    expect(n.dz).toBeCloseTo(0, 6);
    expect(n.dy).toBe(0);
    expect(highest).toBeGreaterThan(LEAP_HOP * 0.9);
    expect(highest).toBeLessThanOrEqual(LEAP_HOP + 1e-9);
    // Turned on the driver: the car is behind and to the left of where they stood facing +z.
    expect(Math.abs(n.yaw)).toBeGreaterThan(1.5);
  });

  it("jumps to the other side where a wall is on the nearer one, and nobody jumps from a car that is slow, past, far ahead or beside them", () => {
    const set = newReact();
    const p = person(1, 0.4, 5);
    stepReact(set, [p], [car(0, 0, 8)], null, DT, 12, (x) => x > 1);
    for (let t = 0; t < LEAP_SECONDS + 0.05; t += DT) stepReact(set, [p], [], null, DT, 12, open);
    const n = nudge();
    nudgeOf(set, 1, 0, n);
    expect(n.dx).toBeLessThan(-(CAR_WIDTH / 2 + BODY));
    const calm = (c: ReactCar, q: Seen): boolean => {
      const s = newReact();
      stepReact(s, [q], [c], null, DT, 12, open);
      return s.said.length === 0 && !nudgeOf(s, q.key, 0, nudge());
    };
    expect(calm(car(0, 0, 0.8), person(1, 0.4, 3.5))).toBe(true);
    expect(calm(car(0, 0, 8), person(1, 0.4, -6))).toBe(true);
    expect(calm(car(0, 0, 8), person(1, 0.4, 14))).toBe(true);
    expect(calm(car(0, 0, 8), person(1, 3, 5))).toBe(true);
    // One who is seated does not jump.
    expect(calm(car(0, 0, 8), person(1, 0.4, 5, { seated: true }))).toBe(true);
    // Nor one in a room, behind its wall.
    expect(calm(car(0, 0, 8), person(1, 0.4, 5, { sheltered: true }))).toBe(true);
    // A faster car is jumped from sooner: 14 m ahead is in time at 20 m/s.
    expect(calm(car(0, 0, 20), person(1, 0.4, 14))).toBe(false);
  });

  it("stays out of the road while the car is near, then walks back to where the schedule has them", () => {
    const set = newReact();
    const p = person(1, 0.4, 5);
    const n = nudge();
    stepReact(set, [p], [car(0, 0, 8)], null, DT, 12, open);
    // The car stops beside them and sits there: three times the stay, and they have not come back under it.
    for (let t = 0; t < LEAP_STAY * 3; t += DT) stepReact(set, [p], [car(0, 4.5, 1.3)], null, DT, 12, open);
    nudgeOf(set, 1, 0, n);
    expect(n.dx).toBeGreaterThan(1);
    // The car gone: after the stay they walk back, a little each frame, and are as the schedule has them.
    let last = n.dx;
    for (let t = 0; t < LEAP_STAY + HOME_SECONDS + 0.5; t += DT) {
      stepReact(set, [p], [], null, DT, 12, open);
      const moved = nudgeOf(set, 1, 0, n);
      const now = moved ? n.dx : 0;
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      expect(last - now).toBeLessThan(0.08);
      last = now;
    }
    expect(nudgeOf(set, 1, 0, n)).toBe(false);
  });

  it("jumps from a car that slides at them sideways, by the strip its length sweeps", () => {
    // The car points +z and slides to +x at 6 m/s: a person 4 m to its right and 2 m ahead of its middle is in its way.
    const set = newReact();
    const p = person(1, 4, 2);
    stepReact(set, [p], [car(0, 0, 0, 6)], null, DT, 12, open);
    expect(set.said.length).toBe(1);
    for (let t = 0; t < LEAP_SECONDS + 0.05; t += DT) stepReact(set, [p], [], null, DT, 12, open);
    const n = nudge();
    nudgeOf(set, 1, 0, n);
    // Out along the car's length (z), not along its slide.
    expect(Math.abs(n.dz)).toBeGreaterThan(1);
    expect(Math.abs(n.dx)).toBeLessThan(1e-6);
  });
});

describe("a person the player walks into", () => {
  it("is knocked back a step along the player's way, leaning away, turned to the player, and is annoyed", () => {
    const set = newReact();
    const p = person(1, 0, 0.5);
    const n = nudge();
    stepReact(set, [p], [], walker(0, 0, 0, 1.4), DT, 12, open);
    expect(set.said.length).toBe(1);
    expect(BUMPED).toContain(set.said[0]!.text);
    let lean = 0;
    for (let t = 0; t < 0.5; t += DT) {
      stepReact(set, [p], [], walker(0, -3), DT, 12, open);
      nudgeOf(set, 1, 0, n);
      lean = Math.max(lean, n.lean);
    }
    expect(n.dz).toBeCloseTo(BUMP_BACK, 6);
    expect(n.dx).toBeCloseTo(0, 6);
    expect(lean).toBeGreaterThan(0.25);
    expect(n.lz).toBeGreaterThan(0.9);
    // They stood facing +z, away from the player: they have turned round to them.
    expect(Math.abs(n.yaw)).toBeGreaterThan(2.5);
    // And go back where they stood when left alone.
    for (let t = 0; t < BUMP_STAY + HOME_SECONDS + 0.5; t += DT) stepReact(set, [p], [], walker(0, -3), DT, 12, open);
    expect(nudgeOf(set, 1, 0, n)).toBe(false);
  });

  it("is pushed further when walked into again, to no more than the most, and not into a wall; a seated one is not moved but still says so", () => {
    const set = newReact();
    const p = person(1, 0, 0.5);
    const n = nudge();
    // The player keeps walking into them for ten seconds.
    let z = 0;
    for (let t = 0; t < 10; t += DT) {
      nudgeOf(set, 1, 0, n);
      const at = 0.5 + (nudgeOf(set, 1, 0, n) ? n.dz : 0);
      z = Math.min(z + 1.4 * DT, at - 0.3);
      stepReact(set, [p], [], walker(0, z, 0, 1.4), DT, 12, open);
    }
    nudgeOf(set, 1, 0, n);
    expect(Math.hypot(n.dx, n.dz)).toBeGreaterThan(BUMP_BACK * 1.5);
    expect(Math.hypot(n.dx, n.dz)).toBeLessThanOrEqual(SHOVE_MOST + 1e-9);
    // A wall behind them: they are annoyed and lean, and stay where they are.
    const walled = newReact();
    stepReact(walled, [p], [], walker(0, 0, 0, 1.4), DT, 12, (_x, z1) => z1 > 0.7);
    for (let t = 0; t < 0.4; t += DT) stepReact(walled, [p], [], walker(0, -3), DT, 12, open);
    expect(walled.said.length).toBe(1);
    expect(nudgeOf(walled, 1, 0, n) ? n.dz : 0).toBeCloseTo(0, 9);
    const sat = newReact();
    stepReact(sat, [person(1, 0, 0.5, { seated: true })], [], walker(0, 0, 0, 1.4), DT, 12, open);
    expect(sat.said.length).toBe(1);
    expect(nudgeOf(sat, 1, 0, n)).toBe(false);
  });

  it("is not bumped by a player who stands beside them, walks away from them, drives, or is on another floor", () => {
    const quiet = (pl: ReactPlayer): boolean => {
      const s = newReact();
      stepReact(s, [person(keyWith(false, 0.99), 0, 0.5)], [], pl, DT, 12, open);
      return s.said.length === 0;
    };
    expect(quiet(walker(0, 0, 0, 0))).toBe(true);
    expect(quiet(walker(0, 0, 0, -1.4))).toBe(true);
    expect(quiet({ ...walker(0, 0, 0, 1.4), onFoot: false })).toBe(true);
    expect(quiet({ ...walker(0, 0, 0, 1.4), y: 60 })).toBe(true);
    expect(quiet(walker(0, 0, 0, 1.4))).toBe(false);
  });
});

describe("a greeting", () => {
  it("is said to the detective in passing, by the hour, by most who walk and some who stand, and not again for a while", () => {
    const greeter = keyWith(true, 0.4);
    const set = newReact();
    // A walker coming toward the player, face to face, 2.5 m off.
    const w = person(greeter, 0, 2.5, { walking: true, yaw: Math.PI });
    stepReact(set, [w], [], walker(0, 0, 0, 1.2), DT, 8, open);
    expect(set.said.length).toBe(1);
    expect(greetingsAt(8)).toContain(set.said[0]!.text);
    expect(set.said[0]!.kind).toBe("greeting");
    // Not again while they are still near, nor a minute on.
    for (let t = 0; t < 60; t += 0.2) stepReact(set, [w], [], walker(0, 0, 0, 1.2), 0.2, 8, open);
    expect(set.said.length).toBe(0);
    // After the wait, again, once.
    let again = 0;
    let saying = false;
    for (let t = 0; t < GREET_AGAIN - 50; t += 0.2) {
      stepReact(set, [w], [], walker(0, 0, 0, 1.2), 0.2, 8, open);
      if (set.said.length === 1 && !saying) again++;
      saying = set.said.length === 1;
    }
    expect(again).toBe(1);
    // The hour's own greetings: none of the morning's at night.
    expect(greetingsAt(8).some((l) => l.includes("Morning"))).toBe(true);
    expect(greetingsAt(23).some((l) => l.includes("Morning"))).toBe(false);
    expect(greetingsAt(14).some((l) => l.includes("fternoon"))).toBe(true);
    expect(greetingsAt(19).some((l) => l.includes("vening"))).toBe(true);
  });

  it("turns a stander to the player, is not said by one with their back turned whom the player is not walking at, and never two at once", () => {
    const greeter = keyWith(true, 0.4);
    const set = newReact();
    // A stander facing -x; the player comes up on their left, from +z, walking at them.
    const p = person(greeter, 0, 0, { yaw: -Math.PI / 2 });
    stepReact(set, [p], [], walker(0, 2.5, 0, -1.2), DT, 14, open);
    expect(set.said.length).toBe(1);
    const n = nudge();
    for (let t = 0; t < 0.5; t += DT) stepReact(set, [p], [], walker(0, 2.5), DT, 14, open);
    expect(nudgeOf(set, greeter, p.yaw, n)).toBe(true);
    // Turned a quarter round, toward +z, and not moved.
    expect(n.yaw).toBeCloseTo(Math.PI / 2, 2);
    expect([n.dx, n.dz, n.dy]).toEqual([0, 0, 0]);
    // Their back to a player who stands still behind them: nothing.
    const back = newReact();
    stepReact(back, [person(greeter, 0, 2.5, { yaw: 0 })], [], walker(0, 0), DT, 14, open);
    expect(back.said.length).toBe(0);
    // Two greeters side by side: one greets, the other waits their turn.
    const other = [...Array(400).keys()].find((k) => k > greeter && chance(k, 11) < 0.4) as number;
    const two = newReact();
    stepReact(two, [person(greeter, -0.6, 2.5, { yaw: Math.PI }), person(other, 0.6, 2.5, { yaw: Math.PI })], [], walker(0, 0, 0, 1.2), DT, 14, open);
    expect(two.said.length).toBe(1);
  });
});

describe("two who are together", () => {
  it("say a line now and then with the player near, in turn, of the kind of place they are at, and nothing with nobody near", () => {
    for (const venue of ["bar", "cafe", "restaurant", "work", "shop", "street"] as const satisfies readonly Venue[]) {
      const set = newReact();
      const a = person(3, 0, 0, { partner: 4, venue });
      const b = person(4, 1, 0, { partner: 3, venue });
      const speakers: number[] = [];
      let lastText = "";
      // The player stands 4 m off for a minute: neither a greeting (the pair's keys do not greet a still player behind) nor a bump.
      for (let t = 0; t < 60; t += DT) {
        stepReact(set, [a, b], [], walker(0.5, -4), DT, 20, open);
        for (const s of set.said) {
          if (s.kind === "chatter" && s.text !== lastText) {
            expect(CHATTER[venue]).toContain(s.text);
            speakers.push(s.key);
            lastText = s.text;
          }
        }
      }
      expect(speakers.length).toBeGreaterThanOrEqual(5);
      expect(speakers.length).toBeLessThanOrEqual(14);
      // In turn.
      for (let i = 1; i < speakers.length; i++) expect(speakers[i]).not.toBe(speakers[i - 1]);
    }
    const far = newReact();
    const a = person(3, 0, 0, { partner: 4 });
    const b = person(4, 1, 0, { partner: 3 });
    for (let t = 0; t < 30; t += 0.1) stepReact(far, [a, b], [], walker(0, CHAT_NEAR + 5), 0.1, 20, open);
    expect(far.said.length).toBe(0);
    for (let t = 0; t < 30; t += 0.1) stepReact(far, [a, b], [], null, 0.1, 20, open);
    expect(far.said.length).toBe(0);
  });

  it("are the nearest two of a room who are not yet paired, never one of another room, never further off than a table's width", () => {
    const list = [
      { x: 0, z: 0, group: "a" }, { x: 1, z: 0, group: "a" }, { x: 1.4, z: 0, group: "a" },
      { x: 0.2, z: 0, group: "b" }, { x: 9, z: 9, group: "b" },
      { x: 5, z: 5, group: "a" },
    ];
    // 1 and 2 are nearest (0.4 m); 0 is left with nobody of its room in reach.
    expect(pairUp(list)).toEqual([-1, 2, 1, -1, -1, -1]);
    expect(pairUp([{ x: 0, z: 0, group: "a" }, { x: 1.6, z: 0, group: "a" }])).toEqual([1, 0]);
    expect(pairUp([{ x: 0, z: 0, group: "a" }, { x: 1.8, z: 0, group: "a" }])).toEqual([-1, -1]);
    expect(pairUp([])).toEqual([]);
  });

  it("talk of the place they are at: a tavern's of a bar, a coffee's of a cafe, a lunch's of a restaurant, a break's of work", () => {
    expect([venueOfReason("tavern"), venueOfReason("morning drink"), venueOfReason("lunch"), venueOfReason("dinner"), venueOfReason("break"), venueOfReason("window shopping"), venueOfReason("corner")]).toEqual(["bar", "cafe", "restaurant", "restaurant", "work", "shop", "street"]);
    expect([venueOfTrade("tavern"), venueOfTrade("cafe"), venueOfTrade("diner"), venueOfTrade("hardware"), venueOfTrade(null)]).toEqual(["bar", "cafe", "restaurant", "shop", "street"]);
    expect([WALK_VENUE.coffee, WALK_VENUE["lunch out"], WALK_VENUE.evening, WALK_VENUE.errand]).toEqual(["cafe", "restaurant", "bar", "shop"]);
    // Every table has lines enough to not repeat at once, and none is empty or shouts in the wrong table.
    for (const table of [MEAN, BUMPED, greetingsAt(3), greetingsAt(9), greetingsAt(15), greetingsAt(20), ...Object.values(CHATTER)]) {
      expect(table.length).toBeGreaterThanOrEqual(8);
      for (const line of table) {
        expect(line.length).toBeGreaterThan(3);
        expect(line.length).toBeLessThan(70);
      }
    }
  });
});

describe("what is said", () => {
  it("is no more than four lines at once, talk giving way first; follows its speaker; and goes with them or when its time is up", () => {
    const set = newReact();
    const crowd = [...Array(8).keys()].map((i) => person(10 + i, 0.3 + (i % 2) * 0.1, 4 + i * 0.9));
    stepReact(set, crowd, [car(0, 0, 12)], null, DT, 12, open);
    expect(set.said.length).toBe(SAID_MOST);
    for (const s of set.said) expect(s.kind).toBe("mean");
    // A line is over its speaker's head, where they have jumped to.
    for (let t = 0; t < LEAP_SECONDS + 0.05; t += DT) stepReact(set, crowd, [], null, DT, 12, open);
    for (const s of set.said) {
      const p = crowd.find((q) => q.key === s.key) as Seen;
      const n = nudge();
      nudgeOf(set, s.key, 0, n);
      expect(s.x).toBeCloseTo(p.x + n.dx, 9);
      expect(s.y).toBeGreaterThan(1.8);
    }
    // One who is no longer drawn takes their line with them.
    const gone = set.said[0]!.key;
    stepReact(set, crowd.filter((p) => p.key !== gone), [], null, DT, 12, open);
    expect(set.said.some((s) => s.key === gone)).toBe(false);
    // And all are gone in a few seconds.
    for (let t = 0; t < 6; t += DT) stepReact(set, crowd, [], null, DT, 12, open);
    expect(set.said.length).toBe(0);
  });

  it("is placed over the speaker's head on the view, and left out behind the eye, off the screen or too far to hear", () => {
    const said = [{ key: 1, text: "Watch it!", x: 0, y: 2, z: 10, age: 1, life: 3, kind: "mean" as const }];
    const out: Caption[] = [];
    const axes = cameraAxes(0, 0, 0, restAxes());
    // Looking along +z from the origin at eye height 2: dead centre.
    captionsOf(said, 0, 2, 0, axes, 1.2, 16 / 9, out);
    expect(out.length).toBe(1);
    expect(out[0]!.x).toBeCloseTo(0.5, 9);
    expect(out[0]!.y).toBeCloseTo(0.5, 9);
    expect(out[0]!.alpha).toBe(1);
    expect(out[0]!.mean).toBe(true);
    expect(out[0]!.depth).toBeCloseTo(10, 9);
    // To the right of the view is right on the screen (the engine's right at rest is +x), and above is up.
    captionsOf([{ ...said[0]!, x: 2, y: 3 }], 0, 2, 0, axes, 1.2, 16 / 9, out);
    expect(out[0]!.x).toBeGreaterThan(0.5);
    expect(out[0]!.y).toBeLessThan(0.5);
    // Behind, far off to the side, and beyond earshot: nothing.
    expect(captionsOf([{ ...said[0]!, z: -10 }], 0, 2, 0, axes, 1.2, 16 / 9, out).length).toBe(0);
    expect(captionsOf([{ ...said[0]!, x: 40 }], 0, 2, 0, axes, 1.2, 16 / 9, out).length).toBe(0);
    expect(captionsOf([{ ...said[0]!, z: HEAR_FAR + 1 }], 0, 2, 0, axes, 1.2, 16 / 9, out).length).toBe(0);
    // Coming and going, and at the edge of earshot, it is faint.
    expect(captionsOf([{ ...said[0]!, age: 0.05 }], 0, 2, 0, axes, 1.2, 16 / 9, out)[0]!.alpha).toBeLessThan(0.5);
    expect(captionsOf([{ ...said[0]!, age: 2.95 }], 0, 2, 0, axes, 1.2, 16 / 9, out)[0]!.alpha).toBeLessThan(0.5);
    expect(captionsOf([{ ...said[0]!, z: HEAR_FAR - 2 }], 0, 2, 0, axes, 1.2, 16 / 9, out)[0]!.alpha).toBeLessThan(0.5);
  });

  it("stays finite for a frame of no time, a long one and no number, and for a person, a car or a player that is no number", () => {
    for (const dt of [0, 5, -1, NaN, Infinity]) {
      const set = newReact();
      const bad = { x: NaN, z: NaN, hx: NaN, hz: NaN, speed: NaN, slip: NaN };
      stepReact(set, [person(1, 0.4, 5), person(2, NaN, NaN)], [car(0, 0, 8), bad, { ...car(0, 0, 8), hx: 0, hz: 0 }], { x: NaN, y: NaN, z: NaN, vx: NaN, vz: NaN, onFoot: true }, dt, NaN, open);
      stepReact(set, [person(1, 0.4, 5)], [], walker(0.4, 4.6, 0, 1.4), dt, 12, open);
      const n = nudge();
      if (nudgeOf(set, 1, 0, n)) for (const v of [n.dx, n.dy, n.dz, n.yaw, n.lx, n.lz, n.lean]) expect(Number.isFinite(v), `dt ${dt}`).toBe(true);
    }
  });
});

describe("a body that is nudged", () => {
  it("is moved, lifted and turned, and leaned about its feet toward the way of the lean", () => {
    const out = new Float32Array(32);
    const n: Nudge = { dx: 1, dy: 0.2, dz: -2, yaw: 0.5, lx: 1, lz: 0, lean: 0 };
    writeNudged(out, 1, 10, 3, 20, 0.25, 1.1, n);
    // The feet, and a body turned by both yaws, at its size.
    expect([out[28], out[29], out[30]]).toEqual([11, Math.fround(3.2), 18]);
    expect(out[16 + 5]).toBeCloseTo(1.1, 6);
    expect(Math.atan2(out[16 + 8] as number, out[16 + 10] as number)).toBeCloseTo(0.75, 6);
    // Leaned 0.3 rad toward +x: the body's up tips toward +x, its feet stay, its axes keep their lengths.
    writeNudged(out, 0, 0, 0, 0, 0, 1, { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0.3 });
    expect(out[4]).toBeCloseTo(Math.sin(0.3), 6);
    expect(out[5]).toBeCloseTo(Math.cos(0.3), 6);
    expect(out[6]).toBeCloseTo(0, 6);
    expect([out[12], out[13], out[14]]).toEqual([0, 0, 0]);
    for (let col = 0; col < 3; col++) expect(Math.hypot(out[col * 4] as number, out[col * 4 + 1] as number, out[col * 4 + 2] as number)).toBeCloseTo(1, 6);
    // The axis across the lean (z) is as it was.
    expect([out[8], out[9], out[10]].map((v) => Math.round((v as number) * 1e6) / 1e6)).toEqual([0, 0, 1]);
  });
});
