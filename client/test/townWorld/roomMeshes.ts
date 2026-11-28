/**
 * The rooms' meshes and grounds, built once for a test file: a room's mesh (and the town's ground it is made on) is what the file's tests share, whether it checks its budget, its box, its light or its panes.
 * A test that changes the arrays it was given copies them first.
 */
import { insideGeometry } from "../../src/game/town/insideGeometry.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import { insideRooms, type InsideRoom } from "../../src/sim/inside/rooms.js";

const GROUNDS = new Map<number, TownGround>();
const MESHES = new Map<string, ReturnType<typeof insideGeometry>>();

export function groundOf(seed: number): TownGround {
  let g = GROUNDS.get(seed);
  if (g === undefined) {
    g = townGround(seed);
    GROUNDS.set(seed, g);
  }
  return g;
}

/** The room `index` (0 bar, 1 cafe, 2 lodging, 3 office) of a seed, drawn at full detail, with or without the layer of through glass. */
export function meshOf(seed: number, index: number, glass = false): ReturnType<typeof insideGeometry> {
  const key = `${seed}:${index}:${glass}`;
  let m = MESHES.get(key);
  if (m === undefined) {
    m = insideGeometry(groundOf(seed), insideRooms(seed)[index] as InsideRoom, "full", undefined, glass);
    MESHES.set(key, m);
  }
  return m;
}
