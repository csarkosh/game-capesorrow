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

export type Tri = { readonly layer: string; readonly p: readonly [number, number, number, number, number, number, number, number, number]; readonly n: readonly [number, number, number]; readonly d: number; /** Its index among the mesh's triangles, to find where it came from. */ readonly index: number; readonly tag?: string };

export type NearPair = { readonly a: Tri; readonly b: Tri; readonly gap: number; readonly area: number; readonly at: readonly [number, number, number] };

/** The triangles of a mesh, tagged with the layer it was drawn in. */
export function trianglesOf(arrays: MeshArrays, layer: string, into: Tri[] = [], tags: readonly [number, string][] = []): Tri[] {
  const { positions: P, indices: I, normals: N } = arrays;
  for (let t = 0; t < I.length; t += 3) {
    const a = (I[t] as number) * 3;
    const b = (I[t + 1] as number) * 3;
    const c = (I[t + 2] as number) * 3;
    const nx = N[a] as number;
    const ny = N[a + 1] as number;
    const nz = N[a + 2] as number;
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
    if (cx * cx + cy * cy + cz * cz < 1e-10) continue;
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
    into.push({ layer, p, n: [nx, ny, nz], d: nx * p[0] + ny * p[1] + nz * p[2], index: t / 3, ...(tag === undefined ? {} : { tag }) });
  }
  return into;
}

type P2 = readonly [number, number];

/** The area of the part of convex polygon `poly` that lies inside the counter-clockwise triangle `tri` (Sutherland-Hodgman). */
function clippedArea(poly: P2[], tri: readonly [P2, P2, P2]): number {
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
  for (let i = 0; i < out.length; i++) {
    const p = out[i] as P2;
    const q = out[(i + 1) % out.length] as P2;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) / 2;
}

/** The triangle's corners in the plane's two axes (dropping the normal's largest axis), turned counter-clockwise. */
function flat(t: Tri, drop: number): [P2, P2, P2] {
  const pick = (i: number): P2 => {
    const x = t.p[i * 3] as number;
    const y = t.p[i * 3 + 1] as number;
    const z = t.p[i * 3 + 2] as number;
    return drop === 0 ? [y, z] : drop === 1 ? [x, z] : [x, y];
  };
  const a = pick(0);
  const b = pick(1);
  const c = pick(2);
  const turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return turn >= 0 ? [a, b, c] : [a, c, b];
}

export function nearPairs(tris: readonly Tri[], gap: number, minArea = 1e-4): NearPair[] {
  const groups = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const key = `${Math.round(t.n[0] * 50)},${Math.round(t.n[1] * 50)},${Math.round(t.n[2] * 50)}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [i]);
    else g.push(i);
  });
  const found: NearPair[] = [];
  const box = (t: Tri): [number, number, number, number, number, number] => [
    Math.min(t.p[0], t.p[3], t.p[6]), Math.max(t.p[0], t.p[3], t.p[6]), Math.min(t.p[1], t.p[4], t.p[7]), Math.max(t.p[1], t.p[4], t.p[7]), Math.min(t.p[2], t.p[5], t.p[8]), Math.max(t.p[2], t.p[5], t.p[8]),
  ];
  for (const list of groups.values()) {
    list.sort((a, b) => (tris[a] as Tri).d - (tris[b] as Tri).d);
    for (let ii = 0; ii < list.length; ii++) {
      const a = tris[list[ii] as number] as Tri;
      const ba = box(a);
      for (let jj = ii + 1; jj < list.length; jj++) {
        const b = tris[list[jj] as number] as Tri;
        const dd = b.d - a.d;
        if (dd >= gap) break;
        const bb = box(b);
        if (ba[0] > bb[1] + gap || bb[0] > ba[1] + gap || ba[2] > bb[3] + gap || bb[2] > ba[3] + gap || ba[4] > bb[5] + gap || bb[4] > ba[5] + gap) continue;
        const ax = Math.abs(a.n[0]);
        const ay = Math.abs(a.n[1]);
        const az = Math.abs(a.n[2]);
        const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
        const fa = flat(a, drop);
        const fb = flat(b, drop);
        const area = clippedArea([fa[0], fa[1], fa[2]], fb);
        if (area > minArea) {
          const cx = (a.p[0] + a.p[3] + a.p[6]) / 3;
          const cy = (a.p[1] + a.p[4] + a.p[7]) / 3;
          const cz = (a.p[2] + a.p[5] + a.p[8]) / 3;
          found.push({ a, b, gap: dd, area, at: [cx, cy, cz] });
        }
      }
    }
  }
  return found;
}
