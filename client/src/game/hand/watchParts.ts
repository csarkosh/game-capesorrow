/**
 * The player's left arm with its watch, drawn (`watchPose.ts` says where it is; `watchGeometry.ts` is what it is made of). One mesh, made once (the first time the watch is
 * wanted), in the town's packed form, drawn with the same material as the right arm (the town's indoor material with a depth shift: see `townParts.ts`), placed each frame from
 * the camera's pose and the arm's, `ARM_SCALE` times life size. One draw while it is up; none at all while it is down.
 *
 * It writes `WATCH_SEEN` (`watchSeen.ts`) each frame: whether it is shown, how far up, and where the lit screen's bounding square is in the view, for the page to draw the map on.
 * The arm is on foot's alone: in a car (`ridePhase` not 0) it is not drawn, and a door's dark screen hides it, as it hides the right arm.
 */
import { disposeMeshGpu, removeFromScene, setMeshVisible, type Mesh } from "@babylonjs/lite";
import { MeshBuilder } from "../town/meshBuilder.js";
import { packedBytes } from "../town/vertexPack.js";
import { makeHandMesh, type HandFrame, type HandHost } from "./handParts.js";
import { basisQuaternion, clearAhead, handHidden, torchBasis, type HandPose } from "./handPose.js";
import { watchGeometry } from "./watchGeometry.js";
import { ARM_SCALE, newWatchPose, newWatchState, stepWatch, watchQuad } from "./watchPose.js";
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

/** The left arm and the watch as plain arrays: what `createWatchParts` lays on the GPU, for the tests and the count. */
export function watchArrays(seed = 1): ReturnType<MeshBuilder["take"]> {
  const b = new MeshBuilder();
  watchGeometry(b, seed);
  return b.take();
}

export function createWatchParts(host: HandHost): WatchParts {
  const arrays = watchArrays();
  const mesh = makeHandMesh(host, "watch_arm", arrays, ARM_SCALE);
  const state = newWatchState();
  const pose = newWatchPose();
  const basis = new Float64Array(9);
  const unit = new Float64Array(9);
  const quat = [0, 0, 0, 1];
  let shown = false;
  return {
    pose,
    cost: { vertices: arrays.positions.length / 3, bytes: packedBytes(arrays.positions.length / 3, arrays.indices.length, arrays.surface.byteLength) },
    drawn: () => (shown ? 1 : 0),
    frame(f) {
      const hidden = handHidden(f.ridePhase, f.insidePhase, f.roomUndrawn);
      const want = !hidden && WATCH_SEEN.on;
      stepWatch(state, { dt: f.dt, want, hidden, speed: f.speed, sprinting: f.sprinting, yaw: f.eye.yaw, pitch: f.eye.pitch, clear: pose.shown || want ? clearAhead(host.blocked, f.eye.x, f.eye.y, f.eye.z, f.axes, f.insidePhase) : 1, aspect: f.aspect }, pose);
      WATCH_SEEN.shown = pose.shown;
      WATCH_SEEN.raised = pose.raised;
      if (!pose.shown) {
        if (shown) setMeshVisible(mesh, false);
        shown = false;
        return;
      }
      torchBasis(f.axes, pose, unit);
      basisQuaternion(unit, quat);
      mesh.position.set(f.eye.x + f.axes.rx * pose.x + f.axes.ux * pose.y + f.axes.fx * pose.z, f.eye.y + f.axes.ry * pose.x + f.axes.uy * pose.y + f.axes.fy * pose.z, f.eye.z + f.axes.rz * pose.x + f.axes.uz * pose.y + f.axes.fz * pose.z);
      mesh.rotationQuaternion.x = quat[0] as number;
      mesh.rotationQuaternion.y = quat[1] as number;
      mesh.rotationQuaternion.z = quat[2] as number;
      mesh.rotationQuaternion.w = quat[3] as number;
      if (!shown) setMeshVisible(mesh, true);
      shown = true;
      // The lit screen's square in the view, from the camera-frame basis scaled as the mesh is.
      torchBasis(restFrame, pose, basis, ARM_SCALE);
      watchQuad(pose, basis, f.aspect, WATCH_SEEN.quad);
    },
    dispose() {
      removeFromScene(host.scene, mesh as Mesh);
      disposeMeshGpu(mesh as Mesh);
      host.uploads.dropped();
      WATCH_SEEN.shown = false;
      WATCH_SEEN.raised = 0;
    },
  };
}

/** The camera's own frame (the pose is in it), for the quad. */
const restFrame = { fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0 };
