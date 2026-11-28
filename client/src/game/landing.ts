/** The title page, in Day Hike's visual language: the same dark ground, type and button slabs. */
/** The title's colour: cream, warm against the cold cast of the controls. */
export const TITLE_CREAM = "#ede4cc";
/** The title's red: a horror poster's headline red, the colour of the reference's type. */
export const TITLE_RED = "#bc0708";

/** The page's stylesheet, exported so a test can read it without a DOM. */
export const LANDING_STYLE = `
  .landing {
    /* The positioning context for the panels below; they carry the layout and the scrolling,
       because each panel is the box that holds the content a short viewport has to scroll. */
    position: relative; height: 100%;
    /* A soft vignette over the still and the film behind it (and over the flat #101014 where there
       is none), darkening towards the edges so the buttons keep their contrast over a bright frame. */
    z-index: 1;
    background: radial-gradient(
      ellipse at center,
      rgba(16, 16, 20, 0.35) 0%,
      rgba(16, 16, 20, 0.78) 100%
    );
    font-family: ui-monospace, monospace; color: #fff;

    /* The title's cream, which every control on this screen is drawn in. */
    --btn-sheen: linear-gradient(rgba(245, 238, 221, 0.16), rgba(237, 228, 204, 0));
    --btn-fill: rgba(237, 228, 204, 0.10);
    --btn-fill-lit: rgba(241, 233, 212, 0.20);
    --btn-fill-hit: rgba(246, 240, 225, 0.32);
    --btn-edge: rgba(237, 228, 204, 0.30);
    --btn-edge-lit: rgba(241, 233, 212, 0.58);
    --btn-rim: inset 0 1px 0 rgba(245, 238, 221, 0.30);
    --btn-bloom: rgba(237, 228, 204, 0.24);
    /* The filled slab every button is: the title's cream itself, lighter under the pointer and the press. */
    --btn-solid: rgb(237, 228, 204);
    --btn-solid-lit: rgb(246, 239, 221);
    --btn-solid-hit: rgb(251, 247, 236);
    /* The dark slab the secondary buttons are: Play's label colour, lifted a step under the pointer and the press. */
    --btn-dark: rgb(12, 15, 17);
    --btn-dark-lit: rgb(30, 31, 32);
    --btn-dark-hit: rgb(44, 44, 42);
  }
  /* The film and its still cover the page behind the title, centred and cropped, never stretched.
     The still fades out (class gone) once the film can play through. */
  .landing-loop, .landing-bg {
    position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0;
    object-fit: cover; object-position: center; pointer-events: none;
  }
  .landing-bg { transition: opacity 0.6s ease; }
  .landing-bg.gone { opacity: 0; }
  /* Three panels in the same box: home slides out to the left as a panel slides in from the
     right, and back reverses it. All are absolutely positioned so the swap never shifts layout. */
  /* Each panel scrolls itself. index.html hides the document's overflow, so a viewport too short
     for a panel's content (a phone held sideways) would clip it with nothing to scroll. A panel is
     exactly one viewport tall (inset: 0 on a full-height parent) and takes the overflow, and the
     safe keyword keeps the centred layout wherever there is room while falling back to flex-start
     when there is not, so the top stays reachable rather than scrolled off. */
  .landing .panel {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center;
    justify-content: safe center; gap: 0.75rem;
    overflow-y: auto; box-sizing: border-box; padding: 1rem 0;
    transition: opacity 240ms ease-out, transform 240ms ease-out;
  }
  .landing .panel.home { opacity: 1; transform: translateX(0); }
  .landing.show-credits .panel.home, .landing.show-settings .panel.home {
    opacity: 0; transform: translateX(-24px); pointer-events: none;
  }
  .landing .panel.credits, .landing .panel.settings {
    opacity: 0; transform: translateX(24px); pointer-events: none;
  }
  .landing.show-credits .panel.credits, .landing.show-settings .panel.settings {
    opacity: 1; transform: translateX(0); pointer-events: auto;
  }
  .landing .panel.credits h2, .landing .panel.settings h2 {
    margin: 0; font-size: 1.4rem; letter-spacing: 0.1em; text-transform: uppercase;
  }
  /* The credits list scrolls, and shows part of itself at a time. The soft fade at the bottom edge
     reads as "this continues"; the trailing padding is what it eats when the list is scrolled to
     its end, so the last credit is never the thing being faded out. */
  .landing ul.credits {
    list-style: none; margin: 0; padding: 0 1rem 1.5rem; max-width: 40rem; max-height: 60vh;
    overflow-y: auto; font-size: 0.85rem; line-height: 1.6; color: rgba(255, 255, 255, 0.75);
    scrollbar-width: thin; scrollbar-gutter: stable;
    scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 1.5rem), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 1.5rem), transparent 100%);
  }
  .landing ul.credits a { color: rgba(255, 255, 255, 0.9); text-decoration: underline; text-underline-offset: 0.2em; }
  /* The list is a tab stop (the engine's credits screen sets tabIndex) so it can be scrolled from
     the keyboard; that stop has to be visible when it is reached. */
  .landing ul.credits:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 4px; }
  /* Secondary: a dark slab with a cream label and a faint cream edge, so Play is the only light
     shape on the screen; it lightens under the pointer and the press. */
  .landing button.secondary {
    margin-top: 0.25rem; padding: 0.4rem 1.25rem; font-size: 0.85rem; color: ${TITLE_CREAM};
    background-image: none; background-color: var(--btn-dark);
    border-color: var(--btn-edge);
    box-shadow: var(--btn-rim), 0 0 0 rgba(237, 228, 204, 0);
  }
  .landing button.secondary:hover:not(:disabled) {
    background-color: var(--btn-dark-lit); border-color: var(--btn-edge-lit);
    box-shadow: var(--btn-rim), 0 0 14px var(--btn-bloom);
  }
  .landing button.secondary:active:not(:disabled) {
    background-color: var(--btn-dark-hit); border-color: var(--btn-edge-lit);
    box-shadow: var(--btn-rim), 0 0 6px var(--btn-bloom);
  }
  /* The title in two parts, set as a horror poster's headline is: the heaviest wide sans there is
     on the machine (Arial Black on macOS and Windows; elsewhere the heaviest sans), italic, in
     capitals, letter-spaced tight and leaded tighter, in one saturated red. The lead is smaller and
     on one line above the name. No font is fetched for it: nothing is loaded before Play but the
     title's still and film. */
  .landing h1 {
    margin: 0 0 0.25rem; display: flex; flex-direction: column; align-items: center;
    font-family: "Arial Black", "Helvetica Neue", Arial, sans-serif;
    font-weight: 900; font-style: italic; line-height: 0.88; color: ${TITLE_RED};
    text-align: center; text-transform: uppercase;
  }
  .landing h1 .title-lead {
    font-size: clamp(1.1rem, 3vw, 2rem); letter-spacing: -0.03em; white-space: nowrap;
  }
  /* The name is drawn tall: stretched 2 times by a transform, which leaves its layout box as it
     was, so its margins give the stretch its room, (2 - 1) / 2 of its 0.88em line above and below. */
  .landing h1 .title-name {
    display: block; margin: 0.44em 0; font-size: clamp(2.6rem, 9vw, 6rem);
    letter-spacing: -0.05em; overflow-wrap: anywhere;
    transform: scaleY(2); transform-origin: center;
  }
  .landing p {
    margin: 0; max-width: 32rem; text-align: center;
    /* Alpha lives in the colour rather than in the opacity property, so a parent opacity does not cap what is inside it. */
    color: rgba(255, 255, 255, 0.62);
    /* Display copy: balance the rag rather than filling line one greedily. */
    text-wrap: balance;
  }
  /* The primary button: filled with the subtitle's colour, held below its alpha, so the slab does
     not outshout the title. The label takes the page's ground colour to stay legible on it, and
     the border matches the fill so the shape reads as a slab rather than an outline with
     something inside. The rim-light along its top edge is what stops a flat slab reading as a
     sticker. */
  .landing button {
    margin-top: 1.25rem; padding: 0.6rem 2rem; font: inherit; font-size: 1rem;
    cursor: pointer; color: #0c0f11;
    /* The title's vocabulary, carried down onto the controls. */
    letter-spacing: 0.12em; text-transform: uppercase;
    /* A fixed gradient over an animated flat colour: only background-color moves between states,
       which interpolates cleanly and costs nothing, while the sheen keeps the slab from reading as
       a flat wash. */
    background-image: linear-gradient(rgba(255, 255, 255, 0.20), rgba(237, 228, 204, 0));
    background-color: var(--btn-solid);
    border: 1px solid var(--btn-solid); border-radius: 4px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 0 0 rgba(237, 228, 204, 0);
    transition:
      background-color 160ms ease-out, border-color 160ms ease-out,
      box-shadow 160ms ease-out, transform 160ms ease-out;
  }
  .landing button:hover:not(:disabled) {
    background-color: var(--btn-solid-lit); border-color: var(--btn-solid-lit);
    /* Mist-light caught on the slab: a pale bloom. */
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 22px var(--btn-bloom);
    transform: translateY(-1px);
  }
  /* A finger gets no hover: the press itself has to show, and so does the wait that follows it.
     Faster than the rise, so the press reads as mechanical rather than soft. */
  .landing button:active:not(:disabled) {
    background-color: var(--btn-solid-hit); border-color: var(--btn-solid-hit);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 8px var(--btn-bloom);
    transform: translateY(1px);
    transition-duration: 70ms;
  }
  /* Every control here is keyboard-reachable and shows focus. */
  .landing button:focus-visible { outline: 2px solid var(--btn-edge-lit); outline-offset: 3px; }
  .landing button:disabled {
    cursor: default; color: rgba(12, 15, 17, 0.7);
    background-color: rgba(237, 228, 204, 0.45); border-color: rgba(237, 228, 204, 0.45);
    box-shadow: none; transform: none;
  }
  /* Sits below the button rules on purpose: a media query carries no extra specificity, so these
     overrides win on source order alone. */
  @media (prefers-reduced-motion: reduce) {
    .landing .panel { transition: none; }
    /* Colour still moves under the pointer; the slab no longer does. */
    .landing button:hover:not(:disabled), .landing button:active:not(:disabled) { transform: none; }
  }
  /* A follower's wait, in Play's place; and the line that says the game is in development, small
     and close under Play (or the wait). The secondary buttons stand apart below it. */
  .landing .waiting { margin-top: 1.25rem; }
  .landing .developing { margin-top: -0.35rem; font-size: 0.75rem; }
  .landing .developing + button.secondary { margin-top: 0.75rem; }
  /* Phone widths: the title, copy and buttons scale to a 400 px screen with 16 px gutters and
     nothing wider than the viewport. */
  @media (max-width: 480px) {
    /* The roster is a fixed full-width panel at the bottom here (the engine's roster), and
       publishes its height; leaving that much room keeps every panel's last control (Back, the
       last credit) above it however big the party. */
    .landing .panel { padding: 1rem 1rem calc(var(--roster-height, 0px) + 1.5rem + 1.0625rem + 0.5rem); gap: 0.6rem; }
    .landing h1 .title-lead { font-size: clamp(0.8rem, 4.4vw, 1.1rem); }
    .landing h1 .title-name { font-size: clamp(1.8rem, 10vw, 3rem); }
    .landing p { font-size: 0.85rem; max-width: 100%; }
    .landing button { width: 100%; max-width: 20rem; margin-top: 0.75rem; }
    .landing button.secondary { width: auto; }
  }
`;

import { renderCredits } from "@csarkosh/engine/game/credits";
import { openerOf, renderSettings, type Opener } from "@csarkosh/engine/game/settings";
import type { TierChoice } from "@csarkosh/engine/game/tierChoice";
import { creditsEntries } from "./credits.js";
import { landingPanelFocus, type LandingPanel, type LandingView } from "./landingModel.js";
import { TITLE_LEAD, TITLE_NAME } from "./words.js";

export type { LandingPanel } from "./landingModel.js";

export type LandingHandle = {
  setView(view: LandingView): void;
  /** Swaps panels in place. The shell calls this (through the page) instead of rebuilding the page,
   * because a rebuild would replace the nodes mid-transition and kill it. */
  setPanel(panel: LandingPanel): void;
  dispose(): void;
};

/**
 * Built with DOM APIs rather than innerHTML on purpose: textContent makes injection structurally
 * impossible instead of depending on every future caller remembering to escape.
 *
 * Paints a `LandingView` and repaints on `setView`: the page changes while it is showing (Play
 * becomes Loading…, a lobby makes a follower). Everything below the title is rebuilt each time; the
 * title is not, so they never flicker.
 */
export function renderLanding(
  container: HTMLElement,
  view: LandingView,
  handlers: {
    onCreate(): void;
    onSettings(): void;
    /** A choice picked on the Settings panel: kept at once, for the world Play starts. */
    onChooseTier(choice: TierChoice): void;
    onChooseMode(mode: string): void;
    onCredits(): void;
    onBack(): void;
  },
  panel: LandingPanel = "home",
): LandingHandle {
  // Appends rather than clearing: the shell owns the container.
  const style = document.createElement("style");
  style.textContent = LANDING_STYLE;

  const root = document.createElement("div");
  root.className = "landing";

  const title = document.createElement("h1");
  const lead = document.createElement("span");
  lead.className = "title-lead";
  lead.textContent = TITLE_LEAD;
  const name = document.createElement("span");
  name.className = "title-name";
  name.textContent = TITLE_NAME;
  // The space between keeps the heading's text the whole title for a screen reader and a copy.
  title.append(lead, " ", name);

  const dynamic = document.createElement("div");
  dynamic.style.display = "contents";

  const home = document.createElement("div");
  home.className = "panel home";
  home.append(title, dynamic);

  // Built once, up front: the entries come from a build-time import, so there is nothing to wait
  // for, and having the panel already in the DOM is what lets the class toggle animate rather
  // than pop.
  const credits = document.createElement("div");
  credits.className = "panel credits";
  renderCredits(credits, creditsEntries(), handlers.onBack);

  // The Settings panel, painted by the engine's Settings screen and repainted with the view: Auto's
  // pick lands once the GPU's signals are in.
  const settings = document.createElement("div");
  settings.className = "panel settings";
  const settingsUi = renderSettings(settings, view.settingsPage, {
    onChoose: handlers.onChooseTier,
    onChooseMode: handlers.onChooseMode,
    onBack: handlers.onBack,
  });

  root.append(home, settings, credits);
  // How the Settings button was last pressed, taken once by the panel's opening: the panel is
  // reached otherwise too (the browser's Forward), and with no press to go by it opens as for a
  // pointer.
  let settingsOpener: Opener = "pointer";
  const takeSettingsOpener = (): Opener => {
    const how = settingsOpener;
    settingsOpener = "pointer";
    return how;
  };
  const panels: Record<LandingPanel, HTMLElement> = { home, settings, credits };
  /** Where focus lands inside each panel as it opens. */
  const into: Record<LandingPanel, () => HTMLElement | null> = {
    home: () => null,
    settings: () => settingsUi.entry(takeSettingsOpener()),
    credits: () => credits.querySelector<HTMLElement>("ul.credits"),
  };
  let showing: LandingPanel | null = null;
  function showPanel(next: LandingPanel): void {
    root.classList.toggle("show-settings", next === "settings");
    root.classList.toggle("show-credits", next === "credits");
    const moved = landingPanelFocus(showing, next);
    showing = next;
    for (const name of Object.keys(panels) as LandingPanel[]) panels[name].inert = moved.inert.includes(name);
    if (moved.focus === null) return;
    if ("into" in moved.focus) into[moved.focus.into]()?.focus();
    else home.querySelector<HTMLElement>(`button.secondary.${moved.focus.entry}`)?.focus();
  }
  showPanel(panel);

  function paint(v: LandingView): void {
    const parts: Node[] = [];

    if (v.play !== undefined) {
      const button = document.createElement("button");
      button.id = "create";
      button.type = "button";
      button.textContent = v.play.label;
      button.disabled = v.play.busy === true;
      button.addEventListener("click", handlers.onCreate);
      parts.push(button);
    }
    if (v.waiting !== undefined) {
      const waiting = document.createElement("p");
      waiting.className = "waiting";
      waiting.textContent = v.waiting;
      parts.push(waiting);
    }
    // Under Play: the game says, small, that it is in development.
    const developing = document.createElement("p");
    developing.className = "developing";
    developing.textContent = v.developing;
    parts.push(developing);

    // Beneath the primary action, set apart from it: Settings, then Credits.
    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "secondary settings";
    settingsButton.textContent = v.settings.label;
    settingsButton.addEventListener("click", (e) => {
      settingsOpener = openerOf(e);
      handlers.onSettings();
    });
    parts.push(settingsButton);
    const creditsButton = document.createElement("button");
    creditsButton.type = "button";
    creditsButton.className = "secondary credits";
    creditsButton.textContent = v.credits.label;
    creditsButton.addEventListener("click", handlers.onCredits);
    parts.push(creditsButton);

    dynamic.replaceChildren(...parts);
    settingsUi.setView(v.settingsPage);
  }

  paint(view);
  container.append(style, root);

  return {
    setView: paint,
    setPanel(next) {
      showPanel(next);
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
