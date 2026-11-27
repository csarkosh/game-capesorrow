/**
 * The paint of a junction: a marked crosswalk's ladder bars on each leg that has one (2 ft bars, gaps of 5 ft at most, 10 ft wide, set
 * just outside the junction's pavement), a stop line 4 ft before the crosswalk (or, with none, a little clear of the pavement) on each
 * leg that stops, and the dotted extension of the centre line of the main street or the avenue through the junction.
 *
 * The highway's own legs have no stop line, and a crosswalk across the highway is not laid here: the highway is paved through the town
 * (`highwayGeometry.ts`), and the crosswalk the plan marks across it (`marked` on its leg) is laid there, on that paving, in these bars' own size.
 */
import { RANK, type Over } from "./groundSurfaces.js";
import { hashN, smooth } from "./groundNoise.js";
import { CROSSWALK_WIDTH, STOP_LINE_WIDTH } from "../../sim/town/junctions.js";
import { onLeg } from "../../sim/town/junctionShape.js";
import type { JunctionLeg } from "../../sim/town/types.js";
import { PAINT_WHITE, PAINT_YELLOW } from "./palette.js";
import { DOTTED_DASH, DOTTED_GAP, LINE_WIDTH, MARK_OVER, ROADWAY_LIFT } from "./streetGeometry.js";
import type { WJunction } from "./junctionWorld.js";
import type { P2, RoadSet, Surface } from "./surface.js";
import type { TownGround } from "./townTypes.js";

/** A ladder bar's width, 2 ft (WSDOT's crosswalk layout), and the widest gap between bars, 5 ft. */
export const BAR_WIDTH = 0.61;
export const BAR_GAP_MAX = 1.52;
/** A crosswalk's marks keep this far from the roadway's edge, metres. */
export const BAR_MARGIN = 0.3;

/** The offsets across a roadway at which a ladder's bars begin: bars of `BAR_WIDTH` with gaps no wider than `BAR_GAP_MAX`, from `t0` to `t1`. */
export function barOffsets(t0: number, t1: number): number[] {
  const span = t1 - t0;
  const n = Math.max(1, Math.ceil((span + BAR_GAP_MAX) / (BAR_WIDTH + BAR_GAP_MAX)));
  if (n === 1) return [t0 + (span - BAR_WIDTH) / 2];
  const gap = (span - n * BAR_WIDTH) / (n - 1);
  return Array.from({ length: n }, (_, i) => t0 + i * (BAR_WIDTH + gap));
}

export function junctionPaint(g: TownGround, surf: Surface, junctions: readonly WJunction[], pavements: RoadSet): void {
  /** Paint on the roadway, without any junction's pavement under it. */
  const paint = (pts: P2[], lift: number, colour: typeof PAINT_WHITE, over?: Over): void => {
    for (const piece of pavements.free(pts)) surf.flat(piece, lift, colour, { rank: RANK.paint, ...over });
  };
  const lift = ROADWAY_LIFT + MARK_OVER;
  /** A main street or an avenue is kept up (its paint is faint in the wheel paths and broken, never gone); a back street may lose its bars. */
  const kept = (street: number): boolean => {
    const k = g.plan.streets.find((q) => q.id === street)?.kind;
    return k === "main" || k === "avenue";
  };
  for (const j of junctions) {
    if (j.polygon.length < 3) continue;
    for (const l of j.legs) {
      if (l.marked && !l.engine) crosswalk(paint, l, lift, Math.imul(j.id + 11, 40503) ^ Math.imul(l.street + 3, 9973), kept(l.street));
      if (l.stops && l.stopLine !== null) {
        // The stop line is faded and broken like the bars, a piece at a time.
        const sk = Math.imul(j.id + 17, 40503) ^ Math.imul(l.street + 5, 9973);
        const n = Math.max(1, Math.round((l.half - 0.2) / 0.9));
        for (let i = 0; i < n; i++) {
          const t0 = 0.1 + ((l.half - 0.2) * i) / n;
          const t1 = 0.1 + ((l.half - 0.2) * (i + 0.97)) / n;
          const w = wornPiece(sk, i, (t0 + t1) / 2, l.half, kept(l.street));
          if (w === null) continue;
          const pts: P2[] = [onLeg(l, l.stopLine, t0), onLeg(l, l.stopLine + STOP_LINE_WIDTH, t0), onLeg(l, l.stopLine + STOP_LINE_WIDTH, t1), onLeg(l, l.stopLine, t1)].map((v) => [v.x, v.z]);
          paint(pts, lift, PAINT_WHITE, w);
        }
      }
    }
    if (j.dotted) dotted(surf, j, lift + 0.01);
  }
}

/**
 * What a piece of paint of a leg looks like at `t` across it (a leg is `half` wide each way from its middle): the wheel paths of its two lanes
 * (0.8 m either side of each lane's middle) have worn it pale and thin, some pieces are gone, and the dirt shows through where it is worn. A leg's whole run
 * is now and then fresh (it was repainted last year), and then only its wheel paths show it. Null for a piece worn away.
 */
function wornPiece(key: number, i: number, t: number, half: number, kept: boolean): Over | null {
  const repainted = hashN(key, 0, 0, 301) < 0.22;
  const lane = half / 2;
  const d = Math.min(Math.abs(Math.abs(t) - (lane - 0.8)), Math.abs(Math.abs(t) - (lane + 0.8)));
  const path = 1 - smooth(0.12, 0.55, d);
  const age = repainted ? 0.05 : kept ? 0.1 + 0.25 * hashN(key, 0, 0, 302) : 0.2 + 0.45 * hashN(key, 0, 0, 302);
  const roll = hashN(key, i, 0, 303);
  const wear = Math.min(1, age * (0.45 + 0.9 * roll) + path * (repainted ? 0.4 : 0.5));
  // A kept street's bars are faint and broken in the wheel paths and plain between them: a piece is thinned, never taken away.
  if (!kept && wear > 0.88) return null;
  const wornTo = kept ? Math.min(wear, 0.6) : wear;
  const k = (1 - 0.6 * wornTo) * (0.85 + 0.15 * roll);
  return { layer: "asphalt", tint: [0.62 * k * 2.1, 0.62 * k * 2.1, 0.6 * k * 2.1], dirt: 0.1 + 0.6 * wornTo, wear: 0.04 };
}

function crosswalk(paint: (pts: P2[], lift: number, colour: typeof PAINT_WHITE, over?: Over) => void, l: JunctionLeg, lift: number, wkey: number, kept: boolean): void {
  const t0 = -l.half + BAR_MARGIN;
  const t1 = l.half - BAR_MARGIN;
  let bi = 0;
  for (const t of barOffsets(t0, t1)) {
    // Each bar is laid in pieces along its length across the leg (the bars run along the leg, so a piece is a stretch of the bar), worn by the wheel paths.
    const n = Math.max(1, Math.round(CROSSWALK_WIDTH / 1.6));
    for (let i = 0; i < n; i++) {
      const m0 = l.mouth + (CROSSWALK_WIDTH * i) / n;
      const m1 = l.mouth + (CROSSWALK_WIDTH * (i + 0.97)) / n;
      const w = wornPiece(wkey, bi * 7 + i, t + BAR_WIDTH / 2, l.half, kept);
      if (w === null) continue;
      const pts: P2[] = [onLeg(l, m0, t), onLeg(l, m1, t), onLeg(l, m1, t + BAR_WIDTH), onLeg(l, m0, t + BAR_WIDTH)].map((v) => [v.x, v.z]);
      paint(pts, lift, PAINT_WHITE, w);
    }
    bi++;
  }
}

/** The centre line carried through the junction as dashes of 2 ft with gaps of 6 ft, between the two mouths of the street's through legs. */
function dotted(surf: Surface, j: WJunction, lift: number): void {
  for (const a of j.legs) {
    if (a.kind !== "main" && a.kind !== "avenue") continue;
    const b = j.legs.find((m) => m !== a && m.street === a.street && m.dx * a.dx + m.dz * a.dz < -0.9);
    if (b === undefined || j.legs.indexOf(a) > j.legs.indexOf(b)) continue;
    const lo = -b.mouth;
    const hi = a.mouth;
    const run = hi - lo;
    if (run < DOTTED_DASH) continue;
    const count = Math.max(1, Math.floor((run + DOTTED_GAP) / (DOTTED_DASH + DOTTED_GAP)));
    const used = count * DOTTED_DASH + (count - 1) * DOTTED_GAP;
    let s = lo + (run - used) / 2;
    for (let k = 0; k < count; k++, s += DOTTED_DASH + DOTTED_GAP) {
      const pts: P2[] = [onLeg(a, s, -LINE_WIDTH / 2), onLeg(a, s + DOTTED_DASH, -LINE_WIDTH / 2), onLeg(a, s + DOTTED_DASH, LINE_WIDTH / 2), onLeg(a, s, LINE_WIDTH / 2)].map((v) => [v.x, v.z]);
      surf.flat(pts, lift, PAINT_YELLOW, { rank: RANK.paint });
    }
  }
}
