/**
 * The town's accent colours: the few colours a cold, wet working port spends on about a tenth of the picture (signs, doors, awnings, shopfront
 * paint, a few vehicles) while everything else stays quiet. Three families, each a faded paint, never a fresh primary.
 *
 * Where the values come from: a cannery red, an ochre and a harbour blue, taken down in saturation to what sun and salt leave of house
 * paint: each is displayed (sRGB) at an
 * HSV saturation of about 0.55 or less, and `accentOf` only ever fades it further and moves its hue a few degrees. Linear base colours, like `palette.ts`.
 *
 * Which things carry one is rolled from the thing's own id and never from a random call: `ACCENT_SHARE` of the eligible things do, and the family
 * is the block's own (`ACCENT_BLOCK_LOYALTY` of the time) so that one family leads a block rather than all three showing everywhere.
 */
import { hash01, greyed, scaled, type Rgb } from "./meshBuilder.js";

/** Faded red: sun-bleached barn and cannery paint (display about #8E4A40). */
export const ACCENT_FADED_RED: Rgb = [0.27, 0.069, 0.051];
/** Mustard: old ochre trim and a tenant's door (display about #B39A4E). */
export const ACCENT_MUSTARD: Rgb = [0.45, 0.323, 0.077];
/** Harbour blue: salt-dulled slate blue (display about #3F6A85). */
export const ACCENT_HARBOUR_BLUE: Rgb = [0.05, 0.144, 0.235];

export const ACCENT_FAMILIES: readonly Rgb[] = [ACCENT_FADED_RED, ACCENT_MUSTARD, ACCENT_HARBOUR_BLUE];

/** The share of eligible things (a door, a sign, an awning, a bulkhead, a vehicle) that carries an accent. */
export const ACCENT_SHARE = 0.28;
/** How often a thing takes its block's family rather than one of its own. */
export const ACCENT_BLOCK_LOYALTY = 0.75;
/** The most a fresh accent is faded toward its own grey, and the least. */
export const ACCENT_FADE_MIN = 0.1;
export const ACCENT_FADE_MAX = 0.35;
/** How far toward grey the existing saturated colours (canvas, sign grounds) are taken. */
export const QUIET_FADE = 0.45;
/** The bound `accentOf` keeps to: the HSV saturation of its displayed (sRGB) colour never exceeds this. */
export const ACCENT_MAX_SATURATION = 0.6;

/** The family index a block favours. */
export function blockFamily(block: number): number {
  return Math.floor(hash01(block, 901) * ACCENT_FAMILIES.length) % ACCENT_FAMILIES.length;
}

/**
 * The accent of the thing `id` (any integer of its own) on block `block`, or null where it carries none. `salt` keeps the doors, signs and
 * awnings of one building from all rolling together. Faded by its own amount, a little off in value and hue.
 */
export function accentOf(block: number, id: number, salt: number): Rgb | null {
  const family = accentFamily(block, id, salt);
  if (family < 0) return null;
  const base = ACCENT_FAMILIES[family] as Rgb;
  const fade = ACCENT_FADE_MIN + hash01(id, 940 + salt) * (ACCENT_FADE_MAX - ACCENT_FADE_MIN);
  const value = 0.8 + hash01(id, 950 + salt) * 0.35;
  const tint = (hash01(id, 960 + salt) - 0.5) * 0.1;
  const c = greyed(base, fade);
  return scaled([c[0] * (1 + tint), c[1], c[2] * (1 - tint)], value);
}

/** Which family (an index of `ACCENT_FAMILIES`) the thing carries, or -1 for none. */
export function accentFamily(block: number, id: number, salt: number): number {
  if (hash01(id, 910 + salt) >= ACCENT_SHARE) return -1;
  return hash01(id, 920 + salt) < ACCENT_BLOCK_LOYALTY ? blockFamily(block) : Math.floor(hash01(id, 930 + salt) * ACCENT_FAMILIES.length) % ACCENT_FAMILIES.length;
}

/** The block a building stands on (its lot's), or its own id where it stands on none (a pier). */
export function blockOfLot(lots: readonly { readonly block: number }[], lot: number, fallback: number): number {
  return lots[lot]?.block ?? fallback;
}

/** An sRGB-encoded channel of a linear one, 0 to 1. */
function display(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** The HSV saturation of a linear colour as it displays: what the "faded" bound is measured in. */
export function displaySaturation(c: Rgb): number {
  const d = [display(c[0]), display(c[1]), display(c[2])];
  const hi = Math.max(...d);
  return hi <= 0 ? 0 : (hi - Math.min(...d)) / hi;
}

type Rgb255 = readonly [number, number, number];
type SignColours = { bg: Rgb255; fg: Rgb255; accent: Rgb255 };

/** The signs that carry a ground of paint or board, where an accent may be the whole ground. */
const GROUNDED = new Set(["fascia", "blade", "banner", "board"]);
/** The signs left as they are: a lit OPEN sign, a lease sign, a gas price pole and a sandwich board are meant to read. */
const KEPT = new Set(["open", "lease", "pole", "sandwich"]);

function toDisplay255(c: Rgb): Rgb255 {
  return [Math.round(display(c[0]) * 255), Math.round(display(c[1]) * 255), Math.round(display(c[2]) * 255)];
}

function faded255(c: Rgb255, k: number): Rgb255 {
  const g = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [Math.round(c[0] + (g - c[0]) * k), Math.round(c[1] + (g - c[1]) * k), Math.round(c[2] + (g - c[2]) * k)];
}

/**
 * A sign's colours as the town sets them: the table's colours faded toward grey (`QUIET_FADE`), and on `ACCENT_SHARE` of the signs with a ground
 * the block's accent as that ground, with lettering of cream or near-black, whichever reads on it.
 */
export function signColours(base: SignColours, kind: string, block: number, seed: number): SignColours {
  if (KEPT.has(kind)) return base;
  const quiet = { bg: faded255(base.bg, QUIET_FADE), fg: faded255(base.fg, QUIET_FADE), accent: faded255(base.accent, QUIET_FADE) };
  if (!GROUNDED.has(kind)) return quiet;
  const a = accentOf(block, seed, 600);
  if (a === null) return quiet;
  const bg = toDisplay255(a);
  const light = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] > 0.18;
  return { bg, fg: light ? [38, 34, 30] : [232, 226, 205], accent: quiet.accent };
}
