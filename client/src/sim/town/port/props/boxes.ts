/**
 * Oriented boxes of the plan's frame, and a grid that says whether a new one lands on any placed. Pure arithmetic (`+ - * /`, `sqrt`,
 * `floor`, `abs`, `min`, `max`), as everything in the sim.
 */
import type { Box, Vec } from "../../types.js";

export type { Box };

/** A box centred at (x, z) facing the unit vector (hx, hz): `length` along it and `width` across. */
export function boxAt(x: number, z: number, hx: number, hz: number, length: number, width: number): Box {
  return { cx: x, cz: z, ux: hx, uz: hz, hu: length / 2, hv: width / 2 };
}

/** The four corners, counter-clockwise. */
export function corners(b: Box): Vec[] {
  const vx = -b.uz;
  const vz = b.ux;
  const at = (a: number, c: number): Vec => ({ x: b.cx + b.ux * b.hu * a + vx * b.hv * c, z: b.cz + b.uz * b.hu * a + vz * b.hv * c });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** A direction turned by a small angle given as its sine (cosine by the root): the plan computes no angle. */
export function turned(hx: number, hz: number, sine: number): Vec {
  const c = Math.sqrt(Math.max(0, 1 - sine * sine));
  return { x: hx * c - hz * sine, z: hx * sine + hz * c };
}

/** How far two boxes overlap (a separating axis test): zero or less when they are apart. `margin` grows both. */
export function overlap(a: Box, b: Box, margin = 0): number {
  const axes: [number, number][] = [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]];
  let least = Infinity;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  for (const [nx, nz] of axes) {
    const ra = Math.abs(a.ux * nx + a.uz * nz) * (a.hu + margin) + Math.abs(-a.uz * nx + a.ux * nz) * (a.hv + margin);
    const rb = Math.abs(b.ux * nx + b.uz * nz) * (b.hu + margin) + Math.abs(-b.uz * nx + b.ux * nz) * (b.hv + margin);
    const o = ra + rb - Math.abs(dx * nx + dz * nz);
    if (o <= 0) return o;
    least = Math.min(least, o);
  }
  return least;
}

/** Whether a point is in a convex counter-clockwise polygon, `tol` metres of slack (negative shrinks it). */
export function inside(poly: readonly Vec[], x: number, z: number, tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    if (ex * (z - a.z) - ez * (x - a.x) < -tol * Math.sqrt(ex * ex + ez * ez)) return false;
  }
  return true;
}

/** The box lies in the polygon (its corners do), shrunk by `margin`. */
export function boxInside(b: Box, poly: readonly Vec[], margin: number): boolean {
  return corners(b).every((c) => inside(poly, c.x, c.z, -margin));
}

const CELL = 8;

/** The boxes placed so far, in a grid, so a new one is tested against the few near it. */
export class Occupancy {
  private readonly cells: { [key: number]: number[] | undefined } = {};
  readonly boxes: Box[] = [];
  readonly tags: string[] = [];

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  private span(b: Box, margin: number): [number, number, number, number] {
    const ex = Math.abs(b.ux) * b.hu + Math.abs(b.uz) * b.hv + margin;
    const ez = Math.abs(b.uz) * b.hu + Math.abs(b.ux) * b.hv + margin;
    return [Math.floor((b.cx - ex) / CELL), Math.floor((b.cx + ex) / CELL), Math.floor((b.cz - ez) / CELL), Math.floor((b.cz + ez) / CELL)];
  }

  /** Adds a box (always), under a tag a test can read. Returns its index. */
  add(b: Box, tag: string): number {
    const id = this.boxes.length;
    this.boxes.push(b);
    this.tags.push(tag);
    const [i0, i1, j0, j1] = this.span(b, 0);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        const list = this.cells[k];
        if (list === undefined) this.cells[k] = [id];
        else list.push(id);
      }
    }
    return id;
  }

  /** Whether a box lands on any placed one (grown by `margin`). */
  hits(b: Box, margin = 0, only?: string): boolean {
    const [i0, i1, j0, j1] = this.span(b, margin);
    const seen: number[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells[this.key(i, j)];
        if (list === undefined) continue;
        for (const id of list) {
          if (seen.includes(id)) continue;
          seen.push(id);
          if (only !== undefined && this.tags[id] !== only) continue;
          if (overlap(b, this.boxes[id] as Box, margin * 0.5) > 0) return true;
        }
      }
    }
    return false;
  }
}
