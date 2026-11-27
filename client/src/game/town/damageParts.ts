/**
 * The marks of damage a car leaves on what it strikes (`struck.ts`), drawn: one small see-through mesh, a dark bruise with pale cracks running out of
 * it, the pale scrape of the bumper across it and a scatter of pale chips, drawn as thin instances, one a mark, each placed flat on the face that was
 * struck by its own matrix (`markMatrices`). Dark and pale together, so it reads on a dark wall and on a pale one. It is drawn a few depth steps ahead
 * of the face, and stands 3 cm off it besides, so it lies over the wall's own paint.
 *
 * `markGeometry` is pure, so the shape is tested without a renderer.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, flushThinInstances, removeFromScene, setMeshVisible, setThinInstanceCount, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin } from "@csarkosh/engine/game/lite/forestPlugins";
import { MARKS_MOST } from "./struck.js";

/** How much of a mark shows at its fullest, and its two colours: the bruise's soot and shadow, a little warm, and what is laid bare under a face that is cracked, scraped or chipped. */
export const MARK_ALPHA = 0.9;
export const MARK_DARK: readonly [number, number, number] = [0.035, 0.03, 0.028];
export const MARK_PALE: readonly [number, number, number] = [0.78, 0.75, 0.68];
/** How far toward the eye a mark is drawn, depth steps. */
export const MARK_AHEAD_UNITS = 16;

/** A number from 0 to 1 for a count and a salt: the mark's shape is the same on every machine and every run. */
function roll(n: number, salt: number): number {
  const v = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The mark, one unit across, in its own frame: x to the right along the face, y up, flat at z = 0 and facing +z. A dark bruise (a ragged fan, full at
 * its middle and gone at its rim), seven pale cracks running out of it (each a sliver, full at its root and gone at its tip), three pale scrapes across
 * it (each a thin band, full in the middle and gone at its ends), and nine pale chips round it. The colour and the alpha ride in the vertices' colours;
 * the pale parts are laid after the bruise, so they are drawn over it.
 */
export function markGeometry(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array; colors: Float32Array } {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let tone: readonly [number, number, number] = MARK_DARK;
  const vertex = (x: number, y: number, alpha: number): number => {
    positions.push(x, y, 0);
    colors.push(tone[0], tone[1], tone[2], alpha);
    return positions.length / 3 - 1;
  };
  // The bruise.
  const RIM = 12;
  const mid = vertex(0, 0, 0.8);
  const rim: number[] = [];
  for (let k = 0; k < RIM; k++) {
    const a = (k / RIM) * Math.PI * 2;
    const r = 0.22 + 0.1 * roll(k, 1);
    rim.push(vertex(Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.75, 0));
  }
  for (let k = 0; k < RIM; k++) indices.push(mid, rim[k] as number, rim[(k + 1) % RIM] as number);
  // The cracks.
  tone = MARK_PALE;
  const CRACKS = 7;
  for (let k = 0; k < CRACKS; k++) {
    const a = ((k + roll(k, 2) * 0.7) / CRACKS) * Math.PI * 2;
    const far = 0.3 + 0.2 * roll(k, 3);
    const cx = Math.cos(a), cy = Math.sin(a);
    const root = 0.05;
    const half = 0.024;
    const p = vertex(cx * root - cy * half, cy * root + cx * half, 1);
    const q = vertex(cx * root + cy * half, cy * root - cx * half, 1);
    // A crack bends a little on its way out.
    const bend = (roll(k, 4) - 0.5) * 0.12;
    const tip = vertex(cx * far - cy * bend, cy * far + cx * bend, 0);
    indices.push(p, q, tip);
  }
  // The scrapes.
  const SCRAPES: readonly [number, number, number][] = [[-0.13, 0.5, 0.022], [0.03, 0.42, 0.03], [0.16, 0.34, 0.018]];
  for (const [y, half, thick] of SCRAPES) {
    const l0 = vertex(-half, y - thick, 0), l1 = vertex(-half, y + thick, 0);
    const m0 = vertex(0, y - thick, 0.8), m1 = vertex(0, y + thick, 0.8);
    const r0 = vertex(half, y - thick, 0), r1 = vertex(half, y + thick, 0);
    indices.push(l0, m0, m1, l0, m1, l1, m0, r0, r1, m0, r1, m1);
  }
  // The chips: small three-cornered flecks, scattered round the bruise.
  const CHIPS = 9;
  for (let k = 0; k < CHIPS; k++) {
    const a = ((k + roll(k, 5)) / CHIPS) * Math.PI * 2;
    const far = 0.12 + 0.2 * roll(k, 6);
    const cx = Math.cos(a) * far * 1.2, cy = Math.sin(a) * far * 0.8;
    const size = 0.02 + 0.02 * roll(k, 7);
    const turn = roll(k, 8) * Math.PI * 2;
    const corner = (j: number): number => vertex(cx + Math.cos(turn + j * 2.1) * size, cy + Math.sin(turn + j * 2.1) * size, 0.95);
    indices.push(corner(0), corner(1), corner(2));
  }
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) normals[v * 3 + 2] = 1;
  return { positions: new Float32Array(positions), normals, indices: Uint32Array.from(indices), colors: new Float32Array(colors) };
}

export type DamageParts = {
  /** The marks this frame draws: `count` matrices, sixteen floats each, in `matrices` (`markMatrices`). */
  frame(matrices: Float32Array, count: number): void;
  dispose(): void;
};

/** What the marks are made with: the renderer's own. */
export type DamagePartsHost = {
  readonly engine: EngineContext;
  readonly scene: SceneContext;
  readonly air: () => MaterialPlugin;
  readonly ahead: (units: number, slope?: number) => MaterialPlugin;
};

export function createDamageParts(host: DamagePartsHost): DamageParts {
  // The mesh is made when the first mark is left, not before: a town nobody has driven into costs nothing here.
  let mesh: Mesh | null = null;
  const own = new Float32Array(MARKS_MOST * 16);
  let shown = 0;
  let disposed = false;
  const make = (): Mesh => {
    const g = markGeometry();
    const made = createMeshFromData(host.engine, "town.damage", g.positions, g.normals, g.indices, undefined, undefined, undefined, g.colors);
    // The colours are the vertices' own: the material's is white, and only its alpha is the mark's.
    const material = createPbrMaterial({ baseColorFactor: [1, 1, 1, MARK_ALPHA], metallicFactor: 0, roughnessFactor: 1, alphaBlend: true, doubleSided: true, usePhysicalLightFalloff: true });
    material.plugins = [baseColourPlugin(), host.ahead(MARK_AHEAD_UNITS, 0), host.air()];
    made.material = material;
    made.renderOrder = SEE_THROUGH_ORDER.carShadow;
    setThinInstances(made, own, MARKS_MOST);
    setThinInstanceCount(made, 0);
    setMeshVisible(made, false);
    addToScene(host.scene, made);
    return made;
  };
  return {
    frame(matrices, count) {
      if (disposed) return;
      const n = Math.min(count, MARKS_MOST);
      if (n === 0 && shown === 0) return;
      if (mesh === null) mesh = make();
      own.set(matrices.subarray(0, n * 16));
      if (n !== shown) {
        setThinInstanceCount(mesh, n);
        setMeshVisible(mesh, n > 0);
      }
      if (n > 0) flushThinInstances(mesh, 0, n);
      shown = n;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh === null) return;
      removeFromScene(host.scene, mesh);
      disposeMeshGpu(mesh);
      mesh = null;
    },
  };
}
