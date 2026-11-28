import { describe, expect, it } from "vitest";
import { restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { handArrays } from "../../src/game/hand/handParts.js";
import { FOV, handScaleFor, newHandPose, newHandState, stepHand, torchBasis, type HandInput, type HandPose } from "../../src/game/hand/handPose.js";
import { handSolids } from "../../src/game/hand/handGeometry.js";
import { watchSolids, WRIST_Y } from "../../src/game/hand/watchGeometry.js";
import { MeshBuilder } from "../../src/game/town/meshBuilder.js";
import { ARM_SCALE, newWatchPose, newWatchState, stepWatch, watchQuad, type WatchInput } from "../../src/game/hand/watchPose.js";
import { watchArrays } from "../../src/game/hand/watchParts.js";

type Arrays = { positions: Float32Array; indices: Uint32Array };
type Pt = { x: number; y: number };

/** Sampled points of an arrays' triangles, on a view W by H, that are in front of the near plane and on the screen, in pixels. */
function sample(a: Arrays, pose: HandPose, basis: ArrayLike<number>, W: number, H: number, per = 5): Pt[] {
  const f = H / 2 / Math.tan(FOV / 2);
  const out: Pt[] = [];
  const at = (k: number): number[] => {
    const px = a.positions[k * 3] as number, py = a.positions[k * 3 + 1] as number, pz = a.positions[k * 3 + 2] as number;
    return [
      pose.x + (basis[0] as number) * px + (basis[3] as number) * py + (basis[6] as number) * pz,
      pose.y + (basis[1] as number) * px + (basis[4] as number) * py + (basis[7] as number) * pz,
      pose.z + (basis[2] as number) * px + (basis[5] as number) * py + (basis[8] as number) * pz,
    ];
  };
  for (let t = 0; t < a.indices.length; t += 3) {
    const p = at(a.indices[t] as number), q = at(a.indices[t + 1] as number), r = at(a.indices[t + 2] as number);
    for (let u = 0; u <= per; u++) {
      for (let v = 0; v <= per - u; v++) {
        const w = per - u - v;
        const x = (p[0]! * u + q[0]! * v + r[0]! * w) / per, y = (p[1]! * u + q[1]! * v + r[1]! * w) / per, z = (p[2]! * u + q[2]! * v + r[2]! * w) / per;
        if (z <= 0.05) continue;
        const sx = W / 2 + (x / z) * f, sy = H / 2 - (y / z) * f;
        if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) out.push({ x: sx, y: sy });
      }
    }
  }
  return out;
}

const rightInput = (aspect: number, over: Partial<HandInput> = {}): HandInput => ({ dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect, ...over });
const leftInput = (aspect: number, over: Partial<WatchInput> = {}): WatchInput => ({ dt: 1 / 60, want: true, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect, ...over });

/** Both arms at the hold on a view W by H, standing still, or with a walk's bob, or turning. */
function both(W: number, H: number, frames = 120, over: { speed?: number; turn?: number } = {}): { right: Pt[]; left: Pt[]; leftHand: Pt[]; quad: Float32Array; rp: HandPose; lp: HandPose; rb: Float64Array; lb: Float64Array } {
  const aspect = W / H;
  const rs = newHandState(), rp = newHandPose(), ls = newWatchState(), lp = newWatchPose();
  for (let n = 0; n < frames; n++) {
    stepHand(rs, rightInput(aspect, { speed: over.speed ?? 0, yaw: n * (over.turn ?? 0) }), rp);
    stepWatch(ls, leftInput(aspect, { speed: over.speed ?? 0, yaw: n * (over.turn ?? 0) }), lp);
  }
  const rb = new Float64Array(9), lb = new Float64Array(9);
  torchBasis(restAxes(), rp, rb, handScaleFor(aspect));
  torchBasis(restAxes(), lp, lb, ARM_SCALE);
  const quad = new Float32Array(8);
  watchQuad(lp, lb, aspect, quad);
  const right = sample(handArrays().body, rp, rb, W, H);
  const left = sample(watchArrays(), lp, lb, W, H);
  // The hand beyond the watch: the back of the hand, the fingers and the thumb, laid alone.
  const hb = new MeshBuilder();
  for (const s of watchSolids().filter((q) => /finger|thumb|back of/.test(q.name))) s.lay(hb);
  const hand = hb.take();
  return { right, left, leftHand: sample(hand, lp, lb, W, H), quad, rp, lp, rb, lb };
}

describe("the right arm's framing: from the player, large, in the lower right", () => {
  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720], ["16:10 at 1,000", 1000, 625], ["16:10 at 1,600", 1600, 1000], ["aspect 1.2", 949, 780]] as const) {
    it(`has the torch's head, the fist and the forearm where the framing says (${name})`, () => {
      const { right, rp, rb } = both(W, H);
      const f = H / 2 / Math.tan(FOV / 2);
      const at = (k: number): Pt => ({ x: (0.5 + ((rp.x + rb[6]! * -k) / (rp.z + rb[8]! * -k) * f) / W) * 100, y: (0.5 - ((rp.y + rb[7]! * -k) / (rp.z + rb[8]! * -k) * f) / H) * 100 });
      const head = at(0), fist = at(0.16), tail = at(0.2135);
      // The head up and left of the fist, 54 to 60 percent across and 46 to 56 percent down; the fist 68 to 72 across and 66 to 72 down.
      expect(head.x).toBeGreaterThanOrEqual(53.5);
      expect(head.x).toBeLessThanOrEqual(60);
      expect(head.y).toBeGreaterThanOrEqual(46);
      expect(head.y).toBeLessThanOrEqual(56);
      expect(fist.x).toBeGreaterThanOrEqual(67);
      expect(fist.x).toBeLessThanOrEqual(72);
      expect(fist.y).toBeGreaterThanOrEqual(name === "aspect 1.2" ? 60 : 66);
      expect(fist.y).toBeLessThanOrEqual(72);
      expect(head.x).toBeLessThan(fist.x);
      expect(head.y).toBeLessThan(fist.y);
      // The middle of the view stays clear: nothing left of half the width or above 42 percent of the height.
      expect(Math.min(...right.map((p) => p.x)) / W).toBeGreaterThanOrEqual(0.5);
      expect(Math.min(...right.map((p) => p.y)) / H).toBeGreaterThanOrEqual(0.42);
      // The torch's length on the screen: 28 to 32 percent of the width at 16:10, a little less on the wider windows (it is as long as the height allows).
      const len = (Math.hypot((tail.x - head.x) * W, (tail.y - head.y) * H) / 100 / W) * 100;
      if (name.startsWith("16:10")) {
        expect(len).toBeGreaterThanOrEqual(27.5);
        expect(len).toBeLessThanOrEqual(32.5);
      } else expect(len).toBeGreaterThanOrEqual(25);
      // On a narrow window the arm is no larger a share of the width than on a wide one: the torch does not come to cover the middle.
      if (name === "aspect 1.2") expect(len).toBeLessThanOrEqual(34);
      // The forearm leaves through the bottom right corner: across the bottom edge between 78 and 100 percent, and the right edge below 70 percent down.
      const bottom = right.filter((p) => p.y > H - 4).map((p) => p.x / W);
      const rightEdge = right.filter((p) => p.x > W - 4).map((p) => p.y / H);
      expect(bottom.length + rightEdge.length).toBeGreaterThan(0);
      if (bottom.length > 0) expect(Math.min(...bottom)).toBeGreaterThanOrEqual(0.78 - 0.04);
      if (rightEdge.length > 0) expect(Math.min(...rightEdge)).toBeGreaterThanOrEqual(0.62);
    });
  }
});

describe("the left arm and its watch: from the lower left, the face to the eye", () => {
  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720], ["16:10 at 1,000", 1000, 625], ["aspect 1.2", 949, 780]] as const) {
    it(`puts the lit screen where the framing says, upright, facing the eye, in order (${name})`, () => {
      const { quad, lp, lb } = both(W, H);
      const px = (k: number): Pt => ({ x: quad[k * 2]! * W, y: quad[k * 2 + 1]! * H });
      const [tl, tr, br, bl] = [px(0), px(1), px(2), px(3)] as [Pt, Pt, Pt, Pt];
      // In the view, every corner.
      for (const c of [tl, tr, br, bl]) {
        expect(c.x).toBeGreaterThan(0);
        expect(c.x).toBeLessThan(W);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(H);
      }
      // Corner order as the wearer reads: clockwise on the screen (y down) from the top left: the signed area is positive, and the top is above the bottom, the left left of the right.
      const area = (tl.x * tr.y - tr.x * tl.y + (tr.x * br.y - br.x * tr.y) + (br.x * bl.y - bl.x * br.y) + (bl.x * tl.y - tl.x * bl.y)) / 2;
      expect(area).toBeGreaterThan(0);
      expect((tl.y + tr.y) / 2).toBeLessThan((bl.y + br.y) / 2);
      expect((tl.x + bl.x) / 2).toBeLessThan((tr.x + br.x) / 2);
      // The middle of it at 33 to 37 percent across and 64 to 70 percent down (the framing is by the view's own share, so a narrower window keeps it).
      const cx = (tl.x + tr.x + br.x + bl.x) / 4 / W, cy = (tl.y + tr.y + br.y + bl.y) / 4 / H;
      expect(cx).toBeGreaterThanOrEqual(0.3);
      expect(cx).toBeLessThanOrEqual(0.37);
      expect(cy).toBeGreaterThanOrEqual(0.64);
      expect(cy).toBeLessThanOrEqual(0.73);
      // About a quarter of the view's height across: 22 to 25 percent.
      const side = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2 / H;
      expect(side).toBeGreaterThanOrEqual(0.22);
      expect(side).toBeLessThanOrEqual(name === "16:10" ? 0.25 : 0.265);
      // Upright: the top edge within 12 degrees of level.
      const tilt = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
      expect(Math.abs(tilt)).toBeLessThanOrEqual(12);
      // Facing the eye: the face's normal (the mesh's +y) within 15 degrees of the way to the eye, from the eye's side of the point.
      const nx = lb[3]! / ARM_SCALE, ny = lb[4]! / ARM_SCALE, nz = lb[5]! / ARM_SCALE;
      const toEye = Math.hypot(lp.x, lp.y, lp.z);
      const cos = -(nx * lp.x + ny * lp.y + nz * lp.z) / toEye;
      expect((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI).toBeLessThanOrEqual(name === "16:10" ? 15 : 18);
    });

    it(`keeps the sleeve slim at the left edge: no taller than about a quarter of the view (${name})`, () => {
      const { left } = both(W, H);
      const edge = left.filter((p) => p.x < 4).map((p) => p.y / H);
      expect(edge.length).toBeGreaterThan(0);
      expect(Math.max(...edge) - Math.min(...edge)).toBeLessThanOrEqual(0.27);
    });

    it(`has the arm come in from the lower left, and the hand end by about half the width (53 percent) (${name})`, () => {
      const { left, leftHand } = both(W, H);
      const leftEdge = left.filter((p) => p.x < 4).map((p) => p.y / H);
      const bottom = left.filter((p) => p.y > H - 4).map((p) => p.x / W);
      expect(leftEdge.length + bottom.length).toBeGreaterThan(0);
      // The forearm's own axis crosses the left edge below 75 percent down (or the bottom edge in its first third).
      expect(Math.max(...leftEdge, 0)).toBeGreaterThan(0.75);
      expect(Math.max(...leftHand.map((p) => p.x)) / W).toBeLessThanOrEqual(name === "aspect 1.2" ? 0.58 : 0.535);
    });
  }

  it("keeps the two arms apart on the screen, standing, walking and turning", () => {
    for (const [W, H] of [[1248, 780], [1280, 720], [1000, 625], [1600, 1000], [949, 780]] as const) {
      for (const over of [{}, { speed: 4.5 }, { turn: 0.05 }]) {
        const { right, left } = both(W, H, 140, over);
        const cell = (p: Pt): string => `${Math.floor((p.x / W) * 90)},${Math.floor((p.y / H) * 90)}`;
        const a = new Set(left.map(cell));
        const touching = right.filter((p) => a.has(cell(p))).length;
        expect(touching, `${W}x${H} ${JSON.stringify(over)}`).toBe(0);
      }
    }
  });

  it("has the wrist's axis above the forearm's sleeve and the strap round it: the wrist is at the frame's own y", () => {
    expect(WRIST_Y).toBeLessThan(0);
    expect(handSolids().length).toBeGreaterThan(10);
  });
});

describe("the strap shows: brown leather above and below the case", () => {
  it("shows at least 10 mm of each band (the watch's own size) past the case's edge to the eye, clear of the lit circle and of the fist, on 16:10, 16:9 and aspect 1.2", async () => {
    const { CASE_RADIUS, BAND_OUT, SCREEN_RADIUS, WATCH_BIG } = await import("../../src/game/hand/watchGeometry.js");
    expect(BAND_OUT).toBeGreaterThanOrEqual(0.012 * WATCH_BIG);
    expect(BAND_OUT).toBeLessThanOrEqual(0.018 * WATCH_BIG);
    for (const [W, H] of [[1248, 780], [1280, 720], [949, 780]] as const) {
      const aspect = W / H;
      const lp = newWatchPose(), ls = newWatchState();
      for (let i = 0; i < 120; i++) stepWatch(ls, leftInput(aspect), lp);
      const lb = new Float64Array(9);
      torchBasis(restAxes(), lp, lb, ARM_SCALE);
      const quad = new Float32Array(8);
      watchQuad(lp, lb, aspect, quad);
      const cx = ((quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4) * W, cy = ((quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4) * H;
      const circle = (Math.hypot((quad[2]! - quad[0]!) * W, (quad[3]! - quad[1]!) * H) / 2) * 0.95;
      const f = H / 2 / Math.tan(FOV / 2);
      for (const side of [-1, 1]) {
        const b = new MeshBuilder();
        for (const s of watchSolids().filter((q) => q.name === (side < 0 ? "upper band" : "lower band"))) s.lay(b);
        const a = b.take();
        let shown = 0, inCircle = 0, farthest = 0, widest = 0;
        for (let k = 0; k < a.positions.length / 3; k++) {
          const px = a.positions[k * 3] as number, py = a.positions[k * 3 + 1] as number, pz = a.positions[k * 3 + 2] as number;
          const nx = a.normals[k * 3] as number, ny = a.normals[k * 3 + 1] as number, nz = a.normals[k * 3 + 2] as number;
          const x = lp.x + lb[0]! * px + lb[3]! * py + lb[6]! * pz, y = lp.y + lb[1]! * px + lb[4]! * py + lb[7]! * pz, z = lp.z + lb[2]! * px + lb[5]! * py + lb[8]! * pz;
          const n = [lb[0]! * nx + lb[3]! * ny + lb[6]! * nz, lb[1]! * nx + lb[4]! * ny + lb[7]! * nz, lb[2]! * nx + lb[5]! * ny + lb[8]! * nz];
          const toEye = -(n[0]! * x + n[1]! * y + n[2]! * z) / Math.hypot(x, y, z) / ARM_SCALE;
          widest = Math.max(widest, Math.abs(pz));
          if (Math.abs(px) < CASE_RADIUS + 0.0175 * 1 || toEye <= 0.1) continue;
          shown++;
          farthest = Math.max(farthest, Math.abs(px));
          const sx = W / 2 + (x / z) * f, sy = H / 2 - (y / z) * f;
          if (Math.hypot(sx - cx, sy - cy) < circle) inCircle++;
        }
        // Brown shows past the case: some of the band's surface faces the eye beyond 10 mm (the watch's size) of the case's edge, and none of that is inside the lit circle.
        expect(shown, `${side} ${W}x${H}`).toBeGreaterThan(8);
        expect(farthest).toBeGreaterThanOrEqual(CASE_RADIUS + 0.0175);
        expect(inCircle).toBe(0);
        // Its width is clear of the fist, which starts at 0.03 along the arm.
        expect(widest).toBeLessThan(0.029);
      }
      expect(SCREEN_RADIUS * WATCH_BIG).toBeLessThan(CASE_RADIUS);
    }
  });
});
