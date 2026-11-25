/**
 * Cape Sorrow's side of a renderer (`renderGame.ts`): the engine's own with no parts of a game's (`noParts`: its look, its
 * api, every point at rest) and, joined to the scene once it is registered, the town.
 *
 * - **The geometry is the pure builders'** (`townGeometry.ts`): batches of arrays by cell of 128 m, one for what lies
 *   flat on the ground and one for what stands. Here each batch is a Lite mesh (`createMeshFromData`, with vertex colours)
 *   under a matt PBR material that wears the air (fog), the weather's wet look at a prop's cap, and, for the flat
 *   layer, a depth step ahead of the terrain (`ahead`), as the engine's own props are.
 * - **Built over frames**: the geometry and then a mesh a slice are a job of the renderer's scheduler (`host.jobs`),
 *   the cells nearest the start first, so no frame stalls on the town. `waiting()` says how many are not yet made.
 * - **Culled here, since Lite culls no mesh**: each frame `seen` shows a cell's meshes while its bounding sphere is in
 *   the view's planes, and, for the standing layer, while it reaches into the rain's cover map's square (a hidden mesh is
 *   left out of that pass too).
 * - **Cover for the rain**: the standing layer's meshes (the buildings, the piers) are registered with the rain's cover
 *   map (`hardCover`, which is there on the tiers above low); the streets are not, they are what the rain lands on.
 * - **Tiers**: the low tier builds its buildings without the upper storeys' windows, the window frames and the sills
 *   (`Detail`); the geometry is otherwise the same on all three.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, createTexture2DArray, disposeMeshGpu, uploadImageToArrayLayer, markMaterialUboDirty, removeFromScene, setMeshVisible,
  type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import { createLeaner } from "./leanMesh.js";
import { packSurface } from "./surfacePack.js";
import type { RenderGame, RenderHost, RenderPlayer, RenderSide, RenderState } from "@csarkosh/engine/game/lite/renderGame";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import { PROP_ROUGHNESS } from "@csarkosh/engine/game/propBoxes";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { WET_CAP } from "@csarkosh/engine/game/wetSurface";
import { townStart } from "../../sim/town/start.js";
import { createRailStream, type RailStream } from "./railParts.js";
import { SignAtlas } from "./signAtlas.js";
import { createPaintSurface, paintRequest } from "./signPaint.js";
import { townGeometry, townGround, type TownBatch } from "./townGeometry.js";
import { fleetOf } from "./props/vehicleFleet.js";
import { createVehicleParts, type VehicleParts } from "./props/vehicleParts.js";
import { standInGeometry } from "./props/vehicleStandIn.js";
import { emptyTownReady, townSurfacePlugin } from "./townMaterial.js";
import { createTownTextures, type TownTextures } from "./townTextures.js";

/** A cell's mesh with what the view's test needs of it. */
type Made = { mesh: Mesh; layer: TownBatch["layer"]; x: number; y: number; z: number; radius: number; shown: boolean; /** The model this car stands in for, until the model's meshes are made. */ model?: string };

/**
 * How far toward the eye the flat layer is drawn, so that it lies over the terrain it is laid on: steps of a 24-bit depth buffer, and the
 * share of a pixel's own depth slope (the engine's `ahead`). Both are positive: the renderer's depth runs from 1 at the near plane to 0 far
 * away, so toward the eye is up. With either negative the layer is drawn behind the terrain instead, and a surface with no cut under it (a
 * yard's drive, a walk, a patch) is seen only from a few metres (`depthLead.test.ts`).
 */
export const FLAT_AHEAD_UNITS = 120;
export const FLAT_AHEAD_SLOPE = 1;

/** The bounding sphere of a batch's positions: the middle of its box and half the box's diagonal. */
export function boundsOf(positions: Float32Array): { x: number; y: number; z: number; radius: number } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const p = positions[i + a] as number;
      if (p < (lo[a] as number)) lo[a] = p;
      if (p > (hi[a] as number)) hi[a] = p;
    }
  }
  const x = ((lo[0] as number) + (hi[0] as number)) / 2;
  const y = ((lo[1] as number) + (hi[1] as number)) / 2;
  const z = ((lo[2] as number) + (hi[2] as number)) / 2;
  const dx = (hi[0] as number) - (lo[0] as number);
  const dy = (hi[1] as number) - (lo[1] as number);
  const dz = (hi[2] as number) - (lo[2] as number);
  return { x, y, z, radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 };
}

function inView(planes: readonly ViewFrustumPlane[], m: Made): boolean {
  for (const plane of planes) {
    if (plane.normal.x * m.x + plane.normal.y * m.y + plane.normal.z * m.z + plane.d <= -m.radius) return false;
  }
  return true;
}

export const townParts: RenderGame<RenderState<RenderPlayer>, RenderPlayer, NoPartsApi> = (host: RenderHost) => {
  const base = noParts(host);
  const made: Made[] = [];
  // The meshes whose arrays the GPU has not yet all taken (`leanMesh.ts`).
  const leaner = createLeaner();
  const owner = {};
  let disposed = false;
  let building = false;
  let left = 0;
  let hardCover: { add(mesh: Mesh): void; remove(mesh: Mesh): void } | undefined;
  let standing: SceneContext | null = null;
  let seed: Mesh | null = null;
  let seedScene: SceneContext | null = null;
  // The textures' arrays and the loads that fill them; the materials that read them.
  let textures: TownTextures | null = null;
  const loading = new AbortController();
  const textured: PbrMaterialProps[] = [];
  // The railroad and the power line, streamed along the coast by the camera's place (`railParts.ts`).
  let rail: RailStream | null = null;
  // The parked vehicles that stand as real models (`props/vehicleParts.ts`), on the tiers above low: loaded once the town's geometry is made.
  let vehicles: VehicleParts | null = null;

  const side: RenderSide<RenderState<RenderPlayer>, RenderPlayer> = {
    ...base.side,

    early({ engine, scene }) {
      // Lite builds the PBR pipelines of a scene's meshes by the build made when the scene is registered, and that build knows
      // vertex colours only if a mesh of the scene had them then (the engine's lake panorama does the same): so one mesh that
      // is never shown stands in the scene from the start with a colour a vertex, a triangle of no size.
      seed = createMeshFromData(
        engine, "town_colour_seed", new Float32Array(9), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), undefined, undefined, undefined,
        new Float32Array(12).fill(1),
      );
      seed.material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS });
      setMeshVisible(seed, false);
      addToScene(scene, seed);
      seedScene = scene;
    },

    late({ engine, scene, shared, air, wetAt, ahead, hardCover: cover }) {
      const forest = host.forest;
      if (forest === null) return;
      hardCover = cover;
      standing = scene;
      const wet = wetAt(WET_CAP.prop);
      const orders = createDrawOrders(DRAW_ORDER.scenery);
      const low = host.tier === "low";
      const ready = emptyTownReady();
      try {
        textures = createTownTextures(engine, low, loading.signal, (filled) => {
          if (!filled || disposed) return;
          ready.townReady[0] = 1;
          for (const m of textured) markMaterialUboDirty(m);
        });
      } catch (error) {
        // The arrays could not be made (no device to make them on): the town stays flat colour, as it was.
        console.warn("the town's texture arrays could not be made; the town stays flat colour:", error);
        textures = null;
      }
      const material = (flat: boolean, wearsTextures: boolean): PbrMaterialProps => {
        // The vertex colours carry the colour (or the paint the textures are multiplied by): the material's own is white.
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
        m.plugins = [
          baseColourPlugin(), ...(wearsTextures && textures !== null ? [townSurfacePlugin(textures, ready, low, undefined, flat)] : []),
          surfaceWetPlugin(wet, shared), ...(flat ? [ahead(FLAT_AHEAD_UNITS, FLAT_AHEAD_SLOPE)] : []), air(),
        ];
        orders.take(m);
        if (wearsTextures) textured.push(m);
        return m;
      };
      // The town's own draw before the railroad's, so where a crossing's panel lies flush with a street the panel is drawn last.
      const wearsTextures = textures !== null;
      const town = { flat: material(true, wearsTextures), solid: material(false, wearsTextures) };
      // The glass: blended over what is behind it (the rooms), after every opaque draw, with the town's plugin for the sky's reflection. It needs the plugin, so without the textures' arrays there is no glass drawn (the openings show their rooms).
      const glassMaterial = (): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.1, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), ...(textures !== null ? [townSurfacePlugin(textures, ready, low)] : []), air()];
        if (textures !== null) textured.push(m);
        return m;
      };
      // The lettering's atlas (`signAtlas.ts`): empty until it is painted, as the layers' arrays are until they land.
      const atlas = new SignAtlas(low ? 2048 : 4096, low ? 1024 : 2048, low ? 36 : 56);
      let atlasTexture: ReturnType<typeof createTexture2DArray> | null = null;
      try {
        atlasTexture = wearsTextures ? createTexture2DArray(engine, atlas.width, atlas.height, 1, { mipMaps: true, srgb: true }) : null;
      } catch (error) {
        console.warn("the town's lettering atlas could not be made; its signs are not drawn:", error);
      }
      const signMaterial = (tex: NonNullable<typeof atlasTexture>): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.7, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), townSurfacePlugin(textures as NonNullable<typeof textures>, ready, low, tex), air()];
        textured.push(m);
        return m;
      };
      const seeThrough = wearsTextures ? { glass: glassMaterial(), sign: atlasTexture === null ? null : signMaterial(atlasTexture) } : null;
      // The railroad's own materials (its draw order is its own, after the town's), reading the same texture layers and wear.
      const materials = { flat: material(true, wearsTextures), solid: material(false, wearsTextures) };
      const worldSeed = forest.seed;
      const start = townStart(worldSeed);
      rail = createRailStream(host, { engine, scene, materials, textured: wearsTextures, orders: { flat: orders.of(materials.flat) ?? DRAW_ORDER.scenery, solid: orders.of(materials.solid) ?? DRAW_ORDER.scenery } }, worldSeed);

      const ground = townGround(worldSeed);
      const fleet = low ? [] : fleetOf(ground, "full");
      if (!low) {
        vehicles = createVehicleParts({ engine, scene, shared, air, wet, jobs: host.jobs, eye: host.pose, uploaded: (bytes) => host.uploads.count("geometry", bytes, 4) }, fleet);
      }

      function* build(): Slices {
        const batches: TownBatch[] = yield* townGeometry(ground, host.tier === "low" ? "low" : "full", start, atlas);
        // A code-built car for each model vehicle until its model lands (and for good where its file fails): made first, so they stand with the town's first cells.
        if (fleet.length > 0) batches.unshift(...(yield* standInGeometry(ground, fleet)));
        // Paint the lettering, a few signs a slice, and upload the atlas once.
        const surface = atlasTexture === null ? null : createPaintSurface(atlas.width, atlas.height);
        if (surface !== null && atlasTexture !== null) {
          for (let k = 0; k < atlas.requests.length; k++) {
            paintRequest(surface, atlas.requests[k] as (typeof atlas.requests)[number]);
            if (k % 24 === 23) yield;
          }
          // The canvas itself is the source: no copy of its 32 MB is read back into the page, and none is sent through the browser's
          // write memory, which it keeps at the size of the largest write it has seen. Rows as they are (the top row first, as a read
          // of the canvas gives them), alpha not premultiplied.
          uploadImageToArrayLayer(engine, atlasTexture, 0, surface.ctx.canvas, { invertY: false, premultiplyAlpha: false });
          host.uploads.count("textures", atlas.width * atlas.height * 4, 4);
          // The canvas is let go at once: its pixels are the GPU's now.
          surface.ctx.canvas.width = 0;
          surface.ctx.canvas.height = 0;
        }
        left = batches.length;
        for (const batch of batches) {
          if (disposed) return;
          const a = batch.arrays;
          if ((batch.layer === "glass" && seeThrough === null) || (batch.layer === "sign" && (seeThrough === null || seeThrough.sign === null))) {
            left--;
            continue;
          }
          const mesh = createMeshFromData(engine, `town_${batch.layer}_${batch.cx}_${batch.cz}`, a.positions, a.normals, a.indices, a.uvs, undefined, undefined, a.colors);
          if (wearsTextures) mesh.pluginVertexData = packSurface(a.surface);
          if (batch.layer === "glass" || batch.layer === "sign") {
            // A blended mesh stands at the world's origin among the see-through draws (`drawOrder.ts`); its place says where in them.
            const set = seeThrough as NonNullable<typeof seeThrough>;
            mesh.material = batch.layer === "glass" ? set.glass : (set.sign as PbrMaterialProps);
            mesh.renderOrder = batch.layer === "glass" ? SEE_THROUGH_ORDER.glass : SEE_THROUGH_ORDER.lettering;
          } else {
            mesh.material = town[batch.layer];
            mesh.renderOrder = orders.of(town[batch.layer]) ?? DRAW_ORDER.scenery;
          }
          addToScene(scene, mesh);
          host.uploads.count("geometry", a.positions.byteLength + a.normals.byteLength + a.colors.byteLength + a.uvs.byteLength + a.surface.byteLength + a.indices.byteLength, 4);
          host.uploads.made();
          if (batch.layer === "solid") hardCover?.add(mesh);
          made.push({ mesh, layer: batch.layer, ...boundsOf(a.positions), shown: true, ...(batch.model === undefined ? {} : { model: batch.model }) });
          leaner.add(mesh);
          left--;
          yield;
        }
        building = false;
        // The town stands; now the vehicles' files are asked for, and each lands when it has.
        vehicles?.begin();
      }

      building = true;
      host.jobs.begin(owner, build(), false, "town");
    },

    seen(planes, cover) {
      base.side.seen(planes, cover);
      rail?.seen(planes);
      vehicles?.seen(planes);
      leaner.step();
      for (const m of made) {
        let want = inView(planes, m);
        // A stand-in car goes the moment its model's meshes are made.
        if (m.model !== undefined && vehicles?.ready(m.model) === true) want = false;
        // The standing layer is cover for the rain: shown to the map's pass while it reaches into the map's square.
        if (!want && m.layer === "solid" && cover !== null && Math.abs(m.x - cover.x) <= cover.half + m.radius && Math.abs(m.z - cover.z) <= cover.half + m.radius) want = true;
        if (want !== m.shown) {
          m.shown = want;
          setMeshVisible(m.mesh, want);
        }
      }
    },

    waiting: () => (building ? Math.max(1, left) : 0) + (textures?.pending() ?? 0),

    release() {
      if (seed !== null && seedScene !== null) {
        removeFromScene(seedScene, seed);
        disposeMeshGpu(seed);
      }
      seed = null;
      seedScene = null;
      base.side.release();
    },

    releaseBodies() {
      disposed = true;
      loading.abort();
      textures = null;
      textured.length = 0;
      rail?.dispose();
      rail = null;
      vehicles?.dispose();
      vehicles = null;
      host.jobs.cancel(owner);
      for (const m of made) {
        if (m.layer === "solid") hardCover?.remove(m.mesh);
        if (standing !== null) removeFromScene(standing, m.mesh);
        disposeMeshGpu(m.mesh);
        host.uploads.dropped();
      }
      made.length = 0;
      leaner.clear();
      building = false;
      base.side.releaseBodies();
    },
  };
  return { side, api: base.api };
};
