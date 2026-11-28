import { describe, expect, it, vi } from "vitest";
import "../../src/terrain.js";
import { COMFORT, checkPath } from "@csarkosh/engine/game/film/cameraPath";
import { filmGroundAt } from "@csarkosh/engine/game/film/filmMode";
import { TITLE_FILM, TITLE_GAME, titleLookDigest } from "../../src/film/titleFilm.js";
import { TITLE_LOOK, TITLE_WINDOWS } from "../../src/film/titleLook.js";
import { TITLE_SEED, TITLE_TOKEN } from "../../src/film/titlePath.js";
import { EMPTY_GAME } from "../../src/game.js";
import { buildInputs } from "../../vite.config.js";

describe("TITLE_FILM", () => {
  it("has the film's values and a path that passes checkPath", () => {
    expect(TITLE_FILM).toMatchObject({
      name: "title",
      token: TITLE_TOKEN,
      fps: 24,
      width: 1280,
      height: 640,
      seconds: 30,
      loop: { blend: 2 },
      hour: TITLE_LOOK.hour,
      weather: TITLE_LOOK.weather,
    });
    expect(checkPath(TITLE_FILM.path, 24, COMFORT, filmGroundAt(TITLE_SEED))).toEqual([]);
  });

  it("has a look digest that a retuned look or window colour changes", () => {
    expect(TITLE_FILM.lookDigest).toBe(titleLookDigest(TITLE_LOOK, TITLE_WINDOWS));
    const base = titleLookDigest(TITLE_LOOK, TITLE_WINDOWS);
    expect(titleLookDigest({ ...TITLE_LOOK, hour: TITLE_LOOK.hour + 0.1 }, TITLE_WINDOWS)).not.toBe(base);
    expect(titleLookDigest(TITLE_LOOK, { ...TITLE_WINDOWS, gain: TITLE_WINDOWS.gain + 1 })).not.toBe(base);
  });

  it("is the empty game with the film's look and its own renderer, and play's game is untouched", () => {
    expect(TITLE_GAME.look).toBe(TITLE_LOOK);
    expect(TITLE_GAME.renderer).not.toBe(EMPTY_GAME.renderer);
    expect(EMPTY_GAME.look).not.toBe(TITLE_LOOK);
    expect(TITLE_GAME.level).toBe(EMPTY_GAME.level);
  });
});

describe("the build's inputs", () => {
  it("include the title page only in film mode", () => {
    expect(Object.keys(buildInputs("production"))).toEqual(["main"]);
    expect(Object.keys(buildInputs("film"))).toEqual(["main", "title"]);
    expect(buildInputs("film").title).toMatch(/title\.html$/);
  });
});

describe("the film's hour", () => {
  /** A host that records every hour pushed to the renderer, standing at `hour` with the world's ticks counted by the test. */
  function hostAt(hour: number) {
    const pushed: number[] = [];
    const host = {
      base: { hour },
      appliedHour: hour,
      appliedWeather: TITLE_LOOK.weather,
      renderer: { setView: vi.fn((h: number) => void pushed.push(h)) },
      ambient: { setHush: vi.fn(), car: vi.fn() },
      hud: {},
    };
    return { host, pushed };
  }
  /** Steps `side.beforeSync` over `ticks` ticks of a world with one outdoor walker. */
  function run(game: typeof TITLE_GAME, ticks: number): number[] {
    const { host, pushed } = hostAt(TITLE_LOOK.hour);
    const side = game.side(host as never);
    const state = { tick: 0, players: new Map([[1, { inside: undefined }]]) };
    for (let t = 0; t < ticks; t++) {
      state.tick = t;
      side.beforeSync(undefined as never, state as never, 1);
    }
    return pushed;
  }

  it("is never moved by a day clock in the film's side", () => {
    expect(run(TITLE_GAME, 40 * 60).filter((h) => h !== TITLE_LOOK.hour)).toEqual([]);
  });

  it("is still moved by play's side (the clock is play's)", () => {
    expect(run(EMPTY_GAME, 40 * 60).length).toBeGreaterThan(0);
  });
});
