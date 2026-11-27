/**
 * The harbour's decks as ground, and its rails as walls.
 *
 * `plan.decks` lists the decks over the water (the quay's apron, piers, the wharf, the platforms of sheds on piles, and the
 * boat basin's floats and gangways) as oriented rectangles with the height of their tops. This module turns them into what
 * the simulation walks on:
 *
 * - **`deckTopAt(seed, x, z)`** is the top of the deck over a world point, or null. The decks are listed in a grid of
 *   `DECK_CELL` m cells, built once per world seed (a top-level cache, as `solid.ts` does), so a lookup tests the few decks
 *   in one cell. Where decks overlap the highest top is the answer.
 * - **`withDecks(base, seed)`** wraps the engine's ground field so a deck is floor: where a deck stands over a point and its
 *   top is higher than the ground, the field stands at the deck's top, and everywhere else it is the engine's field
 *   untouched (the same object's answers). On a deck, each member of the field does this:
 *   `heightAt` is the deck's top; `normalAt` is the deck's own upward normal (straight up on a flat deck, tilted along the
 *   run of a gangway), so the hull stands and slides on it; `standNormalY` is the engine's plain ground, `GROUND_NORMAL_Y`
 *   (a deck is no scramble over rock plates); `above(x, y, z)` is `y - deckTop > 0` and the ground's own `above`, both
 *   (the point is over the higher of the two surfaces: exactly the answer `y - max(deck, ground) > 0` gives, and the cheap
 *   test of the engine's field is asked only when the point clears the deck).
 * - **The rails.** Every edge of a deck that does not join the land, the quay or another deck is railed, as is the whole of
 *   the quay's apron edge (it is a deck, and nothing is beside it but water). An edge is cut into pieces of `RAIL_STEP` m;
 *   a piece is open where the point `RAIL_PROBE` m outside it stands on ground that is within `RAIL_JOIN` of the deck's top
 *   or on another deck whose top is that near, and railed elsewhere; consecutive railed pieces make one rail. `townConstrain`
 *   (`solid.ts`) calls `constrainRails`: a hull on a deck (its feet within `RAIL_STAND` of the top) is held on the inboard
 *   side of every rail, pushed back and slid along it as a building's wall does; a hull below the deck's level (on a beach, or
 *   on the sea bed, which the deck's field would otherwise lift on to the deck) is held outside it.
 *
 * Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only, and the caches are only lookups.
 */
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { GROUND_NORMAL_Y } from "@csarkosh/engine/sim/constants";
import type { Vec3 } from "@csarkosh/engine/sim/core";
import { createGroundField, type GroundField } from "@csarkosh/engine/sim/ground";
import { planFor } from "./planFor.js";
import { siteFor } from "./siteFor.js";
import { HULL_RADIUS } from "./hull.js";

const abs = Math.abs;
const min = Math.min;
const max = Math.max;
const floor = Math.floor;
const sqrt = Math.sqrt;

/** The deck grid's cell, metres. */
export const DECK_CELL = 4;
/** A point this far outside a deck's rectangle's edge is still taken as on it, so a street's edge and a deck's are one. */
export const DECK_EPS = 1e-6;
/** An edge is cut into pieces this long, metres, to decide where it is railed. */
export const RAIL_STEP = 0.5;
/** How far outside an edge the point is taken that says what joins it, metres: more than the hull's radius is not needed, less than a slip's width. */
export const RAIL_PROBE = 0.5;
/** An edge is open where what joins it is within this of the deck's top, metres (a step a walker takes). */
export const RAIL_JOIN = 0.6;
/** A hull whose feet are this near the deck's top or higher is on the deck, metres. */
export const RAIL_STAND = 0.5;
/** What a push leaves between the hull and the rail, metres. */
const CLEAR = 1e-6;
/** The passes a position gets against the rails. */
export const RAIL_PASSES = 4;
/** How far past a rail's own box a grid cell is listed for it, metres: more than the hull's radius. */
const REACH = 1;

/** A deck in the world's coordinates: the plan's, moved by the site's anchor. */
type WorldDeck = {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly hu: number;
  readonly hv: number;
  readonly top: number;
  readonly topEnd: number;
};

/** A railed edge: a segment in the world, the unit normal pointing on to the deck, and the deck's height at each end. */
export type Rail = {
  readonly deck: number;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  /** The unit normal, on the deck's side. */
  readonly nx: number;
  readonly nz: number;
  readonly topA: number;
  readonly topB: number;
};

export type TownDecks = {
  readonly decks: readonly WorldDeck[];
  readonly rails: readonly Rail[];
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  /** Cell `c` lists the decks `deckList[deckStart[c] .. deckStart[c + 1]]`, and the rails `railList[railStart[c] .. railStart[c + 1]]`. */
  readonly deckStart: Int32Array;
  readonly deckList: Int32Array;
  readonly railStart: Int32Array;
  readonly railList: Int32Array;
};

const BASES = new Map<number, GroundField>();
const TOWN_DECKS = new Map<number, TownDecks>();

/** The engine's ground field for a seed, as the world is walked on (no deck laid over it). */
export function baseGround(seed: number): GroundField {
  let g = BASES.get(seed);
  if (g === undefined) {
    g = createGroundField(seed, null);
    BASES.set(seed, g);
  }
  return g;
}

/** A deck's top at (x, z), if (x, z) is over it. */
function topOver(d: WorldDeck, x: number, z: number): number | null {
  const dx = x - d.cx;
  const dz = z - d.cz;
  const a = dx * d.ux + dz * d.uz;
  const b = dx * d.uz - dz * d.ux;
  if (abs(a) > d.hu + DECK_EPS || abs(b) > d.hv + DECK_EPS) return null;
  const t = d.hu > 0 ? (min(d.hu, max(-d.hu, a)) + d.hu) / (2 * d.hu) : 0;
  return d.top + (d.topEnd - d.top) * t;
}

/** The decks and rails of a world seed's harbour, made once. */
export function townDecks(seed: number): TownDecks {
  let made = TOWN_DECKS.get(seed);
  if (made === undefined) {
    made = buildDecks(seed);
    TOWN_DECKS.set(seed, made);
  }
  return made;
}

function cellRange(x0: number, z0: number, lowX: number, highX: number, lowZ: number, highZ: number): [number, number, number, number] {
  return [floor((lowX - x0) / DECK_CELL), floor((highX - x0) / DECK_CELL), floor((lowZ - z0) / DECK_CELL), floor((highZ - z0) / DECK_CELL)];
}

/** The decks and rails of a world seed's harbour, made afresh (what `townDecks` caches): for a test of determinism. */
export function buildDecks(seed: number): TownDecks {
  const { anchor } = siteFor(seed);
  const plan = planFor(seed);
  const decks: WorldDeck[] = plan.decks.map((d) => ({
    id: d.id,
    cx: anchor.x + d.centre.x,
    cz: anchor.z + d.centre.z,
    ux: d.axis.x,
    uz: d.axis.z,
    hu: d.halfAlong,
    hv: d.halfAcross,
    top: d.top,
    topEnd: d.topEnd,
  }));
  const ground = baseGround(seed);

  // The rails: each edge of each deck, in pieces, open where land or another deck of a level a walker steps joins it.
  const rails: Rail[] = [];
  for (const d of decks) {
    // The four edges: each is (the unit normal out of the deck, the unit along the edge, the centre of the edge, the half length).
    const edges: [number, number, number, number, number, number, number][] = [
      [d.ux, d.uz, d.cx + d.ux * d.hu, d.cz + d.uz * d.hu, d.uz, -d.ux, d.hv],
      [-d.ux, -d.uz, d.cx - d.ux * d.hu, d.cz - d.uz * d.hu, d.uz, -d.ux, d.hv],
      [d.uz, -d.ux, d.cx + d.uz * d.hv, d.cz - d.ux * d.hv, d.ux, d.uz, d.hu],
      [-d.uz, d.ux, d.cx - d.uz * d.hv, d.cz + d.ux * d.hv, d.ux, d.uz, d.hu],
    ];
    for (const [ox, oz, mx, mz, tx, tz, half] of edges) {
      const pieces = max(1, floor((2 * half) / RAIL_STEP + 0.5));
      let runStart = -1;
      const closeRun = (end: number): void => {
        if (runStart < 0) return;
        const s0 = -half + (2 * half * runStart) / pieces;
        const s1 = -half + (2 * half * end) / pieces;
        const ax = mx + tx * s0;
        const az = mz + tz * s0;
        const bx = mx + tx * s1;
        const bz = mz + tz * s1;
        rails.push({
          deck: d.id,
          ax,
          az,
          bx,
          bz,
          nx: -ox,
          nz: -oz,
          topA: topOver(d, ax - ox * 1e-4, az - oz * 1e-4) ?? d.top,
          topB: topOver(d, bx - ox * 1e-4, bz - oz * 1e-4) ?? d.top,
        });
        runStart = -1;
      };
      for (let k = 0; k < pieces; k++) {
        const s = -half + (2 * half * (k + 0.5)) / pieces;
        const ex = mx + tx * s;
        const ez = mz + tz * s;
        const own = topOver(d, ex - ox * 1e-4, ez - oz * 1e-4) ?? d.top;
        const px = ex + ox * RAIL_PROBE;
        const pz = ez + oz * RAIL_PROBE;
        let joined = ground.heightAt(px, pz) >= own - RAIL_JOIN;
        if (!joined) {
          for (const o of decks) {
            if (o === d) continue;
            const t = topOver(o, px, pz);
            if (t !== null && abs(t - own) <= RAIL_JOIN) {
              joined = true;
              break;
            }
          }
        }
        if (joined) closeRun(k);
        else if (runStart < 0) runStart = k;
      }
      closeRun(pieces);
    }
  }

  // The grid over decks and rails.
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const deckBox: [number, number, number, number][] = [];
  for (const d of decks) {
    const ex = abs(d.ux) * d.hu + abs(d.uz) * d.hv + REACH;
    const ez = abs(d.uz) * d.hu + abs(d.ux) * d.hv + REACH;
    deckBox.push([d.cx - ex, d.cx + ex, d.cz - ez, d.cz + ez]);
  }
  const railBox: [number, number, number, number][] = rails.map((r) => [min(r.ax, r.bx) - REACH, max(r.ax, r.bx) + REACH, min(r.az, r.bz) - REACH, max(r.az, r.bz) + REACH]);
  for (const b of [...deckBox, ...railBox]) {
    minX = min(minX, b[0]);
    maxX = max(maxX, b[1]);
    minZ = min(minZ, b[2]);
    maxZ = max(maxZ, b[3]);
  }
  if (decks.length === 0) {
    return { decks, rails, x0: 0, z0: 0, cols: 0, rows: 0, deckStart: new Int32Array(1), deckList: new Int32Array(0), railStart: new Int32Array(1), railList: new Int32Array(0) };
  }
  const x0 = floor(minX / DECK_CELL) * DECK_CELL;
  const z0 = floor(minZ / DECK_CELL) * DECK_CELL;
  const cols = floor((maxX - x0) / DECK_CELL) + 1;
  const rows = floor((maxZ - z0) / DECK_CELL) + 1;
  const index = (boxes: readonly [number, number, number, number][]): { start: Int32Array; list: Int32Array } => {
    const start = new Int32Array(cols * rows + 1);
    for (const b of boxes) {
      const [c0, c1, r0, r1] = cellRange(x0, z0, b[0], b[1], b[2], b[3]);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * cols + c + 1] = (start[r * cols + c + 1] as number) + 1;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
    const list = new Int32Array(start[cols * rows] as number);
    const filled = new Int32Array(cols * rows);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i] as [number, number, number, number];
      const [c0, c1, r0, r1] = cellRange(x0, z0, b[0], b[1], b[2], b[3]);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c;
          list[(start[cell] as number) + (filled[cell] as number)] = i;
          filled[cell] = (filled[cell] as number) + 1;
        }
      }
    }
    return { start, list };
  };
  const dg = index(deckBox);
  const rg = index(railBox);
  return { decks, rails, x0, z0, cols, rows, deckStart: dg.start, deckList: dg.list, railStart: rg.start, railList: rg.list };
}

/** The top of the deck over the world point (x, z), or null where none stands over it. */
export function deckTopAt(seed: number, x: number, z: number): number | null {
  return topIn(townDecks(seed), x, z);
}

function topIn(t: TownDecks, x: number, z: number): number | null {
  const c = floor((x - t.x0) / DECK_CELL);
  const r = floor((z - t.z0) / DECK_CELL);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return null;
  const cell = r * t.cols + c;
  let best: number | null = null;
  const end = t.deckStart[cell + 1] as number;
  for (let k = t.deckStart[cell] as number; k < end; k++) {
    const top = topOver(t.decks[t.deckList[k] as number] as WorldDeck, x, z);
    if (top !== null && (best === null || top > best)) best = top;
  }
  return best;
}

/** The normal of the deck over (x, z) whose top is `top`, written into `out`: straight up, or tilted along a gangway's run. */
function normalOver(t: TownDecks, x: number, z: number, out: Vec3): void {
  const c = floor((x - t.x0) / DECK_CELL);
  const r = floor((z - t.z0) / DECK_CELL);
  const cell = r * t.cols + c;
  let best = -Infinity;
  let slopeX = 0;
  let slopeZ = 0;
  const end = t.deckStart[cell + 1] as number;
  for (let k = t.deckStart[cell] as number; k < end; k++) {
    const d = t.decks[t.deckList[k] as number] as WorldDeck;
    const top = topOver(d, x, z);
    if (top !== null && top > best) {
      best = top;
      // The height changes along the deck's axis by (topEnd - top) over its length.
      const run = d.hu > 0 ? (d.topEnd - d.top) / (2 * d.hu) : 0;
      slopeX = run * d.ux;
      slopeZ = run * d.uz;
    }
  }
  const inv = 1 / sqrt(1 + slopeX * slopeX + slopeZ * slopeZ);
  out.x = -slopeX * inv;
  out.y = inv;
  out.z = -slopeZ * inv;
}

/**
 * The engine's ground field with the harbour's decks laid over it: floor where a deck stands higher than the ground, and
 * the engine's field untouched everywhere else. Every peer builds the same one from the world seed.
 */
export function withDecks(base: GroundField, seed: number): GroundField {
  const t = townDecks(seed);
  return {
    heightAt(x, z) {
      const h = base.heightAt(x, z);
      const top = topIn(t, x, z);
      return top !== null && top > h ? top : h;
    },
    normalAt(x, z, out) {
      const top = topIn(t, x, z);
      if (top !== null && top > base.heightAt(x, z)) normalOver(t, x, z, out);
      else base.normalAt(x, z, out);
    },
    standNormalY(x, z) {
      const top = topIn(t, x, z);
      if (top !== null && top > base.heightAt(x, z)) return GROUND_NORMAL_Y;
      return base.standNormalY?.(x, z) ?? GROUND_NORMAL_Y;
    },
    above(x, y, z) {
      const top = topIn(t, x, z);
      // Above the higher of the two surfaces: above the deck and above the ground.
      if (top !== null && !(y - top > 0)) return false;
      if (base.above !== undefined) return base.above(x, y, z);
      return y - base.heightAt(x, z) > 0;
    },
  };
}

/** A place and a velocity, as `Rules.constrain` is handed them. */
type Point = { x: number; y: number; z: number };

/**
 * Holds a hull to the side of each rail it belongs on: a hull on a deck stays on the inboard side, a hull below the deck's level
 * stays outside. Returns whether it moved the hull. A hull clear of every rail is left exactly as it was. `radius` is the
 * hull's: the walker's by default, and the car's circles pass their own (it must not exceed the 1 m the rails' cells reach).
 */
export function constrainRails(seed: number, pos: Point, vel: Point, radius: number = HULL_RADIUS): boolean {
  const t = townDecks(seed);
  const c = floor((pos.x - t.x0) / DECK_CELL);
  const r = floor((pos.z - t.z0) / DECK_CELL);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return false;
  const cell = r * t.cols + c;
  let moved = false;
  const end = t.railStart[cell + 1] as number;
  for (let k = t.railStart[cell] as number; k < end; k++) {
    const rail = t.rails[t.railList[k] as number] as Rail;
    const ex = rail.bx - rail.ax;
    const ez = rail.bz - rail.az;
    const len2 = ex * ex + ez * ez;
    const s = len2 > 0 ? max(0, min(1, ((pos.x - rail.ax) * ex + (pos.z - rail.az) * ez) / len2)) : 0;
    const qx = rail.ax + ex * s;
    const qz = rail.az + ez * s;
    const dx = pos.x - qx;
    const dz = pos.z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    // Inboard (on the deck's side of the rail's line) or outboard.
    const side = (pos.x - qx) * rail.nx + (pos.z - qz) * rail.nz;
    const inboard = side >= 0;
    const top = rail.topA + (rail.topB - rail.topA) * s;
    const onDeck = pos.y - PLAYER_HALF.y >= top - RAIL_STAND;
    // A hull on the deck is held inboard of the rail; one below the deck's level is held outside it (the deck's field would
    // otherwise lift it on to the deck from the side, or from under). A hull on the deck but outboard of the rail is not held.
    if (onDeck && !inboard) continue;
    const d = sqrt(d2);
    let nx: number;
    let nz: number;
    let push: number;
    if (d > 0 && s > 0 && s < 1) {
      // Beside the rail's length: out along its normal, to the hull's radius from the line.
      const sign = onDeck ? 1 : -1;
      nx = rail.nx * sign;
      nz = rail.nz * sign;
      push = radius - (onDeck ? side : -side) + CLEAR;
    } else if (d > 0 && onDeck === inboard) {
      // Round the rail's end: away from the end point.
      nx = dx / d;
      nz = dz / d;
      push = radius - d + CLEAR;
    } else {
      // Under a deck, or on the line itself: through the rail to the side the hull belongs on.
      const sign = onDeck ? 1 : -1;
      nx = rail.nx * sign;
      nz = rail.nz * sign;
      push = radius + side + CLEAR;
    }
    if (!(push > 0)) continue;
    pos.x += nx * push;
    pos.z += nz * push;
    const into = vel.x * nx + vel.z * nz;
    if (into < 0) {
      vel.x -= into * nx;
      vel.z -= into * nz;
    }
    moved = true;
  }
  return moved;
}
