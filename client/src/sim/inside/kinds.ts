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
  /** The cafe's counter facing its customers: p0 its length. Marble top 0.65 m deep at 1.0 m. */
  cafe_counter: (p) => ({ ha: 0.325, hb: (p[0] ?? 2) / 2, h: 1.0 }),
  /** The cafe's back counter with open shelves, facing the room: p0 its length. */
  cafe_back: (p) => ({ ha: 0.25, hb: (p[0] ?? 2) / 2, h: 2.1 }),
  /** The woven bistro stool: a seat at 0.76 m and a curved back to 1.15 m. */
  bistro_stool: () => ({ ha: 0.22, hb: 0.22, h: 1.15 }),
  /** A booth against a wall facing the room: two slatted benches either side of a marble table, 1.15 m deep and 2.0 m long. */
  booth: () => ({ ha: 0.575, hb: 1.0, h: 1.15 }),
  /** An upholstered chair with a round back. */
  round_chair: () => ({ ha: 0.25, hb: 0.25, h: 0.85 }),
  /** The espresso machine on the back counter, the brass rack hung over the counter, a round flush ceiling light and the joints of a tiled floor: none stood in. */
  espresso: () => null,
  brass_rack: () => null,
  flush_light: () => null,
  floor_joints: () => null,
  /** The lodging's reception desk facing its customers: p0 its length; white stone 1.1 m high. */
  reception_desk: (p) => ({ ha: 0.35, hb: (p[0] ?? 3) / 2, h: 1.13 }),
  /** A sofa facing its front: p0 its length, 0.9 m deep, back to 0.85 m. */
  sofa: (p) => ({ ha: 0.45, hb: (p[0] ?? 2) / 2, h: 0.85 }),
  /** A round pouffe, 0.4 m high. */
  pouffe: () => ({ ha: 0.4, hb: 0.4, h: 0.4 }),
  /** A low oval table, 0.42 m high, 1.3 by 0.6. */
  oval_table: () => ({ ha: 0.3, hb: 0.65, h: 0.42 }),
  /** An upholstered shell chair, seat at 0.46 m. */
  shell_chair: () => ({ ha: 0.25, hb: 0.25, h: 0.85 }),
  /** An armchair facing its front. */
  armchair: () => ({ ha: 0.4, hb: 0.4, h: 0.85 }),
  /** A wall of open shelving boxes with a television: p0 its length. */
  shelf_wall: (p) => ({ ha: 0.22, hb: (p[0] ?? 2) / 2, h: 2.2 }),
  /** A king bed, head to foot along its facing (the face looks toward the foot): 2.15 m long, 1.9 wide, its top at 0.62 m. */
  bed: () => ({ ha: 1.08, hb: 0.97, h: 0.65 }),
  /** A bedside table hung on the wall. */
  bedside: () => ({ ha: 0.25, hb: 0.28, h: 0.7 }),
  /** A dresser with a television on it, facing the room: 0.55 by 1.2 m. */
  dresser: () => ({ ha: 0.28, hb: 0.6, h: 0.85 }),
  /** A writing desk, facing the room: 0.6 by 1.4 m. */
  desk: () => ({ ha: 0.3, hb: 0.7, h: 0.76 }),
  /** A footstool, 0.42 m high. */
  footstool: () => ({ ha: 0.23, hb: 0.23, h: 0.42 }),
  /** A heater unit under a window: stood against a wall, 0.5 m high. */
  heater: () => ({ ha: 0.12, hb: 0.5, h: 0.5 }),
  /** An ice machine against a wall of the corridor and a housekeeping cart. */
  ice_machine: () => ({ ha: 0.35, hb: 0.4, h: 1.8 }),
  cart: () => ({ ha: 0.3, hb: 0.55, h: 1.15 }),
  /** A jukebox against a wall, facing the room: 0.8 by 0.6 m and 1.5 m high. */
  jukebox: () => ({ ha: 0.3, hb: 0.42, h: 1.5 }),
  /** Kegs stacked (three) and crates stacked, by a wall: 0.8 m square and 1.2 m high. */
  keg_stack: () => ({ ha: 0.4, hb: 0.4, h: 1.0 }),
  crate_stack: () => ({ ha: 0.3, hb: 0.4, h: 1.0 }),
  /** A rack of newspapers on legs, 0.5 m wide, 1.2 m high. */
  newspaper_rack: () => ({ ha: 0.15, hb: 0.3, h: 1.2 }),
  /** A glass pastry case with a till beside it: p0 its length; stands on the counter, so no footprint. */
  pastry_case: () => null,
  /** A small sideboard with a water jug and cutlery, facing the room: 0.45 by 1.2 m, 0.9 m high. */
  sideboard: () => ({ ha: 0.225, hb: 0.6, h: 0.9 }),
  /** A bench with cushions under a window: p0 its length, 0.5 deep, back to 0.9 m. */
  window_bench: (p) => ({ ha: 0.25, hb: (p[0] ?? 1.6) / 2, h: 0.5 }),
  /** What is hung from the ceiling or laid across it: a beam (p0 its length), a ceiling fan, and the small things on a table top (p0 picks which): none stood in. */
  beam: () => null,
  ceiling_fan: () => null,
  tabletop: () => null,
  /** A luggage cart, 0.6 by 1.1 m and 1.4 m high; a rack of brochures, 0.6 by 0.3 and 1.5 m. */
  luggage_cart: () => ({ ha: 0.3, hb: 0.55, h: 1.4 }),
  brochure_rack: () => ({ ha: 0.15, hb: 0.3, h: 1.5 }),
  /** A long communal high table, 0.9 m wide, `p0` long, top at 1.05 m. */
  long_table: (p) => ({ ha: 0.45, hb: (p[0] ?? 3) / 2, h: 1.05 }),
  /** A coffee station against a wall: a counter with a machine and cups and a fridge with a lit front: `p0` long, 0.7 deep, the fridge 1.9 m high. */
  coffee_station: (p) => ({ ha: 0.35, hb: (p[0] ?? 3) / 2, h: 1.9 }),
  /** A screen of upright timber slats, 2.2 m high, `p0` long, 12 cm thick. */
  slat_screen: (p) => ({ ha: 0.06, hb: (p[0] ?? 2.5) / 2, h: 2.2 }),
  /** A long planter, 0.6 m wide, `p0` long, with plants in it to 1.2 m. */
  planter: (p) => ({ ha: 0.3, hb: (p[0] ?? 2) / 2, h: 0.5 }),
  /** A floor lamp (1.6 m, with a light) and a side table (0.55 m): the lamp stands on the table in `table_lamp`. */
  floor_lamp: () => ({ ha: 0.2, hb: 0.2, h: 1.6 }),
  side_table: () => ({ ha: 0.25, hb: 0.25, h: 0.55 }),
  /** What is let into a ceiling: a downlight (a small glowing disc), a vent, a sprinkler head: none stood in. */
  downlight: () => null,
  /** The room's small things: a luggage rack (0.5 by 0.9 m, a suitcase on it), a waste bin, a kettle tray laid on a dresser, a smoke detector and a cornice, the last two let into the ceiling. */
  luggage_rack: () => ({ ha: 0.25, hb: 0.45, h: 0.8 }),
  waste_bin: () => ({ ha: 0.15, hb: 0.15, h: 0.3 }),
  kettle_tray: () => null,
  smoke_detector: () => null,
  cornice: () => null,
  /** The municipal hall's glass balls of light and the black grid they hang from: hung, no footprint. */
  glass_ball: () => null,
  lamp_grid: () => null,
  vent: () => null,
  sprinkler: () => null,
  /** A potted plant on the floor: a pot 0.4 m across and a fan of leaves to 1.2 m. */
  plant: () => ({ ha: 0.22, hb: 0.22, h: 1.2 }),
  /** Hung or laid: pendant lamps, a ceiling of battens, an inset of carpet, the barrier across the closed flight and what stands at it. */
  pendant_lamp: () => null,
  batten_ceiling: () => null,
  carpet_inset: () => null,
  barrier: () => null,
  step_ladder: () => null,
  paint_cans: () => null,
  dust_sheet: () => null,
  /** A low square table against a wall seat, top at 0.74 m: p0 its half side. */
  square_table: (p) => ({ ha: p[0] ?? 0.4, hb: p[0] ?? 0.4, h: 0.74 }),
};

/** The kinds that hang on a wall (`Decor`). */
export const DECOR_KINDS: readonly string[] = ["television", "guitar", "poster", "sign", "board", "wall_lamp", "ac_unit", "picture", "panel", "tile_wall", "slat_wall", "lit_letters", "frame_art", "forest_picture", "lit_pane", "closet_front", "door_leaf", "clock", "extinguisher", "art", "glazing", "curtain_pair", "light_switch", "fire_plan", "coast_map", "mural", "concrete_joints", "chalkboard", "neon_sign", "dartboard", "wall_shelf", "mirror", "coat_hooks", "bunting"];

/** A kind's footprint as the builder of a design asks for it. A kind that is not named is a mistake, not a kind without one. */
export function footOf(kind: string, p: readonly number[]): Foot | null {
  const f = ITEM_FOOT[kind];
  if (f === undefined) throw new Error(`the design holds an item of the kind ${kind}, which has no footprint`);
  return f(p);
}
