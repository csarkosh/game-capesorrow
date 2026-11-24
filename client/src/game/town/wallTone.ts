/**
 * A big wall's tone at the scale of metres, laid over its surface as flat decals 3 cm off the face (the ledger, `faceLedger.ts`, keeps them clear of what else
 * hangs there): from 60 m the texture and the streaks are fine detail and a wall reads as one flat tone unless it has large shapes of its own.
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
import { wquad, type Hole, type WallRef } from "./buildingKit.js";
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

const OFF = 0.03;

export function wallTone(c: WallToneCtx): void {
  const { out, b, baseY } = c;
  const L = levelOf(b);
  const { age } = agingOf(b);
  c.walls.forEach((w, i) => {
    if (b.state === "ruin") return;
    const topLow = Math.min((c.tops[i] as readonly [number, number])[0], (c.tops[i] as readonly [number, number])[1]) - baseY;
    if (w.length < 5 || topLow < 3 || w.length * topLow < 36) return;
    const holes = c.holes[i] ?? [];
    const free = (s0: number, s1: number, y0: number, y1: number): boolean => !holes.some((h) => h.s0 < s1 + 0.25 && h.s1 > s0 - 0.25 && h.y0 < baseY + y1 + 0.25 && h.y1 > baseY + y0 - 0.25);
    const base = c.surfaceOf(w, 1);
    const r = (k: number): number => hash01(b.id * 31 + i * 7 + k, 5151);
    /** The wall's own surface and colour, scaled in tone by `k`. */
    const tone = (k: number, over?: Partial<Surface>): { colour: Rgb; surface: Surface } => ({
      colour: scaled(c.colour, k),
      surface: { ...base, ...(c.paint || base.tint === undefined ? {} : { tint: scaled(base.tint, k) }), ...(over ?? {}) },
    });
    const put = (s0: number, y0: number, s1: number, y1: number, t: { colour: Rgb; surface: Surface }): void => {
      wquad(out, w, s0, baseY + y0, s1, baseY + y1, OFF, t.colour, t.surface);
    };

    // ---- the dark lower third, with a ragged top
    if (r(1) < 0.8 + 0.2 * L) {
      const piece = c.low ? 12 : 4.5;
      const n = Math.max(1, Math.ceil(w.length / piece));
      const reach = Math.min(4.4, topLow * (0.3 + 0.12 * L + 0.08 * r(2)));
      const k = 1 - (0.18 + 0.3 * L) * (0.8 + 0.4 * r(3));
      for (let j = 0; j < n; j++) {
        const s0 = (w.length * j) / n;
        const s1 = (w.length * (j + 1)) / n;
        const hgt = Math.max(1.2, reach * (0.65 + 0.7 * hash01(b.id * 17 + i * 5 + j, 5152)));
        if (!free(s0, s1, 0, hgt)) continue;
        put(s0, 0.02, s1, hgt, tone(k));
      }
    }
    if (c.low) return;

    // ---- run-off: broad vertical stains from the roofline down, where the gutter overflowed or the parapet leaks, ragged at the bottom
    const runs = Math.floor((w.length / 7) * (0.5 + 1.2 * L) + r(70));
    for (let j = 0; j < runs; j++) {
      const rw = 0.6 + 1.3 * r(71 + j);
      const rh = Math.min(topLow - 1.2, 2.8 + 4.5 * r(80 + j) * (0.5 + L));
      if (rh < 1.5 || w.length < rw + 1) continue;
      const s0 = 0.4 + (w.length - rw - 0.8) * hash01(b.id * 5 + i * 3 + j, 5160);
      const y1 = topLow - 0.15;
      if (!free(s0, s0 + rw, y1 - rh, y1)) continue;
      // Two columns of the stain, the second shorter or longer: a stepped, wandering foot.
      const half = rw * (0.35 + 0.3 * r(90 + j));
      const k = 0.8 - 0.14 * L - 0.06 * r(95 + j);
      put(s0, y1 - rh, s0 + half, y1, tone(k, { wear: 0.2, wearKind: "grime", streaks: true }));
      const rh2 = rh * (0.55 + 0.6 * r(100 + j));
      put(s0 + half, y1 - rh2, s0 + rw, y1, tone(k * 1.05, { wear: 0.2, wearKind: "grime", streaks: true }));
    }

    // ---- patches: a repaint, a leak's stain, a sheet of plywood
    const patches = 1 + (age > 0.45 || L > 0.6 ? 1 : 0) + (r(4) < 0.3 ? 1 : 0);
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
        if (kindRoll < 0.6) put(s0, y0, s0 + pw, y0 + ph, tone(1.45 + 0.2 * r(40 + p), { wear: 0.04, wear2: 0 }));
        else if (kindRoll < 0.8 || !wood || L < 0.35) put(s0, y0, s0 + pw * 0.6, y0 + ph * 1.5, tone(0.78 - 0.1 * L, { wear: 0.25, wearKind: "grime" }));
        else {
          const pw2 = Math.min(pw, 1.3 + 0.9 * r(50 + p));
          wquad(out, w, s0, baseY + y0, s0 + pw2, baseY + y0 + Math.min(2.4, ph * 1.5), OFF, [0.42, 0.31, 0.18], { layer: "plywood", frame: base.frame, tint: [2.2, 2.2, 2.2], wear: 0.2, wearKind: "peel" });
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
        put(s0, y0, s0 + gw, y0 + gh, tone(1.55, { wear: 0.03, wear2: 0 }));
        // The faded lines of lettering: darker bars, broken, each pushed a step out by the ledger.
        const lines = 2 + Math.floor(2 * r(63));
        for (let l = 0; l < lines; l++) {
          const ly = y0 + gh * (0.15 + (0.7 * l) / lines);
          const lh = (gh * 0.5) / lines;
          let x = s0 + gw * 0.08;
          while (x < s0 + gw * 0.92) {
            const run = 0.25 + 0.7 * hash01(b.id * 23 + l * 9 + Math.floor(x * 4), 5157);
            const e = Math.min(s0 + gw * 0.92, x + run);
            if (hash01(b.id * 29 + l * 9 + Math.floor(x * 4), 5158) < 0.7) put(x, ly, e, ly + lh, tone(1.25, { wear: 0.03, wear2: 0 }));
            x = e + 0.12 + 0.2 * hash01(b.id * 31 + l * 9 + Math.floor(x * 4), 5159);
          }
        }
        break;
      }
    }
  });
}
