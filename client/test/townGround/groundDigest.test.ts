import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";
import { createGroundField } from "@csarkosh/engine/sim/ground";
import { coastGround, roadCenterX, roadCorridorOverD } from "@csarkosh/engine/sim/olympic";
import { activeTerrainVariant, elevationAt, elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { townBlendWindowD } from "../../src/sim/town/blend.js";
import { clearAt, townClutterStands, townCover, townFeatureMask, townKeepD, townStripWeight, townYardWeight } from "../../src/sim/town/clearing.js";
import { coverD } from "../../src/sim/town/cover.js";
import { deckTopAt } from "../../src/sim/town/decks.js";
import { fillWindowD, smootherstepD } from "../../src/sim/town/fill.js";
import { alongD, bankD, inlandD, madePlaneD, townGroundD } from "../../src/sim/town/ground.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { railGroundD } from "../../src/sim/town/railGround.js";
import { siteFor } from "../../src/sim/town/siteFor.js";
import { streetChannelD, streetLiftD, streetLowerD, withStreets } from "../../src/sim/town/streetField.js";

/**
 * The town's ground, to the bit. Every function the ground under the town is made of is asked at many thousand places
 * and the doubles it answers are folded into a digest; the digests below were taken from the functions as they stood
 * before any was rewritten to answer without making an object (they were a fifth of a load's short-lived memory). A
 * rewrite of how a function carries its answer must leave every digest as it is: the arithmetic and its order are the
 * world's identity.
 *
 * A digest that moves means the arithmetic moved. Put the arithmetic back; never the digest.
 */

const SEEDS = [20261121, 1, 6];

/** Folds doubles into 64 bits, by their own bits. */
class Digest {
  private a = 0x811c9dc5 | 0;
  private b = 0x01000193 | 0;
  private readonly f = new Float64Array(1);
  private readonly u = new Uint32Array(this.f.buffer);
  count = 0;
  add(n: number): void {
    this.f[0] = n;
    const lo = this.u[0] as number, hi = this.u[1] as number;
    this.a = Math.imul(this.a ^ lo, 0x01000193);
    this.a = Math.imul(this.a ^ hi, 0x01000193);
    this.b = (Math.imul(this.b ^ hi, 0x85ebca6b) + lo) | 0;
    this.b = (this.b << 13) | (this.b >>> 19);
    this.count++;
  }
  rec(o: Readonly<Record<string, number>>, keys: readonly string[]): void {
    for (const k of keys) this.add(o[k] as number);
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0");
  }
}

/** A run of numbers in [0, 1) of its own (mulberry32): the places asked are no function of what is under test. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HDXZ = ["h", "dx", "dz"] as const;
const VDXZ = ["v", "dx", "dz"] as const;
const MASK = ["tree", "clutter", "meadow", "bare"] as const;

/** Places over the town and round it: three in four within the town's own reach of its anchor, the rest out to the sea, the massif and along the coast. */
function places(seed: number, n: number, each: (x: number, z: number) => void): void {
  const r = rng(seed ^ 0x70a7);
  const ax = siteFor(seed).anchor.x;
  for (let i = 0; i < n; i++) {
    const kind = i % 4;
    if (kind === 0) each(ax - 1500 + r() * 3600, (r() - 0.5) * 5000);
    else if (kind === 1) each(roadCenterX(seed, 0) + (r() - 0.5) * 500, (r() - 0.5) * 1700);
    else each(ax - 250 + r() * 950, (r() - 0.5) * 1500);
  }
}

function digests(): Record<string, string> {
  const out: Record<string, string> = {};
  const group = (name: string, fill: (d: Digest) => void): void => {
    const d = new Digest();
    fill(d);
    out[name] = `${d.hex()}/${d.count}`;
  };
  const v = activeTerrainVariant();

  for (const seed of SEEDS) {
    const plan = planFor(seed);
    const ax = siteFor(seed).anchor.x;

    group(`world:${seed}`, (d) => {
      places(seed, 60000, (x, z) => {
        d.rec(v.sample(seed, x, z), HDXZ);
        d.add(elevationAt(seed, x, z));
      });
    });

    group(`hooks:${seed}`, (d) => {
      places(seed, 30000, (x, z) => {
        d.add(v.coastDistance?.(seed, x, z) ?? 0);
        d.add(v.roadDistance?.(seed, x, z) ?? 0);
        d.add(v.coveMask?.(seed, x, z) ?? 0);
        const m = v.featureMask?.(seed, x, z);
        if (m !== undefined) {
          d.rec(m, MASK);
          d.add(m.loose ?? 1);
        }
        d.add(v.shoreStrip?.at(seed, x, z) ?? 0);
        d.add(v.clutterStands?.(seed, (x * 7 + z) & 7, x, z) === false ? 0 : 1);
        d.add(v.wildlifeGround?.(seed, (x + z * 3) & 3, x, z) === false ? 0 : 1);
        d.add(deckTopAt(seed, x, z) ?? -1);
      });
    });

    group(`town:${seed}`, (d) => {
      places(seed, 40000, (x, z) => {
        const c = coastGround(seed, x, z);
        const made = townGroundD(seed, x, z, c.u, c.uDz, c.ground);
        d.rec(made, HDXZ);
        d.rec(townGroundD(seed, x, z, c.u, c.uDz, c.ground, plan.fill), HDXZ);
        const cut = streetChannelD(seed, x, z, made);
        d.rec(cut, HDXZ);
        const railed = railGroundD(seed, z, c.u, c.uDz, cut);
        d.rec(railed, HDXZ);
        d.rec(roadCorridorOverD(seed, z, c.u, c.uDz, railed), HDXZ);
        const plane = madePlaneD(seed, x, z, c.u, c.uDz);
        if (plane === null) d.add(-1);
        else d.rec(plane, HDXZ);
        d.rec(streetLowerD(seed, x, z), VDXZ);
        d.rec(streetLiftD(seed, x, z), VDXZ);
        d.rec(townKeepD(c.u, c.uDz, z, seed), VDXZ);
        const w = townBlendWindowD(z, seed);
        d.add(w.v); d.add(w.dz);
        d.add(townCover(seed, x, z));
        d.rec(townFeatureMask(seed, x, z), MASK);
        d.add(townClutterStands(seed, (x + z) & 7, x, z) ? 1 : 0);
        d.add(townYardWeight(seed, x, z));
        d.add(townStripWeight(seed, x, z));
        const xf = x - ax;
        d.rec(coverD(plan, xf, z, true), VDXZ);
        d.rec(fillWindowD(plan.fill, xf, z), VDXZ);
        const cl = clearAt(plan, xf, z);
        d.add(cl.tree); d.add(cl.clutter); d.add(cl.yard); d.add(cl.meadow);
      });
    });

    group(`walked:${seed}`, (d) => {
      const field = withStreets(createGroundField(seed), seed);
      const n = { x: 0, y: 0, z: 0 };
      places(seed, 20000, (x, z) => {
        const h = field.heightAt(x, z);
        d.add(h);
        d.rec(elevationSampleAt(seed, x, z), HDXZ);
        field.normalAt(x, z, n);
        d.add(n.x); d.add(n.y); d.add(n.z);
        d.add(field.above?.(x, h + 0.03, z) === true ? 1 : 0);
        d.add(field.standNormalY?.(x, z) ?? 0);
      });
    });
  }

  group("windows", (d) => {
    const r = rng(77);
    for (let i = 0; i < 80000; i++) {
      const s = smootherstepD(-3 + r() * 2, 4 + r() * 2, (r() - 0.5) * 14);
      d.add(s.v); d.add(s.d);
      const a = alongD((r() - 0.5) * 2400);
      d.add(a.v); d.add(a.dz);
      const inl = inlandD((r() - 0.5) * 1600);
      d.add(inl.v); d.add(inl.du);
      const b = bankD((r() - 0.5) * 40, (r() - 0.5) * 2, (r() - 0.5) * 3, (r() - 0.5) * 0.1);
      d.rec(b, VDXZ);
      d.add(b.foot);
    }
  });

  return out;
}

const PINNED: Record<string, string> = {
  "hooks:1": "ef41836ebe1f5bdb/360000",
  "hooks:20261121": "ca6cb03f0f345312/360000",
  "hooks:6": "12d6749702cac598/360000",
  "town:1": "a9dd0d10d83af95a/1880000",
  "town:20261121": "8433fd179a61a1c4/1880000",
  "town:6": "20a7eabc602ebbb2/1880000",
  "walked:1": "a8ec5139d3952625/180000",
  "walked:20261121": "00961a0075ff1db7/180000",
  "walked:6": "ac79788bd20460cb/180000",
  windows: "89b5a4c96dc02509/800000",
  "world:1": "08bfb89bb2d4d2ab/240000",
  "world:20261121": "a30d02b9d405512c/240000",
  "world:6": "b8cc32f8065fb906/240000",
};

describe("the town's ground", () => {
  it("is what it was, to the bit", () => {
    expect(digests()).toEqual(PINNED);
  }, timeLimit(600_000));
});
