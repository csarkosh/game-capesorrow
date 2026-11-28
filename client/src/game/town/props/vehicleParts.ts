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
 * - **Culled here, since Lite culls no mesh.** Each frame `seen` takes the instances in the view's planes and within `REACH` (160 m) of the eye and,
 *   only when that set has changed, writes them to the front of the model's buffers and sets the instances drawn. A vehicle that was
 *   behind the player costs nothing; a street of them costs their triangles, about 20,000 a vehicle.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, flushThinInstances, markThinInstancePluginData, removeFromScene, setMeshVisible, setThinInstanceCount,
  setThinInstances, type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadModel, type ModelPart } from "@csarkosh/engine/game/lite/forestModels";
import { modelTextureOptions } from "@csarkosh/engine/game/lite/modelLoadOptions";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import type { WetUniforms } from "@csarkosh/engine/game/wetSurface";
import type { PluginUniformBlock } from "@babylonjs/lite";
import type { Slices, SyncJobs } from "@csarkosh/engine/game/syncJobs";
import { FLEET_DATA_FLOATS, type FleetInstance } from "./vehicleFleet.js";
import type { Vehicle } from "../../../sim/town/types.js";
import { vehiclePlugin, type VehicleGeom } from "./vehicleMaterial.js";
import { MANIFEST } from "./vehicleManifest.js";

/** How far from the eye a vehicle is drawn (m): past it a vehicle is a few pixels under the town's own fog. */
export const REACH = 160;

/** What the parts are made with: the renderer's own. */
export type VehiclePartsHost = {
  readonly engine: EngineContext;
  /** The quality tier: the size the models' textures are held at (`modelTextureOptions`). */
  readonly tier: QualityTier;
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
  /**
   * Draws a parked vehicle moved from where it stands: `move` (sixteen floats, column by column, in the world) is applied over its own matrix, or null
   * puts it back. A vehicle that is no model here is not this part's, and nothing is done. Safe every frame.
   */
  moved(vehicle: Vehicle, move: Float32Array | null): void;
  /** Whether a model's meshes are all made (so its instances stand for its vehicles). */
  ready(model: string): boolean;
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

/** Where a model's wheels, glass and windscreen are, read off its parts (the manifest's wheels, the glass's vertices and their normals). */
export function geometryOf(id: string, parts: readonly ModelPart[]): VehicleGeom {
  const wheels = MANIFEST.vehicles.find((v) => v.id === id)?.wheels ?? [];
  const xs = wheels.map((w) => w.x);
  const axles: [number, number] = xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : [-1.3, 1.3];
  const wheel = wheels.length > 0 ? wheels.reduce((n, w) => n + w.r, 0) / wheels.length : 0.33;
  let gy0 = Infinity;
  let gy1 = -Infinity;
  let sx = Infinity;
  let sy0 = Infinity;
  let sy1 = -Infinity;
  let sz = 0;
  for (const part of parts) {
    if (part.facts.material !== "glass") continue;
    for (let i = 0; i < part.positions.length; i += 3) {
      const y = part.positions[i + 1] as number;
      gy0 = Math.min(gy0, y);
      gy1 = Math.max(gy1, y);
      if ((part.normals[i] as number) > 0.5) {
        sx = Math.min(sx, part.positions[i] as number);
        sy0 = Math.min(sy0, y);
        sy1 = Math.max(sy1, y);
        sz = Math.max(sz, Math.abs(part.positions[i + 2] as number));
      }
    }
  }
  const have = gy0 < gy1;
  return {
    axles, wheel,
    glass: have ? [gy0, gy1] : [1.0, 1.4],
    screen: sx < Infinity ? { x: sx, y0: sy0, y1: sy1, zh: sz } : { x: axles[1] - 0.4, y0: 1.0, y1: 1.4, zh: 0.6 },
  };
}

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
  // A vehicle that is drawn moved (struck by a car: `struck.ts`): its own matrix with the move over it, in place of its own.
  const where = new Map<Vehicle, { batch: Batch; index: number }>();
  for (const b of batches.values()) for (const [index, inst] of b.instances.entries()) where.set(inst.vehicle, { batch: b, index });
  const overrides = new Map<FleetInstance, Float32Array>();
  const matrixOf = (inst: FleetInstance): Float32Array => overrides.get(inst) ?? inst.matrix;
  function moved(vehicle: Vehicle, move: Float32Array | null): void {
    const at = where.get(vehicle);
    if (at === undefined) return;
    const inst = at.batch.instances[at.index] as FleetInstance;
    if (move === null) {
      if (!overrides.delete(inst)) return;
    } else {
      let own = overrides.get(inst);
      if (own === undefined) {
        own = new Float32Array(16);
        overrides.set(inst, own);
      }
      // The move times the vehicle's own matrix, column by column.
      const a = move;
      const b = inst.matrix;
      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          own[col * 4 + row] = (a[row] as number) * (b[col * 4] as number) + (a[4 + row] as number) * (b[col * 4 + 1] as number) + (a[8 + row] as number) * (b[col * 4 + 2] as number) + (a[12 + row] as number) * (b[col * 4 + 3] as number);
        }
      }
    }
    // Shown now: its place in the buffers is written again.
    const k = at.batch.shown.indexOf(at.index);
    if (k < 0 || !at.batch.ready) return;
    at.batch.matrices.set(matrixOf(inst), k * 16);
    for (const { mesh } of at.batch.meshes) flushThinInstances(mesh, k, 1);
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

  function material(part: ModelPart, role: string, geom: VehicleGeom): PbrMaterialProps {
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
    const own = vehiclePlugin(role, geom);
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
    const geom = geometryOf(batch.id, parts);
    for (const [k, part] of parts.entries()) {
      if (disposed) return;
      const role = part.facts.material ?? "body";
      const mapped = part.colour !== undefined || part.normal !== undefined || part.material.ormTexture !== undefined;
      const mesh = createMeshFromData(
        host.engine, `${batch.id}.${role}.${k}`, part.positions.slice(), part.normals.slice(), part.indices.slice(),
        mapped ? part.uvs.slice() : undefined, undefined, mapped && part.tangents !== null ? part.tangents.slice() : undefined,
      );
      mesh.material = material(part, role, geom);
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
      loadModel(host.engine, modelUrl(`models/${id}.glb`), ["LOD0"], loads.signal, modelTextureOptions(host.tier)).then(
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
        batch.matrices.set(matrixOf(inst), k * 16);
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
    moved,
    ready: (model) => batches.get(model)?.ready === true,
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
