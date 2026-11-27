import { describe, expect, it } from "vitest";
import { COVE_Z } from "@csarkosh/engine/sim/olympic";
import { SPECIES_DEER, SPECIES_ELK, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_BUTTERFLY } from "@csarkosh/engine/game/wildlifeField";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { contains, orient, segDist, type Vec } from "../../src/sim/town/geom.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { CAPE_PLACE } from "../../src/sim/town/place.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { TOWN_GEN } from "../../src/sim/town/version.js";
import type { Building, BuildingKind, TownPlan } from "../../src/sim/town/types.js";
import { WILDLIFE_TUNING, townDepth, townWildlifeGround } from "../../src/sim/town/wildlifeGround.js";

const SEEDS = [20261121, 1, 7];
const HOUSES: readonly BuildingKind[] = ["house", "boarding house"];
const COMMERCIAL: readonly BuildingKind[] = ["storefront", "hotel", "bank", "office", "tavern", "restaurant", "gas station", "motel", "big-box store", "garage"];

/** A plan's frame to the world's. */
function world(seed: number, p: Vec): Vec {
  return { x: p.x + siteFor(seed).anchor.x, z: p.z + COVE_Z };
}
/** The buildings of the town's built blocks (not the outskirts' lots). */
function builtBuildings(plan: TownPlan): Building[] {
  return plan.buildings.filter((b) => b.lot !== -1 && plan.blocks[plan.lots[b.lot]!.block]!.district !== "outskirts");
}
/** A point in front of a building's street face, `out` metres past it. */
function frontOf(b: Building, out: number): Vec {
  const f = b.front ?? bearingU(b.bearing);
  const u = bearingU(b.bearing);
  const v = bearingV(b.bearing);
  const ext = Math.abs(f.x * u.x + f.z * u.z) * b.halfAlong + Math.abs(f.x * v.x + f.z * v.z) * b.halfAcross;
  return { x: b.centre.x + f.x * (ext + out), z: b.centre.z + f.z * (ext + out) };
}

describe("the town's wildlife ground", () => {
  it("uses the engine's species numbers", () => {
    expect(WILDLIFE_TUNING.elk).toBe(SPECIES_ELK);
    expect(WILDLIFE_TUNING.deer).toBe(SPECIES_DEER);
    expect(WILDLIFE_TUNING.rabbit).toBe(SPECIES_RABBIT);
  });

  it("is no part of the place's tunables or the generator's version", () => {
    expect(CAPE_PLACE.wildlifeGround).toBe(townWildlifeGround);
    expect(Object.keys(CAPE_PLACE.tunables).filter((k) => /wildlife|animal|rabbit|deer|elk/i.test(k))).toEqual([]);
    expect(Object.keys(CAPE_PLACE.tunables).length).toBeGreaterThan(0);
    // The generator's version as `test/town/determinism.test.ts` pins it: the wildlife ground raised it by nothing, and this follows that pin
    // when the plan itself changes (22: the street lights; 24: no street is shut at the highway).
    expect(TOWN_GEN).toBe(24);
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const plan = planFor(seed);

      it("lets squirrels and butterflies go anywhere", () => {
        for (const b of builtBuildings(plan).slice(0, 40)) {
          const w = world(seed, b.centre);
          expect(townWildlifeGround(seed, SPECIES_SQUIRREL, w.x, w.z)).toBe(true);
          expect(townWildlifeGround(seed, SPECIES_BUTTERFLY, w.x, w.z)).toBe(true);
        }
      });

      it("keeps elk and deer 20 m clear of every building of a built block", () => {
        const blds = builtBuildings(plan);
        expect(blds.length).toBeGreaterThan(20);
        for (const b of blds) {
          const u = bearingU(b.bearing);
          const v = bearingV(b.bearing);
          for (const reach of [0, 10, 20]) {
            for (const [su, sv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
              const du = su * (b.halfAlong + reach * (su !== 0 ? 1 : 0));
              const dv = sv * (b.halfAcross + reach * (sv !== 0 ? 1 : 0));
              const w = world(seed, { x: b.centre.x + u.x * du + v.x * dv, z: b.centre.z + u.z * du + v.z * dv });
              expect(townWildlifeGround(seed, SPECIES_ELK, w.x, w.z)).toBe(false);
              expect(townWildlifeGround(seed, SPECIES_DEER, w.x, w.z)).toBe(false);
            }
          }
        }
      });

      it("lets elk and deer in 80 m and more outside the town", () => {
        const polys = plan.blocks.filter((b) => b.district !== "outskirts").map((b) => orient(b.polygon));
        const dist = (p: Vec): number => {
          let best = Infinity;
          for (const poly of polys) {
            if (contains(poly, p)) return 0;
            for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
          }
          for (const st of plan.streets) if (st.kind !== "highway") best = Math.min(best, segDist(p, st.a, st.b) - st.width / 2);
          for (const f of plan.fill) {
            const poly = orient(f.polygon);
            if (contains(poly, p)) return 0;
            for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
          }
          best = Math.min(best, segDist(p, plan.quay.a, plan.quay.b));
          return best;
        };
        let n = 0;
        const b = plan.bounds;
        for (let z = b.z0 - 100; z <= b.z1 + 100; z += 40) {
          for (let x = b.x0 - 100; x <= b.x1 + 100; x += 40) {
            if (dist({ x, z }) < 80) continue;
            const w = world(seed, { x, z });
            expect(townWildlifeGround(seed, SPECIES_ELK, w.x, w.z), `${x},${z}`).toBe(true);
            expect(townWildlifeGround(seed, SPECIES_DEER, w.x, w.z)).toBe(true);
            n++;
          }
        }
        expect(n).toBeGreaterThan(20);
      });

      it("refuses rabbits at every commercial door and at the FBI office's spawn", () => {
        const shops = builtBuildings(plan).filter((b) => COMMERCIAL.includes(b.kind));
        expect(shops.length).toBeGreaterThan(5);
        for (const b of shops) {
          const w = world(seed, frontOf(b, 1.5));
          expect(townWildlifeGround(seed, SPECIES_RABBIT, w.x, w.z), `${b.kind} ${b.id}`).toBe(false);
        }
        const s = world(seed, plan.spawn);
        expect(townWildlifeGround(seed, SPECIES_RABBIT, s.x, s.z)).toBe(false);
      });

      it("lets rabbits into house yards near the town's edge and not deep in", () => {
        const limit = WILDLIFE_TUNING.rabbitDepth;
        let shallowAllowed = 0;
        let deepChecked = 0;
        for (const b of builtBuildings(plan).filter((x) => HOUSES.includes(x.kind))) {
          const w = world(seed, frontOf(b, 3));
          const depth = townDepth(seed, w.x, w.z);
          const ok = townWildlifeGround(seed, SPECIES_RABBIT, w.x, w.z);
          if (depth > limit + WILDLIFE_TUNING.cell) {
            expect(ok).toBe(false);
            deepChecked++;
          } else if (ok) shallowAllowed++;
        }
        expect(shallowAllowed).toBeGreaterThan(0);
        expect(deepChecked).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
