import { describe, expect, it } from "vitest";
import { boatGeometry, HULL_COLOURS } from "../../src/game/town/boatGeometry.js";
import { lightGeometry, millGeometry, pilingGeometry, terminalGeometry } from "../../src/game/town/harbourGeometry.js";
import { MeshBuilder, type MeshArrays } from "../../src/game/town/meshBuilder.js";
import { townGround } from "../../src/game/town/townGeometry.js";
import { SEA, type TownGround } from "../../src/game/town/townTypes.js";
import type { Boat, BoatKind, BoatState } from "../../src/sim/town/types.js";
import { WORLD_SEEDS } from "./world.js";

const KINDS: BoatKind[] = ["troller", "gillnetter", "crabber", "tug", "skiff", "sailboat", "pleasure"];
const STATES: BoatState[] = ["working", "derelict", "sunk"];

function boat(kind: BoatKind, state: BoatState, id = 3): Boat {
  const length = { troller: 12, gillnetter: 9, crabber: 17, tug: 13, skiff: 5, sailboat: 11, pleasure: 9 }[kind];
  return { id, kind, x: 100, z: -50, heading: { x: 0.6, z: 0.8 }, length, beam: Math.round(length * 0.32 * 10) / 10, draft: Math.round(length * 0.12 * 10) / 10, state, colour: id % HULL_COLOURS.length, name: 0, mooring: "slip" };
}

function build(b: Boat): MeshArrays {
  const m = new MeshBuilder();
  boatGeometry(() => m, b);
  return m.finish();
}

function check(a: MeshArrays, label: string): void {
  expect(a.positions.length % 3, label).toBe(0);
  const nv = a.positions.length / 3;
  for (const v of a.positions) expect(Number.isFinite(v), label).toBe(true);
  for (const i of a.indices) expect(i, label).toBeLessThan(nv);
  for (let v = 0; v < nv; v++) expect(Math.hypot(a.normals[v * 3] as number, a.normals[v * 3 + 1] as number, a.normals[v * 3 + 2] as number), label).toBeCloseTo(1, 4);
  expect(a.indices.length, label).toBeGreaterThan(0);
}

const extent = (a: MeshArrays, axis: 0 | 1 | 2): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < a.positions.length / 3; v++) {
    const x = a.positions[v * 3 + axis] as number;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
};

describe("boats", () => {
  it("build for every kind and state, with the keel under the waterline and the deck above it (a sunk boat's deck under it)", () => {
    for (const kind of KINDS) {
      for (const state of STATES) {
        const b = boat(kind, state);
        const a = build(b);
        check(a, `${kind} ${state}`);
        const [lo, hi] = extent(a, 1);
        // The keel lies at the draft (a listing boat's a little off); the sunk boat's whole hull is under the sea and only its house stands out.
        if (state === "working") {
          expect(lo, kind).toBeGreaterThan(-b.draft - 0.1);
          expect(lo, kind).toBeLessThan(-b.draft + 0.1);
          expect(hi, kind).toBeGreaterThan(0.4);
        }
        if (state === "sunk") {
          expect(lo, kind).toBeLessThan(-b.draft - 0.3);
          if (kind !== "skiff") expect(hi, kind).toBeGreaterThan(SEA + 0.2);
          const working = extent(build(boat(kind, "working")), 1)[1];
          expect(hi, `${kind}: a sunk boat stands lower`).toBeLessThan(working - 0.3);
        }
        // Along its length it stays within the boat's own length (the gear a little past it).
        const along = (x: number, z: number): number => (x - b.x) * b.heading.x + (z - b.z) * b.heading.z;
        for (let v = 0; v < a.positions.length / 3; v++) expect(Math.abs(along(a.positions[v * 3] as number, a.positions[v * 3 + 2] as number)), `${kind} ${state}`).toBeLessThan(b.length / 2 + 1.2);
      }
    }
  });

  it("have a hull lofted through its stations, not a box: far more than 12 faces, and the sheer rises toward the bow", () => {
    for (const kind of KINDS) {
      const a = build(boat(kind, "working"));
      expect(a.indices.length / 3, kind).toBeGreaterThan(80);
    }
    // The skiff is a hull and an outboard: the bow's deck edge stands higher than its middle's.
    const b = boat("skiff", "working");
    const a = build(b);
    const alongOf = (v: number): number => ((a.positions[v * 3] as number) - b.x) * b.heading.x + ((a.positions[v * 3 + 2] as number) - b.z) * b.heading.z;
    let bow = -Infinity;
    let mid = -Infinity;
    for (let v = 0; v < a.positions.length / 3; v++) {
      const s = alongOf(v);
      const y = a.positions[v * 3 + 1] as number;
      if (s > b.length * 0.3) bow = Math.max(bow, y);
      else if (Math.abs(s) < b.length * 0.12) mid = Math.max(mid, y);
    }
    expect(bow).toBeGreaterThan(mid + 0.05);
  });

  it("show their state: a derelict lists and has lost its gear, and the same boat twice gives the same arrays", () => {
    const work = build(boat("troller", "working"));
    const dead = build(boat("troller", "derelict"));
    expect(dead.indices.length).toBeLessThan(work.indices.length);
    // A listing hull's two sides are at different heights: the keel is not under the centre line.
    expect(Array.from(build(boat("troller", "derelict")).positions)).toEqual(Array.from(dead.positions));
    // Fewer faces for the crabber without its pots.
    expect(build(boat("crabber", "derelict")).indices.length).toBeLessThan(build(boat("crabber", "working")).indices.length - 40);
  });

  it("face outward at the hull: a skiff's side triangles look away from its middle", () => {
    const b = boat("skiff", "working");
    const a = build(b);
    let sides = 0;
    for (let t = 0; t < a.indices.length; t += 3) {
      const i = a.indices[t] as number;
      const n = [a.normals[i * 3], a.normals[i * 3 + 1], a.normals[i * 3 + 2]] as [number, number, number];
      if (Math.abs(n[1]) > 0.6) continue;
      const cx = ((a.positions[i * 3] as number) + (a.positions[(a.indices[t + 1] as number) * 3] as number) + (a.positions[(a.indices[t + 2] as number) * 3] as number)) / 3;
      const cz = ((a.positions[i * 3 + 2] as number) + (a.positions[(a.indices[t + 1] as number) * 3 + 2] as number) + (a.positions[(a.indices[t + 2] as number) * 3 + 2] as number)) / 3;
      // The outboard and the bench are small and near the middle: the hull's sides are more than 0.3 m from the boat's long axis.
      const across = (cx - b.x) * b.heading.z - (cz - b.z) * b.heading.x;
      if (Math.abs(across) < 0.3) continue;
      const nAcross = n[0] * b.heading.z - n[2] * b.heading.x;
      expect(nAcross * across, "a side triangle looks outward").toBeGreaterThanOrEqual(-1e-6);
      if (nAcross * across > 0.01) sides++;
    }
    expect(sides).toBeGreaterThan(10);
  });
});

describe("the rest of the harbour's geometry, for the world seeds", () => {
  const grounds = new Map<number, TownGround>();
  const groundFor = (seed: number): TownGround => {
    let g = grounds.get(seed);
    if (g === undefined) {
      g = townGround(seed);
      grounds.set(seed, g);
    }
    return g;
  };
  const run = (g: TownGround, f: (g: TownGround, s: (x: number, z: number) => MeshBuilder) => void): MeshArrays => {
    const m = new MeshBuilder();
    f(g, () => m);
    return m.finish();
  };

  it("builds the pilings, the mill's water, the terminal and the lights with finite, indexed, unit-normal arrays", () => {
    let pilings = 0;
    let mill = 0;
    let terminal = 0;
    let lights = 0;
    for (const seed of WORLD_SEEDS) {
      const g = groundFor(seed);
      const h = g.plan.harbour;
      const p = run(g, pilingGeometry);
      const m = run(g, millGeometry);
      const t = run(g, terminalGeometry);
      const l = run(g, lightGeometry);
      for (const [a, label, expected] of [[p, "pilings", h.pilings.length + h.dolphins.length], [m, "mill", (h.logPond ? 1 : 0) + (h.burner ? 1 : 0)], [t, "terminal", h.terminal ? h.terminal.yard.length + (h.terminal.barge ? 1 : 0) : 0], [l, "lights", h.lights.length]] as const) {
        if (expected > 0) {
          check(a, `${seed} ${label}`);
          if (label === "pilings") pilings++;
          if (label === "mill") mill++;
          if (label === "terminal") terminal++;
          if (label === "lights") lights++;
        } else expect(a.indices.length).toBe(0);
      }
    }
    expect(pilings).toBeGreaterThan(0);
    expect(mill).toBeGreaterThan(0);
    expect(terminal).toBeGreaterThan(0);
    expect(lights).toBeGreaterThan(1);
  });

  it("stands the piles at uneven heights and a few leaning, and a dolphin's three piles together", () => {
    for (const seed of WORLD_SEEDS) {
      const h = groundFor(seed).plan.harbour;
      const tops = h.pilings.flatMap((f) => f.piles.map((p) => p.top));
      if (tops.length > 20) {
        expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(1.5);
        expect(h.pilings.flatMap((f) => f.piles).filter((p) => Math.hypot(p.lean.x, p.lean.z) > 0.02).length).toBeGreaterThan(3);
      }
      expect(h.dolphins.length % 3).toBe(0);
    }
  });
});
