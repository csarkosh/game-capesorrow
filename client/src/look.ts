/**
 * Cape Sorrow's look, as the engine is handed it (`game.ts`): **Harbour**, a cold, clear, wet working port at midday under high cloud.
 *
 * The engine's own look is Day Hike's, a landscape in oils: every frame smeared into strokes, the distance softened, the palette pulling
 * shadows to umber and taking colour out. A town is read by its edges, its lettering and its paint, so here the strokes and the far
 * softening are off, the frame is brighter (under the engine's exposure nothing in a street was brighter than two thirds of white, and the
 * sky read as a grey lid), and the palette leaves the middle of the range almost alone so that paint and brick keep their own colour:
 * blue-black shadows, a slightly warm white on top so the sky separates from the buildings, and colour put back.
 *
 * The weather is the day after rain: more cloud than sun, little haze, the streets still damp, so asphalt is dark and carries a soft
 * reflection. The hour is midday: nothing in the town casts a shadow, and a low sun with no shadows looks wrong.
 *
 * Every value is a first tuning by eye, on two streets.
 */
import type { GameLook } from "@csarkosh/engine/game/gameLook";
import type { PaintPalette } from "@csarkosh/engine/game/gradeParams";
import type { WeatherParams } from "@csarkosh/engine/game/weather";

/** The grade's palette (the engine's format: a band's colour, how far it is pulled there, and its saturation's ease). */
export const HARBOUR_PALETTE: PaintPalette = {
  shadows: { r: 0.16, g: 0.2, b: 0.24, density: 0.6, saturation: 0 },
  midtones: { r: 0.55, g: 0.56, b: 0.54, density: 0.3, saturation: 0.1 },
  highlights: { r: 0.96, g: 0.95, b: 0.9, density: 0.4, saturation: -0.1 },
  saturation: 0.3,
  contrast: 1.32,
  pivot: 0.18,
  lift: { r: 0.005, g: 0.0058, b: 0.007 },
};

/** The day after rain. */
export const DAMP: WeatherParams = { cloudCover: 0.6, mist: 0.08, rain: 0, wetness: 0.7, dread: 0 };

export const CAPE_LOOK: Partial<GameLook> = {
  paint: 0,
  farSoft: 0,
  exposure: 1.5,
  palette: HARBOUR_PALETTE,
  weather: DAMP,
  // Where the engine reads a preset by name (how calm the lakes lie), the nearest of its own.
  weatherName: "overcast",
  hour: 12,
};
