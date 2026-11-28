import { describe, expect, it, vi } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";

type Mesh = { name: string; position: { set(x: number, y: number, z: number): void }; scaling: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; rotationQuaternion: { x: number; y: number; z: number; w: number }; visible: boolean };
const meshes: Mesh[] = [];

vi.mock("@babylonjs/lite", () => ({
  addToScene: () => undefined,
  removeFromScene: () => undefined,
  disposeMeshGpu: () => undefined,
  setMeshVisible: (m: Mesh, v: boolean) => {
    m.visible = v;
  },
  createMeshFromData: (_e: unknown, name: string) => {
    const m: Mesh = {
      name, position: { set: () => undefined }, rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 }, visible: true,
      scaling: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    };
    meshes.push(m);
    return m;
  },
}));

describe("the part for the left arm and the watch", () => {
  it("draws nothing while the watch is off and the arm is down, writes the shared record, and is hidden in a car", async () => {
    const { createWatchParts } = await import("../../src/game/hand/watchParts.js");
    const { WATCH_SEEN, resetWatch, toggleWatch } = await import("../../src/game/hand/watchSeen.js");
    const { ARM_SCALE } = await import("../../src/game/hand/watchPose.js");
    resetWatch();
    const noop = (): void => undefined;
    const part = createWatchParts({
      engine: {} as never, scene: {} as never, material: {} as never, order: 1, textured: false, uploads: { count: noop, made: noop, dropped: noop }, ready: () => null, dirty: noop, blocked: () => false,
    });
    expect(meshes.length).toBe(1);
    // Made larger than life, by the arm's scale.
    expect(meshes[0]!.scaling.x).toBeCloseTo(ARM_SCALE, 9);
    const axes = cameraAxes(0, 0, 0, restAxes());
    const frame = { dt: 1 / 60, eye: { x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, roll: 0 }, axes, ridePhase: 0, insidePhase: 0, roomUndrawn: false, speed: 0, sprinting: false, aspect: 1.6, litGain: 3 };
    for (let i = 0; i < 100; i++) part.frame(frame);
    expect(part.drawn()).toBe(0);
    expect(meshes[0]!.visible).toBe(false);
    expect(WATCH_SEEN.shown).toBe(false);
    // On: it rises, draws, and the record says where the lit screen's square is.
    toggleWatch();
    for (let i = 0; i < 4; i++) part.frame(frame);
    expect(part.drawn()).toBe(1);
    expect(WATCH_SEEN.shown).toBe(true);
    for (let i = 0; i < 30; i++) part.frame(frame);
    expect(WATCH_SEEN.raised).toBe(1);
    const q = Array.from(WATCH_SEEN.quad);
    expect(q.every((v) => v > 0 && v < 1)).toBe(true);
    // Seated in a car: not drawn, at once, though the switch is on.
    part.frame({ ...frame, ridePhase: 2 });
    expect(part.drawn()).toBe(0);
    expect(WATCH_SEEN.shown).toBe(false);
    expect(WATCH_SEEN.on).toBe(true);
    // Out of the car, with the switch still on, it rises again.
    for (let i = 0; i < 30; i++) part.frame(frame);
    expect(part.drawn()).toBe(1);
    // Off: it drops, and when it is down nothing is drawn.
    toggleWatch();
    for (let i = 0; i < 40; i++) part.frame(frame);
    expect(part.drawn()).toBe(0);
    expect(meshes[0]!.visible).toBe(false);
    expect(WATCH_SEEN.raised).toBe(0);
    resetWatch();
  });
});
