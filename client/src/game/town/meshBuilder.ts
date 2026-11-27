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
import { NO_LAYER, layerIndex, townLayer, type LayerName } from "./townLayers.js";
import { WEAR_KIND_NUMBER, basisOf, tintOf, uvAt, type Cut, type Fx, type Surface, type WearKind } from "./townSurface.js";
import { DOOR_ALPHA, KNOCK_ALPHA, paintAlpha } from "./paint.js";

/** True while a thing a car knocks down is being laid (`withKnock`), in whichever builders its pieces land. */
let knocking = false;

/**
 * Runs `fn` with every polygon it lays, in any builder, tagged as part of a thing a car knocks down (`sim/town/knockables.ts`): its corners carry
 * `KNOCK_ALPHA` as their colour's alpha, which the town's vertex stage reads as "falls with what stands here". Puts back the tag it found.
 */
export function withKnock<T>(fn: () => T): T {
  const before = knocking;
  knocking = true;
  try {
    return fn();
  } finally {
    knocking = before;
  }
}
import { FALLBACK, currentMat, isMat, matLook, matSurface, unnamed, type MatRef } from "./materials.js";

export type Vec3 = readonly [number, number, number];

/** How `MeshBuilder.grid` dresses a grid of points: colour per vertex, and optionally a texture layer with its tint, UV (metres) and two wears. */
export type GridLook = {
  readonly colour: Rgb | ((i: number, j: number) => Rgb);
  readonly layer?: LayerName;
  /** With no `layer`: the material the grid is of (`materials.ts`), in the place of the one its builder is working in. Laid by the grid's own lines, at true scale. */
  readonly mat?: MatRef;
  readonly tint?: Rgb | ((i: number, j: number) => Rgb);
  readonly uv?: (i: number, j: number) => readonly [number, number];
  readonly wear?: (i: number, j: number) => readonly [number, WearKind];
  readonly wear2?: (i: number, j: number) => readonly [number, WearKind];
  readonly streaks?: boolean;
  readonly streaks2?: boolean;
  readonly clear?: number;
  /** A wire's radius, metres: the vertex shader keeps it at least a pixel and a bit wide at any distance, and the fragment fades it by the same factor (`townMaterial.ts`, `WIRE_CODE`). */
  readonly wire?: number;
  /** Also lay the grid's back (the same quads wound the other way, normals reversed), in this colour (a function of the corner) or, for `true`, the front's darkened. */
  readonly back?: true | Rgb | ((i: number, j: number) => Rgb);
};
export type Rgb = readonly [number, number, number];

/**
 * A finished mesh's arrays, as `createMeshFromData` takes them (colours four floats a vertex), with the two a textured
 * material reads: `uvs` (two floats a vertex, in texture tiles: metres over the layer's tile size) and `surface` (twelve floats
 * a vertex: the layer's index or `NO_LAYER`, the wear's amount 0 to 1, the wear's kind (`WEAR_KIND_NUMBER`, plus a half for streaks), the glow
 * (0 lit by the scene, 1 lit by itself); then the tint, red, green, blue, and how clear it is (0 opaque); then the second wear's amount and
 * kind, and two floats that say where a textured corner stands under the sky, `skyShade.ts`). `colors` is the flat colour, as before.
 */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; surface: Float32Array; indices: Uint32Array };

/** Floats a vertex's `surface` holds. */
export const SURFACE_FLOATS = 12;

const ONE: Rgb = [1, 1, 1];

/** A corner nearer a cut than this, metres, is on it. */
const CUT_NEAR = 1e-3;

/** A convex polygon cut along each of `cuts` it lies across: the convex pieces, which together are the polygon (itself alone when no cut crosses it). */
export function cutBy(points: readonly Vec3[], cuts: readonly Cut[]): (readonly Vec3[])[] {
  let pieces: (readonly Vec3[])[] = [points];
  for (const c of cuts) {
    const next: (readonly Vec3[])[] = [];
    for (const poly of pieces) {
      const d = poly.map((p) => c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3]);
      if (!d.some((v) => v > CUT_NEAR) || !d.some((v) => v < -CUT_NEAR)) {
        next.push(poly);
        continue;
      }
      const over: Vec3[] = [];
      const under: Vec3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i] as Vec3;
        const q = poly[(i + 1) % poly.length] as Vec3;
        const dp = d[i] as number;
        const dq = d[(i + 1) % poly.length] as number;
        // A corner on the cut is a corner of both pieces.
        if (dp >= -CUT_NEAR) over.push(p);
        if (dp <= CUT_NEAR) under.push(p);
        if ((dp > CUT_NEAR && dq < -CUT_NEAR) || (dp < -CUT_NEAR && dq > CUT_NEAR)) {
          const t = dp / (dp - dq);
          const m: Vec3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
          over.push(m);
          under.push(m);
        }
      }
      if (over.length >= 3) next.push(over);
      if (under.length >= 3) next.push(under);
    }
    pieces = next;
  }
  return pieces;
}

/**
 * A run of 32-bit numbers that grows: what a builder keeps its vertices in. Not a plain array, which holds eight bytes a number where the
 * mesh will hold four, and is copied whole into a typed array at the end: a town's 36 million numbers were 290 MB of the tab's memory while
 * it was built, and 146 MB more as they were copied. It doubles as it fills, and `taken` hands over exactly what was written.
 */
abstract class Run<T extends Float32Array | Uint32Array> {
  data: T;
  length = 0;
  protected constructor(first: T) {
    this.data = first;
  }
  protected abstract make(size: number): T;
  /** Room for `more` numbers after the last. */
  protected room(more: number): void {
    if (this.length + more <= this.data.length) return;
    let size = Math.max(256, this.data.length * 2);
    while (size < this.length + more) size *= 2;
    const grown = this.make(size);
    grown.set(this.data.subarray(0, this.length) as unknown as ArrayLike<number>);
    this.data = grown;
  }
  /** A copy of what was written, no longer than it. */
  copy(): T {
    return this.data.slice(0, this.length) as T;
  }
  /** What was written, and the run is left empty (its storage let go). */
  taken(): T {
    const out = this.copy();
    this.data = this.make(0);
    this.length = 0;
    return out;
  }
  /** Writes a copy of the numbers from index `from` up to the end after them, and returns where the copy starts. */
  repeat(from: number): number {
    const at = this.length;
    const count = at - from;
    this.room(count);
    this.data.copyWithin(at, from, at);
    this.length = at + count;
    return at;
  }
  push2(a: number, b: number): void {
    this.room(2);
    const d = this.data;
    const i = this.length;
    d[i] = a;
    d[i + 1] = b;
    this.length = i + 2;
  }
  push3(a: number, b: number, c: number): void {
    this.room(3);
    const d = this.data;
    const i = this.length;
    d[i] = a;
    d[i + 1] = b;
    d[i + 2] = c;
    this.length = i + 3;
  }
  push4(a: number, b: number, c: number, e: number): void {
    this.room(4);
    const d = this.data;
    const i = this.length;
    d[i] = a;
    d[i + 1] = b;
    d[i + 2] = c;
    d[i + 3] = e;
    this.length = i + 4;
  }
  push6(a: number, b: number, c: number, e: number, f: number, g: number): void {
    this.push3(a, b, c);
    this.push3(e, f, g);
  }
  push12(a: number, b: number, c: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number): void {
    this.push4(a, b, c, e);
    this.push4(f, g, h, i);
    this.push4(j, k, l, m);
  }
}
class Floats extends Run<Float32Array> {
  constructor() {
    super(new Float32Array(0));
  }
  protected make(size: number): Float32Array {
    return new Float32Array(size);
  }
}
class Ints extends Run<Uint32Array> {
  constructor() {
    super(new Uint32Array(0));
  }
  protected make(size: number): Uint32Array {
    return new Uint32Array(size);
  }
}

export class MeshBuilder {
  /** Debugging: when set, each polygon records where in the builders it was made (`tags`: its first triangle's index, and the callers), for a script that hunts overlaps. Off in the game. */
  static trace = false;
  /** With `trace` on, the tags of each finished mesh, by its arrays (the finder reads them to say where a pair came from). */
  static readonly traced = new WeakMap<object, [number, string][]>();
  readonly tags: [number, string][] = [];
  private tag(from: number): void {
    const lines = (new Error().stack ?? "").split("\n").slice(2).filter((l) => !l.includes("meshBuilder") && !l.includes("/surface.ts")).slice(0, 4);
    this.tags.push([from, lines.map((l) => l.replace(/^\s*at\s+(?:async\s+)?(?:new\s+)?(\S+)\s+\(.*\/(game|test)\/town\//, "$1 ").replace(/^.*\/(game|test)\/town\//, "").replace(/\)$/, "")).join(" < ")]);
  }
  /**
   * Whether every face this builder lays also gets its back: the same corners, wound the other way, with their normals turned round and
   * everything else (colour, surface, glow, hours) as they were. The town's materials cull back faces, so a single sheet is not there from
   * behind; a room a player stands in (`insideGeometry.ts`) is seen from every side, and is built in this mode so that no face of it is
   * see-through from any side, whichever builder laid it. A face that asks for a back of its own (`Fx.back`, a grid's `back`) keeps that one.
   */
  private readonly backs: boolean;
  /** True while a back of its own (`Fx.back`) is being laid, which is not given a back in its turn. */
  private backing = false;

  constructor(backs = false) {
    this.backs = backs;
  }

  private pos = new Floats();
  private nor = new Floats();
  private col = new Floats();
  private uv = new Floats();
  private srf = new Floats();
  private idx = new Ints();
  /** The hours code (`hours.ts`) every layered polygon laid now carries in its float 10 (0: none). Set by `withHours`. */
  private hoursCode = 0;

  /** The glow (`Fx.glow`) every polygon laid now takes when it names none: a lamp's lens or a lit sign is built by boxes and cylinders that cannot say it. Set by `withGlow`. */
  private glowBase = 0;

  /** Runs `fn` with `glow` as the glow of every polygon it lays that names none of its own, and puts back the one before. */
  withGlow<T>(glow: number, fn: () => T): T {
    const before = this.glowBase;
    this.glowBase = glow;
    try {
      return fn();
    } finally {
      this.glowBase = before;
    }
  }

  /** Runs `fn` with `code` as the hours every layered polygon it lays carries (a room's, `roomGeometry.ts`), and puts back the one before. */
  withHours<T>(code: number, fn: () => T): T {
    const before = this.hoursCode;
    this.hoursCode = code;
    try {
      return fn();
    } finally {
      this.hoursCode = before;
    }
  }
  /** True while the leaf of a door that can open is being laid (`withLeaf`): its corners carry `DOOR_ALPHA` as their colour's alpha, which the town's vertex stage reads as "turns with the door". */
  private leaf = false;
  /**
   * Where the panes marked `through` (`PaneLook.through`) are laid in place of here: the builder of their own layer, which the glass's builder of a cell is given where the renderer
   * draws them opaque (`townBlur.ts`). None: they are laid here, with the rest of the glass.
   */
  marked: MeshBuilder | null = null;

  /** Runs `fn` with every polygon it lays tagged as a part of a door's leaf (`openDoors.ts`), and puts back the tag it found. The builder the marked panes go to has it too. */
  withLeaf<T>(fn: () => T): T {
    const before = this.leaf;
    const mark = this.marked;
    const markBefore = mark?.leaf ?? false;
    this.leaf = true;
    if (mark !== null) mark.leaf = true;
    try {
      return fn();
    } finally {
      this.leaf = before;
      if (mark !== null) mark.leaf = markBefore;
    }
  }
  /** True while the pieces of a polygon cut along its shade's planes are being laid (`poly`): a piece is not cut again. */
  private cutting = false;

  get vertices(): number {
    return this.pos.length / 3;
  }

  /**
   * In the mode that lays backs (`backs`): the back of what was laid since vertex `vFrom` and triangle index `iFrom`. Its vertices are copies of the
   * front's with the normals turned round, and each triangle is the front's reversed, over the copies.
   */
  private layBack(vFrom: number, iFrom: number): void {
    if (!this.backs || this.backing) return;
    const vEnd = this.vertices;
    const iEnd = this.idx.length;
    if (vEnd === vFrom) return;
    const at = this.pos.repeat(vFrom * 3) / 3;
    const n = this.nor.repeat(vFrom * 3);
    for (let i = n; i < this.nor.length; i++) this.nor.data[i] = -(this.nor.data[i] as number);
    this.col.repeat(vFrom * 4);
    this.uv.repeat(vFrom * 2);
    this.srf.repeat(vFrom * SURFACE_FLOATS);
    const shift = at - vFrom;
    for (let t = iFrom; t < iEnd; t += 3) {
      const a = this.idx.data[t] as number;
      const b = this.idx.data[t + 1] as number;
      const c = this.idx.data[t + 2] as number;
      this.idx.push3(c + shift, b + shift, a + shift);
    }
  }

  /** Calls `fn` with the position of each vertex from vertex number `from` on (for a part that wants its own extent or a fingerprint). */
  forEachPosition(from: number, fn: (x: number, y: number, z: number) => void): void {
    for (let i = from * 3; i < this.pos.length; i += 3) fn(this.pos.data[i] as number, this.pos.data[i + 1] as number, this.pos.data[i + 2] as number);
  }

  /** A fingerprint of the geometry from vertex `from` on: positions to a centimetre, folded in order (FNV-1a), as an unsigned 32-bit number. */
  hashFrom(from: number): number {
    let h = 0x811c9dc5;
    for (let i = from * 3; i < this.pos.length; i++) {
      h ^= Math.round((this.pos.data[i] as number) * 100) | 0;
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
  poly(points: readonly Vec3[], hint: Vec3, colour: Rgb | readonly Rgb[], given?: Surface | MatRef, fx?: Fx): void {
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
    // Nothing opaque is a flat colour: a polygon given no surface takes its material's (`materials.ts`), lit by the scene or by itself. Glass stays as it is.
    let surface: Surface | undefined = isMat(given) ? undefined : given;
    if (surface === undefined && !((fx?.clear ?? 0) > 0)) {
      const mat = isMat(given) ? given : currentMat();
      if (mat === null) unnamed.polygons++;
      surface = matSurface(mat ?? FALLBACK, points, [nx, ny, nz], typeof (colour as readonly unknown[])[0] === "number" ? (colour as Rgb) : null);
    }
    // A surface that carries a shade (`skyShade.ts`) is cut along the planes its codes bend at, and each piece laid as a polygon of its own, of the
    // whole polygon's surface (a material's grain runs along the polygon's longest edge, not a piece's). Not a polygon coloured or mapped by
    // the corner: a piece's corners are not the polygon's.
    if (!this.cutting && surface?.shade !== undefined && surface.shade.cuts.length > 0 && typeof (colour as readonly unknown[])[0] === "number" && fx?.uvs === undefined) {
      const pieces = cutBy(points, surface.shade.cuts);
      if (pieces.length > 1) {
        this.cutting = true;
        try {
          for (const piece of pieces) this.poly(piece, [nx, ny, nz], colour, surface, fx);
        } finally {
          this.cutting = false;
        }
        return;
      }
    }
    const basis = surface === undefined ? null : basisOf(surface);
    const layer = surface === undefined ? NO_LAYER : layerIndex(surface.layer);
    const kind = (WEAR_KIND_NUMBER[surface?.wearKind ?? "moss"] ?? 0) + (surface?.streaks === true ? 0.5 : 0);
    const kind2 = (WEAR_KIND_NUMBER[surface?.wearKind2 ?? "moss"] ?? 0) + (surface?.streaks2 === true ? 0.5 : 0);
    const glow = fx?.glow ?? this.glowBase;
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
      this.pos.push3(p[0], p[1], p[2]);
      if (fx?.normal === undefined) this.nor.push3(nx, ny, nz);
      else this.nor.push3(fx.normal[0], fx.normal[1], fx.normal[2]);
      this.col.push4(colourHere[0], colourHere[1], colourHere[2], this.leaf ? DOOR_ALPHA : knocking ? KNOCK_ALPHA : fx?.paint === undefined ? 1 : paintAlpha(fx.paint));
      if (basis === null || surface === undefined) {
        const cuv = fx?.uvs?.[pointIndex];
        this.uv.push2(cuv?.[0] ?? 0, cuv?.[1] ?? 0);
        // A pane's own data rides in the floats a flat vertex does not use (`townMaterial.ts` says which).
        this.srf.push12(NO_LAYER, fx?.dirt ?? 0, fx?.seed ?? 0, glow, 1, 1, 1, clear, fx?.size?.[0] ?? 0, fx?.size?.[1] ?? 0, fx?.tilt?.[0] ?? 0, fx?.rank ?? fx?.tilt?.[1] ?? 0);
      } else {
        const [u, v] = uvAt(basis, p);
        this.uv.push2(u, v);
        const wear = surface.wear === undefined ? 0 : typeof surface.wear === "number" ? surface.wear : surface.wear(p);
        const w2 = surface.wear2 === undefined ? 0 : typeof surface.wear2 === "number" ? surface.wear2 : surface.wear2(p);
        // Where the corner stands under the sky (`skyShade.ts`): its two codes, in the two floats a textured corner leaves unused. The first is a
        // room's hours where the corner is a room's (`withHours`): a foot's code is under a half and an hours' is 1 or more, so the material tells
        // them apart. The second is the flat ground's depth rank where it has one (`Fx.rank`), and the ground's material does not read it as a code.
        const sky = surface.shade?.at(p);
        this.srf.push12(layer, Math.min(1, Math.max(0, wear)), kind, glow, tint[0], tint[1], tint[2], clear, Math.min(1, Math.max(0, w2)), kind2, this.hoursCode > 0 ? this.hoursCode : (sky?.[0] ?? 0), fx?.rank ?? sky?.[1] ?? 0);
      }
    }
    // The fan 0, i, i+1 turns right-handed in the corners' order, which is with the normal when the order was not flipped:
    // wind it against the normal, as the engine's boxes are (reversed from the fan when the order already faces the hint).
    const iFrom = this.idx.length;
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push3(base, base + i, base + i + 1);
      else this.idx.push3(base, base + i + 1, base + i);
    }
    // A back with no look of its own is of what the front is: its material, or its surface a shade darker.
    if (fx?.back !== undefined) this.twin(points, [-nx, -ny, -nz], colour, fx, given);
    else this.layBack(base, iFrom);
  }

  /**
   * A flat sheet of shared corners, for a pane-like see-through effect that reads its own numbers from a corner (the dark under a vehicle,
   * `props/vehicleShade.ts`): `points` with a `uvs` each, laid as the triangles `tris` (three indices each, in any order: each is wound to face
   * `hint`). The corners carry `fx` as `poly` carries it for a polygon with no surface.
   */
  sheet(points: readonly Vec3[], uvs: readonly (readonly [number, number])[], tris: readonly number[], hint: Vec3, colour: Rgb, fx: Fx): void {
    const base = this.vertices;
    if (MeshBuilder.trace) this.tag(this.idx.length / 3);
    const glow = fx.glow ?? this.glowBase;
    points.forEach((p, i) => {
      const uv = uvs[i] as readonly [number, number];
      this.pos.push3(p[0], p[1], p[2]);
      this.nor.push3(hint[0], hint[1], hint[2]);
      this.col.push4(colour[0], colour[1], colour[2], knocking ? KNOCK_ALPHA : 1);
      this.uv.push2(uv[0], uv[1]);
      this.srf.push12(NO_LAYER, fx.dirt ?? 0, fx.seed ?? 0, glow, 1, 1, 1, fx.clear ?? 0, fx.size?.[0] ?? 0, fx.size?.[1] ?? 0, fx.tilt?.[0] ?? 0, fx.rank ?? fx.tilt?.[1] ?? 0);
    });
    const iFrom = this.idx.length;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t] as number;
      const b = tris[t + 1] as number;
      const c = tris[t + 2] as number;
      const pa = points[a] as Vec3;
      const pb = points[b] as Vec3;
      const pc = points[c] as Vec3;
      const nx = (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]);
      const ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      const nz = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      // The engine's front face is the one the triangle's corners turn against (as `poly` winds them).
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) this.idx.push3(base + a, base + b, base + c);
      else this.idx.push3(base + a, base + c, base + b);
    }
    this.layBack(base, iFrom);
  }

  /** The back of a polygon just laid (`Fx.back`): the same corners, facing `hint` (the front's normal reversed), in the back's own look. */
  private twin(points: readonly Vec3[], hint: Vec3, colour: Rgb | readonly Rgb[], fx: Fx, front?: Surface | MatRef): void {
    const back = fx.back as Exclude<Fx["back"], undefined>;
    const own = back === true ? undefined : back;
    const dark = (c: Rgb): Rgb => greyed(scaled(c, 0.7), 0.25);
    const col: Rgb | readonly Rgb[] = own?.colour ?? (typeof (colour as readonly unknown[])[0] === "number" ? dark(colour as Rgb) : (colour as readonly Rgb[]).map(dark));
    const like: Surface | MatRef | undefined = front === undefined || isMat(front) || front.tint === undefined ? front : { ...front, tint: scaled(front.tint, 0.7) };
    const before = this.backing;
    this.backing = true;
    try {
      this.poly(points, hint, col, own?.surface ?? like, fx.normal === undefined ? {} : { normal: [-fx.normal[0], -fx.normal[1], -fx.normal[2]] });
    } finally {
      this.backing = before;
    }
  }

  /**
   * A flat polygon mapped to explicit UVs (one per corner, in the corners' order): for a face of the sign atlas (`signAtlas.ts`), whose
   * texels the sign's own plugin reads by the UV as given. It carries no layer (`NO_LAYER`), a tint, a glow and, from `withHours`, the hours the glow follow (a face that does not glow has no hours to follow)s (a lit sign's: the sign layer's material reads them as a room's).
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
      this.pos.push3(p[0], p[1], p[2]);
      this.nor.push3(nx * k, ny * k, nz * k);
      this.col.push4(tint[0], tint[1], tint[2], this.leaf ? DOOR_ALPHA : knocking ? KNOCK_ALPHA : fx?.paint === undefined ? 1 : paintAlpha(fx.paint));
      const uv = uvs[i] as readonly [number, number];
      this.uv.push2(uv[0], uv[1]);
      this.srf.push12(NO_LAYER, 0, 0, fx?.glow ?? this.glowBase, tint[0], tint[1], tint[2], fx?.clear ?? 0, 0, 0, (fx?.glow ?? this.glowBase) > 0 ? this.hoursCode : 0, 0);
    });
    const iFrom = this.idx.length;
    for (let i = 1; i < n - 1; i++) {
      if (flip) this.idx.push3(base, base + i, base + i + 1);
      else this.idx.push3(base, base + i + 1, base + i);
    }
    this.layBack(base, iFrom);
  }

  /**
   * A flat grid of quads with shared corners, for a surface lit by a baked light: from `origin` along `du` (to its end) and `dv`, with
   * its lines at the fractions `us` and `vs` (each from 0 to 1, ascending), facing `hint`'s side. `colourAt(i, j, p)` is the colour at the
   * corner on line `i` of `us` and `j` of `vs` (the paint times the light there); a textured grid takes it as its tint.
   */
  litGrid(origin: Vec3, du: Vec3, dv: Vec3, us: readonly number[], vs: readonly number[], hint: Vec3, colourAt: (i: number, j: number, p: Vec3) => Rgb, given?: Surface | MatRef, fx?: Fx): void {
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
    // As `poly`: a grid given no surface takes its material's.
    let surface: Surface | undefined = isMat(given) ? undefined : given;
    if (surface === undefined && !((fx?.clear ?? 0) > 0)) {
      const mat = isMat(given) ? given : currentMat();
      if (mat === null) unnamed.polygons++;
      surface = matSurface(mat ?? FALLBACK, [origin, [origin[0] + du[0], origin[1] + du[1], origin[2] + du[2]], [origin[0] + dv[0], origin[1] + dv[1], origin[2] + dv[2]]], [nx, ny, nz], null);
    }
    const basis = surface === undefined ? null : basisOf(surface);
    const layer = surface === undefined ? NO_LAYER : layerIndex(surface.layer);
    const glow = fx?.glow ?? 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = us[i] as number;
        const b = vs[j] as number;
        const p: Vec3 = [origin[0] + du[0] * a + dv[0] * b, origin[1] + du[1] * a + dv[1] * b, origin[2] + du[2] * a + dv[2] * b];
        const c = colourAt(i, j, p);
        this.pos.push3(p[0], p[1], p[2]);
        this.nor.push3(nx, ny, nz);
        this.col.push4(c[0], c[1], c[2], knocking ? KNOCK_ALPHA : 1);
        if (basis === null) {
          this.uv.push2(0, 0);
          this.srf.push12(NO_LAYER, 0, 0, glow, 1, 1, 1, 0, 0, 0, 0, 0);
        } else {
          const [u, v] = uvAt(basis, p);
          this.uv.push2(u, v);
          const g = surface?.tint ?? ONE;
          this.srf.push12(layer, 0, 0, glow, c[0] * g[0], c[1] * g[1], c[2] * g[2], 0, 0, 0, this.hoursCode, 0);
        }
      }
    }
    const iFrom = this.idx.length;
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const q0 = base + j * nu + i;
        const q1 = q0 + 1;
        const q3 = q0 + nu;
        const q2 = q3 + 1;
        if (flip) this.idx.push6(q0, q1, q2, q0, q2, q3);
        else this.idx.push6(q0, q2, q1, q0, q3, q2);
      }
    }
    this.layBack(base, iFrom);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3, colour: Rgb, surface?: Surface | MatRef, fx?: Fx): void {
    this.poly([a, b, c, d], hint, colour, surface, fx);
  }

  /**
   * A vertical wall from `a` to `b` (two points of one height, or any two) up to `top` and down to `bottom`, facing
   * `hint`'s side: the horizontal direction it looks along.
   */
  wall(ax: number, az: number, bx: number, bz: number, bottom: number, top: number, hint: Vec3, colour: Rgb, surface?: Surface | MatRef): void {
    this.poly([[ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az]], hint, colour, surface);
  }

  /** An axis-aligned-in-a-turned-frame box: centre (x, z), base y, along axis (ux, uz), half extents, height; every face but the bottom, which `bottomFace` (its colour) adds: asked for by anything raised off the ground. */
  box(cx: number, cz: number, y0: number, ux: number, uz: number, halfU: number, halfV: number, height: number, side: Rgb, top: Rgb, topFace = true, bottomFace: Rgb | null | undefined = undefined): void {
    const vx = uz;
    const vz = -ux;
    const c = (su: number, sv: number): [number, number] => [cx + ux * halfU * su + vx * halfV * sv, cz + uz * halfU * su + vz * halfV * sv];
    const y1 = y0 + height;
    const [p00, p10, p11, p01] = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    this.wall(p00[0], p00[1], p10[0], p10[1], y0, y1, [-vx, 0, -vz], side);
    this.wall(p10[0], p10[1], p11[0], p11[1], y0, y1, [ux, 0, uz], side);
    this.wall(p11[0], p11[1], p01[0], p01[1], y0, y1, [vx, 0, vz], side);
    this.wall(p01[0], p01[1], p00[0], p00[1], y0, y1, [-ux, 0, -uz], side);
    if (topFace) this.poly([[p00[0], y1, p00[1]], [p10[0], y1, p10[1]], [p11[0], y1, p11[1]], [p01[0], y1, p01[1]]], [0, 1, 0], top);
    const under = bottomFace === undefined ? scaled(side, 0.55) : bottomFace;
    if (under !== null) this.poly([[p00[0], y0, p00[1]], [p10[0], y0, p10[1]], [p11[0], y0, p11[1]], [p01[0], y0, p01[1]]], [0, -1, 0], under);
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
    // A room that is seen from every side (`backs`) has a drum's underside too, which a hung lamp shows.
    if (this.backs && radius > 0) this.poly(ring.map(([c, s]): Vec3 => [cx + c * radius, y0, cz + s * radius]), [0, -1, 0], scaled(side, 0.6));
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
  grid(rows: readonly (readonly Vec3[])[], insideIn: Vec3 | readonly Vec3[], v: GridLook, skip?: (i: number, j: number) => boolean, reversed = false): void {
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
    if (reversed) sign = -sign;
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
    const tile = v.layer === undefined ? [1, 1] : townLayer(v.layer).tile;
    // Nothing opaque is a flat colour: a grid with no layer takes its material's (a wire and glass stay as they are).
    let auto: ReturnType<typeof matLook> | null = null;
    if (v.layer === undefined && v.wire === undefined && !((v.clear ?? 0) > 0)) {
      const mat = v.mat ?? currentMat();
      if (mat === null) unnamed.polygons++;
      auto = matLook(mat ?? FALLBACK);
    }
    const autoLayer = auto === null ? NO_LAYER : layerIndex(auto.layer);
    const autoU: number[] = [];
    const autoV: number[] = [];
    if (auto !== null) {
      const first = (rows[0] as readonly Vec3[])[0] as Vec3;
      const dist = (a: Vec3, b: Vec3): number => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nc; j++) {
          const p = (rows[i] as readonly Vec3[])[j] as Vec3;
          autoU.push(j === 0 ? first[0] + first[2] : (autoU[i * nc + j - 1] as number) + dist(p, (rows[i] as readonly Vec3[])[j - 1] as Vec3));
          autoV.push(i === 0 ? first[1] : (autoV[(i - 1) * nc + j] as number) + dist(p, (rows[i - 1] as readonly Vec3[])[j] as Vec3));
        }
      }
    }
    const autoKind = auto === null ? 0 : (WEAR_KIND_NUMBER[auto.wearKind] ?? 0);
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const p = (rows[i] as readonly Vec3[])[j] as Vec3;
        const k = (i * nc + j) * 3;
        const l = Math.sqrt((nor[k] as number) * (nor[k] as number) + (nor[k + 1] as number) * (nor[k + 1] as number) + (nor[k + 2] as number) * (nor[k + 2] as number));
        this.pos.push3(p[0], p[1], p[2]);
        // A corner of no area (a point where the sheet closes) has no normal of its own: it takes up.
        if (l > 1e-12) this.nor.push3((nor[k] as number) / l, (nor[k + 1] as number) / l, (nor[k + 2] as number) / l);
        else this.nor.push3(0, 1, 0);
        const c = typeof v.colour === "function" ? v.colour(i, j) : v.colour;
        this.col.push4(c[0], c[1], c[2], knocking ? KNOCK_ALPHA : 1);
        if (auto !== null) {
          // By the grid's own lines: the metres run along its row and down its column to this corner (so the texture is at true scale and
          // follows the body round), from a place of the body's own.
          this.uv.push2((autoU[i * nc + j] as number) / auto.tile[0], (autoV[i * nc + j] as number) / auto.tile[1]);
          const t = auto.tint(c);
          this.srf.push12(autoLayer, auto.wear, autoKind, 0, t[0], t[1], t[2], 0, 0, 0, this.hoursCode, 0);
        } else if (layer === NO_LAYER) {
          this.uv.push2(0, 0);
          this.srf.push12(NO_LAYER, 0, 0, 0, 1, 1, 1, v.clear ?? 0, 0, 0, v.wire === undefined ? 0 : -Math.max(1, Math.round(v.wire * 1000)), 0);
        } else {
          const uv = v.uv === undefined ? [0, 0] : v.uv(i, j);
          this.uv.push2(uv[0] / (tile[0] as number), uv[1] / (tile[1] as number));
          const t = typeof v.tint === "function" ? v.tint(i, j) : (v.tint ?? c);
          const w1 = v.wear === undefined ? ([0, "moss"] as const) : v.wear(i, j);
          const w2 = v.wear2 === undefined ? ([0, "moss"] as const) : v.wear2(i, j);
          const k1 = (WEAR_KIND_NUMBER[w1[1]] ?? 0) + (v.streaks === true ? 0.5 : 0);
          const k2 = (WEAR_KIND_NUMBER[w2[1]] ?? 0) + (v.streaks2 === true ? 0.5 : 0);
          this.srf.push12(layer, Math.min(1, Math.max(0, w1[0])), k1, 0, t[0], t[1], t[2], v.clear ?? 0, Math.min(1, Math.max(0, w2[0])), k2, this.hoursCode, 0);
        }
      }
    }
    const iFrom = this.idx.length;
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < nc - 1; j++) {
        if (skip?.(i, j) === true) continue;
        const a = base + i * nc + j;
        const b = a + 1;
        const c = a + nc + 1;
        const d = a + nc;
        // The sum of the quad's normal faces out when `sign` is 1; wind so the engine's front face looks out (as `poly` does).
        if (sign > 0) this.idx.push6(a, c, b, a, d, c);
        else this.idx.push6(a, b, c, a, c, d);
      }
    }
    if (v.back === undefined && !reversed) this.layBack(base, iFrom);
    if (v.back !== undefined && !reversed) {
      const front = v.colour;
      const dark = (c: Rgb): Rgb => greyed(scaled(c, 0.7), 0.25);
      const colour = v.back === true ? (typeof front === "function" ? (i: number, j: number): Rgb => dark(front(i, j)) : dark(front)) : v.back;
      const { back: _back, layer: _layer, tint: _tint, uv: _uv, wear: _wear, wear2: _wear2, streaks: _s1, streaks2: _s2, ...rest } = v;
      void [_back, _layer, _tint, _uv, _wear, _wear2, _s1, _s2];
      this.grid(rows, insideIn, { ...rest, colour }, skip, true);
    }
  }

  /**
   * The finished arrays. No triangle is laid twice (the same three corners, wound the same way, in the same look): the builders that make one
   * place twice (a post where two runs meet, a pile two spans share) share it or leave it out, and `depthSeparation.test.ts` holds the whole
   * town to that, so that this step stays a copy.
   */
  finish(): MeshArrays {
    const arrays: MeshArrays = { positions: this.pos.copy(), normals: this.nor.copy(), colors: this.col.copy(), uvs: this.uv.copy(), surface: this.srf.copy(), indices: this.idx.copy() };
    if (MeshBuilder.trace) MeshBuilder.traced.set(arrays, this.tags.map(([t, s]): [number, string] => [t, s]));
    return arrays;
  }

  /** As `finish`, and the builder is left empty: its own storage is let go, so a town's builders do not stand beside their finished arrays. */
  take(): MeshArrays {
    const arrays: MeshArrays = { positions: this.pos.taken(), normals: this.nor.taken(), colors: this.col.taken(), uvs: this.uv.taken(), surface: this.srf.taken(), indices: this.idx.taken() };
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
