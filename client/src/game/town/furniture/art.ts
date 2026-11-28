/**
 * Pictures, many kinds of them: a framed picture is one of eleven scenes chosen by a hash of the picture's number and the room's seed (so the next picture on a wall is another), coloured by hash, each in a frame with a
 * mount, of the size the design hangs it at (tall or wide): a seascape, a forest, a mountain and lake, a lighthouse, a boat, an abstract of blocks, a black-and-white street, a map of a coast, a botanical, a round mirror, a
 * night harbour. Each is a handful of flat polygons, 80 to 200 vertices with its frame.
 */
import type { Decor } from "../../../sim/inside/design.js";
import { hash01, type Rgb } from "../meshBuilder.js";
import type { Geo, Local } from "./kit.js";

/** How many kinds of picture there are. */
export const ART_KINDS = 11;

const quad = (L: Local, f: number, r0: number, r1: number, y0: number, y1: number, tint: Rgb, glow?: number): void =>
  L.poly([[f, r0, y0], [f, r1, y0], [f, r1, y1], [f, r0, y1]], [1, 0, 0], "painted", glow === undefined ? { tint } : { tint, glow });
const tri = (L: Local, f: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], tint: Rgb): void => L.poly([[f, a[0], a[1]], [f, b[0], b[1]], [f, c[0], c[1]]], [1, 0, 0], "painted", { tint });
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** A framed picture: its kind from `dc.id` and the room's seed, in a frame of timber, brass or white with a mount round it. */
export function art(g: Geo, dc: Decor): void {
  const L = g.at(dc.s, dc.d, dc.face);
  const h = (n: number): number => hash01(dc.id * 17 + g.seed + n, 120 + n);
  // Consecutive pictures differ by 5 of the 11 kinds, so no two neighbours are alike.
  const kind = (dc.id * 5 + (g.seed % ART_KINDS)) % ART_KINDS;
  const w = dc.w / 2;
  const hh = dc.h / 2;
  const y0 = dc.y - hh;
  const y1 = dc.y + hh;
  const frames: [string, Rgb][] = [["dark_wood", [0.9, 0.9, 0.9]], ["brass", [0.8, 0.8, 0.8]], ["painted", [1.4, 1.4, 1.35]], ["oak", [1.0, 0.8, 0.6]]];
  const [fm, ft] = frames[Math.floor(h(2) * frames.length)] as [string, Rgb];
  L.box(0, 0.03, -w, w, y0, y1, fm, { tint: ft }, false);
  // The mount, then the picture inside it.
  const m = 0.05 + 0.04 * h(3);
  quad(L, 0.0345, -w + 0.025, w - 0.025, y0 + 0.025, y1 - 0.025, [1.25, 1.22, 1.15]);
  const a = -w + 0.025 + m;
  const b = w - 0.025 - m;
  const lo = y0 + 0.025 + m;
  const hi = y1 - 0.025 - m;
  const pw = b - a;
  const ph = hi - lo;
  const f = 0.039;
  const sky = mix([0.5, 0.65, 0.8], [0.9, 0.7, 0.6], h(4));
  const sea = mix([0.15, 0.35, 0.5], [0.1, 0.3, 0.35], h(5));
  switch (kind) {
    case 0: {
      // A seascape: sky, a band of sea, a shore, a headland.
      quad(L, f, a, b, lo + ph * 0.45, hi, sky);
      quad(L, f, a, b, lo + ph * 0.15, lo + ph * 0.45, sea);
      quad(L, f, a, b, lo, lo + ph * 0.15, [0.7, 0.62, 0.45]);
      tri(L, f + 0.0035, [a, lo + ph * 0.3], [a + pw * 0.45, lo + ph * 0.3], [a + pw * 0.1, lo + ph * 0.62], [0.2, 0.3, 0.2]);
      break;
    }
    case 1: {
      // A forest: sky, a dark ground, vertical trunks in warm browns and blue-green leaves.
      quad(L, f, a, b, lo, hi, [0.35, 0.55, 0.6]);
      quad(L, f + 0.0035, a, b, lo, lo + ph * 0.3, [0.12, 0.3, 0.28]);
      for (let k = 0; k < 6; k++) {
        const r = a + 0.06 + (k + h(10 + k) * 0.5) * ((pw - 0.12) / 6);
        const t = 0.012 + 0.02 * h(20 + k);
        quad(L, f + 0.007, r - t, r + t, lo, hi, [0.5 + 0.2 * h(30 + k), 0.22, 0.12]);
      }
      break;
    }
    case 2: {
      // A mountain and a lake.
      quad(L, f, a, b, lo + ph * 0.3, hi, sky);
      tri(L, f + 0.0035, [a, lo + ph * 0.3], [a + pw * 0.6, lo + ph * 0.3], [a + pw * 0.28, hi - ph * 0.1], [0.35, 0.42, 0.55]);
      tri(L, f + 0.007, [a + pw * 0.4, lo + ph * 0.3], [b, lo + ph * 0.3], [a + pw * 0.72, hi - ph * 0.25], [0.28, 0.35, 0.48]);
      tri(L, f + 0.0105, [a + pw * 0.2, hi - ph * 0.25], [a + pw * 0.36, hi - ph * 0.25], [a + pw * 0.28, hi - ph * 0.1], [0.95, 0.95, 0.95]);
      quad(L, f, a, b, lo, lo + ph * 0.3, [0.2, 0.4, 0.55]);
      break;
    }
    case 3: {
      // A lighthouse on a point: sky, sea, a rock and a white tower with a red band and a lamp.
      quad(L, f, a, b, lo + ph * 0.2, hi, mix(sky, [0.3, 0.35, 0.5], 0.5));
      quad(L, f, a, b, lo, lo + ph * 0.2, sea);
      tri(L, f + 0.0035, [a + pw * 0.45, lo], [b, lo], [b, lo + ph * 0.3], [0.3, 0.28, 0.25]);
      L.poly([[f + 0.007, a + pw * 0.66, lo + ph * 0.2], [f + 0.007, a + pw * 0.8, lo + ph * 0.2], [f + 0.007, a + pw * 0.77, lo + ph * 0.75], [f + 0.007, a + pw * 0.69, lo + ph * 0.75]], [1, 0, 0], "painted", { tint: [1.5, 1.5, 1.45] });
      quad(L, f + 0.0105, a + pw * 0.675, a + pw * 0.785, lo + ph * 0.42, lo + ph * 0.54, [1.4, 0.2, 0.15]);
      quad(L, f + 0.0105, a + pw * 0.69, a + pw * 0.77, lo + ph * 0.75, lo + ph * 0.82, [1.4, 1.2, 0.5], 1);
      break;
    }
    case 4: {
      // A boat: sky, sea, a dark hull and a white sail.
      quad(L, f, a, b, lo + ph * 0.3, hi, sky);
      quad(L, f, a, b, lo, lo + ph * 0.3, sea);
      L.poly([[f + 0.0035, a + pw * 0.2, lo + ph * 0.28], [f + 0.0035, a + pw * 0.8, lo + ph * 0.28], [f + 0.0035, a + pw * 0.7, lo + ph * 0.18], [f + 0.0035, a + pw * 0.3, lo + ph * 0.18]], [1, 0, 0], "painted", { tint: [0.25, 0.1, 0.08] });
      tri(L, f + 0.007, [a + pw * 0.48, lo + ph * 0.3], [a + pw * 0.48, hi - ph * 0.1], [a + pw * 0.75, lo + ph * 0.3], [1.4, 1.4, 1.35]);
      tri(L, f + 0.007, [a + pw * 0.44, lo + ph * 0.3], [a + pw * 0.44, hi - ph * 0.25], [a + pw * 0.28, lo + ph * 0.3], [1.2, 1.15, 1.05]);
      break;
    }
    case 5: {
      // An abstract: three big blocks of colour.
      const pal: Rgb[] = [[0.08, 0.4, 0.45], [0.85, 0.6, 0.1], [0.55, 0.15, 0.12], [0.2, 0.3, 0.55], [0.25, 0.45, 0.2], [0.9, 0.85, 0.7]];
      quad(L, f, a, b, lo, hi, pal[Math.floor(h(6) * 6)] as Rgb);
      quad(L, f + 0.0035, a + pw * 0.1, a + pw * 0.62, lo + ph * 0.15, lo + ph * 0.7, pal[Math.floor(h(7) * 6)] as Rgb);
      quad(L, f + 0.007, a + pw * 0.45, b - pw * 0.08, lo + ph * 0.4, hi - ph * 0.1, pal[Math.floor(h(8) * 6)] as Rgb);
      break;
    }
    case 6: {
      // A black and white street of an old town: grey sky and a few buildings in grey tones with windows.
      quad(L, f, a, b, lo, hi, [0.75, 0.75, 0.75]);
      const n = 4;
      for (let k = 0; k < n; k++) {
        const x0 = a + (k * pw) / n;
        const x1 = a + ((k + 1) * pw) / n - 0.01;
        const top = lo + ph * (0.45 + 0.4 * h(40 + k));
        const g1 = 0.2 + 0.3 * h(50 + k);
        quad(L, f + 0.0035, x0, x1, lo, top, [g1, g1, g1]);
        for (let wy = 0; wy < 2; wy++) quad(L, f + 0.007, x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.7, lo + ph * 0.15 + wy * ph * 0.22, lo + ph * 0.27 + wy * ph * 0.22, [0.08, 0.08, 0.08]);
      }
      break;
    }
    case 7: {
      // A map of a coast: pale paper, the sea along one side, the land, a road and red pins.
      quad(L, f, a, b, lo, hi, [0.85, 0.8, 0.65]);
      L.poly([[f + 0.0035, a, lo], [f + 0.0035, a + pw * 0.45, lo], [f + 0.0035, a + pw * 0.35, lo + ph * 0.5], [f + 0.0035, a + pw * 0.5, hi], [f + 0.0035, a, hi]], [1, 0, 0], "painted", { tint: [0.5, 0.62, 0.7] });
      quad(L, f + 0.007, a + pw * 0.55, a + pw * 0.58, lo, hi, [0.35, 0.33, 0.3]);
      for (let k = 0; k < 3; k++) quad(L, f + 0.0105, a + pw * (0.6 + 0.12 * k), a + pw * (0.6 + 0.12 * k) + 0.04, lo + ph * (0.25 + 0.2 * k), lo + ph * (0.25 + 0.2 * k) + 0.04, [0.75, 0.1, 0.08]);
      break;
    }
    case 8: {
      // A botanical: a pale ground, a stem and leaves in two greens.
      quad(L, f, a, b, lo, hi, [0.95, 0.93, 0.85]);
      const mid = (a + b) / 2;
      quad(L, f + 0.0035, mid - 0.008, mid + 0.008, lo + ph * 0.05, hi - ph * 0.1, [0.25, 0.4, 0.2]);
      for (let k = 0; k < 4; k++) {
        const y = lo + ph * (0.2 + 0.18 * k);
        const side = k % 2 === 0 ? 1 : -1;
        tri(L, f + 0.007, [mid, y], [mid + side * pw * 0.38, y + ph * 0.08], [mid, y + ph * 0.1], mix([0.2, 0.45, 0.2], [0.35, 0.55, 0.25], h(60 + k)));
      }
      break;
    }
    case 9: {
      // A round mirror: a dark glass in a round frame.
      const ring = (r: number, f2: number): [number, number, number][] => Array.from({ length: 12 }, (_, i) => [f2, (a + b) / 2 + Math.cos((i / 12) * Math.PI * 2) * r, (lo + hi) / 2 + Math.sin((i / 12) * Math.PI * 2) * r]);
      const r = Math.min(pw, ph) / 2;
      L.poly(ring(r, f), [1, 0, 0], "brass", { tint: [0.9, 0.9, 0.9] });
      L.poly(ring(r * 0.88, f + 0.0035), [1, 0, 0], "glass", { tint: [0.22, 0.25, 0.25] });
      quad(L, f + 0.007, (a + b) / 2 - r * 0.5, (a + b) / 2 - r * 0.3, (lo + hi) / 2 - r * 0.1, (lo + hi) / 2 + r * 0.5, [0.55, 0.58, 0.56]);
      break;
    }
    default: {
      // A harbour at night: a dark sky, a dark sea, boats' lights.
      quad(L, f, a, b, lo + ph * 0.35, hi, [0.06, 0.08, 0.2]);
      quad(L, f, a, b, lo, lo + ph * 0.35, [0.04, 0.12, 0.22]);
      for (let k = 0; k < 4; k++) quad(L, f + 0.0035, a + pw * (0.15 + 0.22 * k), a + pw * (0.15 + 0.22 * k) + 0.03, lo + ph * (0.38 + 0.05 * h(70 + k)), lo + ph * (0.38 + 0.05 * h(70 + k)) + 0.03, [1.5, 1.2, 0.5], 1);
    }
  }
}
