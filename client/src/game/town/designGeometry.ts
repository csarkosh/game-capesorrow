/**
 * A designed room (`sim/inside/design.ts`) as arrays: its floors and ceiling, its walls with their doorways, its stairs as real steps, its rails, its furniture and what hangs
 * on its walls, all lit from one bake (`designLight.ts`) into the colours of their vertices. It is built from the same description the walking is, so what is drawn is what
 * stops a hull: a wall's blocks, a rail's, a counter's, and the space under a stair too low to stand in are made from the numbers drawn here.
 *
 * It is built into a `MeshBuilder` that lays backs (every face is seen from both sides), at the room's frame and `floorY`: the drawn floor's surface is at `floorY` exactly.
 * The front wall inside is the street side's own (`frontWall`, `roomShell.ts`): the wall cut round the unit's openings and its door, a bright pane in each window (the day, no
 * street) and the door shut in its frame. The unit's hours are every vertex's (`withHours`), as a room's behind the street's glass is, so that a room shut for the night is dark.
 *
 * The materials are `interiorMaterials.ts`'s; what each kind of furniture is made of is `furniture/`'s.
 */
import { FRONT_WALL, type Design, type Finish, type Rail, type Slab, type Stair, type Wall } from "../../sim/inside/design.js";
import type { Opening } from "../../sim/town/types.js";
import { hoursCode, type Hours } from "./hours.js";
import { materialOf } from "./interiorMaterials.js";
import { MeshBuilder, hash01, type MeshArrays, type Rgb } from "./meshBuilder.js";
import { bakeLight, type DayPane } from "./designLight.js";
import { DECOR, ITEMS } from "./furniture/index.js";
import { Geo, tintOf, type P3 } from "./furniture/kit.js";
import { glassPanel } from "./furniture/glass.js";
import { PANE_SETBACK } from "./roomGlass.js";
import { roomOutside } from "./roomOutside.js";
import { styleOf } from "./roomFill.js";
import type { Xf, Ctx } from "./roomKit.js";
import { frontWall, type Band, type Layered } from "./roomShell.js";
import type { Detail } from "./townTypes.js";

/** What a design is drawn with: the room's frame in the world (the origin at the design's own `s` 0), its floor, and what the plan says of the front. */
export type DrawIn = {
  readonly design: Design;
  readonly xf: Xf;
  readonly floorY: number;
  /** A number the variation of the room's finishes is rolled from (the unit's). */
  readonly seed: number;
  readonly hours: Hours | null;
  readonly detail: Detail;
  /** The front wall's windows, from the plan, in the design's own `s`; and the building's era, for their frames. None for a design drawn with no front (a test's). */
  readonly front: { readonly openings: readonly Opening[]; readonly era: number; /** The head of the street door over the floor as the street side draws it, which the door inside is cut to. */ readonly doorHead: number } | null;
  /** Lay the room's windows' glass in a layer of its own (`RoomArrays.through`) for the through material to draw; false, the windows are opaque sheets in the room's own mesh. */
  readonly glass?: boolean;
  /** Told how many vertices each part of the room took, by name (for a report of what a room costs). */
  readonly report?: (part: string, vertices: number) => void;
};

/** How much of the day a covered opening lets through, as the room's own light takes it. */
const THROUGH: Readonly<Record<string, number>> = { none: 1, display: 0.7, blinds: 0.5, papered: 0.45, boarded: 0, bricked: 0 };
/** The height of a skirting board. */
const SKIRT = 0.12;
/** The most a lit cell of a wall or a floor is long, metres: the light is baked at its corners. */
const CELL = 0.75;
/** The grid of a floor and a ceiling: the light is baked at its corners, so this is the finest a pool of light can be (0.5 m; the bar keeps 0.75 m, its light is as it is; a pool about 1 m across is then two or three vertices wide). */
const SLAB_CELL = 0.5;
/** Within this of a narrow pool's centre the lines of a floor or a ceiling are this close (metres). */
const POOL_REACH = 0.85;
const POOL_STEP = 0.4;

const ONE: Rgb = [1, 1, 1];
/**
 * The fractions of a span `[from, from + span]` in steps no longer than `step`, finer (`fine`) within `radius` of any of `centres`: the lines of a floor or a ceiling are closer where a narrow pool of light falls,
 * so that its edge is smooth over the vertices and no step shows.
 */
function linesNear(from: number, span: number, step: number, centres: readonly number[], radius: number, fine: number): number[] {
  const base = lines(span, step);
  if (centres.length === 0) return base;
  const at: number[] = base.map((f) => from + f * span);
  for (let x = Math.ceil(from / fine) * fine; x < from + span - 1e-6; x += fine) if (centres.some((c) => Math.abs(c - x) < radius)) at.push(x);
  at.sort((p, q) => p - q);
  const out: number[] = [];
  for (const x of at) if (out.length === 0 || x - (out[out.length - 1] as number) > 0.06) out.push(x);
  out[out.length - 1] = from + span;
  return out.map((x) => (x - from) / span);
}

/** The fractions of a span, in steps no longer than `step`. */
function lines(span: number, step: number): number[] {
  const n = Math.max(1, Math.ceil(span / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => i / n);
}

/** The design as the arrays of one mesh in the town's solid material. */
export type RoomArrays = MeshArrays & { readonly through: MeshArrays | null; /** The street (and the yard behind) seen out of the windows: a mesh of its own, lit by the scene (`roomOutside.ts`). */ readonly outside: MeshArrays | null };

export function designMesh(r: DrawIn): RoomArrays {
  const out = new MeshBuilder(true);
  const marked = r.glass === true ? new MeshBuilder() : null;
  out.marked = marked;
  designGeometry(out, r);
  const arrays = out.take();
  // The ground outside the walls that have a pane: the street in front, a yard behind where the design has a window in its back wall.
  let outside: MeshArrays | null = null;
  if (marked !== null && marked.vertices > 0) {
    const scenery = new MeshBuilder();
    roomOutside(scenery, r.xf, r.floorY, r.design.width, r.design.depth, "front", r.seed);
    if ((r.design.windows ?? []).some((w) => w.wall === "back")) roomOutside(scenery, r.xf, r.floorY, r.design.width, r.design.depth, "back", r.seed + 1);
    outside = scenery.take();
  }
  return Object.assign(arrays, { through: marked !== null && marked.vertices > 0 ? marked.take() : null, outside });
}

export function designGeometry(out: MeshBuilder, r: DrawIn): void {
  const d = r.design;
  const panes: DayPane[] = (r.front?.openings ?? []).map((o) => ({ s0: Math.min(o.s0, o.s1), s1: Math.max(o.s0, o.s1), through: THROUGH[o.cover] ?? 1 }));
  const light = bakeLight(d, panes);
  const g = new Geo(out, r.xf, r.floorY, light, r.seed, d.height);
  const part = (name: string, fn: () => void): void => {
    const from = out.vertices;
    fn();
    r.report?.(name, out.vertices - from);
  };
  out.withHours(hoursCode(r.hours), () => {
    out.withGlow(1, () => {
      part("floors and ceiling", () => slabs(g, d));
      part("outer walls", () => out.solid(() => shell(g, r, d)));
      part("windows", () => windows(g, d));
      for (const w of d.walls) part("walls", () => out.solid(() => wall(g, w, d)));
      for (const st of d.stairs) part("stairs", () => stair(g, st));
      for (const rl of d.rails) part("rails", () => rail(g, rl));
      for (const it of d.items) {
        const build = ITEMS[it.kind];
        if (build === undefined) throw new Error(`no builder for the item kind ${it.kind}`);
        part(it.kind, () => build(g.under(underside(d, it.s, it.d, it.y ?? 0)).lift(it.y ?? 0), it));
      }
      for (const dc of d.decor) {
        const build = DECOR[dc.kind];
        if (build === undefined) throw new Error(`no builder for the decor kind ${dc.kind}`);
        part(dc.kind, () => build(g.under(underside(d, dc.s, dc.d, dc.y)), dc));
      }
    });
  });
}

// ---- floors and ceilings

function slabs(g: Geo, d: Design): void {
  // The narrow pools of light (a downlight's, a flush light's: a beam of 20 or more) are what the floors and ceilings are finer under.
  const pools = d.lights.filter((l) => (l.beam ?? 0) >= 20);
  // A slab is a solid: its edge faces and undersides are laid, no backs (an edge's back would lie in the plane of the wall it stops at).
  g.out.solid(() => {
    for (const sl of d.slabs) slab(g, sl, d.name !== "bar", pools);
  });
}

function slab(g: Geo, sl: Slab, fine: boolean, pools: readonly { s: number; d: number; y: number }[]): void {
  const w = sl.s1 - sl.s0;
  const l = sl.d1 - sl.d0;
  const up: P3 = [0, 0, 1];
  const dn: P3 = [0, 0, -1];
  // Only a floor is made finer: a ceiling is held evenly pale (`Mood.bounce`) and shows no steps.
  const refine = fine && sl.kind === "floor" && sl.y < 0.5;
  const near = pools.filter((p) => p.y - sl.y < 4.6 && p.y > sl.y);
  const us = refine ? linesNear(sl.s0, w, SLAB_CELL, near.map((p) => p.s), POOL_REACH, POOL_STEP) : lines(w, fine ? SLAB_CELL : CELL);
  const vs = refine ? linesNear(sl.d0, l, SLAB_CELL, near.map((p) => p.d), POOL_REACH, POOL_STEP) : lines(l, fine ? SLAB_CELL : CELL);
  const tint = sl.tint;
  const tinted = tint === undefined ? undefined : (): Rgb => tint;
  if (sl.kind === "floor" && (sl.mat === "dark_wood" || sl.mat === "oak")) {
    // Boards run the length of the room: the grid's rows are along `d`.
    g.grid([sl.s0, sl.d0, sl.y], [0, l, 0], [w, 0, 0], vs, us, up, sl.mat, tinted);
  } else if (sl.kind === "floor") {
    g.grid([sl.s0, sl.d0, sl.y], [w, 0, 0], [0, l, 0], us, vs, up, sl.mat, tinted);
    if (sl.thick > 0) {
      g.grid([sl.s0, sl.d0, sl.y - sl.thick], [w, 0, 0], [0, l, 0], lines(w, 1.5), lines(l, 1.5), dn, sl.edge ?? sl.mat);
    }
  } else {
    g.grid([sl.s0, sl.d0, sl.y], [w, 0, 0], [0, l, 0], us, vs, dn, sl.mat, tinted);
    if (sl.thick > 0) g.grid([sl.s0, sl.d0, sl.y + sl.thick], [w, 0, 0], [0, l, 0], lines(w, 1.5), lines(l, 1.5), up, sl.edge ?? sl.mat);
  }
  if (sl.thick > 0) {
    const y0 = sl.kind === "floor" ? sl.y - sl.thick : sl.y;
    const mat = sl.edge ?? sl.mat;
    g.poly([[sl.s0, sl.d0, y0], [sl.s1, sl.d0, y0], [sl.s1, sl.d0, y0 + sl.thick], [sl.s0, sl.d0, y0 + sl.thick]], [0, -1, 0], mat);
    g.poly([[sl.s0, sl.d1, y0], [sl.s1, sl.d1, y0], [sl.s1, sl.d1, y0 + sl.thick], [sl.s0, sl.d1, y0 + sl.thick]], [0, 1, 0], mat);
    g.poly([[sl.s0, sl.d0, y0], [sl.s0, sl.d1, y0], [sl.s0, sl.d1, y0 + sl.thick], [sl.s0, sl.d0, y0 + sl.thick]], [-1, 0, 0], mat);
    g.poly([[sl.s1, sl.d0, y0], [sl.s1, sl.d1, y0], [sl.s1, sl.d1, y0 + sl.thick], [sl.s1, sl.d0, y0 + sl.thick]], [1, 0, 0], mat);
  }
}

// ---- the outer walls

type Face = "left" | "right" | "back";

/** The bands of a finish: the skirting, the wainscot, and the wall over it, each with its tint. */
function bandsOf(f: Finish, top: number): { y0: number; y1: number; mat: string; tint: Rgb; main: boolean }[] {
  const out: { y0: number; y1: number; mat: string; tint: Rgb; main: boolean }[] = [];
  const skirt = f.skirt === undefined ? 0 : SKIRT;
  if (f.skirt !== undefined) out.push({ y0: 0, y1: SKIRT, mat: f.skirt, tint: ONE, main: false });
  const wain = f.wainscot === undefined ? skirt : Math.min(top, f.wainscot.h);
  if (f.wainscot !== undefined) out.push({ y0: skirt, y1: wain, mat: f.wainscot.mat, tint: f.wainscot.tint ?? ONE, main: false });
  out.push({ y0: wain, y1: top, mat: f.mat, tint: f.tint ?? ONE, main: true });
  return out;
}

function outerWall(g: Geo, d: Design, face: Face): void {
  const f = d.shell[face];
  const W = d.width;
  const D = d.depth;
  for (const b of bandsOf(f, d.height)) {
    const h = b.y1 - b.y0;
    if (h < 0.01) continue;
    const vs = lines(h, h > 1 ? (d.mood.bounce !== undefined ? 0.6 : 0.9) : 1);
    const tint = (): Rgb => b.tint;
    // Where the wall runs: its origin, the way along it, its length and which way it faces.
    const run = face === "back" ? { o: [0, D, b.y0] as P3, u: [1, 0, 0] as P3, len: W, hint: [0, -1, 0] as P3 } : face === "left" ? { o: [0, FRONT_WALL, b.y0] as P3, u: [0, 1, 0] as P3, len: D - FRONT_WALL, hint: [1, 0, 0] as P3 } : { o: [W, FRONT_WALL, b.y0] as P3, u: [0, 1, 0] as P3, len: D - FRONT_WALL, hint: [-1, 0, 0] as P3 };
    if (b.main && f.boards !== undefined) {
      // Upright boards, each its own strip with its grain up the board and a tone a few percent off.
      const n = Math.max(1, Math.round(run.len / f.boards));
      const bw = run.len / n;
      const rows = lines(h, 1.4);
      for (let i = 0; i < n; i++) {
        const k = 0.86 + 0.24 * hash01(i * 7 + g.seed, 61 + (face === "left" ? 0 : 1));
        g.grid([run.o[0] + run.u[0] * i * bw, run.o[1] + run.u[1] * i * bw, b.y0], [run.u[0] * bw, run.u[1] * bw, 0], [0, 0, h], [0, 1], rows, run.hint, b.mat, () => [b.tint[0] * k, b.tint[1] * k, b.tint[2] * k]);
      }
      continue;
    }
    // The wall is cut away where a window is (`Design.windows`), when the room has a layer for the glass that is set in it.
    const aStart = face === "back" ? 0 : FRONT_WALL;
    const cuts = (g.out.marked === null ? [] : d.windows ?? []).filter((w) => w.wall === face && w.y0 < b.y1 && w.y1 > b.y0);
    if (cuts.length === 0) {
      g.grid(run.o, [run.u[0] * run.len, run.u[1] * run.len, 0], [0, 0, h], lines(run.len, CELL), vs, run.hint, b.mat, tint);
      continue;
    }
    const ys = [b.y0, b.y1];
    for (const w of cuts) for (const y of [w.y0, w.y1]) if (y > b.y0 + 1e-3 && y < b.y1 - 1e-3) ys.push(y);
    ys.sort((p, q) => p - q);
    for (let k = 0; k + 1 < ys.length; k++) {
      const ya = ys[k] as number;
      const yb = ys[k + 1] as number;
      if (yb - ya < 1e-3) continue;
      const mid = (ya + yb) / 2;
      const blocked = cuts.filter((w) => w.y0 <= mid && mid <= w.y1).sort((p, q) => p.a0 - q.a0);
      let at = aStart;
      const piece = (a0: number, a1: number): void => {
        if (a1 - a0 < 0.02) return;
        const rel = a0 - aStart;
        g.grid([run.o[0] + run.u[0] * rel, run.o[1] + run.u[1] * rel, ya], [run.u[0] * (a1 - a0), run.u[1] * (a1 - a0), 0], [0, 0, yb - ya], lines(a1 - a0, CELL), lines(yb - ya, h > 1 ? (d.mood.bounce !== undefined ? 0.6 : 0.9) : 1), run.hint, b.mat, tint);
      };
      for (const w of blocked) {
        piece(at, Math.min(w.a0, aStart + run.len));
        at = Math.max(at, w.a1);
      }
      piece(at, aStart + run.len);
    }
  }
}

/** A band of the front wall as the street side's builder takes it: its paint and the material it is laid in. */
function frontBands(f: Finish, top: number): Band[] {
  const layered = (mat: string, k: Rgb = ONE): Layered => {
    const a = materialOf(mat).albedo;
    return { layer: null, paint: [a[0] * k[0], a[1] * k[1], a[2] * k[2]], gain: ONE };
  };
  const skirt = f.skirt === undefined ? 0 : SKIRT;
  const out: Band[] = [];
  if (f.skirt !== undefined) out.push({ y0: 0, y1: SKIRT, f: layered(f.skirt), kind: "base", mat: materialOf(f.skirt).mat });
  const wain = f.wainscot === undefined ? skirt : Math.min(top, f.wainscot.h);
  if (f.wainscot !== undefined) out.push({ y0: skirt, y1: wain, f: layered(f.wainscot.mat, f.wainscot.tint), kind: "wain", mat: materialOf(f.wainscot.mat).mat });
  out.push({ y0: wain, y1: top, f: layered(f.mat, f.tint), kind: "wall", mat: materialOf(f.mat).mat });
  return out;
}

function shell(g: Geo, r: DrawIn, d: Design): void {
  outerWall(g, d, "left");
  outerWall(g, d, "right");
  outerWall(g, d, "back");
  const front = r.front;
  if (front === null) {
    // A design drawn with no front of its own (a test's): the wall plain, with a gap for the door.
    const f = d.shell.front;
    for (const b of bandsOf(f, d.height)) {
      const h = b.y1 - b.y0;
      if (h < 0.01) continue;
      g.grid([0, FRONT_WALL, b.y0], [d.width, 0, 0], [0, 0, h], lines(d.width, CELL), lines(h, 0.9), [0, 1, 0], b.mat, () => b.tint);
    }
    return;
  }
  const c: Ctx = {
    out: g.out, xf: g.xf, floorY: g.floorY, seed: r.seed, lit: true, vacant: false, detail: r.detail, trade: null, field: g.light, ceiling: d.height, s0: 0, s1: d.width, d1: d.depth,
    era: front.era, glassIn: 0, glass: g.out.marked, designed: d.name !== "bar", n: 0, chairs: [], type: "bar", paint: materialOf(d.shell.front.mat).albedo, base: materialOf(d.shell.front.skirt ?? d.shell.front.mat).albedo,
    door: { s: d.doorS, w: d.doorWidth }, feet: [], style: styleOf(r.seed, null, front.era, 1960, 0), whole: true,
  };
  frontWall(c, { door: { s: d.doorS, width: d.doorWidth, head: front.doorHead }, openings: front.openings }, frontBands(d.shell.front, d.height));
  if (d.frontCurtains === true) curtains(g, d, front.openings);
}

/** Full-height curtains either side of each window of the front, as a zig-zag of pleats from the floor to the ground floor's ceiling (not over the door), in a pale patterned cloth. */
function curtains(g: Geo, d: Design, openings: readonly Opening[]): void {
  const top = (d.cuts === undefined || d.cuts[0] === undefined ? d.height : d.cuts[0] - 0.15) - 0.12;
  const near = (s: number): boolean => Math.abs(s - d.doorS) < d.doorWidth / 2 + 0.3;
  for (let n = 0; n < openings.length; n++) {
    const o = openings[n] as Opening;
    const lo = Math.min(o.s0, o.s1);
    const hi = Math.max(o.s0, o.s1);
    for (const side of [-1, 1] as const) {
      const s0 = side < 0 ? lo - 0.6 : hi + 0.1;
      const s1 = s0 + 0.5;
      if (s0 < 0.1 || s1 > d.width - 0.1 || near(s0) || near(s1) || near((s0 + s1) / 2)) continue;
      const pleats = 8;
      for (let k = 0; k < pleats; k++) {
        const a = s0 + (k * (s1 - s0)) / pleats;
        const b = s0 + ((k + 1) * (s1 - s0)) / pleats;
        const da = FRONT_WALL + 0.02 + (k % 2) * 0.07;
        const db = FRONT_WALL + 0.02 + ((k + 1) % 2) * 0.07;
        const pat = 0.8 + 0.4 * hash01(n * 9 + k + (side > 0 ? 4 : 0) + g.seed, 85);
        g.poly([[a, da, 0.04], [b, db, 0.04], [b, db, top], [a, da, top]], [0, 1, 0], "cloth", { tint: [1.1 * pat, 2.5 * pat, 2.4 * pat] });
      }
    }
  }
}

// ---- the walls inside

/** A wall: both faces in cells round its doorways, its ends, its top where it stops short of the ceiling, a casing round each doorway and a leaf in a shut one. */
/** Half a wall's thickness. */
const t0 = (w: Wall): number => w.thick / 2;

/**
 * Whether the end of a wall at (s, d) is inside another wall (or on the shell): a cap laid there would be a face in the plane of one of that
 * wall's, a back to back with it or in line with it, so the wall stops at the other and has no cap.
 */
function endsOn(w: Wall, s: number, dd: number, d: Design): boolean {
  const EDGE = 0.03;
  if (s <= EDGE || dd <= EDGE || s >= d.width - EDGE || dd >= d.depth - EDGE) return true;
  for (const o of d.walls) {
    if (o === w) continue;
    const ox = o.s1 - o.s0;
    const od = o.d1 - o.d0;
    const ol = Math.hypot(ox, od);
    if (!(ol > 0)) continue;
    const along = ((s - o.s0) * ox + (dd - o.d0) * od) / ol;
    const across = Math.abs(-(s - o.s0) * od + (dd - o.d0) * ox) / ol;
    if (along >= -EDGE && along <= ol + EDGE && across <= o.thick / 2 + EDGE) return true;
  }
  return false;
}

function wall(g: Geo, w: Wall, design: Design): void {
  const ceiling = design.height;
  const dx = w.s1 - w.s0;
  const dd = w.d1 - w.d0;
  const len = Math.sqrt(dx * dx + dd * dd);
  if (!(len > 0)) return;
  const L = g.at((w.s0 + w.s1) / 2, (w.d0 + w.d1) / 2, { s: dx / len, d: dd / len });
  const t = w.thick / 2;
  const f0 = -len / 2;
  const f1 = len / 2;
  const face = (side: 1 | -1, mat: string): void => {
    const cell = (a0: number, a1: number, y0: number, y1: number): void => {
      if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
      const o = L.p(a0, side * t, y0);
      const du = L.v(a1 - a0, 0, 0);
      const dv: P3 = [0, 0, y1 - y0];
      const tint = side === 1 ? w.tint : w.tintBack;
      if (w.boards !== undefined) {
        // Upright boards, each its own strip, so that the grain runs up each.
        const n = Math.max(1, Math.round((a1 - a0) / w.boards));
        const bw = (a1 - a0) / n;
        for (let i = 0; i < n; i++) {
          const k = 0.8 + 0.4 * hash01(i * 11 + g.seed + Math.floor(a0 * 10), 62);
          const t = tint ?? ONE;
          g.grid(L.p(a0 + i * bw, side * t0(w), y0), L.v(bw, 0, 0), [0, 0, y1 - y0], [0, 1], lines(y1 - y0, 1.4), L.v(0, side, 0), mat, () => [t[0] * k, t[1] * k, t[2] * k]);
        }
        return;
      }
      g.grid(o, du, dv, lines(a1 - a0, CELL), lines(y1 - y0, 1), L.v(0, side, 0), mat, tint === undefined ? undefined : (): Rgb => tint);
    };
    let at = f0;
    for (const o of w.openings) {
      cell(at, f0 + o.a0, w.y0, w.y1);
      cell(f0 + o.a0, f0 + o.a1, o.head, w.y1);
      at = f0 + o.a1;
    }
    cell(at, f1, w.y0, w.y1);
  };
  face(1, w.mat);
  face(-1, w.matBack ?? w.mat);
  // The skirting along each face where the wall meets the floor.
  if (w.skirt !== undefined) {
    let at = f0;
    const run = (a0: number, a1: number): void => {
      if (a1 - a0 < 0.05) return;
      for (const side of [1, -1] as const) L.box(a0, a1, side * t, side * (t + 0.015), w.y0, w.y0 + SKIRT, w.skirt as string, undefined, true, false);
    };
    for (const o of w.openings) {
      run(at, f0 + o.a0);
      at = f0 + o.a1;
    }
    run(at, f1);
  }
  // The ends, and the top where the wall stops short of the ceiling.
  const h = w.y1 - w.y0;
  if (!endsOn(w, w.s0, w.d0, design)) L.poly([[f0, -t, w.y0], [f0, t, w.y0], [f0, t, w.y1], [f0, -t, w.y1]], [-1, 0, 0], w.mat);
  if (!endsOn(w, w.s1, w.d1, design)) L.poly([[f1, -t, w.y0], [f1, t, w.y0], [f1, t, w.y1], [f1, -t, w.y1]], [1, 0, 0], w.mat);
  if (w.y1 < ceiling - 0.02 && h > 0) {
    let at2 = f0;
    const cap = (a0: number, a1: number, y: number): void => {
      if (a1 - a0 > 0.01) L.poly([[a0, -t, y], [a1, -t, y], [a1, t, y], [a0, t, y]], [0, 0, 1], w.mat);
    };
    for (const o of w.openings) {
      cap(at2, f0 + o.a0, w.y1);
      at2 = f0 + o.a1;
    }
    cap(at2, f1, w.y1);
  }
  for (const o of w.openings) {
    const a0 = f0 + o.a0;
    const a1 = f0 + o.a1;
    const frame = "dark_wood";
    // The casing: two uprights and a head, a little proud of both faces.
    L.box(a0 - 0.05, a0, -t - 0.02, t + 0.02, w.y0, o.head, frame, undefined, true, false);
    L.box(a1, a1 + 0.05, -t - 0.02, t + 0.02, w.y0, o.head, frame, undefined, true, false);
    L.box(a0 - 0.05, a1 + 0.05, -t - 0.02, t + 0.02, o.head, o.head + 0.05, frame);
    if (o.shut === true) {
      const leaf = tintOf(Math.floor(a0 * 100) + g.seed, 51, 0.08);
      L.box(a0, a1, -0.02, 0.02, w.y0, o.head, frame, { tint: leaf }, true, false);
      for (const side of [1, -1] as const) L.box(a0 + 0.12, a1 - 0.12, side * 0.02, side * 0.028, w.y0 + 0.2, o.head - 0.2, frame, { tint: [0.75, 0.75, 0.75] }, false, false);
      L.box(a1 - 0.18, a1 - 0.12, -0.05, 0.05, 0.95, 1.07, "brass", undefined, true, false);
    }
  }
}

// ---- stairs

/** The height of a stair's ramp where `t` is the position along its rise (from its low coordinate end). */
function rampAt(st: Stair, t: number, run: number): number {
  return st.y0 + ((st.y1 - st.y0) * t) / run;
}

/** Rise of one step: the stair is made of as many equal risers as come nearest 17.5 cm. */
export const RISER = 0.175;

/**
 * A flight as real steps: a tread and a riser for each, its top at the ramp's height over the tread's middle (so the walker, who stands on the ramp, is within half a riser of the
 * tread under the foot), a closed stringer along each side, a soffit under it, and a handrail on a post every few steps on each side `rails` names.
 */
function stair(g: Geo, st: Stair): void {
  const along = st.along === "s";
  const run = along ? st.s1 - st.s0 : st.d1 - st.d0;
  const lo = along ? st.s0 : st.d0;
  const across0 = along ? st.d0 : st.s0;
  const across1 = along ? st.d1 : st.s1;
  const rise = Math.abs(st.y1 - st.y0);
  const n = Math.max(2, Math.round(rise / RISER));
  const step = run / n;
  const P = (t: number, a: number, y: number): P3 => (along ? [lo + t, a, y] : [a, lo + t, y]);
  // Where the stair's direction of climb looks, and its across axis, as room directions.
  const fwd: P3 = along ? [st.y1 > st.y0 ? 1 : -1, 0, 0] : [0, st.y1 > st.y0 ? 1 : -1, 0];
  const across: P3 = along ? [0, 1, 0] : [1, 0, 0];
  const mat = st.mat;
  const ascending = st.y1 > st.y0;
  const top = (k: number): number => rampAt(st, (k + 0.5) * step, run);
  // The face of a riser looks back down the flight, the way the climber comes.
  const back: P3 = [-fwd[0], -fwd[1], 0];
  for (let k = 0; k < n; k++) {
    const t0 = k * step;
    const t1 = t0 + step;
    const y = top(k);
    // The riser stands at the tread's end nearer the foot of the flight, from the tread below it (the floor, for the first) up to this one.
    const below = ascending ? (k === 0 ? st.base : top(k - 1)) : k === n - 1 ? st.base : top(k + 1);
    const at = ascending ? t0 : t1;
    // A flight is a solid (a riser, a tread, a stringer, the soffit): no backs, which would lie in the plane of the slab edge or the wall it stands against.
    g.out.solid(() => {
      g.poly([P(at, across0, below), P(at, across1, below), P(at, across1, y), P(at, across0, y)], back, mat, { k: 0.8 });
      g.poly([P(t0, across0, y), P(t1, across0, y), P(t1, across1, y), P(t0, across1, y)], [0, 0, 1], mat);
    });
  }
  // The stringers: a solid side to each edge of the flight, from the floor under it to the line of the ramp, and the soffit.
  for (const a of [across0, across1]) {
    const n0: P3 = a === across0 ? [-across[0], -across[1], 0] : [across[0], across[1], 0];
    if (st.glass === true) {
      // A thin stringer along the flight's edge, and glass over it to the handrail.
      g.out.solid(() => g.poly([P(0, a, Math.max(st.base, st.y0 - 0.22)), P(run, a, Math.max(st.base, st.y1 - 0.22)), P(run, a, st.y1 + 0.02), P(0, a, st.y0 + 0.02)], n0, mat, { k: 0.75 }));
      const panes = Math.max(2, Math.round(run / 1.2));
      const ai = a === across0 ? a + 0.04 : a - 0.04;
      for (let i = 0; i < panes; i++) {
        const t0 = (i * run) / panes + 0.03;
        const t1 = ((i + 1) * run) / panes - 0.03;
        const lerpY = (t: number): number => rampAt(st, t, run);
        glassPanel((pts, hint, m, look) => g.poly(pts, hint, m, look), P(t0, ai, lerpY(t0) + 0.06), P(t1, ai, lerpY(t1) + 0.06), P(t1, ai, lerpY(t1) + 0.85), P(t0, ai, lerpY(t0) + 0.85), n0);
      }
      continue;
    }
    g.out.solid(() => g.poly([P(0, a, st.base), P(run, a, st.base), P(run, a, st.y1 + 0.02), P(0, a, st.y0 + 0.02)], n0, mat, { k: 0.75 }));
  }
  g.out.solid(() => g.poly([P(0, across0, st.y0 - 0.12), P(run, across0, st.y1 - 0.12), P(run, across1, st.y1 - 0.12), P(0, across1, st.y0 - 0.12)], [0, 0, -1], mat, { k: 0.7 }));
  // The handrails: a round timber on posts, 0.9 m over the ramp.
  for (const side of st.rails) {
    const a = side === "lo" ? across0 + 0.05 : across1 - 0.05;
    g.tube(P(0, a, st.y0 + 0.9), P(run, a, st.y1 + 0.9), 0.025, 6, "oak");
    const posts = Math.max(2, Math.round(n / 3) + 1);
    for (let i = 0; i < posts; i++) {
      const t = (i * run) / (posts - 1);
      const y = rampAt(st, t, run);
      g.at(P(t, a, 0)[0], P(t, a, 0)[1], { s: 1, d: 0 }).box(-0.02, 0.02, -0.02, 0.02, y, y + 0.9, "steel", { tint: [0.6, 0.6, 0.6] }, true, false);
    }
  }
}

// ---- rails

/** A rail: a top rail and a channel along the foot on posts every 1.4 m at most; bars between them, or a timber panel, or nothing for clear glass (as panes of a frame, pale edge lines and glints, `furniture/glass.ts`: this mesh has no blended layer). */
function rail(g: Geo, r: Rail): void {
  const dx = r.s1 - r.s0;
  const dd = r.d1 - r.d0;
  const len = Math.sqrt(dx * dx + dd * dd);
  if (!(len > 0)) return;
  const L = g.at((r.s0 + r.s1) / 2, (r.d0 + r.d1) / 2, { s: dx / len, d: dd / len });
  const h = len / 2;
  const frame = r.kind === "timber" ? r.mat : "steel";
  L.box(-h, h, -0.04, 0.04, r.y + r.h - 0.045, r.y + r.h, r.kind === "glass" ? "oak" : r.mat);
  L.box(-h, h, -0.03, 0.03, r.y, r.y + 0.05, frame);
  const posts = Math.max(2, Math.ceil(len / 1.4) + 1);
  for (let i = 0; i < posts; i++) {
    const f = -h + 0.025 + (i * (len - 0.05)) / (posts - 1);
    L.box(f - 0.025, f + 0.025, -0.025, 0.025, r.y + 0.05, r.y + r.h - 0.045, frame, undefined, true, false);
  }
  if (r.kind === "bars") {
    const nb = Math.max(1, Math.floor(len / 0.13));
    for (let i = 1; i < nb; i++) {
      const f = -h + (i * len) / nb;
      L.box(f - 0.007, f + 0.007, -0.007, 0.007, r.y + 0.05, r.y + r.h - 0.045, r.mat, undefined, true, false);
    }
  } else if (r.kind === "timber") L.box(-h, h, -0.02, 0.02, r.y + 0.05, r.y + r.h - 0.045, r.mat, undefined, false, false);
  else {
    // Clear glass: one pane between each two posts.
    for (let i = 0; i + 1 < posts; i++) {
      const f0 = -h + 0.05 + (i * (len - 0.05)) / (posts - 1) + 0.02;
      const f1 = -h + 0.025 + ((i + 1) * (len - 0.05)) / (posts - 1) - 0.02;
      const y0 = r.y + 0.05;
      const y1 = r.y + r.h - 0.045;
      glassPanel((pts, hint, mat, look) => L.poly(pts, hint, mat, look), [f0, 0, y0], [f1, 0, y0], [f1, 0, y1], [f0, 0, y1], [0, 1, 0]);
    }
  }
}


// ---- windows in the back and side walls

/**
 * The glass of each window of `Design.windows`, where the room has a layer for it (`out.marked`): a pane of through glass (`roomGlass.ts`) set `PANE_SETBACK` back into the wall's thickness, and the reveal, the
 * four faces of the wall's thickness round it, in the wall's own paint. The wall is cut away there (`outerWall`), so what is read behind the pane is the sky and the far land.
 */
function windows(g: Geo, d: Design): void {
  if (g.out.marked === null) return;
  const paint = { tint: [1.2, 1.18, 1.1] as Rgb };
  for (const [n, w] of (d.windows ?? []).entries()) {
    const back = w.wall === "back";
    // A point of the wall's plane (`off` out of the room, into its thickness): along it `a`, at height `y`.
    const P = (a: number, y: number, off: number): P3 => (back ? [a, d.depth + off, y] : w.wall === "left" ? [-off, a, y] : [d.width + off, a, y]);
    const into: P3 = back ? [0, -1, 0] : w.wall === "left" ? [1, 0, 0] : [-1, 0, 0];
    const along: P3 = back ? [1, 0, 0] : [0, 1, 0];
    const o = PANE_SETBACK;
    g.poly([P(w.a0, w.y0, 0), P(w.a0, w.y0, o), P(w.a0, w.y1, o), P(w.a0, w.y1, 0)], along, "painted", paint);
    g.poly([P(w.a1, w.y0, 0), P(w.a1, w.y0, o), P(w.a1, w.y1, o), P(w.a1, w.y1, 0)], [-along[0], -along[1], 0], "painted", paint);
    g.poly([P(w.a0, w.y0, 0), P(w.a1, w.y0, 0), P(w.a1, w.y0, o), P(w.a0, w.y0, o)], [0, 0, 1], "painted", paint);
    g.poly([P(w.a0, w.y1, 0), P(w.a1, w.y1, 0), P(w.a1, w.y1, o), P(w.a0, w.y1, o)], [0, 0, -1], "painted", paint);
    g.glassSheet([P(w.a0, w.y0, o), P(w.a1, w.y0, o), P(w.a1, w.y1, o), P(w.a0, w.y1, o)], [into[0], into[1], 0], 700 + n * 13 + Math.round(w.a0 * 10), [w.y1 - w.y0, w.a1 - w.a0]);
  }
}

/**
 * The underside of what is above a place of the room at the height `y`: the lowest ceiling or floor slab with thickness that covers it and is over `y` by more than 0.3 m, or the room's own height. What hangs from "the ceiling"
 * (a lamp's wire, a bulb string's rods, a batten ceiling's hangers, a vent, a sprinkler) hangs from this, never through a slab to the room's overall height (the hotel's lobby lamps' wires once stood in the corridor above).
 */
export function underside(d: Design, s: number, dd: number, y: number): number {
  let best = d.height;
  for (const sl of d.slabs) {
    const under = sl.kind === "ceiling" ? sl.y : sl.thick > 0 ? sl.y - sl.thick : Infinity;
    if (under > y + 0.3 && under < best && s >= sl.s0 && s <= sl.s1 && dd >= sl.d0 && dd <= sl.d1) best = under;
  }
  return best;
}
