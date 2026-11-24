/**
 * The town's own track, drawn as real track: the plan's spur (`railSpur.ts`: its polyline in the world with the heights of its bed) with the
 * main line's own cross section (`railGeometry.ts`: its ballast, its ties, its rails at the gauge, the rail's top `RAIL_TOP` over the bed),
 * a turnout where it leaves the main line, and a trestle (the main line's, `trestleOver`) over each stretch that crosses open water.
 *
 * - **The turnout.** The spur's first point is the main line's centre and its bed is the main line's height there, so the two tracks are one at
 *   the start and the spur's curve (an arc of 85 m radius) takes it off: within `TURNOUT_LENGTH` metres the two sets of rails converge, the
 *   ballast of the two is one bed, and a switch stand (a lever on a low post) stands beside the track at the switch's heel. No moving parts.
 * - **The bed.** Its height along the track is the spur's profile (`railSpur.ts`): the main line's height easing to the made ground's. It
 *   sits on the ground the town made level, with a skirt `SPUR_SKIRT` deep so that no daylight shows under it where the ground dips.
 * - **Cells.** The track is cut every `STEP` metres into runs of frames, and a run ends where the town's 128 m cells change, so every
 *   piece of it is in the batch of the place it stands.
 */
import { CELL } from "./townGeometry.js";
import { BALLAST_TOP, BALLAST_TOP_HALF, TIE_PITCH, frameAlong, resample, runLength, type Frame } from "./railConstants.js";
import { railPair, trestleOver } from "./railGeometry.js";
import { dipAt, JOINT, bedGrid, jointBars, spill, tieAt, weedsAt, type Look } from "./trackLook.js";
import { MeshBuilder, scaled, type Rgb } from "./meshBuilder.js";
import { RAIL, TIMBER_WEATHERED } from "./palette.js";
import { spurOf, type SpurTrack } from "../../sim/town/railSpur.js";
import type { Detail, Sink, TownGround } from "./townTypes.js";

/** The cut of the track into frames, metres. */
export const STEP = 4;
/** The turnout's length from the main line, metres, and where the switch stand is along it and beside it. */
export const TURNOUT_LENGTH = 28;
export const SWITCH_AT = 6;
export const SWITCH_BESIDE = 2.4;
/** How deep the spur's ballast skirt goes under its bed, metres. */
export const SPUR_SKIRT = 1.6;

/** The cut of the spur's bed grid at the full tier, metres. */
const BED_STEP_SPUR = 1.6;

/** How far along a run's frames the frame `i` is, metres. */
function runAt(frames: readonly Frame[], i: number): number {
  return runLength(frames.slice(0, i + 1));
}

/** The index of the frame nearest `d` metres along a run. */
function nearest(frames: readonly Frame[], d: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const e = Math.abs(runAt(frames, i) - d);
    if (e < bd) {
      bd = e;
      best = i;
    }
  }
  return best;
}

/** The highest the flat ground lies over the ground at a place (a sidewalk's heave: `walkGeometry.ts`), and how far over it a ballast's top stands, metres. */
const FLAT_TOP = 0.03;
/** The middle of the heights flat ground lies at over the ground. */
const FLAT_MID = 0.02;
const BALLAST_OVER = 0.05;

function onTrestleAt(track: SpurTrack, d: number): boolean {
  for (const r of track.trestles) {
    const a = (track.points[r.from] as { s: number }).s;
    const b = (track.points[r.to] as { s: number }).s;
    if (d >= a && d <= b) return true;
  }
  return false;
}

/** The frames along a track every `STEP` metres, the ends exact; `g` the bed's height there. */
export function spurFrames(track: SpurTrack): { frames: Frame[]; at: number[] } {
  const pts = track.points;
  const total = (pts[pts.length - 1] as { s: number }).s;
  const n = Math.max(1, Math.round(total / STEP));
  const frames: Frame[] = [];
  const at: number[] = [];
  let seg = 1;
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (seg < pts.length - 1 && (pts[seg] as { s: number }).s < d) seg++;
    const a = pts[seg - 1] as { x: number; z: number; s: number; h: number };
    const b = pts[seg] as { x: number; z: number; s: number; h: number };
    const len = b.s - a.s;
    const t = len > 1e-9 ? Math.max(0, Math.min(1, (d - a.s) / len)) : 0;
    const tx = len > 1e-9 ? (b.x - a.x) / len : 0;
    const tz = len > 1e-9 ? (b.z - a.z) / len : 1;
    frames.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, g: a.h + (b.h - a.h) * t, nx: tz, nz: -tx });
    at.push(d);
  }
  return { frames, at };
}

/** Frames of one run, split where the cell changes (each group shares its end frame with the next). */
function byCell(frames: readonly Frame[]): Frame[][] {
  const out: Frame[][] = [];
  let run: Frame[] = [];
  let key = "";
  for (const f of frames) {
    const k = `${Math.floor(f.x / CELL)},${Math.floor(f.z / CELL)}`;
    if (run.length > 0 && k !== key) {
      run.push(f);
      out.push(run);
      run = [];
    }
    key = k;
    run.push(f);
  }
  if (run.length > 1) out.push(run);
  return out;
}

export function spurGeometry(g: TownGround, solid: Sink, detail: Detail): void {
  const track = spurOf(g.seed);
  if (track === null) return;
  const { frames: bed, at } = spurFrames(track);
  // Where the bed lies under the flat ground (a street or a sidewalk crossing it, laid a centimetre or two over the ground), the ballast's top would be
  // a face a few millimetres from theirs: the bed is lifted so that its top stands `BALLAST_OVER` over the highest flat ground there.
  const frames = bed.map((f, i): Frame => {
    if (onTrestleAt(track, at[i] as number)) return f;
    let need = f.g;
    for (const side of [-BALLAST_TOP_HALF, 0, BALLAST_TOP_HALF]) {
      const ground = g.heightAt(f.x + f.nx * side, f.z + f.nz * side);
      // Flat ground that lies within a few centimetres of the ballast's top is a face against it; ground that is far under it or far over it is not.
      if (Math.abs(ground + FLAT_MID - (f.g + BALLAST_TOP)) < BALLAST_OVER) need = Math.max(need, ground + FLAT_TOP + BALLAST_OVER - BALLAST_TOP);
    }
    return need > f.g ? { ...f, g: need } : f;
  });
  // Which frames are on a trestle (the stretch and a little beyond each end, as the main line's trestle is drawn).
  const onTrestle = (d: number): boolean => {
    for (const r of track.trestles) {
      const a = (track.points[r.from] as { s: number }).s;
      const b = (track.points[r.to] as { s: number }).s;
      if (d >= a && d <= b) return true;
    }
    return false;
  };
  const land: Frame[][] = [];
  const wet: Frame[][] = [];
  let run: Frame[] = [];
  let isWet = false;
  for (let i = 0; i < frames.length; i++) {
    const w = onTrestle(at[i] as number);
    if (i > 0 && w !== isWet) {
      // The change's frame ends one run and begins the next.
      run.push(frames[i] as Frame);
      (isWet ? wet : land).push(run);
      run = [];
    }
    isWet = w;
    run.push(frames[i] as Frame);
  }
  if (run.length > 1) (isWet ? wet : land).push(run);

  const look: Look = { seed: g.seed, spur: true };
  const low = detail === "low";
  for (const r of land) {
    for (const part of byCell(r)) {
      if (part.length < 2) continue;
      const mid = frameAlong(part, runLength(part) / 2);
      const b = solid(mid.x, mid.z);
      // The bed, one crowned grid: displaced at the full tier, coarse (the same outline and tone) at the low.
      const dense = resample(part, low ? STEP : BED_STEP_SPUR);
      bedGrid(b, dense, look, low ? 1 : 0, SPUR_SKIRT);
      // The rails: jointed every `JOINT` m, a few millimetres low at some joints, with fish plates at the full tier.
      const railFrames = part;
      const start = Math.round((mid.x + mid.z) * 3);
      const dips = railFrames.map((_, i) => dipAt(look, runAt(railFrames, i), start));
      railPair(b, railFrames, look, low ? 1 : 0, (i) => dips[i] as number);
      if (low) continue;
      const len = runLength(part);
      const bars = Math.floor(len / JOINT);
      for (let k = 0; k <= bars; k++) {
        const d = Math.round((k * JOINT + (start % 5)) * 10) / 10;
        if (d > len - 0.4 || d < 0.4) continue;
        const f = frameAlong(part, d);
        const g = frameAlong(part, Math.min(len, d + 0.5));
        const h = frameAlong(part, Math.max(0, d - 0.5));
        jointBars(b, f, [g.x - h.x, 0, g.z - h.z], dipAt(look, runAt(railFrames, nearest(railFrames, d)), start));
      }
      const n = Math.floor(len / TIE_PITCH);
      for (let j = 0; j < n; j++) {
        const f = frameAlong(part, (j + 0.5) * TIE_PITCH);
        tieAt(b, look, f, true);
        weedsAt(b, look, f, j, true);
        if (j % 8 === 0) spill(b, look, f, j, g.heightAt);
      }
    }
  }
  for (const r of wet) {
    byCell(r).forEach((part, at) => {
      if (part.length < 2) return;
      const mid = frameAlong(part, runLength(part) / 2);
      const b = solid(mid.x, mid.z);
      railPair(b, part, look, low ? 1 : 0);
      // A part's first frame is the last of the one before: its bent is drawn once.
      trestleOver(g.heightAt, b, part, low ? 1 : 0, at === 0 ? 0 : 1, look);
    });
  }
  turnout(frames, solid);
}

/** The switch stand at the turnout's heel: a low post with a lever and a target, beside the track on the side away from the spur's curve. */
function turnout(frames: readonly Frame[], solid: Sink): void {
  const f = frameAlong(frames, SWITCH_AT);
  const aim = frameAlong(frames, TURNOUT_LENGTH);
  // The side the spur curves toward: the stand is on the other.
  const toward = (aim.x - f.x) * f.nx + (aim.z - f.z) * f.nz;
  const side = toward > 0 ? -1 : 1;
  const x = f.x + f.nx * side * SWITCH_BESIDE;
  const z = f.z + f.nz * side * SWITCH_BESIDE;
  const b: MeshBuilder = solid(x, z);
  const post: Rgb = TIMBER_WEATHERED;
  b.box(x, z, f.g, 1, 0, 0.1, 0.1, 0.9, post, post);
  b.box(x, z, f.g + 0.9, f.nx, f.nz, 0.28, 0.02, 0.28, scaled(post, 1.6), scaled(post, 1.6));
  b.box(x, z, f.g + 0.2, f.nx, f.nz, 0.34, 0.03, 0.05, RAIL, RAIL);
}
