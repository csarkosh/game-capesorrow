/**
 * The map on the screen: a small square in the bottom right corner while play has the controls, and, while the game is paused, a large map
 * that covers the right of the screen, where the player can pan and zoom, place waypoints, choose one of the four places to go to and read
 * how far each is. The engine's pause panel is moved to the left of it by the stylesheet (`mapCss.ts`).
 *
 * The map costs nothing where it cannot be seen (`frame(null)` returns at once) and never throws into the game's frame: a fault in it is
 * logged once and the map is hidden for good, and the game goes on.
 */
import { MAP_OPEN } from "../words.js";
import { canvasCtx, type MapCtx } from "./mapCtx.js";
import { CSS } from "./mapCss.js";
import { mapDataFor, type MapData } from "./mapData.js";
import { WATCH_FIXTURE, mapAsk } from "./mapCommand.js";
import { installMapDebug, mapDebug } from "./mapDebug.js";
import { createParty } from "./partyLook.js";
import { createPhone, type Phone } from "./phoneScreen.js";
import { SLIDE_SECONDS, phoneLayout, pointerOnCanvas, type PhoneLayout } from "./phoneShape.js";
import { WATCH_SEEN, type WatchSeen } from "../hand/watchSeen.js";
import { paletteFor } from "./mapStyle.js";
import { WATCH_H, WATCH_W, createPlacement, drawWatchStatus, fadeFor, formatClock, watchBacking, type WatchApp } from "./watchScreen.js";
import { MapDrawer, type Scene } from "./mapDraw.js";
import type { MapFrame } from "./mapFeed.js";
import { ARRIVED, chooseDestination, clearDestination, formatDistance, goalOf, nav, navFor, newTracker, placeWaypoint, removeWaypoint, restoreNav, saveNav, updateTracker } from "./mapNav.js";
import { graphFor, routeLengths, type Profile } from "./mapRoute.js";
import { placeSpots, type Spot } from "./mapMarks.js";
import { aimView, eased, isNight, largeView, minimapView, moving, newViewState, openLarge, panLarge, screenToWorld, snapView, worldToScreen, stepView, watchView, zoomLarge, type MapView } from "./mapView.js";

/** The minimap's side, pixels, on a wide screen and on one under `NARROW` pixels wide; its distance from the corner. */
export const SIZE = 220, SIZE_NARROW = 148, NARROW = 520, MARGIN = 12;
/** The car's navigation unit round the corner screen: the bezel's width at the sides and top and at the bottom, and how far the mount reaches below the screen, pixels. */
export const BEZEL = 8, BEZEL_BOTTOM = 14, DASH_BELOW = 28;
/** A screen narrower than this puts the large map on top and the pause panel under it. */
export const STACKED = 720;
/** The most the large canvas may hold, bytes (the target is under 10 MB), and the most a device pixel ratio the map draws at. */
export const LARGE_BYTES = 9_500_000, MAX_DPR = 2;
/** The least time between two draws of the map, seconds (30 a second). */
export const DRAW_EVERY = 1 / 30;

export type Rect = { left: number; top: number; width: number; height: number };

/** The corner screen's rectangle in a car: the unit's bezel and mount are round it, and keep inside the page's 12 px margin at the bottom right. */
export function cornerRect(w: number, h: number, size: number): Rect {
  return { left: w - MARGIN - BEZEL - size, top: h - MARGIN - DASH_BELOW - size, width: size, height: size };
}

/** The scale a canvas of `w` by `h` css pixels is made at: the device's, to at most `MAX_DPR`, and less where the canvas would hold more than `bytes`. */
export function canvasScale(w: number, h: number, dpr: number, bytes: number): number {
  const want = Math.min(MAX_DPR, Math.max(1, dpr));
  return Math.min(want, Math.sqrt(bytes / (4 * Math.max(1, w * h))));
}

export type MinimapHooks = { onPause(): void };

/** What the minimap reads of the page: kept apart so that a test can give it a fake document. */
export type MinimapEnv = {
  readonly doc: Document;
  readonly win: Pick<Window, "innerWidth" | "innerHeight" | "devicePixelRatio" | "addEventListener" | "removeEventListener">;
  /** Seconds. */
  now(): number;
  /** Milliseconds, for timing a draw. */
  clock(): number;
  /** The context a canvas is drawn through; `scale` is the canvas's pixels to a css pixel. */
  context(canvas: HTMLCanvasElement, scale: () => number): MapCtx | null;
  log(message: string, error: unknown): void;
};

export function realEnv(): MinimapEnv {
  return {
    doc: document,
    win: window,
    now: () => performance.now() / 1000,
    clock: () => performance.now(),
    context(canvas, scale) {
      const c = canvas.getContext("2d");
      return c === null ? null : canvasCtx(c, scale);
    },
    log: (message, error) => console.error(message, error),
  };
}

export type Minimap = {
  /** The local player's frame, or null where there is none (the map is then hidden and costs nothing). */
  frame(f: MapFrame | null): void;
  dispose(): void;
  /** What a test reads. */
  readonly info: () => { phone: PhoneLayout | null; phoneEl: HTMLElement | null; dash: HTMLElement; canvasEl: HTMLCanvasElement; shown: boolean; paused: boolean; mode: "off" | "watch" | "corner" | "large"; broken: boolean; rect: Rect; canvas: { width: number; height: number }; root: HTMLElement };
  /** Draws once, at once (a test's). */
  readonly drawNow: () => void;
};

export function createMinimap(container: HTMLElement, hooks: MinimapHooks, env: MinimapEnv = realEnv()): Minimap {
  const { doc, win } = env;
  const style = doc.createElement("style");
  style.textContent = CSS;
  const root = doc.createElement("div");
  root.className = "capemap";
  root.style.display = "none";
  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-label", MAP_OPEN);
  root.append(canvas);
  // The unit the corner screen is in, in a car: a bezel, a power light, buttons and a mount, made once and shown only there (CSS draws all of it).
  const dash = doc.createElement("div");
  dash.className = "capedash";
  dash.style.display = "none";
  for (const name of ["stalk", "foot", "bezel", "light", "btns"]) {
    const part = doc.createElement("div");
    part.className = name;
    if (name === "btns") for (let i = 0; i < 3; i++) part.append(doc.createElement("i"));
    dash.append(part);
  }
  // The map comes before the engine's pause menu in its container, and over the touch layer while play has the controls.
  container.append(style, dash, root);

  let broken = false;
  let shown = false;
  let paused = false;
  let everEngaged = false;
  let engaged = true;
  let touch = false;
  let started = false;
  let data: MapData | null = null;
  let ctx: MapCtx | null = null;
  let drawer: MapDrawer | null = null;
  let scale = 1;
  let smallSize = SIZE;
  const party = createParty(doc);
  // What the map is now: the watch's screen (on foot, the arm up), the corner tile (in a car, with the switch on), the large map (paused), or nothing.
  let mode: "off" | "watch" | "corner" | "large" = "off";
  const placement = createPlacement(root);
  let fade = -1;
  // The map moves between its places without easing after the watch (the watch is placed every frame), and eases again two frames later.
  let jump = 0;
  // When the unit that swung away is taken out of the page, in seconds, or 0.
  let hideAt = 0;
  let rect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  let bigW = 0;
  let bigH = 0;
  let lastNow = -1;
  let drawnAt = -Infinity;
  let dirty = true;
  const drawn = { x: NaN, z: NaN, heading: NaN, mpp: NaN, sig: "" };
  const vs = newViewState();
  const tracker = newTracker();
  let profile: Profile = "foot";
  let streetName = "";
  let streetAt = -Infinity;
  let listAt = -Infinity;
  let lens: number[] = [];
  let lastFrame: MapFrame | null = null;
  const durations: number[] = [];
  const drawTimes: number[] = [];
  const last = { ms: 0, ops: 0, cells: 0, draws: 0, buildMs: 0, builds: 0 };
  const keysOff = [] as (() => void)[];
  // The phone the large map is: made the first time the game is paused. The canvas lives in it while it is up, and goes back to the root when another place needs it.
  let phone: Phone | null = null;
  let phoneLayoutNow: PhoneLayout | null = null;
  let canvasIn: "root" | "phone" = "root";
  // When a phone that is sliding away is taken out of the page, in seconds, or 0.
  let phoneHideAt = 0;

  const fail = (e: unknown): void => {
    if (broken) return;
    broken = true;
    env.log("The map failed and is hidden:", e);
    root.style.display = "none";
    dash.style.display = "none";
    if (phone !== null) phone.root.style.display = "none";
    container.classList.remove("capemap-open");
    doc.body?.classList.remove("capemap-open");
  };
  const guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A): void => {
    if (broken) return;
    try {
      fn(...a);
    } catch (e) {
      fail(e);
    }
  };

  const setRect = (r: Rect, corner: boolean): void => {
    if (r.left === rect.left && r.top === rect.top && r.width === rect.width && r.height === rect.height && corner === !paused) return;
    rect = r;
    // The corner keeps clear of the notch and the home bar; the large map has margins of its own.
    root.style.left = corner ? `calc(${r.left}px - env(safe-area-inset-right, 0px))` : `${r.left}px`;
    root.style.top = corner ? `calc(${r.top}px - env(safe-area-inset-bottom, 0px))` : `${r.top}px`;
    root.style.width = `${r.width}px`;
    root.style.height = `${r.height}px`;
  };

  const placeDash = (): void => {
    const r = rect;
    dash.style.left = `calc(${r.left - BEZEL}px - env(safe-area-inset-right, 0px))`;
    dash.style.top = `calc(${r.top - BEZEL}px - env(safe-area-inset-bottom, 0px))`;
    dash.style.width = `${r.width + 2 * BEZEL}px`;
    dash.style.height = `${r.height + BEZEL + DASH_BELOW}px`;
    // (The size of the screen, for the bezel's rules.)
    dash.style.setProperty?.("--s", `${r.width}px`);
  };

  const layout = (): void => {
    smallSize = win.innerWidth < NARROW ? SIZE_NARROW : SIZE;
    if (paused) return;
    setRect(cornerRect(win.innerWidth, win.innerHeight, smallSize), true);
    placeDash();
  };

  const watchSeen = (): WatchSeen => (mapAsk.watch ? WATCH_FIXTURE : WATCH_SEEN);

  const enter = (next: typeof mode): void => {
    const was = mode;
    mode = next;
    root.classList.toggle("watch", next === "watch");
    root.classList.remove("leaving");
    dash.classList.remove("leaving");
    // The unit swings away and back over a quarter of a second; the others go at once.
    const swingOut = was === "corner" && next === "off";
    root.classList.toggle("corner", next === "corner" || swingOut);
    hideAt = swingOut ? env.now() + 0.25 : 0;
    root.style.display = (next === "off" && !swingOut) || next === "large" ? "none" : "";
    if (next === "watch" || next === "corner") reclaimCanvas();
    dash.style.display = next === "corner" || swingOut ? "" : "none";
    if (swingOut) {
      root.classList.add("leaving");
      dash.classList.add("leaving");
    }
    if (was === "watch" || next === "watch") {
      root.style.transition = "none";
      jump = 2;
    }
    if (was === "watch") {
      root.style.transform = "";
      root.style.opacity = "";
      placement.forget();
    }
    if (next === "watch") {
      fade = -1;
      rect = { left: -1, top: -1, width: -1, height: -1 };
      root.style.left = "0px";
      root.style.top = "0px";
      root.style.width = `${WATCH_W}px`;
      root.style.height = `${WATCH_H}px`;
    } else if (next === "corner") {
      rect = { left: -1, top: -1, width: -1, height: -1 };
      layout();
      setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }
    dirty = true;
    drawnAt = -Infinity;
  };

  const setBitmap = (cssW: number, cssH: number, s: number): void => {
    scale = s;
    const w = Math.max(1, Math.round(cssW * s));
    const h = Math.max(1, Math.round(cssH * s));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  /** Gives the canvas back to the root (the watch's and the corner's place), once the phone is not showing it. */
  const reclaimCanvas = (): void => {
    if (canvasIn === "root") return;
    root.prepend(canvas);
    canvasIn = "root";
    canvas.classList.remove("dragging");
  };

  const zoomBy = (k: number): void => {
    zoomLarge(vs, k, bigW / 2, bigH / 2, bigW, bigH);
    dirty = true;
  };

  const makePhone = (d: MapData): Phone =>
    createPhone(doc, d.places.map((p) => ({ id: p.id, name: p.name, kind: p.kind })), {
      zoomIn: () => zoomBy(1.6),
      zoomOut: () => zoomBy(1 / 1.6),
      centre: () => {
        if (lastFrame !== null) {
          vs.lcx = lastFrame.x;
          vs.lcz = lastFrame.z;
        }
        dirty = true;
      },
      clear: () => {
        clearDestination();
        dirty = true;
      },
      pick: (id) => {
        chooseDestination("place", id);
        const p = d.places.find((q) => q.id === id);
        // The map goes to the place.
        if (p !== undefined) {
          vs.lcx = p.x;
          vs.lcz = p.z;
        }
        dirty = true;
      },
    }, guard);

  const setPaused = (next: boolean, f: MapFrame): void => {
    paused = next;
    container.classList.toggle("capemap-open", next);
    doc.body?.classList.toggle("capemap-open", next);
    const now = env.now();
    if (next) {
      if (phone === null && data !== null) {
        phone = makePhone(data);
        container.append(phone.root);
        // Nothing of the phone's reaches the game's canvas behind it, where a click would resume play.
        for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"]) phone.root.addEventListener(type, (e) => e.stopPropagation());
      }
      if (phone === null) return;
      const l = phoneLayout(win.innerWidth, win.innerHeight);
      phoneLayoutNow = l;
      phone.place(l);
      bigW = l.screenW;
      bigH = l.screenH;
      phone.screen.prepend(canvas);
      canvasIn = "phone";
      setBitmap(bigW, bigH, canvasScale(bigW, bigH, win.devicePixelRatio || 1, LARGE_BYTES));
      // The pause panel keeps to the free part of the view: the left of a phone at the side, the top above one at the bottom.
      container.style.setProperty?.("--cape-phone-left", `${l.left}px`);
      container.style.setProperty?.("--cape-phone-h", `${l.bodyH + 12}px`);
      phone.root.classList.remove("out");
      phone.root.style.display = "block";
      phone.root.classList.add("in");
      phoneHideAt = 0;
      // It opens on the player, at the minimap's scale, north up.
      openLarge(vs, f.x, f.z, minimapView(vs, smallSize, smallSize, f.x, f.z, f.heading).mpp);
      listAt = -Infinity;
    } else if (phone !== null) {
      pointers.clear();
      // The phone slides down; the canvas stays in it until another place needs the canvas (the frame's mode asks).
      phone.root.classList.remove("in");
      phone.root.classList.add("out");
      phoneHideAt = now + SLIDE_SECONDS;
      layout();
      if (canvasIn === "root") setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }
    dirty = true;
    drawnAt = -Infinity;
  };

  // Pointers on the large map: one drags, two pinch; a press let go where it began is a click.
  const pointers = new Map<number, { x: number; y: number }>();
  const press = { x: 0, y: 0, moved: false };
  let pinchDist = 0;
  let lastClick: { at: number; x: number; y: number; saved: ReturnType<typeof saveNav> } | null = null;
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    // Through the phone's transform (a slide, a scale): where the canvas is now on the page.
    return pointerOnCanvas(canvas.getBoundingClientRect(), bigW, bigH, e.clientX, e.clientY);
  };
  const view = (): MapView => largeView(vs, bigW, bigH);

  /** What the large map does for a click at (x, y): remove a flag, choose a place, or place a waypoint. */
  const click = (x: number, y: number): void => {
    if (data === null || lastFrame === null) return;
    const v = view();
    const p = { x: 0, y: 0 };
    for (const w of nav.waypoints) {
      p.x = 0;
      worldToScreen(v, w.x, w.z, p);
      if (x >= p.x - 9 && x <= p.x + 15 && y >= p.y - 24 && y <= p.y + 5) {
        removeWaypoint(w.id);
        return;
      }
    }
    const at = data.places.map((q) => worldToScreen(v, q.x, q.z, { x: 0, y: 0 }));
    const mark = worldToScreen(v, lastFrame.x, lastFrame.z, { x: 0, y: 0 });
    const spots: Spot[] = [];
    placeSpots(v.w, v.h, mark.x, mark.y, at, spots);
    for (let i = 0; i < data.places.length; i++) {
      const spot = spots[i] as Spot;
      const r = spot.border ? 7 : 10;
      if (Math.abs(x - spot.x) <= r + 3 && y >= spot.y - r * 3.6 && y <= spot.y + 5) {
        chooseDestination("place", (data.places[i] as { id: number }).id);
        return;
      }
    }
    const w = { x: 0, z: 0 };
    screenToWorld(v, x, y, w);
    placeWaypoint(w.x, w.z);
  };

  const up = (e: PointerEvent): void => {
    if (!paused || !pointers.has(e.pointerId)) return;
    const wasOne = pointers.size === 1;
    pointers.delete(e.pointerId);
    canvas.classList.remove("dragging");
    if (!wasOne || press.moved) return;
    const at = local(e);
    const now = env.now();
    // A second click close behind the first is a double click: it zooms in, and takes back what the first did.
    if (lastClick !== null && now - lastClick.at < 0.32 && Math.hypot(at.x - lastClick.x, at.y - lastClick.y) < 22) {
      restoreNav(lastClick.saved);
      lastClick = null;
      zoomLarge(vs, 2, at.x, at.y, bigW, bigH);
    } else {
      const saved = saveNav();
      click(at.x, at.y);
      lastClick = { at: now, x: at.x, y: at.y, saved };
    }
    dirty = true;
  };

  const down = (e: PointerEvent): void => {
    if (!paused) return;
    const at = local(e);
    pointers.set(e.pointerId, at);
    canvas.setPointerCapture?.(e.pointerId);
    if (pointers.size === 1) {
      press.x = at.x;
      press.y = at.y;
      press.moved = false;
    } else {
      press.moved = true;
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const move = (e: PointerEvent): void => {
    if (!paused) return;
    const prev = pointers.get(e.pointerId);
    if (prev === undefined) return;
    const at = local(e);
    if (pointers.size === 1) {
      if (!press.moved && Math.hypot(at.x - press.x, at.y - press.y) > 5) {
        press.moved = true;
        canvas.classList.add("dragging");
      }
      if (press.moved) {
        panLarge(vs, at.x - prev.x, at.y - prev.y);
        dirty = true;
      }
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, at);
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) zoomLarge(vs, d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2, bigW, bigH);
      pinchDist = d;
      dirty = true;
    }
    pointers.set(e.pointerId, at);
  };

  const wheel = (e: WheelEvent): void => {
    if (!paused) return;
    e.preventDefault();
    const at = local(e);
    zoomLarge(vs, Math.exp((-e.deltaY * (e.deltaMode === 1 ? 16 : 1)) * 0.0015), at.x, at.y, bigW, bigH);
    dirty = true;
  };

  canvas.addEventListener("pointerdown", guard(down as (e: Event) => void));
  canvas.addEventListener("pointermove", guard(move as (e: Event) => void));
  canvas.addEventListener("pointerup", guard(up as (e: Event) => void));
  canvas.addEventListener("pointercancel", guard((e: Event) => {
    pointers.delete((e as PointerEvent).pointerId);
    canvas.classList.remove("dragging");
  }));
  canvas.addEventListener("wheel", guard(wheel as (e: Event) => void), { passive: false });
  // Nothing of the map's pointer reaches the game's canvas behind it, where a click would resume play. A tap on the corner map opens the large one.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) root.addEventListener(type, (e) => {
    if (touch) e.stopPropagation();
  });
  root.addEventListener("click", guard((e: Event) => {
    e.stopPropagation();
    if (!paused && touch && engaged) hooks.onPause();
  }));
  // Tab pauses, and the large map is what a paused game shows.
  const onKey = guard((e: Event) => {
    const k = e as KeyboardEvent;
    if (k.code !== "Tab" || k.repeat || !shown || paused || !engaged) return;
    k.preventDefault();
    hooks.onPause();
  });
  win.addEventListener("keydown", onKey, true);
  keysOff.push(() => win.removeEventListener("keydown", onKey, true));

  const uninstall = installMapDebug(mapDebug({
    stats() {
      let sum = 0;
      let worst = 0;
      for (const d of durations) {
        sum += d;
        if (d > worst) worst = d;
      }
      const t = env.clock();
      let n = 0;
      for (const at of drawTimes) if (t - at <= 1000) n++;
      return { lastMs: last.ms, meanMs: durations.length === 0 ? 0 : sum / durations.length, worstMs: worst, counted: durations.length, pathBuildMs: last.buildMs, pathBuilds: last.builds, perSecond: n, ops: last.ops, cells: last.cells, draws: last.draws };
    },
    canvas: () => ({ width: canvas.width, height: canvas.height, large: paused }),
    data: () => {
      if (data === null) return null;
      const g = graphFor(data);
      return { counts: data.counts, buildMs: data.buildMs, nodes: g.nodeX.length, edges: g.edges.length, graphMs: g.buildMs };
    },
    nav: () => ({ destination: nav.dest === null ? null : { ...nav.dest }, waypoints: nav.waypoints.map((w) => ({ ...w })), routeMetres: tracker.route === null ? null : tracker.route.length }),
  }));

  /** The street the player is on, found at most four times a second (empty off the streets). */
  const streetOn = (f: MapFrame, now: number): string => {
    if (now - streetAt < 0.25) return streetName;
    streetAt = now;
    let best = 18;
    streetName = "";
    for (const s of (data as MapData).segments) {
      if (s.name === "") continue;
      const dx = s.x1 - s.x0;
      const dz = s.z1 - s.z0;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((f.x - s.x0) * dx + (f.z - s.z0) * dz) / l2)) : 0;
      const d = Math.hypot(s.x0 + dx * t - f.x, s.z0 + dz * t - f.z);
      if (d < best) {
        best = d;
        streetName = s.name;
      }
    }
    return streetName;
  };

  const run = (f: MapFrame): void => {
    const now = env.now();
    const dt = lastNow < 0 ? 0 : Math.min(0.25, Math.max(0, now - lastNow));
    lastNow = now;
    shown = true;
    lastFrame = f;
    touch = f.touch;
    engaged = f.engaged;
    if (f.engaged) everEngaged = true;
    if (data === null || data.seed !== f.seed) data = mapDataFor(f.seed);
    navFor(f.seed);
    if (mapAsk.to !== null) {
      const asked = data.places.find((q) => q.kind === mapAsk.to);
      if (asked !== undefined) chooseDestination("place", asked.id);
      mapAsk.to = null;
    }
    if (!started) {
      started = true;
      ctx = env.context(canvas, () => scale);
      if (ctx === null) throw new Error("the canvas has no 2d context");
      drawer = new MapDrawer(ctx, env.clock);
      snapView(vs, f.driving || mapAsk.dash, isNight(f.hour));
      layout();
      setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }
    const wantPaused = mapAsk.open || (!f.engaged && everEngaged);
    if (wantPaused !== paused) setPaused(wantPaused, f);
    if (jump > 0 && --jump === 0) root.style.transition = "";
    if (hideAt > 0 && now >= hideAt && mode === "off") {
      hideAt = 0;
      root.style.display = "none";
      dash.style.display = "none";
      root.classList.remove("leaving");
      root.classList.remove("corner");
      dash.classList.remove("leaving");
    }
    const seen = watchSeen();
    // `map dash` is a car's unit shown on foot, for looking at it.
    const driving = f.driving || mapAsk.dash;
    const want = paused ? "large" : driving ? (seen.on || mapAsk.dash ? "corner" : "off") : seen.shown && fadeFor(seen.raised) > 0 ? "watch" : "off";
    if (want !== mode) enter(want);
    if (mode === "corner") layout();
    if (mode === "watch") {
      // The watch's screen is laid on the lit face each frame: one matrix, written only when the face has moved, and its fade.
      const level = fadeFor(seen.raised);
      if (Math.abs(level - fade) > 0.004) {
        fade = level;
        root.style.opacity = String(+level.toFixed(3));
      }
      const vw = win.innerWidth;
      const vh = win.innerHeight;
      placement.place(seen.quad, vw, vh);
      const q = seen.quad;
      const across = Math.hypot(((q[2] as number) - (q[0] as number)) * vw, ((q[3] as number) - (q[1] as number)) * vh);
      const backing = watchBacking(across, win.devicePixelRatio || 1, canvas.width);
      if (backing !== canvas.width || canvas.height !== canvas.width) {
        setBitmap(WATCH_W, WATCH_H, backing / WATCH_W);
        dirty = true;
      }
    }
    party.update(f.rtt, now);
    root.classList.toggle("tappable", touch && mode === "corner");
    aimView(vs, driving, isNight(f.hour));
    stepView(vs, dt);
    profile = driving ? "drive" : "foot";

    // The destination, and the route to it from the player (from their building's street door inside one).
    const goal = goalOf(data);
    const room = f.place > 0 ? data.places.find((p) => p.id === f.place) : undefined;
    const ox = room === undefined ? f.x : room.x;
    const oz = room === undefined ? f.z : room.z;
    if (goal !== null && Math.hypot(f.x - goal.x, f.z - goal.z) < ARRIVED && room === undefined) {
      // A waypoint that is reached is taken down with the destination.
      if (nav.dest !== null && nav.dest.kind === "waypoint") removeWaypoint(nav.dest.id);
      clearDestination();
      dirty = true;
    }
    const goal2 = goalOf(data);
    // At rest (no destination and no waypoint) the small map is quiet and see-through; with one it comes up. CSS fades between the two.
    // (The dimming is the screen's alone: the canvas carries it, the bezel and the mount stay solid.)
    canvas.classList.toggle("active", nav.dest !== null || nav.waypoints.length > 0);
    dash.classList.toggle("night", vs.nightGoal === 1);
    const route = updateTracker(tracker, () => graphFor(data as MapData), now, ox, oz, profile, goal2);
    let slim: string | null;
    if (goal2 !== null) slim = route === null ? goal2.name : `${goal2.name} · ${formatDistance(route.length)}`;
    else if (room !== undefined) slim = room.name;
    else slim = streetOn(f, now) || null;

    // The phone's own app: its clock, the search field's destination, and the sheet's rows (how far each place is along the streets, once a second).
    if (paused && phone !== null) {
      phone.setStatus(formatClock(f.hour), vs.nightGoal === 1);
      phone.setSearch(goal2 === null ? null : goal2.name, goal2 === null || route === null ? null : formatDistance(route.length));
      if (now - listAt >= 1) {
        listAt = now;
        lens = routeLengths(graphFor(data), profile, ox, oz, data.places);
      }
      let nearest = -1;
      lens.forEach((l, i) => {
        if (nearest < 0 || l < (lens[nearest] as number)) nearest = i;
      });
      data.places.forEach((p, i) => phone?.setRow(p.id, formatDistance((lens[i] as number | undefined) ?? 0), i === nearest, nav.dest !== null && nav.dest.kind === "place" && nav.dest.id === p.id));
    }
    // A phone that has slid away is taken out of the page, and the canvas goes back to the root.
    if (phoneHideAt > 0 && now >= phoneHideAt && !paused && phone !== null) {
      phoneHideAt = 0;
      phone.root.style.display = "none";
      phone.root.classList.remove("out");
      reclaimCanvas();
      if (mode !== "large") setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }

    // Redraw policy: the minimap when something it shows changed by a pixel (or the looks are easing), at most 30 a second; the large map on input and when the mark moves.
    if (mode === "off") return;
    const w = paused ? bigW : mode === "watch" ? WATCH_W : smallSize;
    const mmpp = paused ? vs.lmpp : mode === "watch" ? watchView(WATCH_W, WATCH_H, f.x, f.z, f.heading).mpp : minimapView(vs, w, w, f.x, f.z, f.heading).mpp;
    const clock = mode === "watch" ? formatClock(f.hour) : "";
    const sig = `${clock}|${route === null ? "" : `${route.pts.length}:${Math.round(route.length)}`}|${slim ?? ""}|${nav.waypoints.length}|${nav.dest?.id ?? 0}${nav.dest?.kind ?? ""}|${paused ? 1 : 0}`;
    const px = Math.hypot(f.x - drawn.x, f.z - drawn.z) / mmpp;
    const turned = Math.abs(f.heading - drawn.heading) * (paused ? 34 : mode === "watch" || eased(vs.look) > 0.5 ? 110 : 34);
    if (dirty || sig !== drawn.sig || px >= 1 || !(turned < 1) || mmpp !== drawn.mpp || moving(vs)) {
      if (now - drawnAt >= DRAW_EVERY) {
        paint(f, route, paused ? null : slim);
        drawn.x = f.x;
        drawn.z = f.z;
        drawn.heading = f.heading;
        drawn.mpp = mmpp;
        drawn.sig = sig;
        drawnAt = now;
        dirty = false;
      }
    }
  };

  // The map as the watch's app: it draws the scene this frame has made on the screen it is given.
  let pending: Scene | null = null;
  const mapApp: WatchApp = {
    name: "map",
    draw: () => {
      if (drawer !== null && pending !== null) drawer.draw(pending);
    },
  };

  const paint = (f: MapFrame, route: { pts: readonly number[] } | null, slim: string | null): void => {
    if (ctx === null || drawer === null || data === null) return;
    const t0 = env.clock();
    const watch = mode === "watch";
    const w = paused ? bigW : smallSize;
    // The drawing's scale is always the canvas's own width over the layout's, read here at every draw and never kept across a resize (a backing that was kept by the watch's hysteresis, or left by another mode, is then still drawn to fit): the canvas is made to the layout's shape if it is not.
    const lw = paused ? bigW : watch ? WATCH_W : smallSize;
    const lh = paused ? bigH : watch ? WATCH_H : smallSize;
    scale = canvas.width / lw;
    if (Math.abs(canvas.height - lh * scale) > 1) setBitmap(lw, lh, scale);
    const v = paused ? view() : watch ? watchView(WATCH_W, WATCH_H, f.x, f.z, f.heading) : minimapView(vs, w, w, f.x, f.z, f.heading);
    const scene: Scene = {
      data, view: v, e: watch ? 0 : eased(vs.look), night: eased(vs.night), dpr: scale, large: paused, soft: !paused && !watch, watch,
      player: { x: f.x, z: f.z, heading: f.heading, driving: f.driving },
      route, waypoints: nav.waypoints, destination: nav.dest, slim,
    };
    // The watch draws its one app, the map; the other places draw the map directly.
    pending = scene;
    if (watch) mapApp.draw(ctx, WATCH_W, WATCH_H, scale);
    else drawer.draw(scene);
    // The watch's own status line, the game's clock.
    if (watch) {
      drawWatchStatus(ctx, WATCH_W, paletteFor(0, scene.night, false), f.hour);
      drawer.ops++;
    }
    const ms = env.clock() - t0;
    // A draw that built paths is not drawing's cost: it is counted apart.
    if (drawer.built > 0) {
      last.buildMs = drawer.buildMs;
      last.builds += drawer.built;
    } else {
      durations.push(ms);
      if (durations.length > 120) durations.shift();
    }
    drawTimes.push(t0);
    while (drawTimes.length > 0 && t0 - (drawTimes[0] as number) > 1000) drawTimes.shift();
    last.ms = ms;
    last.ops = drawer.ops;
    last.cells = drawer.tiles.length;
    last.draws++;
  };

  return {
    frame(f) {
      if (broken) return;
      if (f === null) {
        if (shown) {
          shown = false;
          everEngaged = false;
          if (paused) {
            paused = false;
            container.classList.remove("capemap-open");
            doc.body?.classList.remove("capemap-open");
          }
          if (phone !== null) {
            phone.root.style.display = "none";
            phone.root.classList.remove("in");
            phone.root.classList.remove("out");
            phoneHideAt = 0;
            reclaimCanvas();
          }
          root.style.display = "none";
          dash.style.display = "none";
          mode = "off";
          root.classList.remove("watch");
        }
        return;
      }
      try {
        run(f);
      } catch (e) {
        fail(e);
      }
    },
    dispose() {
      for (const off of keysOff) off();
      uninstall();
      party.dispose();
      container.classList.remove("capemap-open");
      doc.body?.classList.remove("capemap-open");
      root.remove();
      phone?.dispose();
      dash.remove();
      style.remove();
    },
    info: () => ({ phone: phoneLayoutNow, phoneEl: phone === null ? null : phone.root, dash, canvasEl: canvas, shown, paused, mode, broken, rect: paused && phoneLayoutNow !== null ? { left: phoneLayoutNow.left, top: phoneLayoutNow.top, width: phoneLayoutNow.bodyW, height: phoneLayoutNow.bodyH } : { ...rect }, canvas: { width: canvas.width, height: canvas.height }, root }),
    drawNow() {
      if (lastFrame !== null) guard(() => paint(lastFrame as MapFrame, tracker.route, null))();
    },
  };
}


