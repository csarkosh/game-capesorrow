import { describe, expect, it } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import {
  DRAWN_PITCH, DRAWN_YAW, FOV, HOLD, HOLD_DEPTH, HOLD_SCREEN, AIM_DISTANCE, AIM_DROP, LOWER_SECONDS, aimAngles, clearAhead, holdFor, loweredFor, MAX_LAG, NEAREST, RAISE_SECONDS, basisQuaternion, handHidden, holdAxis, lensWorld, newHandPose, newHandState, stepHand, torchBasis,
  type HandInput,
} from "../../src/game/hand/handPose.js";

const input = (over: Partial<HandInput> = {}): HandInput => ({ dt: 1 / 60, want: false, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect: 1.6, ...over });

/** Steps a hand for `seconds` at 60 frames a second with a fixed input, and returns its state and pose. */
function run(seconds: number, over: Partial<HandInput>, state = newHandState(), pose = newHandPose()): { state: ReturnType<typeof newHandState>; pose: ReturnType<typeof newHandPose> } {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) stepHand(state, input(over), pose);
  return { state, pose };
}

describe("the hand's rise and fall", () => {
  it("is down and not drawn at rest", () => {
    const { pose } = run(1, {});
    expect(pose.shown).toBe(false);
    expect(pose.raised).toBe(0);
    expect(pose.y).toBeCloseTo(loweredFor(1.6).y, 6);
  });

  it("rises in a quarter of a second to its hold and stays there", () => {
    const half = run(RAISE_SECONDS / 2, { want: true });
    expect(half.pose.shown).toBe(true);
    expect(half.pose.raised).toBeGreaterThan(0.3);
    expect(half.pose.raised).toBeLessThan(0.7);
    const full = run(RAISE_SECONDS + 1 / 30, { want: true });
    expect(full.pose.raised).toBe(1);
    expect(full.pose.x).toBeCloseTo(HOLD.x, 2);
    expect(full.pose.y).toBeCloseTo(HOLD.y, 1);
    expect(full.pose.z).toBeCloseTo(HOLD.z, 2);
  });

  it("is under way at a tenth of a second and has not arrived", () => {
    expect(run(0.1, { want: true }).pose.raised).toBeLessThan(1);
  });

  it("lowers in a fifth of a second, from where it was", () => {
    const up = run(0.5, { want: true });
    const mid = run(LOWER_SECONDS / 2, { want: false }, up.state, up.pose);
    expect(mid.pose.shown).toBe(true);
    expect(mid.pose.raised).toBeGreaterThan(0.2);
    expect(mid.pose.raised).toBeLessThan(0.8);
    const down = run(LOWER_SECONDS / 2 + 1 / 30, { want: false }, mid.state, mid.pose);
    expect(down.pose.shown).toBe(false);
  });

  it("goes back down from part way when it is turned off before it arrives", () => {
    const part = run(0.1, { want: true });
    const r = part.pose.raised;
    const back = run(0.05, { want: false }, part.state, part.pose);
    expect(back.pose.raised).toBeLessThan(r);
    expect(back.pose.raised).toBeGreaterThan(0);
  });
});

describe("the hold", () => {
  it("stands the torch's head where the screen says, whatever the window's shape: at `HOLD_SCREEN`", () => {
    for (const aspect of [1.25, 1.6, 16 / 9, 2.1]) {
      const state = newHandState();
      const pose = newHandPose();
      run(0.6, { want: true, aspect }, state, pose);
      const half = Math.tan(FOV / 2);
      const across = 0.5 + pose.x / pose.z / (half * aspect) / 2;
      const down = 0.5 - pose.y / pose.z / half / 2;
      expect(across).toBeCloseTo(HOLD_SCREEN.x, 1);
      expect(down).toBeCloseTo(HOLD_SCREEN.y, 1);
    }
    expect(holdFor(1.6).z).toBeCloseTo(HOLD_DEPTH, 6);
    // The lens is at least 0.4 m from the eye.
    expect(HOLD_DEPTH).toBeGreaterThanOrEqual(0.4);
  });

  it("aims the beam across the middle of the view and AIM_DROP below it, AIM_DISTANCE ahead: so it lights the ground ahead and a face in the view's middle", () => {
    for (const aspect of [1.2, 1.6, 2.2]) {
      const [ax, ay, az] = holdAxis(aspect);
      const h = holdFor(aspect);
      // The lens stands right of the eye, so the beam leans left.
      expect(ax).toBeLessThan(0);
      // Followed to the plane AIM_DISTANCE ahead of the eye, it is at the view's middle across and AIM_DROP below it.
      const t = (AIM_DISTANCE - h.z) / az;
      expect(h.x + ax * t).toBeCloseTo(0, 6);
      expect(h.y + ay * t).toBeCloseTo(-AIM_DROP, 6);
      // From an eye 1.6 m up and looking level, the beam's middle meets the ground between 5 and 12 m ahead.
      const down = (1.6 + h.y) / -ay;
      expect(h.z + az * down).toBeGreaterThan(5);
      expect(h.z + az * down).toBeLessThan(12);
      // A face in the middle of the view 2 m off is within 20 degrees of the beam's axis (the cone's half angle is 28.6).
      const fx = -h.x, fy = -h.y, fz = 2 - h.z;
      const cos = (fx * ax + fy * ay + fz * az) / Math.hypot(fx, fy, fz);
      expect((Math.acos(cos) * 180) / Math.PI).toBeLessThan(20);
    }
  });

  it("is where the lamp stands: the lens, along the torch's axis, carried to the world", () => {
    const state = newHandState();
    const pose = newHandPose();
    run(0.6, { want: true, yaw: 0.7, pitch: 0.15 }, state, pose);
    const axes = cameraAxes(0.7, 0.15, 0, restAxes());
    const lens = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    const eye = { x: 12, y: 3, z: -4 };
    lensWorld(eye.x, eye.y, eye.z, axes, pose, lens);
    const rel = [lens.x - eye.x, lens.y - eye.y, lens.z - eye.z];
    const along = (v: number[], x: number, y: number, z: number): number => v[0]! * x + v[1]! * y + v[2]! * z;
    const hold = holdFor(1.6);
    expect(along(rel, axes.rx, axes.ry, axes.rz)).toBeCloseTo(hold.x, 2);
    expect(along(rel, axes.ux, axes.uy, axes.uz)).toBeCloseTo(hold.y, 1);
    expect(along(rel, axes.fx, axes.fy, axes.fz)).toBeCloseTo(hold.z, 2);
    expect(Math.hypot(lens.dx, lens.dy, lens.dz)).toBeCloseTo(1, 6);
    // The beam's axis, in the camera's frame, is the hold's: the world's carried back.
    expect(along([lens.dx, lens.dy, lens.dz], axes.fx, axes.fy, axes.fz)).toBeCloseTo(holdAxis()[2], 2);
    expect(along([lens.dx, lens.dy, lens.dz], axes.ux, axes.uy, axes.uz)).toBeCloseTo(holdAxis()[1], 2);
  });

  it("keeps two axes apart: the beam's (the tilt that was set, unchanged) and the one the torch is drawn along (turned in toward the middle and a little up)", () => {
    const pose = newHandPose();
    run(0.6, { want: true }, newHandState(), pose);
    // The beam's axis is the aim through the middle of the view.
    const aim = aimAngles(1.6);
    expect(pose.ax).toBeCloseTo(Math.sin(aim.yaw) * Math.cos(aim.pitch), 6);
    expect(pose.ay).toBeCloseTo(-Math.sin(aim.pitch), 6);
    expect(pose.az).toBeCloseTo(Math.cos(aim.yaw) * Math.cos(aim.pitch), 6);
    // The drawn axis is `DRAWN_YAW` and `DRAWN_PITCH`: into the scene, a little left and up.
    expect(pose.mx).toBeCloseTo(Math.sin(DRAWN_YAW) * Math.cos(DRAWN_PITCH), 2);
    expect(pose.my).toBeCloseTo(-Math.sin(DRAWN_PITCH), 2);
    expect(Math.hypot(pose.mx, pose.my, pose.mz)).toBeCloseTo(1, 6);
    // The torch is drawn as the owner's reference shows it (`handScreen.test.ts` measures the angle on the screen): up and to the left, seen along its side (mostly across the view, a little
    // away), and the beam, which goes through the view's middle and down to the street, may differ from it.
    expect(pose.mx).toBeLessThan(-0.6);
    expect(pose.my).toBeGreaterThan(0.3);
    expect(Math.abs(pose.mz)).toBeLessThan(0.4);
    // Lowered, the drawn axis is not the beam's either way round and nothing is lit: only the pair at the hold matters, and both are unit vectors.
    expect(Math.hypot(pose.ax, pose.ay, pose.az)).toBeCloseTo(1, 6);
  });

  it("has a basis whose forward is the DRAWN axis, orthonormal, and a quaternion that turns the torch's frame to it", () => {
    const pose = newHandPose();
    run(0.6, { want: true }, newHandState(), pose);
    const axes = cameraAxes(1.1, -0.2, 0, restAxes());
    const b = new Float64Array(9);
    torchBasis(axes, pose, b);
    const dotv = (i: number, j: number): number => b[i]! * b[j]! + b[i + 1]! * b[j + 1]! + b[i + 2]! * b[j + 2]!;
    for (const i of [0, 3, 6]) expect(dotv(i, i)).toBeCloseTo(1, 6);
    expect(dotv(0, 3)).toBeCloseTo(0, 6);
    expect(dotv(3, 6)).toBeCloseTo(0, 6);
    // The torch's forward is the drawn axis carried to the world; the lens's beam is the other axis, and the two differ.
    const world = (x: number, y: number, z: number): number[] => [axes.rx * x + axes.ux * y + axes.fx * z, axes.ry * x + axes.uy * y + axes.fy * z, axes.rz * x + axes.uz * y + axes.fz * z];
    const drawn = world(pose.mx, pose.my, pose.mz);
    expect(b[6]).toBeCloseTo(drawn[0]!, 6);
    expect(b[7]).toBeCloseTo(drawn[1]!, 6);
    expect(b[8]).toBeCloseTo(drawn[2]!, 6);
    const lens = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    lensWorld(0, 0, 0, axes, pose, lens);
    const beam = world(pose.ax, pose.ay, pose.az);
    expect(lens.dx).toBeCloseTo(beam[0]!, 6);
    expect(lens.dy).toBeCloseTo(beam[1]!, 6);
    expect(lens.dz).toBeCloseTo(beam[2]!, 6);
    expect(Math.hypot(b[6]! - lens.dx, b[7]! - lens.dy, b[8]! - lens.dz)).toBeGreaterThan(0.2);
    // The quaternion's rotation matrix (the standard one) has the basis for its columns.
    const q: number[] = [0, 0, 0, 1];
    basisQuaternion(b, q);
    const [x, y, z, w] = q as [number, number, number, number];
    const col = (vx: number, vy: number, vz: number): number[] => {
      // v + 2w(q x v) + 2 q x (q x v)
      const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
      return [vx + 2 * (w * cx + y * cz - z * cy), vy + 2 * (w * cy + z * cx - x * cz), vz + 2 * (w * cz + x * cy - y * cx)];
    };
    for (const [k, v] of [[0, [1, 0, 0]], [3, [0, 1, 0]], [6, [0, 0, 1]]] as const) {
      const r = col(v[0], v[1], v[2]);
      expect(r[0]).toBeCloseTo(b[k]!, 6);
      expect(r[1]).toBeCloseTo(b[k + 1]!, 6);
      expect(r[2]).toBeCloseTo(b[k + 2]!, 6);
    }
  });
});

describe("the hand's motions", () => {
  const spread = (over: Partial<HandInput>): number => {
    const state = newHandState();
    const pose = newHandPose();
    run(0.5, { want: true, ...over }, state, pose);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 240; i++) {
      stepHand(state, input({ want: true, ...over }), pose);
      lo = Math.min(lo, pose.y);
      hi = Math.max(hi, pose.y);
    }
    return hi - lo;
  };

  it("bobs with the ground speed: more at a walk than at a stand, and at a stand it still breathes", () => {
    const stand = spread({ speed: 0 });
    const walk = spread({ speed: 4 });
    expect(stand).toBeGreaterThan(0.002);
    expect(walk).toBeGreaterThan(stand * 2);
    expect(spread({ speed: 2 })).toBeLessThan(walk);
  });

  it("is lower and steadier when sprinting", () => {
    const sprint = run(1, { want: true, speed: 7, sprinting: true });
    expect(sprint.pose.y).toBeLessThan(HOLD.y - 0.01);
    expect(spread({ speed: 7, sprinting: true })).toBeLessThan(spread({ speed: 5 }));
  });

  it("is raised a little when the view looks steeply down", () => {
    const level = run(1, { want: true, pitch: 0 }).pose;
    const down = run(1, { want: true, pitch: 1.3 }).pose;
    expect(down.y).toBeGreaterThan(level.y + 0.02);
    expect(down.y - level.y).toBeLessThan(0.1);
  });

  it("lags a quick turn, by a few degrees at most, and comes back", () => {
    const state = newHandState();
    const pose = newHandPose();
    run(0.5, { want: true }, state, pose);
    const rest = pose.x;
    let peak = 0;
    let yaw = 0;
    for (let i = 0; i < 30; i++) {
      yaw += 0.3;
      stepHand(state, input({ want: true, yaw }), pose);
      peak = Math.max(peak, Math.abs(state.lagYaw));
      expect(Math.abs(state.lagYaw)).toBeLessThanOrEqual(MAX_LAG + 1e-12);
    }
    expect(peak).toBeGreaterThan(0.02);
    // Turning right, the hand is left behind: it sits to the left of its rest.
    expect(pose.x).toBeLessThan(rest);
    run(1, { want: true, yaw }, state, pose);
    expect(Math.abs(state.lagYaw)).toBeLessThan(1e-3);
    expect(pose.x).toBeCloseTo(rest, 2);
  });

  it("does not lag a turn across the half circle's seam as a spin", () => {
    const state = newHandState();
    const pose = newHandPose();
    run(0.5, { want: true, yaw: Math.PI - 0.01 }, state, pose);
    stepHand(state, input({ want: true, yaw: -Math.PI + 0.01 }), pose);
    expect(Math.abs(state.lagYaw)).toBeLessThan(0.02);
  });

  it("is drawn in toward the eye by a wall, along the line it is seen on, so that it keeps its place on the screen", () => {
    const open = run(1, { want: true, clear: 1 }).pose;
    const wall = run(1, { want: true, clear: 0 }).pose;
    expect(wall.z).toBeLessThan(open.z * 0.95);
    expect(wall.z).toBeGreaterThan(0.1);
    expect(wall.x / wall.z).toBeCloseTo(open.x / open.z, 3);
    expect(wall.y / wall.z).toBeCloseTo(open.y / open.z, 3);
  });

  it("is not drawn in by walls in a room, where every place reads as inside the town's footprints", () => {
    const everywhere = (): boolean => true;
    const axes = restAxes();
    expect(clearAhead(everywhere, 0, 60, 0, axes, 2)).toBe(1);
    expect(clearAhead(everywhere, 0, 1.6, 0, axes, 0)).toBe(0);
    expect(clearAhead(() => false, 0, 1.6, 0, axes, 0)).toBe(1);
    // So in a room, under a dark screen's end, the hand stands at its hold and is shown.
    const pose = newHandPose();
    const state = newHandState();
    run(0.6, { want: !handHidden(0, 2, false), hidden: handHidden(0, 2, false), clear: clearAhead(everywhere, 0, 60, 0, axes, 2) }, state, pose);
    expect(pose.shown).toBe(true);
    expect(pose.raised).toBe(1);
    expect(pose.z).toBeCloseTo(holdFor(1.6).z, 2);
  });
});

describe("how near the eye it comes", () => {
  it("never nearer than 14 cm, in any state it can be in", () => {
    const state = newHandState();
    const pose = newHandPose();
    let nearest = Infinity;
    let yaw = 0;
    for (let i = 0; i < 1500; i++) {
      yaw += Math.sin(i * 0.05) * 0.4;
      const over: Partial<HandInput> = { want: i % 400 < 300, speed: (i % 300) / 40, sprinting: i % 500 > 400, yaw, pitch: Math.sin(i * 0.013) * 1.4, clear: (i % 90) / 90 };
      stepHand(state, input(over), pose);
      nearest = Math.min(nearest, Math.hypot(pose.x, pose.y, pose.z));
      expect(Math.abs(state.lagYaw)).toBeLessThanOrEqual(MAX_LAG + 1e-12);
    }
    expect(nearest).toBeGreaterThanOrEqual(NEAREST);
  });
});

describe("when the hand is hidden", () => {
  it("is hidden while seated, getting in or out, and under the dark screen at a door; shown on foot in the street and in a room", () => {
    expect(handHidden(0, 0, false)).toBe(false);
    expect(handHidden(1, 0, false)).toBe(true);
    expect(handHidden(2, 0, false)).toBe(true);
    expect(handHidden(3, 0, false)).toBe(true);
    expect(handHidden(0, 1, false)).toBe(true);
    expect(handHidden(0, 3, false)).toBe(true);
    expect(handHidden(0, 2, true)).toBe(true);
    expect(handHidden(0, 2, false)).toBe(false);
  });

  it("goes down at once when hidden, and rises again when the hiding is over if the lamp is on", () => {
    const up = run(0.5, { want: true });
    stepHand(up.state, input({ want: true, hidden: true }), up.pose);
    expect(up.pose.shown).toBe(false);
    expect(up.pose.raised).toBe(0);
    const after = run(RAISE_SECONDS / 2, { want: true }, up.state, up.pose);
    expect(after.pose.shown).toBe(true);
    expect(after.pose.raised).toBeLessThan(1);
    expect(run(RAISE_SECONDS, { want: true }, after.state, after.pose).pose.raised).toBe(1);
  });
});
