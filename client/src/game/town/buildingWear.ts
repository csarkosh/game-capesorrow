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

/**
 * How weathered a building is, 0 (light) to 1 (heavy), from its own record: its age, whether it is kept up, vacant or a ruin, and a roll of its own for the
 * paint it was last given. The levels spread: about a quarter of the buildings come out light (short streaks under some sills, a low algae line), about half
 * moderate and about a quarter heavy (the old, the vacant and the neglected), and two neighbours usually differ.
 */
export function levelOf(b: Building): number {
  const { age, neglect } = agingOf(b);
  const score = 0.5 * hash01(b.id, 73) + 0.22 * age + 0.38 * neglect + 0.12 * hash01(b.id, 74);
  return clamp01((score - 0.2) / 0.8);
}

/**
 * The share of a wall the green film may cover: a tenth on a light building, a third on a heavy one (more only on a ruin), and more on a shaded face.
 * It gathers where water does (the foot, under the eave and the parapet), not evenly: the wears below spend this share by place.
 */
export function filmCap(b: Building, shade: number): number {
  const L = levelOf(b);
  return 0.07 + 0.26 * L * (0.7 + 0.3 * shade) + (b.state === "ruin" ? 0.2 : 0);
}

/** The two wears of a wall's foot band and of the wall above it, for a wall of `style` facing (`nx`, `nz`) on base height `baseY`. */
export function wallWear(b: Building, style: WallStyle, nx: number, nz: number, baseY: number): WallWear {
  const e = exposureOf(nx, nz);
  const L = levelOf(b);
  const { neglect } = agingOf(b);
  const high = (p: Vec3): number => p[1] - baseY;
  const metal = style.wearKind === "rust";
  const cap = filmCap(b, e.shade);
  const foot = (p: Vec3): number => 1 - smooth(0.2, 2.4, high(p));
  const top = (p: Vec3): number => clamp01(1 - (b.height - high(p)) / 0.9);
  // The foot: dirt thrown up by the rain (to a hand's height or two), and a tide of algae where the sun does not reach, up a half metre to one and a half.
  const splash = (p: Vec3): number => clamp01((0.22 + 0.4 * L) * (1 - smooth(0.05, FOOT * 0.75, high(p))) + 0.14 * (1 - smooth(0, 0.3, high(p))) + 0.03);
  const algaeTop = 0.5 + 1.0 * L * (0.5 + 0.5 * e.shade);
  const algaeFoot = (p: Vec3): number => clamp01((0.12 + 0.5 * L) * (0.5 + 0.5 * e.shade) * (1 - smooth(0.12, algaeTop, high(p))));
  // Above it: the weather side fails (wood), masonry takes a film that gathers at the foot and under the eave, metal rusts. Each is held to its share.
  const primary = (p: Vec3): number => {
    const h = smooth(0.8, 3.5, high(p));
    if (metal) return clamp01(0.06 + 0.38 * L + 0.2 * neglect + 0.08 * h);
    if (style.paint && style.wearKind === "moss" && b.material === "wood") return clamp01((0.01 + 0.17 * L * (0.25 + 0.75 * Math.max(0, e.weather))) * (0.6 + 0.4 * h));
    if (b.material === "wood") return clamp01(0.03 + 0.3 * L * (0.3 + 0.7 * Math.max(0, e.weather)));
    return clamp01(cap * (0.2 + 1.5 * foot(p) + 0.8 * top(p)));
  };
  // Run-off from the eave: narrow streaks, strongest just under it and fading out within a metre or so, more on a heavier building.
  const reach = 0.5 + 1.0 * L;
  const run = (p: Vec3): number => clamp01((0.05 + 0.4 * L) * clamp01(1 - (b.height - high(p)) / reach));
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
  return { ...base, wear: (p: Vec3): number => clamp01(strength * (1.15 - clamp01((y0 - p[1]) / drop))), wearKind: "grime", streaks: true, wear2: 0 };
}

/**
 * A storefront's bulkhead (the panel under the glass): kicked and scuffed at its foot where shoes, mops and the sidewalk's splash reach, rust running from the
 * bottom where it is metal, and grime in its field by the unit's state. `age` is the building's years over 130, `vacant` a unit with no tenant. Pure of the
 * plan: `roll` is this unit's own 0 to 1 (its own keeping).
 */
export function bulkheadWear(b: Building, vacant: boolean, roll: number, metal: boolean, kick: boolean): Pick<Surface, "wear" | "wearKind" | "streaks" | "wear2" | "wearKind2" | "streaks2"> {
  const { age, neglect } = agingOf(b);
  const keep = 0.5 + 0.9 * roll + (vacant ? 0.5 : 0);
  // Constants for each quad: a value that differs from corner to corner is interpolated across the quad and shades as spikes, so the foot is its own quad (the kick plate).
  const grime = clamp01(kick ? 0.55 + 0.3 * keep * (0.5 + age) : 0.22 + 0.3 * keep * (0.3 + age + neglect));
  const rust = clamp01((metal ? 0.3 : 0.1) * keep * (0.5 + age) * (kick ? 1.8 : 0.6));
  return { wear: grime, wearKind: "grime", wear2: rust, wearKind2: metal ? "rust" : "algae" };
}
