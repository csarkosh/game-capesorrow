/**
 * Every face of the whole town as the finder reads it (`nearPlanes.ts`): the town as the game builds it (`townGeometry`), each batch's
 * triangles tagged with its layer and, from the builders' trace, with where in the code each polygon was made. The batches are by cell
 * of 128 m, and the faces of all the cells are one list, so two things in different cells are compared too.
 */
import "../../src/terrain.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import type { Detail } from "../../src/game/town/townTypes.js";
import { townStart } from "../../src/sim/town/start.js";
import { alike, nearPairs, patchesOf, trianglesOf, type NearPair, type Patch, type Tri } from "./nearPlanes.js";

export type TownFaces = { readonly tris: Tri[]; readonly seed: number; readonly detail: Detail; readonly vertices: number; readonly triangles: number };

export function townFaces(seed: number, detail: Detail, trace = true): TownFaces {
  const was = MeshBuilder.trace;
  MeshBuilder.trace = trace;
  try {
    const g = townGround(seed);
    const run = townGeometry(g, detail, townStart(seed));
    let r = run.next();
    while (r.done !== true) r = run.next();
    const tris: Tri[] = [];
    let vertices = 0;
    let triangles = 0;
    for (const b of r.value) {
      const tags = MeshBuilder.traced.get(b.arrays) ?? [];
      const before = tris.length;
      // A room's haze is not a face: it is the room's air, drawn as see-through sheets across the room (`roomHaze.ts`), each taking a sixth or
      // less of what is behind it. A sheet stands near in plane to whatever stands in the room at its depth, and which side of that face it
      // falls on changes the face's colour by the sheet's share, where the buffer cannot tell them apart: from across a street, not seen.
      if (b.layer !== "haze") trianglesOf(b.arrays, b.layer, tris, tags);
      void before;
      vertices += b.arrays.positions.length / 3;
      triangles += b.arrays.indices.length / 3;
    }
    return { tris, seed, detail, vertices, triangles };
  } finally {
    MeshBuilder.trace = was;
  }
}

/** The rules a pair of faces is held to (see `depthSeparation.test.ts`): the least gap, in metres, between faces that look the same way, and the least overlap that counts, in m^2. */
export const RULE = {
  /** Four depth steps at 60 m (the step is z * z / (0.05 * 2^24) at a distance z). */
  gap: 0.0199,
  /** For faces more than `tallFrom` m over the ground (or the sea): more than one step at 145 m, two at 100 m. */
  tallGap: 0.0245,
  tallFrom: 4,
  /** A patch of 5 cm by 5 cm, which a person sees from the sidewalk as a flickering spot. */
  area: 0.0025,
} as const;

export type Found = { readonly patch: Patch; readonly tall: boolean };

/** The patches of the town's faces that break the rules: the pairs of faces that look the same way, overlap, and are too near one another, joined into patches of 25 cm^2 or more. Flat ground against flat ground is counted apart (`flat`). */
export function unsafePatches(f: TownFaces, groundAt: (x: number, z: number) => number, sea: number): { readonly found: Found[]; readonly flat: number } {
  const high = (at: readonly [number, number, number]): boolean => at[1] - Math.max(groundAt(at[0], at[2]), sea) >= RULE.tallFrom;
  const limit = (q: NearPair): number => (q.a.layer === "flat" && q.b.layer === "flat" ? RULE.gap : high(q.at) ? RULE.tallGap : RULE.gap);
  const pairs = nearPairs(f.tris, RULE.tallGap, 1e-6).filter((q) => q.gap < limit(q) && !alike(q.a, q.b, q.area));
  /** Two flat faces of different ranks are held apart by the rank (a fixed number of depth steps a rank), not by their distance: not a pair. */
  const ground = (q: NearPair): boolean => q.a.layer === "flat" && q.b.layer === "flat";
  const ranked = (q: NearPair): boolean => ground(q) && q.a.rank !== q.b.rank;
  const found = patchesOf(pairs.filter((q) => !ground(q)), f.tris)
    .filter((p) => p.area >= RULE.area)
    .map((patch) => ({ patch, tall: high(patch.at) }));
  const flat = patchesOf(pairs.filter((q) => ground(q) && !ranked(q)), f.tris).filter((p) => p.area >= RULE.area).length;
  return { found, flat };
}

/** Where a patch came from, for a failure message: its two faces' layers and the code that made them. */
export function describe(p: Patch, seed: number, detail: string): string {
  // What each face looks like: its layer, colour, tint and wear, and its first corner's UV.
  const look = (t: Tri): string => `[layer ${t.look[0]} colour ${t.look.slice(1, 4).map((x) => x.toFixed(2)).join(" ")} tint ${t.tint.map((x) => x.toFixed(2)).join(" ")} uv ${t.uv[0].toFixed(3)} ${t.uv[1].toFixed(3)}]`;
  const where = (t: Tri): string => (t.tag ?? "(untraced)").split(" < ").filter((x) => !x.includes("at ")).slice(0, 3).join(" < ");
  return `seed ${seed} ${detail} at ${p.at.map((x) => x.toFixed(1)).join(",")}: ${p.a.layer}/${p.b.layer} ${(p.gap * 1000).toFixed(1)} mm apart, ${(p.area * 1e4).toFixed(0)} cm2 overlap\n  A ${where(p.a)} ${look(p.a)}\n  B ${where(p.b)} ${look(p.b)}`;
}
