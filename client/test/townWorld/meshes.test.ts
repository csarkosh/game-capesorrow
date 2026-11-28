// The rooms' meshes, built once for the file (`roomMeshes.ts`) and checked for their budget, their box, their light, their walls and their panes. Each suite is a module of its own (`*.suite.ts`) that registers its tests
// when imported.
import "../../src/terrain.js";
import "./designGeometry.suite.js";
import "./insideGeometry.suite.js";
import "./roomGlass.suite.js";
import "./hung.suite.js";
import "./roomFaces.suite.js";
