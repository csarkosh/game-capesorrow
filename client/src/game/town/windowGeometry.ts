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
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { GLASS_CLEAR, GLASS_TINT, TRIM_WHITE, pane, pickOf, reveal, wat, wquad, type WallRef } from "./buildingKit.js";
import { STEP, curtainFolds, patch, paperSheets, slatBlinds, slatColour, verticalBlinds, type Behind } from "./windowDressing.js";
import type { WindowCover, WindowTreatment } from "../../sim/town/types.js";
import type { Surface } from "./townSurface.js";
import { sillStreak } from "./buildingWear.js";
import type { Detail, FillReport } from "./townTypes.js";

/** The wall's surface (its texture frame, wear), for a part laid in the same material as the wall. */
export type SurfaceMaker = (w: WallRef) => Surface;

export type WinCtx = { report?: FillReport; out: MeshBuilder; glass: MeshBuilder; detail: Detail; id: number; era: number; surface: SurfaceMaker; trim: Rgb; wall: Rgb; /** The front draws a stone sill under each window itself. */ stoneSill?: boolean };

/** What a window is told of its place beyond the plan's treatment: whether the room behind is lit by the unit, how grimy the glass is (0 to 1), how old and so how wavy it is. */
export type WinLook = { readonly lit?: boolean; readonly dirt?: number; readonly vacant?: boolean };

const CURTAINS: readonly Rgb[] = [
  [0.7, 0.66, 0.55], [0.55, 0.2, 0.18], [0.25, 0.35, 0.5], [0.78, 0.78, 0.74], [0.3, 0.42, 0.3], [0.5, 0.4, 0.55], [0.85, 0.7, 0.35], [0.35, 0.3, 0.27],
];
const ROOM_WARM: Rgb = [0.95, 0.78, 0.48];
const ROOM_DIM: Rgb = [0.2, 0.22, 0.26];
const PLYWOOD: Rgb = [0.6, 0.45, 0.28];

/** The window's frame colour from the building's age (painted wood of the time, or aluminium after 1960); `replaced` is white vinyl. */
export function frameColour(id: number, era: number, replaced: boolean): Rgb {
  if (replaced) return TRIM_WHITE;
  if (era < 1960) return pickOf([[0.62, 0.6, 0.54], [0.1, 0.2, 0.14], [0.14, 0.1, 0.08], [0.55, 0.5, 0.4]] as readonly Rgb[], id, 400);
  return pickOf([[0.4, 0.42, 0.44], [0.18, 0.14, 0.11], [0.62, 0.62, 0.6]] as readonly Rgb[], id, 401);
}

/** A window's room: a shallow box behind the glass in `colour`, lit by gradient (the lamp's side brighter when `lit`), with a lamp in it now and then. */
function shallowBox(out: MeshBuilder, w: WallRef, sa: number, sb: number, y0: number, y1: number, depth: number, colour: Rgb, glow: number, full: boolean, lit: boolean, seed: number): void {
  // Its sides start where the reveal ends (the reveal's faces lie in the same planes).
  const r0 = 0.17;
  const fx = { glow };
  // The back wall: brighter on the side the lamp is on and toward the top when lit; a dark room's is its colour, a little lighter at the glass (the day).
  const lampLeft = hash01(seed, 640) < 0.5;
  const bright = lit ? 1.25 : 1;
  const l = lampLeft ? bright : 0.8;
  const r = lampLeft ? 0.8 : bright;
  out.poly([wat(w, sa, y0, -depth), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [w.nx, 0, w.nz], [scaled(colour, 0.7 * l), scaled(colour, 0.7 * r), scaled(colour, 1.0 * r), scaled(colour, 1.0 * l)], undefined, fx);
  if (!full) return;
  out.poly([wat(w, sa, y1, -r0), wat(w, sb, y1, -r0), wat(w, sb, y1, -depth), wat(w, sa, y1, -depth)], [0, -1, 0], [scaled(colour, 0.9), scaled(colour, 0.9), scaled(colour, 0.65), scaled(colour, 0.65)], undefined, fx);
  out.poly([wat(w, sa, y0, -r0), wat(w, sa, y0, -depth), wat(w, sa, y1, -depth), wat(w, sa, y1, -r0)], [w.tx, 0, w.tz], [scaled(colour, 0.8), scaled(colour, 0.55), scaled(colour, 0.6), scaled(colour, 0.85)], undefined, fx);
  out.poly([wat(w, sb, y0, -r0), wat(w, sb, y0, -depth), wat(w, sb, y1, -depth), wat(w, sb, y1, -r0)], [-w.tx, 0, -w.tz], [scaled(colour, 0.8), scaled(colour, 0.55), scaled(colour, 0.6), scaled(colour, 0.85)], undefined, fx);
  // The floor, seen from below the sill only at a low angle: a strip lighter by the glass.
  out.poly([wat(w, sa, y0, -r0), wat(w, sb, y0, -r0), wat(w, sb, y0, -depth), wat(w, sa, y0, -depth)], [0, 1, 0], [scaled(colour, 0.9), scaled(colour, 0.9), scaled(colour, 0.5), scaled(colour, 0.5)], undefined, fx);
  // A lamp in the room, lit: a small bright shade at the back on its side, and its pool on the back wall.
  if (lit && hash01(seed, 641) < 0.35) {
    const s = lampLeft ? sa + (sb - sa) * 0.22 : sb - (sb - sa) * 0.22;
    const p = wat(w, s, y0 + 0.5, -depth + 0.25);
    out.cylinder(p[0], p[2], y0 + 0.4, 0.09, 0.2, 6, [1, 0.85, 0.55], [1, 0.9, 0.6], 0.05);
  }
}

/** The treatment of a window's own cover (in the plan: paper, boards) is in the shop's front; this is the window's: see the header. */
export function drawWindow(c: WinCtx, w: WallRef, sa: number, sb: number, y0: number, y1: number, state: WindowTreatment, sill: "none" | "plant" | "lamp", salt: number, replaced: boolean, cover: WindowCover = "none", shop = false, look: WinLook = {}): void {
  const { out, glass, detail } = c;
  const full = detail === "full";
  const seed = c.id * 17 + salt;
  const fr = frameColour(c.id, c.era, replaced);
  const width = sb - sa;
  const height = y1 - y0;
  const rv = full ? 0.16 : 0.08;
  // The glass's own depth, and every layer in front of or behind it a step (STEP) from the next.
  const gOff = -0.07;
  if (c.report !== undefined) c.report.windows.push({ pane: state !== "boarded" && cover !== "boarded", behind: state === "boarded" || cover === "boarded" ? "cover" : shop ? "room" : "box" });
  if (state === "boarded" || cover === "boarded") {
    // Plywood over the hole, in sheets, each its own shade.
    const n = Math.max(1, Math.round(width / 1.2));
    for (let i = 0; i < n; i++) {
      const shade = 0.82 + hash01(seed + i, 402) * 0.3;
      const a = sa + (width * i) / n + 0.01;
      const b = sa + (width * (i + 1)) / n - 0.01;
      wquad(out, w, a, y0, b, y1, 0.06, scaled(PLYWOOD, shade), { layer: "plywood", frame: c.surface(w).frame, tint: [shade * 2.4, shade * 2.4, shade * 2.4], wear: 0.18, wearKind: "peel" });
    }
    return;
  }
  reveal(out, w, sa, sb, y0, y1, rv, scaled(c.wall, 0.8), scaled(c.trim, 0.9));
  // Under the sill the rain that runs off it leaves a streak of dirt down the wall (its own decal, in the wall's material); more on an older wall.
  if (full && !shop && hash01(seed, 423) < 0.2 + 0.4 * Math.min(1, (2026 - c.era) / 120)) {
    const base = c.surface(w);
    const cw = Math.min(width * (0.3 + hash01(seed, 424) * 0.4), 0.9);
    const drop = 0.4 + 1.1 * hash01(seed, 426) * hash01(seed, 427);
    const mid = (sa + sb) / 2 + (hash01(seed, 425) - 0.5) * width * 0.25;
    wquad(out, w, mid - cw / 2, y0 - drop, mid + cw / 2, y0 - 0.14, 0.03, c.wall, sillStreak(base, 0.65, y0, drop));
  }
  if (full && !shop) {
    // Trim boards round it, the sill under it (a replaced window has none: it was fitted in the old opening).
    if (!replaced) {
      const bar = 0.08;
      wquad(out, w, sa - bar, y1, sb + bar, y1 + bar, 0.06, c.trim);
      wquad(out, w, sa - bar, y0 - 0.07, sa, y1, 0.06, c.trim);
      wquad(out, w, sb, y0 - 0.07, sb + bar, y1, 0.06, c.trim);
      if (c.stoneSill !== true) {
        wquad(out, w, sa - 0.1, y0 - 0.07, sb + 0.1, y0 - 0.0, 0.1, c.trim);
        out.poly([wat(w, sa - 0.1, y0, 0), wat(w, sb + 0.1, y0, 0), wat(w, sb + 0.1, y0, 0.1), wat(w, sa - 0.1, y0, 0.1)], [0, 1, 0], c.trim);
      }
    } else {
      wquad(out, w, sa - 0.03, y1, sb + 0.03, y1 + 0.03, 0.06, fr);
      wquad(out, w, sa - 0.03, y0 - 0.03, sb + 0.03, y0, 0.06, fr);
    }
  }
  const behind: Behind = { out, w, detail, seed, glass: gOff, lit: look.lit === true };
  if (state === "broken") {
    // No glass: a few shards stand in the corners of the frame, and a torn curtain hangs inside. The room is dark.
    shallowBox(out, w, sa, sb, y0, y1, 0.9, ROOM_DIM, 0.1, full, false, seed);
    for (const [s, y, sg] of [[sa, y1, 1], [sb, y0, -1], [sa, y0, 1]] as const) {
      const k = 0.18 + hash01(seed + sg + y, 403) * 0.25;
      glass.poly([wat(w, s, y, gOff), wat(w, s + sg * k, y, gOff), wat(w, s, y + (y === y1 ? -k * 1.6 : k * 1.6), gOff)], [w.nx, 0, w.nz], [0.5, 0.56, 0.6], undefined, { clear: 0.6 });
    }
    curtainFolds(behind, sa + 0.05, sa + Math.min(0.35, width * 0.4), y1 - 0.05, y1 - height * 0.6, pickOf(CURTAINS, seed, 404), 1, 0.2, 3);
    return;
  }
  // The room behind it: lit, dim; a curtained window sometimes has a lit room behind its curtains.
  const roomLit = state === "lit" || (state === "curtained" && hash01(seed, 405) < 0.22) || (state === "blinds" && hash01(seed, 406) < 0.2);
  const roomColour = roomLit ? ROOM_WARM : state === "dark" ? ROOM_DIM : ([0.4, 0.36, 0.32] as Rgb);
  const lampOn = roomLit || look.lit === true;
  if (!shop) shallowBox(out, w, sa, sb, y0, y1, 0.9, roomColour, roomLit ? 1.1 : state === "dark" ? 0.14 : 0.3, full, roomLit, seed);
  const dirt = look.dirt ?? Math.min(0.9, 0.2 + 0.25 * Math.min(1, (2026 - c.era) / 120) + hash01(seed, 643) * 0.25);
  const oldness = Math.min(1, (2026 - c.era) / 130);
  // The pane: old glass is wavier, so its reflecting normal turns more.
  pane(glass, w, sa, y0, sb, y1, gOff, GLASS_CLEAR, GLASS_TINT, { dirt, tilt: 0.018 + 0.035 * oldness });
  if (full) {
    // The meeting rail of a double-hung window, and its muntin cut round it, in front of the glass.
    const mid = y0 + height * (replaced ? 0.5 : 0.52);
    const gx = gOff + STEP;
    wquad(out, w, sa, mid - 0.03, sb, mid + 0.03, gx, fr);
    if (!replaced && width > 0.7) {
      wquad(out, w, (sa + sb) / 2 - 0.02, y0, (sa + sb) / 2 + 0.02, mid - 0.03, gx, fr);
      wquad(out, w, (sa + sb) / 2 - 0.02, mid + 0.03, (sa + sb) / 2 + 0.02, y1, gx, fr);
    }
  }
  if (cover === "papered") paperSheets(behind, sa, sb, y0, y1, Math.min(1, 0.2 + (look.dirt ?? 0.5)));
  // Curtains, blinds or what the plan says is in it.
  const glowC = roomLit ? 0.7 : 0.18;
  if (shop) {
    // A shop shows the unit's own room behind its glass.
  } else if (state === "curtained") {
    const col = pickOf(CURTAINS, seed, 407);
    const style = Math.floor(hash01(seed, 408) * 3);
    const cover1 = 0.26 + hash01(seed, 409) * 0.2;
    const drawn = hash01(seed, 410) < 0.3;
    const bottom = y0 + height * (hash01(seed, 411) < 0.5 ? 0.05 : 0.0);
    if (drawn) curtainFolds(behind, sa, sb, y1 - 0.02, Math.max(y0, bottom), col, style, glowC);
    else {
      curtainFolds(behind, sa, sa + width * cover1, y1 - 0.02, bottom, col, style, glowC);
      curtainFolds(behind, sb - width * cover1, sb, y1 - 0.02, bottom, col, style, glowC);
    }
    if (full) out.poly([wat(w, sa, y1 - 0.06, gOff - STEP * 4), wat(w, sb, y1 - 0.06, gOff - STEP * 4), wat(w, sb, y1 - 0.03, gOff - STEP * 4), wat(w, sa, y1 - 0.03, gOff - STEP * 4)], [w.nx, 0, w.nz], [0.25, 0.2, 0.14], undefined, { glow: 0.1 });
  } else if (state === "blinds") {
    const col = slatColour(seed);
    const drop = height * (0.3 + hash01(seed, 412) * 0.65);
    if (hash01(seed, 644) < 0.18) verticalBlinds(behind, sa, sb, y1 - 0.02, y0 + 0.05, col);
    else slatBlinds(behind, sa, sb, y1 - 0.02, drop, col);
  } else if (state === "lit") {
    const left = hash01(seed, 414) < 0.5;
    const col = pickOf(CURTAINS, seed, 415);
    curtainFolds(behind, left ? sa : sb - width * 0.22, left ? sa + width * 0.22 : sb, y1 - 0.02, y0 + 0.1, col, 1, 0.8);
  } else if (state === "dark") {
    const left = hash01(seed, 416) < 0.5;
    curtainFolds(behind, left ? sa : sb - width * 0.35, left ? sa + width * 0.35 : sb, y1 - 0.02, y0 + height * 0.3, scaled(pickOf(CURTAINS, seed, 417), 0.6), 1, 0.12);
  }
  if (shop) {
    // The shop's own cover (blinds) is drawn by the front: nothing more here.
  }
  // Now and then something else is in the window: a sheet of cardboard or plywood in a broken pane, a window air-conditioner, a box fan.
  if (!shop && full && !replaced) {
    const x = hash01(seed, 645);
    if (x < 0.05 && (state === "dark" || state === "curtained")) patch(behind, sa + (hash01(seed, 646) < 0.5 ? 0 : width / 2), sa + (hash01(seed, 646) < 0.5 ? width / 2 : width), y0, y0 + height * 0.5, hash01(seed, 647) < 0.6);
    else if (x < 0.11 && c.era >= 1950 && width <= 1.2) acUnit(out, w, (sa + sb) / 2, y0, Math.min(0.55, width - 0.15), seed);
    else if (x < 0.14 && lampOn) boxFan(behind, (sa + sb) / 2, y0, Math.min(0.5, width - 0.2), seed);
  }
  if (shop) return;
  // On the sill, behind the glass: a pot and a lamp stand a hand behind the pane (their near faces well clear of it), their leaves apart.
  if (sill === "plant") {
    const s = (sa + sb) / 2 + (hash01(seed, 418) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, gOff - 0.2);
    out.cylinder(p[0], p[2], y0, 0.07, 0.13, 6, [0.5, 0.25, 0.15], [0.2, 0.12, 0.08]);
    // Four leaves at the corners of a square, each narrower than the gap between them, so no two stand through one another.
    const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    corners.forEach(([cu, cv], k) => {
      const q = wat(w, s + cu * 0.045, y0, gOff - 0.2 - cv * 0.045);
      out.cylinder(q[0], q[2], y0 + 0.12, 0.03 + hash01(seed + k, 421) * 0.012, 0.14 + k * 0.06, 5, [0.12, 0.3, 0.1], [0.2, 0.42, 0.14], 0.012);
    });
  } else if (sill === "lamp") {
    const s = (sa + sb) / 2 + (hash01(seed, 422) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, gOff - 0.2);
    out.cylinder(p[0], p[2], y0, 0.04, 0.2, 5, [0.4, 0.3, 0.2], [0.4, 0.3, 0.2]);
    out.cylinder(p[0], p[2], y0 + 0.18, 0.11, 0.16, 6, [1, 0.85, 0.55], [1, 0.9, 0.6], 0.07);
  }
}

/** A window air-conditioner on the sill, through the lower sash: a grey box standing out of the wall with a grille. */
function acUnit(out: MeshBuilder, w: WallRef, s: number, y0: number, wid: number, seed: number): void {
  const body: Rgb = hash01(seed, 650) < 0.5 ? [0.78, 0.78, 0.74] : [0.62, 0.6, 0.55];
  const h = 0.34;
  const a = s - wid / 2;
  const b = s + wid / 2;
  const front = 0.42;
  const yb = y0 + 0.03;
  const yt = yb + h;
  out.poly([wat(w, a, yb, front), wat(w, b, yb, front), wat(w, b, yt, front), wat(w, a, yt, front)], [w.nx, 0, w.nz], body);
  out.poly([wat(w, a, yt, 0.05), wat(w, b, yt, 0.05), wat(w, b, yt, front), wat(w, a, yt, front)], [0, 1, 0], scaled(body, 1.1));
  out.poly([wat(w, a, yb, 0.05), wat(w, a, yb, front), wat(w, a, yt, front), wat(w, a, yt, 0.05)], [-w.tx, 0, -w.tz], scaled(body, 0.82));
  out.poly([wat(w, b, yb, 0.05), wat(w, b, yb, front), wat(w, b, yt, front), wat(w, b, yt, 0.05)], [w.tx, 0, w.tz], scaled(body, 0.82));
  // The grille, a dark panel on its face proud of it.
  out.poly([wat(w, a + 0.05, yb + 0.05, front + 0.025), wat(w, b - 0.05, yb + 0.05, front + 0.025), wat(w, b - 0.05, yb + 0.2, front + 0.025), wat(w, a + 0.05, yb + 0.2, front + 0.025)], [w.nx, 0, w.nz], [0.2, 0.2, 0.2]);
}

/** A box fan in the window, behind the glass: a square frame and a round face. */
function boxFan(b: Behind, s: number, y0: number, wid: number, seed: number): void {
  const { out, w } = b;
  // Five steps behind the glass: a curtain hangs at two, so the fan's ring (3 cm in front of its plate) is over 4 cm from it.
  const off = b.glass - STEP * 5;
  const y = y0 + 0.08;
  const a = s - wid / 2;
  const c = s + wid / 2;
  out.poly([wat(w, a, y, off), wat(w, c, y, off), wat(w, c, y + wid, off), wat(w, a, y + wid, off)], [w.nx, 0, w.nz], [0.82, 0.8, 0.72], undefined, { glow: 0.2 });
  const cx = s;
  const cy = y + wid / 2;
  const ring: Vec3[] = [];
  for (let k = 0; k < 8; k++) ring.push(wat(w, cx + Math.cos((k / 8) * Math.PI * 2) * wid * 0.4, cy + Math.sin((k / 8) * Math.PI * 2) * wid * 0.4, off + 0.03));
  out.poly(ring, [w.nx, 0, w.nz], [0.35 + 0.1 * hash01(seed, 651), 0.35, 0.33], undefined, { glow: 0.2 });
}
