/**
 * Which real model a parked vehicle is drawn as, and how big that makes it. The files are built by `tools/models/build.py` (the manifest
 * `client/assets/models/vehicles.json` says what each is); the sizes here are the manifest's footprints, the box round every vertex of the
 * file (open doors and mirrors included), so the walker's box is the model's own. A test holds the two together.
 *
 * The model is chosen from what the vehicle already is (its kind, state, load and age) and its `seed`, so no draw of the plan's is added or
 * moved: a pickup is the compact one or the old one by its age; a sedan one of two; a crossover a wagon or a hatchback; a van the van; a
 * work truck the flatbed or the box truck by its load; a project car is the one under a dust sheet; a derelict one of the two left to rot
 * with their doors open (or the dust sheet, where it has a tarp over it). A camper has no model and stays as it was drawn in code.
 */
import type { VehicleKind, VehicleLoad, VehicleState } from "../../types.js";

/** A model's id and its footprint (m): length along the vehicle, width across. */
export type VehicleModel = { readonly length: number; readonly width: number };

export const VEHICLE_MODELS: Readonly<Record<string, VehicleModel>> = {
  "vehicle.pickup_a": { length: 5.218, width: 2.113 },
  "vehicle.pickup_b": { length: 5.126, width: 1.909 },
  "vehicle.sedan_a": { length: 5.001, width: 1.834 },
  "vehicle.sedan_b": { length: 4.314, width: 1.762 },
  "vehicle.wagon": { length: 5.028, width: 1.857 },
  "vehicle.hatch": { length: 3.843, width: 1.826 },
  "vehicle.van": { length: 4.899, width: 2.363 },
  "vehicle.flatbed": { length: 5.271, width: 2.003 },
  "vehicle.boxtruck": { length: 6.023, width: 2.632 },
  "vehicle.derelict_sedan": { length: 4.679, width: 2.792 },
  "vehicle.derelict_truck": { length: 4.999, width: 2.345 },
  "vehicle.covered": { length: 4.38, width: 1.789 },
};

/** The model for a vehicle, or "" for one with none (a camper). `seed` is the vehicle's own, 0 to 0x7fffffff. */
export function vehicleModelFor(kind: VehicleKind, state: VehicleState, load: VehicleLoad, age: number, seed: number): string {
  if (kind === "camper") return "";
  // A fraction from the seed, by floor and not by a remainder.
  const u = (seed - Math.floor(seed / 1024) * 1024) / 1024;
  if (state === "project") return "vehicle.covered";
  if (state === "derelict") {
    if (load === "tarp") return "vehicle.covered";
    return kind === "pickup" || kind === "work truck" || kind === "van" ? "vehicle.derelict_truck" : "vehicle.derelict_sedan";
  }
  if (kind === "pickup") return u < age ? "vehicle.pickup_b" : "vehicle.pickup_a";
  if (kind === "sedan") return u < 0.5 ? "vehicle.sedan_a" : "vehicle.sedan_b";
  if (kind === "suv") return u < 0.5 ? "vehicle.wagon" : "vehicle.hatch";
  if (kind === "van") return "vehicle.van";
  return load === "flatbed" ? "vehicle.flatbed" : "vehicle.boxtruck";
}
