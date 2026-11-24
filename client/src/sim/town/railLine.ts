/** The main line's centre as a polyline in the town's frame, from a site's samples of the highway. Simulation code: `+ - * /` only. */
import { RAIL_OFFSET } from "./rail.js";
import type { TownSite } from "./site.js";
import type { Vec } from "./geom.js";

export function mainLineOf(site: TownSite): Vec[] {
  return site.roadX.map((x, i) => ({ x: x - RAIL_OFFSET, z: site.z0 + i * site.step }));
}
