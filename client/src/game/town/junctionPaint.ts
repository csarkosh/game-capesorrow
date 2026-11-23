import type { P2, RoadSet, Surface } from "./surface.js";
import type { WJunction } from "./junctionWorld.js";
import type { TownGround } from "./townTypes.js";

/** The ENGINE's road lift, metres (the paint of a junction is laid in a later change). */
export const ENGINE_MARK_LIFT = 0.135;

export function junctionPaint(_g: TownGround, _surf: Surface, _junctions: readonly WJunction[], _pavements: RoadSet): void {
  void (null as unknown as P2);
}
