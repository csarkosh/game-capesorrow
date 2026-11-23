/**
 * What the street builders draw with: flat polygons laid over the ground, each vertex at the ground's height plus a lift
 * (so a surface follows the ground's roll), cut off the highway's bed (which the engine paints), left out where it lies under the
 * sea, and given to the cell its middle is in. A polygon of any simple outline is cut into triangles (ears) and each is split into
 * four, `depth` times, so no triangle is much longer than a tile whatever the polygon's size; a convex quad that needs no
 * splitting goes in as one polygon.
 */
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { faceSurfaceFor, flatSurfaceFor } from "./groundSurfaces.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";

export type P2 = readonly [number, number];
/** A corner with its own lift over the ground: x, z, lift. */
export type P3 = readonly [number, number, number];

const UP: Vec3 = [0, 1, 0];

type Corner = { x: number; z: number; u: number; lift: number };

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
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, u: a.u + (b.u - a.u) * k, lift: a.lift + (b.lift - a.lift) * k });
    }
  }
  return out;
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

  /** The vertex's height: the ground's plus its lift. */
  y(x: number, z: number, lift: number): number {
    return this.g.heightAt(x, z) + lift;
  }

  /** Emits one convex polygon (a few corners, each with its lift), off the highway's bed and not under the sea. */
  private emit(corners: readonly Corner[], colour: Rgb): void {
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
      const pts: Vec3[] = piece.map((q) => [q.x, this.g.heightAt(q.x, q.z) + q.lift, q.z]);
      if (pts.every((q, i) => q[1] - (piece[i] as Corner).lift < SEA + 0.1)) continue;
      let cx = 0;
      let cz = 0;
      for (const q of piece) {
        cx += q.x;
        cz += q.z;
      }
      this.sink(cx / piece.length, cz / piece.length).poly(pts, UP, colour, flatSurfaceFor(colour, this.g.anchor));
    }
  }

  /** A convex polygon laid on the engine's road itself (a crosswalk across the highway): not cut off the bed, and `lift` over the road's own height. */
  onRoad(pts: readonly P2[], lift: number, colour: Rgb): void {
    const v: Vec3[] = pts.map((q) => [q[0], this.g.heightAt(q[0], q[1]) + lift, q[1]]);
    this.sink((pts[0] as P2)[0], (pts[0] as P2)[1]).poly(v, UP, colour, flatSurfaceFor(colour, this.g.anchor));
  }

  /** A convex polygon (kept as one polygon) at corners' own lifts. */
  poly(corners: readonly P3[], colour: Rgb): void {
    this.emit(
      corners.map((c) => ({ x: c[0], z: c[1], u: c[0] - this.g.roadX(c[1]), lift: c[2] })),
      colour,
    );
  }

  /** A convex polygon at one lift. */
  flat(pts: readonly P2[], lift: number, colour: Rgb): void {
    this.poly(
      pts.map((p) => [p[0], p[1], lift] as const),
      colour,
    );
  }

  /**
   * Any simple polygon at one lift, in triangles split `depth` times (4^depth each). The same depth for every triangle of
   * one polygon, so no two meet with a crack between.
   */
  fill(pts: readonly P2[], lift: number, colour: Rgb, depth: number): void {
    const tris = triangulate(pts);
    const sub = (a: P2, b: P2, c: P2, d: number): void => {
      if (d === 0) {
        this.flat([a, b, c], lift, colour);
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
    for (const [i, j, k] of tris) sub(pts[i] as P2, pts[j] as P2, pts[k] as P2, depth);
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
  face(a: P2, b: P2, y0: number, y1: number, n: P2, colour: Rgb): void {
    const bed = ROAD_BED_HALF;
    if (Math.abs(a[0] - this.g.roadX(a[1])) < bed + 0.3 || Math.abs(b[0] - this.g.roadX(b[1])) < bed + 0.3) return;
    const ga = this.g.heightAt(a[0], a[1]);
    const gb = this.g.heightAt(b[0], b[1]);
    if (ga + y1 < SEA + 0.1 && gb + y1 < SEA + 0.1) return;
    this.sink((a[0] + b[0]) / 2, (a[1] + b[1]) / 2).poly([[a[0], ga + y0, a[1]], [b[0], gb + y0, b[1]], [b[0], gb + y1, b[1]], [a[0], ga + y1, a[1]]], [n[0], 0, n[1]], colour, faceSurfaceFor(colour, a[0], a[1], b[0], b[1]));
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

/** `p` without `q`: convex pieces (none when `q` covers it). Both convex. */
export function subtractConvex(p: readonly P2[], q: readonly P2[]): P2[][] {
  const ring = areaOfP2(q) < 0 ? q.slice().reverse() : q;
  const out: P2[][] = [];
  let rest: P2[] = p.slice();
  for (let i = 0; i < ring.length && rest.length >= 3; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % ring.length] as P2;
    const outside = clipLine(rest, a, b, false);
    if (outside.length >= 3 && thick(outside)) out.push(outside);
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
        pieces = pieces.flatMap((p) => (shareArea(p, other, 0.004) ? subtractConvex(p, other) : [p]));
        if (pieces.length === 0) return pieces;
      }
    }
    return pieces;
  }

  /** Lays a convex roadway tile at one lift, without the ground already laid. */
  tile(poly: readonly P2[], lift: number, colour: Rgb): void {
    for (const piece of this.free(poly)) {
      this.surf.flat(piece, lift, colour);
      this.note(piece);
    }
  }
}
