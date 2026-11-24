/**
 * What the street builders draw with: flat polygons laid over the ground, each vertex at the ground's height plus a lift
 * (so a surface follows the ground's roll), cut off the highway's bed (which the engine paints), left out where it lies under the
 * sea, and given to the cell its middle is in. A polygon of any simple outline is cut into triangles (ears) and each is split into
 * four, `depth` times, so no triangle is much longer than a tile whatever the polygon's size; a convex quad that needs no
 * splitting goes in as one polygon.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import type { Surface as Surface_ } from "./townSurface.js";
import { RANK, faceSurfaceFor, flatSurfaceFor, withOver, type Over } from "./groundSurfaces.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";

export type P2 = readonly [number, number];
/** A corner with its own lift over the ground: x, z, lift. */
export type P3 = readonly [number, number, number];

const UP: Vec3 = [0, 1, 0];

/** A mark that has been laid, for the marks laid after it to find what lies under them: its outline (a convex polygon in x, z), its box and its rank. */
type Laid = { readonly pts: readonly P2[]; readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number; stamp: number };
/** The marks laid in a town's build, by cell of 8 m (one registry for every `Surface` of one `TownGround`, so a yard's patch and a street's crack stack alike). */
/** The count of looks at the marks laid, so that a mark in several cells is looked at once. */
let STAMP = 0;
const LAID = new WeakMap<object, Map<string | number, Map<number, Laid[]>>>();

/** Forgets the marks laid for `g`: a build starts with none (a ground built twice must give the same ranks twice). */
export function forgetMarks(g: object): void {
  LAID.delete(g);
}

type Corner = { x: number; z: number; u: number; lift: number; y?: number };

/** A convex polygon clipped to one side of the highway's bed edge: `sign` 1 keeps u >= edge, -1 keeps u <= -edge. */
function clipSide(poly: readonly Corner[], sign: 1 | -1, edge: number): Corner[] {
  const out: Corner[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Corner;
    const b = poly[(i + 1) % n] as Corner;
    const da = a.u * sign - edge;
    const db = b.u * sign - edge;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const k = da / (da - db);
      const c: Corner = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, u: a.u + (b.u - a.u) * k, lift: a.lift + (b.lift - a.lift) * k };
      if (a.y !== undefined && b.y !== undefined) c.y = a.y + (b.y - a.y) * k;
      out.push(c);
    }
  }
  return out;
}

/** Whether a polygon's corners turn one way all round in the plan (a convex polygon, with no corner flat or folded). */
function convexXZ(piece: readonly Corner[]): boolean {
  let sign = 0;
  const n = piece.length;
  for (let i = 0; i < n; i++) {
    const a = piece[i] as Corner;
    const b = piece[(i + 1) % n] as Corner;
    const c = piece[(i + 2) % n] as Corner;
    const cr = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cr) < 1e-7) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The ears of a simple polygon (any winding): triples of indices into `pts`. */
export function triangulate(pts: readonly P2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as P2;
    const b = pts[(i + 1) % n] as P2;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const idx: number[] = pts.map((_, i) => i);
  if (area < 0) idx.reverse();
  const out: [number, number, number][] = [];
  const cross = (a: P2, b: P2, c: P2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length] as number;
      const i1 = idx[k] as number;
      const i2 = idx[(k + 1) % idx.length] as number;
      const a = pts[i0] as P2;
      const b = pts[i1] as P2;
      const c = pts[i2] as P2;
      if (cross(a, b, c) <= 1e-9) continue;
      let hit = false;
      for (const m of idx) {
        if (m === i0 || m === i1 || m === i2) continue;
        const p = pts[m] as P2;
        if (cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9) {
          hit = true;
          break;
        }
      }
      if (hit) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // A degenerate corner (collinear points) blocks every ear: drop the flattest.
      let flat = 0;
      let best = Infinity;
      for (let k = 0; k < idx.length; k++) {
        const a = pts[idx[(k + idx.length - 1) % idx.length] as number] as P2;
        const b = pts[idx[k] as number] as P2;
        const c = pts[idx[(k + 1) % idx.length] as number] as P2;
        const v = Math.abs(cross(a, b, c));
        if (v < best) {
          best = v;
          flat = k;
        }
      }
      idx.splice(flat, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0] as number, idx[1] as number, idx[2] as number]);
  return out;
}

export class Surface {
  constructor(
    readonly g: TownGround,
    readonly sink: Sink,
  ) {}

  /**
   * The pieces of a mark of rank `rank` (convex, in x and z) that no mark of the same rank laid before it covers, the first laid keeping its
   * ground: two marks that overlap are never of one rank (a mark of another rank is told from it by the rank, `RANK`). The pieces are noted
   * for the marks after them. A mark that is not trimmed comes back as it was.
   */
  private trim(poly: readonly P2[], group: string | number): readonly (readonly P2[])[] {
    let marks = LAID.get(this.g);
    if (marks === undefined) {
      marks = new Map();
      LAID.set(this.g, marks);
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const q of poly) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < z0) z0 = q[1];
      if (q[1] > z1) z1 = q[1];
    }
    const ix0 = Math.floor(x0 / 8);
    const ix1 = Math.floor(x1 / 8);
    const iz0 = Math.floor(z0 / 8);
    const iz1 = Math.floor(z1 / 8);
    // Each group has its own cells, by number (a cell's x and z, 8 m): a mark is looked up against its own group's alone.
    let cells = marks.get(group);
    if (cells === undefined) {
      cells = new Map();
      marks.set(group, cells);
    }
    let pieces: (readonly P2[])[] = [poly];
    const stamp = ++STAMP;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = cells.get(ix * 65536 + iz);
        if (list === undefined) continue;
        for (const o of list) {
          if (o.stamp === stamp || o.x0 > x1 || o.x1 < x0 || o.z0 > z1 || o.z1 < z0) continue;
          o.stamp = stamp;
          if (pieces.length === 1 && pieces[0] === poly) {
            if (shareArea(poly, o.pts, 1e-4)) pieces = subtractConvex(poly, o.pts);
          } else {
            pieces = pieces.flatMap((p) => (shareArea(p, o.pts, 1e-4) ? subtractConvex(p, o.pts) : [p]));
          }
          if (pieces.length === 0) break;
        }
      }
    }
    for (const piece of pieces) {
      let px0 = Infinity;
      let px1 = -Infinity;
      let pz0 = Infinity;
      let pz1 = -Infinity;
      for (const q of piece) {
        if (q[0] < px0) px0 = q[0];
        if (q[0] > px1) px1 = q[0];
        if (q[1] < pz0) pz0 = q[1];
        if (q[1] > pz1) pz1 = q[1];
      }
      const laid: Laid = { pts: piece, x0: px0, x1: px1, z0: pz0, z1: pz1, stamp: 0 };
      for (let ix = Math.floor(px0 / 8); ix <= Math.floor(px1 / 8); ix++) {
        for (let iz = Math.floor(pz0 / 8); iz <= Math.floor(pz1 / 8); iz++) {
          const k = ix * 65536 + iz;
          const list = cells.get(k);
          if (list === undefined) cells.set(k, [laid]);
          else list.push(laid);
        }
      }
    }
    return pieces.length === 1 && pieces[0] === poly ? [poly] : pieces;
  }

  /**
   * Draws one convex polygon of the ground at its rank: a base surface (rank 0 or under) as it is, a mark (`RANK.mark` and over) in the pieces
   * of it that no mark of its rank covers. A piece cut off a mark takes the height of the ground at its corners and the mark's mean lift.
   */
  lay(builder: MeshBuilder, pts: readonly Vec3[], lifts: readonly number[], colour: Rgb, surface: Surface_ | undefined, rank: number, group: string | number | undefined = rank > 0 ? rank : undefined): void {
    // A colour that names no ground material and lies at the paint's rank is road paint: smooth paint over the road.
    const look = surface ?? (rank === RANK.paint ? "painted" : undefined);
    if (group === undefined) {
      builder.poly(pts, UP, colour, look, rank === 0 ? undefined : { rank });
      return;
    }
    const xz = pts.map((q): P2 => [q[0], q[2]]);
    const pieces = this.trim(xz, group);
    if (pieces.length === 1 && pieces[0] === xz) {
      builder.poly(pts, UP, colour, look, rank === 0 ? undefined : { rank });
      return;
    }
    const lift = lifts.reduce((t, l) => t + l, 0) / lifts.length;
    for (const piece of pieces) {
      if (!thick(piece)) continue;
      // A piece of more than three corners goes in as its ears (one a cut leaves can have a corner on a line or folded), so no fan turns against its face.
      const parts: (readonly P2[])[] = piece.length > 3 ? triangulate(piece).map(([i, j, k]) => [piece[i] as P2, piece[j] as P2, piece[k] as P2]) : [piece];
      for (const part of parts) {
        // A triangle of less than 5 mm^2 is nothing to draw.
        if (part.length === 3 && Math.abs(((part[1] as P2)[0] - (part[0] as P2)[0]) * ((part[2] as P2)[1] - (part[0] as P2)[1]) - ((part[1] as P2)[1] - (part[0] as P2)[1]) * ((part[2] as P2)[0] - (part[0] as P2)[0])) < 1e-5) continue;
        builder.poly(part.map((q): Vec3 => [q[0], this.g.heightAt(q[0], q[1]) + lift, q[1]]), UP, colour, look, rank === 0 ? undefined : { rank });
      }
    }
  }

  /** The vertex's height: the ground's plus its lift. */
  y(x: number, z: number, lift: number): number {
    return this.g.heightAt(x, z) + lift;
  }

  /** Emits one convex polygon (a few corners, each with its lift), off the highway's bed and not under the sea. */
  private emit(corners: readonly Corner[], colour: Rgb, over?: Over): void {
    const bed = ROAD_BED_HALF;
    let pieces: Corner[][];
    const us = corners.map((q) => q.u);
    if (us.every((u) => u >= bed) || us.every((u) => u <= -bed)) pieces = [corners.slice()];
    else if (us.every((u) => u > -bed && u < bed)) pieces = [];
    else pieces = [clipSide(corners, 1, bed), clipSide(corners, -1, bed)];
    for (const raw of pieces) {
      // Corners that repeat make a triangle with no area: left out.
      const piece = raw.filter((q, i) => {
        for (let k = 0; k < i; k++) if (Math.abs(q.x - (raw[k] as Corner).x) <= 1e-4 && Math.abs(q.z - (raw[k] as Corner).z) <= 1e-4) return false;
        return true;
      });
      if (piece.length < 3) continue;
      // A polygon with no area is left out.
      let twice = 0;
      for (let i = 0; i < piece.length; i++) {
        const a = piece[i] as Corner;
        const b = piece[(i + 1) % piece.length] as Corner;
        twice += a.x * b.z - b.x * a.z;
      }
      if (Math.abs(twice) < 4e-4) continue;
      const ground = piece.map((q) => this.g.heightAt(q.x, q.z));
      const pts: Vec3[] = piece.map((q, i) => [q.x, q.y ?? (ground[i] as number) + q.lift, q.z]);
      if (ground.every((h) => h < SEA + 0.1)) continue;
      let cx = 0;
      let cz = 0;
      for (const q of piece) {
        cx += q.x;
        cz += q.z;
      }
      const surface = withOver(flatSurfaceFor(colour, this.g.anchor), colour, this.g.anchor, over);
      const builder = this.sink(cx / piece.length, cz / piece.length);
      const want = over?.rank ?? 0;
      const lifts = piece.map((q) => q.lift);
      if (piece.length > 3 && !convexXZ(piece)) {
        // Not convex (a jittered edge folded, a corner or two collinear): its ears, each a polygon of its own, so no fan turns against the face.
        const flatPts = piece.map((q): P2 => [q.x, q.z]);
        for (const [i, j, k] of triangulate(flatPts)) {
          const tri = [pts[i] as Vec3, pts[j] as Vec3, pts[k] as Vec3];
          const a2 = (tri[1]![0] - tri[0]![0]) * (tri[2]![2] - tri[0]![2]) - (tri[1]![2] - tri[0]![2]) * (tri[2]![0] - tri[0]![0]);
          if (Math.abs(a2) > 4e-4) this.lay(builder, tri, [lifts[i] as number, lifts[j] as number, lifts[k] as number], colour, surface, want, over?.group);
        }
        continue;
      }
      this.lay(builder, pts, lifts, colour, surface, want, over?.group);
    }
  }

  /** A convex polygon laid on the engine's road itself (a crosswalk across the highway): not cut off the bed, and `lift` over the road's own height. */
  onRoad(pts: readonly P2[], lift: number, colour: Rgb, over?: Over): void {
    const v: Vec3[] = pts.map((q) => [q[0], this.g.heightAt(q[0], q[1]) + lift, q[1]]);
    this.lay(this.sink((pts[0] as P2)[0], (pts[0] as P2)[1]), v, v.map(() => lift), colour, flatSurfaceFor(colour, this.g.anchor), over?.rank ?? 0);
  }

  /** A convex polygon (kept as one polygon) at corners' own lifts. */
  poly(corners: readonly P3[], colour: Rgb, over?: Over): void {
    this.emit(
      corners.map((c) => ({ x: c[0], z: c[1], u: c[0] - this.g.roadX(c[1]), lift: c[2] })),
      colour,
      over,
    );
  }

  /** A convex polygon at corners' own absolute heights (x, z, y): for what does not follow the ground's own height (a curb's top, laid at the lots' level beside the roadway's cut). */
  polyY(corners: readonly P3[], colour: Rgb, over?: Over): void {
    this.emit(
      corners.map((c) => ({ x: c[0], z: c[1], u: c[0] - this.g.roadX(c[1]), lift: 0, y: c[2] })),
      colour,
      over,
    );
  }

  /** A convex polygon at one lift. */
  flat(pts: readonly P2[], lift: number, colour: Rgb, over?: Over): void {
    this.poly(
      pts.map((p) => [p[0], p[1], lift] as const),
      colour,
      over,
    );
  }

  /**
   * Any simple polygon at one lift, in triangles split `depth` times (4^depth each). The same depth for every triangle of
   * one polygon, so no two meet with a crack between.
   */
  fill(pts: readonly P2[], lift: number, colour: Rgb, depth: number, over?: Over): void {
    const tris = triangulate(pts);
    const sub = (a: P2, b: P2, c: P2, d: number): void => {
      if (d === 0) {
        this.flat([a, b, c], lift, colour, over);
        return;
      }
      const ab: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const bc: P2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      const ca: P2 = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      sub(a, ab, ca, d - 1);
      sub(ab, b, bc, d - 1);
      sub(ca, bc, c, d - 1);
      sub(ab, bc, ca, d - 1);
    };
    // An ear under 1 cm across (the corners that lie nearly on a line) is a sliver that a neighbour overlaps by its own width: left out.
    for (const [i, j, k] of tris) if (thick([pts[i] as P2, pts[j] as P2, pts[k] as P2])) sub(pts[i] as P2, pts[j] as P2, pts[k] as P2, depth);
  }

  /** The depth that splits a polygon's longest edge to about `tile` metres, at most `cap`. */
  depthFor(pts: readonly P2[], tile: number, cap: number): number {
    let longest = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as P2;
      const b = pts[(i + 1) % pts.length] as P2;
      longest = Math.max(longest, Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])));
    }
    // The triangles' own edges (chords across it) are longer than any side, up to the polygon's span.
    let span = 0;
    for (const a of pts) for (const b of pts) span = Math.max(span, Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])));
    const reach = Math.max(longest, span * 0.7);
    let d = 0;
    while (d < cap && reach / (1 << d) > tile) d++;
    return d;
  }

  /** A vertical face from `a` to `b`, from lift `y0` to `y1` over the ground, looking along `n` (a horizontal unit vector). */
  face(a: P2, b: P2, y0: number, y1: number, n: P2, colour: Rgb, over?: Over): void {
    const bed = ROAD_BED_HALF;
    if (Math.abs(a[0] - this.g.roadX(a[1])) < bed + 0.3 || Math.abs(b[0] - this.g.roadX(b[1])) < bed + 0.3) return;
    const ga = this.g.heightAt(a[0], a[1]);
    const gb = this.g.heightAt(b[0], b[1]);
    if (ga + y1 < SEA + 0.1 && gb + y1 < SEA + 0.1) return;
    this.sink((a[0] + b[0]) / 2, (a[1] + b[1]) / 2).poly([[a[0], ga + y0, a[1]], [b[0], gb + y0, b[1]], [b[0], gb + y1, b[1]], [a[0], ga + y1, a[1]]], [n[0], 0, n[1]], colour, withOver(faceSurfaceFor(colour, a[0], a[1], b[0], b[1]), colour, this.g.anchor, over, true, [a[0], a[1], b[0], b[1]]));
  }

  /** A vertical face with its own absolute heights at each end: from `ya0` up to `ya1` at `a`, `yb0` to `yb1` at `b`. */
  faceY(a: P2, b: P2, ya0: number, ya1_: number, yb0: number, yb1_: number, n: P2, colour: Rgb, over?: Over): void {
    const bed = ROAD_BED_HALF;
    let ya1 = ya1_;
    let yb1 = yb1_;
    if (Math.abs(a[0] - this.g.roadX(a[1])) < bed + 0.3 || Math.abs(b[0] - this.g.roadX(b[1])) < bed + 0.3) return;
    if (this.g.heightAt(a[0], a[1]) < SEA + 0.1 && this.g.heightAt(b[0], b[1]) < SEA + 0.1) return;
    // A face is never turned over (its top under its foot where the curb is buried to nothing) nor flat: at least 2 mm high at each end.
    ya1 = Math.max(ya1, ya0 + 0.002);
    yb1 = Math.max(yb1, yb0 + 0.002);
    this.sink((a[0] + b[0]) / 2, (a[1] + b[1]) / 2).poly([[a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]]], [n[0], 0, n[1]], colour, withOver(faceSurfaceFor(colour, a[0], a[1], b[0], b[1]), colour, this.g.anchor, over, true, [a[0], a[1], b[0], b[1]]));
  }
}

// ---- Roadways that would overlap: the first laid keeps its ground.

/** Whether two convex polygons share more than a sliver of area (separating axes: the least overlap along any of them exceeds `eps`). */
function shareArea(p: readonly P2[], q: readonly P2[], eps: number): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as P2;
      const b = poly[(i + 1) % poly.length] as P2;
      let nx = b[1] - a[1];
      let nz = a[0] - b[0];
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len === 0) continue;
      nx /= len;
      nz /= len;
      let p0 = Infinity;
      let p1 = -Infinity;
      for (const c of p) {
        const t = c[0] * nx + c[1] * nz;
        p0 = Math.min(p0, t);
        p1 = Math.max(p1, t);
      }
      let q0 = Infinity;
      let q1 = -Infinity;
      for (const c of q) {
        const t = c[0] * nx + c[1] * nz;
        q0 = Math.min(q0, t);
        q1 = Math.max(q1, t);
      }
      if (Math.min(p1, q1) - Math.max(p0, q0) <= eps) return false;
    }
  }
  return true;
}

/** The part of a convex polygon on one side of the line through `a` and `b` (the left of a to b when `keepLeft`). */
function clipLine(poly: readonly P2[], a: P2, b: P2, keepLeft: boolean): P2[] {
  const out: P2[] = [];
  const side = (p: P2): number => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepLeft ? 1 : -1);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % poly.length] as P2;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const areaOfP2 = (p: readonly P2[]): number => {
  let t = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as P2;
    const b = p[(i + 1) % p.length] as P2;
    t += a[0] * b[1] - b[0] * a[1];
  }
  return t / 2;
};

/** Whether a convex polygon is thicker than a sliver (its area over its half perimeter, more than 5 mm). */
function thick(p: readonly P2[]): boolean {
  let per = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as P2;
    const b = p[(i + 1) % p.length] as P2;
    per += Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
  }
  return per > 0 && (2 * Math.abs(areaOfP2(p))) / per > 0.005;
}

/** The corners of a polygon with a corner that repeats the one before it (or the first, at the end) left out: a zero-length edge has no side to cut by. */
function distinct(p: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(last[0] - q[0]) > 1e-9 || Math.abs(last[1] - q[1]) > 1e-9) out.push(q);
  }
  while (out.length > 1 && Math.abs((out[0] as P2)[0] - (out[out.length - 1] as P2)[0]) <= 1e-9 && Math.abs((out[0] as P2)[1] - (out[out.length - 1] as P2)[1]) <= 1e-9) out.pop();
  return out;
}

/** `p` without `q`: convex pieces (none when `q` covers it). Both convex. */
export function subtractConvex(p: readonly P2[], q: readonly P2[]): P2[][] {
  const ring = distinct(areaOfP2(q) < 0 ? q.slice().reverse() : q);
  const out: P2[][] = [];
  let rest: P2[] = p.slice();
  for (let i = 0; i < ring.length && rest.length >= 3; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % ring.length] as P2;
    const outside = clipLine(rest, a, b, false);
    if (outside.length >= 3 && thick(outside)) out.push(distinct(outside));
    rest = clipLine(rest, a, b, true);
  }
  return out;
}

/**
 * The roadway surfaces laid so far, in 8 m cells: a new one that would overlap one laid before is laid without that part, so no
 * two roadway surfaces share ground anywhere. The pavements of the junctions are laid first and keep theirs.
 */
export class RoadSet {
  private readonly cells = new Map<string, (readonly P2[])[]>();

  constructor(private readonly surf: Surface) {}

  private keys(poly: readonly P2[]): string[] {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]);
      z1 = Math.max(z1, p[1]);
    }
    const out: string[] = [];
    for (let ix = Math.floor(x0 / 8); ix <= Math.floor(x1 / 8); ix++) for (let iz = Math.floor(z0 / 8); iz <= Math.floor(z1 / 8); iz++) out.push(`${ix},${iz}`);
    return out;
  }

  /** Notes a convex surface as laid (without drawing it). */
  note(poly: readonly P2[]): void {
    for (const k of this.keys(poly)) {
      const list = this.cells.get(k);
      if (list === undefined) this.cells.set(k, [poly]);
      else list.push(poly);
    }
  }

  /** The convex pieces of `poly` that no surface laid before covers. */
  free(poly: readonly P2[]): P2[][] {
    let pieces: P2[][] = [poly.slice()];
    const seen: (readonly P2[])[] = [];
    for (const k of this.keys(poly)) {
      for (const other of this.cells.get(k) ?? []) {
        if (seen.includes(other)) continue;
        seen.push(other);
        pieces = pieces.flatMap((p) => (shareArea(p, other, 1e-4) ? subtractConvex(p, other) : [p]));
        if (pieces.length === 0) return pieces;
      }
    }
    return pieces;
  }

  /** Lays a convex roadway tile at one lift, without the ground already laid. */
  tile(poly: readonly P2[], lift: number, colour: Rgb, over?: Over): void {
    for (const piece of this.free(poly)) {
      this.surf.flat(piece, lift, colour, over?.rank === undefined && over?.group === undefined ? { ...over, group: "base" } : over);
      this.note(piece);
    }
  }
}
