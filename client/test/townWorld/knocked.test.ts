import { describe, expect, it } from "vitest";
import { knockGrid, knockableAt, type KnockBox, type KnockKind, type Knockable } from "../../src/sim/town/knockables.js";
import { BOX_MARGIN, DOWN_MOST, DOWN_SECONDS, FALL_SECONDS, KNOCK_SHAPE, RISE_SECONDS, fallenBy, knockMoves, newKnocked, stepKnocked, tipEdge, turnedBox, type Down, type KnockCar } from "../../src/game/town/knocked.js";
import { KNOCK_UNPAINT, KNOCK_VERTEX, MAX_KNOCKED, emptyTownReady, knockMatrix, townSurfacePlugin, writeKnocked, type KnockMove } from "../../src/game/town/townMaterial.js";

const DT = 1 / 60;
const thing = (id: number, kind: KnockKind, x: number, z: number, box?: KnockBox): Knockable => knockableAt(id, kind, x, z, box);
const flat = (): number => 3;
/** A car heading +z at (x, z). */
const car = (x: number, z: number, speed: number, slip = 0): KnockCar => ({ x, z, hx: 0, hz: 1, speed, slip });
const NONE: KnockCar[] = [];

describe("what the cars have knocked down, as it is drawn", () => {
  it("lays down a thing a moving car's body touches, away from the car, and not one beside the car or under a car that stands", () => {
    const grid = knockGrid([thing(0, "stop", 0, 2), thing(1, "trash can", 5, 0), thing(2, "cart", 0, -2)]);
    const set = newKnocked();
    expect(stepKnocked(set, grid, [car(0, 0, 8)], DT, flat)).toBe(2);
    expect(set.list.map((d) => d.id).sort()).toEqual([0, 2]);
    const d = set.list.find((q) => q.id === 0) as Down;
    // The car goes +z: so does the sign, from the ground it stands on.
    expect(d.dz).toBeCloseTo(1, 6);
    expect(d.dx).toBeCloseTo(0, 6);
    expect(d.y).toBe(3);
    expect([d.x, d.z, d.kind]).toEqual([0, 2, "stop"]);
    // The same car, standing: nothing.
    const still = newKnocked();
    expect(stepKnocked(still, grid, [car(0, 0, 0)], DT, flat)).toBe(0);
    expect(stepKnocked(still, grid, [car(0, 0, 0.3)], DT, flat)).toBe(0);
    expect(still.list.length).toBe(0);
  });

  it("throws a thing met at the car's side off to that side, and one met by a sliding car the way the car slides", () => {
    // The heading is +z, so its right is +x.
    const grid = knockGrid([thing(0, "stop", 0.8, 0), thing(1, "stop", -0.8, 0)]);
    const set = newKnocked();
    stepKnocked(set, grid, [car(0, 0, 8)], DT, flat);
    const right = set.list.find((q) => q.id === 0) as Down;
    const left = set.list.find((q) => q.id === 1) as Down;
    expect(right.dx).toBeGreaterThan(0.3);
    expect(left.dx).toBeLessThan(-0.3);
    expect(right.dz).toBeGreaterThan(0.5);
    for (const d of set.list) expect(Math.hypot(d.dx, d.dz)).toBeCloseTo(1, 9);
    // Sliding to its right with no speed along its heading: what is dead ahead of the slide falls to +x.
    const slid = newKnocked();
    stepKnocked(slid, knockGrid([thing(0, "stop", 0, 0)]), [car(0, 0, 0, 6)], DT, flat);
    expect((slid.list[0] as Down).dx).toBeCloseTo(1, 6);
  });

  it("falls quickening to its rest, lies there, and stands back up eased when its time is up", () => {
    const grid = knockGrid([thing(0, "trash can", 0, 0)]);
    const set = newKnocked();
    stepKnocked(set, grid, [car(0, 0, 8)], DT, flat);
    const d = set.list[0] as Down;
    const rest = KNOCK_SHAPE["trash can"].rest;
    expect(fallenBy(d)).toBe(0);
    const angles: number[] = [];
    for (let t = 0; t < FALL_SECONDS + 0.1; t += DT) {
      stepKnocked(set, grid, NONE, DT, flat);
      angles.push(fallenBy(d));
    }
    // Never back, and faster as it goes: the second half of the fall covers more than the first.
    for (let i = 1; i < angles.length; i++) expect(angles[i] as number).toBeGreaterThanOrEqual(angles[i - 1] as number);
    const half = angles[Math.floor((FALL_SECONDS / DT) / 2)] as number;
    expect(half).toBeLessThan(rest * 0.4);
    expect(angles[angles.length - 1]).toBeCloseTo(rest, 9);
    // Lying.
    for (let t = 0; t < DOWN_SECONDS - 0.5; t += DT) stepKnocked(set, grid, NONE, DT, flat);
    expect(set.list.length).toBe(1);
    expect(fallenBy(d)).toBeCloseTo(rest, 9);
    // Up again: eased at both ends, and then it is forgotten.
    const rising: number[] = [];
    for (let t = 0; t < RISE_SECONDS + 0.7 && set.list.length > 0; t += DT) {
      stepKnocked(set, grid, NONE, DT, flat);
      if (d.rising > 0) rising.push(fallenBy(d));
    }
    expect(set.list.length).toBe(0);
    expect(rising.length).toBeGreaterThan(RISE_SECONDS / DT - 3);
    for (let i = 1; i < rising.length; i++) expect(rising[i] as number).toBeLessThanOrEqual(rising[i - 1] as number);
    expect(rising[0] as number).toBeGreaterThan(rest * 0.99);
    expect(rising[rising.length - 1] as number).toBeLessThan(rest * 0.01);
  });

  it("does not stand up under a car, and goes back down if a car runs over it as it gets up", () => {
    const grid = knockGrid([thing(0, "mailbox", 0, 0)]);
    const set = newKnocked();
    stepKnocked(set, grid, [car(0, 0, 8)], DT, flat);
    // A car parked on it: past its time, it still lies.
    for (let t = 0; t < FALL_SECONDS + DOWN_SECONDS + 5; t += DT) stepKnocked(set, grid, [car(0, 0, 0)], DT, flat);
    expect(set.list.length).toBe(1);
    expect((set.list[0] as Down).rising).toBe(0);
    // The car gone, it begins to rise; run over half way, it is down again, with no jump of more than a step's worth.
    for (let t = 0; t < RISE_SECONDS / 2; t += DT) stepKnocked(set, grid, NONE, DT, flat);
    const d = set.list[0] as Down;
    expect(d.rising).toBeGreaterThan(0);
    expect(stepKnocked(set, grid, [car(0, 0, 8)], DT, flat)).toBe(0);
    expect(d.rising).toBe(0);
    expect(fallenBy(d)).toBeCloseTo(KNOCK_SHAPE.mailbox.rest, 9);
    expect(set.list.length).toBe(1);
  });

  it("holds no more than the vertex stage has room for: one more, and the one that has lain longest stands", () => {
    const things = Array.from({ length: DOWN_MOST + 2 }, (_, i) => thing(i, "stop", i * 20, 0));
    const grid = knockGrid(things);
    const set = newKnocked();
    for (let i = 0; i < things.length; i++) {
      stepKnocked(set, grid, [car(i * 20, 0, 8)], DT, flat);
      expect(set.list.length).toBeLessThanOrEqual(DOWN_MOST);
    }
    expect(set.list.length).toBe(DOWN_MOST);
    expect(DOWN_MOST).toBeLessThan(MAX_KNOCKED);
    expect(set.list.map((d) => d.id)).toEqual(things.slice(2).map((k) => k.id));
  });

  it("stays finite for a frame of 0 s, of 5 s and of no number, and for a car that is no number or has no heading", () => {
    const grid = knockGrid([thing(0, "drum", 0, 0)]);
    for (const dt of [0, 5, -1, NaN, Infinity]) {
      const set = newKnocked();
      stepKnocked(set, grid, [car(0, 0, 8)], dt, () => NaN);
      stepKnocked(set, grid, [{ x: NaN, z: NaN, hx: NaN, hz: NaN, speed: NaN, slip: NaN }, { x: 0, z: 0, hx: 0, hz: 0, speed: 9, slip: 0 }], dt, flat);
      stepKnocked(set, grid, NONE, dt, flat);
      for (const m of knockMoves(set, [])) for (const v of [m.x, m.z, m.y, m.dx, m.dz, m.angle, m.edge, m.ux, m.uz, m.hu, m.hv, m.sx, m.sz]) expect(Number.isFinite(v), `dt ${dt}`).toBe(true);
    }
  });

  it("hands the vertex stage each thing's centre, ground, way, angle, edge and box, and how many there are", () => {
    const grid = knockGrid([thing(0, "trash can", 4, 6), thing(1, "stop", 40, 6)]);
    const set = newKnocked();
    stepKnocked(set, grid, [car(4, 6, 8), car(40, 6, 8)], DT, flat);
    for (let t = 0; t < 1; t += DT) stepKnocked(set, grid, NONE, DT, flat);
    const moves: KnockMove[] = [];
    expect(knockMoves(set, moves)).toBe(moves);
    expect(moves.length).toBe(2);
    const ready = emptyTownReady();
    expect(ready.townKnocked).toEqual([0]);
    writeKnocked(ready, moves);
    expect(ready.townKnocked).toEqual([2]);
    const can = KNOCK_SHAPE["trash can"];
    expect(ready.knockA0).toEqual([4, 6, 3, 0]);
    expect(ready.knockB0?.[0]).toBeCloseTo(0, 6);
    expect(ready.knockB0?.[1]).toBeCloseTo(1, 6);
    expect(ready.knockB0?.[2]).toBeCloseTo(can.rest, 9);
    expect(ready.knockB0?.[3]).toBe(can.edge);
    // A round thing's box is a square its reach each way; nothing knocked down is slid.
    expect(ready.knockC0).toEqual([1, 0, can.reach, can.reach]);
    expect(ready.knockD0).toEqual([0, 0, 0, 0]);
    expect(ready.knockA1?.[0]).toBe(40);
    // No more than there is room for, and none when all have stood.
    writeKnocked(ready, Array.from({ length: MAX_KNOCKED + 3 }, () => moves[0] as KnockMove));
    expect(ready.townKnocked).toEqual([MAX_KNOCKED]);
    writeKnocked(ready, []);
    expect(ready.townKnocked).toEqual([0]);
  });

  it("turns a long thing as its own box, a little wider, over whichever of its edges is toward the fall", () => {
    // A bench lying along x: 0.85 m to each end, 0.3 m front and back.
    const bench = thing(0, "bench", 0, 0, { ux: 1, uz: 0, hu: 0.85, hv: 0.3 });
    expect(turnedBox(bench)).toEqual({ ux: 1, uz: 0, hu: 0.85 + BOX_MARGIN, hv: 0.3 + BOX_MARGIN });
    // Pushed over backward (along z) it tips over its long edge, 0.3 m from its middle; pushed endways, over its end.
    expect(tipEdge(bench, 0, 1)).toBeCloseTo(0.3, 12);
    expect(tipEdge(bench, 1, 0)).toBeCloseTo(0.85, 12);
    expect(tipEdge(bench, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo((0.85 + 0.3) * Math.SQRT1_2, 12);
    const set = newKnocked();
    stepKnocked(set, knockGrid([bench]), [car(0, 0, 8)], DT, flat);
    const d = set.list[0] as Down;
    expect([d.ux, d.uz, d.hu, d.hv]).toEqual([1, 0, 0.85 + BOX_MARGIN, 0.3 + BOX_MARGIN]);
    expect(d.edge).toBeCloseTo(0.3, 9);
    for (let t = 0; t < 1; t += DT) stepKnocked(set, knockGrid([bench]), NONE, DT, flat);
    expect(fallenBy(d)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("turns a tagged vertex in the vertex stage of every material but the flat ground's, reading only what it is handed", () => {
    const code = (ranked: boolean): { world: string; end: string } => {
      const plugin = townSurfacePlugin({ color: {} as never, data: {} as never }, emptyTownReady(), false, undefined, ranked);
      const c = plugin.getCustomCode?.("vertex");
      return { world: c?.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "", end: c?.CUSTOM_VERTEX_MAIN_END ?? "" };
    };
    expect(code(false).world).toContain(KNOCK_VERTEX);
    expect(code(false).end).toContain(KNOCK_UNPAINT);
    expect(code(true).world).not.toContain("townKnocked");
    for (let i = 0; i < MAX_KNOCKED; i++) {
      expect(KNOCK_VERTEX).toContain(`material.knockA${i};`);
      expect(KNOCK_VERTEX).toContain(`material.knockB${i};`);
    }
    expect(KNOCK_VERTEX).not.toContain(`knockA${MAX_KNOCKED}`);
    expect(KNOCK_VERTEX).toContain("material.townKnocked>0.5");
    // The knocked things' fields are the vertex stage's, as the doors' are.
    const plugin = townSurfacePlugin({ color: {} as never, data: {} as never }, emptyTownReady(), false);
    const fields = (plugin.getUniforms?.() as { ubo: { name: string; visibility?: string }[] }).ubo;
    for (const f of fields) if (f.name.startsWith("knock") || f.name === "townKnocked") expect(f.visibility, f.name).toBe("vertex");
    expect(fields.filter((f) => f.name.startsWith("knock")).length).toBe(MAX_KNOCKED * 4);
    for (let i = 0; i < MAX_KNOCKED; i++) {
      expect(KNOCK_VERTEX).toContain(`material.knockC${i};`);
      expect(KNOCK_VERTEX).toContain(`material.knockD${i};`);
    }
    // Braces balance, so the block is one statement beside the door's.
    expect(KNOCK_VERTEX.split("{").length).toBe(KNOCK_VERTEX.split("}").length);
  });

  it("turns up toward the way of the fall and then slides: the stage's matrix lays a can on its side beyond its foot, and moves a shoved thing whole", () => {
    // A thing at (10, 20) on ground at 3, falling toward +x by a quarter turn about an edge 0.25 out.
    const m: KnockMove = { x: 10, z: 20, y: 3, dx: 1, dz: 0, angle: Math.PI / 2, edge: 0.25, ux: 1, uz: 0, hu: 0.5, hv: 0.5, sx: 0, sz: 0 };
    const k = knockMatrix(m, new Float32Array(16));
    const turn = (p: readonly [number, number, number]): [number, number, number] => [
      (k[0] as number) * p[0] + (k[4] as number) * p[1] + (k[8] as number) * p[2] + (k[12] as number),
      (k[1] as number) * p[0] + (k[5] as number) * p[1] + (k[9] as number) * p[2] + (k[13] as number),
      (k[2] as number) * p[0] + (k[6] as number) * p[1] + (k[10] as number) * p[2] + (k[14] as number),
    ];
    // The edge it tips over stays where it is.
    const edge = turn([10.25, 3, 20]);
    expect(edge[0]).toBeCloseTo(10.25, 6);
    expect(edge[1]).toBeCloseTo(3, 6);
    // The top of its near side, a metre up over the edge, lands a metre out along the fall, at the ground.
    const top = turn([10.25, 4, 20]);
    expect(top[0]).toBeCloseTo(11.25, 6);
    expect(top[1]).toBeCloseTo(3, 6);
    expect(top[2]).toBeCloseTo(20, 6);
    // Its far side's foot rises to the can's width over the ground: it lies on its side, not through the ground.
    const foot = turn([9.75, 3, 20]);
    expect(foot[0]).toBeCloseTo(10.25, 6);
    expect(foot[1]).toBeCloseTo(3.5, 6);
    expect([k[3], k[7], k[11], k[15]]).toEqual([0, 0, 0, 1]);
    // Upright and slid: every point moves by the slide and nothing else.
    const slid = knockMatrix({ ...m, angle: 0, sx: 0.2, sz: -0.1 }, new Float32Array(16));
    const want = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0, -0.1, 1];
    for (let i = 0; i < 16; i++) expect(slid[i]).toBeCloseTo(want[i] as number, 6);
    // The stage's text does the same arithmetic: the turn about the edge, then the slide.
    expect(KNOCK_VERTEX).toContain("kp-(kr0*kp.x+kr1*kp.y+kr2*kp.z)+vec3<f32>(kD[ki].x,0.0,kD[ki].y)");
    expect(KNOCK_VERTEX).toContain("abs(kx*kq.x+kz*kq.y)<kq.z&&abs(kx*kq.y-kz*kq.x)<kq.w");
  });
});
