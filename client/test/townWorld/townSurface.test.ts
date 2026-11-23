import { describe, expect, it } from "vitest";
import { MeshBuilder, SURFACE_FLOATS, type Vec3 } from "../../src/game/town/meshBuilder.js";
import { LAYER_NAMES, NO_LAYER, layerIndex, townLayer } from "../../src/game/town/townLayers.js";
import { edgeFrame, groundFrame, groundSurface, tintOf, wallFrame, type Surface } from "../../src/game/town/townSurface.js";

const quad = (x0: number, y0: number, x1: number, y1: number): Vec3[] => [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]];
const FACING: Vec3 = [0, 0, 1];

function uvOf(a: ReturnType<MeshBuilder["finish"]>, i: number): [number, number] {
  return [a.uvs[i * 2] as number, a.uvs[i * 2 + 1] as number];
}

describe("a polygon's surface", () => {
  it("gives a colour-only polygon exactly what it was: its colour, no layer, no wear, a tint of the colour's own", () => {
    const b = new MeshBuilder();
    b.poly(quad(0, 0, 4, 2), FACING, [0.2, 0.3, 0.4]);
    const a = b.finish();
    expect(Array.from(a.colors)).toEqual(Array.from({ length: 4 }, () => [0.2, 0.3, 0.4, 1]).flat().map((v) => Math.fround(v)));
    for (let i = 0; i < 4; i++) {
      expect(Array.from(a.surface.slice(i * SURFACE_FLOATS, i * SURFACE_FLOATS + 4))).toEqual([NO_LAYER, 0, 0, 0]);
      expect(uvOf(a, i)).toEqual([0, 0]);
    }
    expect(a.uvs.length).toBe(8);
    expect(a.surface.length).toBe(4 * SURFACE_FLOATS);
    // And the same polygon with a surface has the same positions, normals, colours and triangles.
    const c = new MeshBuilder();
    c.poly(quad(0, 0, 4, 2), FACING, [0.2, 0.3, 0.4], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 0) });
    const d = c.finish();
    expect(Array.from(d.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(d.normals)).toEqual(Array.from(a.normals));
    expect(Array.from(d.colors)).toEqual(Array.from(a.colors));
    expect(Array.from(d.indices)).toEqual(Array.from(a.indices));
  });

  it("puts a texture at true scale: metres along the frame's axes over the layer's tile size across and up", () => {
    const brick = townLayer("brick");
    const [tw, th] = brick.tile;
    const b = new MeshBuilder();
    // A wall 6 m long and 3 m high, its texture running along it from its left end and up from its base.
    b.poly(quad(0, 0, 6, 3), FACING, [1, 1, 1], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 0) });
    const a = b.finish();
    expect(uvOf(a, 0)).toEqual([0, 0]);
    expect(uvOf(a, 1)[0]).toBeCloseTo(6 / tw, 6);
    expect(uvOf(a, 1)[1]).toBeCloseTo(0, 6);
    expect(uvOf(a, 2)[0]).toBeCloseTo(6 / tw, 6);
    expect(uvOf(a, 2)[1]).toBeCloseTo(3 / th, 6);
    // Every vertex carries the layer's index, as the manifest has it.
    for (let i = 0; i < 4; i++) expect(a.surface[i * SURFACE_FLOATS]).toBe(brick.index);
  });

  it("starts a wall's texture where the wall before it left off, and turns it on its side for boards that stand", () => {
    const w = (along: number, turned: boolean): ReturnType<MeshBuilder["finish"]> => {
      const b = new MeshBuilder();
      b.poly(quad(0, 0, 2, 1), FACING, [1, 1, 1], { layer: "planks_weathered", frame: wallFrame(0, 0, 1, 0, 0, along, turned) });
      return b.finish();
    };
    const tile = townLayer("planks_weathered").tile;
    expect(uvOf(w(5, false), 0)[0]).toBeCloseTo(5 / tile[0], 6);
    expect(uvOf(w(5, false), 1)[0]).toBeCloseTo(7 / tile[0], 6);
    // Turned: u runs up the wall and v along it.
    const t = w(0, true);
    expect(uvOf(t, 1)).toEqual([0, Math.fround(2 / tile[1])]);
    expect(uvOf(t, 3)[0]).toBeCloseTo(1 / tile[0], 6);
  });

  it("runs a roof's texture along its eave and up its slope", () => {
    // A slope rising 1 m for every 2 m across: its eave along x at y = 0, its ridge 2 m back (z) and 1 m up.
    const eaveA: Vec3 = [0, 0, 0];
    const eaveB: Vec3 = [3, 0, 0];
    const ridge: Vec3 = [0, 1, -2];
    const frame = edgeFrame(eaveA, eaveB, ridge);
    const b = new MeshBuilder();
    b.poly([eaveA, eaveB, [3, 1, -2], ridge], [0, 1, 0.5], [0.1, 0.1, 0.1], { layer: "roof_shingle", frame });
    const a = b.finish();
    const tile = townLayer("roof_shingle").tile;
    const slope = Math.sqrt(5);
    // Along the eave: the eave's length in metres. Up the slope: the length along the slope, not the height.
    expect(uvOf(a, 1)[0]).toBeCloseTo(3 / tile[0], 5);
    expect(uvOf(a, 1)[1]).toBeCloseTo(0, 5);
    expect(uvOf(a, 3)[0]).toBeCloseTo(0, 5);
    expect(uvOf(a, 3)[1]).toBeCloseTo(slope / tile[1], 5);
  });

  it("makes ground meet with no seam: two pieces take the same UV at a point they share", () => {
    const anchor = { x: -349.2, z: 12.5 };
    const left = new MeshBuilder();
    const right = new MeshBuilder();
    left.poly([[10, 0, 20], [14, 0, 20], [14, 0, 24], [10, 0, 24]], [0, 1, 0], [0.3, 0.3, 0.3], groundSurface("sidewalk", anchor));
    right.poly([[14, 0, 20], [18, 0, 20], [18, 0, 24], [14, 0, 24]], [0, 1, 0], [0.3, 0.3, 0.3], groundSurface("sidewalk", anchor));
    const l = left.finish();
    const r = right.finish();
    // The shared edge is (14, 20) to (14, 24): left's corners 1 and 2, right's 0 and 3.
    expect(uvOf(l, 1)).toEqual(uvOf(r, 0));
    expect(uvOf(l, 2)).toEqual(uvOf(r, 3));
    // And it is metres over the tile size from the frame's origin.
    const tile = townLayer("sidewalk").tile;
    expect(uvOf(l, 0)[0]).toBeCloseTo((10 - anchor.x) / tile[0], 3);
    expect(uvOf(l, 0)[1]).toBeCloseTo((20 - anchor.z) / tile[1], 3);
    expect(groundFrame(anchor).u).toEqual([1, 0, 0]);
  });

  it("writes the wear as a share of 0 to 1, by vertex where it is a function, and its kind", () => {
    const b = new MeshBuilder();
    const surface: Surface = { layer: "metal_aged", frame: wallFrame(0, 0, 1, 0, 0), wear: (p) => p[1] * 0.5 - 0.25, wearKind: "rust" };
    b.poly(quad(0, 0, 4, 4), FACING, [0.3, 0.3, 0.3], surface);
    const a = b.finish();
    // y = 0 gives -0.25 (kept at 0) and y = 4 gives 1.75 (kept at 1).
    expect(a.surface[1]).toBe(0);
    expect(a.surface[2]).toBe(1);
    expect(a.surface[2 * SURFACE_FLOATS + 1]).toBe(1);
    const c = new MeshBuilder();
    c.poly(quad(0, 0, 1, 1), FACING, [1, 1, 1], { layer: "brick", frame: wallFrame(0, 0, 1, 0, 0), wear: 0.4 });
    expect(c.finish().surface[1]).toBeCloseTo(0.4, 6);
    expect(c.finish().surface[2]).toBe(0);
  });

  it("tints a paintable layer with the polygon's colour and any other with white, unless the surface says", () => {
    const paintable = LAYER_NAMES.filter((n) => townLayer(n).paintable);
    expect(paintable).toEqual(["siding_painted", "metal_aged", "stucco", "roof_shingle"]);
    const frame = wallFrame(0, 0, 1, 0, 0);
    expect(tintOf({ layer: "siding_painted", frame }, [0.2, 0.3, 0.4])).toEqual([0.2, 0.3, 0.4]);
    expect(tintOf({ layer: "brick", frame }, [0.2, 0.3, 0.4])).toEqual([1, 1, 1]);
    expect(tintOf({ layer: "brick", frame, tint: [0.9, 0.8, 0.7] }, [0.2, 0.3, 0.4])).toEqual([0.9, 0.8, 0.7]);
    const b = new MeshBuilder();
    b.poly(quad(0, 0, 1, 1), FACING, [0.2, 0.3, 0.4], { layer: "stucco", frame });
    expect(Array.from(b.finish().surface.slice(4, 7))).toEqual([0.2, 0.3, 0.4].map(Math.fround));
  });

  it("refuses a layer the manifest does not have", () => {
    expect(() => layerIndex("nothing" as never)).toThrow(/no texture layer/);
  });
});
