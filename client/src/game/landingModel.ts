import { settingsModel, type SettingsInput, type SettingsView } from "@csarkosh/engine/game/settings";
import { WALK_MODES } from "../game.js";
import { CREDITS, IN_DEVELOPMENT, LOADING, PLAY, SETTINGS, WAITING_FOR_HOST } from "./words.js";

export type LandingInput = {
  /** The build can play: see `canPlay`. Where it cannot, Play is not offered and a quiet line stands in its place. */
  playable: boolean;
  /** In a lobby someone else hosts. Followers do not start games; the host's navigation carries them. */
  follower?: boolean;
  /** Play was pressed and the world is about to build: the button says so and takes no second press. */
  launching?: boolean;
  /** The graphics setting for the Settings panel: the player's choice, Auto's pick once the GPU's signals are in, `?tier=`, and
   * whether the browser keeps the choice. Auto, with nothing known, when absent. */
  quality?: Omit<SettingsInput, "context" | "running" | "selectionTier" | "applying" | "error">;
};

/**
 * Whether this build can be played: the dev server always can (its own proxy reaches the dev
 * server's signaling), and a production build can when it was given a signaling address. The
 * address is read as the engine reads it (`net/signalingUrl.ts`): an empty value counts as unset.
 */
export function canPlay(env: { DEV?: boolean; VITE_SIGNALING_URL?: string | undefined }): boolean {
  return env.DEV === true || Boolean(env.VITE_SIGNALING_URL);
}

/** Which panel is showing. The route decides; see the engine's shell. */
export type LandingPanel = "home" | "settings" | "credits";

const LANDING_PANELS: readonly LandingPanel[] = ["home", "settings", "credits"];

/**
 * What moving between panels does to the keyboard, as data. Every panel but the one showing is
 * inert: the panels are only slid and faded out of sight, and without this Tab and a screen reader
 * still reached them, where Settings' choices would change the setting unseen. Focus goes into a
 * panel as it opens and back to its entry on the home panel as it closes; a page load (`previous`
 * null) moves nothing.
 */
export function landingPanelFocus(
  previous: LandingPanel | null,
  next: LandingPanel,
): { inert: LandingPanel[]; focus: { into: LandingPanel } | { entry: LandingPanel } | null } {
  const inert = LANDING_PANELS.filter((panel) => panel !== next);
  if (previous === null || previous === next) return { inert, focus: null };
  if (next !== "home") return { inert, focus: { into: next } };
  return { inert, focus: { entry: previous } };
}

export type LandingView = {
  /** The primary action, where the build can play and the player is not a follower. `busy` while the world it started is loading:
   * disabled, with a label that says so, because the build that follows blocks the page for a second or more and a button that
   * changed nothing reads as a missed tap. */
  play?: { label: string; busy?: boolean };
  /** A follower's line, in Play's place. */
  waiting?: string;
  /** A build that cannot play says so, quietly, in Play's place. */
  developing?: string;
  /** Always present, for a follower too: the setting is the player's own. */
  settings: { label: string };
  /** Always present: the credit the licences ask for has to be reachable from every build. */
  credits: { label: string };
  /** The Settings panel's content. */
  settingsPage: SettingsView;
};

/**
 * What the title page shows, as data. The client has no DOM tests, so every decision (what stands
 * in Play's place, what it says) is made here where vitest can reach it, and `renderLanding` only
 * paints the result.
 */
export function landingModel(input: LandingInput): LandingView {
  const quality = input.quality ?? { choice: "auto", auto: null, override: null, stored: true, modes: WALK_MODES };
  const view: LandingView = {
    settings: { label: SETTINGS },
    credits: { label: CREDITS },
    settingsPage: settingsModel({ context: "title", ...quality }),
  };
  // A build that cannot play offers neither Play nor a wait for a host: there is no host to wait for.
  if (!input.playable) view.developing = IN_DEVELOPMENT;
  else if (input.follower) view.waiting = WAITING_FOR_HOST;
  else view.play = input.launching ? { label: LOADING, busy: true } : { label: PLAY };
  return view;
}
