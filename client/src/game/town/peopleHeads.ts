/**
 * Whose head a person has. A body's model carries several heads (each a primitive of its own, `head.<id>`, drawn only for the bodies that wear
 * it: `peopleParts.ts`), and a person wears one of them for good: the same head every time they are drawn, on every screen, by their key alone.
 *
 * **The town's mix of people is in how often each head is worn.** A head is a person of a sex, an age and a background (the manifest's `heads`),
 * and the weights here make the people drawn follow the adults of the small ports of the Pacific Northwest coast (the 2020 to 2024 American
 * Community Survey, sixteen port towns, weighted by their people): `GROUP_SHARE` by background and `AGE_BANDS` by age. Nothing recolours a face
 * to make the numbers: a look (`peopleLook.ts`) leaves the skin as the head's picture has it, and the hair too (a head has the hair of its
 * person's age); the body's hands are drawn the head's skin.
 *
 * - **By background.** A background's share is split between the sexes as the bodies are (`sexShare`) where both have a head of it, and is given
 *   whole to the one sex that has one where the other has none, so that the share of all the people drawn is still the survey's. The few in a
 *   hundred the survey counts as of two or more backgrounds have no head of their own and fall to the others in proportion.
 * - **By age.** Among the heads of one background and sex, each stands for the ages nearest its own: the adult ages are cut halfway between one
 *   head's age and the next, and a head's weight is the share of adults in its cut.
 */
import manifest from "../../../assets/models/people.json" with { type: "json" };
import { chance } from "./peopleReact.js";

export type HeadGroup = "white" | "hispanic" | "native" | "asian" | "black";
export type HeadSex = "f" | "m";
/** A head as the manifest gives it: who the person is. */
export type HeadSpec = { readonly id: string; readonly sex: HeadSex; readonly group: HeadGroup; readonly age: number };

/** The adults of the ports by background, of all adults (the rest, 0.059, are of two or more backgrounds or another). */
export const GROUP_SHARE: { readonly [G in HeadGroup]: number } = { white: 0.82, hispanic: 0.088, native: 0.013, asian: 0.013, black: 0.007 };
/** The adults by age: each band's first year and its share of all adults. The last band ends at `AGE_TOP`. */
export const AGE_BANDS: readonly { readonly from: number; readonly share: number }[] = [
  { from: 18, share: 0.091 }, { from: 25, share: 0.302 }, { from: 45, share: 0.295 }, { from: 65, share: 0.312 },
];
export const AGE_TOP = 90;

/** The share of adults aged from `a` to `b`, people of a band taken as spread evenly over its years. */
export function ageShare(a: number, b: number): number {
  let sum = 0;
  for (const [i, band] of AGE_BANDS.entries()) {
    const to = AGE_BANDS[i + 1]?.from ?? AGE_TOP;
    const lo = Math.max(a, band.from);
    const hi = Math.min(b, to);
    if (hi > lo) sum += (band.share * (hi - lo)) / (to - band.from);
  }
  return sum;
}

/**
 * How often each of `worn` (the heads one body carries) is worn, summing to 1, in `worn`'s order. `all` is every head there is, of both sexes,
 * which decides how a background's share is split between the sexes; `sexShare` is how many of the people drawn are of the body's sex.
 */
export function headWeights(worn: readonly HeadSpec[], all: readonly HeadSpec[], sexShare: number): number[] {
  const raw = worn.map((head) => {
    const both = all.some((h) => h.group === head.group && h.sex !== head.sex);
    // Of this sex, the part that is of this background.
    const group = (GROUP_SHARE[head.group] * (both ? sexShare : 1)) / Math.max(sexShare, 1e-6);
    // Of those, the part nearest this head's age.
    const ages = worn.filter((h) => h.group === head.group).map((h) => h.age).sort((p, q) => p - q);
    const at = ages.indexOf(head.age);
    const same = ages.filter((v) => v === head.age).length;
    const from = at === 0 ? AGE_BANDS[0]?.from ?? 18 : ((ages[at - 1] as number) + head.age) / 2;
    const last = ages.lastIndexOf(head.age);
    const to = last === ages.length - 1 ? AGE_TOP : (head.age + (ages[last + 1] as number)) / 2;
    return (group * ageShare(from, to)) / same;
  });
  const total = raw.reduce((sum, v) => sum + v, 0);
  return raw.map((v) => (total > 0 ? v / total : 1 / Math.max(1, worn.length)));
}

/** Which of the weighted heads the person with this key wears: the same for the same key. -1 where there are none. */
export function headFor(key: number, weights: readonly number[]): number {
  if (weights.length === 0) return -1;
  let draw = chance(key + 0.5, 45);
  for (const [i, w] of weights.entries()) {
    draw -= w;
    if (draw < 0) return i;
  }
  return weights.length - 1;
}

type Region = { readonly mean: readonly number[] };
type HeadEntry = HeadSpec & { readonly look?: { readonly regions: { readonly skin: Region; readonly hair: Region } } };
type BodyEntry = { readonly id: string; readonly sex?: string; readonly heads?: readonly string[] };
const bodies = manifest.people as readonly BodyEntry[];
const heads = ((manifest as { heads?: readonly HeadEntry[] }).heads ?? []) as readonly HeadEntry[];

/** A head worn on a body: who it is, the regions of its picture, and how often it is worn there. */
export type WornHead = { readonly spec: HeadSpec; readonly regions: { readonly skin: Region; readonly hair: Region } | null; readonly weight: number };

/** The heads a model's manifest says it carries, with their weights; none for a model that is a whole person (its head is its own). */
export function headsOf(model: string): readonly WornHead[] {
  const body = bodies.find((p) => p.id === model);
  const worn = (body?.heads ?? []).map((id) => heads.find((h) => h.id === id)).filter((h): h is HeadEntry => h !== undefined);
  if (worn.length === 0) return [];
  const sexed = bodies.filter((p) => p.sex === "f" || p.sex === "m");
  const share = sexed.length === 0 ? 0.5 : sexed.filter((p) => p.sex === body?.sex).length / sexed.length;
  const weights = headWeights(worn, heads, share);
  return worn.map((h, i) => ({ spec: h, regions: h.look?.regions ?? null, weight: weights[i] as number }));
}

/** The name of a head's primitive in a model's file (its material's), and the id of the head a primitive of that name is; null for any other. */
export const HEAD_PREFIX = "head.";
export function headIdOf(partName: string): string | null {
  return partName.startsWith(HEAD_PREFIX) ? partName.slice(HEAD_PREFIX.length) : null;
}
