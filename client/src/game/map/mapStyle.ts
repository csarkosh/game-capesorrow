/**
 * How the map looks: two looks (on foot, and driving), each with a day and a night palette, in the clean flat manner of a modern street-map
 * app. The colours here are the game's own. A palette between two looks, or between day and night, is the mix of the two; `paletteFor`
 * gives it and keeps the ones it has made.
 */
import { ALLEY, AVENUE, HIGHWAY, MAIN, ROAD, STAIR, TRACK, WHARF } from "./mapData.js";

export type Palette = {
  water: string; land: string; made: string; green: string; block: string; deck: string;
  building: string; buildingEdge: string; landmark: string; landmarkEdge: string; enterable: string; enterableEdge: string;
  street: string; streetCasing: string; major: string; majorCasing: string; wharf: string; wharfCasing: string; track: string; trackCasing: string;
  rail: string; stair: string; text: string; halo: string;
  route: string; routeEdge: string; player: string; ring: string; flag: string; panel: string; panelText: string;
  bar: string; cafe: string; lodging: string; office: string;
};

const FOOT_DAY: Palette = {
  water: "#a9d3f0", land: "#f3f0ea", made: "#e8e4db", green: "#cfe6c6", block: "#ebe7df", deck: "#d9cdb5",
  building: "#e1dcd3", buildingEdge: "#cfc9be", landmark: "#dccfbb", landmarkEdge: "#c2b298", enterable: "#fde3b5", enterableEdge: "#e7a94a",
  street: "#ffffff", streetCasing: "#d8d4cc", major: "#ffffff", majorCasing: "#d8d4cc", wharf: "#f1e8d4", wharfCasing: "#cdbf9f", track: "#ece3cd", trackCasing: "#cbbf9f",
  rail: "#a9a69f", stair: "#b9b4aa", text: "#5f6368", halo: "#ffffff",
  route: "#4a86f0", routeEdge: "#2a5fc8", player: "#2a6fe8", ring: "#ffffff", flag: "#2a6fe8", panel: "#ffffff", panelText: "#3c4043",
  bar: "#e8710a", cafe: "#a85d1c", lodging: "#8e44c9", office: "#0f9aa8",
};
const DRIVE_DAY: Palette = {
  ...FOOT_DAY,
  building: "#ece8e0", buildingEdge: "#ece8e0", landmark: "#e6dccb", landmarkEdge: "#e6dccb", enterable: "#fbe3bd", enterableEdge: "#ecb560",
  major: "#fbdc83", majorCasing: "#e6b54a", text: "#5f6368",
};
const FOOT_NIGHT: Palette = {
  water: "#17263c", land: "#242f3e", made: "#2a3546", green: "#22392f", block: "#293648", deck: "#3a4252",
  building: "#2c3848", buildingEdge: "#38465c", landmark: "#34404f", landmarkEdge: "#46546a", enterable: "#5b4a2a", enterableEdge: "#c8903a",
  street: "#3a4658", streetCasing: "#1b2432", major: "#3a4658", majorCasing: "#1b2432", wharf: "#41485a", wharfCasing: "#1b2432", track: "#333d4d", trackCasing: "#1b2432",
  rail: "#5c677a", stair: "#566176", text: "#9aa6b8", halo: "#242f3e",
  route: "#6ea0ff", routeEdge: "#3b6fd8", player: "#5b9bff", ring: "#ffffff", flag: "#6ea0ff", panel: "#1f2937", panelText: "#c8d1e0",
  bar: "#f08a2c", cafe: "#c97a36", lodging: "#a566dc", office: "#2ab6c4",
};
const DRIVE_NIGHT: Palette = {
  ...FOOT_NIGHT,
  building: "#273241", buildingEdge: "#273241", landmark: "#2e3a49", landmarkEdge: "#2e3a49", enterable: "#4f4226", enterableEdge: "#a87a30",
  major: "#7a5f2c", majorCasing: "#4e3b16",
};

type Rgb = readonly [number, number, number];
const RGB = new Map<string, Rgb>();

/** A colour as its three parts, from `#rrggbb` or the `rgb(r,g,b)` that a mix makes. */
export function rgbOf(c: string): Rgb {
  let v = RGB.get(c);
  if (v === undefined) {
    if (c.startsWith("rgb(")) {
      const m = c.slice(4, -1).split(",").map(Number);
      v = [m[0] as number, m[1] as number, m[2] as number];
    } else v = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    RGB.set(c, v);
  }
  return v;
}

/** The colour `t` of the way from `a` to `b` (each `#rrggbb`). */
export function mixColour(a: string, b: string, t: number): string {
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  const p = rgbOf(a);
  const q = rgbOf(b);
  return `rgb(${Math.round(p[0] + (q[0] - p[0]) * t)},${Math.round(p[1] + (q[1] - p[1]) * t)},${Math.round(p[2] + (q[2] - p[2]) * t)})`;
}

/**
 * The small map sits back: its ground, drawing and lettering are desaturated and drawn toward a haze (a soft grey-cream by day, near the
 * scene's own dark blue by night), so that land, blocks and water lie closer in tone and the map pulls the eye less. What must stay the
 * clearest is left as it is: the four places' buildings and their edges, the player's mark, the route and the flags.
 */
const SOFT = {
  ground: { keys: ["water", "land", "made", "green", "block", "deck"], gray: 0.45, haze: 0.35 },
  drawn: { keys: ["building", "buildingEdge", "landmark", "landmarkEdge", "street", "streetCasing", "major", "majorCasing", "wharf", "wharfCasing", "track", "trackCasing", "rail", "stair"], gray: 0.35, haze: 0.15 },
  lettering: { keys: ["text", "halo"], gray: 0.2, haze: 0.25 },
  pins: { keys: ["bar", "cafe", "lodging", "office"], gray: 0.3, haze: 0 },
} as const;
const HAZE_DAY = "#e2dfd8", HAZE_NIGHT = "#1a2230";

function softened(p: Palette, night: number): Palette {
  const out = { ...p };
  const haze = mixColour(HAZE_DAY, HAZE_NIGHT, night);
  for (const g of Object.values(SOFT)) {
    for (const k of g.keys) {
      const c = p[k as keyof Palette];
      const [r, gr, b] = rgbOf(c);
      const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
      const gray = `rgb(${Math.round(r + (lum - r) * g.gray)},${Math.round(gr + (lum - gr) * g.gray)},${Math.round(b + (lum - b) * g.gray)})`;
      out[k as keyof Palette] = g.haze > 0 ? mixColour(gray, haze, g.haze) : gray;
    }
  }
  return out;
}

const STEPS = 16;
const MADE = new Map<number, Palette>();

function mixPalettes(a: Palette, b: Palette, t: number): Palette {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof Palette)[]) out[k] = mixColour(a[k], b[k], t);
  return out;
}

/** The palette at an eased look `e` (0 on foot, 1 driving) and night `n` (0 day, 1 night), to a sixteenth of each; `soft` is the small map's, which sits back (the large map is not soft). */
export function paletteFor(e: number, n: number, soft = false): Palette {
  const ie = Math.round(Math.min(1, Math.max(0, e)) * STEPS);
  const inn = Math.round(Math.min(1, Math.max(0, n)) * STEPS);
  const key = ie * 64 + inn + (soft ? 100000 : 0);
  let p = MADE.get(key);
  if (p === undefined) {
    const day = mixPalettes(FOOT_DAY, DRIVE_DAY, ie / STEPS);
    p = inn === 0 ? day : mixPalettes(day, mixPalettes(FOOT_NIGHT, DRIVE_NIGHT, ie / STEPS), inn / STEPS);
    if (soft) p = softened(p, inn / STEPS);
    MADE.set(key, p);
  }
  return p;
}

/** The colours a class of street is drawn in: its fill and its casing. */
export function streetColours(p: Palette, cls: number): { fill: string; casing: string } {
  if (cls === HIGHWAY || cls === AVENUE) return { fill: p.major, casing: p.majorCasing };
  if (cls === WHARF) return { fill: p.wharf, casing: p.wharfCasing };
  if (cls === TRACK) return { fill: p.track, casing: p.trackCasing };
  return { fill: p.street, casing: p.streetCasing };
}

/**
 * The widths a street of the class `cls` with the roadway `w` is stroked with, in metres: its fill is its real roadway width, never thinner
 * than 2 pixels (1.5 for an alley driving), and its casing a pixel wider each side. Driving, the highway and the avenues are wider and the
 * alleys thin. `mpp` is the metres a pixel of the view is, and `e` the eased look.
 */
export function streetWidths(cls: number, w: number, e: number, mpp: number): { fill: number; casing: number } {
  let width = w;
  if (cls === HIGHWAY || cls === AVENUE) width = w * (1 + 0.3 * e);
  else if (cls === ALLEY) width = w * (1 - 0.35 * e);
  const least = (cls === ALLEY ? 2 - 0.5 * e : 2) * mpp;
  const fill = Math.max(width, least);
  return { fill, casing: fill + 2 * mpp };
}

/** Whether a street of the class carries its name at the eased look: on foot every named street does, driving only the bigger ones. */
export function namedAt(cls: number, e: number): boolean {
  if (cls === ALLEY || cls === STAIR || cls === TRACK) return false;
  return e < 0.5 || cls === HIGHWAY || cls === AVENUE || cls === MAIN || cls === ROAD;
}
