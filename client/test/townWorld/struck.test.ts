import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { CAR_CIRCLES, CAR_RADIUS } from "../../src/sim/car/body.js";
import { MARK_DARK, markGeometry } from "../../src/game/town/damageParts.js";
import {
  HIT_BRAKING, HIT_LEAST, MARKS_MOST, MARK_CLOSE, MARK_LARGE, MARK_OFF, MARK_SECONDS, MARK_SMALL, MARK_UP, ROCK_MOST, SHOVED_MOST, SHOVE_BACK, SHOVE_BLOW, SHOVE_MARGIN, SHOVE_MOST,
  SHOVE_SECONDS, markMatrices, newStruck, rockOf, shoveMove, stepStruck, struckBy, struckMoves, struckSolids, type Solid, type StruckCar,
} from "../../src/game/town/struck.js";
import { knockMatrix, type KnockMove } from "../../src/game/town/townMaterial.js";
import { WORLD_SEEDS, planFor } from "./world.js";

const DT = 1 / 60;
const solid = (id: number, kind: Solid["kind"], x: number, z: number, hu: number, hv: number, ux = 1, uz = 0): Solid => ({ id, kind, x, z, ux, uz, hu, hv, vehicle: null });
/** A wall across the road at z = 10 (its near face), 20 m wide and 6 deep; a dumpster and a parked vehicle elsewhere. */
const WALL = solid(0, "building", 0, 13, 10, 3);
const DUMPSTER = solid(1, "dumpster", 100, 10.65, 0.95, 0.65);
const PARKED = solid(2, "vehicle", 200, 10.9, 2.25, 0.9);
const SOLIDS = [WALL, DUMPSTER, PARKED];
/** A car heading +z whose front circle stands `gap` short of touching a face at z = 10. */
const nose = (x: number, speed: number, gap = 0.001): StruckCar => ({ id: 1, x, y: 2, z: 10 - gap - CAR_RADIUS - (CAR_CIRCLES[2] as number), hx: 0, hz: 1, speed, slip: 0 });

/** Drives a car into a face: a frame going `speed`, a frame stopped against it, and the frame after, on which the blow lands. */
function strike(set: ReturnType<typeof newStruck>, x: number, speed: number, solids: readonly Solid[] = SOLIDS): number {
  stepStruck(set, solids, [nose(x, speed, 0.2)], DT);
  stepStruck(set, solids, [nose(x, 0)], DT);
  return stepStruck(set, solids, [nose(x, 0)], DT).length;
}

describe("what a car has struck", () => {
  it("is the solid a circle of its body is against and was moving into, and nothing for a car that brakes, grazes or stops in the open", () => {
    const blow = struckBy(SOLIDS, nose(3, 0), 0, 1, 6);
    expect(blow?.solid).toBe(WALL);
    // Where the front circle met the wall's face, the face looking back at the car.
    expect(blow?.x).toBeCloseTo(3, 9);
    expect(blow?.z).toBeCloseTo(10, 9);
    expect([blow?.nx, blow?.nz]).toEqual([0, -1]);
    // Half a metre short of it: not touching.
    expect(struckBy(SOLIDS, nose(3, 0, 0.5), 0, 1, 6)).toBeNull();
    // Against it but going along it, or away from it: not into it.
    expect(struckBy(SOLIDS, nose(3, 0), 1, 0, 6)).toBeNull();
    expect(struckBy(SOLIDS, nose(3, 0), 0, -1, 6)).toBeNull();
    // A car of no heading struck nothing.
    expect(struckBy(SOLIDS, { ...nose(3, 0), hx: 0, hz: 0 }, 0, 1, 6)).toBeNull();
    const set = newStruck();
    // The hardest braking the car has, against the wall, is no blow.
    stepStruck(set, SOLIDS, [nose(3, 6)], DT);
    for (let v = 6; v > 0; v -= (HIT_BRAKING - 2) * DT) expect(stepStruck(set, SOLIDS, [nose(3, Math.max(v, 0))], DT).length).toBe(0);
    // A stop in the open is no blow on anything.
    stepStruck(set, SOLIDS, [{ ...nose(3, 9), z: -50 }], DT);
    stepStruck(set, SOLIDS, [{ ...nose(3, 0), z: -50 }], DT);
    expect(stepStruck(set, SOLIDS, [{ ...nose(3, 0), z: -50 }], DT).length).toBe(0);
    expect(set.marks.length).toBe(0);
  });

  it("leaves a mark on a wall where the car met it, at the bumper's height, a little off the face, larger the harder the blow", () => {
    const set = newStruck();
    expect(strike(set, 3, 9)).toBe(1);
    expect(set.marks.length).toBe(1);
    const m = set.marks[0]!;
    expect(m.solid).toBe(WALL.id);
    expect(m.x).toBeCloseTo(3, 9);
    expect(m.z).toBeCloseTo(10 - MARK_OFF, 9);
    expect(m.y).toBeCloseTo(2 + MARK_UP, 9);
    expect([m.nx, m.nz]).toEqual([0, -1]);
    expect(m.size).toBeGreaterThan(MARK_SMALL);
    expect(m.size).toBeLessThanOrEqual(MARK_LARGE);
    // A building is not shoved.
    expect(set.shoves.length).toBe(0);
    const soft = newStruck();
    strike(soft, 3, 2.2);
    expect(soft.marks[0]!.size).toBeLessThan(m.size);
    expect(soft.marks[0]!.size).toBeGreaterThanOrEqual(MARK_SMALL);
    // Under the least blow, no mark.
    const least = newStruck();
    expect(strike(least, 3, HIT_LEAST + HIT_BRAKING * DT - 0.05)).toBe(0);
    expect(least.marks.length).toBe(0);
  });

  it("lands one blow for a stop that is drawn over two frames or three, as hard as the whole of it", () => {
    // 9 m/s lost at once, and the same lost in three frames: one mark each, of one size.
    const once = newStruck();
    strike(once, 3, 9);
    const spread = newStruck();
    stepStruck(spread, SOLIDS, [nose(3, 9, 0.3)], DT);
    let blows = 0;
    for (const v of [6, 3, 0, 0, 0]) blows += stepStruck(spread, SOLIDS, [nose(3, v, v > 0 ? 0.1 : 0.001)], DT).length;
    expect(blows).toBe(1);
    expect(spread.marks.length).toBe(1);
    expect(spread.hits).toBe(1);
    // The spread stop gives up three frames' braking where the other gives up one: nearly as hard.
    expect(spread.marks[0]!.size).toBeGreaterThan(once.marks[0]!.size - 0.15);
    expect(spread.marks[0]!.size).toBeLessThanOrEqual(once.marks[0]!.size);
  });

  it("lasts a while, then closes up and is gone; and holds no more than there is room for", () => {
    const set = newStruck();
    strike(set, 3, 9);
    const out = new Float32Array(MARKS_MOST * 16);
    const size = (): number => Math.hypot(out[0] as number, out[1] as number, out[2] as number);
    expect(markMatrices(set, SOLIDS, out)).toBe(1);
    const full = size();
    expect(full).toBeCloseTo(set.marks[0]!.size, 5);
    for (let t = 0; t < MARK_SECONDS - 1; t += 0.5) stepStruck(set, SOLIDS, [], 0.5);
    markMatrices(set, SOLIDS, out);
    expect(size()).toBeCloseTo(full, 5);
    for (let t = 0; t < 1 + MARK_CLOSE / 2; t += 0.25) stepStruck(set, SOLIDS, [], 0.25);
    markMatrices(set, SOLIDS, out);
    expect(size()).toBeLessThan(full * 0.8);
    expect(size()).toBeGreaterThan(0);
    for (let t = 0; t < MARK_CLOSE; t += 0.25) stepStruck(set, SOLIDS, [], 0.25);
    expect(set.marks.length).toBe(0);
    expect(markMatrices(set, SOLIDS, out)).toBe(0);
    // More blows than there is room for marks: the oldest go.
    const many = newStruck();
    for (let i = 0; i < MARKS_MOST + 3; i++) strike(many, -8 + i * 0.8, 9);
    expect(many.marks.length).toBe(MARKS_MOST);
    expect(many.marks[0]!.x).toBeCloseTo(-8 + 3 * 0.8, 9);
    expect(markMatrices(many, SOLIDS, new Float32Array(4 * 16))).toBe(4);
  });

  it("lays a mark flat on the face: its right along the face, its up up, its out the face's own, turned a little in the face's plane", () => {
    const set = newStruck();
    strike(set, 3, 9);
    const out = new Float32Array(16);
    markMatrices(set, SOLIDS, out);
    const m = set.marks[0]!;
    // The third column is the way out of the face, a unit, level.
    expect([out[8], out[9], out[10]]).toEqual([0, 0, -1]);
    // The first two are in the face's plane (no part along its normal), at right angles, each the mark's size long.
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[6]).toBeCloseTo(0, 6);
    expect((out[0] as number) * (out[4] as number) + (out[1] as number) * (out[5] as number)).toBeCloseTo(0, 5);
    expect(Math.hypot(out[0] as number, out[1] as number)).toBeCloseTo(m.size, 5);
    expect(Math.hypot(out[4] as number, out[5] as number)).toBeCloseTo(m.size, 5);
    // Its right is the reader's right of a face that looks toward -z, which is -x... turned by no more than its spin.
    expect(Math.abs(m.spin)).toBeLessThanOrEqual(0.45);
    expect(out[0] as number).toBeGreaterThan(0.5 * m.size);
    expect([out[12], out[13], out[14], out[15]].map((v) => Math.round((v as number) * 1e5) / 1e5)).toEqual([3, 2 + MARK_UP, 10 - MARK_OFF, 1]);
  });

  it("shoves a dumpster and a parked vehicle the way the car was going, further the harder the blow, and no further than their most", () => {
    for (const thing of [DUMPSTER, PARKED]) {
      const set = newStruck();
      expect(strike(set, thing.x, 4)).toBe(1);
      expect(set.shoves.length).toBe(1);
      const s = set.shoves[0]!;
      expect(s.solid).toBe(thing.id);
      // Along +z, the way the car went.
      expect(s.sx).toBeCloseTo(0, 9);
      expect(s.sz).toBeGreaterThan(0.03);
      expect(s.sz).toBeLessThanOrEqual(SHOVE_BLOW);
      const hard = newStruck();
      strike(hard, thing.x, 9.5);
      expect(hard.shoves[0]!.sz).toBeGreaterThan(s.sz);
      // Struck again and again: it goes no further than its most, and it is still one shove.
      for (let i = 0; i < 8; i++) strike(hard, thing.x, 9.5);
      expect(hard.shoves.length).toBe(1);
      expect(Math.hypot(hard.shoves[0]!.sx, hard.shoves[0]!.sz)).toBeCloseTo(SHOVE_MOST, 9);
      // And it is marked, on the side that was struck.
      expect(set.marks[0]!.solid).toBe(thing.id);
      expect(set.marks[0]!.nz).toBe(-1);
    }
  });

  it("rocks a shoved thing away from the blow and back, dying out in a second or so", () => {
    const set = newStruck();
    strike(set, DUMPSTER.x, 9);
    const s = set.shoves[0]!;
    expect(rockOf(s)).toBe(0);
    const angles: number[] = [];
    for (let t = 0; t < 2; t += DT) {
      stepStruck(set, SOLIDS, [], DT);
      angles.push(rockOf(s));
    }
    // Away first (a lean toward the way of the blow), then back past upright, and within its most.
    expect(Math.max(...angles.slice(0, 12))).toBeGreaterThan(0.02);
    expect(Math.min(...angles)).toBeLessThan(-0.005);
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(ROCK_MOST);
    expect(Math.abs(angles[angles.length - 1]!)).toBeLessThan(0.001);
  });

  it("hands the vertex stage a shoved thing as its box, a little wider, leaning about its middle and slid", () => {
    const set = newStruck();
    strike(set, DUMPSTER.x, 9);
    stepStruck(set, SOLIDS, [], 0.1);
    const moves: KnockMove[] = [];
    expect(struckMoves(set, SOLIDS, moves)).toBe(moves);
    expect(moves.length).toBe(1);
    const m = moves[0]!;
    expect([m.x, m.z, m.y]).toEqual([DUMPSTER.x, DUMPSTER.z, 2]);
    expect([m.ux, m.uz, m.hu, m.hv]).toEqual([1, 0, DUMPSTER.hu + SHOVE_MARGIN, DUMPSTER.hv + SHOVE_MARGIN]);
    expect(m.edge).toBe(0);
    expect([m.dx, m.dz]).toEqual([0, 1]);
    expect(m.angle).toBeCloseTo(rockOf(set.shoves[0]!), 12);
    expect(m.sz).toBeCloseTo(set.shoves[0]!.sz, 12);
    // The same record is what a model is moved by.
    expect(shoveMove(set.shoves[0]!, DUMPSTER)).toEqual(m);
  });

  it("stays where it was shoved for a while, then eases back to where the world has it, and a mark on it moves with it", () => {
    const set = newStruck();
    strike(set, PARKED.x, 9);
    const far = set.shoves[0]!.sz;
    const out = new Float32Array(16);
    const moves: KnockMove[] = [];
    // The rock over: slid, upright. Its mark has moved with it by the slide.
    for (let t = 0; t < 3; t += DT) stepStruck(set, SOLIDS, [], DT);
    markMatrices(set, SOLIDS, out);
    expect(out[14]).toBeCloseTo(10 - MARK_OFF + far, 3);
    expect(struckMoves(set, SOLIDS, moves)[0]!.sz).toBeCloseTo(far, 9);
    // Still there near the end of its time.
    for (let t = 3; t < SHOVE_SECONDS - 1; t += 0.5) stepStruck(set, SOLIDS, [], 0.5);
    moves.length = 0;
    expect(struckMoves(set, SOLIDS, moves)[0]!.sz).toBeCloseTo(far, 9);
    // Easing back: each step nearer home, never further, and then it is forgotten.
    let last = far;
    for (let t = 0; t < 1.5 + SHOVE_BACK && set.shoves.length > 0; t += DT) {
      stepStruck(set, SOLIDS, [], DT);
      moves.length = 0;
      const now = struckMoves(set, SOLIDS, moves)[0]?.sz ?? 0;
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      last = now;
    }
    expect(set.shoves.length).toBe(0);
    expect(last).toBeLessThan(far * 0.02);
  });

  it("is pushed on from where it has got to when struck on its way home, and holds no more shoved things than there is room for", () => {
    const set = newStruck();
    strike(set, DUMPSTER.x, 9);
    for (let t = 0; t < SHOVE_SECONDS + SHOVE_BACK / 2; t += 0.25) stepStruck(set, SOLIDS, [], 0.25);
    const moves: KnockMove[] = [];
    const before = struckMoves(set, SOLIDS, moves)[0]!.sz;
    expect(set.shoves[0]!.back).toBeGreaterThan(0);
    strike(set, DUMPSTER.x, 3);
    expect(set.shoves[0]!.back).toBe(0);
    moves.length = 0;
    const after = struckMoves(set, SOLIDS, moves)[0]!.sz;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before + SHOVE_BLOW + 1e-9);
    // Five dumpsters struck in turn: four are shoved, the first has been put back.
    const row = Array.from({ length: SHOVED_MOST + 1 }, (_, i) => solid(i, "dumpster", i * 30, 10.65, 0.95, 0.65));
    const many = newStruck();
    for (const d of row) strike(many, d.x, 9, row);
    expect(many.shoves.map((q) => q.solid)).toEqual(row.slice(1).map((d) => d.id));
  });

  it("takes no blow from a car put somewhere, from the first frame a car is seen, or from a frame of no time", () => {
    const set = newStruck();
    // Seen for the first time already stopped against the wall.
    expect(stepStruck(set, SOLIDS, [nose(3, 0)], DT).length).toBe(0);
    expect(stepStruck(set, SOLIDS, [nose(3, 0)], DT).length).toBe(0);
    // Gone for a frame, then back at rest against it after having been fast.
    stepStruck(set, SOLIDS, [nose(3, 9, 0.2)], DT);
    stepStruck(set, SOLIDS, [], DT);
    stepStruck(set, SOLIDS, [nose(3, 0)], DT);
    expect(stepStruck(set, SOLIDS, [nose(3, 0)], DT).length).toBe(0);
    for (const dt of [0, -1, NaN]) {
      stepStruck(set, SOLIDS, [nose(3, 9, 0.2)], DT);
      stepStruck(set, SOLIDS, [nose(3, 0)], dt);
      expect(stepStruck(set, SOLIDS, [nose(3, 0)], DT).length, `dt ${dt}`).toBe(0);
    }
    expect(set.marks.length).toBe(0);
    // And nothing is left not a number by a car that is none, or ground that is none.
    stepStruck(set, SOLIDS, [{ id: 1, x: NaN, y: NaN, z: NaN, hx: NaN, hz: NaN, speed: NaN, slip: NaN }], DT);
    stepStruck(set, SOLIDS, [{ ...nose(DUMPSTER.x, 9, 0.2), y: NaN }], DT);
    stepStruck(set, SOLIDS, [{ ...nose(DUMPSTER.x, 0), y: NaN }], DT);
    stepStruck(set, SOLIDS, [{ ...nose(DUMPSTER.x, 0), y: NaN }], DT);
    expect(set.marks.length).toBe(1);
    const out = new Float32Array(MARKS_MOST * 16);
    const n = markMatrices(set, SOLIDS, out);
    for (let i = 0; i < n * 16; i++) expect(Number.isFinite(out[i] as number)).toBe(true);
    for (const m of struckMoves(set, SOLIDS, [])) for (const v of [m.x, m.z, m.y, m.angle, m.sx, m.sz]) expect(Number.isFinite(v)).toBe(true);
  });

  it("moves a mark on a shoved thing by the same matrix the thing is moved by", () => {
    const set = newStruck();
    strike(set, DUMPSTER.x, 9);
    stepStruck(set, SOLIDS, [], 0.08);
    const s = set.shoves[0]!;
    const m = set.marks[0]!;
    const k = knockMatrix(shoveMove(s, DUMPSTER), new Float32Array(16));
    const out = new Float32Array(16);
    markMatrices(set, SOLIDS, out);
    const moved = [
      (k[0] as number) * m.x + (k[4] as number) * m.y + (k[8] as number) * m.z + (k[12] as number),
      (k[1] as number) * m.x + (k[5] as number) * m.y + (k[9] as number) * m.z + (k[13] as number),
      (k[2] as number) * m.x + (k[6] as number) * m.y + (k[10] as number) * m.z + (k[14] as number),
    ];
    expect(out[12]).toBeCloseTo(moved[0] as number, 4);
    expect(out[13]).toBeCloseTo(moved[1] as number, 4);
    expect(out[14]).toBeCloseTo(moved[2] as number, 4);
    // Rocking: the mark's way out is no longer level.
    expect(Math.abs(out[9] as number)).toBeGreaterThan(1e-4);
  });
});

describe("the solids of a town that take a mark", () => {
  it("are its buildings, its dumpsters and the parked vehicles the ground holds, each a box in the world", () => {
    const seed = WORLD_SEEDS[0] as number;
    const solids = struckSolids(seed);
    expect(struckSolids(seed)).toBe(solids);
    const plan = planFor(seed);
    const of = (kind: Solid["kind"]): Solid[] => solids.filter((q) => q.kind === kind);
    expect(of("building").length).toBeGreaterThan(50);
    expect(of("dumpster").length).toBeGreaterThan(0);
    expect(of("dumpster").length).toBeLessThanOrEqual(plan.props.bins.filter((b) => b.kind === "dumpster").length);
    expect(of("vehicle").length).toBeGreaterThan(20);
    expect(of("vehicle").length).toBeLessThanOrEqual(plan.props.vehicles.length);
    solids.forEach((q, i) => {
      expect(q.id).toBe(i);
      expect(Math.hypot(q.ux, q.uz)).toBeCloseTo(1, 6);
      expect(q.hu).toBeGreaterThan(0);
      expect(q.hv).toBeGreaterThan(0);
      expect(q.vehicle === null).toBe(q.kind !== "vehicle");
    });
    for (const d of of("dumpster")) expect([d.hu, d.hv]).toEqual([0.95, 0.65]);
  }, timeLimit(120_000));
});

describe("the mark of damage", () => {
  it("is a flat shape one unit across facing out of the face, dark at its middle and gone at its edges", () => {
    const g = markGeometry();
    const n = g.positions.length / 3;
    expect(n).toBeGreaterThan(40);
    expect(g.normals.length).toBe(n * 3);
    expect(g.colors.length).toBe(n * 4);
    expect(g.indices.length % 3).toBe(0);
    let most = 0;
    let dark = 0;
    let light = 0;
    for (let v = 0; v < n; v++) {
      expect(g.positions[v * 3 + 2]).toBe(0);
      expect([g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]]).toEqual([0, 0, 1]);
      const r = Math.hypot(g.positions[v * 3] as number, g.positions[v * 3 + 1] as number);
      const a = g.colors[v * 4 + 3] as number;
      most = Math.max(most, r);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      // Whatever is past its bruise and its chips has faded away: a crack's tip, a scrape's end.
      if (r > 0.43) expect(a).toBe(0);
      const pale = (g.colors[v * 4] as number) > 0.5;
      if (a > 0.5 && pale) light++;
      if (a > 0.5 && !pale) dark++;
    }
    expect(most).toBeGreaterThan(0.4);
    expect(most).toBeLessThanOrEqual(0.56);
    // Dark and pale both, so it shows on a dark wall and on a pale one: the bruise's middle, and the cracks' roots, the scrapes' middles and the chips.
    expect(dark).toBe(1);
    expect(light).toBeGreaterThan(40);
    expect([g.colors[0], g.colors[1], g.colors[2]]).toEqual([...MARK_DARK].map(Math.fround));
    for (const i of g.indices) expect(i).toBeLessThan(n);
    // The same every time: it is drawn from counts, not from chance.
    expect(markGeometry().positions).toEqual(g.positions);
  });
});
