/**
 * The light of a designed room, baked into the colours of its vertices: what a room that a person stands in is lit by is its own lights, the day through the panes of its front, and a little
 * that bounces. It is meant to be uneven, as a real room is: a light's share at a distance is 1 / (1 + q)^2 with q the distance squared in its own reach squared, so a pool under each fixture is
 * bright and the floor two metres off is not; a face turned away from a light keeps a third; the day falls off with depth from the front's panes; and the room's own things throw shadows.
 *
 * There are no shadows in the renderer, so they are baked. For each light a coarse grid over the floor (cells of 0.5 m) says whether the light, seen from a probe 0.9 m up over the cell,
 * has any of the design's blocks that stand taller than 0.9 m between it and the cell (a column, a counter, a back bar, a booth's high back, a partition); the grid is blurred a little so that a shadow has a soft
 * edge, and each vertex reads its place in it, with the shadow fading out above 2.3 m (no block is taller). Under and beside everything that stands on the floor, in the corners where walls meet, at the foot and
 * head of a wall and behind what stands against it, the light is dimmer (`contact`). The lights are brought to an exposure by the brightest place on the floor (`Mood.exposure`), not the mean.
 *
 * The object it makes is a `RoomField` as well (the room kit's `shade`, `fbox` and the front wall's builder read one), with `lit` for a face whose way is known.
 */
import type { Block, Design } from "../../sim/inside/design.js";
import { FRONT_WALL } from "../../sim/inside/design.js";
import type { Rgb } from "./meshBuilder.js";
import type { RoomField } from "./roomLight.js";

/** The colour of an overcast day. */
const SKY: Rgb = [0.62, 0.68, 0.76];
const CORNER_DARK = 0.6;
const CORNER_REACH = 0.9;
const EDGE_DARK = 0.45;
const EDGE_REACH = 0.5;
/** The cell of a shadow grid, the height of the probe the shadows are cast to, and where a block's shadow fades out. */
const CELL = 0.5;
const PROBE = 0.9;
const SHADOW_TOP = 2.3;
/** The ambient a room keeps at night with its lamps the only light: faint, so that no room is void. */
const NIGHT_FLOOR = 0.008;
/** A light's contribution is dropped where its k (1 + q) is over this: a share of 1 in 625. */
const FAR = 25;

/** A pane the day comes through: along the front wall, and how much of the day it lets through (0 to 1). */
export type DayPane = { readonly s0: number; readonly s1: number; readonly through: number };

export type BakedLight = RoomField & {
  /** The light on a face at (s, d, y) whose unit normal is (ns, nd, ny), in the room's frame. The array is the light's own, reused: read it before the next call. */
  lit(s: number, d: number, y: number, ns: number, nd: number, ny: number): Rgb;
  /** The same face's colour at night (the lamps alone, and a faint floor of ambient): of the latest `lit` call, in an array of its own, reused. The panes give nothing at night. */
  night(): Rgb;
  /** The gain the lights were brought to. */
  readonly gain: number;
  /** Milliseconds the bake took to prepare (the shadow grids and the exposure). */
  readonly prepared: number;
};

/** Whether the segment from (s0, d0) to (s1, d1) at heights `y0` to `y1` passes through the block, seen in plan and in height. */
function crosses(b: Block, s0: number, d0: number, y0: number, s1: number, d1: number, y1: number): boolean {
  const ax = b.ax;
  const ad = b.ad;
  const px = (s0 - b.s) * ax + (d0 - b.d) * ad;
  const py = -(s0 - b.s) * ad + (d0 - b.d) * ax;
  const qx = (s1 - b.s) * ax + (d1 - b.d) * ad;
  const qy = -(s1 - b.s) * ad + (d1 - b.d) * ax;
  // A light inside a block's own footprint (a strip light in a back bar) is not shut out by it.
  if (Math.abs(px) < b.ha && Math.abs(py) < b.hb) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dy = qy - py;
  const clip = (p: number, q: number, lo: number, hi: number): boolean => {
    if (Math.abs(q) < 1e-9) return p >= lo && p <= hi;
    let a = (lo - p) / q;
    let c = (hi - p) / q;
    if (a > c) {
      const t = a;
      a = c;
      c = t;
    }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    return t0 <= t1;
  };
  if (!clip(px, dx, -b.ha, b.ha) || !clip(py, dy, -b.hb, b.hb)) return false;
  const hm = y0 + (y1 - y0) * ((t0 + t1) / 2);
  return hm > b.y0 - 0.05 && hm < b.y1 + 0.05;
}

export function bakeLight(design: Design, panes: readonly DayPane[]): BakedLight {
  const started = performance.now();
  const { lights, mood } = design;
  const W = design.width;
  const D = design.depth;
  const H = design.height;
  // What throws a shadow: blocks that stand taller than the probe.
  const tall = design.blocks.filter((b) => b.y1 > PROBE + 0.1);
  // What darkens the floor and the walls round it: everything that stands up from a floor a hand's breadth or more.
  const solid = design.blocks.filter((b) => b.y1 - b.y0 > 0.3 && b.ha * b.hb >= 0.02).map((b) => ({ b, r: Math.sqrt(b.ha * b.ha + b.hb * b.hb) + 0.55 }));
  // The storeys: which side of each cut a height is on.
  const cuts = design.cuts ?? [];
  const band = (y: number): number => {
    let n = 0;
    for (const c of cuts) if (y > c) n++;
    return n;
  };
  const lightBand = lights.map((l) => band(l.y));

  // ---- the shadow grids.
  const nS = Math.max(2, Math.ceil(W / CELL) + 1);
  const nD = Math.max(2, Math.ceil(D / CELL) + 1);
  const grids: (Float32Array | null)[] = lights.map((l, i) => {
    if (tall.length === 0) return null;
    const reach = l.reach * Math.sqrt(FAR - 1);
    const g = new Float32Array(nS * nD).fill(1);
    let any = false;
    const mine = lightBand[i] as number;
    const near = tall.filter((b) => (cuts.length === 0 || band((b.y0 + b.y1) / 2) === mine) && b.y0 < l.y);
    if (near.length === 0) return null;
    for (let j = 0; j < nD; j++) {
      const cd = j * CELL;
      if (Math.abs(cd - l.d) > reach) continue;
      for (let k = 0; k < nS; k++) {
        const cs = k * CELL;
        const dist = Math.hypot(cs - l.s, cd - l.d);
        if (dist > reach) continue;
        const probe = Math.min(PROBE + (cuts.length === 0 ? 0 : lightBand[i] === 0 ? 0 : design.cuts![0]! + 0.15), l.y);
        let seen = 1;
        for (const b of near) if (crosses(b, l.s, l.d, l.y, cs, cd, probe)) {
          seen = 0;
          break;
        }
        if (seen === 0) {
          g[j * nS + k] = 0;
          any = true;
        }
      }
    }
    if (!any) return null;
    // A little blur, so that a shadow has a soft edge.
    const out = new Float32Array(nS * nD);
    for (let j = 0; j < nD; j++) for (let k = 0; k < nS; k++) {
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const jj = j + dj;
        const kk = k + dk;
        if (jj < 0 || kk < 0 || jj >= nD || kk >= nS) continue;
        const w = dj === 0 && dk === 0 ? 2 : 1;
        sum += (g[jj * nS + kk] as number) * w;
        n += w;
      }
      out[j * nS + k] = sum / n;
    }
    return out;
  });
  /** How much of light `i` reaches the place (s, d) at height `y`: its grid there, fading out above where blocks stand. */
  const seen = (i: number, s: number, d: number, y: number): number => {
    const g = grids[i];
    if (g === null || g === undefined || y >= SHADOW_TOP) return 1;
    const u = Math.min(nS - 1.0001, Math.max(0, s / CELL));
    const v = Math.min(nD - 1.0001, Math.max(0, d / CELL));
    const a = Math.floor(u);
    const b = Math.floor(v);
    const fu = u - a;
    const fv = v - b;
    const o = b * nS + a;
    const vis = ((g[o] as number) * (1 - fu) + (g[o + 1] as number) * fu) * (1 - fv) + ((g[o + nS] as number) * (1 - fu) + (g[o + nS + 1] as number) * fu) * fv;
    const f = Math.min(1, Math.max(0, (SHADOW_TOP - y) / 1.7));
    return 1 - (1 - vis) * f;
  };

  const sum = (s: number, d: number, y: number, ns: number, nd: number, ny: number, out: [number, number, number]): void => {
    const mine = cuts.length === 0 ? 0 : band(y);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as (typeof lights)[number];
      if (cuts.length > 0 && lightBand[i] !== mine) continue;
      const dx = l.s - s;
      const dd = l.d - d;
      const dy = l.y - y;
      const q2 = dx * dx + dd * dd + dy * dy;
      const k = 1 + q2 / (l.reach * l.reach);
      if (k > FAR) continue;
      const len = Math.sqrt(q2) + 1e-4;
      const c = (ns * dx + nd * dd + ny * dy) / len;
      const wrap = 0.3 + 0.7 * (0.5 + 0.5 * c);
      let cone = 1;
      if (l.beam !== undefined) {
        // A downlight: the cosine from straight down to a power below its own height; a halo of a metre or so on what is above it.
        // A ceiling (facing down) is lit by the halo, anything else by the cone alone: the two never meet on one face, so no edge shows at the lamp's own height.
        cone = ny < -0.5 ? 0.9 * Math.exp(-(dx * dx + dd * dd) / 1.6) : Math.pow(Math.max(0, (l.y - y) / len), l.beam);
      }
      const a = (l.power * wrap * cone * seen(i, s, d, y)) / (k * k);
      out[0] += l.tone[0] * a;
      out[1] += l.tone[1] * a;
      out[2] += l.tone[2] * a;
    }
  };
  // The exposure: the brightest place on the floor, lit by every light and with no shadow, is brought to it.
  const tmp: [number, number, number] = [0, 0, 0];
  let peak = 0;
  for (let b = 0; b <= D * 2; b++) for (let a = 0; a <= W * 2; a++) {
    sum(a * 0.5, b * 0.5, 0.05, 0, 0, 1, tmp);
    peak = Math.max(peak, (tmp[0] + tmp[1] + tmp[2]) / 3);
  }
  const gain = peak > 1e-4 ? mood.exposure / peak : 1;
  const out: [number, number, number] = [0, 0, 0];
  const scratch: [number, number, number] = [0, 0, 0];
  const dayAt = (s: number, d: number): number => {
    let day = 0;
    for (const o of panes) {
      if (o.through <= 0) continue;
      const away = s < o.s0 ? o.s0 - s : s > o.s1 ? s - o.s1 : 0;
      const lateral = Math.max(0, 1 - away / (1.2 + d * 0.2));
      // The day falls off with depth: half of it by 2.4 m in, a quarter by 5 m.
      day += (o.through * lateral) / (1 + (d * d) / (2.4 * 2.4));
    }
    return Math.min(1.1, day);
  };
  const occlusion = (s: number, d: number, y: number, ny: number): number => {
    const eS = Math.min(s, W - s);
    const eD = Math.min(d - FRONT_WALL, D - d);
    const e = Math.max(0, Math.min(eS, eD));
    const c = Math.sqrt(Math.max(0, eS) * Math.max(0, eS) + Math.max(0, eD) * Math.max(0, eD));
    // The designs with a bounce are lit more evenly: their corners are darkened less and over a wider reach.
    const soft = mood.bounce !== undefined;
    let k = 1 - (soft ? 0.4 : CORNER_DARK) * Math.exp(-c / (soft ? 1.4 : CORNER_REACH));
    if (ny > 0.5 || ny < -0.5) k *= 1 - EDGE_DARK * Math.exp(-e / EDGE_REACH);
    else k *= (1 - EDGE_DARK * Math.exp(-Math.max(0, y) / EDGE_REACH)) * (1 - EDGE_DARK * Math.exp(-Math.max(0, H - y) / EDGE_REACH));
    return k;
  };
  /** The dark under and beside what stands on the floor: within half a metre of a block's footprint, under its top, the nearer the darker. */
  const contact = (s: number, d: number, y: number): number => {
    let k = 1;
    for (const o of solid) {
      const b = o.b;
      if (Math.abs(s - b.s) > o.r || Math.abs(d - b.d) > o.r) continue;
      if (y > b.y1 + 0.05 || y < b.y0 - 0.2) continue;
      const dx = s - b.s;
      const dz = d - b.d;
      const u = Math.abs(dx * b.ax + dz * b.ad);
      const v = Math.abs(-dx * b.ad + dz * b.ax);
      const dist = Math.sqrt(Math.max(0, u - b.ha) ** 2 + Math.max(0, v - b.hb) ** 2);
      const near = 1 - dist / 0.5;
      if (near <= 0) continue;
      // A table's top is dark under it but not on it; a wall's foot and a counter's side are dark close to the floor and lighter up.
      const up = Math.min(1, Math.max(0, 1 - (y - 0.05) / Math.max(0.4, b.y1)));
      // Fading out above 2.5 m, so that a tall wall shades smoothly over what stands against its foot.
      const high = Math.min(1, Math.max(0, (2.5 - y) / 1.0));
      k *= 1 - 0.6 * Math.min(1, near) * (0.35 + 0.65 * up) * high;
    }
    return Math.max(0.2, k);
  };
  // A pale ceiling gives light back (`Mood.bounce`): its level is a share of the floor's mean, set below once the floor has been sampled.
  let ceilBase = 0;
  let ceilRef = 1;
  // The room at night: the lamps alone, at the power they were designed at, and a faint ambient so that it is never pitch black (a room with its lamps out is dark, not void).
  let ceilNightK = 1;
  const nightAmbient = Math.min(mood.ambientK, 0.03) * 0.5 + NIGHT_FLOOR;
  const scratchN: [number, number, number] = [0, 0, 0];
  const lit = (s: number, d: number, y: number, ns: number, nd: number, ny: number): Rgb => {
    sum(s, d, y, ns, nd, ny, out);
    if (mood.bounce !== undefined && ny < -0.5 && ceilBase > 0) {
      // Evenly pale: between 0.82 and 1 of the base by how much of the lights' own light falls here, with no corner or edge darkening and no contact.
      const L = ((out[0] + out[1] + out[2]) / 3) * gain;
      const v = ceilBase * (0.82 + 0.18 * Math.min(1, L / ceilRef));
      scratch[0] = v * mood.ambient[0];
      scratch[1] = v * mood.ambient[1];
      scratch[2] = v * mood.ambient[2];
      // At night a ceiling holds only what the lamps give back: the day's level scaled by how much of the floor's light the lamps are.
      const vn = v * ceilNightK;
      scratchN[0] = vn * mood.ambient[0];
      scratchN[1] = vn * mood.ambient[1];
      scratchN[2] = vn * mood.ambient[2];
      return scratch;
    }
    const day = dayAt(s, d) * mood.day;
    const k = occlusion(s, d, y, ny) * contact(s, d, y);
    scratch[0] = (out[0] * gain + mood.ambient[0] * mood.ambientK + SKY[0] * day) * k;
    scratch[1] = (out[1] * gain + mood.ambient[1] * mood.ambientK + SKY[1] * day) * k;
    scratch[2] = (out[2] * gain + mood.ambient[2] * mood.ambientK + SKY[2] * day) * k;
    scratchN[0] = (out[0] * gain + mood.ambient[0] * nightAmbient) * k;
    scratchN[1] = (out[1] * gain + mood.ambient[1] * nightAmbient) * k;
    scratchN[2] = (out[2] * gain + mood.ambient[2] * nightAmbient) * k;
    return scratch;
  };
  let mean = 0;
  let meanNight = 0;
  let n = 0;
  for (let b = 0; b <= D * 2; b += 2) for (let a = 0; a <= W * 2; a += 2) {
    const c = lit(a * 0.5, b * 0.5, 0.05, 0, 0, 1);
    mean += (c[0] + c[1] + c[2]) / 3;
    meanNight += (scratchN[0] + scratchN[1] + scratchN[2]) / 3;
    n++;
  }
  mean = n > 0 ? mean / n : 0;
  meanNight = n > 0 ? meanNight / n : 0;
  ceilNightK = mean > 1e-6 ? Math.min(1, meanNight / mean) : 1;
  if (mood.bounce !== undefined) {
    // The ceiling's own reference: the most light any lamp throws on it, over the room's ceiling on a grid of half a metre.
    let top = 1e-4;
    for (let b = 0; b <= D * 2; b++) for (let a = 0; a <= W * 2; a++) {
      sum(a * 0.5, b * 0.5, (cuts[0] ?? H) - 0.2, 0, 0, -1, tmp);
      top = Math.max(top, ((tmp[0] + tmp[1] + tmp[2]) / 3) * gain);
    }
    ceilRef = top;
    ceilBase = mood.bounce;
  }
  return {
    gain,
    mean,
    dead: [],
    veil: [mean, mean, mean],
    lit,
    night: () => scratchN,
    prepared: performance.now() - started,
    at: (s, d, y, up) => lit(s, d, y, 0, 0, up),
    under: (s, d) => contact(s, d, 0.05),
  };
}
