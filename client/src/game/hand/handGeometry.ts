/**
 * The player's right hand gripping the torch, and the forearm into the lower right of the view, built in code in the torch's own frame
 * (`flashlightGeometry.ts`: +z along the torch, the lens at the origin).
 *
 * It wears a glove, on purpose: a bare hand built of boxes does not read as skin, and a glove is only ever a made thing. The glove is dark leather: four
 * fingers, each of three short jointed segments wrapped round the body from the right of it, under it and up the left; a thumb of two along the top, ending on
 * the switch; the back of the hand as a box with its edges cut away; and the glove's wrist. Over the wrist goes the cuff and the sleeve of a heavy waxed
 * cotton coat: a cuff band, the sleeve flaring toward the elbow, a seam along it and a horn button at the cuff.
 *
 * Textures, all of the town's own layers (`materials.ts`): the leather is `rubber`, the asphalt-dark layer's fine black grain, tinted one even near-black brown with no wear
 * (it is matt and faintly grained as leather is, and is the one dark fine-grained layer the town has); the coat is `cloth`, the sidewalk concrete's even
 * grain laid fine and tinted a dark olive, which is how a waxed cotton shows from a metre off (a dry matt weave with no sheen); the button is `rubber` too.
 * The torch's metal is in `flashlightGeometry.ts`. The rooms' own layers are not loaded in the street and are not used.
 *
 * About 1,100 vertices: with the torch, under 1,800.
 */
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "../town/meshBuilder.js";
import type { MatSpec } from "../town/materials.js";
import { TORCH } from "./flashlightGeometry.js";
import { across, bevelBox, frustum } from "./handShapes.js";

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** How wide a glove's finger is (radius), metres, and the ring a finger wraps round the body on. */
const FINGER_R = 0.0085;
const RING = TORCH.bodyRadius + FINGER_R * 0.96;
/** The angles (radians, from +x toward +y) of a finger's knuckle, its two joints and its tip as it wraps: over the right side, under the body and up the left. */
const WRAP = [25, -45, -115, -190].map((d) => (d * Math.PI) / 180);
/** Where the first finger stands along the torch (metres behind the lens), the gap between fingers, and each finger's reach as a share of the first's. */
const FIRST = 0.05, GAP = 0.0175, REACH = [1, 1.03, 0.98, 0.84] as const;

// One even tone of near-black brown leather, over the whole glove: no part of it is lighter or dirtier than another.
const LEATHER: Rgb = [0.042, 0.028, 0.02];
const LEATHER_BACK: Rgb = [0.05, 0.033, 0.024];
const COAT: Rgb = [0.07, 0.08, 0.042];
const COAT_CUFF: Rgb = [0.032, 0.036, 0.024];
const COAT_EDGE: Rgb = [0.055, 0.06, 0.038];
const HORN: Rgb = [0.03, 0.022, 0.016];

/** The knuckle's end of the back of the hand: where the fingers start from, and the way the hand's back runs to the wrist. */
const KNUCKLE: Vec3 = [RING * Math.cos(WRAP[0] as number), RING * Math.sin(WRAP[0] as number), -(FIRST + GAP * 1.5)];
const BACK_DIR = unit([0.95, -0.1, -0.28]);
const BACK_LENGTH = 0.085;
/**
 * The wrist, and the forearm's direction from it toward the elbow. The torch is held rolled a quarter turn (`HOLD_ROLL`, `handPose.ts`), so the torch frame's +x is
 * the view's down: the forearm runs on from the back of the hand, down and back, and rises from the bottom edge of the view.
 */
export const WRIST: Vec3 = along(KNUCKLE, BACK_DIR, BACK_LENGTH);
export const FOREARM: Vec3 = unit([0.86, -0.05, -0.5]);

/** The glove's material: the fine grain of the dark layer and no wear at all (a glove has no patches). */
const LEATHER_MAT: MatSpec = { mat: "rubber", scale: 6 };
const leather = (): MatSpec => LEATHER_MAT;
/** The glove's colour: the same for every part (the hash is kept for the coat, which is worn). */
const hide = (c: Rgb, seed: number, salt: number): Rgb => {
  if (c === LEATHER || c === LEATHER_BACK) return c;
  const k = 1 + (hash01(seed, salt) - 0.5) * 0.18;
  return [c[0] * k, c[1] * k, c[2] * k * (1 + (hash01(seed, salt + 7) - 0.5) * 0.1)];
};

/** A finger: three segments round the ring at its place along the torch. */
export function finger(b: MeshBuilder, i: number, seed: number): void {
  const z = -(FIRST + GAP * i);
  const reach = REACH[i] as number;
  const ringAt = (k: number): Vec3 => {
    // A shorter finger turns less of the way round.
    const a = (WRAP[0] as number) + ((WRAP[k] as number) - (WRAP[0] as number)) * reach;
    return [RING * Math.cos(a), RING * Math.sin(a), z];
  };
  const mat = leather();
  const colour = hide(LEATHER, seed, 30 + i);
  for (let s = 0; s < 3; s++) {
    // Each segment runs a little past its joint, so the joint is a rounded knuckle and not a gap; each is thinner than the one before.
    const p0 = ringAt(s);
    const p1 = ringAt(s + 1);
    const r0 = FINGER_R * (1 - 0.06 * s) * (i === 3 ? 0.88 : 1);
    const r1 = FINGER_R * (1 - 0.06 * (s + 1)) * (i === 3 ? 0.88 : 1);
    frustum(b, p0, p1, r0 * 1.04, r1 * (s === 2 ? 0.9 : 1.04), 8, colour, mat, colour, colour, s * 0.5);
  }
}

/** The thumb: two segments from the heel of the hand over the top of the torch, its tip on the switch. */
export function thumb(b: MeshBuilder, seed: number): void {
  const root: Vec3 = [0.052, 0.02, -0.108];
  const joint: Vec3 = [0.026, 0.0275, -0.082];
  const tip: Vec3 = [0.004, 0.0268, -0.058];
  const mat = leather();
  const colour = hide(LEATHER, seed, 41);
  frustum(b, root, joint, 0.0105, 0.0098, 8, colour, mat, colour, colour);
  frustum(b, joint, tip, 0.0098, 0.0086, 8, colour, mat, colour, colour, 0.5);
}

/** The knuckles: a rounded bar across the roots of the four fingers, which joins them to the back of the hand with no step between. */
export function knuckles(b: MeshBuilder, seed: number): void {
  const c = hide(LEATHER_BACK, seed, 55);
  const z0 = -(FIRST - 0.004), z3 = -(FIRST + GAP * 3 + 0.004);
  frustum(b, [KNUCKLE[0], KNUCKLE[1], z0], [KNUCKLE[0], KNUCKLE[1], z3], FINGER_R * 1.16, FINGER_R * 1.1, 8, c, leather(), c, c, 0.5);
}

/** The back of the hand, a box with its edges cut away, from the knuckles to the wrist. */
export function backOfHand(b: MeshBuilder, seed: number): void {
  const ax = BACK_DIR;
  const ay0: Vec3 = unit(cross([0, 0, 1], ax));
  // The hand's back faces up and out (the normal points toward +y).
  const ay: Vec3 = ay0[1] < 0 ? [-ay0[0], -ay0[1], -ay0[2]] : ay0;
  const az = unit(cross(ax, ay));
  const centre = along(KNUCKLE, ax, BACK_LENGTH / 2);
  bevelBox(b, centre, ax, ay, az, [BACK_LENGTH / 2, 0.014, GAP * 2 + 0.003], 0.0065, hide(LEATHER, seed, 50), hide(LEATHER_BACK, seed, 51), leather());
}

const forearmAt = (k: number): Vec3 => along(WRIST, FOREARM, k);
const cloth = (seed: number): MatSpec => ({ mat: "cloth", scale: 5, wear: 0.1 + hash01(seed, 62) * 0.1, wearKind: "grime" });
/** The sleeve's radius at `k` metres along the forearm from the wrist. */
const sleeveR = (k: number): number => 0.0425 + ((0.058 - 0.0425) * (k - 0.088)) / (0.36 - 0.088);
/** The unit vector across the forearm that is nearest to `want`. */
function radial(want: Vec3): Vec3 {
  const [u, v] = across(FOREARM);
  const a = dot(want, u);
  const c = dot(want, v);
  return unit([u[0] * a + v[0] * c, u[1] * a + v[1] * c, u[2] * a + v[2] * c]);
}

/** The glove's wrist: a short tube from the hand's back along the forearm, a gauntlet that ends under the coat's cuff. */
export function gloveWrist(b: MeshBuilder, seed: number): void {
  const c = hide(LEATHER, seed, 61);
  frustum(b, forearmAt(-0.012), forearmAt(0.07), 0.031, 0.036, 8, c, leather(), c, c);
}

/** The coat's cuff: a band of a darker cloth that stands off the glove. */
export function cuff(b: MeshBuilder, seed: number): void {
  // A band wider than the sleeve that follows it, darker, with a pale piped edge at its mouth: a cuff, with a step to the sleeve.
  frustum(b, forearmAt(0.034), forearmAt(0.088), 0.0485, 0.0495, 10, COAT_CUFF, cloth(seed), COAT_CUFF, COAT_CUFF, 0.5);
  frustum(b, forearmAt(0.027), forearmAt(0.037), 0.0505, 0.0505, 10, COAT_EDGE, cloth(seed), COAT_EDGE, COAT_EDGE, 0.25);
}

/** The sleeve, flaring from the cuff toward the elbow. */
export function sleeveTube(b: MeshBuilder, seed: number): void {
  const c = hide(COAT, seed, 63);
  frustum(b, forearmAt(0.088), forearmAt(0.36), sleeveR(0.088), sleeveR(0.36), 10, c, cloth(seed), c, c);
}

/** The seam: a thin dark ridge along the side of the sleeve that faces up (the view's up: the torch's -x with its roll), so it is seen. */
export function seam(b: MeshBuilder, seed: number): void {
  const rd = radial([-0.9, -0.2, -0.3]);
  const at = (k: number): Vec3 => along(forearmAt(k), rd, sleeveR(k) * 0.97);
  const c: Rgb = [0.035, 0.04, 0.022];
  frustum(b, at(0.095), at(0.34), 0.0028, 0.0028, 3, c, cloth(seed), c, c);
}

/** A horn button on the cuff's outer face, to the right of the view. */
export function button(b: MeshBuilder): void {
  const bd = radial([-0.2, 0.95, 0.1]);
  const base = along(forearmAt(0.062), bd, 0.0492);
  frustum(b, base, along(base, bd, 0.0035), 0.0062, 0.0056, 8, HORN, "rubber", HORN, HORN);
}

/** Every solid of the hand, named, each laid alone by its own call: the hand is these together, and a test holds each to being closed. */
export function handSolids(seed = 1): readonly { readonly name: string; readonly lay: (b: MeshBuilder) => void }[] {
  return [
    ...[0, 1, 2, 3].map((i) => ({ name: `finger ${i}`, lay: (b: MeshBuilder) => finger(b, i, seed) })),
    { name: "thumb", lay: (b: MeshBuilder) => thumb(b, seed) },
    { name: "knuckles", lay: (b: MeshBuilder) => knuckles(b, seed) },
    { name: "back of the hand", lay: (b: MeshBuilder) => backOfHand(b, seed) },
    { name: "glove wrist", lay: (b: MeshBuilder) => gloveWrist(b, seed) },
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
