/**
 * The world's workers, as the page and the title film both hand them to the engine: a session's world is made
 * by a worker named by a path, so the entry is the game's.
 */
export const WORLD_WORKERS = {
  /** The worker that makes a session's world. */
  worldWorker: (): Worker => new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" }),
  /** Two world workers, both made from `worldWorker`: the second looks up the ground clutter's cells, the first builds the terrain's rings and the rock faces. */
  worldWorkers: 2 as const,
};
