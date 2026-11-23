/**
 * The vehicles that stand as real models, drawn: the renderer's side of `vehicleFleet.ts`. For each model in use the file is loaded
 * (`loadModel`, the engine's loader, as it loads its rocks and animals: the file's `LOD0` node, a primitive a role) and made into one
 * mesh a role, drawn as thin instances with one matrix and one set of plugin numbers per parked vehicle (`vehicleMaterial.ts` makes each
 * its own). So the batches are a model's roles (up to seven meshes), never a mesh a car: all the sedans of one model are one draw a role.
 *
 * - **They arrive when their files have.** Nothing here holds the first frame: the loads begin once the town's own geometry is made
 *   (`begin`), each model is made into meshes as a patient job of the renderer's scheduler (a slice, so no frame stalls on it), and a
 *   model whose file does not load is left out, said once on the console. Until a model has landed its vehicles are not drawn (the dark of
 *   the ground under each stays, drawn with the town).
 * - **Culled here, since Lite culls no mesh.** Each frame `seen` takes the instances in the view's planes and within `REACH` of the eye and,
 *   only when that set has changed, writes them to the front of the model's buffers and sets the instances drawn. A vehicle that was
 *   behind the player costs nothing; a street of them costs their triangles, about 20,000 a vehicle.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, markThinInstancePluginData, removeFromScene, setMeshVisible, setThinInstanceCount,
  setThinInstances, type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadModel, type ModelPart } from "@csarkosh/engine/game/lite/forestModels";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import type { WetUniforms } from "@csarkosh/engine/game/wetSurface";
import type { PluginUniformBlock } from "@babylonjs/lite";
import type { Slices, SyncJobs } from "@csarkosh/engine/game/syncJobs";
import { FLEET_DATA_FLOATS, type FleetInstance } from "./vehicleFleet.js";
import { vehiclePlugin } from "./vehicleMaterial.js";

/** How far from the eye a vehicle is drawn (m): past it a vehicle is a few pixels under the town's own fog. */
export const REACH = 260;

/** What the parts are made with: the renderer's own. */
export type VehiclePartsHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly shared: PluginUniformBlock;
  readonly air: () => MaterialPlugin;
  readonly wet: WetUniforms;
  readonly jobs: SyncJobs;
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  /** Told what the vehicles' meshes weigh as they are made (the renderer's record of its uploads). */
  readonly uploaded?: (bytes: number) => void;
};

export type VehicleParts = {
  /** Begins loading the models the instances use. Once. */
  begin(): void;
  /** Shows the instances in the view and within reach. */
  seen(planes: readonly ViewFrustumPlane[]): void;
  /** Models still being loaded or made. */
  waiting(): number;
  /** What is made and drawn now: the models landed, the meshes made, the meshes drawn and the instances drawn (a vehicle once, however many roles). */
  stats(): { models: number; meshes: number; drawn: number; instances: number; triangles: number };
  /** Resolves once every model has landed (or failed). */
  readonly settled: Promise<void>;
  dispose(): void;
};

type Batch = {
  id: string;
  instances: FleetInstance[];
  /** The meshes made, with each one's triangles. */
  meshes: { mesh: Mesh; triangles: number }[];
  matrices: Float32Array;
  data: Float32Array;
  /** Every part is made: the model is shown whole or not at all. */
  ready: boolean;
  /** The instances shown now, as indices of `instances`. */
  shown: number[];
};

const OWNER_PREFIX = "vehicles:";

export function createVehicleParts(host: VehiclePartsHost, instances: readonly FleetInstance[]): VehicleParts {
  const batches = new Map<string, Batch>();
  const order: string[] = [];
  for (const inst of instances) {
    let b = batches.get(inst.model);
    if (b === undefined) {
      b = { id: inst.model, instances: [], meshes: [], matrices: new Float32Array(0), data: new Float32Array(0), ready: false, shown: [] };
      batches.set(inst.model, b);
      order.push(inst.model);
    }
    b.instances.push(inst);
  }
  const loads = new AbortController();
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  const owners = new Map<string, object>();
  const materials: PbrMaterialProps[] = [];
  let pending = 0;
  let landed = 0;
  let began = false;
  let disposed = false;
  let resolveSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  if (order.length === 0) resolveSettled();

  function material(part: ModelPart, role: string): PbrMaterialProps {
    const src = part.material;
    const glass = role === "glass";
    const made = createPbrMaterial({
      baseColorFactor: (src.baseColorFactor ?? [1, 1, 1, 1]) as [number, number, number, number],
      metallicFactor: src.metallicFactor ?? 0,
      roughnessFactor: src.roughnessFactor ?? 1,
      doubleSided: true,
      usePhysicalLightFalloff: true,
      ...(glass ? { alphaBlend: true } : {}),
      ...(src.baseColorTexture === undefined ? {} : { baseColorTexture: src.baseColorTexture }),
      ...(src.ormTexture === undefined ? {} : { ormTexture: src.ormTexture }),
      ...(src.normalTexture === undefined ? {} : { normalTexture: src.normalTexture }),
    });
    const own = vehiclePlugin(role);
    made.plugins = [baseColourPlugin(), ...(own === null ? [] : [own]), surfaceWetPlugin(host.wet, host.shared), host.air()];
    materials.push(made);
    if (!glass) orders.take(made);
    return made;
  }

  /** A model's meshes: a mesh a primitive of its file, all drawn with the model's instances. */
  function* make(batch: Batch, parts: readonly ModelPart[]): Slices {
    const n = batch.instances.length;
    batch.matrices = new Float32Array(n * 16);
    batch.data = new Float32Array(n * FLEET_DATA_FLOATS);
    for (const [k, part] of parts.entries()) {
      if (disposed) return;
      const role = part.facts.material ?? "body";
      const mapped = part.colour !== undefined || part.normal !== undefined || part.material.ormTexture !== undefined;
      const mesh = createMeshFromData(
        host.engine, `${batch.id}.${role}.${k}`, part.positions.slice(), part.normals.slice(), part.indices.slice(),
        mapped ? part.uvs.slice() : undefined, undefined, mapped && part.tangents !== null ? part.tangents.slice() : undefined,
      );
      mesh.material = material(part, role);
      mesh.renderOrder = role === "glass" ? SEE_THROUGH_ORDER.glass + 1 : (orders.of(mesh.material as PbrMaterialProps) ?? DRAW_ORDER.bodies);
      setThinInstances(mesh, batch.matrices, n);
      if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = batch.data;
      setThinInstanceCount(mesh, 0);
      setMeshVisible(mesh, false);
      addToScene(host.scene, mesh);
      batch.meshes.push({ mesh, triangles: part.indices.length / 3 });
      host.uploaded?.(part.positions.byteLength + part.normals.byteLength + part.uvs.byteLength + part.indices.byteLength);
      yield;
    }
    batch.ready = true;
    landed++;
    pending--;
    if (pending === 0) resolveSettled();
  }

  function fail(id: string, error: unknown): void {
    console.warn(`the vehicle model ${id} could not be loaded; its vehicles are not drawn:`, error);
    pending--;
    if (pending === 0) resolveSettled();
  }

  function begin(): void {
    if (began || disposed) return;
    began = true;
    pending = order.length;
    for (const id of order) {
      const batch = batches.get(id) as Batch;
      const owner = {};
      owners.set(id, owner);
      loadModel(host.engine, modelUrl(`models/${id}.glb`), ["LOD0"], loads.signal).then(
        (model) => {
          if (disposed) return;
          const parts = model.get("LOD0") ?? [];
          if (parts.length === 0) {
            fail(id, new Error("the file has no LOD0"));
            return;
          }
          host.jobs.begin(owner, make(batch, parts), true, OWNER_PREFIX + id);
        },
        (error: unknown) => {
          if (!disposed) fail(id, error);
        },
      );
    }
  }

  function seen(planes: readonly ViewFrustumPlane[]): void {
    const eye = host.eye;
    const reach2 = REACH * REACH;
    for (const batch of batches.values()) {
      if (!batch.ready) continue;
      const next: number[] = [];
      for (const [i, inst] of batch.instances.entries()) {
        const dx = inst.x - eye.x;
        const dz = inst.z - eye.z;
        if (dx * dx + dz * dz > reach2) continue;
        let inside = true;
        for (const plane of planes) {
          if (plane.normal.x * inst.x + plane.normal.y * inst.y + plane.normal.z * inst.z + plane.d <= -inst.radius) {
            inside = false;
            break;
          }
        }
        if (inside) next.push(i);
      }
      const same = next.length === batch.shown.length && next.every((v, k) => v === batch.shown[k]);
      if (same) continue;
      batch.shown = next;
      for (const [k, i] of next.entries()) {
        const inst = batch.instances[i] as FleetInstance;
        batch.matrices.set(inst.matrix, k * 16);
        batch.data.set(inst.data, k * FLEET_DATA_FLOATS);
      }
      for (const { mesh } of batch.meshes) {
        setThinInstanceCount(mesh, next.length);
        markThinInstancePluginData(mesh, 0, next.length * FLEET_DATA_FLOATS);
        setMeshVisible(mesh, next.length > 0);
      }
    }
  }

  return {
    begin,
    seen,
    waiting: () => pending,
    stats() {
      let meshes = 0;
      let drawn = 0;
      let count = 0;
      let triangles = 0;
      for (const b of batches.values()) {
        meshes += b.meshes.length;
        if (b.shown.length > 0) {
          drawn += b.meshes.length;
          count += b.shown.length;
          for (const m of b.meshes) triangles += m.triangles * b.shown.length;
        }
      }
      return { models: landed, meshes, drawn, instances: count, triangles };
    },
    settled,
    dispose() {
      disposed = true;
      loads.abort();
      for (const owner of owners.values()) host.jobs.cancel(owner);
      for (const b of batches.values()) {
        for (const { mesh } of b.meshes) {
          removeFromScene(host.scene, mesh);
          disposeMeshGpu(mesh);
        }
        b.meshes.length = 0;
      }
    },
  };
}
