/**
 * The empty game's world worker: the game's entry over the world's work
 * (`worldWork.ts`), a module worker which Vite bundles from the
 * `new Worker(new URL(...), { type: "module" })` in `page.ts`. The terrain
 * registers on every thread that runs the simulation, so that import comes
 * first. The start is the town's (`townStart`), and the cells ahead are the ones its first spawn reads.
 */
import "./terrain.js";
import { serveWorldWork } from "@csarkosh/engine/game/worldWork";
import { townSpawnCells } from "./sim/town/spawnCells.js";
import { townStart } from "./sim/town/start.js";

serveWorldWork({ startOf: townStart, spawnCells: townSpawnCells });
