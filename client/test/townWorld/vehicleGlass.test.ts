// The glass of the code-built vehicles: every cell the skin leaves out as glass is covered by a drawn window, on both details and through the
// stand-in a model's car is until its model has landed, for every vehicle of the game's town and of the seed token "sorrow"'s; and a car that
// was whole is as it was (a digest of its vertices).
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { fleetOf } from "../../src/game/town/props/vehicleFleet.js";
import { bodyOf, glassLayout, vehicleGeometry } from "../../src/game/town/props/vehicleGeometry.js";
import { standInGeometry } from "../../src/game/town/props/vehicleStandIn.js";
import { GLASS_CAR } from "../../src/game/town/props/vehicleStyle.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import type { TownGround } from "../../src/game/town/townTypes.js";
import "../../src/terrain.js";

const fnv = (t: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
};
const TOWNS: readonly (readonly [string, number])[] = [["sorrow", fnv("sorrow")], ["20261121", 20261121]];

/** The glass cells (row interval, column pair) of a body that the skin leaves out and no drawn window covers. */
function uncovered(g: TownGround, detail: "low" | "full"): { id: number; kind: string; cells: number }[] {
  const bad: { id: number; kind: string; cells: number }[] = [];
  for (const v of g.plan.props.vehicles) {
    if (v.kind === "camper") continue;
    const { sh, o } = bodyOf(v, detail, [0, 0, 0]);
    const L = glassLayout(sh, o);
    let miss = 0;
    for (let i = 0; i < L.xs.length - 1; i++) {
      for (let j = 0; j < L.ncol - 1; j++) {
        if (!L.glassQuad(i, j)) continue;
        if (!L.windows.some((w) => i >= w.i0 && i < w.i1 && w.cells.some(([a, b]) => j >= a && j < b))) miss++;
      }
    }
    if (miss > 0) bad.push({ id: v.id, kind: v.kind, cells: miss });
  }
  return bad;
}

describe("the glass of the code-built vehicles", () => {
  for (const [name, seed] of TOWNS) {
    it(`leaves no glass cell of the town ${name} without a window, on either detail`, () => {
      const g = townGround(seed);
      expect(g.plan.props.vehicles.length).toBeGreaterThan(50);
      expect(uncovered(g, "low")).toEqual([]);
      expect(uncovered(g, "full")).toEqual([]);
    });

    it(`draws glass-coloured polygons in the solid layer of every low car of ${name}, and in the stand-in of every model's car`, () => {
      const g = townGround(seed);
      const isGlass = (c: ArrayLike<number>, i: number): boolean =>
        Math.abs((c[i] as number) - GLASS_CAR[0]) < 1e-6 && Math.abs((c[i + 1] as number) - GLASS_CAR[1]) < 1e-6 && Math.abs((c[i + 2] as number) - GLASS_CAR[2]) < 1e-6;
      const glassVertices = (c: ArrayLike<number>): number => {
        let n = 0;
        for (let i = 0; i < c.length; i += 4) if (isGlass(c, i)) n++;
        return n;
      };
      for (const v of g.plan.props.vehicles) {
        if (v.kind === "camper") continue;
        const m = new MeshBuilder();
        vehicleGeometry(g, { solid: () => m, glass: () => new MeshBuilder(), flat: () => new MeshBuilder() }, { ...v, model: "", id: 1 }, "low");
        const { sh, o } = bodyOf(v, "low", [0, 0, 0]);
        const cells = glassLayout(sh, o).windows.reduce((n, w) => n + w.cells.length, 0);
        expect(glassVertices(m.finish().colors), `#${v.id} ${v.kind}`).toBeGreaterThanOrEqual(4 * cells);
        expect(cells, `#${v.id} ${v.kind}`).toBeGreaterThan(0);
      }
      const fleet = fleetOf(g, "full");
      expect(fleet.length).toBeGreaterThan(50);
      const run = standInGeometry(g, fleet);
      let r = run.next();
      while (r.done !== true) r = run.next();
      let expected = 0;
      for (const f of fleet) {
        const { sh, o } = bodyOf(f.vehicle, "low", f.look.paint);
        expected += 4 * glassLayout(sh, o).windows.reduce((n, w) => n + w.cells.length, 0);
      }
      let got = 0;
      for (const b of r.value) if (b.layer === "solid") got += glassVertices(b.arrays.colors);
      expect(got).toBeGreaterThanOrEqual(expected);
    });
  }

  it("leaves a car that was whole as it was: the vertices of every full-detail body, and of the campers, are pinned", () => {
    const parts: string[] = [];
    for (const [, seed] of TOWNS) {
      const g = townGround(seed);
      for (const v of g.plan.props.vehicles) {
        for (const detail of v.kind === "camper" ? (["low", "full"] as const) : (["full"] as const)) {
          const s = new MeshBuilder();
          const gl = new MeshBuilder();
          vehicleGeometry(g, { solid: () => s, glass: () => gl, flat: () => new MeshBuilder() }, { ...v, model: "", id: 1 }, detail);
          for (const m of [s, gl]) {
            const a = m.finish();
            let x = 0x811c9dc5;
            for (let i = 0; i < a.positions.length; i++) {
              x ^= Math.round((a.positions[i] as number) * 1e5) | 0;
              x = Math.imul(x, 0x01000193);
            }
            for (let i = 0; i < a.indices.length; i++) {
              x ^= a.indices[i] as number;
              x = Math.imul(x, 0x01000193);
            }
            parts.push(`${v.id}:${detail}:${a.positions.length / 3}:${x >>> 0}`);
          }
        }
      }
    }
    expect(parts.length).toBeGreaterThan(400);
    expect(fnv(parts.join("|")) >>> 0).toBe(3497635788);
  });
});
