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
  /** How far inland of the highway the made ground reaches, metres. */
  readonly inland: number;
};

/** The z of sample `i` of a site, in its frame. */
export function sampleZ(site: TownSite, i: number): number {
  return site.z0 + i * site.step;
}
