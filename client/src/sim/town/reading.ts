/**
 * Whether the coast's ground is being read for the town's site. The site is the coast as it is without a town laid over
 * it, and the town's own cover (which decides where the cliff bands stay) is made from a plan that is made from the
 * site, so while the site is read the cliff bands are kept off a generous rectangle instead (`clearing.ts`). Set and
 * cleared in one synchronous call: nothing else runs while it is set.
 */
let depth = 0;

/** Is the site being read right now? */
export function readingSite(): boolean {
  return depth > 0;
}

/** Runs `read` with the site being read. */
export function whileReadingSite<T>(read: () => T): T {
  depth++;
  try {
    return read();
  } finally {
    depth--;
  }
}
