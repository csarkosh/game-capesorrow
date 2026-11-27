import { describe, expect, it } from "vitest";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { roadCenterX } from "@csarkosh/engine/sim/olympic";
import { GRAVEL, OPEN, PAVED, TRACKS } from "../../src/sim/car/types.js";
import { surfaceAt, surfaceGrid } from "../../src/sim/car/surface.js";
import { pavedGround } from "../../src/sim/town/pavedGround.js";
import { WORLD_SEEDS, planFor, siteFor } from "../townWorld/world.js";

const ROAD_SURFACE = { paved: PAVED, gravel: GRAVEL, tracks: TRACKS } as const;

/** The distance from (x, z) to the segment a-b. */
function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

describe("what is under a wheel", () => {
  for (const seed of WORLD_SEEDS) {
    const { anchor } = siteFor(seed);
    const plan = planFor(seed);

    it(`the middle of every drivable street is paved, and an alley gravel (seed ${seed})`, () => {
      let paved = 0;
      let alleys = 0;
      for (const st of plan.streets) {
        if (st.kind === "stair" || st.kind === "rail") continue;
        const x = anchor.x + (st.a.x + st.b.x) / 2;
        const z = anchor.z + (st.a.z + st.b.z) / 2;
        const got = surfaceAt(seed, x, z);
        if (st.kind === "alley") {
          alleys++;
          expect(got, `alley ${st.id}`).toBe(GRAVEL);
        } else {
          paved++;
          expect(got, `${st.kind} ${st.id}`).toBe(PAVED);
        }
      }
      expect(paved).toBeGreaterThan(0);
      expect(alleys).toBeGreaterThan(0);
    }, timeLimit(120_000));

    it(`the highway's centre is paved 3 km from the town (seed ${seed})`, () => {
      for (const dz of [-3000, -1500, 1500, 3000]) {
        const z = anchor.z + dz;
        expect(surfaceAt(seed, roadCenterX(seed, z), z)).toBe(PAVED);
      }
    }, timeLimit(120_000));

    it(`a road out follows its own surface along its length (seed ${seed})`, () => {
      let counted = 0;
      for (const road of plan.roads) {
        for (const p of road.points) {
          counted++;
          const x = anchor.x + p.x;
          const z = anchor.z + p.z;
          const got = surfaceAt(seed, x, z);
          // A road's first points lie on the street it continues, which is paved whatever the road is.
          if (got === PAVED && p.surface !== "paved") {
            const onStreet = plan.streets.some((st) => st.kind !== "alley" && st.kind !== "stair" && st.kind !== "rail" && distToSegment(p.x, p.z, st.a.x, st.a.z, st.b.x, st.b.z) <= st.roadway / 2);
            expect(onStreet, `road ${road.id} point at ${p.x},${p.z} is ${p.surface}`).toBe(true);
          } else {
            expect(got, `road ${road.id} point at ${p.x},${p.z}`).toBe(ROAD_SURFACE[p.surface]);
          }
        }
      }
      expect(counted).toBeGreaterThan(0);
    }, timeLimit(120_000));

    it(`the forest 200 m off any road is open ground (seed ${seed})`, () => {
      const near = (x: number, z: number): boolean => {
        if (Math.abs(x + anchor.x - roadCenterX(seed, z + anchor.z)) < 200) return true;
        for (const st of plan.streets) if (distToSegment(x, z, st.a.x, st.a.z, st.b.x, st.b.z) < 200) return true;
        for (const r of plan.roads) for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1] as { x: number; z: number };
          const b = r.points[i] as { x: number; z: number };
          if (distToSegment(x, z, a.x, a.z, b.x, b.z) < 200) return true;
        }
        for (const g of pavedGround(plan)) for (const q of g.polygon) if (Math.hypot(x - q.x, z - q.z) < 200) return true;
        for (const d of plan.decks) if (Math.hypot(x - d.centre.x, z - d.centre.z) < 200 + d.halfAlong) return true;
        return false;
      };
      let found = 0;
      for (let gx = -1200; gx <= 1200 && found < 5; gx += 200) {
        for (let gz = -1200; gz <= 1200 && found < 5; gz += 200) {
          if (near(gx, gz)) continue;
          found++;
          expect(surfaceAt(seed, anchor.x + gx, anchor.z + gz)).toBe(OPEN);
        }
      }
      expect(found).toBeGreaterThan(0);
    }, timeLimit(120_000));

    it(`a pier's deck is paved (seed ${seed})`, () => {
      const piers = plan.decks.filter((d) => d.kind === "pier");
      expect(piers.length).toBeGreaterThan(0);
      for (const d of piers) expect(surfaceAt(seed, anchor.x + d.centre.x, anchor.z + d.centre.z)).toBe(PAVED);
    }, timeLimit(120_000));

    it(`the dock end, the mill's site and the industrial flats are gravel, the rest of the paving asphalt (seed ${seed})`, () => {
      const seen = new Set<string>();
      for (const g of pavedGround(plan)) {
        let cx = 0;
        let cz = 0;
        for (const q of g.polygon) {
          cx += q.x / g.polygon.length;
          cz += q.z / g.polygon.length;
        }
        const x = anchor.x + cx;
        const z = anchor.z + cz;
        // Streets, roads, decks and the highway take precedence over the ground they lie on; test only a clear centre.
        const covered = plan.streets.some((st) => distToSegment(cx, cz, st.a.x, st.a.z, st.b.x, st.b.z) <= st.roadway / 2);
        if (covered || Math.abs(x - roadCenterX(seed, z)) <= 6) continue;
        if (plan.decks.some((d) => Math.abs((cx - d.centre.x) * d.axis.x + (cz - d.centre.z) * d.axis.z) <= d.halfAlong && Math.abs((cx - d.centre.x) * d.axis.z - (cz - d.centre.z) * d.axis.x) <= d.halfAcross)) continue;
        const want = g.district === "dock" || g.district === "mill" || g.district === "industrial" ? GRAVEL : PAVED;
        expect(surfaceAt(seed, x, z), `${g.kind} in ${g.district}`).toBe(want);
        seen.add(g.district);
      }
      expect(seen.size).toBeGreaterThan(0);
    }, timeLimit(120_000));

    it(`answers the same twice, and 10,000 lookups make no new grid (seed ${seed})`, () => {
      const grid = surfaceGrid(seed);
      expect(grid.cols * grid.rows).toBeGreaterThan(0);
      const before: number[] = [];
      for (let i = 0; i < 10000; i++) {
        const x = anchor.x + ((i * 37) % 1100) - 550;
        const z = anchor.z + ((i * 91) % 1100) - 550;
        before.push(surfaceAt(seed, x, z));
      }
      for (let i = 0; i < 10000; i++) {
        const x = anchor.x + ((i * 37) % 1100) - 550;
        const z = anchor.z + ((i * 91) % 1100) - 550;
        expect(surfaceAt(seed, x, z)).toBe(before[i]);
      }
      expect(surfaceGrid(seed)).toBe(grid);
      expect(new Set(before).size).toBeGreaterThan(1);
    }, timeLimit(120_000));
  }
});
