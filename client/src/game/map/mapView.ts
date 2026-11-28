/**
 * The map's view: where it looks, at what scale and turn, in which look (on foot or driving) and by day or night, and the easing of those;
 * and the maths between the world and the screen. Pure: no canvas and no DOM.
 *
 * The world's x is east and its z is north; the screen's y is down. A view puts the world's point (`cx`, `cz`) at the screen's (`markX`,
 * `markY`) and turns the map by `turn` radians (clockwise on the screen), so a point at (x, z) is at
 *   sx = markX + (cos * (x - cx) + sin * (z - cz)) / mpp
 *   sy = markY + (sin * (x - cx) - cos * (z - cz)) / mpp
 * With no turn that is north up. With the turn `-heading` (a heading is the angle of the vector (sin, cos) in the world), what lies ahead
 * of the player is up the screen.
 */

/** How many metres across the shorter side of the minimap shows, on foot and driving. */
export const FOOT_ACROSS = 180, DRIVE_ACROSS = 420;
/** The large map's metres a pixel, at the nearest and at the farthest. */
export const MIN_MPP = 0.25, MAX_MPP = 8;
/** How long the change between the two looks takes, and the change between day and night, seconds. */
export const LOOK_SECONDS = 0.6, NIGHT_SECONDS = 0.5;
/** Night is from 19:00 to 6:00. */
export const NIGHT_FROM = 19, NIGHT_TO = 6;

export function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM || hour < NIGHT_TO;
}

export type MapView = {
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cz: number;
  readonly mpp: number;
  readonly turn: number;
  readonly cos: number;
  readonly sin: number;
  readonly markX: number;
  readonly markY: number;
};

/** What the map keeps from frame to frame. `look` and `night` run from 0 to 1 at a steady rate toward their goals; what is drawn is their smoothed values (`eased`). */
export type ViewState = {
  look: number;
  lookGoal: 0 | 1;
  night: number;
  nightGoal: 0 | 1;
  /** The large map's own centre and scale, kept while it is open. */
  lcx: number;
  lcz: number;
  lmpp: number;
};

export function newViewState(): ViewState {
  return { look: 0, lookGoal: 0, night: 0, nightGoal: 0, lcx: 0, lcz: 0, lmpp: FOOT_ACROSS / 220 };
}

export function eased(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Sets the looks at once, with no easing (the first frame). */
export function snapView(s: ViewState, driving: boolean, night: boolean): void {
  s.look = s.lookGoal = driving ? 1 : 0;
  s.night = s.nightGoal = night ? 1 : 0;
}

/** Asks for a look and a time of day; the easing carries the view there. */
export function aimView(s: ViewState, driving: boolean, night: boolean): void {
  s.lookGoal = driving ? 1 : 0;
  s.nightGoal = night ? 1 : 0;
}

/** Moves the view `dt` seconds toward its goals. */
export function stepView(s: ViewState, dt: number): void {
  const step = (v: number, goal: number, seconds: number): number => (v < goal ? Math.min(goal, v + dt / seconds) : Math.max(goal, v - dt / seconds));
  s.look = step(s.look, s.lookGoal, LOOK_SECONDS);
  s.night = step(s.night, s.nightGoal, NIGHT_SECONDS);
}

/** Whether the easing has not reached its goals. */
export function moving(s: ViewState): boolean {
  return s.look !== s.lookGoal || s.night !== s.nightGoal;
}

/** An angle brought into -PI to PI. */
export function wrapPi(a: number): number {
  const t = Math.PI * 2;
  return a - t * Math.round(a / t);
}

/** The metres a pixel of a minimap `w` by `h` pixels has, at an eased look `e` (0 on foot, 1 driving): the two scales are met by their logarithms. */
export function minimapScale(e: number, w: number, h: number): number {
  const side = Math.min(w, h);
  const foot = FOOT_ACROSS / side;
  const drive = DRIVE_ACROSS / side;
  return Math.exp(Math.log(foot) * (1 - e) + Math.log(drive) * e);
}

function make(w: number, h: number, cx: number, cz: number, mpp: number, turn: number, markX: number, markY: number): MapView {
  return { w, h, cx, cz, mpp, turn, cos: Math.cos(turn), sin: Math.sin(turn), markX, markY };
}

/**
 * The minimap's view for a player at (`x`, `z`) heading `heading` (the angle of the vector (sin, cos) of their facing; the car's nose when
 * driving). On foot the map is north up with the player at its middle; driving it is turned so that the heading is up, and the player is a
 * third of the way up from the bottom, so that more of the road ahead shows. The two are eased between by the state's look.
 */
export function minimapView(s: ViewState, w: number, h: number, x: number, z: number, heading: number): MapView {
  const e = eased(s.look);
  return make(w, h, x, z, minimapScale(e, w, h), -wrapPi(heading) * e, w / 2, h / 2 + (e * h) / 6);
}

/** The large map's view: north up whatever the look, the player's mark wherever it is. */
export function largeView(s: ViewState, w: number, h: number): MapView {
  return make(w, h, s.lcx, s.lcz, s.lmpp, 0, w / 2, h / 2);
}

/** Opens the large map: centred on the player and at the minimap's present scale. */
export function openLarge(s: ViewState, x: number, z: number, mpp: number): void {
  s.lcx = x;
  s.lcz = z;
  s.lmpp = Math.min(MAX_MPP, Math.max(MIN_MPP, mpp));
}

export function worldToScreen(v: MapView, x: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
  const dx = x - v.cx;
  const dz = z - v.cz;
  out.x = v.markX + (v.cos * dx + v.sin * dz) / v.mpp;
  out.y = v.markY + (v.sin * dx - v.cos * dz) / v.mpp;
  return out;
}

export function screenToWorld(v: MapView, sx: number, sy: number, out: { x: number; z: number }): { x: number; z: number } {
  const u = (sx - v.markX) * v.mpp;
  const t = (sy - v.markY) * v.mpp;
  out.x = v.cx + v.cos * u + v.sin * t;
  out.z = v.cz + v.sin * u - v.cos * t;
  return out;
}

/** The unit vector on the screen of a direction (`dx`, `dz`) of the world. */
export function directionOnScreen(v: MapView, dx: number, dz: number, out: { x: number; y: number }): void {
  out.x = v.cos * dx + v.sin * dz;
  out.y = v.sin * dx - v.cos * dz;
}

/** Pans the large map by a drag of (`px`, `py`) screen pixels: the map follows the pointer. */
export function panLarge(s: ViewState, px: number, py: number): void {
  s.lcx -= px * s.lmpp;
  s.lcz += py * s.lmpp;
}

/** Zooms the large map by `factor` (more than 1 brings it nearer) about the screen point (`sx`, `sy`) of a view `w` by `h`, which stays where it is; the scale is held to its limits. */
export function zoomLarge(s: ViewState, factor: number, sx: number, sy: number, w: number, h: number): void {
  const next = Math.min(MAX_MPP, Math.max(MIN_MPP, s.lmpp / factor));
  const before = { x: 0, z: 0 };
  screenToWorld(largeView(s, w, h), sx, sy, before);
  s.lmpp = next;
  const after = { x: 0, z: 0 };
  screenToWorld(largeView(s, w, h), sx, sy, after);
  s.lcx += before.x - after.x;
  s.lcz += before.z - after.z;
}
