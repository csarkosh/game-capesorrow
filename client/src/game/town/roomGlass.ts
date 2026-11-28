/**
 * The panes of a room a player stands in, seen from inside: the same marked glass as a shop's from the street (`townBlur.ts`, `PaneLook.through`), in a layer of its own, `through`, that is
 * drawn opaque after the room's own mesh. Behind it is what the engine draws from where the room is: the sky and the far land, which it reads from the kept frame at full blur (it is far
 * away) with the ink line at the pane's edge, in the colour of the hour and the weather. The room's own mesh leaves the opening empty (a wall is cut away there) and lays the reveal, the
 * frame, the sill, the blind and the curtains in front.
 */
import { THROUGH_SEED, GLASS_CLEAR, GLASS_TINT } from "./buildingKit.js";
import { hash01, type MeshBuilder, type Vec3 } from "./meshBuilder.js";
import type { Fx } from "./townSurface.js";

/** How far a pane stands back from the wall's face into its thickness, metres: the reveal is drawn between. */
export const PANE_SETBACK = 0.1;

/** The look of a through pane: clear glass with a thin film, marked with the through seed (4 to 5) that the glass's plugin and the blur read. */
export function throughFx(key: number, size: readonly [number, number]): Fx {
  const seed = hash01(key, 8801);
  return {
    clear: GLASS_CLEAR, dirt: 0.12, seed: seed + THROUGH_SEED, size: [size[0], size[1]],
    tilt: [(hash01(key, 8802) * 2 - 1) * 0.02, (hash01(key, 8803) * 2 - 1) * 0.02],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

/** A pane of through glass: four world points (counter-clockwise seen from the room), the room's way (the normal), a key that turns its reflection and its size (height, width) in metres. */
export function glassSheet(marked: MeshBuilder, pts: readonly [Vec3, Vec3, Vec3, Vec3], normal: Vec3, key: number, size: readonly [number, number]): void {
  marked.poly(pts, normal, GLASS_TINT, undefined, throughFx(key, size));
}
