/**
 * The things a car has knocked down, as they are drawn: which of the town's knockables (`sim/town/knockables.ts`) lie on the ground now, which
 * way each fell and how far it has. The simulation keeps none of this (`sim/car/knock.ts`: a hit is the tick a car's body comes to touch a
 * thing, and nothing is remembered); it is the screen's own, worked out each frame from the cars as they are drawn, so each machine lays down
 * what it sees a car run over.
 *
 * - **Down.** A thing a moving car's body touches (the simulation's own `touches`, at the speed its hit counts from) goes down, away from the
 *   car: along the car's velocity, turned outward by the side of the car it was met on, so a sign clipped by a corner falls off to that side.
 *   It tips over its own edge (a can lands on its side, not through the ground) in `FALL_SECONDS`, quickening as it goes.
 * - **Back up.** It lies for `DOWN_SECONDS`, then stands back up over `RISE_SECONDS`, eased, but not while a car is on it: it waits.
 * - **How many.** `DOWN_MOST` at once (the vertex stage's uniforms hold these and the things that were shoved, `struck.ts`): one more, and the one that
 *   has lain longest stands at once.
 *
 * `knockMoves` is what the vertex stage is handed (`townMaterial.ts`, `writeKnocked`). Nothing is thrown or left not a number whatever `dt` is.
 */
import { KNOCK_FROM, touches, touching } from "../../sim/car/knock.js";
import { CAR_WIDTH } from "../../sim/car/tuning.js";
import type { KnockKind, Knockable, Knockables } from "../../sim/town/knockables.js";
import type { KnockMove } from "./townMaterial.js";

/** How long a thing takes to fall, lies, and takes to stand back up, seconds. */
export const FALL_SECONDS = 0.42, DOWN_SECONDS = 12, RISE_SECONDS = 0.9;
/** The most things that lie down at once. */
export const DOWN_MOST = 8;
/** How far outward of the car's travel a thing met at the car's side falls: the tangent of the turn, at the body's edge. */
export const FALL_ASIDE = 0.7;

/**
 * How each kind is laid over, metres and radians. A round kind: how far from its centre its vertices reach (what the vertex stage turns: a square that
 * far each way), how far from its centre the edge it tips over is, and the angle it comes to rest at. A post lies just short of flat, on its sign; a can,
 * a box and a cart go right over. A long kind (a bench, a stack of pallets, a cluster of mailboxes) is turned as its own box, `BOX_MARGIN` wider, and tips
 * over whichever of its edges is toward the fall.
 */
export const KNOCK_SHAPE: { readonly [K in KnockKind]: { readonly reach: number; readonly edge: number; readonly rest: number } } = {
  "stop": { reach: 0.55, edge: 0.05, rest: 1.5 },
  "dead end": { reach: 0.55, edge: 0.05, rest: 1.5 },
  "blades": { reach: 1.7, edge: 0.05, rest: 1.5 },
  "pavement ends": { reach: 0.8, edge: 0.05, rest: 1.5 },
  "sign post": { reach: 0.4, edge: 0.04, rest: 1.5 },
  "newspaper box": { reach: 0.62, edge: 0.2, rest: Math.PI / 2 },
  "drum": { reach: 0.5, edge: 0.3, rest: Math.PI / 2 },
  "mailbox": { reach: 0.6, edge: 0.06, rest: 1.45 },
  "trash can": { reach: 0.5, edge: 0.26, rest: Math.PI / 2 },
  "cart": { reach: 0.65, edge: 0.3, rest: Math.PI / 2 },
  // A long kind's reach and edge are its box's; only its rest is its own.
  "bench": { reach: 0, edge: 0, rest: Math.PI / 2 },
  "pallets": { reach: 0, edge: 0, rest: Math.PI / 2 },
  "mailbox cluster": { reach: 0, edge: 0, rest: Math.PI / 2 },
};
/** How much wider than its box a long kind is turned, each way, metres: a bench's arm, a board that overhangs. */
export const BOX_MARGIN = 0.15;

/** The box of a knockable's vertices that the vertex stage turns: a unit vector along it and its half extents along and across. */
export function turnedBox(k: Knockable): { ux: number; uz: number; hu: number; hv: number } {
  if (k.box) return { ux: k.ux, uz: k.uz, hu: k.hu + BOX_MARGIN, hv: k.hv + BOX_MARGIN };
  const reach = KNOCK_SHAPE[k.kind].reach;
  return { ux: 1, uz: 0, hu: reach, hv: reach };
}

/** How far from a knockable's centre the edge it tips over is, falling toward the unit direction (dx, dz): a round kind's own, a long kind's box's reach that way. */
export function tipEdge(k: Knockable, dx: number, dz: number): number {
  if (!k.box) return KNOCK_SHAPE[k.kind].edge;
  return Math.abs(dx * k.ux + dz * k.uz) * k.hu + Math.abs(dx * k.uz - dz * k.ux) * k.hv;
}

/** A thing that is not standing: which, where its foot is, the way it fell, how long ago it was hit (s), and whether it is on its way back up and for how long. */
export type Down = {
  id: number; kind: KnockKind; x: number; z: number; y: number; dx: number; dz: number; age: number; rising: number;
  /** The box of its vertices, and how far from its centre the edge it tipped over is. */
  ux: number; uz: number; hu: number; hv: number; edge: number;
};

export type KnockedSet = { readonly list: Down[] };

export function newKnocked(): KnockedSet {
  return { list: [] };
}

/** A car as the frame drew it: its place, its heading and its velocity along and across it. */
export type KnockCar = { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly speed: number; readonly slip: number };

/** The angle a thing has fallen by: quickening to its rest as it falls, held there, and eased back to standing as it rises. */
export function fallenBy(d: Down): number {
  const rest = KNOCK_SHAPE[d.kind].rest;
  if (d.rising > 0) {
    const t = Math.min(1, d.rising / RISE_SECONDS);
    return rest * (1 - t * t * (3 - 2 * t));
  }
  const t = Math.min(1, Math.max(0, d.age / FALL_SECONDS));
  return rest * t * t;
}

function downOf(set: KnockedSet, id: number): Down | undefined {
  for (let i = 0; i < set.list.length; i++) if ((set.list[i] as Down).id === id) return set.list[i];
  return undefined;
}

/**
 * One frame: the things the cars have run into go down, and the ones that have lain their time and have no car on them stand back up.
 * `baseAt` is the height of the ground a thing stands on. Answers how many went down this frame.
 */
export function stepKnocked(set: KnockedSet, grid: Knockables, cars: readonly KnockCar[], dt: number, baseAt: (k: Knockable) => number): number {
  const step = dt > 0 && dt < 1 ? dt : dt >= 1 ? 1 : 0;
  // Time passes for what is down; what has stood back up is forgotten.
  for (let i = set.list.length - 1; i >= 0; i--) {
    const d = set.list[i] as Down;
    d.age += step;
    if (d.rising > 0) {
      d.rising += step;
      if (d.rising >= RISE_SECONDS) set.list.splice(i, 1);
    } else if (d.age >= FALL_SECONDS + DOWN_SECONDS) {
      // Its time is up: it stands, unless a car is on it.
      const k = grid.list[d.id];
      let under = false;
      if (k !== undefined) for (const c of cars) if (touches(k, c.x, c.z, c.hx, c.hz)) under = true;
      if (!under) d.rising = step > 0 ? step : 1e-6;
    }
  }
  let fell = 0;
  for (const c of cars) {
    const over = Math.hypot(c.speed, c.slip);
    if (!(over >= KNOCK_FROM)) continue;
    const len = Math.hypot(c.hx, c.hz);
    if (!(len > 1e-6)) continue;
    const hx = c.hx / len;
    const hz = c.hz / len;
    // The way the car goes: along its heading and to its right ((hz, -hx)).
    const vx = (hx * c.speed + hz * c.slip) / over;
    const vz = (hz * c.speed - hx * c.slip) / over;
    touching(grid, c.x, c.z, hx, hz, (k) => {
      const was = downOf(set, k.id);
      if (was !== undefined) {
        // Run over again as it was getting up: it goes back down from where it had got to, the way it lay.
        if (was.rising > 0) {
          was.rising = 0;
          was.age = FALL_SECONDS;
        }
        return;
      }
      // Outward: which side of the car's own line the thing is on, as a share of the body's half width.
      const across = (k.x - c.x) * hz - (k.z - c.z) * hx;
      const aside = Math.max(-1, Math.min(1, across / (CAR_WIDTH / 2))) * FALL_ASIDE;
      let dx = vx + vz * aside;
      let dz = vz - vx * aside;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const y = baseAt(k);
      if (set.list.length >= DOWN_MOST) {
        // No room: the one that has lain longest stands at once.
        let oldest = 0;
        for (let i = 1; i < set.list.length; i++) if ((set.list[i] as Down).age > (set.list[oldest] as Down).age) oldest = i;
        set.list.splice(oldest, 1);
      }
      set.list.push({ id: k.id, kind: k.kind, x: k.x, z: k.z, y: Number.isFinite(y) ? y : 0, dx, dz, age: 0, rising: 0, ...turnedBox(k), edge: tipEdge(k, dx, dz) });
      fell++;
    });
  }
  return fell;
}

/** What the vertex stage is handed for the things that are down, added to `out` (kept by the caller, so a frame makes no list). */
export function knockMoves(set: KnockedSet, out: KnockMove[]): KnockMove[] {
  for (const d of set.list) {
    out.push({ x: d.x, z: d.z, y: d.y, dx: d.dx, dz: d.dz, angle: fallenBy(d), edge: d.edge, ux: d.ux, uz: d.uz, hu: d.hu, hv: d.hv, sx: 0, sz: 0 });
  }
  return out;
}
