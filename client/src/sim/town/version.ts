/**
 * The generator's version, part of every plan.
 *
 * It MUST be raised whenever the same site would give a different plan: any change to a stage's
 * draws, to a table, to a constant that shapes the output, or to the order things are made in. A
 * seed is only a promise for one version; the pinned digests in `test/town/determinism.test.ts`
 * fail when this is forgotten, and the fix for a failing digest is to raise this number and re-pin.
 *
 * 24: a street that meets the highway at under 60 degrees is no longer shut with a planter; it runs on and joins, with an acute corner.
 */
export const TOWN_GEN = 24;
