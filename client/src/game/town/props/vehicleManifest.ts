/**
 * What the model build (`tools/models/build.py`) says of each vehicle file: its footprint and where its wheels touch, read from
 * `client/assets/models/vehicles.json`. The files stand on y = 0 at their tyres, face +x and are centred on their footprint, in the glTF's own
 * axes (its z is to the right, and the loader mirrors it: a point of the file at z lies at `c = -z` along the vehicle's left once loaded).
 */
import manifestJson from "../../../../assets/models/vehicles.json" with { type: "json" };

export type ManifestWheel = { x: number; z: number; y: number; r: number; inferred: boolean };
export type ManifestRole = { role: string; triangles: number; vertices: number };
export type ManifestVehicle = {
  id: string;
  file: string;
  kind: string;
  footprint: { length: number; width: number; height: number; x: [number, number]; z: [number, number] };
  wheels: ManifestWheel[];
  triangles: number;
  roles: Record<string, ManifestRole>;
  bytes: number;
};
export type VehicleManifest = { vehicles: ManifestVehicle[]; total_bytes: number };

export const MANIFEST = manifestJson as unknown as VehicleManifest;

/** A model's entry by its id ("vehicle.sedan_a"); it throws for an id the build does not make. */
export function manifestOf(id: string): ManifestVehicle {
  const found = MANIFEST.vehicles.find((v) => v.id === id);
  if (found === undefined) throw new Error(`no vehicle model "${id}" in the manifest`);
  return found;
}
