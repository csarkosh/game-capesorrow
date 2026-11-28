import { describe, expect, it } from "vitest";
import { restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { handArrays } from "../../src/game/hand/handParts.js";
import { FOV, newHandPose, newHandState, stepHand, torchBasis, type HandInput } from "../../src/game/hand/handPose.js";

/**
 * The corner map and the party's rows under it (`hud.ts`: a 220 px square 12 px in from the bottom right corner, 148 px on a screen under 520 px wide, the party's rows
 * about 80 px beneath it): the rectangle, in pixels from the corner, that no part of the hand, the torch or the sleeve may be behind on a screen 1,000 px wide or more.
 */
const BLOCK = { width: 12 + 220 + 12, height: 12 + 220 + 12 + 80 };
/** What the bob and the lag may move the hand on the screen, pixels. */
const SLACK = 10;

type Seen = { inRect: number; xmax: number; bottom: [number, number]; head: [number, number] };

/** The hand as a view W by H sees it with the pose `over` says: how many sampled points of its triangles fall in the map's rectangle, its right edge, where it crosses the bottom edge and where the lens is (shares of the width and height). */
function seen(W: number, H: number, frames: number, over: Partial<HandInput>, slack = 0, turn = 0): Seen {
  const { body } = handArrays();
  const out: Seen = { inRect: 0, xmax: -1, bottom: [9, -9], head: [0, 0] };
  const state = newHandState();
  const pose = newHandPose();
  const f = H / 2 / Math.tan(FOV / 2);
  const basis = new Float64Array(9);
  const axes = restAxes();
  const P = body.positions;
  const I = body.indices;
  for (let n = 0; n < frames; n++) {
    stepHand(state, { dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: n * turn, pitch: 0, clear: 1, aspect: W / H, ...over }, pose);
    if (n < 30) continue;
    torchBasis(axes, pose, basis);
    out.head = [0.5 + (pose.x / pose.z) * f / W, 0.5 - (pose.y / pose.z) * f / H];
    const at = (k: number): [number, number, number] => {
      const px = P[k * 3] as number, py = P[k * 3 + 1] as number, pz = P[k * 3 + 2] as number;
      return [
        pose.x + (basis[0] as number) * px + (basis[3] as number) * py + (basis[6] as number) * pz,
        pose.y + (basis[1] as number) * px + (basis[4] as number) * py + (basis[7] as number) * pz,
        pose.z + (basis[2] as number) * px + (basis[5] as number) * py + (basis[8] as number) * pz,
      ];
    };
    for (let t = 0; t < I.length; t += 3) {
      const a = at(I[t] as number), b = at(I[t + 1] as number), c = at(I[t + 2] as number);
      for (let u = 0; u <= 5; u++) {
        for (let v = 0; v <= 5 - u; v++) {
          const w = 5 - u - v;
          const x = (a[0] * u + b[0] * v + c[0] * w) / 5, y = (a[1] * u + b[1] * v + c[1] * w) / 5, z = (a[2] * u + b[2] * v + c[2] * w) / 5;
          if (z <= 0.05) continue;
          const sx = W / 2 + (x / z) * f, sy = H / 2 - (y / z) * f;
          if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
          out.xmax = Math.max(out.xmax, sx / W);
          if (sx + slack > W - BLOCK.width && sy + slack > H - BLOCK.height) out.inRect++;
          if (sy > H - 6) {
            out.bottom[0] = Math.min(out.bottom[0], sx / W);
            out.bottom[1] = Math.max(out.bottom[1], sx / W);
          }
        }
      }
    }
  }
  return out;
}

describe("the hand and the corner map", () => {
  const views: [string, number, number][] = [["16:10, 1,000 wide", 1000, 625], ["16:9, 1,280 wide", 1280, 720], ["16:10, 1,600 wide", 1600, 1000], ["16:9, 1,000 wide", 1000, 562]];

  for (const [name, W, H] of views) {
    it(`keeps every part of the hand, the torch and the sleeve out of the map's and the party's rectangle (${name}), standing and walking and turning`, () => {
      const still = seen(W, H, 120, {}, SLACK);
      const walking = seen(W, H, 240, { speed: 4.5 }, SLACK);
      // A quick turn of the view (a third of a radian a frame for a few frames, then still: the lag at its greatest).
      const turning = seen(W, H, 40, {}, SLACK, 0.2);
      for (const s of [still, walking, turning]) expect(s.inRect).toBe(0);
      process.stdout.write(`${name}: head at ${(still.head[0] * 100).toFixed(0)}% across and ${(still.head[1] * 100).toFixed(0)}% down; right edge ${(still.xmax * 100).toFixed(1)}%; crosses the bottom at ${(still.bottom[0] * 100).toFixed(0)} to ${(still.bottom[1] * 100).toFixed(0)}%; map rectangle starts at ${(((W - BLOCK.width) / W) * 100).toFixed(1)}% across\n`);
    });

    it(`holds the torch's head at 52 percent across and 64 percent down and has the forearm rise from the bottom edge between 60 and 76 percent (${name})`, () => {
      const s = seen(W, H, 120, {});
      expect(s.head[0]).toBeGreaterThan(0.5);
      expect(s.head[0]).toBeLessThan(0.6);
      expect(s.head[1]).toBeGreaterThan(0.62);
      expect(s.head[1]).toBeLessThan(0.72);
      expect(s.bottom[0]).toBeGreaterThan(0.6);
      expect(s.bottom[1]).toBeLessThan(0.76);
    });
  }
});
