import { describe, expect, it, vi } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { readFileParts, stubParts } from "./armModels.js";
import { FOV, HAND_SCALE, holdFor, newHandPose, newHandState, stepHand, torchBasis, type HandInput } from "../../src/game/hand/handPose.js";

type Mesh = { name: string; position: { set(x: number, y: number, z: number): void }; scaling: { set(x: number, y: number, z: number): void }; rotationQuaternion: { x: number; y: number; z: number; w: number }; visible: boolean };
const meshes: Mesh[] = [];
const visibleLog: boolean[] = [];

vi.mock("@babylonjs/lite", () => ({
  addToScene: () => undefined,
  removeFromScene: () => undefined,
  disposeMeshGpu: () => undefined,
  createMeshFromData: () => undefined,
  setMeshVisible: (m: Mesh, v: boolean) => {
    m.visible = v;
    visibleLog.push(v);
  },
}));

const ASPECTS: [string, number][] = [["4:3", 4 / 3], ["16:10", 1.6], ["16:9", 16 / 9], ["21:9", 21 / 9]];
const input = (over: Partial<HandInput>): HandInput => ({ dt: 1 / 60, want: false, hidden: false, speed: 0, sprinting: false, yaw: 0, pitch: 0, clear: 1, aspect: 1.6, ...over });

/** How many sampled points of the hand's triangles are on a view of this aspect, W by H, at the pose. */
function onScreen(aspect: number, pose: ReturnType<typeof newHandPose>, positions: Float32Array, indices: Uint32Array): number {
  const H = 1000;
  const W = H * aspect;
  const f = H / 2 / Math.tan(FOV / 2);
  const b = new Float64Array(9);
  torchBasis(restAxes(), pose, b, HAND_SCALE);
  const at = (k: number): number[] => {
    const px = positions[k * 3] as number, py = positions[k * 3 + 1] as number, pz = positions[k * 3 + 2] as number;
    return [pose.x + b[0]! * px + b[3]! * py + b[6]! * pz, pose.y + b[1]! * px + b[4]! * py + b[7]! * pz, pose.z + b[2]! * px + b[5]! * py + b[8]! * pz];
  };
  let n = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = at(indices[t] as number), c = at(indices[t + 1] as number), d = at(indices[t + 2] as number);
    for (let u = 0; u <= 4; u++) {
      for (let v = 0; v <= 4 - u; v++) {
        const w = 4 - u - v;
        const x = (a[0]! * u + c[0]! * v + d[0]! * w) / 4, y = (a[1]! * u + c[1]! * v + d[1]! * w) / 4, z = (a[2]! * u + c[2]! * v + d[2]! * w) / 4;
        if (z <= 0.05) continue;
        const sx = W / 2 + (x / z) * f, sy = H / 2 - (y / z) * f;
        if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) n++;
      }
    }
  }
  return n;
}

describe("the hand lowered", () => {
  it("is nowhere in view once the lowering is over, at any pitch of the camera, on any window from 4:3 to 21:9, standing, walking or sprinting", async () => {
    const parts = readFileParts("hand.right");
    for (const [name, aspect] of ASPECTS) {
      for (const motion of [{ speed: 0, sprinting: false }, { speed: 4.5, sprinting: false }, { speed: 7, sprinting: true }]) {
        for (const pitch of [-1.4, -0.7, 0, 0.7, 1.4]) {
          const state = newHandState();
          const pose = newHandPose();
          // Up first, then switched off: the lowering runs its course.
          for (let i = 0; i < 40; i++) stepHand(state, input({ want: true, aspect, pitch, ...motion }), pose);
          for (let i = 0; i < 40; i++) stepHand(state, input({ want: false, aspect, pitch, ...motion }), pose);
          expect(pose.shown, `${name} ${JSON.stringify(motion)} pitch ${pitch}`).toBe(false);
          expect(pose.raised).toBe(0);
          for (const part of parts) expect(onScreen(aspect, pose, part.positions, part.indices), `${name} ${JSON.stringify(motion)} pitch ${pitch}: ${part.name}`).toBe(0);
        }
      }
    }
  });

  it("drops straight down out of the bottom of the view as it lowers, and rises from below: the same distance from the eye and the same place across the screen, only lower", () => {
    for (const [, aspect] of ASPECTS) {
      const state = newHandState();
      const pose = newHandPose();
      for (let i = 0; i < 40; i++) stepHand(state, input({ want: true, aspect }), pose);
      const hold = holdFor(aspect);
      const across = pose.x / pose.z;
      let last = pose.y;
      let steps = 0;
      while (pose.shown && steps++ < 60) {
        stepHand(state, input({ want: false, aspect }), pose);
        // Falling: never back up, the depth and the share across the screen as they were.
        expect(pose.y).toBeLessThanOrEqual(last + 1e-4);
        last = pose.y;
        expect(pose.z).toBeCloseTo(hold.z, 2);
        expect(pose.x / pose.z).toBeCloseTo(across, 1);
      }
      // Rising is the same road back up.
      for (let i = 0; i < 40; i++) {
        const before = pose.y;
        stepHand(state, input({ want: true, aspect }), pose);
        expect(pose.y).toBeGreaterThanOrEqual(before - 1e-4);
        expect(pose.z).toBeCloseTo(hold.z, 2);
      }
    }
  });
});

describe("the part draws nothing while the lamp is off and the hand is down", () => {
  it("reports no draw, and has no mesh visible, until the torch is on again; then the hand's draw, and the lens's too once it is lit", async () => {
    const { createHandParts } = await import("../../src/game/hand/handParts.js");
    const { HAND_SWITCH, resetHand } = await import("../../src/game/hand/handSwitch.js");
    resetHand();
    const noop = (): void => undefined;
    const made = stubParts("hand.right");
    for (const p of made) meshes.push(p.mesh as never);
    const part = createHandParts({
      engine: {} as never, scene: {} as never, tier: "medium", air: noop as never, ahead: noop as never, lamps: {} as never, signal: new AbortController().signal, uploads: { count: noop, made: noop, dropped: noop },
      ready: () => null, dirty: noop, blocked: () => false,
    }, made);
    const lamp = { at: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, angle: 1.5, range: 25 }, lit: { on: false, state: { intensity: 400, colour: { r: 1, g: 0.92, b: 0.78 } } } };
    const axes = cameraAxes(0, 0, 0, restAxes());
    const frame = { dt: 1 / 60, eye: { x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, roll: 0 }, axes, ridePhase: 0, insidePhase: 0, roomUndrawn: false, speed: 0, sprinting: false, aspect: 1.6, litGain: 3 };
    expect(meshes.map((m) => m.name)).toEqual(["arm", "torch", "torch_glass"]);
    for (let i = 0; i < 120; i++) part.frame(frame, lamp);
    expect(part.drawn()).toBe(0);
    expect(meshes.every((m) => !m.visible)).toBe(true);
    expect(part.torch.lit).toBe(false);
    // Switched on: the hand rises and draws, and the lens with it once the light is on.
    HAND_SWITCH.on = true;
    lamp.lit.on = true;
    for (let i = 0; i < 3; i++) part.frame(frame, lamp);
    expect(part.drawn()).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 40; i++) part.frame(frame, lamp);
    expect(part.drawn()).toBe(3);
    expect(part.torch.lit).toBe(true);
    // The lit disc is placed as the hand is, so it faces along the DRAWN axis (turned in toward the middle), and the beam leaves the lens's place along the beam's own axis.
    const bodyMesh = meshes.find((m) => m.name === "torch") as Mesh;
    const lensMesh = meshes.find((m) => m.name === "torch_glass") as Mesh;
    expect(lensMesh.rotationQuaternion).toEqual(bodyMesh.rotationQuaternion);
    const q = bodyMesh.rotationQuaternion;
    const turned = (vx: number, vy: number, vz: number): number[] => {
      const cx = q.y * vz - q.z * vy, cy = q.z * vx - q.x * vz, cz = q.x * vy - q.y * vx;
      return [vx + 2 * (q.w * cx + q.y * cz - q.z * cy), vy + 2 * (q.w * cy + q.z * cx - q.x * cz), vz + 2 * (q.w * cz + q.x * cy - q.y * cx)];
    };
    const faces = turned(0, 0, 1);
    const toWorld = (x: number, y: number, z: number): number[] => [axes.rx * x + axes.ux * y + axes.fx * z, axes.ry * x + axes.uy * y + axes.fy * z, axes.rz * x + axes.uz * y + axes.fz * z];
    const drawn = toWorld(part.pose.mx, part.pose.my, part.pose.mz);
    const beam = toWorld(part.pose.ax, part.pose.ay, part.pose.az);
    for (let k = 0; k < 3; k++) expect(faces[k]).toBeCloseTo(drawn[k]!, 6);
    expect(lamp.at.dx).toBeCloseTo(beam[0]!, 6);
    expect(lamp.at.dy).toBeCloseTo(beam[1]!, 6);
    expect(lamp.at.dz).toBeCloseTo(beam[2]!, 6);
    expect(Math.hypot(faces[0]! - beam[0]!, faces[1]! - beam[1]!, faces[2]! - beam[2]!)).toBeGreaterThan(0.2);
    expect(part.torch.dx).toBeCloseTo(lamp.at.dx, 9);
    // Switched off: the light goes at once, the hand lowers, and when it is down nothing is drawn.
    HAND_SWITCH.on = false;
    lamp.lit.on = false;
    part.frame(frame, lamp);
    expect(part.torch.lit).toBe(false);
    for (let i = 0; i < 40; i++) part.frame(frame, lamp);
    expect(part.drawn()).toBe(0);
    expect(meshes.every((m) => !m.visible)).toBe(true);
    // `hand up` shows it with the lamp off, as the only way to.
    HAND_SWITCH.forced = true;
    for (let i = 0; i < 40; i++) part.frame(frame, lamp);
    expect(part.drawn()).toBe(2);
    resetHand();
  });
});
