import { describe, expect, it, vi } from "vitest";
import { cameraAxes, restAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { stubParts } from "./armModels.js";

type Mesh = { name: string; position: { set(x: number, y: number, z: number): void }; scaling: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; rotationQuaternion: { x: number; y: number; z: number; w: number }; visible: boolean };
const meshes: Mesh[] = [];

vi.mock("@babylonjs/lite", () => ({
  addToScene: () => undefined,
  removeFromScene: () => undefined,
  disposeMeshGpu: () => undefined,
  createMeshFromData: () => undefined,
  setMeshVisible: (m: Mesh, v: boolean) => {
    m.visible = v;
  },
}));

describe("the part for the left arm and the watch", () => {
  it("draws nothing while the watch is off and the arm is down, writes the shared record, and is hidden in a car", async () => {
    const { createWatchParts } = await import("../../src/game/hand/watchParts.js");
    const { WATCH_SEEN, resetWatch, toggleWatch } = await import("../../src/game/hand/watchSeen.js");
    const { ARM_SCALE } = await import("../../src/game/hand/watchPose.js");
    resetWatch();
    const noop = (): void => undefined;
    const made = stubParts("hand.left");
    for (const p of made) meshes.push(p.mesh as never);
    const part = createWatchParts({
      engine: {} as never, scene: {} as never, tier: "medium", air: noop as never, ahead: noop as never, lamps: {} as never, signal: new AbortController().signal, uploads: { count: noop, made: noop, dropped: noop }, ready: () => null, dirty: noop, blocked: () => false,
    }, made);
    expect(meshes.map((m) => m.name)).toEqual(["arm", "watch_case", "watch_back", "watch_glass", "watch_screen", "strap"]);
    const axes = cameraAxes(0, 0, 0, restAxes());
    const frame = { dt: 1 / 60, eye: { x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, roll: 0 }, axes, ridePhase: 0, insidePhase: 0, roomUndrawn: false, speed: 0, sprinting: false, aspect: 1.6, litGain: 3 };
    for (let i = 0; i < 100; i++) part.frame(frame);
    expect(part.drawn()).toBe(0);
    expect(meshes.every((m) => !m.visible)).toBe(true);
    expect(WATCH_SEEN.shown).toBe(false);
    // On: it rises, draws, and the record says where the lit screen's square is.
    toggleWatch();
    for (let i = 0; i < 4; i++) part.frame(frame);
    expect(part.drawn()).toBe(6);
    expect(WATCH_SEEN.shown).toBe(true);
    // Made larger than life, by the arm's scale.
    for (const m of meshes) expect(m.scaling.x).toBeCloseTo(ARM_SCALE, 9);
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
    expect(part.drawn()).toBe(6);
    // Off: it drops, and when it is down nothing is drawn.
    toggleWatch();
    for (let i = 0; i < 40; i++) part.frame(frame);
    expect(part.drawn()).toBe(0);
    expect(meshes.every((m) => !m.visible)).toBe(true);
    expect(WATCH_SEEN.raised).toBe(0);
    resetWatch();
  });
});
