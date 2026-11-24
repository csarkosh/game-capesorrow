/**
 * What stands over the water: the decks (piers, the platforms the terminal's sheds
 * stand on, floats, gangways), the wharf street's skirts and piles, and the bull rails along every railed edge.
 *
 * - **Decks** are `plan.decks`, the one list the simulation walks on (`sim/town/decks.ts`): each is drawn with its top at
 *   exactly the height `deckTopAt` gives there (a gangway's tilted), with a skirt `SKIRT` m deep round its edges, and a pier,
 *   a shed's platform and the wharf on piles every `PILE_STEP` m along each side, from the sea floor up, wherever the ground
 *   is more than half a metre under the deck. The wharf's surface is the street's own (`streetGeometry`).
 * - **The quay** is `quayGeometry.ts`.
 * - **Rails** (`TownGround.rails`): a timber bull rail along every edge the simulation holds a walker back from.
 */
import { type Rgb, type Vec3 } from "./meshBuilder.js";
import { withMat } from "./materials.js";
import { DECK, PILE } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import type { Deck, Street } from "../../sim/town/types.js";

/** How far over the deck a rail's sides and posts begin: the quay's cap under them stands 2 cm over it, and its end faces end there. */
const CAP_CLEAR = 0.025;

export const RAIL_HEIGHT = 0.3;
export const RAIL_WIDTH = 0.28;
export const SKIRT = 0.45;
export const PILE_HALF = 0.18;
export const PILE_STEP = 4;
/** How far under the sea's level the quay's face and the piles go, at the least, metres. */
export const FACE_DEPTH = 1.6;

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
/** The underside of a deck: dark, grey with dirt. */
const UNDERSIDE: Rgb = [0.2, 0.19, 0.18];

function pile(sink: Sink, g: TownGround, x: number, z: number, top: number): void {
  const bottom = Math.min(g.heightAt(x, z), SEA - FACE_DEPTH) - 0.2;
  withMat("wood", () => sink(x, z).box(x, z, bottom, 1, 0, PILE_HALF, PILE_HALF, top - bottom, PILE, PILE));
}

/** The top of a deck at the along coordinate `a` (from `-halfAlong` to `halfAlong`): the plan's own interpolation. */
export function deckTop(d: Deck, a: number): number {
  const t = (Math.min(d.halfAlong, Math.max(-d.halfAlong, a)) + d.halfAlong) / (2 * d.halfAlong);
  return d.top + (d.topEnd - d.top) * t;
}

/** A rectangular deck (a pier's, a shed's platform, a float, a gangway), its skirt and, on piles, its piles. */
export function deckGeometry(g: TownGround, solid: Sink, d: Deck): void {
  const cx = g.anchor.x + d.centre.x;
  const cz = g.anchor.z + d.centre.z;
  const ux = d.axis.x;
  const uz = d.axis.z;
  const vx = uz;
  const vz = -ux;
  const halfU = d.halfAlong;
  const halfV = d.halfAcross;
  const onPiles = d.kind === "pier" || d.kind === "shed";
  const n = Math.max(1, Math.ceil((2 * halfU) / 4));
  const at = (su: number, sv: number): [number, number] => [cx + ux * su + vx * sv, cz + uz * su + vz * sv];
  for (let i = 0; i < n; i++) {
    const a = -halfU + (i / n) * 2 * halfU;
    const b = -halfU + ((i + 1) / n) * 2 * halfU;
    const ya = deckTop(d, a);
    const yb = deckTop(d, b);
    const q: Vec3[] = [[...at(a, -halfV), ya], [...at(b, -halfV), yb], [...at(b, halfV), yb], [...at(a, halfV), ya]].map(([x, z, y]) => [x as number, y as number, z as number]);
    const mid = at((a + b) / 2, 0);
    const s = solid(mid[0], mid[1]);
    s.poly(q, UP, DECK, "wood");
    // Its underside, between the skirts: dark boards, grey with dirt and cobweb (seen from a boat or the beach).
    s.poly(q.map((p): Vec3 => [p[0], p[1] - SKIRT, p[2]]), DOWN, UNDERSIDE, "wood");
    // The skirt down both long edges of the tile.
    for (const sgn of [-1, 1]) {
      const p0 = q[sgn < 0 ? 0 : 3] as Vec3;
      const p1 = q[sgn < 0 ? 1 : 2] as Vec3;
      withMat("wood", () => s.poly([[p0[0], p0[1] - SKIRT, p0[2]], [p1[0], p1[1] - SKIRT, p1[2]], [p1[0], p1[1], p1[2]], [p0[0], p0[1], p0[2]]], [vx * sgn, 0, vz * sgn], PILE, "wood", { back: true }));
    }
  }
  // The end skirts.
  for (const su of [-halfU, halfU]) {
    const [x0, z0] = at(su, -halfV);
    const [x1, z1] = at(su, halfV);
    const y = deckTop(d, su);
    solid(x0, z0).poly([[x0, y - SKIRT, z0], [x1, y - SKIRT, z1], [x1, y, z1], [x0, y, z0]], [ux * Math.sign(su), 0, uz * Math.sign(su)], PILE, "wood");
  }
  if (!onPiles) return;
  // The piles: a row down each long side and one down the middle of a wide deck, every PILE_STEP.
  const rows = halfV > 6 ? [-halfV + 0.4, 0, halfV - 0.4] : [-halfV + 0.4, halfV - 0.4];
  const steps = Math.max(1, Math.round((2 * halfU) / PILE_STEP));
  for (let i = 0; i <= steps; i++) {
    const su = -halfU + 0.3 + (i / steps) * (2 * halfU - 0.6);
    for (const sv of rows) {
      const [x, z] = at(su, sv);
      if (g.heightAt(x, z) < deckTop(d, su) - 0.5) pile(solid, g, x, z, deckTop(d, su) - 0.1);
    }
  }
}

/** The decks of the plan that are drawn as decks: every one but the wharf's, whose surface is the street's own. */
export function deckGeometryAll(g: TownGround, solid: Sink): void {
  for (const d of g.plan.decks) if (d.kind !== "wharf" && d.kind !== "apron") deckGeometry(g, solid, d);
}

/** A bull rail along every railed edge: a timber a hand high and a hand wide on the deck's edge, level or following a gangway's slope. */
export function railGeometry(g: TownGround, solid: Sink): void {
  for (const r of g.rails) {
    const len = Math.sqrt((r.bx - r.ax) * (r.bx - r.ax) + (r.bz - r.az) * (r.bz - r.az));
    if (!(len > 0.05)) continue;
    const tx = (r.bx - r.ax) / len;
    const tz = (r.bz - r.az) / len;
    // The rail sits just inboard of the edge, across RAIL_WIDTH.
    const ox = r.nx * RAIL_WIDTH;
    const oz = r.nz * RAIL_WIDTH;
    const o = (k: number): [number, number] => [r.ax + (r.bx - r.ax) * k, r.az + (r.bz - r.az) * k];
    const top = RAIL_HEIGHT;
    const n = Math.max(1, Math.ceil(len / 4));
    for (let i = 0; i < n; i++) {
      const k0 = i / n;
      const k1 = (i + 1) / n;
      const [x0, z0] = o(k0);
      const [x1, z1] = o(k1);
      const y0 = r.topA + (r.topB - r.topA) * k0;
      const y1 = r.topA + (r.topB - r.topA) * k1;
      const s = solid((x0 + x1) / 2, (z0 + z1) / 2);
      const out: Vec3 = [-r.nx, 0, -r.nz];
      const inn: Vec3 = [r.nx, 0, r.nz];
      const P = (x: number, z: number, y: number): Vec3 => [x, y, z];
      s.poly([P(x0, z0, y0 + top), P(x1, z1, y1 + top), P(x1 + ox, z1 + oz, y1 + top), P(x0 + ox, z0 + oz, y0 + top)], UP, PILE, "wood");
      // The rail's sides begin over the cap that runs under it (its top is 2 cm over the deck), so they are not faces in the cap's end planes.
      s.poly([P(x0, z0, y0 + CAP_CLEAR), P(x1, z1, y1 + CAP_CLEAR), P(x1, z1, y1 + top), P(x0, z0, y0 + top)], out, PILE, "wood");
      s.poly([P(x0 + ox, z0 + oz, y0 + CAP_CLEAR), P(x1 + ox, z1 + oz, y1 + CAP_CLEAR), P(x1 + ox, z1 + oz, y1 + top), P(x0 + ox, z0 + oz, y0 + top)], inn, PILE, "wood");
    }
    // A post at the end of each rail and every 3 m.
    const posts = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) {
      const k = i / posts;
      const [x, z] = o(k);
      const y = r.topA + (r.topB - r.topA) * k;
      // It stands on the rail (its foot is not a second set of faces inside the rail's own sides, whose grain runs the other way).
      withMat("wood", () => solid(x, z).box(x + r.nx * RAIL_WIDTH * 0.5, z + r.nz * RAIL_WIDTH * 0.5, y + top, tx, tz, 0.07, 0.07, 0.8 - top, PILE, PILE, true, null));
    }
  }
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
      solid(p0[0], p0[2]).poly([[p0[0], p0[1] - SKIRT, p0[2]], [p1[0], p1[1] - SKIRT, p1[2]], p1, p0], [nx * Math.sign(t), 0, nz * Math.sign(t)], PILE, "wood");
    }
  }
}
