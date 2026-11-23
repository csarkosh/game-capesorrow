/**
 * The terrain as the engine's mesh draws it, without the GPU: the clipmap's seven rings built from the engine's own functions
 * (`createRingSamples`, `ringGeometry`) for a camera and a quality tier, and the height they draw at a point (the cell's two
 * triangles, split on the diagonal the engine's indices use) and the sand weight they paint there (vertex weights, interpolated).
 */
import "../../src/terrain.js";
import {
  BASE_SPACING_BY_TIER,
  RING_CELLS,
  RING_COUNT,
  createRingSamples,
  holeCellsFor,
  ringGeometry,
  type RingGeometry,
  type RingSamples,
} from "@csarkosh/engine/game/clipmap";

export type QualityTier = "low" | "medium" | "high";
const SIDE = RING_CELLS + 1;

export type DrawnTerrain = {
  readonly rings: readonly RingSamples[];
  /** The ring whose cells a point is drawn by (the finest that has it outside its hole), or -1. */
  ringAt(x: number, z: number): number;
  /** The drawn height, or NaN outside every ring. */
  heightAt(x: number, z: number): number;
  /** The sand weight (0 to 1) painted there. */
  sandAt(x: number, z: number): number;
  /** The spacing of the cell a point is drawn by. */
  spacingAt(x: number, z: number): number;
};

export function drawnTerrain(seed: number, camX: number, camZ: number, tier: QualityTier): DrawnTerrain {
  const base = BASE_SPACING_BY_TIER[tier];
  const rings: RingSamples[] = [];
  for (let l = 0; l < RING_COUNT; l++) rings.push(createRingSamples(seed, l, camX, camZ, base));
  const geos: RingGeometry[] = [];
  const holes: ({ x0: number; z0: number } | null)[] = [];
  for (let l = 0; l < RING_COUNT; l++) {
    const hole = l === 0 ? null : holeCellsFor(rings[l] as RingSamples, rings[l - 1] as RingSamples);
    holes.push(hole);
    geos.push(ringGeometry(rings[l] as RingSamples, hole, l + 1 < RING_COUNT ? (rings[l + 1] as RingSamples) : null));
  }
  const cellAt = (l: number, x: number, z: number): { ix: number; iz: number; u: number; v: number } | null => {
    const r = rings[l] as RingSamples;
    const fx = (x - r.originX) / r.spacing;
    const fz = (z - r.originZ) / r.spacing;
    if (fx < 0 || fz < 0 || fx >= RING_CELLS || fz >= RING_CELLS) return null;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const hole = holes[l] as { x0: number; z0: number } | null;
    if (hole !== null && ix >= hole.x0 && ix < hole.x0 + RING_CELLS / 2 && iz >= hole.z0 && iz < hole.z0 + RING_CELLS / 2) return null;
    return { ix, iz, u: fx - ix, v: fz - iz };
  };
  const ringAt = (x: number, z: number): number => {
    for (let l = 0; l < RING_COUNT; l++) if (cellAt(l, x, z) !== null) return l;
    return -1;
  };
  /** Interpolates a per-vertex value over the cell's triangles (a, b, c) and (b, d, c). */
  const interp = (l: number, x: number, z: number, at: (i: number) => number): number => {
    const c = cellAt(l, x, z);
    if (c === null) return NaN;
    const a = c.iz * SIDE + c.ix;
    const b = a + 1;
    const cc = a + SIDE;
    const d = cc + 1;
    const { u, v } = c;
    if (u + v <= 1) return at(a) + u * (at(b) - at(a)) + v * (at(cc) - at(a));
    return at(d) + (1 - u) * (at(cc) - at(d)) + (1 - v) * (at(b) - at(d));
  };
  return {
    rings,
    ringAt,
    spacingAt(x, z) {
      const l = ringAt(x, z);
      return l < 0 ? NaN : (rings[l] as RingSamples).spacing;
    },
    heightAt(x, z) {
      const l = ringAt(x, z);
      return l < 0 ? NaN : interp(l, x, z, (i) => (geos[l] as RingGeometry).positions[i * 3 + 1] as number);
    },
    sandAt(x, z) {
      const l = ringAt(x, z);
      return l < 0 ? NaN : interp(l, x, z, (i) => (geos[l] as RingGeometry).weights[i * 4 + 3] as number);
    },
  };
}
