/**
 * Walking on a design (`design.ts`): what a hull stands on, and what it is pushed out of. Everything here is in the room's frame, with `feet` the height of
 * the hull's feet over the room's floor.
 *
 * The ground under a hull is the highest of the surfaces that hold its (s, d) whose height there is no more than `STEP_UP` over its feet. If none holds
 * it the move is refused, so nobody walks into a void or up through a floor from below; a hull that steps off an edge finds only the surface below it,
 * and falls. A block acts on a hull only where its height range meets the hull's own (`BODY_LOW` to `BODY_HIGH` over its feet).
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import { BODY_HIGH, BODY_LOW, FRONT_WALL, STEP_UP, surfaceHeight, type Block, type Design } from "./design.js";

const { abs, max, min, sqrt } = Math;

/** A hull stops this far short of a block (metres). */
export const CLEAR = 0.01;
const PASSES = 8;

/** The height of the ground under a hull at (s, d) whose feet are at `feet`, or null where it has none. */
export function groundAt(design: Design, s: number, d: number, feet: number): number | null {
  let best: number | null = null;
  const limit = feet + STEP_UP;
  for (let i = 0; i < design.surfaces.length; i++) {
    const h = surfaceHeight(design.surfaces[i] as Design["surfaces"][number], s, d);
    if (h === null || h > limit) continue;
    if (best === null || h > best) best = h;
  }
  return best;
}

/** Whether a block acts on a hull whose feet are at `feet`. */
export function acts(b: Block, feet: number): boolean {
  return b.y1 > feet + BODY_LOW && b.y0 < feet + BODY_HIGH;
}

/**
 * Keeps a circle of radius `r` (a hull's, with a little to spare) in the room's outer box and out of every block that acts at `feet`, sliding along both:
 * the velocity loses its part into what it met. `at` is the place, in the room's frame, and is moved; `vel` is in the same frame.
 */
export function constrainDesign(design: Design, at: { s: number; d: number }, vel: { s: number; d: number }, feet: number, r: number): void {
  const sLo = r;
  const sHi = design.width - r;
  const dLo = FRONT_WALL + r;
  const dHi = design.depth - r;
  const walls = (): void => {
    if (at.s < sLo) { at.s = sLo; vel.s = max(0, vel.s); }
    if (at.s > sHi) { at.s = sHi; vel.s = min(0, vel.s); }
    if (at.d < dLo) { at.d = dLo; vel.d = max(0, vel.d); }
    if (at.d > dHi) { at.d = dHi; vel.d = min(0, vel.d); }
  };
  walls();
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < design.blocks.length; i++) {
      const b = design.blocks[i] as Block;
      if (!acts(b, feet)) continue;
      const ds = at.s - b.s;
      const dd = at.d - b.d;
      // The hull's centre in the block's own axes: along it, and across (the across axis is (-ad, ax)).
      const la = ds * b.ax + dd * b.ad;
      const lb = -ds * b.ad + dd * b.ax;
      const qa = max(-b.ha, min(b.ha, la));
      const qb = max(-b.hb, min(b.hb, lb));
      const ea = la - qa;
      const eb = lb - qb;
      const d2 = ea * ea + eb * eb;
      if (d2 >= r * r) continue;
      let na: number;
      let nb: number;
      let push: number;
      if (d2 > 0) {
        const dist = sqrt(d2);
        na = ea / dist;
        nb = eb / dist;
        push = r - dist;
      } else {
        // The centre is inside the rectangle: out by its nearest side.
        const toA = b.ha - abs(la);
        const toB = b.hb - abs(lb);
        if (toA < toB) { na = la < 0 ? -1 : 1; nb = 0; push = toA + r; } else { na = 0; nb = lb < 0 ? -1 : 1; push = toB + r; }
      }
      // The way out in the room's frame.
      const ns = na * b.ax - nb * b.ad;
      const nd = na * b.ad + nb * b.ax;
      at.s += ns * push;
      at.d += nd * push;
      const into = vel.s * ns + vel.d * nd;
      if (into < 0) { vel.s -= ns * into; vel.d -= nd * into; }
      moved = true;
    }
    walls();
    if (!moved) break;
  }
}

/**
 * Whether a circle of radius `r` at (s, d) stands in the room as `constrainDesign` means it to (inside the outer box, clear of every block that acts at `feet`, to
 * within `slack`), and has ground under it. A place between two pieces of furniture that stand closer than a hull is wide has no such answer.
 */
export function fitsDesign(design: Design, s: number, d: number, feet: number, r: number, slack: number): boolean {
  const rr = r - slack;
  if (s < rr || s > design.width - rr || d < FRONT_WALL + rr || d > design.depth - rr) return false;
  if (groundAt(design, s, d, feet) === null) return false;
  for (let i = 0; i < design.blocks.length; i++) {
    const b = design.blocks[i] as Block;
    if (!acts(b, feet)) continue;
    const ds = s - b.s;
    const dd = d - b.d;
    const la = ds * b.ax + dd * b.ad;
    const lb = -ds * b.ad + dd * b.ax;
    const ea = la - max(-b.ha, min(b.ha, la));
    const eb = lb - max(-b.hb, min(b.hb, lb));
    if (ea * ea + eb * eb < rr * rr) return false;
  }
  return true;
}
