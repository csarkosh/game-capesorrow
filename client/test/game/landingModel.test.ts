import { describe, expect, it } from "vitest";
import { WALK_MODES } from "../../src/game.js";
import { landingModel, landingPanelFocus } from "../../src/game/landingModel.js";
import { CREDITS, IN_DEVELOPMENT, LOADING, PLAY, SETTINGS, WAITING_FOR_HOST } from "../../src/game/words.js";

describe("landingModel", () => {
  it("says the game is in development and offers Play under it, then Settings and Credits", () => {
    const view = landingModel({});
    expect(view.developing).toBe(IN_DEVELOPMENT);
    expect(view.developing).toBe("In development.");
    expect(view.play).toEqual({ label: PLAY });
    expect(view.play?.label).toBe("Play");
    expect(view.waiting).toBeUndefined();
    expect(view.settings).toEqual({ label: "Settings" });
    expect(view.credits).toEqual({ label: "Credits" });
    expect([SETTINGS, CREDITS]).toEqual(["Settings", "Credits"]);
  });

  it("turns Play into a disabled Loading… the moment it is pressed, the line still above it", () => {
    const view = landingModel({ launching: true });
    expect(view.play).toEqual({ label: LOADING, busy: true });
    expect(LOADING).toBe("Loading…");
    expect(view.developing).toBe(IN_DEVELOPMENT);
  });

  it("replaces Play with a waiting line for a follower, who is still waiting while the world loads", () => {
    for (const launching of [false, true]) {
      const view = landingModel({ follower: true, launching });
      expect(view.play).toBeUndefined();
      expect(view.waiting).toBe(WAITING_FOR_HOST);
      expect(view.developing).toBe(IN_DEVELOPMENT);
    }
    expect(WAITING_FOR_HOST).toBe("Waiting for the host…");
  });

  it("offers Play whatever the build was given: a game with no server yet is played alone", () => {
    // The build's variables are no input of the model's at all; the engine's shell hides the party where there is no server.
    expect(Object.keys(landingModel({})).sort()).toEqual(["credits", "developing", "play", "settings", "settingsPage"]);
  });
});

describe("the Settings entry", () => {
  it("is on every build, for a follower too, and carries the title screen's Settings page", () => {
    for (const input of [{}, { launching: true }, { follower: true }]) {
      const view = landingModel(input);
      expect(view.settings).toEqual({ label: "Settings" });
      expect(view.settingsPage.heading).toBe("Settings");
      expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([true, false, false, false]);
      expect(view.settingsPage.mode.choices).toEqual([{ mode: "walk", label: "Walk", selected: true, disabled: false }]);
    }
  });

  it("paints the player's choice and Auto's pick on the Settings page, in the game's words for a session", () => {
    const view = landingModel({
      quality: { choice: "low", auto: { tier: "medium", probePending: false }, override: null, stored: true, modes: WALK_MODES },
    });
    expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([false, false, false, true]);
    expect(view.settingsPage.lines).toEqual(["Auto picks Medium on this computer."]);
    expect(view.settingsPage.apply).toBe(undefined);
    const pending = landingModel({
      quality: { choice: "auto", auto: { tier: "medium", probePending: true }, override: null, stored: true, modes: WALK_MODES },
    });
    expect(pending.settingsPage.lines).toEqual(["Auto tests this computer when your next case starts."]);
  });
});

describe("landingPanelFocus", () => {
  it("leaves only the panel showing reachable, so no hidden control can be tabbed to or pressed", () => {
    expect(landingPanelFocus(null, "home").inert).toEqual(["settings", "credits"]);
    expect(landingPanelFocus("home", "settings").inert).toEqual(["home", "credits"]);
    expect(landingPanelFocus("home", "credits").inert).toEqual(["home", "settings"]);
  });

  it("takes focus into a panel as it opens and back to its entry as it closes, and not on a page load", () => {
    expect(landingPanelFocus("home", "settings").focus).toEqual({ into: "settings" });
    expect(landingPanelFocus("settings", "home").focus).toEqual({ entry: "settings" });
    expect(landingPanelFocus("credits", "home").focus).toEqual({ entry: "credits" });
    expect(landingPanelFocus(null, "settings").focus).toBe(null);
    expect(landingPanelFocus("home", "home").focus).toBe(null);
  });
});
