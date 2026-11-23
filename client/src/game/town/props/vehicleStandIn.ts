/**
 * The code-built car that stands for a vehicle until its model has landed, and for good where the model's file fails to load
 * (`townParts.ts` hides a model's stand-ins the moment its meshes are made). Each is the low tier's car (`vehicleGeometry.ts`, a few
 * hundred vertices), in the model's own paint, on the box the model's footprint gives it, so what replaces it is the same size in the
 * same place. They are batched by model and by cell of the town: a model that lands takes its own away and nobody else's.
 *
 * They are made apart from the town's batches (`townGeometry.ts`), so the town's pinned counts do not hold them, and they are
 * transient: all but the cars of a failed model are released with the model's arrival.
 */
import { sliceDue } from "@csarkosh/engine/game/syncJobs";
import { MeshBuilder, type MeshArrays } from "../meshBuilder.js";
import type { TownGround } from "../townTypes.js";
import { CELL } from "../townGeometry.js";
import type { FleetInstance } from "./vehicleFleet.js";
import { vehicleGeometry } from "./vehicleGeometry.js";

export type StandInBatch = { readonly model: string; readonly cx: number; readonly cz: number; readonly layer: "solid" | "glass"; readonly arrays: MeshArrays };

export function* standInGeometry(g: TownGround, fleet: readonly FleetInstance[]): Generator<void, StandInBatch[], void> {
  const cells = new Map<string, { model: string; cx: number; cz: number; solid: MeshBuilder; glass: MeshBuilder }>();
  const none = new MeshBuilder();
  for (const f of fleet) {
    const cx = Math.floor(f.x / CELL);
    const cz = Math.floor(f.z / CELL);
    const key = `${f.model}|${cx},${cz}`;
    let c = cells.get(key);
    if (c === undefined) {
      c = { model: f.model, cx, cz, solid: new MeshBuilder(), glass: new MeshBuilder() };
      cells.set(key, c);
    }
    // The vehicle's own record with no model, so the code builds it; its id is moved off the low tier's skipped ones so none is left out.
    const own = { ...f.vehicle, model: "", id: 1 };
    const sink = c;
    vehicleGeometry(g, { solid: () => sink.solid, glass: () => sink.glass, flat: () => none }, own, "low", f.look.paint);
    if (sliceDue()) yield;
  }
  const out: StandInBatch[] = [];
  for (const c of cells.values()) {
    if (c.solid.vertices > 0) out.push({ model: c.model, cx: c.cx, cz: c.cz, layer: "solid", arrays: c.solid.finish() });
    if (c.glass.vertices > 0) out.push({ model: c.model, cx: c.cx, cz: c.cz, layer: "glass", arrays: c.glass.finish() });
  }
  return out;
}
