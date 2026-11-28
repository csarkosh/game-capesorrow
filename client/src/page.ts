/**
 * Port Ashton as the page's shell is handed it (`pageGame.ts`): its definition on a page, and its
 * own of the page. Until the game has a world of its own, what Play starts is the engine's empty
 * game (a walkable yard); the page around it is Port Ashton's: a title page with Play, Settings
 * and Credits, and nothing played before a session starts.
 */
import { isMode, createModeKeeper } from "@csarkosh/engine/game/modeList";
import type { LandingShell, PageGame, PageHost, PageSide } from "@csarkosh/engine/game/pageGame";
import type { Route } from "@csarkosh/engine/game/router";
import { pageStorage, parseTierOverride } from "@csarkosh/engine/game/tierChoice";
import type { AmbientAudio } from "@csarkosh/engine/game/ambientAudio";
import type { CarSoundApi } from "./game/car/carSound.js";
import { EMPTY_GAME, WALK_MODES, type WalkClient, type WalkHost, type WalkRenderer } from "./game.js";
import { creditsEntries } from "./game/credits.js";
import { renderLanding, type LandingHandle, type LandingPanel } from "./game/landing.js";
import { landingModel, type LandingInput } from "./game/landingModel.js";
import { createStatusLine, type WalkHud } from "./hud.js";
import { PORTASHTON_IDENTITY } from "./identity.js";
import { WALK_PROTOCOL } from "./net.js";
import { WORLD_WORKERS } from "./worldWorkers.js";
import { createWalkWorld, type WalkState, type WalkWorld, type Walker } from "./sim.js";

/** Port Ashton's own of the page: made once by the shell, called at the page's own points. */
export function createPortAshtonPage(h: PageHost): PageSide {
  let landing: LandingHandle | null = null;
  // The mode (`WALK_MODES`), kept the same way as the graphics choice.
  const modeChoice = createModeKeeper(WALK_MODES, pageStorage);
  const currentMode = (): string => modeChoice.mode();
  const saveMode = (mode: string): void => {
    modeChoice.save(mode);
    h.telemetry.event("settings", { mode });
  };

  /** What the title page shows of the shell as it stands now: a follower waits for the host, and Play says so while it loads. */
  function landingInput(): LandingInput {
    return {
      follower: h.lobby !== null && h.lobby.state.role === "client",
      launching: h.launching,
      quality: {
        choice: h.currentChoice(),
        auto: h.autoSummary(),
        override: parseTierOverride(location.search),
        stored: h.choiceStored(),
        notice: h.choiceNotice ?? undefined,
        mode: currentMode(),
        modes: WALK_MODES,
      },
    };
  }

  function repaintLanding(): void {
    landing?.setView(landingModel(landingInput()));
  }

  /** The panel an address shows: Settings and Credits have their own, and every other address is the home panel (there is no Downloads panel). */
  function panelFor(route: Route): LandingPanel {
    if (route.kind === "credits") return "credits";
    if (route.kind === "settings") return "settings";
    return "home";
  }

  return {
    showLanding(container: HTMLDivElement, route, shell: LandingShell) {
      const handle = renderLanding(
        container,
        landingModel(landingInput()),
        {
          onCreate: shell.play,
          onSettings: () => shell.toPanel("settings"),
          onChooseTier: (choice) => {
            shell.chooseTier(choice);
            repaintLanding();
          },
          onChooseMode: (mode) => {
            // A value that is not one of the game's modes is ignored.
            if (!isMode(WALK_MODES, mode)) return;
            saveMode(mode);
            repaintLanding();
          },
          onCredits: () => shell.toPanel("credits"),
          onBack: shell.back,
        },
        panelFor(route),
      );
      landing = handle;
      return { dispose: () => handle.dispose() };
    },
    landingUp: () => landing !== null,
    // A panel's address, with the title page already up: the panel slides in or out, and the browser's Back closes it.
    showPanel(route) {
      landing?.setPanel(panelFor(route));
    },
    repaint: repaintLanding,
    left() {
      landing = null;
    },
    // Nothing plays before a session starts.
    played: () => undefined,
    carriesToGame: () => false,
    keepOpening: () => undefined,
    openingFor: () => null,
    muteChanged: () => undefined,
    // A visitor turned away is shown the engine's page; the landing page held goes first.
    turnedAway() {
      landing = null;
    },
    mode: currentMode,
    saveMode(next) {
      if (isMode(WALK_MODES, next)) saveMode(next);
    },
  };
}

export const PORTASHTON_PAGE: PageGame<WalkWorld, WalkState, Walker, WalkRenderer, AmbientAudio & CarSoundApi, WalkHud, WalkHost, WalkClient> = {
  game: EMPTY_GAME,
  side: createPortAshtonPage,
  identity: PORTASHTON_IDENTITY,
  /** The page for those turned away stands on no still (the title page has none), and credits the same works the Credits screen does. */
  away: { still: () => null, credits: creditsEntries },
  protocol: WALK_PROTOCOL,
  statusLine: createStatusLine,
  /** The world workers (`worldWorkers.ts`): shared with the title film, which has no page. */
  ...WORLD_WORKERS,
  /** No scene is staged yet: a scene's address draws nothing. */
  scene: () => ({ dispose: () => undefined }),
  /** What the tier check draws as it measures the renderer: the yard with nobody in it. */
  probeState: (_level, _seed, forest) => createWalkWorld(forest, false).state,
};
