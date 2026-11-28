/**
 * The player's left arm with a smart watch on the wrist, built in code in the watch's own frame and in the same manner as the right arm (`handGeometry.ts`): lofted bodies
 * in a dark waxed coat's sleeve and a dark glove. The frame: the origin is the middle of the watch's screen; +z runs along the forearm toward the fingers (the watch's
 * three o'clock, where its crown is, on a left wrist); +y is the face's normal, out of the back of the wrist toward the eye; +x is across the wrist, the way the watch reads
 * downward (so twelve o'clock, away from the wearer's body as the arm lies across the view, is -x). The wrist's own axis runs along z at y = `WRIST_Y`.
 *
 * The watch is our own design, in the kind of a round smart watch with a domed glass: a low pebble of a case 45 mm across with a slim polished rim, a black glass that
 * domes down to meet it (no flat bezel and no lugs: the strap leaves from under the case), one crown at three o'clock with a small button beside it, and a brown leather
 * strap round the wrist with pale stitching along each edge, a keeper loop and the strap's tail through it, on the side of the wrist that shows below the case. The lit screen is a circle 36 mm across inset in the glass, laid as a flat disc a hair over the dome's middle: it is dark here, and the page
 * draws the map onto its place (`WATCH_SEEN.quad`, the square that bounds it). Everything of the watch is drawn `WATCH_BIG` times larger than a real one, on purpose: the map
 * on its face has to be read, and the arm is only `ARM_SCALE` times life size.
 *
 * No bare skin (the town has no skin shading): the watch sits on a dark knit cuff of the glove, between the glove and the coat's sleeve, which is pushed back a little.
 * Textures are the town's own layers: the glove `rubber`, the knit `cloth`, the coat `cloth`, the case and crown `steel`, the glass `painted`, the strap `rubber` (the asphalt-dark layer's fine pebbled grain, tinted brown: it reads as leather, which no other layer of the town does; the plywood layer has the right brown but is wood).
 */
import { hash01, type MeshBuilder, type Rgb, type Vec3 } from "../town/meshBuilder.js";
import type { MatSpec } from "../town/materials.js";
import { frustum, loft, type Section } from "./handShapes.js";

/** How much larger than a real watch the watch is drawn. */
export const WATCH_BIG = 1.75;
/** The circle of the lit screen's radius (36 mm across), before `WATCH_BIG`, and the height of the glass over the origin at its middle. */
export const SCREEN_RADIUS = 0.018;
const B = WATCH_BIG;
/**
 * The wrist under the watch is slim (`WRIST_R`: the glove's knit cuff, 27 mm), the strap round it 4.5 mm thick, so the watch, a pebble 45 mm across drawn `WATCH_BIG` times larger,
 * stands a little wider than the wrist as a real watch does, and the coat's sleeve is no wider than a coat's cuff is over such a wrist. The watch's origin is the middle of the screen; its case's
 * underside rests on the strap's top.
 */
export const WRIST_R = 0.027;
export const STRAP_THICK = 0.0045;
const STRAP_R = WRIST_R + STRAP_THICK;
/** Where the wrist's axis runs, under the origin: the strap's top meets the case's underside. */
export const WRIST_Y = -0.003 * B + 0.001 - STRAP_R;
/** The face's height (the lit screen's plane), over the origin. */
export const SCREEN_Y = 0.0074 * B;

const CASE: Rgb = [0.07, 0.072, 0.08];
const GLASS: Rgb = [0.006, 0.007, 0.009];
const SCREEN: Rgb = [0.01, 0.014, 0.024];
// The strap: warm mid-brown leather, a little darker at its edges, with pale stitching along each edge.
const STRAP: Rgb = [0.22, 0.12, 0.06];
const STRAP_EDGE: Rgb = [0.15, 0.08, 0.04];
const STITCH: Rgb = [0.6, 0.52, 0.38];
const STRAP_MAT: MatSpec = { mat: "rubber", scale: 5 };
const KNIT: Rgb = [0.03, 0.032, 0.03];
const LEATHER: Rgb = [0.042, 0.028, 0.02];
const COAT: Rgb = [0.05, 0.056, 0.036];
const COAT_CUFF: Rgb = [0.034, 0.038, 0.026];
const COAT_EDGE: Rgb = [0.075, 0.08, 0.05];
const LEATHER_MAT: MatSpec = { mat: "rubber", scale: 6 };
const cloth = (seed: number): MatSpec => ({ mat: "cloth", scale: 5, wear: 0.06 + hash01(seed, 62) * 0.06, wearKind: "grime" });

/** A point of the forearm's axis, `z` metres along it from the screen's middle. */
const axisAt = (z: number): Vec3 => [0, WRIST_Y, z];
const ring = (z: number, r: number): Section => ({ c: axisAt(z), rx: r, ry: r });

/** The four corners of the square that bounds the lit circle, in this frame, in the order the wearer reads them: top left, top right, bottom right, bottom left. */
export function screenSquare(): readonly Vec3[] {
  const r = SCREEN_RADIUS * B;
  // Up is -x and right is +z.
  return [[-r, SCREEN_Y, -r], [-r, SCREEN_Y, r], [r, SCREEN_Y, r], [r, SCREEN_Y, -r]];
}

/** How far a band shows beyond the case's edge, metres, in the watch's own size: 15 mm. */
export const BAND_OUT = 0.015 * B;
/** The case's radius as it is drawn. */
export const CASE_RADIUS = 0.0226 * B;

/** The centre line of a band on `side` (-1 twelve o'clock, +1 six: x is the way the watch reads down): out from under the case, past its edge, and down round the wrist. */
function bandPath(side: number): Vec3[] {
  const out = CASE_RADIUS + BAND_OUT;
  const wrist = WRIST_Y - STRAP_R;
  return [
    [0.7 * CASE_RADIUS, -0.0058, 0], [CASE_RADIUS, -0.0064, 0], [CASE_RADIUS + BAND_OUT * 0.55, -0.0072, 0], [out, -0.0102, 0], [out + 0.006, -0.0215, 0], [out + 0.004, -0.0345, 0], [out - 0.008, -0.048, 0], [0.5 * out, wrist + 0.004, 0], [0.15 * out, wrist, 0],
  ].map(([x, y, z]) => [side * (x as number), y as number, z as number]);
}

/** A band of leather along `bandPath`: `half` wide, `thick` thick, closed at both ends. */
function band(b: MeshBuilder, side: number, colour: (i: number, j: number) => Rgb, half: number, thick: number): void {
  const path = bandPath(side);
  loft(b, path.map((c, k) => ({ c, rx: half * (k === 0 ? 0.9 : 1), ry: thick })), 10, colour, STRAP_MAT, [0, 0, 1]);
}

/** A line of pale stitching along a band's edge: a thin tube just inside the edge, over the band's upper face, ending where the band turns down. */
function stitch(b: MeshBuilder, side: number, edge: number): void {
  const path = bandPath(side).slice(2, 6);
  loft(b, path.map(([x, y]) => ({ c: [x, y + 0.0041, edge * 0.0158] as Vec3, rx: 0.0009, ry: 0.0008 })), 5, STITCH, STRAP_MAT, [0, 0, 1]);
}

/** The keeper: a short loop that holds the lower band's end, a little wider and thicker than the band, a third of the way out from the case. */
function keeper(b: MeshBuilder): void {
  const path = bandPath(1).slice(3, 5);
  const a = path[0] as Vec3, c = path[1] as Vec3;
  const sections = [0, 0.5, 1].map((t, i) => ({ c: [a[0] + (c[0] - a[0]) * (0.1 + t * 0.7), a[1] + (c[1] - a[1]) * (0.1 + t * 0.7), 0] as Vec3, rx: 0.0225, ry: [0.0068, 0.0072, 0.0068][i] as number }));
  loft(b, sections, 10, STRAP, STRAP_MAT, [0, 0, 1]);
}

/** A round part stood on the face's normal: sections of (height, radius), a disc, lofted along y. */
function stack(b: MeshBuilder, levels: readonly (readonly [number, number])[], colour: Rgb, mat: MatSpec | "steel" | "painted"): void {
  loft(b, levels.map(([y, r]) => ({ c: [0, y * B, 0] as Vec3, rx: r * B, ry: r * B })), 28, colour, mat, [0, 0, 1]);
}

/** The solids of the left arm and the watch, named, each laid alone by its own call (a test holds each to being closed). */
export function watchSolids(seed = 1): readonly { readonly name: string; readonly lay: (b: MeshBuilder) => void }[] {
  const fingers = [0, 1, 2, 3].map((i) => ({
    name: `finger ${i}`,
    lay: (b: MeshBuilder) => {
      // A loosely curled finger, in line with the forearm: from its knuckle on the back of the hand it runs on, curls down and back under, the tip coming round to the palm. Close to
      // its neighbours, and a little wider across the row than it is thick, so that the four read as one soft fist and not four balls.
      const x = -0.0225 + 0.015 * i;
      const len = [1, 1.05, 1, 0.9][i] as number;
      const base = WRIST_Y + 0.006;
      const pts: Vec3[] = [
        [x, base, 0.066], [x, base - 0.002, 0.078 * len], [x, base - 0.008, 0.09 * len], [x, base - 0.018, 0.097 * len], [x, base - 0.03, 0.095 * len], [x, base - 0.04, 0.086 * len], [x, base - 0.045, 0.074 * len], [x, base - 0.046, 0.066 * len],
      ];
      const radii = [0.0112, 0.0111, 0.0108, 0.0102, 0.0096, 0.0088, 0.0074, 0.0036];
      const k = i === 3 ? 0.88 : 1;
      loft(b, pts.map((c, n) => ({ c, rx: (radii[n] as number) * k * 1.16, ry: (radii[n] as number) * k * 0.94 })), 10, LEATHER, LEATHER_MAT, [0, 0, 1]);
    },
  }));
  return [
    // The watch.
    { name: "case", lay: (b) => stack(b, [[-0.003, 0.0205], [-0.001, 0.0222], [0.002, 0.0226], [0.0045, 0.0222]], CASE, "steel") },
    { name: "glass", lay: (b) => stack(b, [[0.0045, 0.0218], [0.0058, 0.0208], [0.0066, 0.019], [0.0071, 0.0162], [0.0073, 0.0102], [0.00735, 0.0001]], GLASS, "painted") },
    { name: "screen", lay: (b) => stack(b, [[SCREEN_Y / B - 0.0001, SCREEN_RADIUS], [SCREEN_Y / B + 0.0001, SCREEN_RADIUS * 0.995]], SCREEN, "painted") },
    // The crown at three o'clock (toward the hand), and a small button beside it.
    { name: "crown", lay: (b) => frustum(b, [0, 0.0006 * B, 0.0222 * B], [0, 0.0006 * B, 0.0282 * B], 0.0036 * B, 0.0034 * B, 10, CASE, "steel", CASE, CASE) },
    { name: "button", lay: (b) => frustum(b, [-0.0112 * B, 0.0003 * B, 0.0208 * B], [-0.0112 * B, 0.0003 * B, 0.0236 * B], 0.0021 * B, 0.002 * B, 8, CASE, "steel", CASE, CASE) },
    // The strap round the wrist, under the case and the bands: brown leather, darker at its edges.
    {
      name: "strap",
      lay: (b) => loft(b, [[-0.0135, STRAP_R - 0.002], [-0.0125, STRAP_R], [0.0125, STRAP_R], [0.0135, STRAP_R - 0.002]].map(([z, r]) => ring((z as number) * B, r as number)), 24, (i) => (i === 0 || i === 3 ? STRAP_EDGE : STRAP), STRAP_MAT, [1, 0, 0]),
    },
    // The two bands, leaving the case at twelve and six o'clock: each runs out from under the case, past its edge by `BAND_OUT` (15 mm, in the watch's own size), and curves down round the
    // wrist to meet the ring under it. The strap is of the WATCH's size where it shows, 22 mm wide; the keeper is on the lower band, and a line of pale stitching runs along each edge.
    ...[-1, 1].flatMap((side) => {
      const name = side < 0 ? "upper band" : "lower band";
      return [
        { name, lay: (b: MeshBuilder) => band(b, side, (_i, j) => (j % 5 === 0 ? STRAP_EDGE : STRAP), 0.0193, 0.0035) },
        { name: `${name} stitching a`, lay: (b: MeshBuilder) => stitch(b, side, -1) },
        { name: `${name} stitching b`, lay: (b: MeshBuilder) => stitch(b, side, 1) },
      ];
    }),
    { name: "keeper", lay: (b) => keeper(b) },
    // The glove's knit cuff, under the strap, and the glove's hand: the back of it, a loose fist.
    { name: "knit cuff", lay: (b) => loft(b, [-0.05, -0.02, 0.02, 0.045].map((z, i) => ring(z, [WRIST_R + 0.0012, WRIST_R + 0.0006, WRIST_R, WRIST_R + 0.0002][i] as number)), 22, KNIT, cloth(seed), [1, 0, 0]) },
    {
      name: "back of the hand",
      lay: (b) => {
        // From the wrist (the knit cuff's own radius) out to the knuckles, rounded: the wrist end is the wrist's circle, so it flows out of the cuff with no square cut.
        const sections: Section[] = [];
        for (let k = 0; k < 7; k++) {
          const t = k / 6;
          const ease = Math.sin((Math.PI / 2) * Math.min(1, t * 1.25));
          sections.push({ c: [0, WRIST_Y + 0.004 * ease, 0.03 + 0.04 * t], rx: WRIST_R + 0.0075 * ease, ry: WRIST_R * 0.9 - (WRIST_R * 0.9 - 0.0135) * ease });
        }
        loft(b, sections, 12, LEATHER, LEATHER_MAT, [0, 1, 0]);
      },
    },
    ...fingers,
    {
      name: "thumb",
      lay: (b) => {
        // Resting along the side of the fist (+x).
        const base = WRIST_Y;
        const pts: Vec3[] = [[0.03, base + 0.002, 0.045], [0.037, base - 0.004, 0.06], [0.04, base - 0.012, 0.078], [0.037, base - 0.022, 0.09], [0.03, base - 0.03, 0.094]];
        const radii = [0.0113, 0.0109, 0.0103, 0.0095, 0.0062];
        loft(b, pts.map((c, k) => ({ c, rx: radii[k] as number, ry: radii[k] as number })), 9, LEATHER, LEATHER_MAT, [0, 1, 0]);
      },
    },
    // The coat's cuff, pushed back up the arm, and the sleeve to the elbow.
    {
      name: "cuff",
      lay: (b) => {
        // A soft folded edge, only a little wider than the sleeve: a rolled lip, then the band.
        loft(b, [[-0.058, 0.0295], [-0.0625, 0.0365], [-0.075, 0.0385], [-0.1, 0.0375]].map(([z, r]) => ring(z as number, r as number)), 18, COAT_CUFF, cloth(seed), [1, 0, 0]);
        loft(b, [[-0.0615, 0.0335], [-0.0665, 0.0405], [-0.072, 0.0365]].map(([z, r]) => ring(z as number, r as number)), 18, COAT_EDGE, cloth(seed), [1, 0, 0]);
      },
    },
    { name: "sleeve", lay: (b) => loft(b, [-0.1, -0.22, -0.38, -0.55, -0.72].map((z, i) => ring(z, 0.0355 + 0.0035 * i)), 18, COAT, cloth(seed), [1, 0, 0]) },
  ];
}

/** The whole left arm and watch. */
export function watchGeometry(b: MeshBuilder, seed = 1): void {
  for (const s of watchSolids(seed)) s.lay(b);
}
