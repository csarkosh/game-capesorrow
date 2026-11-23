/**
 * The light in a room, baked: what a person at the glass sees of a room is its own lights, the day coming in at the front, and a little
 * that bounces. This builds that as a field over the room's plan (a lattice of colours, `roomField`), which the room's surfaces and
 * furnishings are lit from at their corners (`at`), so that an open shop is warm and brightest under its tubes, a failed tube leaves a
 * dim patch, the day fades with depth from the glass, a shut shop is dim with one night light and a vacant one is grey and bare. The
 * furnishings darken the floor beneath them (`under`).
 *
 * What the plan causes: which lights are on, whether the unit is open, shut or vacant, where the openings are and what covers each
 * (a papered or blinded opening lets in less day). What is authored: the strengths and the colours of each kind of light, the day's
 * colour (an overcast sky's, cool and grey) and its reach, how often a tube has failed (more in an old unit with many tenants behind it),
 * and the exposure each state is brought to.
 */
import { hash01, type Rgb } from "./meshBuilder.js";
import type { Furnishing, RoomLight } from "../../sim/town/types.js";

export type DayOpening = { readonly s0: number; readonly s1: number; /** How much of the day the opening lets in, 0 to 1 (paper, blinds, boards). */ readonly through: number };

export type FieldIn = {
  readonly s0: number;
  readonly s1: number;
  readonly depth: number;
  readonly ceiling: number;
  readonly lights: readonly RoomLight[];
  readonly openings: readonly DayOpening[];
  readonly lit: boolean;
  readonly vacant: boolean;
  readonly furnishings: readonly Furnishing[];
  readonly seed: number;
  /** How likely a tube is to have failed (0 to 1). */
  readonly wear: number;
  /** The lattice's spacing, metres. */
  readonly step: number;
  /** The glow of a lamp in the back room, seen through the doorway at the back (null for none), s along the room. */
  readonly backLamp: number | null;
};

export type RoomField = {
  /** The light at a point of the room (`s` along, `d` in, `y` over the floor) on a surface that faces `up` (1 a floor, 0 a wall, -1 a ceiling). The array is the field's own, reused: read it before the next call. */
  at(s: number, d: number, y: number, up: number): Rgb;
  /** How much of the floor's light is left at a point after the furnishings' shadows, 0.35 to 1. */
  under(s: number, d: number): number;
  /** Which of the plan's lights are dead (a failed tube), by index. */
  readonly dead: readonly boolean[];
  /** The mean light on the floor, for tests and for looking at. */
  readonly mean: number;
};

const SKY: Rgb = [0.62, 0.68, 0.76];
const TUBE: Rgb = [0.93, 1.0, 1.0];
const WARM: Rgb = [1.0, 0.8, 0.52];
const NEON: readonly Rgb[] = [[1, 0.2, 0.15], [0.25, 0.55, 1], [1, 0.5, 0.15], [0.3, 1, 0.45]];

const lightColour = (l: RoomLight, seed: number, i: number): { c: Rgb; p: number; r0: number } => {
  switch (l.kind) {
    case "tube": return { c: TUBE, p: 1, r0: 1.9 };
    case "pendant": return { c: WARM, p: 0.85, r0: 1.9 };
    case "lamp": return { c: WARM, p: 0.5, r0: 1.3 };
    case "neon": return { c: NEON[Math.floor(hash01(seed + i, 326) * NEON.length) % NEON.length] as Rgb, p: 0.3, r0: 1.4 };
  }
};

/** The mean the room's lights are brought to (their sum on a floor, linear), by whether it is open. */
const EXPOSURE_OPEN = 0.7;
const AMBIENT_OPEN = 0.13;
const AMBIENT_SHUT = 0.04;
const AMBIENT_VACANT = 0.05;

export function roomField(i: FieldIn): RoomField {
  const w = i.s1 - i.s0;
  const nS = Math.max(2, Math.ceil(w / i.step) + 1);
  const nD = Math.max(2, Math.ceil(i.depth / i.step) + 1);
  const cs = w / (nS - 1);
  const cd = i.depth / (nD - 1);
  const cell = new Float32Array(nS * nD * 3);
  const dead: boolean[] = i.lights.map((l, k) => l.on && l.kind === "tube" && hash01(i.seed + k * 13, 701) < i.wear);
  const working = i.lights.map((l, k) => l.on && !dead[k]);
  const sources = i.lights.map((l, k) => ({ l, ...lightColour(l, i.seed, k) }));
  const ky = 1.3;
  // The room's own lights, each node's share; the sum is brought to an exposure with every light working, so a dead tube is a dark patch and not a brighter room.
  const sumAt = (s: number, d: number, count: (k: number) => boolean, out: [number, number, number]): void => {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let k = 0; k < sources.length; k++) {
      if (!count(k)) continue;
      const src = sources[k] as (typeof sources)[number];
      const dx = s - src.l.s;
      const dz = d - src.l.d;
      const dy = Math.max(0, src.l.h - ky);
      const q = (dx * dx + dz * dz + dy * dy) / (src.r0 * src.r0);
      const k2 = src.p / (1 + q);
      out[0] += src.c[0] * k2;
      out[1] += src.c[1] * k2;
      out[2] += src.c[2] * k2;
    }
  };
  const tmp: [number, number, number] = [0, 0, 0];
  // The exposure: the mean of the sum with every lit light working.
  let allMean = 0;
  let nodes = 0;
  for (let b = 0; b < nD; b += 2) {
    for (let a = 0; a < nS; a += 2) {
      sumAt(i.s0 + a * cs, b * cd, (k) => (i.lights[k] as RoomLight).on, tmp);
      allMean += (tmp[0] + tmp[1] + tmp[2]) / 3;
      nodes++;
    }
  }
  allMean = nodes > 0 ? allMean / nodes : 1;
  const gain = allMean > 1e-4 ? EXPOSURE_OPEN / allMean : 0;
  const ambient = i.lit ? AMBIENT_OPEN : i.vacant ? AMBIENT_VACANT : AMBIENT_SHUT;
  const ambC: Rgb = i.lit ? [1, 0.92, 0.78] : [0.8, 0.88, 1];
  let sum = 0;
  for (let b = 0; b < nD; b++) {
    for (let a = 0; a < nS; a++) {
      const s = i.s0 + a * cs;
      const d = b * cd;
      sumAt(s, d, (k) => working[k] === true, tmp);
      let r = tmp[0] * gain + ambient * ambC[0];
      let g = tmp[1] * gain + ambient * ambC[1];
      let bl = tmp[2] * gain + ambient * ambC[2];
      // The day through the front: each opening lights the floor and walls in front of it, wider than itself, and fades with depth.
      let day = 0;
      for (const o of i.openings) {
        if (o.through <= 0) continue;
        const out = s < o.s0 ? o.s0 - s : s > o.s1 ? s - o.s1 : 0;
        const lateral = Math.max(0, 1 - out / (1.5 + d * 0.25));
        const reach = 1 / (1 + (d * d) / (2.6 * 2.6));
        day += o.through * lateral * reach;
      }
      day = Math.min(1.1, day);
      // Under the lights the day is a small part; in a shut or vacant room it is nearly all there is.
      const dayK = i.lit ? 0.4 : 0.5;
      r += SKY[0] * day * dayK;
      g += SKY[1] * day * dayK;
      bl += SKY[2] * day * dayK;
      // The lamp in the back room, through the doorway at the back: a warm spill on the back wall's foot.
      if (i.backLamp !== null && i.lit) {
        const q = ((s - i.backLamp) * (s - i.backLamp) + (d - i.depth) * (d - i.depth)) / 6;
        const k2 = 0.25 / (1 + q);
        r += WARM[0] * k2;
        g += WARM[1] * k2;
        bl += WARM[2] * k2;
      }
      const o = (b * nS + a) * 3;
      cell[o] = r;
      cell[o + 1] = g;
      cell[o + 2] = bl;
      sum += (r + g + bl) / 3;
    }
  }
  // The furnishings' footprints (those big enough to throw a shadow on the floor), in the frame.
  const feet = i.furnishings
    .filter((f) => f.sx * f.sd >= 0.35 && f.kind !== "ladder" && f.kind !== "paint cans")
    .map((f) => ({ s: f.s, d: f.d, hx: f.sx / 2, hz: f.sd / 2, ax: f.dir.x, az: f.dir.z, h: f.h }));
  const out: [number, number, number] = [0, 0, 0];
  /** What `at` hands back: one array reused, to be read before the next call. */
  const scratch: [number, number, number] = [0, 0, 0];
  const sample = (s: number, d: number): void => {
    const u = Math.min(nS - 1.0001, Math.max(0, (s - i.s0) / cs));
    const v = Math.min(nD - 1.0001, Math.max(0, d / cd));
    const a = Math.floor(u);
    const b = Math.floor(v);
    const fu = u - a;
    const fv = v - b;
    const o00 = (b * nS + a) * 3;
    const o10 = o00 + 3;
    const o01 = o00 + nS * 3;
    const o11 = o01 + 3;
    for (let c = 0; c < 3; c++) {
      const top = (cell[o00 + c] as number) * (1 - fu) + (cell[o10 + c] as number) * fu;
      const bot = (cell[o01 + c] as number) * (1 - fu) + (cell[o11 + c] as number) * fu;
      out[c] = top * (1 - fv) + bot * fv;
    }
  };
  return {
    dead,
    mean: nodes > 0 ? sum / (nS * nD) : 0,
    at(s, d, y, up) {
      sample(s, d);
      // A floor is lit square on, a wall less, and more nearer the lights at its top; a ceiling takes what bounces up.
      const k = up > 0.5 ? 1 : up < -0.5 ? 0.4 : 0.55 + 0.45 * Math.min(1, Math.max(0, y / i.ceiling));
      scratch[0] = out[0] * k;
      scratch[1] = out[1] * k;
      scratch[2] = out[2] * k;
      return scratch;
    },
    under(s, d) {
      let k = 1;
      for (const f of feet) {
        const dx = s - f.s;
        const dz = d - f.d;
        const u = Math.abs(dx * f.ax + dz * f.az);
        const v = Math.abs(-dx * f.az + dz * f.ax);
        const ex = Math.max(0, u - f.hx);
        const ez = Math.max(0, v - f.hz);
        const dist = Math.sqrt(ex * ex + ez * ez);
        const near = 1 - dist / 0.4;
        if (near > 0) k *= 1 - 0.62 * Math.min(1, near);
      }
      return Math.max(0.3, k);
    },
  };
}
