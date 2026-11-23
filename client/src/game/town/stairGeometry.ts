/**
 * Public stairs: a flight of steps on the right of way of a street that would climb more than 15 percent (`sim/town/port/stairs.ts`),
 * as Astoria and Seattle have them. A flight is drawn simply: `STEP_RISE` high treads of concrete, each a box standing on the ground at the
 * flight's width, its top at the ground's height at the flight's start plus a step's rise for each tread, and a handrail down each side,
 * a post at each tread's end with a rail along its top. The flight runs from one end of the stair street to the other, at the world's
 * heights (the ground's own, as the street's strips are), so it rises with the hill whatever the town's grading did.
 */
import type { Rgb } from "./meshBuilder.js";
import { CURB, SIDEWALK, FLAG_POLE } from "./palette.js";
import type { Sink, TownGround } from "./townTypes.js";

/** A step's rise, and the least run of a tread, metres. */
export const STEP_RISE = 0.17;
export const STEP_RUN = 0.3;
/** The handrail: its height over a tread, the post's and rail's thickness (half), and how far outside the steps' edge it stands, metres. */
export const RAIL_HEIGHT = 0.95;
export const RAIL_THICK = 0.04;
export const RAIL_OUT = 0.12;
/** A tread stands this far down below its top, so it never floats over a dip in the ground, metres. */
const FOOTING = 0.6;
/** The middle of the heights flat ground lies at over the ground, and how near it a tread's top may not come, metres. */
const FLAT_MID = 0.02;
const FLAT_TOP = 0.03;
const FLAT_CLEAR = 0.05;

const TREAD: Rgb = SIDEWALK;
const RISER: Rgb = CURB;

export function stairGeometry(g: TownGround, sink: Sink): void {
  const { plan, anchor } = g;
  for (const st of plan.streets) {
    if (st.kind !== "stair") continue;
    const ax = anchor.x + st.a.x;
    const az = anchor.z + st.a.z;
    const bx = anchor.x + st.b.x;
    const bz = anchor.z + st.b.z;
    const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    if (!(len > 1)) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const ha = g.heightAt(ax, az);
    const hb = g.heightAt(bx, bz);
    const rise = hb - ha;
    // Treads: as many risers as the rise needs, never a run shorter than `STEP_RUN`.
    const n = Math.max(2, Math.min(Math.floor(len / STEP_RUN), Math.ceil(Math.abs(rise) / STEP_RISE)));
    const half = st.roadway / 2;
    const run = len / n;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * run;
      const cx = ax + ux * s;
      const cz = az + uz * s;
      // The tread's top: its step of the climb, from the flight's foot to its head.
      let top = ha + (rise * (i + 1)) / n;
      // A tread whose top lies within a few centimetres of the flat ground anywhere over its footprint (a junction's pavement, a sidewalk laid 1 to 3 cm over the ground) is a face against it: it stands that much over the highest of it.
      let lo = Infinity;
      let hi = -Infinity;
      for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const h = g.heightAt(cx + ux * (run / 2) * a - uz * half * b, cz + uz * (run / 2) * a + ux * half * b);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      if (top > lo + FLAT_MID - FLAT_CLEAR && top < hi + FLAT_TOP + FLAT_CLEAR) top = hi + FLAT_TOP + FLAT_CLEAR;
      const sinkAt = sink(cx, cz);
      sinkAt.box(cx, cz, top - FOOTING, ux, uz, run / 2, half, FOOTING, RISER, TREAD);
    }
    // The handrails, one down each side: a post every few treads and a rail along their tops.
    const side = { x: -uz, z: ux };
    const posts = Math.max(2, Math.ceil(len / 2.4));
    for (const k of [-1, 1]) {
      let prev: { x: number; z: number; y: number } | null = null;
      for (let p = 0; p <= posts; p++) {
        const s = (len * p) / posts;
        const x = ax + ux * s + side.x * k * (half + RAIL_OUT);
        const z = az + uz * s + side.z * k * (half + RAIL_OUT);
        const i = Math.min(n - 1, Math.floor(s / run));
        const base = ha + (rise * (i + 1)) / n;
        sink(x, z).box(x, z, base, ux, uz, RAIL_THICK, RAIL_THICK, RAIL_HEIGHT, FLAG_POLE, FLAG_POLE);
        const y = base + RAIL_HEIGHT;
        if (prev !== null) {
          // The rail: a thin board from post to post, tilted with the flight (a poly through the two tops).
          const t = RAIL_THICK;
          sink(x, z).quad([prev.x + side.x * t, prev.y, prev.z + side.z * t], [x + side.x * t, y, z + side.z * t], [x - side.x * t, y, z - side.z * t], [prev.x - side.x * t, prev.y, prev.z - side.z * t], [0, 1, 0], FLAG_POLE);
        }
        prev = { x, z, y };
      }
    }
  }
}
