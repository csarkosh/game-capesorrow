/**
 * The player's left arm with its watch, drawn (`watchPose.ts` says where it is; `hand.left.glb` is what it is: the forearm and hand relaxed, the watch on the wrist with its brown leather
 * strap, and the face a plain black screen). Loaded the first time the watch is wanted (`loadWatchParts`, on the first G), its parts made into meshes (the arm, the watch's case, back,
 * glass and screen, and the strap), drawn as the right arm is (`handModels.ts`), placed each frame from the camera's pose and the arm's, `ARM_SCALE` times life size, up to the
 * watch's own `WATCH_BIG` (baked into the file). A few draws while it is up; none at all while it is down.
 *
 * It writes `WATCH_SEEN` (`watchSeen.ts`) each frame: whether it is shown, how far up, and where the lit screen's bounding square is in the view, for the page to draw the map on.
 * The arm is on foot's alone: in a car (`ridePhase` not 0) it is not drawn, and a door's dark screen hides it, as it hides the right arm.
 */
import { setMeshVisible, type Mesh } from "@babylonjs/lite";
import type { HandFrame, HandHost } from "./handParts.js";
import { LEFT_FILE, disposeArm, loadArm, type ArmPart } from "./handModels.js";
import { basisQuaternion, clearAhead, handHidden, torchBasis, type HandPose } from "./handPose.js";
import { ARM_SCALE, newWatchPose, newWatchState, stepWatch, watchMeshBasis, watchQuad } from "./watchPose.js";
import { WATCH_SEEN } from "./watchSeen.js";

export type WatchParts = {
  /** Steps and places the arm and writes `WATCH_SEEN`. Call once a frame, after the camera is placed. */
  frame(f: HandFrame): void;
  readonly pose: HandPose;
  /** How many draws the arm makes now: 0 while it is down, 1 while it is up. */
  drawn(): number;
  /** The vertices and bytes it holds. */
  readonly cost: { vertices: number; bytes: number };
  dispose(): void;
};

/** Loads the left arm's file and makes its parts. Rejects where the file does not load. */
export async function loadWatchParts(host: HandHost): Promise<WatchParts> {
  return createWatchParts(host, await loadArm(host, LEFT_FILE, host.signal));
}

/** The left arm's parts made (`loadArm`), as the arm that is stepped, placed and shown each frame. */
export function createWatchParts(host: HandHost, made: readonly ArmPart[]): WatchParts {
  const meshes: Mesh[] = made.map((p) => p.mesh);
  const cost = { vertices: made.reduce((n, p) => n + p.vertices, 0), bytes: made.reduce((n, p) => n + p.bytes, 0) };
  const state = newWatchState();
  const pose = newWatchPose();
  const basis = new Float64Array(9);
  const unit = new Float64Array(9);
  const mesh9 = new Float64Array(9);
  const quat = [0, 0, 0, 1];
  let shown = false;
  return {
    pose,
    cost,
    drawn: () => (shown ? meshes.length : 0),
    frame(f) {
      const hidden = handHidden(f.ridePhase, f.insidePhase, f.roomUndrawn);
      const want = !hidden && WATCH_SEEN.on;
      stepWatch(state, { dt: f.dt, want, hidden, speed: f.speed, sprinting: f.sprinting, yaw: f.eye.yaw, pitch: f.eye.pitch, clear: pose.shown || want ? clearAhead(host.blocked, f.eye.x, f.eye.y, f.eye.z, f.axes, f.insidePhase) : 1, aspect: f.aspect }, pose);
      WATCH_SEEN.shown = pose.shown;
      WATCH_SEEN.raised = pose.raised;
      if (!pose.shown) {
        if (shown) for (const m of meshes) setMeshVisible(m, false);
        shown = false;
        return;
      }
      torchBasis(f.axes, pose, unit);
      watchMeshBasis(unit, mesh9);
      basisQuaternion(mesh9, quat);
      for (const mesh of meshes) {
        if (mesh.scaling.x !== ARM_SCALE) mesh.scaling.set(ARM_SCALE, ARM_SCALE, ARM_SCALE);
        mesh.position.set(f.eye.x + f.axes.rx * pose.x + f.axes.ux * pose.y + f.axes.fx * pose.z, f.eye.y + f.axes.ry * pose.x + f.axes.uy * pose.y + f.axes.fy * pose.z, f.eye.z + f.axes.rz * pose.x + f.axes.uz * pose.y + f.axes.fz * pose.z);
        mesh.rotationQuaternion.x = quat[0] as number;
        mesh.rotationQuaternion.y = quat[1] as number;
        mesh.rotationQuaternion.z = quat[2] as number;
        mesh.rotationQuaternion.w = quat[3] as number;
      }
      if (!shown) for (const m of meshes) setMeshVisible(m, true);
      shown = true;
      // The lit screen's square in the view, from the camera-frame basis scaled as the mesh is.
      torchBasis(restFrame, pose, basis, ARM_SCALE);
      watchMeshBasis(basis, mesh9);
      watchQuad(pose, mesh9, f.aspect, WATCH_SEEN.quad);
    },
    dispose() {
      disposeArm(host, made);
      WATCH_SEEN.shown = false;
      WATCH_SEEN.raised = 0;
    },
  };
}

/** The camera's own frame (the pose is in it), for the quad. */
const restFrame = { fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0 };
