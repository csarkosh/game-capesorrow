import { describe, expect, it } from "vitest";
import { DAZZLED, DAZZLED_AGAIN } from "../../src/game/peopleWords.js";
import { TORCH_ANGLE } from "../../src/game/hand/handParts.js";
import {
  DAZZLE_AFTER, DAZZLE_AGAIN_WITHIN, DAZZLE_HOLD, DAZZLE_IN, DAZZLE_LOOK, DAZZLE_MOST, DAZZLE_OUT, DAZZLE_REACH, dazzleLine, inBeam, newDazzle, shieldOf, stepDazzle, type DazzleTorch,
} from "../../src/game/town/peopleDazzle.js";
import { newReact, nudgeOf, stepReact, type Nudge, type ReactPlayer, type Seen } from "../../src/game/town/peopleReact.js";
import { captionsOf } from "../../src/game/town/speech.js";
import { restAxes } from "@csarkosh/engine/game/lite/cameraPose";

const DT = 1 / 60;
const HALF = TORCH_ANGLE / 2;
const open = (): boolean => false;
const unitOf = (x: number, y: number, z: number): { dx: number; dy: number; dz: number } => {
  const l = Math.hypot(x, y, z);
  return { dx: x / l, dy: y / l, dz: z / l };
};
/** The torch at the player's right hand, 1.35 m up, pointing +z a little down. */
const torch = (over: Partial<DazzleTorch> = {}): DazzleTorch => ({ lit: true, x: 0.16, y: 1.35, z: 0.3, ...unitOf(0, -0.05, 1), ...over });
const player: ReactPlayer = { x: 0, y: 0, z: 0, vx: 0, vz: 0, onFoot: true };
/** A person at (x, z) facing the player at the origin (yaw π faces -z). */
const person = (key: number, x: number, z: number, over: Partial<Seen> = {}): Seen => ({
  key, x, y: 0, z, yaw: Math.atan2(-x, -z), scale: 1, walking: false, seated: false, sheltered: false, partner: -1, venue: "street", ...over,
});

/** Runs the two together for `seconds`, as the town's part does each frame: the reactions, then the dazzle. */
function run(seconds: number, people: () => Seen[], t: () => DazzleTorch | null, state = { react: newReact(), dazzle: newDazzle() }, over: { inRoom?: boolean; blocked?: (x: number, z: number) => boolean; player?: ReactPlayer } = {}) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const list = people();
    const pl = over.player ?? player;
    stepReact(state.react, list, [], pl, DT, 12, over.blocked ?? open);
    stepDazzle(state.dazzle, state.react, list, t(), HALF, pl, DT, over.inRoom ?? false, over.blocked ?? open);
  }
  return state;
}

describe("who is dazzled", () => {
  const p = person(1, 0, 4);
  const at = (q: Seen, tt: DazzleTorch = torch()): boolean => inBeam(q, 0, 0, tt, HALF, player, open);

  it("is a person in the cone, near, facing the player, with a clear line", () => {
    expect(at(p)).toBe(true);
    expect(at(person(2, 0.5, 7))).toBe(true);
  });

  it("is not a person with their back to the player (a light on the back of a head)", () => {
    expect(at(person(1, 0, 4, { yaw: 0 }))).toBe(false);
    // Turned a little short of a hundred degrees round still sees it; a hundred and twenty does not.
    expect(at(person(1, 0, 4, { yaw: Math.PI - (95 * Math.PI) / 180 }))).toBe(true);
    expect(at(person(1, 0, 4, { yaw: Math.PI - (120 * Math.PI) / 180 }))).toBe(false);
  });

  it("is not a person too far, or outside the cone", () => {
    expect(at(person(1, 0, DAZZLE_REACH + 1))).toBe(false);
    expect(at(person(1, 6, 4))).toBe(false);
    expect(at(person(1, -3, -2))).toBe(false);
  });

  it("is not a person behind a wall", () => {
    expect(inBeam(p, 0, 0, torch(), HALF, player, (x, z) => Math.abs(z - 2) < 0.3 && Math.abs(x) < 3)).toBe(false);
    expect(inBeam(p, 0, 0, torch(), HALF, player, (_x, z) => z > 3.9)).toBe(true);
  });

  it("looks at the person's head, not their feet", () => {
    // A torch pointing at the ground 4 m ahead lights their feet and not their face.
    expect(at(p, torch({ ...unitOf(0, -1, 0.4) }))).toBe(false);
    expect(at(p, torch({ ...unitOf(0, -0.3, 1) }))).toBe(true);
  });
});

describe("the reaction", () => {
  it("waits for a third of a second of light, then stops, turns away, puts an arm up and says something mean", () => {
    const p = person(1, 0, 4);
    const s = run(DAZZLE_AFTER - 0.1, () => [p], () => torch());
    expect(shieldOf(s.dazzle, 1)).toBe(0);
    expect(s.react.said.length).toBe(0);
    run(0.2, () => [p], () => torch(), s);
    expect(s.react.said.length).toBe(1);
    const said = s.react.said[0]!;
    expect(said.kind).toBe("mean");
    expect(DAZZLED).toContain(said.text);
    run(DAZZLE_IN + 0.05, () => [p], () => torch(), s);
    expect(shieldOf(s.dazzle, 1)).toBe(1);
    const n: Nudge = { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 };
    expect(nudgeOf(s.react, 1, p.yaw, n)).toBe(true);
    // Turned a good way off facing the player, and a little less than away.
    expect(Math.abs(n.yaw)).toBeGreaterThan(0.5);
    expect(Math.abs(n.yaw)).toBeLessThan(1.2);
    // The line is a caption marked mean.
    const caps = captionsOf(s.react.said, 0, 1.6, 0, restAxes(), 1.4, 1.6, []);
    expect(caps.length).toBe(1);
    expect(caps[0]!.mean).toBe(true);
  });

  it("holds the pose while the light is on them and for a second after, then lowers it, looks at the player, and goes back to what they were doing", () => {
    const p = person(1, 0, 4);
    let on = true;
    const s = run(1, () => [p], () => (on ? torch() : torch({ lit: false })));
    expect(shieldOf(s.dazzle, 1)).toBe(1);
    on = false;
    run(DAZZLE_HOLD - 0.1, () => [p], () => torch({ lit: false }), s);
    expect(shieldOf(s.dazzle, 1)).toBe(1);
    run(0.2 + DAZZLE_OUT / 2, () => [p], () => torch({ lit: false }), s);
    expect(shieldOf(s.dazzle, 1)).toBeGreaterThan(0);
    expect(shieldOf(s.dazzle, 1)).toBeLessThan(1);
    run(DAZZLE_OUT, () => [p], () => torch({ lit: false }), s);
    expect(shieldOf(s.dazzle, 1)).toBe(0);
    // They look at the player (turned toward them, which for a person who faces them is no turn at all) and then are as their schedule has them.
    run(DAZZLE_LOOK + 1, () => [p], () => torch({ lit: false }), s);
    const n: Nudge = { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 };
    expect(nudgeOf(s.react, 1, p.yaw, n)).toBe(false);
    expect(s.dazzle.people.size).toBe(0);
  });

  it("stops a walker where they were and has them walk home to their path after", () => {
    // A walker going +x at 1.4 m/s, 4 m ahead of the player.
    let t = 0;
    const w = (): Seen => person(7, -2 + t * 1.4, 4, { walking: true, yaw: Math.PI / 2 + 2.6 });
    const state = { react: newReact(), dazzle: newDazzle() };
    const n: Nudge = { dx: 0, dy: 0, dz: 0, yaw: 0, lx: 1, lz: 0, lean: 0 };
    let held = 0;
    for (let i = 0; i < 90; i++) {
      t += DT;
      const list = [w()];
      stepReact(state.react, list, [], player, DT, 12, open);
      stepDazzle(state.dazzle, state.react, list, torch({ ...unitOf(0.1, -0.05, 1) }), HALF * 1.6, player, DT, false, open);
    }
    expect(shieldOf(state.dazzle, 7)).toBe(1);
    // Their body is where it was held: its place on the schedule plus the offset is the anchor, which has not moved on.
    const anchor = state.dazzle.people.get(7)!;
    const m = state.react.minds.get(7)!;
    held = w().x + m.ox;
    expect(held).toBeCloseTo(anchor.ax, 5);
    expect(nudgeOf(state.react, 7, w().yaw, n)).toBe(true);
    // After the light is gone they walk home: the offset closes to nothing within the time it takes at a walk.
    for (let i = 0; i < 60 * 12; i++) {
      t += DT;
      const list = [w()];
      stepReact(state.react, list, [], player, DT, 12, open);
      stepDazzle(state.dazzle, state.react, list, torch({ lit: false }), HALF, player, DT, false, open);
    }
    expect(Math.hypot(m.ox, m.oz)).toBeLessThan(1e-6);
    expect(shieldOf(state.dazzle, 7)).toBe(0);
  });

  it("goes straight to the pose, ruder, when dazzled again within a few seconds", () => {
    const p = person(1, 0, 4);
    let on = true;
    const s = run(1, () => [p], () => (on ? torch() : torch({ lit: false })));
    const first = s.react.said[0]!.text;
    expect(DAZZLED).toContain(first);
    on = false;
    run(DAZZLE_HOLD + DAZZLE_OUT + 0.3, () => [p], () => torch({ lit: false }), s);
    expect(shieldOf(s.dazzle, 1)).toBe(0);
    // Dazzled again: no third of a second's wait.
    on = true;
    run(2 * DT, () => [p], () => torch(), s);
    expect(shieldOf(s.dazzle, 1)).toBeGreaterThan(0);
    expect(DAZZLED_AGAIN).toContain(s.react.said[0]!.text);
  });

  it("is not ruder, and waits, when it has been long since", () => {
    const p = person(1, 0, 4);
    let on = true;
    const s = run(0.8, () => [p], () => (on ? torch() : torch({ lit: false })));
    on = false;
    run(DAZZLE_HOLD + DAZZLE_OUT + DAZZLE_LOOK + DAZZLE_AGAIN_WITHIN + 1, () => [p], () => torch({ lit: false }), s);
    on = true;
    run(2 * DT, () => [p], () => torch(), s);
    expect(shieldOf(s.dazzle, 1)).toBe(0);
    run(DAZZLE_AFTER + 0.1, () => [p], () => torch(), s);
    expect(DAZZLED).toContain(s.react.said[0]!.text);
  });
});

describe("who does not react", () => {
  const p = person(1, 0, 4);
  it("nobody, with the lamp off, or from the car's lamps (the torch is unlit with the player seated), or the player not on foot", () => {
    expect(shieldOf(run(2, () => [p], () => torch({ lit: false })).dazzle, 1)).toBe(0);
    expect(shieldOf(run(2, () => [p], () => null).dazzle, 1)).toBe(0);
    expect(shieldOf(run(2, () => [p], () => torch(), undefined, { player: { ...player, onFoot: false } }).dazzle, 1)).toBe(0);
  });

  it("a person in a shop seen through its glass, but a person in a room the player is in", () => {
    const inShop = person(1, 0, 4, { sheltered: true });
    expect(shieldOf(run(2, () => [inShop], () => torch()).dazzle, 1)).toBe(0);
    expect(shieldOf(run(2, () => [inShop], () => torch(), undefined, { inRoom: true }).dazzle, 1)).toBe(1);
  });

  it("a person on another floor", () => {
    expect(shieldOf(run(2, () => [person(1, 0, 4, { y: 5 })], () => torch()).dazzle, 1)).toBe(0);
  });

  it("more than the nearest few", () => {
    const crowd = [1, 2, 3, 4, 5, 6].map((k) => person(k, (k - 3.5) * 0.35, 3 + k * 0.3));
    const s = run(2, () => crowd, () => torch());
    const shielding = crowd.filter((c) => shieldOf(s.dazzle, c.key) > 0).length;
    expect(shielding).toBe(DAZZLE_MOST);
    // The nearest are the ones.
    expect(shieldOf(s.dazzle, 1)).toBe(1);
    expect(shieldOf(s.dazzle, 6)).toBe(0);
  });
});

describe("the words", () => {
  const banned = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt", "slut", "whore", "nigg", "fag", "retard", "cripple", "spaz", "anthropic", "claude", "openai", "goo" + "gle", "meta", "amazon"];
  it("are many: at least sixteen, with some for a first time and some for a repeat", () => {
    expect(DAZZLED.length).toBeGreaterThanOrEqual(10);
    expect(DAZZLED_AGAIN.length).toBeGreaterThanOrEqual(6);
    expect(new Set([...DAZZLED, ...DAZZLED_AGAIN]).size).toBeGreaterThanOrEqual(16);
    expect(DAZZLED_AGAIN).toContain("Again? Seriously?");
    expect(DAZZLED).toContain("Hey! Get that out of my face!");
  });

  it("are short, plain, and have no banned word", () => {
    for (const line of [...DAZZLED, ...DAZZLED_AGAIN]) {
      expect(line.length).toBeLessThan(60);
      for (const b of banned) expect(line.toLowerCase(), line).not.toContain(b);
    }
  });

  it("are not the same for two people at one moment, and are chosen by a hash of the person and the moment", () => {
    const set = newReact();
    const a = dazzleLine(set, 1, 1, false, 5);
    expect(dazzleLine(set, 1, 1, false, 5)).toBe(a);
    // Two people at once: the second is not given what the first is saying.
    set.said.push({ key: 1, text: a, x: 0, y: 0, z: 0, age: 0, life: 3, kind: "mean" });
    for (let k = 2; k < 60; k++) expect(dazzleLine(set, k, 1, false, 5)).not.toBe(a);
    // Over many people and moments, most of the table is used.
    const used = new Set<string>();
    for (let k = 1; k < 80; k++) used.add(dazzleLine(newReact(), k, 1, false, k * 3));
    expect(used.size).toBeGreaterThanOrEqual(DAZZLED.length - 3);
  });

  it("are said by two people dazzled in one frame, not alike", () => {
    const crowd = [person(1, -0.3, 4), person(2, 0.3, 4.2)];
    const s = run(1, () => crowd, () => torch());
    expect(s.react.said.length).toBe(2);
    expect(s.react.said[0]!.text).not.toBe(s.react.said[1]!.text);
  });
});
