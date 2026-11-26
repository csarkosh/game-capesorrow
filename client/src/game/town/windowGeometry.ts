/**
 * A window as a thing with a depth, never a dark rectangle: a hole through the wall with a reveal, the frame and trim of its age (painted
 * wood with trim boards and a sill, or the white vinyl of a replacement), and a pane of glass in the blended layer that reflects the sky.
 * Behind a home's glass there is nothing to see into: the whole opening is closed right behind it by curtains drawn across (a few colours,
 * plain, in folds or in stripes, lit from within as if a lamp is on in the evening by the window's own night code and not by day), blinds fully down, or a dark window by day (an opaque cool grey, so the
 * sky on the glass and its grime are what is seen), as the plan's `WindowTreatment` says. A shop's glass shows the unit's room; boards go
 * over a boarded window; a broken one has shards left in the frame over an opaque dark backing. A plant or a lamp stands on the sill
 * where the plan puts one, in front of the covering.
 *
 * What is authored: the sizes, the colour tables, the share of curtained windows that glow. What
 * the plan causes: the treatment, the sill, and, from the household's habit (`windows.ts`), which windows match. A window is
 * replaced (white vinyl, a different pane) with a chance that grows with the building's age; the cause is the owner's remodel of a
 * decade in the owner's own lifetime, drawn from the building's id and the window's.
 */
import { withMat } from "./materials.js";
import { hash01, scaled, type MeshBuilder, type Rgb, type Vec3 } from "./meshBuilder.js";
import { GLASS_CLEAR, GLASS_TINT, TRIM_WHITE, pane, pickOf, reveal, wat, wbox, wquad, type WallRef } from "./buildingKit.js";
import { STEP, curtainFolds, patch, paperSheets, slatBlinds, slatColour, verticalBlinds, type Behind } from "./windowDressing.js";
import type { Material, WindowCover, WindowTreatment } from "../../sim/town/types.js";
import type { Surface } from "./townSurface.js";
import { standOff } from "./faceLedger.js";
import { sillStreak } from "./buildingWear.js";
import type { Detail, FillReport } from "./townTypes.js";
import { NEVER_CODE, windowLight } from "./windowNight.js";

/** How deep a window's opening is cut into a wall: a wall of brick, stone, stucco or concrete is thick, so its openings are 24 cm deep; a wall of boards or sheet metal is thin, so they are 16 cm; and the low tier keeps 8 cm. */
export const REVEAL_MASONRY = 0.24;
export const REVEAL_THIN = 0.16;
export const REVEAL_LOW = 0.08;
/** How far the glass stands short of the end of the reveal on the full tier (9 cm: the jambs run that far past the pane). The low tier's glass stays 7 cm in. */
const GLASS_SHORT = 0.09;
const GLASS_LOW = 0.07;

/** Whether a wall of this material is masonry (thick), as against boards or sheet metal (thin). */
export const isMasonry = (material: Material): boolean => material !== "wood" && material !== "metal";

/** The depth of a window's reveal, by the tier and by whether the wall is masonry. */
export const revealOf = (full: boolean, masonry: boolean): number => (full ? (masonry ? REVEAL_MASONRY : REVEAL_THIN) : REVEAL_LOW);
/** The offset of a window's glass (negative: in from the wall's face), 9 cm short of the reveal's end on the full tier. Whatever hangs in the window is set from it. */
export const glassOffOf = (full: boolean, masonry: boolean): number => (full ? GLASS_SHORT - revealOf(true, masonry) : -GLASS_LOW);

/** The wall's surface (its texture frame, wear), for a part laid in the same material as the wall. */
export type SurfaceMaker = (w: WallRef) => Surface;

export type WinCtx = { report?: FillReport; out: MeshBuilder; glass: MeshBuilder; detail: Detail; id: number; era: number; surface: SurfaceMaker; trim: Rgb; wall: Rgb; /** The front draws a stone sill under each window itself. */ stoneSill?: boolean; /** The wall is masonry (brick, stone, stucco, concrete), so its openings are deeper (`REVEAL_MASONRY`); none given is a thin wall. */ masonry?: boolean };

/** What a window is told of its place beyond the plan's treatment: whether the room behind is lit by the unit, how grimy the glass is (0 to 1), how old and so how wavy it is. */
/** `through`: the pane shows a shop's room out of focus (`PaneLook.through`). */
/** `night`: a home's window's night code (`windowNight.ts`), when its covering glows from within; none given is a window that is never lit. */
export type WinLook = { readonly lit?: boolean; readonly dirt?: number; readonly vacant?: boolean; readonly through?: boolean; readonly night?: number };

const CURTAINS: readonly Rgb[] = [
  [0.7, 0.66, 0.55], [0.55, 0.2, 0.18], [0.25, 0.35, 0.5], [0.78, 0.78, 0.74], [0.3, 0.42, 0.3], [0.5, 0.4, 0.55], [0.85, 0.7, 0.35], [0.35, 0.3, 0.27],
];
const DARK_BACK: Rgb = [0.17, 0.19, 0.23];
/** How far a window's sill ledge stands out of the wall (16 cm, as a real sill does). */
export const SILL_OUT = 0.16;
const PLYWOOD: Rgb = [0.6, 0.45, 0.28];

/** The window's frame colour from the building's age (painted wood of the time, or aluminium after 1960); `replaced` is white vinyl. */
export function frameColour(id: number, era: number, replaced: boolean): Rgb {
  if (replaced) return TRIM_WHITE;
  if (era < 1960) return pickOf([[0.62, 0.6, 0.54], [0.1, 0.2, 0.14], [0.14, 0.1, 0.08], [0.55, 0.5, 0.4]] as readonly Rgb[], id, 400);
  return pickOf([[0.4, 0.42, 0.44], [0.18, 0.14, 0.11], [0.62, 0.62, 0.6]] as readonly Rgb[], id, 401);
}

/** The treatment of a window's own cover (in the plan: paper, boards) is in the shop's front; this is the window's: see the header. */
export function drawWindow(c: WinCtx, w: WallRef, sa: number, sb: number, y0: number, y1: number, state: WindowTreatment, sill: "none" | "plant" | "lamp", salt: number, replaced: boolean, cover: WindowCover = "none", shop = false, look: WinLook = {}): void {
  const { out, glass, detail } = c;
  const full = detail === "full";
  const seed = c.id * 17 + salt;
  const fr = frameColour(c.id, c.era, replaced);
  const width = sb - sa;
  const height = y1 - y0;
  const masonry = c.masonry === true;
  const rv = revealOf(full, masonry);
  // The glass's own depth, and every layer in front of or behind it a step (STEP) from the next.
  const gOff = glassOffOf(full, masonry);
  const entry: FillReport["windows"][number] = { pane: state !== "boarded" && cover !== "boarded", behind: state === "boarded" || cover === "boarded" ? "cover" : shop ? "room" : "cover", closes: state === "boarded" || cover === "boarded" ? "boards" : shop ? "room" : "dark", shop, opening: [sa, sb, y0, y1] };
  c.report?.windows.push(entry);
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
      wquad(out, w, sa - bar, y1, sb + bar, y1 + bar, 0.06, c.trim, "painted");
      wquad(out, w, sa - bar, y0 - 0.07, sa, y1, 0.06, c.trim, "painted");
      wquad(out, w, sb, y0 - 0.07, sb + bar, y1, 0.06, c.trim, "painted");
      if (c.stoneSill !== true) {
        // A closed ledge: its face, top, underside and two ends (seen from below on the street, a sill that is only a face and a top is a gap).
        wbox(out, w, sa - 0.1, sb + 0.1, y0 - 0.07, y0, 0, SILL_OUT, c.trim, c.trim, true, "painted");
      }
    } else {
      wquad(out, w, sa - 0.03, y1, sb + 0.03, y1 + 0.03, 0.06, fr, "painted");
      wquad(out, w, sa - 0.03, y0 - 0.03, sb + 0.03, y0, 0.06, fr, "painted");
    }
  }
  // A plant or a lamp on the sill stands in front of the covering, so the covering is set well behind them, with a liner closing the opening's sides to it.
  const shift = !shop && sill !== "none" && state !== "broken" ? 0.3 : 0;
  const behind: Behind = { out, w, detail, seed, glass: gOff - shift, lit: look.lit === true };
  // Clear of every face the wall's own builders have noted (`faceLedger.ts`), as the blinds' face is: a room's wall behind a works' window must not lie within 2.45 cm of it.
  const back0 = behind.glass - STEP * 8.4;
  const ba = wat(w, sa, 0, back0);
  const bb = wat(w, sb, 0, back0);
  const back = back0 - (shop ? 0 : standOff(w.nx, w.nz, ba[0], ba[2], bb[0], bb[2], y0, y1, -1));
  /** The opaque backing that closes the whole opening behind everything else (and its liner, when it is set back from the reveal). */
  const backing = (col: Rgb, glow: number): void => {
    out.poly([wat(w, sa, y0, back), wat(w, sb, y0, back), wat(w, sb, y1, back), wat(w, sa, y1, back)], [w.nx, 0, w.nz], [scaled(col, 0.8), scaled(col, 0.8), col, col], undefined, { glow });
    if (shift > 0) {
      // The liner starts a centimetre past the reveal's end, so it runs on from the jambs.
      const r0 = rv + 0.01;
      const lc = scaled(col, 0.7);
      out.poly([wat(w, sa, y1, -r0), wat(w, sb, y1, -r0), wat(w, sb, y1, back), wat(w, sa, y1, back)], [0, -1, 0], lc, undefined, { glow });
      out.poly([wat(w, sa, y0, -r0), wat(w, sa, y0, back), wat(w, sa, y1, back), wat(w, sa, y1, -r0)], [w.tx, 0, w.tz], lc, undefined, { glow });
      out.poly([wat(w, sb, y0, -r0), wat(w, sb, y0, back), wat(w, sb, y1, back), wat(w, sb, y1, -r0)], [-w.tx, 0, -w.tz], lc, undefined, { glow });
      out.poly([wat(w, sa, y0, -r0), wat(w, sb, y0, -r0), wat(w, sb, y0, back), wat(w, sa, y0, back)], [0, 1, 0], lc, undefined, { glow });
    }
    entry.covering = [sa, sb, y0, y1];
  };
  if (state === "broken") {
    // No glass: a few shards stand in the corners of the frame, and a torn curtain hangs inside. Nothing behind it is a room: an opaque dark backing closes the hole.
    out.withHours(NEVER_CODE, () => withMat("painted", () => backing(DARK_BACK, 0.05)));
    entry.closes = "dark";
    for (const [s, y, sg] of [[sa, y1, 1], [sb, y0, -1], [sa, y0, 1]] as const) {
      const k = 0.18 + hash01(seed + sg + y, 403) * 0.25;
      glass.poly([wat(w, s, y, gOff), wat(w, s + sg * k, y, gOff), wat(w, s, y + (y === y1 ? -k * 1.6 : k * 1.6), gOff)], [w.nx, 0, w.nz], [0.5, 0.56, 0.6], undefined, { clear: 0.6 });
    }
    out.withHours(NEVER_CODE, () => curtainFolds(behind, sa + 0.05, sa + Math.min(0.35, width * 0.4), y1 - 0.05, y1 - height * 0.6, pickOf(CURTAINS, seed, 404), 1, 0.2, 3));
    return;
  }
  // The room behind it: lit, dim; a curtained window sometimes has a lit room behind its curtains.
  const roomLit = state === "lit" || (state === "curtained" && hash01(seed, 405) < 0.22) || (state === "blinds" && hash01(seed, 406) < 0.2);
  // A home's window is lit in the evening by its own night code (`windowNight.ts`), and not by day; a window with none given is never lit.
  const code = shop ? 0 : look.night ?? NEVER_CODE;
  const lamp = !shop && code !== NEVER_CODE ? windowLight(c.id, salt) : null;
  // What closes the opening of a home: curtains drawn right across (most), blinds fully down, or a dark window by day (a lit one is behind a curtain).
  const closer: "curtain" | "blind" | "dark" = shop ? "dark" : state === "blinds" ? "blind" : state === "dark" ? (lamp === null && (look.vacant === true || hash01(seed, 660) < 0.55) ? "dark" : "curtain") : "curtain";
  // The cloth takes the light's colour (the glow is the cloth's own colour lit): a little of it by day, which is all the cloth keeps of it.
  const warmed = (col: Rgb): Rgb => (lamp === null ? col : [col[0] * (0.4 + 0.6 * lamp.colour[0]), col[1] * (0.4 + 0.6 * lamp.colour[1]), col[2] * (0.4 + 0.6 * lamp.colour[2])]);
  const curtainCol = warmed(state === "dark" ? scaled(pickOf(CURTAINS, seed, 417), 0.6) : pickOf(CURTAINS, seed, state === "lit" ? 415 : 407));
  const lampOn = roomLit || look.lit === true || lamp !== null;
  const glowC = lamp?.glow ?? 0;
  const homeBehind: Behind = shop ? behind : { ...behind, glow: glowC };
  /** What a home's window draws behind the glass is its own light's: lit by the night code, and the glow of nothing by day. */
  const night = (fn: () => void): void => (shop ? fn() : out.withHours(code, fn));
  if (!shop) {
    entry.closes = closer;
    night(() => withMat("painted", () => backing(closer === "dark" ? DARK_BACK : closer === "blind" ? scaled(warmed(slatColour(seed)), 0.5) : scaled(curtainCol, 0.5), glowC)));
  }
  const dirt = look.dirt ?? Math.min(0.9, 0.2 + 0.25 * Math.min(1, (2026 - c.era) / 120) + hash01(seed, 643) * 0.25);
  const oldness = Math.min(1, (2026 - c.era) / 130);
  // The pane: old glass is wavier, so its reflecting normal turns more.
  pane(glass, w, sa, y0, sb, y1, gOff, GLASS_CLEAR, GLASS_TINT, { dirt, tilt: 0.018 + 0.035 * oldness, ...(look.through === true ? { through: true } : {}) });
  if (full) {
    // The meeting rail of a double-hung window, and its muntin cut round it, in front of the glass.
    const mid = y0 + height * (replaced ? 0.5 : 0.52);
    const gx = gOff + STEP;
    wquad(out, w, sa, mid - 0.03, sb, mid + 0.03, gx, fr, "painted");
    if (!replaced && width > 0.7) {
      wquad(out, w, (sa + sb) / 2 - 0.02, y0, (sa + sb) / 2 + 0.02, mid - 0.03, gx, fr, "painted");
      wquad(out, w, (sa + sb) / 2 - 0.02, mid + 0.03, (sa + sb) / 2 + 0.02, y1, gx, fr, "painted");
    }
  }
  if (cover === "papered") paperSheets(behind, sa, sb, y0, y1, Math.min(1, 0.2 + (look.dirt ?? 0.5)));
  // Curtains, blinds or what the plan says is in it: the whole opening, edge to edge.
  if (shop) {
    // A shop shows the unit's own room behind its glass.
  } else if (closer === "curtain") {
    const style = Math.floor(hash01(seed, 408) * 3);
    night(() => curtainFolds(homeBehind, sa, sb, y1, y0, curtainCol, style, glowC));
    if (full) night(() => withMat("cloth", () => out.poly([wat(w, sa, y1 - 0.06, behind.glass - STEP * 4), wat(w, sb, y1 - 0.06, behind.glass - STEP * 4), wat(w, sb, y1 - 0.03, behind.glass - STEP * 4), wat(w, sa, y1 - 0.03, behind.glass - STEP * 4)], [w.nx, 0, w.nz], [0.25, 0.2, 0.14], undefined, { glow: glowC * 0.2 })));
  } else if (closer === "blind") {
    const col = warmed(slatColour(seed));
    if (hash01(seed, 644) < 0.18) night(() => verticalBlinds(homeBehind, sa, sb, y1, y0, col));
    else night(() => slatBlinds(homeBehind, sa, sb, y1, height, col));
  }
  if (shop) {
    // The shop's own cover (blinds) is drawn by the front: nothing more here.
  }
  // Now and then something else is in the window: a sheet of cardboard or plywood in a broken pane, a window air-conditioner, a box fan.
  if (!shop && full && !replaced) {
    const x = hash01(seed, 645);
    if (x < 0.05 && (closer === "dark" || closer === "curtain")) patch(behind, sa + (hash01(seed, 646) < 0.5 ? 0 : width / 2), sa + (hash01(seed, 646) < 0.5 ? width / 2 : width), y0, y0 + height * 0.5, hash01(seed, 647) < 0.6);
    else if (x < 0.11 && c.era >= 1950 && width <= 1.2) acUnit(out, w, (sa + sb) / 2, y0, Math.min(0.55, width - 0.15), seed);
    else if (x < 0.14 && lampOn) boxFan(behind, (sa + sb) / 2, y0, Math.min(0.5, width - 0.2), seed);
  }
  if (shop) return;
  // On the sill, behind the glass: a pot and a lamp stand a hand behind the pane (their near faces well clear of it), their leaves apart.
  if (sill === "plant") {
    const s = (sa + sb) / 2 + (hash01(seed, 418) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, gOff - 0.2);
    withMat("painted", () => out.cylinder(p[0], p[2], y0, 0.07, 0.13, 6, [0.5, 0.25, 0.15], [0.2, 0.12, 0.08]));
    // Four leaves at the corners of a square, each narrower than the gap between them, so no two stand through one another.
    const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    corners.forEach(([cu, cv], k) => {
      const q = wat(w, s + cu * 0.045, y0, gOff - 0.2 - cv * 0.045);
      withMat("plant", () => out.cylinder(q[0], q[2], y0 + 0.12, 0.03 + hash01(seed + k, 421) * 0.012, 0.14 + k * 0.06, 5, [0.12, 0.3, 0.1], [0.2, 0.42, 0.14], 0.012));
    });
  } else if (sill === "lamp") {
    const s = (sa + sb) / 2 + (hash01(seed, 422) - 0.5) * width * 0.4;
    const p = wat(w, s, y0, gOff - 0.2);
    withMat("painted", () => {
      out.cylinder(p[0], p[2], y0, 0.04, 0.2, 5, [0.4, 0.3, 0.2], [0.4, 0.3, 0.2]);
      out.cylinder(p[0], p[2], y0 + 0.18, 0.11, 0.16, 6, [1, 0.85, 0.55], [1, 0.9, 0.6], 0.07);
    });
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
  withMat("steel", () => {
    out.poly([wat(w, a, yb, front), wat(w, b, yb, front), wat(w, b, yt, front), wat(w, a, yt, front)], [w.nx, 0, w.nz], body);
    out.poly([wat(w, a, yt, 0.05), wat(w, b, yt, 0.05), wat(w, b, yt, front), wat(w, a, yt, front)], [0, 1, 0], scaled(body, 1.1));
    // Its underside, seen from the street below.
    out.poly([wat(w, a, yb, 0.05), wat(w, b, yb, 0.05), wat(w, b, yb, front), wat(w, a, yb, front)], [0, -1, 0], scaled(body, 0.6));
    out.poly([wat(w, a, yb, 0.05), wat(w, a, yb, front), wat(w, a, yt, front), wat(w, a, yt, 0.05)], [-w.tx, 0, -w.tz], scaled(body, 0.82));
    out.poly([wat(w, b, yb, 0.05), wat(w, b, yb, front), wat(w, b, yt, front), wat(w, b, yt, 0.05)], [w.tx, 0, w.tz], scaled(body, 0.82));
    // The grille, a dark panel on its face proud of it.
    out.poly([wat(w, a + 0.05, yb + 0.05, front + 0.025), wat(w, b - 0.05, yb + 0.05, front + 0.025), wat(w, b - 0.05, yb + 0.2, front + 0.025), wat(w, a + 0.05, yb + 0.2, front + 0.025)], [w.nx, 0, w.nz], [0.2, 0.2, 0.2]);
  });
}

/** A box fan in the window, behind the glass: a square frame and a round face. */
function boxFan(b: Behind, s: number, y0: number, wid: number, seed: number): void {
  withMat("steel", () => {
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
  });
}
