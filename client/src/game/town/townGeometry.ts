/**
 * The whole town as arrays, batched by cells of `CELL` m: for each cell that has anything in it, one set of arrays for
 * what is drawn flat on the ground (streets, rails, the quay's apron) and one for what stands (buildings, piers,
 * piles, the quay's curb and face). No renderer: `townParts.ts` makes a mesh of each.
 *
 * The build is a generator of slices (`syncJobs.ts`): it asks `sliceDue()` between buildings and yields, so the
 * engine's scheduler spreads it over frames; run to its end at once (as a test does) it is the same arrays.
 */
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { sliceDue, type Slices } from "@csarkosh/engine/game/syncJobs";
import { deckTopAt, townDecks } from "../../sim/town/decks.js";
import { streetLiftD } from "../../sim/town/streetField.js";
import { planFor } from "../../sim/town/planFor.js";
import { siteFor } from "../../sim/town/siteFor.js";
import type { LandmarkRole } from "../../sim/town/types.js";
import { buildingGeometry } from "./buildingGeometry.js";
import { endsGeometry } from "./endsGeometry.js";
import { groundGeometry } from "./groundGeometry.js";
import { yardGeometry } from "./yardGeometry.js";
import { boatsGeometry, lightGeometry, millGeometry, pilingGeometry, terminalGeometry } from "./harbourGeometry.js";
import { MeshBuilder, type MeshArrays } from "./meshBuilder.js";
import { deckGeometryAll, railGeometry, wharfGeometry } from "./pileGeometry.js";
import { quayGeometry } from "./quayGeometry.js";
import { roadGeometry } from "./roadGeometry.js";
import { spurGeometry } from "./spurGeometry.js";
import { stairGeometry } from "./stairGeometry.js";
import { streetGeometry } from "./streetGeometry.js";
import type { Detail, TownGround } from "./townTypes.js";

/** The side of a batching cell, metres. */
export const CELL = 128;

export type TownBatch = {
  /** The cell's index along x and z (the world's coordinates over `CELL`). */
  readonly cx: number;
  readonly cz: number;
  /** What the arrays are: drawn flat on the ground, or standing. */
  readonly layer: "flat" | "solid";
  readonly arrays: MeshArrays;
};

/** The ground the town stands on for a world seed: the plan, its anchor, the engine's elevation field plus the streets' trough filled (the ground the player stands on, where no rock layer lies: the town has none) and the highway's line. */
export function townGround(worldSeed: number): TownGround {
  const plan = planFor(worldSeed);
  const { anchor } = siteFor(worldSeed);
  // The same point is asked for again and again (the corners of tiles that meet, a slab's two readings): a point read to the millimetre is read once.
  const memo = new Map<number, number>();
  const heightAt = (x: number, z: number): number => {
    const key = Math.round(x * 1000) * 4000003 + Math.round(z * 1000);
    let h = memo.get(key);
    if (h === undefined) {
      h = elevationSampleAt(worldSeed, x, z).h + streetLiftD(worldSeed, x, z).v;
      memo.set(key, h);
    }
    return h;
  };
  const base = { seed: worldSeed, plan, anchor, heightAt, roadX: (z: number) => roadCenterX(worldSeed, z) };
  return { ...base, deckAt: (x, z) => deckTopAt(worldSeed, x, z) ?? -Infinity, rails: townDecks(worldSeed).rails };
}

/** Everything of the town, as batches. `from` is where the player starts: the cells nearest it come first. */
export function* townGeometry(g: TownGround, detail: Detail, from: { x: number; z: number }): Slices<TownBatch[]> {
  const cells = new Map<string, { cx: number; cz: number; flat: MeshBuilder; solid: MeshBuilder }>();
  const cell = (x: number, z: number): { flat: MeshBuilder; solid: MeshBuilder } => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const key = `${cx},${cz}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = { cx, cz, flat: new MeshBuilder(), solid: new MeshBuilder() };
      cells.set(key, c);
    }
    return c;
  };
  const sinks = { flat: (x: number, z: number) => cell(x, z).flat, solid: (x: number, z: number) => cell(x, z).solid };

  streetGeometry(g, sinks.flat, sinks.solid, detail);
  stairGeometry(g, sinks.solid);
  endsGeometry(g, sinks.flat, sinks.solid);
  groundGeometry(g, sinks.flat);
  yardGeometry(g, sinks.flat);
  roadGeometry(g, sinks.flat, sinks.solid);
  yield;
  quayGeometry(g, sinks.solid, sinks.flat);
  for (const street of g.plan.streets) if (street.kind === "wharf") wharfGeometry(g, street, sinks.solid);
  deckGeometryAll(g, sinks.solid);
  railGeometry(g, sinks.solid);
  spurGeometry(g, sinks.solid, detail);
  yield;
  boatsGeometry(g, sinks.solid);
  pilingGeometry(g, sinks.solid);
  yield;
  millGeometry(g, sinks.solid);
  terminalGeometry(g, sinks.solid);
  lightGeometry(g, sinks.solid);
  yield;

  const roles = new Map<number, LandmarkRole>();
  for (const l of g.plan.landmarks) if (!roles.has(l.building)) roles.set(l.building, l.role);
  for (const b of g.plan.buildings) {
    // A pier is its deck alone (drawn with the decks); a shed on piles is a building, standing on its deck.
    if (b.kind === "pier") continue;
    buildingGeometry(g, b, roles.get(b.id) ?? null, sinks.solid, detail);
    if (sliceDue()) yield;
  }

  const batches: TownBatch[] = [];
  for (const c of cells.values()) {
    if (c.flat.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "flat", arrays: c.flat.finish() });
    if (c.solid.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "solid", arrays: c.solid.finish() });
  }
  const distance = (b: TownBatch): number => {
    const dx = (b.cx + 0.5) * CELL - from.x;
    const dz = (b.cz + 0.5) * CELL - from.z;
    return dx * dx + dz * dz;
  };
  batches.sort((a, b) => distance(a) - distance(b) || a.cx - b.cx || a.cz - b.cz || (a.layer === b.layer ? 0 : a.layer === "flat" ? -1 : 1));
  return batches;
}
