/**
 * The coast's climb to the massif, drawn out behind the town. On the coast's own the climb ends 40 to 500 m
 * inland of the shore, so the ground behind the highway rises tens of metres in the town's first
 * hundred and sixty: a plane at the highway's grade would stand under a hillside there. Inside a window
 * along the shore the climb ends `TOWN_BLEND_END` metres inland, the engine's own hook for it
 * (`CoastOverlay.blend`). The highway does not move with it, but its grade line, which follows the
 * ground, comes down with the foot of the hill.
 */

/** Coast distance at which the shore-to-massif blend ends inside the window, metres. */
export const TOWN_BLEND_END = 1900;
/** The window along z: 1 to this far from the anchor, and 0 beyond it by `TOWN_BLEND_FADE` more. */
export const TOWN_BLEND_Z_HALF = 1000;
export const TOWN_BLEND_FADE = 240;

export const TOWN_BLEND_TUNABLES: Readonly<Record<string, number>> = { TOWN_BLEND_END, TOWN_BLEND_Z_HALF, TOWN_BLEND_FADE };

/** The window's weight at `z` and its slope: a quintic fade, flat (so with no kink at the anchor) inside. */
export function townBlendWindowD(z: number): { v: number; dz: number } {
  const az = z < 0 ? -z : z;
  const edge0 = TOWN_BLEND_Z_HALF;
  const edge1 = TOWN_BLEND_Z_HALF + TOWN_BLEND_FADE;
  if (az <= edge0) return { v: 1, dz: 0 };
  if (az >= edge1) return { v: 0, dz: 0 };
  const t = (az - edge0) / (edge1 - edge0);
  const v = t * t * t * (t * (t * 6 - 15) + 10);
  const d = (30 * t * t * (t - 1) * (t - 1)) / (edge1 - edge0);
  return { v: 1 - v, dz: -d * (z < 0 ? -1 : 1) };
}
