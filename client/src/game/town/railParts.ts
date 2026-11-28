/**
 * The railroad's main line and the power line, streamed by the camera's place: the line runs the whole coast, so the whole
 * coast is never built. Cells of `RAIL_CELL` m along z (`railGeometry.ts`, pure from the seed and the index) are made over
 * frames as jobs of the engine's scheduler (`host.jobs`, one owner and so one job a cell) when the camera comes within
 * `BUILD_REACH` of them, at a level of detail by distance, and let go (meshes removed and their GPU memory freed) when it
 * leaves past `RELEASE_REACH`.
 *
 * - **Reach.** The fog is 4000 m in clear weather, so a cell is built from 4300 m (nothing is seen to appear: what is
 *   built at the fog's edge is a ballast strip and poles) and let go past 4700 m.
 * - **Levels.** Within `NEAR_REACH` the full cell (ties, rail heads, wires), within `MID_REACH` the plain one, beyond that the
 *   far one. A cell changes level at a distance with `HYSTERESIS` of room, so a camera standing at an edge does not rebuild;
 *   the new level's meshes replace the old ones the frame they are made.
 * - **What the engine gave.** The scheduler (`jobs.begin`: a job per owner, spread over frames in slices), the streamed
 *   upload budget (`uploads.hold`/`stream`), the air, wetness and depth-step plugins and draw order of the town's own
 *   materials. What is done here: the cells, which of them to want, their culling by the view's planes (Lite culls none), and
 *   their release.
 * - **Counts.** `railStats()` gives what stands: cells, meshes, vertices and triangles.
 */
import { leanMesh } from "./leanMesh.js";
import { packSurface } from "./surfacePack.js";
import { addToScene, disposeMeshGpu, removeFromScene, setMeshVisible, type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext } from "@babylonjs/lite";
import type { ViewFrustumPlane } from "@csarkosh/engine/game/lite/cameraPose";
import type { RenderHost } from "@csarkosh/engine/game/lite/renderGame";
import type { Slices } from "@csarkosh/engine/game/syncJobs";
import { RAIL_CELL, railCell, type RailCellArrays, type RailLod, type RailWorld } from "./railGeometry.js";
import { railWorld } from "./railWorld.js";
import { createPackedMesh, packedBytes } from "./vertexPack.js";

/** Cells within this distance of the camera are built, and are let go beyond `RELEASE_REACH`, metres. */
export const BUILD_REACH = 4300;
export const RELEASE_REACH = 4700;
/** The distances inside which a cell is the full one and the plain one, metres. */
export const NEAR_REACH = 260;
export const MID_REACH = 1300;
/** A cell keeps its level until the camera is this much past the boundary. */
export const HYSTERESIS = 60;
/** The most cell jobs begun at once. */
export const MAX_PENDING = 4;

/** What stands of the railroad. */
export type RailStats = { cells: number; meshes: number; vertices: number; triangles: number; pending: number; byLod: [number, number, number] };

type Piece = { mesh: Mesh; x: number; y: number; z: number; radius: number; shown: boolean; lean: boolean };
type Cell = { k: number; lod: RailLod; pieces: Piece[]; building: Piece[]; vertices: number; triangles: number; owner: object | null; want: RailLod; x: number; z: number };

export type RailStream = {
  /** Each frame, with the view's planes: streams the cells by the camera's place and shows those in view. */
  seen(planes: readonly ViewFrustumPlane[]): void;
  stats(): RailStats;
  dispose(): void;
};

/** What the stream draws with: the town's materials, already wearing the air and the wet look. */
export type RailDraw = {
  engine: EngineContext;
  scene: SceneContext;
  materials: { flat: PbrMaterialProps; solid: PbrMaterialProps };
  orders: { flat: number; solid: number };
  /** The materials read the town's texture layers: the meshes carry their surface data. */
  textured: boolean;
};

/** The level a cell at distance `d` wants, with `held` its present level giving it room. */
export function lodFor(d: number, held: RailLod | null): RailLod {
  if (d < NEAR_REACH + (held === 0 ? HYSTERESIS : 0)) return 0;
  if (d < MID_REACH + (held === 1 ? HYSTERESIS : 0)) return 1;
  return 2;
}

/** The bounding sphere of a mesh's positions: the middle of its box and half the box's diagonal. */
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

export function createRailStream(host: RenderHost, draw: RailDraw, seed: number): RailStream {
  const world: RailWorld = railWorld(seed);
  const cells = new Map<number, Cell>();
  let disposed = false;

  const inView = (planes: readonly ViewFrustumPlane[], p: Piece): boolean => {
    for (const plane of planes) if (plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z + plane.d <= -p.radius) return false;
    return true;
  };

  function release(cell: Cell): void {
    if (cell.owner !== null) host.jobs.cancel(cell.owner);
    for (const p of [...cell.pieces, ...cell.building]) {
      removeFromScene(draw.scene, p.mesh);
      disposeMeshGpu(p.mesh);
      host.uploads.dropped();
    }
    cell.pieces = [];
    cell.building = [];
  }

  function* job(cell: Cell, lod: RailLod): Slices {
    const arrays: RailCellArrays = yield* railCell(world, cell.k, lod);
    if (disposed || cells.get(cell.k) !== cell) return;
    const pieces = cell.building;
    pieces.length = 0;
    let vertices = 0;
    let triangles = 0;
    for (const layer of ["flat", "solid"] as const) {
      const a = arrays[layer];
      if (a === null) continue;
      const bytes = packedBytes(a.positions.length / 3, a.indices.length, a.surface.byteLength);
      yield* host.uploads.hold(bytes);
      if (disposed || cells.get(cell.k) !== cell) return;
      const mesh = createPackedMesh(draw.engine, `rail_${layer}_${cell.k}_${lod}`, a);
      if (draw.textured) mesh.pluginVertexData = packSurface(a.surface);
      mesh.material = draw.materials[layer];
      mesh.renderOrder = draw.orders[layer];
      addToScene(draw.scene, mesh);
      host.uploads.stream("geometry", bytes, 4);
      host.uploads.made();
      pieces.push({ mesh, ...boundsOf(a.positions), shown: true, lean: false });
      vertices += a.positions.length / 3;
      triangles += a.indices.length / 3;
      yield;
    }
    // The new level replaces the old in the same frame.
    for (const p of cell.pieces) {
      removeFromScene(draw.scene, p.mesh);
      disposeMeshGpu(p.mesh);
      host.uploads.dropped();
    }
    cell.pieces = [...pieces];
    cell.building = [];
    cell.lod = lod;
    cell.vertices = vertices;
    cell.triangles = triangles;
    cell.owner = null;
  }

  function pendingCount(): number {
    let n = 0;
    for (const c of cells.values()) if (c.owner !== null) n++;
    return n;
  }

  function stream(cx: number, cz: number, limit: number): void {
    const k0 = Math.floor((cz - RELEASE_REACH) / RAIL_CELL);
    const k1 = Math.floor((cz + RELEASE_REACH) / RAIL_CELL);
    const wanted: Cell[] = [];
    for (let k = k0; k <= k1; k++) {
      let cell = cells.get(k);
      const zc = (k + 0.5) * RAIL_CELL;
      const xc = cell?.x ?? world.centreX(zc);
      const d = Math.sqrt((xc - cx) * (xc - cx) + (zc - cz) * (zc - cz));
      if (cell === undefined) {
        if (d > BUILD_REACH) continue;
        cell = { k, lod: 2, pieces: [], building: [], vertices: 0, triangles: 0, owner: null, want: lodFor(d, null), x: xc, z: zc };
        cells.set(k, cell);
        wanted.push(cell);
        continue;
      }
      if (d > RELEASE_REACH) {
        release(cell);
        cells.delete(k);
        continue;
      }
      cell.want = lodFor(d, cell.pieces.length > 0 ? cell.lod : null);
      if (cell.owner === null && (cell.pieces.length === 0 || cell.want !== cell.lod)) wanted.push(cell);
    }
    // Nearest first.
    wanted.sort((a, b) => (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz) - ((b.x - cx) * (b.x - cx) + (b.z - cz) * (b.z - cz)) || a.k - b.k);
    let pending = pendingCount();
    for (const cell of wanted) {
      if (pending >= limit) break;
      const owner = {};
      cell.owner = owner;
      host.jobs.begin(owner, job(cell, cell.want), false, "rail");
      pending++;
    }
  }

  const api: RailStream = {
    seen(planes) {
      if (disposed) return;
      stream(host.pose.x, host.pose.z, MAX_PENDING);
      for (const cell of cells.values()) {
        for (const p of cell.pieces) {
          // Its arrays are let go once the GPU has them (`leanMesh.ts`).
          if (!p.lean) p.lean = leanMesh(p.mesh);
          const want = inView(planes, p);
          if (want !== p.shown) {
            p.shown = want;
            setMeshVisible(p.mesh, want);
          }
        }
      }
    },
    stats() {
      const s: RailStats = { cells: 0, meshes: 0, vertices: 0, triangles: 0, pending: 0, byLod: [0, 0, 0] };
      for (const c of cells.values()) {
        if (c.pieces.length > 0) {
          s.cells++;
          s.meshes += c.pieces.length;
          s.vertices += c.vertices;
          s.triangles += c.triangles;
          s.byLod[c.lod]++;
        }
        if (c.owner !== null) s.pending++;
      }
      return s;
    },
    dispose() {
      disposed = true;
      for (const c of cells.values()) release(c);
      cells.clear();
    },
  };
  // What stands of the line, for the page's console and a look at the counts in development.
  (globalThis as { __capeRail?: RailStream }).__capeRail = api;
  return api;
}
