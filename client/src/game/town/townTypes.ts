/**
 * What the town's geometry builders are handed beside the plan: the ground under the town, the highway the
 * engine paints, the deck level over the water, and where each piece of geometry goes (a builder a cell of the
 * town, one set for what is drawn flat on the ground and one for what stands). Plain data and functions, so
 * every builder runs with no renderer.
 */
import type { MeshBuilder } from "./meshBuilder.js";
import type { Rail } from "../../sim/town/decks.js";
import type { TownPlan } from "../../sim/town/types.js";

/** Heights are the world's, metres; x and z are the world's too (the plan's frame plus `anchor`). */
export type TownGround = {
  /** The world's seed (the spur's track is found from it). */
  readonly seed: number;
  readonly plan: TownPlan;
  readonly anchor: { readonly x: number; readonly z: number };
  /** The ground's surface height at a world position, from the engine's ground field. */
  heightAt(x: number, z: number): number;
  /** The x of the highway's centre line at a world z (the engine paints the road: the town's streets end at its edge). */
  roadX(z: number): number;
  /** The top of the deck over a world position (the plan's decks, `sim/town/decks.ts`), or minus infinity where none stands over it. */
  deckAt(x: number, z: number): number;
  /** The railed edges of the decks, in the world: where a walker is held back (`sim/town/decks.ts`). */
  readonly rails: readonly Rail[];
};

/** Which builder takes the geometry at a world position: the town's cells. */
export type Sink = (x: number, z: number) => MeshBuilder;

export type TownSinks = {
  /** Streets, rails and the quay's apron: drawn on the ground, a little ahead of it. */
  readonly flat: Sink;
  /** Buildings, piers, piles and the quay's wall: standing things. */
  readonly solid: Sink;
};

/** How much of a building is built: low leaves off the upper storeys' windows, the frames and the sills. */
export type Detail = "low" | "full";

/** The world's sea level: nothing is drawn on ground below it. */
export const SEA = 0;

/** Where a building's see-through parts and its lettering go, beside its solid ones: the blended glass layer and the signs' layer (each by cell), and the atlas the signs are lettered on. */
export type BuildingExtras = { readonly glass: Sink; readonly sign: Sink; readonly atlas: SignAtlasLike; readonly report?: FillReport };

/** What a building's fronts record of what they drew, for a test to hold them to the plan: filled in by the builders when a report is given. */
export type FillReport = {
  /** Every opening of a unit's front as drawn (the frame's stations and heights over the floor). */
  readonly openings: { unit: number; s0: number; s1: number; sill: number; head: number; cover: string }[];
  /** Every window the builders drew, and what is behind its glass: a unit's room, a shallow box of its own, or a cover (boards, brick, paper). */
  readonly windows: { pane: boolean; behind: "room" | "box" | "cover"; /** What closes the opening: a shop's room, boards, curtains, blinds, or an opaque dark backing. */ closes: "room" | "boards" | "curtain" | "blind" | "dark"; readonly shop: boolean; /** The opening: s0, s1, y0, y1. */ readonly opening: readonly [number, number, number, number]; /** The span of what closes it (a home's window). */ covering?: readonly [number, number, number, number] }[];
  /** Each unit's room: its extent in the frame (s, d, up from the floor), the furnishings the plan gave it, and a fingerprint of its geometry. */
  readonly rooms: { unit: number; trade: string; extent: { s0: number; s1: number; d0: number; d1: number; y0: number; y1: number }; furnishings: number; hash: number }[];
};

/** What the builders need of the lettering atlas (`signAtlas.ts`): a place for each sign's face, which the renderer's side paints. */
export type SignAtlasLike = { place(widthM: number, heightM: number, spec: SignSpec): { u0: number; v0: number; u1: number; v1: number } | null };

/** What the renderer's side is asked to paint on a sign's face (`signAtlas.ts` says how it is read). Plain data. */
export type SignSpec = {
  readonly kind: string;
  readonly style: string;
  readonly lines: readonly string[];
  readonly decade: number;
  readonly condition: number;
  readonly lit: boolean;
  /** A number of the sign's own (its building and place), from which its face, weight and layout are drawn. */
  readonly seed: number;
  /** The face's colours, 0 to 255, and whether the ground is transparent (lettering on glass, paint on a wall). */
  readonly bg: readonly [number, number, number];
  readonly fg: readonly [number, number, number];
  readonly accent: readonly [number, number, number];
  readonly clear: boolean;
  /** The face's size in metres, which sets its letters' size. */
  readonly w: number;
  readonly h: number;
};
