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
import { isPaved } from "../../sim/town/clearing.js";
import { bearingU, bearingV } from "../../sim/town/bearings.js";
import { bbox, clipHalfPlane, contains, dist, orient, type Vec } from "../../sim/town/geom.js";
import type { Block, District } from "../../sim/town/types.js";
import { hash01, scaled, type Rgb, type Vec3 } from "./meshBuilder.js";
import { PAINT_WHITE, WALK_CONCRETE, YARD_ASPHALT, YARD_GRAVEL } from "./palette.js";
import { STREET_LIFT } from "./streetGeometry.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";

/** The side of a tile, metres. */
export const PATCH_TILE = 8;
/** A patch lies this much over the ground, under every street layer (a verge is `STREET_LIFT`). */
export const PATCH_LIFT = STREET_LIFT - 0.012;
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
        const pts = cell.map((q): Vec3 => [q.x, g.heightAt(q.x, q.z) + PATCH_LIFT, q.z]);
        if (pts.every((q) => q[1] - PATCH_LIFT < SEA + 0.1)) continue;
        // A little variation from tile to tile, so a yard is not one flat colour, with no random call.
        const colour = scaled(base, 0.9 + 0.2 * hash01(ix * 7919 + iz * 104729, 41));
        const c = cell[0] as Vec;
        flat(c.x, c.z).poly(pts, UP, colour);
      }
    }
    if (block.district === "highway strip") stalls(g, flat, poly, (footprints.get(block.id) ?? []).map((f) => f.map(world)));
  }
}

/** A row of painted stalls along the block's longest edge, where no building is within `STALL_CLEAR` of the stall. */
function stalls(g: TownGround, flat: Sink, poly: readonly Vec[], buildings: readonly (readonly Vec[])[]): void {
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
    flat(corners[0]!.x, corners[0]!.z).poly(pts, UP, PAINT_WHITE);
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
