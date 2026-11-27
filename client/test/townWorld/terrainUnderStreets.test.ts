/**
 * The terrain as the engine draws it, against the surfaces the town lays over it. The engine's clipmap (`clipTerrain.ts` builds
 * its real rings, with their spacing, their blend toward the coarser ring and their upper envelope) is a mesh of 1 m (2 m on the
 * low tier) near the camera, so a step of 15 cm over a few metres is not in it: the town cuts the terrain out of sight under its
 * streets and lays flat surfaces a depth step ahead (`streetField.ts`). This measures what the cut leaves, for a camera on the
 * start and one on a street of the low flats, on both tiers, over every flat surface of the town (streets, sidewalks, junctions,
 * curbs, paint, paved blocks):
 *
 * - where the terrain's mesh stands above a surface by more than the cut leaves (the surface's own lift is 1 to 2 cm), and
 * - how much of the terrain under them paints as beach sand (the engine paints by height, and the town's flats stand at 2 to 3 m).
 *
 * The cut is measured in the rings of 2 m or finer (the camera's 64 m on the medium tier, 128 m on the low). Past them the mesh is
 * too coarse to hold a cut of any depth, and the surfaces are held by the depth step, which grows with the square of the distance:
 * over every ring (and the lip of a drop to the sea) it is the depth step that is asserted.
 */
import { describe, expect, it } from "vitest";
import { ROAD_BED_HALF } from "@csarkosh/engine/sim/road";
import "../../src/terrain.js";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { finish } from "@csarkosh/engine/game/syncJobs";
import { townStart } from "../../src/sim/town/start.js";
import { pavedGround } from "../../src/sim/town/pavedGround.js";
import { contains } from "../../src/sim/town/geom.js";
import { bearingU, bearingV } from "../../src/sim/town/bearings.js";
import { townGeometry, townGround } from "../../src/game/town/townGeometry.js";
import { drawnTerrain, type QualityTier } from "./clipTerrain.js";
import { WORLD_SEEDS } from "./world.js";

/** A seed the game's own token "sorrow" hashes to, whose low flats the owner's pictures are of. */
const SORROW = -2060655827;
const SEEDS: readonly number[] = [SORROW, WORLD_SEEDS[0] as number, WORLD_SEEDS[1] as number];

type Measure = { samples: number; sand: number; under2: number; under5: number; lips: number; all: number; wins: number; worstWin: number };

/**
 * What the engine's depth offset holds: the flat layer is drawn `FLAT_AHEAD_UNITS` (120) of a 24-bit depth buffer's steps ahead, which at
 * distance d from a 0.05 m near plane is 120 / 2^24 * d^2 / 0.05 = 1.43e-4 * d^2 metres (1.4 cm at 10 m, 36 cm at 50 m). The terrain
 * shows over a surface where its mesh stands over it by more than that.
 */
const depthStep = (d: number): number => 1.43e-4 * d * d;

/**
 * Whether the ground falls away steeply (a gradient over 0.4) within 4 m of a point: a street's end at the water's edge, where the
 * made ground drops to the sea. The engine draws the terrain as an upper envelope of its field, lifted over every crest between its
 * vertices, so a 2 m mesh stands a metre over the lip of such a drop and no cut can hold it down (the engine's, noted in
 * ARCHITECTURE.md); those samples are counted apart.
 */
function nearDrop(seed: number, x: number, z: number): boolean {
  for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
    const s = elevationSampleAt(seed, x + dx, z + dz);
    if (Math.hypot(s.dx, s.dz) > 0.4) return true;
  }
  return false;
}

function measure(seed: number, cam: { x: number; z: number }, tier: QualityTier): Measure {
  const g = townGround(seed);
  const batches = finish(townGeometry(g, "full", cam));
  const T = drawnTerrain(seed, cam.x, cam.z, tier);
  const m: Measure = { samples: 0, sand: 0, under2: 0, under5: 0, lips: 0, all: 0, wins: 0, worstWin: 0 };
  for (const b of batches) {
    if (b.layer !== "flat") continue;
    const p = b.arrays.positions;
    const ix = b.arrays.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const i0 = (ix[t] as number) * 3;
      const i1 = (ix[t + 1] as number) * 3;
      const i2 = (ix[t + 2] as number) * 3;
      for (const [a, c] of [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1]] as const) {
        const k = 1 - a - c;
        const x = a * (p[i0] as number) + c * (p[i1] as number) + k * (p[i2] as number);
        const y = a * (p[i0 + 1] as number) + c * (p[i1 + 1] as number) + k * (p[i2 + 1] as number);
        const z = a * (p[i0 + 2] as number) + c * (p[i1 + 2] as number) + k * (p[i2 + 2] as number);
        const sp = T.spacingAt(x, z);
        if (Number.isNaN(sp)) continue;
        const gap = y - T.heightAt(x, z);
        // Every ring in view, a drop to the sea included (nothing excused): where does the terrain win the depth test?
        m.all++;
        const d = Math.max(1, Math.hypot(x - cam.x, z - cam.z));
        if (-gap > depthStep(d)) {
          m.wins++;
          m.worstWin = Math.max(m.worstWin, -gap - depthStep(d));
        }
        if (!(sp <= 2)) continue;
        if (gap < -0.02 && nearDrop(seed, x, z)) {
          m.lips++;
          continue;
        }
        m.samples++;
        if (gap < -0.02) m.under2++;
        if (gap < -0.05) m.under5++;
        // (Not on the highway's bed: the engine paints its road there, over whatever the ground would be.)
        if (T.sandAt(x, z) > 0.2 && Math.abs(x - g.roadX(z)) >= ROAD_BED_HALF) m.sand++;
      }
    }
  }
  return m;
}

/** The camera on the start, and on the middle of the lowest street (the flats the sea is nearest). */
function cameras(seed: number): { x: number; z: number }[] {
  const g = townGround(seed);
  const start = townStart(seed);
  let low = Infinity;
  let at = { x: start.x, z: start.z };
  for (const s of g.plan.streets) {
    if (s.kind !== "street" && s.kind !== "avenue" && s.kind !== "main") continue;
    const x = (s.a.x + s.b.x) / 2 + g.anchor.x;
    const z = (s.a.z + s.b.z) / 2 + g.anchor.z;
    const h = g.heightAt(x, z);
    if (h < low) {
      low = h;
      at = { x, z };
    }
  }
  return [{ x: start.x, z: start.z }, at];
}

describe("the terrain the engine draws under the town's flat surfaces", () => {
  for (const seed of SEEDS) {
    for (const tier of ["medium", "low"] as const) {
      if (tier === "low" && seed !== SORROW) continue;
      it(`seed ${seed}, ${tier} tier: it paints as soil, not sand, and stands under them`, () => {
        for (const cam of cameras(seed)) {
          const m = measure(seed, cam, tier);
          const share = (n: number): number => n / Math.max(1, m.samples);
          console.log(`seed ${seed} ${tier} cam ${cam.x.toFixed(0)},${cam.z.toFixed(0)}: ${m.samples} samples, sand ${(share(m.sand) * 100).toFixed(2)}%, mesh over a surface by 2 cm ${(share(m.under2) * 100).toFixed(2)}%, by 5 cm ${(share(m.under5) * 100).toFixed(2)}% (${m.lips} more at a drop to the sea); over every ring, the terrain beats the depth step at ${m.wins} of ${m.all} samples (by ${m.worstWin.toFixed(3)} m at most)`);
          expect(m.samples).toBeGreaterThan(20_000);
          // The terrain under and beside every street, sidewalk, junction and paved block paints as soil.
          expect(share(m.sand), `sand under the town's flats (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(0.05);
          // The mesh is under them but for a sliver: at most 1.5 percent of the samples stand 2 cm over and 0.6 percent 5 cm over (3.5 and 2 percent on the low tier, whose rings are twice as coarse).
          // Where the terrain beats the engine's depth offset it shows over a street: at the lip of a drop to the sea too, and in the coarse rings.
          expect(m.wins / Math.max(1, m.all), `terrain over a surface, past the depth step (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(1e-4);
          expect(share(m.under2), `mesh 2 cm over a surface (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(tier === "low" ? 0.035 : 0.015);
          expect(share(m.under5), `mesh 5 cm over a surface (seed ${seed}, ${tier}, camera ${cam.x.toFixed(0)},${cam.z.toFixed(0)})`).toBeLessThan(tier === "low" ? 0.02 : 0.006);
        }
      }, 600_000);
    }
  }
});
/**
 * The paved ground that is not a street (a paved district's block, a lone business's apron: `pavedGround.ts`), against the flat layer and the terrain under it. Every point of
 * those polygons, outside the buildings and the streets' rights of way, should be under a flat surface (else the terrain shows, and it paints by the engine's own mottle of
 * grass and leaf litter, which the game cannot change), and the terrain's mesh should be under that surface by more than the engine's depth step allows it to win.
 */
describe("the terrain the engine draws under the town's paved ground", () => {
  for (const seed of [SORROW, WORLD_SEEDS[0] as number]) {
    it(`seed ${seed}: the paved polygons are covered by a flat surface, and the mesh is under it`, () => {
      const g = townGround(seed);
      const plan = g.plan;
      const polys = pavedGround(plan);
      // (A lone fire hall's apron, where the town has one: no gas station or motel stands past the last blocks, so most plans have none, and the camera stands at a paved block's corner.)
      const apron = polys.find((q) => q.kind === "apron") ?? polys.find((q) => q.kind === "block");
      expect(apron, "paved ground on the plan").toBeDefined();
      const c = (apron as (typeof polys)[number]).polygon[0] as { x: number; z: number };
      const cam = { x: c.x + g.anchor.x, z: c.z + g.anchor.z };
      const batches = finish(townGeometry(g, "full", cam));
      const tris: { x0: number; x1: number; z0: number; z1: number; p: number[]; y: number[] }[] = [];
      for (const b of batches) {
        if (b.layer !== "flat") continue;
        const p = b.arrays.positions;
        const ix = b.arrays.indices;
        for (let k = 0; k < ix.length; k += 3) {
          const i = [ix[k] as number, ix[k + 1] as number, ix[k + 2] as number];
          const xs = i.map((q) => p[q * 3] as number);
          const zs = i.map((q) => p[q * 3 + 2] as number);
          tris.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), p: [xs[0] as number, zs[0] as number, xs[1] as number, zs[1] as number, xs[2] as number, zs[2] as number], y: i.map((q) => p[q * 3 + 1] as number) });
        }
      }
      const CELL = 8;
      const grid = new Map<string, number[]>();
      tris.forEach((tr, k) => {
        for (let ix = Math.floor(tr.x0 / CELL); ix <= Math.floor(tr.x1 / CELL); ix++) {
          for (let iz = Math.floor(tr.z0 / CELL); iz <= Math.floor(tr.z1 / CELL); iz++) {
            const key = `${ix},${iz}`;
            const l = grid.get(key);
            if (l === undefined) grid.set(key, [k]);
            else l.push(k);
          }
        }
      });
      /** The height of the flat surface at a point, or NaN where none lies. */
      const surfaceAt = (x: number, z: number): number => {
        for (const k of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
          const tr = tris[k] as (typeof tris)[number];
          if (x < tr.x0 || x > tr.x1 || z < tr.z0 || z > tr.z1) continue;
          const [ax, az, bx, bz, cx, cz] = tr.p as [number, number, number, number, number, number];
          const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          if (Math.abs(den) < 1e-12) continue;
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
          return l1 * (tr.y[0] as number) + l2 * (tr.y[1] as number) + l3 * (tr.y[2] as number);
        }
        return NaN;
      };
      const feet = plan.buildings
        .filter((b) => b.lot !== -1)
        .map((b) => ({ b, u: bearingU(b.bearing), v: bearingV(b.bearing) }));
      const underBuilding = (x: number, z: number): boolean => feet.some(({ b, u, v }) => Math.abs((x - b.centre.x) * u.x + (z - b.centre.z) * u.z) <= b.halfAlong + 0.5 && Math.abs((x - b.centre.x) * v.x + (z - b.centre.z) * v.z) <= b.halfAcross + 0.5);
      const onStreet = (x: number, z: number): boolean =>
        plan.streets.some((s) => {
          if (s.kind === "highway" || s.kind === "rail" || s.kind === "wharf") return false;
          const dx = s.b.x - s.a.x;
          const dz = s.b.z - s.a.z;
          const l2 = dx * dx + dz * dz;
          const tt = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2));
          return Math.hypot(x - s.a.x - dx * tt, z - s.a.z - dz * tt) < s.width / 2;
        });
      for (const tier of ["medium", "low"] as const) {
        const T = drawnTerrain(seed, cam.x, cam.z, tier);
        for (const kind of polys.some((q) => q.kind === "apron") ? (["apron", "block"] as const) : (["block"] as const)) {
          let pts = 0;
          let bare = 0;
          let bareGrass = 0;
          let wins = 0;
          let all = 0;
          for (const q of polys) {
            if (q.kind !== kind) continue;
            const xs = q.polygon.map((p) => p.x);
            const zs = q.polygon.map((p) => p.z);
            // A lattice of 1 m, started a third of a metre in so that no point lies on a polygon's edge, where float32 corners decide by rounding.
            for (let x = Math.min(...xs) + 0.37; x < Math.max(...xs); x += 1) {
              for (let z = Math.min(...zs) + 0.37; z < Math.max(...zs); z += 1) {
                if (!contains(q.polygon, { x, z }, 0) || underBuilding(x, z) || onStreet(x, z)) continue;
                const wx = x + g.anchor.x;
                const wz = z + g.anchor.z;
                if (Number.isNaN(T.heightAt(wx, wz))) continue;
                pts++;
                const y = surfaceAt(wx, wz);
                if (Number.isNaN(y)) {
                  bare++;
                  if (T.grassAt(wx, wz) > 0.3) bareGrass++;
                  continue;
                }
                all++;
                const d = Math.max(1, Math.hypot(wx - cam.x, wz - cam.z));
                if (T.heightAt(wx, wz) - y > depthStep(d)) wins++;
              }
            }
          }
          console.log(`seed ${seed} ${tier} ${kind}s: ${pts} points, ${bare} bare of a flat surface (${bareGrass} painted grass), terrain over a surface past the depth step at ${wins} of ${all}`);
          expect(pts).toBeGreaterThan(kind === "apron" ? 500 : 5000);
          // What is left bare is the slivers beside buildings and the streets' edges: under 2 percent.
          expect(bare / pts, `bare ground in the ${kind}s (seed ${seed}, ${tier})`).toBeLessThan(0.02);
          expect(wins / Math.max(1, all), `terrain over the ${kind}s' surface (seed ${seed}, ${tier})`).toBeLessThan(1e-4);
        }
      }
    }, 600_000);
  }
});

