/**
 * The map on the screen: a small square in the bottom right corner while play has the controls, and, while the game is paused, a large map
 * that covers the right of the screen, where the player can pan and zoom, place waypoints, choose one of the four places to go to and read
 * how far each is. The engine's pause panel is moved to the left of it by the stylesheet (`mapCss.ts`).
 *
 * The map costs nothing where it cannot be seen (`frame(null)` returns at once) and never throws into the game's frame: a fault in it is
 * logged once and the map is hidden for good, and the game goes on.
 */
import { MAP_BAR, MAP_CAFE, MAP_CENTRE, MAP_CLEAR, MAP_LODGING, MAP_OFFICE, MAP_OPEN, MAP_PLACES, MAP_ZOOM_IN, MAP_ZOOM_OUT } from "../words.js";
import { canvasCtx, type MapCtx } from "./mapCtx.js";
import { CSS } from "./mapCss.js";
import { mapDataFor, type MapData, type PlaceKind } from "./mapData.js";
import { mapAsk } from "./mapCommand.js";
import { installMapDebug, mapDebug } from "./mapDebug.js";
import { createParty } from "./partyLook.js";
import { MapDrawer, type Scene } from "./mapDraw.js";
import type { MapFrame } from "./mapFeed.js";
import { ARRIVED, chooseDestination, clearDestination, formatDistance, goalOf, nav, navFor, newTracker, placeWaypoint, removeWaypoint, restoreNav, saveNav, updateTracker } from "./mapNav.js";
import { graphFor, routeLengths, type Profile } from "./mapRoute.js";
import { placeSpots, type Spot } from "./mapMarks.js";
import { aimView, eased, isNight, largeView, minimapView, moving, newViewState, openLarge, panLarge, screenToWorld, snapView, worldToScreen, stepView, zoomLarge, type MapView } from "./mapView.js";

/** The minimap's side, pixels, on a wide screen and on one under `NARROW` pixels wide; its distance from the corner. */
export const SIZE = 220, SIZE_NARROW = 148, NARROW = 520, MARGIN = 12;
/** A screen narrower than this puts the large map on top and the pause panel under it. */
export const STACKED = 720;
/** The most the large canvas may hold, bytes (the target is under 10 MB), and the most a device pixel ratio the map draws at. */
export const LARGE_BYTES = 9_500_000, MAX_DPR = 2;
/** The least time between two draws of the map, seconds (30 a second). */
export const DRAW_EVERY = 1 / 30;

export type Rect = { left: number; top: number; width: number; height: number };

/** The large map's rectangle on a window: from 40 percent of the width to the right edge and top to bottom with 20 px margins, or, on a narrow window, the top 56 percent. */
export function largeRect(w: number, h: number): Rect {
  if (w >= STACKED) {
    const left = Math.round(w * 0.4);
    return { left, top: 20, width: w - left - 20, height: h - 40 };
  }
  return { left: 20, top: 20, width: w - 40, height: Math.round(h * 0.56) - 20 };
}

/** The minimap's rectangle in the bottom right corner (the party stands over it). */
export function cornerRect(w: number, h: number, size: number): Rect {
  return { left: w - MARGIN - size, top: h - MARGIN - size, width: size, height: size };
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
  readonly info: () => { shown: boolean; paused: boolean; broken: boolean; rect: Rect; canvas: { width: number; height: number }; root: HTMLElement };
  /** Draws once, at once (a test's). */
  readonly drawNow: () => void;
};

const KIND_WORD: Record<PlaceKind, string> = { bar: MAP_BAR, cafe: MAP_CAFE, lodging: MAP_LODGING, office: MAP_OFFICE };

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
  // The map comes before the engine's pause menu in its container, and over the touch layer while play has the controls.
  container.append(style, root);

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
  let lastFrame: MapFrame | null = null;
  const durations: number[] = [];
  const drawTimes: number[] = [];
  const last = { ms: 0, ops: 0, cells: 0, draws: 0, buildMs: 0, builds: 0 };
  const keysOff = [] as (() => void)[];
  let ui: { places: HTMLElement; rows: Map<number, { row: HTMLElement; dist: HTMLElement }> } | null = null;

  const fail = (e: unknown): void => {
    if (broken) return;
    broken = true;
    env.log("The map failed and is hidden:", e);
    root.style.display = "none";
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

  const layout = (): void => {
    smallSize = win.innerWidth < NARROW ? SIZE_NARROW : SIZE;
    if (paused) {
      setRect(largeRect(win.innerWidth, win.innerHeight), false);
      return;
    }
    setRect(cornerRect(win.innerWidth, win.innerHeight, smallSize), true);
    // The party stands over the map, as wide as it is.
    party.place(MARGIN + smallSize + 8, smallSize);
  };

  const setBitmap = (cssW: number, cssH: number, s: number): void => {
    scale = s;
    const w = Math.max(1, Math.round(cssW * s));
    const h = Math.max(1, Math.round(cssH * s));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };

  const setPaused = (next: boolean, f: MapFrame): void => {
    paused = next;
    root.classList.toggle("paused", next);
    root.classList.remove("dragging");
    container.classList.toggle("capemap-open", next);
    doc.body?.classList.toggle("capemap-open", next);
    if (next) {
      const r = largeRect(win.innerWidth, win.innerHeight);
      bigW = r.width;
      bigH = r.height;
      setRect(r, false);
      setBitmap(bigW, bigH, canvasScale(bigW, bigH, win.devicePixelRatio || 1, LARGE_BYTES));
      // It opens on the player, at the minimap's scale, north up.
      openLarge(vs, f.x, f.z, minimapView(vs, smallSize, smallSize, f.x, f.z, f.heading).mpp);
      buildUi();
      listAt = -Infinity;
    } else {
      pointers.clear();
      layout();
      setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }
    dirty = true;
    drawnAt = -Infinity;
  };

  // The large map's interface, made the first time it is wanted.
  const button = (text: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", guard((e: Event) => {
      e.stopPropagation();
      onClick();
    }));
    return b;
  };
  const buildUi = (): void => {
    if (ui !== null || data === null) return;
    const wrap = doc.createElement("div");
    wrap.className = "ui";
    const places = doc.createElement("div");
    places.className = "places";
    const h = doc.createElement("h2");
    h.textContent = MAP_PLACES;
    places.append(h);
    const rows = new Map<number, { row: HTMLElement; dist: HTMLElement }>();
    for (const p of data.places) {
      const row = doc.createElement("button");
      row.type = "button";
      const name = doc.createElement("span");
      name.className = "name";
      name.textContent = p.name;
      const dist = doc.createElement("span");
      dist.className = "dist";
      const kind = doc.createElement("span");
      kind.className = "kind";
      kind.textContent = KIND_WORD[p.kind];
      row.append(name, dist, kind);
      row.addEventListener("click", guard((e: Event) => {
        e.stopPropagation();
        chooseDestination("place", p.id);
        // The map goes to the place.
        vs.lcx = p.x;
        vs.lcz = p.z;
        dirty = true;
      }));
      places.append(row);
      rows.set(p.id, { row, dist });
    }
    const tools = doc.createElement("div");
    tools.className = "tools";
    const zoom = (k: number): void => {
      zoomLarge(vs, k, bigW / 2, bigH / 2, bigW, bigH);
      dirty = true;
    };
    tools.append(
      button("+", MAP_ZOOM_IN, () => zoom(1.6)),
      button("−", MAP_ZOOM_OUT, () => zoom(1 / 1.6)),
      button(MAP_CENTRE, MAP_CENTRE, () => {
        if (lastFrame !== null) {
          vs.lcx = lastFrame.x;
          vs.lcz = lastFrame.z;
        }
        dirty = true;
      }),
      button(MAP_CLEAR, MAP_CLEAR, () => {
        clearDestination();
        dirty = true;
      }),
    );
    wrap.append(places, tools);
    root.append(wrap);
    ui = { places, rows };
  };

  // Pointers on the large map: one drags, two pinch; a press let go where it began is a click.
  const pointers = new Map<number, { x: number; y: number }>();
  const press = { x: 0, y: 0, moved: false };
  let pinchDist = 0;
  let lastClick: { at: number; x: number; y: number; saved: ReturnType<typeof saveNav> } | null = null;
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    const k = r.width > 0 ? bigW / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
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
    root.classList.remove("dragging");
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
        root.classList.add("dragging");
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
    root.classList.remove("dragging");
  }));
  canvas.addEventListener("wheel", guard(wheel as (e: Event) => void), { passive: false });
  // Nothing of the map's pointer reaches the game's canvas behind it, where a click would resume play. A tap on the corner map opens the large one.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) root.addEventListener(type, (e) => {
    if (paused || touch) e.stopPropagation();
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
    if (!shown) {
      shown = true;
      root.style.display = "";
    }
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
      snapView(vs, f.driving, isNight(f.hour));
      layout();
      setBitmap(smallSize, smallSize, canvasScale(smallSize, smallSize, win.devicePixelRatio || 1, LARGE_BYTES));
    }
    const wantPaused = mapAsk.open || (!f.engaged && everEngaged);
    if (wantPaused !== paused) setPaused(wantPaused, f);
    if (!paused) layout();
    party.update(f.rtt, now);
    root.classList.toggle("tappable", touch && !paused);
    aimView(vs, f.driving, isNight(f.hour));
    stepView(vs, dt);
    profile = f.driving ? "drive" : "foot";

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
    root.classList.toggle("active", nav.dest !== null || nav.waypoints.length > 0);
    const route = updateTracker(tracker, () => graphFor(data as MapData), now, ox, oz, profile, goal2);
    let slim: string | null;
    if (goal2 !== null) slim = route === null ? goal2.name : `${goal2.name} · ${formatDistance(route.length)}`;
    else if (room !== undefined) slim = room.name;
    else slim = streetOn(f, now) || null;

    // The large map's list of the four places: how far each is along the streets, once a second.
    if (paused && ui !== null && now - listAt >= 1) {
      listAt = now;
      const lens = routeLengths(graphFor(data), profile, ox, oz, data.places);
      data.places.forEach((p, i) => {
        const cell = ui?.rows.get(p.id);
        const text = formatDistance(lens[i] as number);
        if (cell !== undefined && cell.dist.textContent !== text) cell.dist.textContent = text;
      });
    }
    if (ui !== null) for (const [id, cell] of ui.rows) cell.row.classList.toggle("chosen", nav.dest !== null && nav.dest.kind === "place" && nav.dest.id === id);

    // Redraw policy: the minimap when something it shows changed by a pixel (or the looks are easing), at most 30 a second; the large map on input and when the mark moves.
    const w = paused ? bigW : smallSize;
    const mmpp = paused ? vs.lmpp : minimapView(vs, w, w, f.x, f.z, f.heading).mpp;
    const sig = `${route === null ? "" : `${route.pts.length}:${Math.round(route.length)}`}|${slim ?? ""}|${nav.waypoints.length}|${nav.dest?.id ?? 0}${nav.dest?.kind ?? ""}|${paused ? 1 : 0}`;
    const px = Math.hypot(f.x - drawn.x, f.z - drawn.z) / mmpp;
    const turned = Math.abs(f.heading - drawn.heading) * (paused ? 34 : eased(vs.look) > 0.5 ? 110 : 34);
    if (dirty || sig !== drawn.sig || px >= 1 || !(turned < 1) || mmpp !== drawn.mpp || moving(vs)) {
      if (now - drawnAt >= DRAW_EVERY) {
        paint(f, route, slim);
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

  const paint = (f: MapFrame, route: { pts: readonly number[] } | null, slim: string | null): void => {
    if (ctx === null || drawer === null || data === null) return;
    const t0 = env.clock();
    const w = paused ? bigW : smallSize;
    const v = paused ? view() : minimapView(vs, w, w, f.x, f.z, f.heading);
    const scene: Scene = {
      data, view: v, e: eased(vs.look), night: eased(vs.night), dpr: scale, large: paused, soft: !paused,
      player: { x: f.x, z: f.z, heading: f.heading, driving: f.driving },
      route, waypoints: nav.waypoints, destination: nav.dest, slim,
    };
    drawer.draw(scene);
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
            root.classList.remove("paused");
            container.classList.remove("capemap-open");
            doc.body?.classList.remove("capemap-open");
          }
          root.style.display = "none";
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
      style.remove();
    },
    info: () => ({ shown, paused, broken, rect: { ...rect }, canvas: { width: canvas.width, height: canvas.height }, root }),
    drawNow() {
      if (lastFrame !== null) guard(() => paint(lastFrame as MapFrame, tracker.route, null))();
    },
  };
}


