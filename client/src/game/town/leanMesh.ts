/**
 * Lets go of a mesh's arrays once they are on the GPU. Lite keeps what a mesh was made from (`_cpuPositions`, `_cpuNormals`, `_cpuUvs`,
 * `_cpuColors`, `_cpuIndices`) and the plugin's per-vertex data (`pluginVertexData`) for as long as the mesh lives: for the town that is
 * every vertex twice, once in the tab's memory and once on the GPU, 96 bytes each. Nothing of the game reads them back (it picks nothing,
 * cuts nothing and recovers no lost device: a lost device is a session made again from its seed), so once the GPU has them they are dropped.
 *
 * The mesh's own buffers are written when it is made (`createMeshFromData`). The plugin's is written by the first frame that draws the
 * material's list, shown or hidden (`pbr-renderable`, `syncPluginVertexData`), so a mesh that carries plugin data is lean only once that
 * buffer is there: `leanMesh` says whether it was, and is asked again each frame until it is.
 */
import type { Mesh } from "@babylonjs/lite";

type Held = {
  _cpuPositions?: unknown; _cpuNormals?: unknown; _cpuUvs?: unknown; _cpuUv2s?: unknown; _cpuTangents?: unknown; _cpuColors?: unknown; _cpuIndices?: unknown;
  pluginVertexData?: Float32Array | undefined;
  pluginVertexVersion?: number;
  _gpu?: { _pluginVertexBuffer?: unknown; _pluginVertexVersion?: number } | null;
};

/** Drops the arrays of `mesh` that the GPU already has. True once nothing is left to drop. */
export function leanMesh(mesh: Mesh): boolean {
  const m = mesh as unknown as Held;
  if (m._cpuPositions !== null && m._cpuPositions !== undefined) {
    m._cpuPositions = null;
    m._cpuNormals = null;
    m._cpuUvs = null;
    m._cpuUv2s = null;
    m._cpuTangents = null;
    m._cpuColors = null;
    m._cpuIndices = null;
  }
  if (m.pluginVertexData === undefined) return true;
  // The plugin's buffer is made and written by the first frame that reaches the mesh: until its version is the data's, the data is still needed.
  const gpu = m._gpu;
  if (gpu === null || gpu === undefined || gpu._pluginVertexBuffer === undefined || gpu._pluginVertexBuffer === null || gpu._pluginVertexVersion !== (m.pluginVertexVersion ?? 0)) return false;
  m.pluginVertexData = undefined;
  return true;
}

/** The meshes still holding arrays: each frame `step` drops what the GPU has taken since, and forgets the meshes that are lean. */
export function createLeaner(): { add(mesh: Mesh): void; remove(mesh: Mesh): void; step(): void; waiting(): number; clear(): void } {
  let fat: Mesh[] = [];
  return {
    add: (mesh) => void fat.push(mesh),
    remove: (mesh) => void (fat = fat.filter((m) => m !== mesh)),
    step() {
      if (fat.length === 0) return;
      fat = fat.filter((mesh) => !leanMesh(mesh));
    },
    waiting: () => fat.length,
    clear: () => void (fat = []),
  };
}
