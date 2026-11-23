/** A building's front wall as a frame, and the street it fronts. */
import { segDist } from "../../geom.js";
import type { Building, FrontFrame, Street } from "../../types.js";
import { r2 } from "./ctx.js";

/** The frame of a building's street front, or null for a pier (it has none). */
export function frontFrame(b: Building): FrontFrame | null {
  if (b.front === null) return null;
  const ux = b.bearing.a / b.bearing.c;
  const uz = b.bearing.b / b.bearing.c;
  const vx = uz;
  const vz = -ux;
  const f = b.front;
  const alongU = Math.abs(f.x * ux + f.z * uz) > 0.5;
  // The outward normal is a grid axis exactly: the lot's front vector was cut from the same grid.
  const sign = alongU ? (f.x * ux + f.z * uz >= 0 ? 1 : -1) : f.x * vx + f.z * vz >= 0 ? 1 : -1;
  const n = alongU ? { x: ux * sign, z: uz * sign } : { x: vx * sign, z: vz * sign };
  const hN = alongU ? b.halfAlong : b.halfAcross;
  const hT = alongU ? b.halfAcross : b.halfAlong;
  const t = { x: -n.z, z: n.x };
  return {
    origin: { x: r2(b.centre.x + n.x * hN - t.x * hT), z: r2(b.centre.z + n.z * hN - t.z * hT) },
    n,
    t,
    width: r2(2 * hT),
    depth: r2(2 * hN),
  };
}

/** The street a building fronts: the nearest of the town's streets to the middle of its front, within 60 m of its centre line, or "". */
export function streetOf(b: Building, frame: FrontFrame | null, streets: readonly Street[]): string {
  if (frame === null) return "";
  const mid = { x: frame.origin.x + frame.t.x * (frame.width / 2), z: frame.origin.z + frame.t.z * (frame.width / 2) };
  let best = "";
  let bestD = 60;
  for (const st of streets) {
    if (st.kind === "alley" || st.kind === "rail" || st.kind === "stair") continue;
    const d = segDist(mid, st.a, st.b);
    if (d < bestD) {
      bestD = d;
      best = st.name;
    }
  }
  return best;
}
