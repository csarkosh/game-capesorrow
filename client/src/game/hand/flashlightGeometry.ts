/**
 * The player's hand torch, built in code as everything in the town is: a knurled aluminium body about 15 cm long and 2.6 cm across, a head wider than the
 * body (4.4 cm) with a bezel, a tail cap, a rubber switch on top and a lens. It is laid in the torch's own frame: +z is the way it points, +x is to the
 * right of it and +y is up, with the origin at the middle of the lens. `handGeometry.ts` lays the hand that holds it in the same frame.
 *
 * The lens is two things. The glass is part of the torch's mesh and is dark. The lit face (`lensGlowGeometry`) is a disc laid a hair in front of it as a mesh
 * of its own, which is drawn only while the lamp is on, and lights itself (a glow, kept on at any hour: `ALWAYS_CODE`). Its colour is the lamp's.
 *
 * Wear: the torch is not new. A hash of the seed varies the albedo of the body's parts by a few per cent and lays each a little grime of its own, so the
 * body, the head and the tail cap are three different ages of one tool.
 *
 * The materials are the town's own layers (see `materials.ts`): the body, the head and the tail cap are `sheet` (the aged corrugated metal, neutral, tinted
 * to aluminium, laid fine so that its ribs read as knurling), the bezel and the switch's collar are `steel` and the switch is `rubber`.
 */
import { ALWAYS_CODE } from "../town/hours.js";
import { hash01, type MeshBuilder, type Rgb } from "../town/meshBuilder.js";
import type { MatSpec } from "../town/materials.js";
import { bevelBox, frustum } from "./handShapes.js";

/** The torch's sizes, metres. The body's length is from the tail's end to the bezel's front. */
export const TORCH = {
  length: 0.15,
  bodyRadius: 0.013,
  headRadius: 0.022,
  bezelRadius: 0.0225,
  bezelLength: 0.006,
  lensRadius: 0.0185,
  tailLength: 0.012,
  /** Where the head ends and the body begins, behind the lens. */
  headLength: 0.026,
  /** The switch's place along the axis (behind the lens) and its half sizes. */
  switchAt: 0.062,
  switchHalf: [0.0055, 0.0035, 0.0085] as const,
} as const;

const ALUMINIUM: Rgb = [0.27, 0.275, 0.29];
const HEAD: Rgb = [0.1, 0.1, 0.11];
const BEZEL: Rgb = [0.36, 0.35, 0.33];
const RUBBER: Rgb = [0.025, 0.027, 0.03];
const GLASS: Rgb = [0.012, 0.016, 0.02];

const aged = (seed: number, salt: number, base: number): MatSpec => ({ mat: "sheet", scale: 14, wear: base + hash01(seed, salt) * 0.16, wearKind: "grime" });

function tinted(c: Rgb, seed: number, salt: number): Rgb {
  const k = 1 + (hash01(seed, salt) - 0.5) * 0.14;
  return [c[0] * k, c[1] * k * (1 + (hash01(seed, salt + 1) - 0.5) * 0.03), c[2] * k];
}

/** The torch's solid parts, in the torch's frame. */
export function flashlightGeometry(b: MeshBuilder, seed = 1): void {
  const { length, bodyRadius, headRadius, bezelRadius, bezelLength, lensRadius, tailLength, headLength } = TORCH;
  // The tail cap: a short flat end, a little wider than the body.
  frustum(b, [0, 0, -length], [0, 0, -length + tailLength], bodyRadius * 0.96, bodyRadius * 1.04, 10, tinted(ALUMINIUM, seed, 1), aged(seed, 2, 0.28));
  // The body: the knurled tube between the tail and the head.
  frustum(b, [0, 0, -length + tailLength], [0, 0, -headLength], bodyRadius, bodyRadius, 10, tinted(ALUMINIUM, seed, 3), aged(seed, 4, 0.1), null, null, 0.5);
  // The head: black anodised, flaring from the body to the bezel's width.
  frustum(b, [0, 0, -headLength], [0, 0, -bezelLength], bodyRadius * 1.04, headRadius, 12, tinted(HEAD, seed, 5), aged(seed, 6, 0.06), null, null);
  // The bezel: a ring of bright steel round the glass, its front face the one the lens lies on.
  frustum(b, [0, 0, -bezelLength], [0, 0, 0], bezelRadius, bezelRadius, 12, tinted(BEZEL, seed, 7), "steel", null, BEZEL, 0.5);
  // The glass: a dark disc a hair proud of the bezel's face (dark while the lamp is off).
  const glass = Array.from({ length: 12 }, (_, i): [number, number, number] => {
    const a = (i / 12) * Math.PI * 2;
    return [Math.cos(a) * lensRadius, Math.sin(a) * lensRadius, 0.0002];
  });
  b.poly(glass, [0, 0, 1], GLASS, "painted");
  // The switch: a rubber button in a collar of steel on top of the body, where the thumb lies.
  const [hx, hy, hz] = TORCH.switchHalf;
  const sy = bodyRadius + hy * 0.6;
  bevelBox(b, [0, sy, -TORCH.switchAt], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hx, hy, hz], 0.0012, RUBBER, RUBBER, "rubber");
  bevelBox(b, [0, bodyRadius * 0.96, -TORCH.switchAt], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hx * 1.5, hy * 0.5, hz * 1.4], 0.0008, tinted(BEZEL, seed, 9), tinted(BEZEL, seed, 9), "steel");
}

/** The lit face of the lens: a disc that lights itself, a hair in front of the glass. Its glow is `LENS_GLOW`, kept on at every hour. */
export const LENS_GLOW = 3;
export const LENS_COLOUR: Rgb = [1, 0.95, 0.82];
export function lensGlowGeometry(b: MeshBuilder): void {
  const r = TORCH.lensRadius * 0.96;
  const ring = (k: number): [number, number, number][] =>
    Array.from({ length: 12 }, (_, i): [number, number, number] => {
      const a = (i / 12) * Math.PI * 2;
      return [Math.cos(a) * r * k, Math.sin(a) * r * k, 0.0006];
    });
  b.withHours(ALWAYS_CODE, () => {
    // A bright middle and a dimmer rim, so that the face reads as a lens with a reflector behind it and not as a flat white coin.
    const rim = ring(1);
    const mid = ring(0.62);
    for (let i = 0; i < 12; i++) b.poly([rim[i] as [number, number, number], rim[(i + 1) % 12] as [number, number, number], mid[(i + 1) % 12] as [number, number, number], mid[i] as [number, number, number]], [0, 0, 1], LENS_COLOUR, "painted", { glow: LENS_GLOW * 0.55 });
    b.poly(mid, [0, 0, 1], LENS_COLOUR, "painted", { glow: LENS_GLOW });
  });
}
