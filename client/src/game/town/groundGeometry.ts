/**
 * The town's own ground between its buildings, where the ground is paved: a patch lifted a little over the ground on each
 * block of a paved district, drawn as the streets are, in tiles of `TILE` m that follow the ground.
 *
 * - **The core**: a concrete walk from the street to the building line.
 * - **The dock end, the mill's site and industrial flats**: a gravel yard.
 * - **The working waterfront**: a worn asphalt yard.
 * - **The highway strip**: a parking lot of asphalt, with a few stalls painted where the buildings leave room, in a row along its longest street frontage.
 *
 * Yards of houses, the churchyard, the school's and the hospital's grounds have no patch: they are grass (`sim/town/clearing.ts`).
 */
import { RANK, flatSurfaceFor, type Over } from "./groundSurfaces.js";
import { clamp01, hashN } from "./groundNoise.js";
import { Surface, subtractConvex, type P2 } from "./surface.js";
import { isPaved } from "../../sim/town/clearing.js";
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import { bbox, clipHalfPlane, contains, dist, orient, type Vec } from "../../sim/town/geom.js";
import type { Block, District } from "../../sim/town/types.js";
import { scaled, type Rgb, type Vec3 } from "./meshBuilder.js";
import { PAINT_WHITE, WALK_CONCRETE, YARD_ASPHALT, YARD_GRAVEL } from "./palette.js";
import { STREET_LIFT } from "./streetGeometry.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";

/** The side of a tile, metres. */
export const PATCH_TILE = 8;
/** A patch lies this much over the ground, outside every street's right of way (which it is cut away from: the roadways lie a curb's height lower). */
export const PATCH_LIFT = STREET_LIFT - 0.01;
/** Paint on a lot lies this much over the patch. */
export const STALL_OVER = 0.01;
/** A stall's length and pitch along its row, a line's width, and how far in from the block's edge the row begins, metres. */
export const STALL_LENGTH = 5.5;
export const STALL_PITCH = 2.7;
export const STALL_LINE = 0.1;
export const STALL_SETBACK = 1.2;
/** Stalls keep this far from any building. */
export const STALL_CLEAR = 1.5;

const UP: Vec3 = [0, 1, 0];

/** The patch's colour for a district. */
export function patchColour(d: District): Rgb {
  switch (d) {
    case "core":
      return WALK_CONCRETE;
    case "waterfront":
    case "highway strip":
      return YARD_ASPHALT;
    default:
      return YARD_GRAVEL;
  }
}

export function groundGeometry(g: TownGround, flat: Sink): void {
  const surf = new Surface(g, flat);
  const { plan, anchor } = g;
  const world = (p: Vec): Vec => ({ x: anchor.x + p.x, z: anchor.z + p.z });
  const footprints = new Map<number, Vec[][]>();
  for (const b of plan.buildings) {
    if (b.lot === -1) continue;
    const lot = plan.lots[b.lot];
    if (lot === undefined) continue;
    const u = bearingU(b.bearing);
    const v = bearingV(b.bearing);
    const corner = (su: number, sv: number): Vec => ({ x: b.centre.x + u.x * b.halfAlong * su + v.x * b.halfAcross * sv, z: b.centre.z + u.z * b.halfAlong * su + v.z * b.halfAcross * sv });
    const list = footprints.get(lot.block) ?? [];
    list.push(orient([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]));
    footprints.set(lot.block, list);
  }
  // The streets' rights of way, as rectangles in the world: the patch stops at them.
  const ways: { poly: P2[]; x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const st of plan.streets) {
    if (st.kind === "highway" || st.kind === "rail" || st.kind === "wharf") continue;
    const dx = st.b.x - st.a.x;
    const dz = st.b.z - st.a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0.1)) continue;
    const tx = dx / len;
    const tz = dz / len;
    const hw = st.width / 2;
    const q = (s: number, t: number): P2 => [anchor.x + st.a.x + tx * s - tz * t, anchor.z + st.a.z + tz * s + tx * t];
    const poly = [q(-hw, -hw), q(len + hw, -hw), q(len + hw, hw), q(-hw, hw)];
    ways.push({ poly, x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])), z0: Math.min(...poly.map((p) => p[1])), z1: Math.max(...poly.map((p) => p[1])) });
  }
  const blocks: readonly Block[] = plan.blocks.filter((b) => isPaved(b.district));
  for (const block of blocks) {
    const poly = orient(block.polygon).map(world);
    const bb = bbox(poly);
    const base = patchColour(block.district);
    const x0 = Math.floor(bb.x0 / PATCH_TILE);
    const x1 = Math.floor(bb.x1 / PATCH_TILE);
    const z0 = Math.floor(bb.z0 / PATCH_TILE);
    const z1 = Math.floor(bb.z1 / PATCH_TILE);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        let cell = poly;
        cell = clipHalfPlane(cell, { x: 1, z: 0 }, ix * PATCH_TILE);
        cell = clipHalfPlane(cell, { x: -1, z: 0 }, -(ix + 1) * PATCH_TILE);
        cell = clipHalfPlane(cell, { x: 0, z: 1 }, iz * PATCH_TILE);
        cell = clipHalfPlane(cell, { x: 0, z: -1 }, -(iz + 1) * PATCH_TILE);
        if (cell.length < 3) continue;
        // Without the streets' rights of way: their ground is the street's (cut down for the roadway, with its own sidewalk).
        let pieces: P2[][] = [cell.map((q): P2 => [q.x, q.z])];
        const bx0 = Math.min(...cell.map((q) => q.x));
        const bx1 = Math.max(...cell.map((q) => q.x));
        const bz0 = Math.min(...cell.map((q) => q.z));
        const bz1 = Math.max(...cell.map((q) => q.z));
        for (const r of ways) {
          if (r.x1 < bx0 || r.x0 > bx1 || r.z1 < bz0 || r.z0 > bz1) continue;
          pieces = pieces.flatMap((p) => subtractConvex(p, r.poly));
          if (pieces.length === 0) break;
        }
        // Nor under the buildings: a floor seen through a window is the room's, and a patch pulled forward by the flat layer's depth step would be drawn over it.
        for (const fp of footprints.get(block.id) ?? []) {
          if (pieces.length === 0) break;
          const clip = fp.map((q): P2 => [anchor.x + q.x, anchor.z + q.z]);
          pieces = pieces.flatMap((p) => subtractConvex(p, clip));
        }
        for (const raw of pieces) {
          // Corners that repeat (a clip's seam) are one.
          const piece = raw.filter((q, i) => {
            const prev = raw[(i + raw.length - 1) % raw.length] as P2;
            return Math.abs(q[0] - prev[0]) > 1e-4 || Math.abs(q[1] - prev[1]) > 1e-4;
          });
          // Corners that lie on the line between their neighbours add nothing and would turn the fan's first triangle flat.
          for (let q = piece.length - 1; q >= 0 && piece.length > 3; q--) {
            const a = piece[(q + piece.length - 1) % piece.length] as P2;
            const b = piece[q] as P2;
            const c = piece[(q + 1) % piece.length] as P2;
            if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-4) piece.splice(q, 1);
          }
          if (piece.length < 3) continue;
          // A sliver (a tile's edge cut along a street's) is left out.
          let twice = 0;
          for (let q = 0; q < piece.length; q++) {
            const a = piece[q] as P2;
            const b = piece[(q + 1) % piece.length] as P2;
            twice += a[0] * b[1] - b[0] * a[1];
          }
          if (Math.abs(twice) < 2e-3) continue;
          const pts = piece.map((q): Vec3 => [q[0], g.heightAt(q[0], q[1]) + PATCH_LIFT, q[1]]);
          if (pts.every((q) => q[1] - PATCH_LIFT < SEA + 0.1)) continue;
          // A little variation from tile to tile, so a yard is not one flat colour, with no random call.
          const roll = hashN(ix, iz, 0, 41);
          const colour = scaled(base, 0.9 + 0.2 * roll);
          const surface = flatSurfaceFor(base, g.anchor);
          const shade = colour[0] / base[0];
          // Worn: a tint of its own, dirt and moss in patches (the core's concrete heaves and is mossy where it is shaded by the shops), a frame turned and shifted by a roll.
          const concrete = block.district === "core";
          const worn: Over = {
            tint: [shade * (concrete ? 0.72 : 0.8), shade * (concrete ? 0.74 : 0.8), shade * (concrete ? 0.76 : 0.8)],
            frame: { origin: [ix * PATCH_TILE + hashN(ix, iz, 0, 42) * 3, 0, iz * PATCH_TILE + hashN(ix, iz, 0, 43) * 3], u: roll < 0.5 ? [1, 0, 0] : [0, 0, 1], v: roll < 0.5 ? [0, 0, 1] : [1, 0, 0] },
            wear: clamp01(0.05 + 0.2 * hashN(ix, iz, 0, 44)),
            dirt: clamp01(0.03 + 0.14 * hashN(ix, iz, 0, 45)),
          };
          flat(piece[0]![0], piece[0]![1]).poly(pts, UP, colour, surface === undefined ? undefined : { ...surface, ...worn, tint: worn.tint as Rgb });
        }
      }
    }
    if (block.district === "highway strip") stalls(g, surf, flat, poly, (footprints.get(block.id) ?? []).map((f) => f.map(world)));
  }
}

/** A row of painted stalls along the block's longest edge, where no building is within `STALL_CLEAR` of the stall. */
function stalls(g: TownGround, surf: Surface, flat: Sink, poly: readonly Vec[], buildings: readonly (readonly Vec[])[]): void {
  // The longest edge, and the way in from it.
  let best = 0;
  let from = poly[0] as Vec;
  let to = poly[1] as Vec;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const l = dist(a, b);
    if (l > best) {
      best = l;
      from = a;
      to = b;
    }
  }
  const tx = (to.x - from.x) / best;
  const tz = (to.z - from.z) / best;
  // The polygon is wound counter-clockwise: in from an edge is its left.
  const ix = -tz;
  const iz = tx;
  const at = (s: number, d: number): Vec => ({ x: from.x + tx * s + ix * d, z: from.z + tz * s + iz * d });
  const clear = (p: Vec): boolean => buildings.every((b) => !contains(b as Vec[], p, STALL_CLEAR) && b.every((c) => dist(c, p) > STALL_CLEAR));
  const mark = (corners: readonly Vec[]): void => {
    const pts = corners.map((q): Vec3 => [q.x, g.heightAt(q.x, q.z) + PATCH_LIFT + STALL_OVER, q.z]);
    surf.lay(flat(corners[0]!.x, corners[0]!.z), pts, pts.map(() => PATCH_LIFT + STALL_OVER), PAINT_WHITE, undefined, RANK.paint);
  };
  for (let s = STALL_SETBACK + STALL_PITCH; s < best - STALL_SETBACK; s += STALL_PITCH) {
    const a = at(s, STALL_SETBACK);
    const b = at(s, STALL_SETBACK + STALL_LENGTH);
    // A stall is drawn where its whole length lies on the block, away from the buildings.
    const ok = [0, 0.25, 0.5, 0.75, 1].every((k) => {
      const p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      return contains(poly as Vec[], p, -0.5) && clear(p);
    });
    if (!ok) continue;
    mark([
      { x: a.x - tx * STALL_LINE / 2, z: a.z - tz * STALL_LINE / 2 },
      { x: a.x + tx * STALL_LINE / 2, z: a.z + tz * STALL_LINE / 2 },
      { x: b.x + tx * STALL_LINE / 2, z: b.z + tz * STALL_LINE / 2 },
      { x: b.x - tx * STALL_LINE / 2, z: b.z - tz * STALL_LINE / 2 },
    ]);
  }
}
