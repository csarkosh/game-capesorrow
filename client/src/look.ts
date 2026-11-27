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
 * reflection. A session starts at midday, and the day moves on from there: the grade follows the sun's height and the cloud's cover
 * (`GRADES`), from that midday through a warm late afternoon and a blue dusk to night, with less exposure under a clear sky than under
 * cloud, since direct sun on a wall needs less than the same wall under an overcast.
 *
 * Over the picture lies a finish (`FINISH`), the same at every hour, which is what makes it one style: fine film grain, a faintly darker
 * edge to the frame, the light barely gathered into bands, and a thin grey line where one thing ends against another, which the engine
 * finds from the scene's depth, so a wall's brick draws none.
 *
 * Every value is a first tuning by eye, on two streets.
 */
import { SAND_DEFAULT, gameLook, lookGradeAt, type GameLook, type LookFinish, type LookGrade, type LookSward } from "@csarkosh/engine/game/gameLook";
import type { PaintPalette } from "@csarkosh/engine/game/gradeParams";
import { sunPositionAt } from "@csarkosh/engine/game/sky";
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

/** The hour before sunset: the shade goes blue and the light on a wall goes warm. */
export const LATE_PALETTE: PaintPalette = {
  shadows: { r: 0.14, g: 0.18, b: 0.3, density: 0.9, saturation: 0.1 },
  midtones: { r: 0.48, g: 0.52, b: 0.6, density: 0.5, saturation: 0 },
  highlights: { r: 1.0, g: 0.9, b: 0.72, density: 0.6, saturation: 0.1 },
  saturation: 0.3,
  contrast: 1.25,
  pivot: 0.18,
  lift: { r: 0.005, g: 0.0058, b: 0.007 },
};
/** The hour after sunset: deep blue shade, and the lit windows carry the picture. */
export const DUSK_PALETTE: PaintPalette = {
  shadows: { r: 0.1, g: 0.14, b: 0.3, density: 0.9, saturation: 0.1 },
  midtones: { r: 0.42, g: 0.46, b: 0.62, density: 0.55, saturation: 0 },
  highlights: { r: 1.0, g: 0.85, b: 0.6, density: 0.75, saturation: 0.25 },
  saturation: 0.25,
  contrast: 1.3,
  pivot: 0.18,
  lift: { r: 0.004, g: 0.005, b: 0.009 },
};
/** Night. */
export const NIGHT_PALETTE: PaintPalette = {
  shadows: { r: 0.06, g: 0.09, b: 0.22, density: 0.9, saturation: 0.1 },
  midtones: { r: 0.3, g: 0.36, b: 0.55, density: 0.5, saturation: 0 },
  highlights: { r: 1.0, g: 0.82, b: 0.55, density: 0.8, saturation: 0.3 },
  saturation: 0.2,
  contrast: 1.25,
  pivot: 0.18,
  lift: { r: 0.003, g: 0.004, b: 0.008 },
};

/**
 * The grade by the sun's height (1 overhead, 0 on the horizon): the palette, and what the exposure is multiplied by under a clear sky and
 * under full cloud. Direct sun on a wall needs less than the same wall under cloud, and a dusk under rain needs more than a clear one.
 * Night is dark (the owner's word: "properly dark"): away from a lamp a street is only just read, and what is lit carries the picture
 * (`litGainAt` below keeps the lit things bright under it).
 */
const GRADES: readonly LookGrade[] = [
  { sun: -0.35, palette: NIGHT_PALETTE, exposure: 0.28, overcast: 0.32 },
  { sun: -0.1, palette: DUSK_PALETTE, exposure: 0.55, overcast: 0.85 },
  { sun: 0.38, palette: LATE_PALETTE, exposure: 1.0, overcast: 1.6 },
  { sun: 0.75, palette: HARBOUR_PALETTE, exposure: 1.1, overcast: 1.75 },
];

/** The finish over the picture: fine grain, a faint dark edge to the frame, the light barely banded, and a thin grey line where one thing ends. */
/**
 * Where the line begins and where it is full, as a step in depth over the distance to what is behind it: half the engine's own, so that
 * relief of 5 to 15 cm (a sill, a casing, a pilaster) is drawn from across a street. Paint on a wall lies flush under a depth rank
 * (`game/town/paint.ts`) and draws none, which is what lets these come down.
 *
 * Far off the pen lifts. The engine's measure is a step's share of the distance, the same at any distance, so with thresholds this low a
 * forested hill was a thicket of outlines (one crown before the next is as deep a step, in proportion, as a doorframe) and every fold of
 * a mountain was drawn at full weight. Within `lineNear` (a street's width) nothing changes; from there to `lineFar`, eased along the
 * logarithm of the distance, a step must be up to `lineFarBand` times deeper to draw and the line fades to `lineFarWeight` of its
 * strength. What is left far away is what carries the shape: a ridge against the sky, a headland against the water, one mass of forest
 * against the valley behind it, each lighter than a line near by.
 */
const FINISH: LookFinish = { grain: 0.028, edge: 0.14, line: 0.6, lineColour: [0.16, 0.17, 0.22], lineFrom: 0.005, lineTo: 0.025, lineNear: 40, lineFar: 600, lineFarBand: 20, lineFarWeight: 0.5, bands: 0.25 };

/**
 * The ground under the grass. The line is drawn on every blade's edge, so the grass is darker than the engine's own floor under it, and
 * where the blades are built late round a player who runs, the bare ground showed as a pale patch that then went dark. The floor is as
 * dark as the blades are with the line on them, and the ground is pulled all the way to it: measured with the blades off, the bare
 * ground then shows within a few parts in a hundred of the grass over it.
 */
const SWARD: LookSward = { floor: [0.031, 0.041, 0.013], pull: 1 };

export const CAPE_LOOK: Partial<GameLook> = {
  paint: 0,
  farSoft: 0,
  exposure: 1.5,
  palette: HARBOUR_PALETTE,
  weather: DAMP,
  // Where the engine reads a preset by name (how calm the lakes lie), the nearest of its own.
  weatherName: "overcast",
  hour: 12,
  finish: FINISH,
  sward: SWARD,
  // The beach's sand, deeper than the engine's own: every part at its full strength (`LookSand`).
  sand: { ...SAND_DEFAULT },
  grades: GRADES,
};

/**
 * The night's grade is dark: an unlit street is barely read, as a town's is away from its lamps. The grade darkens the whole frame, and
 * with it everything that is lit from within (a lamp's lens and the light it throws, a lit window, an open shop's room), which would
 * leave a lit window as dim as the wall round it. So the town's glows are multiplied back (`townMaterial.ts`, `townGlow`) by `LIT_GAIN`
 * over the grade's gain at the hour: `LIT_GAIN` is the night's gain those glows were tuned by eye under, so a lit thing stays as bright
 * as it was tuned to be while the dark round it deepens. Never under 1: by day the glows are as they were drawn.
 *
 * The cloud is the look's own weather's, which is the only weather the game has; when the weather turns, this must read the sky's.
 */
export const LIT_GAIN = 0.86;
export function litGainAt(hour: number): number {
  const grade = lookGradeAt(gameLook(CAPE_LOOK), hour, DAMP.cloudCover);
  return grade === null ? 1 : Math.max(1, LIT_GAIN / grade.exposure);
}

/**
 * How much day there is at `hour`, 1 to 0: all of it with the sun a little over the horizon, none with it a little under. What glows only
 * because daylight is on it or through it (paper in a vacant shop's glass, an office's blinds) is kept by this (`townMaterial.ts`, `townDay`).
 */
export const DAY_FROM = -0.1;
export const DAY_FULL = 0.1;
export function daylightAt(hour: number): number {
  const t = Math.min(1, Math.max(0, (sunPositionAt(hour).y - DAY_FROM) / (DAY_FULL - DAY_FROM)));
  return t * t * (3 - 2 * t);
}
