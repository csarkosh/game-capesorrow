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
import { NO_LAYER, TOWN_LAYERS, layerIndex, type LayerName } from "./townLayers.js";
import { WEAR_KIND_NUMBER, basisOf, tintOf, uvAt, type Fx, type Surface, type WearKind } from "./townSurface.js";

export type Vec3 = readonly [number, number, number];

/** How `MeshBuilder.grid` dresses a grid of points: colour per vertex, and optionally a texture layer with its tint, UV (metres) and two wears. */
export type GridLook = {
  readonly colour: Rgb | ((i: number, j: number) => Rgb);
  readonly layer?: LayerName;
  readonly tint?: Rgb | ((i: number, j: number) => Rgb);
  readonly uv?: (i: number, j: number) => readonly [number, number];
  readonly wear?: (i: number, j: number) => readonly [number, WearKind];
  readonly wear2?: (i: number, j: number) => readonly [number, WearKind];
  readonly streaks?: boolean;
  readonly streaks2?: boolean;
  readonly clear?: number;
  /** A wire's radius, metres: the vertex shader keeps it at least a pixel and a bit wide at any distance, and the fragment fades it by the same factor (`townMaterial.ts`, `WIRE_CODE`). */
  readonly wire?: number;
};
export type Rgb = readonly [number, number, number];

/**
 * A finished mesh's arrays, as `createMeshFromData` takes them (colours four floats a vertex), with the two a textured
 * material reads: `uvs` (two floats a vertex, in texture tiles: metres over the layer's tile size) and `surface` (twelve floats
 * a vertex: the layer's index or `NO_LAYER`, the wear's amount 0 to 1, the wear's kind (`WEAR_KIND_NUMBER`, plus a half for streaks), the glow
 * (0 lit by the scene, 1 lit by itself); then the tint, red, green, blue, and how clear it is (0 opaque); then the second wear's amount and
 * kind, and two floats left). `colors` is the flat colour, as before.
 */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; surface: Float32Array; indices: Uint32Array };

/** Floats a vertex's `surface` holds. */
export const SURFACE_FLOATS = 12;

const ONE: Rgb = [1, 1, 1];

export class MeshBuilder {
  /** Debugging: when set, each polygon records where in the builders it was made (`tags`: its first triangle's index, and the callers), for a script that hunts overlaps. Off in the game. */
  static trace = false;
  /** With `trace` on, the tags of each finished mesh, by its arrays (the finder reads them to say where a pair came from). */
  static readonly traced = new WeakMap<object, [number, string][]>();
  readonly tags: [number, string][] = [];
  private tag(from: number): void {
    const lines = (new Error().stack ?? "").split("\n").slice(2).filter((l) => !l.includes("meshBuilder") && !l.includes("/surface.ts")).slice(0, 4);
    this.tags.push([from, lines.map((l) => l.replace(/^.*\/(game|test)\/town\//, "").replace(/\)$/, "")).join(" < ")]);
  }
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private srf: number[] = [];
  private idx: number[] = [];

  get vertices(): number {
    return this.pos.length / 3;
  }

  /** Calls `fn` with the position of each vertex from vertex number `from` on (for a part that wants its own extent or a fingerprint). */
  forEachPosition(from: number, fn: (x: number, y: number, z: number) => void): void {
    for (let i = from * 3; i < this.pos.length; i += 3) fn(this.pos[i] as number, this.pos[i + 1] as number, this.pos[i + 2] as number);
  }

  /** A fingerprint of the geometry from vertex `from` on: positions to a centimetre, folded in order (FNV-1a), as an unsigned 32-bit number. */
  hashFrom(from: number): number {
    let h = 0x811c9dc5;
    for (let i = from * 3; i < this.pos.length; i++) {
      h ^= Math.round((this.pos[i] as number) * 100) | 0;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /**
   * A convex polygon, flat shaded in one colour, its normal from its corners by Newell's rule and turned to face
   * `hint`. Corners are shared by the fan of triangles it is cut into. Returns nothing for a polygon with no area. Given a
   * `surface`, each corner also gets its UV from the surface's frame and its layer and wear.
   */
  poly(points: readonly Vec3[], hint: Vec3, colour: Rgb | readonly Rgb[], surface?: Surface, fx?: Fx): void {
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
    if (MeshBuilder.trace) this.tag(this.idx.length / 3);
    const basis = surface === undefined ? null : basisOf(surface);
    const layer = surface === undefined ? NO_LAYER : layerIndex(surface.layer);
    const kind = (WEAR_KIND_NUMBER[surface?.wearKind ?? "moss"] ?? 0) + (surface?.streaks === true ? 0.5 : 0);
    const kind2 = (WEAR_KIND_NUMBER[surface?.wearKind2 ?? "moss"] ?? 0) + (surface?.streaks2 === true ? 0.5 : 0);
    const glow = fx?.glow ?? 0;
    const clear = fx?.clear ?? 0;
    // One colour for the polygon, or one a corner (a baked light): then a textured corner's tint is its own colour.
    const per = typeof (colour as readonly unknown[])[0] !== "number";
    const flat = (per ? [1, 1, 1] : colour) as Rgb;
    const tint0 = surface === undefined ? flat : tintOf(surface, flat);
    for (let pointIndex = 0; pointIndex < n; pointIndex++) {
      const p = points[pointIndex] as Vec3;
      const colourHere = (per ? (colour as readonly Rgb[])[pointIndex] ?? flat : flat) as Rgb;
      // A corner's own colour, times the surface's gain (a layer whose picture is darker than the paint it carries is lifted by it).
      const gain = surface?.tint ?? ONE;
      const tint: Rgb = per && surface !== undefined ? [colourHere[0] * gain[0], colourHere[1] * gain[1], colourHere[2] * gain[2]] : tint0;
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(colourHere[0], colourHere[1], colourHere[2], 1);
      if (basis === null || surface === undefined) {
        const cuv = fx?.uvs?.[pointIndex];
        this.uv.push(cuv?.[0] ?? 0, cuv?.[1] ?? 0);
        // A pane's own data rides in the floats a flat vertex does not use (`townMaterial.ts` says which).
        this.srf.push(NO_LAYER, fx?.dirt ?? 0, fx?.seed ?? 0, glow, 1, 1, 1, clear, fx?.size?.[0] ?? 0, fx?.size?.[1] ?? 0, fx?.tilt?.[0] ?? 0, fx?.rank ?? fx?.tilt?.[1] ?? 0);
      } else {
        const [u, v] = uvAt(basis, p);
        this.uv.push(u, v);
        const wear = surface.wear === undefined ? 0 : typeof surface.wear === "number" ? surface.wear : surface.wear(p);
        const w2 = surface.wear2 === undefined ? 0 : typeof surface.wear2 === "number" ? surface.wear2 : surface.wear2(p);
        this.srf.push(layer, Math.min(1, Math.max(0, wear)), kind, glow, tint[0], tint[1], tint[2], clear, Math.min(1, Math.max(0, w2)), kind2, 0, fx?.rank ?? 0);
      }
    }
    // The fan 0, i, i+1 turns right-handed in the corners' order, which is with the normal when the order was not flipped:
    // wind it against the normal, as the engine's boxes are (reversed from the fan when the order already faces the hint).
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push(base, base + i, base + i + 1);
      else this.idx.push(base, base + i + 1, base + i);
    }
  }

  /**
   * A flat polygon mapped to explicit UVs (one per corner, in the corners' order): for a face of the sign atlas (`signAtlas.ts`), whose
   * texels the sign's own plugin reads by the UV as given. It carries no layer (`NO_LAYER`), a tint and a glow.
   */
  polyUv(points: readonly Vec3[], uvs: readonly (readonly [number, number])[], hint: Vec3, tint: Rgb, fx?: Fx): void {
    const base = this.vertices;
    const n = points.length;
    if (n < 3) return;
    if (MeshBuilder.trace) this.tag(this.idx.length / 3);
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
    const flip = (nx * hint[0] + ny * hint[1] + nz * hint[2]) / len < 0;
    const k = flip ? -1 / len : 1 / len;
    points.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx * k, ny * k, nz * k);
      this.col.push(tint[0], tint[1], tint[2], 1);
      const uv = uvs[i] as readonly [number, number];
      this.uv.push(uv[0], uv[1]);
      this.srf.push(NO_LAYER, 0, 0, fx?.glow ?? 0, tint[0], tint[1], tint[2], fx?.clear ?? 0, 0, 0, 0, 0);
    });
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push(base, base + i, base + i + 1);
      else this.idx.push(base, base + i + 1, base + i);
    }
  }

  /**
   * A flat grid of quads with shared corners, for a surface lit by a baked light: from `origin` along `du` (to its end) and `dv`, with
   * its lines at the fractions `us` and `vs` (each from 0 to 1, ascending), facing `hint`'s side. `colourAt(i, j, p)` is the colour at the
   * corner on line `i` of `us` and `j` of `vs` (the paint times the light there); a textured grid takes it as its tint.
   */
  litGrid(origin: Vec3, du: Vec3, dv: Vec3, us: readonly number[], vs: readonly number[], hint: Vec3, colourAt: (i: number, j: number, p: Vec3) => Rgb, surface?: Surface, fx?: Fx): void {
    const nu = us.length;
    const nv = vs.length;
    if (nu < 2 || nv < 2) return;
    let nx = du[1] * dv[2] - du[2] * dv[1];
    let ny = du[2] * dv[0] - du[0] * dv[2];
    let nz = du[0] * dv[1] - du[1] * dv[0];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-12)) return;
    const flip = (nx * hint[0] + ny * hint[1] + nz * hint[2]) / len < 0;
    const k = (flip ? -1 : 1) / len;
    nx *= k;
    ny *= k;
    nz *= k;
    const base = this.vertices;
    if (MeshBuilder.trace) this.tag(this.idx.length / 3);
    const basis = surface === undefined ? null : basisOf(surface);
    const layer = surface === undefined ? NO_LAYER : layerIndex(surface.layer);
    const glow = fx?.glow ?? 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = us[i] as number;
        const b = vs[j] as number;
        const p: Vec3 = [origin[0] + du[0] * a + dv[0] * b, origin[1] + du[1] * a + dv[1] * b, origin[2] + du[2] * a + dv[2] * b];
        const c = colourAt(i, j, p);
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(nx, ny, nz);
        this.col.push(c[0], c[1], c[2], 1);
        if (basis === null) {
          this.uv.push(0, 0);
          this.srf.push(NO_LAYER, 0, 0, glow, 1, 1, 1, 0, 0, 0, 0, 0);
        } else {
          const [u, v] = uvAt(basis, p);
          this.uv.push(u, v);
          const g = surface?.tint ?? ONE;
          this.srf.push(layer, 0, 0, glow, c[0] * g[0], c[1] * g[1], c[2] * g[2], 0, 0, 0, 0, 0);
        }
      }
    }
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const q0 = base + j * nu + i;
        const q1 = q0 + 1;
        const q3 = q0 + nu;
        const q2 = q3 + 1;
        if (flip) this.idx.push(q0, q1, q2, q0, q2, q3);
        else this.idx.push(q0, q2, q1, q0, q3, q2);
      }
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3, colour: Rgb, surface?: Surface, fx?: Fx): void {
    this.poly([a, b, c, d], hint, colour, surface, fx);
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


  /**
   * A smooth-shaded surface through a grid of points (`rows[i][j]`): vertices shared, normals averaged over the quads that meet at
   * them, so a lofted body is round and not faceted. Wound to face away from `inside` (a point inside the shape). Per vertex: a flat colour,
   * and (with `layer`) a tint, a UV in tiles' metres (divided by the layer's tile here) and up to two wears of a kind each. `skip(i, j)` leaves
   * out the quad whose corner is (i, j). Returns nothing for a grid with no area.
   */
  grid(rows: readonly (readonly Vec3[])[], insideIn: Vec3 | readonly Vec3[], v: GridLook, skip?: (i: number, j: number) => boolean): void {
    const nr = rows.length;
    const nc = nr === 0 ? 0 : (rows[0] as readonly Vec3[]).length;
    if (nr < 2 || nc < 2) return;
    const insideOf = (i: number): Vec3 => (typeof (insideIn as readonly unknown[])[0] === "object" ? ((insideIn as readonly Vec3[])[Math.min(i, (insideIn as readonly Vec3[]).length - 1)] as Vec3) : (insideIn as Vec3));
    const nor: number[] = new Array(nr * nc * 3).fill(0);
    const quadN = (i: number, j: number): Vec3 => {
      const a = (rows[i] as readonly Vec3[])[j] as Vec3;
      const b = (rows[i] as readonly Vec3[])[j + 1] as Vec3;
      const c = (rows[i + 1] as readonly Vec3[])[j + 1] as Vec3;
      const d = (rows[i + 1] as readonly Vec3[])[j] as Vec3;
      const ux = c[0] - a[0];
      const uy = c[1] - a[1];
      const uz = c[2] - a[2];
      const wx = d[0] - b[0];
      const wy = d[1] - b[1];
      const wz = d[2] - b[2];
      return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    };
    // Which way is out: the first quad that has area, against the way from `inside` to its corner.
    let sign = 1;
    let votes = 0;
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        const n = quadN(i, j);
        const p = (rows[i] as readonly Vec3[])[j] as Vec3;
        const inside = insideOf(i);
        votes += Math.sign(n[0] * (p[0] - inside[0]) + n[1] * (p[1] - inside[1]) + n[2] * (p[2] - inside[2])) * Math.min(1, Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]));
      }
    }
    if (votes < 0) sign = -1;
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        if (skip?.(i, j) === true) continue;
        const n = quadN(i, j);
        for (const [a, b] of [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]] as const) {
          const k = (a * nc + b) * 3;
          nor[k] = (nor[k] as number) + n[0] * sign;
          nor[k + 1] = (nor[k + 1] as number) + n[1] * sign;
          nor[k + 2] = (nor[k + 2] as number) + n[2] * sign;
        }
      }
    }
    const base = this.vertices;
    if (MeshBuilder.trace) this.tag(this.idx.length / 3);
    const layer = v.layer === undefined ? NO_LAYER : layerIndex(v.layer);
    const tile = v.layer === undefined ? [1, 1] : (TOWN_LAYERS[layerIndex(v.layer)]?.tile ?? [1, 1]);
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const p = (rows[i] as readonly Vec3[])[j] as Vec3;
        const k = (i * nc + j) * 3;
        const l = Math.sqrt((nor[k] as number) * (nor[k] as number) + (nor[k + 1] as number) * (nor[k + 1] as number) + (nor[k + 2] as number) * (nor[k + 2] as number));
        this.pos.push(p[0], p[1], p[2]);
        // A corner of no area (a point where the sheet closes) has no normal of its own: it takes up.
        if (l > 1e-12) this.nor.push((nor[k] as number) / l, (nor[k + 1] as number) / l, (nor[k + 2] as number) / l);
        else this.nor.push(0, 1, 0);
        const c = typeof v.colour === "function" ? v.colour(i, j) : v.colour;
        this.col.push(c[0], c[1], c[2], 1);
        if (layer === NO_LAYER) {
          this.uv.push(0, 0);
          this.srf.push(NO_LAYER, 0, 0, 0, 1, 1, 1, v.clear ?? 0, 0, 0, v.wire === undefined ? 0 : -Math.max(1, Math.round(v.wire * 1000)), 0);
        } else {
          const uv = v.uv === undefined ? [0, 0] : v.uv(i, j);
          this.uv.push(uv[0] / (tile[0] as number), uv[1] / (tile[1] as number));
          const t = typeof v.tint === "function" ? v.tint(i, j) : (v.tint ?? c);
          const w1 = v.wear === undefined ? ([0, "moss"] as const) : v.wear(i, j);
          const w2 = v.wear2 === undefined ? ([0, "moss"] as const) : v.wear2(i, j);
          const k1 = (WEAR_KIND_NUMBER[w1[1]] ?? 0) + (v.streaks === true ? 0.5 : 0);
          const k2 = (WEAR_KIND_NUMBER[w2[1]] ?? 0) + (v.streaks2 === true ? 0.5 : 0);
          this.srf.push(layer, Math.min(1, Math.max(0, w1[0])), k1, 0, t[0], t[1], t[2], v.clear ?? 0, Math.min(1, Math.max(0, w2[0])), k2, 0, 0);
        }
      }
    }
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        if (skip?.(i, j) === true) continue;
        const a = base + i * nc + j;
        const b = a + 1;
        const c = a + nc + 1;
        const d = a + nc;
        // The sum of the quad's normal faces out when `sign` is 1; wind so the engine's front face looks out (as `poly` does).
        if (sign > 0) this.idx.push(a, c, b, a, d, c);
        else this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /**
   * The finished arrays. No triangle is laid twice (the same three corners, wound the same way, in the same look): the builders that make one
   * place twice (a post where two runs meet, a pile two spans share) share it or leave it out, and `depthSeparation.test.ts` holds the whole
   * town to that, so that this step stays a copy.
   */
  finish(): MeshArrays {
    const arrays: MeshArrays = {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col),
      uvs: new Float32Array(this.uv), surface: new Float32Array(this.srf), indices: Uint32Array.from(this.idx),
    };
    if (MeshBuilder.trace) MeshBuilder.traced.set(arrays, this.tags.map(([t, s]): [number, string] => [t, s]));
    return arrays;
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
