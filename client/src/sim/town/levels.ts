/**
 * The heights and widths the harbour is built to, in metres, shared by the plan, the ground and the drawing. Heights are
 * the world's (the sea's level is 0), so a deck's number is a height in the world and not a height over the ground.
 */

/** The made ground's height at the water's edge, and over all the fill: the quay's own height (`ground.ts`'s `QUAY`). */
export const QUAY_HEIGHT = 2.5;
/** The top of a deck on piles (a pier, the wharf, a shed's platform, the quay's apron): a step above the quay. */
export const DECK_TOP = 2.6;
/** The top of a float, which rides this far above the water. */
export const FLOAT_TOP = 0.4;
/** The quay's apron, the strip of deck between the quay's line and its wall, seaward, metres. */
export const QUAY_APRON = 5;
/** The sea's level. */
export const SEA_HEIGHT = 0;

/**
 * The most the made ground keeps of the land's own relief, in metres either way of its graded plane (`ground.ts`, which documents it with the other relief constants and
 * exports it again). It is here, in a module that imports nothing, because the plan's landmarks read it too, and the ground reads the plan.
 */
export const RELIEF_LIMIT = 2;
