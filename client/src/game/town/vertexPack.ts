/**
 * A town vertex's normal and colour as the GPU holds them, and a batch's indices at the width its vertex count allows. A vertex was 64 bytes
 * (position 12, normal 12, uv 8, colour 16, and the 16 of `surfacePack.ts`); with the normal in 8 bytes and the colour in 8 it is 52 (48 with the
 * normal in 4), and a batch of fewer than 65,536 vertices (171 of the town's 179) takes 2 bytes an index where it took 4.
 *
 * - The normal is `NORMAL_FORMAT`: `snorm8x4` (x, y, z, 0 times 127: a unit normal is turned by at most 0.39 degrees) or `snorm16x4` (times 32767:
 *   0.0015 degrees). The town's normals are unit, and the shader renormalises what it reads. It is `snorm16x4`: at 8 bits the low tier's picture of
 *   wet ground at the quay moved by 0.4 of a level on average (a level is 1/255), where at 16 bits no view moved more than the unchanged build does
 *   between two runs.
 * - The colour is `float16x4`, not 8 bits: it is a tint that runs to 1.571, and its alpha carries codes (0.02, 0.05, sixteenths) that 8 bits would
 *   move. A 16-bit float is within 0.0005 of any value the town writes.
 * - A mesh made this way is never written in place or resized (the renderer says so if asked), which no town mesh is.
 *
 * `createPackedMesh` is the one call the town's parts make in place of `createMeshFromData`.
 */
import { createMeshFromData, type EngineContext, type Mesh, type MeshVertexFormats } from "@babylonjs/lite";
import { toHalf } from "./surfacePack.js";

/** The format the normals are held in: change it here and the sizes below follow. */
export const NORMAL_FORMAT = "snorm16x4" as "snorm8x4" | "snorm16x4";
/** The format the colours are held in. */
export const COLOR_FORMAT = "float16x4";
/** Bytes a vertex's normal and colour take. */
export const NORMAL_BYTES = NORMAL_FORMAT === "snorm8x4" ? 4 : 8;
export const COLOR_BYTES = 8;
/** A batch with fewer vertices than this has 16-bit indices. */
export const INDEX16_BELOW = 65536;

const NORMAL_SCALE = NORMAL_FORMAT === "snorm8x4" ? 127 : 32767;

/** The bytes an index takes in a batch of `vertices` vertices. */
export function indexBytes(vertices: number): 2 | 4 {
  return vertices < INDEX16_BELOW ? 2 : 4;
}

/** What `packVertices` makes: the arrays and the formats `createMeshFromData` takes them with. */
export type Packed = {
  readonly normals: Int8Array | Int16Array;
  readonly colors: Uint16Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly formats: MeshVertexFormats;
};

/** A batch's normals (three floats a vertex) as four snorm values a vertex, with the fourth 0. */
export function packNormals(normals: Float32Array): Int8Array | Int16Array {
  const n = normals.length / 3;
  const out = NORMAL_FORMAT === "snorm8x4" ? new Int8Array(n * 4) : new Int16Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = Math.round((normals[i * 3 + k] as number) * NORMAL_SCALE);
      out[i * 4 + k] = v > NORMAL_SCALE ? NORMAL_SCALE : v < -NORMAL_SCALE ? -NORMAL_SCALE : v;
    }
  }
  return out;
}

/** A batch's colours (four floats a vertex) as the bits of 16-bit floats. */
export function packColors(colors: Float32Array): Uint16Array {
  const out = new Uint16Array(colors.length);
  for (let i = 0; i < colors.length; i++) out[i] = toHalf(colors[i] as number);
  return out;
}

/** The normals and colours of a batch of `vertices` vertices in their smaller formats, and its indices at the width the count allows. */
export function packVertices(vertices: number, normals: Float32Array, colors: Float32Array, indices: Uint32Array): Packed {
  return {
    normals: packNormals(normals),
    colors: packColors(colors),
    indices: indexBytes(vertices) === 2 ? Uint16Array.from(indices) : indices,
    formats: { normalFormat: NORMAL_FORMAT, colorFormat: COLOR_FORMAT },
  };
}

/** The bytes a batch's arrays take on the GPU once packed (what `host.uploads` counts): the position and uv as they are, `surfaceBytes` of surface records. */
export function packedBytes(vertices: number, indexCount: number, surfaceBytes: number): number {
  return vertices * (12 + 8 + NORMAL_BYTES + COLOR_BYTES) + surfaceBytes + indexCount * indexBytes(vertices);
}

/** A mesh made as `createMeshFromData` makes one, with its normals and colours packed and its indices at the narrowest width. The 32-bit arrays are not kept. */
export function createPackedMesh(
  engine: EngineContext, name: string,
  a: { readonly positions: Float32Array; readonly normals: Float32Array; readonly indices: Uint32Array; readonly uvs: Float32Array | undefined; readonly colors: Float32Array },
): Mesh {
  const p = packVertices(a.positions.length / 3, a.normals, a.colors, a.indices);
  return createMeshFromData(engine, name, a.positions, p.normals, p.indices, a.uvs, undefined, undefined, p.colors, p.formats);
}
