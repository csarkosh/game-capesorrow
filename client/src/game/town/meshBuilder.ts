/**
 * Plain arrays for a mesh: positions, normals, vertex colours, UVs, surface data and indices, grown a polygon at a time. The town's
 * geometry builders write into these and know nothing of the renderer; `townParts.ts` hands the finished arrays to
 * Babylon Lite. A polygon is given with a direction it must face (its "outward"), and is wound so that it does, as
 * the engine winds its own boxes (`propBoxes.ts`: the turn from a triangle's first edge to its second runs against
 * the face's normal), whatever order its corners were listed in.
 *
 * A polygon is flat shaded in one colour, and may also be given a `Surface` (`townSurface.ts`): a texture layer, a frame in
 * metres, and a wear. The colour is then the tint the texture is multiplied by. A polygon with no surface is exactly what it
 * was before surfaces existed: its vertices carry no layer (`NO_LAYER`) and the renderer draws them as flat colour.
 */
import { NO_LAYER, layerIndex } from "./townLayers.js";
import { basisOf, tintOf, uvAt, type Surface } from "./townSurface.js";

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

/**
 * A finished mesh's arrays, as `createMeshFromData` takes them (colours four floats a vertex), with the two a textured
 * material reads: `uvs` (two floats a vertex, in texture tiles: metres over the layer's tile size) and `surface` (eight floats
 * a vertex: the layer's index or `NO_LAYER`, the wear's amount 0 to 1, the wear's kind 0 for moss and 1 for rust, a float left
 * for a later use; then the tint, red, green, blue, and a float left). `colors` is the flat colour, as before.
 */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; surface: Float32Array; indices: Uint32Array };

/** Floats a vertex's `surface` holds. */
export const SURFACE_FLOATS = 8;

export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private srf: number[] = [];
  private idx: number[] = [];

  get vertices(): number {
    return this.pos.length / 3;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /**
   * A convex polygon, flat shaded in one colour, its normal from its corners by Newell's rule and turned to face
   * `hint`. Corners are shared by the fan of triangles it is cut into. Returns nothing for a polygon with no area. Given a
   * `surface`, each corner also gets its UV from the surface's frame and its layer and wear.
   */
  poly(points: readonly Vec3[], hint: Vec3, colour: Rgb, surface?: Surface): void {
    const n = points.length;
    if (n < 3) return;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i] as Vec3;
      const b = points[(i + 1) % n] as Vec3;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-9)) return;
    nx /= len;
    ny /= len;
    nz /= len;
    // Newell's normal is the right-handed turn of the corners in order; the polygon is wound so the turn runs against
    // the face's normal, so the engine's front face is the one `hint` looks at.
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const base = this.vertices;
    const basis = surface === undefined ? null : basisOf(surface);
    const layer = surface === undefined ? NO_LAYER : layerIndex(surface.layer);
    const kind = surface?.wearKind === "rust" ? 1 : 0;
    const tint = surface === undefined ? colour : tintOf(surface, colour);
    for (const p of points) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0], colour[1], colour[2], 1);
      if (basis === null || surface === undefined) {
        this.uv.push(0, 0);
        this.srf.push(NO_LAYER, 0, 0, 0, 1, 1, 1, 0);
      } else {
        const [u, v] = uvAt(basis, p);
        this.uv.push(u, v);
        const wear = surface.wear === undefined ? 0 : typeof surface.wear === "number" ? surface.wear : surface.wear(p);
        this.srf.push(layer, Math.min(1, Math.max(0, wear)), kind, 0, tint[0], tint[1], tint[2], 0);
      }
    }
    // The fan 0, i, i+1 turns right-handed in the corners' order, which is with the normal when the order was not flipped:
    // wind it against the normal, as the engine's boxes are (reversed from the fan when the order already faces the hint).
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push(base, base + i, base + i + 1);
      else this.idx.push(base, base + i + 1, base + i);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3, colour: Rgb, surface?: Surface): void {
    this.poly([a, b, c, d], hint, colour, surface);
  }

  /**
   * A vertical wall from `a` to `b` (two points of one height, or any two) up to `top` and down to `bottom`, facing
   * `hint`'s side: the horizontal direction it looks along.
   */
  wall(ax: number, az: number, bx: number, bz: number, bottom: number, top: number, hint: Vec3, colour: Rgb, surface?: Surface): void {
    this.poly([[ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az]], hint, colour, surface);
  }

  /** An axis-aligned-in-a-turned-frame box: centre (x, z), base y, along axis (ux, uz), half extents, height; every face but the bottom. */
  box(cx: number, cz: number, y0: number, ux: number, uz: number, halfU: number, halfV: number, height: number, side: Rgb, top: Rgb): void {
    const vx = uz;
    const vz = -ux;
    const c = (su: number, sv: number): [number, number] => [cx + ux * halfU * su + vx * halfV * sv, cz + uz * halfU * su + vz * halfV * sv];
    const y1 = y0 + height;
    const [p00, p10, p11, p01] = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    this.wall(p00[0], p00[1], p10[0], p10[1], y0, y1, [-vx, 0, -vz], side);
    this.wall(p10[0], p10[1], p11[0], p11[1], y0, y1, [ux, 0, uz], side);
    this.wall(p11[0], p11[1], p01[0], p01[1], y0, y1, [vx, 0, vz], side);
    this.wall(p01[0], p01[1], p00[0], p00[1], y0, y1, [-ux, 0, -uz], side);
    this.poly([[p00[0], y1, p00[1]], [p10[0], y1, p10[1]], [p11[0], y1, p11[1]], [p01[0], y1, p01[1]]], [0, 1, 0], top);
  }

  /**
   * A round post or drum: an upright prism of `sides` sides of radius `radius` from base `y0` up `height`, with its top (and no bottom).
   * Its sides' normals point out from the axis; `sides` is at least 3. A radius of 0 at the top is a cone (`topRadius`).
   */
  cylinder(cx: number, cz: number, y0: number, radius: number, height: number, sides: number, side: Rgb, top: Rgb, topRadius = radius): void {
    const y1 = y0 + height;
    // Corners round the axis by rotating with exact steps of the angle's own cosine and sine (a table, so no call to trigonometry is needed here).
    const ring: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      ring.push([Math.cos(a), Math.sin(a)]);
    }
    for (let i = 0; i < sides; i++) {
      const [c0, s0] = ring[i] as [number, number];
      const [c1, s1] = ring[(i + 1) % sides] as [number, number];
      const mx = c0 + c1;
      const mz = s0 + s1;
      this.poly(
        [[cx + c0 * radius, y0, cz + s0 * radius], [cx + c1 * radius, y0, cz + s1 * radius], [cx + c1 * topRadius, y1, cz + s1 * topRadius], [cx + c0 * topRadius, y1, cz + s0 * topRadius]],
        [mx, 0, mz],
        side,
      );
    }
    if (topRadius > 0) this.poly(ring.map(([c, s]): Vec3 => [cx + c * topRadius, y1, cz + s * topRadius]), [0, 1, 0], top);
  }

  /**
   * A straight prism of `sides` sides and radius `radius` from `p0` to `p1` (any direction): a timber, a pole, a log lying down, a
   * leaning pile. Its ends are capped in `cap` (left open when null). Radius 0 at either end is not allowed; use `cone` for a point.
   */
  prism(p0: Vec3, p1: Vec3, radius: number, sides: number, side: Rgb, cap: Rgb | null = side): void {
    let ax = p1[0] - p0[0];
    let ay = p1[1] - p0[1];
    let az = p1[2] - p0[2];
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(len > 1e-9)) return;
    ax /= len;
    ay /= len;
    az /= len;
    // Two axes across it: u is the axis crossed with the up (or with x when it is upright), v completes the turn.
    let ux = ay * 0 - az * 1;
    let uy = az * 0 - ax * 0;
    let uz = ax * 1 - ay * 0;
    if (Math.abs(ay) > 0.95) {
      ux = 0;
      uy = az;
      uz = -ay;
    }
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;
    const ring = (c: Vec3, i: number): Vec3 => {
      const a = (i / sides) * Math.PI * 2;
      const cs = Math.cos(a) * radius;
      const sn = Math.sin(a) * radius;
      return [c[0] + ux * cs + vx * sn, c[1] + uy * cs + vy * sn, c[2] + uz * cs + vz * sn];
    };
    for (let i = 0; i < sides; i++) {
      const a = (i / sides + 0.5 / sides) * Math.PI * 2;
      const hint: Vec3 = [ux * Math.cos(a) + vx * Math.sin(a), uy * Math.cos(a) + vy * Math.sin(a), uz * Math.cos(a) + vz * Math.sin(a)];
      this.poly([ring(p0, i), ring(p0, i + 1), ring(p1, i + 1), ring(p1, i)], hint, side);
    }
    if (cap !== null) {
      this.poly(Array.from({ length: sides }, (_, i) => ring(p1, i)), [ax, ay, az], cap);
      this.poly(Array.from({ length: sides }, (_, i) => ring(p0, i)), [-ax, -ay, -az], cap);
    }
  }

  finish(): MeshArrays {
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col),
      uvs: new Float32Array(this.uv), surface: new Float32Array(this.srf), indices: Uint32Array.from(this.idx),
    };
  }
}

/** A hash of an integer to [0, 1), by multiplication only, so the same id gives the same variation on every machine. */
export function hash01(n: number, salt = 0): number {
  let h = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A colour scaled by `k` (all three channels). */
export function scaled(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** A colour pulled toward its own grey by `k` (0 is the colour, 1 is grey). */
export function greyed(c: Rgb, k: number): Rgb {
  const g = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] + (g - c[0]) * k, c[1] + (g - c[1]) * k, c[2] + (g - c[2]) * k];
}
