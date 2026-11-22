/**
 * What the town's geometry builders are handed beside the plan: the ground under the town, the highway the
 * engine paints, the deck level over the water, and where each piece of geometry goes (a builder a cell of the
 * town, one set for what is drawn flat on the ground and one for what stands). Plain data and functions, so
 * every builder runs with no renderer.
 */
import type { MeshBuilder } from "./meshBuilder.js";
import type { TownPlan } from "../../sim/town/types.js";

/** Heights are the world's, metres; x and z are the world's too (the plan's frame plus `anchor`). */
export type TownGround = {
  readonly plan: TownPlan;
  readonly anchor: { readonly x: number; readonly z: number };
  /** The ground's surface height at a world position, from the engine's ground field. */
  heightAt(x: number, z: number): number;
  /** The x of the highway's centre line at a world z (the engine paints the road: the town's streets end at its edge). */
  roadX(z: number): number;
  /** The height of a deck over the water at a world position: the quay's top where the nearest quay is. */
  deckAt(x: number, z: number): number;
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
