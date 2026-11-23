/**
 * Wear that follows its cause, laid on a building's walls and roofs by where each part stands (which way it faces, how high it is) and by the
 * building's own history (its age, whether it is kept up, vacant or a ruin). The first pass put moss on walls as round dark patches; this replaces
 * it. The material (`townMaterial.ts`) lays two wears on a surface, each an amount and a kind, in patches or in streaks down the surface; this file
 * says how much of which, and where.
 *
 * What the weather does here (authored, not researched; the weather comes off the sea from the south-west and the rain runs down walls):
 * - **A wall's foot** is splashed with dirt (grime, to about 1.6 m) and, on the shaded side, green with a film of algae to about 2.6 m. The foot is its own band of the
 *   wall (`FOOT`), so the two bands carry different kinds.
 * - **Above the foot**, a painted wooden wall fails where the weather hits it: bare, peeling boards on the south-west faces, more with age and neglect; brick, concrete,
 *   stone and stucco take a thin green film on the shaded (north) faces; metal rusts, in streaks. All of them are streaked with dirt from under
 *   the eave or the cornice, and under each sill (`sillStreak`).
 * - **Roofs** are mossy on their north slopes and dry on the south; a metal roof rusts in streaks down the slope.
 * Age is the building's years over 130; a vacant building takes 0.65 more neglect, a ruin 1.
 */
import type { Building } from "../../sim/town/types.js";
import { hash01, type Vec3 } from "./meshBuilder.js";
import type { Surface, WearKind } from "./townSurface.js";
import type { WallStyle } from "./buildingSurfaces.js";

const NOW = 2026;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The top of the foot band of a wall, metres over its base: the band's own kinds (dirt splash, algae) end here. */
export const FOOT = 1.6;

/** How a face looks to the weather: `weather` is 1 facing the south-west (where it comes from), -1 away; `shade` is 1 facing north (no sun). x is east, z north. */
export function exposureOf(nx: number, nz: number): { weather: number; shade: number } {
  return { weather: (-nx - nz) * 0.7071, shade: clamp01(nz) };
}

/** A building's age in the fraction of 130 years, and its neglect. */
export function agingOf(b: Building): { age: number; neglect: number } {
  return { age: clamp01((NOW - b.era) / 130), neglect: b.state === "ruin" ? 1 : b.state === "vacant" ? 0.65 : 0 };
}

export type WallWear = { readonly foot: Pick<Surface, "wear" | "wearKind" | "streaks" | "wear2" | "wearKind2" | "streaks2">; readonly upper: Pick<Surface, "wear" | "wearKind" | "streaks" | "wear2" | "wearKind2" | "streaks2"> };

/** The two wears of a wall's foot band and of the wall above it, for a wall of `style` facing (`nx`, `nz`) on base height `baseY`. */
export function wallWear(b: Building, style: WallStyle, nx: number, nz: number, baseY: number): WallWear {
  const e = exposureOf(nx, nz);
  const { age, neglect } = agingOf(b);
  // This building's own keeping: an owner who washed the front in 2015 (or never has) scales its dirt, 0.35 to 1.15 (a roll from its id).
  const kept = 0.35 + 0.8 * hash01(b.id, 70);
  const high = (p: Vec3): number => p[1] - baseY;
  const metal = style.wearKind === "rust";
  // The foot: dirt thrown up by the rain, and algae where the sun does not reach.
  const splash = (p: Vec3): number => clamp01(kept * (0.3 + 0.35 * age + 0.3 * neglect) * (1 - smooth(0.1, FOOT, high(p))) + 0.04);
  const algaeFoot = (p: Vec3): number => clamp01(kept * (0.1 + 0.45 * e.shade + 0.2 * neglect + 0.15 * age) * (1 - smooth(0.6, 2.8, high(p))));
  // Above it: the weather side fails (wood), the shaded side greens (masonry), metal rusts.
  const primary = (p: Vec3): number => {
    const h = smooth(0.8, 3.5, high(p));
    if (metal) return clamp01(0.12 + 0.35 * age + 0.4 * neglect + 0.1 * h);
    if (style.paint && style.wearKind === "moss" && b.material === "wood") return clamp01((0.02 + 0.2 * age * (0.25 + 0.75 * Math.max(0, e.weather)) + 0.34 * neglect * (0.4 + 0.6 * Math.max(0, e.weather))) * (0.6 + 0.4 * h));
    if (b.material === "wood") return clamp01(0.04 + 0.26 * age * Math.max(0, e.weather) + 0.3 * neglect);
    return clamp01(0.02 + 0.2 * kept * e.shade * (0.4 + 0.6 * age) + 0.2 * neglect);
  };
  // Dirt that runs from under the eave: more near the top of a wall, more with age.
  const run = (p: Vec3): number => clamp01(kept * (0.05 + 0.16 * age + 0.2 * neglect) * (0.3 + 0.7 * smooth(2, 6, high(p))));
  const upperKind: WearKind = metal ? "rust" : b.material === "wood" ? (style.layer === "shingle_siding" ? "algae" : "peel") : "algae";
  return {
    foot: { wear: splash, wearKind: "grime", wear2: algaeFoot, wearKind2: "algae" },
    upper: { wear: primary, wearKind: upperKind, streaks: metal, wear2: run, wearKind2: "grime", streaks2: true },
  };
}

/** A roof slope's wear (a pitched roof of shingles, a shed, a flat roof, or metal), by whether it faces north. */
export function roofWear(b: Building, kind: "flat" | "gable" | "hip" | "shed", metal: boolean, nx: number, nz: number): Pick<Surface, "wear" | "wearKind" | "streaks" | "wear2" | "wearKind2" | "streaks2"> {
  const e = exposureOf(nx, nz);
  const { age, neglect } = agingOf(b);
  if (metal || kind === "shed") return { wear: clamp01(0.1 + 0.4 * age + 0.4 * neglect), wearKind: "rust", streaks: true, wear2: clamp01(0.1 + 0.2 * e.shade), wearKind2: "algae" };
  if (kind === "flat") return { wear: clamp01(0.12 + 0.3 * age + 0.3 * neglect), wearKind: "grime", wear2: clamp01(0.06 + 0.2 * age + 0.2 * neglect), wearKind2: "moss" };
  // Moss lives on the north slope and in its valleys, in streaks down the courses; the south slope is dry.
  return { wear: clamp01(0.03 + 0.5 * e.shade * (0.5 + age) + 0.25 * neglect), wearKind: "moss", streaks: true, wear2: clamp01(0.08 + 0.2 * e.shade + 0.1 * age), wearKind2: "algae" };
}

/** A decal of dirt under a sill: wide as the window, tall as `drop`, strongest at the top. Its surface is the wall's own. */
export function sillStreak(base: Surface, strength: number, y0: number, drop: number): Surface {
  return { ...base, wear: (p: Vec3): number => clamp01(strength * (1 - clamp01((y0 - p[1]) / drop))), wearKind: "grime", streaks: true, wear2: 0 };
}
