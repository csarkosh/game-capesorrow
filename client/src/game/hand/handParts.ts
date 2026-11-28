/**
 * The player's hand and torch, drawn and lit (`handPose.ts` says where they are; `handModels.ts` loads what they are made of: `hand.right.glb`, the real forearm and hand with the
 * torch in its grip).
 *
 * - **Loaded when first wanted** (`loadHandParts`, on the first F): the file is fetched and its parts made into meshes (the arm, the torch, and the torch's glass, which is drawn
 *   only while the lamp is on and glows with it). The arm is raised when the parts are ready; until then nothing is drawn.
 * - **Placed each frame** from the camera's pose and the pose of the hand: the meshes' position and rotation are set (plain meshes, moved by their own matrix, as the
 *   renderer moves any), `handScaleFor` times life size about the lens, which is the file's origin. They are drawn among the scene's other opaque draws, with the depth buffer
 *   and a depth shift toward the eye (`HAND_AHEAD_UNITS`); `clear` (a probe ahead of the eye, `blocked`) pulls the torch in before it comes to a wall.
 * - **The light.** The engine has one lamp. While the player is on foot with the torch on, it is moved to the lens, along the torch's axis, as `headlights.ts`
 *   moves it to the car's nose; its cone is tighter than the car's and its light a warm white. The beam is still the engine's one lamp, so it costs what the
 *   walker's lamp always cost: nothing more. What the lamp cannot light (the rooms' own-lit surfaces) takes the beam from `FLASH_CODE`, from the uniforms this writes.
 * - Never hidden by the interface: the interface is the page's, above the canvas.
 */
import { setMeshVisible, type Mesh } from "@babylonjs/lite";
import type { RenderLamp } from "@csarkosh/engine/game/lite/renderGame";
import type { CameraAxes } from "@csarkosh/engine/game/lite/cameraPose";
import type { TownReady } from "../town/townMaterial.js";
import { TORCH_COLOUR } from "./handLight.js";
import { lightTorch, newTorchState } from "./handLight.js";
import { RIGHT_FILE, disposeArm, loadArm, type ArmHost, type ArmPart } from "./handModels.js";
import { handScaleFor, basisQuaternion, clearAhead, handHidden, lensWorld, newHandPose, newHandState, originWorld, stepHand, torchBasis, type HandPose } from "./handPose.js";
import { HAND_SWITCH, handWanted, torchLit } from "./handSwitch.js";

export { TORCH_ANGLE, TORCH_COLOUR, TORCH_GAIN, TORCH_RANGE } from "./handLight.js";
export { HAND_AHEAD_UNITS } from "./handModels.js";

/** The beam as the rooms' own-lit surfaces take it (`FLASH_CODE`): the cone's half angle (radians) and its range (metres), and the strength it is added with. */
export const FLASH_HALF_ANGLE = 0.45;
export const FLASH_RANGE = 14;
export const FLASH_STRENGTH = 1;

export type HandHost = ArmHost & {
  /** The town's uniforms: the hand writes the flashlight's into them, and `dirty` tells every material that reads them. */
  readonly ready: () => TownReady | null;
  readonly dirty: () => void;
  /** Whether a point of the world is inside a wall or a thing that stands. */
  readonly blocked: (x: number, y: number, z: number) => boolean;
  /** Aborts the loads of the arms' files (the renderer's disposal). */
  readonly signal: AbortSignal;
};

/** What a frame says of the player. */
export type HandFrame = {
  readonly dt: number;
  /** The camera's place and turns, as `pose` is. */
  readonly eye: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };
  readonly axes: CameraAxes;
  readonly ridePhase: number;
  readonly insidePhase: number;
  readonly roomUndrawn: boolean;
  readonly speed: number;
  readonly sprinting: boolean;
  /** The view's width over its height. */
  readonly aspect: number;
  /** The hour's lit gain (`look.ts`, `litGainAt`): the torch's brightness follows it. */
  readonly litGain: number;
};

/** Where the torch is this frame, for whoever looks at it (`peopleDazzle.ts`, the console): its lens, its axis, and whether it is lit and up. */
export type TorchSeen = { lit: boolean; x: number; y: number; z: number; dx: number; dy: number; dz: number };

export type HandParts = {
  /** Steps and places the hand, moves the lamp to the lens and writes the flashlight's uniforms. Call once a frame, after the camera is placed and the engine has put the lamp at the eye. */
  frame(f: HandFrame, lamp: RenderLamp): void;
  /** The torch as the last frame left it. */
  readonly torch: TorchSeen;
  /** The pose as the last frame left it. */
  readonly pose: HandPose;
  /** How many draws the hand makes now: 0 while it is down and the torch off, 1 with it up, 2 with the lens lit. */
  drawn(): number;
  /** The vertices and bytes the hand holds, and the draws it makes at most. */
  readonly cost: { vertices: number; bytes: number; draws: number };
  dispose(): void;
};

/** Loads the right arm's file and makes the hand's parts. Rejects where the file does not load. */
export async function loadHandParts(host: HandHost): Promise<HandParts> {
  return createHandParts(host, await loadArm(host, RIGHT_FILE, host.signal));
}

/** The hand's parts made (`loadArm`), as the hand that is stepped, placed and lit each frame. */
export function createHandParts(host: HandHost, made: readonly ArmPart[]): HandParts {
  const body: Mesh[] = made.filter((p) => p.name !== "torch_glass").map((p) => p.mesh);
  const lens: Mesh[] = made.filter((p) => p.name === "torch_glass").map((p) => p.mesh);
  const cost = {
    vertices: made.reduce((n, p) => n + p.vertices, 0),
    bytes: made.reduce((n, p) => n + p.bytes, 0),
    draws: made.length,
  };
  const state = newHandState();
  const pose = newHandPose();
  const torch: TorchSeen = { lit: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
  const place = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
  const origin = { x: 0, y: 0, z: 0 };
  const basis = new Float64Array(9);
  const quat = [0, 0, 0, 1];
  const torchState = newTorchState();
  let bodyShown = false;
  let lensShown = false;
  let flashOn = false;
  const cosHalf = Math.cos(FLASH_HALF_ANGLE);

  const show = (meshes: readonly Mesh[], want: boolean, was: boolean): boolean => {
    if (want !== was) for (const mesh of meshes) setMeshVisible(mesh, want);
    return want;
  };

  const writeFlash = (on: boolean, strength: number): void => {
    const ready = host.ready();
    if (ready === null) return;
    if (!on && !flashOn) return;
    const p = ready.flashP as number[];
    const d = ready.flashD as number[];
    const c = ready.flashC as number[];
    p[0] = torch.x;
    p[1] = torch.y;
    p[2] = torch.z;
    p[3] = FLASH_RANGE;
    d[0] = torch.dx;
    d[1] = torch.dy;
    d[2] = torch.dz;
    d[3] = cosHalf;
    c[0] = TORCH_COLOUR[0];
    c[1] = TORCH_COLOUR[1];
    c[2] = TORCH_COLOUR[2];
    c[3] = on ? strength : 0;
    flashOn = on;
    host.dirty();
  };

  return {
    torch,
    pose,
    cost,
    drawn: () => (bodyShown ? body.length : 0) + (lensShown ? lens.length : 0),
    frame(f, lamp) {
      const lit = torchLit(f.ridePhase === 0) && lamp.lit.on;
      const hidden = handHidden(f.ridePhase, f.insidePhase, f.roomUndrawn);
      const want = !hidden && handWanted(lit);
      stepHand(state, { dt: f.dt, want, hidden, speed: f.speed, sprinting: f.sprinting, yaw: f.eye.yaw, pitch: f.eye.pitch, clear: pose.shown || want ? clearAhead(host.blocked, f.eye.x, f.eye.y, f.eye.z, f.axes, f.insidePhase) : 1, aspect: f.aspect }, pose);
      if (!pose.shown) {
        bodyShown = show(body, false, bodyShown);
        lensShown = show(lens, false, lensShown);
        torch.lit = false;
        writeFlash(false, 0);
        return;
      }
      lensWorld(f.eye.x, f.eye.y, f.eye.z, f.axes, pose, place);
      originWorld(f.eye.x, f.eye.y, f.eye.z, f.axes, pose, origin);
      torchBasis(f.axes, pose, basis);
      basisQuaternion(basis, quat);
      const size = handScaleFor();
      for (const mesh of [...body, ...lens]) {
        mesh.position.set(origin.x, origin.y, origin.z);
        if (mesh.scaling.x !== size) mesh.scaling.set(size, size, size);
        mesh.rotationQuaternion.x = quat[0] as number;
        mesh.rotationQuaternion.y = quat[1] as number;
        mesh.rotationQuaternion.z = quat[2] as number;
        mesh.rotationQuaternion.w = quat[3] as number;
      }
      bodyShown = show(body, true, bodyShown);
      torch.x = place.x;
      torch.y = place.y;
      torch.z = place.z;
      torch.dx = place.dx;
      torch.dy = place.dy;
      torch.dz = place.dz;
      // The torch's light comes on as the hand arrives, and goes at once with the switch.
      const arrive = lit ? Math.min(1, Math.max(0, (pose.raised - 0.35) / 0.55)) : 0;
      torch.lit = lit && arrive > 0;
      lensShown = show(lens, torch.lit, lensShown);
      if (lit) lightTorch(lamp, place, arrive, torchState, f.litGain);
      writeFlash(torch.lit, FLASH_STRENGTH * arrive);
    },
    dispose() {
      disposeArm(host, made);
    },
  };
}

/** Whether the console has the hand forced up (for the tests and the status line). */
export const handForced = (): boolean => HAND_SWITCH.forced;
