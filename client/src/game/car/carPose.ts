/**
 * Where the car is drawn, and where each of its wheels is: pure arithmetic over the car's record, so the layout is tested without a
 * renderer. `carParts.ts` makes the meshes and writes these numbers into them.
 *
 * **The model's axes** are those of the parked vehicles' (`vehicleFleet.ts`): the model's +x is the nose, +y up and +z the car's left, which
 * is (-hz, hx) in plan; the right of the heading, (hz, -hx), is the model's -z. A matrix is sixteen floats column by column (the model's
 * x, y and z axes and then its place), as Lite's thin instances and `placeVehicle` have it.
 *
 * **Standing on the ground.** As `placeVehicle` stands a parked vehicle: the drawn ground's height is read under each of the four
 * wheels' contacts, a plane is fitted through them (the mean and the two slopes), the body is turned onto that plane and raised by whatever
 * the worst wheel is sunk under it. The record's own `y` is the simulation's ground, which the drawn ground may differ from a little.
 */
import { EYE_SNAP_M } from "@csarkosh/engine/game/eyeBlend";
import { AXLE_FRONT, AXLE_REAR, TRACK, WHEEL_RADIUS } from "../../sim/car/tuning.js";
import type { Car } from "../../sim/car/types.js";
import type { ManifestWheel } from "../town/props/vehicleManifest.js";

export type CarPose = {
  id: number; x: number; y: number; z: number; hx: number; hz: number;
  /** Sixteen floats, column by column: the body stood on the plane through its four wheels' ground contacts. */
  matrix: Float32Array; steer: number; speed: number; lights: boolean; driver: number;
};

/** A pose to be filled in place, so a frame allocates none. */
export function newCarPose(): CarPose {
  return { id: 0, x: 0, y: 0, z: 0, hx: 1, hz: 0, matrix: new Float32Array(16), steer: 0, speed: 0, lights: false, driver: 0 };
}

/**
 * A car as this frame draws it: between the last tick's car and this one's by `alpha`, stood on the drawn ground as `placeVehicle` stands a
 * parked one. With no `before`, at `alpha` 1 and over, or where the two are a teleport apart, it is `now` itself.
 */
export function carPose(before: Car | null, now: Car, alpha: number, groundAt: (x: number, z: number) => number, out: CarPose): void {
  let t = before === null || !(alpha < 1) ? 1 : alpha < 0 ? 0 : alpha;
  if (before !== null && Math.hypot(now.x - before.x, now.z - before.z) > EYE_SNAP_M) t = 1;
  const from = t === 1 || before === null ? now : before;
  const x = from.x + (now.x - from.x) * t;
  const z = from.z + (now.z - from.z) * t;
  let hx = from.hx + (now.hx - from.hx) * t;
  let hz = from.hz + (now.hz - from.hz) * t;
  const len = Math.hypot(hx, hz);
  if (len < 1e-6) {
    hx = now.hx;
    hz = now.hz;
  } else {
    hx /= len;
    hz /= len;
  }
  out.id = now.id;
  out.x = x;
  out.z = z;
  out.hx = hx;
  out.hz = hz;
  out.steer = from.steer + (now.steer - from.steer) * t;
  out.speed = from.speed + (now.speed - from.speed) * t;
  out.lights = now.lights;
  out.driver = now.seats[0];
  stand(x, z, hx, hz, groundAt, out);
}

/** The drawn ground's height under each wheel, front left, front right, rear left, rear right (kept to spare an array a frame). */
const CONTACT = new Float64Array(4);

/** Fills `out.matrix` and `out.y`: the body stood on the plane through its wheels' contacts on the ground. */
function stand(x: number, z: number, hx: number, hz: number, groundAt: (x: number, z: number) => number, out: CarPose): void {
  // Left is (-hz, hx); a wheel lies at `a` along the heading and `c` along the left.
  const lx = -hz;
  const lz = hx;
  const half = TRACK / 2;
  const at = (a: number, c: number): number => groundAt(x + hx * a + lx * c, z + hz * a + lz * c);
  CONTACT[0] = at(AXLE_FRONT, half);
  CONTACT[1] = at(AXLE_FRONT, -half);
  CONTACT[2] = at(AXLE_REAR, half);
  CONTACT[3] = at(AXLE_REAR, -half);
  const hl = (CONTACT[0] as number) + (CONTACT[2] as number);
  const hr = (CONTACT[1] as number) + (CONTACT[3] as number);
  const hf = (CONTACT[0] as number) + (CONTACT[1] as number);
  const hb = (CONTACT[2] as number) + (CONTACT[3] as number);
  // The plane y = y0 + pitch * a + roll * c by least squares: the four contacts are a rectangle, so the slopes are the ends' and the sides' differences.
  const pitch = (hf - hb) / 2 / (AXLE_FRONT - AXLE_REAR);
  const roll = (hl - hr) / 2 / TRACK;
  const y0 = (hl + hr) / 4 - pitch * ((AXLE_FRONT + AXLE_REAR) / 2);
  // No wheel in the ground: raised by the deepest it sinks under the plane.
  let raise = 0;
  raise = Math.max(raise, (CONTACT[0] as number) - (y0 + pitch * AXLE_FRONT + roll * half));
  raise = Math.max(raise, (CONTACT[1] as number) - (y0 + pitch * AXLE_FRONT - roll * half));
  raise = Math.max(raise, (CONTACT[2] as number) - (y0 + pitch * AXLE_REAR + roll * half));
  raise = Math.max(raise, (CONTACT[3] as number) - (y0 + pitch * AXLE_REAR - roll * half));
  const oy = y0 + raise;
  // The axes: x along the heading and its slope, z along the left and its slope, y across them (as `placeVehicle` builds them).
  let ex0 = hx, ex1 = pitch, ex2 = hz;
  let n = Math.hypot(ex0, ex1, ex2) || 1;
  ex0 /= n; ex1 /= n; ex2 /= n;
  let c0 = lx, c1 = roll, c2 = lz;
  n = Math.hypot(c0, c1, c2) || 1;
  c0 /= n; c1 /= n; c2 /= n;
  // y = c0 x ex
  let ey0 = c1 * ex2 - c2 * ex1;
  let ey1 = c2 * ex0 - c0 * ex2;
  let ey2 = c0 * ex1 - c1 * ex0;
  n = Math.hypot(ey0, ey1, ey2) || 1;
  ey0 /= n; ey1 /= n; ey2 /= n;
  // z = ex x ey
  const ez0 = ex1 * ey2 - ex2 * ey1;
  const ez1 = ex2 * ey0 - ex0 * ey2;
  const ez2 = ex0 * ey1 - ex1 * ey0;
  const m = out.matrix;
  m[0] = ex0; m[1] = ex1; m[2] = ex2; m[3] = 0;
  m[4] = ey0; m[5] = ey1; m[6] = ey2; m[7] = 0;
  m[8] = ez0; m[9] = ez1; m[10] = ez2; m[11] = 0;
  m[12] = x; m[13] = oy; m[14] = z; m[15] = 1;
  out.y = oy;
}

/**
 * Writes a wheel's matrix at `out[at]`: the body's, times the axle's place on it (`centre`, in the model), times the turn of the steer
 * (about the model's up; a positive `steer`, the tangent of the wheel's angle, turns the wheel's front to the right, the model's -z),
 * times the roll (about the axle, the model's z; a positive `roll` rolls forward, the wheel's top toward the nose). The wheel's own
 * vertices have its axle at the origin (`splitWheels`).
 */
export function wheelMatrix(body: ArrayLike<number>, centre: readonly [number, number, number], steer: number, roll: number, out: Float32Array, at: number): void {
  const psi = Math.atan(steer);
  const cs = Math.cos(psi);
  const sn = Math.sin(psi);
  // Rolling forward is a turn of -roll about +z (a turn about +z lifts the top toward the tail).
  const cr = Math.cos(roll);
  const sr = -Math.sin(roll);
  // The wheel's frame in the body's: Ry(psi) * Rz(-roll), column by column, then the axle's place.
  const l0 = cs * cr, l1 = sr, l2 = -sn * cr;
  const l3 = -cs * sr, l4 = cr, l5 = sn * sr;
  const l6 = sn, l7 = 0, l8 = cs;
  const b = body;
  const col = (v0: number, v1: number, v2: number, k: number): number => (b[k] as number) * v0 + (b[4 + k] as number) * v1 + (b[8 + k] as number) * v2;
  out[at] = col(l0, l1, l2, 0); out[at + 1] = col(l0, l1, l2, 1); out[at + 2] = col(l0, l1, l2, 2); out[at + 3] = 0;
  out[at + 4] = col(l3, l4, l5, 0); out[at + 5] = col(l3, l4, l5, 1); out[at + 6] = col(l3, l4, l5, 2); out[at + 7] = 0;
  out[at + 8] = col(l6, l7, l8, 0); out[at + 9] = col(l6, l7, l8, 1); out[at + 10] = col(l6, l7, l8, 2); out[at + 11] = 0;
  out[at + 12] = col(centre[0], centre[1], centre[2], 0) + (b[12] as number);
  out[at + 13] = col(centre[0], centre[1], centre[2], 1) + (b[13] as number);
  out[at + 14] = col(centre[0], centre[1], centre[2], 2) + (b[14] as number);
  out[at + 15] = 1;
}

/** The roll after `dt` seconds at `speed` (m/s along the heading): the angle grows by the distance over the radius, kept within a turn. */
export function rollAfter(roll: number, speed: number, dt: number): number {
  const turn = 2 * Math.PI;
  const next = (roll + (speed * dt) / WHEEL_RADIUS) % turn;
  return next < 0 ? next + turn : next;
}

/** One wheel of the tyre mesh: its own triangles and vertices, the vertices' places in the model's and the wheel's axle in it. */
export type WheelPart = {
  indices: Uint32Array;
  /** The wheel's vertices, moved so its axle is the origin. */
  positions: Float32Array;
  /** The axle's place in the model: the manifest's contact point lifted by the wheel's radius. */
  centre: [number, number, number];
  /** Each of the wheel's vertices' index in the mesh that was cut, for the arrays beside the positions (normals, coordinates). */
  source: Uint32Array;
};

/**
 * Cuts a model's `tyre` mesh into its wheels by the manifest's wheel centres, one part for each wheel in the manifest's order. A triangle
 * goes to the wheel whose axle is nearest its middle, so none is in two; a wheel has copies of the vertices its triangles use, so none is
 * shared (a vertex a wheel does not own cannot move with it). The model's own tyre is clean: every triangle's corners are nearest one axle.
 */
export function splitWheels(positions: Float32Array, indices: Uint32Array, wheels: readonly ManifestWheel[]): WheelPart[] {
  const centres = wheels.map((w): [number, number, number] => [w.x, w.y + w.r, w.z]);
  const nearest = (x: number, y: number, z: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (const [k, c] of centres.entries()) {
      const d = (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const tris: number[][] = centres.map(() => []);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < 3; q++) {
      const v = (indices[t + q] as number) * 3;
      x += positions[v] as number;
      y += positions[v + 1] as number;
      z += positions[v + 2] as number;
    }
    (tris[nearest(x / 3, y / 3, z / 3)] as number[]).push(indices[t] as number, indices[t + 1] as number, indices[t + 2] as number);
  }
  return centres.map((centre, k): WheelPart => {
    const own = tris[k] as number[];
    const made = new Map<number, number>();
    const source: number[] = [];
    const out = new Uint32Array(own.length);
    for (const [i, v] of own.entries()) {
      let n = made.get(v);
      if (n === undefined) {
        n = source.length;
        made.set(v, n);
        source.push(v);
      }
      out[i] = n;
    }
    const moved = new Float32Array(source.length * 3);
    for (const [n, v] of source.entries()) {
      moved[n * 3] = (positions[v * 3] as number) - centre[0];
      moved[n * 3 + 1] = (positions[v * 3 + 1] as number) - centre[1];
      moved[n * 3 + 2] = (positions[v * 3 + 2] as number) - centre[2];
    }
    return { indices: out, positions: moved, centre, source: Uint32Array.from(source) };
  });
}
