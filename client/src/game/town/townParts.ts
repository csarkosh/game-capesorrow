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
  addToScene, createMeshFromData, createPbrMaterial, createTexture2DArray, disposeMeshGpu, updateTexture2DArrayFromPixels, markMaterialUboDirty, removeFromScene, setMeshVisible,
  type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import { noParts, type NoPartsApi } from "@csarkosh/engine/game/lite/noParts";
import { createLeaner } from "./leanMesh.js";
import { townBlurPlugin } from "./townBlur.js";
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
import { peopleFor, personWorld } from "./people.js";
import { createPeopleParts, type PeopleParts } from "./peopleParts.js";
import { standInGeometry } from "./props/vehicleStandIn.js";
import { RANK_UNITS, emptyTownReady, townSurfacePlugin, type TownReady } from "./townMaterial.js";
import { createTownTextures, type TownTextures } from "./townTextures.js";

/** A cell's mesh with what the view's test needs of it. */
type Made = { mesh: Mesh; layer: TownBatch["layer"]; x: number; y: number; z: number; radius: number; shown: boolean; /** The model this car stands in for, until the model's meshes are made. */ model?: string };

/**
 * How far toward the eye the flat layer is drawn, so that it lies over the terrain it is laid on: steps of a 24-bit depth buffer (the
 * engine's `ahead`). Positive: the renderer's depth runs from 1 at the near plane to 0 far away, so toward the eye is up. With it negative
 * the layer is drawn behind the terrain instead, and a surface with no cut under it (a yard's drive, a walk, a patch) is seen only from a
 * few metres (`depthLead.test.ts`).
 *
 * The slope's share of the engine's offset is not used (0). It is worked out at each vertex and drawn as the triangle's own run between
 * them, so two flat surfaces at one place get different shares of it wherever their triangles differ, by far more than a rank's step: a
 * patch of large triangles on a roadway of small ones was eaten by the roadway in a wedge that moved with the eye, and the ground was drawn
 * over the foot of a wall or a step near by. The steps alone are the same at every point of every surface, so the ranks hold.
 */
export const FLAT_AHEAD_UNITS = 120;
export const FLAT_AHEAD_SLOPE = 0;
/** Where among the see-through draws a room's haze stands: after the cars' shadows and before the lettering and the glass, which are laid over it. */
export const HAZE_ORDER = SEE_THROUGH_ORDER.lettering - 1;
/** Where the lettering stands on a tier whose glass writes its whole pixel (`townBlur.ts`): after the glass. */
export const LETTERING_OVER_GLASS = SEE_THROUGH_ORDER.glass + 1;

/** How far the hour moves before the materials are written again (a hundredth of an hour). */
const HOUR_STEP = 0.01;
/** Where the dark at the walls' feet stands (`footShade.ts`): over the water, before the cars' shadows and everything laid over the ground after them. */
export const SHADE_ORDER = SEE_THROUGH_ORDER.carShadow - 1;
/** The dark at the walls' feet is drawn this many depth steps ahead of where it lies: past the flat ground's own (`FLAT_AHEAD_UNITS`) and its highest rank's, which it lies over. */
export const SHADE_AHEAD_UNITS = FLAT_AHEAD_UNITS + 16 * RANK_UNITS;

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
  // The people standing in the open shops (`peopleParts.ts`): loaded with the vehicles, once the town is made, and drawn when near.
  let people: PeopleParts | null = null;
  // The hour of day last written to the materials (12 until a frame says otherwise), and their record.
  let shownHour = 12;
  let ready: TownReady | null = null;

  const side: RenderSide<RenderState<RenderPlayer>, RenderPlayer> = {
    ...base.side,
    // The shops' glass reads the frame the opaque draws left, to show each room out of focus (`townBlur.ts`): the medium tier keeps it too.
    keepsFrame: true,

    // The renderer hands the hour of day with the view each frame (the console's `time`): the town's shaders and its people follow it.
    wildlife: {
      ...base.side.wildlife,
      look(state, x, y, z, yaw, pitch, fov, aspect, hour, mist) {
        base.side.wildlife.look(state, x, y, z, yaw, pitch, fov, aspect, hour, mist);
        if (Math.abs(hour - shownHour) > HOUR_STEP) {
          shownHour = hour;
          if (ready !== null) {
            ready.townHour[0] = hour;
            for (const m of textured) markMaterialUboDirty(m);
          }
          people?.setHour(hour);
        }
      },
    },

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

    late({ engine, scene, shared, air, wetAt, ahead, skinClock, hardCover: cover, behind }) {
      const forest = host.forest;
      if (forest === null) return;
      hardCover = cover;
      standing = scene;
      const wet = wetAt(WET_CAP.prop);
      const orders = createDrawOrders(DRAW_ORDER.scenery);
      const low = host.tier === "low";
      ready = emptyTownReady();
      ready.townHour[0] = shownHour;
      const readied = ready;
      try {
        textures = createTownTextures(engine, low, loading.signal, (filled) => {
          if (!filled || disposed) return;
          readied.townReady[0] = 1;
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
          baseColourPlugin(), ...(wearsTextures && textures !== null ? [townSurfacePlugin(textures, readied, low, undefined, flat)] : []),
          surfaceWetPlugin(wet, shared), ...(flat ? [ahead(FLAT_AHEAD_UNITS, FLAT_AHEAD_SLOPE)] : []), air(),
        ];
        orders.take(m);
        if (wearsTextures) textured.push(m);
        return m;
      };
      // The town's own draw before the railroad's, so where a crossing's panel lies flush with a street the panel is drawn last.
      const wearsTextures = textures !== null;
      // Whether the rooms are seen through their glass out of focus: the frame behind the glass is kept, and the glass has its plugin.
      const through = behind !== undefined && wearsTextures;
      const town = { flat: material(true, wearsTextures), solid: material(false, wearsTextures) };
      // The glass: blended over what is behind it (the rooms), after every opaque draw, with the town's plugin for the sky's reflection. It needs the plugin, so without the textures' arrays there is no glass drawn (the openings show their rooms).
      const glassMaterial = (): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.1, alphaBlend: true, usePhysicalLightFalloff: true });
        // Where the frame behind the glass is kept, a shop's pane reads its room from it, out of focus (`townBlur.ts`).
        m.plugins = [baseColourPlugin(), ...(textures !== null ? [townSurfacePlugin(textures, readied, low)] : []), ...(through && behind !== undefined ? [townBlurPlugin(behind, shared)] : []), air()];
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
        m.plugins = [baseColourPlugin(), townSurfacePlugin(textures as NonNullable<typeof textures>, readied, low, tex), air()];
        textured.push(m);
        return m;
      };
      // The dark at the walls' feet (`footShade.ts`): the glass's material, which reads a sheet by its seed, drawn ahead of the flat ground it lies over.
      const shadeMaterial = (): PbrMaterialProps => {
        const m = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, alphaBlend: true, usePhysicalLightFalloff: true });
        m.plugins = [baseColourPlugin(), ...(textures !== null ? [townSurfacePlugin(textures, readied, low)] : []), ahead(SHADE_AHEAD_UNITS, 0), air()];
        if (textures !== null) textured.push(m);
        return m;
      };
      const seeThrough = wearsTextures ? { glass: glassMaterial(), sign: atlasTexture === null ? null : signMaterial(atlasTexture), shade: low ? null : shadeMaterial() } : null;
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

      const plan = ground.plan;
      people = createPeopleParts(
        { engine, scene, air, clock: skinClock, uploads: host.uploads, eye: host.pose, low },
        peopleFor(plan).map((person) => ({ person, at: personWorld(ground, plan, person) })),
      );
      people.setHour(shownHour);

      function* build(): Slices {
        const batches: TownBatch[] = yield* townGeometry(ground, host.tier === "low" ? "low" : "full", start, atlas, through);
        // A code-built car for each model vehicle until its model lands (and for good where its file fails): made first, so they stand with the town's first cells.
        if (fleet.length > 0) batches.unshift(...(yield* standInGeometry(ground, fleet)));
        // Paint the lettering, a few signs a slice, and upload the atlas once.
        const surface = atlasTexture === null ? null : createPaintSurface(atlas.width, atlas.height);
        if (surface !== null && atlasTexture !== null) {
          for (let k = 0; k < atlas.requests.length; k++) {
            paintRequest(surface, atlas.requests[k] as (typeof atlas.requests)[number]);
            if (k % 24 === 23) yield;
          }
          const px = surface.ctx.getImageData(0, 0, atlas.width, atlas.height);
          updateTexture2DArrayFromPixels(engine, atlasTexture, new Uint8Array(px.data.buffer));
          host.uploads.count("textures", px.data.byteLength, 4);
        }
        left = batches.length;
        for (const batch of batches) {
          if (disposed) return;
          const a = batch.arrays;
          if (((batch.layer === "glass" || batch.layer === "haze") && seeThrough === null) || (batch.layer === "sign" && (seeThrough === null || seeThrough.sign === null)) || (batch.layer === "shade" && (seeThrough === null || seeThrough.shade === null))) {
            left--;
            continue;
          }
          const mesh = createMeshFromData(engine, `town_${batch.layer}_${batch.cx}_${batch.cz}`, a.positions, a.normals, a.indices, a.uvs, undefined, undefined, a.colors);
          if (wearsTextures) mesh.pluginVertexData = packSurface(a.surface);
          if (batch.layer === "shade") {
            mesh.material = (seeThrough as NonNullable<typeof seeThrough>).shade as PbrMaterialProps;
            mesh.renderOrder = SHADE_ORDER;
          } else if (batch.layer === "glass" || batch.layer === "sign" || batch.layer === "haze") {
            // A blended mesh stands at the world's origin among the see-through draws (`drawOrder.ts`); its place says where in them.
            const set = seeThrough as NonNullable<typeof seeThrough>;
            // A room's haze is the glass's material (its sheets say what they are), drawn before the lettering and the glass, which are laid over it.
            mesh.material = batch.layer === "sign" ? (set.sign as PbrMaterialProps) : set.glass;
            // Where a pane reads the frame behind it, it is drawn in the half after the break and writes its whole pixel: the lettering is then
            // drawn after the glass, not before it.
            mesh.renderOrder = batch.layer === "glass" ? SEE_THROUGH_ORDER.glass : batch.layer === "sign" ? (through ? LETTERING_OVER_GLASS : SEE_THROUGH_ORDER.lettering) : HAZE_ORDER;
            if (through && batch.layer === "glass") mesh.afterBreak = true;
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
        people?.begin();
      }

      building = true;
      host.jobs.begin(owner, build(), false, "town");
    },

    bodies(dt, lamp) {
      base.side.bodies(dt, lamp);
      people?.step(dt);
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
      people?.dispose();
      people = null;
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
