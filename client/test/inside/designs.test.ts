// The rooms' designs, walked, flooded and checked, in one file so that they share what costs: the towns' plans, the rooms built from them, the flood fill of each design and the walkable count (`designHelpers.ts`'s
// memos). Each suite is a module of its own (`*.suite.ts`) that registers its tests when imported. The cheap structural checks run on every seed (`rooms.suite.ts`); the long ones on `HEAVY_SEEDS` (`seeds.ts`).
import "../../src/terrain.js";
import "./rooms.suite.js";
import "./bar.suite.js";
import "./hall.suite.js";
import "./lodging.suite.js";
import "./spots.suite.js";
import "./seats.suite.js";
import "./closure.suite.js";
import "./wallSpace.suite.js";
