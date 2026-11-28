import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { FOV, MAX_LAG, NEAREST, handHidden, torchBasis } from "../../src/game/hand/handPose.js";
import { readFileParts } from "./armModels.js";
import { LEFT } from "../../src/game/hand/handModels.js";
import {
  ARM_SCALE, SCREEN_CORNERS, WATCH_LOWER_SECONDS, WATCH_RAISE_SECONDS, newWatchPose, newWatchState, stepWatch, watchHoldFor, watchLoweredFor, watchMeshBasis, type WatchInput,
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
function mergedLeft(): { positions: Float32Array; indices: Uint32Array } {
  const parts = readFileParts("hand.left");
  const positions = new Float32Array(parts.reduce((n, p) => n + p.positions.length, 0));
  const indices: number[] = [];
  let at = 0;
  for (const p of parts) {
    for (const i of p.indices) indices.push(i + at / 3);
    positions.set(p.positions, at);
    at += p.positions.length;
  }
  return { positions, indices: Uint32Array.from(indices) };
}

function look(aspect: number, pose: ReturnType<typeof newWatchPose>): { onScreen: number; nearest: number; lowest: number } {
  const a = mergedLeft();
  const H = 1000, W = H * aspect, f = H / 2 / Math.tan(FOV / 2);
  const b = new Float64Array(9), unit = new Float64Array(9);
  torchBasis(restAxes(), pose, unit, ARM_SCALE);
  watchMeshBasis(unit, b);
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

describe("the left arm's model", () => {
  it("has the screen's four corners from the manifest, in the mesh's frame as the loader stands it: top left, top right, bottom right, bottom left, face out", () => {
    expect(SCREEN_CORNERS.length).toBe(4);
    const r = (LEFT.watch as NonNullable<typeof LEFT.watch>).screen_diameter / 2;
    const [tl, tr, br, bl] = SCREEN_CORNERS as readonly (readonly number[])[] as [readonly number[], readonly number[], readonly number[], readonly number[]];
    // The file's x is mirrored: as read, the left of the face is the mesh's +x.
    expect(tl[0]).toBeCloseTo(r, 4);
    expect(tl[1]).toBeCloseTo(r, 4);
    expect(tr[0]).toBeCloseTo(-r, 4);
    expect(br[1]).toBeCloseTo(-r, 4);
    expect(bl[0]).toBeCloseTo(r, 4);
    expect(bl[1]).toBeCloseTo(-r, 4);
  });

  it("is one arm and a watch in a handful of draws, with the watch at its size against the arm", () => {
    const parts = readFileParts("hand.left");
    expect(parts.map((p) => p.name)).toEqual(["arm", "watch_case", "watch_back", "watch_glass", "watch_screen", "strap"]);
    const watch = LEFT.watch as NonNullable<typeof LEFT.watch>;
    expect(watch.case_diameter).toBeCloseTo(0.045 * watch.watch_big, 3);
    // The lit circle is inside the rim: 80 to 88 percent of the case's diameter.
    expect(watch.screen_diameter / watch.case_diameter).toBeGreaterThan(0.8);
    expect(watch.screen_diameter / watch.case_diameter).toBeLessThanOrEqual(0.88);
    // The case is sized from the wrist: 0.68 of the sleeve's width in the file, which is 4/5 of it as the eye sees it (the case stands nearer the eye; `handScreen.test.ts` measures that).
    expect(watch.case_diameter / watch.wrist_width).toBeGreaterThanOrEqual(0.62);
    expect(watch.case_diameter / watch.wrist_width).toBeLessThanOrEqual(0.74);
    expect(watch.screen_plate_diameter).toBeLessThan(watch.case_diameter);
    // The strap's width and the case's diameter, as the file's own vertices say.
    const case_ = parts.find((p) => p.name === "watch_case") as { positions: Float32Array };
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < case_.positions.length; i += 3) {
      lo = Math.min(lo, case_.positions[i] as number);
      hi = Math.max(hi, case_.positions[i] as number);
    }
    expect(hi - lo).toBeCloseTo(watch.case_diameter, 2);
  });

  it("stands the mesh's axes from the pose's: x back along the forearm, y toward twelve, z out of the face, a proper turn", () => {
    const b = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const out = new Float64Array(9);
    watchMeshBasis(b, out);
    // right = (1,0,0), up = (0,1,0), forward = (0,0,1): x is -forward, y is -right, z is up.
    expect(Array.from(out)).toEqual([-0, -0, -1, -1, -0, -0, 0, 1, 0]);
    const det = out[0]! * (out[4]! * out[8]! - out[5]! * out[7]!) - out[3]! * (out[1]! * out[8]! - out[2]! * out[7]!) + out[6]! * (out[1]! * out[5]! - out[2]! * out[4]!);
    expect(det).toBeCloseTo(1, 9);
    expect(cameraAxes(0, 0, 0, restAxes()).fz).toBe(1);
  });
});
