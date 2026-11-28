/**
 * What is on a wall, and where there is room for one more thing. A wall face is a plane (an axis, the way it looks, how far along that axis), and everything that meets it (a slab or a gallery edge, a flight and its
 * rail, a partition or a column that abuts it, tall furniture against it, a window or the door, a board or a picture or a casing already on it) is a rectangle in that plane, along the wall and up. A hanging is a rectangle
 * too, and it is put only where no rectangle is within `MARGIN` of it and where it lies wholly inside one storey's clear height: over a floor that holds the whole of it in front of the wall, and under whatever
 * slab meets the wall over it.
 *
 * Pure (a design's lists in, rectangles out), so the builder settles a design's hangings with it (`settleHangings`) and a test holds every room to it (`conflicts`).
 */
import type { Block, Decor, DesignWindow, Slab, Stair, Surface, Wall } from "./design.js";
import { FRONT_WALL } from "./design.js";

const { abs, floor, max, min, round } = Math;

/** How far a hanging stands from anything on its wall, and from the soffit over it, metres. */
export const MARGIN = 0.15;

/** What hangs on a wall: a picture, a board, a sign, a clock, a mural, a lamp, a screen, a shelf. */
export const HANGINGS: readonly string[] = [
  "television", "guitar", "poster", "sign", "board", "wall_lamp", "ac_unit", "picture", "frame_art", "forest_picture", "clock", "extinguisher", "art", "light_switch", "fire_plan", "coast_map", "pin_board",
  "certificate", "mural", "chalkboard", "neon_sign", "dartboard", "wall_shelf", "mirror", "coat_hooks", "lit_letters",
];

/** What else stands on a wall's face as a piece of its own (a hanging must not overlap it, and it is not moved): a glazed front, a window's curtains or panes, a door's leaf, a closet's front. */
export const OCCUPANTS: readonly string[] = ["glazing", "curtain_pair", "lit_pane", "door_leaf", "closet_front"];

/** A face of a wall: the axis it is across (`s`: a left or right wall, a partition across `s`; `d`: the front, the back, a partition across `d`), the way it looks along it, and where it stands. */
export type Plane = { readonly axis: "s" | "d"; readonly sign: 1 | -1; readonly c: number };
/** A rectangle in a plane: from `t0` to `t1` along the wall (`d` for an `s` plane, `s` for a `d` plane) and from `y0` to `y1` up. */
export type Rect = { readonly t0: number; readonly t1: number; readonly y0: number; readonly y1: number };

/** The parts of a design that a wall's face is measured against. */
export type Space = {
  readonly width: number; readonly depth: number; readonly height: number; readonly doorS: number; readonly doorWidth: number; readonly doorHead: number;
  readonly surfaces: readonly Surface[]; readonly blocks: readonly Block[]; readonly walls: readonly Wall[]; readonly slabs: readonly Slab[]; readonly stairs: readonly Stair[];
  readonly windows?: readonly DesignWindow[]; readonly decor: readonly Decor[];
};

export function planeOf(dc: Decor): Plane | null {
  if (abs(dc.face.s) > 0.5) return { axis: "s", sign: dc.face.s > 0 ? 1 : -1, c: dc.s };
  if (abs(dc.face.d) > 0.5) return { axis: "d", sign: dc.face.d > 0 ? 1 : -1, c: dc.d };
  return null;
}

/** Whether two planes are one face of one wall. */
export const samePlane = (a: Plane, b: Plane): boolean => a.axis === b.axis && a.sign === b.sign && abs(a.c - b.c) < 0.2;

/** The rectangle of a decoration in its plane. */
export function rectOf(dc: Decor): Rect {
  const t = abs(dc.face.s) > 0.5 ? dc.d : dc.s;
  return { t0: t - dc.w / 2, t1: t + dc.w / 2, y0: dc.y - dc.h / 2, y1: dc.y + dc.h / 2 };
}

/** Whether a plane is a face of the room's outer wall (where a hanging may be moved to another place). */
export function outerPlane(p: Plane, sp: Pick<Space, "width" | "depth">): boolean {
  return p.axis === "s" ? (p.sign === 1 && abs(p.c) < 0.3) || (p.sign === -1 && abs(p.c - sp.width) < 0.3) : (p.sign === 1 && abs(p.c - FRONT_WALL) < 0.3) || (p.sign === -1 && abs(p.c - sp.depth) < 0.3);
}

/** How far the wall can be hung along: from just inside one end to just inside the other. */
function reach(p: Plane, sp: Pick<Space, "width" | "depth">): [number, number] {
  return p.axis === "s" ? [FRONT_WALL + 0.1, sp.depth - 0.1] : [0.1, sp.width - 0.1];
}

type Labelled = Rect & { readonly what: string };

/** The extent of a block along the plane's normal and along the wall: its middle (as a depth in front of the plane) and half widths. */
function blockInPlane(b: Block, p: Plane): { depth: number; en: number; t: number; et: number } {
  const es = abs(b.ax) * b.ha + abs(b.ad) * b.hb;
  const ed = abs(b.ad) * b.ha + abs(b.ax) * b.hb;
  return p.axis === "s" ? { depth: p.sign * (b.s - p.c), en: es, t: b.d, et: ed } : { depth: p.sign * (b.d - p.c), en: ed, t: b.s, et: es };
}

/** What meets a plane: slabs, flights, blocks, windows and the door, and the pieces standing on it (other than `self`). Not the hangings. */
export function occupancy(sp: Space, p: Plane, self?: Decor): Labelled[] {
  const out: Labelled[] = [];
  const depthOf = (lo: { s: number; d: number }, hi: { s: number; d: number }): [number, number] => {
    const a = p.axis === "s" ? p.sign * (lo.s - p.c) : p.sign * (lo.d - p.c);
    const b = p.axis === "s" ? p.sign * (hi.s - p.c) : p.sign * (hi.d - p.c);
    return [min(a, b), max(a, b)];
  };
  const along = (lo: { s: number; d: number }, hi: { s: number; d: number }): [number, number] => (p.axis === "s" ? [lo.d, hi.d] : [lo.s, hi.s]);
  // Slabs that reach the plane: a floor's thickness and what hangs under it, a ceiling's.
  for (const sl of sp.slabs) {
    const [near, far] = depthOf({ s: sl.s0, d: sl.d0 }, { s: sl.s1, d: sl.d1 });
    if (far < -0.06 || near > 0.06) continue;
    const [t0, t1] = along({ s: sl.s0, d: sl.d0 }, { s: sl.s1, d: sl.d1 });
    out.push(sl.kind === "floor" ? { t0, t1, y0: sl.y - sl.thick - 0.05, y1: sl.y + 0.02, what: "floor slab" } : { t0, t1, y0: sl.y - 0.02, y1: sl.y + sl.thick, what: "ceiling slab" });
  }
  // Flights near the plane: each slice of the climb up to the handrail over it.
  for (const st of sp.stairs) {
    const [near, far] = depthOf({ s: st.s0, d: st.d0 }, { s: st.s1, d: st.d1 });
    if (far < -0.06 || near > 0.3) continue;
    const [t0, t1] = along({ s: st.s0, d: st.d0 }, { s: st.s1, d: st.d1 });
    const climbsAlongWall = (p.axis === "s") === (st.along === "d");
    const hi = max(st.y0, st.y1);
    const low = min(st.base, st.y0, st.y1);
    if (!climbsAlongWall) {
      out.push({ t0, t1, y0: low, y1: hi + 1.0, what: "stair" });
      continue;
    }
    const n = max(1, floor((t1 - t0) / 0.5) + 1);
    for (let i = 0; i < n; i++) {
      const a = t0 + ((t1 - t0) * i) / n;
      const b = t0 + ((t1 - t0) * (i + 1)) / n;
      const ya = st.y0 + ((st.y1 - st.y0) * (a - t0)) / (t1 - t0);
      const yb = st.y0 + ((st.y1 - st.y0) * (b - t0)) / (t1 - t0);
      out.push({ t0: a, t1: b, y0: low, y1: max(ya, yb) + 1.0, what: "stair" });
    }
  }
  // Blocks against it: furniture, columns, partitions, rails. A thin one across the plane's own middle is the wall itself.
  for (const b of sp.blocks) {
    if (b.y1 <= 0.3) continue;
    const q = blockInPlane(b, p);
    const near = q.depth - q.en;
    const far = q.depth + q.en;
    if (far < -0.06 || near > 0.3) continue;
    // A thin block lying along the plane's own middle is the wall that carries it (a partition's piece), not something against it.
    const along = p.axis === "s" ? abs(b.ad) : abs(b.ax);
    if (along > 0.9 && q.en <= 0.12 && abs(q.depth) <= q.en + 0.06) continue;
    out.push({ t0: q.t - q.et, t1: q.t + q.et, y0: b.y0, y1: b.y1, what: "block" });
  }
  // The room's windows and its door.
  for (const w of sp.windows ?? []) {
    const wp: Plane = w.wall === "left" ? { axis: "s", sign: 1, c: 0 } : w.wall === "right" ? { axis: "s", sign: -1, c: sp.width } : { axis: "d", sign: -1, c: sp.depth };
    if (wp.axis === p.axis && wp.sign === p.sign && abs(wp.c - p.c) < 0.3) out.push({ t0: w.a0 - 0.1, t1: w.a1 + 0.1, y0: w.y0 - 0.1, y1: w.y1 + 0.1, what: "window" });
  }
  if (p.axis === "d" && p.sign === 1 && abs(p.c - FRONT_WALL) < 0.3) out.push({ t0: sp.doorS - sp.doorWidth / 2 - 0.1, t1: sp.doorS + sp.doorWidth / 2 + 0.1, y0: 0, y1: sp.doorHead + 0.1, what: "door" });
  // Pieces of the wall's face that are not hangings: a glazed front, curtains, a leaf.
  for (const dc of sp.decor) {
    if (dc === self || !OCCUPANTS.includes(dc.kind)) continue;
    const dp = planeOf(dc);
    if (dp !== null && samePlane(dp, p)) out.push({ ...rectOf(dc), what: dc.kind });
  }
  return out;
}

/** The floors that hold a stretch of a wall in front of it, as the heights they are at (highest first). */
function floorsAt(sp: Space, p: Plane, t0: number, t1: number): number[] {
  const ys: number[] = [];
  for (const sf of sp.surfaces) {
    if (sf.kind !== "floor") continue;
    const a = p.axis === "s" ? p.sign * (sf.s0 - p.c) : p.sign * (sf.d0 - p.c);
    const b = p.axis === "s" ? p.sign * (sf.s1 - p.c) : p.sign * (sf.d1 - p.c);
    if (min(a, b) > 0.35 || max(a, b) < 0.6) continue;
    const [lo, hi] = p.axis === "s" ? [sf.d0, sf.d1] : [sf.s0, sf.s1];
    if (lo <= t0 + 0.05 && hi >= t1 - 0.05 && !ys.includes(sf.y)) ys.push(sf.y);
  }
  // The floors that are drawn as slabs hold it too (a closed corridor beyond a barrier is no ground and is a floor to hang over).
  for (const sl of sp.slabs) {
    if (sl.kind !== "floor") continue;
    const a = p.axis === "s" ? p.sign * (sl.s0 - p.c) : p.sign * (sl.d0 - p.c);
    const b = p.axis === "s" ? p.sign * (sl.s1 - p.c) : p.sign * (sl.d1 - p.c);
    if (min(a, b) > 0.35 || max(a, b) < 0.6) continue;
    const [lo, hi] = p.axis === "s" ? [sl.d0, sl.d1] : [sl.s0, sl.s1];
    if (lo <= t0 + 0.05 && hi >= t1 - 0.05 && !ys.includes(sl.y)) ys.push(sl.y);
  }
  return ys.sort((x, y) => y - x);
}

/**
 * The storey a rectangle hangs in: the floor in front of the whole of it that it hangs over (its foot a quarter metre over it at the least), and the lowest of the slab over it that meets the wall over its stretch
 * and the ceiling: or null where it is over no floor, or crosses a slab.
 */
export function storeyOf(sp: Space, p: Plane, r: Rect, margin = MARGIN): { floor: number; soffit: number } | null {
  const floors = floorsAt(sp, p, r.t0, r.t1).filter((f) => f + 0.25 <= r.y0);
  const floor = floors[0];
  if (floor === undefined) return null;
  let soffit = sp.height;
  for (const sl of sp.slabs) {
    const a = p.axis === "s" ? p.sign * (sl.s0 - p.c) : p.sign * (sl.d0 - p.c);
    const b = p.axis === "s" ? p.sign * (sl.s1 - p.c) : p.sign * (sl.d1 - p.c);
    if (max(a, b) < -0.06 || min(a, b) > 0.06) continue;
    const [lo, hi] = p.axis === "s" ? [sl.d0, sl.d1] : [sl.s0, sl.s1];
    if (hi <= r.t0 || lo >= r.t1) continue;
    const bottom = sl.kind === "floor" ? sl.y - sl.thick : sl.y;
    if (bottom > floor + 0.5) soffit = min(soffit, bottom);
  }
  return r.y1 + margin <= soffit ? { floor, soffit } : null;
}

const overlaps = (a: Rect, b: Rect, m: number): boolean => a.t0 < b.t1 + m - 1e-6 && b.t0 < a.t1 + m - 1e-6 && a.y0 < b.y1 + m - 1e-6 && b.y0 < a.y1 + m - 1e-6;

/** What a rectangle on a plane runs into: the first thing in the occupancy list or among `others` that is within `margin` of it ("storey" when it is not wholly inside one), or null. */
export function clash(sp: Space, p: Plane, r: Rect, others: readonly Rect[], margin = MARGIN, self?: Decor, occ?: readonly Labelled[]): string | null {
  if (storeyOf(sp, p, r, margin) === null) return "storey";
  for (const o of occ ?? occupancy(sp, p, self)) if (overlaps(r, o, margin)) return o.what;
  for (const o of others) if (overlaps(r, o, margin)) return "hanging";
  return null;
}

/**
 * What carries a hanging's face: the room's outer wall, a partition (a wall of the design), or an item (a hoarding's face, a screen: its signs are made for it and are held only apart from one another).
 */
export function hostOf(sp: Space, p: Plane): "outer" | "partition" | "item" {
  if (outerPlane(p, sp)) return "outer";
  for (const w of sp.walls) {
    const along = abs(w.d1 - w.d0) < 0.01 ? "d" : abs(w.s1 - w.s0) < 0.01 ? "s" : null;
    if (along === null) continue;
    // A wall along `s` (constant `d`) carries faces whose plane is across `d`.
    if (along === "d" && p.axis === "d" && abs(w.d0 - p.c) <= w.thick / 2 + 0.12) return "partition";
    if (along === "s" && p.axis === "s" && abs(w.s0 - p.c) <= w.thick / 2 + 0.12) return "partition";
  }
  return "item";
}

/** Every hanging of a design that is cut by something at its place, overlaps another hanging, or is not wholly inside one storey: each with what it runs into, for a test and a report. */
export function conflicts(sp: Space, margin = MARGIN): { readonly decor: Decor; readonly with: string }[] {
  const out: { decor: Decor; with: string }[] = [];
  const hangs = sp.decor.filter((d) => HANGINGS.includes(d.kind) && planeOf(d) !== null);
  for (let i = 0; i < hangs.length; i++) {
    const h = hangs[i] as Decor;
    const p = planeOf(h) as Plane;
    const others: Rect[] = [];
    for (let j = 0; j < hangs.length; j++) {
      if (j === i) continue;
      const o = hangs[j] as Decor;
      const op = planeOf(o) as Plane;
      if (samePlane(op, p)) others.push(rectOf(o));
    }
    const host = hostOf(sp, p);
    const why = host === "item" ? (others.some((o) => overlaps(rectOf(h), o, 0.02)) ? "hanging" : null) : clash(sp, p, rectOf(h), others, margin, h);
    if (why !== null) out.push({ decor: h, with: why });
  }
  return out;
}

/** The order hangings are settled in: a mural first, then the pieces with words and fixtures, then the pictures; the larger first. */
function priority(d: Decor): number {
  if (d.kind === "mural") return 0;
  if (d.kind === "art" || d.kind === "picture" || d.kind === "frame_art" || d.kind === "forest_picture" || d.kind === "poster") return 2;
  return 1;
}

/** The sizes a hanging may be scaled to, to fit: a picture or a mural shrinks, a board or a sign (its words are drawn to its size) does not. */
function scalesOf(d: Decor): readonly number[] {
  return d.kind === "mural" || d.kind === "board" || priority(d) === 2 ? [1, 0.85, 0.7] : [1];
}

/** The heights a hanging's middle may be tried at: where it is, and 1.4 to 1.8 m over each floor that holds its place. */
function heights(sp: Space, p: Plane, t0: number, t1: number, y: number, h: number): number[] {
  const out = [y];
  for (const f of floorsAt(sp, p, t0, t1)) for (let k = 0; k <= 4; k++) out.push(f + 1.4 + k * 0.1);
  // A big piece (a mural) may hang higher in a tall space: over each floor, up from 1.8 m by half a metre.
  if (h > 1.2) for (const f of floorsAt(sp, p, t0, t1)) for (let k = 1; k <= 6; k++) out.push(f + 1.8 + k * 0.25);
  return out;
}

export type Settled = { readonly decor: Decor[]; readonly moved: number; readonly shrunk: number; readonly dropped: number };

/**
 * Puts every hanging on an outer wall where nothing meets it (`clash`): as it is if it clears, else the nearest place along the wall and up it that does (at the same size, then at 85 and 70 percent for a
 * picture or a mural); a piece that fits nowhere is left out. Everything else is kept. Pieces on a partition are not moved (their plates are put over their own doorways).
 */
export function settleHangings(sp: Space): Settled {
  const movable = (d: Decor): boolean => HANGINGS.includes(d.kind) && planeOf(d) !== null && hostOf(sp, planeOf(d) as Plane) !== "item";
  const keep = sp.decor.filter((d) => !movable(d));
  const todo = sp.decor.filter(movable);
  todo.sort((a, b) => priority(a) - priority(b) || b.w * b.h - a.w * a.h || a.id - b.id);
  const placed: Decor[] = [];
  let moved = 0;
  let shrunk = 0;
  let dropped = 0;
  const occCache: { key: string; occ: Labelled[] }[] = [];
  const planeKey = (p: Plane): string => `${p.axis}${p.sign}${round(p.c * 10)}`;
  // Hangings on partitions (and the other pieces) count where they stand.
  const fixedOn = (p: Plane): Rect[] => keep.filter((d) => HANGINGS.includes(d.kind) && planeOf(d) !== null && samePlane(planeOf(d) as Plane, p)).map(rectOf);
  for (const h of todo) {
    const p = planeOf(h) as Plane;
    const key = planeKey(p);
    let hit = occCache.find((e) => e.key === key);
    if (hit === undefined) {
      hit = { key, occ: occupancy(sp, p) };
      occCache.push(hit);
    }
    const occ = hit.occ;
    const others = [...fixedOn(p), ...placed.filter((d) => samePlane(planeOf(d) as Plane, p)).map(rectOf)];
    const r0 = rectOf(h);
    const t = (r0.t0 + r0.t1) / 2;
    const [lo, hi] = reach(p, sp);
    const tryAt = (scale: number, tt: number, yy: number): boolean => {
      const w = h.w * scale;
      const hh = h.h * scale;
      if (tt - w / 2 < lo || tt + w / 2 > hi) return false;
      return clash(sp, p, { t0: tt - w / 2, t1: tt + w / 2, y0: yy - hh / 2, y1: yy + hh / 2 }, others, MARGIN, h, occ) === null;
    };
    const put = (scale: number, tt: number, yy: number): void => {
      const cm = (x: number): number => round(x * 100) / 100;
      const at = p.axis === "s" ? { s: h.s, d: cm(tt) } : { s: cm(tt), d: h.d };
      placed.push({ ...h, ...at, y: cm(yy), w: cm(h.w * scale), h: cm(h.h * scale) });
      if (scale !== 1) shrunk++;
      else if (abs(tt - t) > 0.005 || abs(yy - h.y) > 0.005) moved++;
    };
    let done = false;
    for (const s of scalesOf(h)) {
      if (tryAt(s, t, h.y)) {
        put(s, t, h.y);
        done = true;
        break;
      }
    }
    if (done) continue;
    // The nearest place: every tenth of a metre along the wall, at each height.
    const cands: { cost: number; scale: number; t: number; y: number }[] = [];
    // On a partition a piece is only nudged (a plate over its own doorway): a little along, and up or down.
    const partition = hostOf(sp, p) === "partition";
    for (const s of scalesOf(h)) {
      const ys = heights(sp, p, max(lo, t - h.w / 2), min(hi, t + h.w / 2), h.y, h.h * s);
      if (partition) for (let k = -24; k <= 24; k++) ys.push(h.y + k * 0.05);
      for (const y of ys) {
        for (let tt = partition ? max(lo, t - 0.6) : lo; tt <= (partition ? min(hi, t + 0.6) : hi); tt += 0.1) cands.push({ cost: abs(tt - t) + 1.5 * abs(y - h.y) + (1 - s) * 4, scale: s, t: tt, y });
      }
    }
    cands.sort((a, b) => a.cost - b.cost);
    for (const c of cands) {
      if (tryAt(c.scale, c.t, c.y)) {
        put(c.scale, c.t, c.y);
        done = true;
        break;
      }
    }
    if (!done) dropped++;
  }
  // Back in the order they were made.
  const all = [...keep, ...placed].sort((a, b) => a.id - b.id);
  return { decor: all, moved, shrunk, dropped };
}

