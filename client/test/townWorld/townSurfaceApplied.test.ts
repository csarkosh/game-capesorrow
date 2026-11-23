import "../../src/terrain.js";
import { describe, expect, it } from "vitest";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { buildingGeometry } from "../../src/game/town/buildingGeometry.js";
import { roofStyle, wallStyle, wallWearAt, wallWearBase, WALL_WEAR } from "../../src/game/town/buildingSurfaces.js";
import { flatSurfaceFor, faceSurfaceFor } from "../../src/game/town/groundSurfaces.js";
import { MeshBuilder, SURFACE_FLOATS, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { ALLEY, ASPHALT, CURB, DOME, GRAVEL, PAINT_WHITE, SIDEWALK, VERGE } from "../../src/game/town/palette.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { LAYER_NAMES, NO_LAYER, townLayer } from "../../src/game/town/townLayers.js";
import type { Building } from "../../src/sim/town/types.js";

const SEED = 20261121;
const ground = townGround(SEED);

/** The layers a batch's vertices carry, counted by layer name (or "none"). */
function layersOf(a: MeshArrays): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < a.positions.length / 3; i++) {
    const layer = a.surface[i * SURFACE_FLOATS] as number;
    const name = layer === NO_LAYER ? "none" : (LAYER_NAMES[layer] as string);
    out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

function buildingArrays(b: Building): MeshArrays {
  const builder = new MeshBuilder();
  buildingGeometry(ground, b, null, () => builder, "full");
  return builder.finish();
}

const town = finish(townGeometry(ground, "full", { x: 0, z: 0 }));

describe("the town's first surfaces", () => {
  it("leaves every array consistent: a UV and eight surface floats a vertex, a layer the manifest has, a wear of 0 to 1", () => {
    for (const batch of town) {
      const a = batch.arrays;
      const n = a.positions.length / 3;
      expect(a.uvs.length).toBe(n * 2);
      expect(a.surface.length).toBe(n * SURFACE_FLOATS);
      for (let i = 0; i < n; i++) {
        const layer = a.surface[i * SURFACE_FLOATS] as number;
        expect(Number.isInteger(layer) && layer >= NO_LAYER && layer < LAYER_NAMES.length).toBe(true);
        const wear = a.surface[i * SURFACE_FLOATS + 1] as number;
        expect(wear >= 0 && wear <= 1).toBe(true);
        expect(Number.isFinite(a.uvs[i * 2] as number) && Number.isFinite(a.uvs[i * 2 + 1] as number)).toBe(true);
        if (layer === NO_LAYER) expect(wear).toBe(0);
      }
    }
  });

  it("puts the street surfaces on the flat layer and the buildings' on the standing one, and leaves the paint, signs and verges flat colour", () => {
    const flat = new Map<string, number>();
    const solid = new Map<string, number>();
    for (const batch of town) for (const [name, n] of layersOf(batch.arrays)) (batch.layer === "flat" ? flat : solid).set(name, ((batch.layer === "flat" ? flat : solid).get(name) ?? 0) + n);
    // The streets and ground now wear the new asphalt (utility cuts, cracks), the mud (dirt in the joints, worn ground, the gutter's band), the moss (weeds and grass over the edges) and the rust (covers, drains and lids).
    expect([...flat.keys()].sort()).toEqual(["asphalt", "asphalt_dark", "gravel", "moss", "mud", "none", "rust", "sidewalk"]);
    // Paint and verges are still the larger share of nothing: some of the flat layer is not textured.
    expect(flat.get("none") ?? 0).toBeGreaterThan(0);
    for (const layer of ["asphalt", "sidewalk"]) expect(flat.get(layer) ?? 0, layer).toBeGreaterThan(1000);
    const walls = ["siding_painted", "brick", "concrete_board", "roof_shingle", "roof_bitumen"];
    for (const layer of walls) expect(solid.get(layer) ?? 0, layer).toBeGreaterThan(100);
    expect(solid.get("none") ?? 0).toBeGreaterThan(0);
  });

  it("keeps every textured street polygon's flat colour as it was, its texture's tint apart from it", () => {
    // A street polygon in ASPHALT keeps ASPHALT as its colour, whatever its tint.
    let seen = 0;
    for (const batch of town) {
      if (batch.layer !== "flat") continue;
      const a = batch.arrays;
      for (let i = 0; i < a.positions.length / 3; i++) {
        if ((a.surface[i * SURFACE_FLOATS] as number) !== LAYER_NAMES.indexOf("asphalt")) continue;
        const r = a.colors[i * 4] as number;
        // The paint lies on the asphalt's grain in its own colour (and is not what this checks): a roadway's flat colour stays what it was.
        if (r >= 0.15) continue;
        expect(r > 0.09 && r < 0.14).toBe(true);
        // A tone of its own for each stretch (0.86 to 1.14) or a block's patch's shade of it (0.72 to 0.88).
        const tint = a.surface[i * SURFACE_FLOATS + 4] as number;
        expect(tint > 0.7 && tint < 1.3).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it("gives the ground's colours their materials and nothing else", () => {
    const anchor = { x: 0, z: 0 };
    expect(flatSurfaceFor(ASPHALT, anchor)?.layer).toBe("asphalt");
    expect(flatSurfaceFor(SIDEWALK, anchor)?.layer).toBe("sidewalk");
    expect(flatSurfaceFor(CURB, anchor)?.layer).toBe("sidewalk");
    expect(flatSurfaceFor(ALLEY, anchor)?.layer).toBe("gravel");
    expect(flatSurfaceFor(GRAVEL, anchor)?.layer).toBe("gravel");
    for (const colour of [PAINT_WHITE, VERGE, DOME]) expect(flatSurfaceFor(colour, anchor)).toBeUndefined();
    expect(flatSurfaceFor(SIDEWALK, anchor)?.wear).toBeGreaterThan(0);
    expect(flatSurfaceFor(ASPHALT, anchor)?.wear).toBeUndefined();
    // A face that stands runs along itself and up.
    const face = faceSurfaceFor(CURB, 0, 0, 3, 0);
    expect(face?.frame.u).toEqual([1, 0, 0]);
    expect(face?.frame.v).toEqual([0, 1, 0]);
    expect(faceSurfaceFor(CURB, 1, 1, 1, 1)).toBeUndefined();
  });

  it("textures a house's walls by its material and its roof by its kind, with the paint the house has always had", () => {
    const house = ground.plan.buildings.find((b) => b.material === "wood" && b.roof === "gable" && b.state === "open" && b.lot !== -1 && wallStyle(b).layer === "siding_painted");
    expect(house).toBeDefined();
    const a = buildingArrays(house as Building);
    const layers = layersOf(a);
    expect(layers.get("siding_painted") ?? 0).toBeGreaterThan(0);
    expect(layers.get("roof_shingle") ?? 0).toBeGreaterThan(0);
    // Painted siding is tinted with the wall's flat colour: its tint is the vertex colour.
    for (let i = 0; i < a.positions.length / 3; i++) {
      if ((a.surface[i * SURFACE_FLOATS] as number) !== LAYER_NAMES.indexOf("siding_painted")) continue;
      for (let k = 0; k < 3; k++) expect(a.surface[i * SURFACE_FLOATS + 4 + k]).toBeCloseTo(a.colors[i * 4 + k] as number, 5);
    }
  });

  it("chooses walls and roofs by the plan's material and kind, deterministically, and wears vacant buildings more", () => {
    const styles = new Set<string>();
    for (const b of ground.plan.buildings) {
      const s = wallStyle(b);
      styles.add(`${b.material}:${s.layer}`);
      expect(wallStyle(b)).toEqual(s);
      expect(townLayer(s.layer).paintable).toBe(s.paint);
    }
    for (const want of ["wood:siding_painted", "wood:shingle_siding", "brick:brick", "concrete:concrete_board", "stone:stone", "stucco:stucco", "metal:metal_aged"]) expect(styles.has(want), want).toBe(true);
    const base = ground.plan.buildings[0] as Building;
    expect(roofStyle(base, "flat").layer).toBe("roof_bitumen");
    expect(roofStyle(base, "shed").layer).toBe("roof_metal");
    expect(roofStyle({ ...base, material: "wood" }, "gable").layer).toBe("roof_shingle");
    expect(roofStyle({ ...base, material: "metal" }, "gable").layer).toBe("roof_metal");
    expect(wallWearBase({ ...base, state: "ruin" })).toBeGreaterThan(wallWearBase({ ...base, state: "vacant" }));
    expect(wallWearBase({ ...base, state: "vacant" })).toBeGreaterThan(wallWearBase({ ...base, state: "open" }));
    // More at the foot of a wall than at its eave.
    expect(wallWearAt(0.1, 0, 0)).toBeCloseTo(0.1 + WALL_WEAR.foot, 6);
    expect(wallWearAt(0.1, 0, 10)).toBeCloseTo(0.1, 6);
    expect(wallWearAt(0.9, 0, 0)).toBe(1);
  });

  it("boards a vacant building's openings in plywood and gives a big door the shutter layer", () => {
    const vacant = ground.plan.buildings.find((b) => b.state === "vacant" && b.kind === "storefront");
    expect(vacant).toBeDefined();
    expect(layersOf(buildingArrays(vacant as Building)).get("plywood") ?? 0).toBeGreaterThan(0);
    // One with no units of its own (a warehouse that is just stock): its front is a big door.
    const warehouse = ground.plan.buildings.find((b) => b.state === "open" && (b.kind === "warehouse" || b.kind === "garage" || b.kind === "mill shed") && (ground.plan.uses[b.id]?.units.length ?? 0) === 0);
    expect(warehouse).toBeDefined();
    expect(layersOf(buildingArrays(warehouse as Building)).get("shutter") ?? 0).toBeGreaterThan(0);
  });
});
