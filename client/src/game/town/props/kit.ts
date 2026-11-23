/**
 * What the props' builders share: a place on the ground (an origin, a heading, and a plane through the ground under its feet, so a
 * vehicle on a slope pitches and rolls with it), boxes and slabs in local coordinates, and the colour helpers.
 *
 * Local coordinates: `lx` along the heading (forward), `ly` up, `lz` to the left of it.
 */
import { greyed, scaled, type MeshBuilder, type Rgb, type Vec3 } from "../meshBuilder.js";
import type { TownGround } from "../townTypes.js";


export type Place = {
  /** The world origin (x, z), the forward unit vector and the left one. */
  readonly ox: number;
  readonly oz: number;
  readonly fx: number;
  readonly fz: number;
  readonly lx: number;
  readonly lz: number;
  /** The height of the origin, and the slope along (up to the front) and across (up to the left), metres per metre. */
  readonly y0: number;
  readonly pitch: number;
  readonly roll: number;
};

/** The ground's top at a world place: the terrain and the streets' trough, or the deck over the water. */
export function groundAt(g: TownGround, x: number, z: number): number {
  const d = g.deckAt(x, z);
  return Math.max(g.heightAt(x, z), d) + 0.015;
}

/**
 * A place for something `length` long and `width` wide centred at plan (x, z) facing (hx, hz): the plane through the ground
 * at its four ends (a least-squares fit of the corners' heights is the mean and the two slopes).
 */
export function placeOn(g: TownGround, x: number, z: number, hx: number, hz: number, length: number, width: number, lift = 0): Place {
  const wx = g.anchor.x + x;
  const wz = g.anchor.z + z;
  const lx = -hz;
  const lz = hx;
  const hL = length / 2;
  const hW = width / 2;
  const h = (a: number, b: number): number => groundAt(g, wx + hx * a + lx * b, wz + hz * a + lz * b);
  const ff = (h(hL, hW) + h(hL, -hW)) / 2;
  const rr = (h(-hL, hW) + h(-hL, -hW)) / 2;
  const ll = (h(hL, hW) + h(-hL, hW)) / 2;
  const rl = (h(hL, -hW) + h(-hL, -hW)) / 2;
  const y0 = (ff + rr + ll + rl) / 4 + lift;
  return { ox: wx, oz: wz, fx: hx, fz: hz, lx, lz, y0, pitch: (ff - rr) / length, roll: (ll - rl) / width };
}

/** Local to world. */
export function P(p: Place, a: number, b: number, c: number): Vec3 {
  return [p.ox + p.fx * a + p.lx * c, p.y0 + b + p.pitch * a + p.roll * c, p.oz + p.fz * a + p.lz * c];
}

/** A direction in local coordinates, in the world (no translation). */
export function D(p: Place, a: number, b: number, c: number): Vec3 {
  return [p.fx * a + p.lx * c, b + p.pitch * a + p.roll * c, p.fz * a + p.lz * c];
}

/** A box in local coordinates: every face but the bottom. */
export function lbox(m: MeshBuilder, p: Place, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, side: Rgb, top: Rgb = side): void {
  const c = (a: number, b: number, d: number): Vec3 => P(p, a, b, d);
  m.poly([c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0)], D(p, 1, 0, 0), side);
  m.poly([c(x0, y0, z1), c(x0, y0, z0), c(x0, y1, z0), c(x0, y1, z1)], D(p, -1, 0, 0), side);
  m.poly([c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], D(p, 0, 0, 1), side);
  m.poly([c(x1, y0, z0), c(x0, y0, z0), c(x0, y1, z0), c(x1, y1, z0)], D(p, 0, 0, -1), side);
  m.poly([c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1)], D(p, 0, 1, 0), top);
}

/** A flat quad in a local plane of constant `x`, `y` or `z`. */
export function lquadX(m: MeshBuilder, p: Place, x: number, y0: number, y1: number, z0: number, z1: number, face: 1 | -1, colour: Rgb): void {
  m.poly([P(p, x, y0, z0), P(p, x, y0, z1), P(p, x, y1, z1), P(p, x, y1, z0)], D(p, face, 0, 0), colour);
}
export function lquadZ(m: MeshBuilder, p: Place, z: number, x0: number, x1: number, y0: number, y1: number, face: 1 | -1, colour: Rgb): void {
  m.poly([P(p, x0, y0, z), P(p, x1, y0, z), P(p, x1, y1, z), P(p, x0, y1, z)], D(p, 0, 0, face), colour);
}

/** A cylinder with its axis along local `z` (a wheel, a drum on its side): `sides` sides, from `z0` to `z1`, centred at (x, y), the faces capped when asked. */
export function lcylZ(m: MeshBuilder, p: Place, x: number, y: number, z0: number, z1: number, r: number, sides: number, side: Rgb, capA: Rgb | null, capB: Rgb | null): void {
  const ring = (z: number): Vec3[] => Array.from({ length: sides }, (_, i) => P(p, x + Math.cos((i / sides) * Math.PI * 2) * r, y + Math.sin((i / sides) * Math.PI * 2) * r, z));
  const a = ring(z0);
  const b = ring(z1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mid = (i + 0.5) / sides;
    m.poly([a[i] as Vec3, a[j] as Vec3, b[j] as Vec3, b[i] as Vec3], D(p, Math.cos(mid * Math.PI * 2), Math.sin(mid * Math.PI * 2), 0), side);
  }
  if (capA !== null) m.poly(a, D(p, 0, 0, z0 < z1 ? -1 : 1), capA);
  if (capB !== null) m.poly(b, D(p, 0, 0, z0 < z1 ? 1 : -1), capB);
}

/** A cylinder with its axis up, in local coordinates (a pot, a drum, a post). */
export function lcylY(m: MeshBuilder, p: Place, x: number, z: number, y0: number, y1: number, r: number, r1: number, sides: number, side: Rgb, top: Rgb | null): void {
  const ring = (y: number, rr: number): Vec3[] => Array.from({ length: sides }, (_, i) => P(p, x + Math.cos((i / sides) * Math.PI * 2) * rr, y, z + Math.sin((i / sides) * Math.PI * 2) * rr));
  const a = ring(y0, r);
  const b = ring(y1, r1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mid = ((i + 0.5) / sides) * Math.PI * 2;
    m.poly([a[i] as Vec3, a[j] as Vec3, b[j] as Vec3, b[i] as Vec3], D(p, Math.cos(mid), 0, Math.sin(mid)), side);
  }
  if (top !== null && r1 > 0) m.poly(b, D(p, 0, 1, 0), top);
}

/** Linear interpolation. */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mixC = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** A hash of a seed and a salt to [0, 1). */
export function rnd(seed: number, salt: number): number {
  let h = Math.imul((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export { greyed, scaled };

/**
 * A thin smooth tube through points (a wire, a rope, a strand): a ring of `sides` corners (three is enough to be seen and to hold still
 * at a distance) of radius `r`, shaded round. `r` is wider than a real wire's, so that it does not shimmer.
 */
export function tube(m: MeshBuilder, pts: readonly Vec3[], r: number, colour: Rgb, sides = 3, wire = false): void {
  if (pts.length < 2) return;
  const rows: Vec3[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)] as Vec3;
    const b = pts[Math.min(pts.length - 1, i + 1)] as Vec3;
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // u: across the tube, horizontal where it can be.
    let ux = -tz;
    const uy = 0;
    let uz = tx;
    let ul = Math.sqrt(ux * ux + uz * uz);
    if (ul < 1e-6) {
      ux = 1;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    const c = pts[i] as Vec3;
    const ring: Vec3[] = [];
    for (let k = 0; k <= sides; k++) {
      const th = (k / sides) * Math.PI * 2;
      const cs = Math.cos(th) * r;
      const sn = Math.sin(th) * r;
      ring.push([c[0] + ux * cs + vx * sn, c[1] + uy * cs + vy * sn, c[2] + uz * cs + vz * sn]);
    }
    rows.push(ring);
  }
  m.grid(rows, pts, wire ? { colour, wire: r } : { colour });
}

/** A tapered, leaning post as sections of prisms: radius `r0` at the base to `r1` at the top, the top standing off by (ox, oz), the lean growing with the square of the height. */
export function post(m: MeshBuilder, base: Vec3, height: number, r0: number, r1: number, ox: number, oz: number, sides: number, colour: Rgb, surface?: (a: Vec3, tangent: Vec3) => import("../townSurface.js").Surface): void {
  const n = 3;
  const at = (t: number): Vec3 => [base[0] + ox * t * t, base[1] + height * t, base[2] + oz * t * t];
  const rr = (t: number): number => r0 + (r1 - r0) * t;
  for (let s = 0; s < n; s++) {
    const t0 = s / n;
    const t1 = (s + 1) / n;
    const a = at(t0);
    const b = at(t1);
    const ring = (c: Vec3, rad: number): Vec3[] => Array.from({ length: sides }, (_, k) => [c[0] + Math.cos((k / sides) * Math.PI * 2) * rad, c[1], c[2] + Math.sin((k / sides) * Math.PI * 2) * rad] as Vec3);
    const ra = ring(a, rr(t0));
    const rb = ring(b, rr(t1));
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      const mid = ((k + 0.5) / sides) * Math.PI * 2;
      const quad: Vec3[] = [ra[k] as Vec3, ra[j] as Vec3, rb[j] as Vec3, rb[k] as Vec3];
      m.poly(quad, [Math.cos(mid), 0, Math.sin(mid)], colour, surface?.([a[0], a[1], a[2]], [-Math.sin(mid), 0, Math.cos(mid)]));
    }
    if (s === n - 1) m.poly(rb, [0, 1, 0], colour);
  }
}
