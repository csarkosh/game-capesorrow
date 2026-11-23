/**
 * A trestle's deck as ground: where the main line is carried over the sea on a trestle (`railSpans.ts`), the deck is floor a
 * player can walk on, by the same mechanism as the harbour's (`decks.ts`), asked for through a function of its own.
 *
 * - **`trestleTopAt(seed, x, z)`** is the top of the deck over a world point, or null: within `TRESTLE_HALF` of the line's centre and
 *   within a trestle's drawn length (its span and `TRESTLE_END` beyond each end), `TRESTLE_TOP` over the grade line, the top
 *   coming up from the bench over the first `TRESTLE_TAPER` metres at either end so a walker steps on it.
 * - **`withTrestles(base, seed)`** wraps a ground field as `withDecks` does: floor where the deck stands higher than the ground, and
 *   the field's own answers elsewhere (the same object's answers).
 * - **`constrainTrestle(seed, pos, vel)`** holds a hull on the deck inboard of its guard rails (the deck's sides), and one under the
 *   deck's level outside them, as the harbour's rails do.
 *
 * The span source is a parameter (the sea's gaps along the line, `railSpansIn`), so a test can lay a trestle where the coast has
 * none. Simulation code: `+ - * /`, `floor`, `abs`, `min`, `max`, `sqrt` only.
 */
import { PLAYER_HALF, GROUND_NORMAL_Y } from "@csarkosh/engine/sim/constants";
import type { GroundField } from "@csarkosh/engine/sim/ground";
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { HULL_RADIUS } from "./hull.js";
import { railCenterX } from "./rail.js";
import { TRESTLE_RAMP, railSpansIn, type RailSpan } from "./railSpans.js";

/** The deck's half width, the top of its ties over the bench, and how far the drawn trestle runs past the span's ends, metres. */
export const TRESTLE_HALF = 1.8;
export const TRESTLE_TOP = 0.24;
export const TRESTLE_END = TRESTLE_RAMP * 0.6;
/** The deck's top rises from the bench over this many metres at each end. */
export const TRESTLE_TAPER = 3;
/** A hull whose feet are this near the deck's top or higher is on it. */
export const TRESTLE_STAND = 0.5;

export type SpanSource = (seed: number, z0: number, z1: number) => readonly RailSpan[];

/** The top of the trestle's deck over (x, z), or null where none stands. */
export function trestleTopAt(seed: number, x: number, z: number, spans: SpanSource = railSpansIn): number | null {
  const list = spans(seed, z - 1, z + 1);
  for (const s of list) {
    if (s.kind !== "trestle") continue;
    const a = s.a - TRESTLE_END;
    const b = s.b + TRESTLE_END;
    if (z < a || z > b) continue;
    const off = x - railCenterX(seed, z);
    if ((off < 0 ? -off : off) > TRESTLE_HALF) continue;
    const d = Math.min(z - a, b - z);
    return roadGradeAt(seed, z).h + TRESTLE_TOP * Math.min(1, d / TRESTLE_TAPER);
  }
  return null;
}

/** The ground field with trestle decks laid over it. */
export function withTrestles(base: GroundField, seed: number, spans: SpanSource = railSpansIn): GroundField {
  return {
    heightAt(x, z) {
      const h = base.heightAt(x, z);
      const top = trestleTopAt(seed, x, z, spans);
      return top !== null && top > h ? top : h;
    },
    normalAt(x, z, out) {
      const top = trestleTopAt(seed, x, z, spans);
      if (top !== null && top > base.heightAt(x, z)) {
        out.x = 0;
        out.y = 1;
        out.z = 0;
      } else base.normalAt(x, z, out);
    },
    standNormalY(x, z) {
      const top = trestleTopAt(seed, x, z, spans);
      if (top !== null && top > base.heightAt(x, z)) return GROUND_NORMAL_Y;
      return base.standNormalY?.(x, z) ?? GROUND_NORMAL_Y;
    },
    above(x, y, z) {
      const top = trestleTopAt(seed, x, z, spans);
      if (top !== null && !(y - top > 0)) return false;
      if (base.above !== undefined) return base.above(x, y, z);
      return y - base.heightAt(x, z) > 0;
    },
  };
}

type Point = { x: number; y: number; z: number };

/** Holds a hull to the side of the deck's rails it belongs on. Returns whether it moved the hull. */
export function constrainTrestle(seed: number, pos: Point, vel: Point, spans: SpanSource = railSpansIn): boolean {
  const list = spans(seed, pos.z - 1, pos.z + 1);
  for (const s of list) {
    if (s.kind !== "trestle" || pos.z < s.a - TRESTLE_END || pos.z > s.b + TRESTLE_END) continue;
    const centre = railCenterX(seed, pos.z);
    const off = pos.x - centre;
    const a = off < 0 ? -off : off;
    if (a >= TRESTLE_HALF + HULL_RADIUS) return false;
    const top = trestleTopAt(seed, centre, pos.z, spans) as number;
    const onDeck = pos.y - PLAYER_HALF.y >= top - TRESTLE_STAND;
    const sign = off < 0 ? -1 : 1;
    // On the deck: kept inboard of the rail; below it: kept outside the deck's side.
    const limit = onDeck ? TRESTLE_HALF - HULL_RADIUS : TRESTLE_HALF + HULL_RADIUS;
    if (onDeck ? a <= limit : a >= limit) return false;
    pos.x = centre + sign * limit;
    if (vel.x * sign * (onDeck ? 1 : -1) > 0) vel.x = 0;
    return true;
  }
  return false;
}
