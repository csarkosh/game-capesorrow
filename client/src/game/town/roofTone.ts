/**
 * What breaks a roof's outline and its tone as seen from the street, by the building's own record (`levelOf`, its age and keeping):
 *
 * - **A tarp** held down by battens over a leak: one roof in twenty, blue or grey, on the slope the weather comes at.
 * - **A patch of other shingle**, newer (darker) or older (paler), where a part of the slope was redone.
 * - **Moss in broad patches** on the north slopes of the damp and the neglected.
 * - **An antenna** leaning on the ridge of one house in six, and on a few a satellite dish.
 *
 * A decal stands 4 cm off the slope along its normal (more than the 2.45 cm the depth buffer is held to). A roof whose ridge sags (an old wooden house's) gets no
 * decal, since its slope is no plane, but may have an antenna.
 */
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { levelOf, exposureOf } from "./buildingWear.js";
import type { Surface } from "./townSurface.js";
import type { Building } from "../../sim/town/types.js";

type Quad = readonly [Vec3, Vec3, Vec3, Vec3];

const LIFT = 0.04;
const TARP: readonly Rgb[] = [[0.12, 0.26, 0.5], [0.45, 0.47, 0.5], [0.1, 0.22, 0.42], [0.3, 0.38, 0.28]];

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
  const lift = (p: Vec3, k = 1): Vec3 => [p[0] + n[0] * LIFT * k, p[1] + n[1] * LIFT * k, p[2] + n[2] * LIFT * k];
  const rect = (u0: number, v0: number, u1: number, v1: number, colour: Rgb, surface: Surface | undefined, k = 1): void => {
    out.poly([lift(at(q, u0, v0), k), lift(at(q, u1, v0), k), lift(at(q, u1, v1), k), lift(at(q, u0, v1), k)], n, colour, surface);
  };
  const eaveLen = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]);
  const slopeLen = Math.sqrt(e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2]);
  if (eaveLen < 3 || slopeLen < 2) return;

  // ---- a tarp on the side the weather comes at: one roof in twenty
  if (e.weather > 0.2 && hash01(b.id, 6162) < 0.07 + 0.05 * L) {
    const uw = Math.min(0.85, (2.2 + 2.6 * r(1)) / eaveLen);
    const vh = Math.min(0.8, (1.8 + 1.4 * r(2)) / slopeLen);
    const u0 = 0.06 + (0.88 - uw) * r(3);
    const v0 = 0.12 + (0.8 - vh) * r(4);
    const col = TARP[Math.floor(r(5) * TARP.length)] as Rgb;
    rect(u0, v0, u0 + uw, v0 + vh, col, undefined, 1);
    // The battens: boards across it, a step further out.
    const bat: Rgb = [0.22, 0.17, 0.12];
    const nb = Math.max(2, Math.round((uw * eaveLen) / 1.1));
    for (let i = 0; i <= nb; i++) {
      const u = u0 + (uw * i) / nb;
      rect(Math.max(u0, u - 0.035 / eaveLen * 2), v0, Math.min(u0 + uw, u + 0.035 / eaveLen * 2), v0 + vh, bat, undefined, 2);
    }
    return;
  }

  // ---- a patch of newer or older shingle
  if (r(10) < 0.15 + 0.3 * L && fr.layer === "roof_shingle") {
    const uw = Math.min(0.5, (1.6 + 2.2 * r(11)) / eaveLen);
    const vh = Math.min(0.55, (1.2 + 1.4 * r(12)) / slopeLen);
    const u0 = 0.08 + (0.84 - uw) * r(13);
    const v0 = 0.15 + (0.75 - vh) * r(14);
    const newer = r(15) < 0.55;
    rect(u0, v0, u0 + uw, v0 + vh, scaled(roofColour, newer ? 0.6 : 1.3), { ...fr, wear: 0.03, wear2: 0 }, 1);
  }

  // ---- moss in broad patches on the damp north side
  if (e.shade > 0.4 && r(20) < 0.2 + 0.55 * L) {
    for (let m = 0; m < 2; m++) {
      const uw = Math.min(0.6, (2.4 + 3 * r(21 + m)) / eaveLen);
      const vh = Math.min(0.6, (1.4 + 1.8 * r(24 + m)) / slopeLen);
      const u0 = 0.04 + (0.92 - uw) * r(27 + m);
      const v0 = 0.08 + (0.84 - vh) * r(30 + m);
      rect(u0, v0, u0 + uw, v0 + vh, [0.22, 0.32, 0.14], { layer: "moss", frame: fr.frame, tint: [0.8, 1.0, 0.5], wear: 0.1 }, 2 + m);
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
    out.prism([x, y - 0.2, z], top, 0.014, 4, grey, grey);
    for (let i = 0; i < 3; i++) {
      const k = 0.55 + 0.17 * i;
      const c: Vec3 = [x + lx * k, y - 0.2 + (h + 0.2) * k, z + lz * k];
      const w = 0.55 - 0.12 * i;
      const ax = r(5) < 0.5 ? 1 : 0;
      const az = 1 - ax;
      out.prism([c[0] - ax * w, c[1], c[2] - az * w], [c[0] + ax * w, c[1], c[2] + az * w], 0.01, 4, grey, grey);
    }
  } else if (r(6) < 0.1) {
    // A dish on a short post, its face turned toward the south and up.
    const post: Vec3 = [x, y + 0.7, z];
    out.prism([x, y - 0.1, z], post, 0.02, 4, grey, grey);
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
    out.poly(ring, nn, [0.72, 0.72, 0.7]);
    out.poly(ring, [-nn[0], -nn[1], -nn[2]], [0.45, 0.45, 0.45]);
  }
}
