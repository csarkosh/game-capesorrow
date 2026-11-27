/**
 * What the design tests share: a room made of a design alone (an identity frame, floor 100 m up), the test-only design with a gallery, a stair and a room under it, the engine's
 * walking on a design, the grid flood fill the walking rules are held to, and a deterministic walk that explores a room.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import type { InputCommand } from "@csarkosh/engine/sim/core";
import { arrivalOf } from "../../src/sim/inside/convert.js";
import { DesignBuilder, STEP_UP, surfaceHeight, type Design, type Spot } from "../../src/sim/inside/design.js";
import { CLEAR, fitsDesign, groundAt } from "../../src/sim/inside/designWalk.js";
import { footOf } from "../../src/sim/inside/kinds.js";
import { fromRoom, inRoom, type InsideRoom } from "../../src/sim/inside/rooms.js";
import { walkInRoom } from "../../src/sim/inside/rules.js";
import { HULL_RADIUS } from "../../src/sim/town/hull.js";

export const R = HULL_RADIUS + CLEAR;
export const FIT = 0.001;
export const CELL = 0.5;

/** A room that is a design and nothing else: its frame is the world's own (`s` is x, `d` is z), its floor 100 m up. */
export function roomOfDesign(design: Design): InsideRoom {
  return {
    id: 1, name: "bar", building: 0, unit: 0, ox: 0, oz: 0, nx: 0, nz: -1, tx: 1, tz: 0, s0: 0, s1: design.width, depth: design.depth, ceiling: design.height, doorS: design.doorS,
    doorWidth: design.doorWidth, streetY: 40, floorY: 100, solids: [], design,
  };
}

/** A body in a room: where the hull's centre is, its velocity, and whether it is grounded. */
export type Body = { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; grounded: boolean };

/** A body standing at a place of a room's frame on the ground the design has there. */
export function standAt(room: InsideRoom, s: number, d: number, feet = 0): Body {
  const g = groundAt(room.design, s, d, feet) ?? 0;
  const p = fromRoom(room, room.s0 + s, d);
  return { pos: { x: p.x, y: room.floorY + g + PLAYER_HALF.y, z: p.z }, vel: { x: 0, y: 0, z: 0 }, grounded: true };
}

/** Where a body is, in the room's frame, and the height of its feet over the room's floor. */
export function whereIs(room: InsideRoom, b: Body): { s: number; d: number; feet: number } {
  const at = inRoom(room, b.pos.x, b.pos.z);
  return { s: at.s - room.s0, d: at.d, feet: b.pos.y - PLAYER_HALF.y - room.floorY };
}

/** A command that walks toward a place of the room's frame from where the body is (the room's frame turned to the world's, yaw 0 looks along +z). */
export function toward(room: InsideRoom, b: Body, s: number, d: number, sprint = false): InputCommand {
  const to = fromRoom(room, room.s0 + s, d);
  const dx = to.x - b.pos.x;
  const dz = to.z - b.pos.z;
  return { seq: 0, moveX: 0, moveZ: 1, yaw: Math.atan2(dx, dz), pitch: 0, buttons: sprint ? 2 : 0 };
}

export const IDLE: InputCommand = { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };

/** Walks the body for `ticks` ticks toward a place of the room's frame; returns where it ended. */
export function walkTo(room: InsideRoom, b: Body, s: number, d: number, ticks: number): { s: number; d: number; feet: number } {
  for (let i = 0; i < ticks; i++) walkInRoom(room, b, toward(room, b, s, d));
  return whereIs(room, b);
}

/** Ticks of nothing, for a body to settle or fall. */
export function rest(room: InsideRoom, b: Body, ticks: number): void {
  for (let i = 0; i < ticks; i++) walkInRoom(room, b, IDLE);
}

// ---- the test-only design: a hall with a gallery over its back, a flight up to it with a handrail each side, and a room under the gallery

export type TestOptions = {
  /** Leave a gap in the gallery's rail, 1 m wide at s 2 to 3. */
  readonly gap?: boolean;
  /** Leave the flight's low side without a handrail or a guard, so that the space under it can be walked into from the side. */
  readonly openStair?: boolean;
};

export const GALLERY = 3.2;
export const STAIR_FROM = 2;
export const STAIR_TO = 7;

export function testDesign(o: TestOptions = {}): Design {
  const W = 10;
  const D = 12;
  const H = 6.5;
  const b = new DesignBuilder(W, D, H, 7, footOf);
  b.surface({ kind: "floor", s0: 0, s1: W, d0: 0, d1: D, y: 0 });
  b.surface({ kind: "floor", s0: 0, s1: W, d0: 7, d1: D, y: GALLERY });
  b.slab({ kind: "floor", s0: 0, s1: W, d0: 0.15, d1: D, y: 0, thick: 0, mat: "dark_wood" });
  b.slab({ kind: "floor", s0: 0, s1: W, d0: 7, d1: D, y: GALLERY, thick: 0.25, mat: "oak", edge: "dark_wood" });
  b.slab({ kind: "ceiling", s0: 0, s1: W, d0: 0.15, d1: D, y: H, thick: 0, mat: "ceiling_dark" });
  // The room under the gallery: a wall across its front with a doorway, and one along its side.
  b.wall({ s0: 0, d0: 7, s1: 5, d1: 7, thick: 0.15, y0: 0, y1: GALLERY - 0.25, mat: "plaster", openings: [{ a0: 1.75, a1: 2.75, head: 2.05 }] });
  b.wall({ s0: 5, d0: 7, s1: 5, d1: D, thick: 0.15, y0: 0, y1: GALLERY - 0.25, mat: "plaster", openings: [] });
  // The flight, up along d to the gallery's edge, beside the right wall's side.
  b.stair({ s0: 7, s1: 9, d0: STAIR_FROM, d1: STAIR_TO, along: "d", y0: 0, y1: GALLERY, base: 0, mat: "oak", rails: o.openStair === true ? ["hi"] : ["lo", "hi"] });
  // The gallery's open edge: its rail from the left wall to the flight, and from the flight to the right wall, with a gap if asked.
  const rail = (s0: number, s1: number): void => b.rail({ s0, d0: 7, s1, d1: 7, y: GALLERY, h: 1.05, kind: "glass", mat: "steel" });
  if (o.gap === true) {
    rail(0, 2);
    rail(3, 7);
  } else rail(0, 7);
  rail(9, W);
  b.item("stool", 6.2, 2.5, { s: 0, d: 1 });
  b.item("column", 3.5, 4, { s: 0, d: 1 }, [H]);
  b.item("stool", 2.5, 9.5, { s: 0, d: 1 });
  return b.build({
    name: "test", legacy: false, doorS: 5, doorWidth: 1.2, doorHead: 2.1, arrive: arrivalOf(W, 5),
    shell: { front: { mat: "plaster" }, left: { mat: "plaster" }, right: { mat: "brick" }, back: { mat: "plaster" }, floor: "dark_wood", ceiling: "ceiling_dark" },
    mood: { exposure: 0.6, ambient: [1, 0.9, 0.7], ambientK: 0.03, day: 0 },
  });
}

// ---- the flood fill

type State = { readonly i: number; readonly j: number; readonly h: number; /** The state it was reached from (-1 for the first). */ readonly from: number };
const key = (i: number, j: number, h: number): string => `${i},${j},${Math.round(h * 100)}`;

export type Flood = {
  /** The states reached, as cell, ground height. */
  readonly states: readonly State[];
  /** Which of the design's surfaces some state stands on. */
  readonly surfaces: ReadonlySet<number>;
  /** The deepest `d` reached. */
  readonly deepest: number;
  /** The steps the walking takes from each state: the states a step reaches. */
  readonly adj: readonly (readonly number[])[];
};

/** The cell's centre. */
export const centre = (i: number, j: number): Spot => ({ s: (i + 0.5) * CELL, d: (j + 0.5) * CELL });

/** The ground a hull of radius `r` coming from feet at `h` stands on at a place (null if none): there is ground within a step of `h`, and it is clear of every block that acts at the height of that ground. */
export function standsAt(design: Design, s: number, d: number, h: number, r: number): number | null {
  const g = groundAt(design, s, d, h);
  if (g === null) return null;
  return fitsDesign(design, s, d, g, r, FIT) ? g : null;
}

/** The ground a step from a state at a place reaches (the place's own, also at the step's midpoint), or null where it is refused. */
export function stepTo(design: Design, from: { s: number; d: number; h: number }, s: number, d: number, r: number): number | null {
  const g = standsAt(design, s, d, from.h, r);
  if (g === null) return null;
  const mid = standsAt(design, (from.s + s) / 2, (from.d + d) / 2, from.h, r);
  return mid === null ? null : g;
}

/** A 0.5 m grid flood-filled from a place with the walking's own rules: a step to a neighbour (eight ways) is taken where a hull of radius `r` stands there and at the step's middle, on the highest ground within a step up, falling to what is below. */
export function flood(design: Design, from: Spot, r: number = R): Flood {
  const seen = new Map<string, number>();
  const adj: number[][] = [];
  const states: State[] = [];
  const surfaces = new Set<number>();
  let deepest = 0;
  const i0 = Math.floor(from.s / CELL);
  const j0 = Math.floor(from.d / CELL);
  const h0 = groundAt(design, from.s, from.d, 0) ?? 0;
  const queue: { i: number; j: number; h: number; s: number; d: number; from: number }[] = [{ i: i0, j: j0, h: h0, s: from.s, d: from.d, from: -1 }];
  seen.set(key(i0, j0, h0), 0);
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q] as (typeof queue)[number];
    states.push({ i: cur.i, j: cur.j, h: cur.h, from: cur.from });
    adj.push([]);
    deepest = Math.max(deepest, cur.d);
    design.surfaces.forEach((sf, idx) => {
      const y = surfaceHeight(sf, cur.s, cur.d);
      if (y !== null && Math.abs(y - cur.h) < 0.02) surfaces.add(idx);
    });
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const c = centre(cur.i + di, cur.j + dj);
        const g = stepTo(design, { s: cur.s, d: cur.d, h: cur.h }, c.s, c.d, r);
        if (g === null) continue;
        const k = key(cur.i + di, cur.j + dj, g);
        let at = seen.get(k);
        if (at === undefined) {
          at = queue.length;
          seen.set(k, at);
          queue.push({ i: cur.i + di, j: cur.j + dj, h: g, s: c.s, d: c.d, from: q });
        }
        (adj[q] as number[]).push(at);
      }
    }
  }
  return { states, surfaces, deepest, adj };
}

/** Every (cell, ground) where a hull stands, on any surface, whether or not it can be reached. */
export function walkable(design: Design): number {
  let n = 0;
  for (let j = 0; j * CELL < design.depth; j++) {
    for (let i = 0; i * CELL < design.width; i++) {
      const c = centre(i, j);
      const heights: number[] = [];
      for (const sf of design.surfaces) {
        const y = surfaceHeight(sf, c.s, c.d);
        if (y !== null && !heights.some((h) => Math.abs(h - y) < 0.1) && standsAt(design, c.s, c.d, y, R) !== null) heights.push(y);
      }
      n += heights.length;
    }
  }
  return n;
}

/** Whether a walk reached a flood state: the body stood within a cell (half a metre) of its cell, on the ground of its level. */
export function reached(visited: ReadonlyMap<string, readonly number[]>, s: { readonly i: number; readonly j: number; readonly h: number }): boolean {
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const here = visited.get(`${s.i + di},${s.j + dj}`);
      if (here !== undefined && here.some((h) => Math.abs(h - s.h) < 0.4)) return true;
    }
  }
  return false;
}

// ---- a walk that explores

/** A small deterministic stream of numbers in [0, 1). */
export function stream(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Walked = {
  /** The cells the body stood in, each with the heights of the ground it stood on there. */
  readonly visited: ReadonlyMap<string, readonly number[]>;
  readonly worstOutside: number;
  readonly inBlock: number;
  readonly onNothing: number;
  readonly ticks: number;
};

/**
 * A deterministic walk of `ticks` ticks from a place: to a state chosen at random among those the flood fill reached and the body has not stood in, by way of the flood's own
 * tree (sprinting), a new one when it gets there. Checked every tick: the body is inside the outer box, in no block and on ground.
 */
export function explore(room: InsideRoom, from: Spot, ticks: number, seed: number, reach: Flood): Walked {
  const design = room.design;
  const rnd = stream(seed);
  const body = standAt(room, from.s, from.d);
  const visited = new Map<string, number[]>();
  const states = reach.states;
  visited.set(`${Math.floor(from.s / CELL)},${Math.floor(from.d / CELL)}`, [0]);
  let worstOutside = -Infinity;
  let inBlock = 0;
  let onNothing = 0;
  let here = 0;
  let path: number[] = [];
  let stuck = 0;
  let last = whereIs(room, body);
  const pick = (): void => {
    // Breadth first over the steps the walking takes, from where the body is: one of the first three states it comes to that it has not stood in, and the way there.
    const parent = new Map<number, number>([[here, -1]]);
    const found: number[] = [];
    const queue = [here];
    for (let q = 0; q < queue.length && found.length < 3; q++) {
      const k = queue[q] as number;
      if (k !== here && !reached(visited, states[k] as State)) found.push(k);
      for (const n of reach.adj[k] as number[]) {
        if (parent.has(n)) continue;
        parent.set(n, k);
        queue.push(n);
      }
    }
    if (found.length === 0) {
      path = [];
      return;
    }
    const target = found[Math.floor(rnd() * found.length)] as number;
    const way: number[] = [];
    for (let k = target; k !== here; k = parent.get(k) as number) way.push(k);
    path = way.reverse();
  };
  for (let t = 0; t < ticks; t++) {
    if (path.length === 0) pick();
    if (path.length === 0) break;
    const wp = states[path[0] as number] as State;
    const c = centre(wp.i, wp.j);
    const at = whereIs(room, body);
    if (Math.hypot(at.s - c.s, at.d - c.d) < 0.4) {
      here = path.shift() as number;
      // Standing on a state's centre is standing in its cell.
      const k = `${wp.i},${wp.j}`;
      const list = visited.get(k);
      if (list === undefined) visited.set(k, [wp.h]);
      else list.push(wp.h);
      stuck = 0;
      continue;
    }
    walkInRoom(room, body, toward(room, body, c.s, c.d, true));
    const now = whereIs(room, body);
    stuck = Math.hypot(now.s - last.s, now.d - last.d) < 0.004 ? stuck + 1 : 0;
    last = now;
    if (stuck > 60) {
      // Jammed against something on the way: walk the route again from the nearest state.
      let best = here;
      let bestD = Infinity;
      states.forEach((s, k) => {
        const q = centre(s.i, s.j);
        const dist = Math.hypot(now.s - q.s, now.d - q.d) + Math.abs(now.feet - s.h);
        if (dist < bestD) {
          bestD = dist;
          best = k;
        }
      });
      here = best;
      path = [];
      stuck = 0;
    }
    worstOutside = Math.max(worstOutside, R - 0.002 - now.s, now.s - (design.width - R + 0.002), 0.15 + R - 0.002 - now.d, now.d - (design.depth - R + 0.002));
    const ground = groundAt(design, now.s, now.d, now.feet);
    if (ground === null || Math.abs(now.feet - ground) > 0.03) {
      onNothing++;
      if (process.env.DBG !== undefined && onNothing < 4) console.log(`NOTHING t${t} s${now.s.toFixed(2)} d${now.d.toFixed(2)} feet${now.feet.toFixed(3)} ground${ground} grounded${body.grounded}`);
    }
    else if (!fitsDesign(design, now.s, now.d, now.feet, HULL_RADIUS, 0.003)) inBlock++;
    const cell = `${Math.floor(now.s / CELL)},${Math.floor(now.d / CELL)}`;
    const list = visited.get(cell);
    if (list === undefined) visited.set(cell, [ground ?? now.feet]);
    else list.push(ground ?? now.feet);
  }
  return { visited, worstOutside, inBlock, onNothing, ticks };
}

export { STEP_UP };
