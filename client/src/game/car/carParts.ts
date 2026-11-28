/**
 * The car, drawn: the real sedan (`models/vehicle.sedan_a.glb`, the parked sedans' own file) as meshes whose thin instances are moved
 * every frame, with its four wheels apart from the body so they roll and the front pair steers, and a dark patch of the ground's under it.
 *
 * - **Meshes as the parked vehicles'** (`vehicleParts.ts`): one mesh a role of the model's `LOD0` but the `tyre`, each with the
 *   parked vehicles' material and `vehiclePlugin` (the paint and its dirt, here a clean car in dark paint), the weather's wet look and the
 *   air. The `tyre` mesh is cut into four (`splitWheels`), one mesh a wheel with its axle at the origin, wearing the file's own maps, the wet
 *   look and the air but not `vehiclePlugin`, whose code reads a vertex's place in the model.
 * - **Thin instances, rewritten every frame**: each mesh holds room for `CAPACITY` cars (one is drawn; the pool costs a few floats), and
 *   a frame writes each car's matrix into the mesh's own array and tells Lite it changed (`flushThinInstances`, which marks the instances'
 *   range dirty so the next draw sends the sixteen floats an instance: nothing is made or bound again, so it is safe every frame).
 * - **Between ticks.** The renderer is handed, for the car the local player drives, the predicted world's own car, which changes once a
 *   tick; the eye is drawn `alpha` of the way from where the last tick began (`eyeBlend.ts`). This car is drawn from the same two
 *   ticks by the same `alpha`, so the car and the camera that follows it move as one. Every other car is already blended for the frame
 *   (`net.ts`, `view`): it is drawn as it is.
 * - **Fails soft.** A model that does not load leaves no car drawn and one warning on the console; the pose does not need the model, only
 *   the ground, so `pose` serves the camera all the same.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, flushThinInstances, markThinInstancePluginData, removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances, type MaterialPlugin, type Mesh, type PbrMaterialProps,
} from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadModel, type ModelPart } from "@csarkosh/engine/game/lite/forestModels";
import { modelTextureOptions } from "@csarkosh/engine/game/lite/modelLoadOptions";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import type { Car } from "../../sim/car/types.js";
import { RANK_UNITS } from "../town/townMaterial.js";
import { FLEET_DATA_FLOATS } from "../town/props/vehicleFleet.js";
import { MODEL_PAINT } from "../town/props/vehicleLook.js";
import { manifestOf } from "../town/props/vehicleManifest.js";
import { vehiclePlugin, type VehicleGeom } from "../town/props/vehicleMaterial.js";
import { geometryOf, type VehiclePartsHost } from "../town/props/vehicleParts.js";
import { newSway, stepSway, swayMatrix, type Sway } from "./bodySway.js";
import { carPose, halfTurnAboutY, newCarPose, rollAfter, splitWheels, wheelMatrix, type CarPose, type WheelPart } from "./carPose.js";

export const CAR_MODEL = "vehicle.sedan_a";
/** The most cars drawn at once: the room each mesh keeps in its instances. */
export const CAPACITY = 4;
/** The paint of the car: charcoal, as the parked cars' table has it. */
const PAINT = MODEL_PAINT[3] as readonly [number, number, number];
/**
 * How far toward the eye the dark patch is drawn, depth steps: where the town's own dark at the walls' feet is (`SHADE_AHEAD_UNITS` in
 * `townParts.ts`, the flat ground's steps and its highest rank's), so it lies over the ground it is laid on.
 */
export const PATCH_AHEAD_UNITS = 120 + 16 * RANK_UNITS;
/** Where among the opaque draws the car's materials stand: past the parked vehicles' places, which run on from the shell's first. */
const OWN_PLACE = 600;
/** The patch's height over the wheels' plane, m. */
export const PATCH_LIFT = 0.03;
/**
 * How dark the patch is at its fullest: the parked cars' patch is wear laid over the ground, 0.9 at most (`vehicleGeometry.ts`), full to about
 * two thirds of the way to its rim and none at it. The dark's colour is near black, a little over the mud layer's under the parked cars' tint.
 */
export const PATCH_ALPHA = 0.9;
const PATCH_COLOUR: [number, number, number] = [0.03, 0.03, 0.035];

export type CarParts = {
  /** Begins loading the model. Once, after the town stands. */
  begin(): void;
  /**
   * The cars this frame draws. `cars` is the state's; `tick` the state's tick; `alpha` how far the frame is into the tick; `dt` the frame's
   * seconds; `driven` the id of the car the local player drives (0 for none), whose record changes once a tick and is blended by `alpha`.
   */
  frame(cars: readonly Car[], tick: number, alpha: number, dt: number, driven?: number): void;
  /** The car's pose as the last frame drew it, or null for a car not in it. It needs the ground, not the model. */
  pose(id: number): CarPose | null;
  /** Shows the car's meshes while one of the cars is in the view. */
  seen(planes: readonly ViewFrustumPlane[]): void;
  dispose(): void;
};

/** What is kept of a car between frames. */
type Entry = {
  id: number;
  pose: CarPose;
  /** The car the local player drives, as the tick before the last had it and as the last has it (`has` says they are filled), the tick that is, and how many ticks the last change was (a frame that missed one blends over both). */
  prev: Car;
  cur: Car;
  has: boolean;
  /** `prev` is the tick before `cur` and may be blended from. */
  blend: boolean;
  span: number;
  tick: number;
  roll: number;
  /** The body on its springs (`bodySway.ts`). */
  sway: Sway;
  stamp: number;
};

type Wheel = { mesh: Mesh; centre: [number, number, number]; front: boolean; matrices: Float32Array };
type Body = { mesh: Mesh; matrices: Float32Array };

function copyCar(from: Car): Car {
  return { ...from, controls: { ...from.controls }, seats: [...from.seats] };
}

/** `from`'s numbers written over `to`'s, with nothing made. */
function copyInto(to: Car, from: Car): void {
  to.id = from.id; to.x = from.x; to.y = from.y; to.z = from.z; to.hx = from.hx; to.hz = from.hz;
  to.speed = from.speed; to.slip = from.slip; to.steer = from.steer; to.lights = from.lights;
  to.controls.throttle = from.controls.throttle; to.controls.turn = from.controls.turn; to.controls.handbrake = from.controls.handbrake;
  for (let i = 0; i < 4; i++) to.seats[i] = from.seats[i] as number;
}

/**
 * The dark patch under the car: the parked cars' eight-cornered patch, inset from the footprint by 0.3 m at the ends and 0.22 m at the sides,
 * lying on the wheels' plane. Its alpha (`PATCH_ALPHA` at most, in the material) is full from its middle to just over half way to its rim, then falls to none at the rim.
 */
export function patchGeometry(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array; colors: Float32Array } {
  const f = manifestOf(CAR_MODEL).footprint;
  const hl = f.length / 2 - 0.3;
  const hw = f.width / 2 - 0.22;
  const ring: [number, number][] = [[hl, hw * 0.6], [hl * 0.8, hw], [-hl * 0.8, hw], [-hl, hw * 0.6], [-hl, -hw * 0.6], [-hl * 0.8, -hw], [hl * 0.8, -hw], [hl, -hw * 0.6]];
  const rings = [{ scale: 0.55, alpha: 1 }, { scale: 1, alpha: 0 }];
  const positions: number[] = [0, PATCH_LIFT, 0];
  const colors: number[] = [1, 1, 1, 1];
  for (const r of rings) {
    for (const [a, c] of ring) {
      positions.push(a * r.scale, PATCH_LIFT, c * r.scale);
      colors.push(1, 1, 1, r.alpha);
    }
  }
  const n = ring.length;
  const indices: number[] = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    // Wound so the face is up for a model whose y is up (the material is double sided in any case).
    indices.push(0, 1 + k1, 1 + k);
    indices.push(1 + k, 1 + k1, 1 + n + k1, 1 + k, 1 + n + k1, 1 + n + k);
  }
  const vertices = positions.length / 3;
  const normals = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v++) normals[v * 3 + 1] = 1;
  return { positions: new Float32Array(positions), normals, indices: Uint32Array.from(indices), colors: new Float32Array(colors) };
}

/**
 * Which cars are drawn: the first `capacity` of the state's, in its order, except that the car the local player drives (`driven`, 0 for
 * none) always is, in the last place if it would not have had one. Fills `out` with the cars' indices in `ids` and answers how many; it makes nothing.
 */
export function drawnOf(ids: readonly number[], capacity: number, driven: number, out: number[]): number {
  const n = Math.min(ids.length, capacity);
  for (let i = 0; i < n; i++) out[i] = i;
  if (driven !== 0 && n === capacity && n > 0) {
    let among = false;
    for (let i = 0; i < n; i++) if (ids[i] === driven) among = true;
    if (!among) {
      const at = ids.indexOf(driven);
      if (at >= 0) out[n - 1] = at;
    }
  }
  return n;
}

export function createCarParts(host: VehiclePartsHost & { groundAt(x: number, z: number): number; ahead(units: number, slope?: number): MaterialPlugin }): CarParts {
  const entries = new Map<number, Entry>();
  let stamp = 0;
  const loads = new AbortController();
  const owner = {};
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  const materials: PbrMaterialProps[] = [];
  const bodies: Body[] = [];
  const wheels: Wheel[] = [];
  let patch: Body | null = null;
  let began = false;
  let disposed = false;
  let failed = false;
  /** Every mesh is made: until then the cars are posed and not drawn. */
  let ready = false;
  let shownCount = 0;
  let visible = false;
  /** The cars of the last frame in the order they are written into the instances. */
  const drawn: Entry[] = [];
  /** The frame's cars in the state's order, their ids, and the indices chosen to be drawn (`drawnOf`): kept to make no arrays a frame. */
  const posed: Entry[] = [];
  const posedIds: number[] = [];
  const pick: number[] = [];
  /** The body's matrix with its lean, written once a car and copied to each of its meshes. */
  const leaned = new Float32Array(16);

  const meshes = (): Mesh[] => [...bodies.map((b) => b.mesh), ...wheels.map((w) => w.mesh), ...(patch === null ? [] : [patch.mesh])];

  function partMaterial(part: ModelPart, role: string, plugin: MaterialPlugin | null): PbrMaterialProps {
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
    made.plugins = [baseColourPlugin(), ...(plugin === null ? [] : [plugin]), surfaceWetPlugin(host.wet, host.shared), host.air()];
    materials.push(made);
    if (!glass) orders.put(made, OWN_PLACE + materials.length);
    return made;
  }

  /** A mesh drawn as `CAPACITY` thin instances, none shown until a frame has written them. */
  function instanced(mesh: Mesh): Float32Array {
    const matrices = new Float32Array(CAPACITY * 16);
    setThinInstances(mesh, matrices, CAPACITY);
    setThinInstanceCount(mesh, 0);
    setMeshVisible(mesh, false);
    addToScene(host.scene, mesh);
    return matrices;
  }

  function meshOf(name: string, part: ModelPart, positions: Float32Array, indices: Uint32Array, from: Uint32Array | null): Mesh {
    const mapped = part.colour !== undefined || part.normal !== undefined || part.material.ormTexture !== undefined;
    const pick = (a: Float32Array, size: number): Float32Array => {
      if (from === null) return a.slice();
      const out = new Float32Array(from.length * size);
      for (let i = 0; i < from.length; i++) for (let q = 0; q < size; q++) out[i * size + q] = a[(from[i] as number) * size + q] as number;
      return out;
    };
    return createMeshFromData(
      host.engine, name, positions, pick(part.normals, 3), indices,
      mapped ? pick(part.uvs, 2) : undefined, undefined, mapped && part.tangents !== null ? pick(part.tangents, 4) : undefined,
    );
  }

  function* make(loaded: readonly ModelPart[]): Slices {
    // The loader's mirror leaves the model's nose at -x: the car is drawn from the model turned half a circle about its up (`halfTurnAboutY`).
    const parts = loaded.map((part): ModelPart => ({
      ...part, positions: halfTurnAboutY(part.positions, 3), normals: halfTurnAboutY(part.normals, 3),
      tangents: part.tangents === null ? null : halfTurnAboutY(part.tangents, 4),
    }));
    const geom: VehicleGeom = geometryOf(CAR_MODEL, parts);
    const look = new Float32Array([PAINT[0], PAINT[1], PAINT[2], 0, 0, 0, 0.37, 0, 0, 0, 0, 0]);
    const data = new Float32Array(CAPACITY * FLEET_DATA_FLOATS);
    for (let i = 0; i < CAPACITY; i++) data.set(look, i * FLEET_DATA_FLOATS);
    try {
      for (const [k, part] of parts.entries()) {
        if (disposed) return;
        const role = part.facts.material ?? "body";
        if (role === "tyre") {
          const cut: WheelPart[] = splitWheels(part.positions, part.indices, manifestOf(CAR_MODEL).wheels);
          const material = partMaterial(part, role, null);
          for (const [w, piece] of cut.entries()) {
            const mesh = meshOf(`car.wheel.${w}`, part, piece.positions, piece.indices, piece.source);
            mesh.material = material;
            mesh.renderOrder = orders.of(material) ?? DRAW_ORDER.bodies;
            const matrices = instanced(mesh);
            wheels.push({ mesh, centre: piece.centre, front: piece.centre[0] > 0, matrices });
          }
        } else {
          const mesh = meshOf(`car.${role}.${k}`, part, part.positions.slice(), part.indices.slice(), null);
          const material = partMaterial(part, role, vehiclePlugin(role, geom));
          mesh.material = material;
          mesh.renderOrder = role === "glass" ? SEE_THROUGH_ORDER.glass + 1 : (orders.of(material) ?? DRAW_ORDER.bodies);
          const matrices = instanced(mesh);
          if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = data;
          bodies.push({ mesh, matrices });
        }
        host.uploaded?.(part.positions.byteLength + part.normals.byteLength + part.uvs.byteLength + part.indices.byteLength);
        yield;
      }
      // The dark under the body, a see-through patch ordered where the town's dark at the walls' feet is, a place before the lettering and the glass.
      const g = patchGeometry();
      const mesh = createMeshFromData(host.engine, "car.patch", g.positions, g.normals, g.indices, undefined, undefined, undefined, g.colors);
      const material = createPbrMaterial({ baseColorFactor: [...PATCH_COLOUR, PATCH_ALPHA], metallicFactor: 0, roughnessFactor: 1, alphaBlend: true, doubleSided: true, usePhysicalLightFalloff: true });
      material.plugins = [baseColourPlugin(), host.ahead(PATCH_AHEAD_UNITS, 0), host.air()];
      mesh.material = material;
      mesh.renderOrder = SEE_THROUGH_ORDER.carShadow;
      patch = { mesh, matrices: instanced(mesh) };
      ready = true;
    } catch (error) {
      fail(error);
    }
  }

  function fail(error: unknown): void {
    if (failed) return;
    failed = true;
    console.warn(`the car's model ${CAR_MODEL} could not be made; no car is drawn:`, error);
    // What was made is let go, so no half a car is drawn.
    for (const mesh of meshes()) {
      removeFromScene(host.scene, mesh);
      disposeMeshGpu(mesh);
    }
    bodies.length = 0;
    wheels.length = 0;
    patch = null;
    ready = false;
  }

  function begin(): void {
    if (began || disposed) return;
    began = true;
    loadModel(host.engine, modelUrl(`models/${CAR_MODEL}.glb`), ["LOD0"], loads.signal, modelTextureOptions(host.tier)).then(
      (model) => {
        if (disposed) return;
        const parts = model.get("LOD0") ?? [];
        if (parts.length === 0) {
          fail(new Error("the file has no LOD0"));
          return;
        }
        host.jobs.begin(owner, make(parts), true, `car:${CAR_MODEL}`);
      },
      (error: unknown) => {
        if (!disposed) fail(error);
      },
    );
  }

  /** The cars the frame draws are written into every mesh, and the instances told they changed. */
  function write(n: number): void {
    for (const [i, entry] of drawn.entries()) {
      const m = entry.pose.matrix;
      // The body leans, dips and rides on its springs; the wheels and the patch stay on the ground.
      swayMatrix(m, entry.sway, leaned, 0);
      for (const b of bodies) b.matrices.set(leaned, i * 16);
      if (patch !== null) patch.matrices.set(m, i * 16);
      for (const w of wheels) wheelMatrix(m, w.centre, w.front ? entry.pose.steer : 0, entry.roll, w.matrices, i * 16);
    }
    for (const mesh of meshes()) {
      if (n !== shownCount) setThinInstanceCount(mesh, n);
      else if (n > 0) flushThinInstances(mesh, 0, n);
      const data = mesh.thinInstances?.pluginData;
      if (data !== undefined && data !== null && n !== shownCount) markThinInstancePluginData(mesh, 0, n * FLEET_DATA_FLOATS);
    }
    shownCount = n;
  }

  function frame(cars: readonly Car[], tick: number, alpha: number, dt: number, driven = 0): void {
    if (disposed) return;
    stamp++;
    drawn.length = 0;
    posed.length = 0;
    posedIds.length = 0;
    for (const c of cars) {
      let e = entries.get(c.id);
      if (e === undefined) {
        e = { id: c.id, pose: newCarPose(), prev: copyCar(c), cur: copyCar(c), has: false, blend: false, span: 1, tick, roll: 0, sway: newSway(), stamp };
        entries.set(c.id, e);
      }
      e.stamp = stamp;
      // The car the local player drives changes once a tick: it is drawn `alpha` of the way from the tick before to this one, as the eye is
      // (`eyeBlend.ts`). A frame that saw two ticks pass blends from where the first of them left the car (a straight line over both).
      // Every other car is blended already for the frame and drawn as it is.
      let before: Car | null = null;
      let a = alpha;
      if (c.id === driven) {
        if (!e.has) {
          copyInto(e.cur, c);
          e.has = true;
          e.blend = false;
          e.tick = tick;
        } else if (tick !== e.tick) {
          copyInto(e.prev, e.cur);
          copyInto(e.cur, c);
          e.span = Math.max(1, tick - e.tick);
          e.blend = true;
          e.tick = tick;
        }
        before = e.blend ? e.prev : null;
        a = (e.span - 1 + alpha) / e.span;
      } else {
        e.has = false;
        e.blend = false;
      }
      carPose(before, c, a, host.groundAt, e.pose);
      e.roll = rollAfter(e.roll, e.pose.speed, dt);
      stepSway(e.sway, e.pose, dt);
      // Every car is posed, whatever the count, for the camera's sake.
      posed.push(e);
      posedIds.push(c.id);
    }
    // Of them `CAPACITY` are drawn: the first in the state's order, and the driven car among them (`drawnOf`).
    const count = drawnOf(posedIds, CAPACITY, driven, pick);
    for (let k = 0; k < count; k++) drawn.push(posed[pick[k] as number] as Entry);
    for (const [id, e] of entries) if (e.stamp !== stamp) entries.delete(id);
    if (ready) write(drawn.length);
  }

  return {
    begin,
    frame,
    pose: (id) => {
      const e = entries.get(id);
      return e === undefined || e.stamp !== stamp ? null : e.pose;
    },
    seen(planes) {
      let any = false;
      if (ready) {
        for (const e of drawn) {
          let inside = true;
          for (const plane of planes) {
            if (plane.normal.x * e.pose.x + plane.normal.y * (e.pose.y + 0.7) + plane.normal.z * e.pose.z + plane.d <= -3.2) {
              inside = false;
              break;
            }
          }
          if (inside) {
            any = true;
            break;
          }
        }
      }
      if (any === visible) return;
      visible = any;
      for (const mesh of meshes()) setMeshVisible(mesh, any);
    },
    dispose() {
      disposed = true;
      loads.abort();
      // Only a job that was begun is cancelled.
      if (began) host.jobs.cancel(owner);
      for (const mesh of meshes()) {
        removeFromScene(host.scene, mesh);
        disposeMeshGpu(mesh);
      }
      bodies.length = 0;
      wheels.length = 0;
      patch = null;
      entries.clear();
      drawn.length = 0;
      posed.length = 0;
      ready = false;
    },
  };
}
