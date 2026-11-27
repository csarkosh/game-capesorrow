/**
 * The builders of the designed rooms' furniture, by the kind's name: every kind the simulation gives a footprint to (`sim/inside/kinds.ts`) has one in `ITEMS`, and every kind
 * that hangs on a wall (`DECOR_KINDS`) one in `DECOR`; a test holds the lists to each other.
 */
import type { Decor, Item } from "../../../sim/inside/design.js";
import { archway, backBar, barCounter, column } from "./bar.js";
import { board, bulbString, guitar, poster, sign, television } from "./hung.js";
import type { Geo } from "./kit.js";
import { banquette, chair, highTable, lowTable, squareTable, stool } from "./seating.js";

export const ITEMS: Readonly<Record<string, (g: Geo, it: Item) => void>> = {
  bar_counter: barCounter,
  back_bar: backBar,
  stool,
  high_table: highTable,
  low_table: lowTable,
  square_table: squareTable,
  chair,
  column,
  banquette,
  archway,
  bulb_string: bulbString,
};

export const DECOR: Readonly<Record<string, (g: Geo, dc: Decor) => void>> = {
  television,
  guitar,
  poster,
  sign,
  board,
};
