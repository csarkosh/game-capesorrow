/**
 * Plain arrays for a mesh: positions, normals, vertex colours and indices, grown a polygon at a time. The town's
 * geometry builders write into these and know nothing of the renderer; `townParts.ts` hands the finished arrays to
 * Babylon Lite. A polygon is given with a direction it must face (its "outward"), and is wound so that it does, as
 * the engine winds its own boxes (`propBoxes.ts`: the turn from a triangle's first edge to its second runs against
 * the face's normal), whatever order its corners were listed in.
 */

export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

/** A finished mesh's arrays, as `createMeshFromData` takes them (colours four floats a vertex). */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array };

export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get vertices(): number {
    return this.pos.length / 3;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /**
   * A convex polygon, flat shaded in one colour, its normal from its corners by Newell's rule and turned to face
   * `hint`. Corners are shared by the fan of triangles it is cut into. Returns nothing for a polygon with no area.
   */
  poly(points: readonly Vec3[], hint: Vec3, colour: Rgb): void {
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
    for (const p of points) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0], colour[1], colour[2], 1);
    }
    // The fan 0, i, i+1 turns right-handed in the corners' order, which is with the normal when the order was not flipped:
    // wind it against the normal, as the engine's boxes are (reversed from the fan when the order already faces the hint).
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push(base, base + i, base + i + 1);
      else this.idx.push(base, base + i + 1, base + i);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3, colour: Rgb): void {
    this.poly([a, b, c, d], hint, colour);
  }

  /**
   * A vertical wall from `a` to `b` (two points of one height, or any two) up to `top` and down to `bottom`, facing
   * `hint`'s side: the horizontal direction it looks along.
   */
  wall(ax: number, az: number, bx: number, bz: number, bottom: number, top: number, hint: Vec3, colour: Rgb): void {
    this.poly([[ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az]], hint, colour);
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

  finish(): MeshArrays {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col), indices: Uint32Array.from(this.idx) };
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
