/**
 * The shapes the hand and the flashlight are built from, laid with the town's `MeshBuilder`: a frustum (a tapered prism, round or many-sided, with its ends
 * capped or open) and a box with its edges cut away. Every one is a closed solid, laid with its outward faces only, so none has a back that nothing sees.
 * They are written in a frame of the torch's own: its axis is +z (forward), +x is to the right and +y is up, and the lens is the origin.
 */
import type { MeshBuilder, Rgb, Vec3 } from "../town/meshBuilder.js";
import type { MatRef } from "../town/materials.js";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Two unit vectors across `axis` (a unit vector), turning a ring round it. */
export function across(axis: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(helper, axis));
  const v = cross(axis, u);
  return [u, v];
}

/**
 * A tapered prism from `p0` (radius `r0`) to `p1` (radius `r1`) of `sides` sides. `start` and `end` are the colours of its end caps, or null to leave an end
 * open (a sleeve's far end, which is never seen). `twist` turns the ring by that share of a side, so a part laid over another does not share its edges.
 */
export function frustum(
  b: MeshBuilder, p0: Vec3, p1: Vec3, r0: number, r1: number, sides: number, side: Rgb, mat: MatRef,
  start: Rgb | null = side, end: Rgb | null = side, twist = 0,
): void {
  const axis = unit(sub(p1, p0));
  const [u, v] = across(axis);
  const ring = (c: Vec3, r: number, i: number): Vec3 => {
    const a = ((i + twist) / sides) * Math.PI * 2;
    return add(add(c, u, Math.cos(a) * r), v, Math.sin(a) * r);
  };
  // A face leans out with the taper: the hint is the radial direction tilted along the axis by the slope.
  const slope = (r0 - r1) / Math.max(len(sub(p1, p0)), 1e-6);
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5 + twist) / sides) * Math.PI * 2;
    const radial = add(add([0, 0, 0], u, Math.cos(a)), v, Math.sin(a));
    b.poly([ring(p0, r0, i), ring(p0, r0, i + 1), ring(p1, r1, i + 1), ring(p1, r1, i)], add(radial, axis, slope), side, mat);
  }
  if (end !== null) b.poly(Array.from({ length: sides }, (_, i) => ring(p1, r1, i)), axis, end, mat);
  if (start !== null) b.poly(Array.from({ length: sides }, (_, i) => ring(p0, r0, i)), [-axis[0], -axis[1], -axis[2]], start, mat);
}

/**
 * A box of half sizes `half` along the unit axes `ax`, `ay`, `az` about `centre`, its twelve edges cut away by `bevel` (a plane of 45 degrees at each edge
 * and a triangle at each corner): 96 vertices. `top` is the colour of the face along +`ay`, which a back of a hand or the top of a cuff shows.
 */
export function bevelBox(b: MeshBuilder, centre: Vec3, ax: Vec3, ay: Vec3, az: Vec3, half: Vec3, bevel: number, side: Rgb, top: Rgb, mat: MatRef): void {
  const axes = [ax, ay, az];
  const at = (s: readonly [number, number, number], inset: readonly [number, number, number]): Vec3 => {
    let p = centre;
    for (let k = 0; k < 3; k++) p = add(p, axes[k] as Vec3, (s[k] as number) * ((half[k] as number) - (inset[k] as number)));
    return p;
  };
  const dir = (s: readonly [number, number, number]): Vec3 => {
    let d: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) d = add(d, axes[k] as Vec3, s[k]);
    return d;
  };
  const colourOf = (s: readonly [number, number, number]): Rgb => (s[1] > 0 ? top : side);
  // The six faces, each shrunk by the bevel on the two axes across it.
  for (let k = 0; k < 3; k++) {
    for (const sk of [-1, 1]) {
      const i = (k + 1) % 3;
      const j = (k + 2) % 3;
      const pts: Vec3[] = [];
      for (const [si, sj] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const s = [0, 0, 0] as [number, number, number];
        s[k] = sk;
        s[i] = si;
        s[j] = sj;
        const inset = [bevel, bevel, bevel] as [number, number, number];
        inset[k] = 0;
        pts.push(at(s, inset));
      }
      const hs = [0, 0, 0] as [number, number, number];
      hs[k] = sk;
      b.poly(pts, dir(hs), colourOf(hs), mat);
    }
  }
  // The twelve edges: the quad between the two faces' shrunk edges.
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    for (const si of [-1, 1]) {
      for (const sj of [-1, 1]) {
        const hs = [0, 0, 0] as [number, number, number];
        hs[i] = si;
        hs[j] = sj;
        // The edge quad: its four corners are the faces' two shrunk corners on either side of the edge at each end of the axis.
        const corner = (sk: number, onI: boolean): Vec3 => {
          const s = [0, 0, 0] as [number, number, number];
          s[k] = sk;
          s[i] = si;
          s[j] = sj;
          const inset = [bevel, bevel, bevel] as [number, number, number];
          inset[k] = bevel;
          if (onI) inset[i] = 0;
          else inset[j] = 0;
          return at(s, inset);
        };
        b.poly([corner(-1, true), corner(1, true), corner(1, false), corner(-1, false)], dir(hs), colourOf(hs), mat);
      }
    }
  }
  // The eight corners: the triangle between the three edge quads' ends.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s: [number, number, number] = [sx, sy, sz];
        const corner = (free: number): Vec3 => {
          const inset: [number, number, number] = [bevel, bevel, bevel];
          inset[free] = 0;
          return at(s, inset);
        };
        b.poly([corner(0), corner(1), corner(2)], dir(s), colourOf(s), mat);
      }
    }
  }
}
