/**
 * The title film: Port Ashton's town from the sea at dusk, recorded by the engine's film mode (`tools/recording/record.mjs`) on a
 * rented GPU machine. This page is development only: `title.html` is an input of the film build (`vite build --mode film`) and never of
 * production's. The recording is what the title page shows (`client/assets/video/title.mp4`).
 */
import "../assets.js";
import "../terrain.js";
import { startFilm, type FilmDefinition } from "@csarkosh/engine/game/film/filmMode";
import { EMPTY_GAME, walkRenderer } from "../game.js";
import { townPartsWith } from "../game/town/townParts.js";
import { WORLD_WORKERS } from "../worldWorkers.js";
import { TITLE_LOOK, TITLE_WINDOWS } from "./titleLook.js";
import { TITLE_SEED, TITLE_TOKEN, titlePath } from "./titlePath.js";

/** A short stable hash (FNV-1a, 8 hex digits) of `text`. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** What the film's frames are lit and graded by, as a stable string: a retuned look or window colour refuses frames recorded under the old one. */
export function titleLookDigest(look: unknown, windows: unknown): string {
  return hashOf(JSON.stringify({ look, windows }));
}

export const TITLE_FILM: FilmDefinition = {
  name: "title",
  token: TITLE_TOKEN,
  fps: 24,
  width: 1280,
  height: 640,
  seconds: 30,
  loop: { blend: 2 },
  hour: TITLE_LOOK.hour,
  weather: TITLE_LOOK.weather,
  path: titlePath(TITLE_SEED),
  lookDigest: titleLookDigest(TITLE_LOOK, TITLE_WINDOWS),
};

/** The empty game with the film's look and its renderer's town drawing its windows in the film's colour. */
export const TITLE_GAME: typeof EMPTY_GAME = {
  ...EMPTY_GAME,
  look: TITLE_LOOK,
  renderer: walkRenderer(townPartsWith({ windowLight: TITLE_WINDOWS })),
};

/** Starts the film on the page's canvas; the engine sets `window.engineFilm`. */
export async function main(): Promise<void> {
  const canvas = document.getElementById("film") as HTMLCanvasElement;
  await startFilm(canvas, TITLE_FILM, TITLE_GAME, WORLD_WORKERS);
}
