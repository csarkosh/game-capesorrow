/**
 * The whole town as arrays, batched by cells of `CELL` m: for each cell that has anything in it, one set of arrays for
 * what is drawn flat on the ground (streets, rails, the quay's apron) and one for what stands (buildings, piers,
 * piles, the quay's curb and face), and the see-through layers beside them: the blended glass, the lettering, the rooms' haze and the dark at
 * the walls' feet. Where the renderer reads the frame behind its glass (`through`), the panes marked for it are a layer of their own, drawn opaque
 * (`townBlur.ts`). No renderer: `townParts.ts` makes a mesh of each.
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
import { propsGeometry } from "./props/index.js";
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
import { SignAtlas } from "./signAtlas.js";
import { groundStains } from "./groundStains.js";
import { growthGeometry, resetGrowth } from "./growth.js";
import { resetSeam } from "./houseSeam.js";
import { seamGround } from "./seamGround.js";
import { seamWall } from "./seamWall.js";
import { forgetMarks } from "./surface.js";
import { resetLedger } from "./faceLedger.js";
import type { Detail, TownGround } from "./townTypes.js";

/** The side of a batching cell, metres. */
export const CELL = 128;

const LAYER_ORDER = { flat: 0, solid: 1, shade: 2, haze: 3, through: 4, glass: 5, sign: 6 } as const;

export type TownBatch = {
  /** The cell's index along x and z (the world's coordinates over `CELL`). */
  readonly cx: number;
  readonly cz: number;
  /** What the arrays are: drawn flat on the ground, or standing. */
  readonly layer: "flat" | "solid" | "shade" | "haze" | "through" | "glass" | "sign";
  readonly arrays: MeshArrays;
  /** For a code-built car that stands for a vehicle's model until it lands (`props/vehicleStandIn.ts`): the model it stands for. */
  readonly model?: string;
};

/** Most points the ground's height table holds. The build asks for about 720 thousand readings of 375 thousand different points, almost every repeat close behind the first (the corners of tiles that meet, a slab's two readings): a table emptied each time it holds this many costs the build 0.6 percent more readings than one that never forgets. After the build the walkers, the cars and the camera ask for new points every frame, and a table that kept them all would grow without end. */
export const HEIGHT_MEMO_CAP = 32768;

/**
 * A height of the ground remembered by the point read to the millimetre, up to `cap` points; when the table is full it is emptied. The height is a pure
 * function of the point, so what is forgotten is read again and is the same number.
 */
export function heightMemo(read: (x: number, z: number) => number, cap: number = HEIGHT_MEMO_CAP): { at: (x: number, z: number) => number; size: () => number } {
  const memo = new Map<number, number>();
  return {
    at(x, z) {
      const key = Math.round(x * 1000) * 4000003 + Math.round(z * 1000);
      let h = memo.get(key);
      if (h === undefined) {
        h = read(x, z);
        if (memo.size >= cap) memo.clear();
        memo.set(key, h);
      }
      return h;
    },
    size: () => memo.size,
  };
}

/** The ground the town stands on for a world seed: the plan, its anchor, the engine's elevation field plus the streets' trough filled (the ground the player stands on, where no rock layer lies: the town has none) and the highway's line. */
export function townGround(worldSeed: number): TownGround {
  const plan = planFor(worldSeed);
  const { anchor } = siteFor(worldSeed);
  const heightAt = heightMemo((x, z) => elevationSampleAt(worldSeed, x, z).h + streetLiftD(worldSeed, x, z).v).at;
  const base = { seed: worldSeed, plan, anchor, heightAt, roadX: (z: number) => roadCenterX(worldSeed, z) };
  return { ...base, deckAt: (x, z) => deckTopAt(worldSeed, x, z) ?? -Infinity, rails: townDecks(worldSeed).rails };
}

/** Everything of the town, as batches. `from` is where the player starts: the cells nearest it come first. */
export function* townGeometry(g: TownGround, detail: Detail, from: { x: number; z: number }, atlas: SignAtlas = new SignAtlas(detail === "low" ? 2048 : 4096, detail === "low" ? 1024 : 2048, detail === "low" ? 36 : 56), through = false): Slices<TownBatch[]> {
  const cells = new Map<string, { cx: number; cz: number; flat: MeshBuilder; solid: MeshBuilder; shade: MeshBuilder; haze: MeshBuilder; through: MeshBuilder; glass: MeshBuilder; sign: MeshBuilder }>();
  const cell = (x: number, z: number): { flat: MeshBuilder; solid: MeshBuilder; shade: MeshBuilder; haze: MeshBuilder; through: MeshBuilder; glass: MeshBuilder; sign: MeshBuilder } => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const key = `${cx},${cz}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = { cx, cz, flat: new MeshBuilder(), solid: new MeshBuilder(), shade: new MeshBuilder(), haze: new MeshBuilder(), through: new MeshBuilder(), glass: new MeshBuilder(), sign: new MeshBuilder() };
      // Where the renderer reads the frame behind the glass, the panes marked for it are laid in a layer of their own, drawn opaque (`townBlur.ts`).
      if (through) c.glass.marked = c.through;
      cells.set(key, c);
    }
    return c;
  };
  const sinks = { flat: (x: number, z: number) => cell(x, z).flat, solid: (x: number, z: number) => cell(x, z).solid, glass: (x: number, z: number) => cell(x, z).glass, sign: (x: number, z: number) => cell(x, z).sign, haze: (x: number, z: number) => cell(x, z).haze, shade: (x: number, z: number) => cell(x, z).shade };
  // `through`: the renderer reads the frame behind its glass, so the rooms are drawn whole and their panes show them out of focus (`townBlur.ts`); the panes marked for it are the `through` layer's.
  const extras = { glass: sinks.glass, sign: sinks.sign, haze: sinks.haze, atlas, through, ...(detail === "low" ? {} : { shade: sinks.shade }) };

  forgetMarks(g);
  resetLedger();
  resetGrowth();
  resetSeam();
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

  yield* propsGeometry(g, { solid: sinks.solid, glass: sinks.glass, flat: sinks.flat, ...(detail === "low" ? {} : { shade: sinks.shade }) }, detail, sliceDue);
  yield;
  // The marks on the street: oil, scuffs, puddles, drifts (`groundStains.ts`).
  if (detail !== "low") groundStains(g, sinks.flat);
  yield;
  const roles = new Map<number, LandmarkRole>();
  for (const l of g.plan.landmarks) if (!roles.has(l.building)) roles.set(l.building, l.role);
  for (const b of g.plan.buildings) {
    // A pier is its deck alone (drawn with the decks); a shed on piles is a building, standing on its deck.
    if (b.kind === "pier") continue;
    buildingGeometry(g, b, roles.get(b.id) ?? null, sinks.solid, detail, extras);
    if (sliceDue()) yield;
  }
  yield;
  // The tufts that grow in the street's seams and at the feet of walls and posts (`growth.ts`); after the houses, whose doors and walls it reads (`houseSeam.ts`).
  seamGround(g, sinks.flat, detail);
  if (detail !== "low") seamWall(g, sinks.solid);
  growthGeometry(g, sinks.solid, detail);
  yield;

  const batches: TownBatch[] = [];
  for (const c of cells.values()) {
    if (c.flat.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "flat", arrays: c.flat.take() });
    if (c.solid.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "solid", arrays: c.solid.take() });
    if (c.shade.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "shade", arrays: c.shade.take() });
    if (c.haze.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "haze", arrays: c.haze.take() });
    if (c.through.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "through", arrays: c.through.take() });
    if (c.glass.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "glass", arrays: c.glass.take() });
    if (c.sign.vertices > 0) batches.push({ cx: c.cx, cz: c.cz, layer: "sign", arrays: c.sign.take() });
  }
  const distance = (b: TownBatch): number => {
    const dx = (b.cx + 0.5) * CELL - from.x;
    const dz = (b.cz + 0.5) * CELL - from.z;
    return dx * dx + dz * dz;
  };
  batches.sort((a, b) => distance(a) - distance(b) || a.cx - b.cx || a.cz - b.cz || LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
  return batches;
}
