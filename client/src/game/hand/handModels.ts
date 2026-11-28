/**
 * The two arms as real models: `client/assets/models/hand.right.glb` (the right forearm and hand gripping the torch, the torch in the grip) and `hand.left.glb` (the left
 * forearm and hand with the watch on its wrist), which `tools/models/buildHands.py` writes, and `hands.json`, its manifest, which this reads for the numbers the game places
 * them by. Each is a static mesh (the skin is baked into the file) of a few parts, a part a material, told apart by the material's name.
 *
 * - **Loaded the first time the arm is wanted** (the torch's on the first F, the watch's on the first G): `loadModel`, the engine's loader, as it loads the vehicles and the
 *   people, with `modelTextureOptions` (the maps are KTX2, capped for the tier, and the arms' own three maps, the same bytes in both files, are one GPU texture between them).
 *   Nothing is fetched or held before that.
 * - **Drawn as the people are**: the loader's own PBR material of each part, the engine's own lighting (the day, dark at night), the town's air, and the street lamps near the
 *   player (`peopleLampPlugin`, written by `townParts.ts` with the lamps the town's surfaces take); and a depth shift toward the eye (`ahead`, `HAND_AHEAD_UNITS`), so
 *   that no arm is sunk into a wall the player stands against. The torch's lamp is behind the lens's plane for the hand that holds it (outside the cone), so it does not
 *   light its holder.
 * - **The frames.** The files are right handed and the loader mirrors x on a model's root, so a part's positions here are the file's with x negated. The right file is then
 *   in the torch's own frame (+x right, +y up, +z the way it points, the origin at the lens), which `torchBasis` stands. The left file's frame (origin at the screen's middle,
 *   +z out of the screen, +y toward twelve, the fingers toward the file's +x, so toward -x here) is stood by `watchMeshBasis` (`watchPose.ts`).
 */
import {
  addToScene, createMeshFromData, disposeMeshGpu, removeFromScene, setMeshVisible, type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { modelUrl } from "@csarkosh/engine/game/assetUrls";
import { DRAW_ORDER, SEE_THROUGH_ORDER, createDrawOrders } from "@csarkosh/engine/game/lite/drawOrder";
import { loadModel } from "@csarkosh/engine/game/lite/forestModels";
import { modelTextureOptions } from "@csarkosh/engine/game/lite/modelLoadOptions";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import handsJson from "../../../assets/models/hands.json" with { type: "json" };
import { peopleLampPlugin, type PeopleLamps } from "../town/peopleLight.js";

/** What `tools/models/buildHands.py` says of each file (the part of `hands.json` the game reads). */
export type HandFileFacts = {
  readonly file?: string;
  readonly bytes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly gpu_bytes_with_mips: number;
  readonly parts: Readonly<Record<string, { triangles: number; vertices: number }>>;
  readonly lens?: readonly number[];
  readonly axis?: readonly number[];
  readonly torch_length?: number;
  readonly torch_radius?: number;
  readonly watch?: { readonly screen_diameter: number; readonly screen_plate_diameter: number; readonly screen_corners: readonly (readonly number[])[]; readonly case_diameter: number; readonly watch_big: number };
  readonly forearm_cut: { readonly centre: readonly number[]; readonly direction: readonly number[]; readonly runs_on: number };
};
export type HandsManifest = { readonly total_bytes: number; readonly total_gpu_bytes_shared: number; readonly files: Readonly<Record<string, HandFileFacts>> };

export const HANDS = handsJson as unknown as HandsManifest;

export const RIGHT_FILE = "hand.right";
export const LEFT_FILE = "hand.left";
export const RIGHT = HANDS.files["hand.right.glb"] as HandFileFacts;
export const LEFT = HANDS.files["hand.left.glb"] as HandFileFacts;

/**
 * How far toward the eye, in steps of the 24-bit depth buffer (the engine's `ahead`: depth runs from 1 at the near plane to 0 far away, so a shift of `n / 2^24` is `n` steps up),
 * both arms are drawn: 0.4 of the buffer's range. A first person arm held out 0.3 to 0.5 m is a depth of 0.1 to 0.2 (the near plane's 0.05 over its distance); shifted by 0.4 it
 * is 0.5 to 0.6, which no wall seen from a body's length off reaches (a wall at 0.1 m is 0.5), so the arms are never sunk into a wall that the player stands against. Their own
 * order is kept (the shift is the same for every point). Set it to 0 to take it off.
 */
export const HAND_AHEAD_UNITS = Math.round(0.4 * 2 ** 24);

export type ArmHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly tier: QualityTier;
  readonly air: () => MaterialPlugin;
  readonly ahead: (units: number, slope: number) => MaterialPlugin;
  /** The lamps' uniforms the arms' materials read (`townParts.ts` writes them each frame the lamps change). */
  readonly lamps: PeopleLamps;
  readonly uploads: { count(kind: string, bytes: number, ...rest: number[]): void; made(): void; dropped(): void };
  /** Called with each material made, so that a change of the lamps can mark it dirty. */
  readonly dressed?: (material: PbrMaterialProps) => void;
};

/** One part of an arm's file as a mesh: hidden until a frame shows it. */
export type ArmPart = { readonly name: string; readonly mesh: Mesh; readonly triangles: number; readonly vertices: number; readonly bytes: number };

/** The lit lens: a warm white added to the glass's colour, and the glass made opaque, while it is drawn (it is drawn only while the lamp is on). */
function lensGlowPlugin(): MaterialPlugin {
  return {
    name: "LensGlow",
    priority: 200,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: "color+=vec3<f32>(3.0,2.7,2.0);alpha=1.0;" } : null),
  };
}

/**
 * Loads an arm's file and makes a mesh of each of its parts, hidden, in the scene. `root` is the file's root node ("hand.right" or "hand.left"). Rejects where the file cannot be
 * fetched or read (or `signal` aborts); the caller says so once and draws no arm.
 */
export async function loadArm(host: ArmHost, root: string, signal: AbortSignal): Promise<ArmPart[]> {
  const model = await loadModel(host.engine, modelUrl(`models/${root}.glb`), [root], signal, modelTextureOptions(host.tier));
  const parts = model.get(root) ?? [];
  if (parts.length === 0) throw new Error(`the file ${root}.glb has no parts under ${root}`);
  const orders = createDrawOrders(DRAW_ORDER.bodies);
  const made: ArmPart[] = [];
  for (const part of parts) {
    const role = part.facts.material ?? "arm";
    const glass = role.endsWith("glass");
    const mapped = part.colour !== undefined || part.normal !== undefined || part.material.ormTexture !== undefined;
    const mesh = createMeshFromData(
      host.engine, `${root}.${role}`, part.positions.slice(), part.normals.slice(), part.indices.slice(),
      mapped ? part.uvs.slice() : undefined, undefined, mapped && part.tangents !== null ? part.tangents.slice() : undefined,
    );
    const material = part.material;
    material.usePhysicalLightFalloff = true;
    material.doubleSided = true;
    material.plugins = [host.ahead(HAND_AHEAD_UNITS, 0), host.air(), peopleLampPlugin(host.lamps), ...(role === "torch_glass" ? [lensGlowPlugin()] : [])];
    host.dressed?.(material);
    mesh.material = material;
    if (!glass) orders.take(material);
    mesh.renderOrder = glass ? SEE_THROUGH_ORDER.glass + 1 : (orders.of(material) ?? DRAW_ORDER.bodies);
    addToScene(host.scene, mesh);
    setMeshVisible(mesh, false);
    const bytes = part.positions.byteLength + part.normals.byteLength + part.uvs.byteLength + part.indices.byteLength + (part.tangents?.byteLength ?? 0);
    host.uploads.count("geometry", bytes, 4);
    host.uploads.made();
    made.push({ name: role, mesh, triangles: part.indices.length / 3, vertices: part.positions.length / 3, bytes });
  }
  return made;
}

/** Takes an arm's meshes out of the scene and frees them. */
export function disposeArm(host: ArmHost, parts: readonly ArmPart[]): void {
  for (const { mesh } of parts) {
    removeFromScene(host.scene, mesh);
    disposeMeshGpu(mesh);
    host.uploads.dropped();
  }
}
