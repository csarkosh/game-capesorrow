/**
 * Importing this file registers the world the game is played on: the
 * engine's coast with Port Ashton's place laid over it (`coast.ts`: the
 * town's made ground at the cove, `sim/town/place.ts`), and the engine's own
 * passes (elevation 1, trees 6, clutter 7, cliffs 10). A page and a worker each
 * import it before the world is read or prepared. A game that lays a place
 * over the coast registers its own passes after these, under ids of its own.
 */
import "@csarkosh/engine/sim/montane";
import "./coast.js";
import "@csarkosh/engine/sim/passes/elevation";
import "@csarkosh/engine/sim/passes/trees";
import "@csarkosh/engine/sim/passes/clutter";
import "@csarkosh/engine/sim/passes/cliffs";
