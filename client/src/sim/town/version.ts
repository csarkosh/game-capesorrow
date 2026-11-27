/**
 * The generator's version, part of every plan.
 *
 * It MUST be raised whenever the same site would give a different plan: any change to a stage's
 * draws, to a table, to a constant that shapes the output, or to the order things are made in. A
 * seed is only a promise for one version; the pinned digests in `test/town/determinism.test.ts`
 * fail when this is forgotten, and the fix for a failing digest is to raise this number and re-pin.
 *
 * 24: a street that meets the highway at under 60 degrees is no longer shut with a planter; it runs on and joins, with an acute corner.
 *
 * 25: one downtown (`port/downtown.ts`): every shop, office, tavern, restaurant, bank, lodging, apartment, the lodge hall, school, hospital and gas station stands in one connected set of
 * blocks, and nothing of these stands out in the town or its outskirts. The old start office is gone: the town's municipal building (a landmark, in the downtown, with the town's name on its signs)
 * takes its place, and the player starts at its door. Every town has an open lodging, tavern and cafe in the downtown, recorded in `plan.places`.
 */
export const TOWN_GEN = 25;
