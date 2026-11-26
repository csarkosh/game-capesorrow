/**
 * What hangs behind the glass of a window, built as real parts: blinds of separate slats with gaps the room shows through (part raised,
 * one end sagging, a bent slat here and there), vertical blinds of louvres turned at different angles, curtains in folds, the butcher
 * paper on a vacant unit's glass (sheets with seams, tape, a torn corner, faded at the top, a gap that shows the empty room), a sheet of
 * plywood or cardboard in a broken pane, and a window air-conditioner. Pure geometry into a `MeshBuilder`, on a wall's frame (`WallRef`).
 *
 * Every layer lies at its own depth: a part behind the glass is at least 2.5 cm behind the one in front of it, and the parts of one
 * layer do not overlap (slats leave a gap, sheets leave a seam), so that no two faces share a plane for the depth buffer to confuse.
 *
 * What the plan causes: which window has which treatment and whether the room behind is lit; what is authored: the colours, the slat
 * pitch, the share of blinds that sag or bend, how paper hangs.
 */
import { withMat } from "./materials.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { wat, type WallRef } from "./buildingKit.js";
import { standOff } from "./faceLedger.js";
import type { Detail } from "./townTypes.js";

/** The steps of depth, metres: a layer is this far behind the next in front of it (the depth buffer holds 2 cm apart at 60 m). */
export const STEP = 0.025;

const SLAT_COLOURS: readonly Rgb[] = [[0.8, 0.77, 0.68], [0.86, 0.86, 0.83], [0.58, 0.48, 0.34], [0.7, 0.7, 0.72], [0.3, 0.3, 0.32]];
const PAPER: readonly Rgb[] = [[0.78, 0.66, 0.46], [0.84, 0.8, 0.7], [0.72, 0.6, 0.4]];
/** How much a sheet of paper in a vacant unit's glass glows by day, as daylight falls on it (it has no light behind it: at night the material takes this away, `townMaterial.ts` `DAY_GLOW_CODE`, and a vacant shop is dark). */
const PAPER_GLOW = 0.2;

export type Behind = { readonly out: MeshBuilder; readonly w: WallRef; readonly detail: Detail; readonly seed: number; /** The glass's own offset; things behind it are at `glass - STEP * k`. */ readonly glass: number; readonly lit: boolean; /** A home's window: the glow its covering has when its light is on (its night code, `windowNight.ts`, says when), in the place of the room's. */ readonly glow?: number };

const at = (b: Behind, k: number): number => b.glass - STEP * k;

/** Slat blinds from `sa` to `sb` hanging from `top`, down `drop` metres. */
export function slatBlinds(b: Behind, sa: number, sb: number, top: number, drop: number, col: Rgb): void {
  withMat("cloth", () => {
    const { out, w, seed } = b;
    const full = b.detail === "full";
    const off = at(b, 1.5);
    const glow = b.glow ?? (b.lit ? 0.5 : 0.1);
    const warm: Rgb = b.lit ? [col[0] * 1.08, col[1] * 1.0, col[2] * 0.88] : col;
    // The head rail and the stack of raised slats, a box at the top.
    const stack = 0.05 + (full ? hash01(seed, 600) * 0.05 : 0.04);
    const topOff = at(b, 1.5);
    if (full) out.poly([wat(w, sa, top - stack, topOff), wat(w, sb, top - stack, topOff), wat(w, sb, top, topOff), wat(w, sa, top, topOff)], [w.nx, 0, w.nz], scaled(warm, 0.7), undefined, { glow });
    const y0 = top - stack;
    const hang = Math.max(0.05, drop - stack);
    if (!full) {
      // The low tier: one band, the head rail and the slats as a single face (the stack above it is left out).
      out.poly([wat(w, sa, top - drop, off), wat(w, sb, top - drop, off), wat(w, sb, top, off), wat(w, sa, top, off)], [w.nx, 0, w.nz], scaled(warm, 0.9), undefined, { glow });
      return;
    }
    const pitch = Math.max(0.05, hang / 20);
    const n = Math.max(2, Math.floor(hang / pitch));
    // One end hangs lower than the other, more toward the bottom (a cord that has slipped).
    const sag = hash01(seed, 601) < 0.45 ? (0.03 + hash01(seed, 602) * 0.1) * (hash01(seed, 603) < 0.5 ? 1 : -1) : 0;
    const bl0 = sag > 0 ? -Math.abs(sag) : 0;
    const br0 = sag > 0 ? 0 : -Math.abs(sag);
    // The slats are one face, striped in the fragment stage (`townSurfaceCode`: slat and gap by the height in the world, the stripes' pitch riding in the vertex's
    // spare float, in millimetres): the gaps are cut out near and the stripes are averaged by the pixel's own footprint beyond, so a blind a pixel cannot resolve is one even panel, never a flicker.
    const tone = scaled(warm, 0.9);
    const ybot = y0 - n * pitch;
    // Behind the glass and clear of every face the wall's own builders have noted (`faceLedger.ts`): a transom bar or a frame's face is never within 2.45 cm of it.
    const lowest = ybot + Math.min(bl0, br0);
    const oa = wat(w, sa, 0, off);
    const ob = wat(w, sb, 0, off);
    const face = off - standOff(w.nx, w.nz, oa[0], oa[2], ob[0], ob[2], lowest, y0, -1);
    out.poly([wat(w, sa, ybot + bl0, face), wat(w, sb, ybot + br0, face), wat(w, sb, y0, face), wat(w, sa, y0, face)], [w.nx, 0, w.nz], tone, undefined, { glow, tilt: [Math.round(pitch * 1000), 0] });
    // The pull cord and the bottom rail.
    const bottom = y0 - n * pitch;
    const bl = sag > 0 ? -Math.abs(sag) : 0;
    const br = sag > 0 ? 0 : -Math.abs(sag);
    out.poly([wat(w, sa, bottom + bl - 0.03, off), wat(w, sb, bottom + br - 0.03, off), wat(w, sb, bottom + br, off), wat(w, sa, bottom + bl, off)], [w.nx, 0, w.nz], scaled(warm, 0.62), undefined, { glow });
  });
}

/** Vertical blinds: louvres hung from a track, turned at their own angles, a gap now and then. */
export function verticalBlinds(b: Behind, sa: number, sb: number, top: number, bottom: number, col: Rgb): void {
  withMat("cloth", () => {
    const { out, w, seed } = b;
    const off = at(b, 2.5);
    const glow = b.glow ?? (b.lit ? 0.5 : 0.1);
    const wid = sb - sa;
    if (b.detail !== "full") {
      // The low tier: one pale panel for the whole set.
      out.poly([wat(w, sa, bottom, off), wat(w, sb, bottom, off), wat(w, sb, top, off), wat(w, sa, top, off)], [w.nx, 0, w.nz], scaled(col, 0.9), undefined, { glow });
      return;
    }
    const n = Math.max(3, Math.min(26, Math.round(wid / 0.1)));
    const open = hash01(seed, 610) < 0.5;
    const pitch = wid / n;
    // The louvres are drawn with their faces turned about the vertical: an open set is all at one angle, a shut one overlaps in a shingle.
    const angle = open ? 0.55 + hash01(seed, 611) * 0.3 : 0.12;
    // A shut set's louvres are a little narrower than their pitch, so that two that hang at nearly one angle are side by side and not one over the other.
    const half = pitch * (open ? 0.5 : 0.46);
    for (let k = 0; k < n; k++) {
      if (hash01(seed + k, 612) < 0.04) continue;
      const c = sa + pitch * (k + 0.5);
      const a = angle + (hash01(seed + k, 613) - 0.5) * 0.2;
      const ds = Math.cos(a) * half;
      const dn = Math.sin(a) * half;
      const hang = hash01(seed + k, 614) < 0.06 ? 0.25 : 0;
      const tone = scaled(col, 0.85 + 0.2 * hash01(seed + k, 615));
      out.poly([wat(w, c - ds, bottom + hang, off + dn), wat(w, c + ds, bottom + hang, off - dn), wat(w, c + ds, top - 0.04, off - dn), wat(w, c - ds, top - 0.04, off + dn)], [w.nx, 0, w.nz], tone, undefined, { glow });
    }
    out.poly([wat(w, sa, top - 0.04, at(b, 1.5)), wat(w, sb, top - 0.04, at(b, 1.5)), wat(w, sb, top, at(b, 1.5)), wat(w, sa, top, at(b, 1.5))], [w.nx, 0, w.nz], scaled(col, 0.6), undefined, { glow });
  });
}

/** A curtain: a panel from `sa` to `sb`, down from `top` to `bottom`, in vertical strips (folds) of two tones, the strips at slightly different depths. */
export function curtainFolds(b: Behind, sa: number, sb: number, top: number, bottom: number, col: Rgb, style: number, glow: number, layer = 2): void {
  withMat("cloth", () => {
    const { out, w } = b;
    const n = style === 0 ? 1 : Math.max(2, Math.min(5, Math.round((sb - sa) / 0.14)));
    for (let i = 0; i < n; i++) {
      const a = sa + ((sb - sa) * i) / n;
      const c = sa + ((sb - sa) * (i + 1)) / n;
      const k = style === 0 ? 1 : style === 1 ? (i % 2 === 0 ? 0.75 : 1.08) : i % 4 < 2 ? 0.8 : 1.15;
      // The strips are side by side in one plane (each its own span, two tones): none stands out of it, so none is within 2 cm of what lies over or under it.
      const o = at(b, layer);
      out.poly([wat(w, a, bottom, o), wat(w, c, bottom, o), wat(w, c, top, o), wat(w, a, top, o)], [w.nx, 0, w.nz], scaled(col, k), undefined, { glow });
    }
  });
}

/**
 * The butcher paper taped over a vacant unit's glass: sheets hung from the top, seams between them with the empty room showing, tape at
 * the seams, a corner torn from one sheet, the whole faded toward the top; sheets that stop short of the bottom with a ragged edge.
 */
export function paperSheets(b: Behind, sa: number, sb: number, y0: number, y1: number, age: number): void {
  withMat("cloth", () => {
    const { out, w, seed } = b;
    const full = b.detail === "full";
    const off = at(b, 3);
    const tape = at(b, 2);
    const base = PAPER[Math.floor(hash01(seed, 620) * PAPER.length) % PAPER.length] as Rgb;
    const wid = sb - sa;
    const n = Math.max(1, Math.round(wid / 0.95));
    const seam = 0.05;
    const fade = Math.min(1, 0.4 + age * 0.5);
    const tone = (c: Rgb, y: number): Rgb => {
      // Sun fades the top most (toward bleached yellow-white), the foot keeps its colour and its dirt.
      const t = (y - y0) / (y1 - y0);
      const k = 0.78 + 0.3 * t * fade;
      return [Math.min(1, c[0] * k + 0.05 * t * fade), Math.min(1, c[1] * k + 0.05 * t * fade), Math.min(1, c[2] * k + 0.02 * t)];
    };
    for (let i = 0; i < n; i++) {
      const a = sa + (wid * i) / n + (i === 0 ? 0.02 : seam / 2);
      const c = sa + (wid * (i + 1)) / n - (i === n - 1 ? 0.02 : seam / 2);
      // Where this sheet stops: most reach the sill, some stop a hand or more short, and a ragged edge is drawn.
      const short = hash01(seed + i, 621) < 0.35 ? 0.15 + hash01(seed + i, 622) * 0.4 : 0.02;
      const bottom = y0 + short;
      const topY = y1 - 0.02 - (i === 0 && hash01(seed, 623) < 0.3 ? 0.12 : 0);
      const col = scaled(base, 0.94 + 0.12 * hash01(seed + i * 3, 624));
      const torn = hash01(seed + i, 625) < 0.28;
      const cutS = 0.22 + hash01(seed + i, 626) * 0.2;
      const cutY = 0.25 + hash01(seed + i, 627) * 0.3;
      const right = hash01(seed + i, 628) < 0.5;
      const paint = (pts: Vec3[]): void => {
        out.poly(pts, [w.nx, 0, w.nz], pts.map((p) => tone(col, p[1])), undefined, { glow: PAPER_GLOW });
      };
      if (short > 0.05 && full) {
        // A ragged bottom edge: a strip of quads, each its own height (a convex piece apiece, none over another).
        const steps = Math.max(2, Math.round((c - a) / 0.2));
        const edge: number[] = [];
        for (let k = 0; k <= steps; k++) edge.push(bottom + (k === 0 || k === steps ? 0 : (hash01(seed + i * 9 + k, 629) - 0.3) * 0.12));
        for (let k = 0; k < steps; k++) {
          const x0 = a + ((c - a) * k) / steps;
          const x1 = a + ((c - a) * (k + 1)) / steps;
          const y0b = edge[k] as number;
          const y1b = edge[k + 1] as number;
          const lift = (x: number): number => (torn && right && x > c - cutS ? topY - cutY : torn && !right && x < a + cutS ? topY - cutY : bottom);
          void lift;
          paint([wat(w, x0, y0b, off), wat(w, x1, y1b, off), wat(w, x1, topY - (torn && right && k === steps - 1 ? cutY : 0), off), wat(w, x0, topY - (torn && !right && k === 0 ? cutY : 0), off)]);
        }
      } else if (torn && right) {
        paint([wat(w, a, bottom, off), wat(w, c, bottom, off), wat(w, c, topY - cutY, off), wat(w, c - cutS, topY, off), wat(w, a, topY, off)]);
      } else if (torn) {
        paint([wat(w, a, bottom, off), wat(w, c, bottom, off), wat(w, c, topY, off), wat(w, a + cutS, topY, off), wat(w, a, topY - cutY, off)]);
      } else {
        paint([wat(w, a, bottom, off), wat(w, c, bottom, off), wat(w, c, topY, off), wat(w, a, topY, off)]);
      }
      if (!full) continue;
      // Tape: a short strip at the top corners of the sheet, and at the seam's middle.
      for (const s of [a + 0.06, c - 0.06]) {
        if (torn && ((right && s > c - 0.1) || (!right && s < a + 0.1))) continue;
        out.poly([wat(w, s - 0.04, topY - 0.07, tape), wat(w, s + 0.04, topY - 0.07, tape), wat(w, s + 0.04, topY + 0.01, tape), wat(w, s - 0.04, topY + 0.01, tape)], [w.nx, 0, w.nz], [0.75, 0.72, 0.58], undefined, { glow: PAPER_GLOW });
      }
    }
  });
}

/** A sheet of plywood or cardboard over a broken pane's half: `sa` to `sb`, `y0` to `y1`, at the glass's depth behind the pane. */
export function patch(b: Behind, sa: number, sb: number, y0: number, y1: number, cardboard: boolean): void {
  withMat("ply", () => {
    const col: Rgb = cardboard ? [0.55, 0.42, 0.28] : [0.42, 0.31, 0.18];
    b.out.poly([wat(b.w, sa, y0, at(b, 4)), wat(b.w, sb, y0, at(b, 4)), wat(b.w, sb, y1, at(b, 4)), wat(b.w, sa, y1, at(b, 4))], [b.w.nx, 0, b.w.nz], [scaled(col, 0.85), scaled(col, 0.85), col, col], undefined, { glow: 0.15 });
    // A strip of tape across its top.
    b.out.poly([wat(b.w, sa, y1 - 0.06, at(b, 3)), wat(b.w, sb, y1 - 0.06, at(b, 3)), wat(b.w, sb, y1 - 0.02, at(b, 3)), wat(b.w, sa, y1 - 0.02, at(b, 3))], [b.w.nx, 0, b.w.nz], [0.7, 0.68, 0.55], undefined, { glow: 0.2 });
  });
}

export const slatColour = (seed: number): Rgb => SLAT_COLOURS[Math.floor(hash01(seed, 630) * SLAT_COLOURS.length) % SLAT_COLOURS.length] as Rgb;
