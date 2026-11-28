/**
 * The dive the people's models hold, as their manifest says it (`assets/models/people.json`): the `dive` clip's length and how far along its way
 * a body has gone at each thirtieth of a second of it. The clip stays over the model's origin; whoever plays it moves the body by these distances
 * (`peopleReact.ts`), so the manifest's numbers and the clip's feet are one thing made together. Null where the models hold no dive.
 */
import manifest from "../../../assets/models/people.json" with { type: "json" };
import type { DiveSpec } from "./peopleReact.js";

type DiveEntry = { readonly seconds: number; readonly stored?: number; readonly travel_m: readonly number[] };
type Entry = { readonly id: string; readonly dive?: DiveEntry };

const entries = manifest.people as readonly Entry[];

/** The one dive every model holds (the files are made with the same distances), or null. */
export const DIVE: DiveSpec | null = (() => {
  const e = entries.find((p) => p.dive !== undefined)?.dive;
  return e !== undefined && e.seconds > 0 && e.travel_m.length >= 2 ? { seconds: e.seconds, travel: e.travel_m } : null;
})();

/** Seconds of a model's `dive` clip, as its file stores it, to a second of the dive: 1 where the file holds it at its own speed. */
export function diveStored(id: string): number {
  const stored = entries.find((p) => p.id === id)?.dive?.stored;
  return stored !== undefined && stored > 0 ? stored : 1;
}
