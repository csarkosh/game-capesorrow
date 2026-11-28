/**
 * The player's hand torch, built in code as everything in the town is: a chunky machined-steel tactical torch about 21 cm long, a wide head with a knurled bezel ring and a
 * stepped shoulder, a grip of two knurled bands with a raised anti-roll ring (flats on it) between them, and a wide tail with a notched guard round a recessed button.
 * It is laid in the torch's own frame: +z is the way it points, +x is to the right of it and +y is up, with the origin at the middle of the lens. `handGeometry.ts` lays the
 * hand that holds it in the same frame.
 *
 * The lens is two things. The glass is part of the torch's mesh and is dark. The lit face (`lensGlowGeometry`) is a disc laid a hair in front of it as a mesh
 * of its own, which is drawn only while the lamp is on, and lights itself (a glow, kept on at any hour: `ALWAYS_CODE`). Its colour is the lamp's.
 *
 * The knurling is shallow ridges (`knurl`: a ring that alternates between two radii) with the town's `sheet` layer (the aged corrugated metal) laid fine on the whole of
 * the steel, so that its ribs and grime read as the machining and the wear; no part of it is thousands of bumps. Wear: a hash of the seed varies each part's albedo by a few
 * per cent and lays each a little grime of its own, so the head, the bands and the tail are different ages of one tool.
 *
 * Materials, all the town's own layers (`materials.ts`): the steel is `sheet`, the guard's posts and the anti-roll ring `steel`, the button `rubber`, the glass `painted`.
 */
import { ALWAYS_CODE } from "../town/hours.js";
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "../town/meshBuilder.js";
import type { MatSpec } from "../town/materials.js";
import { frustum, knurl, loft } from "./handShapes.js";

/** The torch's sizes, metres, along the axis behind the lens. */
export const TORCH = {
  /** From the lens to the end of the tail's guard. */
  length: 0.2135,
  /** The radii of the bezel's ring, the head, the grip's bands, the anti-roll ring and the tail. */
  bezelRadius: 0.0305,
  headRadius: 0.0275,
  gripRadius: 0.0198,
  ringRadius: 0.0262,
  tailRadius: 0.0238,
  lensRadius: 0.0235,
  /** Where each part ends, behind the lens (the next begins there). */
  bezelEnd: 0.016,
  headEnd: 0.052,
  shoulderEnd: 0.062,
  bandOneEnd: 0.118,
  ringEnd: 0.132,
  bandTwoEnd: 0.188,
  tailEnd: 0.208,
} as const;

// Dark gunmetal, with the machined edges (the bezel's ring and the anti-roll ring) a shade lighter so that they catch the light.
const STEEL: Rgb = [0.11, 0.115, 0.125];
const STEEL_DARK: Rgb = [0.06, 0.062, 0.068];
const STEEL_EDGE: Rgb = [0.2, 0.205, 0.215];
const RUBBER: Rgb = [0.025, 0.027, 0.03];
const GLASS: Rgb = [0.012, 0.016, 0.02];

const aged = (seed: number, salt: number, base: number): MatSpec => ({ mat: "sheet", scale: 48, wear: base + hash01(seed, salt) * 0.14, wearKind: "grime" });

function tinted(c: Rgb, seed: number, salt: number): Rgb {
  const k = 1 + (hash01(seed, salt) - 0.5) * 0.14;
  return [c[0] * k, c[1] * k * (1 + (hash01(seed, salt + 1) - 0.5) * 0.03), c[2] * k];
}

const at = (z: number, x = 0, y = 0): Vec3 => [x, y, z];

/** A smooth round part of the torch between two places along its axis, `r0` to `r1` across, closed at both ends. */
function round(b: MeshBuilder, z0: number, z1: number, r0: number, r1: number, colour: Rgb, mat: MatSpec | "steel"): void {
  const mid = (z0 + z1) / 2;
  loft(b, [{ c: at(z0), rx: r0, ry: r0 }, { c: at(mid), rx: (r0 + r1) / 2, ry: (r0 + r1) / 2 }, { c: at(z1), rx: r1, ry: r1 }], 20, colour, mat, [0, 1, 0]);
}

/** The solids of the torch, named, each laid alone by its own call: the torch is these together, and a test holds each to being closed. */
export function torchSolids(seed = 1): readonly { readonly name: string; readonly lay: (b: MeshBuilder) => void }[] {
  const T = TORCH;
  return [
    // The bezel: a wide knurled ring round the lens, the first thing the light leaves by.
    { name: "bezel", lay: (b) => knurl(b, at(0), at(-T.bezelEnd), T.bezelRadius, 0.0016, 16, tinted(STEEL_EDGE, seed, 1), aged(seed, 2, 0.12)) },
    // The head: smooth steel behind the bezel, a little narrower toward the shoulder.
    { name: "head", lay: (b) => round(b, -T.bezelEnd, -T.headEnd, T.headRadius, T.headRadius * 0.96, tinted(STEEL, seed, 3), aged(seed, 4, 0.1)) },
    // The shoulder: the head steps down to the grip.
    { name: "shoulder", lay: (b) => round(b, -T.headEnd, -T.shoulderEnd, T.headRadius * 0.96, T.gripRadius * 1.08, tinted(STEEL_DARK, seed, 5), aged(seed, 6, 0.16)) },
    // The grip: two knurled bands.
    { name: "band one", lay: (b) => knurl(b, at(-T.shoulderEnd), at(-T.bandOneEnd), T.gripRadius, 0.0014, 14, tinted(STEEL, seed, 7), aged(seed, 8, 0.18)) },
    { name: "band two", lay: (b) => knurl(b, at(-T.ringEnd), at(-T.bandTwoEnd), T.gripRadius, 0.0014, 14, tinted(STEEL, seed, 9), aged(seed, 10, 0.24)) },
    // The anti-roll ring between them: raised, eight-sided (flats on it), chamfered at both edges.
    { name: "ring front", lay: (b) => frustum(b, at(-T.bandOneEnd), at(-T.bandOneEnd - 0.003), T.gripRadius * 1.05, T.ringRadius, 8, tinted(STEEL_DARK, seed, 11), "steel", tinted(STEEL_DARK, seed, 11), tinted(STEEL_DARK, seed, 11), 0.5) },
    { name: "ring middle", lay: (b) => frustum(b, at(-T.bandOneEnd - 0.003), at(-T.ringEnd + 0.003), T.ringRadius, T.ringRadius, 8, tinted(STEEL_EDGE, seed, 12), "steel", tinted(STEEL_EDGE, seed, 12), tinted(STEEL_EDGE, seed, 12), 0.5) },
    { name: "ring back", lay: (b) => frustum(b, at(-T.ringEnd + 0.003), at(-T.ringEnd), T.ringRadius, T.gripRadius * 1.05, 8, tinted(STEEL_DARK, seed, 13), "steel", tinted(STEEL_DARK, seed, 13), tinted(STEEL_DARK, seed, 13), 0.5) },
    // The tail: wide, smooth.
    { name: "tail", lay: (b) => round(b, -T.bandTwoEnd, -T.tailEnd, T.tailRadius, T.tailRadius * 1.02, tinted(STEEL, seed, 14), aged(seed, 15, 0.2)) },
    // The guard: six posts round the tail's end, standing past it, and the button between them, sunk below their tops.
    ...[0, 1, 2, 3, 4, 5].map((k) => ({
      name: `guard post ${k}`,
      lay: (b: MeshBuilder) => {
        const a = (k / 6) * Math.PI * 2 + 0.26;
        const r = T.tailRadius - 0.0042;
        frustum(b, at(-T.tailEnd, Math.cos(a) * r, Math.sin(a) * r), at(-T.tailEnd - 0.0055, Math.cos(a) * r, Math.sin(a) * r), 0.0042, 0.0038, 5, tinted(STEEL, seed, 20 + k), "steel", tinted(STEEL, seed, 20 + k), tinted(STEEL, seed, 20 + k));
      },
    })),
    { name: "button", lay: (b) => frustum(b, at(-T.tailEnd), at(-T.tailEnd - 0.0022), 0.0125, 0.0115, 12, RUBBER, "rubber", RUBBER, RUBBER) },
  ];
}

/** The torch's solid parts, in the torch's frame, and the dark glass of the lens. */
export function flashlightGeometry(b: MeshBuilder, seed = 1): void {
  for (const s of torchSolids(seed)) s.lay(b);
  // The glass: a dark disc a hair proud of the bezel's face (dark while the lamp is off).
  const glass = Array.from({ length: 16 }, (_, i): Vec3 => {
    const a = (i / 16) * Math.PI * 2;
    return [Math.cos(a) * TORCH.lensRadius, Math.sin(a) * TORCH.lensRadius, 0.0002];
  });
  b.poly(glass, [0, 0, 1], GLASS, "painted");
}

/** The lit face of the lens: a disc that lights itself, a hair in front of the glass. Its glow is `LENS_GLOW`, kept on at every hour. */
export const LENS_GLOW = 3;
export const LENS_COLOUR: Rgb = [1, 0.95, 0.82];
export function lensGlowGeometry(b: MeshBuilder): void {
  const r = TORCH.lensRadius * 0.96;
  const ring = (k: number): Vec3[] =>
    Array.from({ length: 16 }, (_, i): Vec3 => {
      const a = (i / 16) * Math.PI * 2;
      return [Math.cos(a) * r * k, Math.sin(a) * r * k, 0.0006];
    });
  b.withHours(ALWAYS_CODE, () => {
    // A bright middle and a dimmer rim, so that the face reads as a lens with a reflector behind it and not as a flat white coin.
    const rim = ring(1);
    const mid = ring(0.62);
    for (let i = 0; i < 16; i++) b.poly([rim[i] as Vec3, rim[(i + 1) % 16] as Vec3, mid[(i + 1) % 16] as Vec3, mid[i] as Vec3], [0, 0, 1], LENS_COLOUR, "painted", { glow: LENS_GLOW * 0.55 });
    b.poly(mid, [0, 0, 1], LENS_COLOUR, "painted", { glow: LENS_GLOW });
  });
}
