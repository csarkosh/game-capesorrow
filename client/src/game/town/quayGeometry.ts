/**
 * The quay as a built edge: along each wet stretch of the line (`plan.quay.wet`) an apron, a straight wall at its seaward edge,
 * and what a working quay has on it.
 *
 * - **The apron** is the deck of the plan (`QUAY_APRON` m wide at `DECK_TOP`), drawn flat. It is left out where a pier, the wharf
 *   or a gangway leaves the quay, which draw their own decks there.
 * - **The wall** stands `PROUD` (a hand) beyond the apron's edge, straight along the stretch, so the terrain's bank, which falls
 *   away under the apron, is hidden behind it. Its face goes from the apron's top to `WALL_FOOT` under the sea. Of timber cribwork
 *   (horizontal wales down the face, a timber cap) or of steel sheet piling (a corrugated face, a concrete cap), as the plan says
 *   (`plan.quay.wall`: a fire after 1921 that took the waterfront rebuilt it in concrete and steel).
 * - **Fender piles** down the face every `FENDER_STEP` m; a **ladder** every `LADDER_STEP` m (two rails and rungs, down to the
 *   water); **bollards** along the apron every `BOLLARD_STEP` m, set back from its edge. Fenders and bollards are not solid.
 * - The **bull rail** along the top is `railGeometry`'s, from the rails the simulation holds a walker to: it is broken where
 *   a deck leaves the quay.
 */
import { type Vec3 } from "./meshBuilder.js";
import { BOLLARD, QUAY_CONCRETE, STEEL, STEEL_RUST, TIMBER, TIMBER_WEATHERED } from "./palette.js";
import { SEA, type Sink, type TownGround } from "./townTypes.js";
import { QUAY_APRON } from "../../sim/town/levels.js";

export const APRON = QUAY_APRON;
/** How far the wall's face stands beyond the apron's edge, metres. */
export const PROUD = 0.1;
/** How far under the sea the wall's foot goes, metres. */
export const WALL_FOOT = 4;
/** How far under the sea the wall's face is drawn with its detail (wales, corrugation), metres. */
export const FACE_DETAIL = 1.2;
export const CAP_HEIGHT = 0.4;
export const FENDER_STEP = 6;
export const LADDER_STEP = 40;
export const BOLLARD_STEP = 15;

const UP: Vec3 = [0, 1, 0];

/** The pieces of a wet stretch that are not under a deck leaving the quay, as intervals along the stretch (metres from its `a`). */
export function freePieces(g: TownGround, a: { x: number; z: number }, b: { x: number; z: number }): [number, number][] {
  const ax = g.anchor.x + a.x;
  const az = g.anchor.z + a.z;
  const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  const tx = (b.x - a.x) / len;
  const tz = (b.z - a.z) / len;
  const sx = g.plan.quay.seaward.x;
  const sz = g.plan.quay.seaward.z;
  let pieces: [number, number][] = [[0, len]];
  for (const d of g.plan.decks) {
    if (d.kind !== "pier" && d.kind !== "wharf" && d.kind !== "gangway") continue;
    let lo = Infinity;
    let hi = -Infinity;
    let nearest = Infinity;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const px = g.anchor.x + d.centre.x + d.axis.x * d.halfAlong * su - d.axis.z * d.halfAcross * sv;
        const pz = g.anchor.z + d.centre.z + d.axis.z * d.halfAlong * su + d.axis.x * d.halfAcross * sv;
        const s = (px - ax) * tx + (pz - az) * tz;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
        nearest = Math.min(nearest, (px - ax) * sx + (pz - az) * sz);
      }
    }
    // A deck leaves the quay if it reaches into the apron from the line.
    if (!(nearest < QUAY_APRON - 0.5)) continue;
    const out: [number, number][] = [];
    for (const [p0, p1] of pieces) {
      if (hi <= p0 || lo >= p1) out.push([p0, p1]);
      else {
        if (lo > p0) out.push([p0, lo]);
        if (hi < p1) out.push([hi, p1]);
      }
    }
    pieces = out;
  }
  return pieces.filter(([p0, p1]) => p1 - p0 > 0.3);
}

/** The quay: the apron, the wall and what stands on and against it, along each wet stretch. */
export function quayGeometry(g: TownGround, solid: Sink, flat: Sink): void {
  const { quay } = g.plan;
  const sx = quay.seaward.x;
  const sz = quay.seaward.z;
  const apron = g.plan.decks.find((d) => d.kind === "apron");
  if (apron === undefined) return;
  const y = apron.top;
  const timber = quay.wall === "timber";
  const faceColour = timber ? TIMBER_WEATHERED : STEEL;
  const capColour = timber ? TIMBER : QUAY_CONCRETE;
  const P = (x: number, h: number, z: number): Vec3 => [x, h, z];
  const faceOff = QUAY_APRON + PROUD;
  for (const w of quay.wet) {
    const ax = g.anchor.x + w.a.x;
    const az = g.anchor.z + w.a.z;
    const len = Math.sqrt((w.b.x - w.a.x) * (w.b.x - w.a.x) + (w.b.z - w.a.z) * (w.b.z - w.a.z));
    const tx = (w.b.x - w.a.x) / len;
    const tz = (w.b.z - w.a.z) / len;
    const at = (s: number, off: number): [number, number] => [ax + tx * s + sx * off, az + tz * s + sz * off];
    const out: Vec3 = [sx, 0, sz];
    const pieces = freePieces(g, w.a, w.b);
    for (const [p0, p1] of pieces) {
      const n = Math.max(1, Math.ceil((p1 - p0) / 4));
      for (let i = 0; i < n; i++) {
        const s0 = p0 + ((p1 - p0) * i) / n;
        const s1 = p0 + ((p1 - p0) * (i + 1)) / n;
        const sm = (s0 + s1) / 2;
        const half = (s1 - s0) / 2;
        const mid = at(sm, QUAY_APRON / 2);
        // The apron, at the deck's own height.
        const [a0x, a0z] = at(s0, 0);
        const [a1x, a1z] = at(s1, 0);
        const [b0x, b0z] = at(s0, QUAY_APRON);
        const [b1x, b1z] = at(s1, QUAY_APRON);
        flat(mid[0], mid[1]).poly([P(a0x, y, a0z), P(a1x, y, a1z), P(b1x, y, b1z), P(b0x, y, b0z)], UP, QUAY_CONCRETE);
        const s = solid(...at(sm, faceOff));
        // The wall's face, from the cap down to the foot.
        const [f0x, f0z] = at(s0, faceOff);
        const [f1x, f1z] = at(s1, faceOff);
        if (timber) {
          // The face runs from under the cap down: the cap's own face is the wall's top.
          s.poly([P(f0x, y - CAP_HEIGHT, f0z), P(f1x, y - CAP_HEIGHT, f1z), P(f1x, SEA - WALL_FOOT, f1z), P(f0x, SEA - WALL_FOOT, f0z)], out, faceColour);
          // Wales: horizontal timbers proud of the face, every 1.3 m from the cap's foot down to just under the water.
          for (let h = y - CAP_HEIGHT - 0.5; h > SEA - FACE_DETAIL; h -= 1.3) {
            const c = at(sm, faceOff + 0.04);
            s.box(c[0], c[1], h, tx, tz, half, 0.04, 0.2, TIMBER, TIMBER);
          }
        } else {
          // Sheet piling: a corrugated face above the water, a plain one below it.
          const lowEdge = SEA - FACE_DETAIL;
          s.poly([P(f0x, lowEdge, f0z), P(f1x, lowEdge, f1z), P(f1x, SEA - WALL_FOOT, f1z), P(f0x, SEA - WALL_FOOT, f0z)], out, faceColour);
          const panels = Math.max(2, Math.round((s1 - s0) / 0.45));
          for (let k = 0; k < panels; k++) {
            const t0 = s0 + ((s1 - s0) * k) / panels;
            const t1 = s0 + ((s1 - s0) * (k + 1)) / panels;
            const tm = (t0 + t1) / 2;
            const colour = k % 2 === 0 ? STEEL : STEEL_RUST;
            const [x0, z0] = at(t0, faceOff);
            const [x1, z1] = at(t1, faceOff);
            const [xm, zm] = at(tm, faceOff + (k % 2 === 0 ? 0.08 : -0.02));
            // Two flanks meeting at a ridge or a trough.
            s.poly([P(x0, lowEdge, z0), P(xm, lowEdge, zm), P(xm, y - CAP_HEIGHT, zm), P(x0, y - CAP_HEIGHT, z0)], out, colour);
            s.poly([P(xm, lowEdge, zm), P(x1, lowEdge, z1), P(x1, y - CAP_HEIGHT, z1), P(xm, y - CAP_HEIGHT, zm)], out, colour);
          }
        }
        // The cap along the top: a beam from just inboard of the edge to the face, flush with the deck.
        const cc = at(sm, faceOff - 0.3);
        s.box(cc[0], cc[1], y - CAP_HEIGHT, tx, tz, half, 0.3, CAP_HEIGHT + 0.02, capColour, capColour);
      }
      // Fender piles down the face, from the cap to well under the water, proud of the face by their own radius.
      for (let s = p0 + FENDER_STEP / 2; s < p1 - 1; s += FENDER_STEP) {
        const [x, z] = at(s, faceOff + 0.17);
        solid(x, z).cylinder(x, z, SEA - WALL_FOOT + 0.5, 0.17, y - 0.15 - (SEA - WALL_FOOT + 0.5), 6, TIMBER, TIMBER);
      }
      // Bollards along the apron, set back from the edge.
      for (let s = p0 + BOLLARD_STEP / 2; s < p1 - 1; s += BOLLARD_STEP) {
        const [x, z] = at(s, QUAY_APRON - 1.3);
        solid(x, z).cylinder(x, z, y, 0.2, 0.5, 8, BOLLARD, BOLLARD);
        solid(x, z).cylinder(x, z, y + 0.5, 0.26, 0.1, 8, BOLLARD, BOLLARD);
      }
    }
    // Ladders every LADDER_STEP m along the stretch, where no deck stands: two rails and rungs down to the water, on the face.
    for (let s = LADDER_STEP / 2; s < len; s += LADDER_STEP) {
      const piece = pieces.find(([p0, p1]) => s > p0 + 1.5 && s < p1 - 1.5);
      if (piece === undefined) continue;
      const foot = SEA - 1.5;
      const top = y - 0.1;
      for (const side of [-0.3, 0.3]) {
        // Out from the face past the wales (which stand 8 cm proud of it), so a pile's sides and a wale's ends are not in one plane.
        const [x, z] = at(s + side, faceOff + 0.16);
        solid(x, z).box(x, z, foot, tx, tz, 0.05, 0.05, top - foot, STEEL, STEEL);
      }
      const [cx, cz] = at(s, faceOff + 0.16);
      const rungs = Math.round((top - foot) / 0.3);
      for (let k = 0; k < rungs; k++) solid(cx, cz).box(cx, cz, foot + 0.15 + k * 0.3, tx, tz, 0.3, 0.02, 0.04, STEEL, STEEL);
    }
  }
}
