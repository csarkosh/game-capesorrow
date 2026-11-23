/**
 * Finds pairs of triangles that a depth buffer cannot tell apart: two faces that look the same way, overlap in area, and lie closer than
 * `gap` metres from one plane along their normal. Pure (arrays in, pairs out), so a test holds a town's buildings to it and a script can
 * list what it finds.
 *
 * Triangles are grouped by their facing (the normal to 0.02) and sorted by the offset of their plane along it; a triangle is compared
 * only with those whose offset is within `gap` of its own and whose boxes meet, and two overlap when the convex pieces of them, cut
 * against each other in the plane, have an area over `minArea`. Faces that look away from each other (a thin board's two sides) are
 * not a pair: the back face is never drawn.
 */
import type { MeshArrays } from "../../src/game/town/meshBuilder.js";

export type Tri = { readonly layer: string; readonly p: readonly [number, number, number, number, number, number, number, number, number]; readonly n: readonly [number, number, number]; readonly d: number; /** Its index among the mesh's triangles, to find where it came from. */ readonly index: number; readonly tag?: string; /** What it looks like: the texture layer's index (-1 for none), the flat colour (or the texture's tint), and the glow and clearness. */ readonly look: readonly [number, number, number, number, number, number]; /** Which mesh of the town it is in, when the town's meshes are put together. */ readonly mesh?: string };

export type NearPair = { readonly a: Tri; readonly b: Tri; readonly gap: number; readonly area: number; readonly at: readonly [number, number, number] };

/** The triangles of a mesh, tagged with the layer it was drawn in. */
export function trianglesOf(arrays: MeshArrays, layer: string, into: Tri[] = [], tags: readonly [number, string][] = []): Tri[] {
  const { positions: P, indices: I, normals: N } = arrays;
  for (let t = 0; t < I.length; t += 3) {
    const a = (I[t] as number) * 3;
    const b = (I[t + 1] as number) * 3;
    const c = (I[t + 2] as number) * 3;
    const p = [P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]] as unknown as Tri["p"];
    // A triangle with no area is nothing to draw.
    const ux = (p[3] - p[0]) as number;
    const uy = (p[4] - p[1]) as number;
    const uz = (p[5] - p[2]) as number;
    const vx = (p[6] - p[0]) as number;
    const vy = (p[7] - p[1]) as number;
    const vz = (p[8] - p[2]) as number;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = cx * cx + cy * cy + cz * cz;
    if (area2 < 1e-10) continue;
    // A flat polygon's three corners share its normal, exact (the corners' positions are floats a long way from the origin, which a thin triangle's normal would not survive). A lofted body's normals are averaged over the quads that meet at a corner: its triangle's own plane is read off the corners.
    const sx = N[a] as number;
    const sy = N[a + 1] as number;
    const sz = N[a + 2] as number;
    const smooth = Math.abs((N[b] as number) - sx) + Math.abs((N[b + 1] as number) - sy) + Math.abs((N[b + 2] as number) - sz) + Math.abs((N[c] as number) - sx) + Math.abs((N[c + 1] as number) - sy) + Math.abs((N[c + 2] as number) - sz) > 1e-4;
    const inv = (cx * sx + cy * sy + cz * sz < 0 ? -1 : 1) / Math.sqrt(area2);
    const nx = smooth ? cx * inv : sx;
    const ny = smooth ? cy * inv : sy;
    const nz = smooth ? cz * inv : sz;
    let tag: string | undefined;
    if (tags.length > 0) {
      // The last tag at or before this triangle's index.
      let lo = 0;
      let hi = tags.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((tags[mid] as [number, string])[0] <= t / 3) lo = mid;
        else hi = mid - 1;
      }
      tag = (tags[lo] as [number, string])[1];
    }
    const sv = (I[t] as number) * 12;
    const cv = (I[t] as number) * 4;
    const layerAt = arrays.surface[sv] as number;
    const textured = layerAt >= 0 && layerAt < 1e6;
    const look: Tri["look"] = [textured ? layerAt : -1, arrays.colors[cv] as number, arrays.colors[cv + 1] as number, arrays.colors[cv + 2] as number, arrays.surface[sv + 3] as number, arrays.surface[sv + 7] as number];
    into.push({ layer, p, n: [nx, ny, nz], d: nx * p[0] + ny * p[1] + nz * p[2], index: t / 3, look, ...(tag === undefined ? {} : { tag }) });
  }
  return into;
}

type P2 = readonly [number, number];

/** The area and the middle of the part of convex polygon `poly` that lies inside the counter-clockwise triangle `tri` (Sutherland-Hodgman). */
function clipped(poly: P2[], tri: readonly [P2, P2, P2]): { area: number; cx: number; cy: number } {
  let out = poly;
  for (let e = 0; e < 3 && out.length > 0; e++) {
    const a = tri[e] as P2;
    const b = tri[(e + 1) % 3] as P2;
    const inside = (q: P2): number => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const next: P2[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i] as P2;
      const q = out[(i + 1) % out.length] as P2;
      const sp = inside(p);
      const sq = inside(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    out = next;
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i] as P2;
    const q = out[(i + 1) % out.length] as P2;
    const w = p[0] * q[1] - q[0] * p[1];
    area += w;
    cx += (p[0] + q[0]) * w;
    cy += (p[1] + q[1]) * w;
  }
  if (Math.abs(area) < 1e-12) return { area: 0, cx: 0, cy: 0 };
  return { area: Math.abs(area) / 2, cx: cx / (3 * area), cy: cy / (3 * area) };
}

/** The triangle's corners in the plane's own two axes (`u`, `v`, unit and across the normal), turned counter-clockwise: seen along the normal. */
function flat(t: Tri, u: readonly [number, number, number], v: readonly [number, number, number]): [P2, P2, P2] {
  const pick = (i: number): P2 => {
    const x = t.p[i * 3] as number;
    const y = t.p[i * 3 + 1] as number;
    const z = t.p[i * 3 + 2] as number;
    return [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
  };
  const a = pick(0);
  const b = pick(1);
  const c = pick(2);
  const turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return turn >= 0 ? [a, b, c] : [a, c, b];
}

/** Two unit vectors across `n`. */
function across(n: readonly [number, number, number]): [[number, number, number], [number, number, number]] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  // The axis the normal leans least on, crossed with the normal.
  const h: [number, number, number] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  let ux = n[1] * h[2] - n[2] * h[1];
  let uy = n[2] * h[0] - n[0] * h[2];
  let uz = n[0] * h[1] - n[1] * h[0];
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  return [[ux, uy, uz], [n[1] * uz - n[2] * uy, n[2] * ux - n[0] * uz, n[0] * uy - n[1] * ux]];
}

export function nearPairs(tris: readonly Tri[], gap: number, minArea = 1e-4): NearPair[] {
  const CELL = 3;
  const cells = new Map<number, number[]>();
  const big: number[] = [];
  const bboxes: number[][] = [];
  const key = (ix: number, iy: number, iz: number): number => (ix + 4096) * 16777216 + (iy + 512) * 4096 + (iz + 4096);
  tris.forEach((t, i) => {
    const bb = [
      Math.min(t.p[0], t.p[3], t.p[6]) - gap, Math.max(t.p[0], t.p[3], t.p[6]) + gap, Math.min(t.p[1], t.p[4], t.p[7]) - gap, Math.max(t.p[1], t.p[4], t.p[7]) + gap, Math.min(t.p[2], t.p[5], t.p[8]) - gap, Math.max(t.p[2], t.p[5], t.p[8]) + gap,
    ];
    bboxes.push(bb);
    const x0 = Math.floor((bb[0] as number) / CELL);
    const x1 = Math.floor((bb[1] as number) / CELL);
    const y0 = Math.floor((bb[2] as number) / CELL);
    const y1 = Math.floor((bb[3] as number) / CELL);
    const z0 = Math.floor((bb[4] as number) / CELL);
    const z1 = Math.floor((bb[5] as number) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 3000) {
      big.push(i);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = key(x, y, z);
          const l = cells.get(k);
          if (l === undefined) cells.set(k, [i]);
          else l.push(i);
        }
      }
    }
  });
  const found: NearPair[] = [];
  const seen = new Set<number>();
  const test = (ia: number, ib: number): void => {
    const a = tris[ia] as Tri;
    const b = tris[ib] as Tri;
    if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] < 0.9998) return;
    const ba = bboxes[ia] as number[];
    const bb = bboxes[ib] as number[];
    if ((ba[0] as number) > (bb[1] as number) || (bb[0] as number) > (ba[1] as number) || (ba[2] as number) > (bb[3] as number) || (bb[2] as number) > (ba[3] as number) || (ba[4] as number) > (bb[5] as number) || (bb[4] as number) > (ba[5] as number)) return;
    const pk = ia < ib ? ia * 4194304 + ib : ib * 4194304 + ia;
    if (seen.has(pk)) return;
    seen.add(pk);
    const [u, v] = across(a.n);
    const fa = flat(a, u, v);
    const fb = flat(b, u, v);
    const c = clipped([fa[0], fa[1], fa[2]], fb);
    if (!(c.area > minArea)) return;
    // The distance between the two planes where the faces overlap: the second plane's height over the first at the middle of the overlap, along the first's normal.
    const nbu = b.n[0] * u[0] + b.n[1] * u[1] + b.n[2] * u[2];
    const nbv = b.n[0] * v[0] + b.n[1] * v[1] + b.n[2] * v[2];
    const nbn = b.n[0] * a.n[0] + b.n[1] * a.n[1] + b.n[2] * a.n[2];
    const wb = (b.d - c.cx * nbu - c.cy * nbv) / nbn;
    // The first plane's `w` at the same (u, v): the plane is n_a . x = d_a, with x = cx u + cy v + w n_a, so w = d_a.
    const dd = Math.abs(wb - a.d);
    if (dd >= gap) return;
    // Back to the world for where it is: the first face's own middle.
    const cx = (a.p[0] + a.p[3] + a.p[6]) / 3;
    const cy = (a.p[1] + a.p[4] + a.p[7]) / 3;
    const cz = (a.p[2] + a.p[5] + a.p[8]) / 3;
    found.push({ a, b, gap: dd, area: c.area, at: [cx, cy, cz] });
  };
  for (const list of cells.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) test(list[i] as number, list[j] as number);
    }
  }
  for (const ib of big) {
    for (let ia = 0; ia < tris.length; ia++) if (ia !== ib) test(ia, ib);
  }
  return found;
}

/** One patch where two faces lie together: the pairs of triangles that touch one another, joined, and their overlap summed. */
export type Patch = { readonly area: number; readonly gap: number; readonly pairs: readonly NearPair[]; readonly a: Tri; readonly b: Tri; readonly at: readonly [number, number, number] };

/**
 * The pairs `nearPairs` found, joined into patches: two pairs that share a triangle are one patch (a quad is two triangles, and a
 * patch of 25 cm^2 can be four pairs of 6 cm^2). A patch's area is the sum of its pairs'; its gap the smallest of them; `a` and `b` the
 * pair with the largest overlap (where to look).
 */
export function patchesOf(pairs: readonly NearPair[], tris: readonly Tri[]): Patch[] {
  const parent = new Map<Tri, Tri>();
  const find = (t: Tri): Tri => {
    let r = t;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as Tri;
    let c = t;
    while (c !== r) {
      const n = parent.get(c) as Tri;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  void tris;
  for (const p of pairs) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map<Tri, NearPair[]>();
  for (const p of pairs) {
    const r = find(p.a);
    const l = byRoot.get(r);
    if (l === undefined) byRoot.set(r, [p]);
    else l.push(p);
  }
  const out: Patch[] = [];
  for (const list of byRoot.values()) {
    let area = 0;
    let gap = Infinity;
    let best = list[0] as NearPair;
    for (const p of list) {
      area += p.area;
      if (p.gap < gap) gap = p.gap;
      if (p.area > best.area) best = p;
    }
    out.push({ area, gap, pairs: list, a: best.a, b: best.b, at: best.at });
  }
  return out;
}

/**
 * Whether two faces look alike: both flat colour (no texture layer), the same colour to 3 percent, the same glow and clearness, and drawn in the
 * same layer. Two such faces in one plane can be neither told apart nor flicker to the eye: they are listed, not counted.
 */
export function alike(a: Tri, b: Tri): boolean {
  if (a.layer !== b.layer || a.look[0] !== -1 || b.look[0] !== -1) return false;
  return Math.abs(a.look[1] - b.look[1]) < 0.03 && Math.abs(a.look[2] - b.look[2]) < 0.03 && Math.abs(a.look[3] - b.look[3]) < 0.03 && Math.abs(a.look[4] - b.look[4]) < 0.05 && Math.abs(a.look[5] - b.look[5]) < 0.05;
}
