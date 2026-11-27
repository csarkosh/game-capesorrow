/**
 * The vehicles that stand as real models, as instances: for each parked vehicle of the plan that has a model, where it stands in the
 * world (a matrix a thin instance is drawn with) and what it wears (`vehicleLook.ts`, as the eight floats of an instance's plugin data).
 * No engine: `vehicleParts.ts` makes the meshes and draws them.
 *
 * **Standing on the ground.** A model's four wheels touch the ground at the points its manifest gives. The ground's height is read at
 * each point's place (`groundAt`, the same surface the code-built cars and the player stand on), a plane is fitted through the four
 * (the mean and the two slopes), and the model is turned onto that plane: its forward axis follows the slope along the heading, its left
 * one the slope across, and it is raised by whatever the worst wheel is sunk under the plane, so no tyre is in the ground and none stands
 * off it by more than the ground's own twist under the car (a few centimetres). The plan's position is the centre of the model's footprint.
 */
import { standingVehicles } from "../../../sim/town/parked.js";
import type { Vehicle } from "../../../sim/town/types.js";
import type { TownGround } from "../townTypes.js";
import { groundAt } from "./kit.js";
import { manifestOf, type ManifestVehicle } from "./vehicleManifest.js";
import { vehicleLook, type VehicleLook } from "./vehicleLook.js";

/** Floats of plugin data an instance carries: paint rgb and grime, then dust, moss, the offset seed and the fade, then rust, the primer panel, the dull lamp's side and the mud. */
export const FLEET_DATA_FLOATS = 12;

export type FleetInstance = {
  readonly vehicle: Vehicle;
  readonly model: string;
  /** Sixteen floats, as a shader reads a matrix (column by column). */
  readonly matrix: Float32Array;
  /** Where the footprint's centre stands in the world, and a sphere round the model. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly data: Float32Array;
  readonly look: VehicleLook;
  /** Where each wheel touches, in the world as the matrix puts it, and the ground's height under it (for a test). */
  readonly contacts: readonly { x: number; y: number; z: number; ground: number }[];
};

/** Whether the vehicle is drawn as a model on a tier: the full tier draws every vehicle that has one. */
export function drawnAsModel(v: Vehicle, detail: "full" | "low"): boolean {
  return detail === "full" && v.model !== "";
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const n = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / n, y / n, z / n];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [(a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number), (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number), (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number)];
}

/** One vehicle as an instance. `entry` is its model's manifest entry. */
export function placeVehicle(g: TownGround, v: Vehicle, entry: ManifestVehicle): FleetInstance {
  const wx = g.anchor.x + v.x;
  const wz = g.anchor.z + v.z;
  const fx = v.hx;
  const fz = v.hz;
  // Left is (-hz, hx), as the props' places have it, and a point of the file at z lies at c = -z along it.
  const lx = -v.hz;
  const lz = v.hx;
  // The wheels' places in the vehicle's frame (a along it, c across), and the ground under each with the model level at the footprint's centre.
  const pts = entry.wheels.map((w) => {
    const a = w.x;
    const c = -w.z;
    const px = wx + fx * a + lx * c;
    const pz = wz + fz * a + lz * c;
    return { a, c, h: groundAt(g, px, pz) };
  });
  // The plane y = y0 + pitch * a + roll * c through them, by least squares (the points are not collinear).
  const n = pts.length;
  let sa = 0, sc = 0, sh = 0, saa = 0, scc = 0, sac = 0, sah = 0, sch = 0;
  for (const p of pts) {
    sa += p.a; sc += p.c; sh += p.h; saa += p.a * p.a; scc += p.c * p.c; sac += p.a * p.c; sah += p.a * p.h; sch += p.c * p.h;
  }
  // Solve [n sa sc; sa saa sac; sc sac scc] [y0 pitch roll] = [sh sah sch] by Cramer's rule.
  const det3 = (m: number[]): number => (m[0] as number) * ((m[4] as number) * (m[8] as number) - (m[5] as number) * (m[7] as number)) - (m[1] as number) * ((m[3] as number) * (m[8] as number) - (m[5] as number) * (m[6] as number)) + (m[2] as number) * ((m[3] as number) * (m[7] as number) - (m[4] as number) * (m[6] as number));
  const D = det3([n, sa, sc, sa, saa, sac, sc, sac, scc]);
  const y0 = det3([sh, sa, sc, sah, saa, sac, sch, sac, scc]) / D;
  const pitch = det3([n, sh, sc, sa, sah, sac, sc, sch, scc]) / D;
  const roll = det3([n, sa, sh, sa, saa, sah, sc, sac, sch]) / D;
  // No wheel in the ground: raised by the deepest it sinks under the plane.
  let raise = 0;
  for (const p of pts) raise = Math.max(raise, p.h - (y0 + pitch * p.a + roll * p.c));
  const oy = y0 + raise;
  const ex = normalize(fx, pitch, fz);
  const ec0 = normalize(lx, roll, lz);
  const ey = normalize(...cross(ec0, ex));
  const ec = cross(ex, ey);
  const matrix = new Float32Array([ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ec[0], ec[1], ec[2], 0, wx, oy, wz, 1]);
  const contacts = entry.wheels.map((w, i) => {
    const a = w.x;
    const c = -w.z;
    const px = wx + ex[0] * a + ey[0] * w.y + ec[0] * c;
    const py = oy + ex[1] * a + ey[1] * w.y + ec[1] * c;
    const pz = wz + ex[2] * a + ey[2] * w.y + ec[2] * c;
    return { x: px, y: py, z: pz, ground: groundAt(g, px, pz), i };
  });
  const look = vehicleLook(v);
  const data = new Float32Array([look.paint[0], look.paint[1], look.paint[2], look.grime, look.dust, look.moss, look.seed, look.fade, look.rust, look.primer, look.lamp, look.mud]);
  const f = entry.footprint;
  const radius = Math.sqrt(f.length * f.length + f.width * f.width + f.height * f.height) / 2;
  return { vehicle: v, model: entry.id, matrix, x: wx, y: oy + f.height / 2, z: wz, radius, data, look, contacts };
}

/** Every vehicle of the plan that the ground holds (`standingVehicles`) and that is drawn as a model on this tier, as instances, in the plan's order. */
export function fleetOf(g: TownGround, detail: "full" | "low"): FleetInstance[] {
  const out: FleetInstance[] = [];
  for (const v of standingVehicles(g.seed, g.plan, g.anchor)) {
    if (!drawnAsModel(v, detail)) continue;
    out.push(placeVehicle(g, v, manifestOf(v.model)));
  }
  return out;
}
