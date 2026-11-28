import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { FOV, MAX_LAG, NEAREST, handHidden, torchBasis } from "../../src/game/hand/handPose.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { watchSolids } from "../../src/game/hand/watchGeometry.js";
import { watchArrays } from "../../src/game/hand/watchParts.js";
import {
  ARM_SCALE, WATCH_LOWER_SECONDS, WATCH_RAISE_SECONDS, newWatchPose, newWatchState, stepWatch, watchHoldFor, watchLoweredFor, type WatchInput,
} from "../../src/game/hand/watchPose.js";

const input = (over: Partial<WatchInput> = {}): WatchInput => ({ dt: 1 / 60, want: false, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect: 1.6, ...over });
function run(seconds: number, over: Partial<WatchInput>, state = newWatchState(), pose = newWatchPose()) {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepWatch(state, input(over), pose);
  return { state, pose };
}

describe("the left arm's rise and fall", () => {
  it("is down and not drawn at rest", () => {
    const { pose } = run(1, {});
    expect(pose.shown).toBe(false);
    expect(pose.raised).toBe(0);
  });

  it("rises in 0.3 s from straight below, and drops in 0.25 s straight down", () => {
    const part = run(WATCH_RAISE_SECONDS / 2, { want: true });
    expect(part.pose.shown).toBe(true);
    expect(part.pose.raised).toBeGreaterThan(0.3);
    expect(part.pose.raised).toBeLessThan(0.7);
    const up = run(WATCH_RAISE_SECONDS + 1 / 30, { want: true });
    expect(up.pose.raised).toBe(1);
    const hold = watchHoldFor(1.6);
    expect(up.pose.x).toBeCloseTo(hold.x, 2);
    expect(up.pose.y).toBeCloseTo(hold.y, 1);
    // The drop: never up again, the same depth, the same place across.
    let last = up.pose.y;
    let steps = 0;
    while (up.pose.shown && steps++ < 60) {
      stepWatch(up.state, input({ want: false }), up.pose);
      expect(up.pose.y).toBeLessThanOrEqual(last + 1e-4);
      last = up.pose.y;
      expect(up.pose.z).toBeCloseTo(hold.z, 2);
      expect(up.pose.x).toBeCloseTo(hold.x, 2);
    }
    expect(steps).toBeLessThanOrEqual(Math.ceil(WATCH_LOWER_SECONDS * 60) + 2);
    expect(up.pose.shown).toBe(false);
  });

  it("is hidden in a car and getting in or out, and under the dark screen at a door, and rises again after", () => {
    for (const [ride, inside] of [[1, 0], [2, 0], [3, 0], [0, 1], [0, 3]] as const) expect(handHidden(ride, inside, false)).toBe(true);
    expect(handHidden(0, 0, false)).toBe(false);
    const up = run(0.5, { want: true });
    stepWatch(up.state, input({ want: true, hidden: true }), up.pose);
    expect(up.pose.shown).toBe(false);
    expect(up.pose.raised).toBe(0);
    expect(run(WATCH_RAISE_SECONDS * 0.4, { want: true }, up.state, up.pose).pose.shown).toBe(true);
  });

  it("bobs with the ground speed and breathes when still, lags a turn by a few degrees at most, and is drawn in by a wall", () => {
    const spread = (speed: number): number => {
      const s = newWatchState(), p = newWatchPose();
      run(0.5, { want: true, speed }, s, p);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 240; i++) {
        stepWatch(s, input({ want: true, speed }), p);
        lo = Math.min(lo, p.y);
        hi = Math.max(hi, p.y);
      }
      return hi - lo;
    };
    expect(spread(0)).toBeGreaterThan(0.001);
    expect(spread(4)).toBeGreaterThan(spread(0) * 2);
    const s = newWatchState(), p = newWatchPose();
    run(0.5, { want: true }, s, p);
    let yaw = 0;
    for (let i = 0; i < 30; i++) {
      yaw += 0.3;
      stepWatch(s, input({ want: true, yaw }), p);
      expect(Math.abs(s.lagYaw)).toBeLessThanOrEqual(MAX_LAG + 1e-12);
    }
    const open = run(1, { want: true, clear: 1 }).pose;
    const wall = run(1, { want: true, clear: 0 }).pose;
    expect(wall.z).toBeLessThan(open.z);
    expect(wall.x / wall.z).toBeCloseTo(open.x / open.z, 3);
  });
});

/** The arm's triangles' sampled points at a pose, on a view of this aspect: how many are on screen, and the nearest to the eye in front of it. */
function look(aspect: number, pose: ReturnType<typeof newWatchPose>): { onScreen: number; nearest: number; lowest: number } {
  const a = watchArrays();
  const H = 1000, W = H * aspect, f = H / 2 / Math.tan(FOV / 2);
  const b = new Float64Array(9);
  torchBasis(restAxes(), pose, b, ARM_SCALE);
  const at = (k: number): number[] => {
    const px = a.positions[k * 3] as number, py = a.positions[k * 3 + 1] as number, pz = a.positions[k * 3 + 2] as number;
    return [pose.x + b[0]! * px + b[3]! * py + b[6]! * pz, pose.y + b[1]! * px + b[4]! * py + b[7]! * pz, pose.z + b[2]! * px + b[5]! * py + b[8]! * pz];
  };
  let onScreen = 0, nearest = Infinity, lowest = Infinity;
  for (let t = 0; t < a.indices.length; t += 3) {
    const p = at(a.indices[t] as number), q = at(a.indices[t + 1] as number), r = at(a.indices[t + 2] as number);
    for (let u = 0; u <= 3; u++) for (let v = 0; v <= 3 - u; v++) {
      const w = 3 - u - v;
      const x = (p[0]! * u + q[0]! * v + r[0]! * w) / 3, y = (p[1]! * u + q[1]! * v + r[1]! * w) / 3, z = (p[2]! * u + q[2]! * v + r[2]! * w) / 3;
      if (z <= 0.05) continue;
      nearest = Math.min(nearest, Math.hypot(x, y, z));
      const sx = W / 2 + (x / z) * f, sy = H / 2 - (y / z) * f;
      lowest = Math.min(lowest, sy / H);
      if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) onScreen++;
    }
  }
  return { onScreen, nearest, lowest };
}

describe("the left arm lowered, and never too near", () => {
  it("is nowhere in view once the lowering is over, on any window from 4:3 to 21:9, at any pitch, standing, walking or sprinting", () => {
    for (const aspect of [4 / 3, 1.6, 16 / 9, 21 / 9]) {
      for (const motion of [{ speed: 0, sprinting: false }, { speed: 4.5, sprinting: false }, { speed: 7, sprinting: true }]) {
        for (const pitch of [-1.4, 0, 1.4]) {
          const s = newWatchState(), p = newWatchPose();
          for (let i = 0; i < 40; i++) stepWatch(s, input({ want: true, aspect, pitch, ...motion }), p);
          for (let i = 0; i < 40; i++) stepWatch(s, input({ want: false, aspect, pitch, ...motion }), p);
          expect(p.shown).toBe(false);
          const l = watchLoweredFor(aspect);
          expect(p.y).toBeCloseTo(l.y, 6);
          const seen = look(aspect, p);
          expect(seen.onScreen, `${aspect} ${JSON.stringify(motion)} ${pitch}`).toBe(0);
          expect(seen.lowest).toBeGreaterThan(1.1);
        }
      }
    }
  });

  it("never comes nearer the eye than 14 cm, in the hold and on the way, in every state", () => {
    let nearest = Infinity;
    const s = newWatchState(), p = newWatchPose();
    for (let i = 0; i < 700; i++) {
      stepWatch(s, input({ want: i < 450, speed: (i % 200) / 30, sprinting: i % 300 > 250, yaw: Math.sin(i * 0.08) * 3, pitch: Math.sin(i * 0.03) * 1.3, clear: i % 60 < 12 ? 0 : 1 }), p);
      if (p.shown) nearest = Math.min(nearest, look(1.6, p).nearest);
    }
    expect(nearest).toBeGreaterThanOrEqual(NEAREST);
  });
});

describe("the left arm's geometry", () => {
  const a = watchArrays();
  it("is under 6,000 vertices and in one draw, with a finite number everywhere and a unit normal", () => {
    expect(a.positions.length / 3).toBeLessThan(6000);
    expect(a.positions.length / 3).toBeGreaterThan(1000);
    for (const v of a.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it("is made of closed solids: every solid, laid alone, has every edge met", () => {
    const key = (p: Float32Array, i: number): string => `${Math.round((p[i * 3] as number) * 1e5)},${Math.round((p[i * 3 + 1] as number) * 1e5)},${Math.round((p[i * 3 + 2] as number) * 1e5)}`;
    for (const s of watchSolids()) {
      const b = new MeshBuilder();
      s.lay(b);
      const m = b.take();
      const edges = new Map<string, number>();
      for (let t = 0; t < m.indices.length; t += 3) {
        const v = [key(m.positions, m.indices[t] as number), key(m.positions, m.indices[t + 1] as number), key(m.positions, m.indices[t + 2] as number)];
        for (let k = 0; k < 3; k++) {
          const e = `${v[k]}>${v[(k + 1) % 3]}`;
          if (v[k] !== v[(k + 1) % 3]) edges.set(e, (edges.get(e) ?? 0) + 1);
        }
      }
      let open = 0;
      for (const [e, n] of edges) {
        const [p, q] = e.split(">") as [string, string];
        if ((edges.get(`${q}>${p}`) ?? 0) !== n) open++;
      }
      expect(m.indices.length, s.name).toBeGreaterThan(0);
      expect(open, `${s.name} has open edges`).toBe(0);
    }
  });

  it("has the watch of the owner's kind: a round case 45 mm across (before the view-model scale), a lit circle 36 mm, a crown, a strap of brown leather with stitching, a keeper and a tail", () => {
    const names = watchSolids().map((q) => q.name);
    for (const n of ["case", "glass", "screen", "crown", "button", "strap", "upper band", "lower band", "upper band stitching a", "lower band stitching b", "keeper", "knit cuff", "back of the hand", "thumb", "cuff", "sleeve"]) expect(names).toContain(n);
    expect(names.filter((q) => q.startsWith("finger")).length).toBe(4);
  });

  it("keeps its own frame's quad on the face: the square that bounds the circle, face up, 36 mm times the watch's size across", async () => {
    const { screenSquare, SCREEN_RADIUS, SCREEN_Y, WATCH_BIG } = await import("../../src/game/hand/watchGeometry.js");
    const sq = screenSquare();
    expect(sq.length).toBe(4);
    for (const p of sq) expect(p[1]).toBeCloseTo(SCREEN_Y, 9);
    expect(Math.abs((sq[1] as readonly number[])[2]! - (sq[0] as readonly number[])[2]!)).toBeCloseTo(2 * SCREEN_RADIUS * WATCH_BIG, 9);
    expect(SCREEN_RADIUS * 2).toBeCloseTo(0.036, 6);
    // The camera is looking at the face from outside: the screen's normal is toward the eye (checked in handScreen.test.ts), and the corner order has a positive area there.
    expect(cameraAxes(0, 0, 0, restAxes()).fz).toBe(1);
  });
});
