/**
 * What one parked vehicle looks like, from its own plan record and no one else's: its paint, and the dirt on it. Pure numbers, which the
 * material (`vehicleMaterial.ts`) wears. Two cars of one model and one colour differ by their seed, their age and how long they have sat.
 *
 * The paint is the plan's colour index (`PAINT` in `vehicleStyle.ts` is the code-built cars' table; this is the table of period colours
 * for the models): dull, never candy, the way old paint goes. A model is repainted only where its body is paint (the kit models' `paint`
 * role); the worn ones (the two derelicts and the covered car) keep their own textures.
 */
import { rnd } from "./kit.js";
import type { Rgb } from "../meshBuilder.js";
import type { Vehicle } from "../../../sim/town/types.js";

/** Linear paint colours by the plan's index: white, silver, black, charcoal, blue, faded red, forest green, tan, maroon, teal, yellow, orange, light blue, cream, brown, sage, champagne, pale grey. */
export const MODEL_PAINT: readonly Rgb[] = [
  [0.4, 0.38, 0.33], [0.2, 0.21, 0.21], [0.02, 0.02, 0.022], [0.045, 0.05, 0.056], [0.024, 0.05, 0.115], [0.17, 0.03, 0.024],
  [0.026, 0.07, 0.04], [0.21, 0.16, 0.1], [0.065, 0.016, 0.025], [0.026, 0.095, 0.095], [0.28, 0.21, 0.045], [0.22, 0.07, 0.022],
  [0.13, 0.2, 0.28], [0.34, 0.31, 0.2], [0.09, 0.052, 0.03], [0.1, 0.14, 0.1], [0.23, 0.19, 0.13], [0.26, 0.28, 0.29],
];

export type VehicleLook = {
  /** The paint, linear, after its fade and its own variation. */
  readonly paint: Rgb;
  /** Road film low on the body, up to the door handles, 0 to 1. */
  readonly grime: number;
  /** Dust on the glass, 0 to 1 (the wiper arcs are wiped clean in it). */
  readonly dust: number;
  /** Algae and leaf litter, for a vehicle that never moves, 0 to 1 (and moss in its window channels). */
  readonly moss: number;
  /** How far the clear coat has gone (chalky, paler and rougher on the roof and bonnet), 0 to 1. */
  readonly fade: number;
  /** A number in [0, 1) that offsets the dirt's noise, so no two patterns agree. */
  readonly seed: number;
  /** Rust at the arches and sills, 0 to 1: none before about fifteen years old (age 0.35 of the plan's 0 to 1). */
  readonly rust: number;
  /** A primer-grey panel (a door or a wing): 0 for none, else where along the side it is, in (0, 1]. */
  readonly primer: number;
  /** One dull headlamp: -1 or 1 for which side, 0 for none. */
  readonly lamp: number;
  /** Mud behind each wheel arch, 0 to 1: more from a yard or a pull-off, less from the curb. */
  readonly mud: number;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** How much mud a place a vehicle stands on throws up on it. */
const MUD_OF_SPOT = { curb: 0.12, drive: 0.3, lot: 0.25, "pull-off": 0.55, yard: 0.6, harbour: 0.45 } as const;

export function vehicleLook(v: Vehicle): VehicleLook {
  const base = MODEL_PAINT[v.colour % MODEL_PAINT.length] as Rgb;
  // Each car's own shade: a little lighter or darker, and a touch off its hue.
  const value = 0.86 + 0.28 * rnd(v.seed, 31);
  const warm = (rnd(v.seed, 32) - 0.5) * 0.12;
  // The clear coat goes first on old paint left out in the weather: age and the years it has sat.
  const fade = clamp01(v.age * 0.9 + v.idle * 0.35 - 0.12 + (rnd(v.seed, 33) - 0.3) * 0.2);
  const chalk = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722;
  const paint = base.map((c, k) => {
    const shifted = c * value * (1 + (k === 0 ? warm : k === 2 ? -warm : 0));
    // Faded paint goes pale and flat: toward its own grey, lifted.
    return Math.max(0, shifted + (chalk * 1.4 + 0.02 - shifted) * fade * 0.3);
  }) as unknown as Rgb;
  const still = v.state === "derelict" || v.state === "project";
  const mud = clamp01(MUD_OF_SPOT[v.spot] + 0.35 * v.idle + 0.2 * (rnd(v.seed, 37) - 0.5) + (v.state === "work" ? 0.2 : 0));
  const grime = clamp01(0.4 + 0.4 * v.idle + 0.25 * v.age + 0.3 * mud + (v.state === "work" ? 0.12 : 0) + (rnd(v.seed, 34) - 0.5) * 0.25);
  const dust = clamp01(0.3 + 0.55 * v.idle + 0.15 * v.age + (rnd(v.seed, 35) - 0.5) * 0.3);
  const moss = v.state === "derelict" ? clamp01(0.55 + 0.4 * v.idle) : v.state === "project" ? clamp01(0.3 + 0.4 * v.idle) : clamp01((v.idle - 0.12) * 2.2) * (v.spot === "yard" || v.spot === "pull-off" ? 1 : 0.5);
  const rust = v.age < 0.3 ? 0 : clamp01((v.age - 0.3) * 1.6 + (rnd(v.seed, 38) - 0.5) * 0.25);
  const primer = v.age > 0.4 && rnd(v.seed, 39) < 0.2 + 0.5 * v.age ? 0.1 + 0.9 * rnd(v.seed, 40) : 0;
  const lamp = rnd(v.seed, 41) < 0.3 + 0.5 * v.age ? (rnd(v.seed, 42) < 0.5 ? -1 : 1) : 0;
  return { paint, grime: still ? Math.min(1, grime + 0.1) : grime, dust: still ? Math.min(1, dust + 0.2) : dust, moss, fade, seed: rnd(v.seed, 36), rust, primer, lamp, mud };
}
