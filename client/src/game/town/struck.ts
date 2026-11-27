/**
 * What a car has struck that does not give way, as it is drawn: a building, a dumpster, a parked vehicle. The simulation stops the car against
 * these as it always did and keeps nothing of the blow (`sim/car/body.ts`); what is left to see is the screen's own, worked out each frame from the
 * cars as they are drawn, as what is knocked down is (`knocked.ts`).
 *
 * - **The blow.** A car that loses more speed over the ground in a frame than its brakes could take (`HIT_BRAKING`), while one of its three circles
 *   is against a solid it was moving into, has struck it. How hard is the speed lost. A car is drawn between two ticks, so one stop may be
 *   spread over two frames or three: the loss is added up while it goes on, and the blow lands once, on the frame it ends.
 * - **A mark.** Where the car touched, at the height of its bumper, a mark of damage is left on the face it met: on a wall, or on the side of the
 *   dumpster or the vehicle. It is larger the harder the blow, lasts `MARK_SECONDS` and then closes up.
 * - **A shove.** A dumpster or a parked vehicle is also moved: slid a little the way the car was going (more the harder the blow, and no further than
 *   `SHOVE_MOST` in all), and rocked: it leans away from the blow and back, dying out in a second. It stays where it was pushed for
 *   `SHOVE_SECONDS` and is then eased back to where the world has it, since the simulation's box of it never moved. The marks on it move with it.
 *
 * `struckMoves` is what the vertex stage is handed for the shoved things that are part of the town's batches; a parked vehicle that is a model is
 * given the same move as a matrix (`knockMatrix`). Nothing is thrown or left not a number whatever `dt` is.
 */
import { CAR_CIRCLES, CAR_RADIUS } from "../../sim/car/body.js";
import { standingVehicles } from "../../sim/town/parked.js";
import { planFor } from "../../sim/town/planFor.js";
import { siteFor } from "../../sim/town/siteFor.js";
import { STRIDE, townSolids } from "../../sim/town/solid.js";
import type { Vehicle } from "../../sim/town/types.js";
import { knockMatrix, type KnockMove } from "./townMaterial.js";

/** The most the brakes and a slide take off a car's speed (m/s²): a fall beyond it is a blow. The least fall beyond it that counts (m/s), and the least speed a car must have had (m/s). */
export const HIT_BRAKING = 22, HIT_LEAST = 0.6, HIT_FROM = 1.5;
/** How near a car's circle must be to a solid's face to have struck it (m), and how much of the car's travel must have been into the face. */
export const TOUCH = 0.15, INTO = 0.25;
/** A mark: how high over the ground it is left (m), how far off the face (m), how long it lasts and how long it takes to close up (s), and its size (m across) for the least and the hardest blow (`HARD` m/s lost). */
export const MARK_UP = 0.55, MARK_OFF = 0.03, MARK_SECONDS = 25, MARK_CLOSE = 1.5, MARK_SMALL = 0.9, MARK_LARGE = 1.8, HARD = 8;
/** A shove: metres slid for each m/s lost, the most in one blow and in all (m); how long it stays and how long it takes to ease back (s). */
export const SHOVE_PER = 0.02, SHOVE_BLOW = 0.12, SHOVE_MOST = 0.3, SHOVE_SECONDS = 25, SHOVE_BACK = 2;
/** The rock: radians of lean for each m/s lost and the most; how fast it swings (rad/s) and how fast it dies (per second). */
export const ROCK_PER = 0.012, ROCK_MOST = 0.07, ROCK_SWING = 15, ROCK_DIE = 3.5;
/** The most marks and the most shoved things at once. */
export const MARKS_MOST = 16, SHOVED_MOST = 4;
/** How much wider than its box a shoved thing's vertices are taken to reach, each way, metres: a mirror, a lid, a load. */
export const SHOVE_MARGIN = 0.3;

export type SolidKind = "building" | "dumpster" | "vehicle";

/** A solid a car can strike: its oriented box in the world, and for a parked vehicle the plan's own record. */
export type Solid = { readonly id: number; readonly kind: SolidKind; readonly x: number; readonly z: number; readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number; readonly vehicle: Vehicle | null };

const MADE = new Map<number, readonly Solid[]>();

/** The solids of a world seed's town that take a mark: the buildings, then the dumpsters, then the parked vehicles the ground holds, each in the plan's order. Made once. */
export function struckSolids(worldSeed: number): readonly Solid[] {
  let made = MADE.get(worldSeed);
  if (made === undefined) {
    const out: Solid[] = [];
    const walls = townSolids(worldSeed);
    for (let o = 0; o + STRIDE <= walls.rects.length; o += STRIDE) {
      out.push({ id: out.length, kind: "building", x: walls.rects[o] as number, z: walls.rects[o + 1] as number, ux: walls.rects[o + 2] as number, uz: walls.rects[o + 3] as number, hu: walls.rects[o + 4] as number, hv: walls.rects[o + 5] as number, vehicle: null });
    }
    const plan = planFor(worldSeed);
    const { anchor } = siteFor(worldSeed);
    for (const b of plan.props.bins) {
      if (b.kind !== "dumpster") continue;
      // Its box is the props' own, where they hold one (the stage puts it down at the bin's place).
      const box = plan.props.solids.find((s) => s.cx === b.x && s.cz === b.z);
      if (box === undefined) continue;
      out.push({ id: out.length, kind: "dumpster", x: anchor.x + b.x, z: anchor.z + b.z, ux: box.ux, uz: box.uz, hu: box.hu, hv: box.hv, vehicle: null });
    }
    for (const v of standingVehicles(worldSeed, plan, anchor)) {
      out.push({ id: out.length, kind: "vehicle", x: anchor.x + v.x, z: anchor.z + v.z, ux: v.hx, uz: v.hz, hu: v.length / 2, hv: v.width / 2, vehicle: v });
    }
    made = out;
    MADE.set(worldSeed, made);
  }
  return made;
}

/** A mark of damage: the solid it is on, where it is and the way it faces (as it was left, before any shove), its size, a turn of its own, and its age. */
export type Mark = { solid: number; x: number; y: number; z: number; nx: number; nz: number; size: number; spin: number; age: number };
/** A shoved thing: the solid, how far it has been slid, the way and the size of its rock, how long since the last blow, and how long it has been easing back (0: not yet). */
export type Shove = { solid: number; sx: number; sz: number; dx: number; dz: number; rock: number; since: number; back: number; /** The height of the ground it stands on, as the car that struck it stood. */ y: number };
/** What is kept of a car between frames: its velocity over the ground, and a blow that is still landing (the speed lost so far, and the way the car was going as it began). */
type Seen = { id: number; vx: number; vz: number; stamp: number; lost: number; dx: number; dz: number };

export type StruckSet = { readonly marks: Mark[]; readonly shoves: Shove[]; readonly seen: Seen[]; stamp: number; hits: number };

export function newStruck(): StruckSet {
  return { marks: [], shoves: [], seen: [], stamp: 0, hits: 0 };
}

/** A car as the frame drew it: `y` is the height of the ground under its wheels. */
export type StruckCar = { readonly id: number; readonly x: number; readonly y: number; readonly z: number; readonly hx: number; readonly hz: number; readonly speed: number; readonly slip: number };

/** A blow: the solid struck, where on its face, the face's outward way, the way the car was going, and the speed lost. */
export type Blow = { solid: Solid; x: number; z: number; nx: number; nz: number; dx: number; dz: number; lost: number };

/** A number from 0 to 1 drawn from a count: the same for the same count. */
function draw(n: number, salt: number): number {
  const v = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const NEAR = { x: 0, z: 0, gap: 0, nx: 0, nz: 0 };

/**
 * The nearest point of a solid's box to (px, pz), in `NEAR`, with the gap between them and the way from the point of the box to (px, pz).
 * Answers false for a point inside the box, which has no face nearest it worth the name.
 */
function nearest(s: Solid, px: number, pz: number): boolean {
  const dx = px - s.x;
  const dz = pz - s.z;
  const a = dx * s.ux + dz * s.uz;
  const b = dx * s.uz - dz * s.ux;
  const ca = Math.max(-s.hu, Math.min(s.hu, a));
  const cb = Math.max(-s.hv, Math.min(s.hv, b));
  const ea = a - ca;
  const eb = b - cb;
  const gap = Math.hypot(ea, eb);
  if (!(gap > 1e-9)) return false;
  NEAR.x = s.x + s.ux * ca + s.uz * cb;
  NEAR.z = s.z + s.uz * ca - s.ux * cb;
  NEAR.gap = gap;
  NEAR.nx = (s.ux * ea + s.uz * eb) / gap;
  NEAR.nz = (s.uz * ea - s.ux * eb) / gap;
  return true;
}

/** What a car going (dx, dz) struck, of the solids: the one a circle of its body is nearest against and was moving into, or null. */
export function struckBy(solids: readonly Solid[], car: StruckCar, dx: number, dz: number, lost: number): Blow | null {
  const len = Math.hypot(car.hx, car.hz);
  if (!(len > 1e-6)) return null;
  const hx = car.hx / len;
  const hz = car.hz / len;
  let best: Blow | null = null;
  let least = TOUCH;
  for (const s of solids) {
    // Far from the car: its centre is further than both could reach.
    const far = Math.abs(s.x - car.x) + Math.abs(s.z - car.z);
    if (far > s.hu + s.hv + 4) continue;
    for (const along of CAR_CIRCLES) {
      if (!nearest(s, car.x + hx * along, car.z + hz * along)) continue;
      const gap = NEAR.gap - CAR_RADIUS;
      // Into the face: the car's way against the face's own.
      if (gap >= least || -(dx * NEAR.nx + dz * NEAR.nz) < INTO) continue;
      least = gap;
      best = { solid: s, x: NEAR.x, z: NEAR.z, nx: NEAR.nx, nz: NEAR.nz, dx, dz, lost };
    }
  }
  return best;
}

/** How far a shove has come back to where the world has the thing: 0 as it was pushed, 1 home. */
function home(s: Shove): number {
  if (!(s.back > 0)) return 0;
  const t = Math.min(1, s.back / SHOVE_BACK);
  return t * t * (3 - 2 * t);
}

/** The angle a shoved thing leans by now: away from the blow and back, dying out. */
export function rockOf(s: Shove): number {
  return s.rock * Math.exp(-ROCK_DIE * s.since) * Math.sin(ROCK_SWING * s.since);
}

/** A shoved thing's move, as the vertex stage and `knockMatrix` take it. */
export function shoveMove(s: Shove, solid: Solid): KnockMove {
  const keep = 1 - home(s);
  return { x: solid.x, z: solid.z, y: s.y, dx: s.dx, dz: s.dz, angle: rockOf(s), edge: 0, ux: solid.ux, uz: solid.uz, hu: solid.hu + SHOVE_MARGIN, hv: solid.hv + SHOVE_MARGIN, sx: s.sx * keep, sz: s.sz * keep };
}

/**
 * One frame: time passes for the marks and the shoves, and each car that has struck a solid leaves a mark on it and, if it is a dumpster or a
 * parked vehicle, shoves it. The heights are the car's own: the ground under its wheels is the ground the thing it met stands on, near enough, where
 * the drawn ground under a wall or a vehicle may be cut away out of sight. Answers the blows of the frame (a list kept by the set: read it before the next).
 */
const BLOWS: Blow[] = [];
export function stepStruck(set: StruckSet, solids: readonly Solid[], cars: readonly StruckCar[], dt: number): readonly Blow[] {
  const step = dt > 0 && dt < 1 ? dt : dt >= 1 ? 1 : 0;
  for (let i = set.marks.length - 1; i >= 0; i--) {
    const m = set.marks[i] as Mark;
    m.age += step;
    if (m.age >= MARK_SECONDS + MARK_CLOSE) set.marks.splice(i, 1);
  }
  for (let i = set.shoves.length - 1; i >= 0; i--) {
    const s = set.shoves[i] as Shove;
    s.since += step;
    if (s.back > 0) {
      s.back += step;
      if (s.back >= SHOVE_BACK) set.shoves.splice(i, 1);
    } else if (s.since >= SHOVE_SECONDS) {
      s.back = step > 0 ? step : 1e-6;
    }
  }
  BLOWS.length = 0;
  set.stamp++;
  for (const c of cars) {
    const vx = c.hx * c.speed + c.hz * c.slip;
    const vz = c.hz * c.speed - c.hx * c.slip;
    let seen: Seen | undefined;
    for (const q of set.seen) if (q.id === c.id) seen = q;
    if (seen === undefined) {
      if (Number.isFinite(vx) && Number.isFinite(vz)) set.seen.push({ id: c.id, vx, vz, stamp: set.stamp, lost: 0, dx: 0, dz: 0 });
      continue;
    }
    const was = Math.hypot(seen.vx, seen.vz);
    const now = Math.hypot(vx, vz);
    const over = was - now - HIT_BRAKING * step;
    // A car not seen at the last frame was put here, not stopped here.
    const fresh = seen.stamp === set.stamp - 1;
    const px = seen.vx;
    const pz = seen.vz;
    if (Number.isFinite(vx) && Number.isFinite(vz)) {
      seen.vx = vx;
      seen.vz = vz;
    }
    seen.stamp = set.stamp;
    if (!fresh || step === 0) {
      seen.lost = 0;
      continue;
    }
    if (over > 0 && (seen.lost > 0 || was >= HIT_FROM)) {
      // A stop too sudden for the brakes: it is added to the blow that is landing, which began the way the car was then going.
      if (!(seen.lost > 0)) {
        seen.dx = px / was;
        seen.dz = pz / was;
      }
      seen.lost += over;
      continue;
    }
    // The stop is over: the blow lands, if it was one.
    const lost = seen.lost;
    seen.lost = 0;
    if (!(lost >= HIT_LEAST)) continue;
    const dx = seen.dx;
    const dz = seen.dz;
    const blow = struckBy(solids, c, dx, dz, lost);
    if (blow === null) continue;
    BLOWS.push(blow);
    set.hits++;
    const hard = Math.min(1, lost / HARD);
    if (set.marks.length >= MARKS_MOST) set.marks.shift();
    const ground = Number.isFinite(c.y) ? c.y : 0;
    set.marks.push({
      solid: blow.solid.id, x: blow.x + blow.nx * MARK_OFF, y: ground + MARK_UP, z: blow.z + blow.nz * MARK_OFF, nx: blow.nx, nz: blow.nz,
      size: MARK_SMALL + (MARK_LARGE - MARK_SMALL) * hard, spin: (draw(set.hits, 1) - 0.5) * 0.9, age: 0,
    });
    if (blow.solid.kind === "building") continue;
    let s: Shove | undefined;
    for (const q of set.shoves) if (q.solid === blow.solid.id) s = q;
    if (s === undefined) {
      if (set.shoves.length >= SHOVED_MOST) set.shoves.shift();
      s = { solid: blow.solid.id, sx: 0, sz: 0, dx, dz, rock: 0, since: 0, back: 0, y: ground };
      set.shoves.push(s);
    } else if (s.back > 0) {
      // Struck again on its way home: it is pushed on from where it has got to.
      const keep = 1 - home(s);
      s.sx *= keep;
      s.sz *= keep;
      s.back = 0;
    }
    const push = Math.min(SHOVE_BLOW, SHOVE_PER * lost);
    s.sx += dx * push;
    s.sz += dz * push;
    const far = Math.hypot(s.sx, s.sz);
    if (far > SHOVE_MOST) {
      s.sx *= SHOVE_MOST / far;
      s.sz *= SHOVE_MOST / far;
    }
    s.dx = dx;
    s.dz = dz;
    s.rock = Math.min(ROCK_MOST, ROCK_PER * lost);
    s.since = 0;
  }
  // A car that is gone is forgotten.
  for (let i = set.seen.length - 1; i >= 0; i--) if ((set.seen[i] as Seen).stamp !== set.stamp) set.seen.splice(i, 1);
  return BLOWS;
}

/** What the vertex stage is handed for the shoved things, added to `out`. */
export function struckMoves(set: StruckSet, solids: readonly Solid[], out: KnockMove[]): KnockMove[] {
  for (const s of set.shoves) {
    const solid = solids[s.solid];
    if (solid !== undefined) out.push(shoveMove(s, solid));
  }
  return out;
}

const MOVED = new Float32Array(16);

/**
 * Writes each mark's matrix into `out` (sixteen floats a mark, column by column) and answers how many: the mark's own frame (its right along the face,
 * its up, the face's way out), sized, turned by its own spin in the face's plane, closing up at the end of its time, and moved with the thing it is on
 * if that was shoved.
 */
export function markMatrices(set: StruckSet, solids: readonly Solid[], out: Float32Array): number {
  let n = 0;
  for (const m of set.marks) {
    if ((n + 1) * 16 > out.length) break;
    const closing = m.age > MARK_SECONDS ? Math.max(0, 1 - (m.age - MARK_SECONDS) / MARK_CLOSE) : 1;
    const size = m.size * closing;
    const c = Math.cos(m.spin) * size;
    const s = Math.sin(m.spin) * size;
    // The reader's right of a face that looks along n is (-nz, 0, nx).
    const rx = -m.nz, rz = m.nx;
    const o = n * 16;
    out[o] = rx * c; out[o + 1] = s; out[o + 2] = rz * c; out[o + 3] = 0;
    out[o + 4] = -rx * s; out[o + 5] = c; out[o + 6] = -rz * s; out[o + 7] = 0;
    out[o + 8] = m.nx; out[o + 9] = 0; out[o + 10] = m.nz; out[o + 11] = 0;
    out[o + 12] = m.x; out[o + 13] = m.y; out[o + 14] = m.z; out[o + 15] = 1;
    let shove: Shove | undefined;
    for (const q of set.shoves) if (q.solid === m.solid) shove = q;
    const solid = solids[m.solid];
    if (shove !== undefined && solid !== undefined) {
      knockMatrix(shoveMove(shove, solid), MOVED);
      // The moved matrix times the mark's own: each column turned, and the place turned and slid.
      for (let col = 0; col < 4; col++) {
        const x = out[o + col * 4] as number, yy = out[o + col * 4 + 1] as number, z = out[o + col * 4 + 2] as number, w = col === 3 ? 1 : 0;
        out[o + col * 4] = (MOVED[0] as number) * x + (MOVED[4] as number) * yy + (MOVED[8] as number) * z + (MOVED[12] as number) * w;
        out[o + col * 4 + 1] = (MOVED[1] as number) * x + (MOVED[5] as number) * yy + (MOVED[9] as number) * z + (MOVED[13] as number) * w;
        out[o + col * 4 + 2] = (MOVED[2] as number) * x + (MOVED[6] as number) * yy + (MOVED[10] as number) * z + (MOVED[14] as number) * w;
      }
    }
    n++;
  }
  return n;
}
