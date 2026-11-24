/** The railroad's cross section and frames, shared by the main line (`railGeometry.ts`), the spur (`spurGeometry.ts`) and the look of the track (`trackLook.ts`). */
import type { Vec3 } from "./meshBuilder.js";

/** Heights over the bench, metres: the ballast's top, a tie's bottom and top, the rails' foot and top. */
export const BALLAST_TOP = 0.16;
export const TIE_BOTTOM = 0.08;
export const TIE_TOP = 0.24;
export const RAIL_FOOT = 0.235;
export const RAIL_TOP = 0.36;
/** The ballast's top half width and its half width at the bench, metres (`RAIL_BED_HALF` is the toe). */
export const BALLAST_TOP_HALF = 1.55;
export const BALLAST_SKIRT = 0.8;
/** A tie: its half length across the track and its half width along it, and the distance between them, metres. */
export const TIE_HALF_LENGTH = 1.3;
export const TIE_HALF_WIDTH = 0.11;
export const TIE_PITCH = 0.55;
export type Frame = { x: number; z: number; g: number; nx: number; nz: number };

export function pointOf(f: Frame, off: number, dy: number): Vec3 {
  return [f.x + f.nx * off, f.g + dy, f.z + f.nz * off];
}

/** A cross-section: points as (offset across, height over the bench), in clockwise order seen from along +z with +x to the right. */
export type Profile = readonly (readonly [number, number])[];


/** The frame `d` metres along a run of frames (by the distance between them), interpolated. */
export function frameAlong(frames: readonly Frame[], d: number): Frame {
  let at = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as Frame;
    const b = frames[i] as Frame;
    const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    if (d <= at + len || i === frames.length - 1) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, (d - at) / len)) : 0;
      const nx = a.nx + (b.nx - a.nx) * t;
      const nz = a.nz + (b.nz - a.nz) * t;
      const nl = Math.sqrt(nx * nx + nz * nz);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, g: a.g + (b.g - a.g) * t, nx: nx / nl, nz: nz / nl };
    }
    at += len;
  }
  return frames[frames.length - 1] as Frame;
}

/** The length of a run of frames. */
export function runLength(frames: readonly Frame[]): number {
  let at = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as Frame;
    const b = frames[i] as Frame;
    at += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  }
  return at;
}


/** A run of frames cut every `step` metres or less along its length, the ends kept. */
export function resample(frames: readonly Frame[], step: number): Frame[] {
  const len = runLength(frames);
  const n = Math.max(1, Math.ceil(len / step - 1e-9));
  const out: Frame[] = [];
  for (let i = 0; i <= n; i++) out.push(i === 0 ? (frames[0] as Frame) : i === n ? (frames[frames.length - 1] as Frame) : frameAlong(frames, (len * i) / n));
  return out;
}
