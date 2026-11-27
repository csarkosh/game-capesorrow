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
};

/** A floor or a ceiling as drawn: a rectangle at height `y` (the top of a floor, the underside of a ceiling) and how thick it is (an edge is drawn down or up by that much). */
export type Slab = { readonly kind: "floor" | "ceiling"; readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly y: number; readonly thick: number; readonly mat: string; readonly edge?: string };

/** A flight of stairs: a ramp (`along`, `y0` at the low end of `s` or `d`, `y1` at the other), over a floor at `base`, with a handrail on the side of each of `rails` (lo or hi in the other axis). */
export type Stair = {
  readonly s0: number; readonly s1: number; readonly d0: number; readonly d1: number; readonly along: "s" | "d"; readonly y0: number; readonly y1: number;
  readonly base: number; readonly mat: string; readonly rails: readonly ("lo" | "hi")[];
};

/** A rail at an open edge, from one end to the other, standing on a floor at `y`, `h` high. */
export type Rail = { readonly s0: number; readonly d0: number; readonly s1: number; readonly d1: number; readonly y: number; readonly h: number; readonly kind: "glass" | "bars" | "timber"; readonly mat: string };

/** A piece of furniture or a fixture by kind: its place (the centre of its footprint), the way its front looks, and a few numbers its kind reads (`p`). `id` varies it (a stool turned, a cushion's colour). */
export type Item = { readonly kind: string; readonly s: number; readonly d: number; readonly face: Spot; readonly p: readonly number[]; readonly id: number; readonly mat?: string };
/** What hangs on a wall: a picture, a sign with words, a board, a clock, a guitar. `w` by `h` metres, its centre `y` over the floor, `face` the way it looks (into the room). */
export type Decor = { readonly kind: string; readonly s: number; readonly d: number; readonly y: number; readonly face: Spot; readonly w: number; readonly h: number; readonly text?: string; readonly id: number };
/** A light the bake lights the room from: a place, a power (1 is a tube's), the distance (m) at which its light has fallen to a quarter, and a tone. */
export type DesignLight = { readonly s: number; readonly d: number; readonly y: number; readonly kind: "bulb" | "pendant" | "tube" | "lamp" | "strip" | "glow"; readonly power: number; readonly reach: number; readonly tone: readonly [number, number, number] };
/** Someone in the room: a place, the way they face, an activity (`ACTIVITIES` of `game/town/people.ts`) and the height of the seat for a sitter. */
export type DesignPerson = {
  readonly s: number; readonly d: number; readonly face: Spot; readonly activity: string; readonly role: "staff" | "customer"; readonly sits: number | null; readonly family: "chair" | "stool";
};

/** How an outer wall is finished: its material, a wainscot to a height in another, and its skirting. */
export type Finish = { readonly mat: string; readonly wainscot?: { readonly h: number; readonly mat: string }; readonly skirt?: string };
/** The room's mood for the light: the brightest floor's luminance the lights are brought to, the ambient colour and strength, and how much of the day the front's panes let in. */
export type Mood = { readonly exposure: number; readonly ambient: readonly [number, number, number]; readonly ambientK: number; readonly day: number };

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
  /** The outer walls' finishes, and the ceiling's and the floor's materials. */
  readonly shell: { readonly front: Finish; readonly left: Finish; readonly right: Finish; readonly back: Finish; readonly floor: string; readonly ceiling: string };
  readonly mood: Mood;
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
    const top = low;
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
  footprint(kind: string, s: number, d: number, face: Spot, p: readonly number[]): Block | null {
    const f = this.footOf(kind, p);
    if (f === null) return null;
    return { s, d, ax: face.s, ad: face.d, ha: f.ha, hb: f.hb, y0: 0, y1: f.h };
  }

  /** Whether an item would be put down: inside the room (a `margin` from the walls), off the reserved zones, and `gap` metres from every item put down before. */
  fits(kind: string, s: number, d: number, face: Spot, p: readonly number[] = [], opts: { readonly gap?: number; readonly margin?: number; readonly anywhere?: boolean } = {}): boolean {
    const foot = this.footprint(kind, s, d, face, p);
    if (foot === null) return true;
    const ex = abs(foot.ax) * foot.ha + abs(foot.ad) * foot.hb;
    const ed = abs(foot.ad) * foot.ha + abs(foot.ax) * foot.hb;
    const m = opts.margin ?? 0.02;
    if (s - ex < m || s + ex > this.width - m || d - ed < FRONT_WALL + m || d + ed > this.depth - m) return false;
    if (opts.anywhere !== true) for (const z of this.zones) if (blocksOverlap(foot, zoneBlock(z), 0)) return false;
    for (const o of this.feet) if (blocksOverlap(foot, o, opts.gap ?? 0.12)) return false;
    return true;
  }

  /**
   * Puts an item down, with its block, unless it does not fit (`fits`). Answers whether it was put down.
   */
  item(kind: string, s: number, d: number, face: Spot, p: readonly number[] = [], opts: { readonly gap?: number; readonly margin?: number; readonly mat?: string; readonly anywhere?: boolean } = {}): boolean {
    if (!this.fits(kind, s, d, face, p, opts)) return false;
    const foot = this.footprint(kind, s, d, face, p);
    if (foot !== null) {
      this.feet.push(foot);
      this.blocks.push(foot);
    }
    this.items.push({ kind, s: cm(s), d: cm(d), face, p, id: this.items.length, ...(opts.mat === undefined ? {} : { mat: opts.mat }) });
    return true;
  }

  build(o: Omit<Design, "surfaces" | "blocks" | "walls" | "slabs" | "stairs" | "rails" | "items" | "decor" | "lights" | "people" | "width" | "depth" | "height">): Design {
    return {
      ...o, width: this.width, depth: this.depth, height: this.height,
      surfaces: this.surfaces, blocks: this.blocks, walls: this.walls, slabs: this.slabs, stairs: this.stairs, rails: this.rails, items: this.items, decor: this.decor, lights: this.lights, people: this.people,
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
