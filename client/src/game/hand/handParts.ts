/**
 * The player's hand and torch, drawn and lit (`handPose.ts` says where they are; `handGeometry.ts` and `flashlightGeometry.ts` are what they are made of).
 *
 * - **Two meshes, made once**, in the town's own packed form (`createPackedMesh`): the hand with the torch (one draw), and the torch's lit lens (a disc, drawn
 *   only while the lamp is on). Both are placed alike. Both are drawn with the town's indoor material (the one the walk-in
 *   rooms use: the town's layers, the air and the night's own lamps), so that the hand is lit by the day outside and is dark at night but for its own lamp's spill,
 *   and takes the torch's spill (`FLASH_CODE`) and the street lamps near it.
 * - **Placed each frame** from the camera's pose and the pose of the hand: the mesh's position and rotation are set (a plain mesh, moved by its own matrix, as the
 *   renderer moves any). The meshes are drawn where the scene's other opaque draws are, with the depth buffer: a wall that is closer than the hand hides it, and
 *   `clear` (a probe ahead of the eye, `blocked`) pulls the torch in before it comes to a wall.
 * - **The light.** The engine has one lamp. While the player is on foot with the torch on, it is moved to the lens, along the torch's axis, as `headlights.ts`
 *   moves it to the car's nose; its cone is tighter than the car's and its light a warm white. The beam is still the engine's one lamp, so it costs what the
 *   walker's lamp always cost: nothing more. What the lamp cannot light (the rooms' own-lit surfaces) takes the beam from `FLASH_CODE`, from the uniforms this writes.
 * - Never hidden by the interface: the interface is the page's, above the canvas. Not in the ink line's mask and not in the rain's cover: it is made after them.
 */
import { addToScene, disposeMeshGpu, removeFromScene, setMeshVisible, type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext } from "@babylonjs/lite";
import type { RenderLamp } from "@csarkosh/engine/game/lite/renderGame";
import type { CameraAxes } from "@csarkosh/engine/game/lite/cameraPose";
import { MeshBuilder, type MeshArrays } from "../town/meshBuilder.js";
import { packSurface } from "../town/surfacePack.js";
import { createPackedMesh, packedBytes } from "../town/vertexPack.js";
import type { TownReady } from "../town/townMaterial.js";
import { TORCH_COLOUR } from "./handLight.js";
import { lightTorch, newTorchState } from "./handLight.js";
import { flashlightGeometry, lensGlowGeometry } from "./flashlightGeometry.js";
import { handGeometry } from "./handGeometry.js";
import { basisQuaternion, clearAhead, handHidden, lensWorld, newHandPose, newHandState, stepHand, torchBasis, type HandPose } from "./handPose.js";
import { HAND_SWITCH, handWanted, torchLit } from "./handSwitch.js";

export { TORCH_ANGLE, TORCH_COLOUR, TORCH_GAIN, TORCH_RANGE } from "./handLight.js";
/** The beam as the rooms' own-lit surfaces take it (`FLASH_CODE`): the cone's half angle (radians) and its range (metres), and the strength it is added with. */
export const FLASH_HALF_ANGLE = 0.45;
export const FLASH_RANGE = 14;
export const FLASH_STRENGTH = 1;

export type HandHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  /** The town's indoor material (`townParts.ts`): the layers, the air and the night's lamps. */
  readonly material: PbrMaterialProps;
  /** Where the material stands among the opaque draws. */
  readonly order: number;
  /** Whether the town's textures are in use (a mesh then carries the surface records). */
  readonly textured: boolean;
  readonly uploads: { count(kind: string, bytes: number, ...rest: number[]): void; made(): void; dropped(): void };
  /** The town's uniforms: the hand writes the flashlight's into them, and `dirty` tells every material that reads them. */
  readonly ready: () => TownReady | null;
  readonly dirty: () => void;
  /** Whether a point of the world is inside a wall or a thing that stands. */
  readonly blocked: (x: number, y: number, z: number) => boolean;
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

/** The hand with the torch, and the torch's lit lens, as plain arrays: what `createHandParts` lays on the GPU, for the tests and the count. */
export function handArrays(seed = 1): { body: MeshArrays; lens: MeshArrays } {
  const body = new MeshBuilder();
  flashlightGeometry(body, seed);
  handGeometry(body, seed);
  const lens = new MeshBuilder();
  lensGlowGeometry(lens);
  return { body: body.take(), lens: lens.take() };
}

export function createHandParts(host: HandHost): HandParts {
  const arrays = handArrays();
  const make = (name: string, a: MeshArrays): Mesh => {
    const mesh = createPackedMesh(host.engine, name, a);
    if (host.textured) mesh.pluginVertexData = packSurface(a.surface);
    mesh.material = host.material;
    mesh.renderOrder = host.order;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k] as number, a.positions[i + k] as number);
        hi[k] = Math.max(hi[k] as number, a.positions[i + k] as number);
      }
    }
    mesh.boundMin = lo as [number, number, number];
    mesh.boundMax = hi as [number, number, number];
    addToScene(host.scene, mesh);
    setMeshVisible(mesh, false);
    host.uploads.count("geometry", packedBytes(a.positions.length / 3, a.indices.length, a.surface.byteLength), 4);
    host.uploads.made();
    return mesh;
  };
  const body = make("hand_torch", arrays.body);
  const lens = make("hand_lens", arrays.lens);
  const cost = {
    vertices: arrays.body.positions.length / 3 + arrays.lens.positions.length / 3,
    bytes: packedBytes(arrays.body.positions.length / 3, arrays.body.indices.length, arrays.body.surface.byteLength) + packedBytes(arrays.lens.positions.length / 3, arrays.lens.indices.length, arrays.lens.surface.byteLength),
    draws: 2,
  };
  const state = newHandState();
  const pose = newHandPose();
  const torch: TorchSeen = { lit: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
  const place = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
  const basis = new Float64Array(9);
  const quat = [0, 0, 0, 1];
  const torchState = newTorchState();
  let bodyShown = false;
  let lensShown = false;
  let flashOn = false;
  const cosHalf = Math.cos(FLASH_HALF_ANGLE);

  const show = (mesh: Mesh, want: boolean, was: boolean): boolean => {
    if (want !== was) setMeshVisible(mesh, want);
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
    drawn: () => (bodyShown ? 1 : 0) + (lensShown ? 1 : 0),
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
      torchBasis(f.axes, pose, basis);
      basisQuaternion(basis, quat);
      for (const mesh of [body, lens]) {
        mesh.position.set(place.x, place.y, place.z);
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
      for (const mesh of [lens, body]) {
        removeFromScene(host.scene, mesh);
        disposeMeshGpu(mesh);
        host.uploads.dropped();
      }
    },
  };
}

/** Whether the console has the hand forced up (for the tests and the status line). */
export const handForced = (): boolean => HAND_SWITCH.forced;
