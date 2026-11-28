/**
 * The player's right hand gripping the torch, and the forearm into the lower right of the view, built in code in the torch's own frame
 * (`flashlightGeometry.ts`: +z along the torch, the lens at the origin).
 *
 * It wears a glove, on purpose: a bare hand needs skin shading the town has not, and in the rain on this coast a detective wears one. The glove is smooth dark leather,
 * rounded as a hand is and not as a mannequin's: each finger is one lofted tube that tapers from a soft knuckle to a rounded tip, wrapping the second knurled band of the
 * grip from behind, the fingertips coming round the front of the barrel; the thumb lies along the barrel toward the head; the back of the hand is one full lofted form
 * with a seam down it and flows into a thick wrist with a cuff strap and a small buckle. Over the wrist goes a heavy waxed coat's cuff and sleeve, with a piped edge, a
 * seam and a button. The head of the torch stands clear of the fist by more than 5 cm.
 *
 * Textures, all of the town's own layers (`materials.ts`): the leather is `rubber`, the asphalt-dark layer's fine black grain, in one even near-black brown with no
 * wear (it is matt and faintly grained as leather is, and is the one dark fine-grained layer the town has); the coat is `cloth`, the sidewalk concrete's even grain laid
 * fine and tinted a dark olive, which is how a waxed cotton shows from a metre off (a dry matt weave with no sheen); the buckle is `steel`. The torch's metal is in
 * `flashlightGeometry.ts`. The rooms' own layers are not loaded in the street and are not used.
 */
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "../town/meshBuilder.js";
import type { MatSpec } from "../town/materials.js";
import { TORCH } from "./flashlightGeometry.js";
import { bevelBox, loft, type Section } from "./handShapes.js";

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** The grip the fingers wrap (the second knurled band), the finger's own thickness, and the ring a finger's middle runs round the barrel on. */
const GRIP = TORCH.gripRadius;
const FINGER_R = 0.0106;
const RING = GRIP + FINGER_R * 0.92;
/** Where the first finger stands behind the lens, the gap between fingers, and each finger's reach (its share of the turn) and thickness, first to last. */
const FIRST = 0.1435, GAP = 0.015;
const REACH = [1, 1.04, 1, 0.84] as const;
const THICK = [1, 1.04, 1, 0.86] as const;
/** The angles of a finger's knuckle and its tip as it wraps: over the right of the barrel, under it and up the left. */
const KNUCKLE_A = (28 * Math.PI) / 180, TIP_A = (-205 * Math.PI) / 180;

// One even tone of near-black brown leather over the whole glove.
const LEATHER: Rgb = [0.042, 0.028, 0.02];
const LEATHER_SEAM: Rgb = [0.03, 0.02, 0.015];
const COAT: Rgb = [0.05, 0.056, 0.036];
const COAT_CUFF: Rgb = [0.034, 0.038, 0.026];
const COAT_EDGE: Rgb = [0.075, 0.08, 0.05];
const HORN: Rgb = [0.03, 0.022, 0.016];
const BUCKLE: Rgb = [0.2, 0.2, 0.21];

const LEATHER_MAT: MatSpec = { mat: "rubber", scale: 6 };

/** The knuckle where the back of the hand meets the fingers, and the way the back runs to the wrist; the wrist; and the forearm's direction from it toward the elbow. */
const KNUCKLE: Vec3 = [RING * Math.cos(KNUCKLE_A), RING * Math.sin(KNUCKLE_A), -(FIRST + GAP * 1.5)];
const BACK_DIR = unit([0.95, -0.12, -0.3]);
const BACK_LENGTH = 0.092;
export const WRIST: Vec3 = along(KNUCKLE, BACK_DIR, BACK_LENGTH);
/**
 * The forearm runs on from the back of the hand, down and back. The torch is held rolled a quarter turn and more (`HOLD_ROLL`, `handPose.ts`), so the torch frame's +x is
 * about the view's down, and the arm leaves toward the lower right.
 */
export const FOREARM: Vec3 = unit([0.43, -0.83, -0.4]);

const cloth = (seed: number): MatSpec => ({ mat: "cloth", scale: 5, wear: 0.06 + hash01(seed, 62) * 0.06, wearKind: "grime" });
const forearmAt = (k: number): Vec3 => along(WRIST, FOREARM, k);
const sleeveR = (k: number): number => 0.0485 + ((0.064 - 0.0485) * (k - 0.09)) / (0.35 - 0.09);

/** A finger: one tube, a soft knuckle, two soft joints, a rounded tip, round the barrel at its place along the grip. */
export function finger(b: MeshBuilder, i: number): void {
  const z = -(FIRST + GAP * i);
  const reach = REACH[i] as number;
  const thick = THICK[i] as number;
  const n = 18;
  const sections: Section[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = KNUCKLE_A + (TIP_A - KNUCKLE_A) * reach * t;
    // Taper from the knuckle to the tip, a swelling at the knuckle and (less) at the two joints, then the end closed to a round tip.
    let r = FINGER_R * thick * (1.06 - 0.2 * t);
    r *= 1 + 0.06 * Math.exp(-(((t - 0.34) / 0.05) ** 2)) + 0.05 * Math.exp(-(((t - 0.68) / 0.05) ** 2));
    if (t > 0.9) r *= Math.sqrt(Math.max(0.16, 1 - ((t - 0.9) / 0.1) ** 2));
    // The arm of the turn drifts a little toward the tail as it goes round, as a hand's does.
    sections.push({ c: [RING * Math.cos(a), RING * Math.sin(a), z - 0.0015 * t], rx: r, ry: r });
  }
  loft(b, sections, 9, LEATHER, LEATHER_MAT, [0, 0, 1]);
}

/** The thumb: lies along the barrel from the heel of the hand toward the head, its tip over the band, soft at its joint and rounded at its tip. */
export function thumb(b: MeshBuilder): void {
  const top = GRIP + 0.0085;
  const path: Vec3[] = [[0.052, 0.014, -0.176], [0.034, 0.022, -0.17], [0.016, 0.0285, -0.158], [0.003, top, -0.14], [0, top, -0.122], [0, top, -0.1105]];
  const radii = [0.0112, 0.0108, 0.0102, 0.0098, 0.0092, 0.0072];
  const sections: Section[] = path.map((c, k) => ({ c, rx: radii[k] as number, ry: (radii[k] as number) * 0.92 }));
  // Round the tip: one more section closes it.
  const last = path[path.length - 1] as Vec3;
  sections.push({ c: [last[0], last[1], last[2] + 0.004], rx: 0.0036, ry: 0.0034 });
  loft(b, sections, 9, LEATHER, LEATHER_MAT, [1, 0, 0]);
}

/** The back of the hand: one full rounded form from the knuckles to the wrist, a little wider across the knuckles and thickest over the middle of it. */
export function backOfHand(b: MeshBuilder): void {
  const sections: Section[] = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const c = along(KNUCKLE, BACK_DIR, BACK_LENGTH * t);
    // Across (along the torch): the knuckles are the widest, the wrist narrower. Thickness: full over the middle.
    const rx = 0.0385 - 0.0095 * t * t;
    const ry = 0.0125 + 0.0065 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    sections.push({ c, rx, ry });
  }
  // The first section is the knuckle line: drawn in a little, so the fingers' roots stand out of it.
  loft(b, sections, 12, LEATHER, LEATHER_MAT, [0, 0, 1]);
}

/** The glove's wrist and gauntlet: a thick tube from the back of the hand along the forearm, wider at its mouth. */
export function gloveWrist(b: MeshBuilder): void {
  const sections: Section[] = [];
  for (let k = 0; k < 5; k++) {
    const t = k / 4;
    const r = 0.0265 + 0.0075 * t;
    sections.push({ c: forearmAt(-0.02 + 0.1 * t), rx: r * 1.02, ry: r * 0.94 });
  }
  loft(b, sections, 14, LEATHER, LEATHER_MAT, [0, 0, 1]);
}

/** The strap at the glove's wrist: a band a little wider than the gauntlet, in darker leather. */
export function strap(b: MeshBuilder): void {
  const r = 0.0318;
  const sections: Section[] = [0, 1, 2].map((k) => ({ c: forearmAt(0.018 + 0.0065 * k), rx: r * (k === 1 ? 1.06 : 1), ry: r * (k === 1 ? 1.0 : 0.94) }));
  loft(b, sections, 14, LEATHER_SEAM, LEATHER_MAT, [0, 0, 1]);
}

/** The strap's buckle: a small plate of steel on the strap's outer side. */
export function buckle(b: MeshBuilder): void {
  const f = FOREARM;
  const out = unit(cross(f, [0, 0, 1]));
  const centre = along(along(forearmAt(0.0245), out, 0.0345), [0, 0, 1], 0.004);
  const ax = out;
  const az = unit(cross(ax, f));
  bevelBox(b, centre, ax, f, az, [0.0028, 0.0075, 0.0095], 0.0012, BUCKLE, BUCKLE, "steel");
}

/** The seam down the back of the hand: a thin ridge of the same leather, a shade darker, on the back's top. */
export function handSeam(b: MeshBuilder): void {
  const sections: Section[] = [];
  const nrm = unit(cross(BACK_DIR, [0, 0, 1]));
  const out: Vec3 = nrm[1] < 0 ? [-nrm[0], -nrm[1], -nrm[2]] : nrm;
  for (let k = 0; k < 4; k++) {
    const t = 0.16 + 0.7 * (k / 3);
    const ry = 0.0125 + 0.0065 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    sections.push({ c: along(along(KNUCKLE, BACK_DIR, BACK_LENGTH * t), out, ry * 0.97), rx: 0.0016, ry: 0.0012 });
  }
  loft(b, sections, 5, LEATHER_SEAM, LEATHER_MAT, [0, 0, 1]);
}

/** The coat's cuff: a band wider than the sleeve, darker, with a pale piped edge at its mouth: a cuff, with a step to the sleeve. */
export function cuff(b: MeshBuilder, seed: number): void {
  const band: Section[] = [[0.026, 0.0345], [0.031, 0.0485], [0.05, 0.0495], [0.09, 0.0505]].map(([k, r]) => ({ c: forearmAt(k as number), rx: r as number, ry: r as number }));
  loft(b, band, 16, COAT_CUFF, cloth(seed), [0, 0, 1]);
  const edge: Section[] = [[0.0295, 0.0415], [0.0335, 0.0528], [0.0375, 0.0415]].map(([k, r]) => ({ c: forearmAt(k as number), rx: r as number, ry: r as number }));
  loft(b, edge, 16, COAT_EDGE, cloth(seed), [0, 0, 1]);
}

/** The sleeve, flaring from the cuff toward the elbow. */
export function sleeveTube(b: MeshBuilder, seed: number): void {
  const sections: Section[] = [0.09, 0.15, 0.22, 0.29, 0.35].map((k) => ({ c: forearmAt(k), rx: sleeveR(k), ry: sleeveR(k) }));
  loft(b, sections, 16, COAT, cloth(seed), [0, 0, 1]);
}

/** The unit vector across the forearm that is nearest to `want`. */
function radial(want: Vec3): Vec3 {
  const t = FOREARM;
  const k = want[0] * t[0] + want[1] * t[1] + want[2] * t[2];
  return unit([want[0] - t[0] * k, want[1] - t[1] * k, want[2] - t[2] * k]);
}

/** The seam: a thin ridge down the side of the sleeve that faces up (the view's up: the torch's -x with its roll), so it is seen. */
export function seam(b: MeshBuilder, seed: number): void {
  const rd = radial([-0.9, -0.2, -0.3]);
  const sections: Section[] = [0.1, 0.16, 0.22, 0.28, 0.34].map((k) => ({ c: along(forearmAt(k), rd, sleeveR(k) * 0.985), rx: 0.0026, ry: 0.0022 }));
  loft(b, sections, 5, [0.03, 0.034, 0.022], cloth(seed), [0, 0, 1]);
}

/** A horn button on the cuff's outer face, to the right of the view. */
export function button(b: MeshBuilder): void {
  const bd = radial([-0.2, 0.95, 0.1]);
  const base = along(forearmAt(0.07), bd, 0.0495);
  const sections: Section[] = [0, 0.0016, 0.0032].map((k, i) => ({ c: along(base, bd, k), rx: [0.0068, 0.0066, 0.0052][i] as number, ry: [0.0068, 0.0066, 0.0052][i] as number }));
  loft(b, sections, 12, HORN, "rubber", [0, 0, 1]);
}

/** Every solid of the hand, named, each laid alone by its own call: the hand is these together, and a test holds each to being closed. */
export function handSolids(seed = 1): readonly { readonly name: string; readonly lay: (b: MeshBuilder) => void }[] {
  return [
    ...[0, 1, 2, 3].map((i) => ({ name: `finger ${i}`, lay: (b: MeshBuilder) => finger(b, i) })),
    { name: "thumb", lay: (b: MeshBuilder) => thumb(b) },
    { name: "back of the hand", lay: (b: MeshBuilder) => backOfHand(b) },
    { name: "hand seam", lay: (b: MeshBuilder) => handSeam(b) },
    { name: "glove wrist", lay: (b: MeshBuilder) => gloveWrist(b) },
    { name: "strap", lay: (b: MeshBuilder) => strap(b) },
    { name: "buckle", lay: (b: MeshBuilder) => buckle(b) },
    { name: "cuff", lay: (b: MeshBuilder) => cuff(b, seed) },
    { name: "sleeve", lay: (b: MeshBuilder) => sleeveTube(b, seed) },
    { name: "seam", lay: (b: MeshBuilder) => seam(b, seed) },
    { name: "button", lay: (b: MeshBuilder) => button(b) },
  ];
}

/** The whole hand and sleeve. */
export function handGeometry(b: MeshBuilder, seed = 1): void {
  for (const s of handSolids(seed)) s.lay(b);
}
