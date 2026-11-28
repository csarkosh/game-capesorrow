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

/** About 0.15 h after the sun's own set: the hour where the sun's height crosses 0 (evening), plus 0.15. */
function hourAfterSunset(): number {
  let h = 12;
  while (h < 24 && sunPositionAt(h).y > 0) h += 1 / 60;
  return h + 0.15;
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

/** The halo's strength is an absolute grade gain (the engine's own halation is 0.04). */
const GLOW: LookGlow = { threshold: 0.8, strength: 0.12, radius: 2, mist: 1 };

export const TITLE_LOOK: GameLook = gameLook({
  ...PORTASHTON_LOOK,
  hour: hourAfterSunset(),
  weather: WEATHER,
  grades: [],
  palette: PALETTE,
  glow: GLOW,
});

/** The windows' light in the film: red, the one warm colour. */
export const TITLE_WINDOWS: WindowLight = { colour: [1, 0.06, 0.04], gain: 3 };
