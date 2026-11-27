/**
 * What each kind of item a design can hold takes up on the floor: the footprint a hull is pushed out of and the height it is felt to. The drawing
 * (`game/town/furniture/`) has a builder for each kind named here, and a test holds the two lists to each other. A kind with no footprint (null) is
 * a fixture that is hung or strung and not stood in.
 *
 * Every number is a real size in metres: a stool's seat is 0.76 m, a high-top's table 1.05, a bar's top 1.07, a chair's seat 0.46.
 *
 * Simulation code: the arithmetic of AGENTS.md applies.
 */
import type { Foot } from "./design.js";

/** A kind's footprint from its numbers `p` (what each reads is said beside it); a round thing takes its square, which a hull is pushed out of a little early at the corners. */
export const ITEM_FOOT: Readonly<Record<string, (p: readonly number[]) => Foot | null>> = {
  /** A bar counter facing its customers: p0 its length. 0.7 deep at the top, 1.07 high. */
  bar_counter: (p) => ({ ha: 0.35, hb: (p[0] ?? 2) / 2, h: 1.07 }),
  /** The back bar with its shelves and lower counter, facing the room: p0 its length. */
  back_bar: (p) => ({ ha: 0.3, hb: (p[0] ?? 2) / 2, h: 2.1 }),
  /** A round stool: seat at 0.76 m. */
  stool: () => ({ ha: 0.2, hb: 0.2, h: 0.76 }),
  /** A high-top table, round, top at 1.05 m: p0 its radius. */
  high_table: (p) => ({ ha: p[0] ?? 0.36, hb: p[0] ?? 0.36, h: 1.05 }),
  /** A low round table, top at 0.74 m: p0 its radius. */
  low_table: (p) => ({ ha: p[0] ?? 0.42, hb: p[0] ?? 0.42, h: 0.74 }),
  /** A chair facing its front, seat at 0.46 m and back to 0.9. */
  chair: () => ({ ha: 0.23, hb: 0.23, h: 0.9 }),
  /** A square column to the ceiling: p0 its height. */
  column: (p) => ({ ha: 0.23, hb: 0.23, h: p[0] ?? 3 }),
  /** A banquette against a wall facing the room: p0 its length. */
  banquette: (p) => ({ ha: 0.3, hb: (p[0] ?? 2) / 2, h: 1.0 }),
  /** An archway with a shut door in the wall behind it, facing the room: p0 its width. */
  archway: (p) => ({ ha: 0.1, hb: (p[0] ?? 1.1) / 2 + 0.1, h: 2.3 }),
  /** A run of bare bulbs on a wire from its place along its facing: p0 its length, p1 how many bulbs. Hung high, never stood in. */
  bulb_string: () => null,
  /** A low square table against a wall seat, top at 0.74 m: p0 its half side. */
  square_table: (p) => ({ ha: p[0] ?? 0.4, hb: p[0] ?? 0.4, h: 0.74 }),
};

/** The kinds that hang on a wall (`Decor`). */
export const DECOR_KINDS: readonly string[] = ["television", "guitar", "poster", "sign", "board"];

/** A kind's footprint as the builder of a design asks for it. A kind that is not named is a mistake, not a kind without one. */
export function footOf(kind: string, p: readonly number[]): Foot | null {
  const f = ITEM_FOOT[kind];
  if (f === undefined) throw new Error(`the design holds an item of the kind ${kind}, which has no footprint`);
  return f(p);
}
