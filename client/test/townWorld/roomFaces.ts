/**
 * The faces of a designed room that the depth buffer cannot tell apart, by the town's own finder (`nearPlanes.ts`, the rules in `depthSeparation.test.ts`'s header): two faces that look the same way, overlap, and lie nearer
 * than `ROOM_GAP` from one plane, joined into patches of 25 cm^2 or more, and not alike (`alike`: the same stuff laid the same).
 *
 * How near is too near. The depth buffer is 24 bits with the near plane at 0.05 m: a step of depth is z * z / (0.05 * 2^24) metres at a distance z, finest close to the camera and coarsest at the farthest sight line, which
 * in a room is its own length: 25 m across the hall's gallery to the far corner, 0.75 mm a step. So 0.4 m from a wall, where a hull can stand, the step is 0.2 micrometres, and the nearest viewing distance is the
 * easiest, not the hardest, case. A face is held 2 cm (the town's rule, 26 steps at 25 m) from another that looks the same way and overlaps it, which is far more than any room needs of the buffer and keeps the room safe
 * from the float error of its place too (a vertex 400 m from the origin is exact to 3 cm / 1000). A back a builder lays for a face (`MeshBuilder(true)`) looks the other way and is a pair with whatever looks that way where it lies.
 *
 * The room's three meshes are looked at together: its own, the layer of through glass and the street outside.
 */
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { insideGeometry } from "../../src/game/town/insideGeometry.js";
import { insideRooms } from "../../src/sim/inside/rooms.js";
import { alike, nearPairs, patchesOf, trianglesOf, type NearPair, type Patch, type Tri } from "./nearPlanes.js";
import { groundOf } from "./roomMeshes.js";

export const ROOM_GAP = 0.003;
export const ROOM_AREA = 0.0025;

export type RoomPatch = { readonly patch: Patch; readonly where: string };

/** Where a face came from: the first frame of its trace that is not the kit's own plumbing, and the item or part that asked for it. */
function source(t: Tri): string {
  const frames = (t.tag ?? "?").split(" < ").filter((x) => !x.includes("at "));
  const first = frames.find((x) => !/kit\.ts|^Geo\.|^Local\./.test(x)) ?? frames[frames.length - 1] ?? "?";
  const at = frames.findIndex((x) => /designGeometry\.ts:1(1[0-9]|2[0-9])/.test(x) && !/part /.test(x));
  const item = at > 0 ? (frames[at - 1] as string) : "";
  return item === "" || item === first ? first : `${first} [${item}]`;
}

/** The patches of one room that break the rule, with where each came from (the builders' trace names the code that made a face). */
export function roomPatches(seed: number, index: number, trace = true): RoomPatch[] {
  const was = MeshBuilder.trace;
  MeshBuilder.trace = trace;
  try {
    const room = insideRooms(seed)[index];
    if (room === undefined) throw new Error(`no room ${index}`);
    const a = insideGeometry(groundOf(seed), room, "full", undefined, true);
    const tris: Tri[] = [];
    trianglesOf(a, "room", tris, MeshBuilder.traced.get(a) ?? []);
    if (a.through !== undefined && a.through !== null) trianglesOf(a.through, "glass", tris, MeshBuilder.traced.get(a.through) ?? []);
    if (a.outside !== undefined && a.outside !== null) trianglesOf(a.outside, "outside", tris, MeshBuilder.traced.get(a.outside) ?? []);
    const pairs = nearPairs(tris, ROOM_GAP, 1e-6).filter((q: NearPair) => !alike(q.a, q.b, q.area));
    return patchesOf(pairs, tris)
      .filter((p) => p.area >= ROOM_AREA)
      .map((patch) => ({ patch, where: `${source(patch.a)}  ~  ${source(patch.b)}` }));
  } finally {
    MeshBuilder.trace = was;
  }
}

const STRUCTURE = /slabs |outerWall|shell designGeometry|wall designGeometry|stair designGeometry|rail designGeometry|frontWall|roomShell|windows designGeometry/;

/** What kind of fault a patch is, for a report: the structure against itself, an item laid against the structure, one item's own layers, two items, or the outside street / the through glass. */
export function kindOf(p: Patch): string {
  if (p.a.layer === "outside" || p.b.layer === "outside") return "outside street";
  if (p.a.layer === "glass" || p.b.layer === "glass") return "through glass";
  const sa = STRUCTURE.test(p.a.tag ?? "");
  const sb = STRUCTURE.test(p.b.tag ?? "");
  if (sa && sb) return "structure on structure (walls, slabs, stairs, shell)";
  if (sa || sb) return "item or decal on the structure";
  const name = (t: Tri): string => {
    const frames = (t.tag ?? "?").split(" < ").filter((x) => !x.includes("at "));
    const at = frames.findIndex((x) => /designGeometry\.ts:1[0-9][0-9]/.test(x) && !/part /.test(x));
    return at > 0 ? (frames[at - 1] as string).split(" ")[0] as string : "?";
  };
  return name(p.a) === name(p.b) ? "one item's own layers" : "two items against each other";
}
