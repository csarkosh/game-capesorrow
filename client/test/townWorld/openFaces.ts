/**
 * Finds the faces of the town whose backs a player can see with nothing there. The town's materials cull back faces, so a face laid as a
 * single sheet (an awning's cloth, a sign, a fence board, a box with no bottom) is simply not there when it is seen from behind or below.
 *
 * For every triangle of the standing layers (solid and sign; not the flat ground, not glass) a ray goes from its middle straight back
 * along the reverse of its normal, and the face is one of:
 *  - backed (fine): within `BACKED` m the ray meets a face that looks the same way (the triangle lies on a wall or a surface), or the ground;
 *  - closed (fine): the first face the ray meets, within `CLOSED` m, looks away from the triangle (the ray is leaving through the far side of
 *    a solid, or through the twin laid wound the other way: `Fx.back`);
 *  - open otherwise: a player on the other side sees nothing.
 * An open face is then counted only if it is reachable from behind: the point `BEHIND` m behind its middle is outside every building's
 * footprint (a roof slope's inner side, a wall's, are inside the building; an eave's underside is not), is not underground and is within
 * `HEIGHT` m of the ground. A pier's deck has no footprint (the finder skips piers' footprints): its underside is reachable.
 *
 * More rules, all in `OPEN_RULE` and each tuned on a real case:
 *  - a ray from a face's middle can slip through a seam of a closed solid (the far side of a five-sided post is an edge), so a face is open
 *    only when the rays from its middle and from three points half way to its corners all are;
 *  - a box standing on the ground has no bottom to meet: half way down the ray every side wall shows its back (closed);
 *  - not reachable: a point with a face within `slit` m on both sides of it (between a fence's two faces), a point under flat ground (a quay's
 *    fill), a point with faces round it on three sides and over it (inside a lean-to or a tower), a point between a floor and a ceiling less
 *    than `squeeze` m apart (inside a flat box).
 *
 * The finder reads only what is drawn: a face that is missing altogether (a bottomless box has no triangle whose back is the missing bottom)
 * is found by the faces whose backs show through it, and a few of those are in cavities the rules call closed.
 */
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import type { Tri } from "./nearPlanes.js";
import type { TownFaces } from "./townFaces.js";

export const OPEN_RULE = {
  /** A face looking the same way this near behind a triangle backs it, metres. A little over the brief's 12 cm: a bar, a curb, a sill, a cornice or a plinth under 50 cm deep or tall stands on its surface with its sides reaching down to it, and nobody sees the inside of it. */
  backed: 0.5,
  /** The first face met within this far is a solid's far side, metres. */
  closed: 40,
  /** How far behind its middle the point is that a player must be able to stand at, metres. */
  behind: 0.3,
  /** A building's footprint is taken this much larger: the back of a room's wall is in the wall's thickness, or just outside it, metres. */
  wall: 0.35,
  /** The highest a player can see the back from: over the ground, metres. */
  height: 12,
  /** How far the ray goes that tells a point under flat ground, metres. */
  up: 40,
  /** A point with a face this near on all four sides and over it is inside a cavity, not a place to stand, metres. */
  cavity: 4,
  /** A point with a face this near over it and under it is inside a flat box, metres. */
  squeeze: 0.8,
  /** And a face this near over it (a tower is taller than a lean-to), metres. */
  cavityUp: 20,
  /** A point with a face this near on both sides of it is in a slit, not a place to stand, metres. */
  slit: 0.3,
} as const;

export type OpenFace = {
  readonly tri: Tri;
  readonly area: number;
  readonly reachable: boolean;
  /** The builder that made it: the first frames of its trace, without line numbers. */
  readonly builder: string;
  readonly at: readonly [number, number, number];
};

const CELL = 2;
const key = (ix: number, iy: number, iz: number): number => ((ix + 4096) * 1024 + (iy + 512)) * 8192 + (iz + 4096);

/** The name of the builder of a traced triangle: the first two frames' function and file, no line numbers. */
export function builderOf(t: Tri): string {
  const frames = (t.tag ?? "(untraced)").split(" < ").slice(0, 2);
  return frames.map((f) => f.replace(/:\d+(:\d+)?\)?$/, "")).join(" < ");
}

export function openFaces(f: TownFaces, g0: TownGround, fresh: () => TownGround = () => g0): OpenFace[] {
  // The ground's height is memoised to the millimetre by `townGround`, and a hundred thousand rays would fill its table: a fresh ground now and then.
  let g = g0;
  let calls = 0;
  const heightAt = (x: number, z: number): number => {
    if (++calls > 4_000_000) {
      calls = 0;
      g = fresh();
    }
    return g.heightAt(x, z);
  };
  const tris = f.tris;
  const n = tris.length;
  // The grid of every face a ray can meet (not glass).
  const cells = new Map<number, number[]>();
  const big: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = tris[i] as Tri;
    if (t.layer === "glass" || t.layer === "haze" || t.layer === "shade") continue;
    const p = t.p;
    const x0 = Math.floor(Math.min(p[0], p[3], p[6]) / CELL);
    const x1 = Math.floor(Math.max(p[0], p[3], p[6]) / CELL);
    const y0 = Math.floor(Math.min(p[1], p[4], p[7]) / CELL);
    const y1 = Math.floor(Math.max(p[1], p[4], p[7]) / CELL);
    const z0 = Math.floor(Math.min(p[2], p[5], p[8]) / CELL);
    const z1 = Math.floor(Math.max(p[2], p[5], p[8]) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 60) {
      big.push(i);
      continue;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = key(x, y, z);
      const l = cells.get(k);
      if (l === undefined) cells.set(k, [i]);
      else l.push(i);
    }
  }
  // Buildings' footprints, binned by 16 m.
  type Fp = { cx: number; cz: number; ux: number; uz: number; vx: number; vz: number; hu: number; hv: number };
  const fps = new Map<number, Fp[]>();
  const fk = (ix: number, iz: number): number => (ix + 4096) * 8192 + (iz + 4096);
  for (const b of g.plan.buildings) {
    if (b.kind === "pier") continue;
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const fp: Fp = { cx: g.anchor.x + b.centre.x, cz: g.anchor.z + b.centre.z, ux: u.x, uz: u.z, vx: v.x, vz: v.z, hu: b.halfAlong, hv: b.halfAcross };
    const r = b.halfAlong + b.halfAcross;
    for (let ix = Math.floor((fp.cx - r) / 16); ix <= Math.floor((fp.cx + r) / 16); ix++) {
      for (let iz = Math.floor((fp.cz - r) / 16); iz <= Math.floor((fp.cz + r) / 16); iz++) {
        const l = fps.get(fk(ix, iz));
        if (l === undefined) fps.set(fk(ix, iz), [fp]);
        else l.push(fp);
      }
    }
  }
  const insideBuilding = (x: number, z: number): boolean => {
    const l = fps.get(fk(Math.floor(x / 16), Math.floor(z / 16)));
    if (l === undefined) return false;
    for (const fp of l) {
      const dx = x - fp.cx;
      const dz = z - fp.cz;
      if (Math.abs(dx * fp.ux + dz * fp.uz) < fp.hu + OPEN_RULE.wall && Math.abs(dx * fp.vx + dz * fp.vz) < fp.hv + OPEN_RULE.wall) return true;
    }
    return false;
  };

  const stamp = new Int32Array(n);
  let stampNo = 0;
  /** The nearest face the ray meets (self excluded): its distance along the ray and the dot of its normal with the ray. */
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number, self: number): { t: number; facing: number; layer: string } | null => {
    stampNo++;
    let bestT = tmax;
    let bestF = 0;
    let bestL = "";
    let hit = false;
    const test = (i: number): void => {
      if (i === self || stamp[i] === stampNo) return;
      stamp[i] = stampNo;
      const t = tris[i] as Tri;
      const p = t.p;
      const e1x = p[3] - p[0];
      const e1y = p[4] - p[1];
      const e1z = p[5] - p[2];
      const e2x = p[6] - p[0];
      const e2y = p[7] - p[1];
      const e2z = p[8] - p[2];
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) return;
      const inv = 1 / det;
      const sx = ox - p[0];
      const sy = oy - p[1];
      const sz = oz - p[2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < -2e-3 || u > 1 + 2e-3) return;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < -2e-3 || u + v > 1 + 2e-3) return;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt <= 1e-5 || tt > bestT + 1e-4) return;
      const facing = t.n[0] * dx + t.n[1] * dy + t.n[2] * dz;
      // Two faces in one plane (boxes that abut): the one that shows its back wins, the ray is leaving a solid.
      if (tt >= bestT - 1e-4 && (!hit || bestF > 0 || facing <= 0)) return;
      bestT = Math.min(tt, bestT);
      bestF = facing;
      bestL = t.layer;
      hit = true;
    };
    // Sampled every fifth of a cell, so that no cell the ray crosses is skipped (a corner clipped by a slanting ray), and stopped as soon as a hit lies behind the sample.
    const step = CELL / 10;
    const last = new Set<number>();
    for (let s = 0; s <= tmax + step; s += step) {
      const tt = Math.min(s, tmax);
      const x = ox + dx * tt;
      const y = oy + dy * tt;
      const z = oz + dz * tt;
      const k = key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
      if (!last.has(k)) {
        last.add(k);
        const l = cells.get(k);
        if (l !== undefined) for (const i of l) test(i);
      }
      if (hit && bestT <= tt - step) break;
    }
    for (const i of big) test(i);
    return hit ? { t: bestT, facing: bestF, layer: bestL } : null;
  };

  const out: OpenFace[] = [];
  for (let i = 0; i < n; i++) {
    const t = tris[i] as Tri;
    if (t.layer !== "solid" && t.layer !== "sign") continue;
    const p = t.p;
    const mx = (p[0] + p[3] + p[6]) / 3;
    const my = (p[1] + p[4] + p[7]) / 3;
    const mz = (p[2] + p[5] + p[8]) / 3;
    const [nx, ny, nz] = t.n;
    const dx = -nx;
    const dy = -ny;
    const dz = -nz;
    // Whether the back of the face is open at a point of it: the ray from there along the reverse of the normal.
    const openAt = (mx: number, my: number, mz: number): boolean => {
    // The ground: the first step along the ray that is under it.
    let groundT = Infinity;
    // Near first (the ground backing a face), then coarsely, and only for a ray that goes down.
    for (let s = 0; s <= OPEN_RULE.closed; s += s < 0.12 ? 0.04 : 0.5) {
      if (s > 0.12 && dy > -0.05) break;
      const x = mx + dx * s;
      const z = mz + dz * s;
      if (my + dy * s <= heightAt(x, z) + 0.005) {
        groundT = s;
        break;
      }
    }
    if (groundT <= OPEN_RULE.backed) return false;
    // Start a hair in front, so the twin laid wound the other way (and the triangle itself) is met first.
    const o = 0.002;
    const hit = cast(mx + nx * o, my + ny * o, mz + nz * o, dx, dy, dz, Math.min(OPEN_RULE.closed, groundT) + o, i);
    if (hit !== null) {
      const tt = hit.t - o;
      if (hit.facing > 0 && tt < OPEN_RULE.closed) return false; // closed: the far side of a solid, or a twin
      if (hit.facing < 0 && tt <= OPEN_RULE.backed) return false; // backed by a face looking the same way
    }
    // A box standing on the ground has no bottom to meet: halfway down the ray, every side wall shows its back (closed).
    const reach = hit !== null ? hit.t - o : groundT < Infinity ? groundT : 0;
    if (reach > OPEN_RULE.backed && reach < OPEN_RULE.closed) {
      let inside = true;
      for (const [rx, rz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const h = cast(mx + dx * reach * 0.5, my + dy * reach * 0.5, mz + dz * reach * 0.5, rx, 0, rz, OPEN_RULE.up, i);
        if (h === null || h.facing <= 0) {
          inside = false;
          break;
        }
      }
      if (inside) return false;
    }
    return true;
    };
    // One ray can slip through a seam of a closed solid (the opposite of a face of a five-sided post is a vertex): the face is open only if rays from its middle and from three points toward its corners all are.
    if (!openAt(mx, my, mz)) continue;
    let leaks = false;
    for (let k = 0; k < 3 && !leaks; k++) if (!openAt(mx + ((p[k * 3] as number) - mx) * 0.5, my + ((p[k * 3 + 1] as number) - my) * 0.5, mz + ((p[k * 3 + 2] as number) - mz) * 0.5)) leaks = true;
    if (leaks) continue;
    // Open. Can a player stand behind it?
    const bx = mx + dx * OPEN_RULE.behind;
    const by = my + dy * OPEN_RULE.behind;
    const bz = mz + dz * OPEN_RULE.behind;
    const gh = heightAt(bx, bz);
    let reachable = !insideBuilding(bx, bz) && by >= gh && by - gh <= OPEN_RULE.height;
    if (reachable) {
      // Not under flat ground (a quay's fill), and not in a closed cavity: something within `cavity` m on all four sides and over it (a lean-to's inside, a box with no bottom, a room the footprints do not know), which no player can stand in.
      // Nor in a slit: a face within `slit` m on both sides of it along x or along z (between a fence's two faces, under its cap), where a person cannot stand.
      for (const [rx, rz] of [[1, 0], [0, 1]] as const) {
        const h1 = cast(bx, by, bz, rx, 0, rz, OPEN_RULE.slit, -1);
        const h2 = h1 === null ? null : cast(bx, by, bz, -rx, 0, -rz, OPEN_RULE.slit, -1);
        if (h1 !== null && h2 !== null) reachable = false;
      }
      const up = cast(bx, by, bz, 0, 1, 0, OPEN_RULE.up, -1);
      // Nor between a floor and a ceiling less than `squeeze` m apart (inside a flat box: a parapet, a slab).
      if (up !== null && up.t < OPEN_RULE.squeeze && cast(bx, by, bz, 0, -1, 0, OPEN_RULE.squeeze, -1) !== null) reachable = false;
      // Under flat ground a little further back too: a quay wall's face is at its apron's very edge.
      let buried = false;
      for (const k of [0.3, 0.7]) {
        const u2 = cast(bx + dx * k, by + dy * k, bz + dz * k, 0, 1, 0, OPEN_RULE.up, -1);
        if (u2 !== null && u2.facing > 0 && u2.layer === "flat") buried = true;
      }
      if (!reachable) { /* in a slit */ } else if (buried) reachable = false;
      else if (up !== null && up.facing > 0 && up.layer === "flat") reachable = false;
      else if (up !== null && up.t < OPEN_RULE.cavityUp) {
        // Three sides of four are enough: the fourth may be a gap in a wall's run.
        let blocked = 0;
        for (const [rx, rz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (cast(bx, by, bz, rx, 0, rz, OPEN_RULE.cavity, -1) !== null) blocked++;
        const sealed = blocked >= 3;
        if (sealed) reachable = false;
      }
    }
    const ex1 = p[3] - p[0];
    const ey1 = p[4] - p[1];
    const ez1 = p[5] - p[2];
    const ex2 = p[6] - p[0];
    const ey2 = p[7] - p[1];
    const ez2 = p[8] - p[2];
    const cx = ey1 * ez2 - ez1 * ey2;
    const cy = ez1 * ex2 - ex1 * ez2;
    const cz = ex1 * ey2 - ey1 * ex2;
    out.push({ tri: t, area: Math.sqrt(cx * cx + cy * cy + cz * cz) / 2, reachable, builder: builderOf(t), at: [mx, my, mz] });
  }
  void bearingV;
  return out;
}

/** The open faces by builder: how many triangles, how many reachable and the reachable area, most area first. */
export function byBuilder(faces: readonly OpenFace[]): { builder: string; open: number; reachable: number; area: number }[] {
  const m = new Map<string, { builder: string; open: number; reachable: number; area: number }>();
  for (const o of faces) {
    let r = m.get(o.builder);
    if (r === undefined) {
      r = { builder: o.builder, open: 0, reachable: 0, area: 0 };
      m.set(o.builder, r);
    }
    r.open++;
    if (o.reachable) {
      r.reachable++;
      r.area += o.area;
    }
  }
  return [...m.values()].sort((a, b) => b.area - a.area);
}
