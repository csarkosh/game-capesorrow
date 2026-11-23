/**
 * A town's site: what the town's plan is made from, and all the plan may know
 * of the ground it stands on. The plan (`plan.ts`) is a pure function of a
 * site, so a town can be made and looked at with no world behind it; the world
 * (`siteFor`) reads a site off the coast for a seed.
 *
 * The frame is the town's own: its origin at the anchor, +x inland (east),
 * +z north along the shore, metres, the same hand and turn as the world's, so
 * a place in the world is the place in the frame plus the anchor. The sea lies
 * to the west, at negative x.
 */
export type TownSite = {
  /** The town's own seed: the world's, mixed with which town this is. Every draw the plan makes comes from it. */
  readonly seed: number;
  /** Where the frame's origin stands in the world: on the highway's centre line. */
  readonly anchor: { readonly x: number; readonly z: number };
  /** The spacing of the samples below along z, metres. */
  readonly step: number;
  /** The z of the first sample, in the frame: negative, the site reaching as far south of the anchor as north. */
  readonly z0: number;
  /** The shoreline's x at each sample (the frame's x at which the ground meets the sea): negative. */
  readonly shoreX: readonly number[];
  /** The highway's centre line's x at each sample: 0 at the anchor's own sample. */
  readonly roadX: readonly number[];
  /** The highway's grade line (the height of its bed, which the main line keeps) at each sample, metres; none for a site made by hand. */
  readonly grade?: readonly number[];
  /** How far inland of the highway the made ground reaches, metres. */
  readonly inland: number;
  /** The coast's own ground over and beyond the town, for routing roads out of it. A site made without one (the synthetic coast) has no roads out. */
  readonly ground?: GroundGrid;
};

/**
 * The coast's own ground as a grid of heights over and beyond the town, in the site's frame: `nx` by `nz` samples `step` metres
 * apart from (`x0`, `z0`), row by row along z (`h[ix * nz + iz]`). What a road out of town is routed over.
 */
export type GroundGrid = {
  readonly x0: number;
  readonly z0: number;
  readonly step: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: readonly number[];
};

/** The grid's height at a point of the site's frame (bilinear), clamped to the grid's edge. */
export function groundAt(grid: GroundGrid, x: number, z: number): number {
  const fx = Math.max(0, Math.min(grid.nx - 1.000001, (x - grid.x0) / grid.step));
  const fz = Math.max(0, Math.min(grid.nz - 1.000001, (z - grid.z0) / grid.step));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = grid.h;
  const a = h[ix * grid.nz + iz] as number;
  const b = h[(ix + 1) * grid.nz + iz] as number;
  const c = h[ix * grid.nz + iz + 1] as number;
  const d = h[(ix + 1) * grid.nz + iz + 1] as number;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** The z of sample `i` of a site, in its frame. */
export function sampleZ(site: TownSite, i: number): number {
  return site.z0 + i * site.step;
}
