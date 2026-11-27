/**
 * The soft dark on the ground under each person drawn (`peopleParts.ts`): from eye height a body's feet look a few centimetres off the pavement
 * though they are on it, and a small dark under them says they stand on it. The same dark the walls' feet and the parked vehicles have
 * (`footShade.ts`, `props/vehicleShade.ts`: one colour, covering most at the middle and nothing at the rim, blended over the ground a little ahead
 * of it in depth), but much lighter, since a person standing hides little of the sky.
 *
 * - **Not town geometry.** People are shown and hidden by the hour and by distance and will come to walk, so the dark is not laid with the
 *   town's cells: it is one quad's worth of thin instances, one draw for every person shown. A place is a list entry (`ShadePlace`: where, which way
 *   it faces, the two half sizes and a strength) that whoever draws a body writes when the set shown is written, and again each frame if the
 *   body moves (`write`, by a key of its own, so each model's bodies and a later walker's can write theirs apart; the draw is all the keys' places).
 * - **Drawn as the walls' feet are**: a blended mesh in the see-through draws before the lettering and the glass, never written to depth, drawn
 *   ahead of the ground in depth by the same steps (`SHADE_AHEAD_UNITS`), with the walls' dark colour. The falloff is worked out in the pixel from
 *   where it is on the quad, so a quad of four corners is all the mesh there is, and a strength (0 to 1, as the foot's depth is) rides with each
 *   instance in the plugin's own data.
 * - **A pure side.** `shadeFloats` turns a list of places into the instances' matrices and data, and `personShade` says what a person's place is
 *   (a sitter's is a little larger, under the feet and the seat, on the floor).
 */
import { addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, markThinInstancePluginData, removeFromScene, setMeshVisible, setThinInstanceCount, setThinInstances, type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext } from "@babylonjs/lite";
import { FOOT_COLOUR } from "./footShade.js";

/** A place to lay a person's dark: the ground under them (`y` is the ground's, not a seat's), the way they face (yaw 0 faces +z, growing toward +x), the half sizes across (the shoulders' way) and along (the way they face), metres, and how deep it is, 0 to 1. */
export type ShadePlace = { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly halfAcross: number; readonly halfAlong: number; readonly strength: number };

/** The most of a person's dark's depth (at its middle), and the half sizes of a person standing: the two feet and a little more. */
export const STAND_STRENGTH = 0.62;
export const STAND_HALF: readonly [number, number] = [0.46, 0.36];
/** The same for a sitter: under the feet and the seat. */
export const SIT_STRENGTH = 0.56;
export const SIT_HALF: readonly [number, number] = [0.56, 0.46];
/** The dark lies this much over the ground, metres, and is drawn ahead of it in depth besides. */
export const SHADE_RISE = 0.02;
/** Floats of a matrix and of an instance's own data. */
const MATRIX = 16;
const DATA = 4;
/** How far from the middle the dark is full (of the quad's half size), and how it eases to nothing at the rim. */
const FULL = 0.12;

/** Where a person's dark lies: under a standing body, or under a sitter's feet and seat, scaled by the body's own scale. */
export function personShade(p: { readonly at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }; readonly person: { readonly seat: unknown; readonly scale: number } }): ShadePlace {
  const sits = p.person.seat !== null;
  const half = sits ? SIT_HALF : STAND_HALF;
  return { x: p.at.x, y: p.at.y, z: p.at.z, yaw: p.at.yaw, halfAcross: half[0] * p.person.scale, halfAlong: half[1] * p.person.scale, strength: sits ? SIT_STRENGTH : STAND_STRENGTH };
}

/**
 * The instances for `places`, written into `matrices` (sixteen floats each, as a shader reads a matrix) and `data` (four floats each: the
 * strength, then three the plugin does not use). The quad is two metres across about its own middle on the ground, so a matrix scales it by the
 * half sizes and turns it by the yaw. Returns how many were written; as many as the arrays have room for.
 */
export function shadeFloats(places: readonly ShadePlace[], matrices: Float32Array, data: Float32Array): number {
  const n = Math.min(places.length, Math.floor(matrices.length / MATRIX), Math.floor(data.length / DATA));
  for (let i = 0; i < n; i++) {
    const p = places[i] as ShadePlace;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    const m = i * MATRIX;
    // Across is the body's right, (cos, -sin); along is the way it faces, (sin, cos).
    matrices.set([p.halfAcross * c, 0, -p.halfAcross * s, 0, 0, 1, 0, 0, p.halfAlong * s, 0, p.halfAlong * c, 0, p.x, p.y + SHADE_RISE, p.z, 1], m);
    data.set([p.strength, 0, 0, 0], i * DATA);
  }
  return n;
}

/** The plugin: the dark colour, and the alpha from how far the pixel is from the quad's middle. The quad's own coordinates ride to the fragment as a varying. */
export function peopleShadePlugin(): MaterialPlugin {
  const colour = FOOT_COLOUR.map((c) => c.toFixed(4)).join(",");
  return {
    name: "PeopleShade",
    priority: 200,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: `let psT=clamp((length(input.vPeopleShade.yz)-${FULL.toFixed(3)})/${(1 - FULL).toFixed(3)},0.0,1.0);alpha=input.vPeopleShade.x*(1.0-psT*psT*(3.0-2.0*psT));`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `color=vec3<f32>(${colour});`,
        }
        : { CUSTOM_VERTEX_MAIN_END: "out.vPeopleShade=vec4<f32>(peopleShadeA.x,position.x,position.z,0.0);" },
    getInstanceAttributes: () => [{ name: "peopleShadeA", type: "vec4<f32>", format: "float32x4" as const, stride: 16, offset: 0 }],
    getVaryings: () => [{ name: "vPeopleShade", type: "vec4<f32>" }],
  };
}

export type PeopleShadeHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly air: () => MaterialPlugin;
  /** The depth plugin that draws a mesh a little ahead of where it stands, and how far (as the walls' feet are: `townParts.ts`). */
  readonly ahead: (units: number, slope?: number) => MaterialPlugin;
  readonly aheadUnits: number;
  /** Where among the draws it stands. */
  readonly order: number;
};

export type PeopleShade = {
  /** The places of the bodies under `key` (a model's, a walker's), all of them at once: the key's earlier places are replaced. An empty list takes them away. */
  write(key: string, places: readonly ShadePlace[]): void;
  dispose(): void;
};

/** The one draw for every person's dark, with room for `capacity` places in all (more are not drawn). */
export function createPeopleShade(host: PeopleShadeHost, capacity: number): PeopleShade {
  const matrices = new Float32Array(Math.max(1, capacity) * MATRIX);
  const data = new Float32Array(Math.max(1, capacity) * DATA);
  const keyed = new Map<string, readonly ShadePlace[]>();
  let mesh: Mesh | null = null;
  // Made when the first place is written, so a part that never shows anyone makes no mesh.
  const made = (): Mesh => {
    if (mesh !== null) return mesh;
    // A unit quad on the ground, two metres across: the pixel's place on it is the falloff's.
    const m: Mesh = createMeshFromData(host.engine, "people_shade", new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 2, 1, 0, 3, 2]), new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]));
    const material: PbrMaterialProps = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, alphaBlend: true, doubleSided: true, usePhysicalLightFalloff: true });
    material.plugins = [peopleShadePlugin(), host.ahead(host.aheadUnits, 0), host.air()];
    m.material = material;
    m.renderOrder = host.order;
    setThinInstances(m, matrices, Math.max(1, capacity));
    if (m.thinInstances !== undefined && m.thinInstances !== null) m.thinInstances.pluginData = data;
    setThinInstanceCount(m, 0);
    setMeshVisible(m, false);
    addToScene(host.scene, m);
    mesh = m;
    return m;
  };
  let drawn = 0;
  let disposed = false;
  return {
    write(key, places) {
      if (disposed || (mesh === null && places.length === 0)) return;
      if (places.length === 0) keyed.delete(key);
      else keyed.set(key, places);
      let all: ShadePlace[] = [];
      for (const list of keyed.values()) all = all.concat(list);
      const n = shadeFloats(all, matrices, data);
      const m = made();
      markThinInstancePluginData(m, 0, Math.max(n, drawn) * DATA);
      setThinInstanceCount(m, n);
      if ((n > 0) !== (drawn > 0)) setMeshVisible(m, n > 0);
      drawn = n;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh === null) return;
      removeFromScene(host.scene, mesh);
      disposeMeshGpu(mesh);
    },
  };
}
