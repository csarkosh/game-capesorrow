/**
 * No two faces of the town are left for the depth buffer to tell apart. A storefront flickers as a person walks past it when two faces
 * that look the same way overlap and lie nearly in one plane (a pane drawn twice, a sign over a board, blinds against the glass, a trim
 * board a centimetre off the wall, two boxes that meet with a face in common): the buffer cannot say which is nearer, and the choice
 * changes with the camera.
 *
 * **How close is too close.** The game's depth buffer is 24 bits with the near plane at 0.05 m (`LENS_NEAR`) and the far at 10 km, so a
 * step of depth is z * z / (0.05 * 2^24) metres at a distance z: 0.3 mm at 15 m, 1.1 mm at 30 m, 1.9 mm at 40 m, 4.3 mm at 60 m,
 * 12 mm at 100 m, 27 mm at 150 m. Two faces that overlap are held apart when they are four steps apart at 60 m: 2 cm. Above head height
 * (4 m over the ground or the sea: an upper storey, a roof, a tall sign) a face is seen from farther off, and 2.5 cm is held: more than
 * one step out to 145 m and two to 100 m. So the test fails when two faces that look the same way (their normals within 0.02 of each
 * other) overlap and are less than that apart along their normal, and the overlap, joined over the triangles that make it, is
 * 25 cm^2 or more (a patch of 5 cm by 5 cm is seen from the sidewalk; 10 cm is seen from 100 m).
 *
 * **What is looked at.** The whole town as the game builds it (`townGeometry`: every building and ruin, the props, the signs, the
 * sidewalks, the harbour; all the cells together, so a front against the next building's, a canopy over a neighbour's wall and a
 * prop against a wall are pairs too), in every layer (flat on the ground, standing, the glass, the lettering's sign layer), on three
 * seeds on the full tier and one on the low. Faces that look opposite ways are not a pair: the town's materials cull back faces (none
 * is `doubleSided`), so the back of a thin board is never drawn. Two flat faces of one colour (the same layer and colour to 3 percent,
 * no texture) are not counted either: they cannot be told apart by eye, whichever is drawn.
 *
 * **What is held apart in the ground's own layer.** Flat ground against flat ground (a sidewalk's slabs and the joints, cracks and weeds
 * laid on them, the roadway and its paint) is laid in millimetres of lift over the ground, the layer being drawn a fixed number of
 * depth steps ahead of the terrain (`ahead`, in `townParts.ts`), which is nothing between two flat faces. It is counted here, held to
 * what it is now so that it does not grow, and is the one known flicker left (ARCHITECTURE.md, "How the town is drawn").
 */
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { SEA } from "../../src/game/town/townTypes.js";
import type { Detail } from "../../src/game/town/townTypes.js";
import { alike, nearPairs, trianglesOf, type NearPair, type Tri } from "./nearPlanes.js";
import { RULE, describe as where, townFaces, unsafePatches } from "./townFaces.js";

/**
 * What is left, by seed and tier, held so that it cannot grow. The patches of the standing and see-through layers (and a flat face
 * against one that stands) are what is left of the small things that meet: a fence's corner post against the board of the fence that
 * turns there, the pile and rail posts of a quay against its cap, the tarp on a truck against its roof, a motel's door plates against
 * the window frames of the front they hang on, a blind's overlapping slats. Each is under 3 m^2 (most under 1 m^2) and found at 5 mm to 2.4 cm.
 */
const LEFT: Record<string, number> = { "20261121 full": 51, "1 full": 61, "6 full": 36, "20261121 low": 23 };
/** Flat ground against flat ground: the sidewalks' slabs, joints, cracks and weeds, the roadway's paint and patches. See the header. */
const FLAT_GROUND: Record<string, number> = { "20261121 full": 3126, "1 full": 3549, "6 full": 2594, "20261121 low": 3130 };

function check(seed: number, detail: Detail): { found: number; flat: number; lines: string[] } {
  const g = townGround(seed);
  const quick = unsafePatches(townFaces(seed, detail, false), g.heightAt, SEA);
  if (quick.found.length <= (LEFT[`${seed} ${detail}`] as number)) return { found: quick.found.length, flat: quick.flat, lines: [] };
  // Run it again with the builders' trace on, to say where each came from.
  const traced = unsafePatches(townFaces(seed, detail, true), g.heightAt, SEA);
  return { found: traced.found.length, flat: traced.flat, lines: traced.found.slice(0, 12).map((f) => where(f.patch, seed, detail)) };
}

describe("the finder of faces the depth buffer cannot tell apart", () => {
  const quad = (y: number, x0 = 0, flip = false, colour: [number, number, number] = [1, 1, 1]): { p: number[]; n: number[]; c: [number, number, number] } => ({
    p: [x0, y, 0, x0 + 1, y, 0, x0 + 1, y, 1, x0, y, 1],
    n: flip ? [0, -1, 0] : [0, 1, 0],
    c: colour,
  });
  const mesh = (quads: { p: number[]; n: number[]; c: [number, number, number] }[]): ReturnType<MeshBuilder["finish"]> => {
    const m = new MeshBuilder();
    for (const q of quads) m.poly([[q.p[0]!, q.p[1]!, q.p[2]!], [q.p[3]!, q.p[4]!, q.p[5]!], [q.p[6]!, q.p[7]!, q.p[8]!], [q.p[9]!, q.p[10]!, q.p[11]!]], [q.n[0]!, q.n[1]!, q.n[2]!], q.c);
    return m.finish();
  };
  const pairs = (quads: { p: number[]; n: number[]; c: [number, number, number] }[], layer = "solid"): NearPair[] => nearPairs(trianglesOf(mesh(quads), layer), RULE.gap, 1e-4);
  const RED: [number, number, number] = [0.8, 0.1, 0.1];

  it("finds two faces on one plane, and two a centimetre apart, that overlap", () => {
    expect(pairs([quad(0), quad(0, 0, false, RED)]).length).toBeGreaterThan(0);
    expect(pairs([quad(0), quad(0.01, 0.5, false, RED)]).length).toBeGreaterThan(0);
  });
  it("leaves alone faces 3 cm apart, faces side by side, and faces that look away from each other", () => {
    expect(pairs([quad(0), quad(0.03, 0, false, RED)])).toHaveLength(0);
    expect(pairs([quad(0), quad(0, 1, false, RED)])).toHaveLength(0);
    expect(pairs([quad(0), quad(0, 0, true, RED)])).toHaveLength(0);
  });
  it("sees the plane of a smooth (averaged-normal) triangle by its corners, and a thin triangle far from the origin by its own normal", () => {
    // A tilted face whose stored normal is up: its own plane is read off its corners.
    const m = new MeshBuilder();
    m.grid([[[400, 0, 400], [401, 0, 400]], [[400, 0.5, 401], [401, 0.5, 401]]], [400.5, -1, 400.5], { colour: [1, 1, 1] });
    const t = trianglesOf(m.finish(), "solid");
    expect(t.length).toBe(2);
    expect(Math.abs((t[0] as Tri).n[1])).toBeLessThan(0.95);
  });
  it("calls two faces of one flat colour alike, and a different colour or a different layer not", () => {
    const same = nearPairs(trianglesOf(mesh([quad(0), quad(0.005, 0)]), "solid"), RULE.gap, 1e-4);
    expect(same.length).toBeGreaterThan(0);
    expect(same.every((q) => alike(q.a, q.b))).toBe(true);
    const other = nearPairs(trianglesOf(mesh([quad(0), quad(0.005, 0, false, RED)]), "solid"), RULE.gap, 1e-4);
    expect(other.some((q) => !alike(q.a, q.b))).toBe(true);
    const a = trianglesOf(mesh([quad(0)]), "solid")[0] as Tri;
    const b = trianglesOf(mesh([quad(0)]), "glass")[0] as Tri;
    expect(alike(a, b)).toBe(false);
  });
});

describe("no front is left flickering", () => {
  it("has no two faces of the town overlapping nearer than the rule, on three seeds on the full tier", () => {
    for (const seed of [20261121, 1, 6]) {
      const r = check(seed, "full");
      expect(r.found, r.lines.join("\n")).toBeLessThanOrEqual(LEFT[`${seed} full`] as number);
      expect(r.flat, "flat ground against flat ground").toBeLessThanOrEqual(FLAT_GROUND[`${seed} full`] as number);
    }
  }, 300_000);
  it("has none on the low tier either", () => {
    const r = check(20261121, "low");
    expect(r.found, r.lines.join("\n")).toBeLessThanOrEqual(LEFT["20261121 low"] as number);
    expect(r.flat).toBeLessThanOrEqual(FLAT_GROUND["20261121 low"] as number);
  }, 300_000);
});
