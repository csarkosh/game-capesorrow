import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { isPaved } from "../../src/sim/town/clearing.js";
import { contains, orient } from "../../src/sim/town/geom.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { groundGeometry, PATCH_LIFT, STALL_CLEAR, STALL_OVER } from "../../src/game/town/groundGeometry.js";
import { PAINT_WHITE } from "../../src/game/town/palette.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { SEA } from "../../src/game/town/townTypes.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { WORLD_SEEDS } from "./world.js";

describe("the paved ground between the buildings", () => {
  it("is a lifted patch on every paved block and none on a yard: every vertex is on a paved block, at the ground's height plus the lift, facing the sky", () => {
    for (const seed of WORLD_SEEDS) {
      const g = townGround(seed);
      const b = new MeshBuilder();
      groundGeometry(g, () => b);
      const a = b.finish();
      expect(a.positions.length).toBeGreaterThan(3000);
      const paved = g.plan.blocks.filter((bl) => isPaved(bl.district));
      const yards = g.plan.blocks.filter((bl) => !isPaved(bl.district));
      let onYard = 0;
      for (let v = 0; v < a.positions.length / 3; v++) {
        const x = a.positions[v * 3] as number;
        const y = a.positions[v * 3 + 1] as number;
        const z = a.positions[v * 3 + 2] as number;
        const p = { x: x - g.anchor.x, z: z - g.anchor.z };
        // On a paved block (its edge, within a centimetre, and the vertex's float rounding included).
        expect(paved.some((bl) => contains(orient(bl.polygon), p, 0.05)), `seed ${seed} vertex ${v}`).toBe(true);
        if (yards.some((bl) => contains(orient(bl.polygon), p, -0.05))) onYard++;
        const lift = y - g.heightAt(x, z);
        expect(lift).toBeGreaterThan(PATCH_LIFT - 0.002);
        expect(lift).toBeLessThan(PATCH_LIFT + STALL_OVER + 0.002);
        expect(y - lift).toBeGreaterThan(SEA);
      }
      expect(onYard).toBe(0);
      for (let t = 0; t < a.indices.length; t += 3) expect(a.normals[(a.indices[t] as number) * 3 + 1] as number, `seed ${seed}`).toBeGreaterThan(0.95);
    }
  });

  it("paints stalls only on the highway strip, kept clear of the buildings, and a few", () => {
    let stallsSeen = 0;
    for (const seed of WORLD_SEEDS) {
      const g = townGround(seed);
      const b = new MeshBuilder();
      groundGeometry(g, () => b);
      const a = b.finish();
      const strips = g.plan.blocks.filter((bl) => bl.district === "highway strip");
      for (let t = 0; t < a.indices.length; t += 3) {
        const i = a.indices[t] as number;
        if (Math.abs((a.colors[i * 4] as number) - PAINT_WHITE[0]) > 1e-6) continue;
        stallsSeen++;
        const p = { x: (a.positions[i * 3] as number) - g.anchor.x, z: (a.positions[i * 3 + 2] as number) - g.anchor.z };
        expect(strips.some((bl) => contains(orient(bl.polygon), p, 0.05)), `seed ${seed}: a stall off the strip`).toBe(true);
        for (const bd of g.plan.buildings) {
          if (bd.lot === -1) continue;
          const u = bearingU(bd.bearing);
          const v = bearingV(bd.bearing);
          const lu = Math.max(0, Math.abs((p.x - bd.centre.x) * u.x + (p.z - bd.centre.z) * u.z) - bd.halfAlong);
          const lv = Math.max(0, Math.abs((p.x - bd.centre.x) * v.x + (p.z - bd.centre.z) * v.z) - bd.halfAcross);
          expect(Math.sqrt(lu * lu + lv * lv), `seed ${seed} stall near building ${bd.id}`).toBeGreaterThanOrEqual(STALL_CLEAR - 0.6);
        }
      }
    }
    expect(stallsSeen).toBeGreaterThan(10);
  });
});
