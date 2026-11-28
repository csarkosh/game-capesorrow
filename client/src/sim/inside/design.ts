/**
 * A room as a design: one pure description, made from the world's seed and the place's own measures, from which both the walking (`designWalk.ts`)
 * and the drawing (`game/town/designGeometry.ts`) are derived, so that they cannot disagree. A wall, a rail, a stair and a piece of furniture each
 * state themselves once, and the blocks a hull is pushed out of follow from the same numbers that are drawn.
 *
 * Everything is in the room's frame: `s` along the front wall from the room's left end as the street sees it, `d` into the building (the front
 * wall's inner face is at `FRONT_WALL`, the back wall's at `depth`), and `y` up from the room's floor (`InsideRoom.floorY`). Material names, kinds of
 * furniture and activities are plain strings here; `game/town/interiorMaterials.ts`, `game/town/furniture/` and `game/town/people.ts` say what they are.
 *
 * Standing: a `Surface` is what feet stand on, a floor at one height or a ramp whose height runs along `s` or `d` (a flight of stairs is a ramp to the
 * walker). A `Block` is what a hull is pushed out of: an oriented rectangle over a height range. A hull on a surface is acted on only by the blocks
 * whose height range meets its own, so a gallery over a hall, a stair with a room under it and a corridor over a lobby all work.
 *
 * Simulation code: the arithmetic of AGENTS.md ("The simulation's rules") applies, and no collection is walked for its order.
 */

const { abs, floor, max, min, round, sqrt } = Math;

/** The front wall's thickness: a room's depth is measured from the front wall's outer face, and the room's shell starts this far in. */
export const FRONT_WALL = 0.15;
/** The most a hull's feet are lifted onto a surface in one move, metres: the highest surface within this over its feet is the one it stands on. */
export const STEP_UP = 0.45;
/** A block acts on a hull only where its height range meets the hull's: from `BODY_LOW` to `BODY_HIGH` over its feet (a thing lower than the first is stepped over). */
export const BODY_LOW = 0.3;
export const BODY_HIGH = 1.7;
/** The headroom a hull needs: under a ramp, a block is made wherever the ramp is lower than this over the floor below. */
export const HEADROOM = 1.9;
/** How thick a rail is, and how long a slice of the block under a ramp is (metres). */
export const RAIL_THICK = 0.08;
const SLICE = 0.25;
/** How thick the guard along a flight's handrail is. */
const GUARD = 0.06;

/** How far in front of the centre the seat of each deep seat ends (its front edge, in the item's frame), for the people who sit on it: the sofa's, the armchair's and the bench's seat as their builders draw them. */
export const SEAT_FRONT: Readonly<Record<string, number>> = { sofa: 0.45, armchair: 0.4, window_bench: 0.25 };
/** How far behind the front edge of a deep seat a sitter's hips are: the clips put the knees 0.4 m forward of the hips. */
export const SEAT_BEHIND = 0.1;

/** A place in the room's frame. */
export type Spot = { readonly s: number; readonly d: number };

/** A floor at one height, or a ramp whose height runs from `y0` at its low end (`s0` or `d0`) to `y1` at the other along `s` or `d`. */
export type Surface =
  | { readonly kind: "floor"; readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly y: number }
  | { readonly kind: "ramp"; readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly along: "s" | "d"; readonly y0: number; readonly y1: number };

/** An oriented rectangle over a height range: centre, unit axis, half its length along the axis and half across it. */
export type Block = { readonly s: number; readonly d: number; readonly ax: number; readonly ad: number; readonly ha: number; readonly hb: number; readonly y0: number; readonly y1: number };

/** A way through a wall: along it from its start, up to `head`; `shut` for a door that is shut (solid, and drawn with its leaf), `arch` for a rounded head. */
export type WallOpening = { readonly a0: number; readonly a1: number; readonly head: number; readonly shut?: boolean; readonly arch?: boolean };
/** A wall: a straight run with a thickness from `y0` to `y1`, with its doorways. `mat` faces the side `(-ud, us)` of its direction `(us, ud)` (for a wall that runs along `s`, the side with more `d`), `matBack` the other. */
export type Wall = {
  readonly s0: number; readonly d0: number; readonly s1: number; readonly d1: number; readonly thick: number; readonly y0: number; readonly y1: number;
  readonly mat: string; readonly matBack?: string; readonly skirt?: string; readonly openings: readonly WallOpening[];
  /** Multipliers of each face's albedo (`mat`'s side, `matBack`'s side). */
  readonly tint?: readonly [number, number, number]; readonly tintBack?: readonly [number, number, number];
  /** The faces are laid as upright boards this wide (metres), each its own strip. */
  readonly boards?: number;
};

/** A floor or a ceiling as drawn: a rectangle at height `y` (the top of a floor, the underside of a ceiling) and how thick it is (an edge is drawn down or up by that much). */
export type Slab = { readonly kind: "floor" | "ceiling"; readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly y: number; readonly thick: number; readonly mat: string; readonly edge?: string; /** A multiplier of the material's albedo, per channel: a darker ceiling, a brighter floor. */ readonly tint?: readonly [number, number, number] };

/** A flight of stairs: a ramp (`along`, `y0` at the low end of `s` or `d`, `y1` at the other), over a floor at `base`, with a handrail on the side of each of `rails` (lo or hi in the other axis). */
export type Stair = {
  readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly along: "s" | "d"; readonly y0: number; readonly y1: number;
  readonly base: number; readonly mat: string; readonly rails: readonly ("lo" | "hi")[];
  /** The flight's sides are glass over a thin stringer (a timber handrail on top), not solid. */
  readonly glass?: boolean;
};

/** A rail at an open edge, from one end to the other, standing on a floor at `y`, `h` high. */
export type Rail = { readonly s0: number; readonly d0: number; readonly s1: number; readonly d1: number; readonly y: number; readonly h: number; readonly kind: "glass" | "bars" | "timber"; readonly mat: string };

/** A piece of furniture or a fixture by kind: its place (the centre of its footprint), the way its front looks, and a few numbers its kind reads (`p`). `id` varies it (a stool turned, a cushion's colour). */
export type Item = { readonly kind: string; readonly s: number; readonly d: number; readonly face: Spot; readonly p: readonly number[]; readonly id: number; readonly mat?: string; /** The height of the floor it stands on (an upper floor's); none is the room's floor. */ readonly y?: number };
/** What hangs on a wall: a picture, a sign with words, a board, a clock, a guitar. `w` by `h` metres, its centre `y` over the floor, `face` the way it looks (into the room). */
export type Decor = { readonly kind: string; readonly s: number; readonly d: number; readonly y: number; readonly face: Spot; readonly w: number; readonly h: number; readonly text?: string; readonly id: number };
/** A light the bake lights the room from: a place, a power (1 is a tube's), the distance (m) at which its light has fallen to a quarter, and a tone. */
export type DesignLight = { readonly s: number; readonly d: number; readonly y: number; readonly kind: "bulb" | "pendant" | "tube" | "lamp" | "strip" | "glow"; readonly power: number; readonly reach: number; readonly tone: readonly [number, number, number];
  /** A fixture that throws its light down in a cone: the exponent of the cosine of the angle from straight down (a downlight is 8 to 20), and a halo of about a metre on the ceiling round it. None: it lights all round. */
  readonly beam?: number;
};
/** Someone in the room: a place, the way they face, an activity (`ACTIVITIES` of `game/town/people.ts`) and the height of the seat for a sitter. */
export type DesignPerson = {
  readonly s: number; readonly d: number; readonly face: Spot; readonly activity: string; readonly role: "staff" | "customer"; readonly sits: number | null; readonly family: "chair" | "stool";
  /** The height of the floor they stand on (an upper floor's); none is the room's floor. */
  readonly y?: number;
};

/** How an outer wall is finished: its material, a wainscot to a height in another, and its skirting. */
export type Finish = {
  readonly mat: string;
  readonly wainscot?: { readonly h: number; readonly mat: string; readonly tint?: readonly [number, number, number] };
  readonly skirt?: string;
  /** A multiplier of the wall material's albedo, per channel. */
  readonly tint?: readonly [number, number, number];
  /** The wall is laid as upright boards this wide (metres), each a little off its neighbour's tone, in place of one grid (a panelled wall). */
  readonly boards?: number;
};
/** The room's mood for the light: the brightest floor's luminance the lights are brought to, the ambient colour and strength, and how much of the day the front's panes let in. */
export type Mood = {
  readonly exposure: number; readonly ambient: readonly [number, number, number]; readonly ambientK: number; readonly day: number;
  /** A pale ceiling gives back light: the light every ceiling face holds before its paint's own colour is laid over it (0.82 of it where no lamp's light falls, the whole of it under a fixture), so that an open ceiling is evenly pale, gently brighter round fixtures. None: the ceiling is lit as everything is. */
  readonly bounce?: number;
  /** The share of the floor's mean light that a wall also holds (default 0.5 where there is a `bounce`): what the room gives back to a wall no lamp reaches. */
  readonly fill?: number;
};

/** A window in the back or a side wall: `a0` to `a1` along the wall (`s` for the back, `d` for a side), `y0` to `y1` over the floor. */
export type DesignWindow = { readonly wall: "back" | "left" | "right"; readonly a0: number; readonly a1: number; readonly y0: number; readonly y1: number };

export type Design = {
  readonly name: string;
  /** True for a design the converter made from the plan's one-floor record: the old whole-room path draws it. */
  readonly legacy: boolean;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly doorS: number;
  readonly doorWidth: number;
  /** The door's head over the floor. */
  readonly doorHead: number;
  /** Where a player arrives inside the door (the hull's centre). */
  readonly arrive: Spot;
  readonly surfaces: readonly Surface[];
  readonly blocks: readonly Block[];
  readonly walls: readonly Wall[];
  readonly slabs: readonly Slab[];
  readonly stairs: readonly Stair[];
  readonly rails: readonly Rail[];
  readonly items: readonly Item[];
  readonly decor: readonly Decor[];
  readonly lights: readonly DesignLight[];
  readonly people: readonly DesignPerson[];
  /** Openings in the back and side walls that a pane of glass is set in (the street's windows are the front wall's own, from the plan): the wall is cut away there when the room is drawn with glass, and a window's frame, blind and curtains hang over it. */
  readonly windows?: readonly DesignWindow[];
  /** The outer walls' finishes, and the ceiling's and the floor's materials. */
  readonly shell: { readonly front: Finish; readonly left: Finish; readonly right: Finish; readonly back: Finish; readonly floor: string; readonly ceiling: string };
  readonly mood: Mood;
  /** Heights over the floor that split the room into storeys for the light: a light only lights what is on its own side of each (the floor of an upper storey has no light of the one under it). */
  readonly cuts?: readonly number[];
  /** The front wall's windows are hung with full-height curtains (the plan says where the windows are). */
  readonly frontCurtains?: boolean;
  /** Places a test or a tool may ask for by name: a point inside the player's room, one past a barrier. `y` is the height of the floor there. */
  readonly marks?: readonly { readonly name: string; readonly s: number; readonly d: number; readonly y: number }[];
};

/** A hash of two integers to [0, 1), by multiplication only: the town's own, written out here since the simulation imports nothing of the game. */
export function hash01(n: number, salt: number): number {
  let h = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A length to a centimetre. */
export const cm = (x: number): number => round(x * 100) / 100;

// ---- surfaces

/** The height of a surface at a place, or null where it does not hold the place. */
export function surfaceHeight(sf: Surface, s: number, d: number): number | null {
  if (s < sf.s0 || s > sf.s1 || d < sf.d0 || d > sf.d1) return null;
  if (sf.kind === "floor") return sf.y;
  if (sf.along === "s") return sf.y0 + ((sf.y1 - sf.y0) * (s - sf.s0)) / (sf.s1 - sf.s0);
  return sf.y0 + ((sf.y1 - sf.y0) * (d - sf.d0)) / (sf.d1 - sf.d0);
}

/** A stair's ramp. */
export function stairSurface(st: Stair): Surface {
  return { kind: "ramp", s0: st.s0, s1: st.s1, d0: st.d0, d1: st.d1, along: st.along, y0: st.y0, y1: st.y1 };
}

/**
 * The blocks of a flight: the block under a ramp where the headroom over `base` is under `HEADROOM`: slices along its rise, each as high as the ramp's own low edge over it
 * (so a hull on the ramp, whose feet are at or over that edge, is never held by it); and, along each side that has a handrail, a thin guard in slices that follow the ramp
 * and stand a metre over it, so that nobody walks off the side of a flight onto the floor beside it.
 */
export function stairBlocks(st: Stair): Block[] {
  const out: Block[] = [];
  const along = st.along === "s";
  const lo = along ? st.s0 : st.d0;
  const hi = along ? st.s1 : st.d1;
  const run = hi - lo;
  const rise = st.y1 - st.y0;
  if (!(run > 0)) return out;
  const n = max(1, floor(run / SLICE));
  const step = run / n;
  for (let i = 0; i < n; i++) {
    const a = lo + i * step;
    const b = a + step;
    // The ramp's lower edge over this slice (the lower of its two ends).
    const yl = st.y0 + (rise * (a - lo)) / run;
    const yh = st.y0 + (rise * (b - lo)) / run;
    const low = min(yl, yh);
    // A hull on the ramp reaches ahead a hull's radius, where the ramp is that much higher; the block stops short of what a hull standing on the ramp could meet, and still stops one on the floor where the ramp is over 0.6 m.
    const top = low - BODY_LOW;
    if (top > st.base + 0.02 && low - st.base < HEADROOM) {
      if (along) out.push({ s: (a + b) / 2, d: (st.d0 + st.d1) / 2, ax: 1, ad: 0, ha: step / 2, hb: (st.d1 - st.d0) / 2, y0: st.base, y1: top });
      else out.push({ s: (st.s0 + st.s1) / 2, d: (a + b) / 2, ax: 0, ad: 1, ha: step / 2, hb: (st.s1 - st.s0) / 2, y0: st.base, y1: top });
    }
    for (const side of st.rails) {
      const edge = side === "lo" ? (along ? st.d0 + GUARD / 2 : st.s0 + GUARD / 2) : along ? st.d1 - GUARD / 2 : st.s1 - GUARD / 2;
      const yLow = min(yl, yh);
      const yHigh = max(yl, yh) + 1;
      if (along) out.push({ s: (a + b) / 2, d: edge, ax: 1, ad: 0, ha: step / 2, hb: GUARD / 2, y0: yLow, y1: yHigh });
      else out.push({ s: edge, d: (a + b) / 2, ax: 0, ad: 1, ha: step / 2, hb: GUARD / 2, y0: yLow, y1: yHigh });
    }
  }
  return out;
}

// ---- walls and rails

/** The blocks of a wall: a stretch between and beyond its doorways at the wall's whole height, a header over each doorway, and a thin block across a shut one. */
export function wallBlocks(w: Wall): Block[] {
  const out: Block[] = [];
  const dx = w.s1 - w.s0;
  const dd = w.d1 - w.d0;
  const len = sqrt(dx * dx + dd * dd);
  if (!(len > 0)) return out;
  const ax = dx / len;
  const ad = dd / len;
  const at = (t: number): Spot => ({ s: w.s0 + ax * t, d: w.d0 + ad * t });
  const piece = (t0: number, t1: number, y0: number, y1: number): void => {
    if (t1 - t0 < 0.01 || y1 - y0 < 0.01) return;
    const c = at((t0 + t1) / 2);
    out.push({ s: c.s, d: c.d, ax, ad, ha: (t1 - t0) / 2, hb: w.thick / 2, y0, y1 });
  };
  let t = 0;
  for (const o of w.openings) {
    piece(t, o.a0, w.y0, w.y1);
    if (o.head < w.y1) piece(o.a0, o.a1, o.head, w.y1);
    if (o.shut === true) piece(o.a0, o.a1, w.y0, o.head);
    t = o.a1;
  }
  piece(t, len, w.y0, w.y1);
  return out;
}

/** A rail's block: a thin one along it, over its height. */
export function railBlock(r: Rail): Block {
  const dx = r.s1 - r.s0;
  const dd = r.d1 - r.d0;
  const len = sqrt(dx * dx + dd * dd);
  return { s: (r.s0 + r.s1) / 2, d: (r.d0 + r.d1) / 2, ax: len > 0 ? dx / len : 1, ad: len > 0 ? dd / len : 0, ha: len / 2 + RAIL_THICK / 2, hb: RAIL_THICK / 2, y0: r.y, y1: r.y + r.h };
}

// ---- furniture footprints

/** A kind's footprint: half its length along its facing, half across it, and its height. */
export type Foot = { readonly ha: number; readonly hb: number; readonly h: number };

/** Whether two oriented rectangles in plan overlap, with `gap` metres to spare between them (the separating-axis test). */
export function blocksOverlap(a: Block, b: Block, gap: number): boolean {
  const axes: readonly (readonly [number, number])[] = [[a.ax, a.ad], [-a.ad, a.ax], [b.ax, b.ad], [-b.ad, b.ax]];
  for (const [ux, ud] of axes) {
    const pa = abs(a.ax * ux + a.ad * ud) * a.ha + abs(-a.ad * ux + a.ax * ud) * a.hb;
    const pb = abs(b.ax * ux + b.ad * ud) * b.ha + abs(-b.ad * ux + b.ax * ud) * b.hb;
    const dist = abs((b.s - a.s) * ux + (b.d - a.d) * ud);
    if (dist >= pa + pb + gap) return false;
  }
  return true;
}

/** An axis-aligned rectangle in plan, for a zone nothing is put in. */
export type Zone = { readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number };

/** A block as the rectangle of a zone's own kind, for the test of whether it touches the zone. */
function zoneBlock(z: Zone): Block {
  return { s: (z.s0 + z.s1) / 2, d: (z.d0 + z.d1) / 2, ax: 1, ad: 0, ha: (z.s1 - z.s0) / 2, hb: (z.d1 - z.d0) / 2, y0: 0, y1: 99 };
}

/**
 * Collects a design: each wall, rail, stair and item is given once, and its blocks and its surface are made from it. Zones can be reserved (the street
 * door's, the way in), and an item that would stand on a zone, on a wall or on another item is refused (`item` answers false), so a design written
 * against any width and depth drops what does not fit and keeps the rest.
 */
export class DesignBuilder {
  readonly surfaces: Surface[] = [];
  readonly blocks: Block[] = [];
  readonly walls: Wall[] = [];
  readonly slabs: Slab[] = [];
  readonly stairs: Stair[] = [];
  readonly rails: Rail[] = [];
  readonly items: Item[] = [];
  readonly decor: Decor[] = [];
  readonly lights: DesignLight[] = [];
  readonly people: DesignPerson[] = [];
  readonly windows: DesignWindow[] = [];
  private readonly zones: Zone[] = [];
  /** The blocks of the items put down, for the test of the next. */
  private readonly feet: Block[] = [];

  constructor(readonly width: number, readonly depth: number, readonly height: number, readonly seed: number, private readonly footOf: (kind: string, p: readonly number[]) => Foot | null) {}

  /** A hash of the design's own seed and a salt, to [0, 1). */
  roll(salt: number): number {
    return hash01(this.seed, salt);
  }

  surface(sf: Surface): void {
    this.surfaces.push(sf);
  }
  block(b: Block): void {
    this.blocks.push(b);
  }
  wall(w: Wall): void {
    this.walls.push(w);
    for (const b of wallBlocks(w)) this.blocks.push(b);
  }
  rail(r: Rail): void {
    this.rails.push(r);
    this.blocks.push(railBlock(r));
  }
  stair(st: Stair): void {
    this.stairs.push(st);
    this.surfaces.push(stairSurface(st));
    for (const b of stairBlocks(st)) this.blocks.push(b);
  }
  /**
   * Hangs something on every stretch of a long wall at eye height that has nothing on it for more than `over` metres, in turn from `specs` (a picture, a board, a shelf), each as wide as its spec or the gap
   * allows, a hand's breadth apart, until none is left.
   */
  fillWall(wall: "left" | "right", over: number, specs: readonly { readonly kind: string; readonly w: number; readonly h: number; readonly y: number; readonly text?: string }[]): void {
    let n = 0;
    for (let pass = 0; pass < 3; pass++) {
      const gaps = wallGaps(this, wall, over);
      if (gaps.length === 0) return;
      for (const [a, c] of gaps) {
        let at = a + 0.2;
        while (at + 0.35 < c - 0.15) {
          const spec = specs[n++ % specs.length] as (typeof specs)[number];
          const w = min(spec.w, c - 0.15 - at);
          if (w < 0.35) break;
          const w0 = onWall(wall, cm(at + w / 2), this.width, this.depth);
          this.decorate({ kind: spec.kind, s: w0.s, d: w0.d, y: spec.y, face: w0.face, w: cm(w), h: spec.h, ...(spec.text === undefined ? {} : { text: spec.text }) });
          at += w + 0.3;
        }
      }
    }
  }
  /**
   * Hangs a group of pictures on a wall at `along` metres (the middle of the group) and the height `y` (its middle): `group` 0 one large picture alone, 1 a pair of different sizes side by side, 2 a row of three,
   * 3 a tall one with a small one under it. The pictures are `art` (`game/town/furniture/art.ts`); the group is as wide as it is and the width is answered.
   */
  hang(wall: "left" | "right" | "back" | "front", along: number, y: number, group: number): number {
    const sizes: readonly (readonly [number, number, number, number])[][] = [
      [[0, 1.0, 0.75, 0]],
      [[-0.4, 0.55, 0.75, 0], [0.4, 0.6, 0.45, -0.1]],
      [[-0.6, 0.4, 0.5, 0], [0, 0.4, 0.5, 0], [0.6, 0.4, 0.5, 0]],
      [[-0.3, 0.45, 0.7, 0.1], [0.3, 0.4, 0.4, -0.15]],
    ];
    const parts = sizes[group % sizes.length] as readonly (readonly [number, number, number, number])[];
    let extent = 0;
    for (const [dx, w, h, dy] of parts) {
      const at = onWall(wall, cm(along + dx), this.width, this.depth);
      this.decorate({ kind: "art", s: at.s, d: at.d, y: cm(y + dy), face: at.face, w, h });
      extent = max(extent, abs(dx) + w / 2);
    }
    return extent * 2;
  }
  /** A flight that is drawn and is no ground: its ramp and its blocks are left out. */
  display(st: Stair): void {
    this.stairs.push(st);
  }
  slab(s: Slab): void {
    this.slabs.push(s);
  }
  light(l: DesignLight): void {
    this.lights.push(l);
  }
  person(p: DesignPerson): void {
    this.people.push(p);
  }
  decorate(d: Omit<Decor, "id">): void {
    this.decor.push({ ...d, id: this.decor.length });
  }
  /** Keeps a rectangle free of what `item` puts down. */
  reserve(z: Zone): void {
    this.zones.push(z);
  }

  /** The footprint block an item of this kind at this place would make, or null for a kind with no footprint. */
  footprint(kind: string, s: number, d: number, face: Spot, p: readonly number[], y = 0): Block | null {
    const f = this.footOf(kind, p);
    if (f === null) return null;
    return { s, d, ax: face.s, ad: face.d, ha: f.ha, hb: f.hb, y0: y, y1: y + f.h };
  }

  /** Whether an item would be put down: inside the room (a `margin` from the walls), off the reserved zones, and `gap` metres from every item put down before. */
  fits(kind: string, s: number, d: number, face: Spot, p: readonly number[] = [], opts: { readonly gap?: number; readonly margin?: number; readonly anywhere?: boolean; readonly y?: number } = {}): boolean {
    const foot = this.footprint(kind, s, d, face, p, opts.y ?? 0);
    if (foot === null) return true;
    const ex = abs(foot.ax) * foot.ha + abs(foot.ad) * foot.hb;
    const ed = abs(foot.ad) * foot.ha + abs(foot.ax) * foot.hb;
    const m = opts.margin ?? 0.02;
    if (s - ex < m || s + ex > this.width - m || d - ed < FRONT_WALL + m || d + ed > this.depth - m) return false;
    // The reserved zones are of the ground floor; an upper floor's items are not held off them.
    if (opts.anywhere !== true && (opts.y ?? 0) < 1) for (const z of this.zones) if (blocksOverlap(foot, zoneBlock(z), 0)) return false;
    for (const o of this.feet) if (o.y1 > foot.y0 && foot.y1 > o.y0 && blocksOverlap(foot, o, opts.gap ?? 0.12)) return false;
    return true;
  }

  /**
   * Puts an item down, with its block, unless it does not fit (`fits`). Answers whether it was put down.
   */
  item(kind: string, s: number, d: number, face: Spot, p: readonly number[] = [], opts: { readonly gap?: number; readonly margin?: number; readonly mat?: string; readonly anywhere?: boolean; readonly y?: number } = {}): boolean {
    if (!this.fits(kind, s, d, face, p, opts)) return false;
    const foot = this.footprint(kind, s, d, face, p, opts.y ?? 0);
    if (foot !== null) {
      this.feet.push(foot);
      this.blocks.push(foot);
    }
    this.items.push({ kind, s: cm(s), d: cm(d), face, p, id: this.items.length, ...(opts.mat === undefined ? {} : { mat: opts.mat }), ...(opts.y === undefined ? {} : { y: opts.y }) });
    return true;
  }

  /**
   * Sets each person who sits on a deep seat (a sofa, an armchair, a bench) so that the sitting clip has its leg room: the clips are made for a chair, with the hips over the seat at its height and the knees 0.4 m forward
   * of them and the shins below, so the hips go 0.1 m behind the seat's FRONT edge, facing out of the seat, and the lower legs are in the open air before it (`SEAT_FRONT`). A person on a chair, a stool or in a booth stays where the room put them.
   */
  private seatPeople(): void {
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i] as DesignPerson;
      if (p.sits === null) continue;
      let best: { it: Item; f: number; r: number; hb: number; score: number } | null = null;
      for (const it of this.items) {
        const front = SEAT_FRONT[it.kind];
        if (front === undefined || (p.y ?? 0) !== (it.y ?? 0)) continue;
        const foot = this.footOf(it.kind, it.p);
        if (foot === null) continue;
        const dx = p.s - it.s;
        const dd = p.d - it.d;
        const f = dx * it.face.s + dd * it.face.d;
        const r = -dx * it.face.d + dd * it.face.s;
        if (abs(f) > foot.ha + 0.3 || abs(r) > foot.hb + 0.1) continue;
        const score = abs(f) + abs(r);
        if (best === null || score < best.score) best = { it, f, r, hb: foot.hb, score };
      }
      if (best === null) continue;
      const it = best.it;
      const front = SEAT_FRONT[it.kind] as number;
      const r = max(-best.hb + 0.3, min(best.hb - 0.3, best.r));
      this.people[i] = { ...p, s: cm(it.s + it.face.s * (front - SEAT_BEHIND) - it.face.d * r), d: cm(it.d + it.face.d * (front - SEAT_BEHIND) + it.face.s * r), face: it.face };
    }
  }

  build(o: Omit<Design, "surfaces" | "blocks" | "walls" | "slabs" | "stairs" | "rails" | "items" | "decor" | "lights" | "people" | "windows" | "width" | "depth" | "height">): Design {
    this.seatPeople();
    return {
      ...o, width: this.width, depth: this.depth, height: this.height,
      surfaces: this.surfaces, blocks: this.blocks, walls: this.walls, slabs: this.slabs, stairs: this.stairs, rails: this.rails, items: this.items, decor: this.decor, lights: this.lights, people: this.people, windows: this.windows,
    };
  }
}

/** A wall on the outer wall of the room that carries things: where a decoration with `along` metres along it and its facing goes. */
export function onWall(wall: "front" | "left" | "right" | "back", along: number, width: number, depth: number): { s: number; d: number; face: Spot } {
  switch (wall) {
    case "left": return { s: 0, d: along, face: { s: 1, d: 0 } };
    case "right": return { s: width, d: along, face: { s: -1, d: 0 } };
    case "back": return { s: along, d: depth, face: { s: 0, d: -1 } };
    case "front": return { s: along, d: FRONT_WALL, face: { s: 0, d: 1 } };
  }
}

const ONE3: readonly [number, number, number] = [1, 1, 1];

/**
 * The design reflected about `about` (the room's width unless given: `s` to `about - s`; a layout on a grid of half metres is mirrored about a width on it), for a layout written with its stair at one end that the door's place wants at the other. Every part is
 * mirrored in place: a wall keeps its direction of travel, so its two faces and its doorways change sides; a flight that climbs along `s` swaps its two heights.
 */
export function mirrorDesign(d: Design, about: number = d.width): Design {
  const W = about;
  const m = (s: number): number => cm(W - s);
  const flip = (f: Spot): Spot => ({ s: -f.s, d: f.d });
  return {
    ...d,
    doorS: m(d.doorS),
    arrive: { s: m(d.arrive.s), d: d.arrive.d },
    surfaces: d.surfaces.map((sf): Surface =>
      sf.kind === "floor" ? { ...sf, s0: m(sf.s1), s1: m(sf.s0) } : { ...sf, s0: m(sf.s1), s1: m(sf.s0), ...(sf.along === "s" ? { y0: sf.y1, y1: sf.y0 } : {}) },
    ),
    blocks: d.blocks.map((b): Block => ({ ...b, s: m(b.s), ax: -b.ax })),
    // A wall keeps its direction of travel, so its doorways stay where they are (measured from its start, which moves with it) and its two faces change sides.
    walls: d.walls.map((w): Wall => ({
      ...w, s0: m(w.s0), s1: m(w.s1), mat: w.matBack ?? w.mat, matBack: w.mat, ...(w.tint === undefined && w.tintBack === undefined ? {} : { tint: w.tintBack ?? ONE3, tintBack: w.tint ?? ONE3 }),
    })),
    slabs: d.slabs.map((s): Slab => ({ ...s, s0: m(s.s1), s1: m(s.s0) })),
    stairs: d.stairs.map((st): Stair => ({
      ...st, s0: m(st.s1), s1: m(st.s0), ...(st.along === "s" ? { y0: st.y1, y1: st.y0 } : { rails: st.rails.map((r) => (r === "lo" ? "hi" : "lo")) }),
    })),
    rails: d.rails.map((r): Rail => ({ ...r, s0: m(r.s0), s1: m(r.s1) })),
    items: d.items.map((i): Item => ({ ...i, s: m(i.s), face: flip(i.face) })),
    decor: d.decor.map((i): Decor => ({ ...i, s: m(i.s), face: flip(i.face) })),
    lights: d.lights.map((l): DesignLight => ({ ...l, s: m(l.s) })),
    people: d.people.map((p): DesignPerson => ({ ...p, s: m(p.s), face: flip(p.face) })),
    ...(d.windows === undefined ? {} : { windows: d.windows.map((w): DesignWindow => (w.wall === "back" ? { ...w, a0: m(w.a1), a1: m(w.a0) } : { ...w, wall: w.wall === "left" ? "right" : "left" })) }),
    ...(d.marks === undefined ? {} : { marks: d.marks.map((k) => ({ ...k, s: m(k.s) })) }),
  };
}

/**
 * The stretches of one of the two long walls (`left` is `s` 0, `right` is `s` = width) that something stands against or hangs on at eye height (between 1.0 and 2.0 m): a decoration within 0.3 m of it
 * whose height meets that band, and a block that stands within 0.3 m of it and is taller than 1.0 m. Each is `[from, to]` along `d`, in order.
 */
export function wallCover(d: { readonly width: number; readonly blocks: readonly Block[]; readonly decor: readonly Decor[] }, wall: "left" | "right"): [number, number][] {
  const at = wall === "left" ? 0 : d.width;
  const out: [number, number][] = [];
  for (const dc of d.decor) {
    if (abs(dc.s - at) > 0.3 || abs(dc.face.s) < 0.5) continue;
    if (dc.y + dc.h / 2 < 1.0 || dc.y - dc.h / 2 > 2.0) continue;
    out.push([dc.d - dc.w / 2, dc.d + dc.w / 2]);
  }
  for (const b of d.blocks) {
    if (b.y1 <= 1.0 || b.y0 >= 2.0) continue;
    const es = abs(b.ax) * b.ha + abs(b.ad) * b.hb;
    const ed = abs(b.ad) * b.ha + abs(b.ax) * b.hb;
    if (wall === "left" ? b.s - es > 0.3 : b.s + es < d.width - 0.3) continue;
    out.push([b.d - ed, b.d + ed]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** The bare stretches of a long wall of a room `depth` long: the gaps between what `wallCover` finds, from the front wall's inside to the back, longer than `over` metres. */
export function wallGaps(d: { readonly width: number; readonly depth: number; readonly blocks: readonly Block[]; readonly decor: readonly Decor[] }, wall: "left" | "right", over: number): [number, number][] {
  const gaps: [number, number][] = [];
  let at = FRONT_WALL;
  for (const [a, b] of wallCover(d, wall)) {
    if (a - at > over) gaps.push([at, a]);
    at = max(at, b);
  }
  if (d.depth - at > over) gaps.push([at, d.depth]);
  return gaps;
}
