/**
 * The title film's look: Port Ashton's look held at one hour a little after sunset, after a TV key art: a teal sky, paler and hazier teal
 * ridges with distance, near-black foreground, and red lit windows as the only warm colour. One palette (no grades), so the hour is held.
 * Starting values; tuned by eye.
 */
import { gameLook, type GameLook, type LookGlow } from "@csarkosh/engine/game/gameLook";
import type { PaintPalette } from "@csarkosh/engine/game/gradeParams";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import { sunPositionAt } from "@csarkosh/engine/game/sky";
import type { WindowLight } from "../game/town/townMaterial.js";
import { PORTASHTON_LOOK } from "../look.js";

/** The sun's height the film is held at: a little under the horizon (the spec asks -0.05 to -0.1), the sky's teal dusk. */
const SUN_HEIGHT = -0.07;

/** The first evening hour (found a minute at a time from noon, as the sun's own set is) where the sun's height has fallen to `SUN_HEIGHT`. */
function hourAfterSunset(): number {
  let h = 12;
  while (h < 24 && sunPositionAt(h).y > SUN_HEIGHT) h += 1 / 60;
  return h;
}

const WEATHER: WeatherParams = { cloudCover: 0.85, mist: 0.35, rain: 0, wetness: 0.8, dread: 0 };

const PALETTE: PaintPalette = {
  shadows: { r: 0.02, g: 0.05, b: 0.06, density: 0.95, saturation: 0 },
  midtones: { r: 0.3, g: 0.5, b: 0.52, density: 0.7, saturation: -0.2 },
  highlights: { r: 0.62, g: 0.82, b: 0.8, density: 0.6, saturation: 0 },
  saturation: 0.2,
  contrast: 1.5,
  pivot: 0.18,
  lift: { r: 0.003, g: 0.004, b: 0.005 },
};

/**
 * The halo's strength is an absolute grade gain (the engine's own halation is 0.04). The threshold is the exposed linear luminance a
 * pixel must pass to glow. Saturated red has a luminance of only about 0.23 to 0.26 (the green and blue weights are what carry
 * luminance), so a red window's 0.43 to 0.92 (its glow 0.35 to 0.75, times the window gain 3, the town's 1.06 and the exposure 1.5)
 * barely crossed 0.8; at 0.35 most of them cross it. The other night lights are dimmed (`TITLE_WINDOWS.others`) so that they do not.
 * Starting values, tuned by eye.
 */
const GLOW: LookGlow = { threshold: 0.35, strength: 0.12, radius: 2, mist: 1 };

export const TITLE_LOOK: GameLook = gameLook({
  ...PORTASHTON_LOOK,
  hour: hourAfterSunset(),
  weather: WEATHER,
  grades: [],
  palette: PALETTE,
  glow: GLOW,
});

/** The windows' light in the film: red, the one warm colour. Every other night light (a lamp's lens and its thrown light, a porch, a harbour lamp, a boat's cabin) is at a quarter, so the red windows are the glow that shows. */
export const TITLE_WINDOWS: WindowLight = { colour: [1, 0.06, 0.04], gain: 3, others: 0.25 };
