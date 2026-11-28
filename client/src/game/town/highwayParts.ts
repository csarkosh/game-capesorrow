/**
 * The highway outside the town's strip, streamed by the camera's place as the railroad is (`railParts.ts`): the engine's road is endless, so cells of
 * `HIGHWAY_CELL` m along it (`highwayCells.ts`, pure from the seed, an index and a level of detail) are made over frames as jobs of the engine's scheduler
 * when the camera comes within `BUILD_REACH` of them, and let go (meshes removed, their GPU memory freed) when it leaves past `RELEASE_REACH`. Beyond the
 * built cells the engine's own painted road shows, as it did before.
 *
 * - **Reach.** The rail builds to 4300 m because what it builds at the fog's edge is a ballast strip of a few triangles a metre. The highway's paving
 *   is about 20 vertices a metre with its wear, so it is built to 600 m (300 on the low tier) and let go past 720 (380): the distance at which the wear is
 *   no longer told from the engine's painted road. The two meet where the stream ends with no seam to speak of (the engine's asphalt is as wide).
 * - **Levels.** Within `NEAR_REACH` the near cell (rows of 2 m and all the wear), beyond it the far one (rows of 8 m, the large patches), with `HYSTERESIS`
 *   of room so that a camera at the boundary does not rebuild.
 * - **Depth.** The cells' meshes use the rail's flat material: drawn the town's flat layer's number of depth steps toward the eye of the terrain, as the
 *   rail's far cells and the town's streets are. A step is z * z / (0.05 * 2^24) m at a distance z, so at 600 m the road wins the depth test over terrain
 *   up to about 50 m nearer the eye than it: the road is the surface there, and a crest between it and the eye hides it only by more than that.
 * - **Counts.** `highwayStats()` gives what stands: cells, vertices, triangles and the bytes the GPU holds for them.
 */
import { leanMesh } from "./leanMesh.js";
import { SURFACE_PACKED_BYTES, packSurface } from "./surfacePack.js";
import { addToScene, disposeMeshGpu, removeFromScene, setMeshVisible, type Mesh } from "@babylonjs/lite";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import type { RenderHost } from "@csarkosh/engine/game/lite/renderGame";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { HIGHWAY_CELL, cellInStrip, highwayCellSlices, highwayWorld, type HighwayLod } from "./highwayCells.js";
import type { RailDraw } from "./railParts.js";
import type { MeshArrays } from "./meshBuilder.js";
import { createPackedMesh, packedBytes } from "./vertexPack.js";

/** Cells within this distance of the camera are built, and are let go beyond `RELEASE_REACH`, metres: the full tiers' and the low tier's. */
export const BUILD_REACH = 600;
export const RELEASE_REACH = 720;
export const LOW_BUILD_REACH = 300;
export const LOW_RELEASE_REACH = 380;
/** The distance inside which a cell is the near one, metres, and the room a cell keeps its level in. */
export const NEAR_REACH = 200;
export const LOW_NEAR_REACH = 100;
export const HYSTERESIS = 40;
/** The most cell jobs begun at once. */
export const MAX_PENDING = 3;

export type HighwayStats = { cells: number; vertices: number; triangles: number; bytes: number; pending: number; byLod: [number, number] };

type Cell = { k: number; lod: HighwayLod; mesh: Mesh | null; x: number; y: number; z: number; radius: number; shown: boolean; lean: boolean; vertices: number; triangles: number; bytes: number; built: boolean; owner: object | null; want: HighwayLod; cx: number; cz: number };

export type HighwayStream = {
  /** Each frame, with the view's planes: streams the cells by the camera's place and shows those in view. */
  seen(planes: readonly ViewFrustumPlane[]): void;
  stats(): HighwayStats;
  dispose(): void;
};

/** The level a cell at distance `d` wants, with `held` its present level giving it room. */
export function highwayLodFor(d: number, held: HighwayLod | null, near: number = NEAR_REACH): HighwayLod {
  return d < near + (held === 0 ? HYSTERESIS : 0) ? 0 : 1;
}

/** The bytes a cell's arrays take on the GPU: positions, UVs, the packed normals and colours, the packed surface records (`SURFACE_PACKED_BYTES` a vertex) and the indices (`vertexPack.ts`). */
export function gpuBytes(a: MeshArrays): number {
  const vertices = a.positions.length / 3;
  return packedBytes(vertices, a.indices.length, vertices * SURFACE_PACKED_BYTES);
}

function boundsOf(positions: Float32Array): { x: number; y: number; z: number; radius: number } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] as number;
    const y = positions[i + 1] as number;
    const z = positions[i + 2] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, radius: Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)) / 2 };
}

export function createHighwayStream(host: RenderHost, draw: RailDraw, seed: number, low: boolean): HighwayStream {
  const world = highwayWorld(seed);
  const build = low ? LOW_BUILD_REACH : BUILD_REACH;
  const release = low ? LOW_RELEASE_REACH : RELEASE_REACH;
  const near = low ? LOW_NEAR_REACH : NEAR_REACH;
  const cells = new Map<number, Cell>();
  let disposed = false;

  const drop = (cell: Cell): void => {
    if (cell.owner !== null) host.jobs.cancel(cell.owner);
    cell.owner = null;
    if (cell.mesh !== null) {
      removeFromScene(draw.scene, cell.mesh);
      disposeMeshGpu(cell.mesh);
      host.uploads.dropped();
      cell.mesh = null;
    }
  };

  function* job(cell: Cell, lod: HighwayLod): Slices {
    const arrays = yield* highwayCellSlices(world, cell.k, lod);
    if (disposed || cells.get(cell.k) !== cell) return;
    let made: Mesh | null = null;
    let bounds = { x: 0, y: 0, z: 0, radius: 0 };
    if (arrays !== null) {
      const bytes = packedBytes(arrays.positions.length / 3, arrays.indices.length, arrays.surface.byteLength);
      yield* host.uploads.hold(bytes);
      if (disposed || cells.get(cell.k) !== cell) return;
      const mesh = createPackedMesh(draw.engine, `highway_${cell.k}_${lod}`, arrays);
      if (draw.textured) mesh.pluginVertexData = packSurface(arrays.surface);
      mesh.material = draw.materials.flat;
      mesh.renderOrder = draw.orders.flat;
      addToScene(draw.scene, mesh);
      host.uploads.stream("geometry", bytes, 4);
      host.uploads.made();
      made = mesh;
      bounds = boundsOf(arrays.positions);
    }
    // The new level replaces the old in the same frame.
    if (cell.mesh !== null) {
      removeFromScene(draw.scene, cell.mesh);
      disposeMeshGpu(cell.mesh);
      host.uploads.dropped();
    }
    cell.mesh = made;
    Object.assign(cell, bounds, { shown: true, lean: false, built: true, lod, owner: null, vertices: arrays === null ? 0 : arrays.positions.length / 3, triangles: arrays === null ? 0 : arrays.indices.length / 3, bytes: arrays === null ? 0 : gpuBytes(arrays) });
  }

  function stream(cx: number, cz: number): void {
    const k0 = Math.floor((cz - release) / HIGHWAY_CELL);
    const k1 = Math.floor((cz + release) / HIGHWAY_CELL);
    const wanted: Cell[] = [];
    for (let k = k0; k <= k1; k++) {
      if (cellInStrip(world, k)) continue;
      let cell = cells.get(k);
      const zc = (k + 0.5) * HIGHWAY_CELL;
      const xc = cell?.cx ?? world.ground.roadX(zc);
      const d = Math.sqrt((xc - cx) * (xc - cx) + (zc - cz) * (zc - cz));
      if (cell === undefined) {
        if (d > build) continue;
        cell = { k, lod: 1, mesh: null, x: 0, y: 0, z: 0, radius: 0, shown: true, lean: false, vertices: 0, triangles: 0, bytes: 0, built: false, owner: null, want: highwayLodFor(d, null, near), cx: xc, cz: zc };
        cells.set(k, cell);
        wanted.push(cell);
        continue;
      }
      if (d > release) {
        drop(cell);
        cells.delete(k);
        continue;
      }
      cell.want = highwayLodFor(d, cell.built ? cell.lod : null, near);
      if (cell.owner === null && (!cell.built || cell.want !== cell.lod)) wanted.push(cell);
    }
    // Cells let go that the loop's range no longer reaches (the camera moved a long way at once).
    for (const [k, cell] of cells) {
      if (k < k0 || k > k1) {
        drop(cell);
        cells.delete(k);
      }
    }
    wanted.sort((a, b) => (a.cx - cx) * (a.cx - cx) + (a.cz - cz) * (a.cz - cz) - ((b.cx - cx) * (b.cx - cx) + (b.cz - cz) * (b.cz - cz)) || a.k - b.k);
    let pending = 0;
    for (const c of cells.values()) if (c.owner !== null) pending++;
    for (const cell of wanted) {
      if (pending >= MAX_PENDING) break;
      const owner = {};
      cell.owner = owner;
      host.jobs.begin(owner, job(cell, cell.want), false, "highway");
      pending++;
    }
  }

  const inView = (planes: readonly ViewFrustumPlane[], c: Cell): boolean => {
    for (const plane of planes) if (plane.normal.x * c.x + plane.normal.y * c.y + plane.normal.z * c.z + plane.d <= -c.radius) return false;
    return true;
  };

  const api: HighwayStream = {
    seen(planes) {
      if (disposed) return;
      stream(host.pose.x, host.pose.z);
      for (const cell of cells.values()) {
        if (cell.mesh === null) continue;
        // Its arrays are let go once the GPU has them (`leanMesh.ts`).
        if (!cell.lean) cell.lean = leanMesh(cell.mesh);
        const want = inView(planes, cell);
        if (want !== cell.shown) {
          cell.shown = want;
          setMeshVisible(cell.mesh, want);
        }
      }
    },
    stats() {
      const s: HighwayStats = { cells: 0, vertices: 0, triangles: 0, bytes: 0, pending: 0, byLod: [0, 0] };
      for (const c of cells.values()) {
        if (c.mesh !== null) {
          s.cells++;
          s.vertices += c.vertices;
          s.triangles += c.triangles;
          s.bytes += c.bytes;
          s.byLod[c.lod]++;
        }
        if (c.owner !== null) s.pending++;
      }
      return s;
    },
    dispose() {
      disposed = true;
      for (const c of cells.values()) drop(c);
      cells.clear();
    },
  };
  // What stands of the highway, for the page's console and a look at the counts in development.
  (globalThis as { __capeHighway?: HighwayStream }).__capeHighway = api;
  return api;
}
