/**
 * The arms' files as the tests read them: the binary glTF's parts (their positions as the game's loader stands them, x mirrored, and their triangles), and stand-in `ArmPart`s
 * made of them with plain objects for meshes, so that the hand's and the watch's parts can be run without an engine.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ArmPart } from "../../src/game/hand/handModels.js";

export type FilePart = { name: string; positions: Float32Array; indices: Uint32Array };
export type StubMesh = {
  name: string;
  position: { set(x: number, y: number, z: number): void };
  scaling: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  rotationQuaternion: { x: number; y: number; z: number; w: number };
  visible: boolean;
};

type Json = {
  nodes: { name: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
};

export function readFileParts(file: "hand.right" | "hand.left"): FilePart[] {
  const raw = readFileSync(fileURLToPath(new URL(`../../assets/models/${file}.glb`, import.meta.url)));
  const jsonSize = raw.readUInt32LE(12);
  const json = JSON.parse(raw.toString("utf8", 20, 20 + jsonSize)) as Json;
  const bin = raw.subarray(20 + jsonSize + 8);
  const read = (index: number, width: number, as: "f" | "u"): Float32Array | Uint32Array => {
    const a = json.accessors[index] as Json["accessors"][number];
    const v = json.bufferViews[a.bufferView] as Json["bufferViews"][number];
    const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * width;
    if (as === "f") return Float32Array.from(new Float32Array(bin.buffer.slice(bin.byteOffset + at, bin.byteOffset + at + n * 4)));
    const size = a.componentType === 5125 ? 4 : 2;
    const view = new DataView(bin.buffer, bin.byteOffset + at, n * size);
    return Uint32Array.from({ length: n }, (_, i) => (size === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true)));
  };
  const out: FilePart[] = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const prim = (json.meshes[node.mesh] as Json["meshes"][number]).primitives[0] as Json["meshes"][number]["primitives"][number];
    const positions = read(prim.attributes.POSITION, 3, "f") as Float32Array;
    // The loader mirrors x on the model's root.
    for (let i = 0; i < positions.length; i += 3) positions[i] = -(positions[i] as number);
    out.push({ name: node.name, positions, indices: read(prim.indices, 1, "u") as Uint32Array });
  }
  return out;
}

/** Stand-in parts of a file, each with a stub mesh (and the sizes of its real part). */
export function stubParts(file: "hand.right" | "hand.left"): ArmPart[] {
  return readFileParts(file).map((p) => ({
    name: p.name,
    mesh: {
      name: p.name, position: { set: () => undefined }, rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 }, visible: false,
      scaling: { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    } satisfies StubMesh as never,
    triangles: p.indices.length / 3,
    vertices: p.positions.length / 3,
    bytes: p.positions.byteLength + p.indices.byteLength,
  }));
}
