import { afterEach, describe, expect, it, vi } from "vitest";
import { asHtml, installStandInDom, type StandInVideo } from "@csarkosh/engine/testing/standInDom";
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
    expect(PORTASHTON_IDENTITY).toEqual({ title: "Something Haunts Port Ashton", session: "case", player: "Detective", storage: "capesorrow", desktop: "PortAshton" });
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

describe("the film behind the title page", () => {
  const FILM = { url: null as string | null, still: null as string | null };
  const fast = { effectiveType: "4g", saveData: false };

  /** A page side with a title page up on a stand-in container, the title assets and the title page's own drawing stubbed. */
  async function landingWith(video: string | null, still: string | null, connection = fast) {
    vi.resetModules();
    const doc = installStandInDom();
    vi.stubGlobal("navigator", { connection });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("location", { search: "" });
    FILM.url = video;
    FILM.still = still;
    vi.doMock("../src/game/titleAssets.js", () => ({ titleVideoUrl: () => FILM.url, titleStillUrl: () => FILM.still }));
    vi.doMock("../src/game/landing.js", () => ({ renderLanding: () => ({ dispose: () => undefined, setView: () => undefined, setPanel: () => undefined }) }));
    const { createPortAshtonPage: make } = await import("../src/page.js");
    const host = {
      telemetry: { event: () => undefined }, lobby: null, launching: false,
      currentChoice: () => "auto", autoSummary: () => "", choiceStored: () => false, choiceNotice: null,
    };
    const side = make(host as never);
    const container = doc.createElement("div");
    const shell = { play: () => undefined, join: () => false, toPanel: () => undefined, chooseTier: () => undefined, back: () => undefined };
    return { doc, side, container, handle: side.showLanding(asHtml(container) as HTMLDivElement, { kind: "home" } as never, shell as never) };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../src/game/titleAssets.js");
    vi.doUnmock("../src/game/landing.js");
  });

  it("adds no video and no image while neither file exists", async () => {
    const { container } = await landingWith(null, null);
    expect(container.children.length).toBe(0);
  });

  it("lays an image with the still and a video, both from the assets", async () => {
    const { container } = await landingWith("/title-Ab12.mp4", "/title.still-Cd34.webp");
    expect(container.children.map((c) => c.tagName).sort()).toEqual(["IMG", "VIDEO"]);
    expect(container.children.find((c) => c.tagName === "IMG")!.getAttribute("src")).toBe("/title.still-Cd34.webp");
  });

  it("holds the film back before load, and fetches it after", async () => {
    vi.resetModules();
    const doc = installStandInDom();
    doc.readyState = "loading";
    vi.stubGlobal("navigator", { connection: fast });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("location", { search: "" });
    vi.doMock("../src/game/titleAssets.js", () => ({ titleVideoUrl: () => "/title-Ab12.mp4", titleStillUrl: () => "/s.webp" }));
    vi.doMock("../src/game/landing.js", () => ({ renderLanding: () => ({ dispose: () => undefined, setView: () => undefined, setPanel: () => undefined }) }));
    const { createPortAshtonPage: make } = await import("../src/page.js");
    const side = make({ telemetry: { event: () => undefined }, lobby: null, launching: false, currentChoice: () => "auto", autoSummary: () => "", choiceStored: () => false } as never);
    const container = doc.createElement("div");
    side.showLanding(asHtml(container) as HTMLDivElement, { kind: "home" } as never, {} as never);
    const video = container.children.find((c) => c.tagName === "VIDEO") as StandInVideo;
    expect(video.getAttribute("src")).toBeNull();
    doc.finishLoading();
    expect(video.getAttribute("src")).toBe("/title-Ab12.mp4");
  });

  it("never fetches the film on save-data or a slow connection", async () => {
    for (const connection of [{ effectiveType: "4g", saveData: true }, { effectiveType: "2g", saveData: false }]) {
      const { container } = await landingWith("/title-Ab12.mp4", "/s.webp", connection);
      const video = container.children.find((c) => c.tagName === "VIDEO") as StandInVideo;
      expect(video.getAttribute("src")).toBeNull();
    }
  });

  it("stops the film at Play, and removes both when the page is left", async () => {
    const { side, container, handle } = await landingWith("/title-Ab12.mp4", "/s.webp");
    const video = container.children.find((c) => c.tagName === "VIDEO") as StandInVideo;
    expect(video.getAttribute("src")).toBe("/title-Ab12.mp4");
    side.played();
    expect(video.getAttribute("src")).toBeNull();
    handle.dispose();
    expect(container.children.length).toBe(0);
  });
});
