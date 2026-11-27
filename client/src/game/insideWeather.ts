/**
 * The weather of a player in a room. The engine knows nothing of indoors, and the rain it draws round the camera is not all stopped by a roof the cover map holds:
 *
 * - **The lens** (the droplets the post chain refracts the frame through, `lensParams.ts`) is a function of the weather's rain value and the pitch of the view alone, with no cover
 *   in it. In a room it bends the furniture's edges.
 * - **The streaks** are hidden under hard cover, but the drops of the **drips** (`rain.ts`) show *under* it: alpha = covered x (1 - canopy) x the canopy's water, which is a state
 *   the renderer steps (a minute of rain fills it, ten of dry drain it), so a room under a roof has drips hanging in it in a long rain.
 *
 * So for the local player in a room the view's weather is the real weather with no rain (`dry`), put in at once with `setView` (which the game's half of a session already uses
 * for the hour), and the room is not registered as cover (`insideParts.ts`): with no rain no streak is drawn, and with no cover under the room the drips are not covered by anything
 * there. The world's rain and wind sound are cut to about half (`setHush`), not silenced. Everyone else's view and the street's wetness are untouched, and outside the real
 * weather is put back at once.
 */
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import type { WeatherParams } from "@csarkosh/engine/game/weather";
import { GOING_IN, INSIDE, type Inside } from "../sim/inside/rooms.js";

/** How much of the world's beds (the rain, the wind, the drips) a room cuts: a wall's worth, not a silence. */
export const INDOOR_HUSH = 0.5;

/** Whether the local player's view is a room's: from the start of the hold at the street door (so the lens, which eases out over a second, has begun to go while the screen is dark) until the way out begins. */
export function indoors(inside: Inside | undefined): boolean {
  return inside !== undefined && (inside.phase === GOING_IN || inside.phase === INSIDE);
}

/** The weather a room's view is drawn in: the real one with no rain. */
export function dry(real: WeatherParams): WeatherParams {
  return { ...real, rain: 0 };
}

/** What the tracker reads of the page: the renderer to tell, the sound to hush, and the weather and hour the console and the clock last set. */
export type WeatherHost = {
  readonly renderer: { setView(hour: number, weather: WeatherParams): void };
  readonly ambient: Pick<AmbientAudio, "setHush">;
  readonly appliedHour: number;
  readonly appliedWeather: WeatherParams;
};

export type IndoorWeather = {
  /** One frame, before the sync: tells the renderer when the local player's view changes between a room's and the street's (or the console or a swapped renderer changed it under a room's). */
  step(inside: Inside | undefined): void;
  /** The weather to draw in now: what a push of the hour must carry. */
  weather(): WeatherParams;
};

export function createIndoorWeather(host: WeatherHost): IndoorWeather {
  let on = false;
  let renderer: unknown = null;
  let seen: WeatherParams | null = null;
  return {
    step(inside) {
      const want = indoors(inside);
      // Under a room's view the console's weather command, and a renderer made again, put the real rain back: it is put out again.
      if (want === on && !(on && (host.appliedWeather !== seen || host.renderer !== renderer))) return;
      on = want;
      renderer = host.renderer;
      seen = host.appliedWeather;
      host.renderer.setView(host.appliedHour, on ? dry(seen) : seen);
      host.ambient.setHush(on ? INDOOR_HUSH : 0);
    },
    weather: () => (on ? dry(host.appliedWeather) : host.appliedWeather),
  };
}
