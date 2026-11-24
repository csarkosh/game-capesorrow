/**
 * The railroad's main line and the power line beside the highway, as plain arrays, in cells of `RAIL_CELL` m along z. A cell is
 * a pure function of the world's seed and its index (`railCell`), so any machine builds the same one, in any order, whenever
 * the camera comes within reach (`railParts.ts` streams them).
 *
 * What a cell holds, by level of detail (`RailLod`):
 *
 * - **0, near** (the nearest cells): the ballast bed with its sloped sides and a skirt down into the bench (so a coarse terrain
 *   mesh never shows daylight under it), the shoulders, ties every `TIE_PITCH` m as boxes, two rails with a proper head (foot,
 *   web, head), crossings, trestles, riprap on causeways, poles with crossarms and insulators, and wires as sagging ribbons.
 * - **1, mid**: ballast, two plain rails, crossings, trestles, poles and wires; no ties, cut every 16 m.
 * - **2, far**: a ballast strip and poles, cut every 32 m.
 *
 * Every height is the highway's grade line at that z (the bench is exactly it: `railGround.ts`) plus a height in the cross
 * section, so the track sits on the ground the simulation made, and a spur's end can meet it: the rails' tops are `RAIL_TOP`
 * over the bench, their gauge `RAIL_GAUGE`.
 */
import { frameAlong, runLength, BALLAST_SKIRT, BALLAST_TOP, BALLAST_TOP_HALF, RAIL_FOOT, RAIL_TOP, TIE_PITCH, pointOf, type Frame, type Profile } from "./railConstants.js";
import { MeshBuilder, hash01, scaled, type MeshArrays, type Rgb, type Vec3 } from "./meshBuilder.js";
import { DECK, PAINT_WHITE, PILE, TIMBER, TIMBER_WEATHERED, YARD_ASPHALT, YARD_GRAVEL } from "./palette.js";
import { sliceDue, type Slices } from "@csarkosh/engine/game/syncJobs";
import { alongSurface, bedGrid, railSpecs, spill, stretchAt, texBox, tieAt, weedsAt, type Look, type SurfaceSpec } from "./trackLook.js";
import { groundFrame, type Surface, type WearKind } from "./townSurface.js";
import { RAIL_BED_HALF, RAIL_GAUGE } from "../../sim/town/rail.js";
import { RAIL_BENCH_HALF } from "../../sim/town/railGround.js";
import type { RailCrossing } from "../../sim/town/railCrossings.js";
import { RAIL_CROSSBUCK, RAIL_STOP_LINE } from "../../sim/town/junctions.js";
import { TRESTLE_END, TRESTLE_HALF } from "../../sim/town/railDeck.js";
import type { RailSpan } from "../../sim/town/railSpans.js";
import { POLE_HEIGHT, poleAt, type Pole } from "../../sim/town/powerLine.js";

/** The side of a cell along z, metres. */
export const RAIL_CELL = 128;
export type RailLod = 0 | 1 | 2;

export * from "./railConstants.js";
/** The cut of the path at each level of detail, metres. */
export const LOD_STEP: Readonly<Record<RailLod, number>> = { 0: 4, 1: 16, 2: 32 };
/** The cut of the bed's grid at each level, metres: the near level's is fine enough for its lumps. */
export const BED_STEP: Readonly<Record<RailLod, number>> = { 0: 1, 1: 16, 2: 32 };

/** The distance between a trestle's bents, metres. Its deck's width and ends are the simulation's (`railDeck.ts`). */
export const TRESTLE_BENT = 3;

/** A crossing's panel: half width across the track where its top is flat, where its ramps end, and their heights, metres. */
export const PANEL_FLAT = 1.1;
export const PANEL_RAMP = 2.4;
export const PANEL_TOP = 0.34;
export const PANEL_FOOT = 0.125;
/** A crossbuck: its post's height and the height of its boards' centre, and how far from the track it stands, metres. */
export const CROSSBUCK_POST = 2.7;
export const CROSSBUCK_AT = 2.35;
export const CROSSBUCK_DISTANCE = RAIL_CROSSBUCK;
export const STOP_LINE_DISTANCE = RAIL_STOP_LINE;

/** Poles: the crossarm's length, the wires' sag for a span of `POLE_SPACING` m, and the wires' radius, metres. */
export const CROSSARM = 2.4;
export const POLE_RADIUS = 0.16;
export const WIRE_RADIUS = 0.022;
export const SAG_PER_SQUARE = 0.00035;
export const WIRE_SEGMENTS = 8;

const POLE_COLOUR: Rgb = [0.16, 0.11, 0.07];
const WIRE: Rgb = [0.03, 0.03, 0.035];
const INSULATOR: Rgb = [0.12, 0.2, 0.17];
const STONE: Rgb = [0.3, 0.3, 0.29];
const WHITE_SIGN: Rgb = [0.62, 0.62, 0.6];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** What a cell is built from: the world's own answers, as plain functions. */
export type RailWorld = {
  readonly seed: number;
  /** The engine's ground height at a world position. */
  heightAt(x: number, z: number): number;
  /** The highway's grade line at a z: the bench's height. */
  gradeAt(z: number): number;
  /** The main line's centre x at a z. */
  centreX(z: number): number;
  /** The crossings of the town's ways with the line, ordered by z. */
  readonly crossings: readonly RailCrossing[];
  /** The sea's runs along the line that touch [z0, z1]. */
  spans(z0: number, z1: number): readonly RailSpan[];
  /** The poles with z in [z0, z1). */
  poles(z0: number, z1: number): readonly Pole[];
};

/** The line's frame at a z: its centre, the grade there, and the unit normal across it (toward +x). */
function frameAt(w: RailWorld, z: number): Frame {
  const slope = w.centreX(z + 0.5) - w.centreX(z - 0.5);
  const len = Math.sqrt(1 + slope * slope);
  return { x: w.centreX(z), z, g: w.gradeAt(z), nx: 1 / len, nz: -slope / len };
}

export const BALLAST_FULL: Profile = [
  [-RAIL_BED_HALF, -BALLAST_SKIRT],
  [-RAIL_BED_HALF, 0],
  [-BALLAST_TOP_HALF, BALLAST_TOP],
  [BALLAST_TOP_HALF, BALLAST_TOP],
  [RAIL_BED_HALF, 0],
  [RAIL_BED_HALF, -BALLAST_SKIRT],
];
export const BALLAST_STRIP: Profile = [
  [-RAIL_BED_HALF, 0],
  [-BALLAST_TOP_HALF, BALLAST_TOP],
  [BALLAST_TOP_HALF, BALLAST_TOP],
  [RAIL_BED_HALF, 0],
];

/** A rail's section round its own centre: the foot, the web and the head, closed (the first point follows the last). */
export const RAIL_PROFILE: Profile = [
  [-0.07, RAIL_FOOT],
  [-0.07, RAIL_FOOT + 0.025],
  [-0.02, RAIL_FOOT + 0.04],
  [-0.02, RAIL_FOOT + 0.075],
  [-0.037, RAIL_FOOT + 0.085],
  [-0.037, RAIL_TOP],
  [0.037, RAIL_TOP],
  [0.037, RAIL_FOOT + 0.085],
  [0.02, RAIL_FOOT + 0.075],
  [0.02, RAIL_FOOT + 0.04],
  [0.07, RAIL_FOOT + 0.025],
  [0.07, RAIL_FOOT],
];
export const RAIL_PLAIN: Profile = [
  [-0.05, RAIL_FOOT],
  [-0.05, RAIL_TOP],
  [0.05, RAIL_TOP],
  [0.05, RAIL_FOOT],
];

/** What a swept profile is made of: a surface for its upward faces (`topEdges`: just these edges of the profile, when given) and for the rest, and how far each frame lifts it. */
export type SweepLook = {
  readonly top?: SurfaceSpec;
  readonly side?: SurfaceSpec;
  /** The profile's edges that are the "top" (indices); by default every edge that faces up. */
  readonly topEdges?: readonly number[];
  readonly lift?: (i: number) => number;
};

/**
 * A profile swept along the frames: a quad for each edge of the profile and each pair of frames, facing out of the section
 * (`closed`: the last point joins the first). `centre` shifts the profile across the track. With a `look`, each quad wears a surface whose grain
 * runs along the track.
 */
export function sweep(sink: MeshBuilder, frames: readonly Frame[], profile: Profile, centre: number, colour: Rgb, closed: boolean, topColour: Rgb = colour, look?: SweepLook): void {
  const n = profile.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i + 1 < frames.length; i++) {
    const f0 = frames[i] as Frame;
    const f1 = frames[i + 1] as Frame;
    const l0 = look?.lift?.(i) ?? 0;
    const l1 = look?.lift?.(i + 1) ?? 0;
    for (let e = 0; e < edges; e++) {
      const p = profile[e] as readonly [number, number];
      const q = profile[(e + 1) % n] as readonly [number, number];
      const du = q[0] - p[0];
      const dy = q[1] - p[1];
      // Outward of a clockwise section is (-dy, du) in (across, up).
      const hu = -dy;
      const hy = du;
      const mid = (f0.nx + f1.nx) / 2;
      const midZ = (f0.nz + f1.nz) / 2;
      const hint: Vec3 = [mid * hu, hy, midZ * hu];
      const isTop = look?.topEdges !== undefined ? look.topEdges.includes(e) : hy > 0.5 * Math.abs(hu);
      const a = pointOf(f0, centre + p[0], p[1] + l0);
      const b = pointOf(f1, centre + p[0], p[1] + l1);
      const c = pointOf(f1, centre + q[0], q[1] + l1);
      const d = pointOf(f0, centre + q[0], q[1] + l0);
      const spec = look === undefined ? undefined : isTop ? (look.top ?? look.side) : look.side;
      const surface = spec === undefined ? undefined : alongSurface(spec, a, b, d);
      sink.quad(a, b, c, d, hint, hy > 0.5 * Math.abs(hu) ? topColour : colour, surface, closed ? undefined : { back: true });
    }
  }
}

/** The flat gravel on the bench beside the bed: the gravel layer on the world's frame, grimy, with growth where the stretch is old. */
export function shoulderSurface(look: Look, f: Frame): Surface {
  const st = stretchAt(look, f.x, f.z);
  return {
    layer: "gravel",
    frame: groundFrame({ x: 0, z: 0 }),
    tint: [0.5 - 0.1 * st.age, 0.46 - 0.12 * st.age, 0.41 - 0.16 * st.age],
    wear: 0.25 + 0.3 * st.age,
    wearKind: "grime",
    wear2: 0.15 + 0.7 * st.weeds * st.age,
    wearKind2: "growth",
  };
}

/** The two rails over a run of frames at a gauge: the head-web-foot section near (`lod` 0), plain beyond, in aged metal with a bright worn head on a used line. */
export function railPair(sink: MeshBuilder, frames: readonly Frame[], look: Look, lod: RailLod, lift?: (i: number) => number): void {
  const mid = frames[Math.floor(frames.length / 2)] as Frame;
  const spec = railSpecs(look, mid.x, mid.z);
  const rails = lod === 0 ? RAIL_PROFILE : RAIL_PLAIN;
  const topEdges = lod === 0 ? [5] : [1];
  for (const side of [-1, 1]) sweep(sink, frames, rails, (side * RAIL_GAUGE) / 2, spec.flatSide, true, spec.flatTop, { top: spec.top, side: spec.side, topEdges, ...(lift === undefined ? {} : { lift }) });
}

/** Frames along z from `za` to `zb` every `step` metres, with the ends exact. */
function framesOf(w: RailWorld, za: number, zb: number, step: number): Frame[] {
  const out: Frame[] = [];
  const n = Math.max(1, Math.round((zb - za) / step));
  for (let i = 0; i <= n; i++) out.push(frameAt(w, za + ((zb - za) * i) / n));
  return out;
}

/** Whether a z is within a trestle's draw. */
function onTrestle(spans: readonly RailSpan[], z: number): boolean {
  for (const s of spans) if (s.kind === "trestle" && z > s.a - TRESTLE_END && z < s.b + TRESTLE_END) return true;
  return false;
}

/** Whether a z is in a crossing's panel (along the track), with a margin. */
function inPanel(w: RailWorld, z: number, margin: number): boolean {
  for (const c of w.crossings) {
    const half = panelHalfAlong(c) + margin;
    if (z > c.z - half && z < c.z + half) return true;
  }
  return false;
}

/** How far a crossing's panel reaches along the track from the crossing's point, each way: its street's half width over the angle. */
function panelHalfAlong(c: RailCrossing): number {
  const sin = Math.max(0.2, Math.abs(c.dx));
  return (c.width / 2) / sin + PANEL_RAMP;
}

/** The finished arrays of a cell: the layer drawn flat on the ground a step ahead of it, and what stands. Null where a layer is empty. */
export type RailCellArrays = { readonly flat: MeshArrays | null; readonly solid: MeshArrays | null; readonly lod: RailLod; readonly k: number };

/** A cell's geometry at a level of detail, in slices for the scheduler (run at once, it is the same arrays). */
export function* railCell(w: RailWorld, k: number, lod: RailLod): Slices<RailCellArrays> {
  const z0 = k * RAIL_CELL;
  const z1 = z0 + RAIL_CELL;
  const flat = new MeshBuilder();
  const solid = new MeshBuilder();
  const spans = w.spans(z0 - 40, z1 + 40);
  const step = LOD_STEP[lod];

  // The bed, in runs between the trestles, cut every `BED_STEP` metres: one crowned grid (displaced at the near level), the rails over it.
  const look: Look = { seed: w.seed, spur: false };
  const frames = framesOf(w, z0, z1, BED_STEP[lod]);
  const bed: Frame[][] = [];
  let run: Frame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as Frame;
    const next = frames[i + 1];
    const mid = next === undefined ? f.z : (f.z + next.z) / 2;
    if (i + 1 < frames.length && onTrestle(spans, mid)) {
      if (run.length > 1) bed.push(run);
      run = [];
    } else run.push(f);
  }
  if (run.length > 1) bed.push(run);
  for (const r of bed) {
    bedGrid(solid, r, look, lod, lod === 2 ? 0 : BALLAST_SKIRT);
    if (lod === 2) continue;
    // The rails, every 2 m at the near level.
    const rf = lod === 0 ? r.filter((_, i) => i % 2 === 0 || i === r.length - 1) : r;
    railPair(solid, rf, look, lod);
    // The shoulders: gravel on the bench either side of the ballast, flat.
    for (const side of [-1, 1]) {
      const stepN = lod === 0 ? 4 : 1;
      for (let i = 0; i + stepN < r.length + stepN - 1 && i < r.length - 1; i += stepN) {
        const a = r[i] as Frame;
        const b = r[Math.min(r.length - 1, i + stepN)] as Frame;
        const o0 = side * RAIL_BED_HALF;
        const o1 = side * RAIL_BENCH_HALF;
        flat.quad(pointOf(a, o0, 0.012), pointOf(b, o0, 0.012), pointOf(b, o1, 0.012), pointOf(a, o1, 0.012), [0, 1, 0], YARD_GRAVEL, shoulderSurface(look, a));
      }
    }
    if (lod === 0) for (let i = 0; i < r.length; i += 4) spill(solid, look, r[i] as Frame, i, w.heightAt);
  }
  yield;

  // The rails' ends on a trestle and the rails over it: the same rails, on the deck.
  for (const s of spans) {
    if (s.kind !== "trestle") continue;
    const a = Math.max(z0, s.a - TRESTLE_END);
    const b = Math.min(z1, s.b + TRESTLE_END);
    if (!(b > a)) continue;
    const tf = framesOf(w, a, b, Math.min(step, 4));
    if (lod !== 2) railPair(solid, tf, look, lod);
    trestle(w, solid, tf, lod);
  }
  yield;

  // Ties, every `TIE_PITCH` m: near cells only, off the crossings' panels.
  if (lod === 0) {
    const j0 = Math.ceil(z0 / TIE_PITCH);
    const j1 = Math.ceil(z1 / TIE_PITCH);
    for (let j = j0; j < j1; j++) {
      const z = j * TIE_PITCH;
      if (inPanel(w, z, 0)) continue;
      const f = frameAt(w, z);
      tieAt(solid, look, f, true);
      weedsAt(solid, look, f, j, true);
      if (sliceDue()) yield;
    }
  }

  // Riprap on the sides of a causeway.
  if (lod < 2) {
    for (const s of spans) if (s.kind === "causeway" && s.b > z0 && s.a < z1) riprap(w, solid, Math.max(z0, s.a - 6), Math.min(z1, s.b + 6));
  }

  // The crossings whose points are in this cell.
  for (const c of w.crossings) {
    if (c.z >= z0 && c.z < z1) crossing(w, solid, flat, c, lod);
  }

  // The power line: its poles and the wires from each to the next.
  const poles = w.poles(z0, z1);
  for (const p of poles) {
    const next = poleAt(w.seed, p.k + 1);
    pole(w, solid, p, next, lod);
  }
  yield;

  const sol = solid.vertices > 0 ? solid.finish() : null;
  const fl = flat.vertices > 0 ? flat.finish() : null;
  return { flat: fl, solid: sol, lod, k };
}

/**
 * A trestle over a run of frames (the main line's, or the spur's): its bents of piles every `TRESTLE_BENT` m, the planked deck, the stringers,
 * its ties and its guard rails. `heightAt` is the ground the piles stand on.
 */
export function trestleOver(heightAt: (x: number, z: number) => number, b: MeshBuilder, frames: readonly Frame[], lod: RailLod, firstBent = 0, look: Look = { seed: 0, spur: false }): void {
  if (frames.length < 2) return;
  const timber = (tint: Rgb, wear: number | ((p: Vec3) => number), kind: WearKind = "grime", streaks = false): SurfaceSpec => ({ layer: "planks_weathered", tint, wear, wearKind: kind, streaks, wear2: 0.12, wearKind2: "moss" });
  // The planked deck and the stringers under it, swept along the frames: boards that run along the deck, worn grey in the wheel-less middle and dark at the edges.
  sweep(b, frames, [[-TRESTLE_HALF, 0.08], [TRESTLE_HALF, 0.08]], 0, DECK, false, DECK, { top: timber([1.25, 1.12, 1.0], 0.3), side: timber([1.1, 1.0, 0.9], 0.3) });
  sweep(b, frames, [[-TRESTLE_HALF, 0.04], [-TRESTLE_HALF, 0.08]], 0, TIMBER, false, TIMBER, { side: timber([1.0, 0.9, 0.8], 0.4) });
  sweep(b, frames, [[TRESTLE_HALF, 0.08], [TRESTLE_HALF, 0.04]], 0, TIMBER, false, TIMBER, { side: timber([1.0, 0.9, 0.8], 0.4) });
  for (const off of [-0.8, 0.8]) sweep(b, frames, [[off - 0.15, -0.3], [off - 0.15, 0.04], [off + 0.15, 0.04], [off + 0.15, -0.3]], 0, TIMBER_WEATHERED, true, TIMBER_WEATHERED, { top: timber([0.9, 0.82, 0.74], 0.45, "grime", true), side: timber([0.9, 0.82, 0.74], 0.45, "grime", true) });
  // The guard rails: a top rail and a mid rail on posts every bent.
  for (const side of [-1, 1]) {
    const off = side * (TRESTLE_HALF - 0.06);
    sweep(b, frames, [[off - 0.05, 1.0], [off - 0.05, 1.1], [off + 0.05, 1.1], [off + 0.05, 1.0]], 0, TIMBER, true, TIMBER, { top: timber([1.1, 1.0, 0.9], 0.3), side: timber([1.1, 1.0, 0.9], 0.3) });
    sweep(b, frames, [[off - 0.04, 0.55], [off - 0.04, 0.62], [off + 0.04, 0.62], [off + 0.04, 0.55]], 0, TIMBER, true, TIMBER, { top: timber([1.1, 1.0, 0.9], 0.3), side: timber([1.1, 1.0, 0.9], 0.3) });
  }
  const length = runLength(frames);
  // Ties on the deck, as on the bed: individuals.
  if (lod === 0) {
    const n = Math.floor(length / TIE_PITCH);
    for (let j = 0; j < n; j++) {
      const f = frameAlong(frames, (j + 0.5) * TIE_PITCH);
      tieAt(b, look, f, true);
    }
  }
  // The bents: three piles under a cap beam, down to the ground, and the posts of the guard rails. Each pile is stained dark below the joint
  // where it meets the cap, and the cap below the deck it carries.
  const nb = Math.max(1, Math.floor(length / TRESTLE_BENT));
  for (let i = firstBent; i <= nb; i++) {
    const f = frameAlong(frames, (length * i) / nb);
    const capBottom = f.g - 0.55;
    const stain = (p: Vec3): number => 0.2 + 0.7 * clamp01(1 - (capBottom - p[1]) / 0.6) + (p[1] > capBottom ? 0.2 : 0);
    texBox(b, f.x, f.z, capBottom, f.nx, f.nz, 1.55, 0.14, 0.25, timber([0.95, 0.85, 0.75], 0.45, "grime", true), false, PILE, true);
    for (const off of [-1.15, 0, 1.15]) {
      const x = f.x + f.nx * off;
      const z = f.z + f.nz * off;
      const bottom = Math.min(heightAt(x, z), f.g - 1) - 0.4;
      texBox(b, x, z, bottom, 1, 0, 0.16, 0.16, capBottom - bottom, timber([0.75, 0.66, 0.58], stain, "grime", true), true, PILE, true);
    }
    if (lod < 2) {
      for (const side of [-1, 1]) {
        const x = f.x + f.nx * side * (TRESTLE_HALF - 0.06);
        const z = f.z + f.nz * side * (TRESTLE_HALF - 0.06);
        b.box(x, z, f.g + 0.08, 1, 0, 0.06, 0.06, 1.05, TIMBER, TIMBER, true, null);
      }
    }
  }
}

function trestle(w: RailWorld, b: MeshBuilder, frames: readonly Frame[], lod: RailLod): void {
  trestleOver(w.heightAt, b, frames, lod, 0, { seed: w.seed, spur: false });
}

/** A crossing: the roadway carried over the rails on a panel flush with their heads, crossbucks on posts each side, and a stop line on the highway side. */
function crossing(w: RailWorld, solid: MeshBuilder, flat: MeshBuilder, c: RailCrossing, lod: RailLod): void {
  const f = frameAt(w, c.z);
  const D: [number, number] = [c.dx, c.dz];
  const L: [number, number] = [-c.dz, c.dx];
  const N: [number, number] = [f.nx, f.nz];
  const DN = D[0] * N[0] + D[1] * N[1];
  const LN = L[0] * N[0] + L[1] * N[1];
  if (Math.abs(DN) < 0.15) return;
  const hw = c.width / 2;
  // A point of the street at a lateral `lat` from its middle and at the distance `n` across the line.
  const at = (lat: number, n: number): [number, number] => {
    const s = (n - lat * LN) / DN;
    return [c.x + L[0] * lat + D[0] * s, c.z + L[1] * lat + D[1] * s];
  };
  const rails = [-PANEL_RAMP, -PANEL_FLAT, PANEL_FLAT, PANEL_RAMP];
  const rises = [PANEL_FOOT, PANEL_TOP, PANEL_TOP, PANEL_FOOT];
  const colour = c.paved ? YARD_ASPHALT : TIMBER_WEATHERED;
  const plank: Rgb = c.paved ? scaled(YARD_ASPHALT, 1.4) : scaled(TIMBER_WEATHERED, 0.8);
  const along: Vec3 = [-f.nz, 0, f.nx];
  const worn = (p: Vec3): number => {
    // Wear at the street's edges, where the wheels do not run, and on the ramps where the traffic pounds.
    const lat = Math.abs((p[0] - c.x) * L[0] + (p[2] - c.z) * L[1]);
    return clamp01((lat - (hw - 0.6)) / 0.6) * 0.6 + 0.12;
  };
  const spec: SurfaceSpec = c.paved
    ? { layer: "asphalt", tint: [1.1, 1.08, 1.05], wear: worn, wearKind: "grime", wear2: 0.18, wearKind2: "damp" }
    : { layer: "planks_weathered", tint: [1.05, 0.95, 0.85], wear: worn, wearKind: "grime", wear2: 0.12, wearKind2: "moss" };
  // The panel: a grid of the roadway's width in five columns and four rows (the ramps, the flat, the ramps), so the wear can be said at its edges.
  const lats = [-hw, -hw * 0.6, 0, hw * 0.6, hw];
  const grid: Vec3[][] = rails.map((n, i) => lats.map((lat): Vec3 => {
    const p = at(lat, n);
    return [p[0], w.gradeAt(p[1]) + (rises[i] as number), p[1]];
  }));
  solid.grid(grid, [c.x, f.g - 3, c.z], {
    colour: (_i, j) => (j === 0 || j === 4 ? scaled(plank, 0.8) : plank),
    layer: spec.layer,
    tint: () => spec.tint as Rgb,
    uv: (i, j) => {
      const p = (grid[i] as Vec3[])[j] as Vec3;
      return [p[0] * along[0] + p[2] * along[2], p[0] * f.nx + p[2] * f.nz];
    },
    wear: (i, j) => [worn((grid[i] as Vec3[])[j] as Vec3) + (i === 0 || i === 3 ? 0.1 : 0), "grime"],
    wear2: () => [spec.wear2 as number, spec.wearKind2 as WearKind],
  });
  // The panel's two edges: a skirt down to the bench, so no light shows under a ramp.
  for (const lat of [-hw, hw]) {
    const a = at(lat, -PANEL_RAMP);
    const m1 = at(lat, -PANEL_FLAT);
    const m2 = at(lat, PANEL_FLAT);
    const bz = at(lat, PANEL_RAMP);
    const pts = [a, m1, m2, bz];
    const hs = [PANEL_FOOT, PANEL_TOP, PANEL_TOP, PANEL_FOOT];
    for (let i = 0; i < 3; i++) {
      const p = pts[i] as [number, number];
      const q = pts[i + 1] as [number, number];
      const gp = w.gradeAt(p[1]);
      const gq = w.gradeAt(q[1]);
      const corners: Vec3[] = [[p[0], gp - 0.05, p[1]], [q[0], gq - 0.05, q[1]], [q[0], gq + (hs[i + 1] as number), q[1]], [p[0], gp + (hs[i] as number), p[1]]];
      solid.poly(corners, [L[0] * Math.sign(lat), 0, L[1] * Math.sign(lat)], colour, alongSurface({ layer: c.paved ? "asphalt" : "planks_weathered", tint: [0.8, 0.78, 0.74], wear: 0.3, wearKind: "grime" }, corners[0] as Vec3, corners[1] as Vec3, corners[3] as Vec3));
    }
  }
  if (lod === 2) return;
  // Crossbucks on posts, on the right of each approach, facing the traffic that comes to them.
  for (const side of [1, -1]) {
    // `side` 1: the highway's side (larger x across the line), whose traffic travels along `D` (seaward); -1 the sea's, travelling the other way.
    const travel: [number, number] = side === 1 ? D : [-D[0], -D[1]];
    const rightOf: [number, number] = [travel[1], -travel[0]];
    const lat = (c.roadway / 2 + 0.9) * (rightOf[0] * L[0] + rightOf[1] * L[1]);
    const [px, pz] = at(lat, side * CROSSBUCK_DISTANCE);
    const foot = w.heightAt(px, pz);
    solid.box(px, pz, foot - 0.1, 1, 0, 0.05, 0.05, CROSSBUCK_POST + 0.1, PAINT_WHITE, PAINT_WHITE);
    // Two boards crossed, in the plane across the street, facing back along the approach.
    const top = foot + CROSSBUCK_AT;
    const face: Vec3 = [-travel[0], 0, -travel[1]];
    for (const turn of [1, -1]) {
      const dir: Vec3 = [L[0] * 0.7071, turn * 0.7071, L[1] * 0.7071];
      const thick: Vec3 = [face[0] * 0.02, 0, face[2] * 0.02];
      // The board's own cross direction in its plane, perpendicular to `dir`.
      const cross: Vec3 = [L[0] * 0.7071 * turn * -1, 0.7071, L[1] * 0.7071 * turn * -1];
      const corner = (a: number, bq: number): Vec3 => [px + dir[0] * a + cross[0] * bq + thick[0], top + dir[1] * a + cross[1] * bq, pz + dir[2] * a + cross[2] * bq + thick[2]];
      solid.quad(corner(-0.55, -0.07), corner(0.55, -0.07), corner(0.55, 0.07), corner(-0.55, 0.07), face, WHITE_SIGN);
      const back: Vec3 = [-thick[0], 0, -thick[2]];
      const corner2 = (a: number, bq: number): Vec3 => [px + dir[0] * a + cross[0] * bq + back[0], top + dir[1] * a + cross[1] * bq, pz + dir[2] * a + cross[2] * bq + back[2]];
      solid.quad(corner2(-0.55, -0.07), corner2(0.55, -0.07), corner2(0.55, 0.07), corner2(-0.55, 0.07), [-face[0], 0, -face[2]], scaled(WHITE_SIGN, 0.8));
    }
  }
  // The stop lines, one on each approach, across the lane that comes to the line: at least 15 ft (4.6 m) from the nearest rail (the
  // distances are the junction's own, `sim/town/junctions.ts`, so they agree with the street's markings).
  for (const side of [1, -1]) {
    const rightL = D[1] * L[0] + -D[0] * L[1];
    const lane = (rightL >= 0 ? 1 : -1) * side;
    const n0 = side * STOP_LINE_DISTANCE;
    const n1 = n0 + side * 0.6;
    const a = at(lane * 0.15, n0);
    const bb = at(lane * (c.roadway / 2 - 0.1), n0);
    const cc = at(lane * (c.roadway / 2 - 0.1), n1);
    const d = at(lane * 0.15, n1);
    const up = (p: [number, number]): Vec3 => [p[0], w.heightAt(p[0], p[1]) + 0.135, p[1]];
    flat.quad(up(a), up(bb), up(cc), up(d), [0, 1, 0], PAINT_WHITE);
  }
}

/** A pole with its crossarm and insulators and the three wires to the next pole. */
function pole(w: RailWorld, solid: MeshBuilder, p: Pole, next: Pole, lod: RailLod): void {
  const foot = w.heightAt(p.x, p.z) - 0.3;
  const top = foot + POLE_HEIGHT;
  solid.cylinder(p.x, p.z, foot, POLE_RADIUS, POLE_HEIGHT + 0.3, lod === 0 ? 7 : 4, POLE_COLOUR, POLE_COLOUR, POLE_RADIUS * 0.8);
  // The line's direction at the pole: toward the next.
  const dx = next.x - p.x;
  const dz = next.z - p.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const ux = len > 1e-6 ? dz / len : 1;
  const uz = len > 1e-6 ? -dx / len : 0;
  // Across the line: the crossarm lies along (ux, uz).
  const armY = top - 0.7;
  solid.box(p.x, p.z, armY, ux, uz, CROSSARM / 2, 0.06, 0.12, POLE_COLOUR, POLE_COLOUR);
  if (lod === 2) return;
  const attach = (off: number, y: number): Vec3 => [p.x + ux * off, y, p.z + uz * off];
  const here: Vec3[] = [attach(-CROSSARM / 2 + 0.12, armY + 0.12 + 0.18), attach(CROSSARM / 2 - 0.12, armY + 0.12 + 0.18), attach(0, top + 0.12)];
  for (const a of here) solid.box(a[0], a[2], a[1] - 0.18, 1, 0, 0.04, 0.04, 0.18, INSULATOR, INSULATOR);
  if (len < 1e-6) return;
  // The next pole's attachments, in the same order: its crossarm is across the same line.
  const nfoot = w.heightAt(next.x, next.z) - 0.3;
  const ntop = nfoot + POLE_HEIGHT;
  const nuX = dz / len;
  const nuZ = -dx / len;
  const nArm = ntop - 0.7;
  const there: Vec3[] = [
    [next.x + nuX * (-CROSSARM / 2 + 0.12), nArm + 0.12 + 0.18, next.z + nuZ * (-CROSSARM / 2 + 0.12)],
    [next.x + nuX * (CROSSARM / 2 - 0.12), nArm + 0.12 + 0.18, next.z + nuZ * (CROSSARM / 2 - 0.12)],
    [next.x, ntop + 0.12, next.z],
  ];
  const sag = SAG_PER_SQUARE * len * len;
  for (let i = 0; i < 3; i++) {
    const a = here[i] as Vec3;
    const bq = there[i] as Vec3;
    let prev: Vec3 = a;
    for (let s = 1; s <= WIRE_SEGMENTS; s++) {
      const t = s / WIRE_SEGMENTS;
      const cur: Vec3 = [a[0] + (bq[0] - a[0]) * t, a[1] + (bq[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (bq[2] - a[2]) * t];
      solid.prism(prev, cur, WIRE_RADIUS, 3, WIRE, null);
      prev = cur;
    }
  }
}

/** Rock blocks of a causeway's riprap on its two sides over [za, zb]: a deterministic scatter by the block's index. */
export function riprap(w: RailWorld, b: MeshBuilder, za: number, zb: number): void {
  for (let j = Math.ceil(za / 0.9); j < zb / 0.9; j++) {
    for (const side of [-1, 1]) {
      const h = hash01(j, side + 5);
      const f = frameAt(w, j * 0.9);
      const off = side * (RAIL_BENCH_HALF + 0.3 + h * 1.4);
      const x = f.x + f.nx * off;
      const z = f.z + f.nz * off;
      const size = 0.35 + hash01(j, side + 9) * 0.35;
      b.box(x, z, w.heightAt(x, z) - 0.15, 1, 0, size, size * 0.8, size * 1.2, STONE, scaled(STONE, 1.2));
    }
  }
}
