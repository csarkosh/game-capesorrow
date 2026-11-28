import "../../src/terrain.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { StandInDocument, StandInElement, type StandInEvent, asHtml, installStandInDom } from "@csarkosh/engine/testing/standInDom";
import { createWalkHud } from "../../src/hud.js";
import { mapDataFor } from "../../src/game/map/mapData.js";
import type { MapFrame } from "../../src/game/map/mapFeed.js";
import { CSS } from "../../src/game/map/mapCss.js";
import { LARGE_BYTES, SIZE, SIZE_NARROW, canvasScale, cornerRect, createMinimap, largeRect, type Minimap, type MinimapEnv } from "../../src/game/map/minimap.js";
import { mapAsk } from "../../src/game/map/mapCommand.js";
import { chooseDestination, nav, resetNav } from "../../src/game/map/mapNav.js";
import { paletteFor } from "../../src/game/map/mapStyle.js";
import { largeView, worldToScreen } from "../../src/game/map/mapView.js";
import { WATCH_SEEN, resetWatch } from "../../src/game/hand/watchSeen.js";
import { RecordingCtx } from "./fakes.js";

const SEED = 20261121;

type Listener = (e: Record<string, unknown>) => void;

/** A window of a size, with the keys it is sent, and a document to match: the minimap's whole page. */
function page(width: number, height: number, dpr = 2) {
  const doc: StandInDocument = installStandInDom();
  const container = doc.createElement("div");
  doc.body.append(container);
  const keys: Listener[] = [];
  const win = {
    innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    addEventListener: (type: string, fn: Listener) => { if (type === "keydown") keys.push(fn); },
    removeEventListener: (type: string, fn: Listener) => { if (type === "keydown") keys.splice(keys.indexOf(fn), 1); },
  };
  const ctx = new RecordingCtx();
  // These tests are of the corner screen, which is a car's (M switches it); the watch's own are below.
  WATCH_SEEN.on = true;
  let roster: StandInElement | null = null;
  const vars: Record<string, string> = {};
  let now = 100;
  const logs: unknown[][] = [];
  let canvas: StandInElement | null = null;
  const bigBox = { w: 0, h: 0 };
  const env: MinimapEnv = {
    doc: {
      createElement(tag: string) {
        const el = doc.createElement(tag);
        if (tag === "canvas") {
          canvas = el;
          Object.assign(el, { width: 300, height: 150, setPointerCapture: () => undefined, getBoundingClientRect: () => ({ left: 0, top: 0, width: bigBox.w || Number((el.style.width ?? "0").replace("px", "")), height: bigBox.h }) });
        }
        return el;
      },
      querySelector: (sel: string) => (sel === ".roster" ? roster : null),
      body: doc.body,
      documentElement: { style: { setProperty: (k: string, v: string) => { vars[k] = v; }, removeProperty: (k: string) => { delete vars[k]; } } },
    } as unknown as Document,
    win: win as never,
    now: () => now,
    clock: () => now * 1000,
    context: () => ctx,
    log: (...a) => logs.push(a),
  };
  const calls = { pause: 0 };
  const map: Minimap = createMinimap(asHtml(container), { onPause: () => calls.pause++ }, env);
  const frame = (over: Partial<MapFrame> = {}): MapFrame => ({ seed: SEED, x: -254.7, z: 83.5, heading: 0, driving: true, place: 0, hour: 12, engaged: true, touch: false, rtt: null, ...over });
  return {
    doc, container, win, ctx, map, calls, logs, frame,
    tick: (seconds: number) => { now += seconds; },
    canvas: () => canvas as StandInElement,
    setRoster: (r: StandInElement | null) => { roster = r; },
    vars,
    body: doc.body,
    key: (code: string, extra: Record<string, unknown> = {}) => { const e = { code, repeat: false, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...extra }; for (const k of [...keys]) k(e); return e; },
    big: (w: number, h: number) => { bigBox.w = w; bigBox.h = h; },
    root: () => map.info().root as unknown as StandInElement,
  };
}

/** A click as a page makes it: the stand-in's own has no `stopPropagation`. */
const clickOn = (el: StandInElement): void => {
  el.dispatch("click", { stopPropagation: () => undefined } as never);
};
const ptr = (x: number, y: number, id = 1): Partial<StandInEvent> => ({ clientX: x, clientY: y, pointerId: id, stopPropagation() {} }) as unknown as Partial<StandInEvent>;

afterEach(() => {
  vi.unstubAllGlobals();
  resetNav();
  resetWatch();
  mapAsk.watch = false;
  mapAsk.dash = false;
  mapAsk.open = false;
});

describe("the minimap on the screen", () => {
  it("is 220 px in the bottom right corner on a wide screen and 148 px on a narrow one, at most 2x in memory", () => {
    const wide = page(1440, 900, 3);
    wide.map.frame(wide.frame());
    expect(wide.map.info().rect).toEqual(cornerRect(1440, 900, SIZE));
    expect(wide.map.info().rect).toEqual({ left: 1440 - 12 - 8 - 220, top: 900 - 12 - 28 - 220, width: 220, height: 220 });
    // A device pixel ratio of 3 is drawn at 2: under a megabyte.
    expect(wide.map.info().canvas).toEqual({ width: 440, height: 440 });
    expect(440 * 440 * 4).toBeLessThan(1_000_000);
    const narrow = page(400, 800, 2);
    narrow.map.frame(narrow.frame());
    expect(narrow.map.info().rect).toEqual({ left: 400 - 12 - 8 - 148, top: 800 - 12 - 28 - 148, width: 148, height: 148 });
    expect(SIZE_NARROW).toBe(148);
    // The corner keeps clear of a notch and a home bar, and is a rounded square with an edge and a shadow.
    expect(wide.root().style.left).toContain("env(safe-area-inset-right");
    expect(CSS).toMatch(/\.capemap \{[^}]*border-radius: 14px[^}]*border: 1px solid[^}]*box-shadow/);
    expect(CSS).toMatch(/\.capemap\.corner \{[^}]*border: none[^}]*box-shadow: none/);
  });

  it("takes no pointer while playing on a desktop, a tap on a touch screen, and shows from the first frame with a player to none without", () => {
    const p = page(1440, 900);
    expect(p.root().style.display).toBe("none");
    p.map.frame(p.frame());
    expect(p.root().style.display).toBe("");
    expect(p.root().classList.contains("tappable")).toBe(false);
    expect(CSS).toMatch(/\.capemap \{[^}]*pointer-events: none/);
    p.map.frame(p.frame({ touch: true }));
    expect(p.root().classList.contains("tappable")).toBe(true);
    // A tap on the map opens the large one, by the HUD's own pause hook.
    clickOn(p.root());
    expect(p.calls.pause).toBe(1);
    p.map.frame(null);
    expect(p.root().style.display).toBe("none");
  });

  it("costs nothing with no local player: no drawing, and a first frame is the first it draws", () => {
    const p = page(1440, 900);
    for (let i = 0; i < 5; i++) p.map.frame(null);
    expect(p.ctx.ops).toBe(0);
    expect(p.ctx.rec.paths).toBe(0);
    p.map.frame(p.frame());
    expect(p.ctx.ops).toBeGreaterThan(10);
  });

  it("is the large map while the game is paused: the right of the screen, over the pause menu, the canvas large only then", () => {
    const p = page(1440, 900);
    p.big(844, 860);
    p.map.frame(p.frame());
    expect(p.root().classList.contains("paused")).toBe(false);
    expect(CSS).toMatch(/\.capemap \{[^}]*z-index: 16/);
    expect(CSS).toMatch(/\.capemap\.paused \{[^}]*z-index: 19/);
    p.tick(1);
    p.map.frame(p.frame({ engaged: false }));
    expect(p.map.info().paused).toBe(true);
    expect(p.root().classList.contains("paused")).toBe(true);
    expect(p.container.classList.contains("capemap-open")).toBe(true);
    expect(p.map.info().rect).toEqual({ left: 576, top: 20, width: 844, height: 860 });
    const s = canvasScale(844, 860, 2, LARGE_BYTES);
    const { width, height } = p.map.info().canvas;
    expect([width, height]).toEqual([Math.round(844 * s), Math.round(860 * s)]);
    expect(width * height * 4).toBeLessThan(10_000_000);
    // Resumed, it goes back to the corner and the small canvas.
    p.tick(1);
    p.map.frame(p.frame({ engaged: true }));
    expect(p.map.info().paused).toBe(false);
    expect(p.root().classList.contains("paused")).toBe(false);
    expect(p.container.classList.contains("capemap-open")).toBe(false);
    expect(p.map.info().canvas).toEqual({ width: 440, height: 440 });
    expect(p.map.info().rect).toEqual(cornerRect(1440, 900, 220));
  });

  it("is not the large map before play has had the controls once (a start waiting for its first click)", () => {
    const p = page(1440, 900);
    p.map.frame(p.frame({ engaged: false }));
    expect(p.map.info().paused).toBe(false);
  });

  it("lays the large map out as the top 56 percent on a screen under 720 px, and from 40 percent of the width on a wide one", () => {
    expect(largeRect(1440, 900)).toEqual({ left: 576, top: 20, width: 844, height: 860 });
    expect(largeRect(1000, 700)).toEqual({ left: 400, top: 20, width: 580, height: 660 });
    expect(largeRect(600, 900)).toEqual({ left: 20, top: 20, width: 560, height: 484 });
    expect(largeRect(719, 1000).left).toBe(20);
    expect(largeRect(720, 1000).left).toBe(288);
    expect(CSS).toContain(".capemap-open .pausemenu.open { box-sizing: border-box; padding-right: 60%; }");
    expect(CSS).toMatch(/@media \(max-width: 719px\) \{\s*\.capemap-open \.pausemenu\.open \{ padding-right: 0; padding-top: 56vh; \}/);
  });

  it("opens the large map on Tab while play has the controls, and on no other press", () => {
    const p = page(1440, 900);
    p.map.frame(p.frame());
    const tab = p.key("Tab");
    expect(p.calls.pause).toBe(1);
    expect(tab.defaultPrevented).toBe(true);
    p.key("KeyW");
    p.key("Tab", { repeat: true });
    expect(p.calls.pause).toBe(1);
    // Not while paused already, and not with the map hidden.
    p.tick(1);
    p.map.frame(p.frame({ engaged: false }));
    p.key("Tab");
    expect(p.calls.pause).toBe(1);
    p.map.frame(null);
    p.key("Tab");
    expect(p.calls.pause).toBe(1);
  });

  it("is told of Tab by the HUD's hook: pausing is the HUD's own", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    let paused = 0;
    const hud = createWalkHud(asHtml(container), { onPause: () => paused++ });
    hud.setMap(null);
    hud.dispose();
    expect(paused).toBe(0);
    expect(container.querySelector("div.capemap")).toBeNull();
  });

  it("leans on the engine's pause menu only through names that are still there", () => {
    const src = readFileSync(new URL("../../../node_modules/@csarkosh/engine/src/game/pauseMenu.ts", import.meta.url), "utf8");
    for (const needle of [".pausemenu {", ".pausemenu.open {", ".pausemenu .panel {", "justify-content: center", "z-index: 18"]) expect(src, needle).toContain(needle);
    // The map's z-index over the menu's and under the roster's.
    expect(19).toBeGreaterThan(18);
    const roster = readFileSync(new URL("../../../node_modules/@csarkosh/engine/src/game/roster.ts", import.meta.url), "utf8");
    expect(roster).toContain("z-index: 20");
  });
});

describe("the large map's controls", () => {
  /** A paused page with the player standing at the municipal building's door, so that its pin is at the map's middle. */
  function paused() {
    const p = page(1440, 900);
    const hall = mapDataFor(SEED).places.find((q) => q.kind === "office")!;
    p.big(844, 860);
    p.map.frame(p.frame({ x: hall.x, z: hall.z }));
    p.tick(1);
    p.map.frame(p.frame({ x: hall.x, z: hall.z, engaged: false }));
    resetNav(SEED);
    const view = largeView({ look: 0, lookGoal: 0, night: 0, nightGoal: 0, lcx: hall.x, lcz: hall.z, lmpp: 420 / 220 }, 844, 860);
    const at = (x: number, z: number) => worldToScreen(view, x, z, { x: 0, y: 0 });
    const press = (x: number, y: number, to: { x: number; y: number } = { x, y }): void => {
      const c = p.canvas();
      c.dispatch("pointerdown", ptr(x, y));
      c.dispatch("pointermove", ptr(to.x, to.y));
      c.dispatch("pointerup", ptr(to.x, to.y));
      // Clicks are more than a double click's time apart.
      p.tick(1);
    };
    return { p, hall, view, at, press };
  }

  it("makes a place the destination on a click on its pin", () => {
    const { hall, at, press, p } = paused();
    const s = at(hall.x, hall.z);
    press(s.x, s.y - 8);
    expect(nav.dest).toEqual({ kind: "place", id: hall.id });
    expect(nav.waypoints).toHaveLength(0);
    p.map.frame(p.frame({ x: hall.x, z: hall.z, engaged: false }));
  });

  it("places a waypoint elsewhere and makes it the destination, keeps five and drops the oldest, and removes one on a click on its flag", () => {
    const { at, hall, press } = paused();
    const s = at(hall.x, hall.z);
    const spots = [0, 1, 2, 3, 4, 5].map((i) => ({ x: s.x + 60 + i * 30, y: s.y + 120 }));
    for (const q of spots) press(q.x, q.y);
    expect(nav.waypoints).toHaveLength(5);
    expect(nav.dest).toEqual({ kind: "waypoint", id: 6 });
    expect(nav.waypoints.map((w) => w.id)).toEqual([2, 3, 4, 5, 6]);
    const w = nav.waypoints[4]!;
    const f = at(w.x, w.z);
    press(f.x + 3, f.y - 10);
    expect(nav.waypoints.map((v) => v.id)).toEqual([2, 3, 4, 5]);
    expect(nav.dest).toBeNull();
  });

  it("does neither on a drag, and pans the map by it", () => {
    const { at, hall, press, p } = paused();
    const s = at(hall.x, hall.z);
    press(s.x + 200, s.y + 200, { x: s.x + 260, y: s.y + 240 });
    expect(nav.waypoints).toHaveLength(0);
    expect(nav.dest).toBeNull();
    expect(p.root().classList.contains("dragging")).toBe(false);
  });

  it("zooms in on a double click and takes back the flag its first click placed", () => {
    const { at, hall, p } = paused();
    const s = at(hall.x, hall.z);
    const c = p.canvas();
    for (let i = 0; i < 2; i++) {
      c.dispatch("pointerdown", ptr(s.x + 150, s.y + 150));
      c.dispatch("pointerup", ptr(s.x + 150, s.y + 150));
      p.tick(0.1);
    }
    expect(nav.waypoints).toHaveLength(0);
    expect(nav.dest).toBeNull();
  });

  it("does not let a click on the map reach the canvas that would resume the game", () => {
    const { p } = paused();
    let stopped = 0;
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"]) {
      p.canvas().dispatch(type, { ...ptr(10, 10), stopPropagation: () => stopped++ } as never);
    }
    // The map's root stops each of them where it is, before the container and the window (the stand-in's dispatch does not model the stop, so it is counted).
    expect(stopped).toBeGreaterThanOrEqual(7);
  });

  it("lists the four places with a button each, and chooses one on a click", () => {
    const { p, hall } = paused();
    const rows = p.root().querySelectorAll("button").filter((b) => b.classList.contains("chosen") || b.querySelector("span.name") !== null);
    expect(rows).toHaveLength(4);
    clickOn(rows[3]!);
    expect(nav.dest).toEqual({ kind: "place", id: 4 });
    expect(hall.id).toBe(4);
    const labels = p.root().querySelectorAll("button").map((b) => b.getAttribute("aria-label")).filter((v) => v !== null);
    expect(labels).toEqual(["Zoom in", "Zoom out", "Centre on me", "Clear destination"]);
  });
});

describe("a fault in the map", () => {
  it("is logged once and hides the map, and the game's frame goes on", () => {
    const p = page(1440, 900);
    p.map.frame(p.frame());
    p.ctx.failNext = true;
    p.tick(1);
    expect(() => p.map.frame(p.frame({ x: 0, z: 0 }))).not.toThrow();
    expect(p.map.info().broken).toBe(true);
    expect(p.root().style.display).toBe("none");
    expect(p.logs).toHaveLength(1);
    const ops = p.ctx.ops;
    p.ctx.failNext = false;
    p.map.frame(p.frame({ x: 40, z: 40 }));
    p.map.frame(null);
    expect(p.ctx.ops).toBe(ops);
    expect(p.logs).toHaveLength(1);
  });
});

describe("when the minimap is drawn", () => {
  it("only when something it shows has changed, and at most 30 times a second", () => {
    const p = page(1440, 900);
    p.map.frame(p.frame());
    const first = p.ctx.ops;
    expect(first).toBeGreaterThan(0);
    // Nothing moved, a frame later: nothing is drawn.
    p.tick(0.05);
    p.map.frame(p.frame());
    expect(p.ctx.ops).toBe(first);
    // A pixel on (1.9 m a pixel driving), it is.
    p.tick(0.05);
    p.map.frame(p.frame({ x: -254.7 + 4 }));
    expect(p.ctx.ops).toBeGreaterThan(first);
    // Moving every frame at 200 a second: at most 30 draws in a second.
    const before = p.ctx.rec.rects;
    for (let i = 0; i < 200; i++) {
      p.tick(0.005);
      p.map.frame(p.frame({ x: -253 + i * 2.5 }));
    }
    expect(p.ctx.rec.rects - before).toBeLessThanOrEqual(31);
    expect(p.ctx.rec.rects - before).toBeGreaterThanOrEqual(25);
  });
});

describe("the console's map", () => {
  it("takes open, close and to <place>, and keeps open in the address but not close", async () => {
    const { MAP_COMMANDS } = await import("../../src/game/map/mapCommand.js");
    const spec = MAP_COMMANDS[0]!;
    for (const ok of [["open"], ["close"], ["watch"], ["unwatch"], ["dash"], ["undash"], ["to", "bar"], ["to", "cafe"], ["to", "lodging"], ["to", "office"]]) expect(spec.validate(ok), ok.join(" ")).toBeNull();
    for (const bad of [[], ["to"], ["to", "moon"], ["open", "x"], ["zoom"]]) expect(spec.validate(bad), bad.join(" ")).toMatch(/map takes/);
    expect(spec.scriptValue?.(["close"])).toBe(spec.defaultValue);
    expect(spec.scriptValue?.(["open"])).not.toBe(spec.defaultValue);
  });

  it("opens the large map without a pause, closes it, and makes a place the destination", async () => {
    const { askMap, mapAsk } = await import("../../src/game/map/mapCommand.js");
    const p = page(1440, 900);
    p.big(844, 860);
    p.map.frame(p.frame());
    expect(p.map.info().paused).toBe(false);
    askMap(["open"]);
    p.tick(1);
    p.map.frame(p.frame());
    expect(p.map.info().paused).toBe(true);
    expect(p.map.info().rect).toEqual(largeRect(1440, 900));
    expect(p.body.classList.contains("capemap-open")).toBe(true);
    askMap(["to", "cafe"]);
    p.tick(1);
    p.map.frame(p.frame());
    expect(nav.dest).toEqual({ kind: "place", id: 2 });
    expect(mapAsk.to).toBeNull();
    askMap(["close"]);
    p.tick(1);
    p.map.frame(p.frame());
    expect(p.map.info().paused).toBe(false);
    expect(p.body.classList.contains("capemap-open")).toBe(false);
  });
});

describe("what the handle says of drawing", () => {
  it("leaves the draw that builds paths out of the mean and the worst, and says what the build took", () => {
    const p = page(1440, 900);
    p.map.frame(p.frame());
    const g = globalThis as unknown as { __capeMap: { draw(): { meanMs: number; worstMs: number; counted: number; pathBuildMs: number; pathBuilds: number; draws: number } } };
    const first = g.__capeMap.draw();
    expect(first.draws).toBe(1);
    expect(first.pathBuilds).toBeGreaterThan(0);
    // The first draw built its tiles: it is not in what is counted.
    expect(first.counted).toBe(0);
    p.tick(0.1);
    p.map.frame(p.frame({ x: -254.7 + 5 }));
    const second = g.__capeMap.draw();
    expect(second.draws).toBe(2);
    expect(second.counted).toBe(1);
    expect(second.pathBuilds).toBe(first.pathBuilds);
    expect(second.worstMs).toBeGreaterThanOrEqual(second.meanMs);
  });
});

describe("how present the small map is", () => {
  const level = (p: ReturnType<typeof page>): boolean => p.map.info().canvasEl.classList.contains("active");

  it("is quiet with no destination and no waypoint, comes up with either, and goes back when it is cleared or reached", async () => {
    const { clearDestination, chooseDestination, placeWaypoint, removeWaypoint } = await import("../../src/game/map/mapNav.js");
    const p = page(1440, 900);
    p.map.frame(p.frame());
    expect(level(p)).toBe(false);
    chooseDestination("place", 1);
    p.tick(1);
    p.map.frame(p.frame());
    expect(level(p)).toBe(true);
    clearDestination();
    p.tick(1);
    p.map.frame(p.frame());
    expect(level(p)).toBe(false);
    const w = placeWaypoint(-300, 120);
    p.tick(1);
    p.map.frame(p.frame());
    expect(level(p)).toBe(true);
    // Reaching the waypoint takes it down with the destination, and the map settles back.
    p.tick(1);
    p.map.frame(p.frame({ x: w.x + 2, z: w.z }));
    expect(nav.waypoints).toHaveLength(0);
    expect(nav.dest).toBeNull();
    expect(level(p)).toBe(false);
    // A flag left without a destination still counts as one set.
    placeWaypoint(1, 2);
    placeWaypoint(3, 4);
    removeWaypoint(2);
    p.tick(1);
    p.map.frame(p.frame());
    expect(level(p)).toBe(true);
    // Arriving at a place (within 8 m of its door) clears the destination and the map goes quiet.
    resetNav(SEED);
    const door = mapDataFor(SEED).places[1]!;
    chooseDestination("place", door.id);
    p.tick(1);
    p.map.frame(p.frame({ x: door.x + 3, z: door.z }));
    expect(nav.dest).toBeNull();
    expect(level(p)).toBe(false);
  });

  it("is half seen at rest and nearly whole with a destination, fading over 0.4 s, on the canvas alone, and not dimmed at all when it is the large map", () => {
    expect(CSS).toMatch(/\.capemap canvas \{[^}]*opacity: 1; transition: opacity 400ms ease/);
    expect(CSS).toContain(".capemap.corner canvas { opacity: 0.5; }");
    expect(CSS).toContain(".capemap.corner canvas.active { opacity: 0.9; }");
    // The container and the frame carry no dimming of their own: the large map and the bezel stay whole.
    expect(CSS).not.toMatch(/\.capemap \{[^}]*opacity: 0\.5/);
    expect(CSS).not.toMatch(/\.capedash[^{]*\{[^}]*opacity: 0\.[59]\b/);
    const p = page(1440, 900);
    p.map.frame(p.frame());
    expect(p.root().classList.contains("active")).toBe(false);
    expect(p.map.info().dash.classList.contains("active")).toBe(false);
  });

  it("draws the small map in the soft palette and the large one in the full", () => {
    const p = page(1440, 900);
    p.big(844, 860);
    p.map.frame(p.frame());
    expect(p.ctx.rec.rectColours[0]).toBe(paletteFor(0, 0, true).water);
    p.ctx.reset();
    p.tick(1);
    p.map.frame(p.frame({ engaged: false }));
    expect(p.ctx.rec.rectColours[0]).toBe(paletteFor(0, 0, false).water);
    expect(paletteFor(0, 0, true).water).not.toBe(paletteFor(0, 0, false).water);
  });

});

describe("the watch's screen on foot, and the unit in a car", () => {
  const QUAD = [0.32, 0.55, 0.45, 0.575, 0.442, 0.795, 0.312, 0.77];
  const raise = (raised: number, shown = true): void => {
    WATCH_SEEN.shown = shown;
    WATCH_SEEN.raised = raised;
    WATCH_SEEN.quad.set(QUAD);
  };
  const walk = (p: ReturnType<typeof page>, over: Partial<MapFrame> = {}): void => {
    p.tick(1);
    p.map.frame(p.frame({ driving: false, ...over }));
  };

  it("is hidden on foot while the watch is not shown (the corner tile is a car's), and shown on its face when it is", () => {
    const p = page(1440, 900);
    WATCH_SEEN.on = true;
    raise(1, false);
    walk(p);
    expect(p.map.info().mode).toBe("off");
    expect(p.root().style.display).toBe("none");
    expect(p.ctx.ops).toBe(0);
    raise(1);
    walk(p);
    expect(p.map.info().mode).toBe("watch");
    expect(p.root().style.display).toBe("");
    expect(p.root().classList.contains("watch")).toBe(true);
    expect(p.root().style.transform).toMatch(/^matrix3d\(/);
    expect(p.root().style.width).toBe("180px");
    expect(p.root().style.height).toBe("180px");
    // Full strength while up: no rest or active level on the watch, and no border or shadow of its own.
    expect(p.root().style.opacity).toBe("1");
    expect(CSS).toMatch(/\.capemap\.watch, \.capemap\.watch\.active \{[^}]*border: none[^}]*box-shadow: none[^}]*clip-path: circle\(50%\)/);
    // The car's unit is not there.
    expect(p.map.info().dash.style.display).toBe("none");
    // The screen was drawn, with the clock.
    expect(p.ctx.rec.texts).toContain("12:00");
  });

  it("comes on as the wrist rises: dark below 0.6 raised, half at 0.8", () => {
    const p = page(1440, 900);
    raise(0.5);
    walk(p);
    expect(p.map.info().mode).toBe("off");
    raise(0.8);
    walk(p);
    expect(p.map.info().mode).toBe("watch");
    expect(Number(p.root().style.opacity)).toBeCloseTo(0.5, 2);
    raise(1);
    walk(p);
    expect(p.root().style.opacity).toBe("1");
  });

  it("sizes the backing to the face times the device's ratio, at most 512, without resizing for a small change", () => {
    const p = page(1440, 900, 2);
    raise(1);
    walk(p);
    // The face is about 0.13 of 1440 px across: 187 px, 375 backing.
    const w0 = p.map.info().canvas.width;
    expect(w0).toBeGreaterThan(300);
    expect(w0).toBeLessThanOrEqual(512);
    expect(p.map.info().canvas.height).toBe(w0);
    // A bob of a pixel or two does not resize it.
    const bob = QUAD.map((v, i) => v + (i % 2 === 0 ? 2 / 1440 : 0));
    WATCH_SEEN.quad.set(bob);
    walk(p);
    expect(p.map.info().canvas.width).toBe(w0);
    // A face twice as large is capped.
    WATCH_SEEN.quad.set([0.2, 0.3, 0.6, 0.3, 0.6, 0.8, 0.2, 0.8]);
    walk(p);
    expect(p.map.info().canvas.width).toBe(512);
  });

  it("is not shown while paused (the large map is), and is back after", () => {
    const p = page(1440, 900);
    p.big(844, 860);
    raise(1);
    walk(p);
    expect(p.map.info().mode).toBe("watch");
    walk(p, { engaged: false });
    expect(p.map.info().mode).toBe("large");
    expect(p.root().classList.contains("watch")).toBe(false);
    expect(p.root().style.transform).toBe("");
    expect(p.map.info().dash.style.display).toBe("none");
    walk(p, { engaged: true });
    expect(p.map.info().mode).toBe("watch");
  });

  it("shows nothing of the watch in a car, where the corner tile and its unit follow the switch, and swings away over a quarter of a second", () => {
    const p = page(1440, 900);
    WATCH_SEEN.on = false;
    raise(1);
    p.tick(1);
    p.map.frame(p.frame({ driving: true }));
    expect(p.map.info().mode).toBe("off");
    expect(p.map.info().dash.style.display).toBe("none");
    WATCH_SEEN.on = true;
    p.tick(1);
    p.map.frame(p.frame({ driving: true }));
    expect(p.map.info().mode).toBe("corner");
    expect(p.root().style.display).toBe("");
    expect(p.root().classList.contains("watch")).toBe(false);
    expect(p.root().style.transform).toBeFalsy();
    expect(p.map.info().dash.style.display).toBe("");
    WATCH_SEEN.on = false;
    p.tick(0.05);
    p.map.frame(p.frame({ driving: true }));
    expect(p.map.info().mode).toBe("off");
    expect(p.map.info().dash.classList.contains("leaving")).toBe(true);
    expect(p.map.info().dash.style.display).toBe("");
    p.tick(0.3);
    p.map.frame(p.frame({ driving: true }));
    expect(p.map.info().dash.style.display).toBe("none");
    expect(p.root().style.display).toBe("none");
  });

  it("frames the corner screen as a car's unit: the canvas keeps its size inside the bezel, the dimming is the canvas's and not the frame's, and it is a car's alone", () => {
    for (const [w, h, size] of [[1440, 900, 220], [400, 800, 148]] as const) {
      const p = page(w, h);
      raise(1);
      walk(p);
      expect(p.map.info().dash.style.display).toBe("none");
      p.tick(1);
      p.map.frame(p.frame({ driving: true }));
      const r = p.map.info().rect;
      expect([r.width, r.height]).toEqual([size, size]);
      expect(p.map.info().canvas.width).toBe(size * 2);
      const dash = p.map.info().dash;
      // The unit is the screen with a bezel of 8 px at the sides and top and 14 px at the bottom, and a mount under it that stays inside the page's margin.
      expect(dash.style.width).toBe(`${size + 16}px`);
      expect(dash.style.height).toBe(`${size + 8 + 28}px`);
      expect(r.top + size + 28).toBeLessThanOrEqual(h - 12);
      expect(r.left + size + 8).toBeLessThanOrEqual(w - 12);
      // Dimming is on the canvas, never on the frame.
      chooseDestination("place", 1);
      p.tick(1);
      p.map.frame(p.frame({ driving: true }));
      expect(p.map.info().canvasEl.classList.contains("active")).toBe(true);
      expect(dash.classList.contains("active")).toBe(false);
      expect(p.root().classList.contains("active")).toBe(false);
      expect((dash as unknown as StandInElement).children.map((c) => c.className)).toEqual(["stalk", "foot", "bezel", "light", "btns"]);
      resetNav();
    }
    // The frame has no lettering and no brand: it is made of boxes alone.
    expect(CSS).not.toMatch(/\.capedash[^{]*\{[^}]*content:/);
  });

  it("shows the car's unit on foot with the console's `map dash`, in the driving look, and takes it away with `map undash`", () => {
    const p = page(1440, 900);
    WATCH_SEEN.on = false;
    raise(1, false);
    walk(p);
    expect(p.map.info().mode).toBe("off");
    mapAsk.dash = true;
    walk(p);
    expect(p.map.info().mode).toBe("corner");
    expect(p.map.info().dash.style.display).toBe("");
    expect(p.map.info().rect).toEqual(cornerRect(1440, 900, 220));
    expect(p.map.info().canvasEl.classList.contains("active")).toBe(false);
    mapAsk.dash = false;
    walk(p);
    expect(p.map.info().mode).toBe("off");
  });

  it("shows the watch on a made-up face with the console's `map watch`, with no arm", () => {
    const p = page(1440, 900);
    mapAsk.watch = true;
    WATCH_SEEN.on = false;
    WATCH_SEEN.shown = false;
    walk(p);
    expect(p.map.info().mode).toBe("watch");
    expect(p.root().style.transform).toMatch(/^matrix3d\(/);
  });
});
