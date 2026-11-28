/**
 * The phone the pause screen is: its body, its screen (the map's canvas goes in it), and the phone-style map app laid over the canvas: a status bar either side of the camera
 * cutout (the game's clock at the left, signal, wireless and battery marks at the right), a search-like field under it that holds the destination's name and distance (a tap
 * clears it), round floating buttons for the zoom and the centre on the right edge of the map, a bottom sheet (a handle and the nearest place, opened to all four by a tap or
 * a drag of the handle), and a home indicator. Everything is inside the screen's rounded corners. Made with DOM calls; the shapes and sizes come from `phoneShape.ts`, and the
 * look from `PHONE_CSS`. No maker's name, logo or wordmark appears anywhere on it: it is "the phone".
 */
import { MAP_CENTRE, MAP_PLACES, MAP_SEARCH, MAP_ZOOM_IN, MAP_ZOOM_OUT, MAP_BAR, MAP_CAFE, MAP_LODGING, MAP_OFFICE } from "../words.js";
import type { PlaceKind } from "./mapData.js";
import { sheetAfter, sheetHeight, type PhoneLayout, type Sheet } from "./phoneShape.js";

export const PHONE_CSS = `
.capephone {
  position: absolute; z-index: 19; display: none; box-sizing: border-box; background: #000; pointer-events: auto;
  font-family: system-ui, 'Segoe UI', sans-serif; color: #1c1d20; user-select: none; -webkit-user-select: none;
  /* The thin titanium-grey frame: a lighter rim with a faint highlight at the top edge. */
  box-shadow: 0 0 0 1px #4d5054, inset 0 0 0 2px #8f9398, inset 0 0 0 3px rgba(255, 255, 255, 0.16), inset 0 2px 2px 1px rgba(255, 255, 255, 0.28), 0 14px 44px rgba(0, 0, 0, 0.55);
}
.capephone.in { animation: phone-in 300ms cubic-bezier(0.2, 0.8, 0.25, 1); }
.capephone.out { animation: phone-out 300ms ease-in forwards; }
@keyframes phone-in { from { transform: translateY(110%); } to { transform: none; } }
@keyframes phone-out { from { transform: none; } to { transform: translateY(110%); } }
@keyframes phone-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes phone-fade-out { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .capephone.in { animation: phone-fade-in 200ms ease-out; }
  .capephone.out { animation: phone-fade-out 200ms ease-in forwards; }
}
.capephone .side { position: absolute; width: 3px; background: linear-gradient(90deg, #6e7176, #a3a7ac 60%, #7d8085); border-radius: 1.5px; }
.capephone .side.right { right: -3px; }
.capephone .side.left { left: -3px; transform: scaleX(-1); }
.capephone .pscreen { position: absolute; background: #000; overflow: hidden; }
.capephone .pscreen canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.capephone .pscreen canvas.dragging { cursor: grabbing; }
.capephone .cutout { position: absolute; background: #000; border-radius: 999px; pointer-events: none; z-index: 3; }
.capephone .statusbar { position: absolute; left: 0; right: 0; top: 0; z-index: 2; pointer-events: none; display: flex; justify-content: space-between; align-items: center; padding: 0 9% 0 10%; color: #1c1d20; background: linear-gradient(rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0)); }
.capephone .statusbar .clock { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
.capephone .statusbar svg { width: 56px; height: 12px; display: block; }
.capephone .search {
  position: absolute; left: 10px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; box-sizing: border-box;
  border: none; border-radius: 19px; background: rgba(255, 255, 255, 0.95); color: #1c1d20; font: 500 13px/1 system-ui, sans-serif; text-align: left; cursor: pointer;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.28);
}
.capephone .search svg { width: 16px; height: 16px; flex: none; opacity: 0.6; }
.capephone .search .n { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.capephone .search .d { flex: none; white-space: nowrap; opacity: 0.7; }
.capephone .search .x { flex: none; font-size: 17px; line-height: 1; opacity: 0.55; }
.capephone .search.empty { cursor: default; color: rgba(28, 29, 32, 0.6); }
.capephone .search.empty .x { display: none; }
.capephone .floaters { position: absolute; right: 10px; z-index: 2; display: flex; flex-direction: column; gap: 8px; }
.capephone .floaters button {
  width: 38px; height: 38px; padding: 0; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.95); color: #1c1d20; cursor: pointer;
  font: 500 20px/1 system-ui, sans-serif; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
}
.capephone .floaters button svg { width: 18px; height: 18px; }
.capephone .floaters button:active, .capephone .search:active { filter: brightness(0.92); }
.capephone .sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; box-sizing: border-box; background: rgba(255, 255, 255, 0.97); color: #1c1d20;
  border-radius: 18px 18px 0 0; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.25); transition: height 220ms ease;
}
.capephone .handle { display: block; width: 100%; height: 22px; padding: 0; border: none; background: none; cursor: grab; position: relative; touch-action: none; }
.capephone .handle::after { content: ""; position: absolute; left: 50%; top: 8px; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: rgba(0, 0, 0, 0.25); }
.capephone .rows { padding: 0 8px; }
.capephone .row {
  display: grid; grid-template-columns: 1fr auto; column-gap: 10px; align-items: center; width: 100%; height: 54px; box-sizing: border-box; padding: 6px 10px; margin: 0;
  border: none; border-radius: 10px; background: none; color: inherit; text-align: left; cursor: pointer; font: inherit;
}
.capephone .row .name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.capephone .row .dist { font-size: 13px; opacity: 0.7; }
.capephone .row .kind { grid-column: 1 / span 2; font-size: 11px; opacity: 0.55; letter-spacing: 0.04em; }
.capephone .row.chosen { background: rgba(66, 133, 244, 0.14); }
.capephone .row:active { background: rgba(0, 0, 0, 0.07); }
.capephone .sheet.collapsed .row { display: none; }
.capephone .sheet.collapsed .row.nearest { display: grid; }
.capephone .homebar { position: absolute; left: 50%; bottom: 7px; width: 36%; height: 4.5px; margin-left: -18%; border-radius: 3px; background: rgba(0, 0, 0, 0.72); z-index: 3; pointer-events: none; }
/* By night the phone's own app is dark, as a phone's is. */
.capephone.night .statusbar { color: #eceef2; background: linear-gradient(rgba(10, 14, 22, 0.8), rgba(10, 14, 22, 0)); }
.capephone.night .search, .capephone.night .floaters button { background: rgba(32, 38, 50, 0.96); color: #eceef2; }
.capephone.night .search.empty { color: rgba(236, 238, 242, 0.6); }
.capephone.night .sheet { background: rgba(28, 33, 44, 0.98); color: #eceef2; }
.capephone.night .handle::after { background: rgba(255, 255, 255, 0.3); }
.capephone.night .row.chosen { background: rgba(110, 160, 255, 0.2); }
.capephone.night .homebar { background: rgba(255, 255, 255, 0.8); }
`;

/** What the phone asks of its owner when the player presses something on it. */
export type PhoneActions = {
  zoomIn(): void;
  zoomOut(): void;
  centre(): void;
  clear(): void;
  pick(id: number): void;
};

export type PhonePlace = { readonly id: number; readonly name: string; readonly kind: PlaceKind };

const KIND_WORD: Record<PlaceKind, string> = { bar: MAP_BAR, cafe: MAP_CAFE, lodging: MAP_LODGING, office: MAP_OFFICE };
const NS = "http://www.w3.org/2000/svg";

function svg(doc: Document, view: string, parts: readonly { d: string; fill?: boolean; width?: number }[]): SVGSVGElement {
  const el = doc.createElementNS(NS, "svg");
  el.setAttribute("viewBox", view);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const p of parts) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", p.d);
    if (p.fill === true) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    } else path.setAttribute("stroke-width", String(p.width ?? 1.6));
    el.append(path);
  }
  return el;
}

export type Phone = {
  readonly root: HTMLElement;
  /** The screen's element: the map's canvas is put first in it. */
  readonly screen: HTMLElement;
  /** Lays the body out in the view and sizes the screen and what is laid on it. */
  place(layout: PhoneLayout): void;
  /** The clock in the status bar, and whether the phone is in its dark look. */
  setStatus(clock: string, night: boolean): void;
  /** What the search field holds: the destination's name and the distance left, or null for none. */
  setSearch(name: string | null, distance: string | null): void;
  /** A place's row in the sheet: the distance, whether it is the nearest and whether it is the destination. */
  setRow(id: number, distance: string, nearest: boolean, chosen: boolean): void;
  sheet(): Sheet;
  setSheet(sheet: Sheet): void;
  /** The height the sheet has now, pixels (the floating buttons stand over it). */
  sheetHeightNow(): number;
  dispose(): void;
};

export function createPhone(doc: Document, places: readonly PhonePlace[], actions: PhoneActions, guard: <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => void): Phone {
  const root = doc.createElement("div");
  root.className = "capephone";
  // The buttons on the edges: on the right a long one in the upper third and a short flush one lower down; on the left two volume buttons and a short one above them.
  const sides: readonly [string, number, number][] = [["right", 22, 11], ["right", 49, 4], ["left", 15, 3.5], ["left", 21.5, 7], ["left", 30.5, 7]];
  for (const [edge, top, h] of sides) {
    const b = doc.createElement("div");
    b.className = `side ${edge}`;
    b.style.top = `${top}%`;
    b.style.height = `${h}%`;
    root.append(b);
  }
  const screen = doc.createElement("div");
  screen.className = "pscreen";
  const cutout = doc.createElement("div");
  cutout.className = "cutout";
  const statusbar = doc.createElement("div");
  statusbar.className = "statusbar";
  const clock = doc.createElement("span");
  clock.className = "clock";
  statusbar.append(clock, svg(doc, "0 0 56 12", [
    { d: "M0 8h2v3H0zM4 6h2v5H4zM8 4h2v7H8zM12 2h2v9h-2z", fill: true },
    { d: "M20 5.4a6 6 0 0 1 8 0M21.9 7.6a3.3 3.3 0 0 1 4.2 0" },
    { d: "M24 10.1v.1", width: 2.2 },
    { d: "M34.5 2.5h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM52.5 5v3", width: 1.2 },
    { d: "M34 4h11v5H34z", fill: true },
  ]));
  const search = doc.createElement("button");
  search.type = "button";
  search.className = "search empty";
  search.setAttribute("aria-label", MAP_SEARCH);
  const sName = doc.createElement("span");
  sName.className = "n";
  sName.textContent = MAP_SEARCH;
  const sDist = doc.createElement("span");
  sDist.className = "d";
  const sX = doc.createElement("span");
  sX.className = "x";
  sX.textContent = "×";
  search.append(svg(doc, "0 0 24 24", [{ d: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5l5 5", width: 2 }]), sName, sDist, sX);
  search.addEventListener("click", guard((e: Event) => {
    e.stopPropagation();
    actions.clear();
  }));
  const floaters = doc.createElement("div");
  floaters.className = "floaters";
  const round = (content: Node | string, label: string, on: () => void): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    if (typeof content === "string") b.textContent = content;
    else b.append(content);
    b.addEventListener("click", guard((e: Event) => {
      e.stopPropagation();
      on();
    }));
    return b;
  };
  floaters.append(
    round("+", MAP_ZOOM_IN, actions.zoomIn),
    round("−", MAP_ZOOM_OUT, actions.zoomOut),
    round(svg(doc, "0 0 24 24", [{ d: "M12 4v3M12 17v3M4 12h3M17 12h3", width: 2 }, { d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", width: 2 }]), MAP_CENTRE, actions.centre),
  );
  // The sheet: its handle, and a row for each place.
  const sheetEl = doc.createElement("div");
  sheetEl.className = "sheet collapsed";
  sheetEl.setAttribute("aria-label", MAP_PLACES);
  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = "handle";
  handle.setAttribute("aria-label", MAP_PLACES);
  const rowsEl = doc.createElement("div");
  rowsEl.className = "rows";
  const rows = new Map<number, { row: HTMLElement; dist: HTMLElement }>();
  for (const p of places) {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = "row";
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
      actions.pick(p.id);
    }));
    rowsEl.append(row);
    rows.set(p.id, { row, dist });
  }
  sheetEl.append(handle, rowsEl);
  const home = doc.createElement("div");
  home.className = "homebar";
  screen.append(cutout, statusbar, search, floaters, sheetEl, home);
  root.append(screen);

  let sheet: Sheet = "collapsed";
  const applySheet = (): void => {
    sheetEl.classList.toggle("collapsed", sheet === "collapsed");
    const h = sheetHeight(sheet, places.length);
    sheetEl.style.height = `${h}px`;
    floaters.style.bottom = `${h + 12}px`;
  };
  // A press of the handle that goes up or down by enough moves the sheet; a short one is a tap and flips it.
  let pressY: number | null = null;
  handle.addEventListener("pointerdown", guard((e: Event) => {
    e.stopPropagation();
    pressY = (e as PointerEvent).clientY;
    (handle as HTMLElement & { setPointerCapture?(id: number): void }).setPointerCapture?.((e as PointerEvent).pointerId);
  }));
  handle.addEventListener("pointerup", guard((e: Event) => {
    e.stopPropagation();
    if (pressY === null) return;
    sheet = sheetAfter(sheet, (e as PointerEvent).clientY - pressY);
    pressY = null;
    applySheet();
  }));
  handle.addEventListener("pointercancel", () => {
    pressY = null;
  });
  // A keyboard's Enter on the handle is a click with no pointer: it flips the sheet.
  handle.addEventListener("click", guard((e: Event) => {
    e.stopPropagation();
    if ((e as MouseEvent).detail === 0) {
      sheet = sheet === "collapsed" ? "expanded" : "collapsed";
      applySheet();
    }
  }));
  applySheet();

  return {
    root,
    screen,
    place(l) {
      root.style.left = `${l.left}px`;
      root.style.top = `${l.top}px`;
      root.style.width = `${l.bodyW}px`;
      root.style.height = `${l.bodyH}px`;
      root.style.borderRadius = `${l.bodyRadius}px`;
      screen.style.left = `${l.inset}px`;
      screen.style.top = `${l.inset}px`;
      screen.style.width = `${l.screenW}px`;
      screen.style.height = `${l.screenH}px`;
      screen.style.borderRadius = `${l.screenRadius}px`;
      cutout.style.left = `${l.cutout.x}px`;
      cutout.style.top = `${l.cutout.y}px`;
      cutout.style.width = `${l.cutout.w}px`;
      cutout.style.height = `${l.cutout.h}px`;
      statusbar.style.height = `${l.statusH}px`;
      search.style.top = `${l.statusH + 4}px`;
    },
    setStatus(text, night) {
      if (clock.textContent !== text) clock.textContent = text;
      root.classList.toggle("night", night);
    },
    setSearch(name, distance) {
      const has = name !== null;
      search.classList.toggle("empty", !has);
      sName.textContent = has ? name : MAP_SEARCH;
      sDist.textContent = has && distance !== null ? ` · ${distance}` : "";
    },
    setRow(id, distance, nearest, chosen) {
      const r = rows.get(id);
      if (r === undefined) return;
      if (r.dist.textContent !== distance) r.dist.textContent = distance;
      r.row.classList.toggle("nearest", nearest);
      r.row.classList.toggle("chosen", chosen);
    },
    sheet: () => sheet,
    setSheet(next) {
      sheet = next;
      applySheet();
    },
    sheetHeightNow: () => sheetHeight(sheet, places.length),
    dispose() {
      root.remove();
    },
  };
}

