/**
 * What the furniture builders (`furniture/`) and `designGeometry.ts` lay a design with: a context that puts a polygon given in the room's frame (`s` along the front, `d` into
 * the room, `y` up from its floor) into the world, lit at each corner by the baked light (`designLight.ts`) in the colour of its interior material (`interiorMaterials.ts`),
 * and `Local`, a frame of one item: `f` forward the way it faces, `r` to its right, `y` up.
 *
 * Every face is laid once; the builder (`MeshBuilder(true)`) lays its back. A thing that should look lit by itself (a bulb, a picture on a screen) takes its own `glow`.
 */
import { materialOf, varied } from "../interiorMaterials.js";
import { NIGHT_RATIOS, type MeshBuilder, type Rgb, type Vec3 } from "../meshBuilder.js";
import { nightRatio, xd, xp, type Xf } from "../roomKit.js";
import type { BakedLight } from "../designLight.js";
import { glassSheet } from "../roomGlass.js";

/** A point of the room's frame: `s`, `d`, `y`. */
export type P3 = readonly [number, number, number];

/** How a polygon is laid: the colour it is tinted by (times the material's albedo), a glow of its own (its colour is then its own and not lit), and a brightness for the lit colour. */
export type Look = { readonly tint?: Rgb; readonly glow?: number; readonly k?: number };

const ONE: Rgb = [1, 1, 1];

export class Geo {
  constructor(readonly out: MeshBuilder, readonly xf: Xf, readonly floorY: number, readonly light: BakedLight, readonly seed: number, readonly ceiling: number, readonly yOff = 0) {}

  /** The same room's context with the ceiling at `c` over the floor: what is hung from the ceiling at some place hangs from the underside of what is actually above it there (`designGeometry.ts`), not from the room's overall height. */
  under(c: number): Geo {
    return new Geo(this.out, this.xf, this.floorY, this.light, this.seed, c, this.yOff);
  }

  /** The same room's context for things that stand on a floor `y` metres up (an upper floor's): their heights are measured from it, and lit as the height it is. */
  lift(y: number): Geo {
    return y === 0 ? this : new Geo(this.out, this.xf, this.floorY, this.light, this.seed, this.ceiling - y, this.yOff + y);
  }

  /**
   * A pane of through glass (`roomGlass.ts`) on the room's frame: four points (`s`, `d`, height), the way it faces as a hint (`s`, `d`, up) and its size. False, and nothing laid, where this room has
   * no layer for such panes (a tier with no kept frame): the caller lays the opaque sheet it laid before.
   */
  glassSheet(pts: readonly [P3, P3, P3, P3], hint: P3, key: number, size: readonly [number, number]): boolean {
    const m = this.out.marked;
    if (m === null) return false;
    const h = xd(this.xf, hint[0], hint[1]);
    glassSheet(m, [this.world(pts[0]), this.world(pts[1]), this.world(pts[2]), this.world(pts[3])], [h[0], hint[2], h[2]], key, size);
    return true;
  }

  /** A point of the room's frame in the world. */
  world(p: P3): Vec3 {
    return xp(this.xf, p[0], p[1], this.floorY + this.yOff + p[2]);
  }

  /**
   * A convex polygon through points of the room's frame, facing `hint` (a direction in the same frame), in an interior material. Each corner is lit by the room's light from the
   * polygon's own normal; a polygon with its own `glow` is its albedo times it, unlit.
   */
  poly(pts: readonly P3[], hint: P3, mat: string, look: Look = {}): void {
    const n = pts.length;
    if (n < 3) return;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i] as P3;
      const b = pts[(i + 1) % n] as P3;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-9)) return;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0 ? -1 : 1;
    nx = (nx / len) * flip;
    ny = (ny / len) * flip;
    nz = (nz / len) * flip;
    const m = materialOf(mat);
    const base: Rgb = look.tint === undefined ? m.albedo : [m.albedo[0] * look.tint[0], m.albedo[1] * look.tint[1], m.albedo[2] * look.tint[2]];
    const glow = look.glow ?? 1;
    const lit = look.glow === undefined;
    const k = look.k ?? 1;
    const cols: Rgb[] = pts.map((p) => {
      if (!lit) return base;
      const c = this.light.lit(p[0], p[1], p[2] + this.yOff, nx, ny, nz);
      const col: Rgb = [base[0] * c[0] * k, base[1] * c[1] * k, base[2] * c[2] * k];
      const cn = this.light.night();
      NIGHT_RATIOS.set(col, [nightRatio(cn[0], c[0]), nightRatio(cn[2], c[2])]);
      return col;
    });
    const h = xd(this.xf, hint[0], hint[1]);
    this.out.poly(pts.map((p) => this.world(p)), [h[0], hint[2], h[2]], cols, m.mat, { glow });
  }

  /** A lit grid over a rectangle spanned from `o` by `du` and `dv` (points of the frame), its lines at the fractions `us` and `vs`, facing `hint`: the floor, a wall, a ceiling in cells the light is baked at the corners of. */
  grid(o: P3, du: P3, dv: P3, us: readonly number[], vs: readonly number[], hint: P3, mat: string, tintAt?: (i: number, j: number) => Rgb): void {
    const nx = du[1] * dv[2] - du[2] * dv[1];
    const ny = du[2] * dv[0] - du[0] * dv[2];
    const nz = du[0] * dv[1] - du[1] * dv[0];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-12)) return;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0 ? -1 : 1;
    const ns = (nx / len) * flip;
    const nd = (ny / len) * flip;
    const nyy = (nz / len) * flip;
    const m = materialOf(mat);
    const h = xd(this.xf, hint[0], hint[1]);
    const w0 = this.world(o);
    const wu: Vec3 = [this.world([o[0] + du[0], o[1] + du[1], o[2] + du[2]])[0] - w0[0], du[2], this.world([o[0] + du[0], o[1] + du[1], o[2] + du[2]])[2] - w0[2]];
    const wv: Vec3 = [this.world([o[0] + dv[0], o[1] + dv[1], o[2] + dv[2]])[0] - w0[0], dv[2], this.world([o[0] + dv[0], o[1] + dv[1], o[2] + dv[2]])[2] - w0[2]];
    this.out.litGrid(w0, wu, wv, us, vs, [h[0], hint[2], h[2]], (i, j) => {
      const a = us[i] as number;
      const b = vs[j] as number;
      const p: P3 = [o[0] + du[0] * a + dv[0] * b, o[1] + du[1] * a + dv[1] * b, o[2] + du[2] * a + dv[2] * b];
      const c = this.light.lit(p[0], p[1], p[2] + this.yOff, ns, nd, nyy);
      // A few percent off from cell to cell, so a floor is not one flat colour; the caller's own tint on top.
      const v = varied(m.albedo, i * 131 + j * 7 + this.seed, 5, 0.06);
      const k = tintAt === undefined ? ONE : tintAt(i, j);
      const col: Rgb = [v[0] * k[0] * c[0], v[1] * k[1] * c[1], v[2] * k[2] * c[2]];
      const cn = this.light.night();
      NIGHT_RATIOS.set(col, [nightRatio(cn[0], c[0]), nightRatio(cn[2], c[2])]);
      return col;
    }, m.mat, { glow: 1 });
  }

  /** A straight prism of `sides` sides and radius `rad` between two points of the room's frame (a handrail along a stair), its ends capped. */
  tube(p0: P3, p1: P3, rad: number, sides: number, mat: string, look?: Look): void {
    let ax = p1[0] - p0[0];
    let ay = p1[1] - p0[1];
    let az = p1[2] - p0[2];
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(len > 1e-9)) return;
    ax /= len;
    ay /= len;
    az /= len;
    // Two axes across it: the up crossed with it (or the s axis when it stands upright), and the third.
    let ux = ay * 1 - az * 0;
    let uy = az * 0 - ax * 1;
    let uz = 0;
    if (Math.abs(az) > 0.95) {
      ux = 1;
      uy = 0;
      uz = 0;
    }
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;
    const ring = (c: P3, i: number): P3 => {
      const a = (i / sides) * Math.PI * 2;
      const cs = Math.cos(a) * rad;
      const sn = Math.sin(a) * rad;
      return [c[0] + ux * cs + vx * sn, c[1] + uy * cs + vy * sn, c[2] + uz * cs + vz * sn];
    };
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      this.poly([ring(p0, i), ring(p0, i + 1), ring(p1, i + 1), ring(p1, i)], [ux * Math.cos(a) + vx * Math.sin(a), uy * Math.cos(a) + vy * Math.sin(a), uz * Math.cos(a) + vz * Math.sin(a)], mat, look);
    }
    this.poly(Array.from({ length: sides }, (_, i) => ring(p1, i)), [ax, ay, az], mat, look);
    this.poly(Array.from({ length: sides }, (_, i) => ring(p0, i)), [-ax, -ay, -az], mat, look);
  }

  /** A frame for an item at (`s`, `d`) facing (`fs`, `fd`). */
  at(s: number, d: number, face: { readonly s: number; readonly d: number }): Local {
    return new Local(this, s, d, face.s, face.d);
  }
}

/** An item's own frame: `f` along its facing, `r` to its right (the facing turned a quarter turn), `y` up over the floor. */
export class Local {
  constructor(readonly g: Geo, readonly s: number, readonly d: number, readonly fs: number, readonly fd: number) {}

  /** A point of the item's frame in the room's. */
  p(f: number, r: number, y: number): P3 {
    return [this.s + this.fs * f - this.fd * r, this.d + this.fd * f + this.fs * r, y];
  }
  /** A direction of the item's frame in the room's. */
  v(f: number, r: number, y: number): P3 {
    return [this.fs * f - this.fd * r, this.fd * f + this.fs * r, y];
  }

  /** A polygon through points `[f, r, y]` of the item's frame. */
  poly(pts: readonly (readonly [number, number, number])[], hint: readonly [number, number, number], mat: string, look?: Look): void {
    this.g.poly(pts.map((q) => this.p(q[0], q[1], q[2])), this.v(hint[0], hint[1], hint[2]), mat, look);
  }

  /** A box between `f0` and `f1` forward, `r0` and `r1` to the right and `y0` and `y1` up: its four sides and its top, and its underside when it is held off the floor. */
  box(f0: number, f1: number, r0: number, r1: number, y0: number, y1: number, mat: string, look?: Look, sides = true, top = true): void {
    // A box is a solid (a leg, a plate, a cabinet): its inside is not seen, and its faces' backs would lie in the planes of what it stands on or against.
    this.g.out.solid(() => this.boxFaces(f0, f1, r0, r1, y0, y1, mat, look, sides, top));
  }

  private boxFaces(f0: number, f1: number, r0: number, r1: number, y0: number, y1: number, mat: string, look: Look | undefined, sides: boolean, topIn: boolean): void {
    // A top at the ceiling is over the slab's face: not drawn (it would be stood off the ceiling's own back).
    const top = topIn && y1 < this.g.ceiling - 0.002;
    if (sides) {
      this.poly([[f1, r0, y0], [f1, r1, y0], [f1, r1, y1], [f1, r0, y1]], [1, 0, 0], mat, look);
      this.poly([[f0, r0, y0], [f0, r1, y0], [f0, r1, y1], [f0, r0, y1]], [-1, 0, 0], mat, look);
      this.poly([[f0, r1, y0], [f1, r1, y0], [f1, r1, y1], [f0, r1, y1]], [0, 1, 0], mat, look);
      this.poly([[f0, r0, y0], [f1, r0, y0], [f1, r0, y1], [f0, r0, y1]], [0, -1, 0], mat, look);
    }
    if (top) this.poly([[f0, r0, y1], [f1, r0, y1], [f1, r1, y1], [f0, r1, y1]], [0, 0, 1], mat, look);
    if (y0 > 0.03) this.poly([[f0, r0, y0], [f1, r0, y0], [f1, r1, y0], [f0, r1, y0]], [0, 0, -1], mat, look);
  }

  /** A tube along the `r` axis (a rail), centred at forward `f` and height `y`, from `r0` to `r1`, of `sides` sides and radius `rad`, with its ends. */
  tubeR(f: number, y: number, r0: number, r1: number, rad: number, sides: number, mat: string, look?: Look): void {
    const ring = (r: number, i: number): [number, number, number] => {
      const a = (i / sides) * Math.PI * 2;
      return [f + Math.cos(a) * rad, r, y + Math.sin(a) * rad];
    };
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      this.poly([ring(r0, i), ring(r1, i), ring(r1, i + 1), ring(r0, i + 1)], [Math.cos(a), 0, Math.sin(a)], mat, look);
    }
    this.poly(Array.from({ length: sides }, (_, i) => ring(r1, i)), [0, 1, 0], mat, look);
    this.poly(Array.from({ length: sides }, (_, i) => ring(r0, i)), [0, -1, 0], mat, look);
  }

  /** A disc standing out from a wall along `f` (a guitar's body, a clock): centred at (`r`, `y`), radius `rad`, from `f0` to `f1`, with its front face. */
  disc(r: number, y: number, rad: number, f0: number, f1: number, sides: number, mat: string, look?: Look): void {
    const ring = (f: number, i: number): [number, number, number] => {
      const a = (i / sides) * Math.PI * 2;
      return [f, r + Math.cos(a) * rad, y + Math.sin(a) * rad];
    };
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      this.poly([ring(f0, i), ring(f0, i + 1), ring(f1, i + 1), ring(f1, i)], [0, Math.cos(a), Math.sin(a)], mat, look);
    }
    this.poly(Array.from({ length: sides }, (_, i) => ring(f1, i)), [1, 0, 0], mat, look);
  }

  /** An upright frustum of `sides` sides about (`f`, `r`) from `y0` to `y1`, radius `rad0` at its foot and `rad1` at its top, with its top, and its underside when it is held off the floor. */
  frustum(f: number, r: number, y0: number, y1: number, rad0: number, rad1: number, sides: number, mat: string, look?: Look, bottom = y0 > 0.03, top = true): void {
    // Closed at both ends it is a solid, with no backs (open, a shade, its inside is seen).
    if (bottom && top) {
      this.g.out.solid(() => this.frustumFaces(f, r, y0, y1, rad0, rad1, sides, mat, look, bottom, top));
      return;
    }
    this.frustumFaces(f, r, y0, y1, rad0, rad1, sides, mat, look, bottom, top);
  }

  private frustumFaces(f: number, r: number, y0: number, y1: number, rad0: number, rad1: number, sides: number, mat: string, look: Look | undefined, bottom: boolean, top: boolean): void {
    const ring = (rad: number, y: number, i: number): [number, number, number] => {
      const a = (i / sides) * Math.PI * 2;
      return [f + Math.cos(a) * rad, r + Math.sin(a) * rad, y];
    };
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      this.poly([ring(rad0, y0, i), ring(rad0, y0, i + 1), ring(rad1, y1, i + 1), ring(rad1, y1, i)], [Math.cos(a), Math.sin(a), 0], mat, look);
    }
    if (top && rad1 > 0) this.poly(Array.from({ length: sides }, (_, i) => ring(rad1, y1, i)), [0, 0, 1], mat, look);
    if (bottom && rad0 > 0) this.poly(Array.from({ length: sides }, (_, i) => ring(rad0, y0, i)), [0, 0, -1], mat, look);
  }
}

/** A colour off by a hash, for a thing that is not the same as its neighbour: the table's albedo is multiplied by this as a tint. */
export function tintOf(id: number, salt: number, amount = 0.1): Rgb {
  return varied([1, 1, 1], id, salt, amount);
}

