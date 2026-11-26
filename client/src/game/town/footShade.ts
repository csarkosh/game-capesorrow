/**
 * The dark on the ground at a wall's foot: where a wall meets the ground each hides half the sky from the other, so the ground is darker in a
 * strip along the wall as the wall is darker at its foot (`skyShade.ts`). With no shadows in the scene it is what says a building stands on
 * the ground and was not set down on it.
 *
 * The ground under a wall may be anything: a sidewalk, a yard's patch, gravel, the engine's own terrain and grass. So the strip is not cut into
 * what it lies on: it is a see-through sheet laid over it, one dark colour, covering most at the wall and nothing at its outer edge
 * (`townMaterial.ts` reads a sheet by its seed, `FOOT_SEED`, and takes how near the wall a pixel is from the sheet's own v). The sheets are a
 * layer of their own (`townGeometry.ts`, "shade"), drawn blended before the rooms' haze and the glass, a little ahead of the flat ground in
 * depth (`townParts.ts`).
 *
 * - A strip a wall, along the part of it that has open ground before it: where another building stands against the wall there is no ground
 *   to darken (and the strip would lie in the neighbour's room).
 * - A corner of the building where two strips end is filled by a fan, dark at the corner itself.
 * - A building on piles stands on its deck: the strip lies on the deck, and there is none where the deck ends.
 * - How far the dark reaches and how deep it is are the building's own (a roll by its id), so no two are alike.
 *
 * Full tier only: the low tier has none.
 */
import { penetration, solidsNear } from "../../sim/town/solid.js";
import type { Building } from "../../sim/town/types.js";
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import type { TownGround } from "./townTypes.js";

/** What marks a foot's sheet in the float a pane keeps its seed in (a pane's is 0 to 1, a room's haze is 2). */
export const FOOT_SEED = 3;
/** How much of the ground the dark covers at the wall itself, and how far from the wall it reaches, metres: each moved by the building's roll. */
export const FOOT_DARK = 0.5;
export const FOOT_OUT = 0.75;
/** The dark's colour: the cold near-black of an unlit crevice out of doors. */
export const FOOT_COLOUR: Rgb = [0.012, 0.013, 0.017];
/** The sheet lies this much over the ground, metres: over the yard's patches and the marks (0.04). */
const LIFT = 0.06;
/** A wall is asked whether it has open ground before it this often along it, metres, and a strip is no longer than `LONGEST`: a long one would leave sloping ground. */
const STEP = 1;
const LONGEST = 6;
/** Where before the wall the open ground is asked for, metres. */
const PROBE = 0.5;

/** A wall as the strip needs it: its two ends, looking at it from outside from left to right, and its outward normal. */
export type FootWall = { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number; readonly nx: number; readonly nz: number; readonly length: number };

/** How far the dark reaches from building `id`'s walls and how much it covers at them. */
export function footLook(id: number): { reach: number; dark: number } {
  return { reach: FOOT_OUT * (0.75 + 0.5 * hash01(id, 771)), dark: FOOT_DARK * (0.8 + 0.3 * hash01(id, 772)) };
}

/** Whether the ground `PROBE` before a wall's point is open: no other building stands on it. */
function open(g: TownGround, b: Building, x: number, z: number): boolean {
  for (const id of solidsNear(g.seed, x, z)) if (id !== b.id && penetration(g.seed, id, x, z) > 0) return false;
  return true;
}

/**
 * Lays the dark at the feet of `b`'s walls into `sheet`. `onPiles`: the building stands on a deck at `deckY`, and the strip lies on the deck.
 */
export function footShade(g: TownGround, sheet: MeshBuilder, b: Building, walls: readonly FootWall[], onPiles: boolean, deckY: number): void {
  const { reach, dark } = footLook(b.id);
  const fx = { clear: 0.5, seed: FOOT_SEED, size: [FOOT_COLOUR[0], FOOT_COLOUR[1]] as const, tilt: [FOOT_COLOUR[2], dark] as const };
  const up: Vec3 = [0, 1, 0];
  // The ground's height at a place, or null where there is none to lie on (past the edge of a pile building's deck).
  const groundAt = (x: number, z: number): number | null => {
    if (!onPiles) return g.heightAt(x, z) + LIFT;
    const deck = g.deckAt(x, z);
    return deck > deckY - 0.5 ? deck + LIFT : null;
  };
  // Whether each wall's two ends have a strip, for the corners' fans.
  const ends: [boolean, boolean][] = walls.map(() => [false, false]);
  walls.forEach((w, i) => {
    const tx = (w.bx - w.ax) / w.length;
    const tz = (w.bz - w.az) / w.length;
    const n = Math.max(1, Math.round(w.length / STEP));
    const at = (k: number): number => (w.length * k) / n;
    // A stretch between two stations has open ground when the place before its middle has.
    const free: boolean[] = [];
    for (let k = 0; k < n; k++) {
      const s = (at(k) + at(k + 1)) / 2;
      const x = w.ax + tx * s + w.nx * PROBE;
      const z = w.az + tz * s + w.nz * PROBE;
      free.push(open(g, b, x, z) && groundAt(x, z) !== null);
    }
    (ends[i] as [boolean, boolean])[0] = free[0] === true;
    (ends[i] as [boolean, boolean])[1] = free[n - 1] === true;
    const most = Math.max(1, Math.round(LONGEST / STEP));
    let k = 0;
    while (k < n) {
      if (free[k] !== true) {
        k++;
        continue;
      }
      let e = k;
      while (e < n && free[e] === true && e - k < most) e++;
      const s0 = at(k);
      const s1 = at(e);
      const corner = (s: number, out: number): Vec3 | null => {
        const x = w.ax + tx * s + w.nx * out;
        const z = w.az + tz * s + w.nz * out;
        // The height is asked a little before the wall, never under it: the ground under a building is not the ground beside it.
        const y = groundAt(x + w.nx * (out > 0 ? 0 : 0.05), z + w.nz * (out > 0 ? 0 : 0.05));
        return y === null ? null : [x, y, z];
      };
      const p = [corner(s0, 0), corner(s1, 0), corner(s1, reach), corner(s0, reach)];
      if (p.every((q) => q !== null)) sheet.poly(p as Vec3[], up, FOOT_COLOUR, undefined, { ...fx, uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] });
      k = e;
    }
  });
  // The corners: where a wall's right end is the next wall's left end and both have a strip, a fan from the corner to the two strips' ends.
  walls.forEach((w, i) => {
    if ((ends[i] as [boolean, boolean])[1] !== true) return;
    const j = walls.findIndex((o, m) => m !== i && Math.abs(o.ax - w.bx) < 1e-6 && Math.abs(o.az - w.bz) < 1e-6);
    if (j < 0 || (ends[j] as [boolean, boolean])[0] !== true) return;
    const o = walls[j] as FootWall;
    // Only a corner that juts out has ground between its two strips.
    if (w.nx * o.nz - w.nz * o.nx === 0) return;
    const place = (dx: number, dz: number): Vec3 | null => {
      const y = groundAt(w.bx + dx + (w.nx + o.nx) * 0.03, w.bz + dz + (w.nz + o.nz) * 0.03);
      return y === null ? null : [w.bx + dx, y, w.bz + dz];
    };
    const p = [place(0, 0), place(w.nx * reach, w.nz * reach), place((w.nx + o.nx) * reach * Math.SQRT1_2, (w.nz + o.nz) * reach * Math.SQRT1_2), place(o.nx * reach, o.nz * reach)];
    if (p.every((q) => q !== null)) sheet.poly(p as Vec3[], up, FOOT_COLOUR, undefined, { ...fx, uvs: [[0, 1], [0, 0], [0, 0], [0, 0]] });
  });
}
