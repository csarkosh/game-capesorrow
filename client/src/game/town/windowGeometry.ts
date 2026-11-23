/**
 * A window as a thing with a depth, never a dark rectangle: a hole through the wall with a reveal, the frame and trim of its age (painted
 * wood with trim boards and a sill, or the white vinyl of a replacement), a pane of glass in the blended layer that reflects the sky and
 * shows what is behind it, and behind that a shallow box (a floor, a ceiling, two sides and a back, one metre deep) that lights itself by
 * what the plan says about the window (`WindowTreatment`): curtains drawn (a few colours, plain, in folds or in stripes), blinds part way
 * down, a lit room glimpsed through, a dark room with a curtain half drawn and the sky on the glass, boards over it, or the glass gone
 * with shards left in the frame. A plant or a lamp stands on the sill where the plan puts one.
 *
 * What is authored: the sizes, the colour tables, the depth of the box, the share of curtained windows with the room lit behind. What
 * the plan causes: the treatment, the sill, and, from the household's habit (`windows.ts`), which windows match. A window is
 * replaced (white vinyl, a different pane) with a chance that grows with the building's age; the cause is the owner's remodel of a
 * decade in the owner's own lifetime, drawn from the building's id and the window's.
 */
import { hash01, scaled, type MeshBuilder, type Rgb } from "./meshBuilder.js";
import { TRIM_WHITE, pane, pickOf, reveal, wat, wquad, type WallRef } from "./buildingKit.js";
import type { WindowCover, WindowTreatment } from "../../sim/town/types.js";
import type { Surface } from "./townSurface.js";
import { sillStreak } from "./buildingWear.js";
import type { Detail, FillReport } from "./townTypes.js";

/** The wall's surface (its texture frame, wear), for a part laid in the same material as the wall. */
export type SurfaceMaker = (w: WallRef) => Surface;

export type WinCtx = { report?: FillReport; out: MeshBuilder; glass: MeshBuilder; detail: Detail; id: number; era: number; surface: SurfaceMaker; trim: Rgb; wall: Rgb };

const CURTAINS: readonly Rgb[] = [
  [0.7, 0.66, 0.55], [0.55, 0.2, 0.18], [0.25, 0.35, 0.5], [0.78, 0.78, 0.74], [0.3, 0.42, 0.3], [0.5, 0.4, 0.55], [0.85, 0.7, 0.35], [0.35, 0.3, 0.27],
];
const ROOM_WARM: Rgb = [0.95, 0.78, 0.48];
const ROOM_DIM: Rgb = [0.2, 0.22, 0.26];
const PLYWOOD: Rgb = [0.42, 0.31, 0.18];

/** The window's frame colour from the building's age (painted wood of the time, or aluminium after 1960); `replaced` is white vinyl. */
export function frameColour(id: number, era: number, replaced: boolean): Rgb {
  if (replaced) return TRIM_WHITE;
  if (era < 1960) return pickOf([[0.62, 0.6, 0.54], [0.1, 0.2, 0.14], [0.14, 0.1, 0.08], [0.55, 0.5, 0.4]] as readonly Rgb[], id, 400);
  return pickOf([[0.4, 0.42, 0.44], [0.18, 0.14, 0.11], [0.62, 0.62, 0.6]] as readonly Rgb[], id, 401);
}

/** A window's room: a shallow box behind the glass in `colour`, lighting itself by `glow`. */
function shallowBox(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, depth: number, colour: Rgb, glow: number, full: boolean): void {
  const fx = { glow };
  const back = wat(w, 0, 0, 0);
  void back;
  out.poly([wat(w, sa, y0, -depth), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [w.nx, 0, w.nz], colour, undefined, fx);
  if (!full) return;
  out.poly([wat(w, sa, y1, -0.1), wat(w, sb, y1, -0.1), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [0, -1, 0], scaled(colour, 0.9), undefined, fx);
  out.poly([wat(w, sa, y0, -0.1), wat(w, sa, y0, -depth), wat(w, sa, y1, -depth), wat(w, sa, y1, -0.1)], [w.tx, 0, w.tz], scaled(colour, 0.75), undefined, fx);
  out.poly([wat(w, sb, y0, -0.1), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sb, y1, -0.1)], [-w.tx, 0, -w.tz], scaled(colour, 0.75), undefined, fx);
}

/** A curtain: a panel from `sa` to `sb` down from `top` to `bottom`, in vertical strips of two tones (folds) or bands (stripes). */
function curtain(out: MeshBuilder, w: WallRef, sa: number, sb: number, top: number, bottom: number, off: number, col: Rgb, style: number, glow: number): void {
  const n = style === 0 ? 1 : Math.max(2, Math.min(5, Math.round((sb - sa) / 0.14)));
  for (let i = 0; i < n; i++) {
    const a = sa + ((sb - sa) * i) / n;
    const b = sa + ((sb - sa) * (i + 1)) / n;
    const k = style === 0 ? 1 : style === 1 ? (i % 2 === 0 ? 0.75 : 1.08) : i % 4 < 2 ? 0.8 : 1.15;
    const o = off - (style === 1 && i % 2 === 0 ? 0.02 : 0);
    out.poly([wat(w, a, bottom, o), wat(w, b, bottom, o), wat(w, b, top, o), wat(w, a, top, o)], [w.nx, 0, w.nz], scaled(col, k), undefined, { glow });
  }
}

function blinds(out: MeshBuilder, w: WallRef, sa: number, sb: number, top: number, drop: number, off: number, col: Rgb, glow: number, detail: Detail): void {
  const bottom = top - drop;
  const n = detail === "low" ? 1 : Math.max(2, Math.min(5, Math.round(drop / 0.22)));
  for (let i = 0; i < n; i++) {
    const a = top - (drop * i) / n;
    const b = top - (drop * (i + 1)) / n;
    out.poly([wat(w, sa, b, off), wat(w, sb, b, off), wat(w, sb, a, off), wat(w, sa, a, off)], [w.nx, 0, w.nz], scaled(col, i % 2 === 0 ? 1 : 0.84), undefined, { glow });
  }
  out.poly([wat(w, sa, bottom - 0.02, off), wat(w, sb, bottom - 0.02, off), wat(w, sb, bottom, off), wat(w, sa, bottom, off)], [w.nx, 0, w.nz], scaled(col, 0.6), undefined, { glow });
}

/**
 * One window: the hole from station `sa` to `sb` and from `y0` to `y1` has already been left in the wall. `state` and `sill` are the plan's. `replaced`
 * says an owner put a vinyl window here. `cover` is a shop window's covering when this is a shop's (the plan's `WindowCover`), "none" otherwise.
 */
export function drawWindow(c: WinCtx, w: WallRef, sa: number, sb: number, y0: number, y1: number, state: WindowTreatment, sill: "none" | "plant" | "lamp", salt: number, replaced: boolean, cover: WindowCover = "none", shop = false): void {
  const { out, glass, detail } = c;
  const full = detail === "full";
  const seed = c.id * 17 + salt;
  const fr = frameColour(c.id, c.era, replaced);
  const width = sb - sa;
  const height = y1 - y0;
  const rv = full ? 0.16 : 0.08;
  if (c.report !== undefined) c.report.windows.push({ pane: state !== "boarded" && cover !== "boarded", behind: state === "boarded" || cover === "boarded" ? "cover" : shop ? "room" : "box" });
  if (state === "boarded" || cover === "boarded") {
    // Plywood over the hole, in sheets, each its own shade.
    const n = Math.max(1, Math.round(width / 1.2));
    for (let i = 0; i < n; i++) {
      const shade = 0.82 + hash01(seed + i, 402) * 0.3;
      const a = sa + (width * i) / n + 0.01;
      const b = sa + (width * (i + 1)) / n - 0.01;
      wquad(out, w, a, y0, b, y1, 0.02, scaled(PLYWOOD, shade), { layer: "plywood", frame: c.surface(w).frame, tint: [shade, shade, shade], wear: 0.18, wearKind: "peel" });
    }
    return;
  }
  reveal(out, w, sa, sb, y0, y1, rv, scaled(c.wall, 0.8), scaled(c.trim, 0.9));
  // Under the sill the rain that runs off it leaves a streak of dirt down the wall (its own decal, in the wall's material); more on an older wall.
  if (full && hash01(seed, 423) < 0.35 + 0.5 * Math.min(1, (2026 - c.era) / 120)) {
    const base = c.surface(w);
    const cw = Math.min(width * (0.5 + hash01(seed, 424) * 0.5), width);
    const mid = (sa + sb) / 2 + (hash01(seed, 425) - 0.5) * width * 0.25;
    wquad(out, w, mid - cw / 2, y0 - 1.3, mid + cw / 2, y0, 0.012, c.wall, sillStreak(base, 0.7, y0, 1.3));
  }
  if (full) {
    // Trim boards round it, the sill under it (a replaced window has none: it was fitted in the old opening).
    if (!replaced) {
      const bar = 0.08;
      wquad(out, w, sa - bar, y1, sb + bar, y1 + bar, 0.025, c.trim);
      wquad(out, w, sa - bar, y0, sa, y1, 0.025, c.trim);
      wquad(out, w, sb, y0, sb + bar, y1, 0.025, c.trim);
      wquad(out, w, sa - 0.1, y0 - 0.07, sb + 0.1, y0, 0.07, c.trim);
      out.poly([wat(w, sa - 0.1, y0, 0), wat(w, sb + 0.1, y0, 0), wat(w, sb + 0.1, y0, 0.07), wat(w, sa - 0.1, y0, 0.07)], [0, 1, 0], c.trim);
    } else {
      wquad(out, w, sa - 0.03, y1, sb + 0.03, y1 + 0.03, 0.01, fr);
      wquad(out, w, sa - 0.03, y0 - 0.03, sb + 0.03, y0, 0.01, fr);
    }
  }
  if (state === "broken") {
    // No glass: a few shards stand in the corners of the frame, and a torn curtain hangs inside. The room is dark.
    shallowBox(out, w, sa, sb, y0, y1, 0.9, ROOM_DIM, 0.1, full);
    for (const [s, y, sg] of [[sa, y1, 1], [sb, y0, -1], [sa, y0, 1]] as const) {
      const k = 0.18 + hash01(seed + sg + y, 403) * 0.25;
      glass.poly([wat(w, s, y, -0.07), wat(w, s + sg * k, y, -0.07), wat(w, s, y + (y === y1 ? -k * 1.6 : k * 1.6), -0.07)], [w.nx, 0, w.nz], [0.5, 0.56, 0.6], undefined, { clear: 0.6 });
    }
    curtain(out, w, sa + 0.05, sa + Math.min(0.35, width * 0.4), y1 - 0.05, y1 - height * 0.6, -0.14, pickOf(CURTAINS, seed, 404), 1, 0.2);
    return;
  }
  // The room behind it: lit, dim; a curtained window sometimes has a lit room behind its curtains.
  const roomLit = state === "lit" || (state === "curtained" && hash01(seed, 405) < 0.22) || (state === "blinds" && hash01(seed, 406) < 0.2);
  const roomColour = roomLit ? ROOM_WARM : state === "dark" ? ROOM_DIM : [0.4, 0.36, 0.32] as Rgb;
  if (!shop) shallowBox(out, w, sa, sb, y0, y1, 0.9, roomColour, roomLit ? 1.1 : state === "dark" ? 0.14 : 0.3, full);
  if (cover === "papered") {
    // The last tenant's butcher paper, taped up, a corner coming down.
    const paper: Rgb = [0.78, 0.74, 0.62];
    wquad(out, w, sa, y0, sb, y1, -rv * 0.5, paper, undefined, { glow: 0.5 });
    out.poly([wat(w, sb - 0.35, y1, -rv * 0.4), wat(w, sb, y1, -rv * 0.4), wat(w, sb, y1 - 0.45, -rv * 0.4)], [w.nx, 0, w.nz], scaled(paper, 0.88), undefined, { glow: 0.5 });
  }
  // The panes: a double-hung window has its meeting rail; a replacement is one pane with a thin bar.
  pane(glass, w, sa, y0, sb, y1, -rv * 0.45);
  if (full) {
    const mid = y0 + height * (replaced ? 0.5 : 0.52);
    wquad(out, w, sa, mid - 0.03, sb, mid + 0.03, -rv * 0.4, fr);
    if (!replaced && width > 0.7) wquad(out, w, (sa + sb) / 2 - 0.02, y0, (sa + sb) / 2 + 0.02, y1, -rv * 0.4, fr);
  }
  // Curtains, blinds or what the plan says is in it.
  const glowC = roomLit ? 0.9 : 0.35;
  if (shop) {
    // A shop shows the unit's own room behind its glass.
  } else if (state === "curtained") {
    const col = pickOf(CURTAINS, seed, 407);
    const style = Math.floor(hash01(seed, 408) * 3);
    const cover1 = 0.28 + hash01(seed, 409) * 0.3;
    const drawn = hash01(seed, 410) < 0.3;
    const bottom = y0 + height * (hash01(seed, 411) < 0.5 ? 0.05 : -0.1);
    if (drawn) curtain(out, w, sa, sb, y1 - 0.02, Math.max(y0 - 0.05, bottom), -rv * 0.6, col, style, glowC);
    else {
      curtain(out, w, sa, sa + width * cover1, y1 - 0.02, bottom, -rv * 0.6, col, style, glowC);
      curtain(out, w, sb - width * cover1, sb, y1 - 0.02, bottom, -rv * 0.6, col, style, glowC);
    }
    if (full) wquad(out, w, sa - 0.03, y1 - 0.06, sb + 0.03, y1 - 0.03, -rv * 0.55, [0.25, 0.2, 0.14]);
  } else if (state === "blinds") {
    blinds(out, w, sa, sb, y1, height * (0.3 + hash01(seed, 412) * 0.6), -rv * 0.55, pickOf([[0.78, 0.74, 0.64], [0.85, 0.85, 0.82], [0.55, 0.45, 0.3]] as readonly Rgb[], seed, 413), glowC, detail);
  } else if (state === "lit") {
    const left = hash01(seed, 414) < 0.5;
    const col = pickOf(CURTAINS, seed, 415);
    curtain(out, w, left ? sa : sb - width * 0.22, left ? sa + width * 0.22 : sb, y1 - 0.02, y0 + 0.1, -rv * 0.6, col, 1, 0.8);
  } else if (state === "dark") {
    const left = hash01(seed, 416) < 0.5;
    curtain(out, w, left ? sa : sb - width * 0.35, left ? sa + width * 0.35 : sb, y1 - 0.02, y0 + height * 0.3, -rv * 0.6, scaled(pickOf(CURTAINS, seed, 417), 0.6), 1, 0.12);
  }
  // On the sill.
  if (shop) return;
  if (sill === "plant") {
    const s = (sa + sb) / 2 + (hash01(seed, 418) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, -rv * 0.6);
    out.cylinder(p[0], p[2], y0, 0.07, 0.13, 6, [0.5, 0.25, 0.15], [0.2, 0.12, 0.08]);
    for (let k = 0; k < 4; k++) out.cylinder(p[0] + (hash01(seed + k, 419) - 0.5) * 0.08, p[2] + (hash01(seed + k, 420) - 0.5) * 0.08, y0 + 0.12, 0.05 + hash01(seed + k, 421) * 0.03, 0.14 + k * 0.06, 5, [0.12, 0.3, 0.1], [0.2, 0.42, 0.14], 0.012);
  } else if (sill === "lamp") {
    const s = (sa + sb) / 2 + (hash01(seed, 422) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, -rv * 0.6);
    out.cylinder(p[0], p[2], y0, 0.04, 0.2, 5, [0.4, 0.3, 0.2], [0.4, 0.3, 0.2]);
    out.cylinder(p[0], p[2], y0 + 0.18, 0.11, 0.16, 6, [1, 0.85, 0.55], [1, 0.9, 0.6], 0.07);
  }
}
