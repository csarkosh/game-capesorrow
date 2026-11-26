/**
 * A big wall's tone at the scale of metres, laid over its surface as paint: sheets that lie flush on the face (2 mm off it, `paint.ts`) and are held from it by
 * a rank of paint, so no line is drawn round them and they are no faces of the ledger (`faceLedger.ts`); a sheet of plywood is a board and stands 3 cm off, a face of the
 * ledger. From 60 m the texture and the streaks are fine detail and a wall reads as one flat tone unless it has large shapes of its own.
 *
 * By the building's record (`levelOf`, its age and its keeping):
 * - **A dark lower third** with a ragged top, the tide of splash and damp that climbs a wall: higher and darker the heavier the weathering.
 * - **Patches**: where the owner mended and repainted (pale), where a roof leaked (a broad dark stain), and on a wooden wall a sheet of plywood nailed over a repair.
 * - **A ghost sign** on a brick or concrete wall of a commercial block: the pale rectangle of an old painted sign, with the bars of its faded lines.
 *
 * Nothing here is laid over an opening (a window, a door, a shopfront),. Only walls of 36 square metres and more.
 */
import { hash01, scaled, type MeshBuilder, type Rgb } from "./meshBuilder.js";
import { levelOf, agingOf } from "./buildingWear.js";
import { wat, wquad, type Hole, type WallRef } from "./buildingKit.js";
import { isClear } from "./faceLedger.js";
import { paintOff } from "./paint.js";
import type { Surface } from "./townSurface.js";
import type { Building } from "../../sim/town/types.js";

export type WallToneCtx = {
  readonly out: MeshBuilder;
  readonly b: Building;
  readonly walls: readonly WallRef[];
  readonly holes: readonly (readonly Hole[])[];
  readonly tops: readonly (readonly [number, number])[];
  readonly baseY: number;
  readonly colour: Rgb;
  readonly surfaceOf: (w: WallRef, band?: 0 | 1) => Surface;
  readonly frontAt: number;
  readonly low: boolean;
  readonly paint: boolean;
};

/** Where a sheet of plywood nailed over a repair stands off the wall: a real board, 3 cm, a face of the ledger like any other. */
const OFF = 0.03;
/** The rank of every sheet of paint here: the tone of the wall's lower third, a patch, a stain, a ghost sign's rows. None lies over another (`placed`), so one rank holds them all. */
const TONE_RANK = 1;
/** Where a sheet of paint is looked for a face already on the wall: the plane the ledger's faces are kept clear of (`OFF`), though the paint itself lies flush. Paint is not put under a pipe or a plate. */
const PROBE = OFF;

export function wallTone(c: WallToneCtx): void {
  const { out, b, baseY } = c;
  const L = levelOf(b);
  const { age } = agingOf(b);
  c.walls.forEach((w, i) => {
    if (b.state === "ruin") return;
    const topLow = Math.min((c.tops[i] as readonly [number, number])[0], (c.tops[i] as readonly [number, number])[1]) - baseY;
    if (w.length < 5 || topLow < 3 || w.length * topLow < 36) return;
    const holes = c.holes[i] ?? [];
    /** The decals already on this wall: none lies over another (a step further out would put it near the pipes and cables hung there), and none under a window where its own sill's streak is. */
    const placed: { s0: number; s1: number; y0: number; y1: number }[] = [];
    const free = (s0: number, s1: number, y0: number, y1: number): boolean => {
      // And no face already on the wall within 2.45 cm of where this one stands (a sill's streak, a plate): it is skipped, not pushed out beside the pipes.
      const pa = wat(w, s0, baseY + y0, PROBE);
      const pb = wat(w, s1, baseY + y0, PROBE);
      if (!isClear(w.nx, w.nz, pa[0], pa[2], pb[0], pb[2], baseY + y0, baseY + y1)) return false;
      return freeOf(s0, s1, y0, y1);
    };
    const freeOf = (s0: number, s1: number, y0: number, y1: number): boolean =>
      !holes.some((h) => h.s0 < s1 + 0.4 && h.s1 > s0 - 0.4 && h.y0 < baseY + y1 + 0.4 && h.y1 > baseY + y0 - 0.4) &&
      !placed.some((q) => q.s0 < s1 + 0.1 && q.s1 > s0 - 0.1 && q.y0 < y1 + 0.1 && q.y1 > y0 - 0.1);
    const base = c.surfaceOf(w, 1);
    /** A mark of another layer lies on the wall, and sees the sky the wall sees there (`skyShade.ts`). */
    const sky = base.shade === undefined ? {} : { shade: base.shade };
    /** An unpainted wall (concrete, brick, weathered boards) is dark in the textures, so a darker mark shows nothing on it: its marks are the lighter ones (efflorescence, chalk, repaint) and rust. */
    const dark = !c.paint;
    const r = (k: number): number => hash01(b.id * 31 + i * 7 + k, 5151);
    /** The wall's own surface and colour, scaled in tone by `k`. */
    const tone = (k: number, over?: Partial<Surface>): { colour: Rgb; surface: Surface } =>
      dark
        ? // On a dark textured wall a lighter mark is paint or chalk, a layer of its own (the paintable one, whose colour is the paint's), not the wall's texture turned up.
          { colour: [0.2 * k, 0.185 * k, 0.16 * k], surface: { layer: "siding_painted", frame: base.frame, wear: 0.05, wear2: 0, ...sky, ...(over ?? {}) } }
        : {
            colour: scaled(c.colour, k),
            surface: { ...base, ...(c.paint || base.tint === undefined ? {} : { tint: scaled(base.tint, k) }), ...(over ?? {}) },
          };
    const put = (s0: number, y0: number, s1: number, y1: number, t: { colour: Rgb; surface: Surface }): void => {
      wquad(out, w, s0, baseY + y0, s1, baseY + y1, paintOff(TONE_RANK), t.colour, t.surface, { paint: TONE_RANK });
      placed.push({ s0, s1, y0, y1 });
    };

    const bandPass = (): void => {
      // ---- the lower third, with a ragged top
      if (r(1) < 0.8 + 0.2 * L) {
        const piece = c.low ? 12 : 4.5;
        const n = Math.max(1, Math.ceil(w.length / piece));
        const reach = Math.min(4.4, topLow * (0.3 + 0.12 * L + 0.08 * r(2)));
        const k = dark ? 1.15 + 0.25 * L + 0.1 * r(3) : 1 - (0.18 + 0.3 * L) * (0.8 + 0.4 * r(3));
        for (let j = 0; j < n; j++) {
          const s0 = (w.length * j) / n;
          const s1 = (w.length * (j + 1)) / n;
          const hgt = Math.max(1.2, reach * (0.65 + 0.7 * hash01(b.id * 17 + i * 5 + j, 5152)));
          if (!free(s0, s1, 0, hgt)) continue;
          put(s0, 0.02, s1, hgt, tone(k, dark ? { wear: 0.05, wear2: 0 } : undefined));
        }
      }
    };
    if (c.low) {
      bandPass();
      return;
    }


    // ---- patches: a repaint, a leak's stain, a sheet of plywood
    const patches = Math.min(5, 1 + Math.floor(w.length / 9)) + (age > 0.45 || L > 0.6 ? 1 : 0) + (r(4) < 0.3 ? 1 : 0);
    for (let p = 0; p < patches; p++) {
      const big = w.length > 12 && topLow > 4;
      const pw = (big ? 3 : 1.4) + (big ? 4.5 : 2.8) * r(10 + p);
      const ph = (big ? 2 : 1.1) + (big ? 2 : 1.8) * r(20 + p);
      if (w.length < pw + 1.2 || topLow < ph + 2.4) continue;
      const kindRoll = r(30 + p);
      const wood = b.material === "wood";
      for (let t = 0; t < 4; t++) {
        const s0 = 0.5 + (w.length - pw - 1) * hash01(b.id * 13 + i * 3 + p * 5 + t, 5153);
        const y0 = 1.6 + (topLow - ph - 2.4) * hash01(b.id * 19 + i * 3 + p * 5 + t, 5154);
        if (!free(s0, s0 + pw, y0, y0 + ph)) continue;
        if (kindRoll < 0.6 || (dark && kindRoll < 0.8)) put(s0, y0, s0 + pw, y0 + ph, tone((dark ? 1.3 : 1.45) + 0.2 * r(40 + p), { wear: 0.04, wear2: 0 }));
        else if (kindRoll < 0.8 || !wood || L < 0.35) {
          // A leak's stain is taller than the patch asked for: the room it takes is looked for, so that no two sheets of one rank overlap.
          if (!free(s0, s0 + pw * 0.6, y0, y0 + ph * 1.5)) continue;
          put(s0, y0, s0 + pw * 0.6, y0 + ph * 1.5, tone(0.78 - 0.1 * L, { wear: 0.25, wearKind: "grime" }));
        }
        else {
          const pw2 = Math.min(pw, 1.3 + 0.9 * r(50 + p));
          const ph2 = Math.min(2.4, ph * 1.5);
          if (!free(s0, s0 + pw2, y0, y0 + ph2)) continue;
          wquad(out, w, s0, baseY + y0, s0 + pw2, baseY + y0 + ph2, OFF, [0.42, 0.31, 0.18], { layer: "plywood", frame: base.frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel", ...sky });
          placed.push({ s0, s1: s0 + pw2, y0, y1: y0 + ph2 });
        }
        break;
      }
    }

    // ---- a ghost sign on a masonry wall
    if ((b.material === "brick" || b.material === "concrete") && w.length > 7 && r(60) < 0.3) {
      const gw = Math.min(w.length - 2, 3 + 2 * r(61));
      const gh = 1.5 + 0.9 * r(62);
      for (let t = 0; t < 4; t++) {
        const s0 = 1 + (w.length - gw - 2) * hash01(b.id * 7 + i + t, 5155);
        const y0 = Math.max(2.2, topLow - gh - 0.9 - 1.6 * hash01(b.id * 11 + i + t, 5156));
        if (y0 + gh > topLow - 0.4 || !free(s0, s0 + gw, y0, y0 + gh)) continue;
        // The pale rectangle in rows: bare rows between the lines, and in each line the faded letters (darker) and the gaps between them (pale), so no face lies over another.
        const pale = tone(1.55, { wear: 0.03, wear2: 0 });
        const ink = tone(1.25, { wear: 0.03, wear2: 0 });
        const raw = (a: number, ya: number, e: number, yb: number, t: { colour: Rgb; surface: Surface }): void => {
          wquad(out, w, a, baseY + ya, e, baseY + yb, paintOff(TONE_RANK), t.colour, t.surface, { paint: TONE_RANK });
        };
        const lines = 2 + Math.floor(2 * r(63));
        let y = y0;
        for (let l = 0; l < lines; l++) {
          const ly = y0 + gh * (0.15 + (0.7 * l) / lines);
          const lh = (gh * 0.5) / lines;
          if (ly > y + 0.02) raw(s0, y, s0 + gw, ly, pale);
          let x = s0;
          while (x < s0 + gw - 0.02) {
            const letter = hash01(b.id * 29 + l * 9 + Math.floor(x * 4), 5158) < 0.6;
            const run = (letter ? 0.25 : 0.1) + 0.7 * hash01(b.id * 23 + l * 9 + Math.floor(x * 4), 5157);
            const e = Math.min(s0 + gw, x + run);
            raw(x, ly, e, ly + lh, letter && x > s0 + gw * 0.06 && e < s0 + gw * 0.94 ? ink : pale);
            x = e;
          }
          y = ly + lh;
        }
        if (y0 + gh > y + 0.02) raw(s0, y, s0 + gw, y0 + gh, pale);
        placed.push({ s0, s1: s0 + gw, y0, y1: y0 + gh });
        break;
      }
    }
    // ---- run-off below the parapet and the joints: on a light wall, broad dark stains; on a dark one, pale efflorescence in thin runs and rust-brown runs below fixings
    const runs = Math.floor((w.length / (dark ? 3.5 : 7)) * (0.5 + 1.2 * L) + r(70));
    for (let j = 0; j < runs; j++) {
      const rw = dark ? 0.3 + 0.6 * r(71 + j) : 0.6 + 1.3 * r(71 + j);
      const rh = Math.min(topLow - 2.5, (dark ? 1.8 : 2.8) + 4.5 * r(80 + j) * (0.5 + L));
      if (rh < 1.5 || w.length < rw + 1) continue;
      const s0 = 0.4 + (w.length - rw - 0.8) * hash01(b.id * 5 + i * 3 + j, 5160);
      const y1 = topLow - 1.3;
      if (!free(s0, s0 + rw, y1 - rh, y1)) continue;
      if (dark && r(110 + j) < 0.3) {
        // Rust-brown, from a fixing: narrow, ragged at its foot.
        wquad(out, w, s0, baseY + y1 - rh * 0.8, s0 + Math.min(rw, 0.3), baseY + y1, paintOff(TONE_RANK), [0.3, 0.15, 0.08], { layer: "siding_painted", frame: base.frame, wear: 0.1, wear2: 0, ...sky }, { paint: TONE_RANK });
        placed.push({ s0, s1: s0 + rw, y0: y1 - rh * 0.8, y1 });
        continue;
      }
      const half = rw * (0.35 + 0.3 * r(90 + j));
      const k = dark ? 1.4 + 0.3 * r(95 + j) : 0.8 - 0.14 * L - 0.06 * r(95 + j);
      const ov = dark ? { wear: 0.05, wear2: 0 } : { wear: 0.2, wearKind: "grime" as const, streaks: true };
      put(s0, y1 - rh, s0 + half, y1, tone(k, ov));
      const rh2 = rh * (0.55 + 0.6 * r(100 + j));
      put(s0 + half, y1 - rh2, s0 + rw, y1, tone(k * 1.03, ov));
    }

    // The lower band last: it takes what the patches and the runs leave.
    bandPass();
  });
}
