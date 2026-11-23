/**
 * What is made where a street ends (`plan.ends`): the pavement stops at a clean line, and beyond it is gravel for a few
 * metres, with what the plan chose there:
 *
 * - **A turnaround**: a bulb of gravel, wider than the roadway, to turn a vehicle in.
 * - **A barricade**: a strip of gravel the roadway's width, and across it a barricade of two striped boards on three posts.
 * - **A landing** at the water: a short strip of gravel and a low timber bumper across the end.
 *
 * Gravel lies on the ground a little over a verge (`END_LIFT`); posts, boards and the bumper stand, in the solid layer.
 */
import { flatSurfaceFor } from "./groundSurfaces.js";
import { BARRICADE_RED, BARRICADE_WHITE, GRAVEL, TIMBER, PILE } from "./palette.js";
import type { Rgb, Vec3 } from "./meshBuilder.js";
import { endMarker } from "./signGeometry.js";
import { ROADWAY_LIFT, STREET_LIFT } from "./streetGeometry.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";

/** How far the gravel runs beyond the pavement's end, metres. */
export const GRAVEL_LENGTH = 6;
/** A turnaround's bulb: its radius beyond the roadway's half width, metres. */
export const BULB_EXTRA = 3.5;
/** The gravel's lift over the ground, metres. */
export const END_LIFT = STREET_LIFT + 0.005;

const UP: Vec3 = [0, 1, 0];

export function endsGeometry(g: TownGround, flat: Sink, solid: Sink): void {
  for (const e of g.plan.ends) {
    const st = g.plan.streets[e.street];
    if (st === undefined) continue;
    const x = g.anchor.x + e.x;
    const z = g.anchor.z + e.z;
    const cw = st.roadway / 2;
    // The end's axes: out along the street, and across it.
    const ox = e.dx;
    const oz = e.dz;
    const nx = oz;
    const nz = -ox;
    const at = (s: number, t: number): [number, number] => [x + ox * s + nx * t, z + oz * s + nz * t];
    const lay = (pts: readonly [number, number][], colour: Rgb): void => {
      const corners = pts.map(([px, pz]): Vec3 => [px, g.heightAt(px, pz) + END_LIFT, pz]);
      if (corners.every((c) => c[1] - END_LIFT < SEA + 0.1)) return;
      const [cx, cz] = pts[0] as [number, number];
      flat(cx, cz).poly(corners, UP, colour, flatSurfaceFor(colour, g.anchor));
    };
    if (e.kind === "turnaround") {
      // A bulb of gravel whose near edge is the pavement's end line.
      const r = cw + BULB_EXTRA;
      const ring: [number, number][] = [];
      const steps = 14;
      for (let k = 0; k < steps; k++) {
        const [c, s] = CIRCLE14[k] as readonly [number, number];
        ring.push(at(r + r * c, r * s));
      }
      // The bulb as fans of quads from its middle, so a tile follows the ground.
      const mid = at(r, 0);
      for (let k = 0; k < steps; k++) {
        const a = ring[k] as [number, number];
        const b = ring[(k + 1) % steps] as [number, number];
        lay([mid, a, b], GRAVEL);
      }
      // The pavement's end is square across the roadway: the bulb is wider, so a strip joins the two.
      lay([at(0, -cw), at(0.5, -cw), at(0.5, cw), at(0, cw)], GRAVEL);
      // The end of the road: three red diamond markers across it (MUTCD 2C, Type 4), 4 ft over the road, facing the street.
      for (const t of [-cw + 0.5, 0, cw - 0.5]) {
        const [mx, mz] = at(0.6, t);
        endMarker(solid, g, mx, mz, -ox, -oz, ROADWAY_LIFT);
      }
      continue;
    }
    const length = e.kind === "landing" ? 3 : GRAVEL_LENGTH;
    lay([at(0, -cw), at(length, -cw), at(length, cw), at(0, cw)], GRAVEL);
    const base = (px: number, pz: number): number => g.heightAt(px, pz);
    if (e.kind === "barricade") {
      // Three posts and two striped boards, a metre beyond the pavement's end, across the roadway.
      const [bx, bz] = at(1, 0);
      for (const t of [-cw + 0.15, 0, cw - 0.15]) {
        const [px, pz] = at(1, t);
        solid(px, pz).box(px, pz, base(px, pz) - 0.05, ox, oz, 0.06, 0.06, 1.2, TIMBER, TIMBER);
      }
      // To the outer posts' middles, so a board's end is inside its post.
      const half = cw - 0.15;
      for (const [y, colour] of [[0.65, BARRICADE_RED], [0.95, BARRICADE_WHITE]] as const) {
        solid(bx, bz).box(bx, bz, base(bx, bz) + y, nx, nz, half, 0.03, 0.22, colour, colour);
      }
    } else {
      // A landing: a low timber bumper across the end.
      const [bx, bz] = at(length, 0);
      solid(bx, bz).box(bx, bz, base(bx, bz) - 0.05, nx, nz, cw, 0.15, 0.45, TIMBER, PILE);
    }
  }
}

/** The corners of a 14-gon of radius 1, as (cos, sin) pairs, from numbers written once (no trigonometry in a builder of the town's shape). */
const CIRCLE14: readonly (readonly [number, number])[] = [
  [1, 0], [0.9010, 0.4339], [0.6235, 0.7818], [0.2225, 0.9749], [-0.2225, 0.9749], [-0.6235, 0.7818], [-0.9010, 0.4339],
  [-1, 0], [-0.9010, -0.4339], [-0.6235, -0.7818], [-0.2225, -0.9749], [0.2225, -0.9749], [0.6235, -0.7818], [0.9010, -0.4339],
];
