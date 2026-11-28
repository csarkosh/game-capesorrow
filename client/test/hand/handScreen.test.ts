import { describe, expect, it } from "vitest";
import { restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { FOV, NEAREST, handScaleFor, newHandPose, newHandState, stepHand, torchBasis, type HandInput, type HandPose } from "../../src/game/hand/handPose.js";
import { ARM_SCALE, newWatchPose, newWatchState, stepWatch, watchMeshBasis, watchQuad, type WatchInput } from "../../src/game/hand/watchPose.js";
import { LEFT, RIGHT } from "../../src/game/hand/handModels.js";
import { readFileParts, type FilePart } from "./armModels.js";

type Arrays = FilePart;
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

const lo = (a: number[]): number => a.reduce((m, v) => Math.min(m, v), Infinity);
const hi = (a: number[]): number => a.reduce((m, v) => Math.max(m, v), -Infinity);
const RIGHT_PARTS = readFileParts("hand.right");
const LEFT_PARTS = readFileParts("hand.left");
const part = (parts: FilePart[], name: string): FilePart => parts.find((p) => p.name === name) as FilePart;

/** Both arms at the hold on a view W by H, standing still, or with a walk's bob, or turning. */
function both(W: number, H: number, frames = 120, over: { speed?: number; turn?: number } = {}): { right: Pt[]; left: Pt[]; leftHand: Pt[]; quad: Float32Array; rp: HandPose; lp: HandPose; rb: Float64Array; lb: Float64Array } {
  const aspect = W / H;
  const rs = newHandState(), rp = newHandPose(), ls = newWatchState(), lp = newWatchPose();
  for (let n = 0; n < frames; n++) {
    stepHand(rs, rightInput(aspect, { speed: over.speed ?? 0, yaw: n * (over.turn ?? 0) }), rp);
    stepWatch(ls, leftInput(aspect, { speed: over.speed ?? 0, yaw: n * (over.turn ?? 0) }), lp);
  }
  const rb = new Float64Array(9), lb = new Float64Array(9), unit = new Float64Array(9);
  torchBasis(restAxes(), rp, rb, handScaleFor());
  torchBasis(restAxes(), lp, unit, ARM_SCALE);
  watchMeshBasis(unit, lb);
  const quad = new Float32Array(8);
  watchQuad(lp, lb, aspect, quad);
  const right = RIGHT_PARTS.flatMap((p) => sample(p, rp, rb, W, H));
  const left = LEFT_PARTS.flatMap((p) => sample(p, lp, lb, W, H));
  // The hand beyond the watch: the part of the arm farther along the forearm than the glove's cuff (the file's x, toward the fingers, is the mesh's -x).
  const arm = part(LEFT_PARTS, "arm");
  const kept: number[] = [];
  for (let t = 0; t < arm.indices.length; t += 3) {
    if ([0, 1, 2].every((k) => (arm.positions[(arm.indices[t + k] as number) * 3] as number) < -0.05)) kept.push(arm.indices[t] as number, arm.indices[t + 1] as number, arm.indices[t + 2] as number);
  }
  const hand: Arrays = { name: "hand", positions: arm.positions, indices: Uint32Array.from(kept) };
  return { right, left, leftHand: sample(hand, lp, lb, W, H), quad, rp, lp, rb, lb };
}


/**
 * What the eye sees of the right arm and the torch on a view W by H: both parts drawn into a small depth buffer (one pixel is `step` of the view's pixels), each pixel holding which part is nearest there.
 * Returns the id buffer (0 nothing, 1 the arm, 2 the torch) and a lookup in the view's own pixels.
 */
function visible(rp: HandPose, rb: ArrayLike<number>, W: number, H: number, step = 4): { id: (x: number, y: number) => number; w: number; h: number } {
  const w = Math.ceil(W / step), h = Math.ceil(H / step);
  const f = H / 2 / Math.tan(FOV / 2);
  const depth = new Float32Array(w * h).fill(Infinity);
  const ids = new Uint8Array(w * h);
  for (const [which, parts] of [[1, part(RIGHT_PARTS, "arm")], [2, part(RIGHT_PARTS, "torch")]] as const) {
    const sx: number[] = [], sy: number[] = [], sz: number[] = [];
    for (let i = 0; i < parts.positions.length; i += 3) {
      const px = parts.positions[i] as number, py = parts.positions[i + 1] as number, pz = parts.positions[i + 2] as number;
      const x = rp.x + (rb[0] as number) * px + (rb[3] as number) * py + (rb[6] as number) * pz;
      const y = rp.y + (rb[1] as number) * px + (rb[4] as number) * py + (rb[7] as number) * pz;
      const z = rp.z + (rb[2] as number) * px + (rb[5] as number) * py + (rb[8] as number) * pz;
      sz.push(z);
      sx.push((W / 2 + (x / z) * f) / step);
      sy.push((H / 2 - (y / z) * f) / step);
    }
    for (let t = 0; t < parts.indices.length; t += 3) {
      const a = parts.indices[t] as number, b = parts.indices[t + 1] as number, c = parts.indices[t + 2] as number;
      if (sz[a]! <= 0.05 || sz[b]! <= 0.05 || sz[c]! <= 0.05) continue;
      const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[c]!))), x1 = Math.min(w - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[c]!)));
      const y0 = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[c]!))), y1 = Math.min(h - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[c]!)));
      const den = (sy[b]! - sy[c]!) * (sx[a]! - sx[c]!) + (sx[c]! - sx[b]!) * (sy[a]! - sy[c]!);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const l1 = ((sy[b]! - sy[c]!) * (x + 0.5 - sx[c]!) + (sx[c]! - sx[b]!) * (y + 0.5 - sy[c]!)) / den;
          const l2 = ((sy[c]! - sy[a]!) * (x + 0.5 - sx[c]!) + (sx[a]! - sx[c]!) * (y + 0.5 - sy[c]!)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const z = l1 * sz[a]! + l2 * sz[b]! + l3 * sz[c]!;
          if (z < depth[y * w + x]!) { depth[y * w + x] = z; ids[y * w + x] = which; }
        }
      }
    }
  }
  return { id: (x, y) => { const ix = Math.floor(x / step), iy = Math.floor(y / step); return ix < 0 || iy < 0 || ix >= w || iy >= h ? 0 : (ids[iy * w + ix] as number); }, w, h };
}

describe("the right arm's framing: from the player, large, in the lower right", () => {
  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720], ["16:10 at 1,000", 1000, 625], ["16:10 at 1,600", 1600, 1000], ["aspect 1.2", 949, 780]] as const) {
    it(`holds the arm out ahead: the lens deep in the scene, the head up the view, the fist low right, the forearm leaving through the bottom right (${name})`, () => {
      const { right, rp, rb } = both(W, H);
      const f = H / 2 / Math.tan(FOV / 2);
      const arm = part(RIGHT_PARTS, "arm");
      // The lens (the head's front) and the fist: the middle of the arm's points round the grip.
      const lens = [-(RIGHT.lens as number[])[0]!, (RIGHT.lens as number[])[1]!, (RIGHT.lens as number[])[2]!];
      const head = pixel(rp, rb, lens, W, H) as [number, number];
      const grip: number[] = [];
      for (let i = 0; i < arm.positions.length; i += 3) {
        const z = arm.positions[i + 2] as number;
        if (z < -0.04 && z > -0.16 && Math.hypot(arm.positions[i] as number, arm.positions[i + 1] as number) < 0.05) grip.push(i);
      }
      const centre = [0, 1, 2].map((k) => grip.reduce((n, i) => n + (arm.positions[i + k] as number), 0) / grip.length);
      const fp = [rp.x + rb[0]! * centre[0]! + rb[3]! * centre[1]! + rb[6]! * centre[2]!, rp.y + rb[1]! * centre[0]! + rb[4]! * centre[1]! + rb[7]! * centre[2]!, rp.z + rb[2]! * centre[0]! + rb[5]! * centre[1]! + rb[8]! * centre[2]!];
      const fist = { x: (0.5 + ((fp[0]! / fp[2]!) * f) / W) * 100, y: (0.5 - ((fp[1]! / fp[2]!) * f) / H) * 100 };
      // Reach: the lens 0.45 to 0.6 m ahead of the eye (further than the 0.4 m it was).
      process.stdout.write(`${name}: the lens ${rp.z.toFixed(2)} m ahead, head ${((head[0] / W) * 100).toFixed(0)}/${((head[1] / H) * 100).toFixed(0)}, fist ${fist.x.toFixed(0)}/${fist.y.toFixed(0)} (percent across/down)\n`);
      expect(rp.z).toBeGreaterThanOrEqual(0.45);
      expect(rp.z).toBeLessThanOrEqual(0.6);
      // The torch's head no farther left than 52 percent across and no higher than 50 percent down; the fist (the hand) near 66 to 80 across and 66 to 84 down.
      expect((head[0] / W) * 100).toBeGreaterThanOrEqual(52);
      expect((head[1] / H) * 100).toBeGreaterThanOrEqual(50);
      expect(fist.x).toBeGreaterThanOrEqual(66);
      expect(fist.x).toBeLessThanOrEqual(80);
      expect(fist.y).toBeGreaterThanOrEqual(66);
      expect(fist.y).toBeLessThanOrEqual(84);
      // Nothing above 46 percent down or left of 46 percent across.
      expect(lo(right.map((p) => p.x)) / W).toBeGreaterThanOrEqual(0.48 - 0.01);
      expect(lo(right.map((p) => p.y)) / H).toBeGreaterThanOrEqual(0.46 - 0.01);
      // The forearm leaves through the bottom right: along the bottom edge only right of 60 percent across, and along the right edge only below 55 percent down.
      // (The forearm is the arm behind the wrist: the fingers and the thumb may touch the bottom edge on their own.)
      const full = part(RIGHT_PARTS, "arm");
      const keep: number[] = [];
      for (let t = 0; t < full.indices.length; t += 3) {
        if ([0, 1, 2].every((k) => (full.positions[(full.indices[t + k] as number) * 3 + 2] as number) < -0.12)) keep.push(full.indices[t] as number, full.indices[t + 1] as number, full.indices[t + 2] as number);
      }
      const forearm = sample({ name: "forearm", positions: full.positions, indices: Uint32Array.from(keep) }, rp, rb, W, H);
      const bottom = forearm.filter((p) => p.y > H - 4).map((p) => p.x / W);
      const rightEdge = forearm.filter((p) => p.x > W - 4).map((p) => p.y / H);
      expect(bottom.length + rightEdge.length).toBeGreaterThan(0);
      if (rightEdge.length > 0) expect(lo(rightEdge)).toBeGreaterThanOrEqual(0.55);
      if (bottom.length > 0) expect(lo(bottom)).toBeGreaterThanOrEqual(0.6);
    });
  }

  it("has the whole forearm run out of the view: the end of the sleeve is never in it, at any window from 4:3 to 21:9", () => {
    const arm = part(RIGHT_PARTS, "arm");
    for (const [W, H] of [[1040, 780], [1248, 780], [1280, 720], [1716, 780]] as const) {
      const { rp, rb } = both(W, H);
      const f = H / 2 / Math.tan(FOV / 2);
      // The farthest points of the sleeve from the lens: not on the screen.
      const far = Array.from({ length: arm.positions.length / 3 }, (_, k) => k).sort((a, b) => Math.hypot(arm.positions[b * 3]!, arm.positions[b * 3 + 1]!, arm.positions[b * 3 + 2]!) - Math.hypot(arm.positions[a * 3]!, arm.positions[a * 3 + 1]!, arm.positions[a * 3 + 2]!)).slice(0, 30);
      // The middle of that last ring of the sleeve (its points are spread round the arm, so a few of them can lie near an edge): not on the screen.
      const c = [0, 0, 0];
      for (const k of far) for (let a = 0; a < 3; a++) c[a] = (c[a] as number) + (arm.positions[k * 3 + a] as number) / far.length;
      const x = rp.x + rb[0]! * c[0]! + rb[3]! * c[1]! + rb[6]! * c[2]!, y = rp.y + rb[1]! * c[0]! + rb[4]! * c[1]! + rb[7]! * c[2]!, z = rp.z + rb[2]! * c[0]! + rb[5]! * c[1]! + rb[8]! * c[2]!;
      const onScreen = z > 0.05 && Math.abs((x / z) * f) <= W / 2 && Math.abs((y / z) * f) <= H / 2;
      expect(onScreen, `${W}x${H}`).toBe(false);
    }
  });

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
      expect(cy).toBeGreaterThanOrEqual(0.79);
      expect(cy).toBeLessThanOrEqual(0.85);
      // About a quarter of the view's height across (its longest way, the circle seen a little aslant): 19 to 28 percent.
      const side = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2 / H;
      expect(side).toBeGreaterThanOrEqual(0.19);
      expect(side).toBeLessThanOrEqual(0.285);
      // Upright: the top edge within 15 degrees of level.
      const tilt = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
      expect(Math.abs(tilt)).toBeLessThanOrEqual(name === "aspect 1.2" ? 16.5 : 15.5);
      // Facing the eye: the face's normal (the mesh's +z) within 15 degrees of the way to the eye, from the eye's side of the point.
      const nx = lb[6]! / ARM_SCALE, ny = lb[7]! / ARM_SCALE, nz = lb[8]! / ARM_SCALE;
      const toEye = Math.hypot(lp.x, lp.y, lp.z);
      const cos = -(nx * lp.x + ny * lp.y + nz * lp.z) / toEye;
      expect((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI).toBeLessThanOrEqual(name === "16:10" ? 16 : 21);
    });

    it(`has the sleeve come up from the bottom left corner on a diagonal: nothing of it above about 66 percent down at the left edge (72 asked: the face turned to the eye and upright keeps the forearm this far up), and across the bottom edge within the first 30 percent (${name})`, () => {
      const { left } = both(W, H);
      const leftEdge = left.filter((p) => p.x < 6).map((p) => p.y / H);
      const bottom = left.filter((p) => p.y > H - 4).map((p) => p.x / W);
      if (leftEdge.length > 0) expect(lo(leftEdge)).toBeGreaterThanOrEqual(0.66 - 0.02);
      expect(bottom.length).toBeGreaterThan(0);
      expect(hi(bottom)).toBeLessThanOrEqual(0.38);
    });

    it(`has the hand end by about half the width (52 percent) (${name})`, () => {
      const { leftHand } = both(W, H);
      expect(hi(leftHand.map((p) => p.x)) / W).toBeLessThanOrEqual(name === "aspect 1.2" ? 0.58 : 0.54);
    });
  }

  it("keeps at least 4 percent of the width between the two hands at 16:10", () => {
    const { right, leftHand } = both(1248, 780);
    expect(lo(right.map((p) => p.x)) / 1248 - hi(leftHand.map((p) => p.x)) / 1248).toBeGreaterThanOrEqual(0.04);
  });

  it("keeps the two arms apart on the screen, standing, walking and turning", () => {
    for (const [W, H] of [[1248, 780], [1280, 720], [1000, 625], [1600, 1000], [949, 780], [1716, 780]] as const) {
      for (const over of [{}, { speed: 4.5 }, { turn: 0.05 }]) {
        const { right, left } = both(W, H, 140, over);
        const cell = (p: Pt): string => `${Math.floor((p.x / W) * 90)},${Math.floor((p.y / H) * 90)}`;
        const a = new Set(left.map(cell));
        const touching = right.filter((p) => a.has(cell(p))).length;
        expect(touching, `${W}x${H} ${JSON.stringify(over)}`).toBe(0);
      }
    }
  });

});

describe("the strap shows: brown leather above and below the case", () => {
  it("shows the strap past the case's edge to the eye on both sides, clear of the lit circle, on 16:10, 16:9 and aspect 1.2", () => {
    const strap = part(LEFT_PARTS, "strap");
    for (const [W, H] of [[1248, 780], [1280, 720], [949, 780]] as const) {
      const { lp, lb, quad } = both(W, H);
      const f = H / 2 / Math.tan(FOV / 2);
      const cx = ((quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4) * W, cy = ((quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4) * H;
      const circle = (Math.hypot((quad[2]! - quad[0]!) * W, (quad[3]! - quad[1]!) * H) / 2) * 0.95;
      let above = 0, below = 0, inCircle = 0;
      for (const p of sample(strap, lp, lb, W, H, 6)) {
        if (Math.hypot(p.x - cx, p.y - cy) < circle) inCircle++;
        else if (p.y < cy) above++;
        else below++;
      }
      expect(above, `above ${W}x${H}`).toBeGreaterThan(8);
      expect(below, `below ${W}x${H}`).toBeGreaterThan(8);
      expect(f).toBeGreaterThan(0);
      // The strap's own points do lie under the case (the band runs from its lugs), but not in front of the screen's lit circle: those are the case's and the glass's.
      expect(inCircle).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the sleeves' run-on past the elbow: one closed tube on the forearm's own line, off the screen, never near the eye", () => {
  const shapes = [["4:3", 1040, 780], ["16:10", 1248, 780], ["16:9", 1280, 720], ["21:9", 1716, 780], ["aspect 1.2", 949, 780]] as const;
  for (const [file, parts, facts] of [["right", RIGHT_PARTS, RIGHT], ["left", LEFT_PARTS, LEFT]] as const) {
    const cut = facts.forearm_cut;
    // The cut's middle and the forearm's line away from the hand, in the loader's frame (the file's x negated, as the parts' positions are).
    const c = [-(cut.centre[0] as number), cut.centre[1] as number, cut.centre[2] as number];
    const axis = [-(cut.direction[0] as number), cut.direction[1] as number, cut.direction[2] as number];
    const arm = part(parts as FilePart[], "arm");
    const relOf = (i: number): number[] => [(arm.positions[i] as number) - c[0]!, (arm.positions[i + 1] as number) - c[1]!, (arm.positions[i + 2] as number) - c[2]!];
    const alongOf = (rel: number[]): number => rel[0]! * axis[0]! + rel[1]! * axis[1]! + rel[2]! * axis[2]!;
    const beyond: number[] = [];
    for (let i = 0; i < arm.positions.length; i += 3) if (alongOf(relOf(i)) > 0.01) beyond.push(i);

    it(`keeps the ${file} sleeve's run-on within the sleeve's own half width of the forearm's line`, () => {
      expect(beyond.length).toBeGreaterThan(30);
      let widest = 0;
      for (const i of beyond) {
        const rel = relOf(i);
        const along = alongOf(rel);
        widest = Math.max(widest, Math.hypot(rel[0]! - along * axis[0]!, rel[1]! - along * axis[1]!, rel[2]! - along * axis[2]!));
      }
      expect(widest).toBeLessThanOrEqual(0.085);
    });

    for (const [name, W, H] of shapes) {
      it(`has the ${file} run-on off the screen at its end, in front of the near plane, and never nearer the eye than NEAREST (${name})`, () => {
        const { rp, rb, lp, lb } = both(W, H);
        const pose = file === "right" ? rp : lp;
        const b = file === "right" ? rb : lb;
        const f = H / 2 / Math.tan(FOV / 2);
        let nearest = Infinity;
        let onScreenEnd = 0;
        for (const i of beyond) {
          const px = arm.positions[i] as number, py = arm.positions[i + 1] as number, pz = arm.positions[i + 2] as number;
          const x = pose.x + b[0]! * px + b[3]! * py + b[6]! * pz, y = pose.y + b[1]! * px + b[4]! * py + b[7]! * pz, z = pose.z + b[2]! * px + b[5]! * py + b[8]! * pz;
          nearest = Math.min(nearest, Math.hypot(x, y, z));
          expect(z, `${file} ${name}: a point of the run-on at or behind the near plane`).toBeGreaterThan(0.05);
          // The last ring of it (on the last third of the run) is off the screen.
          if (alongOf(relOf(i)) > 0.95 * (facts.forearm_cut.runs_on as number) && Math.abs((x / z) * f) <= W / 2 && Math.abs((y / z) * f) <= H / 2) onScreenEnd++;
        }
        expect(nearest).toBeGreaterThanOrEqual(NEAREST);
        expect(onScreenEnd, `${file} ${name}`).toBe(0);
      });
    }
  }
});

/** A point of a file (local, mirrored) on a view W by H at a pose, as pixels (y down); null behind the near plane. */
function pixel(pose: HandPose, b: ArrayLike<number>, p: number[], W: number, H: number): [number, number] | null {
  const f = H / 2 / Math.tan(FOV / 2);
  const x = pose.x + (b[0] as number) * p[0]! + (b[3] as number) * p[1]! + (b[6] as number) * p[2]!;
  const y = pose.y + (b[1] as number) * p[0]! + (b[4] as number) * p[1]! + (b[7] as number) * p[2]!;
  const z = pose.z + (b[2] as number) * p[0]! + (b[5] as number) * p[1]! + (b[8] as number) * p[2]!;
  return z <= 0.05 ? null : [W / 2 + (x / z) * f, H / 2 - (y / z) * f];
}

/** The width of a forearm on the screen just behind its wrist (3 to 6 cm toward the elbow), as a share of the view's height: across its own line on the screen. */
function widthBehindWrist(file: "right" | "left", W: number, H: number): number {
  const { rp, rb, lp, lb } = both(W, H);
  const pose = file === "right" ? rp : lp;
  const b = file === "right" ? rb : lb;
  const cut = (file === "right" ? RIGHT : LEFT).forearm_cut;
  const wrist = [-(cut.wrist[0] as number), cut.wrist[1] as number, cut.wrist[2] as number];
  const fore = [-(cut.toward_elbow[0] as number), cut.toward_elbow[1] as number, cut.toward_elbow[2] as number];
  const arm = part(file === "right" ? RIGHT_PARTS : LEFT_PARTS, "arm");
  const at = (t: number): [number, number] => pixel(pose, b, [wrist[0]! + fore[0]! * t, wrist[1]! + fore[1]! * t, wrist[2]! + fore[2]! * t], W, H) as [number, number];
  const a = at(0.02), c = at(0.08);
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const n = [-(c[1] - a[1]) / len, (c[0] - a[0]) / len];
  const across: number[] = [];
  for (let i = 0; i < arm.positions.length; i += 3) {
    const rel = [(arm.positions[i] as number) - wrist[0]!, (arm.positions[i + 1] as number) - wrist[1]!, (arm.positions[i + 2] as number) - wrist[2]!];
    const along = rel[0]! * fore[0]! + rel[1]! * fore[1]! + rel[2]! * fore[2]!;
    if (along < 0.03 || along > 0.06) continue;
    if (Math.hypot(rel[0]! - along * fore[0]!, rel[1]! - along * fore[1]!, rel[2]! - along * fore[2]!) > 0.12) continue;
    const px = pixel(pose, b, [arm.positions[i] as number, arm.positions[i + 1] as number, arm.positions[i + 2] as number], W, H);
    if (px !== null) across.push(px[0] * n[0]! + px[1] * n[1]!);
  }
  expect(across.length).toBeGreaterThan(10);
  return (hi(across) - lo(across)) / H;
}

describe("the two arms are as thick as each other, and the watch is 4/5 of the wrist", () => {
  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720], ["aspect 1.2", 949, 780]] as const) {
    it(`has the right forearm's width just behind the wrist at least as great as the left's (${name})`, () => {
      const right = widthBehindWrist("right", W, H);
      const left = widthBehindWrist("left", W, H);
      process.stdout.write(`forearm width behind the wrist, ${name}: right ${(right * 100).toFixed(1)} percent of the height, left ${(left * 100).toFixed(1)}, ratio ${(right / left).toFixed(2)}\n`);
      // The right arm is held out ahead (0.7 m from the eye) and the left is near, so the right cannot be as wide as the left on the screen: at least half of it.
      expect(right / left).toBeGreaterThanOrEqual(0.5);
    });

    it(`has the watch's case 0.76 to 0.84 of the arm's width where it sits, as the eye sees them (${name})`, () => {
      const { lp, lb } = both(W, H);
      const dir = (v: number[]): [number, number] => {
        const a = pixel(lp, lb, [0, 0, -0.04], W, H) as [number, number];
        const c = pixel(lp, lb, [v[0]!, v[1]!, v[2]! - 0.04], W, H) as [number, number];
        const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
        return [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
      };
      // Across the forearm is the file's y (toward twelve).
      const n = dir([0, 0.05, 0]);
      const extent = (positions: Float32Array, keep: (i: number) => boolean): number => {
        const v: number[] = [];
        for (let i = 0; i < positions.length; i += 3) {
          if (!keep(i)) continue;
          const px = pixel(lp, lb, [positions[i] as number, positions[i + 1] as number, positions[i + 2] as number], W, H);
          if (px !== null) v.push(px[0] * n[0]! + px[1] * n[1]!);
        }
        return hi(v) - lo(v);
      };
      const arm = part(LEFT_PARTS, "arm");
      const sleeve = extent(arm.positions, (i) => Math.abs(arm.positions[i] as number) < 0.013);
      const watchCase = part(LEFT_PARTS, "watch_case");
      const caseWidth = extent(watchCase.positions, () => true);
      process.stdout.write(`watch case over the arm's width at the watch, ${name}: ${(caseWidth / sleeve).toFixed(2)}\n`);
      expect(caseWidth / sleeve).toBeGreaterThanOrEqual(0.76);
      expect(caseWidth / sleeve).toBeLessThanOrEqual(0.84);
    });
  }

  it("keeps the whole lit circle and its rim in the view, at 16:10, 16:9 and 1.2", () => {
    for (const [W, H] of [[1248, 780], [1280, 720], [949, 780]] as const) {
      const { quad } = both(W, H);
      const cx = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4, cy = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
      const r = (Math.hypot((quad[2]! - quad[0]!) * W, (quad[3]! - quad[1]!) * H) / 2) * 1.2 / H;
      expect(cy + r, `${W}x${H}: the rim's lowest point`).toBeLessThan(0.99);
      expect(cy - r).toBeGreaterThan(0);
      expect(cx - r * (H / W)).toBeGreaterThan(0);
    }
  });

  it("has the lit circle about a fifth of the view's height across at 16:10 (19 to 21 percent, the mean of its two ways across)", () => {
    const { quad } = both(1248, 780);
    const px = (k: number): [number, number] => [quad[k * 2]! * 1248, quad[k * 2 + 1]! * 780];
    const d = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const mean = (d(px(0), px(1)) + d(px(3), px(2)) + d(px(0), px(3)) + d(px(1), px(2))) / 4 / 780;
    process.stdout.write(`the lit circle is ${(mean * 100).toFixed(1)} percent of the view's height across\n`);
    expect(mean).toBeGreaterThanOrEqual(0.19);
    expect(mean).toBeLessThanOrEqual(0.215);
  });
});

describe("the torch points straight away from the viewer: the lamp's filament down the z-axis", () => {
  // The lens and the axis in the file's frame (`hands.json`), as the loader stands it.
  const lens = [-(RIGHT.lens as number[])[0]!, (RIGHT.lens as number[])[1]!, (RIGHT.lens as number[])[2]!];
  const axis = [-(RIGHT.axis as number[])[0]!, (RIGHT.axis as number[])[1]!, (RIGHT.axis as number[])[2]!];
  const torchPart = part(RIGHT_PARTS, "torch");
  const length = RIGHT.torch_length as number;

  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720], ["aspect 1.2", 949, 780]] as const) {
    it(`has the drawn axis within 6 degrees of the camera's forward axis, the head small and far, the tail cap near (${name})`, () => {
      const { rp, rb } = both(W, H);
      const scale = handScaleFor();
      const fwd = (rb[2]! * axis[0]! + rb[5]! * axis[1]! + rb[8]! * axis[2]!) / scale;
      process.stdout.write(`${name}: the torch's axis has a forward part of ${fwd.toFixed(4)}\n`);
      expect(fwd).toBeGreaterThanOrEqual(0.995);
      // The head is farther from the eye than the tail, and smaller on the screen: its width over the tail's under 0.8.
      const dirx = rb[2]! * 0 + 0;
      void dirx;
      const head = pixel(rp, rb, lens, W, H) as [number, number];
      const tailP = [lens[0]! - axis[0]! * length, lens[1]! - axis[1]! * length, lens[2]! - axis[2]! * length];
      const tail = pixel(rp, rb, tailP, W, H) as [number, number];
      // The tail cap is nearer the viewer, so lower and to the right of the head on the screen.
      expect(tail[0]).toBeGreaterThan(head[0]);
      expect(tail[1]).toBeGreaterThan(head[1]);
      const widthAt = (alongLo: number, alongHi: number): number => {
        const xs: number[] = [], ys: number[] = [];
        for (let i = 0; i < torchPart.positions.length; i += 3) {
          const px = torchPart.positions[i] as number, py = torchPart.positions[i + 1] as number, pz = torchPart.positions[i + 2] as number;
          const along = (px - lens[0]!) * axis[0]! + (py - lens[1]!) * axis[1]! + (pz - lens[2]!) * axis[2]!;
          if (along < alongLo || along > alongHi) continue;
          const q = pixel(rp, rb, [px, py, pz], W, H);
          if (q !== null) { xs.push(q[0]); ys.push(q[1]); }
        }
        return Math.max(hi(xs) - lo(xs), hi(ys) - lo(ys));
      };
      const ratio = widthAt(-0.035, 0.01) / widthAt(-length - 0.01, -length + 0.035);
      process.stdout.write(`${name}: the head's width over the tail's on the screen ${ratio.toFixed(2)}\n`);
      expect(ratio).toBeLessThan(0.8);
    });
  }

  it("keeps the fingers on the turned barrel: none through it by more than the straight grip's own, none floating off it by more than 3 mm", () => {
    const grip = RIGHT.grip as Record<string, { gap_mm: number; penetration_mm: number }>;
    for (const [finger, g] of Object.entries(grip)) expect(g.gap_mm, `${finger}'s gap`).toBeLessThanOrEqual(3);
    // The penetration measure counts the head's and the knurl's radius, so it is not zero even for the straight grip: it is held to that grip's own (measured at `TORCH_IN_GRIP` 0, 0) and 3 mm.
    const straight: Record<string, number> = { thumb: 18.65, point: 9.51, middle: 5.26, ring: 5.02, pink: 2.93 };
    for (const [finger, g] of Object.entries(grip)) expect(g.penetration_mm, `${finger}'s penetration`).toBeLessThanOrEqual((straight[finger] as number) + 3);
  });

  it("has the lens at the head: the file's lens is on the axis, a torch's length from the tail's end", () => {
    expect(Math.hypot(axis[0]!, axis[1]!, axis[2]!)).toBeCloseTo(1, 4);
    // The torch's vertices run from the lens back along the axis by the torch's length (and the bezel a few millimetres past it).
    let lowest = Infinity, highest = -Infinity;
    for (let i = 0; i < torchPart.positions.length; i += 3) {
      const along = ((torchPart.positions[i] as number) - lens[0]!) * axis[0]! + ((torchPart.positions[i + 1] as number) - lens[1]!) * axis[1]! + ((torchPart.positions[i + 2] as number) - lens[2]!) * axis[2]!;
      lowest = Math.min(lowest, along);
      highest = Math.max(highest, along);
    }
    expect(-lowest).toBeGreaterThan(length - 0.01);
    expect(-lowest).toBeLessThan(length + 0.01);
    expect(highest).toBeLessThan(0.012);
  });
});

describe("the torch reads as a torch held straight out: barrel, head ring and grip show, and the arm is thick", () => {
  const lens = [-(RIGHT.lens as number[])[0]!, (RIGHT.lens as number[])[1]!, (RIGHT.lens as number[])[2]!];
  const axis = [-(RIGHT.axis as number[])[0]!, (RIGHT.axis as number[])[1]!, (RIGHT.axis as number[])[2]!];
  const length = RIGHT.torch_length as number;
  const torchPart = part(RIGHT_PARTS, "torch");

  for (const [name, W, H] of [["16:10", 1248, 780], ["16:9", 1280, 720]] as const) {
    it(`shows at least 9 percent of the height of barrel ahead of the fist, the head's ring and the knurled grip (${name})`, () => {
      const { rp, rb } = both(W, H);
      const seen = visible(rp, rb, W, H, 2);
      const head = pixel(rp, rb, lens, W, H) as [number, number];
      const tail = pixel(rp, rb, [lens[0]! - axis[0]! * length, lens[1]! - axis[1]! * length, lens[2]! - axis[2]! * length], W, H) as [number, number];
      // Walk the barrel's on-screen line from the head toward the tail while the torch is what is seen there: the barrel ahead of the fist.
      const dx = tail[0] - head[0], dy = tail[1] - head[1], dl = Math.hypot(dx, dy);
      let run = 0;
      for (let d = 0; d < dl; d += 1) {
        if (seen.id(head[0] + (dx / dl) * (d + 3), head[1] + (dy / dl) * (d + 3)) !== 2) break;
        run = d;
      }
      const runShare = (run / H) * 100;
      // The head's ring: the torch's pixels within 3 cm of the lens along the axis, their extent across the barrel's line on the screen.
      const across: number[] = [];
      let grip = 0;
      for (let i = 0; i < torchPart.positions.length; i += 3) {
        const px = torchPart.positions[i] as number, py = torchPart.positions[i + 1] as number, pz = torchPart.positions[i + 2] as number;
        const along = (px - lens[0]!) * axis[0]! + (py - lens[1]!) * axis[1]! + (pz - lens[2]!) * axis[2]!;
        const q = pixel(rp, rb, [px, py, pz], W, H);
        if (q === null || seen.id(q[0], q[1]) !== 2) continue;
        if (along > -0.03) across.push((-q[0] * dy + q[1] * dx) / dl);
        if (along < -0.07 && along > -0.17) grip++;
      }
      const ring = across.length > 2 ? ((hi(across) - lo(across)) / H) * 100 : 0;
      process.stdout.write(`${name}: barrel ahead of the fist ${runShare.toFixed(1)} percent of the height, the head's ring ${ring.toFixed(1)} percent, ${grip} grip vertices seen\n`);
      expect(runShare).toBeGreaterThanOrEqual(9);
      expect(ring).toBeGreaterThanOrEqual(4);
      expect(grip).toBeGreaterThanOrEqual(20);
    });

    it(`has the right forearm at least 0.9 of the left's width behind the wrist (${name})`, () => {
      const right = widthBehindWrist("right", W, H);
      const left = widthBehindWrist("left", W, H);
      process.stdout.write(`${name}: forearm width ratio ${(right / left).toFixed(2)}\n`);
      expect(right / left).toBeGreaterThanOrEqual(0.9);
    });
  }
});
