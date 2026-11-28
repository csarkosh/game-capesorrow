/**
 * The faces of a designed room whose backs a player can see with nothing there: the room's version of `openFaces.ts` (which reads the town's buildings and their footprints, and has no notion of a room). The town's materials cull
 * back faces, so a face with no back and no face behind it is simply not there seen from behind: a floor seen from under, a ceiling from over, a flight's soffit.
 *
 * "Reachable" for a room is measured from the eyes themselves. The eyes are every cell of the flood fill of standable floor (`floodOf`: the walking's own rules, on every level and up every flight, a cell a metre apart), each at 1.0 m and at
 * 1.75 m over its floor. From each eye rays go out in a sphere of directions, always including straight up and straight down (the stairwells and the galleries), and each ray is followed through the room's mesh as the screen would draw it: a face
 * that looks toward the eye is drawn and stops the ray; a face that looks away from it is culled and the ray goes on. A culled face the ray passes through before the first face it draws (and not within `BACKED` m of one: its twin, or a face laid
 * against its back) is seen with nothing there, and is an open face. A face is counted once, however many eyes see it, and by the builder that laid it.
 */
import type { MeshArrays } from "../../src/game/town/meshBuilder.js";
const CELL = 0.5;
import type { InsideRoom } from "../../src/sim/inside/rooms.js";
import { floodOf } from "../inside/designHelpers.js";

/** A face that looks toward the eye this near beyond (or before) a culled face backs it, metres. */
const BACKED = 0.06;
const GRID = 1.0;
/** A face counts as open when this many different eyes see its back: a few rays get through a millimetre slit between two faces (where one was stood off another, `MeshBuilder.stacked`), and a hole is seen from everywhere. */
const MIN_EYES = 6;

export type OpenTri = { readonly eye: readonly [number, number, number]; readonly dir: readonly [number, number, number]; readonly index: number; readonly at: readonly [number, number, number]; readonly n: readonly [number, number, number]; readonly area: number };

/** How many eye places the last runs left out for being inside a slab (the head of a hull under a landing). */
export function roomOpenFaces(a: MeshArrays, room: InsideRoom, directions = 360): OpenTri[] {
  const P = a.positions;
  const I = a.indices;
  const nt = I.length / 3;
  // The triangles: corners, normal, and the grid cells they touch.
  const tri = new Float64Array(nt * 9);
  const nrm = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = (I[t * 3 + k] as number) * 3;
      tri[t * 9 + k * 3] = P[v] as number;
      tri[t * 9 + k * 3 + 1] = P[v + 1] as number;
      tri[t * 9 + k * 3 + 2] = P[v + 2] as number;
    }
    const v0 = (I[t * 3] as number) * 3;
    nrm[t * 3] = a.normals[v0] as number;
    nrm[t * 3 + 1] = a.normals[v0 + 1] as number;
    nrm[t * 3 + 2] = a.normals[v0 + 2] as number;
  }
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k] as number, P[i + k] as number);
    hi[k] = Math.max(hi[k] as number, P[i + k] as number);
  }
  lo = lo.map((v) => v - 0.01);
  hi = hi.map((v) => v + 0.01);
  const dim = [0, 1, 2].map((k) => Math.max(1, Math.ceil(((hi[k] as number) - (lo[k] as number)) / GRID)));
  const cells: number[][] = Array.from({ length: (dim[0] as number) * (dim[1] as number) * (dim[2] as number) }, () => []);
  const cellOf = (x: number, k: number): number => Math.min((dim[k] as number) - 1, Math.max(0, Math.floor((x - (lo[k] as number)) / GRID)));
  for (let t = 0; t < nt; t++) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k] as number, tri[t * 9 + c * 3 + k] as number);
      mx[k] = Math.max(mx[k] as number, tri[t * 9 + c * 3 + k] as number);
    }
    for (let x = cellOf(mn[0] as number, 0); x <= cellOf(mx[0] as number, 0); x++) for (let y = cellOf(mn[1] as number, 1); y <= cellOf(mx[1] as number, 1); y++) for (let z = cellOf(mn[2] as number, 2); z <= cellOf(mx[2] as number, 2); z++) {
      (cells[(x * (dim[1] as number) + y) * (dim[2] as number) + z] as number[]).push(t);
    }
  }
  const open = new Set<number>();
  const eyeOf = new Map<number, [number, number, number]>();
  /** The eyes that have seen each open face: a slit between two faces (a few millimetres, where one was stood off the other) lets a ray or two through, and a hole lets many eyes see it. */
  const seenBy = new Map<number, Set<number>>();
  let eyeId = 0;
  const dirOf = new Map<number, [number, number, number]>();
  const seenAt = new Int32Array(nt).fill(-1);
  let stamp = 0;
  const hits: { t: number; tri: number; front: boolean }[] = [];
  const collect = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = Infinity): void => {
    stamp++;
    hits.length = 0;
    // Walk the grid's cells along the ray (a 3D DDA).
    let x = cellOf(ox, 0);
    let y = cellOf(oy, 1);
    let z = cellOf(oz, 2);
    const o = [ox, oy, oz];
    const d = [dx, dy, dz];
    const cell = [x, y, z];
    const step = d.map((v) => (v > 0 ? 1 : -1));
    const tMax = [0, 1, 2].map((k) => (d[k] === 0 ? Infinity : (((lo[k] as number) + ((cell[k] as number) + (step[k] === 1 ? 1 : 0)) * GRID) - (o[k] as number)) / (d[k] as number)));
    const tDelta = [0, 1, 2].map((k) => (d[k] === 0 ? Infinity : GRID / Math.abs(d[k] as number)));
    let tEnd = Infinity;
    for (let guard = 0; guard < 400; guard++) {
      if (x < 0 || y < 0 || z < 0 || x >= (dim[0] as number) || y >= (dim[1] as number) || z >= (dim[2] as number)) break;
      const list = cells[(x * (dim[1] as number) + y) * (dim[2] as number) + z] as number[];
      for (const t of list) {
        if (seenAt[t] === stamp) continue;
        seenAt[t] = stamp;
        // Moller-Trumbore.
        const b = t * 9;
        const e1x = (tri[b + 3] as number) - (tri[b] as number), e1y = (tri[b + 4] as number) - (tri[b + 1] as number), e1z = (tri[b + 5] as number) - (tri[b + 2] as number);
        const e2x = (tri[b + 6] as number) - (tri[b] as number), e2y = (tri[b + 7] as number) - (tri[b + 1] as number), e2z = (tri[b + 8] as number) - (tri[b + 2] as number);
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - (tri[b] as number), sy = oy - (tri[b + 1] as number), sz = oz - (tri[b + 2] as number);
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt < 1e-4) continue;
        hits.push({ t: tt, tri: t, front: (nrm[t * 3] as number) * dx + (nrm[t * 3 + 1] as number) * dy + (nrm[t * 3 + 2] as number) * dz < 0 });
      }
      // The ray cannot reach a face in a cell further on than the first drawn face found so far.
      let first = Infinity;
      for (const h of hits) if (h.front && h.t < first) first = h.t;
      const k = (tMax[0] as number) < (tMax[1] as number) ? ((tMax[0] as number) < (tMax[2] as number) ? 0 : 2) : ((tMax[1] as number) < (tMax[2] as number) ? 1 : 2);
      tEnd = tMax[k] as number;
      if (first + BACKED < tEnd || tEnd > maxT + 1) break;
      cell[k] = (cell[k] as number) + (step[k] as number);
      tMax[k] = (tMax[k] as number) + (tDelta[k] as number);
      x = cell[0] as number;
      y = cell[1] as number;
      z = cell[2] as number;
    }
  };
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void => {
    collect(ox, oy, oz, dx, dy, dz);
    let first = Infinity;
    for (const h of hits) if (h.front && h.t < first) first = h.t;
    for (const h of hits) if (!h.front && h.t < first - BACKED) {
      open.add(h.tri);
      const sb = seenBy.get(h.tri) ?? new Set<number>();
      sb.add(eyeId);
      seenBy.set(h.tri, sb);
      if (!eyeOf.has(h.tri)) {
        eyeOf.set(h.tri, [ox, oy, oz]);
        dirOf.set(h.tri, [dx, dy, dz]);
      }
    }
  };
  /** Whether the eye sees the culled face's back at a point: nothing drawn stands before it or at it (a ray can slip through a seam between two faces, so a face is open only if four points of it are seen so). */
  const seesBack = (e: readonly number[], t: number, w: [number, number, number]): boolean => {
    const dx = w[0] - (e[0] as number), dy = w[1] - (e[1] as number), dz = w[2] - (e[2] as number);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    collect(e[0] as number, e[1] as number, e[2] as number, dx / len, dy / len, dz / len, len);
    for (const h of hits) if (h.front && h.t <= len + BACKED && h.tri !== t) return false;
    return true;
  };
  // The directions: a sphere (Fibonacci), and straight up and down.
  const dirs: [number, number, number][] = [[0, 1, 0], [0, -1, 0]];
  for (let i = 0; i < directions; i++) {
    const y = 1 - (2 * (i + 0.5)) / directions;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    dirs.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  const fl = floodOf(room.design);
  for (const st of fl.states) {
    // A metre apart: every other cell of the half-metre grid.
    if (st.i % 2 !== 0 || st.j % 2 !== 0) continue;
    const s = (st.i + 0.5) * CELL;
    const d = (st.j + 0.5) * CELL;
    const wx = room.ox + (s + room.s0) * room.tx - d * room.nx;
    const wz = room.oz + (s + room.s0) * room.tz - d * room.nz;
    for (const eye of [1.0, 1.75]) {
      const wy = room.floorY + st.h + eye;
      // An eye inside a slab's own thickness (a head through a landing that the walking lets a hull under) sees the slab's back by being in it: not an eye place, and counted in `inSlab`.
      if (room.design.slabs.some((sl) => sl.thick > 0 && s >= sl.s0 && s <= sl.s1 && d >= sl.d0 && d <= sl.d1 && st.h + eye <= (sl.kind === "floor" ? sl.y : sl.y + sl.thick) && st.h + eye >= (sl.kind === "floor" ? sl.y - sl.thick : sl.y))) {
        roomOpenFaces.inSlab++;
        continue;
      }
      eyeId++;
      for (const dr of dirs) cast(wx, wy, wz, dr[0], dr[1], dr[2]);
    }
  }
  const out: OpenTri[] = [];
  for (const t of open) {
    if ((seenBy.get(t)?.size ?? 0) < MIN_EYES) continue;
    {
      const b0 = t * 9;
      const c = [0, 1, 2].map((k) => ((tri[b0 + k] as number) + (tri[b0 + 3 + k] as number) + (tri[b0 + 6 + k] as number)) / 3);
      let ok = seesBack(eyeOf.get(t) as number[], t, c as [number, number, number]);
      for (let k = 0; k < 3 && ok; k++) {
        const w = [0, 1, 2].map((j) => ((c[j] as number) + (tri[b0 + k * 3 + j] as number)) / 2);
        ok = seesBack(eyeOf.get(t) as number[], t, w as [number, number, number]);
      }
      if (!ok) continue;
    }
    const b = t * 9;
    const e1 = [0, 1, 2].map((k) => (tri[b + 3 + k] as number) - (tri[b + k] as number));
    const e2 = [0, 1, 2].map((k) => (tri[b + 6 + k] as number) - (tri[b + k] as number));
    const cx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
    const cy = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
    const cz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
    out.push({ eye: eyeOf.get(t) as [number, number, number], dir: dirOf.get(t) as [number, number, number], index: t, at: [0, 1, 2].map((k) => ((tri[b + k] as number) + (tri[b + 3 + k] as number) + (tri[b + 6 + k] as number)) / 3) as [number, number, number], n: [nrm[t * 3] as number, nrm[t * 3 + 1] as number, nrm[t * 3 + 2] as number], area: Math.sqrt(cx * cx + cy * cy + cz * cz) / 2 });
  }
  // A face under 25 cm2 (5 cm by 5 cm: the coplanar finder's own floor) is not a hole anyone sees.
  return out.filter((o) => o.area >= 0.0025);
}

roomOpenFaces.inSlab = 0;
