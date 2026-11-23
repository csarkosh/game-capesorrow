/**
 * No two faces of a building are left for the depth buffer to tell apart. A storefront flickers as a person walks past it when two faces
 * that look the same way overlap and lie nearly in one plane (a pane drawn twice, a sign over a board, blinds against the glass, a trim
 * board a centimetre off the wall): the buffer cannot say which is nearer, and the choice changes with the camera.
 *
 * **How close is too close.** The game's depth buffer is 24 bits with the near plane at 0.05 m (`LENS_NEAR`) and the far at 10 km, so a
 * step of depth is z * z / (0.05 * 2^24) metres at a distance z: 0.3 mm at 15 m, 1.1 mm at 30 m, 1.9 mm at 40 m, 4.3 mm at 60 m,
 * 12 mm at 100 m. Two faces that overlap are held apart when they are at least four steps apart at 60 m: 2 cm. So the test fails when two
 * faces that look the same way (their normals within 0.02 of each other), overlap in area, and are less than 2 cm apart along their
 * normal. An overlap smaller than `MIN_AREA` (0.25 m^2, a patch under 50 cm square) is not counted: what is left under it is a few
 * volumes that meet (a porch against an addition, the leaves of a plant, a reveal against a wall piece), not a layer of the front drawn
 * twice. At 0.15 m^2 four such pairs are left on seeds 1 and 6, and at 25 cm^2 about a hundred a town.
 *
 * Over the town's buildings, as the game builds them (full tier on three seeds, the low tier on one), the ruins left out (a ruin's rubble
 * is boxes dropped at random, which meet).
 */
import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { buildingGeometry } from "../../src/game/town/buildingGeometry.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { SignAtlas } from "../../src/game/town/signAtlas.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { Detail } from "../../src/game/town/townTypes.js";
import { nearPairs, trianglesOf } from "./nearPlanes.js";

/** The depth step at 60 m is 4.3 mm; four steps. */
const GAP = 0.02;
/** A patch smaller than this (m^2) is not a layer of the front drawn twice. */
const MIN_AREA = 0.25;

function overlaps(seed: number, detail: Detail): string[] {
  const g = townGround(seed);
  const found: string[] = [];
  for (const b of g.plan.buildings) {
    if (b.kind === "pier" || b.state === "ruin") continue;
    const solid = new MeshBuilder();
    const glass = new MeshBuilder();
    const sign = new MeshBuilder();
    const atlas = new SignAtlas(8192, 8192, 56);
    const role = g.plan.landmarks.find((l) => l.building === b.id)?.role ?? null;
    buildingGeometry(g, b, role, () => solid, detail, { glass: () => glass, sign: () => sign, atlas });
    const tris = trianglesOf(solid.finish(), "solid");
    trianglesOf(glass.finish(), "glass", tris);
    trianglesOf(sign.finish(), "sign", tris);
    for (const p of nearPairs(tris, GAP, MIN_AREA)) {
      found.push(`seed ${seed} ${detail} building ${b.id} (${b.kind}) at ${p.at.map((x) => x.toFixed(1)).join(",")}: ${p.a.layer}/${p.b.layer} ${(p.gap * 1000).toFixed(1)} mm apart, ${p.area.toFixed(2)} m2 overlap`);
    }
  }
  return found;
}

describe("the finder of faces the depth buffer cannot tell apart", () => {
  const quad = (y: number, x0 = 0, flip = false): { p: number[]; n: number[] } => ({
    p: [x0, y, 0, x0 + 1, y, 0, x0 + 1, y, 1, x0, y, 1],
    n: flip ? [0, -1, 0] : [0, 1, 0],
  });
  const mesh = (quads: { p: number[]; n: number[] }[]): ReturnType<MeshBuilder["finish"]> => {
    const m = new MeshBuilder();
    for (const q of quads) m.poly([[q.p[0]!, q.p[1]!, q.p[2]!], [q.p[3]!, q.p[4]!, q.p[5]!], [q.p[6]!, q.p[7]!, q.p[8]!], [q.p[9]!, q.p[10]!, q.p[11]!]], [q.n[0]!, q.n[1]!, q.n[2]!], [1, 1, 1]);
    return m.finish();
  };
  const pairs = (quads: { p: number[]; n: number[] }[]): number => nearPairs(trianglesOf(mesh(quads), "solid"), GAP, 0.01).length;

  it("finds two faces on one plane, and two a centimetre apart, that overlap", () => {
    expect(pairs([quad(0), quad(0)])).toBeGreaterThan(0);
    expect(pairs([quad(0), quad(0.01, 0.5)])).toBeGreaterThan(0);
  });
  it("leaves alone faces 3 cm apart, faces side by side, and faces that look away from each other", () => {
    expect(pairs([quad(0), quad(0.03)])).toBe(0);
    expect(pairs([quad(0), quad(0, 1)])).toBe(0);
    expect(pairs([quad(0), quad(0, 0, true)])).toBe(0);
  });
});

describe("no front is left flickering", () => {
  it("has no two faces overlapping closer than 2 cm on the town's buildings (3 seeds, full tier)", () => {
    for (const seed of [20261121, 1, 6]) {
      const found = overlaps(seed, "full");
      expect(found.slice(0, 8), `${found.length} overlaps`).toEqual([]);
    }
  });
  it("has none on the low tier either", () => {
    const found = overlaps(20261121, "low");
    expect(found.slice(0, 8), `${found.length} overlaps`).toEqual([]);
  });
});
