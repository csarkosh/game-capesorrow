/**
 * What stands over the water or against it: the quay's apron, curb and face, the piers, the decks the terminal's
 * sheds stand on, and the wharf street's deck, each on rows of piles down into the water.
 *
 * - **The quay** (`plan.quay`) is the straight edge of the made ground. Seaward of its line the made ground falls away
 *   in a bank, so a face drawn on the line itself would be buried: the quay is an apron `APRON` m wide at the line's
 *   own height, a low curb along its seaward edge, and a face that goes down from the curb into the water.
 * - **A deck** (pier, shed's platform, wharf) stands at the quay's height at the nearest point of the quay (`quayDeck`),
 *   or on the ground where that is higher, with a skirt `SKIRT` m deep round its edges and piles every `PILE_STEP`
 *   m along each side, from the sea floor up, wherever the ground is more than half a metre under the deck.
 */
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { DECK, PILE, QUAY_CONCRETE, QUAY_FACE } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import { bearingU } from "../../sim/town/bearings.js";
import type { Building, Street } from "../../sim/town/types.js";

export const APRON = 3;
export const CURB_HEIGHT = 0.3;
export const CURB_WIDTH = 0.4;
export const SKIRT = 0.45;
export const PILE_HALF = 0.18;
export const PILE_STEP = 4;
/** How far under the sea's level the quay's face and the piles go, at the least, metres. */
export const FACE_DEPTH = 1.6;

const UP: Vec3 = [0, 1, 0];

/** The quay's own height, which a deck over the water stands at: the ground's height at the nearest point of the quay's line. */
export function quayDeck(g: Pick<TownGround, "plan" | "anchor" | "heightAt">): (x: number, z: number) => number {
  const { quay } = g.plan;
  const ax = g.anchor.x + quay.a.x;
  const az = g.anchor.z + quay.a.z;
  const dx = g.anchor.x + quay.b.x - ax;
  const dz = g.anchor.z + quay.b.z - az;
  const len2 = dx * dx + dz * dz;
  return (x, z) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    return g.heightAt(ax + dx * t, az + dz * t) + 0.1;
  };
}

function pile(sink: Sink, g: TownGround, x: number, z: number, top: number): void {
  const bottom = Math.min(g.heightAt(x, z), SEA - FACE_DEPTH) - 0.2;
  sink(x, z).box(x, z, bottom, 1, 0, PILE_HALF, PILE_HALF, top - bottom, PILE, PILE);
}

/** The quay: apron, curb and face, in tiles of `TILE` along its line. */
export function quayGeometry(g: TownGround, solid: Sink, flat: Sink): void {
  const { quay } = g.plan;
  const ax = g.anchor.x + quay.a.x;
  const az = g.anchor.z + quay.a.z;
  const bx = g.anchor.x + quay.b.x;
  const bz = g.anchor.z + quay.b.z;
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  // The sea is to the west: the normal that has a negative x.
  const sx = tz > 0 ? -tz : tz;
  const sz = tz > 0 ? tx : -tx;
  const n = Math.max(1, Math.ceil(len / 4));
  const at = (s: number, off: number): [number, number] => [ax + tx * s + sx * off, az + tz * s + sz * off];
  const topAt = (s: number): number => {
    const [x, z] = at(s, 0);
    return g.heightAt(x, z) + 0.1;
  };
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * len;
    const s1 = ((i + 1) / n) * len;
    const y0 = topAt(s0);
    const y1 = topAt(s1);
    const p = (s: number, off: number, y: number): Vec3 => {
      const [x, z] = at(s, off);
      return [x, y, z];
    };
    const mid = at((s0 + s1) / 2, 0);
    const out: Vec3 = [sx, 0, sz];
    const back: Vec3 = [-sx, 0, -sz];
    const apron = flat(mid[0], mid[1]);
    apron.poly([p(s0, 0, y0), p(s1, 0, y1), p(s1, APRON - CURB_WIDTH, y1), p(s0, APRON - CURB_WIDTH, y0)], UP, QUAY_CONCRETE);
    const s = solid(mid[0], mid[1]);
    // The curb: top, and the two faces; then the quay's face down to the water.
    s.poly([p(s0, APRON - CURB_WIDTH, y0 + CURB_HEIGHT), p(s1, APRON - CURB_WIDTH, y1 + CURB_HEIGHT), p(s1, APRON, y1 + CURB_HEIGHT), p(s0, APRON, y0 + CURB_HEIGHT)], UP, QUAY_CONCRETE);
    s.poly([p(s0, APRON - CURB_WIDTH, y0), p(s1, APRON - CURB_WIDTH, y1), p(s1, APRON - CURB_WIDTH, y1 + CURB_HEIGHT), p(s0, APRON - CURB_WIDTH, y0 + CURB_HEIGHT)], back, QUAY_CONCRETE);
    s.poly([p(s0, APRON, y0), p(s1, APRON, y1), p(s1, APRON, SEA - FACE_DEPTH), p(s0, APRON, SEA - FACE_DEPTH)], out, QUAY_FACE);
    s.poly([p(s0, APRON, y0 + CURB_HEIGHT), p(s1, APRON, y1 + CURB_HEIGHT), p(s1, APRON, y1), p(s0, APRON, y0)], out, QUAY_CONCRETE);
  }
}

/** A rectangular deck (a pier's, a shed's platform), its skirt and its piles. `u` is the long axis. */
function deckGeometry(g: TownGround, solid: Sink, cx: number, cz: number, ux: number, uz: number, halfU: number, halfV: number): void {
  const vx = uz;
  const vz = -ux;
  const level = g.deckAt(cx, cz);
  const colour: Rgb = DECK;
  const n = Math.max(1, Math.ceil((2 * halfU) / 4));
  const at = (su: number, sv: number): [number, number] => [cx + ux * su + vx * sv, cz + uz * su + vz * sv];
  const top = (x: number, z: number): number => Math.max(level, g.heightAt(x, z) + 0.08);
  for (let i = 0; i < n; i++) {
    const a = -halfU + (i / n) * 2 * halfU;
    const b = -halfU + ((i + 1) / n) * 2 * halfU;
    const q = [at(a, -halfV), at(b, -halfV), at(b, halfV), at(a, halfV)].map(([x, z]): Vec3 => [x, top(x, z), z]);
    const mid = at((a + b) / 2, 0);
    const s = solid(mid[0], mid[1]);
    s.poly(q, UP, colour);
    // The skirt down both long edges of the tile.
    for (const sgn of [-1, 1]) {
      const p0 = q[sgn < 0 ? 0 : 3] as Vec3;
      const p1 = q[sgn < 0 ? 1 : 2] as Vec3;
      s.poly([[p0[0], p0[1] - SKIRT, p0[2]], [p1[0], p1[1] - SKIRT, p1[2]], [p1[0], p1[1], p1[2]], [p0[0], p0[1], p0[2]]], [vx * sgn, 0, vz * sgn], PILE);
    }
  }
  // The end skirts, and the piles: a row down each long side and one down the middle of a wide deck, every PILE_STEP.
  for (const su of [-halfU, halfU]) {
    const [x0, z0] = at(su, -halfV);
    const [x1, z1] = at(su, halfV);
    const y0 = top(x0, z0);
    const y1 = top(x1, z1);
    solid(x0, z0).poly([[x0, y0 - SKIRT, z0], [x1, y1 - SKIRT, z1], [x1, y1, z1], [x0, y0, z0]], [ux * Math.sign(su), 0, uz * Math.sign(su)], PILE);
  }
  const rows = halfV > 6 ? [-halfV + 0.4, 0, halfV - 0.4] : [-halfV + 0.4, halfV - 0.4];
  const steps = Math.max(1, Math.round((2 * halfU) / PILE_STEP));
  for (let i = 0; i <= steps; i++) {
    const su = -halfU + 0.3 + (i / steps) * (2 * halfU - 0.6);
    for (const sv of rows) {
      const [x, z] = at(su, sv);
      if (g.heightAt(x, z) < top(x, z) - 0.5) pile(solid, g, x, z, top(x, z) - 0.1);
    }
  }
}

/** A building of no lot: a pier is its deck; a shed on piles stands on a deck a metre wider than itself all round. */
export function pierGeometry(g: TownGround, b: Building, solid: Sink): void {
  const u = bearingU(b.bearing);
  const cx = g.anchor.x + b.centre.x;
  const cz = g.anchor.z + b.centre.z;
  // The pier's long axis is its across axis (`halfAcross` is its length): the deck is built along the longer.
  const alongLong = b.halfAlong >= b.halfAcross;
  const margin = b.kind === "pier" ? 0 : 1;
  if (alongLong) deckGeometry(g, solid, cx, cz, u.x, u.z, b.halfAlong + margin, b.halfAcross + margin);
  else deckGeometry(g, solid, cx, cz, u.z, -u.x, b.halfAcross + margin, b.halfAlong + margin);
}

/** A wharf street: a deck's skirt and piles along its two edges (its surface is the street's own, `streetGeometry`). */
export function wharfGeometry(g: TownGround, street: Street, solid: Sink): void {
  const ax = g.anchor.x + street.a.x;
  const az = g.anchor.z + street.a.z;
  const bx = g.anchor.x + street.b.x;
  const bz = g.anchor.z + street.b.z;
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  const nx = tz;
  const nz = -tx;
  const hw = street.width / 2;
  const n = Math.max(1, Math.ceil(len / 4));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * len;
    for (const t of [-hw + 0.3, hw - 0.3]) {
      const x = ax + tx * s + nx * t;
      const z = az + tz * s + nz * t;
      const y = Math.max(g.deckAt(x, z), g.heightAt(x, z) + 0.06);
      if (g.heightAt(x, z) < y - 0.5) pile(solid, g, x, z, y - 0.1);
    }
  }
  for (const t of [-hw, hw]) {
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * len;
      const s1 = ((i + 1) / n) * len;
      const p = (s: number): Vec3 => {
        const x = ax + tx * s + nx * t;
        const z = az + tz * s + nz * t;
        return [x, Math.max(g.deckAt(x, z), g.heightAt(x, z) + 0.06), z];
      };
      const p0 = p(s0);
      const p1 = p(s1);
      solid(p0[0], p0[2]).poly([[p0[0], p0[1] - SKIRT, p0[2]], [p1[0], p1[1] - SKIRT, p1[2]], p1, p0], [nx * Math.sign(t), 0, nz * Math.sign(t)], PILE);
    }
  }
}
