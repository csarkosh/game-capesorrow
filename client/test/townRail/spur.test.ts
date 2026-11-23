import { describe, expect, it } from "vitest";
import "../../src/terrain.js";
import { PLAYER_HALF } from "@csarkosh/engine/sim/constants";
import { roadGradeAt } from "@csarkosh/engine/sim/olympic";
import { elevationSampleAt } from "@csarkosh/engine/sim/terrain";
import { RAIL_GAUGE, railCenterX } from "../../src/sim/town/rail.js";
import { TRESTLE_HALF, TRESTLE_TAPER, TRESTLE_TOP, constrainTrestle, spurTrestleTopAt, trestleTopAt } from "../../src/sim/town/railDeck.js";
import { SPUR_GRADE, spurOf } from "../../src/sim/town/railSpur.js";
import { DECK_TOP } from "../../src/sim/town/levels.js";
import { planFor } from "../../src/sim/town/planFor.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { RAIL_TOP } from "../../src/game/town/railGeometry.js";
import { spurGeometry, spurFrames } from "../../src/game/town/spurGeometry.js";
import { townGround } from "../../src/game/town/townGeometry.js";

const SEEDS40 = [20261121, 424242, 123, 99, ...Array.from({ length: 36 }, (_, i) => i + 1)];

describe("the town's spur, as the world has it", () => {
  it("leaves the main line at the main line's height, and falls or rises by no more than a train's grade", () => {
    let spurs = 0;
    for (const seed of SEEDS40) {
      const track = spurOf(seed);
      const plan = planFor(seed);
      if (track === null) {
        // A town has no spur without a railroad, or where the main line stands too high at both its ends to come down to the shore.
        continue;
      }
      spurs++;
      expect(plan.history.railroad, `seed ${seed}`).not.toBeNull();
      const first = track.points[0]!;
      expect(Math.abs(first.x - railCenterX(seed, first.z)), `seed ${seed}: the spur's first point is on the line`).toBeLessThan(1e-9);
      expect(first.h, `seed ${seed}`).toBeCloseTo(roadGradeAt(seed, first.z).h, 9);
      for (let i = 1; i < track.points.length; i++) {
        const a = track.points[i - 1]!;
        const b = track.points[i]!;
        expect(Math.abs(b.h - a.h) / (b.s - a.s), `seed ${seed} point ${i}`).toBeLessThanOrEqual(SPUR_GRADE + 1e-9);
      }
    }
    expect(spurs).toBeGreaterThan(28);
  });

  it("carries each wet stretch on a trestle whose deck is ground a player walks on, at the quay's apron level, with guard rails", () => {
    let trestles = 0;
    for (const seed of SEEDS40) {
      const track = spurOf(seed);
      if (track === null) continue;
      for (const run of track.trestles) {
        trestles++;
        // The deck's level is the apron's, and a point of its middle has the deck's top, the ground field's answer too.
        const mid = track.points[Math.floor((run.from + run.to) / 2)]!;
        expect(mid.h).toBe(DECK_TOP);
        const top = spurTrestleTopAt(seed, mid.x, mid.z) as number;
        // (The top comes up from the bed over `TRESTLE_TAPER` metres at each end: a point of the middle that stands nearer an end than that, as the one point of a run of one segment does, has less than the whole deck.)
        const a0 = (track.points[run.from] as { s: number }).s;
        const a1 = (track.points[run.to] as { s: number }).s;
        if (Math.min(mid.s - a0, a1 - mid.s) >= TRESTLE_TAPER) expect(top, `seed ${seed}`).toBeCloseTo(DECK_TOP + TRESTLE_TOP, 9);
        else expect(top, `seed ${seed}`).toBeGreaterThanOrEqual(DECK_TOP);
        expect(trestleTopAt(seed, mid.x, mid.z)).toBe(top);
        // Beside the deck there is none; and a hull on the deck is held inboard of its guard rails, one below it outboard of the deck.
        const a = track.points[Math.floor((run.from + run.to) / 2) - 1]!;
        const dx = mid.x - a.x;
        const dz = mid.z - a.z;
        const l = Math.hypot(dx, dz);
        const nx = dz / l;
        const nz = -dx / l;
        expect(spurTrestleTopAt(seed, mid.x + nx * (TRESTLE_HALF + 0.5), mid.z + nz * (TRESTLE_HALF + 0.5))).toBeNull();
        const on = { x: mid.x + nx * (TRESTLE_HALF + 0.1), y: top + PLAYER_HALF.y + 0.01, z: mid.z + nz * (TRESTLE_HALF + 0.1) };
        const vel = { x: nx * 3, y: 0, z: nz * 3 };
        // Just past the deck's side and above its top: outboard of the rail is where a hull on the deck is not; it is brought back inboard.
        if (constrainTrestle(seed, on, vel)) expect(Math.hypot(on.x - mid.x, on.z - mid.z)).toBeLessThanOrEqual(TRESTLE_HALF + 0.5);
      }
    }
    expect(trestles).toBeGreaterThan(20);
  });

  it("is drawn with the main line's cross section: rail heads RAIL_TOP over the bed at the gauge, ties, a turnout stand, a trestle's deck over each wet stretch", () => {
    let seen = 0;
    for (const seed of [1, 4, 6, 8, 20261121]) {
      const g = townGround(seed);
      const track = spurOf(seed);
      if (track === null) continue;
      const builders = new Map<string, MeshBuilder>();
      const sink = (x: number, z: number): MeshBuilder => {
        const k = `${Math.floor(x / 128)},${Math.floor(z / 128)}`;
        let b = builders.get(k);
        if (b === undefined) builders.set(k, (b = new MeshBuilder()));
        return b;
      };
      spurGeometry(g, sink, "full");
      const { frames } = spurFrames(track);
      let heads = 0;
      let vertices = 0;
      for (const b of builders.values()) {
        const a = b.finish();
        vertices += a.positions.length / 3;
        for (let i = 0; i < a.positions.length; i++) expect(Number.isFinite(a.positions[i])).toBe(true);
        for (let v = 0; v < a.positions.length / 3; v++) {
          const x = a.positions[v * 3] as number;
          const y = a.positions[v * 3 + 1] as number;
          const z = a.positions[v * 3 + 2] as number;
          // A rail head's top vertex: at the gauge's half off a frame, RAIL_TOP over its bed.
          for (let k = 0; k < frames.length; k += 7) {
            const f = frames[k]!;
            if (Math.hypot(x - f.x, z - f.z) > 1.1) continue;
            const off = Math.abs((x - f.x) * f.nx + (z - f.z) * f.nz);
            if (Math.abs(off - RAIL_GAUGE / 2) < 0.04 && Math.abs(y - f.g - RAIL_TOP) < 0.012) heads++;
          }
        }
      }
      expect(vertices, `seed ${seed}`).toBeGreaterThan(2000);
      expect(heads, `seed ${seed}: rail heads at RAIL_TOP over the bed`).toBeGreaterThan(20);
      seen++;
    }
    expect(seen).toBeGreaterThan(3);
  });

  it("stands the spur's bed on the made ground it is laid over, within the skirt's depth, where it runs on land", () => {
    let checked = 0;
    for (const seed of [1, 4, 6, 8, 20261121]) {
      const track = spurOf(seed);
      if (track === null) continue;
      for (const p of track.points) {
        if (p.wet || p.s < 100) continue;
        // The made ground and the harbour's decks are no lower than the apron's level, whatever the sea floor is under them.
        const ground = Math.max(DECK_TOP, elevationSampleAt(seed, p.x, p.z).h);
        // The bed is no lower than the ground by more than the cut allows, and no higher by more than the skirt hides (1.6 m): the spur ends where it would be.
        expect(p.h - ground, `seed ${seed} s ${p.s.toFixed(0)}`).toBeLessThan(2.5);
        expect(ground - p.h, `seed ${seed} s ${p.s.toFixed(0)}`).toBeLessThan(2.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
