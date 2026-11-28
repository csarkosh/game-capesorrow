/**
 * The evening in a town's homes: which windows are lit, when, and in what light; and the porch light by a front door. Pure: no engine.
 *
 * By day no home's window glows from within (a lamp on at noon cannot be seen). In the evening each occupied home lights some of its
 * curtained and blinded windows, warm (most a warm white, a few cooler, now and then the blue of a television), each with its own night
 * code (`hours.ts`) from a hash of the building and the window: on between half an hour before dusk and two hours after, off between
 * about 21:00 and 01:00 (the household goes to bed), a few windows all night. The household decides how many: an old couple one
 * window, a family most of them; the window of the room a household lives in faces the street. A vacant, boarded or ruined house lights
 * none. A window the plan already calls lit is among the lit ones.
 *
 * A window that is not lit has the code `NEVER_CODE`: a pair whose off is before its on, which `nightShare` reads as dark at every hour,
 * so that its curtain or blind has no glow of its own at any hour (an unlit window would otherwise glow at night, as the exposure
 * follows the sky into the dark).
 */
import type { Building, BuildingUse, WindowTreatment } from "../../sim/town/types.js";
import { ON_STEPS, UNTIL_DAWN, nightCode } from "./hours.js";
import { hash01, type Rgb } from "./meshBuilder.js";

/** The code of a window that is never lit. */
export const NEVER_CODE = nightCode(ON_STEPS - 1, 0);

/** The kinds of building people live in (the plan's `Building.kind`). Offices' and shops' upper windows are no home's. */
const HOME_KINDS: readonly Building["kind"][] = ["house", "apartment", "boarding house", "motel", "hotel"];

/** Whether people live here now: a home that is open (a vacant or ruined one has nobody to light a window). */
export function isHome(b: Building): boolean {
  return b.state === "open" && HOME_KINDS.includes(b.kind);
}

/** The step of the first light of the evening a home's window may have, up to about two hours after dusk (half an hour before it is step 0). */
const ON_SPREAD = 30;
/** A household's bedtime is one of the quarter hours from 21:00 (step 4) to 01:00 (step 20). */
const BED_FIRST = 4;
const BED_STEPS = 17;

/** What a window's glass is told of the night: the code of its own light, or `NEVER_CODE`. */
export type WindowWindow = { readonly wall: "front" | "left" | "right"; readonly state: WindowTreatment };

/** The household's bedtime step in `hours.ts`'s off-steps (21:00 up to 01:00). */
export function bedStep(id: number): number {
  return BED_FIRST + Math.floor(hash01(id, 705) * BED_STEPS);
}

/**
 * The night code of each window of a home `id`, in order: the household decides how many are lit (an old couple one, a family most) and the
 * room they live in is on the street side; a window the plan calls lit is always among them. Windows that are no curtain's or blind's
 * (dark, boarded, broken) are never lit, except that a home none of whose street windows are lit takes its first dark one.
 */
export function windowCodes(id: number, ws: readonly WindowWindow[]): number[] {
  const eligible = ws.map((w) => w.state === "curtained" || w.state === "blinds" || w.state === "lit");
  const front = ws.map((w, i) => (w.wall === "front" && eligible[i] === true ? i : -1)).filter((i) => i >= 0);
  const pool = front.length > 0 ? front : ws.map((_, i) => (eligible[i] === true ? i : -1)).filter((i) => i >= 0);
  // The living window: a street window if there is one (and, failing any, a dark street window is a curtained one).
  let living = pool.length > 0 ? (pool[Math.floor(hash01(id, 700) * pool.length) % pool.length] as number) : -1;
  if (living < 0) living = ws.findIndex((w) => w.wall === "front" && w.state === "dark");
  const h = hash01(id, 701);
  const share = h < 0.3 ? 0 : h < 0.65 ? 0.45 : 0.8;
  return ws.map((w, i) => {
    const lit = i === living || w.state === "lit" || (eligible[i] === true && share > 0 && hash01(id * 31 + i, 702) < share);
    return lit ? litCode(id, i) : NEVER_CODE;
  });
}

/** The code of window `i` of household `id` once it is lit: its own time on, and off about the household's bedtime (a few all night: a sleeper's lamp, a television left on). */
function litCode(id: number, i: number): number {
  const on = Math.floor(hash01(id * 31 + i, 703) * ON_SPREAD);
  const off = hash01(id * 31 + i, 704) < 0.06 ? UNTIL_DAWN : Math.max(BED_FIRST, Math.min(BED_FIRST + BED_STEPS - 1, bedStep(id) + Math.floor(hash01(id * 31 + i, 706) * 5) - 2));
  return nightCode(on, off);
}

/**
 * The code of a window of a home that is not one of its drawn list (a side wall's window of an apartment house or a motel): lit by the household's share of its windows,
 * where the plan calls it lit or by its own hash, and never where nobody lives.
 */
export function looseWindowCode(b: Building, k: number, state: WindowTreatment): number {
  if (!isHome(b) || !(state === "curtained" || state === "blinds" || state === "lit")) return NEVER_CODE;
  const h = hash01(b.id, 701);
  const share = h < 0.3 ? 0.25 : h < 0.65 ? 0.45 : 0.8;
  return state === "lit" || hash01(b.id * 31 + k, 702) < share ? litCode(b.id, k) : NEVER_CODE;
}

/** The top of `windowLight`'s glow: a night-coded surface with a glow above 0 and at most this is a lit window (`shaders/townWindowLight.wgsl`); every lens and porch light glows more. */
export const WINDOW_GLOW_MAX = 0.75;

/** The colour and strength of a lit window's light: most a warm white, a few cooler, one now and then the blue of a television. */
export function windowLight(id: number, k: number): { colour: Rgb; glow: number } {
  const r = hash01(id * 17 + k, 707);
  const colour: Rgb = r < 0.07 ? [0.5, 0.64, 1] : r < 0.27 ? [0.88, 0.94, 1] : [1, 0.82, 0.55];
  return { colour, glow: 0.35 + 0.4 * hash01(id * 17 + k, 708) };
}

/** Whether a home has a porch of its own (a deck, posts and a roof of its own at the door: `buildingParts.ts`), which a wall light by the door would stand inside. */
export function hasPorch(b: Building): boolean {
  return b.era >= 1900 && b.era < 1950 && hash01(b.id, 501) < 0.6;
}

/** A home's porch light by its front door: nearly every home that has no porch of its own has one (a home with a porch has none: the light would stand inside it), about half of all homes; from dusk until the household's bedtime, a few all night. Null for a home with none. */
export function porchCode(b: Building, use: BuildingUse | undefined): { code: number; side: 1 | -1 } | null {
  if (!isHome(b) || hash01(b.id, 710) >= 0.95 || use === undefined || use.door === null || hasPorch(b)) return null;
  // Not where a sign of the building hangs by the door (the light would lie in the sign's own plane).
  const door = use.door;
  if (use.signs.some((q) => q.place.wall === "front" && Math.abs(q.place.s - door.s) < 2.5)) return null;
  const off = hash01(b.id, 711) < 0.12 ? UNTIL_DAWN : bedStep(b.id);
  return { code: nightCode(6 + Math.floor(hash01(b.id, 712) * 8), off), side: hash01(b.id, 713) < 0.5 ? 1 : -1 };
}

/** How far from the door's edge the porch light stands along the wall, how high above the floor its lens is, and how far it stands out, metres. */
/** The glow of a porch light's lens (1 or more: a lens, dull grey glass by day; `townMaterial.ts`). */
export const PORCH_GLOW = 1.3;
export const PORCH = { beside: 0.32, height: 1.95, out: 0.12, range: 5, strength: 0.5, colour: [1, 0.78, 0.45] as Rgb };
