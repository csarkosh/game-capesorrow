/**
 * The renderer's side of the lettering: paints each `SignRequest` of the atlas (`signAtlas.ts`) with a 2D canvas, from the `SignSpec` it
 * carries and the face, weight and colours `signStyle.ts` rolls for it. A sign says its plan's lines in capitals or as given, fitted to its
 * face, a letter at a time, so that wear can take the letters one by one.
 *
 * Forms: a hand-painted board's letters uneven (each a little off the line and the upright, a painted shadow), its border a pinstripe;
 * porcelain a two-colour enamel with a border; neon tubes (a pale core in a coloured stroke, with a halo when lit; when the sign is poor,
 * some letters dead and dark); a backlit box yellowed with age, letters missing and a panel cracked or gone when it is in poor condition;
 * vinyl cut letters, flat; gold leaf on a window in arcs; a sandwich board's chalk; the gas station's price rows; a ghost sign, large paint
 * on brick eaten away to a few strokes. Condition (0 gone, 1 new) fades the ground and the letters toward grey, peels bits of paint away
 * (to bare wood or, for paint on a wall, to nothing), runs rust and dirt streaks down from the top, and (neon and boxes) kills or drops letters.
 *
 * Without a canvas (a test, a worker without one), nothing is painted: `canPaint()` says so and the atlas's requests stand as the record of what the
 * signs say. The paint is deterministic (a generator seeded from the sign's number), and is the same on every machine that has a canvas.
 */
import type { SignRequest } from "./signAtlas.js";
import { FACE_STACKS, lookOf, type Rgb255 } from "./signStyle.js";

type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface2 = { readonly ctx: Ctx2; readonly width: number; readonly height: number };

/** A 2D canvas of this size, or null where there is none. */
export function createPaintSurface(width: number, height: number): Surface2 | null {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
      if (ctx !== null) return { ctx, width, height };
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (ctx !== null) return { ctx, width, height };
    }
  } catch {
    // No canvas: the town is built without lettering.
  }
  return null;
}

/** A generator of numbers in [0, 1) from a seed (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (c: Rgb255, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix = (a: Rgb255, b: Rgb255, t: number): Rgb255 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const GREY: Rgb255 = [128, 124, 116];

type Char = { ch: string; x: number; w: number };

/** The characters of a line at `size` px in the context's current font, with `track` px between: each one's left edge and advance. */
function layout(ctx: Ctx2, text: string, track: number): { chars: Char[]; width: number } {
  const chars: Char[] = [];
  let x = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    chars.push({ ch, x, w });
    x += w + track;
  }
  return { chars, width: Math.max(0, x - track) };
}

/** Paints one request into the surface. */
export function paintRequest(surface: Surface2, req: SignRequest): void {
  const ctx = surface.ctx;
  const { x, y, w, h, spec } = req;
  const r = rng(spec.seed * 2654435761);
  const look = lookOf(spec);
  const cond = Math.max(0, Math.min(1, spec.condition));
  const stack = FACE_STACKS[look.face];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  ctx.clearRect(0, 0, w, h);
  const age = 1 - cond;
  const neon = spec.style === "neon and porcelain";
  const box = spec.style === "backlit box";
  const lit = spec.lit;
  // The ground.
  let bg: Rgb255 = spec.bg;
  let fg: Rgb255 = spec.fg;
  if (spec.style === "hand-painted" || spec.kind === "ghost") {
    bg = mix(bg, GREY, age * 0.45);
    fg = mix(fg, GREY, age * 0.5);
  } else if (box) {
    // The plastic yellows with the years and a panel of it fades.
    bg = mix(bg, [226, 200, 130], age * 0.7);
    fg = mix(fg, [60, 50, 40], age * 0.3);
  } else if (spec.style === "vinyl") {
    bg = mix(bg, GREY, age * 0.3);
  }
  if (!spec.clear) {
    ctx.fillStyle = css(bg);
    ctx.fillRect(0, 0, w, h);
    if (spec.style === "hand-painted" || (neon && !lit && cond > 0)) {
      // Pinstripe border.
      ctx.strokeStyle = css(spec.accent, 0.9 - age * 0.4);
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h * 0.86);
    }
  }
  const text = (s: string): string => (look.caps ? s.toUpperCase() : s);
  const lines = spec.lines.map(text).filter((l) => l.length > 0);
  const pad = Math.max(2, h * 0.1);
  const areaW = w - pad * 2;
  const areaH = h - pad * 2;

  const gas = spec.kind === "pole" && lines.length >= 4 && (spec.lines[1] ?? "").toUpperCase().startsWith("REGULAR");
  if (gas) {
    paintGas(ctx, w, h, spec.lines, spec.fg, spec.bg, spec.accent, lit, stack);
  } else if (lines.length > 0) {
    const n = lines.length;
    // Sizes: the first line larger when there are several; each shrunk to fit.
    const weights = lines.map((_, k) => (n > 1 && k === 0 ? 1.35 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let yy = pad;
    lines.forEach((line, k) => {
      const share = (areaH * (weights[k] as number)) / total;
      let size = Math.min(share * 0.82, areaH * 0.78);
      ctx.font = `${look.italic ? "italic " : ""}${look.weight} ${size}px ${stack}`;
      const track0 = size * (look.face === "block" ? 0.04 : neon ? 0.06 : 0.02);
      let lay = layout(ctx, line, track0);
      if (lay.width > areaW) {
        size *= areaW / lay.width;
        ctx.font = `${look.italic ? "italic " : ""}${look.weight} ${size}px ${stack}`;
        lay = layout(ctx, line, size * 0.03);
      }
      const x0 = look.left ? pad : (w - lay.width) / 2;
      const cy = yy + share / 2;
      ctx.textBaseline = "middle";
      let ink = fg;
      if (spec.clear && spec.kind === "glass") ink = spec.style === "hand-painted" ? [214, 176, 70] : [244, 244, 240];
      if (spec.kind === "ghost" || (spec.clear && spec.kind === "wall")) ink = spec.style === "hand-painted" ? [236, 228, 206] : [230, 226, 214];
      const arc = spec.kind === "glass" && spec.style === "hand-painted" ? size * 3 + w * 0.6 : 0;
      lay.chars.forEach((c, ci) => {
        // A dead letter: a tube out, a letter of a box fallen off.
        if (cond < 0.5 && (neon || box) && r() < (0.5 - cond) * 0.9) {
          if (neon) {
            ctx.fillStyle = css(mix(ink, [40, 40, 44], 0.85), 0.5);
            ctx.fillText(c.ch, x0 + c.x, cy);
          }
          return;
        }
        ctx.save();
        const px = x0 + c.x + c.w / 2;
        let py = cy;
        let rot = 0;
        if (arc > 0) {
          // Gold leaf on a window is set on an arc.
          const t = (c.x + c.w / 2 - lay.width / 2) / arc;
          rot = t * 1.1;
          py += (1 - Math.cos(t)) * arc * 0.5 * (k === 0 ? 1 : -0.3) * 0.4;
        } else if (look.uneven) {
          rot = (r() - 0.5) * 0.07;
          py += (r() - 0.5) * size * 0.07;
        }
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.textAlign = "center";
        if (neon) {
          // The tube: a thick coloured stroke with a pale core, and a halo while it is lit.
          ctx.lineJoin = "round";
          if (lit) {
            ctx.shadowColor = css(ink);
            ctx.shadowBlur = size * 0.35;
          }
          ctx.strokeStyle = css(lit ? ink : mix(ink, [60, 60, 66], 0.65));
          ctx.lineWidth = Math.max(1.5, size * 0.1);
          ctx.strokeText(c.ch, 0, 0);
          ctx.shadowBlur = 0;
          ctx.fillStyle = css(lit ? mix(ink, [255, 255, 255], 0.65) : mix(ink, [90, 90, 96], 0.55));
          ctx.fillText(c.ch, 0, 0);
        } else {
          if (look.uneven && spec.kind !== "ghost" && !spec.clear) {
            // A painted shadow, a hair off.
            ctx.fillStyle = css(spec.accent, 0.55 * cond);
            ctx.fillText(c.ch, size * 0.03, size * 0.04);
          }
          ctx.fillStyle = css(ink);
          ctx.fillText(c.ch, 0, 0);
        }
        ctx.restore();
      });
      yy += share;
    });
  }
  wear(ctx, w, h, spec, r, cond, bg, spec.clear);
  ctx.restore();
}

/** A gas station's price sign: the brand over a band, then a row for each grade with the price in a black box. */
function paintGas(ctx: Ctx2, w: number, h: number, lines: readonly string[], fg: Rgb255, bg: Rgb255, accent: Rgb255, lit: boolean, stack: string): void {
  const head = h * 0.28;
  ctx.fillStyle = css(accent);
  ctx.fillRect(0, 0, w, head);
  ctx.font = `700 ${head * 0.58}px ${stack}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = css(mix(fg, [255, 255, 255], 0.6));
  let size = head * 0.58;
  const brand = (lines[0] ?? "").toUpperCase();
  const mw = ctx.measureText(brand).width;
  if (mw > w * 0.9) {
    size *= (w * 0.9) / mw;
    ctx.font = `700 ${size}px ${stack}`;
  }
  ctx.fillText(brand, w / 2, head / 2);
  const rows = lines.slice(1, 5);
  const rh = (h - head) / Math.max(1, rows.length);
  rows.forEach((row, k) => {
    const [label, price] = [row.slice(0, row.lastIndexOf(" ")), row.slice(row.lastIndexOf(" ") + 1)];
    const cy = head + rh * (k + 0.5);
    ctx.font = `700 ${rh * 0.34}px ${stack}`;
    ctx.textAlign = "left";
    ctx.fillStyle = css(bg[0] > 128 ? [20, 20, 24] : [245, 245, 240]);
    ctx.fillText(label, w * 0.06, cy);
    ctx.fillStyle = "rgb(12,12,14)";
    ctx.fillRect(w * 0.55, cy - rh * 0.36, w * 0.4, rh * 0.72);
    ctx.font = `700 ${rh * 0.5}px "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = lit ? "rgb(255,210,70)" : "rgb(150,130,70)";
    ctx.fillText(price, w * 0.75, cy);
  });
}

/** What the years do: peeling, streaks of rust and dirt, specks, a cracked or missing panel. */
function wear(ctx: Ctx2, w: number, h: number, spec: SignRequest["spec"], r: () => number, cond: number, bg: Rgb255, clear: boolean): void {
  const age = 1 - cond;
  if (spec.kind === "open" || spec.kind === "lease") return;
  const area = w * h;
  // Peeling: patches of paint gone to bare wood (or, paint on a wall and lettering on glass, to nothing).
  const patches = Math.floor(age * age * area / 260 + (spec.kind === "ghost" ? area / 140 : 0));
  for (let k = 0; k < patches; k++) {
    const pw = 2 + r() * Math.min(26, w * 0.12) * (spec.kind === "ghost" ? 1.6 : 1);
    const ph = 2 + r() * Math.min(14, h * 0.2);
    const px = r() * w;
    const py = r() * h;
    if (clear || spec.kind === "ghost") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillRect(px, py, pw, ph);
      ctx.globalCompositeOperation = "source-over";
    } else if (spec.style === "hand-painted") {
      ctx.fillStyle = css(mix([150, 130, 100], bg, 0.2), 0.9);
      ctx.fillRect(px, py, pw, ph);
    }
  }
  if (spec.kind === "ghost") {
    // Washed to a ghost: the whole painting thinned.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${0.35 + age * 0.45})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  // Streaks down from the top: rust from the fixings of a metal or old board, dirt on the rest.
  if (!clear && age > 0.25) {
    const n = Math.floor(2 + age * 7);
    for (let k = 0; k < n; k++) {
      const sx = r() * w;
      const len = h * (0.3 + r() * 0.7);
      const gr = ctx.createLinearGradient(0, 0, 0, len);
      const rust = spec.style === "hand-painted" || spec.style === "neon and porcelain";
      gr.addColorStop(0, rust ? `rgba(120,60,28,${0.25 * age + 0.05})` : `rgba(70,64,56,${0.2 * age})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(sx, 0, Math.max(1, w * 0.01 + r() * 3), len);
    }
    // A grimy lower edge.
    const g2 = ctx.createLinearGradient(0, h * 0.7, 0, h);
    g2.addColorStop(0, "rgba(40,36,30,0)");
    g2.addColorStop(1, `rgba(40,36,30,${0.35 * age})`);
    ctx.fillStyle = g2;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }
  // A cracked or gone panel of a backlit box in poor condition.
  if (spec.style === "backlit box" && cond < 0.4 && !clear) {
    const pw = w * (0.18 + r() * 0.2);
    const px = r() * (w - pw);
    if (cond < 0.25) {
      ctx.fillStyle = "rgb(24,22,20)";
      ctx.fillRect(px, h * 0.08, pw, h * 0.84);
    }
    ctx.strokeStyle = "rgba(20,20,20,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.2, h * 0.1);
    ctx.lineTo(px + pw * 0.5, h * 0.5);
    ctx.lineTo(px + pw * 0.35, h * 0.9);
    ctx.moveTo(px + pw * 0.5, h * 0.5);
    ctx.lineTo(px + pw * 0.9, h * 0.6);
    ctx.stroke();
  }
}
