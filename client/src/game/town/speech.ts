/**
 * What the people are saying, as the frame shows it: each line's place on the screen, worked out by the renderer's part from where the speaker's
 * head is (`townParts.ts`), and read by the session's half, which has the HUD (`game/car/side.ts`). The two do not meet otherwise, so the frame's
 * lines are left here, as the line at a car's door is.
 */
import type { CameraAxes } from "@csarkosh/engine/game/lite/cameraPose";
import type { Said } from "./peopleReact.js";

/** A line on the screen: across and down as shares of the view (0 to 1), the words, how much of it shows (0 to 1), and how far off its speaker is (m). */
export type Caption = { x: number; y: number; text: string; alpha: number; depth: number; mean: boolean };

/** How far off a line is still shown (m), the distance from which it begins to fade (m), and how long a line takes to come and to go (s). */
export const HEAR_FAR = 26, HEAR_FADE = 18, SAY_EASE = 0.25;

let shown: readonly Caption[] = [];

/** The lines the last frame showed. */
export function captionsShown(): readonly Caption[] {
  return shown;
}

/** Sets the lines the frame shows. */
export function showCaptions(list: readonly Caption[]): void {
  shown = list;
}

/**
 * The lines said, as captions on a view from (`ex`, `ey`, `ez`) along `axes` through a lens of vertical field of view `fov` (radians) and an
 * `aspect` of width over height: each over its speaker's head, the ones behind the eye, off the screen or too far left out, fading in and out
 * and with distance. Fills and returns `out`.
 */
export function captionsOf(said: readonly Said[], ex: number, ey: number, ez: number, axes: CameraAxes, fov: number, aspect: number, out: Caption[]): Caption[] {
  out.length = 0;
  const half = Math.tan(fov / 2);
  if (!(half > 0) || !(aspect > 0)) return out;
  for (const s of said) {
    const dx = s.x - ex;
    const dy = s.y - ey;
    const dz = s.z - ez;
    const ahead = dx * axes.fx + dy * axes.fy + dz * axes.fz;
    if (!(ahead > 0.3)) continue;
    const depth = Math.hypot(dx, dy, dz);
    if (!(depth < HEAR_FAR)) continue;
    const x = (dx * axes.rx + dy * axes.ry + dz * axes.rz) / (ahead * half * aspect) * 0.5 + 0.5;
    const y = 0.5 - (dx * axes.ux + dy * axes.uy + dz * axes.uz) / (ahead * half) * 0.5;
    if (!(x > 0.03 && x < 0.97 && y > 0.04 && y < 0.92)) continue;
    const ease = Math.min(1, s.age / SAY_EASE, (s.life - s.age) / SAY_EASE);
    const far = depth <= HEAR_FADE ? 1 : 1 - (depth - HEAR_FADE) / (HEAR_FAR - HEAR_FADE);
    const alpha = Math.max(0, ease) * far;
    if (!(alpha > 0.02)) continue;
    out.push({ x, y, text: s.text, alpha, depth, mean: s.kind === "mean" || s.kind === "bumped" });
  }
  return out;
}
