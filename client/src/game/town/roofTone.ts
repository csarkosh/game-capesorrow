/**
 * What breaks a roof's outline and its tone as seen from the street, by the building's own record (`levelOf`, its age and keeping):
 *
 * - **Moss in broad patches** on the north slopes of the damp and the neglected.
 * - **An antenna** leaning on the ridge of one house in six, and on a few a satellite dish.
 *
 * (The tarps and the patches of other shingle are `buildingParts.ts`'s: a repair of the building's own.) A decal is paint: it lies flush on the slope, 2 mm a rank off it along its normal (`paint.ts`), and is held from the slope and from the decal under it by its rank of paint. A roof whose ridge sags (an old wooden house's) gets no
 * decal, since its slope is no plane, but may have an antenna.
 */
import { withMat } from "./materials.js";
import { paintOff } from "./paint.js";
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { levelOf, exposureOf } from "./buildingWear.js";
import type { Surface } from "./townSurface.js";
import type { Building } from "../../sim/town/types.js";

type Quad = readonly [Vec3, Vec3, Vec3, Vec3];


/** A point on a slope: `u` along its eave, `v` up toward the ridge, 0 to 1 each. */
function at(q: Quad, u: number, v: number): Vec3 {
  const a: Vec3 = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u, q[0][2] + (q[1][2] - q[0][2]) * u];
  const d: Vec3 = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u, q[3][2] + (q[2][2] - q[3][2]) * u];
  return [a[0] + (d[0] - a[0]) * v, a[1] + (d[1] - a[1]) * v, a[2] + (d[2] - a[2]) * v];
}

export function roofSlopeDecals(out: MeshBuilder, b: Building, q: Quad, fr: Surface | undefined, nx: number, nz: number, roofColour: Rgb, tag: number, low: boolean): void {
  if (low || fr === undefined || b.state === "ruin") return;
  const L = levelOf(b);
  const e = exposureOf(nx, nz);
  const r = (k: number): number => hash01(b.id * 37 + tag * 11 + k, 6161);
  const e1: Vec3 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
  const e2: Vec3 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
  let n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (!(nl > 1e-6)) return;
  n = n[1] < 0 ? [-n[0] / nl, -n[1] / nl, -n[2] / nl] : [n[0] / nl, n[1] / nl, n[2] / nl];
  const lift = (p: Vec3, rank: number): Vec3 => [p[0] + n[0] * paintOff(rank), p[1] + n[1] * paintOff(rank), p[2] + n[2] * paintOff(rank)];
  /** A sheet of paint of rank `rank` (1 and up: the first over the slope, the next over that). */
  const rect = (u0: number, v0: number, u1: number, v1: number, colour: Rgb, surface: Surface | undefined, rank: number): void => {
    out.poly([lift(at(q, u0, v0), rank), lift(at(q, u1, v0), rank), lift(at(q, u1, v1), rank), lift(at(q, u0, v1), rank)], n, colour, surface, { paint: rank });
  };
  const eaveLen = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]);
  const slopeLen = Math.sqrt(e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2]);
  if (eaveLen < 3 || slopeLen < 2) return;

  // ---- moss in broad patches on the damp north side
  if (e.shade > 0.4 && r(20) < 0.2 + 0.55 * L) {
    for (let m = 0; m < 2; m++) {
      const uw = Math.min(0.6, (2.4 + 3 * r(21 + m)) / eaveLen);
      const vh = Math.min(0.6, (1.4 + 1.8 * r(24 + m)) / slopeLen);
      const u0 = 0.04 + (0.92 - uw) * r(27 + m);
      const v0 = 0.08 + (0.84 - vh) * r(30 + m);
      rect(u0, v0, u0 + uw, v0 + vh, [0.22, 0.32, 0.14], { layer: "moss", frame: fr.frame, tint: [0.8, 1.0, 0.5], wear: 0.1 }, 1 + m);
    }
  }
}

/** An antenna leaning on a ridge, and on some a dish: `at` is a point of the ridge, `y` its height. */
export function roofGear(out: MeshBuilder, b: Building, x: number, y: number, z: number, tag: number, low: boolean): void {
  if (low || b.state === "ruin") return;
  const r = (k: number): number => hash01(b.id * 41 + tag * 3 + k, 6171);
  const grey: Rgb = [0.26, 0.27, 0.28];
  if (r(1) < 0.16) {
    // A mast leaning off the upright, three crossbars, thin.
    const lx = (r(2) - 0.5) * 0.9;
    const lz = (r(3) - 0.5) * 0.9;
    const h = 2.4 + 1.2 * r(4);
    const top: Vec3 = [x + lx, y + h, z + lz];
    withMat("steel", () => out.prism([x, y - 0.2, z], top, 0.014, 4, grey, grey));
    for (let i = 0; i < 3; i++) {
      const k = 0.55 + 0.17 * i;
      const c: Vec3 = [x + lx * k, y - 0.2 + (h + 0.2) * k, z + lz * k];
      const w = 0.55 - 0.12 * i;
      const ax = r(5) < 0.5 ? 1 : 0;
      const az = 1 - ax;
      withMat("steel", () => out.prism([c[0] - ax * w, c[1], c[2] - az * w], [c[0] + ax * w, c[1], c[2] + az * w], 0.01, 4, grey, grey));
    }
  } else if (r(6) < 0.1) {
    // A dish on a short post, its face turned toward the south and up.
    const post: Vec3 = [x, y + 0.7, z];
    withMat("steel", () => out.prism([x, y - 0.1, z], post, 0.02, 4, grey, grey));
    const rr = 0.3 + 0.08 * r(7);
    const n: Vec3 = [(r(8) - 0.5) * 0.4, 0.6, -0.8];
    const nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    const nn: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
    // Two axes across the dish's face.
    const ux: Vec3 = [1, 0, 0];
    const vx: Vec3 = [nn[1] * ux[2] - nn[2] * ux[1], nn[2] * ux[0] - nn[0] * ux[2], nn[0] * ux[1] - nn[1] * ux[0]];
    const ring: Vec3[] = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const cs = Math.cos(a) * rr;
      const sn = Math.sin(a) * rr;
      return [post[0] + nn[0] * 0.05 + ux[0] * cs + vx[0] * sn, post[1] + nn[1] * 0.05 + ux[1] * cs + vx[1] * sn, post[2] + nn[2] * 0.05 + ux[2] * cs + vx[2] * sn];
    });
    withMat("sheet", () => {
      out.poly(ring, nn, [0.72, 0.72, 0.7]);
      out.poly(ring, [-nn[0], -nn[1], -nn[2]], [0.45, 0.45, 0.45]);
    });
  }
}
