/**
 * The marks drawn over the map in screen pixels: a place's pin (a rounded drop in the colour of its kind with a simple white glyph drawn in
 * code), the flag of a waypoint, and the player's mark (a blue dot with a facing cone on foot, a blue arrowhead driving).
 */
import type { MapCtx, PathLike } from "./mapCtx.js";
import type { PlaceKind } from "./mapData.js";
import type { Palette } from "./mapStyle.js";

/** The radius of a pin's head at scale 1, pixels. */
export const PIN_R = 8;

/** The pin's colour for a kind of place. */
export function placeColour(p: Palette, kind: PlaceKind): string {
  return kind === "bar" ? p.bar : kind === "cafe" ? p.cafe : kind === "lodging" ? p.lodging : p.office;
}

/** The pin's outline: a circle with a point below it, its tip at (`x`, `y`). Its head's centre is returned. */
function dropPath(path: PathLike, x: number, y: number, r: number): { cx: number; cy: number } {
  const d = r * 2.2;
  const cy = y - d;
  const phi = Math.acos(r / d);
  path.moveTo(x, y);
  path.lineTo(x + r * Math.cos(Math.PI / 2 - phi), cy + r * Math.sin(Math.PI / 2 - phi));
  path.arc(x, cy, r, Math.PI / 2 - phi, Math.PI / 2 + phi, true);
  path.closePath();
  return { cx: x, cy };
}

/** The glyph of a kind of place in white, in a box about (`cx`, `cy`) that is 10 units across, a unit `s` pixels. */
function glyphPath(path: PathLike, kind: PlaceKind, cx: number, cy: number, s: number): void {
  const r = (x: number, y: number, w: number, h: number): void => path.rect(cx + x * s, cy + y * s, w * s, h * s);
  const pt = (x: number, y: number): [number, number] => [cx + x * s, cy + y * s];
  if (kind === "bar") {
    // A glass: a wide bowl on a stem and a foot.
    path.moveTo(...pt(-4, -3.8));
    path.lineTo(...pt(4, -3.8));
    path.lineTo(...pt(0.6, 0.4));
    path.lineTo(...pt(0.6, 3));
    path.lineTo(...pt(2.4, 3.8));
    path.lineTo(...pt(-2.4, 3.8));
    path.lineTo(...pt(-0.6, 3));
    path.lineTo(...pt(-0.6, 0.4));
    path.closePath();
  } else if (kind === "cafe") {
    // A cup with a handle on a saucer.
    r(-3.6, -2.6, 5.6, 5.4);
    r(2, -1.6, 2.4, 1);
    r(3.4, -1.6, 1, 3.2);
    r(2, 0.6, 2.4, 1);
    r(-4.4, 3.4, 8.8, 0.9);
  } else if (kind === "lodging") {
    // A bed: a headboard, a mattress and a pillow.
    r(-4.6, -3.4, 1.4, 6.4);
    r(-4.6, 0.2, 9.2, 2.6);
    r(-2.8, -1.6, 3.4, 1.4);
  } else {
    // A columned front: a pediment over three columns on a base.
    path.moveTo(...pt(-4.8, -1.6));
    path.lineTo(...pt(0, -4.6));
    path.lineTo(...pt(4.8, -1.6));
    path.closePath();
    r(-3.6, -1, 1.5, 4);
    r(-0.75, -1, 1.5, 4);
    r(2.1, -1, 1.5, 4);
    r(-4.8, 3.2, 9.6, 1);
  }
}

/** A place's pin standing at (`x`, `y`) at `scale` times the usual size. Three drawing operations. */
export function drawPin(ctx: MapCtx, p: Palette, kind: PlaceKind, x: number, y: number, scale: number): void {
  const r = PIN_R * scale;
  const drop = ctx.newPath();
  const c = dropPath(drop, x, y, r);
  ctx.fill(drop, placeColour(p, kind));
  ctx.stroke(drop, "#ffffff", Math.max(1, 1.5 * scale));
  const glyph = ctx.newPath();
  glyphPath(glyph, kind, c.cx, c.cy, (r * 0.78) / 5);
  ctx.fill(glyph, "#ffffff");
}

/** The blue flag of a waypoint, its pole's foot at (`x`, `y`). Two operations. */
export function drawFlag(ctx: MapCtx, p: Palette, x: number, y: number, scale: number): void {
  const s = scale;
  const flag = ctx.newPath();
  flag.rect(x - 1 * s, y - 20 * s, 2 * s, 20 * s);
  flag.moveTo(x + 1 * s, y - 20 * s);
  flag.lineTo(x + 12 * s, y - 15.5 * s);
  flag.lineTo(x + 1 * s, y - 11 * s);
  flag.closePath();
  ctx.stroke(flag, "#ffffff", 3 * s);
  ctx.fill(flag, p.flag);
}

/** The player's mark on foot: a facing cone over a blue dot with a white ring. `dx`, `dy` is the unit vector of the facing on the screen. Three operations. */
export function drawWalker(ctx: MapCtx, p: Palette, x: number, y: number, dx: number, dy: number): void {
  const a = Math.atan2(dy, dx);
  const cone = ctx.newPath();
  cone.moveTo(x, y);
  cone.arc(x, y, 34, a - 0.62, a + 0.62);
  cone.closePath();
  ctx.fill(cone, p.player, 0.26);
  const ring = ctx.newPath();
  ring.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill(ring, p.ring);
  const dot = ctx.newPath();
  dot.arc(x, y, 6.4, 0, Math.PI * 2);
  ctx.fill(dot, p.player);
}

/** The player's mark in a car: a blue arrowhead with a white edge, pointing along (`dx`, `dy`). Two operations. */
export function drawDriver(ctx: MapCtx, p: Palette, x: number, y: number, dx: number, dy: number): void {
  const px = -dy;
  const py = dx;
  const head = ctx.newPath();
  head.moveTo(x + dx * 14, y + dy * 14);
  head.lineTo(x - dx * 9 + px * 9, y - dy * 9 + py * 9);
  head.lineTo(x - dx * 4, y - dy * 4);
  head.lineTo(x - dx * 9 - px * 9, y - dy * 9 - py * 9);
  head.closePath();
  ctx.stroke(head, p.ring, 4);
  ctx.fill(head, p.player);
}

/**
 * Where a pin for a point at (`tx`, `ty`) stands in a view `w` by `h` whose own mark is at (`mx`, `my`): at the point itself where it is
 * within the view's edge (kept `inset` pixels in; `top` more at the top, for a pin's head), else on the border, on the line from the mark
 * to the point. `border` says which.
 */
export function pinSpot(w: number, h: number, mx: number, my: number, tx: number, ty: number, inset: number, top: number, out: { x: number; y: number; border: boolean }): void {
  const minX = inset;
  const maxX = w - inset;
  const minY = inset + top;
  const maxY = h - inset;
  if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) {
    out.x = tx;
    out.y = ty;
    out.border = false;
    return;
  }
  const dx = tx - mx;
  const dy = ty - my;
  let s = 1;
  if (dx > 0) s = Math.min(s, (maxX - mx) / dx);
  else if (dx < 0) s = Math.min(s, (minX - mx) / dx);
  if (dy > 0) s = Math.min(s, (maxY - my) / dy);
  else if (dy < 0) s = Math.min(s, (minY - my) / dy);
  out.x = mx + dx * Math.max(0, s);
  out.y = my + dy * Math.max(0, s);
  out.border = true;
}

/** Where a place's pin stands, and whether its distance is written under it. */
export type Spot = { x: number; y: number; border: boolean; label: boolean; /** Where the distance is written: under a pin on a rectangle's border, inside the ring on a round one. */ lx: number; ly: number };

/** The least room two pins on one border need along it, pixels: a pin and its label stacked, down a side; a label's width, along the top or bottom. */
export const GAP_SIDE = 34, GAP_ALONG = 40;

/**
 * Where the pins of the places stand in a view `w` by `h` whose mark is at (`mx`, `my`), given where the places themselves are on the screen
 * (`at`): each pin where its place is, or on the border in the direction it lies; and pins on the border are slid apart along it, so that
 * no two (nor their distance labels) lie over one another. Where there is no room to slide them all, the nearer keeps its label and the
 * farther loses it. The result is written into `out`, one spot to a place.
 */
export function placeSpots(w: number, h: number, mx: number, my: number, at: readonly { x: number; y: number }[], out: Spot[], top = 22): void {
  const inset = 16;
  const tmp = { x: 0, y: 0, border: false };
  out.length = at.length;
  for (let i = 0; i < at.length; i++) {
    const a = at[i] as { x: number; y: number };
    pinSpot(w, h, mx, my, a.x, a.y, inset, top, tmp);
    const o = out[i] ?? (out[i] = { x: 0, y: 0, border: false, label: true, lx: 0, ly: 0 });
    o.x = tmp.x;
    o.y = tmp.y;
    o.border = tmp.border;
    o.label = true;
  }
  // The border pins of each side, in order along it.
  const sides: number[][] = [[], [], [], []];
  for (let i = 0; i < out.length; i++) {
    const o = out[i] as Spot;
    if (!o.border) continue;
    const side = o.x <= inset + 0.5 ? 0 : o.x >= w - inset - 0.5 ? 1 : o.y <= inset + top + 0.5 ? 2 : 3;
    (sides[side] as number[]).push(i);
  }
  sides.forEach((list, side) => {
    if (list.length < 2) return;
    const vertical = side < 2;
    const key = (i: number): number => ((vertical ? (out[i] as Spot).y : (out[i] as Spot).x));
    const set = (i: number, v: number): void => {
      if (vertical) (out[i] as Spot).y = v;
      else (out[i] as Spot).x = v;
    };
    const lo = vertical ? inset + top : inset;
    const hi = vertical ? h - inset : w - inset;
    const gap = vertical ? GAP_SIDE : GAP_ALONG;
    list.sort((a, b) => key(a) - key(b));
    for (let k = 1; k < list.length; k++) set(list[k] as number, Math.max(key(list[k] as number), key(list[k - 1] as number) + gap));
    // Pushed past the end: back from it.
    if (key(list[list.length - 1] as number) > hi) {
      set(list[list.length - 1] as number, hi);
      for (let k = list.length - 2; k >= 0; k--) set(list[k] as number, Math.min(key(list[k] as number), key(list[k + 1] as number) - gap));
    }
    // Still no room: they stack at the start, and the farther of two that touch has no label.
    for (let k = 0; k < list.length; k++) set(list[k] as number, Math.max(lo, key(list[k] as number)));
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1] as number;
      const b = list[k] as number;
      if (key(b) - key(a) < gap * 0.6) {
        const da = Math.hypot((out[a] as Spot).x - mx, (out[a] as Spot).y - my);
        const db = Math.hypot((out[b] as Spot).x - mx, (out[b] as Spot).y - my);
        (out[da > db ? a : b] as Spot).label = false;
      }
    }
  });
  for (const o of out) {
    o.lx = o.x;
    o.ly = o.y + 9;
  }
}

/** A rectangle of the screen, left, top, right, bottom. */
export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** Half the width of the arc at twelve o'clock where the watch's clock is and no pin stands, radians (about 25 degrees). */
export const CLOCK_ARC = 0.436;

/**
 * The pins' places on a round screen (the watch's): a place inside the ring (`radius` from the circle's centre (`cx`, `cy`)) is where it is; one outside has its pin on the ring, on the line from
 * the mark (`mx`, `my`) to it, and its distance is written just inside the ring, on the side of the pin that keeps farthest from the points in `avoid` (the route's). Pins on the ring are kept `gap` pixels apart along it and out of the top arc where the watch's clock is (`CLOCK_ARC` either side of twelve o'clock), and where there is no room the farther loses its label.
 */
export function ringSpots(cx: number, cy: number, radius: number, mx: number, my: number, at: readonly { x: number; y: number }[], out: Spot[], gap = 30, avoid: readonly { x: number; y: number }[] = [], keepOut: readonly Box[] = []): void {
  out.length = at.length;
  const ringed: number[] = [];
  for (let i = 0; i < at.length; i++) {
    const a = at[i] as { x: number; y: number };
    const o = out[i] ?? (out[i] = { x: 0, y: 0, border: false, label: true, lx: 0, ly: 0 });
    o.label = true;
    if (Math.hypot(a.x - cx, a.y - cy) <= radius) {
      o.x = a.x;
      o.y = a.y;
      o.border = false;
      o.lx = a.x;
      o.ly = a.y + 9;
      continue;
    }
    // Where the line from the mark meets the ring (the mark is inside it).
    const dx = a.x - mx, dy = a.y - my, fx = mx - cx, fy = my - cy;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - radius * radius;
    const t = A > 0 ? (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A) : 0;
    o.x = mx + dx * t;
    o.y = my + dy * t;
    o.border = true;
    ringed.push(i);
  }
  const angle = (i: number): number => Math.atan2((out[i] as Spot).y - cy, (out[i] as Spot).x - cx);
  const place = (i: number, th: number): void => {
    (out[i] as Spot).x = cx + radius * Math.cos(th);
    (out[i] as Spot).y = cy + radius * Math.sin(th);
  };
  const th = new Map<number, number>();
  for (const i of ringed) th.set(i, angle(i));
  ringed.sort((a, b) => (th.get(a) as number) - (th.get(b) as number));
  const arc = gap / radius;
  // Forward passes keep the pins an arc apart, and a pin that falls in the clock's arc goes to its nearer edge; repeated, since each can push the other.
  const top = -Math.PI / 2;
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 0; k < ringed.length; k++) {
      const i = ringed[k] as number;
      let v = th.get(i) as number;
      if (k > 0) v = Math.max(v, (th.get(ringed[k - 1] as number) as number) + arc);
      if (Math.abs(v - top) < CLOCK_ARC) v = v < top ? top - CLOCK_ARC : top + CLOCK_ARC;
      th.set(i, v);
    }
  }
  for (let k = 0; k < ringed.length; k++) {
    const i = ringed[k] as number;
    place(i, th.get(i) as number);
    const next = ringed[(k + 1) % ringed.length] as number;
    if (ringed.length > 1) {
      let span = (th.get(next) as number) - (th.get(i) as number);
      if (k === ringed.length - 1) span += Math.PI * 2;
      // No room (the pins have gone round the ring): the farther of two that touch loses its label.
      if (span < arc * 0.6) {
        const di = Math.hypot((out[i] as Spot).x - mx, (out[i] as Spot).y - my);
        const dn = Math.hypot((out[next] as Spot).x - mx, (out[next] as Spot).y - my);
        (out[di > dn ? i : next] as Spot).label = false;
      }
    }
    const o = out[i] as Spot;
    // The distance goes just inside the ring: toward its centre, or to either side of that, whichever keeps farthest from the route's dots.
    const ix = (cx - o.x) / radius;
    const iy = (cy - o.y) / radius;
    let best = -1;
    let free = false;
    for (const [a, b] of [[0, 0], [1, 1], [1, -1]] as const) {
      const lx = o.x + ix * 13 + (-iy) * 17 * b * a;
      const ly = o.y + iy * 13 + ix * 17 * b * a;
      // Never under the line's backing or the clock (a label is about 34 by 11 px).
      if (keepOut.some((k) => lx + 17 > k.x0 && lx - 17 < k.x1 && ly + 6 > k.y0 && ly - 6 < k.y1)) continue;
      free = true;
      let near = Infinity;
      for (const p of avoid) near = Math.min(near, Math.hypot(p.x - lx, p.y - ly));
      // The middle one is kept unless a side is clearly clearer (by 6 px), so that labels do not wander without a route.
      const score = near + (a === 0 ? 6 : 0);
      if (score > best) {
        best = score;
        o.lx = lx;
        o.ly = ly + 1;
      }
    }
    // No place for it that is clear: the pin stays and its distance is left out.
    if (!free) o.label = false;
  }
}
