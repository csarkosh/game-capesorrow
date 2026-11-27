import fs from "node:fs";
import { halfTurnAboutY } from "../../src/game/car/carPose.js";

type Gltf = {
  materials: { name: string }[];
  meshes: { primitives: { material: number; indices: number; attributes: { POSITION: number; NORMAL: number } }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
  bufferViews: { byteOffset?: number }[];
};

export type FilePart = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** The sedan's file as it is read, by role (the material's name after the model's): its own axes. */
export function sedanFile(): Map<string, FilePart> {
  const b = fs.readFileSync(new URL("../../assets/models/vehicle.sedan_a.glb", import.meta.url));
  const jl = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + jl).toString()) as Gltf;
  const bin = b.subarray(20 + jl + 8);
  const at = (i: number): { o: number; count: number; type: number } => {
    const a = gltf.accessors[i] as Gltf["accessors"][number];
    return { o: bin.byteOffset + ((gltf.bufferViews[a.bufferView] as { byteOffset?: number }).byteOffset ?? 0) + (a.byteOffset ?? 0), count: a.count, type: a.componentType };
  };
  const out = new Map<string, FilePart>();
  for (const p of gltf.meshes.flatMap((m) => m.primitives)) {
    const role = (gltf.materials[p.material] as { name: string }).name.replace("vehicle.sedan_a.", "");
    const pos = at(p.attributes.POSITION);
    const nor = at(p.attributes.NORMAL);
    const idx = at(p.indices);
    out.set(role, {
      positions: new Float32Array(bin.buffer.slice(pos.o, pos.o + pos.count * 12)),
      normals: new Float32Array(bin.buffer.slice(nor.o, nor.o + nor.count * 12)),
      indices: idx.type === 5125 ? new Uint32Array(bin.buffer.slice(idx.o, idx.o + idx.count * 4)) : Uint32Array.from(new Uint16Array(bin.buffer.slice(idx.o, idx.o + idx.count * 2))),
    });
  }
  return out;
}

/** What the loader makes of a file's points: the mirror of x on its root (`__root__`, scaling (-1, 1, 1) in Lite's glTF loader). */
export function loaded(a: Float32Array): Float32Array {
  const out = a.slice();
  for (let i = 0; i < out.length; i += 3) out[i] = -(out[i] as number);
  return out;
}

/** The loaded model as the car is drawn from it. */
export function drawnFrom(a: Float32Array): Float32Array {
  return halfTurnAboutY(loaded(a), 3);
}
