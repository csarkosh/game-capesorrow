/**
 * The town's overlay answers at once beyond its reach (`townReachOf`), and every answer is what it was to the bit. Today's hooks are
 * kept whole as the `…Full` functions, which ask every stage at every point: they are the oracle. Each hook the engine is handed
 * (`PORTASHTON_PLACE`) is compared with its oracle, field by field with `Object.is`, along the highway for 3 km beyond the town either way,
 * on a dense grid across each side of the reach, at random points across the coast and at random points inside the town. Then, for
 * points outside the reach, each stage's own "nothing here" is checked directly, so the reach is shown to hold every stage's.
 */
import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { COVE_Z, roadCenterX } from "@csarkosh/engine/sim/olympic";
import { UNIT_KEEP } from "@csarkosh/engine/sim/cliffs";
import { CLUTTER_CLASS_COUNT } from "@csarkosh/engine/sim/clutter";
import type { FeatureMask } from "@csarkosh/engine/sim/features";
import type { TerrainSample } from "@csarkosh/engine/sim/terrain";
import { ROAD_KEEP_HALF, ROAD_KEEP_RAMP, clearAt, townClutterStandsFull, townFeatureMask, townFeatureMaskFull, townKeepD, townKeepDFull, townReachOf, townStripWeightFull, type TownReach } from "../../src/sim/town/clearing.js";
import { COVER_FADE, COVER_HOLD, coverD } from "../../src/sim/town/cover.js";
import { QUAY_BANK } from "../../src/sim/town/fill.js";
import { segDist } from "../../src/sim/town/geom.js";
import { PORTASHTON_PLACE, shapeDFull } from "../../src/sim/town/place.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { railFeatureMask } from "../../src/sim/town/railClearing.js";
import { RAIL_GROUND, railGroundInto } from "../../src/sim/town/railGround.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { streetLiftD, streetLowerD } from "../../src/sim/town/streetField.js";
import { vergeMask, vergeWeight, vergeWeightAt } from "../../src/sim/town/verge.js";

/** The game's own world first, then two more coasts. */
const SEEDS = [20261121, 1, 7];

/** A world point, with what the engine hands the hooks there: the offset from the highway, its slope in z, and a base sample. */
type Pt = { x: number; z: number; u: number; uDz: number; base: TerrainSample };

/** A small deterministic stream of numbers in [0, 1). */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** A point at world (x, z): the offset from the highway as the coast has it, and a slope and base sample drawn from `r`. */
function point(seed: number, x: number, z: number, r: () => number): Pt {
  const u = x - roadCenterX(seed, z);
  return { x, z, u, uDz: (r() - 0.5) * 0.6, base: { h: -8 + r() * 70, dx: (r() - 0.5) * 0.8, dz: (r() - 0.5) * 0.8 } };
}

/** A point whose `townKeepD` frame lands at plan-frame x `xf` (the hook reads x from `u`, so `u` is chosen for it). */
function framePoint(seed: number, ax: number, xf: number, zr: number, r: () => number): Pt {
  return point(seed, ax + xf, COVE_Z + zr, r);
}

function reachOf(seed: number): { reach: TownReach; ax: number } {
  return { reach: townReachOf(planFor(seed)), ax: siteFor(seed).anchor.x };
}

function outside(reach: TownReach, ax: number, x: number, z: number): boolean {
  const xf = x - ax;
  const zr = z - COVE_Z;
  return xf < reach.x0 || xf > reach.x1 || zr < reach.z0 || zr > reach.z1;
}

/** The highway for 3 km beyond the town's reach either way, every 2 m, across its width. */
function highway(seed: number): Pt[] {
  const { reach } = reachOf(seed);
  const r = stream(seed ^ 0x4817);
  const out: Pt[] = [];
  for (let zr = reach.z0 - 3000; zr <= reach.z1 + 3000; zr += 2) {
    const z = COVE_Z + zr;
    const rc = roadCenterX(seed, z);
    for (const off of [-9, -4.5, -1.5, 0, 1.5, 4.5, 9]) out.push(point(seed, rc + off, z, r));
  }
  return out;
}

/** A grid across each side of the reach: 12 m either side of it every 0.5 m, along it every 10 m and 30 m past its corners. */
function edges(seed: number): Pt[] {
  const { reach, ax } = reachOf(seed);
  const r = stream(seed ^ 0x3d11);
  const out: Pt[] = [];
  for (let d = -12; d <= 12; d += 0.5) {
    for (let zr = reach.z0 - 30; zr <= reach.z1 + 30; zr += 10) {
      out.push(framePoint(seed, ax, reach.x0 + d, zr, r));
      out.push(framePoint(seed, ax, reach.x1 + d, zr, r));
    }
    for (let xf = reach.x0 - 30; xf <= reach.x1 + 30; xf += 10) {
      out.push(framePoint(seed, ax, xf, reach.z0 + d, r));
      out.push(framePoint(seed, ax, xf, reach.z1 + d, r));
    }
  }
  return out;
}

/** Random points across the coast: 20 km along it either way of the cove, 3 km to sea and inland of the highway. */
function coast(seed: number, n: number): Pt[] {
  const r = stream(seed ^ 0x6c0a57);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const z = COVE_Z + (r() - 0.5) * 40000;
    out.push(point(seed, roadCenterX(seed, z) + (r() - 0.5) * 6000, z, r));
  }
  return out;
}

/** Random points inside the reach. */
function inside(seed: number, n: number): Pt[] {
  const { reach, ax } = reachOf(seed);
  const r = stream(seed ^ 0x1a51de);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(framePoint(seed, ax, reach.x0 + r() * (reach.x1 - reach.x0), reach.z0 + r() * (reach.z1 - reach.z0), r));
  return out;
}

const MASK_FIELDS = ["tree", "clutter", "meadow", "bare", "loose"] as const;

function sameMask(a: FeatureMask, b: FeatureMask): boolean {
  if (Object.keys(a).join() !== Object.keys(b).join()) return false;
  for (const f of MASK_FIELDS) if (!Object.is(a[f], b[f])) return false;
  return true;
}

function sameTriple(a: { v: number; dx: number; dz: number }, b: { v: number; dx: number; dz: number }): boolean {
  return Object.is(a.v, b.v) && Object.is(a.dx, b.dx) && Object.is(a.dz, b.dz);
}

/** Every hook the engine is handed against its oracle at each point: the names of those that differ, with the first few points. */
function compare(seed: number, pts: readonly Pt[]): { bad: string[]; out: number; in: number; said: { keep: number; shape: number; mask: number; stands: number; strip: number } } {
  const { reach, ax } = reachOf(seed);
  const keep = PORTASHTON_PLACE.cliffKeepD as NonNullable<typeof PORTASHTON_PLACE.cliffKeepD>;
  const mask = PORTASHTON_PLACE.featureMask as NonNullable<typeof PORTASHTON_PLACE.featureMask>;
  const stands = PORTASHTON_PLACE.clutterStands as NonNullable<typeof PORTASHTON_PLACE.clutterStands>;
  const strip = (PORTASHTON_PLACE.shoreStrip as NonNullable<typeof PORTASHTON_PLACE.shoreStrip>).at;
  const bad: string[] = [];
  let nOut = 0;
  let nIn = 0;
  // How many answers say something (the oracle's): so the points are known to reach the town's stages, not only their edges.
  const said = { keep: 0, shape: 0, mask: 0, stands: 0, strip: 0 };
  const miss = (what: string, p: Pt): void => {
    if (bad.length < 12) bad.push(`${what} at (${p.x}, ${p.z}) u=${p.u}`);
  };
  for (const p of pts) {
    if (outside(reach, ax, p.x, p.z)) nOut++;
    else nIn++;
    const ka = keep(p.u, p.uDz, p.z, seed);
    const kb = townKeepDFull(p.u, p.uDz, p.z, seed);
    if (Object.is(ka, UNIT_KEEP) !== Object.is(kb, UNIT_KEEP) || !sameTriple(ka, kb)) miss("cliffKeepD", p);
    if (kb.v !== 1) said.keep++;
    const kc = townKeepD(p.u, p.uDz, p.z, seed);
    if (Object.is(kc, UNIT_KEEP) !== Object.is(kb, UNIT_KEEP) || !sameTriple(kc, kb)) miss("townKeepD", p);
    // A base of its own for each call, so that "the same object" is a question of each path alone.
    const baseA = { ...p.base };
    const baseB = { ...p.base };
    const sa = PORTASHTON_PLACE.shapeD(seed, p.x, p.z, p.u, p.uDz, baseA);
    const sb = shapeDFull(seed, p.x, p.z, p.u, p.uDz, baseB);
    if (Object.is(sa, baseA) !== Object.is(sb, baseB) || !Object.is(sa.h, sb.h) || !Object.is(sa.dx, sb.dx) || !Object.is(sa.dz, sb.dz)) miss("shapeD", p);
    if (sb !== baseB) said.shape++;
    const ma = mask(seed, p.x, p.z, p.base.h);
    // The place lays the verge (`verge.ts`: the made ground's rest and the highway's and railroad's corridor, the whole coast long) over the
    // town's own mask and strip, so the oracle does too, from the town's full stages: what is held to the bit is still the town's early answer.
    const townMask = railFeatureMask(seed, p.x, p.z, townFeatureMaskFull(seed, p.x, p.z));
    const vw = vergeWeightAt(seed, p.x, p.z, p.base.h);
    const mb = vw === 0 ? townMask : vergeMask(seed, p.x, p.z, p.base.h, vw, townStripWeightFull(seed, p.x, p.z), townMask);
    if (!sameMask(ma, mb)) miss("featureMask", p);
    if (mb.tree !== 1 || mb.clutter !== 1 || mb.meadow !== 0 || mb.loose !== undefined) said.mask++;
    if (!sameMask(townFeatureMask(seed, p.x, p.z), townFeatureMaskFull(seed, p.x, p.z))) miss("townFeatureMask", p);
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const st = townClutterStandsFull(seed, cls, p.x, p.z);
      if (stands(seed, cls, p.x, p.z) !== st) miss(`clutterStands(${cls})`, p);
      if (!st) said.stands++;
    }
    const ownStrip = townStripWeightFull(seed, p.x, p.z);
    const sw = ownStrip === 1 ? 1 : Math.max(vergeWeight(seed, p.x, p.z), ownStrip);
    if (!Object.is(strip(seed, p.x, p.z), sw)) miss("shoreStrip", p);
    if (sw !== 0) said.strip++;
  }
  return { bad, out: nOut, in: nIn, said };
}

describe("the town's overlay answers at once beyond its reach, to the bit", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: along the highway 3 km beyond the town either way`, () => {
      const r = compare(seed, highway(seed));
      expect(r.bad).toEqual([]);
      expect(r.out).toBeGreaterThan(10000);
      expect(r.in).toBeGreaterThan(1000);
    });

    it(`seed ${seed}: on a grid across each side of the reach`, () => {
      const r = compare(seed, edges(seed));
      expect(r.bad).toEqual([]);
      expect(r.out).toBeGreaterThan(10000);
      expect(r.in).toBeGreaterThan(10000);
    });

    it(`seed ${seed}: at random points across the coast and inside the town`, () => {
      const c = compare(seed, coast(seed, 20000));
      expect(c.bad).toEqual([]);
      expect(c.out).toBeGreaterThan(15000);
      const t = compare(seed, inside(seed, 10000));
      expect(t.bad).toEqual([]);
      expect(t.in).toBe(10000);
      // Inside the town every hook has something to say at many of the points.
      expect(t.said.keep).toBeGreaterThan(1000);
      expect(t.said.shape).toBeGreaterThan(1000);
      expect(t.said.mask).toBeGreaterThan(1000);
      expect(t.said.stands).toBeGreaterThan(10);
      expect(t.said.strip).toBeGreaterThan(1000);
    });
  }
});

describe("the reach holds every stage's own reach", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: beyond it, every stage says nothing by its own test`, () => {
      const plan = planFor(seed);
      const { reach, ax } = reachOf(seed);
      // The fill's box as the stages find it (`clearing.ts` and `ground.ts`): each polygon's corners grown by the bank.
      let fx0 = Infinity;
      let fz0 = Infinity;
      let fx1 = -Infinity;
      let fz1 = -Infinity;
      for (const area of plan.fill) {
        for (const p of area.polygon) {
          fx0 = Math.min(fx0, p.x - QUAY_BANK);
          fz0 = Math.min(fz0, p.z - QUAY_BANK);
          fx1 = Math.max(fx1, p.x + QUAY_BANK);
          fz1 = Math.max(fz1, p.z + QUAY_BANK);
        }
      }
      const pts = [...edges(seed), ...coast(seed, 20000), ...highway(seed).filter((_, i) => i % 3 === 0)].filter((p) => outside(reach, ax, p.x, p.z));
      expect(pts.length).toBeGreaterThan(30000);
      const far = clearAt(plan, -1e7, -1e7);
      const bad: string[] = [];
      const miss = (what: string, p: Pt): void => {
        if (bad.length < 12) bad.push(`${what} at (${p.x}, ${p.z})`);
      };
      for (const p of pts) {
        const xf = p.x - ax;
        const zr = p.z - COVE_Z;
        // The cover, with and without the outlying lots: no window reaches (`coverInto`).
        const zero = { v: 0, dx: 0, dz: 0 };
        if (!sameTriple(coverD(plan, xf, zr), zero) || !sameTriple(coverD(plan, xf, zr, false), zero)) miss("cover", p);
        // The quay's window is out of reach.
        if (!(segDist({ x: xf, z: zr }, plan.quay.a, plan.quay.b) >= COVER_HOLD + COVER_FADE)) miss("quay", p);
        // Outside the fill's box, where neither stage asks the fill.
        if (!(xf < fx0 || xf > fx1 || zr < fz0 || zr > fz1)) miss("fill box", p);
        // The streets cut nothing: no cell of the street field.
        if (!sameTriple(streetLowerD(seed, p.x, p.z), zero) || !sameTriple(streetLiftD(seed, p.x, p.z), zero)) miss("street field", p);
        // No cell of the clearing's index: the open answer itself, as far from the town as can be.
        if (clearAt(plan, xf, zr) !== far) miss("clearing", p);
        // No road out keeps the cliff bands off.
        for (const road of plan.roads) {
          for (let i = 1; i < road.points.length; i++) {
            if (segDist({ x: xf, z: zr }, road.points[i - 1] as { x: number; z: number }, road.points[i] as { x: number; z: number }) < ROAD_KEEP_HALF + ROAD_KEEP_RAMP) miss("road", p);
          }
        }
        // And the whole hooks, asked of every stage, give the answers the early ones give.
        if (townKeepDFull(p.u, p.uDz, p.z, seed) !== UNIT_KEEP) miss("townKeepDFull", p);
        const m = townFeatureMaskFull(seed, p.x, p.z);
        if (Object.keys(m).join() !== "tree,clutter,meadow,bare" || m.tree !== 1 || m.clutter !== 1 || !Object.is(m.meadow, 0) || !Object.is(m.bare, 0)) miss("townFeatureMaskFull", p);
        for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) if (!townClutterStandsFull(seed, cls, p.x, p.z)) miss("townClutterStandsFull", p);
        if (!Object.is(townStripWeightFull(seed, p.x, p.z), 0)) miss("townStripWeightFull", p);
        // The made ground and the streets leave the ground as it is: only the railroad's bed is laid, if it is there at all.
        const base = { ...p.base };
        const s = shapeDFull(seed, p.x, p.z, p.u, p.uDz, base);
        const railed = railGroundInto(seed, p.z, p.u, p.uDz, base.h, base.dx, base.dz);
        if (railed ? s === base || !Object.is(s.h, RAIL_GROUND.h) || !Object.is(s.dx, RAIL_GROUND.dx) || !Object.is(s.dz, RAIL_GROUND.dz) : s !== base) miss("shapeDFull", p);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("the reach is the town's, not the coast's", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: a few kilometres at most, holding the whole town`, () => {
      const plan = planFor(seed);
      const reach = townReachOf(plan);
      expect(Number.isFinite(reach.x0) && Number.isFinite(reach.x1) && Number.isFinite(reach.z0) && Number.isFinite(reach.z1)).toBe(true);
      // It holds the quay and every building.
      for (const b of plan.buildings) {
        expect(b.centre.x >= reach.x0 && b.centre.x <= reach.x1 && b.centre.z >= reach.z0 && b.centre.z <= reach.z1).toBe(true);
      }
      expect(reach.x1 - reach.x0).toBeLessThan(4000);
      expect(reach.z1 - reach.z0).toBeLessThan(6000);
      // Along the shore it is a small share of the 40 km the coast is sampled over here.
      expect((reach.z1 - reach.z0) / 40000).toBeLessThan(0.15);
    });
  }
});
