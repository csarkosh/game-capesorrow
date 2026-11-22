import { describe, expect, it } from "vitest";
import { WALK_MODES } from "../../src/game.js";
import { canPlay, landingModel, landingPanelFocus } from "../../src/game/landingModel.js";
import { CREDITS, IN_DEVELOPMENT, LOADING, PLAY, SETTINGS, WAITING_FOR_HOST } from "../../src/game/words.js";

describe("canPlay: whether the build can be played", () => {
  it("can on the dev server, whatever the build was given", () => {
    expect(canPlay({ DEV: true })).toBe(true);
    expect(canPlay({ DEV: true, VITE_SIGNALING_URL: "" })).toBe(true);
  });
  it("can in a production build given a signaling address", () => {
    expect(canPlay({ DEV: false, VITE_SIGNALING_URL: "wss://example.invalid/ws" })).toBe(true);
  });
  it("cannot in a production build with none, and an empty address is none, as the engine reads it", () => {
    expect(canPlay({ DEV: false })).toBe(false);
    expect(canPlay({ DEV: false, VITE_SIGNALING_URL: undefined })).toBe(false);
    expect(canPlay({ DEV: false, VITE_SIGNALING_URL: "" })).toBe(false);
    expect(canPlay({})).toBe(false);
  });
});

describe("landingModel where the build can play", () => {
  it("offers Play, then Settings and Credits, and says nothing of development", () => {
    const view = landingModel({ playable: true });
    expect(view.play).toEqual({ label: PLAY });
    expect(view.play?.label).toBe("Play");
    expect(view.waiting).toBeUndefined();
    expect(view.developing).toBeUndefined();
    expect(view.settings).toEqual({ label: "Settings" });
    expect(view.credits).toEqual({ label: "Credits" });
    expect([SETTINGS, CREDITS]).toEqual(["Settings", "Credits"]);
  });

  it("turns Play into a disabled Loading… the moment it is pressed", () => {
    const view = landingModel({ playable: true, launching: true });
    expect(view.play).toEqual({ label: LOADING, busy: true });
    expect(LOADING).toBe("Loading…");
  });

  it("replaces Play with a waiting line for a follower, who is still waiting while the world loads", () => {
    for (const launching of [false, true]) {
      const view = landingModel({ playable: true, follower: true, launching });
      expect(view.play).toBeUndefined();
      expect(view.waiting).toBe(WAITING_FOR_HOST);
      expect(view.developing).toBeUndefined();
    }
    expect(WAITING_FOR_HOST).toBe("Waiting for the host…");
  });
});

describe("landingModel where the build cannot play", () => {
  it("shows a quiet line in Play's place, and no button", () => {
    const view = landingModel({ playable: false });
    expect(view.developing).toBe(IN_DEVELOPMENT);
    expect(view.developing).toBe("In development.");
    expect(view.play).toBeUndefined();
    expect(view.waiting).toBeUndefined();
  });

  it("keeps Settings and Credits, and offers no wait and no loading either (there is no host and no world to load)", () => {
    for (const extra of [{}, { follower: true }, { launching: true }, { follower: true, launching: true }]) {
      const view = landingModel({ playable: false, ...extra });
      expect(view.developing).toBe(IN_DEVELOPMENT);
      expect(view.play).toBeUndefined();
      expect(view.waiting).toBeUndefined();
      expect(view.settings).toEqual({ label: "Settings" });
      expect(view.credits).toEqual({ label: "Credits" });
    }
  });
});

describe("the Settings entry", () => {
  it("is on every build, for a follower too, and carries the title screen's Settings page", () => {
    for (const input of [{ playable: true }, { playable: false }, { playable: true, follower: true }]) {
      const view = landingModel(input);
      expect(view.settings).toEqual({ label: "Settings" });
      expect(view.settingsPage.heading).toBe("Settings");
      expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([true, false, false, false]);
      expect(view.settingsPage.mode.choices).toEqual([{ mode: "walk", label: "Walk", selected: true, disabled: false }]);
    }
  });

  it("paints the player's choice and Auto's pick on the Settings page, in the game's words for a session", () => {
    const view = landingModel({
      playable: true,
      quality: { choice: "low", auto: { tier: "medium", probePending: false }, override: null, stored: true, modes: WALK_MODES },
    });
    expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([false, false, false, true]);
    expect(view.settingsPage.lines).toEqual(["Auto picks Medium on this computer."]);
    expect(view.settingsPage.apply).toBe(undefined);
    const pending = landingModel({
      playable: true,
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
