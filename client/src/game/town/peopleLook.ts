/**
 * Each person's own look, on a few models: the colours of what they wear, their hair and their skin, and how broad they are. A model costs memory
 * (its clip table, its pictures, its mesh); a look costs sixteen floats for a body drawn, so a town can have hundreds of people no two of whom
 * look alike on five or six models.
 *
 * - **The regions are in the picture.** A model's base-colour picture says, in its alpha (which nothing else uses: the bodies are opaque), what each
 *   texel is: `alpha * 5` is 0 for a shoe, 1 for what is worn on the legs, 2 for what is worn on the body and arms, 3 for skin, 4 for hair and 5 for
 *   what is never recoloured. The order is the order they meet on a body, so where the picture's filtering blends two neighbours the colours blend
 *   too and no third region shows between them. The manifest (`people.json`, `look.regions`) gives each region's mean colour in the picture.
 * - **A region is recoloured by its light and dark.** The colour drawn is the look's colour for the region times the texel's luminance over the
 *   region's mean luminance: the folds, seams and wear of the cloth stay, and its colour is the look's. A texel brighter than its region's mean is
 *   taken less than in proportion (`LOOK_SOFT`, to 1.8 times at the most): a highlight in dark hair made fair, or a white shirt beside a black
 *   waistcoat, would otherwise burn out. Each body carries one over each region's mean (`writeLook`), so one shader serves every model. Skin is
 *   multiplied by a tone and is otherwise the picture's own.
 * - **A look is a function of who the person is** (`lookOf`: their key, and what their model's manifest says of the person the model is): colours
 *   from tables of what people of a wet northern port wear, each moved a little in lightness and warmth by the person's own draws, so two with the
 *   same jacket colour from the table are still not the same. Nothing is kept: the same person has the same look every time they are drawn, on
 *   every screen.
 * - **A look does not change who a model is.** A model is a person of an age and a background, and the town's mix of people is in which models
 *   there are and how often each is drawn, not in recolouring one face: the skin keeps the picture's tone but for a few parts in a hundred, hair
 *   is grey or white as often as it is at the model's age (`GREY_AT`), and a model whose manifest says its hair is dark is never made fair.
 *
 * The floats ride to the shader as an instance attribute of the body's mesh (`LOOK_ATTRIBUTES`; `peopleParts.ts` writes them beside the body's
 * matrix). A model whose manifest has no `look` is drawn as its picture is, with no plugin.
 */
import type { MaterialPlugin } from "@babylonjs/lite";
import manifest from "../../../assets/models/people.json" with { type: "json" };
import { chance } from "./peopleReact.js";

/**
 * Floats of a body's look: five of four. The colour worn on the body and the skin's red; on the legs and the skin's green; the shoes and the skin's
 * blue; the hair and a spare; and one over the mean luminance of the body's cloth, the legs', the shoes' and the hair in the model's picture.
 */
export const LOOK_FLOATS = 20;

type Rgb = readonly [number, number, number];
export type Look = {
  /** The colours, sRGB 0 to 1: what is worn on the body, on the legs, the shoes, the hair. */
  readonly top: Rgb; readonly bottoms: Rgb; readonly shoes: Rgb; readonly hair: Rgb;
  /** What the skin's colour is multiplied by. */
  readonly skin: Rgb;
  /** How broad the body is drawn, of the model's own breadth. */
  readonly wide: number;
};

/** What is worn on the body: rain shells, puffers, fleeces and hoodies of a working port. */
export const TOPS: readonly Rgb[] = [
  [0.78, 0.6, 0.12], [0.12, 0.2, 0.36], [0.2, 0.3, 0.18], [0.62, 0.14, 0.12], [0.1, 0.1, 0.11], [0.42, 0.44, 0.46], [0.1, 0.36, 0.38], [0.4, 0.12, 0.2],
  [0.6, 0.5, 0.36], [0.82, 0.4, 0.1], [0.24, 0.28, 0.42], [0.3, 0.2, 0.14], [0.74, 0.74, 0.7], [0.36, 0.4, 0.26], [0.16, 0.42, 0.62], [0.5, 0.32, 0.5],
];
/** On the legs: denim, canvas, work trousers, leggings. */
export const BOTTOMS: readonly Rgb[] = [
  [0.16, 0.24, 0.4], [0.24, 0.34, 0.5], [0.1, 0.13, 0.2], [0.08, 0.08, 0.09], [0.24, 0.24, 0.26], [0.46, 0.4, 0.3], [0.3, 0.3, 0.2], [0.34, 0.24, 0.16],
];
/** Shoes and boots. */
export const SHOES: readonly Rgb[] = [[0.3, 0.3, 0.31], [0.07, 0.07, 0.07], [0.3, 0.2, 0.12], [0.62, 0.6, 0.56], [0.2, 0.24, 0.3], [0.36, 0.3, 0.2]];
/** Hair, from black to white. */
export const HAIR: readonly Rgb[] = [
  [0.05, 0.045, 0.04], [0.14, 0.09, 0.06], [0.26, 0.17, 0.1], [0.4, 0.22, 0.12], [0.62, 0.48, 0.28], [0.46, 0.44, 0.42], [0.78, 0.77, 0.74], [0.34, 0.12, 0.07],
];
/** The hair that is not grey: any of it, and the dark of it; and the grey and the white. */
const HAIR_ANY: readonly number[] = [0, 1, 1, 2, 2, 3, 4, 7];
const HAIR_DARK: readonly number[] = [0, 0, 1];
const HAIR_GREY: readonly number[] = [5, 6];
/** What a model's manifest says of the person it is: about how old (under 45, 45 to 64, 65 and over), and whether their hair is only ever dark. */
export type LookTraits = { readonly age: "young" | "middle" | "old"; readonly hair: "any" | "dark" };
export const TRAITS: LookTraits = { age: "young", hair: "any" };
/** How many of an age have grey or white hair. */
export const GREY_AT: { readonly [A in LookTraits["age"]]: number } = { young: 0.03, middle: 0.4, old: 0.88 };
/** How far the skin's tone is moved from the picture's own, each way: a person is a little paler or ruddier than the next, and no other person. */
export const SKIN_VARIES = 0.05;
/** How far a colour is moved in lightness (of itself, each way) and in warmth by a person's own draws, and how much broader or narrower a body is. */
export const LOOK_LIGHT = 0.16, LOOK_WARM = 0.06, LOOK_WIDE = 0.06;

/** A region's mean colour in a model's picture, sRGB 0 to 1. */
type Region = { readonly mean: readonly number[] };
/** The regions a picture has, by name: a body with a head of its own has all five, a body that wears a head has no hair, and a head has skin and hair. */
export type LookRegions = { readonly shoes?: Region; readonly bottoms?: Region; readonly top?: Region; readonly skin?: Region; readonly hair?: Region };
type LookEntry = {
  readonly regions: LookRegions;
  readonly age?: string;
  readonly hair?: string;
};
type Entry = { readonly id: string; readonly look?: LookEntry };
const entries = manifest.people as readonly Entry[];

/** The regions of a model's picture as its manifest gives them, or null for a model with none. */
export function lookRegions(id: string): LookEntry["regions"] | null {
  return entries.find((p) => p.id === id)?.look?.regions ?? null;
}

/** What a model's manifest says of the person it is; a young person with hair of any colour where it says nothing. */
export function lookTraits(id: string): LookTraits {
  const look = entries.find((p) => p.id === id)?.look;
  return { age: look?.age === "middle" || look?.age === "old" ? look.age : "young", hair: look?.hair === "dark" ? "dark" : "any" };
}

const pick = <T>(table: readonly T[], draw: number): T => table[Math.min(table.length - 1, Math.floor(draw * table.length))] as T;

/** A table's colour moved by two draws: lighter or darker by `LOOK_LIGHT` of itself, and warmer or cooler by `LOOK_WARM`. */
function varied(c: Rgb, light: number, warm: number): Rgb {
  const k = 1 + (light * 2 - 1) * LOOK_LIGHT;
  const w = (warm * 2 - 1) * LOOK_WARM;
  return [Math.min(1, Math.max(0, c[0] * k * (1 + w))), Math.min(1, Math.max(0, c[1] * k)), Math.min(1, Math.max(0, c[2] * k * (1 - w)))];
}

/** The look of the person with this key, on a model of these traits: the same for the same key, and by its draws alone. */
export function lookOf(key: number, traits: LookTraits = TRAITS): Look {
  const d = (salt: number): number => chance(key + 0.5, salt);
  const grey = d(41) < GREY_AT[traits.age];
  const hairs = grey ? HAIR_GREY : traits.hair === "dark" ? HAIR_DARK : HAIR_ANY;
  const tone = 1 + (d(43) * 2 - 1) * SKIN_VARIES;
  const ruddy = (d(44) * 2 - 1) * SKIN_VARIES * 0.6;
  return {
    top: varied(pick(TOPS, d(31)), d(32), d(33)),
    bottoms: varied(pick(BOTTOMS, d(34)), d(35), d(36)),
    shoes: varied(pick(SHOES, d(37)), d(38), 0.5),
    hair: varied(HAIR[pick(hairs, d(39))] as Rgb, d(40), 0.5),
    skin: [tone * (1 + ruddy), tone, tone * (1 - ruddy)],
    wide: 1 + (d(42) * 2 - 1) * LOOK_WIDE,
  };
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: readonly number[]): number => 0.2126 * linear(c[0] ?? 0) + 0.7152 * linear(c[1] ?? 0) + 0.0722 * linear(c[2] ?? 0);
/** The least a region's mean luminance is taken to be (dark hair is about 0.01, and may be made fair): a region the picture has all but black is not multiplied without end. */
export const MEAN_LEAST = 0.004;

/** The least a skin's mean is taken to be in a channel, linear, where one skin is matched to another. */
export const SKIN_LEAST = 0.01;
/** A region the picture does not have: its mean is white, so nothing of it is ever multiplied up. */
const NO_REGION: readonly number[] = [1, 1, 1];

/**
 * Writes a look at `index` of `out` for a picture with these regions: each region's colour, linear, with the skin's tone beside them, and one
 * over each region's mean luminance in the picture. `skinOf` is the skin the picture's own is to be drawn as (a body that wears a head has its
 * hands the head's skin: the tone is multiplied by the one mean over the other, channel by channel); left out, the skin is the picture's own.
 */
export function writeLook(out: Float32Array, index: number, look: Look, regions: LookRegions, skinOf?: readonly number[]): void {
  const at = index * LOOK_FLOATS;
  const own = regions.skin?.mean;
  const tone = (c: 0 | 1 | 2): number =>
    skinOf === undefined || own === undefined ? look.skin[c] : (look.skin[c] * linear(skinOf[c] ?? 0)) / Math.max(SKIN_LEAST, linear(own[c] ?? 0));
  const put = (slot: number, colour: Rgb, mean: readonly number[], extra: number): void => {
    out[at + slot * 4] = linear(colour[0]);
    out[at + slot * 4 + 1] = linear(colour[1]);
    out[at + slot * 4 + 2] = linear(colour[2]);
    out[at + slot * 4 + 3] = extra;
    out[at + 16 + slot] = 1 / Math.max(MEAN_LEAST, luminance(mean));
  };
  put(0, look.top, regions.top?.mean ?? NO_REGION, tone(0));
  put(1, look.bottoms, regions.bottoms?.mean ?? NO_REGION, tone(1));
  put(2, look.shoes, regions.shoes?.mean ?? NO_REGION, tone(2));
  put(3, look.hair, regions.hair?.mean ?? NO_REGION, 1);
}

/** Makes a body written at `index` of `matrices` broader or narrower: its own x and z axes (across and through it), not its height. */
export function widen(matrices: Float32Array, index: number, wide: number): void {
  const at = index * 16;
  for (const col of [0, 8]) {
    matrices[at + col] = (matrices[at + col] as number) * wide;
    matrices[at + col + 1] = (matrices[at + col + 1] as number) * wide;
    matrices[at + col + 2] = (matrices[at + col + 2] as number) * wide;
  }
}

export const LOOK_ATTRIBUTES = [
  { name: "lookA", type: "vec4<f32>", format: "float32x4" as const, stride: LOOK_FLOATS * 4, offset: 0 },
  { name: "lookB", type: "vec4<f32>", format: "float32x4" as const, stride: LOOK_FLOATS * 4, offset: 16 },
  { name: "lookC", type: "vec4<f32>", format: "float32x4" as const, stride: LOOK_FLOATS * 4, offset: 32 },
  { name: "lookD", type: "vec4<f32>", format: "float32x4" as const, stride: LOOK_FLOATS * 4, offset: 48 },
  { name: "lookE", type: "vec4<f32>", format: "float32x4" as const, stride: LOOK_FLOATS * 4, offset: 64 },
];

/** How a texel's luminance over its region's mean is taken: as it is up to the mean, and beyond it less than in proportion, toward `1 + LOOK_OVER`. */
export const LOOK_OVER = 0.8, LOOK_EASE = 0.9;
export function lookSoft(ratio: number): number {
  return ratio <= 1 ? ratio : 1 + LOOK_OVER * (1 - Math.exp(-(ratio - 1) * LOOK_EASE));
}
/** The same in the shader's own language. */
export const LOOK_SOFT = `fn plSoft(r:f32)->f32{return select(1.0+${LOOK_OVER.toFixed(2)}*(1.0-exp(-(r-1.0)*${LOOK_EASE.toFixed(2)})),r,r<=1.0);}`;

/**
 * The fragment's code. The region is the picture's alpha times five; a texel takes of each region what a tent about its number gives (all of it at
 * the number, none a whole region away), so a texel the filtering left between two regions is drawn between their colours. What is left over is
 * the picture's own colour (what is never recoloured, and any model with no regions: its alpha is 1, which is 5).
 */
export const LOOK_CODE = [
  "{",
  "let plR=baseColorSample.a*5.0;",
  "let plL=dot(baseColor,vec3<f32>(0.2126,0.7152,0.0722));",
  "let plShoe=clamp(1.0-abs(plR),0.0,1.0);",
  "let plLegs=clamp(1.0-abs(plR-1.0),0.0,1.0);",
  "let plTop=clamp(1.0-abs(plR-2.0),0.0,1.0);",
  "let plSkin=clamp(1.0-abs(plR-3.0),0.0,1.0);",
  "let plHair=clamp(1.0-abs(plR-4.0),0.0,1.0);",
  "let plOwn=clamp(1.0-plShoe-plLegs-plTop-plSkin-plHair,0.0,1.0);",
  "let plTone=vec3<f32>(input.vLookA.w,input.vLookB.w,input.vLookC.w);",
  "let plM=input.vLookE*plL;",
  "baseColor=min(vec3<f32>(1.0),baseColor*plOwn+baseColor*plTone*plSkin+input.vLookA.rgb*(plTop*plSoft(plM.x))+input.vLookB.rgb*(plLegs*plSoft(plM.y))+input.vLookC.rgb*(plShoe*plSoft(plM.z))+input.vLookD.rgb*(plHair*plSoft(plM.w)));",
  "alpha=1.0;",
  "}",
].join("");

/** The plugin. Its priority is under the lamps' (200), so the lamps light the look's colours and not the picture's. */
export function peopleLookPlugin(): MaterialPlugin {
  return {
    name: "PeopleLook",
    priority: 100,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_DEFINITIONS: LOOK_SOFT, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: LOOK_CODE }
        : { CUSTOM_VERTEX_MAIN_END: "out.vLookA=lookA;out.vLookB=lookB;out.vLookC=lookC;out.vLookD=lookD;out.vLookE=lookE;" },
    getInstanceAttributes: () => LOOK_ATTRIBUTES,
    getVaryings: () => [{ name: "vLookA", type: "vec4<f32>" }, { name: "vLookB", type: "vec4<f32>" }, { name: "vLookC", type: "vec4<f32>" }, { name: "vLookD", type: "vec4<f32>" }, { name: "vLookE", type: "vec4<f32>" }],
  };
}
