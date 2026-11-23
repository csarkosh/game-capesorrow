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
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setMeshVisible,
  type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { DRAW_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import type { RenderGame, RenderHost, RenderPlayer, RenderSide, RenderState } from "@csarkosh/engine/game/lite/renderGame";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import { PROP_ROUGHNESS } from "@csarkosh/engine/game/propBoxes";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { WET_CAP } from "@csarkosh/engine/game/wetSurface";
import { townStart } from "../../sim/town/start.js";
import { createRailStream, type RailStream } from "./railParts.js";
import { townGeometry, townGround, type TownBatch } from "./townGeometry.js";

/** A cell's mesh with what the view's test needs of it. */
type Made = { mesh: Mesh; layer: TownBatch["layer"]; x: number; y: number; z: number; radius: number; shown: boolean };

/** The depth step ahead of the terrain the flat layer is drawn with (the engine's face patches use the same). */
const FLAT_AHEAD_UNITS = -120;
const FLAT_AHEAD_SLOPE = -1;

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
  const owner = {};
  let disposed = false;
  let building = false;
  let left = 0;
  let hardCover: { add(mesh: Mesh): void; remove(mesh: Mesh): void } | undefined;
  let standing: SceneContext | null = null;
  let seed: Mesh | null = null;
  let seedScene: SceneContext | null = null;
  // The railroad and the power line, streamed along the coast by the camera's place (`railParts.ts`).
  let rail: RailStream | null = null;

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
      const material = (flat: boolean): PbrMaterialProps => {
        // The vertex colours carry the colour: the material's own is white.
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), surfaceWetPlugin(wet, shared), ...(flat ? [ahead(FLAT_AHEAD_UNITS, FLAT_AHEAD_SLOPE)] : []), air()];
        orders.take(m);
        return m;
      };
      const materials = { flat: material(true), solid: material(false) };
      const worldSeed = forest.seed;
      const start = townStart(worldSeed);
      rail = createRailStream(host, { engine, scene, materials, orders: { flat: orders.of(materials.flat) ?? DRAW_ORDER.scenery, solid: orders.of(materials.solid) ?? DRAW_ORDER.scenery } }, worldSeed);

      function* build(): Slices {
        const ground = townGround(worldSeed);
        const batches: TownBatch[] = yield* townGeometry(ground, host.tier === "low" ? "low" : "full", start);
        left = batches.length;
        for (const batch of batches) {
          if (disposed) return;
          const a = batch.arrays;
          const mesh = createMeshFromData(engine, `town_${batch.layer}_${batch.cx}_${batch.cz}`, a.positions, a.normals, a.indices, undefined, undefined, undefined, a.colors);
          mesh.material = materials[batch.layer];
          mesh.renderOrder = orders.of(materials[batch.layer]) ?? DRAW_ORDER.scenery;
          addToScene(scene, mesh);
          host.uploads.count("geometry", a.positions.byteLength + a.normals.byteLength + a.colors.byteLength + a.indices.byteLength, 4);
          host.uploads.made();
          if (batch.layer === "solid") hardCover?.add(mesh);
          made.push({ mesh, layer: batch.layer, ...boundsOf(a.positions), shown: true });
          left--;
          yield;
        }
        building = false;
      }

      building = true;
      host.jobs.begin(owner, build(), false, "town");
    },

    seen(planes, cover) {
      base.side.seen(planes, cover);
      rail?.seen(planes);
      for (const m of made) {
        let want = inView(planes, m);
        // The standing layer is cover for the rain: shown to the map's pass while it reaches into the map's square.
        if (!want && m.layer === "solid" && cover !== null && Math.abs(m.x - cover.x) <= cover.half + m.radius && Math.abs(m.z - cover.z) <= cover.half + m.radius) want = true;
        if (want !== m.shown) {
          m.shown = want;
          setMeshVisible(m.mesh, want);
        }
      }
    },

    waiting: () => (building ? Math.max(1, left) : 0),

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
      rail?.dispose();
      rail = null;
      host.jobs.cancel(owner);
      for (const m of made) {
        if (m.layer === "solid") hardCover?.remove(m.mesh);
        if (standing !== null) removeFromScene(standing, m.mesh);
        disposeMeshGpu(m.mesh);
        host.uploads.dropped();
      }
      made.length = 0;
      building = false;
      base.side.releaseBodies();
    },
  };
  return { side, api: base.api };
};
