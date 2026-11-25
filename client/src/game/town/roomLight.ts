/**
 * The light in a room, baked: what a person at the glass sees of a room is its own lights, the day coming in at the front, and a little
 * that bounces. This builds that as a field over the room's plan (a lattice of colours, `roomField`), which the room's surfaces and
 * furnishings are lit from at their corners (`at`), so that an open shop is warm and brightest under its tubes, a failed tube leaves a
 * dim patch, the day fades with depth from the glass, a shut shop is dim with one night light and a vacant one is grey and bare. The
 * furnishings darken the floor beneath them (`under`).
 *
 * The light is not even. A lamp lights what is under it and little else: its light falls off fast with distance (`FALL`), so a room is
 * pools of light with dimmer floor between them and dark in its corners, at the foot of its walls and up at the ceiling's edge (`corner`,
 * `edge`), and what bounces about the room (the ambient) is small. The room is brought to an exposure by its brightest place, not its
 * mean, so a room with few lights is a dim room with a bright pool in it and not a room evenly half lit. No two lamps are equally
 * bright (a tube yellows and dims with age).
 *
 * And a room is a stage at its window. The two metres behind the glass are what the street sees, and they are seen as they are, a
 * little brighter at the glass (`depthLight`). Behind them the room is veiled: from `VEIL_FROM` to `VEIL_TO` everything runs to one bright,
 * even tone, the room's own light with nothing in it (`veil`, the field's `veil` colour, laid on every lit colour by `roomKit.ts`'s `shade`).
 * That is what a steamed or dusty pane does to a lit room: the lights are on and the room is bright, and what stands in it past the front
 * is a faint shape or nothing. It is there so that a room need be furnished only at its front; the lights stay on to the back wall.
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
  /** The mean the lights are brought to, where the room is darker or brighter than a shop (a bar's is low). */
  readonly exposure?: number;
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
  /** What everything behind the front of the room runs to (`veil`): the room's own light as one even tone. */
  readonly veil: Rgb;
};

const SKY: Rgb = [0.62, 0.68, 0.76];
const TUBE: Rgb = [1.0, 0.95, 0.84];
const WARM: Rgb = [1.0, 0.8, 0.52];
const NEON: readonly Rgb[] = [[1, 0.2, 0.15], [0.25, 0.55, 1], [1, 0.5, 0.15], [0.3, 1, 0.45]];

/**
 * A light's colour, its strength and the distance (m) at which it has fallen to a share of itself (`FALL`). The reaches are short: a tube
 * lights the two or three metres under it, a pendant its table, a lamp its desk. Each light's strength is its kind's times an age of its own
 * (0.55 to 1.25: a tube dims and yellows, a bulb is whatever was in the drawer).
 */
const lightColour = (l: RoomLight, seed: number, i: number): { c: Rgb; p: number; r0: number } => {
  const age = 0.55 + 0.7 * hash01(seed + i * 29, 913);
  switch (l.kind) {
    case "tube": return { c: [TUBE[0], TUBE[1] * (0.96 + 0.04 * age), TUBE[2] * (0.8 + 0.2 * age)], p: 1 * age, r0: 1.45 };
    case "pendant": return { c: WARM, p: 0.85 * age, r0: 1.15 };
    case "lamp": return { c: WARM, p: 0.5 * age, r0: 0.9 };
    case "neon": return { c: NEON[Math.floor(hash01(seed + i, 326) * NEON.length) % NEON.length] as Rgb, p: 0.3, r0: 1.1 };
  }
};

/** How fast a light falls off: its share at a distance q (in its own reach, squared) is 1 / (1 + q)^FALL. At 1 it is a soft glow that fills a room; at 2.2 a pool. */
const FALL = 2.2;
/** What the brightest place on the room's floor is brought to with every lit light working (linear), by whether it is open: the rest of the room falls from it. */
const EXPOSURE_OPEN = 1.0;
/** What a room's exposure was stated as before it was its brightest place (a mean of 0.7): a caller's own (`FieldIn.exposure`, a bar's 0.42) is scaled by the same. */
const EXPOSURE_WAS = 0.7;
/** What bounces about the room and reaches everything: a little. */
const AMBIENT_OPEN = 0.022;
const AMBIENT_SHUT = 0.014;
const AMBIENT_VACANT = 0.02;
/** How much darker a room is in a corner, along a wall's foot, up at the ceiling's edge and on the floor against a wall, and over what distance (m) each lifts. */
/** Where behind the glass the veil begins and where it is whole, metres: the front of the room is seen, the rest is not. */
export const VEIL_FROM = 1.1;
export const VEIL_TO = 2.2;
/** How far behind the glass the room as drawn ends at its painted sheet (`roomBackdrop.ts`), metres: just past where the veil is whole. */
export const BACKDROP_AT = 2.4;
/** A room no deeper than the sheet and this has none: there is no back to paint. */
export const BACKDROP_MIN_BEHIND = 1.2;
/** How much of a thing is gone into the veil where it is whole: the rest is the faint shape that says the room is not bare. */
export const VEIL_FULL = 0.93;
/** How bright the veil of a lit room is (linear), and of a shut or vacant one as a share of its own mean light. */
const VEIL_LIT = 0.4;
const VEIL_UNLIT = 0.6;
/** How much brighter than itself the room is right at the glass. */
const FRONT_BOOST = 0.25;

const ease = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** How much of the room's light reaches a place `d` metres behind the glass: a little over 1 at the glass, 1 from `VEIL_TO` to the back wall. */
export function depthLight(d: number): number {
  return 1 + FRONT_BOOST * (1 - Math.min(1, Math.max(0, d) / VEIL_TO));
}

/** How far a thing `d` metres behind the glass has run to the veil: 0 (itself) to `VEIL_FROM`, `VEIL_FULL` from `VEIL_TO`. */
export function veil(d: number): number {
  return VEIL_FULL * ease((d - VEIL_FROM) / (VEIL_TO - VEIL_FROM));
}
const CORNER_DARK = 0.45;
const CORNER_REACH = 0.9;
const EDGE_DARK = 0.3;
const EDGE_REACH = 0.45;

export function roomField(i: FieldIn): RoomField {
  const w = i.s1 - i.s0;
  const nS = Math.max(2, Math.ceil(w / i.step) + 1);
  const nD = Math.max(2, Math.ceil(i.depth / i.step) + 1);
  const cs = w / (nS - 1);
  const cd = i.depth / (nD - 1);
  const cell = new Float32Array(nS * nD * 3);
  // A tube that has failed.
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
      const k2 = src.p / Math.pow(1 + q, FALL);
      out[0] += src.c[0] * k2;
      out[1] += src.c[1] * k2;
      out[2] += src.c[2] * k2;
    }
  };
  const tmp: [number, number, number] = [0, 0, 0];
  // The exposure: the brightest place on the floor with every lit light working is brought to it, and the rest of the room falls from there.
  let allPeak = 0;
  let nodes = 0;
  for (let b = 0; b < nD; b++) {
    for (let a = 0; a < nS; a++) {
      sumAt(i.s0 + a * cs, b * cd, (k) => (i.lights[k] as RoomLight).on, tmp);
      allPeak = Math.max(allPeak, (tmp[0] + tmp[1] + tmp[2]) / 3);
      nodes++;
    }
  }
  const gain = allPeak > 1e-4 ? (EXPOSURE_OPEN * (i.exposure ?? EXPOSURE_WAS)) / EXPOSURE_WAS / allPeak : 0;
  const ambient = i.lit ? AMBIENT_OPEN : i.vacant ? AMBIENT_VACANT : AMBIENT_SHUT;
  const ambC: Rgb = i.lit ? [1, 0.92, 0.78] : [0.8, 0.88, 1];
  let sum = 0;
  const sumC: [number, number, number] = [0, 0, 0];
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
      const dayK = i.lit ? 0.3 : 0.5;
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
      // The room is its window's stage: a little brighter at the glass.
      const fade = depthLight(d);
      r *= fade;
      g *= fade;
      bl *= fade;
      const o = (b * nS + a) * 3;
      cell[o] = r;
      cell[o + 1] = g;
      cell[o + 2] = bl;
      sum += (r + g + bl) / 3;
      sumC[0] += r;
      sumC[1] += g;
      sumC[2] += bl;
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
  // The veil: the colour of the room's own light. A lit room's is brought to one brightness (less in a room kept dim, a bar), so that the
  // room behind the front reads as lit; a shut or vacant room's is its own dim mean.
  const lum = (sumC[0] + sumC[1] + sumC[2]) / 3;
  const veilK = lum <= 1e-6 ? 0 : i.lit ? (VEIL_LIT * (i.exposure ?? EXPOSURE_WAS)) / EXPOSURE_WAS / lum : VEIL_UNLIT / (nS * nD);
  const veilC: Rgb = [sumC[0] * veilK, sumC[1] * veilK, sumC[2] * veilK];
  return {
    dead,
    veil: veilC,
    mean: nodes > 0 ? sum / (nS * nD) : 0,
    at(s, d, y, up) {
      sample(s, d);
      // A floor is lit square on, a wall less, and more nearer the lights at its top; a ceiling takes what bounces up.
      let k = up > 0.5 ? 1 : up < -0.5 ? 0.3 : 0.42 + 0.4 * Math.min(1, Math.max(0, y / i.ceiling));
      // Less light reaches where two walls meet, and where a wall meets the floor or the ceiling: the distance to the nearest wall across the
      // room (`e`), to the nearest corner in plan (`c`), and up or down a wall to its foot and its head.
      const eS = Math.min(s - i.s0, i.s1 - s);
      const eD = Math.min(d, i.depth - d);
      const e = Math.max(0, Math.min(eS, eD));
      const c = Math.sqrt(Math.max(0, eS) * Math.max(0, eS) + Math.max(0, eD) * Math.max(0, eD));
      k *= 1 - CORNER_DARK * Math.exp(-c / CORNER_REACH);
      if (up > 0.5 || up < -0.5) k *= 1 - EDGE_DARK * Math.exp(-e / EDGE_REACH);
      else k *= (1 - EDGE_DARK * Math.exp(-Math.max(0, y) / EDGE_REACH)) * (1 - EDGE_DARK * Math.exp(-Math.max(0, i.ceiling - y) / EDGE_REACH));
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
