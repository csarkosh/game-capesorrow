/**
 * A running count of what the ground builders laid (slabs, cracks, patches, potholes and the rest), kept for the tests and for looking at
 * a town: nothing reads it to decide anything. `resetTally` zeroes it before a build.
 */
export const tally = {
  slabs: 0,
  missingSlabs: 0,
  slabCracks: 0,
  brokenCorners: 0,
  weedBlobs: 0,
  utilityCuts: 0,
  roadCracks: 0,
  potholes: 0,
  manholes: 0,
  drains: 0,
  drives: 0,
  frontWalks: 0,
  yardPatches: 0,
};

export function resetTally(): void {
  for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] = 0;
}
