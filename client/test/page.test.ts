import { describe, expect, it } from "vitest";
import { createPortAshtonPage, PORTASHTON_PAGE } from "../src/page.js";
import { PORTASHTON_IDENTITY } from "../src/identity.js";
import { creditsEntries } from "../src/game/credits.js";
import { WALK_MODES } from "../src/game.js";

/**
 * Port Ashton's page definition and its own of the page, as far as they can be held without a
 * DOM: what the shell reads of the definition, and what the page side does before a title page is
 * up. The title page's decisions are in `game/landingModel.test.ts`.
 */

/** The little of the shell's host the page side reads while no title page is up: the telemetry a saved mode is told to. */
function fakeHost() {
  const events: { name: string; data: unknown }[] = [];
  const host = { telemetry: { event: (name: string, data: unknown) => events.push({ name, data }) } };
  return { host: host as never, events };
}

describe("Port Ashton's identity", () => {
  it("is the game's name, the word for a session, a nameless player, its storage prefix and its desktop token", () => {
    // `storage` keeps the game's former name on purpose: saved settings are stored in the browser under it.
    expect(PORTASHTON_IDENTITY).toEqual({ title: "Something’s Haunting Port Ashton", session: "case", player: "Detective", storage: "capesorrow", desktop: "PortAshton" });
    expect(PORTASHTON_PAGE.identity).toBe(PORTASHTON_IDENTITY);
  });
});

describe("the page definition", () => {
  it("stands the page for those turned away on no still, and credits the works the Credits screen does", () => {
    expect(PORTASHTON_PAGE.away.still()).toBeNull();
    expect(PORTASHTON_PAGE.away.credits()).toEqual(creditsEntries());
    expect(PORTASHTON_PAGE.away.credits().length).toBeGreaterThan(0);
  });

  it("names its own of the page as the side the shell makes", () => {
    expect(PORTASHTON_PAGE.side).toBe(createPortAshtonPage);
  });
});

describe("the page side before a title page is up", () => {
  it("has no title page, and a panel's address or a repaint with none is nothing to do", () => {
    const side = createPortAshtonPage(fakeHost().host);
    expect(side.landingUp()).toBe(false);
    expect(() => side.showPanel({ kind: "settings" })).not.toThrow();
    expect(() => side.showPanel({ kind: "credits" })).not.toThrow();
    expect(() => side.repaint()).not.toThrow();
    expect(() => side.left()).not.toThrow();
    expect(() => side.turnedAway()).not.toThrow();
  });

  it("starts in the game's initial mode, keeps a mode of its list and tells telemetry, and ignores a value that is not one", () => {
    const { host, events } = fakeHost();
    const side = createPortAshtonPage(host);
    expect(side.mode()).toBe(WALK_MODES.initial);
    side.saveMode("not-a-mode");
    expect(events).toEqual([]);
    side.saveMode("walk");
    expect(events).toEqual([{ name: "settings", data: { mode: "walk" } }]);
    expect(side.mode()).toBe("walk");
  });

  it("plays nothing before a session and carries nothing into it", () => {
    const side = createPortAshtonPage(fakeHost().host);
    expect([side.carriesToGame(), side.openingFor(undefined as never, false), side.openingFor(undefined as never, true)]).toEqual([false, null, null]);
  });
});
